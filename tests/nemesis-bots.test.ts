// Desafíos de los Vocaloids en la Ruleta de Némesis (pedido de GyroP, 14 nov. 2026, PLAN §3.12): la casa no pone
// Shaulitas, la apuesta sube con cada victoria del Vocaloid y vuelve al inicio cuando pierde, y el desafío va a un Papu
// que escribió hace poco.
import { ChannelType, type Guild } from "discord.js";
import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import type { BotId } from "../src/config";
import { NemesisDiscord } from "../src/discord/nemesis";
import { apuestaCasa, chancePorMinuto, enVentana, loadNemesisSettings, type NemesisSettings } from "../src/nemesis/rules";
import { NemesisService } from "../src/nemesis/service";
import { DeckStore } from "../src/phrases/deck";
import { Phrases } from "../src/phrases/catalog";
import { memDb, seededRng } from "./helpers";

const S = loadNemesisSettings();
const B = S.bots!;
const BOT = "bot-miku";

function setup(rnd = seededRng(3), settings: NemesisSettings = S) {
  const db = memDb();
  let now = Date.UTC(2026, 10, 14, 20, 0); // 17:00 en Chile
  const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now });
  const svc = new NemesisService({ db, settings, coins, now: () => now, rnd });
  coins.adjust("p", "monedas", 5000, "test");
  coins.adjust("q", "monedas", 5000, "test");
  return { db, coins, svc, now: () => now, advance: (ms: number) => (now += ms) };
}

/** Juega una partida de la casa hasta el final, forzando quién cae: `casaGana` = cae el Papu. */
function play(svc: NemesisService, rival: string, casaGana: boolean): void {
  const ch = svc.challengeHouse(BOT, rival, "c");
  if (!ch.ok) throw new Error(ch.motivo);
  const ok = svc.accept(ch.duelo.id, rival);
  if (!ok.ok) throw new Error(ok.motivo);
  // La bala va en el primer turno del que debe caer.
  const debeCaer = casaGana ? rival : BOT;
  const x0 = svc.get(ch.duelo.id)!;
  forceBullet(svc, x0.id, svc.shooter(x0) === debeCaer ? 0 : 1);
  for (let k = 0; k < S.recamaras; k++) {
    const x = svc.get(ch.duelo.id)!;
    const r = svc.pull(x.id, x.turno, svc.shooter(x));
    if (!r.ok) throw new Error(r.motivo);
    if (r.disparo.bang) return;
  }
  throw new Error("nunca salió la bala");
}

function forceBullet(svc: NemesisService, id: string, bala: number): void {
  (svc as unknown as { d: { db: ReturnType<typeof memDb> } }).d.db.prepare("UPDATE nemesis SET bala = ? WHERE id = ?").run(bala, id);
}

describe("reglas de los desafíos de los Vocaloids", () => {
  it("config: hasta 3 al día entre las 12 y las 23, desde 100 y el doble con cada victoria", () => {
    expect(B.activo).toBe(true);
    expect(B.porDia).toBe(3);
    expect(apuestaCasa(S, 0)).toBe(B.apuestaInicial);
    expect(apuestaCasa(S, 1)).toBe(B.apuestaInicial * B.subida);
    expect(apuestaCasa(S, 2)).toBe(B.apuestaInicial * B.subida ** 2);
    expect(apuestaCasa(S, 50)).toBe(S.apuesta.maxima);
  });

  it("ventana del día y probabilidad por minuto (en promedio porDia)", () => {
    expect(enVentana(B, B.desde)).toBe(true);
    expect(enVentana(B, B.hasta)).toBe(false);
    expect(enVentana(B, B.desde - 1)).toBe(false);
    expect(chancePorMinuto(B) * (B.hasta - B.desde) * 60).toBeCloseTo(B.porDia);
  });
});

