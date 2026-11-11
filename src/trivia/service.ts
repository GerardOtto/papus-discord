// Trivia de los Papus (PLAN §3.4): partidas en curso, revision de cada respuesta, XP al instante y registro de las
// rachas. La partida en curso vive en memoria (dura segundos por pregunta; tras un reinicio se pierde, pero la XP ya
// ganada queda); lo demas en SQLite (xp_dia.trivia, trivia_vistas, trivia_partidas). Sin Discord: src/discord/trivia.ts
// muestra las preguntas, los botones y el resultado.
import { kvGet, kvSet, transaction, type Db } from "../db/database";
import type { LevelChange, LevelService } from "../levels/service";
import { reinicioDe } from "../mercado/reinicios";
import { dayKey, nextDayStart } from "../time";
import { answerXp, dailyCap, DIFICULTADES, playOrder, runCost, shuffledOptions, textCorrect, timerFor, type Dificultad, type PremioSobre, type Question, type TriviaSettings } from "./rules";

/**
 * Una partida cuya pregunta vencio hace mas de esto sigue abierta solo si algo fallo al mostrarla (Discord no recibio
 * la respuesta a tiempo y no se armo el temporizador): la siguiente vez que el Papu juega, se cierra por tiempo. Asi
 * nadie queda con una trivia "en curso" para siempre (le paso a Wicho el Bicho el 5 nov. 2026).
 */
export const STALE_MS = 10_000;

/** Hito cumplido con un acierto: dificultad, aciertos que lleva en ella y el sobre que ya recibio. */
export interface Milestone {
  level: Dificultad;
  n: number;
  premio: PremioSobre;
}

/** Como termino una partida. perfecta = acerto todas las preguntas de su dificultad sin fallar. */
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
  /** Racha de la partida al mostrarla (sigue tras la Baguette de Teto, asi que no siempre es number - 1). */
  streak: number;
  /** Opciones borradas por el Celular de Neru (indices en `options`). */
  hidden?: number[];
}

/**
 * Pausa tras un error o tiempo agotado cuando el Papu tiene la Baguette de Teto (mercado negro): decide si sigue la
 * partida o la termina. Si no decide antes de `deadline`, termina como si no la tuviera.
 */
interface Pause {
  nonce: string;
  deadline: number;
  reason: "error" | "tiempo";
  question: Question;
  picked: string | null;
}

/** Un consumible del mercado negro (src/mercado/): usos que le quedan y gastar uno. */
export interface ConsumablePort {
  usos(userId: string): number;
  consume(userId: string): boolean;
}

/** La partida dentro del dia: si da XP (las primeras `partidasConXp`) y cuanta XP le queda al tope del dia. */
export interface RunInfo {
  /** Numero de partida de hoy (1 = la primera). */
  run: number;
  withXp: boolean;
  /** XP que aun puede ganar hoy en la trivia. */
  capLeft: number;
  /** Cuando se recargan las partidas con XP y el tope (medianoche, hora de Chile). */
  resetsAt: number;
  /** XP que le costo empezar esta partida (las de despues de la 15 del dia; 0 en las demas). */
  cost: number;
}

interface Session {
  userId: string;
  level: Dificultad;
  info: RunInfo;
  channelId: string;
  order: string[];
  pos: number;
  streak: number;
  xp: number;
  shown: Shown;
  /** Veces que siguio tras fallar con la Baguette de Teto en esta partida, y si ya gasto un uso en ella. */
  revives: number;
  baguette: boolean;
  pause: Pause | null;
  /** Guitarra de flower: desde que la toco, los aciertos de esta partida dan el doble de XP. */
  guitar: boolean;
  /** Zanahoria de Gumi: tema elegido para la siguiente pregunta (y en que pregunta se eligio). */
  carrot: { pos: number; topic: string } | null;
}

export interface RunSummary {
  userId: string;
  level: Dificultad;
  channelId: string;
  streak: number;
  xp: number;
  /** ¿Era una de las partidas del dia que dan XP? */
  withXp: boolean;
  reason: EndReason;
  /** Mejor racha del Papu contando esta. */
  best: number;
  /** ¿Es su nueva mejor racha? */
  record: boolean;
}

