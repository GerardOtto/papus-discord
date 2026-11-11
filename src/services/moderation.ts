// Moderacion de Neru (PLAN §7): reglas fijas -> borrar -> machetazo -> sancion -> aviso en el canal y en #moderacion.
// Neru nunca expulsa ni banea; GyroP queda exento. Tambien aplica los machetazos de los bloqueos de AutoMod.
import type { Phrases } from "../phrases/catalog";
import { FloodTracker, INVITE_RE, isExpressive, type RuleSet, type Violation, type ViolationKind } from "../moderation/rules";
import { MAX_MACHETAZOS, WARNINGS_PER_MACHETAZO, type Machetazo, type Penalty, type StrikeStore } from "../moderation/strikes";

export interface ModMessage {
  messageId: string;
  channelId: string;
  authorId: string;
  text: string;
  targetsSomeone: boolean;
  /** Menciona o responde a uno de nuestros bots. */
  targetsBot?: boolean;
  memberAgeHours: number;
  /** Canal libre (`canalesLibres` de config/moderacion.json). */
  freeLanguage?: boolean;
  /** Sin flood: #general y el hilo mientras hay una adivinanza de boda abierta (decision de GyroP, 22 oct. 2026). */
  noFlood?: boolean;
}

export interface ModLogEntry {
  userId: string;
  channelId: string | null;
  kind: string;
  detail: string;
  excerpt: string;
  action: string;
  /** Machetazos activos despues de la accion (null si no aplica). */
  activeStrikes: number | null;
}

export interface ModerationPort {
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  timeout(userId: string, minutes: number, reason: string): Promise<void>;
  /** Neru escribe en un canal (respondiendo a `replyTo`, si se da). */
  say(channelId: string, content: string, pingUserId: string | null, replyTo?: string): Promise<void>;
  log(entry: ModLogEntry): Promise<void>;
  notifyOwner(content: string): Promise<void>;
}

export interface AutoModHit {
  userId: string;
  channelId: string | null;
  ruleName: string;
  content: string;
}

const CAPS_COOLDOWN_MS = 10 * 60_000;
/** Toque por pedir que ignoren o saquen a alguien: uno cada 30 min por Papu (es un aviso, no una sanción). */
const EXCLUSION_COOLDOWN_MS = 30 * 60_000;
/** Advertencia automática por maltrato: una por minuto por Papu (una frase partida en varios mensajes cuenta una vez). */
const ABUSE_COOLDOWN_MS = 60_000;
/** Una frase de apoyo por Papu cada 6 h: si sigue hablando del tema, le responde el Vocaloid (con la guía de comun.md). */
const SUPPORT_COOLDOWN_MS = 6 * 3_600_000;
/** Infracciones con frase propia (explican la regla); la linea del machetazo dice la sancion. */
const OWN_PHRASE: Partial<Record<ViolationKind, string>> = {
  invitacion: "invitacion",
  estafa: "estafa",
  flood: "flood",
  enlace_cuenta_nueva: "enlace_cuenta_nueva",
  mayusculas: "mayusculas",
};

/** Se citan (con la grosería tapada) para que todos aprendan del ejemplo. Datos, invitaciones y estafas no: citarlos
 * volvería a exponer el teléfono o el enlace. */
const QUOTED: ReadonlySet<ViolationKind> = new Set(["insulto", "muy_fuerte", "odio"]);

/** Regla del filtro de spam de Discord ("Neru · spam"): bloquea, pero sin machetazo. */
const isSpamRule = (ruleName: string) => /·\s*spam$/i.test(ruleName);

/** Que frase lleva un bloqueo de AutoMod. */
const kindOfHit = (hit: AutoModHit): ViolationKind =>
  /dato|estafa/i.test(hit.ruleName) ? (INVITE_RE.test(hit.content) ? "invitacion" : "estafa") : "insulto";

