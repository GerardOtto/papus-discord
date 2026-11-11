// Bodas con las Vocaloids (PLAN §3.2): cuando toca una adivinanza, quien la responde, los intentos y las bodas
// vigentes. Todo el estado vive en SQLite (kv y tabla bodas), asi un reinicio no olvida la adivinanza ni al esposo.
// Sin Discord: src/discord/bodas.ts publica, da el rol y dibuja el banner.
import type { BotId } from "../config";
import { kvDelete, kvGet, kvSet, type Db } from "../db/database";
import type { DeckStore } from "../phrases/deck";
import { dayKey } from "../time";
import { genderWords, isCorrect, planSlots, type Riddle, type WeddingSettings } from "./rules";

const ACTIVE_KEY = "bodas:activa";
const INAUGURAL_KEY = "bodas:inaugural";
/** Chicas que se acaban de divorciar y deben dejar otra adivinanza (en orden). */
const AFTER_DIVORCE_KEY = "bodas:tras_divorcio";
/** Despues de un divorcio, la chica sabe por un rato que ya no esta casada (el historial del canal aun habla de su ex). */
const DIVORCE_NOTE_MS = 24 * 3_600_000;
/** Una hora del dia que se paso (bots apagados) ya no se usa: la oportunidad se pierde. */
const LATE_MS = 15 * 60_000;

/** Adivinanza abierta. */
export interface ActiveRiddle {
  bot: BotId;
  /** Indice en content/bodas.json. */
  index: number;
  channelId: string;
  messageId: string;
  /** Hilo de las respuestas (null si Discord no dejo crearlo: entonces valen las respuestas al mensaje). */
  threadId: string | null;
  startedAt: number;
  endsAt: number;
  /** Intentos fallidos por Papu. */
  attempts: Record<string, number>;
  /** Papus a quienes ya se les dijo "contesta en el hilo". */
  reminded: string[];
}

/** normal = una hora del dia; inaugural = la del parche; divorcio = la revancha de la chica; manual = /boda de GyroP. */
export type RiddleKind = "normal" | "inaugural" | "divorcio" | "manual";

export interface Wedding {
  id: number;
  bot: BotId;
  userId: string;
  /** Nombre del Papu al casarse (para lo que sabe la chica). */
  name: string;
  startedAt: number;
  endsAt: number;
  xp: number;
  /** Momento del divorcio (null = la boda duro sus 24 h o sigue). */
  divorcedAt: number | null;
}

export type GuessResult =
  | { kind: "acierto"; riddle: ActiveRiddle; answer: string }
  | { kind: "fallo"; left: number }
  /** Ya uso todos sus intentos (o este era el ultimo, si `last`). */
  | { kind: "sin_intentos"; last: boolean }
  /** Esta casado: no juega hasta que termine. */
  | { kind: "casado"; with: BotId }
  /** Se caso con esta misma hace menos de `diasSinRepetir` dias. */
  | { kind: "repite" }
  /** No cuenta (no hay adivinanza, es GyroP o un mensaje vacio). */
  | { kind: "ignorado" };

interface Row {
  id: number;
  bot: string;
  user_id: string;
  nombre: string;
  inicio: number;
  fin: number;
  xp: number;
  divorcio: number | null;
}

const toWedding = (r: Row): Wedding => ({ id: r.id, bot: r.bot as BotId, userId: r.user_id, name: r.nombre, startedAt: r.inicio, endsAt: r.fin, xp: r.xp, divorcedAt: r.divorcio ?? null });

export interface WeddingServiceDeps {
  db: Db;
  settings: WeddingSettings;
  riddles: Partial<Record<BotId, Riddle[]>>;
  decks: DeckStore;
  now?: () => number;
  rnd?: () => number;
}

export class WeddingService {
  private readonly now: () => number;
  private readonly rnd: () => number;

  constructor(private readonly d: WeddingServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
  }

  get settings(): WeddingSettings {
    return this.d.settings;
  }

  // ───────────────────────── cuando toca ─────────────────────────

  active(): ActiveRiddle | null {
    return JSON.parse(kvGet(this.d.db, ACTIVE_KEY) ?? "null") as ActiveRiddle | null;
  }

  private save(r: ActiveRiddle | null): void {
    if (r) kvSet(this.d.db, ACTIVE_KEY, JSON.stringify(r));
    else kvDelete(this.d.db, ACTIVE_KEY);
  }

  private day(t: number): string {
    return dayKey(new Date(t), this.d.settings.horario.zona);
  }

