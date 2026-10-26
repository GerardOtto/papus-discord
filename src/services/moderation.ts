// Moderacion de Neru (PLAN §7): reglas fijas -> borrar -> strike -> sancion -> aviso en el canal y en #moderacion.
// Neru nunca expulsa ni banea; GyroP queda exento. Tambien aplica los strikes de los bloqueos de AutoMod.
import type { Phrases } from "../phrases/catalog";
import { FloodTracker, INVITE_RE, isExpressive, type RuleSet, type Violation, type ViolationKind } from "../moderation/rules";
import type { Penalty, StrikeStore } from "../moderation/strikes";

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
/** Una frase de apoyo por Papu cada 6 h: si sigue hablando del tema, le responde el Vocaloid (con la guía de comun.md). */
const SUPPORT_COOLDOWN_MS = 6 * 3_600_000;
/** Infracciones con frase propia (explican la regla); si ademas toca silencio, manda la del silencio. */
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
const MAX_STRIKES = 4;

/** Regla del filtro de spam de Discord ("Neru · spam"): bloquea, pero sin strike. */
const isSpamRule = (ruleName: string) => /·\s*spam$/i.test(ruleName);

/** Que frase lleva un bloqueo de AutoMod. */
const kindOfHit = (hit: AutoModHit): ViolationKind =>
  /dato|estafa/i.test(hit.ruleName) ? (INVITE_RE.test(hit.content) ? "invitacion" : "estafa") : "insulto";

/** Lo que dice #moderacion cuando la lista `sinStrikes` evita un strike. */
const SPARED_NOTE = "sin strike (lista de GyroP)";

/** "strike 2 de 4 · 10 min de silencio. al siguiente, una hora." (la escalera real de penaltyFor). */
export function strikeLine(active: number, penalty: Penalty): string {
  const n = Math.min(active, MAX_STRIKES);
  const now = penalty.kind === "advertencia" ? "advertencia" : penalty.minutes >= 1440 ? "un día de silencio" : penalty.minutes >= 60 ? "una hora de silencio" : `${penalty.minutes} min de silencio`;
  const next =
    n <= 1 ? "al siguiente, 10 min de silencio" : n === 2 ? "al siguiente, una hora" : n === 3 ? "al 4.º, un día sin escribir y gyrop decide si te quedas" : "gyrop ya está avisado y decide si te quedas";
  return `**strike ${n} de ${MAX_STRIKES}** · ${now}. ${next}. (se borran a los 3 días)`;
}

export class ModerationService {
  private readonly flood: FloodTracker;
  private readonly capsWarned = new Map<string, number>();
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

