import { describe, expect, it } from "vitest";
import { BOT_IDS, type BotId } from "../src/config";
import { EngineReader } from "../src/engine/reader";
import { LLMChain } from "../src/llm/chain";
import { PersonaLibrary } from "../src/llm/prompt";
import { LLMError, type LLMProvider } from "../src/llm/provider";
import { RequestQueue } from "../src/llm/queue";
import { loadModerationSettings, RuleSet } from "../src/moderation/rules";
import { StrikeStore } from "../src/moderation/strikes";
import { Phrases } from "../src/phrases/catalog";
import { DeckStore } from "../src/phrases/deck";
import { Quota } from "../src/quota/quota";
import { ConversationService, mentionedBots, type ChatPort, type IncomingMention } from "../src/services/conversation";
import { ModerationService, type ModerationPort } from "../src/services/moderation";
import { FIXTURE_ENGINE, memDb, seededRng } from "./helpers";

const engine = new EngineReader(FIXTURE_ENGINE);
const characters = Object.fromEntries(BOT_IDS.map((id) => [id, engine.character(id)])) as Record<BotId, ReturnType<EngineReader["character"]>>;

class FakeChat implements ChatPort {
  sent: { bot: BotId; content: string }[] = [];
  reactions: string[] = [];
  typingStarted = 0;
  typingStopped = 0;
  async reply(bot: BotId, _c: string, _r: string, content: string) {
    this.sent.push({ bot, content });
  }
  typing() {
    this.typingStarted++;
    return () => void this.typingStopped++;
  }
  async react(_b: BotId, _c: string, _m: string, emoji: string) {
    this.reactions.push(emoji);
  }
}

function setup(provider: LLMProvider, opts: { quota?: number; maxWaitMs?: number } = {}) {
  const db = memDb();
  const port = new FakeChat();
  const quota = new Quota(db, opts.quota ?? 5, "America/Santiago");
  const queue = new RequestQueue({ concurrency: 2, maxWaitMs: opts.maxWaitMs ?? 5000 });
  const svc = new ConversationService({
    quota,
    queue,
    chain: new LLMChain([provider]),
    phrases: new Phrases(new DeckStore(db, seededRng(1))),
    personas: new PersonaLibrary(),
    characters,
    port,
    llm: { maxTokens: 300, temperature: 0.9 },
  });
  return { svc, port, quota, queue };
}

const llm = (text: string | (() => Promise<string>)): LLMProvider => ({
  name: "fake",
  chat: async () => ({ text: typeof text === "string" ? text : await text(), provider: "fake", model: "m" }),
});
const mention = (bots: BotId[], authorId = "papu"): IncomingMention => ({
  messageId: "m1",
  channelId: "c1",
  authorId,
  authorName: "Ana",
  text: "hola",
  bots,
  history: async () => [],
});

describe("ConversationService", () => {
  it("una sola llamada para varios @, cada bot publica su parte y se cobra por @", async () => {
    let calls = 0;
    const { svc, port, quota } = setup(llm(async () => (calls++, '{"teto": "¡hola!", "miku": "¡¿QUÉ?! hola"}')));
    expect(await svc.handle(mention(["teto", "miku"]))).toBe("answered");
    expect(calls).toBe(1);
    expect(port.sent).toEqual([
      { bot: "teto", content: "¡hola!" },
      { bot: "miku", content: "¡¿QUÉ?! hola" },
    ]);
    expect(quota.remaining("papu")).toBe(3);
    expect(port.typingStarted).toBe(2);
    expect(port.typingStopped).toBe(2);
  });

  it("si la cuota no alcanza, responden los primeros y el resto da su frase de cuota agotada", async () => {
    const { svc, port, quota } = setup(llm('{"teto": "hola"}'), { quota: 1 });
    expect(await svc.handle(mention(["teto", "neru"]))).toBe("answered");
    expect(port.sent[0]!.bot).toBe("neru");
    expect(port.sent[0]!.content).toContain("<@papu>"); // frase fija, no LLM
    expect(port.sent[1]).toEqual({ bot: "teto", content: "hola" });
    expect(quota.remaining("papu")).toBe(0);
    expect(await svc.handle(mention(["miku"]))).toBe("no_quota");
  });

  it("si todas las APIs fallan: frase sin_api y se devuelve la cuota", async () => {
    const { svc, port, quota } = setup({
      name: "x",
      chat: async () => {
        throw new LLMError("caida", "x");
      },
    });
    expect(await svc.handle(mention(["luka"]))).toBe("failed");
    expect(port.sent).toHaveLength(1);
    expect(quota.remaining("papu")).toBe(5);
  });

  it("espera maxima superada: frase de cola llena y sin cobro", async () => {
    const { svc, port, quota } = setup(llm(() => new Promise(() => {})), { maxWaitMs: 50 });
    expect(await svc.handle(mention(["miku"]))).toBe("timeout");
    expect(port.sent[0]!.bot).toBe("miku");
    expect(quota.remaining("papu")).toBe(5);
  });

  it("devuelve la unidad del bot por el que el modelo no respondio", async () => {
    const { svc, port, quota } = setup(llm('{"teto": "hola"}'));
    expect(await svc.handle(mention(["teto", "luka"]))).toBe("partial");
    expect(port.sent).toEqual([{ bot: "teto", content: "hola" }]);
    expect(quota.remaining("papu")).toBe(4);
  });

  it("una peticion pendiente por Papu: la segunda solo recibe ⏳ y no se cobra", async () => {
    let release!: (v: string) => void;
    const { svc, port, quota } = setup(llm(() => new Promise<string>((r) => (release = r))));
    const first = svc.handle(mention(["teto"]));
    await new Promise((r) => setTimeout(r, 10));
    expect(await svc.handle(mention(["miku"]))).toBe("busy");
    expect(port.reactions).toEqual(["⏳"]);
    release('{"teto": "listo"}');
    expect(await first).toBe("answered");
    expect(quota.remaining("papu")).toBe(4);
  });
});