export type AnswerResult =
  /**
   * Acerto: `next` es la siguiente pregunta (o null si era la ultima: partida perfecta, ver `end`). `completed` = con este
   * acierto supero todas las preguntas de esa dificultad (ya recibio su sobre); `secret` = con este acierto supero TODAS
   * las preguntas de la trivia por primera vez (Papu Lince: ya recibio sus sobres; el rol y el anuncio los da Discord).
   */
  | { kind: "acierto"; question: Question; xp: number; info: RunInfo; streak: number; change: LevelChange | null; next: Shown | null; end: RunSummary | null; completed: Dificultad | null; secret: boolean; milestone: Milestone | null }
  /** Fallo o se acabo el tiempo: la partida termino. */
  | { kind: "fallo" | "tiempo"; question: Question; picked: string | null; end: RunSummary }
  /**
   * Fallo o se acabo el tiempo, pero tiene la Baguette de Teto: la partida queda en pausa hasta `deadline` para que
   * decida (revive o giveUp con `nonce`). `vidas` = veces que aun puede seguir en esta partida; `usos` = usos de la
   * Baguette que le quedan; `gasta` = seguir ahora gasta un uso (la primera vez en la partida).
   */
  | { kind: "salvable"; reason: "error" | "tiempo"; question: Question; picked: string | null; nonce: string; deadline: number; vidas: number; usos: number; gasta: boolean; streak: number }
  /** Boton o respuesta de una pregunta que ya paso (o de una partida que ya no existe). */
  | { kind: "vieja" };

export interface TriviaServiceDeps {
  db: Db;
  settings: TriviaSettings;
  questions: Question[];
  levels: LevelService;
  /** Da el sobre de premio de una dificultad (src/coins/). Sin tienda, solo se registra. */
  giveSobre?: (userId: string, tipo: PremioSobre, n?: number) => void;
  /**
   * Consumibles del mercado negro (src/mercado/; sin mercado, no hay): la Baguette de Teto (seguir tras fallar hasta
   * `vidas` veces por partida; `espera` = segundos para decidir) y el Celular de Neru (borra dos opciones incorrectas).
   */
  baguette?: ConsumablePort & { vidas: number; espera: number };
  celular?: ConsumablePort;
  /** Guitarra de flower (doble XP el resto de la partida) y Zanahoria de Gumi (elegir el tema de la siguiente). */
  guitarra?: ConsumablePort;
  zanahoria?: ConsumablePort;
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

  /** Cuantas preguntas hay en total (las que hay que superar para el secreto), o de una dificultad. */
  get total(): number {
    return this.d.questions.length;
  }

  totalOf(level: Dificultad): number {
    return this.d.questions.filter((q) => q.level === level).length;
  }

  /** Preguntas que el Papu ya supero (acerto alguna vez, desde el 31 oct. 2026). */
  private passed(userId: string): Set<string> {
    return new Set((this.d.db.prepare("SELECT pregunta FROM trivia_superadas WHERE user_id = ?").all(userId) as { pregunta: string }[]).map((r) => r.pregunta));
  }

  /** Contador de superadas por dificultad (las que ya no existen no cuentan) y si ya gano su sobre. */
  progress(userId: string): Record<Dificultad, { done: number; total: number; prize: boolean }> {
    const passed = this.passed(userId);
    const prizes = new Set((this.d.db.prepare("SELECT dificultad FROM trivia_premios WHERE user_id = ?").all(userId) as { dificultad: string }[]).map((r) => r.dificultad));
    const out = {} as Record<Dificultad, { done: number; total: number; prize: boolean }>;
    for (const level of DIFICULTADES) {
      const qs = this.d.questions.filter((q) => q.level === level);
      out[level] = { done: qs.filter((q) => passed.has(q.id)).length, total: qs.length, prize: prizes.has(level) };
    }
    return out;
  }

  private day(t = this.now()): string {
    return dayKey(new Date(t), this.d.timeZone);
  }

  // ───────────────────────── partida ─────────────────────────

  /** Partida en curso del Papu. */
  active(userId: string): Shown | null {
    return this.sessions.get(userId)?.shown ?? null;
  }

  /**
   * Cierra por tiempo la partida del Papu si quedo colgada (su pregunta vencio hace mas de STALE_MS: el temporizador
   * no corrio). Devuelve su resumen para publicarlo, o null si no habia nada que cerrar.
   */
  reap(userId: string, t = this.now()): RunSummary | null {
    const s = this.sessions.get(userId);
    if (!s || t <= (s.pause?.deadline ?? s.shown.deadline) + STALE_MS) return null;
    return this.finish(s, s.pause?.reason ?? "tiempo");
  }

