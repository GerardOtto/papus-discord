// Registro de uso por proveedor y dia; avisa una vez por dia y proveedor al llegar al 80 % del limite diario.
import type { Db } from "../db/database";
import { dayKey } from "../time";
import type { UsageSink } from "./chain";

export interface UsageAlert {
  provider: string;
  used: number;
  limit: number;
}

export class LLMUsage implements UsageSink {
  private readonly alerted = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly timeZone: string,
    /** Peticiones diarias gratuitas estimadas por proveedor (config/llm.json -> dailyRequests). */
    private readonly dailyLimits: Record<string, number>,
    private readonly onAlert: (a: UsageAlert) => void = () => {},
    private readonly now: () => Date = () => new Date(),
    private readonly threshold = 0.8,
  ) {}

  record(provider: string, ok: boolean): void {
    const day = dayKey(this.now(), this.timeZone);
    this.db
      .prepare(
        `INSERT INTO llm_usage (provider, day, ok, failed) VALUES (?, ?, ?, ?)
         ON CONFLICT(provider, day) DO UPDATE SET ok = ok + excluded.ok, failed = failed + excluded.failed`,
      )
      .run(provider, day, ok ? 1 : 0, ok ? 0 : 1);
    const limit = this.dailyLimits[provider];
    if (!limit) return;
    const used = this.today(provider);
    const key = `${provider}:${day}`;
    if (used >= limit * this.threshold && !this.alerted.has(key)) {
      this.alerted.add(key);
      this.onAlert({ provider, used, limit });
    }
  }

  /** Peticiones de hoy (exitosas + fallidas: ambas cuentan para el limite de la API). */
  today(provider: string): number {
    const row = this.db
      .prepare("SELECT ok + failed AS n FROM llm_usage WHERE provider = ? AND day = ?")
      .get(provider, dayKey(this.now(), this.timeZone)) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** Fraccion del limite diario que le queda (1 si no tiene limite conocido, como el modelo local). */
  remainingFraction(provider: string): number {
    const limit = this.dailyLimits[provider];
    if (!limit) return 1;
    return Math.max(0, 1 - this.today(provider) / limit);
  }

  /** Capacidad diaria total de la cadena (para el calculo de la cuota, PLAN §5). */
  dailyCapacity(): number {
    return Object.values(this.dailyLimits).reduce((a, b) => a + b, 0);
  }
}