/** "🔪 machetazo 1 de 3 · 10 min de silencio y sin la XP de hoy. al siguiente, …" (la escalera real de penaltyFor). */
export function machetazoLine(active: number, penalty: Penalty): string {
  const n = Math.min(active, MAX_MACHETAZOS);
  const silence = penalty.minutes >= 1440 ? "un día de silencio" : penalty.minutes >= 60 ? "una hora de silencio" : `${penalty.minutes} min de silencio`;
  const now = `${silence}, sin la XP de hoy${penalty.blockXp ? " y sin ganar XP" : ""}`;
  const next = n <= 1 ? "al siguiente, una hora y sin ganar XP" : n === 2 ? "al 3.º, un día sin escribir y gyrop revisa tu caso" : "gyrop ya está avisado y revisa tu caso";
  return `🔪 **machetazo ${n} de ${MAX_MACHETAZOS}** · ${now}. ${next}. (se borran a los 3 días)`;
}

/** "advertencia 2 de 3 · a la tercera, machetazo." */
export function warningLine(warnings: number): string {
  return `**advertencia ${warnings} de ${WARNINGS_PER_MACHETAZO}** · a la tercera, machetazo. (se borran a los 3 días)`;
}

export class ModerationService {
  private readonly flood: FloodTracker;
  private readonly capsWarned = new Map<string, number>();
  private readonly exclusionWarned = new Map<string, number>();
  private readonly abuseWarned = new Map<string, number>();
  private readonly supported = new Map<string, number>();

  constructor(
    private readonly rules: RuleSet,
    private readonly strikes: StrikeStore,
    private readonly phrases: Phrases,
    private readonly port: ModerationPort,
    private readonly exempt: () => ReadonlySet<string>,
    private readonly now: () => number = Date.now,
  ) {
    const l = rules.settings.limites;
    this.flood = new FloodTracker(l.floodMensajes, l.floodSegundos * 1000);
  }

  /** Revisa un mensaje. Devuelve la infraccion aplicada (null si esta bien). Si `remove`, el mensaje ya no existe. */
  async handle(m: ModMessage): Promise<Violation | null> {
    if (this.exempt().has(m.authorId)) return null;
    const t = this.now();
    let v = this.rules.check(m);
    // Repetir un mensaje ya no es infracción, y los emojis, stickers y GIF no cuentan para el flood (decisión de GyroP,
    // 22 oct. 2026: cortaba el ánimo de los Papus).
    if ((!v || !v.remove) && !m.noFlood && !isExpressive(m.text) && this.flood.hit(m.authorId, t)) v = { kind: "flood", remove: true, strike: true, detail: "flood" };
    if (!v) return null;

    const papu = `<@${m.authorId}>`;
    if (v.kind === "mayusculas") {
      const last = this.capsWarned.get(m.authorId);
      if (last !== undefined && t - last < CAPS_COOLDOWN_MS) return null;
      this.capsWarned.set(m.authorId, t);
      await this.port.say(m.channelId, this.phrases.pick("neru", "mayusculas", { papu }), m.authorId);
      return v;
    }

    // Maltrato a otro Papu (parche del 11 nov. 2026): advertencia automática, como /advertir. Sin borrar.
    if (v.kind === "maltrato") {
      if (!this.cooldown(this.abuseWarned, m.authorId, ABUSE_COOLDOWN_MS, t)) return null;
      await this.warn({ userId: m.authorId, channelId: m.channelId, messageId: m.messageId, excerpt: m.text, por: "Neru", grupo: "maltrato", razon: v.detail });
      return v;
    }

    // Pedir que ignoren o saquen a alguien: un toque público, sin sanción; GyroP o un Mod deciden en #moderación.
    if (v.kind === "exclusion") {
      if (!this.cooldown(this.exclusionWarned, m.authorId, EXCLUSION_COOLDOWN_MS, t)) return null;
      await this.port.say(m.channelId, this.phrases.pick("neru", "exclusion", { papu }), m.authorId, m.messageId).catch(() => {});
      await this.port.log({
        userId: m.authorId,
        channelId: m.channelId,
        kind: v.kind,
        detail: v.detail,
        excerpt: m.text,
        action: "sin borrar · toque de Neru, sin sanción (si sigue: /advertir)",
        activeStrikes: null,
      });
      return v;
    }

    const removed = v.remove ? await this.remove(m.channelId, m.messageId) : false;
    const hit = v.strike ? this.strikes.add({ userId: m.authorId, reason: v.kind, excerpt: m.text, channelId: m.channelId }, t) : null;
    const action = await this.apply(m.authorId, m.channelId, v.kind, hit, m.text);
    await this.port.log({
      userId: m.authorId,
      channelId: m.channelId,
      kind: v.kind,
      detail: v.detail,
      excerpt: m.text,
      action: `${v.remove ? (removed ? "borrado" : "no se pudo borrar") : "sin borrar"}${action ? ` · ${action}` : ""}`,
      activeStrikes: hit?.active ?? null,
    });
    return v;
  }