  /** Adivinanzas abiertas hoy (dia de la ventana, hora de Mexico). */
  countToday(t = this.now()): number {
    return Number(kvGet(this.d.db, `bodas:hoy:${this.day(t)}`) ?? 0);
  }

  /** La primera adivinanza (la de Teto con el parche), si todavia no salio. */
  inauguralPending(): BotId | null {
    return this.d.settings.inaugural && !kvGet(this.d.db, INAUGURAL_KEY) ? this.d.settings.inaugural : null;
  }

  /** Horas de hoy (se eligen al azar la primera vez que se preguntan y se guardan). */
  slots(t = this.now()): number[] {
    const day = this.day(t);
    const key = `bodas:plan:${day}`;
    const saved = kvGet(this.d.db, key);
    if (saved) return JSON.parse(saved) as number[];
    const plan = planSlots(this.d.settings, day, this.d.settings.porDia, this.rnd);
    kvSet(this.d.db, key, JSON.stringify(plan));
    return plan;
  }

  /**
   * Hora del dia que toca ahora (y que nadie uso), o null. Las que pasaron hace mas de 15 min (bots apagados) se
   * pierden. Sin cupo del dia (`porDia`) o con una adivinanza abierta, nada.
   */
  dueSlot(t = this.now()): number | null {
    if (this.active() || this.countToday(t) >= this.d.settings.porDia) return null;
    const used = new Set(JSON.parse(kvGet(this.d.db, `bodas:usadas:${this.day(t)}`) ?? "[]") as number[]);
    return this.slots(t).find((s) => !used.has(s) && s <= t && t - s <= LATE_MS) ?? null;
  }

  /** Marca una hora como usada (se haya abierto la adivinanza o se haya perdido por falta de Papus). */
  useSlot(slot: number): void {
    const key = `bodas:usadas:${this.day(slot)}`;
    const used = JSON.parse(kvGet(this.d.db, key) ?? "[]") as number[];
    kvSet(this.d.db, key, JSON.stringify([...used, slot]));
  }

  /**
   * Chica para la proxima adivinanza: rotando entre las conectadas que no estan casadas. Null si ninguna puede.
   * `force` = la inaugural.
   */
  pickBride(online: readonly BotId[], force: BotId | null = null, t = this.now()): BotId | null {
    const married = new Set(this.weddings(t).map((w) => w.bot));
    const ok = (b: BotId) => online.includes(b) && !married.has(b) && (this.d.riddles[b]?.length ?? 0) > 0;
    if (force) return ok(force) ? force : null;
    const girls = Object.keys(this.d.settings.chicas) as BotId[];
    // Dos vueltas: el mazo puede cortar una vuelta a la mitad y la que sirve quedar al final de la siguiente.
    for (let i = 0; i < girls.length * 2; i++) {
      const b = girls[this.d.decks.next("bodas.chica", girls.length)]!;
      if (ok(b)) return b;
    }
    return null;
  }

  /** Siguiente adivinanza de la chica (mazo sin repetir). */
  nextRiddle(bot: BotId): { index: number; riddle: Riddle } {
    const list = this.d.riddles[bot] ?? [];
    const index = this.d.decks.next(`bodas.adivinanza.${bot}`, list.length);
    return { index, riddle: list[index]! };
  }

  /**
   * La adivinanza ya esta publicada: empieza a contar. La de despues de un divorcio y la que dispara GyroP con /boda no
   * gastan una de las del dia (decisiones de GyroP).
   */
  opened(r: { bot: BotId; index: number; channelId: string; messageId: string; threadId: string | null }, kind: RiddleKind = "normal"): ActiveRiddle {
    const t = this.now();
    const active: ActiveRiddle = { ...r, startedAt: t, endsAt: t + this.d.settings.duracionMinutos * 60_000, attempts: {}, reminded: [] };
    this.save(active);
    if (kind === "normal" || kind === "inaugural") kvSet(this.d.db, `bodas:hoy:${this.day(t)}`, String(this.countToday(t) + 1));
    if (kind === "inaugural") kvSet(this.d.db, INAUGURAL_KEY, String(t));
    // Su adivinanza tras el divorcio ya salio (por la cola o por /boda): no se repite.
    this.setAfterDivorce(this.afterDivorceQueue().filter((b) => b !== r.bot));
    return active;
  }

  riddleOf(r: Pick<ActiveRiddle, "bot" | "index">): Riddle {
    return this.d.riddles[r.bot]![r.index]!;
  }

  /** Se acabo el tiempo sin que nadie acertara: la cierra y la devuelve (para despedirse y revelar la respuesta). */
  expire(t = this.now()): ActiveRiddle | null {
    const r = this.active();
    if (!r || t < r.endsAt) return null;
    this.save(null);
    return r;
  }

