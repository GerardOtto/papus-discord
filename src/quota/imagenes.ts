// Tope diario de imagenes que cada Papu le muestra a los Vocaloids (PLAN §5.1). Va aparte de la cuota de mensajes:
// la imagen ademas cuesta `cuotaExtra` mensajes (src/services/conversation.ts). Se devuelve si el Vocaloid no la vio.
import { transaction, type Db } from "../db/database";
import { dayKey } from "../time";

export class ImageAllowance {
  constructor(
    private readonly db: Db,
    readonly perDay: number,
    private readonly timeZone: string,
    /** Sin tope (GyroP). */
    private readonly unlimited: Pick<ReadonlySet<string>, "has"> = new Set(),
  ) {}

  used(userId: string, now = new Date()): number {
    const row = this.db.prepare("SELECT n FROM imagenes_dia WHERE user_id = ? AND day = ?").get(userId, dayKey(now, this.timeZone)) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** Imagenes que le quedan hoy (Infinity sin tope). */
  remaining(userId: string, now = new Date()): number {
    if (this.unlimited.has(userId)) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.perDay - this.used(userId, now));
  }

  /** Toma una imagen del dia y devuelve el dia (para poder devolverla); null si ya no le quedan. */
  take(userId: string, now = new Date()): string | null {
    const day = dayKey(now, this.timeZone);
    return transaction(this.db, () => {
      if (this.remaining(userId, now) <= 0) return null;
      this.db
        .prepare("INSERT INTO imagenes_dia (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1")
        .run(userId, day);
      return day;
    });
  }

  /** Devuelve una imagen tomada (el Vocaloid no la llego a ver). */
  refund(userId: string, day: string): void {
    this.db.prepare("UPDATE imagenes_dia SET n = MAX(0, n - 1) WHERE user_id = ? AND day = ?").run(userId, day);
  }

  prune(keepDays = 60, now = new Date()): void {
    const cutoff = dayKey(new Date(now.getTime() - keepDays * 86_400_000), this.timeZone);
    this.db.prepare("DELETE FROM imagenes_dia WHERE day < ?").run(cutoff);
  }
}