    const removed = v.remove ? await this.remove(m.channelId, m.messageId) : false;
    const spared = v.strike && this.spared(m.authorId);
    let penalty: Penalty | null = null;
    let active: number | null = null;
    if (v.strike && !spared) {
      const r = this.strikes.add({ userId: m.authorId, reason: v.kind, excerpt: m.text, channelId: m.channelId }, t);
      penalty = r.penalty;
      active = r.active;
    }
    const action = await this.apply(m.authorId, m.channelId, v.kind, penalty, active, m.text);
    await this.port.log({
      userId: m.authorId,
      channelId: m.channelId,
      kind: v.kind,
      detail: v.detail,
      excerpt: m.text,
      action: `${v.remove ? (removed ? "borrado" : "no se pudo borrar") : "sin borrar"}${action ? ` · ${action}` : ""}${spared ? ` · ${SPARED_NOTE}` : ""}`,
      activeStrikes: active ?? (spared ? this.strikes.active(m.authorId, t) : null),
    });
    return v;
  }

  /** En la lista `sinStrikes` de config/moderacion.json: aviso, pero el strike solo lo pone GyroP. */
  spared(userId: string): boolean {
    return (this.rules.settings.sinStrikes ?? []).some((p) => p.id === userId);
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
   * Bloqueo de AutoMod visto en vivo: Neru lo publica como suyo y suma el strike. El filtro de spam de Discord solo
   * bloquea (Discord ya le muestra el aviso al Papu): sin strike ni frase, porque tambien atrapa copiar y pegar, que ya
   * no es infracción (decisión de GyroP, 22 oct. 2026). Queda en #moderación.
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
        action: "bloqueado por AutoMod · sin strike",
        activeStrikes: this.strikes.active(hit.userId, this.now()),
      });
      return;
    }
    if (this.spared(hit.userId)) {
      // AutoMod ya bloqueó el mensaje: solo el aviso de Neru, sin strike.
      const action = hit.channelId ? await this.apply(hit.userId, hit.channelId, kindOfHit(hit), null, null, hit.content) : "";
      await this.port.log({
        userId: hit.userId,
        channelId: hit.channelId,
        kind: "automod",
        detail: hit.ruleName,
        excerpt: hit.content,
        action: `bloqueado por AutoMod${action ? ` · ${action}` : ""} · ${SPARED_NOTE}`,
        activeStrikes: this.strikes.active(hit.userId, this.now()),
      });
      return;
    }
    const { penalty, active } = this.strikes.add(
      { userId: hit.userId, reason: `automod: ${hit.ruleName}`, excerpt: hit.content, channelId: hit.channelId ?? undefined },
      this.now(),
    );
    const action = hit.channelId ? await this.apply(hit.userId, hit.channelId, kindOfHit(hit), penalty, active, hit.content) : "";
    await this.port.log({
      userId: hit.userId,
      channelId: hit.channelId,
      kind: "automod",
      detail: hit.ruleName,
      excerpt: hit.content,
      action: `bloqueado por AutoMod${action ? ` · ${action}` : ""}`,
      activeStrikes: active,
    });
  }

  /**
   * Aviso a mano de GyroP o de un Mod (clic derecho "Advertir (Neru)" o /advertir): Neru llama la atencion en publico
   * con una frase fija, sin borrar el mensaje ni sumar strike. Queda en #moderacion (con quien lo dio) por si se repite.
   * `por`: quien lo da en el registro ("GyroP" por defecto; "Mod <@id>").
   */
  async warn(w: { userId: string; channelId: string; messageId?: string; excerpt?: string; motivo?: string; por?: string }): Promise<void> {
    const lines = [this.phrases.pick("neru", "aviso", { papu: `<@${w.userId}>` })];
    if (w.motivo?.trim()) lines.push(`> ${w.motivo.trim().replace(/\n/g, " ")}`);
    await this.port.say(w.channelId, lines.join("\n"), w.userId, w.messageId);
    await this.port.log({
      userId: w.userId,
      channelId: w.channelId,
      kind: "aviso",
      detail: w.motivo?.trim() || `aviso de ${w.por ?? "GyroP"}`,
      excerpt: w.excerpt ?? "",
      action: "sin borrar · sin strike",
      activeStrikes: this.strikes.active(w.userId, this.now()),
    });
  }

  /**
   * Strike a mano de GyroP o de un Mod (/strike o clic derecho "Strike (Neru)"; decisiones de GyroP, 20 y 21 oct. 2026):
   * la misma escalera y el mismo aviso publico que un strike automatico, con el motivo citado. No borra el mensaje,
   * salvo con `borrar` (clic derecho "Strike y borrar (Neru)", decision de GyroP, 22 oct. 2026): entonces el aviso va
   * suelto, sin responder al mensaje que ya no existe. Devuelve los activos. `por`: quien lo da ("GyroP" por defecto;
   * "Mod <@id>").
   */
  async strike(s: { userId: string; channelId: string; messageId?: string; excerpt?: string; motivo?: string; por?: string; borrar?: boolean }): Promise<number | null> {
    const motivo = s.motivo?.trim().replace(/\n/g, " ") ?? "";
    const por = s.por ?? "GyroP";
    // A los de `sinStrikes` solo GyroP les pone strike: el de un Mod queda como aviso (y devuelve null).
    if (por !== "GyroP" && this.spared(s.userId)) {
      await this.warn({ ...s, por });
      return null;
    }
    const { penalty, active } = this.strikes.add(
      { userId: s.userId, reason: `${por.toLowerCase()}: ${motivo || "strike a mano"}`, excerpt: s.excerpt || motivo, channelId: s.channelId },
      this.now(),
    );
    const removed = s.borrar && s.messageId ? await this.remove(s.channelId, s.messageId) : false;
    const action = await this.apply(s.userId, s.channelId, "manual", penalty, active, "", { motivo, replyTo: removed ? undefined : s.messageId, por });
    await this.port.log({
      userId: s.userId,
      channelId: s.channelId,
      kind: `strike de ${por}`,
      detail: motivo || "strike a mano",
      excerpt: s.excerpt ?? "",
      action: `${removed ? "borrado" : s.borrar ? "no se pudo borrar" : "sin borrar"} · ${action}`,
      activeStrikes: active,
    });
    return active;
  }

  /**
   * Bloqueos de AutoMod ocurridos con el PC apagado: suma los strikes pendientes (sin silencios tardios)
   * y devuelve el resumen de Neru, o null si no hubo bloqueos.
   */
  async applyOfflineHits(hits: AutoModHit[]): Promise<string | null> {
    const relevant = hits.filter((h) => !this.exempt().has(h.userId) && !this.spared(h.userId) && !isSpamRule(h.ruleName));
    if (!relevant.length) return null;
    const flagged = new Set<string>();
    for (const h of relevant) {
      const { penalty } = this.strikes.add(
        { userId: h.userId, reason: `automod (sin conexion): ${h.ruleName}`, excerpt: h.content, channelId: h.channelId ?? undefined },
        this.now(),
      );
      if (penalty.kind === "silencio" && penalty.notifyOwner) flagged.add(h.userId);
    }
    for (const u of flagged) await this.port.notifyOwner(`<@${u}> acumuló 4 o más strikes mientras los bots estaban desconectados. Revisa #moderación.`);
    return this.phrases.pick("neru", "resumen_despertar", { n: relevant.length });
  }

  /**
   * Aplica la sancion y llama la atencion EN PUBLICO, en el mismo canal (decision de GyroP: que todos aprendan del
   * ejemplo): frase de Neru + lo que se dijo (con la groseria tapada) + en que strike va y que viene despues.
   * Devuelve la descripcion de la accion para el registro.
   */
  private async apply(
    userId: string,
    channelId: string,
    kind: ViolationKind | "manual",
    penalty: Penalty | null,
    active: number | null,
    excerpt = "",
    extra: { motivo?: string; replyTo?: string; por?: string } = {},
  ): Promise<string> {
    const papu = `<@${userId}>`;
    const silence = penalty?.kind === "silencio" ? penalty : null;
    if (silence) await this.port.timeout(userId, silence.minutes, `Neru: ${kind === "manual" ? `strike de ${extra.por ?? "GyroP"}` : kind}`).catch(() => {});
    const own = kind === "manual" ? undefined : OWN_PHRASE[kind];
    const phrase = this.phrases.pick("neru", silence ? `silencio_${silence.minutes}` : (own ?? "advertencia"), { papu });
    const lines = [phrase];
    if (kind !== "manual" && QUOTED.has(kind) && excerpt.trim()) {
      const { text, masked } = this.rules.mask(excerpt.trim().slice(0, 200));
      if (masked > 0) lines.push(`> ${text.replace(/\n/g, " ")}`);
    }
    if (extra.motivo) lines.push(`> ${extra.motivo}`);
    if (penalty && active !== null) lines.push(strikeLine(active, penalty));
    // Si el aviso no sale (p. ej. un hilo cerrado), el strike y el silencio ya estan: que igual quede en #moderacion.
    await this.port.say(channelId, lines.join("\n"), userId, extra.replyTo).catch(() => {});
    if (silence?.notifyOwner) await this.port.notifyOwner(`${papu} llegó a 4+ strikes activos (último: ${kind}). Silencio de 24 h aplicado; tú decides lo demás.`);
    return silence ? `silencio ${silence.minutes} min` : penalty ? "advertencia" : "";
  }

  /** Borra el mensaje; false si Discord no lo dejo (asi el registro no dice "borrado" cuando no lo esta). */
  private async remove(channelId: string, messageId: string): Promise<boolean> {
    return this.port.deleteMessage(channelId, messageId).then(
      () => true,
      () => false,
    );
  }
}