describe("partidas de la casa", () => {
  it("el Vocaloid no paga; si el Papu rechaza no pierde nada", () => {
    const { svc, coins } = setup();
    const r = svc.challengeHouse(BOT, "p", "c");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duelo.casa).toBe(true);
    expect(r.duelo.apuesta).toBe(B.apuestaInicial);
    expect(coins.wallet(BOT).monedas).toBe(0);
    expect(svc.reject(r.duelo.id, "p").ok).toBe(true);
    expect(coins.wallet("p").monedas).toBe(5000);
    expect(coins.wallet(BOT).monedas).toBe(0);
    expect(svc.houseStreak()).toBe(0);
  });

  it("si gana el Vocaloid, el Papu pierde su apuesta (no se le paga al bot) y la siguiente sube", () => {
    const { svc, coins } = setup();
    play(svc, "p", true);
    expect(coins.wallet("p").monedas).toBe(5000 - B.apuestaInicial);
    expect(coins.wallet(BOT).monedas).toBe(0);
    expect(svc.houseStreak()).toBe(1);
    expect(svc.houseBet()).toBe(B.apuestaInicial * B.subida);
    play(svc, "q", true);
    expect(coins.wallet("q").monedas).toBe(5000 - B.apuestaInicial * B.subida);
    expect(svc.houseBet()).toBe(B.apuestaInicial * B.subida ** 2);
  });

  it("si gana el Papu, cobra su apuesta + el 80 % y la apuesta vuelve al inicio", () => {
    const { svc, coins } = setup();
    play(svc, "p", true);
    play(svc, "q", false);
    const apuesta = B.apuestaInicial * B.subida;
    expect(coins.wallet("q").monedas).toBe(5000 + apuesta - Math.round(apuesta * S.tajada));
    expect(svc.houseStreak()).toBe(0);
    expect(svc.houseBet()).toBe(B.apuestaInicial);
  });

  it("los rechazos y vencidos no cambian la racha", () => {
    const { svc, advance } = setup();
    play(svc, "p", true);
    const r = svc.challengeHouse(BOT, "q", "c");
    if (!r.ok) throw new Error(r.motivo);
    advance(S.aceptarMinutos * 60_000 + 1);
    expect(svc.expire()?.estado).toBe("vencida");
    expect(svc.houseStreak()).toBe(1);
  });

  it("al Papu sin Shaulitas suficientes no se le desafía", () => {
    const { svc } = setup();
    expect(svc.challengeHouse(BOT, "pobre", "c").ok).toBe(false);
  });

  it("un reinicio a la mitad le devuelve al Papu lo suyo y nada al bot", () => {
    const { svc, coins } = setup();
    const r = svc.challengeHouse(BOT, "p", "c");
    if (!r.ok) throw new Error(r.motivo);
    svc.accept(r.duelo.id, "p");
    const [rec] = svc.recover();
    expect(rec!.devuelto).toBe(B.apuestaInicial);
    expect(coins.wallet("p").monedas).toBe(5000);
    expect(coins.wallet(BOT).monedas).toBe(0);
  });
});

describe("cuándo y a quién desafían", () => {
  function discord(svc: NemesisService, rnd: () => number) {
    const sent: string[] = [];
    const channel = { id: "general-id", name: "💬・general", type: ChannelType.GuildText };
    const guild = {
      channels: { cache: { find: (f: (c: typeof channel) => boolean) => (f(channel) ? channel : undefined) } },
      members: {
        cache: new Map(),
        fetch: async (id: string) => ({ id, user: { bot: id === BOT, username: id }, displayName: id, displayAvatarURL: () => "http://127.0.0.1:9/a.png" }),
      },
    } as unknown as Guild;
    const nd = new NemesisDiscord({
      svc,
      phrases: new Phrases(new DeckStore(memDb(), seededRng(5))),
      owners: new Set(),
      guild: () => guild,
      sendable: async (_c, bot?: BotId) => ({ send: async (m: { content: string }) => (sent.push(`${bot}: ${m.content}`), { id: `m${sent.length}` }) }) as never,
      botOf: (id) => (id === BOT ? "miku" : undefined),
      houseBots: () => [BOT],
      timeZone: "America/Santiago",
      rnd,
      report: async () => {},
      log: () => {},
    });
    return { nd, sent };
  }

  it("desafía a un Papu activo, lo publica el Vocaloid y respeta el tope del día", async () => {
    const { svc, now, advance } = setup();
    const { nd, sent } = discord(svc, () => 0); // siempre le toca
    expect(await nd.houseTick(now())).toBe(false); // nadie activo
    nd.seen("p", now());
    expect(await nd.houseTick(now())).toBe(true);
    expect(sent[0]).toMatch(/^miku: .*<@p>.*<@bot-miku> te desafía/);
    expect(svc.active()?.casa).toBe(true);
    // Mientras hay una en curso no sale otra; tampoco antes de la espera ni al mismo Papu del día.
    expect(await nd.houseTick(now())).toBe(false);
    svc.reject(svc.active()!.id, "p");
    advance(B.esperaMinutos * 60_000);
    nd.seen("p", now());
    expect(await nd.houseTick(now())).toBe(false);
    nd.seen("q", now());
    expect(await nd.houseTick(now())).toBe(true);
    svc.reject(svc.active()!.id, "q");
    nd.stop();
  });

  it("no desafía a quien no escribe hace rato ni fuera de la ventana del día", async () => {
    const { svc, now, advance } = setup();
    const { nd } = discord(svc, () => 0);
    nd.seen("p", now());
    advance((B.activoMinutos + 1) * 60_000);
    expect(await nd.houseTick(now())).toBe(false);
    // 04:00 en Chile: fuera de la ventana.
    nd.seen("p", Date.UTC(2026, 10, 15, 7, 0));
    expect(await nd.houseTick(Date.UTC(2026, 10, 15, 7, 0))).toBe(false);
    nd.stop();
  });
});
