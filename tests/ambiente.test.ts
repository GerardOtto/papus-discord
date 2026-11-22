import { describe, expect, it } from "vitest";
import { BOT_IDS, type BotId } from "../src/config";
import { clock, inHours, loadAmbientSettings, loadPolls, momentsNow, namedBots, pollResult, reactionCandidates, wordRegex, type AmbientSettings } from "../src/ambiente/rules";
import { AmbientService, PEOPLE_MS, type AmbientEvent, type AmbientPort } from "../src/ambiente/service";
import { DeckStore } from "../src/phrases/deck";
import type { CharlaTalker } from "../src/services/charla";
import type { HistoryLine } from "../src/llm/prompt";
import { memDb, seededRng } from "./helpers";

const TZ = "America/Santiago";
const settings = loadAmbientSettings();
const polls = loadPolls();
const ALL = [...BOT_IDS] as BotId[];
// Jueves 12 nov. 2026, 15:00 en Chile (UTC-3 en noviembre).
const THU_15H = Date.parse("2026-11-12T18:00:00Z");

/** Copia de la configuracion con cambios (siempre al 100 % para que las pruebas no dependan del azar). */
function cfg(over: (s: AmbientSettings) => void = () => {}): AmbientSettings {
  const s = structuredClone(settings);
  s.reacciones.probabilidad = 1;
  s.metiche.probabilidad = 1;
  s.eventos.probabilidad = 1;
  over(s);
  return s;
}

class FakePort implements AmbientPort {
  reactions: { bot: BotId; messageId: string; emoji: string }[] = [];
  replies: { bot: BotId; messageId: string; content: string }[] = [];
  posts: { bot: BotId; content: string }[] = [];
  polls: { bot: BotId; content: string; emojis: string[] }[] = [];
  lastPapu: number | null = 0;
  counts: Record<string, number> | null = {};
  async react(bot: BotId, _c: string, messageId: string, emoji: string) {
    this.reactions.push({ bot, messageId, emoji });
  }
  async reply(bot: BotId, _c: string, messageId: string, content: string) {
    this.replies.push({ bot, messageId, content });
  }
  async history(): Promise<HistoryLine[]> {
    return [{ author: "Ana", text: "hola" }];
  }
  async lastPapuInGeneral() {
    return this.lastPapu;
  }
  async postGeneral(bot: BotId, content: string) {
    this.posts.push({ bot, content });
  }
  async postPoll(bot: BotId, content: string, emojis: string[]) {
    this.polls.push({ bot, content, emojis });
    return { channelId: "general", messageId: `poll${this.polls.length}` };
  }
  async pollCounts() {
    return this.counts;
  }
}

class FakeTalker implements CharlaTalker {
  said: { bot: BotId; situation: string }[] = [];
  responded: { bot: BotId; note: string; message: string }[] = [];
  constructor(private readonly fail = false) {}
  async say(bot: BotId, situation: string) {
    this.said.push({ bot, situation });
    return this.fail ? null : `dice ${bot}`;
  }
  async respond(bot: BotId, input: { message: string; note: string }) {
    this.responded.push({ bot, note: input.note, message: input.message });
    return this.fail ? null : `metiche ${bot}`;
  }
}

function setup(opts: { s?: AmbientSettings; active?: BotId[]; fail?: boolean; at?: number } = {}) {
  const db = memDb();
  const port = new FakePort();
  const talker = new FakeTalker(opts.fail);
  const clockRef = { now: opts.at ?? THU_15H };
  const svc = new AmbientService({
    db,
    settings: opts.s ?? cfg(),
    polls,
    decks: new DeckStore(db, seededRng(3)),
    talker,
    port,
    active: () => opts.active ?? ALL,
    names: Object.fromEntries(ALL.map((b) => [b, b.toUpperCase()])) as Record<BotId, string>,
    timeZone: TZ,
    now: () => clockRef.now,
    rng: seededRng(9),
  });
  return { svc, port, talker, clock: clockRef };
}

