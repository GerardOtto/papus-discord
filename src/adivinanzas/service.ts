// «¡Adivina, Papu!» (pedido de GyroP, 20 nov. 2026; PLAN §3.17). Entre 4 y 6 veces al día (hora de México), si hay
// Papus charlando, un Vocaloid suelta una adivinanza de cualquier tema en el canal (banner con el pozo). El primero
// que acierta en ese canal se lleva el pozo: 50 Shaulitas al salir, sube hasta 150 al minuto y se queda; a los 2 min
// se revela. Pistas a los 40 s (en palabras) y 80 s (letras). 1 de cada 15 es dorada (×2). Si nadie acierta, la
// siguiente trae bote. Máximo 4 premios al día por Papu. Los lunes, Teto publica a los que más adivinaron la semana
// y el primero se lleva el rol decorativo 🧠 Sabelotodo. Lo revisa el código, nunca el LLM (regla 4); solo da
// Shaulitas ganadas, nada de XP ni cuota (regla 1).
import { isCorrect } from "../bodas/answer";
import type { BotId } from "../config";
import { kvGet, kvSet, transaction, type Db } from "../db/database";
import type { DeckStore } from "../phrases/deck";
import { CATEGORIAS, esIntento, letrasPista, lunesAnterior, lunesDe, mmss, pistaEn, planDelDia, pozo, relojLocal, type Adivinanza, type AdivinanzasSettings, type FrasesAdivinanzas } from "./rules";

/** Cada cuánto llama la app a tick(). */
export const ADIVINANZAS_TICK_MS = 2_000;

export interface Publicacion {
  content: string;
  image: Buffer;
  /** Etiquetar a los 🧩 Adivinadores (#tus-roles). */
  aviso?: boolean;
}

export interface AdivinanzasPort {
  /** Último mensaje de un Papu en cada canal de `nombres` (el más reciente; null = ninguno). */
  ultimoPapu(nombres: string[]): Promise<{ channelId: string; at: number } | null>;
  /** Publica y devuelve el id del mensaje (null si no se pudo). */
  publicar(bot: BotId, channelId: string, p: Publicacion): Promise<string | null>;
  editar(bot: BotId, channelId: string, messageId: string, p: Publicacion): Promise<void>;
  responder(bot: BotId, channelId: string, messageId: string, p: Publicacion): Promise<void>;
  reaccionar(bot: BotId, channelId: string, messageId: string, emoji: string): Promise<void>;
  /** Teto publica el resumen semanal en #ranking. */
  semanal(content: string): Promise<void>;
  /** Pasa el rol del Sabelotodo (lo crea si falta). Devuelve si pudo. */
  sabelotodo(nuevo: string, anterior: string | null): Promise<boolean>;
}

export interface Render {
  adivinanza(o: import("./images").BannerAdivinanza): Promise<Buffer>;
  ganador(o: import("./images").BannerGanador): Promise<Buffer>;
  nadie(o: import("./images").BannerNadie): Promise<Buffer>;
}

export interface AdivinanzasDeps {
  db: Db;
  settings: AdivinanzasSettings;
  banco: Adivinanza[];
  frases: FrasesAdivinanzas;
  decks: DeckStore;
  port: AdivinanzasPort;
  render: Render;
  /** Paga Shaulitas ganadas. */
  pagar: (userId: string, cantidad: number, motivo: string) => void;
  active: () => readonly BotId[];
  names: Record<BotId, string>;
  colors: Record<BotId, string>;
  avatar: (bot: BotId) => Buffer | null;
  log?: (msg: string) => void;
  now?: () => number;
  rng?: () => number;
}

interface Fila {
  id: number;
  indice: number;
  bot: BotId;
  channel_id: string;
  message_id: string | null;
  dorada: number;
  bote: number;
  creada_at: number;
}

export interface MensajePapu {
  channelId: string;
  messageId: string;
  authorId: string;
  authorName: string;
  text: string;
  /** Id del mensaje al que responde (si responde a uno). */
  repliedTo: string | null;
}

const KV_PLAN = "adivinanzas:plan";
const KV_BOTE = "adivinanzas:bote";
const KV_SEMANA = "adivinanzas:semana";
const KV_SABELOTODO = "adivinanzas:sabelotodo";
const KV_ULTIMO_BOT = "adivinanzas:ultimo-bot";

const fill = (t: string, vars: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);