  /**
   * Un Papu habla de hacerse daño (caso real del 18 oct. 2026: "palabras de motivación para no terminar con todo").
   * No es infracción: Neru le responde con una frase fija de apoyo + las líneas de ayuda, y GyroP recibe el aviso en
   * #moderación para escribirle. Reglas fijas, nunca el LLM (regla 3). Devuelve true si respondió: entonces el
   * mensaje no pasa a los Vocaloids ni gasta cuota.
   */
  async support(m: Pick<ModMessage, "messageId" | "channelId" | "authorId" | "text">): Promise<boolean> {
    const phrase = this.rules.selfHarmPhrase(m.text);
    if (!phrase) return false;
    const t = this.now();
    const last = this.supported.get(m.authorId);
    if (last !== undefined && t - last < SUPPORT_COOLDOWN_MS) return false;
    this.supported.set(m.authorId, t);

    const lines = [this.phrases.pick("neru", "apoyo", { papu: `<@${m.authorId}>` })];
    const help = this.rules.settings.lineasDeAyuda?.trim();
    if (help) lines.push(help);
    await this.port.say(m.channelId, lines.join("\n"), m.authorId, m.messageId);
    await this.port.notifyOwner(
      `💙 <@${m.authorId}> escribió algo que suena a querer hacerse daño ("${phrase}") en <#${m.channelId}>. Neru le respondió con las líneas de ayuda; quizá quieras escribirle por privado.\n> ${m.text.slice(0, 300).replace(/\n/g, " ")}`,
    );
    return true;
  }

  /**
   * Bloqueo de AutoMod visto en vivo: Neru lo publica como suyo y suma el machetazo (el mensaje ya no existe). El
   * filtro de spam de Discord solo bloquea (Discord ya le muestra el aviso al Papu): sin machetazo ni frase, porque
   * tambien atrapa copiar y pegar, que ya no es infracción (decisión de GyroP, 22 oct. 2026). Queda en #moderación.
   */
  async handleAutoModHit(hit: AutoModHit): Promise<void> {
    if (this.exempt().has(hit.userId)) return;
    if (isSpamRule(hit.ruleName)) {
      await this.port.log({
        userId: hit.userId,
        channelId: hit.channelId,
        kind: "automod",
        detail: hit.ruleName,
        excerpt: hit.content,
        action: "bloqueado por AutoMod · sin machetazo",
        activeStrikes: this.strikes.active(hit.userId, this.now()),
      });
      return;
    }
    const m = this.strikes.add(
      { userId: hit.userId, reason: `automod: ${hit.ruleName}`, excerpt: hit.content, channelId: hit.channelId ?? undefined },
      this.now(),
    );
    // Sin canal no hay donde avisar, pero el silencio igual va.
    const action = hit.channelId ? await this.apply(hit.userId, hit.channelId, kindOfHit(hit), m, hit.content) : await this.punish(hit.userId, "automod", m);
    await this.port.log({
      userId: hit.userId,
      channelId: hit.channelId,
      kind: "automod",
      detail: hit.ruleName,
      excerpt: hit.content,
      action: `bloqueado por AutoMod · ${action}`,
      activeStrikes: m.active,
    });
  }