describe("mentionedBots", () => {
  const ids = new Map<string, BotId>([
    ["11", "teto"],
    ["22", "miku"],
    ["33", "neru"],
  ]);
  it("respeta el orden, no repite e incluye la respuesta a un bot", () => {
    expect(mentionedBots("<@22> y <@!11> y <@22> y <@999>", ids)).toEqual(["miku", "teto"]);
    expect(mentionedBots("jaja", ids, "33")).toEqual(["neru"]);
    expect(mentionedBots("<@33> oye", ids, "33")).toEqual(["neru"]);
  });
});

class FakeMod implements ModerationPort {
  deleted: string[] = [];
  timeouts: { userId: string; minutes: number }[] = [];
  said: string[] = [];
  logs: { kind: string; action: string }[] = [];
  owner: string[] = [];
  async deleteMessage(_c: string, id: string) {
    this.deleted.push(id);
  }
  async timeout(userId: string, minutes: number) {
    this.timeouts.push({ userId, minutes });
  }
  async say(_c: string, content: string) {
    this.said.push(content);
  }
  async log(e: { kind: string; action: string }) {
    this.logs.push({ kind: e.kind, action: e.action });
  }
  async notifyOwner(c: string) {
    this.owner.push(c);
  }
}

function modSetup(start = 0) {
  const db = memDb();
  const port = new FakeMod();
  let t = start;
  const svc = new ModerationService(
    new RuleSet(loadModerationSettings()),
    new StrikeStore(db),
    new Phrases(new DeckStore(db, seededRng(2))),
    port,
    () => new Set(["gyrop"]),
    () => t,
  );
  return { svc, port, advance: (ms: number) => (t += ms) };
}
const msg = (text: string, extra: Partial<Parameters<ModerationService["handle"]>[0]> = {}) => ({
  messageId: `m${Math.random()}`,
  channelId: "c",
  authorId: "papu",
  text,
  targetsSomeone: false,
  memberAgeHours: 1000,
  ...extra,
});

describe("ModerationService", () => {
  it("mensajes normales pasan sin tocar nada", async () => {
    const { svc, port } = modSetup();
    expect(await svc.handle(msg("no mames, qué buena canción"))).toBeNull();
    expect(port.said).toEqual([]);
  });

  it("escalera de strikes: advertencia, 10 min, 1 h, 24 h + aviso a GyroP", async () => {
    const { svc, port, advance } = modSetup();
    for (let i = 0; i < 4; i++) {
      await svc.handle(msg("eres un pendejo"));
      advance(60_000);
    }
    expect(port.deleted).toHaveLength(4);
    expect(port.timeouts.map((x) => x.minutes)).toEqual([10, 60, 1440]);
    expect(port.owner).toHaveLength(1);
    expect(port.logs.map((l) => l.action)).toEqual([
      "borrado · advertencia",
      "borrado · silencio 10 min",
      "borrado · silencio 60 min",
      "borrado · silencio 1440 min",
    ]);
  });

  it("GyroP esta exento", async () => {
    const { svc, port } = modSetup();
    expect(await svc.handle(msg("eres un pendejo", { authorId: "gyrop" }))).toBeNull();
    expect(port.deleted).toEqual([]);
  });

  it("datos personales: borra y explica con su frase propia", async () => {
    const { svc, port } = modSetup();
    await svc.handle(msg("mi cel 55 1234 5678"));
    expect(port.deleted).toHaveLength(1);
    expect(port.said[0]).toMatch(/datos|número|teléfono|correo/i);
  });

  it("mayúsculas: solo aviso, sin borrar ni strike, y no más de uno cada 10 min", async () => {
    const { svc, port, advance } = modSetup();
    await svc.handle(msg("MIKU ES LA MEJOR DEL MUNDO"));
    await svc.handle(msg("TETO TAMBIEN ES LA MEJOR"));
    expect(port.said).toHaveLength(1);
    expect(port.deleted).toEqual([]);
    advance(11 * 60_000);
    await svc.handle(msg("LUKA ES LA MÁS ELEGANTE"));
    expect(port.said).toHaveLength(2);
  });

  it("flood: el sexto mensaje en 10 s se borra con strike", async () => {
    const { svc, port, advance } = modSetup();
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await svc.handle(msg(`mensaje ${i}`)));
      advance(500);
    }
    expect(results.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(results[5]?.kind).toBe("flood");
    expect(port.deleted).toHaveLength(1);
  });

  it("bloqueos de AutoMod sin conexión: strikes y resumen de Neru con el número", async () => {
    const { svc } = modSetup();
    const summary = await svc.applyOfflineHits([
      { userId: "a", channelId: "c", ruleName: "Neru · odio", content: "x" },
      { userId: "b", channelId: "c", ruleName: "Neru · odio", content: "y" },
      { userId: "gyrop", channelId: "c", ruleName: "Neru · odio", content: "z" },
    ]);
    expect(summary).toContain("2");
    expect(await svc.applyOfflineHits([])).toBeNull();
  });
});
