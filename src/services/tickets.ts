// Tickets de #reportes-y-reclamos: cada Papu abre uno con /reporte y Neru le crea un hilo privado (solo el Papu y
// GyroP). Un aviso a GyroP por ticket (no por mensaje), un ticket abierto por Papu y un máximo por día, para que el
// canal no se vuelva un chat ni una lluvia de notificaciones.
import { kvDelete, kvGet, kvSet, type Db } from "../db/database";

export const MAX_TICKETS_PER_DAY = 3;

export type OpenCheck = { ok: true } | { ok: false; reason: "abierto"; threadId: string } | { ok: false; reason: "limite" };

export class TicketStore {
  constructor(private readonly db: Db) {}

  /** Ticket abierto del Papu (id del hilo), o null. */
  openFor(userId: string): string | null {
    return kvGet(this.db, `ticket:papu:${userId}`);
  }

  /**
   * ¿Puede abrir uno? `isLive` dice si el hilo del ticket anterior sigue abierto en Discord (si se archivó o se
   * borró, el ticket cuenta como cerrado).
   */
  canOpen(userId: string, day: string, isLive: (threadId: string) => boolean): OpenCheck {
    const open = this.openFor(userId);
    if (open) {
      if (isLive(open)) return { ok: false, reason: "abierto", threadId: open };
      this.close(open);
    }
    if (this.countOn(userId, day) >= MAX_TICKETS_PER_DAY) return { ok: false, reason: "limite" };
    return { ok: true };
  }

  /** Reserva el número del próximo ticket (correlativo, empieza en 1). */
  nextNumber(): number {
    const n = Number(kvGet(this.db, "ticket:n") ?? 0) + 1;
    kvSet(this.db, "ticket:n", String(n));
    return n;
  }

  /** Registra el ticket ya creado en Discord. */
  opened(userId: string, threadId: string, day: string): void {
    kvSet(this.db, `ticket:papu:${userId}`, threadId);
    kvSet(this.db, `ticket:hilo:${threadId}`, userId);
    kvSet(this.db, `ticket:dia:${userId}`, `${day}:${this.countOn(userId, day) + 1}`);
  }

  /** Papu dueño de un hilo de ticket, o null si el hilo no es un ticket. */
  ownerOf(threadId: string): string | null {
    return kvGet(this.db, `ticket:hilo:${threadId}`);
  }

  /** Cierra el ticket de un hilo; devuelve el Papu dueño, o null si no era un ticket. */
  close(threadId: string): string | null {
    const userId = this.ownerOf(threadId);
    if (!userId) return null;
    kvDelete(this.db, `ticket:hilo:${threadId}`);
    if (this.openFor(userId) === threadId) kvDelete(this.db, `ticket:papu:${userId}`);
    return userId;
  }

  private countOn(userId: string, day: string): number {
    const [d, n] = (kvGet(this.db, `ticket:dia:${userId}`) ?? "").split(":");
    return d === day ? Number(n) : 0;
  }
}
