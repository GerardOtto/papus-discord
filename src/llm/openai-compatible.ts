// Proveedor para APIs compatibles con OpenAI (/chat/completions): Groq, Gemini, OpenRouter y Cloudflare.
import { LLMError, type ChatRequest, type ChatResponse, type LLMProvider } from "./provider";

export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  /** Campos extra del cuerpo (ej.: reasoning_effort). */
  extra?: Record<string, unknown>;
  fetchFn?: typeof fetch;
}

const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

/** Lee Retry-After (segundos o fecha) y los encabezados x-ratelimit-reset-* (ej.: "2m30s", "1.5s"). */
export function parseRetryAfter(headers: Headers, now = Date.now()): number | null {
  const ra = headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  const reset = headers.get("x-ratelimit-reset-requests") ?? headers.get("x-ratelimit-reset-tokens");
  if (reset) {
    let ms = 0;
    for (const [, n, unit] of reset.matchAll(/([\d.]+)(ms|h|m|s)/g)) {
      const v = Number(n);
      ms += unit === "h" ? v * 3_600_000 : unit === "m" ? v * 60_000 : unit === "s" ? v * 1000 : v;
    }
    if (ms > 0) return ms;
  }
  return null;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.name = opts.name;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 30_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          ...this.opts.extra,
        }),
        signal: combined,
      });
    } catch (e) {
      throw new LLMError(`${this.name}: sin respuesta (${(e as Error).name})`, this.name);
    }

    if (res.status === 429) {
      throw new LLMError(`${this.name}: limite de uso (429)`, this.name, parseRetryAfter(res.headers) ?? DEFAULT_RATE_LIMIT_WAIT_MS);
    }
    if (!res.ok) {
      // El cuerpo de error puede repetir datos de la peticion; solo se guarda un resumen corto.
      const body = (await res.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
      throw new LLMError(`${this.name}: HTTP ${res.status} ${body}`, this.name);
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new LLMError(`${this.name}: respuesta vacia`, this.name);
    return { text, provider: this.name, model: data.model ?? this.opts.model };
  }
}
