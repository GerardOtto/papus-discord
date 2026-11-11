import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { loadLayout } from "../src/setup/layout";
import { loadRiddles, loadWeddingSettings } from "../src/bodas/rules";
import { WeddingService } from "../src/bodas/service";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { loadLevelSettings } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { DeckStore } from "../src/phrases/deck";
import { Quota } from "../src/quota/quota";
import { loadRouletteSettings } from "../src/ruleta/rules";
import { RouletteService } from "../src/ruleta/service";
import { DayStats, papuText, serverText } from "../src/services/estadisticas";
import { loadMangoSettings, MangoService, mentionsUser, pardonedFromLog } from "../src/services/mango";
import { loadTriviaSettings, type Question } from "../src/trivia/rules";
import { TriviaService } from "../src/trivia/service";
import { BASE_ENV, memDb, seededRng } from "./helpers";


describe("Mango9374", () => {
  it("sus frases salen de config/mango.json", () => {
    const s = loadMangoSettings();
    expect(s.nombre).toBe("Mango9374");
    expect(s.frases).toEqual(["Sea serio ve", "Poco serio ve", "See you in the next reel, tetolovers"]);
    expect(s.probabilidadFrase).toBeCloseTo(1 / 3, 3);
  });

  it("sin límite: a un Papu le da sus números, y 1 de cada 3 veces (más o menos) una frase", () => {
    const settings = loadMangoSettings();
    const m = new MangoService(settings, seededRng(7));
    const answers = Array.from({ length: 600 }, () => m.answer(false));
    const frases = answers.filter((a) => a.kind === "frase");
    expect(answers.every((a) => a.kind === "frase" || a.kind === "numeros")).toBe(true);
    expect(frases.length / answers.length).toBeGreaterThan(0.25);
    expect(frases.length / answers.length).toBeLessThan(0.42);
    expect(new Set(frases.map((a) => (a as { text: string }).text))).toEqual(new Set(settings.frases));
  });

  it("a GyroP siempre le da los totales", () => {
    const m = new MangoService(loadMangoSettings(), () => 0);
    for (let i = 0; i < 5; i++) expect(m.answer(true)).toEqual({ kind: "totales" });
  });

  it("solo cuenta el @ a él", () => {
    expect(mentionsUser("hola <@111> y <@!222>", "222")).toBe(true);
    expect(mentionsUser("hola <@111>", "222")).toBe(false);
    expect(mentionsUser("mango9374 sea serio", "222")).toBe(false);
  });

  it("token opcional", () => {
    expect(loadConfig({ ...BASE_ENV }).mangoToken).toBeNull();
    const c = loadConfig({ ...BASE_ENV, DISCORD_TOKEN_MANGO9374: "x" });
    expect(c.mangoToken).toBe("x");
    expect(c.activeBots).not.toContain("mango9374");
  });
});