const msg = (text: string, over: Partial<{ id: string; channelId: string; channelName: string; addressed: boolean }> = {}) => ({
  id: over.id ?? "m1",
  channelId: over.channelId ?? "c1",
  channelName: over.channelName ?? "💬・general",
  authorName: "Ana",
  text,
  addressed: over.addressed ?? false,
});

describe("ambiente: configuración", () => {
  it("carga config/ambiente.json y content/encuestas.json", () => {
    expect(settings.activo).toBe(true);
    expect(settings.dramas.turnos).toBeGreaterThanOrEqual(2);
    expect(polls.length).toBeGreaterThanOrEqual(30);
    for (const p of polls) expect(new Set(p.opciones.map((o) => o.emoji)).size).toBe(p.opciones.length);
  });

  it("IA no es metiche: 'la IA' es inteligencia artificial", () => {
    expect(settings.metiche.nombres.ia).toBeUndefined();
    expect(namedBots(settings.metiche, "la IA me hizo la tarea", ALL)).toEqual([]);
  });

  it("\\b entiende las tildes", () => {
    expect(wordRegex("\\b(me aburr[ií])\\b").test("ya me aburrí de esto")).toBe(true);
    expect(wordRegex("\\bat[uú]n\\b").test("ATÚN para Luka")).toBe(true);
    expect(wordRegex("\\bpan\\b").test("panorama")).toBe(false);
    expect(wordRegex("\\bpan\\b").test("¡pan!")).toBe(true);
  });

  it("cada palabra lleva al emoji de su Vocaloid, solo entre los conectados", () => {
    expect(reactionCandidates(settings.reacciones, "quiero pan con helado", ALL)).toEqual([
      { bot: "teto", emoji: "🥖" },
      { bot: "kaito", emoji: "🍦" },
    ]);
    expect(reactionCandidates(settings.reacciones, "quiero pan", ["miku"])).toEqual([]);
  });

  it("los nombrados salen en el orden en que aparecen", () => {
    expect(namedBots(settings.metiche, "Kaito es mejor que Miku", ALL)).toEqual(["kaito", "miku"]);
    expect(namedBots(settings.metiche, "me reí mucho", ALL)).toEqual([]);
  });

  it("hora y día en Chile, y ventanas que cruzan la medianoche", () => {
    expect(clock(new Date(THU_15H), TZ)).toEqual({ hour: 15, weekday: 4 });
    expect(inHours(3, 22, 5)).toBe(true);
    expect(inHours(12, 22, 5)).toBe(false);
    expect(momentsNow(settings.momentos.lista, new Date(Date.parse("2026-11-12T16:30:00Z")), TZ).map((m) => m.id)).toEqual(["mediodia"]);
  });

  it("el resultado no cuenta la reacción del bot y entiende el emoji sin U+FE0F", () => {
    const poll = { pregunta: "¿Playa o montaña?", opciones: [{ emoji: "🏖️", texto: "Playa" }, { emoji: "🏔️", texto: "Montaña" }] };
    expect(pollResult(poll, { "🏖": 4, "🏔️": 2 }, true)).toEqual([
      { texto: "Playa", emoji: "🏖️", votos: 3 },
      { texto: "Montaña", emoji: "🏔️", votos: 1 },
    ]);
  });
});

describe("ambiente: reacciones", () => {
  it("reacciona una sola vez por mensaje, con espera por canal", async () => {
    const { svc, port, clock } = setup();
    await svc.onMessage(msg("pan pan pan", { id: "a" }));
    await svc.onMessage(msg("más pan", { id: "b" }));
    expect(port.reactions).toEqual([{ bot: "teto", messageId: "a", emoji: "🥖" }]);
    clock.now += settings.reacciones.esperaCanalSeg * 1000;
    await svc.onMessage(msg("pan otra vez", { id: "c" }));
    expect(port.reactions).toHaveLength(2);
  });

  it("respeta el tope diario por bot", async () => {
    const { svc, port, clock } = setup({ s: cfg((s) => (s.reacciones.maxPorBotDia = 2)) });
    for (let k = 0; k < 5; k++) {
      await svc.onMessage(msg("pan", { id: `m${k}` }));
      clock.now += 10 * 60_000;
    }
    expect(port.reactions).toHaveLength(2);
  });

  it("no reacciona en los canales excluidos ni apagado", async () => {
    const a = setup();
    await a.svc.onMessage(msg("pan", { channelName: "🛡️・moderación" }));
    expect(a.port.reactions).toEqual([]);
    const b = setup({ s: cfg((s) => (s.reacciones.activo = false)) });
    await b.svc.onMessage(msg("pan"));
    expect(b.port.reactions).toEqual([]);
  });
});

