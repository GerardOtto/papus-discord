// Cuota diaria unica por Papu, compartida entre los 4 bots e igual para todos los niveles (regla 1).
// Una unidad por cada @ a un bot. Se reserva al recibir la mencion y se devuelve si el Papu
// no recibe respuesta del LLM (espera maxima superada o todas las APIs caidas).
import { transaction, type Db } from "../db/database";
import { dayKey } from "../time";

export interface Reservation {
  userId: string;
  day: string;
  /** Unidades concedidas (puede ser menos que las pedidas si no alcanzaba). */
  units: number;
}

export class Quota {
  constructor(
    private readonly db: Db,
    private readonly dailyLimit: number,
    private readonly timeZone: string,
    /** Usuarios sin limite (solo GyroP, para probar). Pagar NO da exencion. */
    private readonly unlimited: ReadonlySet<string> = new Set(),
  ) {}

  get limit(): number {
    return this.dailyLimit;
  }

  used(userId: string, now = new Date()): number {
    const row = this.db
      .prepare("SELECT used FROM quota_usage WHERE user_id = ? AND day = ?")
      .get(userId, dayKey(now, this.timeZone)) as { used: number } | undefined;
    return row?.used ?? 0;
  }

  remaining(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.dailyLimit - this.used(userId, now));
  }

  /** Reserva hasta `units` unidades; devuelve cuantas se concedieron (los primeros @ del mensaje). */
  reserve(userId: string, units: number, now = new Date()): Reservation {
    const day = dayKey(now, this.timeZone);
    if (units <= 0) return { userId, day, units: 0 };
    if (this.unlimited.has(userId)) return { userId, day, units };
    return transaction(this.db, () => {
      const granted = Math.min(units, this.remaining(userId, now));
      if (granted > 0) {
        this.db
          .prepare(
            `INSERT INTO quota_usage (user_id, day, used) VALUES (?, ?, ?)
             ON CONFLICT(user_id, day) DO UPDATE SET used = used + excluded.used`,
          )
          .run(userId, day, granted);
      }
      return { userId, day, units: granted };
    });
  }

  /** Devuelve unidades de una reserva (al dia en que se reservaron). */
  refund(res: Reservation, units = res.units): void {
    const n = Math.min(units, res.units);
    if (n <= 0 || this.unlimited.has(res.userId)) return;
    this.db
      .prepare("UPDATE quota_usage SET used = MAX(0, used - ?) WHERE user_id = ? AND day = ?")
      .run(n, res.userId, res.day);
  }

  /** Borra registros de dias viejos (mantenimiento). */
  prune(keepDays = 60, now = new Date()): void {
    const cutoff = dayKey(new Date(now.getTime() - keepDays * 86_400_000), this.timeZone);
    this.db.prepare("DELETE FROM quota_usage WHERE day < ?").run(cutoff);
  }
}
