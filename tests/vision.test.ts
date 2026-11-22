// Ver imagenes (PLAN §5.1): achicar, elegir el adjunto, formato de OpenAI, prompt, tope diario y cobro en la conversacion.
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { BOT_IDS, type BotId } from "../src/config";
import { EngineReader } from "../src/engine/reader";
import { LLMChain } from "../src/llm/chain";
import { fitSize, pickImage, shrinkImage, type ImageAttachment } from "../src/llm/image";
import { toWire } from "../src/llm/openai-compatible";
import { buildRequest, HIDDEN_IMAGE_NOTE, IMAGE_NOTE, PersonaLibrary } from "../src/llm/prompt";
import { LLMError, type ChatRequest, type LLMProvider } from "../src/llm/provider";
import { RequestQueue } from "../src/llm/queue";
import { Phrases } from "../src/phrases/catalog";
import { DeckStore } from "../src/phrases/deck";
import { ImageAllowance } from "../src/quota/imagenes";
import { Quota } from "../src/quota/quota";
import { ConversationService, type ChatPort, type IncomingMention } from "../src/services/conversation";
import { FIXTURE_ENGINE, memDb, seededRng } from "./helpers";

const engine = new EngineReader(FIXTURE_ENGINE);
const characters = Object.fromEntries(BOT_IDS.map((id) => [id, engine.character(id)])) as Record<BotId, ReturnType<EngineReader["character"]>>;
const TZ = "America/Santiago";
const IMG: ImageAttachment = { url: "https://cdn.discordapp.com/x.png", contentType: "image/png", size: 1000 };

describe("imagenes: preparar", () => {
  it("fitSize achica al lado maximo sin agrandar", () => {
    expect(fitSize(2000, 1000, 768)).toEqual({ width: 768, height: 384 });
    expect(fitSize(500, 300, 768)).toEqual({ width: 500, height: 300 });
  });

  it("pickImage toma la primera imagen conocida y no muy pesada", () => {
    const list: ImageAttachment[] = [
      { url: "a.pdf", contentType: "application/pdf", size: 10 },
      { url: "b.png", contentType: "image/png", size: 30 * 1024 * 1024 },
      { url: "c.webp", contentType: "image/webp", size: 10 },
    ];
    expect(pickImage(list, 15)?.url).toBe("c.webp");
    expect(pickImage([{ url: "v.mp4", contentType: "video/mp4", size: 1 }], 15)).toBeNull();
    expect(pickImage([{ url: "x", contentType: null, size: 1 }], 15)).toBeNull();
  });

  it("shrinkImage devuelve un JPEG achicado y null si no es imagen", async () => {
    const c = createCanvas(1600, 800);
    c.getContext("2d").fillRect(0, 0, 10, 10);
    const url = await shrinkImage(c.toBuffer("image/png"), 768);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(await shrinkImage(Buffer.from("no soy una imagen"), 768)).toBeNull();
  });
});