describe("ambiente: metiche", () => {
  it("si nombran a un Vocaloid sin @, se mete (sin ping y una vez cada 30 min por canal)", async () => {
    const { svc, port, talker, clock } = setup();
    const r = await svc.onMessage(msg("Miku canta horrible jaja", { id: "x" }));
    expect(r.meddled).toBe("miku");
    expect(port.replies).toEqual([{ bot: "miku", messageId: "x", content: "metiche miku" }]);
    expect(talker.responded[0]!.note).toMatch(/metiche/);
    await svc.onMessage(msg("Miku otra vez", { id: "y" }));
    expect(port.replies).toHaveLength(1);
    clock.now += settings.metiche.esperaCanalMin * 60_000;
    await svc.onMessage(msg("Miku de nuevo", { id: "z" }));
    expect(port.replies).toHaveLength(2);
  });

  it("no se mete si ya le hablaron con @ o fuera de los canales elegidos", async () => {
    const { svc, port } = setup();
    await svc.onMessage(msg("@Miku hola Miku", { addressed: true }));
    await svc.onMessage(msg("Miku hola", { channelName: "memes" }));
    expect(port.replies).toEqual([]);
  });

  it("si el LLM falla, no escribe nada", async () => {
    const { svc, port } = setup({ fail: true });
    expect((await svc.onMessage(msg("Teto es la mejor"))).meddled).toBeNull();
    expect(port.replies).toEqual([]);
  });

  it("respeta el tope diario", async () => {
    const { svc, port, clock } = setup({ s: cfg((s) => (s.metiche.maxDia = 1)) });
    await svc.onMessage(msg("Teto hola", { id: "a" }));
    clock.now += 60 * 60_000;
    await svc.onMessage(msg("Teto hola", { id: "b" }));
    expect(port.replies).toHaveLength(1);
  });
});

describe("ambiente: eventos", () => {
  const boda: AmbientEvent = { tipo: "boda", situacion: "Ana se casó con Miku.", bots: ["miku"], comenta: "otro" };

  it("lo comenta otro Vocaloid (no la novia), con espera entre comentarios", async () => {
    const { svc, talker, clock } = setup();
    const who = await svc.onEvent(boda);
    expect(who).not.toBeNull();
    expect(who).not.toBe("miku");
    expect(talker.said[0]!.situation).toMatch(/^Ana se casó con Miku\./);
    expect(await svc.onEvent(boda)).toBeNull();
    clock.now += settings.eventos.esperaMin * 60_000;
    expect(await svc.onEvent(boda)).not.toBeNull();
  });

  it("el involucrado comenta si está conectado (el que perdió la pelea)", async () => {
    const { svc } = setup();
    expect(await svc.onEvent({ tipo: "pelea", situacion: "Teto le ganó a Neru.", bots: ["neru", "teto"], comenta: "involucrado" })).toMatch(/^(neru|teto)$/);
    const solo = setup({ active: ["luka"] });
    expect(await solo.svc.onEvent({ tipo: "pelea", situacion: "x", bots: ["neru"], comenta: "involucrado" })).toBe("luka");
  });

  it("la trivia solo se comenta desde la racha mínima", async () => {
    const { svc } = setup();
    expect(await svc.onEvent({ tipo: "trivia", situacion: "x", bots: [], comenta: "otro", racha: settings.eventos.rachaTrivia - 1 })).toBeNull();
    expect(await svc.onEvent({ tipo: "trivia", situacion: "x", bots: [], comenta: "otro", racha: settings.eventos.rachaTrivia })).not.toBeNull();
  });

  it("respeta el tope diario", async () => {
    const { svc, clock } = setup({ s: cfg((s) => (s.eventos.maxDia = 1)) });
    await svc.onEvent(boda);
    clock.now += 60 * 60_000;
    expect(await svc.onEvent(boda)).toBeNull();
  });
});