  /** Conecta los consumibles del mercado negro (se crea despues de la trivia: necesita contar sus partidas). */
  useConsumables(c: { baguette?: TriviaServiceDeps["baguette"]; celular?: ConsumablePort; guitarra?: ConsumablePort; zanahoria?: ConsumablePort }): void {
    this.d.guitarra = c.guitarra;
    this.d.zanahoria = c.zanahoria;
    this.d.baguette = c.baguette;
    this.d.celular = c.celular;
  }

  /** Partidas que el Papu empezo hoy (ya terminadas). */
  runsToday(userId: string, t = this.now()): number {
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM trivia_partidas WHERE user_id = ? AND day = ?").get(userId, this.day(t)) as { n: number }).n;
  }

  /** Partidas de hoy que cuentan para las partidas con XP: desde el ultimo PC de Adachi Rei, si lo uso. */
  runsCounted(userId: string, t = this.now()): number {
    return this.runsToday(userId, t) - reinicioDe(this.d.db, userId, this.day(t)).triviaPartidas;
  }

  /** XP que la trivia le dio hoy. */
  xpToday(userId: string, t = this.now()): number {
    const r = this.d.db.prepare("SELECT trivia AS n FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, this.day(t)) as { n: number } | undefined;
    return r?.n ?? 0;
  }

  /** XP que aun puede ganar hoy en la trivia (el tope vuelve a empezar tras el PC de Adachi Rei). */
  private capLeft(userId: string, t = this.now()): number {
    const xp = this.xpToday(userId, t) - reinicioDe(this.d.db, userId, this.day(t)).triviaXp;
    return Math.max(0, dailyCap(this.d.settings, this.d.levels.settings, this.d.levels.store.get(userId).xp, this.d.levels.multiplier(new Date(t))) - xp);
  }

  /** XP que le costaria empezar ahora otra partida (0 si aun no pasa de las gratis del dia). */
  nextCost(userId: string, t = this.now()): number {
    return runCost(this.d.settings, this.d.levels.settings, this.d.levels.store.get(userId).xp, this.runsCounted(userId, t) + 1);
  }

  /** Cuando vuelven las partidas gratis (medianoche, hora de Chile). */
  resetsAt(t = this.now()): number {
    return nextDayStart(new Date(t), this.d.timeZone);
  }

  /**
   * Empieza una partida de una dificultad. Si ya tiene una, devuelve esa (`busy`). Si la partida cuesta XP (despues de
   * la 15 del dia), se cobra aqui: quien la muestra debe pedir confirmacion antes con `nextCost`. `change` = si el
   * cobro lo bajo de nivel.
   */
  start(userId: string, channelId: string, level: Dificultad): { shown: Shown; busy: boolean; info: RunInfo; level: Dificultad; change: LevelChange | null } {
    this.reap(userId);
    const current = this.sessions.get(userId);
    if (current) return { shown: current.shown, busy: true, info: current.info, level: current.level, change: null };
    const t = this.now();
    const run = this.runsCounted(userId, t) + 1;
    const cost = this.nextCost(userId, t);
    const info: RunInfo = { run, withXp: run <= this.d.settings.limites.partidasConXp, capLeft: this.capLeft(userId, t), resetsAt: this.resetsAt(t), cost };
    const seen = new Set((this.d.db.prepare("SELECT pregunta FROM trivia_vistas WHERE user_id = ?").all(userId) as { pregunta: string }[]).map((r) => r.pregunta));
    const order = playOrder(this.d.questions.filter((q) => q.level === level), seen, this.rnd, this.passed(userId));
    if (!order.length) throw new Error(`trivia: no hay preguntas de dificultad ${level}`);
    const change = cost > 0 ? this.d.levels.penalize(userId, cost, t) : null;
    const s: Session = { userId, level, info, channelId, order, pos: 0, streak: 0, xp: 0, shown: null as unknown as Shown, revives: 0, baguette: false, pause: null, guitar: false, carrot: null };
    s.shown = this.show(s);
    this.sessions.set(userId, s);
    return { shown: s.shown, busy: false, info, level, change };
  }

  private show(s: Session): Shown {
    const question = this.byId.get(s.order[s.pos]!)!;
    const { options, correct } = question.kind === "opciones" ? shuffledOptions(question, this.rnd) : { options: [], correct: -1 };
    this.d.db.prepare("INSERT INTO trivia_vistas (user_id, pregunta) VALUES (?, ?) ON CONFLICT DO NOTHING").run(s.userId, question.id);
    return { question, number: s.pos + 1, options, correct, nonce: this.nonce(), deadline: this.now() + timerFor(this.d.settings, question) * 1000, streak: s.streak };
  }

  private nonce(): string {
    return `${Date.now().toString(36)}${(this.counter++).toString(36)}`;
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

  /**
   * Lo llama el temporizador: si la pregunta sigue sin respuesta y vencio, la partida termina (o queda en pausa si tiene
   * la Baguette de Teto). Si estaba en pausa y no decidio a tiempo, termina.
   */
  timeout(userId: string, nonce: string): AnswerResult | null {
    const s = this.sessions.get(userId);
    if (!s) return null;
    if (s.pause) {
      if (s.pause.nonce !== nonce || this.now() < s.pause.deadline) return null;
      return this.end(s);
    }
    if (s.shown.nonce !== nonce || this.now() < s.shown.deadline) return null;
    return this.salvage(s, "tiempo", s.shown.question, null) ?? { kind: "tiempo", question: s.shown.question, picked: null, end: this.finish(s, "tiempo") };
  }

  /** La sesion si el nonce es el de la pregunta en pantalla (si el tiempo ya vencio, `resolve` la cierra). En pausa, ninguna. */
  private current(userId: string, nonce: string): Session | null {
    const s = this.sessions.get(userId);
    if (!s || s.pause || s.shown.nonce !== nonce) return null;
    return s;
  }

  private resolve(s: Session, ok: boolean, picked: string | null): AnswerResult {
    const question = s.shown.question;
    if (this.now() > s.shown.deadline) return this.salvage(s, "tiempo", question, picked) ?? { kind: "tiempo", question, picked, end: this.finish(s, "tiempo") };
    if (!ok) return this.salvage(s, "error", question, picked) ?? { kind: "fallo", question, picked, end: this.finish(s, "error") };
    s.streak++;
    const { xp, change } = s.info.withXp ? this.award(s.userId, s.streak, s.guitar ? 2 : 1) : (this.count(s.userId), { xp: 0, change: null });
    s.xp += xp;
    s.info = { ...s.info, capLeft: s.info.withXp ? this.capLeft(s.userId) : s.info.capLeft };
    const { completed, secret } = this.pass(s.userId, question);
    const milestone = !this.d.settings.hitos?.soloPartidasConXp || s.info.withXp ? this.hit(s.userId, question.level) : null;
    s.pos++;
    const base = { kind: "acierto" as const, question, xp, streak: s.streak, change, completed, secret, milestone };
    if (s.pos >= s.order.length) return { ...base, info: s.info, next: null, end: this.finish(s, "perfecta") };
    s.shown = this.show(s);
    return { ...base, info: s.info, next: s.shown, end: null };
  }

  // ───────────────────────── consumibles del mercado negro ─────────────────────────

  /**
   * Fallo con la Baguette de Teto: si aun puede seguir en esta partida (menos de `vidas` veces) y le queda un uso (o ya
   * gasto uno en esta partida), la partida queda en pausa para que decida. Si no, null (la partida termina).
   */
  private salvage(s: Session, reason: "error" | "tiempo", question: Question, picked: string | null): AnswerResult | null {
    const b = this.d.baguette;
    if (!b || s.revives >= b.vidas) return null;
    const usos = b.usos(s.userId);
    if (!s.baguette && usos <= 0) return null;
    s.pause = { nonce: this.nonce(), deadline: this.now() + b.espera * 1000, reason, question, picked };
    return { kind: "salvable", reason, question, picked, nonce: s.pause.nonce, deadline: s.pause.deadline, vidas: b.vidas - s.revives, usos, gasta: !s.baguette, streak: s.streak };
  }

  /** Termina una partida en pausa (no quiso seguir o no decidio a tiempo), como si no tuviera la Baguette. */
  private end(s: Session): AnswerResult {
    const p = s.pause!;
    return { kind: p.reason === "tiempo" ? "tiempo" : "fallo", question: p.question, picked: p.picked, end: this.finish(s, p.reason) };
  }

  /** La sesion en pausa con ese nonce (Baguette de Teto). */
  private paused(userId: string, nonce: string): Session | null {
    const s = this.sessions.get(userId);
    return s?.pause?.nonce === nonce ? s : null;
  }

  /**
   * Sigue la partida con la Baguette de Teto: la primera vez en la partida gasta un uso. La racha se mantiene y viene la
   * siguiente pregunta. Si ya no quedaban preguntas, la partida termina.
   */
  revive(userId: string, nonce: string): { kind: "sigue"; next: Shown; info: RunInfo; vidas: number; gasto: boolean } | AnswerResult {
    const s = this.paused(userId, nonce);
    if (!s) return { kind: "vieja" };
    if (this.now() > s.pause!.deadline + STALE_MS) return this.end(s);
    const gasto = !s.baguette;
    if (gasto && !this.d.baguette?.consume(userId)) return this.end(s);
    s.baguette = true;
    s.revives++;
    s.pos++;
    if (s.pos >= s.order.length) return this.end(s);
    s.pause = null;
    s.shown = this.show(s);
    return { kind: "sigue", next: s.shown, info: s.info, vidas: this.d.baguette!.vidas - s.revives, gasto };
  }

  /** No quiso usar la Baguette: la partida termina como siempre. */
  giveUp(userId: string, nonce: string): AnswerResult {
    const s = this.paused(userId, nonce);
    return s ? this.end(s) : { kind: "vieja" };
  }

  /**
   * Consumibles de la trivia que puede usar ahora (para los botones): usos del Celular, la Guitarra y la Zanahoria, si la
   * Guitarra ya suena en esta partida y el tema que eligio con la Zanahoria para la siguiente.
   */
  extras(userId: string): { celular: number; guitarra: number; zanahoria: number; guitar: boolean; carrot: string | null } {
    const s = this.sessions.get(userId);
    return {
      celular: this.d.celular?.usos(userId) ?? 0,
      guitarra: this.d.guitarra?.usos(userId) ?? 0,
      zanahoria: this.d.zanahoria?.usos(userId) ?? 0,
      guitar: !!s?.guitar,
      carrot: s?.carrot && s.carrot.pos === s.pos ? s.carrot.topic : null,
    };
  }

  /** Guitarra de flower: desde ahora, los aciertos de esta partida dan el doble de XP (gasta un uso; una vez por partida). */
  guitar(userId: string, nonce: string): { ok: true; shown: Shown; info: RunInfo } | { ok: false; motivo: "vieja" | "no_aplica" | "sin_usos" } {
    const s = this.current(userId, nonce);
    if (!s || this.now() > s.shown.deadline) return { ok: false, motivo: "vieja" };
    if (s.guitar) return { ok: false, motivo: "no_aplica" };
    if (!this.d.guitarra?.consume(userId)) return { ok: false, motivo: "sin_usos" };
    s.guitar = true;
    return { ok: true, shown: s.shown, info: s.info };
  }

  /** Temas que aun quedan en la partida despues de la pregunta en pantalla (para la Zanahoria de Gumi), con cuantas hay. */
  topics(userId: string): { topic: string; n: number }[] {
    const s = this.sessions.get(userId);
    if (!s) return [];
    const count = new Map<string, number>();
    for (const id of s.order.slice(s.pos + 1)) {
      const t = this.byId.get(id)!.topic;
      count.set(t, (count.get(t) ?? 0) + 1);
    }
    return [...count].map(([topic, n]) => ({ topic, n })).sort((a, b) => b.n - a.n);
  }

  /**
   * Zanahoria de Gumi: la siguiente pregunta sera del tema elegido (la primera de ese tema que le tocaba; asi sigue
   * pasando primero por las que no ha visto). Una vez por pregunta; gasta un uso.
   */
  carrot(userId: string, nonce: string, topic: string): { ok: true; shown: Shown; info: RunInfo } | { ok: false; motivo: "vieja" | "no_aplica" | "sin_usos" } {
    const s = this.current(userId, nonce);
    if (!s || this.now() > s.shown.deadline) return { ok: false, motivo: "vieja" };
    if (s.carrot?.pos === s.pos) return { ok: false, motivo: "no_aplica" };
    const j = s.order.findIndex((id, k) => k > s.pos && this.byId.get(id)!.topic === topic);
    if (j < 0) return { ok: false, motivo: "no_aplica" };
    if (!this.d.zanahoria?.consume(userId)) return { ok: false, motivo: "sin_usos" };
    const [id] = s.order.splice(j, 1);
    s.order.splice(s.pos + 1, 0, id!);
    s.carrot = { pos: s.pos, topic };
    return { ok: true, shown: s.shown, info: s.info };
  }

  /** Usos que le quedan de la Baguette de Teto (0 sin mercado). */
  baguetteUsos(userId: string): number {
    return this.d.baguette?.usos(userId) ?? 0;
  }

  /** Usos que le quedan del Celular de Neru (null sin mercado). */
  celularUsos(userId: string): number | null {
    return this.d.celular ? this.d.celular.usos(userId) : null;
  }

  /** Lo de la partida en curso para volver a mostrar la pregunta (tras el Celular de Neru). */
  runInfo(userId: string): RunInfo | null {
    return this.sessions.get(userId)?.info ?? null;
  }

  /**
   * Celular de Neru: en una pregunta de opciones con 4 o más, borra dos incorrectas al azar (gasta un uso). Una vez por
   * pregunta; el tiempo no se detiene.
   */
  fiftyFifty(userId: string, nonce: string): { ok: true; shown: Shown; info: RunInfo } | { ok: false; motivo: "vieja" | "no_aplica" | "sin_usos" } {
    const s = this.current(userId, nonce);
    if (!s || this.now() > s.shown.deadline) return { ok: false, motivo: "vieja" };
    const shown = s.shown;
    if (shown.question.kind !== "opciones" || shown.options.length < 4 || shown.hidden?.length) return { ok: false, motivo: "no_aplica" };
    if (!this.d.celular?.consume(userId)) return { ok: false, motivo: "sin_usos" };
    const wrong = shown.options.map((_, k) => k).filter((k) => k !== shown.correct);
    for (let k = wrong.length - 1; k > 0; k--) {
      const j = Math.floor(this.rnd() * (k + 1));
      [wrong[k], wrong[j]] = [wrong[j]!, wrong[k]!];
    }
    shown.hidden = wrong.slice(0, 2).sort((a, b) => a - b);
    return { ok: true, shown, info: s.info };
  }

  /**
   * Pregunta superada (cuenta una vez). Si con ella completa su dificultad, gana el sobre de premio (una sola vez por
   * dificultad). Si con ella ya supero TODAS las preguntas de la trivia, es el secreto (Papu Lince, decision de GyroP
   * del 2 nov. 2026): sus sobres de premio (secreto.sobres) una sola vez, guardado como dificultad "todas". Quien gano
   * el secreto antes (Larper Vocaloid) lo puede ganar al superar las preguntas nuevas.
   */
  private pass(userId: string, q: Question): { completed: Dificultad | null; secret: boolean } {
    return transaction(this.d.db, () => {
      if (!this.d.db.prepare("INSERT OR IGNORE INTO trivia_superadas (user_id, pregunta) VALUES (?, ?)").run(userId, q.id).changes) return { completed: null, secret: false };
      const all = this.progress(userId);
      let completed: Dificultad | null = null;
      const p = all[q.level];
      if (p.done >= p.total && !p.prize) {
        this.d.db.prepare("INSERT INTO trivia_premios (user_id, dificultad, at) VALUES (?, ?, ?)").run(userId, q.level, this.now());
        this.d.giveSobre?.(userId, this.d.settings.dificultades[q.level].premio);
        completed = q.level;
      }
      const secret = DIFICULTADES.every((d) => all[d].done >= all[d].total) && this.claimSecret(userId);
      return { completed, secret };
    });
  }

  // ───────────────────────── hitos ─────────────────────────

  /**
   * Cuenta un acierto para los hitos de su dificultad (pedido de GyroP, 7 nov. 2026): cada `hito.cada` aciertos, un
   * sobre `hito.premio`. Con 2 o mas machetazos de Neru no cuenta (como la XP).
   */
  private hit(userId: string, level: Dificultad): Milestone | null {
    if (!this.d.levels.canEarn(userId, this.now())) return null;
    return transaction(this.d.db, () => {
      this.d.db
        .prepare("INSERT INTO trivia_hitos (user_id, dificultad, aciertos) VALUES (?, ?, 1) ON CONFLICT(user_id, dificultad) DO UPDATE SET aciertos = aciertos + 1")
        .run(userId, level);
      const r = this.d.db.prepare("SELECT aciertos, premios FROM trivia_hitos WHERE user_id = ? AND dificultad = ?").get(userId, level) as { aciertos: number; premios: number };
      const h = this.d.settings.dificultades[level].hito;
      if (!h) return null;
      const due = Math.floor(r.aciertos / h.cada);
      if (due <= r.premios) return null;
      this.d.db.prepare("UPDATE trivia_hitos SET premios = ? WHERE user_id = ? AND dificultad = ?").run(due, userId, level);
      this.d.giveSobre?.(userId, h.premio, due - r.premios);
      return { level, n: r.aciertos, premio: h.premio };
    });
  }

  /**
   * Una sola vez (al primer arranque con hitos, 7 nov. 2026; pedido de GyroP): quienes ya tenian avance reciben sus
   * hitos. El unico registro por dificultad de antes son las preguntas superadas (trivia_superadas, desde el 31 oct.),
   * asi que esos son sus aciertos iniciales; reciben los sobres de los hitos que ya pasaron. Devuelve lo entregado.
   */
  seedMilestones(): { userId: string; level: Dificultad; aciertos: number; sobres: number }[] {
    const KEY = "trivia_hitos_inicio";
    if (!this.d.giveSobre || this.d.db.prepare("SELECT 1 FROM kv WHERE key = ?").get(KEY)) return [];
    const levelOf = new Map(this.d.questions.map((q) => [q.id, q.level]));
    const counts = new Map<string, number>();
    for (const r of this.d.db.prepare("SELECT user_id, pregunta FROM trivia_superadas").all() as { user_id: string; pregunta: string }[]) {
      const level = levelOf.get(r.pregunta);
      if (level) counts.set(`${r.user_id}|${level}`, (counts.get(`${r.user_id}|${level}`) ?? 0) + 1);
    }
    const out: { userId: string; level: Dificultad; aciertos: number; sobres: number }[] = [];
    transaction(this.d.db, () => {
      for (const [k, aciertos] of counts) {
        const [userId, level] = k.split("|") as [string, Dificultad];
        const h = this.d.settings.dificultades[level].hito;
        const sobres = h ? Math.floor(aciertos / h.cada) : 0;
        this.d.db
          .prepare("INSERT INTO trivia_hitos (user_id, dificultad, aciertos, premios) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, dificultad) DO UPDATE SET aciertos = aciertos + excluded.aciertos, premios = premios + excluded.premios")
          .run(userId, level, aciertos, sobres);
        if (sobres > 0 && h) {
          this.d.giveSobre!(userId, h.premio, sobres);
          out.push({ userId, level, aciertos, sobres });
        }
      }
      this.d.db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run(KEY, String(this.now()));
    });
    return out;
  }

  /** Aciertos del Papu en una dificultad para los hitos, y cuantos le faltan para el siguiente (null si no tiene hito). */
  milestones(userId: string, level: Dificultad): { aciertos: number; cada: number; left: number; premio: PremioSobre } | null {
    const h = this.d.settings.dificultades[level].hito;
    if (!h) return null;
    const r = this.d.db.prepare("SELECT aciertos FROM trivia_hitos WHERE user_id = ? AND dificultad = ?").get(userId, level) as { aciertos: number } | undefined;
    const aciertos = r?.aciertos ?? 0;
    return { aciertos, cada: h.cada, left: h.cada - (aciertos % h.cada), premio: h.premio };
  }

  /** ¿Ya es Papu Lince? (supero todas las preguntas alguna vez, desde el 2 nov. 2026) */
  isLynx(userId: string): boolean {
    return !!this.d.db.prepare("SELECT 1 FROM trivia_premios WHERE user_id = ? AND dificultad = 'todas'").get(userId);
  }

  /** Registra el secreto y da sus sobres (una sola vez). */
  private claimSecret(userId: string): boolean {
    if (this.isLynx(userId)) return false;
    this.d.db.prepare("INSERT INTO trivia_premios (user_id, dificultad, at) VALUES (?, 'todas', ?)").run(userId, this.now());
    const { tipo, cantidad } = this.d.settings.secreto.sobres;
    this.d.giveSobre?.(userId, tipo, cantidad);
    return true;
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

  /** Un acierto sin XP (partida fuera de las del dia): solo se cuenta. */
  private count(userId: string): void {
    this.d.db
      .prepare("INSERT INTO xp_dia (user_id, day, trivia_aciertos) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET trivia_aciertos = trivia_aciertos + 1")
      .run(userId, this.day());
  }

  // ───────────────────────── trivia multijugador (Actividad) ─────────────────────────

  /**
   * Partida multijugador del Papu (Actividad de Discord): la primera vez que acierta en ella cuenta como una partida de
   * /trivia del dia (fin "actividad"), con o sin XP segun `partidasConXp` (decision de GyroP, 8 nov. 2026: comparte
   * todas las estadisticas con /trivia). Devuelve su fila en trivia_partidas y si da XP.
   */
  private sharedRun(userId: string, partida: string): { id: number; withXp: boolean } {
    const key = `actividad_partida:${partida}:${userId}`;
    const saved = kvGet(this.d.db, key);
    if (saved) return JSON.parse(saved) as { id: number; withXp: boolean };
    const t = this.now();
    const withXp = this.runsCounted(userId, t) + 1 <= this.d.settings.limites.partidasConXp;
    const id = Number(this.d.db.prepare("INSERT INTO trivia_partidas (user_id, day, racha, xp, fin, at) VALUES (?, ?, 0, 0, 'actividad', ?)").run(userId, this.day(t), t).lastInsertRowid);
    kvSet(this.d.db, key, JSON.stringify({ id, withXp }));
    return { id, withXp };
  }

  /**
   * Acierto de la trivia multijugador (src/trivia/actividad.ts), con todo lo de /trivia: XP (por nivel, crecimiento y
   * racha de esa partida, solo en las partidas del dia con XP y con el mismo tope), pregunta superada (sobre al completar
   * una dificultad y el secreto), hitos de aciertos y mejor racha.
   */
  answerShared(userId: string, partida: string, questionId: string, streak: number): { xp: number; change: LevelChange | null; completed: Dificultad | null; secret: boolean; milestone: Milestone | null } {
    const run = this.sharedRun(userId, partida);
    const s = Math.max(1, Math.floor(streak));
    const { xp, change } = run.withXp ? this.award(userId, s) : (this.count(userId), { xp: 0, change: null });
    this.d.db.prepare("UPDATE trivia_partidas SET racha = MAX(racha, ?), xp = xp + ? WHERE id = ?").run(s, xp, run.id);
    const q = this.byId.get(questionId);
    if (!q) return { xp, change, completed: null, secret: false, milestone: null };
    this.d.db.prepare("INSERT INTO trivia_vistas (user_id, pregunta) VALUES (?, ?) ON CONFLICT DO NOTHING").run(userId, q.id);
    const { completed, secret } = this.pass(userId, q);
    const milestone = !this.d.settings.hitos?.soloPartidasConXp || run.withXp ? this.hit(userId, q.level) : null;
    return { xp, change, completed, secret, milestone };
  }

  /**
   * Lo que la Actividad necesita para mostrar la XP de cada acierto: XP base (racha 1, con el evento) y tope que le
   * queda hoy (0 si la partida, o la siguiente si aun no empieza, ya no es de las que dan XP).
   */
  sharedProfile(userId: string, partida: string | null = null, t = this.now()): { base: number; tope: number } {
    if (!this.d.levels.canEarn(userId, t)) return { base: 0, tope: 0 };
    const saved = partida ? kvGet(this.d.db, `actividad_partida:${partida}:${userId}`) : null;
    const withXp = saved ? (JSON.parse(saved) as { withXp: boolean }).withXp : this.runsCounted(userId, t) + 1 <= this.d.settings.limites.partidasConXp;
    const base = answerXp(this.d.settings, this.d.levels.settings, {
      xp: this.d.levels.store.get(userId).xp,
      dailyAvg: this.dailyAvg(userId, t),
      streak: 1,
      multiplier: this.d.levels.multiplier(new Date(t)),
    });
    return { base, tope: withXp ? this.capLeft(userId, t) : 0 };
  }

  /** XP del acierto, recortada a lo que le queda del tope del dia (0 si ya llego). */
  /** `factor` = 2 con la Guitarra de flower (siempre dentro del tope del dia). */
  private award(userId: string, streak: number, factor = 1): { xp: number; change: LevelChange | null } {
    const t = this.now();
    return transaction(this.d.db, () => {
      const full = answerXp(this.d.settings, this.d.levels.settings, {
        xp: this.d.levels.store.get(userId).xp,
        dailyAvg: this.dailyAvg(userId, t),
        streak,
        multiplier: this.d.levels.multiplier(new Date(t)),
      });
      // Con 2 o mas machetazos de Neru, el acierto cuenta pero no da XP.
      const xp = this.d.levels.canEarn(userId, t) ? Math.min(full * factor, this.capLeft(userId, t)) : 0;
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
    return { userId: s.userId, level: s.level, channelId: s.channelId, streak: s.streak, xp: s.xp, withXp: s.info.withXp, reason, best: Math.max(before, s.streak), record: s.streak > before && s.streak > 0 };
  }

  /** Mejores rachas del servidor (para el resultado publico). */
  top(limit = 3): { userId: string; streak: number }[] {
    return (this.d.db.prepare("SELECT user_id, MAX(racha) AS m FROM trivia_partidas GROUP BY user_id ORDER BY m DESC, MIN(at) LIMIT ?").all(limit) as { user_id: string; m: number }[])
      .filter((r) => r.m > 0)
      .map((r) => ({ userId: r.user_id, streak: r.m }));
  }
}