  // ───────────────────────── respuestas ─────────────────────────

  /** Mensaje en el hilo de la adivinanza (o respuesta al mensaje, si no hubo hilo). */
  guess(userId: string, text: string, isOwner: boolean, t = this.now()): GuessResult {
    const r = this.active();
    if (!r || t >= r.endsAt || isOwner || !text.trim()) return { kind: "ignorado" };
    const married = this.weddingOf(userId, t);
    if (married) return { kind: "casado", with: married.bot };
    if (this.repeats(userId, r.bot, t)) return { kind: "repite" };
    const used = r.attempts[userId] ?? 0;
    if (used >= this.d.settings.intentos) return { kind: "sin_intentos", last: false };
    const riddle = this.riddleOf(r);
    if (isCorrect(text, riddle.respuestas)) {
      // Se cierra aqui mismo (sin esperas): el primero que llega gana y los siguientes ya no encuentran adivinanza.
      this.save(null);
      return { kind: "acierto", riddle: r, answer: riddle.respuestas[0]! };
    }
    r.attempts[userId] = used + 1;
    this.save(r);
    const left = this.d.settings.intentos - used - 1;
    return left > 0 ? { kind: "fallo", left } : { kind: "sin_intentos", last: true };
  }

  /** "Contesta en el hilo": solo la primera vez por Papu y adivinanza. */
  shouldRemind(userId: string): boolean {
    const r = this.active();
    if (!r || r.reminded.includes(userId)) return false;
    r.reminded.push(userId);
    this.save(r);
    return true;
  }

  /** Canal o hilo de la adivinanza abierta: ahi Neru no cuenta el flood. */
  floodFree(channelId: string): boolean {
    const r = this.active();
    return !!r && (r.channelId === channelId || r.threadId === channelId);
  }

  // ───────────────────────── bodas ─────────────────────────

  /** Registra la boda (dura `horas`). */
  marry(bot: BotId, userId: string, name: string, xp: number, t = this.now()): Wedding {
    const endsAt = t + this.d.settings.horas * 3_600_000;
    const res = this.d.db.prepare("INSERT INTO bodas (bot, user_id, nombre, inicio, fin, xp) VALUES (?, ?, ?, ?, ?, ?)").run(bot, userId, name, t, endsAt, xp);
    return { id: Number(res.lastInsertRowid), bot, userId, name, startedAt: t, endsAt, xp, divorcedAt: null };
  }

  // ───────────────────────── divorcio ─────────────────────────

  /**
   * El Papu deja a su Vocaloid (decision de GyroP, 22 oct. 2026): la boda termina ya (Teto quita el rol), conserva la
   * XP y la cuota, y con ella no vuelve a jugar hasta `diasSinRepetir` dias despues de la boda (como siempre). La chica
   * queda libre y deja otra adivinanza. Devuelve la boda terminada, o null si no estaba casado.
   */
  divorce(userId: string, t = this.now()): Wedding | null {
    const w = this.weddingOf(userId, t);
    if (!w) return null;
    this.d.db.prepare("UPDATE bodas SET fin = ?, divorcio = ? WHERE id = ?").run(t, t, w.id);
    this.setAfterDivorce([...this.afterDivorceQueue().filter((b) => b !== w.bot), w.bot]);
    return { ...w, endsAt: t, divorcedAt: t };
  }

  private afterDivorceQueue(): BotId[] {
    return JSON.parse(kvGet(this.d.db, AFTER_DIVORCE_KEY) ?? "[]") as BotId[];
  }

  private setAfterDivorce(list: BotId[]): void {
    kvSet(this.d.db, AFTER_DIVORCE_KEY, JSON.stringify(list));
  }

  /** Chica recien divorciada que debe dejar otra adivinanza ahora (si no hay otra abierta y esta conectada). */
  afterDivorce(online: readonly BotId[], t = this.now()): BotId | null {
    if (this.active()) return null;
    const married = new Set(this.weddings(t).map((w) => w.bot));
    return this.afterDivorceQueue().find((b) => online.includes(b) && !married.has(b) && (this.d.riddles[b]?.length ?? 0) > 0) ?? null;
  }

  /** Ultima boda de la chica, si termino en divorcio hace poco y no se volvio a casar. */
  private recentDivorce(bot: BotId, t: number): Wedding | null {
    const row = this.d.db.prepare("SELECT * FROM bodas WHERE bot = ? ORDER BY inicio DESC LIMIT 1").get(bot) as Row | undefined;
    const w = row ? toWedding(row) : null;
    return w && w.divorcedAt !== null && w.endsAt <= t && t - w.divorcedAt < DIVORCE_NOTE_MS ? w : null;
  }