describe("números del día de Mango (GyroP, 31 oct. 2026)", () => {
  const TZ = "America/Santiago";
  const NOON = Date.parse("2026-10-31T12:00:00-03:00");

  function setup() {
    const db = memDb();
    const levels = new LevelService({ db, settings: loadLevelSettings(), timeZone: TZ });
    const quota = new Quota(db, (id, d) => levels.limitFor(id, d), TZ);
    const roulette = new RouletteService({ db, settings: loadRouletteSettings(), levels, quota, timeZone: TZ, now: () => NOON, rnd: () => 0 });
    const weddings = new WeddingService({ db, settings: loadWeddingSettings(), riddles: loadRiddles(), decks: new DeckStore(db, seededRng(3)), now: () => NOON });
    const questions: Question[] = ["a", "b"].map((id) => ({ id, kind: "opciones", topic: "t", level: "facil", text: "?", answer: "si", wrong: ["x", "y", "z"], accepted: [] }));
    const trivia = new TriviaService({ db, settings: loadTriviaSettings(), questions, levels, timeZone: TZ, now: () => NOON, rnd: seededRng(2) });
    const stats = new DayStats({ db, quota, levels, timeZone: TZ, roulette, weddings, trivia, owners: new Set(["gyrop"]) });
    return { db, levels, quota, roulette, weddings, trivia, stats };
  }

  it("minutos en voz del día (den XP o no) y la trivia del Papu (2 nov. 2026)", () => {
    const { stats, trivia } = setup();
    const now = new Date(NOON);
    for (let m = 0; m < 75; m++) stats.countVoiceMinute(["ana", "beto"], now);
    stats.countVoiceMinute(["ana", "ana"], now); // repetido en la lista: cuenta una vez
    trivia.start("ana", "c", "facil");
    const s = trivia.active("ana")!;
    trivia.answerOption("ana", s.nonce, s.correct);
    const s2 = trivia.active("ana")!;
    trivia.answerOption("ana", s2.nonce, (s2.correct + 1) % 4);
    const p = stats.papu("ana", now);
    expect(p.voiceMin).toBe(76);
    expect(p.trivia).toMatchObject({ runs: 1, correct: 1, freeLeft: null, withXpLeft: 9, best: 1, cost: 0 });
    expect(p.trivia!.levels[0]).toMatchObject({ emoji: "🟢", done: 1, total: 2 });
    const text = papuText(p, {});
    expect(text).toContain("En voz: **1 h 16 min**");
    expect(text).toContain("Trivia hoy: **1** partida");
    expect(text).toContain("quedan **9** partidas con XP");
    expect(text).toContain("🟢 1/2");
    expect(papuText(stats.papu("beto", now), {})).toContain("Trivia hoy: no has jugado");
    const server = stats.server(now);
    expect(server).toMatchObject({ voiceMinutes: 151, voicePapus: 2, trivia: { runs: 1, players: 1, best: { userId: "ana", streak: 1 } } });
    expect(serverText(server)).toContain("Minutos en voz: **151** (2 Papus)");
  });

  it("a un Papu: mensajes, XP, cuota gastada y donada, y con quién no se puede casar", () => {
    const { levels, quota, weddings, stats } = setup();
    const now = new Date(NOON);
    for (let i = 0; i < 4; i++) stats.countMessage("ana", false, now);
    stats.countMessage("teto-bot", true, now);
    levels.bonus("ana", 120, NOON);
    quota.reserve("ana", 1, now);
    quota.reserve("beto", 2, now);
    expect(quota.donate("ana", "beto", 1, now).ok).toBe(true);
    weddings.marry("miku", "beto", "Beto", 10, NOON - 3_600_000);
    weddings.marry("luka", "ana", "Ana", 10, NOON - 3 * 86_400_000); // ya terminó, pero se casó hace poco
    const p = stats.papu("ana", now);
    expect(p).toMatchObject({ messages: 4, xp: 120, spent: 1, donated: 1, married: null });
    expect(p.blocked).toEqual(expect.arrayContaining([{ bot: "miku", why: "casada" }]));
    const text = papuText(p, { miku: "Miku", luka: "Luka" });
    expect(text).toContain("Mensajes enviados: **4**");
    expect(text).toContain("Miku (ya se casaron con otro Papu)");
    expect(papuText(stats.papu("beto", now), { miku: "Miku" })).toContain("Estás casado con **Miku**");
  });

  it("a GyroP: los totales del servidor, sin contarlo a él en el top de XP", () => {
    const { levels, quota, roulette, stats } = setup();
    const now = new Date(NOON);
    stats.countMessage("ana", false, now);
    stats.countMessage("beto", false, now);
    stats.countMessage("teto-bot", true, now);
    levels.bonus("gyrop", 9999, NOON);
    levels.bonus("ana", 300, NOON);
    levels.bonus("beto", 50, NOON);
    quota.reserve("beto", quota.remaining("beto", now), now);
    quota.reserve("ana", 1, now);
    quota.refund({ userId: "beto", day: "2026-10-31", units: 1 });
    expect(quota.donate("ana", "beto", 1, now).ok).toBe(true);
    while (roulette.spin("ana")); // ana subio de nivel: su tirada
    const t = stats.server(now);
    expect(t).toMatchObject({ papuMessages: 2, botMessages: 1, donated: 1, noQuota: 0, topXp: { userId: "ana" } });
    expect(t.spent).toBe(quota.used("beto", now) + 1);
    const text = serverText(t);
    expect(text).toContain("Mensajes de Papus: **2** · de Vocaloids: **1**");
    expect(text).toContain("<@ana>");
  });
});

