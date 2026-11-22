// Cuota diaria por Papu, compartida entre todos los bots, en dos espacios (pedido de GyroP, 14 nov. 2026):
// - DIARIO: depende solo del nivel por participacion (src/levels/); nada de pago lo cambia (regla 1). Lo rellenan la
//   ruleta, el sorteo y los reinicios, sin pasar de su limite.
// - DONADOS: lo que regalan otros Papus con /donar, con su propio tope (`donatedCap`, config/niveles.json). Lo que llega
//   por /intercambio entra en cualquier espacio libre: primero el diario, despues el de donados.
// Una unidad por cada @ a un bot: se gastan primero los diarios y despues los donados. Se reserva al recibir la mencion y
// se devuelve si el Papu no recibe respuesta del LLM (espera maxima superada o todas las APIs caidas). Solo se dona de
// la cuota diaria (asi lo regalado no se vuelve a regalar).
import { transaction, type Db } from "../db/database";
import { dayKey } from "../time";

export interface Reservation {
  userId: string;
  day: string;
  /** Unidades concedidas (puede ser menos que las pedidas si no alcanzaba). Baja al devolverlas. */
  units: number;
  /** Cuantas de `units` salieron del espacio de donados (se devuelven primero). */
  fromDonated: number;
}

/** Tope del espacio de donados si no se indica otro (config/niveles.json, donadosMax). */
export const DEFAULT_DONATED_CAP = 5;

/** Donde entra lo que recibe un Papu: /donar solo en donados; /intercambio en cualquier espacio libre. */
export type Destino = "donados" | "cualquiera";

interface Row {
  used: number;
  extra: number;
  donadas: number;
  recibidas: number;
  gastadas_rec: number;
}

const EMPTY: Row = { used: 0, extra: 0, donadas: 0, recibidas: 0, gastadas_rec: 0 };

export class Quota {
  constructor(
    private readonly db: Db,
    /** Limite diario: fijo, o por Papu segun su nivel (LevelService.limitFor). */
    private readonly dailyLimit: number | ((userId: string, now: Date) => number),
    private readonly timeZone: string,
    /** Usuarios sin limite (GyroP y el Papu especial que el elija en config/especiales.json). Pagar NO da exencion. */
    private readonly unlimited: Pick<ReadonlySet<string>, "has"> = new Set(),
    /** Tope del espacio de donados. */
    readonly donatedCap: number = DEFAULT_DONATED_CAP,
  ) {}

  private row(userId: string, day: string): Row {
    return (this.db.prepare("SELECT used, extra, donadas, recibidas, gastadas_rec FROM quota_usage WHERE user_id = ? AND day = ?").get(userId, day) as Row | undefined) ?? EMPTY;
  }

  private today(userId: string, now: Date): Row {
    return this.row(userId, dayKey(now, this.timeZone));
  }

  /** Limite diario de un Papu (Infinity si no tiene limite). */
  limitFor(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return Number.POSITIVE_INFINITY;
    return typeof this.dailyLimit === "number" ? this.dailyLimit : this.dailyLimit(userId, now);
  }

  /** Gastado hoy del espacio diario (incluye lo donado a otros). */
  used(userId: string, now = new Date()): number {
    return this.today(userId, now).used;
  }

  /** Lo que el Papu uso hoy con los Vocaloids, de los dos espacios (sin contar lo que dono). */
  spent(userId: string, now = new Date()): number {
    const r = this.today(userId, now);
    return r.used - r.donadas + r.gastadas_rec;
  }

  /** Mensajes que rellenaron hoy el espacio diario (ruleta, sorteo, intercambios). */
  extra(userId: string, now = new Date()): number {
    return this.today(userId, now).extra;
  }

  /** Premio de la ruleta: `units` mensajes mas solo por hoy, en el espacio diario. */
  addExtra(userId: string, units: number, now = new Date()): void {
    if (units <= 0) return;
    this.db
      .prepare("INSERT INTO quota_usage (user_id, day, used, extra) VALUES (?, ?, 0, ?) ON CONFLICT(user_id, day) DO UPDATE SET extra = extra + excluded.extra")
      .run(userId, dayKey(now, this.timeZone), units);
  }

  /**
   * Lo que le queda hoy del espacio diario (Infinity sin limite). Puede pasar de su limite tras un reinicio (boda, PC):
   * el reinicio devuelve lo gastado y conserva los extra ya ganados.
   */
  dailyLeft(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return Number.POSITIVE_INFINITY;
    const r = this.today(userId, now);
    return Math.max(0, this.limitFor(userId, now) + r.extra - r.used);
  }

  /** Lo que le queda hoy del espacio de donados (0 sin limite: no lo necesita). */
  donatedLeft(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return 0;
    const r = this.today(userId, now);
    return Math.max(0, r.recibidas - r.gastadas_rec);
  }

  remaining(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return Number.POSITIVE_INFINITY;
    return this.dailyLeft(userId, now) + this.donatedLeft(userId, now);
  }

  /**
   * Cuantos mensajes ganados le caben hoy en el espacio diario: hasta volver a su limite (decision de GyroP, 31 oct.
   * 2026). Con el diario lleno (o sin limite), 0: lo que gane de mas se le cambia por XP.
   */
  room(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return 0;
    return Math.max(0, this.limitFor(userId, now) - this.dailyLeft(userId, now));
  }

  /** Cuantos donados le caben hoy (hasta `donatedCap` sin usar). */
  donatedRoom(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return 0;
    return Math.max(0, this.donatedCap - this.donatedLeft(userId, now));
  }

