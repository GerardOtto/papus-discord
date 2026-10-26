// Trivia de los Papus (PLAN §3.4): partidas en curso, revision de cada respuesta, XP al instante y registro de las
// rachas. La partida en curso vive en memoria (dura segundos por pregunta; tras un reinicio se pierde, pero la XP ya
// ganada queda); lo demas en SQLite (xp_dia.trivia, trivia_vistas, trivia_partidas). Sin Discord: src/discord/trivia.ts
// muestra las preguntas, los botones y el resultado.
import { transaction, type Db } from "../db/database";
import type { LevelChange, LevelService } from "../levels/service";
import { dayKey } from "../time";
import { answerXp, playOrder, shuffledOptions, textCorrect, timerFor, type Question, type TriviaSettings } from "./rules";

/** Como termino una partida. perfecta = acerto todas las preguntas sin fallar (el secreto). */
export type EndReason = "error" | "tiempo" | "perfecta";

/** Pregunta en pantalla. */
export interface Shown {
  question: Question;
  /** Numero de la pregunta en la partida (1 = la primera). */
  number: number;
  /** opciones: barajadas (vacio en las de texto). */
  options: string[];
  correct: number;
  /** Cambia con cada pregunta: un boton de una pregunta anterior ya no vale. */
  nonce: string;
  deadline: number;
}

interface Session {
  userId: string;
  channelId: string;
  order: string[];
  pos: number;
  streak: number;
  xp: number;
  shown: Shown;
}

export interface RunSummary {
  userId: string;
  channelId: string;
  streak: number;
  xp: number;
  reason: EndReason;
  /** Mejor racha del Papu contando esta. */
  best: number;
  /** ¿Es su nueva mejor racha? */
  record: boolean;
}

export type AnswerResult =
  /** Acerto: `next` es la siguiente pregunta (o null si era la ultima: partida perfecta, ver `end`). */
  | { kind: "acierto"; question: Question; xp: number; streak: number; change: LevelChange | null; next: Shown | null; end: RunSummary | null }
  /** Fallo o se acabo el tiempo: la partida termino. */
  | { kind: "fallo" | "tiempo"; question: Question; picked: string | null; end: RunSummary }
  /** Boton o respuesta de una pregunta que ya paso (o de una partida que ya no existe). */
  | { kind: "vieja" };

export interface TriviaServiceDeps {
  db: Db;
  settings: TriviaSettings;
  questions: Question[];
  levels: LevelService;
  timeZone: string;
  now?: () => number;
  rnd?: () => number;
}

export class TriviaService {
  private readonly now: () => number;
  private readonly rnd: () => number;
  private readonly byId: Map<string, Question>;
  private readonly sessions = new Map<string, Session>();
  private counter = 0;

  constructor(private readonly d: TriviaServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
    this.byId = new Map(d.questions.map((q) => [q.id, q]));
  }

  get settings(): TriviaSettings {
    return this.d.settings;
  }

  /** Cuantas preguntas hay (las que debe acertar una racha perfecta). */
  get total(): number {
    return this.d.questions.length;
  }

  private day(t = this.now()): string {
    return dayKey(new Date(t), this.d.timeZone);
  }

  // ───────────────────────── partida ─────────────────────────

  /** Partida en curso del Papu (si su tiempo no vencio). */
  active(userId: string): Shown | null {
    return this.sessions.get(userId)?.shown ?? null;
  }

  /** Empieza una partida. Si ya tiene una, devuelve esa (`busy`). */
  start(userId: string, channelId: string): { shown: Shown; busy: boolean } {
    const current = this.sessions.get(userId);
    if (current) return { shown: current.shown, busy: true };
    const seen = new Set((this.d.db.prepare("SELECT pregunta FROM trivia_vistas WHERE user_id = ?").all(userId) as { pregunta: string }[]).map((r) => r.pregunta));
    const order = playOrder(this.d.questions, seen, this.rnd);
    const s: Session = { userId, channelId, order, pos: 0, streak: 0, xp: 0, shown: null as unknown as Shown };
    s.shown = this.show(s);
    this.sessions.set(userId, s);
    return { shown: s.shown, busy: false };
  }

  private show(s: Session): Shown {
    const question = this.byId.get(s.order[s.pos]!)!;
    const { options, correct } = question.kind === "opciones" ? shuffledOptions(question, this.rnd) : { options: [], correct: -1 };
    this.d.db.prepare("INSERT INTO trivia_vistas (user_id, pregunta) VALUES (?, ?) ON CONFLICT DO NOTHING").run(s.userId, question.id);
    return { question, number: s.pos + 1, options, correct, nonce: `${Date.now().toString(36)}${(this.counter++).toString(36)}`, deadline: this.now() + timerFor(this.d.settings, question) * 1000 };
  }

  /** Eligio una opcion (indice en las barajadas). */
  answerOption(userId: string, nonce: string, index: number): AnswerResult {
    const s = this.current(userId, nonce);
    if (!s) return { kind: "vieja" };
    return this.resolve(s, s.shown.question.kind === "opciones" && index === s.shown.correct, s.shown.options[index] ?? null);
  }

