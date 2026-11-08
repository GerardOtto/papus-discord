// Machetazos de Neru (PLAN §7; decision de GyroP, 28 oct. 2026, antes "strikes"). Vencen a los 3 dias, igual que las
// advertencias (/advertir); 3 advertencias activas = 1 machetazo. Cada machetazo borra el mensaje y quita la XP del dia:
// 1 = 10 min de silencio; 2 = 1 h y sin ganar XP; 3+ = 24 h, sin ganar XP y aviso a GyroP. Neru NUNCA expulsa ni banea
// (eso lo decide GyroP). Perdonar borra machetazos y advertencias y devuelve la XP quitada.
import type { Db } from "../db/database";

export interface Penalty {
  minutes: number;
  /** Sin ganar XP de ninguna forma mientras siga con 2 o mas machetazos activos. */
  blockXp: boolean;
  notifyOwner: boolean;
}

/** Advertencias activas que se vuelven un machetazo. */
export const WARNINGS_PER_MACHETAZO = 3;
/** Machetazos activos desde los que no se gana XP. */
export const XP_BLOCK_AT = 2;
export const MAX_MACHETAZOS = 3;

export function penaltyFor(active: number): Penalty {
  if (active <= 1) return { minutes: 10, blockXp: false, notifyOwner: false };
  if (active === 2) return { minutes: 60, blockXp: true, notifyOwner: false };
  return { minutes: 24 * 60, blockXp: true, notifyOwner: true };
}

export interface StrikeInput {
  userId: string;
  reason: string;
  excerpt?: string;
  channelId?: string;
}

/** XP que un machetazo le quito a un dia (para devolverla al perdonar). */
export interface XpTaken {
  day: string;
  xp: number;
}

export interface Machetazo {
  active: number;
  penalty: Penalty;
}

export class StrikeStore {
  /** Aviso a los niveles con cada machetazo nuevo: quitan la XP del dia y devuelven cuanta fue. */
  onAdd: ((userId: string, now: number) => XpTaken | null | void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly ttlDays = 3,
  ) {}

  private insert(kind: "machetazo" | "advertencia", input: StrikeInput, now: number): number {
    const r = this.db
      .prepare(
        "INSERT INTO strikes (user_id, reason, excerpt, channel_id, created_at, expires_at, tipo) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(input.userId, input.reason, input.excerpt?.slice(0, 500) ?? null, input.channelId ?? null, now, now + this.ttlDays * 86_400_000, kind);
    return Number(r.lastInsertRowid);
  }

  private count(kind: "machetazo" | "advertencia", userId: string, now: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM strikes WHERE user_id = ? AND tipo = ? AND expires_at > ?")
      .get(userId, kind, now) as { n: number };
    return row.n;
  }

  /** Suma un machetazo y devuelve cuantos activos tiene ahora y la sancion que corresponde. */
  add(input: StrikeInput, now = Date.now()): Machetazo {
    const id = this.insert("machetazo", input, now);
    const taken = this.onAdd?.(input.userId, now);
    if (taken) this.db.prepare("UPDATE strikes SET xp_quitada = ?, dia = ? WHERE id = ?").run(taken.xp, taken.day, id);
    const active = this.active(input.userId, now);
    return { active, penalty: penaltyFor(active) };
  }

  /**
   * Suma una advertencia. A la tercera activa, las tres se cambian por un machetazo (`machetazo` no es null). Devuelve
   * las advertencias activas (3 cuando se volvieron machetazo).
   */
  warn(input: StrikeInput, now = Date.now()): { warnings: number; machetazo: Machetazo | null } {
    this.insert("advertencia", input, now);
    const warnings = this.warnings(input.userId, now);
    if (warnings < WARNINGS_PER_MACHETAZO) return { warnings, machetazo: null };
    this.db.prepare("DELETE FROM strikes WHERE user_id = ? AND tipo = 'advertencia' AND expires_at > ?").run(input.userId, now);
    return { warnings, machetazo: this.add({ ...input, reason: `${WARNINGS_PER_MACHETAZO} advertencias: ${input.reason}` }, now) };
  }

  /** Machetazos activos. */
  active(userId: string, now = Date.now()): number {
    return this.count("machetazo", userId, now);
  }

  /** Advertencias activas (las que todavia no se volvieron machetazo). */
  warnings(userId: string, now = Date.now()): number {
    return this.count("advertencia", userId, now);
  }

  /** Con 2 o mas machetazos activos no se gana XP de ninguna forma. */
  xpBlocked(userId: string, now = Date.now()): boolean {
    return this.active(userId, now) >= XP_BLOCK_AT;
  }

  /**
   * Perdon de GyroP: borra los machetazos y advertencias activos y devuelve cuantos eran y la XP que esos machetazos
   * quitaron (por dia, tambien los dias con 0: se les levanta el castigo), para devolverla.
   */
  clear(userId: string, now = Date.now()): { machetazos: number; advertencias: number; xp: XpTaken[] } {
    const machetazos = this.active(userId, now);
    const advertencias = this.warnings(userId, now);
    const xp = this.db
      .prepare("SELECT dia AS day, SUM(xp_quitada) AS xp FROM strikes WHERE user_id = ? AND tipo = 'machetazo' AND expires_at > ? AND dia IS NOT NULL GROUP BY dia")
      .all(userId, now) as unknown as XpTaken[];
    this.db.prepare("DELETE FROM strikes WHERE user_id = ? AND expires_at > ?").run(userId, now);
    return { machetazos, advertencias, xp };
  }

  prune(now = Date.now(), keepDays = 30): void {
    this.db.prepare("DELETE FROM strikes WHERE expires_at < ?").run(now - keepDays * 86_400_000);
  }
}
