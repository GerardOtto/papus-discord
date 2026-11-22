// Ambiente casual de los Vocaloids (pedido de GyroP, 14 nov. 2026; PLAN §3.13). Nada es un comando ni gasta la cuota
// de los Papus:
//  - reacciones: un Vocaloid reacciona con su emoji a una palabra suya (sin LLM);
//  - metiche: si nombran a un Vocaloid sin @, a veces se mete a contestar (LLM, sin ping);
//  - eventos: otro Vocaloid comenta en #general una boda, una pelea, la Ruleta de Némesis... (LLM; si falla, nada);
//  - preguntas al aire: con #general muerto, una pregunta para votar con reacciones; horas despues, el resultado;
//  - momentos: un mensaje segun la hora (madrugada, lunes, viernes...), una vez al dia cada uno.
// Los minidramas viven en la charla de #general (src/services/charla.ts). Topes diarios en ambiente_dia.
import type { BotId } from "../config";
import type { Db } from "../db/database";
import { channelKey } from "../discord/channels";
import type { HistoryLine } from "../llm/prompt";
import type { DeckStore } from "../phrases/deck";
import type { CharlaTalker } from "../services/charla";
import { dayKey } from "../time";
import { momentsNow, namedBots, pollResult, reactionCandidates, inHours, clock, type AmbientSettings, type Poll } from "./rules";

/** Un Papu escribio hace menos que esto: hay gente (para los momentos con 'conGente'). */
export const PEOPLE_MS = 15 * 60_000;
/** Cada cuanto se revisan las preguntas al aire y los momentos. */
export const AMBIENT_TICK_MS = 5 * 60_000;

export interface AmbientMessage {
  id: string;
  channelId: string;
  channelName: string;
  authorName: string;
  text: string;
  /** Menciona o responde a un Vocaloid: ya lo contesta la conversacion normal (nada de metiche). */
  addressed: boolean;
}

export type AmbientEventKind = "boda" | "divorcio" | "pelea" | "nemesis" | "trivia" | "carrera";

export interface AmbientEvent {
  tipo: AmbientEventKind;
  /** Lo que paso, para el LLM (con nombres, nunca ids ni @). */
  situacion: string;
  /** Vocaloids metidos en lo que paso (la novia, los luchadores...). */
  bots: BotId[];
  /** Quien lo comenta: uno de los involucrados (el que perdio, la que se divorcio) u otro Vocaloid. */
  comenta: "involucrado" | "otro";
  /** Trivia: racha lograda (solo se comenta desde eventos.rachaTrivia). */
  racha?: number;
}

export interface AmbientPort {
  react(bot: BotId, channelId: string, messageId: string, emoji: string): Promise<void>;
  /** Responde a un mensaje sin ping. */
  reply(bot: BotId, channelId: string, messageId: string, content: string): Promise<void>;
  /** Ultimos mensajes antes de `messageId` en el canal, del mas viejo al mas nuevo. */
  history(channelId: string, messageId: string): Promise<HistoryLine[]>;
  /** Momento del ultimo mensaje de un Papu en #general (null = no hay #general o no se pudo leer). */
  lastPapuInGeneral(): Promise<number | null>;
  /** Publica en #general (sin menciones). */
  postGeneral(bot: BotId, content: string): Promise<void>;
  /** Publica la pregunta en #general y le pone las reacciones; null si no se pudo. */
  postPoll(bot: BotId, content: string, emojis: string[]): Promise<{ channelId: string; messageId: string } | null>;
  /** Reacciones del mensaje por emoji (null = el mensaje ya no existe). */
  pollCounts(channelId: string, messageId: string): Promise<Record<string, number> | null>;
}

export interface AmbientDeps {
  db: Db;
  settings: AmbientSettings;
  polls: Poll[];
  decks: DeckStore;
  talker: CharlaTalker;
  port: AmbientPort;
  /** Vocaloids conectados (con token). */
  active: () => readonly BotId[];
  names: Record<BotId, string>;
  timeZone: string;
  log?: (msg: string) => void;
  now?: () => number;
  rng?: () => number;
}

/** Topes del dia (dia de la cuota). */
export class AmbientCounters {
  constructor(
    private readonly db: Db,
    private readonly timeZone: string,
    private readonly now: () => number = Date.now,
  ) {}

  private day(): string {
    return dayKey(new Date(this.now()), this.timeZone);
  }

  get(clave: string): number {
    const row = this.db.prepare("SELECT n FROM ambiente_dia WHERE day = ? AND clave = ?").get(this.day(), clave) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  bump(clave: string): number {
    this.db.prepare("INSERT INTO ambiente_dia (day, clave, n) VALUES (?, ?, 1) ON CONFLICT(day, clave) DO UPDATE SET n = n + 1").run(this.day(), clave);
    return this.get(clave);
  }

  /** Borra los dias anteriores a `beforeDay`. */
  prune(beforeDay: string): void {
    this.db.prepare("DELETE FROM ambiente_dia WHERE day < ?").run(beforeDay);
  }
}

interface OpenPoll {
  id: number;
  indice: number;
  bot: BotId;
  channel_id: string;
  message_id: string;
  creada_at: number;
}

export class AmbientService {
  readonly counters: AmbientCounters;
  /** Ultima reaccion de cada bot en cada canal y ultimo metiche de cada canal (en memoria: un reinicio solo los olvida). */
  private readonly lastReaction = new Map<string, number>();
  private readonly lastMeddle = new Map<string, number>();
  private lastEvent = 0;
  private ticking = false;