  /** Escribio una respuesta (preguntas de texto). */
  answerText(userId: string, nonce: string, text: string): AnswerResult {
    const s = this.current(userId, nonce);
    if (!s) return { kind: "vieja" };
    return this.resolve(s, s.shown.question.kind === "texto" && textCorrect(s.shown.question, text), text.trim().slice(0, 100) || null);
  }

  /** Lo llama el temporizador: si la pregunta sigue sin respuesta y vencio, la partida termina. */
  timeout(userId: string, nonce: string): AnswerResult | null {
    const s = this.sessions.get(userId);
    if (!s || s.shown.nonce !== nonce || this.now() < s.shown.deadline) return null;
    return { kind: "tiempo", question: s.shown.question, picked: null, end: this.finish(s, "tiempo") };
  }

  /** La sesion si el nonce es el de la pregunta en pantalla (si el tiempo ya vencio, `resolve` la cierra). */
  private current(userId: string, nonce: string): Session | null {
    const s = this.sessions.get(userId);
    if (!s || s.shown.nonce !== nonce) return null;
    return s;
  }

  private resolve(s: Session, ok: boolean, picked: string | null): AnswerResult {
    const question = s.shown.question;
    if (this.now() > s.shown.deadline) return { kind: "tiempo", question, picked, end: this.finish(s, "tiempo") };
    if (!ok) return { kind: "fallo", question, picked, end: this.finish(s, "error") };
    s.streak++;
    const { xp, change } = this.award(s.userId, s.streak);
    s.xp += xp;
    s.pos++;
    if (s.pos >= s.order.length) return { kind: "acierto", question, xp, streak: s.streak, change, next: null, end: this.finish(s, "perfecta") };
    s.shown = this.show(s);
    return { kind: "acierto", question, xp, streak: s.streak, change, next: s.shown, end: null };
  }

  // ───────────────────────── XP ─────────────────────────

  /**
   * XP promedio por dia activo del Papu en los ultimos `dias` dias (sin hoy y sin la XP de la trivia): lo que viene
   * creciendo charlando, en voz, en bodas y en la ruleta.
   */
  dailyAvg(userId: string, t = this.now()): number {
    const from = dayKey(new Date(t - this.d.settings.xp.dias * 86_400_000), this.d.timeZone);
    const row = this.d.db
      .prepare("SELECT AVG(xp - trivia) AS avg FROM xp_dia WHERE user_id = ? AND day >= ? AND day < ? AND xp - trivia > 0")
      .get(userId, from, this.day(t)) as { avg: number | null };
    return row.avg ?? 0;
  }

  /** Aciertos de hoy en la trivia (todas las partidas). */
  correctToday(userId: string, t = this.now()): number {
    const r = this.d.db.prepare("SELECT trivia_aciertos AS n FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, this.day(t)) as { n: number } | undefined;
    return r?.n ?? 0;
  }

  private award(userId: string, streak: number): { xp: number; change: LevelChange | null } {
    const t = this.now();
    return transaction(this.d.db, () => {
      const xp = answerXp(this.d.settings, this.d.levels.settings, {
        xp: this.d.levels.store.get(userId).xp,
        dailyAvg: this.dailyAvg(userId, t),
        streak,
        correctToday: this.correctToday(userId, t),
        multiplier: this.d.levels.multiplier(new Date(t)),
      });
      const change = this.d.levels.bonus(userId, xp, t);
      this.d.db
        .prepare("INSERT INTO xp_dia (user_id, day, trivia, trivia_aciertos) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET trivia = trivia + excluded.trivia, trivia_aciertos = trivia_aciertos + 1")
        .run(userId, this.day(t), xp);
      return { xp, change };
    });
  }

  // ───────────────────────── rachas ─────────────────────────

  best(userId: string): number {
    const r = this.d.db.prepare("SELECT MAX(racha) AS m FROM trivia_partidas WHERE user_id = ?").get(userId) as { m: number | null };
    return r.m ?? 0;
  }

  /** ¿Ya hizo alguna vez la racha perfecta? */
  perfectBefore(userId: string): boolean {
    return !!this.d.db.prepare("SELECT 1 FROM trivia_partidas WHERE user_id = ? AND fin = 'perfecta' LIMIT 1").get(userId);
  }

  private finish(s: Session, reason: EndReason): RunSummary {
    this.sessions.delete(s.userId);
    const before = this.best(s.userId);
    this.d.db.prepare("INSERT INTO trivia_partidas (user_id, day, racha, xp, fin, at) VALUES (?, ?, ?, ?, ?, ?)").run(s.userId, this.day(), s.streak, s.xp, reason, this.now());
    return { userId: s.userId, channelId: s.channelId, streak: s.streak, xp: s.xp, reason, best: Math.max(before, s.streak), record: s.streak > before && s.streak > 0 };
  }

  /** Mejores rachas del servidor (para el resultado publico). */
  top(limit = 3): { userId: string; streak: number }[] {
    return (this.d.db.prepare("SELECT user_id, MAX(racha) AS m FROM trivia_partidas GROUP BY user_id ORDER BY m DESC, MIN(at) LIMIT ?").all(limit) as { user_id: string; m: number }[])
      .filter((r) => r.m > 0)
      .map((r) => ({ userId: r.user_id, streak: r.m }));
  }
}
