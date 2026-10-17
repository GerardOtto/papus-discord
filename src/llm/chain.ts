// Cadena de respaldo (regla 5): local -> Groq -> Gemini -> OpenRouter -> Cloudflare (config/llm.json), con el orden de
// cada peticion decidido por SmartRouter (router.ts). Un proveedor que da limite de uso descansa lo que indique la API;
// uno que falla o se demora, un rato corto.
import { LLMError, type ChatRequest, type ChatResponse, type LLMProvider } from "./provider";
import type { SmartRouter } from "./router";

export interface UsageSink {
  record(provider: string, ok: boolean): void;
}

export class AllProvidersFailedError extends Error {
  constructor(readonly errors: LLMError[]) {
    super(`Todas las APIs fallaron: ${errors.map((e) => e.message).join(" | ") || "todas en descanso"}`);
  }
}

const FAILURE_COOLDOWN_MS = 30_000;

export class LLMChain {
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    readonly providers: LLMProvider[],
    private readonly usage: UsageSink | null = null,
    private readonly now: () => number = Date.now,
    /** Reparto local/APIs; sin router, se usa el orden de config/llm.json. */
    private readonly router: Pick<SmartRouter, "order" | "begin" | "end"> | null = null,
  ) {
    if (providers.length === 0) throw new Error("La cadena de LLM no tiene proveedores");
  }

  /** Proveedores disponibles ahora (sin descanso pendiente), en orden. */
  available(): LLMProvider[] {
    const t = this.now();
    return this.providers.filter((p) => (this.cooldownUntil.get(p.name) ?? 0) <= t);
  }

  /**
   * `accept`: si la respuesta llega pero no sirve (ej.: cortada a la mitad, sin el JSON de cada personaje), se prueba
   * con el siguiente proveedor en vez de devolverla. Ese proveedor no descansa: fue un tropiezo, no una caída.
   */
  async chat(req: ChatRequest, signal?: AbortSignal, accept?: (res: ChatResponse) => boolean): Promise<ChatResponse> {
    const errors: LLMError[] = [];
    const candidates = this.router ? this.router.order(this.available()) : this.available();
    for (const p of candidates) {
      if (signal?.aborted) break;
      this.router?.begin(p.name);
      try {
        const res = await p.chat(req, signal);
        if (accept && !accept(res)) {
          errors.push(new LLMError(`${p.name}: respuesta ilegible`, p.name));
          this.usage?.record(p.name, false);
          continue;
        }
        this.usage?.record(p.name, true);
        return res;
      } catch (e) {
        const err = e instanceof LLMError ? e : new LLMError(`${p.name}: ${(e as Error).message}`, p.name);
        errors.push(err);
        this.usage?.record(p.name, false);
        this.cooldownUntil.set(p.name, this.now() + (err.retryAfterMs ?? FAILURE_COOLDOWN_MS));
      } finally {
        this.router?.end(p.name);
      }
    }
    throw new AllProvidersFailedError(errors);
  }
}
