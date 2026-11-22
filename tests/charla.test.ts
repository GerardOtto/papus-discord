import { describe, expect, it } from "vitest";
import { BOT_IDS, type BotId } from "../src/config";
import { EngineReader } from "../src/engine/reader";
import { LLMChain } from "../src/llm/chain";
import { PersonaLibrary } from "../src/llm/prompt";
import { LLMError, type ChatRequest, type LLMProvider } from "../src/llm/provider";
import { RequestQueue } from "../src/llm/queue";
import { Phrases } from "../src/phrases/catalog";
import { DeckStore } from "../src/phrases/deck";
import { ACTIVE_MS, botSpokeAlone, FRESH_MS, GENERAL_CHAT_MS, GENERAL_HISTORY, GeneralChat, nextChatterBot, type ChannelMessage, type CharlaPort } from "../src/services/charla";
import { FIXTURE_ENGINE, memDb, seededRng } from "./helpers";
import tetoPhrases from "../content/frases/teto.json";

const engine = new EngineReader(FIXTURE_ENGINE);
const characters = Object.fromEntries(BOT_IDS.map((id) => [id, engine.character(id)])) as Record<BotId, ReturnType<EngineReader["character"]>>;
const NOW = 1_800_000_000_000;

const msg = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: "x",
  author: "Ana",
  bot: null,
  repliesToHuman: false,
  text: "¿alguien vio el estreno de ayer?",
  at: NOW - 30 * 60_000,
  ...over,
});

class FakePort implements CharlaPort {
  posts: { id: string; bot: BotId; content: string; mention?: BotId }[] = [];
  replies: { bot: BotId; replyTo: string; content: string }[] = [];
  asked = 0;
  constructor(public messages: ChannelMessage[] | null) {}
  async recent(limit: number) {
    this.asked = limit;
    return this.messages;
  }
  async post(bot: BotId, content: string, mention?: BotId) {
    const id = `p${this.posts.length + 1}`;
    this.posts.push({ id, bot, content, mention });
    return id;
  }
  async reply(bot: BotId, replyTo: string, content: string) {
    this.replies.push({ bot, replyTo, content });
    return `r${this.replies.length}`;
  }
  typing() {
    return () => {};
  }
}

