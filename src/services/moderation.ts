// Moderacion de Neru (PLAN §7): reglas fijas -> borrar -> strike -> sancion -> aviso en el canal y en #moderacion.
// Neru nunca expulsa ni banea; GyroP queda exento. Tambien aplica los strikes de los bloqueos de AutoMod.
import type { Phrases } from "../phrases/catalog";
import { DuplicateTracker, FloodTracker, type RuleSet, type Violation, type ViolationKind } from "../moderation/rules";
import type { Penalty, StrikeStore } from "../moderation/strikes";

export interface ModMessage {
  messageId: string;
  channelId: string;
  authorId: string;
  text: string;
  targetsSomeone: boolean;
  memberAgeHours: number;
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
  /** Neru escribe en un canal. */
  say(channelId: string, content: string, pingUserId: string | null): Promise<void>;
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
/** Infracciones con frase propia (explican la regla); si ademas toca silencio, manda la del silencio. */
const OWN_PHRASE: Partial<Record<ViolationKind, string>> = {
  datos_personales: "datos_personales",
  invitacion: "datos_personales",
  estafa: "estafa",
  flood: "flood",
  repetido: "flood",
  enlace_cuenta_nueva: "enlace_cuenta_nueva",
  mayusculas: "mayusculas",
};

export class ModerationService {
  private readonly flood: FloodTracker;
  private readonly dupes: DuplicateTracker;
  private readonly capsWarned = new Map<string, number>();

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
    this.dupes = new DuplicateTracker(l.repetidoVeces, l.repetidoSegundos * 1000);
  }

  /** Revisa un mensaje. Devuelve la infraccion aplicada (null si esta bien). Si `remove`, el mensaje ya no existe. */
  async handle(m: ModMessage): Promise<Violation | null> {
    if (this.exempt().has(m.authorId)) return null;
    const t = this.now();
    let v = this.rules.check(m);
    if (!v || !v.remove) {
      if (this.flood.hit(m.authorId, t)) v = { kind: "flood", remove: true, strike: true, detail: "flood" };
      else if (this.dupes.hit(m.authorId, m.text, t)) v = { kind: "repetido", remove: true, strike: true, detail: "mensaje repetido" };
    }
    if (!v) return null;

    const papu = `<@${m.authorId}>`;
    if (v.kind === "mayusculas") {
      const last = this.capsWarned.get(m.authorId);
      if (last !== undefined && t - last < CAPS_COOLDOWN_MS) return null;
      this.capsWarned.set(m.authorId, t);
      await this.port.say(m.channelId, this.phrases.pick("neru", "mayusculas", { papu }), m.authorId);
      return v;
    }

    if (v.remove) await this.port.deleteMessage(m.channelId, m.messageId).catch(() => {});
    let penalty: Penalty | null = null;
    let active: number | null = null;
    if (v.strike) {
      const r = this.strikes.add({ userId: m.authorId, reason: v.kind, excerpt: m.text, channelId: m.channelId }, t);
      penalty = r.penalty;
      active = r.active;
    }
    const action = await this.apply(m.authorId, m.channelId, v.kind, penalty);
    await this.port.log({
      userId: m.authorId,
      channelId: m.channelId,
      kind: v.kind,
      detail: v.detail,
      excerpt: m.text,
      action: `${v.remove ? "borrado" : "sin borrar"}${action ? ` · ${action}` : ""}`,
      activeStrikes: active,
    });
    return v;
  }

  /** Bloqueo de AutoMod visto en vivo: Neru lo publica como suyo y suma el strike. */
  async handleAutoModHit(hit: AutoModHit): Promise<void> {
    if (this.exempt().has(hit.userId)) return;
    const { penalty, active } = this.strikes.add(
      { userId: hit.userId, reason: `automod: ${hit.ruleName}`, excerpt: hit.content, channelId: hit.channelId ?? undefined },
      this.now(),
    );
    const kind: ViolationKind = /dato|estafa/i.test(hit.ruleName) ? "datos_personales" : "insulto";
    const action = hit.channelId ? await this.apply(hit.userId, hit.channelId, kind, penalty) : "";
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
   * Bloqueos de AutoMod ocurridos con el PC apagado: suma los strikes pendientes (sin silencios tardios)
   * y devuelve el resumen de Neru, o null si no hubo bloqueos.
   */
  async applyOfflineHits(hits: AutoModHit[]): Promise<string | null> {
    const relevant = hits.filter((h) => !this.exempt().has(h.userId));
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

  /** Aplica la sancion y publica la frase de Neru. Devuelve la descripcion de la accion para el registro. */
  private async apply(userId: string, channelId: string, kind: ViolationKind, penalty: Penalty | null): Promise<string> {
    const papu = `<@${userId}>`;
    if (penalty?.kind === "silencio") {
      await this.port.timeout(userId, penalty.minutes, `Neru: ${kind}`).catch(() => {});
      await this.port.say(channelId, this.phrases.pick("neru", `silencio_${penalty.minutes}`, { papu }), userId);
      if (penalty.notifyOwner) await this.port.notifyOwner(`${papu} llegó a 4+ strikes activos (último: ${kind}). Silencio de 24 h aplicado; tú decides lo demás.`);
      return `silencio ${penalty.minutes} min`;
    }
    const group = OWN_PHRASE[kind] ?? "advertencia";
    await this.port.say(channelId, this.phrases.pick("neru", group, { papu }), userId);
    return penalty ? "advertencia" : "";
  }
}
