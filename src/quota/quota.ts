// Cuota diaria por Papu, compartida entre todos los bots. Depende solo del nivel por participacion (src/levels/):
// nada de pago la cambia (regla 1). Una unidad por cada @ a un bot. Se reserva al recibir la mencion y se devuelve si el Papu
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
    /** Limite diario: fijo, o por Papu segun su nivel (LevelService.limitFor). */
    private readonly dailyLimit: number | ((userId: string, now: Date) => number),
    private readonly timeZone: string,
    /** Usuarios sin limite (GyroP y el Papu especial que el elija en config/especiales.json). Pagar NO da exencion. */
    private readonly unlimited: Pick<ReadonlySet<string>, "has"> = new Set(),
  ) {}

  /** Limite diario de un Papu (Infinity si no tiene limite). */
  limitFor(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return Number.POSITIVE_INFINITY;
    return typeof this.dailyLimit === "number" ? this.dailyLimit : this.dailyLimit(userId, now);
  }

  used(userId: string, now = new Date()): number {
    const row = this.db
      .prepare("SELECT used FROM quota_usage WHERE user_id = ? AND day = ?")
      .get(userId, dayKey(now, this.timeZone)) as { used: number } | undefined;
    return row?.used ?? 0;
  }

  /** Mensajes extra de hoy ganados en la ruleta (src/ruleta/): se suman al limite solo ese dia. */
  extra(userId: string, now = new Date()): number {
    const row = this.db
      .prepare("SELECT extra FROM quota_usage WHERE user_id = ? AND day = ?")
      .get(userId, dayKey(now, this.timeZone)) as { extra: number } | undefined;
    return row?.extra ?? 0;
  }

  /** Premio de la ruleta: `units` mensajes mas solo por hoy. */
  addExtra(userId: string, units: number, now = new Date()): void {
    if (units <= 0) return;
    this.db
      .prepare("INSERT INTO quota_usage (user_id, day, used, extra) VALUES (?, ?, 0, ?) ON CONFLICT(user_id, day) DO UPDATE SET extra = extra + excluded.extra")
      .run(userId, dayKey(now, this.timeZone), units);
  }

  remaining(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.limitFor(userId, now) + this.extra(userId, now) - this.used(userId, now));
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

  /**
   * Reinicio de la cuota (/reiniciar-cuota de GyroP, boda, "cuota llena" de la ruleta): devuelve lo gastado HOY por un
   * Papu o por todos; los mensajes extra de la ruleta se conservan. Devuelve a cuantos Papus se les devolvieron mensajes.
   */
  reset(userId: string | null = null, now = new Date()): number {
    const day = dayKey(now, this.timeZone);
    const res = userId
      ? this.db.prepare("UPDATE quota_usage SET used = 0 WHERE day = ? AND user_id = ? AND used > 0").run(day, userId)
      : this.db.prepare("UPDATE quota_usage SET used = 0 WHERE day = ? AND used > 0").run(day);
    return Number(res.changes);
  }

  /** Borra registros de dias viejos (mantenimiento). */
  prune(keepDays = 60, now = new Date()): void {
    const cutoff = dayKey(new Date(now.getTime() - keepDays * 86_400_000), this.timeZone);
    this.db.prepare("DELETE FROM quota_usage WHERE day < ?").run(cutoff);
  }
}
