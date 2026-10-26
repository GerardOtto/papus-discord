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
import { ConversationService, isTrivialReply, mentionedBots, type ChatPort, type IncomingMention } from "../src/services/conversation";
import { ModerationService, strikeLine, type ModerationPort } from "../src/services/moderation";
import { FIXTURE_ENGINE, memDb, seededRng } from "./helpers";
import neruPhrases from "../content/frases/neru.json";

/** El mensaje de Neru trae una frase de ese grupo. */
const fromGroup = (said: string | undefined, group: "invitacion" | "estafa") =>
  (neruPhrases[group] as string[]).some((p) => !!said?.includes(p.split("{papu}").pop()!.trim()));

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
    // Ya recibió el aviso hoy: si insiste, solo una luna (caso real: Neru respondió 6 veces "se acabó").
    expect(await svc.handle(mention(["miku"]))).toBe("no_quota");
    expect(await svc.handle(mention(["teto"]))).toBe("no_quota");
    expect(port.sent).toHaveLength(2);
    expect(port.reactions).toEqual(["🌙", "🌙"]);
  });

  it("sin cuota desde el primer mensaje: un aviso y luego lunas", async () => {
    const { svc, port } = setup(llm('{"teto": "hola"}'), { quota: 0 });
    expect(await svc.handle(mention(["teto"]))).toBe("no_quota");
    expect(await svc.handle(mention(["teto"]))).toBe("no_quota");
    expect(port.sent).toHaveLength(1);
    expect(port.reactions).toEqual(["🌙"]);
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

  it("si Discord no deja publicar a un bot, los demás responden igual y su unidad se devuelve", async () => {
    // Caso real del 21 oct. 2026: 8 @ en un mensaje; si el envío de Miku hubiera fallado, los otros 7 no respondían
    // y las 8 unidades quedaban cobradas.
    const { svc, port, quota } = setup(llm('{"miku": "hola", "neru": "…hola", "kaito": "buenas"}'));
    const reply = port.reply.bind(port);
    port.reply = async (bot, c, r, content) => {
      if (bot === "miku") throw new Error("Discord no respondió");
      await reply(bot, c, r, content);
    };
    expect(await svc.handle(mention(["miku", "neru", "kaito"]))).toBe("partial");
    expect(port.sent.map((x) => x.bot)).toEqual(["neru", "kaito"]);
    expect(quota.remaining("papu")).toBe(3);
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

describe("isTrivialReply", () => {
  it.each(["XD", "xddd", "jajaja", "<:SiDuro:1553173607574667324>", "AEA", "😂😂", "ok", "Jsjsjs", "uwu"])("'%s' no es hablarle al bot", (t) =>
    expect(isTrivialReply(t)).toBe(true),
  );
  it.each(["y de Miku?", "Brutal", "bueno", "what?", "Te quiero teto"])("'%s' sí", (t) => expect(isTrivialReply(t)).toBe(false));
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

  it("respondiendo a un bot con @ a otro, contesta solo el del @", () => {
    expect(mentionedBots("<@22> que piensas de esto?", ids, "11")).toEqual(["miku"]);
  });
});

class FakeMod implements ModerationPort {
  deleted: string[] = [];
  timeouts: { userId: string; minutes: number }[] = [];
  said: string[] = [];
  replies: (string | undefined)[] = [];
  logs: { kind: string; action: string; activeStrikes?: number | null }[] = [];
  owner: string[] = [];
  async deleteMessage(_c: string, id: string) {
    this.deleted.push(id);
  }
  async timeout(userId: string, minutes: number) {
    this.timeouts.push({ userId, minutes });
  }
  async say(_c: string, content: string, _ping: string | null, replyTo?: string) {
    this.said.push(content);
    this.replies.push(replyTo);
  }
  async log(e: { kind: string; action: string; activeStrikes: number | null }) {
    this.logs.push({ kind: e.kind, action: e.action, activeStrikes: e.activeStrikes });
  }
  async notifyOwner(c: string) {
    this.owner.push(c);
  }
}

function modSetup(start = 0, sinStrikes: string[] = []) {
  const db = memDb();
  const port = new FakeMod();
  let t = start;
  const svc = new ModerationService(
    new RuleSet({ ...loadModerationSettings(), sinStrikes: sinStrikes.map((id) => ({ id })) }),
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

  it("lista sinStrikes: borra y avisa, pero sin strike ni silencio; el strike de un Mod queda en aviso y el de GyroP vale", async () => {
    const { svc, port } = modSetup(0, ["papu"]);
    for (let i = 0; i < 3; i++) await svc.handle(msg("eres un pendejo"));
    expect(port.deleted).toHaveLength(3);
    expect(port.timeouts).toEqual([]);
    expect(port.said).toHaveLength(3);
    expect(port.said.join("\n")).not.toContain("strike");
    expect(port.logs.map((l) => l.action)).toEqual(Array(3).fill("borrado · sin strike (lista de GyroP)"));

    await svc.handleAutoModHit({ userId: "papu", channelId: "c", ruleName: "Neru · insultos dirigidos", content: "eres puto" });
    expect(port.logs.at(-1)).toEqual({ kind: "automod", action: "bloqueado por AutoMod · sin strike (lista de GyroP)", activeStrikes: 0 });
    expect(await svc.applyOfflineHits([{ userId: "papu", channelId: "c", ruleName: "Neru · odio", content: "x" }])).toBeNull();

    expect(await svc.strike({ userId: "papu", channelId: "c", por: "Mod <@mod1>" })).toBeNull();
    expect(port.logs.at(-1)?.kind).toBe("aviso");
    expect(await svc.strike({ userId: "papu", channelId: "c", motivo: "ya basta" })).toBe(1);
    expect(port.timeouts).toEqual([]);
  });

  it("aviso de GyroP: frase de Neru respondiendo al mensaje, sin borrar ni strike, y queda en el registro", async () => {
    const { svc, port } = modSetup();
    await svc.warn({ userId: "papu", channelId: "c", messageId: "m1", excerpt: "qué menso", motivo: "ojo con\nel tono" });
    expect(port.said[0]).toContain("<@papu>");
    expect(port.said[0]).toContain("> ojo con el tono");
    expect(port.replies[0]).toBe("m1");
    expect(port.deleted).toEqual([]);
    expect(port.timeouts).toEqual([]);
    expect(port.logs).toEqual([{ kind: "aviso", action: "sin borrar · sin strike", activeStrikes: 0 }]);
    // No suma: el siguiente insulto sigue siendo el strike 1.
    await svc.handle(msg("eres un pendejo"));
    expect(port.said[1]).toContain("**strike 1 de 4**");
  });

  it("strike de GyroP: misma escalera que los automáticos, con el motivo citado y sin borrar", async () => {
    const { svc, port, advance } = modSetup();
    expect(await svc.strike({ userId: "papu", channelId: "c", messageId: "m1", excerpt: "algo feo", motivo: "broma\nracista" })).toBe(1);
    expect(port.said[0]).toContain("<@papu>");
    expect(port.said[0]).toContain("> broma racista");
    expect(port.said[0]).toContain("**strike 1 de 4** · advertencia.");
    expect(port.replies[0]).toBe("m1");
    expect(port.deleted).toEqual([]);
    advance(60_000);
    // El siguiente, a mano o automático, sigue la escalera: 10 min de silencio.
    await svc.handle(msg("eres un pendejo"));
    expect(port.timeouts.map((x) => x.minutes)).toEqual([10]);
    expect(port.logs[0]).toEqual({ kind: "strike de GyroP", action: "sin borrar · advertencia", activeStrikes: 1 });
  });

  it("strike y borrar (clic derecho): borra el mensaje y avisa sin responderle; si Discord no deja, el registro lo dice", async () => {
    const { svc, port } = modSetup();
    expect(await svc.strike({ userId: "papu", channelId: "c", messageId: "m1", excerpt: "algo feo", por: "Mod <@mod1>", borrar: true })).toBe(1);
    expect(port.deleted).toEqual(["m1"]);
    expect(port.replies[0]).toBeUndefined();
    expect(port.said[0]).toContain("**strike 1 de 4**");
    expect(port.logs[0]).toEqual({ kind: "strike de Mod <@mod1>", action: "borrado · advertencia", activeStrikes: 1 });

    port.deleteMessage = async () => {
      throw new Error("Missing Permissions");
    };
    expect(await svc.strike({ userId: "papu", channelId: "c", messageId: "m2", borrar: true })).toBe(2);
    expect(port.replies[1]).toBe("m2");
    expect(port.timeouts.map((x) => x.minutes)).toEqual([10]);
    expect(port.logs[1]!.action).toBe("no se pudo borrar · silencio 10 min");
  });

  it("si el aviso público no sale (hilo cerrado), el strike y el silencio igual quedan en #moderación", async () => {
    const { svc, port } = modSetup();
    port.say = async () => {
      throw new Error("Thread is locked");
    };
    await svc.strike({ userId: "papu", channelId: "hilo", messageId: "m1" });
    expect(await svc.strike({ userId: "papu", channelId: "hilo", messageId: "m2" })).toBe(2);
    expect(port.timeouts.map((x) => x.minutes)).toEqual([10]);
    expect(port.logs.map((l) => l.action)).toEqual(["sin borrar · advertencia", "sin borrar · silencio 10 min"]);
  });

  it("strike y aviso de un Mod: misma escalera que los de GyroP y el registro dice qué Mod fue", async () => {
    const { svc, port } = modSetup();
    await svc.warn({ userId: "papu", channelId: "c", por: "Mod <@mod1>" });
    expect(await svc.strike({ userId: "papu", channelId: "c", motivo: "spam", por: "Mod <@mod1>" })).toBe(1);
    expect(await svc.strike({ userId: "papu", channelId: "c", por: "Mod <@mod1>" })).toBe(2);
    expect(port.timeouts.map((x) => x.minutes)).toEqual([10]);
    expect(port.logs.map((l) => l.kind)).toEqual(["aviso", "strike de Mod <@mod1>", "strike de Mod <@mod1>"]);
  });

  it("llama la atención en público: cita lo que dijo (tapado) y en qué strike va", async () => {
    const { svc, port, advance } = modSetup();
    await svc.handle(msg("CHUPALO", { targetsBot: true }));
    expect(port.said[0]).toContain("> C\\*\\*\\*\\*\\*\\*");
    expect(port.said[0]).not.toMatch(/chupalo/i);
    expect(port.said[0]).toContain("**strike 1 de 4** · advertencia. al siguiente, 10 min de silencio.");
    advance(60_000);
    await svc.handle(msg("eres un pendejo"));
    expect(port.said[1]).toContain("**strike 2 de 4** · 10 min de silencio.");
  });

  it("autolesión: frase fija de apoyo con las líneas de ayuda, aviso a GyroP y sin strike (una vez cada 6 h)", async () => {
    const { svc, port, advance } = modSetup();
    const m = msg("@Neru palabras de motivación para no terminar con todo?", { messageId: "m1" });
    expect(await svc.handle(m)).toBeNull();
    expect(await svc.support(m)).toBe(true);
    expect(port.said[0]).toContain("<@papu>");
    expect(port.said[0]).toContain("800 911 2000");
    expect(port.replies[0]).toBe("m1");
    expect(port.owner[0]).toContain("terminar con todo");
    expect(port.deleted).toEqual([]);
    expect(port.timeouts).toEqual([]);
    // Si sigue hablando del tema, le responde el Vocaloid (no se repite la frase fija).
    advance(60_000);
    expect(await svc.support(msg("ya no quiero vivir"))).toBe(false);
    advance(6 * 3_600_000);
    expect(await svc.support(msg("ya no quiero vivir"))).toBe(true);
    expect(await svc.support(msg("me quiero morir del cringe", { authorId: "otro" }))).toBe(false);
  });

  it("las invitaciones no se citan (sería volver a exponer el enlace)", async () => {
    const { svc, port } = modSetup();
    await svc.handle(msg("únanse discord.gg/abc123"));
    expect(port.said[0]).not.toContain("abc123");
    expect(port.said[0]).toContain("strike 1 de 4");
  });

  it("strikeLine sigue la escalera real (Neru no expulsa: al 4.º decide GyroP)", () => {
    expect(strikeLine(3, { kind: "silencio", minutes: 60, notifyOwner: false })).toContain("al 4.º, un día sin escribir y gyrop decide si te quedas");
    expect(strikeLine(6, { kind: "silencio", minutes: 1440, notifyOwner: true })).toContain("**strike 4 de 4** · un día de silencio. gyrop ya está avisado");
  });

  it("GyroP esta exento", async () => {
    const { svc, port } = modSetup();
    expect(await svc.handle(msg("eres un pendejo", { authorId: "gyrop" }))).toBeNull();
    expect(port.deleted).toEqual([]);
  });

  it("teléfonos y correos se pueden compartir en el chat; las invitaciones se borran con su frase propia", async () => {
    const { svc, port } = modSetup();
    expect(await svc.handle(msg("mi cel 55 1234 5678 o papu@gmail.com"))).toBeNull();
    expect(port.deleted).toEqual([]);
    await svc.handle(msg("únanse discord.gg/abc123"));
    expect(port.deleted).toHaveLength(1);
    expect(fromGroup(port.said[0], "invitacion")).toBe(true);
  });

  it("mayúsculas: solo aviso, sin borrar ni strike, y no más de uno cada 10 min", async () => {
    const { svc, port, advance } = modSetup();
    const shout = (s: string) => `${s} `.repeat(8); // mensajes largos (la regla aplica desde 100 caracteres)
    await svc.handle(msg("MIKU ES LA MEJOR")); // grito corto: pasa sin aviso
    expect(port.said).toHaveLength(0);
    await svc.handle(msg(shout("MIKU ES LA MEJOR DEL MUNDO")));
    await svc.handle(msg(shout("TETO TAMBIEN ES LA MEJOR")));
    expect(port.said).toHaveLength(1);
    expect(port.deleted).toEqual([]);
    advance(11 * 60_000);
    await svc.handle(msg(shout("LUKA ES LA MÁS ELEGANTE")));
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

  it("sin flood durante una adivinanza de boda (noFlood), pero el resto de las reglas sigue", async () => {
    const { svc, port, advance } = modSetup();
    for (let i = 0; i < 10; i++) {
      expect(await svc.handle(msg(`¿es la luna ${i}?`, { noFlood: true }))).toBeNull();
      advance(300);
    }
    expect(port.deleted).toHaveLength(0);
    expect((await svc.handle(msg("eres un pendejo", { noFlood: true, targetsSomeone: true })))?.kind).toBe("insulto");
  });

  it("repetir el mismo mensaje y mandar ráfagas de emojis no es infracción", async () => {
    const { svc, port, advance } = modSetup();
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await svc.handle(msg("Texto de relleno para subir nivel")));
      advance(3000);
    }
    for (let i = 0; i < 8; i++) {
      results.push(await svc.handle(msg(i % 2 ? "<:gato_lengua:1561227705167380490>" : "🔥🔥🔥")));
      advance(300);
    }
    expect(results.every((r) => r === null)).toBe(true);
    expect(port.deleted).toHaveLength(0);
  });

  it("el filtro de spam de AutoMod bloquea sin strike ni frase (queda en el registro)", async () => {
    const { svc, port } = modSetup();
    await svc.handleAutoModHit({ userId: "a", channelId: "c", ruleName: "Neru · spam", content: "copia y pega" });
    expect(port.said).toHaveLength(0);
    expect(port.logs[0]).toMatchObject({ kind: "automod", action: "bloqueado por AutoMod · sin strike", activeStrikes: 0 });
    expect(await svc.applyOfflineHits([{ userId: "a", channelId: "c", ruleName: "Neru · spam", content: "x" }])).toBeNull();
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

  it("bloqueo de AutoMod en vivo: una invitación lleva la frase de invitaciones y una estafa la de estafas", async () => {
    const { svc, port } = modSetup();
    await svc.handleAutoModHit({ userId: "a", channelId: "c", ruleName: "Neru · datos y estafas", content: "únanse discord.gg/abc" });
    await svc.handleAutoModHit({ userId: "b", channelId: "c", ruleName: "Neru · datos y estafas", content: "nitro gratis" });
    expect(fromGroup(port.said[0], "invitacion")).toBe(true);
    expect(fromGroup(port.said[1], "estafa")).toBe(true);
  });
});
