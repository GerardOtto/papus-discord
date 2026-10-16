// Strikes de Neru (PLAN §7): vencen a los 3 dias. 1 = advertencia, 2 = 10 min de silencio,
// 3 = 1 h, 4+ = 24 h y aviso a GyroP. Neru NUNCA expulsa ni banea (eso lo decide GyroP).
import type { Db } from "../db/database";

export type Penalty =
  | { kind: "advertencia" }
  | { kind: "silencio"; minutes: number; notifyOwner: boolean };

export function penaltyFor(activeStrikes: number): Penalty {
  if (activeStrikes <= 1) return { kind: "advertencia" };
  if (activeStrikes === 2) return { kind: "silencio", minutes: 10, notifyOwner: false };
  if (activeStrikes === 3) return { kind: "silencio", minutes: 60, notifyOwner: false };
  return { kind: "silencio", minutes: 24 * 60, notifyOwner: true };
}

export interface StrikeInput {
  userId: string;
  reason: string;
  excerpt?: string;
  channelId?: string;
}

export class StrikeStore {
  constructor(
    private readonly db: Db,
    private readonly ttlDays = 3,
  ) {}

  /** Suma un strike y devuelve cuantos activos tiene ahora y la sancion que corresponde. */
  add(input: StrikeInput, now = Date.now()): { active: number; penalty: Penalty } {
    this.db
      .prepare(
        "INSERT INTO strikes (user_id, reason, excerpt, channel_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.userId,
        input.reason,
        input.excerpt?.slice(0, 500) ?? null,
        input.channelId ?? null,
        now,
        now + this.ttlDays * 86_400_000,
      );
    const active = this.active(input.userId, now);
    return { active, penalty: penaltyFor(active) };
  }

  active(userId: string, now = Date.now()): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM strikes WHERE user_id = ? AND expires_at > ?")
      .get(userId, now) as { n: number };
    return row.n;
  }

  /** Borra los strikes activos de un Papu (comando de GyroP para perdonar un falso positivo). */
  clear(userId: string, now = Date.now()): number {
    return Number(this.db.prepare("DELETE FROM strikes WHERE user_id = ? AND expires_at > ?").run(userId, now).changes);
  }

  prune(now = Date.now(), keepDays = 30): void {
    this.db.prepare("DELETE FROM strikes WHERE expires_at < ?").run(now - keepDays * 86_400_000);
  }
}