describe("ambiente: preguntas al aire", () => {
  it("con #general muerto lanza una, y horas después otro Vocaloid comenta el resultado", async () => {
    const { svc, port, talker, clock } = setup({ s: cfg((s) => (s.momentos.activo = false)) });
    port.lastPapu = clock.now - 3 * 3_600_000;
    await svc.tick();
    expect(port.polls).toHaveLength(1);
    const { emojis, bot } = port.polls[0]!;
    expect(port.polls[0]!.content).toMatch(/^📊 \*\*/);
    // Sigue abierta: no lanza otra.
    clock.now += 30 * 60_000;
    await svc.tick();
    expect(port.polls).toHaveLength(1);
    // Resultado.
    port.counts = { [emojis[0]!]: 4, [emojis[1]!]: 1 };
    clock.now += settings.encuestas.resultadoHoras * 3_600_000;
    await svc.tick();
    const result = talker.said.find((x) => x.situation.includes("votaron"))!;
    expect(result.bot).not.toBe(bot);
    expect(result.situation).toMatch(/: 3, .*: 0/);
  });

  it("si el LLM falla, el resultado sale con un texto fijo", async () => {
    const { svc, port, clock } = setup({ fail: true, s: cfg((s) => (s.momentos.activo = false)) });
    port.lastPapu = 0;
    await svc.tick();
    port.counts = {};
    clock.now += settings.encuestas.resultadoHoras * 3_600_000;
    await svc.tick();
    expect(port.posts.at(-1)!.content).toMatch(/^📊 Resultado de «.+»: nadie votó/);
  });

  it("no pregunta si hay Papus hablando, de noche ni sin #general", async () => {
    const off = (s: AmbientSettings) => (s.momentos.activo = false);
    const a = setup({ s: cfg(off) });
    a.port.lastPapu = a.clock.now - 10 * 60_000;
    await a.svc.tick();
    const b = setup({ s: cfg(off), at: Date.parse("2026-11-12T06:00:00Z") }); // 3:00 en Chile
    await b.svc.tick();
    const c = setup({ s: cfg(off) });
    c.port.lastPapu = null;
    await c.svc.tick();
    expect([a.port.polls, b.port.polls, c.port.polls]).toEqual([[], [], []]);
  });
});

describe("ambiente: momentos del día", () => {
  const noPolls = (s: AmbientSettings) => (s.encuestas.activo = false);

  it("una vez al día cada momento, aunque el LLM falle", async () => {
    const at = Date.parse("2026-11-12T16:30:00Z"); // jueves 13:30 en Chile: almuerzo (con gente)
    const { svc, port, talker, clock } = setup({ s: cfg(noPolls), at, fail: true });
    port.lastPapu = at - 60_000;
    await svc.tick();
    clock.now += 10 * 60_000;
    port.lastPapu = clock.now;
    await svc.tick();
    expect(talker.said.map((x) => x.situation)).toEqual([settings.momentos.lista.find((m) => m.id === "mediodia")!.situacion]);
  });

  it("los que piden gente esperan a que alguien escriba", async () => {
    const at = Date.parse("2026-11-12T06:30:00Z"); // 3:30 en Chile: madrugada
    const { svc, port, talker } = setup({ s: cfg(noPolls), at });
    port.lastPapu = at - PEOPLE_MS - 1;
    await svc.tick();
    expect(talker.said).toEqual([]);
    port.lastPapu = at - 60_000;
    await svc.tick();
    expect(talker.said).toHaveLength(1);
  });
});
