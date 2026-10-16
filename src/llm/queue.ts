// Cola de peticiones al LLM para los picos (PLAN §5): orden de llegada igual para todos (sin prioridad
// por pagar), una peticion pendiente por Papu y espera maxima: si se supera, se cancela y no se cobra.

export type QueueResult<T> =
  | { status: "ok"; value: T }
  /** El Papu ya tenia una peticion en la cola. */
  | { status: "busy" }
  /** Se supero la espera maxima (frase de "hay mucha gente"; sin cobro). */
  | { status: "timeout" }
  | { status: "error"; error: unknown };

interface Job<T> {
  userId: string;
  deadline: number;
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (r: QueueResult<T>) => void;
  expiry?: ReturnType<typeof setTimeout>;
}

export interface QueueOptions {
  /** Peticiones simultaneas al LLM. */
  concurrency: number;
  maxWaitMs: number;
  now?: () => number;
}

export class RequestQueue {
  private readonly waiting: Job<unknown>[] = [];
  private readonly pendingUsers = new Set<string>();
  private active = 0;
  private readonly now: () => number;

  constructor(private readonly opts: QueueOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Peticiones en espera (sin contar las que ya se estan procesando). */
  get length(): number {
    return this.waiting.length;
  }

  get inFlight(): number {
    return this.active;
  }

  hasPending(userId: string): boolean {
    return this.pendingUsers.has(userId);
  }

  enqueue<T>(userId: string, run: (signal: AbortSignal) => Promise<T>): Promise<QueueResult<T>> {
    if (this.pendingUsers.has(userId)) return Promise.resolve({ status: "busy" });
    this.pendingUsers.add(userId);
    return new Promise<QueueResult<T>>((resolve) => {
      const job = { userId, deadline: this.now() + this.opts.maxWaitMs, run, resolve } as Job<unknown>;
      this.waiting.push(job);
      // Si sigue esperando al vencer el plazo (todos los cupos ocupados), sale de la cola sin cobro.
      job.expiry = setTimeout(() => {
        const i = this.waiting.indexOf(job);
        if (i >= 0) {
          this.waiting.splice(i, 1);
          this.finish(job, { status: "timeout" });
        }
      }, this.opts.maxWaitMs);
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.opts.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      const remaining = job.deadline - this.now();
      if (remaining <= 0) {
        this.finish(job, { status: "timeout" });
        continue;
      }
      this.active++;
      const controller = new AbortController();
      // Al vencer el plazo el Papu recibe su respuesta de inmediato, aunque la API no haya soltado la
      // peticion; el cupo se libera cuando la peticion termine (los proveedores respetan el AbortSignal).
      const timer = setTimeout(() => {
        controller.abort();
        this.finish(job, { status: "timeout" });
      }, remaining);
      job
        .run(controller.signal)
        .then(
          (value) => ({ status: "ok" as const, value }),
          (error: unknown) => ({ status: "error" as const, error }),
        )
        .then((r) => {
          clearTimeout(timer);
          this.active--;
          if (!controller.signal.aborted) this.finish(job, r);
          this.pump();
        });
    }
  }

  private finish(job: Job<unknown>, r: QueueResult<unknown>): void {
    clearTimeout(job.expiry);
    this.pendingUsers.delete(job.userId);
    job.resolve(r);
  }
}