  /**
   * Advertencia a mano de GyroP o de un Mod (clic derecho "Advertir (Neru)" o /advertir): Neru llama la atencion en
   * publico con una frase fija, sin borrar el mensaje. Vence a los 3 dias; la tercera activa se vuelve un machetazo
   * (decision de GyroP, 28 oct. 2026): entonces se borra el mensaje y va la sancion completa. Queda en #moderacion (con
   * quien la dio). `por`: quien la da en el registro ("GyroP" por defecto; "Mod <@id>"). Devuelve las advertencias
   * activas y el machetazo, si lo hubo.
   */
  async warn(w: {
    userId: string;
    channelId: string;
    messageId?: string;
    excerpt?: string;
    motivo?: string;
    por?: string;
    /** Grupo de frases de Neru ("aviso" por defecto; "maltrato" en la advertencia automática). */
    grupo?: string;
    /** Razón para el registro cuando no hay motivo público (advertencia automática). */
    razon?: string;
  }): Promise<{ warnings: number; machetazo: Machetazo | null }> {
    const por = w.por ?? "GyroP";
    const motivo = w.motivo?.trim().replace(/\n/g, " ") ?? "";
    const r = this.strikes.warn(
      { userId: w.userId, reason: `advertencia de ${por.toLowerCase()}: ${motivo || w.razon || "a mano"}`, excerpt: w.excerpt || motivo, channelId: w.channelId },
      this.now(),
    );
    let action: string;
    if (r.machetazo) {
      const removed = w.messageId ? await this.remove(w.channelId, w.messageId) : false;
      const applied = await this.apply(w.userId, w.channelId, "manual", r.machetazo, "", { motivo, replyTo: removed ? undefined : w.messageId, por, fromWarnings: true });
      action = `${removed ? "borrado" : w.messageId ? "no se pudo borrar" : "sin mensaje"} · ${WARNINGS_PER_MACHETAZO} advertencias · ${applied}`;
    } else {
      const lines = [this.phrases.pick("neru", w.grupo ?? "aviso", { papu: `<@${w.userId}>` })];
      if (motivo) lines.push(`> ${motivo}`);
      lines.push(warningLine(r.warnings));
      await this.port.say(w.channelId, lines.join("\n"), w.userId, w.messageId);
      action = `sin borrar · advertencia ${r.warnings} de ${WARNINGS_PER_MACHETAZO}`;
    }
    await this.port.log({
      userId: w.userId,
      channelId: w.channelId,
      kind: `advertencia de ${por}`,
      detail: motivo || w.razon || `advertencia de ${por}`,
      excerpt: w.excerpt ?? "",
      action,
      activeStrikes: r.machetazo?.active ?? this.strikes.active(w.userId, this.now()),
    });
    return r;
  }

  /**
   * Machetazo a mano de GyroP o de un Mod (/machetazo o clic derecho "Machetazo (Neru)"): la misma escalera y el mismo
   * aviso publico que uno automatico, con el motivo citado. Borra el mensaje, si lo hay (el aviso va suelto, sin
   * responder al mensaje que ya no existe). Devuelve los activos. `por`: quien lo da ("GyroP" por defecto; "Mod <@id>").
   */
  async strike(s: { userId: string; channelId: string; messageId?: string; excerpt?: string; motivo?: string; por?: string }): Promise<number> {
    const motivo = s.motivo?.trim().replace(/\n/g, " ") ?? "";
    const por = s.por ?? "GyroP";
    const m = this.strikes.add(
      { userId: s.userId, reason: `${por.toLowerCase()}: ${motivo || "machetazo a mano"}`, excerpt: s.excerpt || motivo, channelId: s.channelId },
      this.now(),
    );
    const removed = s.messageId ? await this.remove(s.channelId, s.messageId) : false;
    const action = await this.apply(s.userId, s.channelId, "manual", m, "", { motivo, replyTo: removed ? undefined : s.messageId, por });
    await this.port.log({
      userId: s.userId,
      channelId: s.channelId,
      kind: `machetazo de ${por}`,
      detail: motivo || "machetazo a mano",
      excerpt: s.excerpt ?? "",
      action: `${removed ? "borrado" : s.messageId ? "no se pudo borrar" : "sin mensaje"} · ${action}`,
      activeStrikes: m.active,
    });
    return m.active;
  }