describe("imagenes: formato y prompt", () => {
  it("toWire manda la imagen como partes de OpenAI y deja igual el texto solo", () => {
    expect(toWire({ role: "user", content: "hola" })).toEqual({ role: "user", content: "hola" });
    expect(toWire({ role: "user", content: "mira", images: ["data:image/jpeg;base64,AA"] })).toEqual({
      role: "user",
      content: [
        { type: "text", text: "mira" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AA" } },
      ],
    });
  });

  const base = { characters: [characters.teto], papuName: "Ana", message: "@Teto mira mi dibujo", history: [] };
  it("con imagen: va adjunta y con la nota de como mirarla", () => {
    const req = buildRequest({ ...base, image: "data:image/jpeg;base64,AA" }, new PersonaLibrary());
    expect(req.messages[1]!.images).toEqual(["data:image/jpeg;base64,AA"]);
    expect(req.messages[0]!.content).toContain(IMAGE_NOTE);
  });

  it("oculta: sin adjunto y con la nota de no inventar; sin imagen, ninguna nota", () => {
    const hidden = buildRequest({ ...base, image: "oculta" }, new PersonaLibrary());
    expect(hidden.messages[1]!.images).toBeUndefined();
    expect(hidden.messages[0]!.content).toContain(HIDDEN_IMAGE_NOTE);
    const none = buildRequest(base, new PersonaLibrary());
    expect(none.messages[0]!.content).not.toContain(IMAGE_NOTE);
    expect(none.messages[0]!.content).not.toContain(HIDDEN_IMAGE_NOTE);
  });
});

describe("ImageAllowance", () => {
  it("tope diario, devolucion y sin tope para GyroP", () => {
    const a = new ImageAllowance(memDb(), 2, TZ, new Set(["gyro"]));
    const d1 = a.take("ana");
    expect(d1).not.toBeNull();
    expect(a.take("ana")).not.toBeNull();
    expect(a.take("ana")).toBeNull();
    expect(a.remaining("ana")).toBe(0);
    a.refund("ana", d1!);
    expect(a.remaining("ana")).toBe(1);
    for (let i = 0; i < 5; i++) expect(a.take("gyro")).not.toBeNull();
    expect(a.remaining("gyro")).toBe(Number.POSITIVE_INFINITY);
  });
});

class FakeChat implements ChatPort {
  sent: { bot: BotId; content: string }[] = [];
  async reply(bot: BotId, _c: string, _r: string, content: string) {
    this.sent.push({ bot, content });
  }
  typing() {
    return () => {};
  }
  async react() {}
}

/** Proveedor que anota lo que recibe: si vio una imagen y que respondio. */
function recorder(name: string, text: string | (() => never)) {
  const seen: ChatRequest[] = [];
  const p: LLMProvider = {
    name,
    chat: async (req) => {
      seen.push(req);
      if (typeof text !== "string") text();
      return { text: text as string, provider: name, model: "m" };
    },
  };
  return { p, seen };
}

function setup(opts: { quota?: number; vision?: LLMProvider; load?: () => Promise<string | null> } = {}) {
  const db = memDb();
  const port = new FakeChat();
  const quota = new Quota(db, opts.quota ?? 5, TZ);
  const allowance = new ImageAllowance(db, 2, TZ);
  const text = recorder("texto", '{"teto": "¡Qué lindo!", "miku": "¡¿QUÉ?! Me encanta"}');
  const vision = opts.vision ?? recorder("vision", '{"teto": "¡Ese dibujo tiene mis taladros!", "miku": "¡Precioso!"}').p;
  const svc = new ConversationService({
    quota,
    queue: new RequestQueue({ concurrency: 1, maxWaitMs: 5000 }),
    chain: new LLMChain([text.p]),
    phrases: new Phrases(new DeckStore(db, seededRng(1))),
    personas: new PersonaLibrary(),
    characters,
    port,
    llm: { maxTokens: 300, temperature: 0.9 },
    vision: { chain: new LLMChain([vision]), allowance, extraUnits: 1, load: opts.load ?? (async () => "data:image/jpeg;base64,AA") },
  });
  return { svc, port, quota, allowance, text };
}

const mention = (bots: BotId[], image: ImageAttachment | null = IMG): IncomingMention => ({
  messageId: "m1",
  channelId: "c1",
  authorId: "ana",
  authorName: "Ana",
  text: "@Teto mira mi dibujo",
  bots,
  history: async () => [],
  image,
});

describe("ConversationService con imagenes", () => {
  it("la mira la cadena de vision y cobra 1 mensaje mas, una sola vez aunque haya varios @", async () => {
    const { svc, port, quota, allowance, text } = setup();
    expect(await svc.handle(mention(["teto", "miku"]))).toBe("answered");
    expect(text.seen).toHaveLength(0);
    expect(quota.used("ana")).toBe(3);
    expect(allowance.used("ana")).toBe(1);
    expect(port.sent[0]!.content).toContain("¡Ese dibujo tiene mis taladros!");
    expect(port.sent[0]!.content).toContain("-# 🖼️ Hoy te queda 1 imagen");
    expect(port.sent[1]!.content).not.toContain("🖼️");
  });

  it("sin imagen todo sigue igual: cadena de texto y sin nota", async () => {
    const { svc, port, quota, text } = setup();
    expect(await svc.handle(mention(["teto"], null))).toBe("answered");
    expect(text.seen).toHaveLength(1);
    expect(quota.used("ana")).toBe(1);
    expect(port.sent[0]!.content).toBe("¡Qué lindo!");
  });

  it("con el tope del dia lleno responde sin verla (sin inventar) y no cobra la imagen", async () => {
    const { svc, port, quota, allowance, text } = setup();
    allowance.take("ana");
    allowance.take("ana");
    expect(await svc.handle(mention(["teto"]))).toBe("answered");
    expect(text.seen[0]!.messages[0]!.content).toContain(HIDDEN_IMAGE_NOTE);
    expect(text.seen[0]!.messages[1]!.images).toBeUndefined();
    expect(quota.used("ana")).toBe(1);
    expect(port.sent[0]!.content).toContain("el máximo del día");
  });

  it("sin cuota para la imagen: responde con el mensaje que le queda y avisa", async () => {
    const { svc, port, quota, allowance } = setup({ quota: 1 });
    expect(await svc.handle(mention(["teto"]))).toBe("answered");
    expect(quota.used("ana")).toBe(1);
    expect(allowance.used("ana")).toBe(0);
    expect(port.sent[0]!.content).toContain("no te alcanza");
  });

  it("si la vision falla, responde la cadena de texto sin la imagen y devuelve lo de la imagen", async () => {
    const down = recorder("vision", () => {
      throw new LLMError("caida", "vision");
    });
    const { svc, port, quota, allowance, text } = setup({ vision: down.p });
    expect(await svc.handle(mention(["teto"]))).toBe("answered");
    expect(text.seen[0]!.messages[0]!.content).toContain(HIDDEN_IMAGE_NOTE);
    expect(quota.used("ana")).toBe(1);
    expect(allowance.used("ana")).toBe(0);
    expect(port.sent[0]!.content).toContain("no se te cobró");
  });

  it("si no se pudo bajar la imagen, igual: sin cobro de la imagen", async () => {
    const { svc, quota, allowance, text } = setup({ load: async () => null });
    expect(await svc.handle(mention(["teto"]))).toBe("answered");
    expect(text.seen).toHaveLength(1);
    expect(quota.used("ana")).toBe(1);
    expect(allowance.used("ana")).toBe(0);
  });

  it("si nadie responde, devuelve la cuota y la imagen", async () => {
    const down = recorder("vision", () => {
      throw new LLMError("caida", "vision");
    });
    const db = setup({ vision: down.p });
    // La cadena de texto tambien falla.
    (db.text.p as { chat: LLMProvider["chat"] }).chat = async () => {
      throw new LLMError("caida", "texto");
    };
    expect(await db.svc.handle(mention(["teto"]))).toBe("failed");
    expect(db.quota.used("ana")).toBe(0);
    expect(db.allowance.used("ana")).toBe(0);
  });
});