  constructor(private readonly d: AmbientDeps) {
    this.counters = new AmbientCounters(d.db, d.timeZone, d.now);
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private chance(p: number): boolean {
    return (this.d.rng ?? Math.random)() < p;
  }

  private pick<T>(list: readonly T[], key: string): T {
    return list[this.d.decks.next(key, list.length)]!;
  }

  // ───────────────────────── mensajes de los Papus ─────────────────────────

  /** Cada mensaje de un Papu que paso la moderacion. Devuelve lo que hizo (para las pruebas y el registro). */
  async onMessage(m: AmbientMessage): Promise<{ reaction: string | null; meddled: BotId | null }> {
    if (!this.d.settings.activo || !m.text.trim()) return { reaction: null, meddled: null };
    const reaction = await this.react(m);
    const meddled = m.addressed ? null : await this.meddle(m);
    return { reaction, meddled };
  }

  private async react(m: AmbientMessage): Promise<string | null> {
    const s = this.d.settings.reacciones;
    if (!s.activo || s.excluir.map(channelKey).includes(channelKey(m.channelName))) return null;
    const now = this.now();
    const ready = reactionCandidates(s, m.text, this.d.active()).filter(
      (c) => now - (this.lastReaction.get(`${m.channelId}:${c.bot}`) ?? 0) >= s.esperaCanalSeg * 1000 && this.counters.get(`reaccion:${c.bot}`) < s.maxPorBotDia,
    );
    if (!ready.length || !this.chance(s.probabilidad)) return null;
    const c = ready[Math.floor((this.d.rng ?? Math.random)() * ready.length)]!;
    this.lastReaction.set(`${m.channelId}:${c.bot}`, now);
    this.counters.bump(`reaccion:${c.bot}`);
    await this.d.port.react(c.bot, m.channelId, m.id, c.emoji);
    return `${c.bot}:${c.emoji}`;
  }

  private async meddle(m: AmbientMessage): Promise<BotId | null> {
    const s = this.d.settings.metiche;
    if (!s.activo || !s.canales.map(channelKey).includes(channelKey(m.channelName))) return null;
    const named = namedBots(s, m.text, this.d.active());
    if (!named.length) return null;
    const now = this.now();
    if (now - (this.lastMeddle.get(m.channelId) ?? 0) < s.esperaCanalMin * 60_000) return null;
    if (this.counters.get("metiche") >= s.maxDia || !this.chance(s.probabilidad)) return null;
    const bot = named[0]!;
    // La espera corre desde que se decide (dos mensajes seguidos no traen dos metiches).
    this.lastMeddle.set(m.channelId, now);
    this.counters.bump("metiche");
    const history = await this.d.port.history(m.channelId, m.id).catch(() => []);
    const text = await this.d.talker.respond(bot, {
      authorName: m.authorName,
      message: m.text,
      history,
      note: `Nadie te mencionó: ${m.authorName} te nombró hablando con otros y tú te metes sin que te llamen, como metiche. Contesta en 1 frase corta, con tu voz, a lo que dijo de ti (en broma; si te halagan, presúmelo; si te critican, defiéndete). No hagas preguntas largas ni cambies de tema.`,
    });
    if (!text) return null;
    await this.d.port.reply(bot, m.channelId, m.id, text);
    this.d.log?.(`👀 ${bot} se metió en #${m.channelName} (la nombraron sin @)`);
    return bot;
  }

  // ───────────────────────── eventos ─────────────────────────

  /** Algo paso en el servidor: a veces otro Vocaloid lo comenta en #general. Devuelve quien lo comento. */
  async onEvent(e: AmbientEvent): Promise<BotId | null> {
    const s = this.d.settings.eventos;
    if (!this.d.settings.activo || !s.activo) return null;
    if (e.tipo === "trivia" && (e.racha ?? 0) < s.rachaTrivia) return null;
    const now = this.now();
    if (now - this.lastEvent < s.esperaMin * 60_000 || this.counters.get("evento") >= s.maxDia || !this.chance(s.probabilidad)) return null;
    const active = this.d.active();
    const involved = e.bots.filter((b) => active.includes(b));
    const others = active.filter((b) => !e.bots.includes(b));
    const pool = e.comenta === "involucrado" && involved.length ? involved : others.length ? others : involved;
    if (!pool.length) return null;
    const bot = this.pick(pool, "ambiente.evento.bot");
    this.lastEvent = now;
    this.counters.bump("evento");
    const text = await this.d.talker.say(bot, `${e.situacion} Coméntalo en #general con tu voz y en broma, como chisme del servidor (sin @ y sin inventar detalles que no están aquí).`);
    if (text) this.d.log?.(`🗣️ ${bot} comentó en #general: ${e.tipo}`);
    return text ? bot : null;
  }

  // ───────────────────────── reloj: preguntas al aire y momentos ─────────────────────────

  /** Cada 5 minutos. */
  async tick(): Promise<void> {
    if (!this.d.settings.activo || this.ticking) return;
    this.ticking = true;
    try {
      await this.closePolls();
      const last = await this.d.port.lastPapuInGeneral().catch(() => null);
      await this.moments(last);
      await this.openPoll(last);
    } finally {
      this.ticking = false;
    }
  }

  private openPolls(): OpenPoll[] {
    return this.d.db.prepare("SELECT id, indice, bot, channel_id, message_id, creada_at FROM ambiente_encuestas WHERE cerrada_at IS NULL ORDER BY id").all() as unknown as OpenPoll[];
  }

  private async openPoll(lastPapu: number | null): Promise<boolean> {
    const s = this.d.settings.encuestas;
    if (!s.activo || !this.d.polls.length || lastPapu === null) return false;
    const now = this.now();
    if (!inHours(clock(new Date(now), this.d.timeZone).hour, s.desde, s.hasta)) return false;
    if (now - lastPapu < s.silencioHoras * 3_600_000 || this.counters.get("encuesta") >= s.maxDia || this.openPolls().length) return false;
    const active = this.d.active();
    if (!active.length) return false;
    const bot = this.pick(active, "ambiente.encuesta.bot");
    const indice = this.d.decks.next("ambiente.encuesta", this.d.polls.length);
    const poll = this.d.polls[indice]!;
    this.counters.bump("encuesta");
    const content = [`📊 **${poll.pregunta}**`, ...poll.opciones.map((o) => `${o.emoji} ${o.texto}`), `-# Vota con una reacción · en unas ${s.resultadoHoras} horas comentamos el resultado`].join("\n");
    const posted = await this.d.port.postPoll(bot, content, poll.opciones.map((o) => o.emoji));
    if (!posted) return false;
    this.d.db
      .prepare("INSERT INTO ambiente_encuestas (indice, bot, channel_id, message_id, creada_at) VALUES (?, ?, ?, ?, ?)")
      .run(indice, bot, posted.channelId, posted.messageId, now);
    this.d.log?.(`📊 ${bot} lanzó una pregunta al aire en #general: ${poll.pregunta}`);
    return true;
  }

  private async closePolls(): Promise<void> {
    const s = this.d.settings.encuestas;
    const now = this.now();
    for (const p of this.openPolls()) {
      if (now - p.creada_at < s.resultadoHoras * 3_600_000) continue;
      this.d.db.prepare("UPDATE ambiente_encuestas SET cerrada_at = ? WHERE id = ?").run(now, p.id);
      const poll = this.d.polls[p.indice];
      const counts = await this.d.port.pollCounts(p.channel_id, p.message_id).catch(() => null);
      if (!poll || !counts) continue;
      const result = pollResult(poll, counts, true);
      const total = result.reduce((a, r) => a + r.votos, 0);
      const active = this.d.active();
      const others = active.filter((b) => b !== p.bot);
      const pool = others.length ? others : active;
      if (!pool.length) continue;
      const bot = this.pick(pool, "ambiente.resultado.bot");
      const tally = result.map((r) => `${r.texto}: ${r.votos}`).join(", ");
      const asker = this.d.names[p.bot] ?? p.bot;
      const situation = total
        ? `Hace unas horas ${asker} preguntó en #general «${poll.pregunta}» y los Papus votaron con reacciones. Resultado: ${tally}. Comenta el resultado con tu voz (quién ganó y qué opinas tú).`
        : `Hace unas horas ${asker} preguntó en #general «${poll.pregunta}» y ningún Papu votó. Búrlate con cariño de que nadie votó.`;
      const said = await this.d.talker.say(bot, situation);
      if (!said) {
        const line = total ? result.map((r) => `${r.emoji} ${r.texto} (${r.votos})`).join(" · ") : "nadie votó 🦗";
        await this.d.port.postGeneral(bot, `📊 Resultado de «${poll.pregunta}»: ${line}`);
      }
      this.d.log?.(`📊 Resultado de la pregunta al aire «${poll.pregunta}»: ${tally}`);
    }
  }

  private async moments(lastPapu: number | null): Promise<void> {
    const s = this.d.settings.momentos;
    if (!s.activo) return;
    const now = this.now();
    for (const m of momentsNow(s.lista, new Date(now), this.d.timeZone)) {
      if (this.counters.get(`momento:${m.id}`) > 0) continue;
      if (m.conGente && (lastPapu === null || now - lastPapu > PEOPLE_MS)) continue;
      const active = this.d.active();
      if (!active.length) return;
      // Uno solo por vuelta, y se marca aunque el LLM falle (no se reintenta cada 5 minutos).
      this.counters.bump(`momento:${m.id}`);
      const bot = this.pick(active, "ambiente.momento.bot");
      const said = await this.d.talker.say(bot, m.situacion);
      if (said) this.d.log?.(`🕰️ ${bot} escribió en #general por el momento «${m.id}»`);
      return;
    }
  }
}
