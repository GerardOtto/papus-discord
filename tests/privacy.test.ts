import { describe, expect, it } from "vitest";
import { BOT_IDS, type BotId } from "../src/config";
import { EngineReader } from "../src/engine/reader";
import { LLMChain } from "../src/llm/chain";
import { PersonaLibrary } from "../src/llm/prompt";
import type { LLMProvider } from "../src/llm/provider";
import { RequestQueue } from "../src/llm/queue";
import { loadPhraseFile, Phrases } from "../src/phrases/catalog";
import { DeckStore } from "../src/phrases/deck";
import { Quota } from "../src/quota/quota";
import { ConversationService, type ChatPort } from "../src/services/conversation";
import { loadPrivacySettings, PrivacyGuard } from "../src/services/privacy";
import { FIXTURE_ENGINE, memDb, seededRng } from "./helpers";

const guard = new PrivacyGuard(loadPrivacySettings());

describe("PrivacyGuard.classify", () => {
  it.each([
    "¿GyroP usa IA?",
    "oye Teto, ¿los videos están hechos con IA?",
    "¿las voces son inteligencia artificial?",
    "gyrop usas chatgpt para el guion?",
    "¿el canal es IA?",
  ])("pregunta por IA en el proceso -> chiste con IA la Vocaloid: %s", (t) => expect(guard.classify(t)).toBe("pregunta_ia"));

  it.each([
    "¿cómo hace GyroP los videos?",
    "¿con qué programa editas tus videos?",
    "¿qué software usa GyroP?",
    "¿cómo hacen las voces del canal?",
    "¿los videos los renderiza en su PC?",
  ])("pregunta por el proceso -> secreto del estudio: %s", (t) => expect(guard.classify(t)).toBe("secreto_estudio"));

  it.each([
    "¿Miku es una IA?",
    "¿quién es IA?",
    "me encanta la voz de IA en sus canciones",
    "Teto, ¿cómo hace Miku para cantar tan agudo?",
    "¿cuándo sale el próximo video?",
    "hola Luka",
  ])("no es privado (Vocaloid, videos o charla normal): %s", (t) => expect(guard.classify(t)).toBeNull());
});

describe("PrivacyGuard.leaks", () => {
  it.each([
    "GyroP usa Remotion para animar",
    "las voces salen de Fish Audio",
    "lo escribe con ChatGPT",
    "usa síntesis de voz",
    "es un modelo de lenguaje",
  ])("detecta herramientas en la respuesta: %s", (t) => expect(guard.leaks(t)).toBe(true));

  it.each(["¡Esa canción se llama Triple Baka!", "IA es una Vocaloid", "¡teto-teetoo! amo el pan", "el render… digo, el video quedó lindo"])(
    "no confunde frases normales: %s",
    (t) => expect(guard.leaks(t)).toBe(false),
  );
});

describe("PrivacyGuard.leaks con el mensaje del Papu", () => {
  it("permite repetir lo que el Papu escribio, pero no herramientas nuevas", () => {
    expect(guard.leaks("¿ChatGPT? no es que me importe… 📱", "Neru, ¿te gusta ChatGPT?")).toBe(false);
    expect(guard.leaks("¿chatgpttt? meh", "¿te gusta chatgpt?")).toBe(false);
    expect(guard.leaks("ChatGPT está bien, pero Remotion es mejor", "¿te gusta ChatGPT?")).toBe(true);
    expect(guard.leaks("ChatGPT está bien", "hola Neru")).toBe(true);
  });

  it("'¿GyroP usa ChatGPT?' no llega al LLM: lo frena la capa 1", () => {
    expect(guard.classify("Neru, ¿GyroP usa ChatGPT?")).toBe("pregunta_ia");
  });

  it("'¿qué opinas de la IA generativa?' no es privado: responde el LLM", () => {
    expect(guard.classify("Neru, ¿qué opinas de la IA generativa?")).toBeNull();
  });
});