/** LLM falso: contesta con la clave que pide el formato del prompt. */
function fakeLLM(fail = false) {
  const requests: ChatRequest[] = [];
  const provider: LLMProvider = {
    name: "fake",
    chat: async (req) => {
      requests.push(req);
      if (fail) throw new LLMError("caída", "fake");
      const key = /objeto JSON de una clave: \{"(\w+)"/.exec(req.messages[0]!.content)![1]!;
      return { text: JSON.stringify({ [key]: `habla ${key}` }), provider: "fake", model: "m" };
    },
  };
  return { provider, requests };
}

function setup(messages: ChannelMessage[] | null, active: BotId[], opts: { fail?: boolean; drama?: { turnos: number; allowed: () => boolean; used: () => void } } = {}) {
  const db = memDb();
  const decks = new DeckStore(db, seededRng(5));
  const port = new FakePort(messages);
  const { provider, requests } = fakeLLM(opts.fail);
  const chat = new GeneralChat({
    decks,
    phrases: new Phrases(decks),
    chain: new LLMChain([provider]),
    queue: new RequestQueue({ concurrency: 1, maxWaitMs: 5000 }),
    personas: new PersonaLibrary(),
    characters,
    port,
    active: () => active,
    llm: { maxTokens: 200, temperature: 0.9 },
    now: () => NOW,
    rng: seededRng(2),
    drama: opts.drama,
  });
  return { chat, port, requests };
}

describe("charla en #general", () => {
  it("cada 20 minutos, leyendo los últimos 12 mensajes", async () => {
    expect(GENERAL_CHAT_MS).toBe(20 * 60_000);
    const { chat, port } = setup([msg()], ["teto"]);
    await chat.tick();
    expect(port.asked).toBe(GENERAL_HISTORY);
    expect(GENERAL_HISTORY).toBe(12);
  });

  it("si el último mensaje es de un bot que habló solo, no escribe nada", async () => {
    const { chat, port, requests } = setup([msg(), msg({ bot: "miku", author: "Miku" })], ["teto", "miku"]);
    expect(await chat.tick()).toBe("skipped");
    expect(port.posts).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("si un Papu escribió hace menos de 10 min, ya hay gente hablando: no interrumpe", async () => {
    const talking = [msg({ at: NOW - ACTIVE_MS + 60_000 }), msg({ bot: "miku", author: "Miku", repliesToHuman: true })];
    const { chat, port, requests } = setup(talking, ["teto", "miku"]);
    expect(await chat.tick()).toBe("skipped");
    expect(port.posts).toEqual([]);
    expect(requests).toEqual([]);
    // /charla de GyroP sí sale.
    expect(await chat.tick({ force: true })).not.toBe("skipped");
  });

  it("el comando /charla (force) escribe aunque el último sea de un bot que habló solo", async () => {
    const { chat, port } = setup([msg(), msg({ bot: "miku", author: "Miku" })], ["teto"]);
    expect(await chat.tick({ force: true })).toBe("commented");
    expect(port.posts).toHaveLength(1);
  });

  it("/charla con Vocaloid, tema y a quién preguntarle", async () => {
    const { chat, port, requests } = setup([msg()], ["teto", "miku", "kaito"]);
    expect(await chat.tick({ force: true, bot: "kaito", target: "miku", topic: "el helado de puerro" })).toBe("asked");
    expect(port.posts[0]).toMatchObject({ bot: "kaito", mention: "miku" });
    expect(port.replies[0]).toMatchObject({ bot: "miku" });
    expect(requests[0]!.messages[0]!.content).toContain("GyroP te pidió que este mensaje sea sobre esto");
    expect(requests[0]!.messages[0]!.content).toContain("el helado de puerro");
  });

  it("/charla con tema y sin a quién: comenta el tema, sin mencionar a nadie", async () => {
    const { chat, port } = setup([msg({ at: NOW - FRESH_MS - 1 })], ["teto", "miku"]);
    expect(await chat.tick({ force: true, bot: "teto", topic: "las baguettes" })).toBe("commented");
    expect(port.posts).toEqual([{ id: "p1", bot: "teto", content: "habla teto", mention: undefined }]);
  });

  it("si el último es un bot contestándole a un Papu, sí escribe", async () => {
    const { chat, port } = setup([msg(), msg({ bot: "miku", author: "Miku", repliesToHuman: true })], ["teto"]);
    expect(await chat.tick()).toBe("commented");
    expect(port.posts).toHaveLength(1);
  });

  it("comenta la plática reciente de los Papus con el LLM, sin mencionar a nadie", async () => {
    const { chat, port, requests } = setup([msg({ text: "las baguettes de la panadería de mi esquina" })], ["teto"]);
    expect(await chat.tick()).toBe("commented");
    expect(port.posts).toEqual([{ id: "p1", bot: "teto", content: "habla teto", mention: undefined }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages[1]!.content).toContain("Ana: las baguettes de la panadería de mi esquina");
    expect(requests[0]!.messages[0]!.content).toContain("Nadie te mencionó");
  });

  it("sin plática reciente, le pregunta a otro Vocaloid con @ y ese contesta una sola vez", async () => {
    const old = msg({ at: NOW - FRESH_MS - 1 });
    const { chat, port, requests } = setup([old], ["teto", "kaito"]);
    expect(await chat.tick()).toBe("asked");
    expect(port.posts).toHaveLength(1);
    const opener = port.posts[0]!;
    expect(opener.mention).toBeDefined();
    expect(opener.mention).not.toBe(opener.bot);
    expect(port.replies).toEqual([{ bot: opener.mention, replyTo: opener.id, content: `habla ${opener.mention}` }]);
    expect(requests).toHaveLength(2);
    // El que contesta sabe que le habla otro Vocaloid, no un Papu.
    expect(requests[1]!.messages[0]!.content).toContain(`Quien te escribe es ${characters[opener.bot].displayName}`);
  });

  it("si el LLM falla, va una frase fija (sin mención)", async () => {
    const { chat, port } = setup([msg()], ["teto"], { fail: true });
    expect(await chat.tick()).toBe("fallback");
    expect(port.posts).toHaveLength(1);
    expect(port.posts[0]!.mention).toBeUndefined();
    expect(tetoPhrases.charla_general).toContain(port.posts[0]!.content);
  });

  it("sin #general o sin bots conectados no hace nada", async () => {
    expect(await setup(null, ["teto"]).chat.tick()).toBe("skipped");
    expect(await setup([msg()], []).chat.tick()).toBe("skipped");
  });

  it("botSpokeAlone", () => {
    expect(botSpokeAlone(undefined)).toBe(false);
    expect(botSpokeAlone(msg())).toBe(false);
    expect(botSpokeAlone(msg({ bot: "neru" }))).toBe(true);
    expect(botSpokeAlone(msg({ bot: "neru", repliesToHuman: true }))).toBe(false);
  });

  it("rota entre todos los Vocaloids conectados sin repetir hasta completar la vuelta", () => {
    const decks = new DeckStore(memDb(), seededRng(7));
    const vuelta = BOT_IDS.map(() => nextChatterBot(decks, BOT_IDS));
    expect(new Set(vuelta).size).toBe(BOT_IDS.length);
  });

  it("solo elige bots conectados", () => {
    const decks = new DeckStore(memDb(), seededRng(3));
    const active: BotId[] = ["teto", "kaito"];
    for (let i = 0; i < 10; i++) expect(active).toContain(nextChatterBot(decks, active));
  });
});

describe("minidramas en #general (PLAN §3.13)", () => {
  const old = [msg({ at: NOW - FRESH_MS - 60_000 })];

  it("cuando toca, se turnan hasta completar los turnos y cada uno responde al anterior", async () => {
    let used = 0;
    const { chat, port, requests } = setup(old, ["teto", "miku"], { drama: { turnos: 4, allowed: () => true, used: () => void used++ } });
    expect(await chat.tick()).toBe("drama");
    expect(used).toBe(1);
    const a = port.posts[0]!.bot;
    const b = port.posts[0]!.mention!;
    expect(port.replies.map((r) => [r.bot, r.replyTo])).toEqual([
      [b, "p1"],
      [a, "r1"],
      [b, "r2"],
    ]);
    expect(requests[0]!.messages[0]!.content).toMatch(/pique en broma/);
    expect(requests.at(-1)!.messages[0]!.content).toMatch(/último mensaje: ciérralo con un remate/);
  });

  it("sin permiso (tope del día o azar) es la pregunta de siempre con una sola respuesta", async () => {
    let used = 0;
    const { chat, port } = setup(old, ["teto", "miku"], { drama: { turnos: 4, allowed: () => false, used: () => void used++ } });
    expect(await chat.tick()).toBe("asked");
    expect(port.replies).toHaveLength(1);
    expect(used).toBe(0);
  });

  it("pique por una carrera (PLAN §3.14): el que ganó provoca al otro por lo que pasó, como minidrama", async () => {
    let used = 0;
    const { chat, port, requests } = setup([msg()], ["teto", "miku"], { drama: { turnos: 4, allowed: () => true, used: () => void used++ } });
    expect(await chat.tick({ force: true, bot: "miku", target: "teto", pique: "Miku llegó 1.º y Teto 6.º en la carrera." })).toBe("drama");
    expect(used).toBe(1);
    expect(port.posts[0]).toMatchObject({ bot: "miku", mention: "teto" });
    expect(port.replies).toHaveLength(3);
    expect(requests[0]!.messages[0]!.content).toContain("Miku llegó 1.º y Teto 6.º en la carrera.");
  });

  it("pique sin cupo de minidramas: una provocación y una sola respuesta; sin rival conectado, nada", async () => {
    const sinCupo = setup([msg()], ["teto", "miku"], { drama: { turnos: 4, allowed: () => false, used: () => {} } });
    expect(await sinCupo.chat.tick({ force: true, bot: "miku", target: "teto", pique: "Miku ganó." })).toBe("asked");
    expect(sinCupo.port.replies).toHaveLength(1);
    const solo = setup([msg()], ["miku"], { drama: { turnos: 4, allowed: () => true, used: () => {} } });
    expect(await solo.chat.tick({ force: true, bot: "miku", target: "teto", pique: "Miku ganó." })).toBe("skipped");
    expect(solo.port.posts).toEqual([]);
  });

  it("si el LLM no responde a mitad del pique, se corta ahí", async () => {
    const { chat, port } = setup(old, ["teto", "miku"], { fail: true, drama: { turnos: 4, allowed: () => true, used: () => {} } });
    expect(await chat.tick()).toBe("fallback");
    expect(port.replies).toEqual([]);
  });
});

describe("say y respond (ambiente casual)", () => {
  it("say publica en #general con la situación, sin la indicación de animar la plática", async () => {
    const { chat, port, requests } = setup([msg()], ["teto"]);
    expect(await chat.say("teto", "Ana se casó con Miku.")).toBe("habla teto");
    expect(port.posts).toEqual([{ id: "p1", bot: "teto", content: "habla teto", mention: undefined }]);
    const system = requests[0]!.messages[0]!.content;
    expect(system).toContain("Ana se casó con Miku.");
    expect(system).not.toContain("para animar la plática");
  });

  it("respond devuelve la respuesta sin publicarla", async () => {
    const { chat, port, requests } = setup([msg()], ["miku"]);
    expect(await chat.respond("miku", { authorName: "Ana", message: "Miku canta raro", history: [], note: "te metes como metiche" })).toBe("habla miku");
    expect(port.posts).toEqual([]);
    expect(requests[0]!.messages[0]!.content).toContain("te metes como metiche");
  });
});
