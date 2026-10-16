// Reparto entre el modelo local y las APIs gratuitas (regla 5: alternar segun la necesidad, sin depender de uno):
// - el local va primero (gratis, sin limite diario, los mensajes no salen del PC), salvo que la tarjeta este ocupada
//   por otra cosa (render, juegos) o ya este respondiendo a otro Papu: entonces pasa al final y responde una API;
// - las APIs se ordenan por lo que les queda del dia, para repartir el consumo entre los cuatro planes gratis.
import { execFile } from "node:child_process";
import type { LLMProvider } from "./provider";

export interface GpuSample {
  /** Uso de la tarjeta en %. */
  utilization: number;
}

/** Lee el uso de la GPU con nvidia-smi (null si no hay tarjeta NVIDIA o falla). */
export function nvidiaSmiSampler(): () => Promise<GpuSample | null> {
  return () =>
    new Promise((resolve) => {
      execFile("nvidia-smi", ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"], { timeout: 5000, windowsHide: true }, (err, out) => {
        const n = Number(String(out).trim().split(/\r?\n/)[0]);
        resolve(err || !Number.isFinite(n) ? null : { utilization: n });
      });
    });
}

export interface GpuMonitorOptions {
  intervalMs?: number;
  /** Uso a partir del cual la tarjeta se considera ocupada por otra cosa. */
  busyUtilization?: number;
  /** Tras una respuesta del modelo local se ignoran las lecturas un rato (el uso alto era nuestro). */
  ownActivityGraceMs?: number;
  now?: () => number;
}

export class GpuMonitor {
  private last: GpuSample | null = null;
  private lastAt = 0;
  private ownUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly busyUtil: number;
  private readonly grace: number;
  private readonly now: () => number;

  constructor(
    private readonly sample: () => Promise<GpuSample | null>,
    private readonly opts: GpuMonitorOptions = {},
  ) {
    this.busyUtil = opts.busyUtilization ?? 40;
    this.grace = opts.ownActivityGraceMs ?? 8000;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.opts.intervalMs ?? 15_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    const s = await this.sample();
    // Lecturas tomadas mientras (o justo despues de que) el modelo local trabajaba no cuentan: el uso era nuestro.
    if (s && this.now() >= this.ownUntil) {
      this.last = s;
      this.lastAt = this.now();
    }
  }

  /** El modelo local empieza o termina de responder. */
  noteLocalActivity(): void {
    this.ownUntil = this.now() + this.grace;
  }

  /** La tarjeta esta ocupada por otro programa (lectura reciente con uso alto). */
  get busy(): boolean {
    if (!this.last || this.now() - this.lastAt > 60_000) return false;
    return this.last.utilization >= this.busyUtil;
  }
}

export interface RouterOptions {
  /** Nombre del proveedor local en config/llm.json. */
  local?: string;
  /** Respuestas simultaneas del modelo local; las demas van a las APIs en vez de esperar en fila. */
  localMaxInFlight?: number;
  gpu?: Pick<GpuMonitor, "busy" | "noteLocalActivity">;
  /** Fraccion del limite diario que le queda a cada API (1 = intacto). */
  remaining?: (provider: string) => number;
  /**
   * "local" (por defecto): el modelo local primero y las APIs de respaldo.
   * "apis": las APIs se turnan (cada peticion a la que le queda mas cupo del dia; a igual cupo, la que se uso hace mas
   * tiempo) y el local queda de respaldo (APIs caidas, limitadas por minuto o sin cupo del dia).
   */
  prefer?: "local" | "apis";
  now?: () => number;
}

export class SmartRouter {
  private readonly inFlight = new Map<string, number>();
  private readonly lastUsed = new Map<string, number>();
  private seq = 0;
  readonly local: string;

  constructor(private readonly opts: RouterOptions = {}) {
    this.local = opts.local ?? "local";
  }

  /** Orden en que se prueban los proveedores disponibles para esta peticion. */
  order(available: LLMProvider[]): LLMProvider[] {
    const local = available.filter((p) => p.name === this.local);
    if (this.opts.prefer === "apis") {
      const left = (p: LLMProvider) => this.opts.remaining?.(p.name) ?? 1;
      const apis = available
        .filter((p) => p.name !== this.local)
        .sort((a, b) => left(b) - left(a) || (this.lastUsed.get(a.name) ?? 0) - (this.lastUsed.get(b.name) ?? 0));
      // Las que ya gastaron su cupo del dia van despues del local (por si el limite estimado es mas alto que el real).
      return [...apis.filter((p) => left(p) > 0), ...local, ...apis.filter((p) => left(p) <= 0)];
    }
    // Las APIs, de la que mas le queda a la que menos (en tramos del 10 %, para no saltar entre ellas por una peticion);
    // a igual tramo se respeta el orden de config/llm.json.
    const bucket = (p: LLMProvider) => Math.floor((this.opts.remaining?.(p.name) ?? 1) * 10);
    const apis = available
      .filter((p) => p.name !== this.local)
      .map((p, i) => ({ p, i, b: bucket(p) }))
      .sort((a, b) => b.b - a.b || a.i - b.i)
      .map((x) => x.p);
    const localFree = !this.opts.gpu?.busy && (this.inFlight.get(this.local) ?? 0) < (this.opts.localMaxInFlight ?? 1);
    return localFree ? [...local, ...apis] : [...apis, ...local];
  }

  begin(name: string): void {
    this.inFlight.set(name, (this.inFlight.get(name) ?? 0) + 1);
    this.lastUsed.set(name, (this.opts.now ?? Date.now)() + this.seq++ / 1000);
    if (name === this.local) this.opts.gpu?.noteLocalActivity();
  }

  end(name: string): void {
    this.inFlight.set(name, Math.max(0, (this.inFlight.get(name) ?? 0) - 1));
    if (name === this.local) this.opts.gpu?.noteLocalActivity();
  }
}