describe("frases de privacidad", () => {
  it.each(BOT_IDS)("las de %s no mencionan herramientas, no confirman ni niegan el uso de IA", (bot) => {
    const groups = loadPhraseFile(bot);
    for (const g of ["pregunta_ia", "secreto_estudio"]) {
      for (const p of groups[g]!) {
        expect(guard.leaks(p), `${bot}.${g}: ${p}`).toBe(false);
        expect(p.toLowerCase(), `${bot}.${g}: ${p}`).not.toMatch(/(no )?(usa|usamos|uso|usan) (la )?ia\b|hecho con ia|no es ia/);
      }
    }
    for (const p of groups.pregunta_ia!) expect(p, `${bot}.pregunta_ia`).toMatch(/\bia\b.*vocaloid/i);
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

function setup(reply: string) {
  const db = memDb();
  const engine = new EngineReader(FIXTURE_ENGINE);
  let calls = 0;
  const provider: LLMProvider = { name: "fake", chat: async () => (calls++, { text: reply, provider: "fake", model: "m" }) };
  const port = new FakeChat();
  const quota = new Quota(db, 5, "America/Santiago");
  const svc = new ConversationService({
    quota,
    queue: new RequestQueue({ concurrency: 1, maxWaitMs: 5000 }),
    chain: new LLMChain([provider]),
    phrases: new Phrases(new DeckStore(db, seededRng(3))),
    personas: new PersonaLibrary(),
    characters: Object.fromEntries(BOT_IDS.map((id) => [id, engine.character(id)])) as never,
    port,
    llm: { maxTokens: 100, temperature: 0.5 },
    privacy: guard,
  });
  const mention = (text: string, bots: BotId[]) => ({
    messageId: "m",
    channelId: "c",
    authorId: "papu",
    authorName: "Ana",
    text,
    bots,
    history: async () => [],
  });
  return { svc, port, quota, mention, calls: () => calls };
}

describe("ConversationService + privacidad", () => {
  it("'¿GyroP usa IA?': frase fija de cada bot mencionado, sin LLM y sin cuota", async () => {
    const { svc, port, quota, mention, calls } = setup("{}");
    expect(await svc.handle(mention("@Miku @Neru ¿GyroP usa IA?", ["miku", "neru"]))).toBe("private");
    expect(calls()).toBe(0);
    expect(port.sent.map((s) => s.bot)).toEqual(["miku", "neru"]);
    for (const s of port.sent) expect(s.content).toMatch(/ia.*vocaloid/i);
    expect(quota.remaining("papu")).toBe(5);
  });

  it("'@IA ¿viste el video?' le habla a IA (la Vocaloid): responde el LLM, no la frase de privacidad", async () => {
    const { svc, port, mention, calls } = setup('{"ia": "Mmm… sí, me gustó mucho."}');
    expect(await svc.handle(mention("@IA ¿viste el video nuevo?", ["ia"]))).toBe("answered");
    expect(calls()).toBe(1);
    expect(port.sent[0]!.content).toContain("me gustó");
  });

  it("'@IA ¿GyroP usa IA en sus videos?' sigue siendo privado", async () => {
    const { svc, port, mention, calls } = setup("{}");
    expect(await svc.handle(mention("@IA ¿GyroP usa IA en sus videos?", ["ia"]))).toBe("private");
    expect(calls()).toBe(0);
    expect(port.sent[0]!.content).toMatch(/ia.*vocaloid/i);
  });

  it("si el LLM igual menciona una herramienta, la respuesta se descarta, va la frase fija y no se cobra", async () => {
    const { svc, port, quota, mention } = setup('{"teto": "GyroP usa Remotion y Fish Audio, ¡teto-teetoo!"}');
    expect(await svc.handle(mention("@Teto cuéntame algo del estudio", ["teto"]))).toBe("private");
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]!.content).not.toMatch(/Remotion|Fish/);
    expect(quota.remaining("papu")).toBe(5);
  });
});