export class AdivinanzasService {
  /** Etapa ya dibujada de cada adivinanza abierta (en memoria: tras un reinicio solo se redibuja una vez de más). */
  private readonly etapa = new Map<number, string>();
  private ticking = false;
  /** Adivinanzas que se están cerrando ahora (un acierto y el final del tiempo a la vez). */
  private readonly cerrando = new Set<number>();

  constructor(private readonly d: AdivinanzasDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private get s(): AdivinanzasSettings {
    return this.d.settings;
  }

  private reloj(t = this.now()) {
    return relojLocal(new Date(t), this.s.zonaHoraria);
  }

  abierta(): Fila | null {
    return (this.d.db.prepare("SELECT id, indice, bot, channel_id, message_id, dorada, bote, creada_at FROM adivinanzas WHERE cerrada_at IS NULL ORDER BY id DESC LIMIT 1").get() as unknown as Fila | undefined) ?? null;
  }

  bote(): number {
    return Number(kvGet(this.d.db, KV_BOTE) ?? 0);
  }

  /** Lo que se lleva quien acierte la adivinanza `f` a los `ms`. */
  premio(f: Pick<Fila, "dorada" | "bote">, ms: number): number {
    return pozo(this.s, ms, !!f.dorada) + f.bote;
  }

  premiosHoy(userId: string): number {
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM adivinanzas WHERE ganador = ? AND dia = ?").get(userId, this.reloj().day) as { n: number }).n;
  }

  // ───────────────────────── reloj ─────────────────────────

  async tick(): Promise<void> {
    if (!this.s.activo || this.ticking) return;
    this.ticking = true;
    try {
      const f = this.abierta();
      if (f) await this.avanzar(f);
      else await this.programada();
      await this.semanal();
    } finally {
      this.ticking = false;
    }
  }

  /** Plan del día: minutos (hora de México) a los que toca soltar una. */
  private plan(): number[] {
    const day = this.reloj().day;
    const raw = kvGet(this.d.db, KV_PLAN);
    const saved = raw ? (JSON.parse(raw) as { day: string; slots: number[] }) : null;
    if (saved?.day === day) return saved.slots;
    const slots = planDelDia(this.s, this.d.rng);
    kvSet(this.d.db, KV_PLAN, JSON.stringify({ day, slots }));
    return slots;
  }

  private guardarPlan(slots: number[]): void {
    kvSet(this.d.db, KV_PLAN, JSON.stringify({ day: this.reloj().day, slots }));
  }

  private async programada(): Promise<void> {
    const slots = this.plan();
    const { minutos } = this.reloj();
    const due = slots.filter((m) => m <= minutos);
    if (!due.length) return;
    // Nunca dos seguidas: si la última salió hace menos de separacionMin (un reinicio soltó una atrasada justo antes
    // de la siguiente del plan), esta espera.
    const ultima = (this.d.db.prepare("SELECT MAX(creada_at) AS t FROM adivinanzas WHERE message_id IS NOT NULL").get() as { t: number | null }).t;
    if (ultima !== null && this.now() - ultima < this.s.separacionMin * 60_000) return;
    const rest = slots.filter((m) => m > minutos);
    const hayGente = await this.d.port.ultimoPapu(this.s.canales).catch(() => null);
    if (hayGente && this.now() - hayGente.at <= this.s.conGenteMin * 60_000) {
      // Sale una (si se juntaron varias atrasadas, las demás se pierden: nada de dos seguidas).
      this.guardarPlan(rest);
      await this.soltar({ channelId: hayGente.channelId });
      return;
    }
    // Sin gente: se reintenta más tarde, si todavía cabe en el horario.
    const retry = minutos + this.s.reintentoMin;
    const fin = this.s.hasta * 60 - Math.ceil(this.s.duracionSeg / 60);
    this.guardarPlan([...(retry < fin ? [retry] : []), ...rest].sort((a, b) => a - b));
  }

  /** Elige el Vocaloid: el de la adivinanza si está en primera persona; si no, cualquiera menos el de la anterior. */
  private elegirBot(a: Adivinanza): BotId | null {
    const active = this.d.active();
    if (a.bot) return active.includes(a.bot) ? a.bot : null;
    const ultimo = kvGet(this.d.db, KV_ULTIMO_BOT);
    const pool = active.filter((b) => b !== ultimo);
    const list = pool.length ? pool : active;
    if (!list.length) return null;
    return list[this.d.decks.next(`adivinanzas.bot.${list.length}`, list.length)]!;
  }

  /** Suelta una adivinanza ahora en `channelId`. Devuelve su id (null si no se pudo). */
  async soltar(o: { channelId: string; bot?: BotId; dorada?: boolean }): Promise<number | null> {
    if (this.abierta()) return null;
    let indice = -1;
    let bot: BotId | null = null;
    for (let i = 0; i < 5 && !bot; i++) {
      indice = this.d.decks.next("adivinanzas.banco", this.d.banco.length);
      const a = this.d.banco[indice]!;
      if (o.bot && a.bot && a.bot !== o.bot) continue;
      bot = o.bot && this.d.active().includes(o.bot) ? o.bot : this.elegirBot(a);
    }
    if (!bot) return null;
    const rng = this.d.rng ?? Math.random;
    const dorada = o.dorada ?? rng() < 1 / Math.max(1, this.s.dorada.cada);
    const bote = this.bote();
    const now = this.now();
    const { day } = this.reloj(now);
    const id = Number(
      this.d.db
        .prepare("INSERT INTO adivinanzas (indice, bot, channel_id, dorada, bote, dia, semana, creada_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(indice, bot, o.channelId, dorada ? 1 : 0, bote, day, lunesDe(day), now).lastInsertRowid,
    );
    kvSet(this.d.db, KV_BOTE, "0");
    kvSet(this.d.db, KV_ULTIMO_BOT, bot);
    const f: Fila = { id, indice, bot, channel_id: o.channelId, message_id: null, dorada: dorada ? 1 : 0, bote, creada_at: now };
    const msgId = await this.d.port.publicar(bot, o.channelId, { ...(await this.vista(f, 0, true)), aviso: true }).catch(() => null);
    if (!msgId) {
      // No se pudo publicar: se anula sin premio y el bote vuelve.
      this.d.db.prepare("UPDATE adivinanzas SET cerrada_at = ? WHERE id = ?").run(now, id);
      kvSet(this.d.db, KV_BOTE, String(bote));
      return null;
    }
    this.d.db.prepare("UPDATE adivinanzas SET message_id = ? WHERE id = ?").run(msgId, id);
    this.etapa.set(id, "0:0");
    const a = this.d.banco[indice]!;
    this.d.log?.(`🧩 ${bot} soltó una adivinanza${dorada ? " DORADA" : ""} (${a.c}): ${a.t} → ${a.r[0]}`);
    return id;
  }

  /** Texto y banner de la adivinanza a los `ms`. */
  private async vista(f: Fila, ms: number, intro: boolean): Promise<Publicacion> {
    const a = this.d.banco[f.indice]!;
    const nivel = pistaEn(this.s, ms);
    const pista = nivel === 2 ? `PISTA 2:  ${letrasPista(a.r[0]!)}` : nivel === 1 ? `PISTA 1: ${a.p}` : null;
    const premio = this.premio(f, ms);
    const maxPozo = this.premio(f, this.s.subidaSeg * 1000);
    const total = this.s.duracionSeg * 1000;
    const cat = CATEGORIAS[a.c];
    const image = await this.d.render.adivinanza({
      avatar: this.d.avatar(f.bot),
      nombre: this.d.names[f.bot] ?? f.bot,
      color: this.d.colors[f.bot] ?? "#39C5BB",
      categoria: cat,
      texto: a.t,
      pozo: premio,
      pozoMax: maxPozo,
      bote: f.bote,
      ms,
      totalMs: total,
      marcas: { palabras: this.s.pistas.palabras, tope: this.s.subidaSeg, letras: this.s.pistas.letras },
      pista,
      dorada: !!f.dorada,
    });
    const fin = Math.floor((f.creada_at + total) / 1000);
    const head = intro ? `${fill(this.d.frases.intro[this.d.decks.next("adivinanzas.intro", this.d.frases.intro.length)]!, {})}\n` : "";
    const lines = [
      `${head}🧩 **${f.dorada ? "¡ADIVINANZA DORADA!" : "¡Adivina, Papu!"}** · ${cat.nombre}`,
      `> **${a.t}**`,
      ...(nivel === 1 ? [`> 💡 Pista: ${a.p}`] : nivel === 2 ? [`> 💡 Pista: ${a.p} · \`${letrasPista(a.r[0]!)}\``] : []),
      `> 💰 Pozo ahora: **${fmt(premio)} Shaulitas** (sube hasta ${fmt(maxPozo)}) · ⏳ se revela <t:${fin}:R>`,
      `-# Responde aquí en el canal · ${this.s.intentos} intentos por Papu · máximo ${this.s.maxPremiosDia} premios al día`,
    ];
    return { content: lines.join("\n"), image };
  }

  /** Redibuja el banner cuando cambia de etapa y la cierra al acabarse el tiempo. */
  private async avanzar(f: Fila): Promise<void> {
    const ms = this.now() - f.creada_at;
    if (ms >= this.s.duracionSeg * 1000) {
      await this.cerrarSinGanador(f);
      return;
    }
    if (!f.message_id) return;
    // Se redibuja cada actualizarSeg y también apenas sale una pista.
    const etapa = `${Math.floor(ms / (this.s.actualizarSeg * 1000))}:${pistaEn(this.s, ms)}`;
    if (this.etapa.get(f.id) === etapa) return;
    this.etapa.set(f.id, etapa);
    const p = await this.vista(f, ms, false);
    await this.d.port.editar(f.bot, f.channel_id, f.message_id, p).catch(() => {});
  }

  private async cerrarSinGanador(f: Fila): Promise<void> {
    if (this.cerrando.has(f.id)) return;
    this.cerrando.add(f.id);
    try {
      const r = this.d.db.prepare("UPDATE adivinanzas SET cerrada_at = ? WHERE id = ? AND cerrada_at IS NULL").run(this.now(), f.id);
      if (!Number(r.changes)) return;
      this.etapa.delete(f.id);
      const nuevoBote = Math.min(this.s.bote.max, f.bote + this.s.bote.porFallida);
      kvSet(this.d.db, KV_BOTE, String(nuevoBote));
      const a = this.d.banco[f.indice]!;
      const frase = fill(this.d.frases.nadie[this.d.decks.next("adivinanzas.nadie", this.d.frases.nadie.length)]!, { respuesta: a.r[0]! });
      const image = await this.d.render.nadie({ avatar: this.d.avatar(f.bot), color: this.d.colors[f.bot] ?? "#E285B2", respuesta: a.r[0]!, frase, bote: nuevoBote });
      const content = `⌛ **¡Se acabó el tiempo!** Era **${a.r[0]}**.\n${frase}${nuevoBote ? `\n-# 💰 Bote: la siguiente adivinanza sale con +${nuevoBote} Shaulitas.` : ""}`;
      if (f.message_id) await this.d.port.responder(f.bot, f.channel_id, f.message_id, { content, image }).catch(() => {});
      this.d.log?.(`🧩 Nadie adivinó (${a.r[0]}); bote ${nuevoBote}`);
    } finally {
      this.cerrando.delete(f.id);
    }
  }

  // ───────────────────────── mensajes de los Papus ─────────────────────────

  /**
   * Un mensaje de un Papu (ya pasó la moderación). true = era un intento de la adivinanza y ya se atendió (no va a
   * los Vocaloids); false = charla normal.
   */
  async onMessage(m: MensajePapu): Promise<boolean> {
    if (!this.s.activo) return false;
    const f = this.abierta();
    if (!f || f.channel_id !== m.channelId || !f.message_id) return false;
    const ms = this.now() - f.creada_at;
    if (ms >= this.s.duracionSeg * 1000) {
      await this.cerrarSinGanador(f);
      return false;
    }
    const respondeA = m.repliedTo === f.message_id;
    if (!esIntento(this.s, m.text, respondeA)) return false;
    const usados = (this.d.db.prepare("SELECT n FROM adivinanzas_intentos WHERE adivinanza = ? AND user_id = ?").get(f.id, m.authorId) as { n: number } | undefined)?.n ?? 0;
    if (usados >= this.s.intentos) {
      if (respondeA) await this.d.port.reaccionar(f.bot, m.channelId, m.messageId, "🚫").catch(() => {});
      return respondeA;
    }
    this.d.db
      .prepare("INSERT INTO adivinanzas_intentos (adivinanza, user_id, n) VALUES (?, ?, 1) ON CONFLICT(adivinanza, user_id) DO UPDATE SET n = n + 1")
      .run(f.id, m.authorId);
    const a = this.d.banco[f.indice]!;
    if (!isCorrect(m.text, a.r)) {
      await this.d.port.reaccionar(f.bot, m.channelId, m.messageId, "❌").catch(() => {});
      return true;
    }
    if (this.premiosHoy(m.authorId) >= this.s.maxPremiosDia) {
      // Ya ganó sus premios de hoy: acierta, pero le deja la adivinanza a los demás.
      await this.d.port.reaccionar(f.bot, m.channelId, m.messageId, "🔒").catch(() => {});
      return true;
    }
    await this.ganar(f, m, ms);
    return true;
  }

  private async ganar(f: Fila, m: MensajePapu, ms: number): Promise<void> {
    if (this.cerrando.has(f.id)) return;
    this.cerrando.add(f.id);
    try {
      const premio = this.premio(f, ms);
      const ok = transaction(this.d.db, () => {
        const r = this.d.db
          .prepare("UPDATE adivinanzas SET cerrada_at = ?, ganador = ?, nombre = ?, premio = ?, ms = ? WHERE id = ? AND cerrada_at IS NULL")
          .run(this.now(), m.authorId, m.authorName, premio, ms, f.id);
        if (!Number(r.changes)) return false;
        this.d.pagar(m.authorId, premio, `adivinanza al aire #${f.id}`);
        return true;
      });
      if (!ok) return;
      this.etapa.delete(f.id);
      const a = this.d.banco[f.indice]!;
      const hoy = this.premiosHoy(m.authorId);
      const tiempo = mmss(ms);
      const frase = fill(this.d.frases.acierto[this.d.decks.next("adivinanzas.acierto", this.d.frases.acierto.length)]!, { papu: `<@${m.authorId}>`, premio: fmt(premio), respuesta: a.r[0]! });
      const image = await this.d.render.ganador({ avatar: this.d.avatar(f.bot), color: this.d.colors[f.bot] ?? "#39C5BB", papu: m.authorName, respuesta: a.r[0]!, tiempo, premio, hoy, dorada: !!f.dorada });
      const content = `🎉 ${frase}\n-# ✅ **${a.r[0]}** · a los ${tiempo} · +${fmt(premio)} Shaulitas · hoy lleva ${hoy}/${this.s.maxPremiosDia}`;
      await this.d.port.responder(f.bot, m.channelId, m.messageId, { content, image }).catch(() => {});
      this.d.log?.(`🧩 ${m.authorName} adivinó «${a.r[0]}» a los ${tiempo}: +${premio}`);
    } finally {
      this.cerrando.delete(f.id);
    }
  }

  // ───────────────────────── semanal ─────────────────────────

  /** Los que más adivinaron en la semana que empieza el lunes `semana`. */
  topSemana(semana: string, n = this.s.semanal.top): { userId: string; nombre: string; aciertos: number; shaulitas: number }[] {
    return this.d.db
      .prepare(
        `SELECT ganador AS userId, MAX(nombre) AS nombre, COUNT(*) AS aciertos, SUM(premio) AS shaulitas, MIN(cerrada_at) AS primero
         FROM adivinanzas WHERE semana = ? AND ganador IS NOT NULL GROUP BY ganador
         ORDER BY aciertos DESC, shaulitas DESC, primero ASC LIMIT ?`,
      )
      .all(semana, n) as unknown as { userId: string; nombre: string; aciertos: number; shaulitas: number }[];
  }

  private async semanal(): Promise<void> {
    const s = this.s.semanal;
    const r = this.reloj();
    if (r.weekday !== s.dia || r.hora < s.hora) return;
    const semana = lunesAnterior(r.day);
    if (kvGet(this.d.db, KV_SEMANA) === semana) return;
    kvSet(this.d.db, KV_SEMANA, semana);
    const top = this.topSemana(semana);
    if (!top.length) return;
    const medal = ["🥇", "🥈", "🥉"];
    const lines = top.map((t, i) => `${medal[i] ?? `**${i + 1}.**`} <@${t.userId}> · ${t.aciertos} adivinada${t.aciertos === 1 ? "" : "s"} · ${fmt(t.shaulitas)} Shaulitas`);
    const primero = top[0]!;
    const anterior = kvGet(this.d.db, KV_SABELOTODO);
    const ok = await this.d.port.sabelotodo(primero.userId, anterior && anterior !== primero.userId ? anterior : null).catch(() => false);
    if (ok) kvSet(this.d.db, KV_SABELOTODO, primero.userId);
    await this.d.port.semanal(
      [`🧩 **¡Adivina, Papu!: los cerebritos de la semana**`, ...lines, "", `${s.rol} para <@${primero.userId}> hasta el próximo lunes. ¡A defenderlo! 🥖`].join("\n"),
    );
    this.d.log?.(`🧠 Sabelotodo de la semana ${semana}: ${primero.nombre}`);
  }
}
