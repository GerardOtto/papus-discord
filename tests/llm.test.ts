import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, LLMChain } from "../src/llm/chain";
import { buildProviders, loadLLMSettings } from "../src/llm/index";
import { OpenAICompatibleProvider, parseRetryAfter } from "../src/llm/openai-compatible";
import { LLMError, type ChatRequest, type LLMProvider } from "../src/llm/provider";
import { RequestQueue } from "../src/llm/queue";
import { LLMUsage } from "../src/llm/usage";
import { memDb } from "./helpers";

const REQ: ChatRequest = { messages: [{ role: "user", content: "hola" }] };

class FakeProvider implements LLMProvider {
  calls = 0;
  constructor(
    readonly name: string,
    private readonly behavior: () => Promise<string>,
  ) {}
  async chat() {
    this.calls++;
    return { text: await this.behavior(), provider: this.name, model: "fake" };
  }
}
const ok = (name: string, text = `respuesta de ${name}`) => new FakeProvider(name, async () => text);
const limited = (name: string, ms = 60_000) =>
  new FakeProvider(name, async () => {
    throw new LLMError("429", name, ms);
  });
const broken = (name: string) =>
  new FakeProvider(name, async () => {
    throw new LLMError("500", name);
  });

describe("LLMChain", () => {
  it("usa el primero disponible", async () => {
    const chain = new LLMChain([ok("groq"), ok("gemini")]);
    expect((await chain.chat(REQ)).provider).toBe("groq");
  });

  it("pasa al siguiente ante limite o error y deja en descanso al que fallo", async () => {
    let t = 0;
    const groq = limited("groq", 120_000);
    const gemini = broken("gemini");
    const or = ok("openrouter");
    const chain = new LLMChain([groq, gemini, or], null, () => t);
    expect((await chain.chat(REQ)).provider).toBe("openrouter");
    expect(chain.available().map((p) => p.name)).toEqual(["openrouter"]);
    t = 31_000; // el error comun descansa 30 s
    expect(chain.available().map((p) => p.name)).toEqual(["gemini", "openrouter"]);
    t = 121_000; // el limite descansa lo que dijo la API
    expect(chain.available().map((p) => p.name)).toEqual(["groq", "gemini", "openrouter"]);
  });

  it("si todas fallan lanza AllProvidersFailedError (frase fija del personaje)", async () => {
    const chain = new LLMChain([limited("groq"), broken("gemini")]);
    await expect(chain.chat(REQ)).rejects.toBeInstanceOf(AllProvidersFailedError);
    // Ambas en descanso: ni siquiera se llaman.
    await expect(chain.chat(REQ)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("registra el uso por proveedor y avisa al 80 % una sola vez por dia", async () => {
    const alerts: string[] = [];
    const usage = new LLMUsage(memDb(), "UTC", { groq: 10 }, (a) => alerts.push(`${a.provider} ${a.used}/${a.limit}`));
    const chain = new LLMChain([ok("groq")], usage);
    for (let i = 0; i < 9; i++) await chain.chat(REQ);
    expect(usage.today("groq")).toBe(9);
    expect(alerts).toEqual(["groq 8/10"]);
    expect(usage.dailyCapacity()).toBe(10);
  });
});

describe("LLMChain: respuestas que no sirven", () => {
  const prov = (name: string, text: string): LLMProvider => ({ name, chat: async () => ({ text, provider: name, model: "m" }) });

  it("una respuesta cortada se descarta y responde la siguiente API (sin dejar en descanso a la primera)", async () => {
    const used: [string, boolean][] = [];
    const chain = new LLMChain([prov("gemini", '{"miku": "¡Ay, papu, World is Mine es'), prov("groq", '{"miku": "¡World is Mine!"}')], {
      record: (p, ok) => used.push([p, ok]),
    });
    const accept = (r: { text: string }) => r.text.trim().endsWith("}");
    expect((await chain.chat({ messages: [] }, undefined, accept)).provider).toBe("groq");
    expect(used).toEqual([["gemini", false], ["groq", true]]);
    expect(chain.available().map((p) => p.name)).toEqual(["gemini", "groq"]);
  });

  it("si ninguna sirve, error de todas", async () => {
    const chain = new LLMChain([prov("a", "x"), prov("b", "y")]);
    await expect(chain.chat({ messages: [] }, undefined, () => false)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});

describe("OpenAICompatibleProvider", () => {
  const make = (fetchFn: typeof fetch) =>
    new OpenAICompatibleProvider({ name: "groq", baseUrl: "https://x/v1", model: "m", apiKey: "SECRETO", fetchFn });

  it("envia el formato OpenAI con la clave en el encabezado y devuelve el texto", async () => {
    const fetchFn = vi.fn(async () => Response.json({ model: "m1", choices: [{ message: { content: " hola " } }] }));
    const res = await make(fetchFn as unknown as typeof fetch).chat({ ...REQ, maxTokens: 50 });
    expect(res).toEqual({ text: "hola", provider: "groq", model: "m1" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SECRETO");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m", max_tokens: 50 });
  });

  it("convierte 429 en limite con la espera que indica la API", async () => {
    const fetchFn = async () => new Response("", { status: 429, headers: { "retry-after": "7" } });
    const err = await make(fetchFn as typeof fetch).chat(REQ).catch((e: LLMError) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect((err as LLMError).retryAfterMs).toBe(7000);
  });

  it("los errores no incluyen la clave", async () => {
    const fetchFn = async () => new Response("upstream down", { status: 503 });
    const err = (await make(fetchFn as typeof fetch).chat(REQ).catch((e: LLMError) => e)) as LLMError;
    expect(err.isRateLimit).toBe(false);
    expect(err.message).not.toContain("SECRETO");
  });

  it("una respuesta vacia es un error (pasa al siguiente proveedor)", async () => {
    const fetchFn = async () => Response.json({ choices: [{ message: { content: "" } }] });
    await expect(make(fetchFn as typeof fetch).chat(REQ)).rejects.toBeInstanceOf(LLMError);
  });

  it("parseRetryAfter entiende segundos y los encabezados de Groq", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(parseRetryAfter(new Headers({ "x-ratelimit-reset-requests": "2m30.5s" }))).toBe(150_500);
    expect(parseRetryAfter(new Headers())).toBeNull();
  });
});

describe("buildProviders", () => {
  it("arma la cadena en el orden de config/llm.json y omite las que no tienen clave", () => {
    const settings = loadLLMSettings();
    expect(settings.providers.map((p) => p.name)).toEqual(["local", "groq", "gemini", "openrouter", "cloudflare"]);
    const { providers, skipped } = buildProviders(settings, {
      GROQ_API_KEY: "a",
      OPENROUTER_API_KEY: "b",
      CLOUDFLARE_API_TOKEN: "c", // sin CLOUDFLARE_ACCOUNT_ID no se puede armar la URL
    });
    // El local no necesita clave: siempre entra.
    expect(providers.map((p) => p.name)).toEqual(["local", "groq", "openrouter"]);
    expect(skipped).toEqual(["gemini", "cloudflare"]);
  });
});

describe("RequestQueue", () => {
  const deferred = () => {
    let resolve!: (v: string) => void;
    const promise = new Promise<string>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("atiende en orden de llegada respetando la concurrencia", async () => {
    const q = new RequestQueue({ concurrency: 1, maxWaitMs: 10_000 });
    const order: string[] = [];
    const a = deferred();
    const pa = q.enqueue("a", async () => (order.push("a"), a.promise));
    const pb = q.enqueue("b", async () => (order.push("b"), "B"));
    expect(q.length).toBe(1);
    a.resolve("A");
    expect(await pa).toEqual({ status: "ok", value: "A" });
    expect(await pb).toEqual({ status: "ok", value: "B" });
    expect(order).toEqual(["a", "b"]);
  });

  it("una sola peticion pendiente por Papu", async () => {
    const q = new RequestQueue({ concurrency: 1, maxWaitMs: 10_000 });
    const a = deferred();
    const first = q.enqueue("papu", () => a.promise);
    expect(await q.enqueue("papu", async () => "x")).toEqual({ status: "busy" });
    a.resolve("ok");
    await first;
    expect(q.hasPending("papu")).toBe(false);
  });

  it("vence la espera maxima en la cola o en curso, cancelando la peticion", async () => {
    vi.useFakeTimers();
    try {
      const q = new RequestQueue({ concurrency: 1, maxWaitMs: 120_000 });
      let aborted = false;
      const running = q.enqueue("a", (signal) => {
        signal.addEventListener("abort", () => (aborted = true));
        return new Promise<string>(() => {});
      });
      const waiting = q.enqueue("b", async () => "nunca");
      await vi.advanceTimersByTimeAsync(120_001);
      expect(await waiting).toEqual({ status: "timeout" });
      expect(aborted).toBe(true);
      expect(q.hasPending("b")).toBe(false);
      void running;
    } finally {
      vi.useRealTimers();
    }
  });

  it("un error del LLM llega como status error", async () => {
    const q = new RequestQueue({ concurrency: 2, maxWaitMs: 1000 });
    const r = await q.enqueue("a", async () => {
      throw new Error("x");
    });
    expect(r.status).toBe("error");
  });
});