describe("Shaula-coins y apuestas en los números de Mango (GyroP, 10 nov. 2026)", () => {
  const TZ = "America/Santiago";
  const NOON = Date.parse("2026-11-10T12:00:00-03:00");

  it("a un Papu: su monedero y lo ganado y perdido hoy en apuestas; a GyroP, los totales", () => {
    const db = memDb();
    const levels = new LevelService({ db, settings: loadLevelSettings(), timeZone: TZ });
    const quota = new Quota(db, (id, d) => levels.limitFor(id, d), TZ);
    const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: TZ, now: () => NOON });
    const stats = new DayStats({ db, quota, levels, timeZone: TZ, coins, owners: new Set(["gyrop"]) });
    coins.adjust("ana", "ganadas", 500, "t");
    coins.adjust("ana", "compradas", 1200, "t");
    const pelea = (id: string, estado: string, terminada: number | null) =>
      db.prepare("INSERT INTO peleas (id, a, b, cuota_a, cuota_b, estado, creada_at, cierra_at, terminada_at) VALUES (?, 'teto', 'miku', 2, 2, ?, ?, ?, ?)").run(id, estado, NOON - 3_600_000, NOON, terminada);
    const apuesta = (p: string, u: string, cantidad: number, pago: number) => db.prepare("INSERT INTO apuestas (pelea, user_id, lado, cantidad, pago, at) VALUES (?, ?, 'teto', ?, ?, ?)").run(p, u, cantidad, pago, NOON - 3_600_000);
    pelea("p1", "terminada", NOON - 60_000);
    pelea("p2", "terminada", NOON - 30_000);
    pelea("ayer", "terminada", NOON - 86_400_000);
    pelea("p3", "abierta", null);
    apuesta("p1", "ana", 100, 250); // ganó 150
    apuesta("p2", "ana", 80, 0); // perdió 80
    apuesta("ayer", "ana", 999, 0); // otro día: no cuenta
    apuesta("p3", "ana", 40, 0); // en juego
    apuesta("p1", "beto", 50, 0); // perdió 50
    const p = stats.papu("ana", new Date(NOON));
    expect(p.coins).toMatchObject({ ganadas: 500, compradas: 1200, ecos: 0 });
    expect(p.bets).toEqual({ peleas: 2, ganado: 150, perdido: 80, enJuego: 40 });
    const text = papuText(p, {});
    expect(text).toContain("🪙 Shaula-coins: **500** ganadas · **1.200** compradas");
    expect(text).toContain("⚔️ Apuestas hoy: **2** peleas · ganado **+150** · perdido **−80** · vas **+70** · en juego: **40**");
    expect(papuText(stats.papu("carla", new Date(NOON)), {})).not.toContain("Apuestas hoy");
    const t = stats.server(new Date(NOON));
    expect(t.bets).toEqual({ peleas: 2, ganado: 150, perdido: 130, enJuego: 40, papus: 2 });
    expect(t.coins).toMatchObject({ ganadas: 500, compradas: 1200 });
    const st = serverText(t);
    expect(st).toContain("⚔️ Apuestas hoy: **2** peleas · 2 Papus · ganado **+150** · perdido **−130** · los Papus van **+20**");
    expect(st).toContain("en los monederos: **500** ganadas, **1.200** compradas");
  });
});

describe("🔪 Sobreviviente", () => {
  it("está en config/servidor.json, sin función", () => {
    const r = loadLayout().rolesExtra.filter((x) => x.sobreviviente);
    expect(r).toHaveLength(1);
    expect(r[0]!.rol).toBe("🔪 Sobreviviente");
    expect(r[0]!.mod || r[0]!.todos || r[0]!.separado).toBeFalsy();
  });

  it("perdonados de un machetazo o strike en #moderación; no los de solo advertencias o silencio", () => {
    expect(pardonedFromLog("🧽 GyroP perdonó 1 machetazo y 2 advertencias de <@123> (le devolví 40 XP).")).toBe("123");
    expect(pardonedFromLog("🧽 GyroP perdonó 2 machetazos y el silencio de <@!456>.")).toBe("456");
    expect(pardonedFromLog("🧽 GyroP perdonó 1 strikes de <@789>.")).toBe("789");
    expect(pardonedFromLog("🧽 GyroP perdonó 2 advertencias de <@123>.")).toBeNull();
    expect(pardonedFromLog("🧽 GyroP perdonó el silencio de <@123>.")).toBeNull();
    expect(pardonedFromLog("⚠️ No pude quitarle el silencio a <@123>")).toBeNull();
  });
});