  /**
   * Bloqueos de AutoMod ocurridos con los bots apagados: suma los machetazos pendientes (sin silencios tardios)
   * y devuelve el resumen de Neru, o null si no hubo bloqueos.
   */
  async applyOfflineHits(hits: AutoModHit[]): Promise<string | null> {
    const relevant = hits.filter((h) => !this.exempt().has(h.userId) && !isSpamRule(h.ruleName));
    if (!relevant.length) return null;
    const flagged = new Set<string>();
    for (const h of relevant) {
      const { penalty } = this.strikes.add(
        { userId: h.userId, reason: `automod (sin conexion): ${h.ruleName}`, excerpt: h.content, channelId: h.channelId ?? undefined },
        this.now(),
      );
      if (penalty.notifyOwner) flagged.add(h.userId);
    }
    for (const u of flagged) await this.port.notifyOwner(`<@${u}> llegó a ${MAX_MACHETAZOS} machetazos mientras los bots estaban desconectados. Revisa su caso en #moderación.`);
    return this.phrases.pick("neru", "resumen_despertar", { n: relevant.length });
  }

  /**
   * Aplica el machetazo y llama la atencion EN PUBLICO, en el mismo canal (decision de GyroP: que todos aprendan del
   * ejemplo): frase de Neru + lo que se dijo (con la groseria tapada) + en que machetazo va y que viene despues. Sin
   * machetazo (`hit` null), solo la frase. Devuelve la descripcion de la accion para el registro.
   */
  private async apply(
    userId: string,
    channelId: string,
    kind: ViolationKind | "manual",
    hit: Machetazo | null,
    excerpt = "",
    extra: { motivo?: string; replyTo?: string; por?: string; fromWarnings?: boolean } = {},
  ): Promise<string> {
    const papu = `<@${userId}>`;
    const own = kind === "manual" ? undefined : OWN_PHRASE[kind];
    const phrase = this.phrases.pick("neru", own ?? (hit ? `silencio_${hit.penalty.minutes}` : "advertencia"), { papu });
    const lines = [phrase];
    if (kind !== "manual" && QUOTED.has(kind) && excerpt.trim()) {
      const { text, masked } = this.rules.mask(excerpt.trim().slice(0, 200));
      if (masked > 0) lines.push(`> ${text.replace(/\n/g, " ")}`);
    }
    if (extra.motivo) lines.push(`> ${extra.motivo}`);
    if (extra.fromWarnings) lines.push(`-# ${WARNINGS_PER_MACHETAZO} advertencias = 1 machetazo.`);
    if (hit) lines.push(machetazoLine(hit.active, hit.penalty));
    const action = hit ? await this.punish(userId, kind === "manual" ? `machetazo de ${extra.por ?? "GyroP"}` : kind, hit) : "";
    // Si el aviso no sale (p. ej. un hilo cerrado), el machetazo y el silencio ya estan: que igual quede en #moderacion.
    await this.port.say(channelId, lines.join("\n"), userId, extra.replyTo).catch(() => {});
    return action;
  }

  /** Silencio del machetazo y, al 3.º, aviso a GyroP. La XP del dia ya la quitaron los niveles (StrikeStore.onAdd). */
  private async punish(userId: string, reason: string, hit: Machetazo): Promise<string> {
    const { minutes, blockXp, notifyOwner } = hit.penalty;
    await this.port.timeout(userId, minutes, `Neru: ${reason}`).catch(() => {});
    if (notifyOwner)
      await this.port.notifyOwner(`<@${userId}> llegó a ${hit.active} machetazos activos (último: ${reason}). Silencio de 24 h aplicado y sin ganar XP; revisa su caso.`);
    return `machetazo ${hit.active} · silencio ${minutes} min · sin la XP de hoy${blockXp ? " · sin ganar XP" : ""}`;
  }

  /** true (y anota la hora) si ya pasó la espera desde el último aviso a este Papu. */
  private cooldown(map: Map<string, number>, userId: string, ms: number, t: number): boolean {
    const last = map.get(userId);
    if (last !== undefined && t - last < ms) return false;
    map.set(userId, t);
    return true;
  }

  /** Borra el mensaje; false si Discord no lo dejo (asi el registro no dice "borrado" cuando no lo esta). */
  private async remove(channelId: string, messageId: string): Promise<boolean> {
    return this.port.deleteMessage(channelId, messageId).then(
      () => true,
      () => false,
    );
  }
}
