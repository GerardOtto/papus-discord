import { describe, expect, it } from "vitest";
import { EngineReader } from "../src/engine/reader";
import { LLMChain } from "../src/llm/chain";
import { buildRequest, PersonaLibrary } from "../src/llm/prompt";
import type { LLMProvider } from "../src/llm/provider";
import { GpuMonitor, SmartRouter } from "../src/llm/router";
import { FIXTURE_ENGINE } from "./helpers";

const prov = (name: string, impl?: () => Promise<string>): LLMProvider => ({
  name,
  chat: async () => ({ text: impl ? await impl() : name, provider: name, model: "m" }),
});
const names = (list: LLMProvider[]) => list.map((p) => p.name);
const ALL = ["local", "groq", "gemini", "openrouter", "cloudflare"].map((n) => prov(n));

describe("SmartRouter", () => {
  it("el local va primero si la tarjeta está libre", () => {
    const r = new SmartRouter({ gpu: { busy: false, noteLocalActivity() {} } });
    expect(names(r.order(ALL))).toEqual(["local", "groq", "gemini", "openrouter", "cloudflare"]);
  });

  it("si la tarjeta está ocupada (render, juego), el local pasa al final", () => {
    const r = new SmartRouter({ gpu: { busy: true, noteLocalActivity() {} } });
    expect(names(r.order(ALL))).toEqual(["groq", "gemini", "openrouter", "cloudflare", "local"]);
  });

  it("si el local ya está respondiendo a otro Papu, el siguiente va a una API", () => {
    const r = new SmartRouter();
    r.begin("local");
    expect(names(r.order(ALL))[0]).toBe("groq");
    r.end("local");
    expect(names(r.order(ALL))[0]).toBe("local");
  });

  it("las APIs se ordenan por lo que les queda del día (en tramos del 10 %)", () => {
    const left: Record<string, number> = { groq: 0.35, gemini: 0.9, openrouter: 0.95, cloudflare: 0.5 };
    const r = new SmartRouter({ remaining: (p) => left[p] ?? 1 });
    // gemini y openrouter estan en el mismo tramo (9): se respeta el orden de la config.
    expect(names(r.order(ALL))).toEqual(["local", "gemini", "openrouter", "cloudflare", "groq"]);
  });

  it("modo apis: se turnan por cupo del día y el local queda de respaldo", () => {
    const used: Record<string, number> = { groq: 0, gemini: 0, openrouter: 0, cloudflare: 0 };
    const limit: Record<string, number> = { groq: 1000, gemini: 1000, openrouter: 50, cloudflare: 170 };
    let t = 0;
    const r = new SmartRouter({ prefer: "apis", remaining: (p) => 1 - (used[p] ?? 0) / (limit[p] ?? 1), now: () => t });
    const picks: string[] = [];
    for (let i = 0; i < 2220; i++) {
      const first = r.order(ALL)[0]!.name;
      picks.push(first);
      r.begin(first);
      r.end(first);
      used[first] = (used[first] ?? 0) + 1;
      t += 1000;
    }
    // Groq y Gemini se alternan desde el principio.
    expect(picks.slice(0, 4).sort()).toEqual(["cloudflare", "gemini", "groq", "openrouter"]);
    expect(new Set(picks.slice(4, 8))).toEqual(new Set(["groq", "gemini"]));
    // Al final del día cada una gastó su cupo en proporción, y el local nunca salió primero.
    for (const p of ["groq", "gemini", "openrouter", "cloudflare"]) expect(used[p]).toBe(limit[p]);
    expect(picks).not.toContain("local");
    // Sin cupo en ninguna: responde el local.
    expect(r.order(ALL)[0]!.name).toBe("local");
  });

  it("modo apis: una API sin cupo va después del local", () => {
    const r = new SmartRouter({ prefer: "apis", remaining: (p) => (p === "groq" ? 0 : 0.5) });
    expect(names(r.order(ALL))).toEqual(["gemini", "openrouter", "cloudflare", "local", "groq"]);
  });

  it("la cadena usa el orden del router y libera el cupo del local al terminar", async () => {
    const r = new SmartRouter();
    let release!: () => void;
    let released = false;
    const slow = prov("local", () =>
      released ? Promise.resolve("local") : new Promise<string>((res) => (release = () => ((released = true), res("local")))),
    );
    const chain = new LLMChain([slow, prov("groq")], null, Date.now, r);
    const first = chain.chat({ messages: [] });
    // Mientras el local responde al primero, el segundo lo atiende groq.
    expect((await chain.chat({ messages: [] })).provider).toBe("groq");
    release();
    expect((await first).provider).toBe("local");
    expect((await chain.chat({ messages: [] })).provider).toBe("local");
  });
});

describe("GpuMonitor", () => {
  it("ocupada con uso alto de otro programa; libre con uso bajo", async () => {
    let util = 80;
    let t = 0;
    const g = new GpuMonitor(async () => ({ utilization: util }), { now: () => t });
    await g.poll();
    expect(g.busy).toBe(true);
    util = 5;
    t = 1000;
    await g.poll();
    expect(g.busy).toBe(false);
  });

  it("ignora el uso alto causado por el propio modelo local", async () => {
    let t = 0;
    const g = new GpuMonitor(async () => ({ utilization: 95 }), { now: () => t, ownActivityGraceMs: 8000 });
    g.noteLocalActivity();
    t = 3000;
    await g.poll();
    expect(g.busy).toBe(false);
    t = 9000;
    await g.poll();
    expect(g.busy).toBe(true);
  });

  it("sin tarjeta NVIDIA o con lecturas viejas, no bloquea al local", async () => {
    let t = 0;
    const none = new GpuMonitor(async () => null, { now: () => t });
    await none.poll();
    expect(none.busy).toBe(false);
    const g = new GpuMonitor(async () => ({ utilization: 90 }), { now: () => t });
    await g.poll();
    t = 61_000;
    expect(g.busy).toBe(false);
  });
});

describe("caché del modelo local", () => {
  it("el comienzo de la petición es idéntico entre mensajes distintos (lo que cambia va al final)", () => {
    const engine = new EngineReader(FIXTURE_ENGINE);
    const personas = new PersonaLibrary();
    const teto = engine.character("teto");
    const a = buildRequest({ characters: [teto], papuName: "Ana", message: "hola", history: [] }, personas, { rng: () => 0.1 });
    const b = buildRequest(
      { characters: [teto], papuName: "Beto", message: "¿por qué te dicen pera?", history: [], videos: [{ title: "X", state: "publicado" }] },
      personas,
      { rng: () => 0.9 },
    );
    const sa = a.messages[0]!.content;
    const sb = b.messages[0]!.content;
    const cut = sa.indexOf("# Para esta respuesta");
    expect(cut).toBeGreaterThan(0);
    expect(sb.startsWith(sa.slice(0, cut))).toBe(true);
  });
});