  /** Lo que le cabe segun el destino: /donar solo en donados, /intercambio en los dos espacios. */
  roomFor(userId: string, destino: Destino, now = new Date()): number {
    return destino === "donados" ? this.donatedRoom(userId, now) : this.room(userId, now) + this.donatedRoom(userId, now);
  }

  /**
   * Mensajes ganados (ruleta, sorteo): se suman al espacio diario sin pasar de su limite. `overflow` = los que no
   * cupieron (el que llama los cambia por XP).
   */
  grant(userId: string, units: number, now = new Date()): { added: number; overflow: number } {
    if (units <= 0) return { added: 0, overflow: 0 };
    return transaction(this.db, () => {
      const added = Math.min(units, this.room(userId, now));
      this.addExtra(userId, added, now);
      return { added, overflow: units - added };
    });
  }

  /**
   * Un Papu le cede `units` de sus mensajes diarios de hoy a otro (los pierde el; solo de su espacio diario). Con
   * /donar (destino "donados") entran al espacio de donados del otro; con /intercambio ("cualquiera"), primero a su
   * espacio diario libre y lo demas a donados. Quien no tiene limite no dona (su regalo es solo suyo, regla 1).
   */
  donate(
    fromId: string,
    toId: string,
    units: number,
    now = new Date(),
    destino: Destino = "donados",
  ): { ok: true; units: number } | { ok: false; motivo: "sin_limite" | "no_alcanza" | "llena" } {
    if (this.unlimited.has(fromId)) return { ok: false, motivo: "sin_limite" };
    if (this.unlimited.has(toId)) return { ok: false, motivo: "llena" };
    return transaction(this.db, () => {
      if (units <= 0 || this.dailyLeft(fromId, now) < units) return { ok: false as const, motivo: "no_alcanza" as const };
      if (this.roomFor(toId, destino, now) < units) return { ok: false as const, motivo: "llena" as const };
      const day = dayKey(now, this.timeZone);
      this.db
        .prepare(
          `INSERT INTO quota_usage (user_id, day, used, donadas) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, day) DO UPDATE SET used = used + excluded.used, donadas = donadas + excluded.donadas`,
        )
        .run(fromId, day, units, units);
      const toDaily = destino === "cualquiera" ? Math.min(units, this.room(toId, now)) : 0;
      this.addExtra(toId, toDaily, now);
      if (units > toDaily) {
        this.db
          .prepare("INSERT INTO quota_usage (user_id, day, recibidas) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET recibidas = recibidas + excluded.recibidas")
          .run(toId, day, units - toDaily);
      }
      return { ok: true as const, units };
    });
  }

  /** Mensajes que el Papu dono hoy (incluidos en `used`). */
  donated(userId: string, now = new Date()): number {
    return this.today(userId, now).donadas;
  }

  /** Reserva hasta `units` unidades: primero del espacio diario y despues del de donados (los primeros @ del mensaje). */
  reserve(userId: string, units: number, now = new Date()): Reservation {
    const day = dayKey(now, this.timeZone);
    if (units <= 0) return { userId, day, units: 0, fromDonated: 0 };
    if (this.unlimited.has(userId)) return { userId, day, units, fromDonated: 0 };
    return transaction(this.db, () => {
      const daily = Math.min(units, this.dailyLeft(userId, now));
      const fromDonated = Math.min(units - daily, this.donatedLeft(userId, now));
      if (daily + fromDonated > 0) {
        this.db
          .prepare(
            `INSERT INTO quota_usage (user_id, day, used, gastadas_rec) VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, day) DO UPDATE SET used = used + excluded.used, gastadas_rec = gastadas_rec + excluded.gastadas_rec`,
          )
          .run(userId, day, daily, fromDonated);
      }
      return { userId, day, units: daily + fromDonated, fromDonated };
    });
  }

  /** Devuelve unidades de una reserva (al dia en que se reservaron); primero las de donados. Se puede llamar por partes. */
  refund(res: Reservation, units = res.units): void {
    const n = Math.min(units, res.units);
    if (n <= 0) return;
    const fromDonated = Math.min(n, res.fromDonated);
    res.units -= n;
    res.fromDonated -= fromDonated;
    if (this.unlimited.has(res.userId)) return;
    this.db
      .prepare("UPDATE quota_usage SET used = MAX(0, used - ?), gastadas_rec = MAX(0, gastadas_rec - ?) WHERE user_id = ? AND day = ?")
      .run(n - fromDonated, fromDonated, res.userId, res.day);
  }

  /**
   * Reinicio de la cuota (/reiniciar-cuota de GyroP, boda, PC de Adachi Rei, "cuota llena" de la ruleta): devuelve lo
   * gastado HOY por un Papu o por todos, en los dos espacios; los mensajes extra se conservan y lo donado con /donar no
   * vuelve. Devuelve a cuantos Papus se les devolvieron mensajes.
   */
  reset(userId: string | null = null, now = new Date()): number {
    const day = dayKey(now, this.timeZone);
    const set = "UPDATE quota_usage SET used = donadas, gastadas_rec = 0 WHERE day = ? AND (used > donadas OR gastadas_rec > 0)";
    const res = userId ? this.db.prepare(`${set} AND user_id = ?`).run(day, userId) : this.db.prepare(set).run(day);
    return Number(res.changes);
  }

  /** Borra registros de dias viejos (mantenimiento). */
  prune(keepDays = 60, now = new Date()): void {
    const cutoff = dayKey(new Date(now.getTime() - keepDays * 86_400_000), this.timeZone);
    this.db.prepare("DELETE FROM quota_usage WHERE day < ?").run(cutoff);
  }
}