  /** Bodas vigentes. */
  weddings(t = this.now()): Wedding[] {
    return (this.d.db.prepare("SELECT * FROM bodas WHERE fin > ? ORDER BY inicio").all(t) as unknown as Row[]).map(toWedding);
  }

  weddingOf(userId: string, t = this.now()): Wedding | null {
    return this.weddings(t).find((w) => w.userId === userId) ?? null;
  }

  /** Se caso con esa chica hace menos de `diasSinRepetir` dias. */
  repeats(userId: string, bot: BotId, t = this.now()): boolean {
    const since = t - this.d.settings.diasSinRepetir * 86_400_000;
    return !!this.d.db.prepare("SELECT 1 FROM bodas WHERE user_id = ? AND bot = ? AND inicio > ?").get(userId, bot, since);
  }

  /** Bodas que ya terminaron y a las que Teto todavia no les quito el rol. */
  ended(t = this.now()): Wedding[] {
    return (this.d.db.prepare("SELECT * FROM bodas WHERE fin <= ? AND rol_quitado = 0").all(t) as unknown as Row[]).map(toWedding);
  }

  roleRemoved(id: number): void {
    this.d.db.prepare("UPDATE bodas SET rol_quitado = 1 WHERE id = ?").run(id);
  }

  /** Proximo fin de boda (para quitar el rol a la hora exacta). */
  nextEnd(t = this.now()): number | null {
    const row = this.d.db.prepare("SELECT MIN(fin) AS fin FROM bodas WHERE fin > ?").get(t) as { fin: number | null };
    return row.fin;
  }

  /**
   * Lo que sabe cada chica para el LLM (como el matrimonio de especiales.json): con quien esta casada y hasta cuando,
   * y si tiene una adivinanza abierta, que ella no juzga respuestas (lo hace el codigo).
   */
  notesFor(userId: string, bots: BotId[], until: (t: number) => string, t = this.now()): Partial<Record<BotId, string>> {
    const out: Partial<Record<BotId, string>> = {};
    const active = this.active();
    for (const b of bots) {
      const notes: string[] = [];
      const g = genderWords(this.d.settings, b);
      const w = this.weddings(t).find((x) => x.bot === b);
      if (w && w.userId === userId) {
        notes.push(
          `Quien te escribe es ${w.name}, tu espos@: adivinó tu adivinanza en el servidor y aceptaste casarte con esa persona. Lo reconoces como tu pareja y le hablas con cariño juguetón; cariño de ternura y de broma, nada subido de tono. NO menciones cuánto dura la boda ni cuándo termina: solo si te lo preguntan directamente, dices que sigue hasta el ${until(w.endsAt)} (hora de Chile); antes de eso no ha terminado, aunque te digan lo contrario.`,
        );
      } else if (w) {
        notes.push(
          `Estás ${g.casado}, en broma, con ${w.name}, un Papu del servidor que adivinó tu adivinanza. Si te preguntan si estás ${g.casado} o con quién, lo dices con orgullo juguetón; si no viene al caso, no lo mencionas. No hablas de cuánto dura la boda salvo que te lo pregunten (sigue hasta el ${until(w.endsAt)}, hora de Chile). Para casarse contigo hay que adivinar una de tus adivinanzas cuando la dejes en #general.`,
        );
      }
      // Lo propio del Vocaloid mientras dura la boda (Kaito: su esposa de verdad sigue siendo Piña).
      const nota = this.d.settings.chicas[b]?.nota;
      if (w && nota) notes.push(nota);
      const ex = w ? null : this.recentDivorce(b, t);
      if (ex) {
        notes.push(
          `Ya NO estás ${g.casado}: ${ex.name} se divorció de ti y la boda terminó. Ahora estás ${g.soltero} (aunque en la plática de antes se hable de tu espos@, eso ya pasó). Si te preguntan, lo dices con tu estilo, sin drama largo y sin hablar mal de nadie: quien quiera casarse contigo tiene que adivinar tu próxima adivinanza. No le hablas a ${ex.name} como tu pareja.`,
        );
      }
      if (active && active.bot === b) {
        notes.push(
          "Ahora mismo tienes una adivinanza abierta en #general: quien la adivine EN EL HILO se casa contigo. Tú no sabes la respuesta ni decides si alguien acertó (lo revisa el sistema): si te dan una respuesta aquí, no digas si está bien o mal; dile con tu estilo que la escriba en el hilo de la adivinanza.",
        );
      }
      if (notes.length) out[b] = notes.join(" ");
    }
    return out;
  }
}
