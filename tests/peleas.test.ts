import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { BOT_IDS, type BotId } from "../src/config";
import { avatarFile, bannerImage, resultGif } from "../src/peleas/images";
import { checkBet, finalLine, hpBar, loadPeleaSettings, oddsFor, payout, pickPair, simulate, turnLine, winChance, type PeleaSettings } from "../src/peleas/rules";
import { PeleaService } from "../src/peleas/service";
import { memDb, seededRng } from "./helpers";

const S = loadPeleaSettings();
const IDS = Object.keys(S.luchadores);
/** Los 15 Vocaloids del servidor (bots); los demás son invitados. */
const VOCALOIDS = IDS.filter((id) => BOT_IDS.includes(id as BotId));
const INVITADOS = IDS.filter((id) => !VOCALOIDS.includes(id));

function setup(settings: PeleaSettings = S) {
  const db = memDb();
  let now = Date.UTC(2026, 10, 4, 17, 0);
  const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now });
  const peleas = new PeleaService({ db, settings: { ...settings, apuestas: { ...settings.apuestas, simulaciones: 300 } }, coins, now: () => now, rnd: seededRng(5) });
  return { db, coins, peleas, advance: (ms: number) => (now += ms) };
}

describe("reglas del 1vs1", () => {
  it("la config carga con los 15 Vocaloids y los invitados, con sus movimientos", () => {
    expect(VOCALOIDS).toHaveLength(15);
    for (const id of VOCALOIDS) expect(readFileSync(avatarFile(id)).length, id).toBeGreaterThan(0);
    // Invitados (pedido de GyroP, 8 nov. 2026): los de los videos y los especiales, con nombre, color y grupo.
    expect(INVITADOS.sort()).toEqual(
      ["anon", "defoko", "donramon", "godzilla", "kafu", "kanon", "lily", "mango", "momo", "nero", "pina", "shaula", "ted"].sort(),
    );
    for (const id of INVITADOS) {
      const l = S.luchadores[id]!;
      expect(l.nombre, id).toBeTruthy();
      expect(l.color, id).toMatch(/^#[0-9A-F]{6}$/i);
      expect(["invitado", "especial"], id).toContain(l.grupo);
    }
    expect(S.luchadores.mango!.agilidad).toBe(67);
    // Todos los invitados tienen avatar (un luchador sin avatar no pelea).
    for (const id of INVITADOS)
      expect(existsSync(avatarFile(id)), id).toBe(true);
  });

  it("un invitado sin nombre o color no carga", () => {
    const bad = JSON.parse(readFileSync("config/peleas.json", "utf8"));
    delete bad.luchadores.pina.color;
    const file = path.join(tmpdir(), `peleas-mala-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(bad));
    expect(() => loadPeleaSettings(file)).toThrow(/pina/);
  });

  it("ninguna pareja pasa de 80/20 y nadie gana o pierde casi siempre", () => {
    const s = { ...S, apuestas: { ...S.apuestas, simulaciones: 600 } };
    const rnd = seededRng(1);
    const avg = new Map<string, number[]>();
    for (const a of IDS)
      for (const b of IDS)
        if (a < b) {
          const p = winChance(s, S.luchadores[a]!, S.luchadores[b]!, rnd);
          expect(p, `${a} vs ${b}`).toBeGreaterThan(0.15);
          expect(p, `${a} vs ${b}`).toBeLessThan(0.85);
          avg.set(a, [...(avg.get(a) ?? []), p]);
          avg.set(b, [...(avg.get(b) ?? []), 1 - p]);
        }
    for (const [id, ps] of avg) {
      const m = ps.reduce((x, y) => x + y) / ps.length;
      expect(m, id).toBeGreaterThan(0.4);
      expect(m, id).toBeLessThan(0.6);
    }
  });

  it("respeta la personalidad: Teto tiene la mayor vida, Miku la mayor agilidad y Adachi Rei la mayor defensa", () => {
    // Entre los Vocaloids del servidor y los personajes de los videos (los invitados especiales pueden pasarlos).
    const base = IDS.filter((id) => S.luchadores[id]!.grupo !== "especial");
    const max = (k: "vida" | "agilidad" | "defensa") => Math.max(...base.map((id) => S.luchadores[id]![k]));
    expect(S.luchadores.teto!.vida).toBe(max("vida"));
    expect(S.luchadores.miku!.agilidad).toBe(max("agilidad"));
    expect(S.luchadores.adachirei!.defensa).toBe(max("defensa"));
    expect(S.luchadores.neru!.ataque).toBe(Math.max(...base.map((id) => S.luchadores[id]!.ataque)));
  });

  it("una pelea nunca pasa de maxTurnos y siempre tiene ganador", () => {
    const rnd = seededRng(2);
    for (let k = 0; k < 300; k++) {
      const a = IDS[k % IDS.length]!, b = IDS[(k * 7 + 1) % IDS.length]!;
      if (a === b) continue;
      const r = simulate(S, S.luchadores[a]!, S.luchadores[b]!, rnd);
      expect(r.turnos.length).toBeLessThanOrEqual(S.pelea.maxTurnos);
      expect([0, 1]).toContain(r.ganador);
      const last = r.turnos[r.turnos.length - 1]!;
      if (!r.porPuntos) expect(Math.min(...last.vida)).toBeLessThanOrEqual(0);
      // El especial se usa una vez como mucho por luchador.
      for (const i of [0, 1]) expect(r.turnos.filter((t) => t.acciones[i] === "especial").length).toBeLessThanOrEqual(1);
    }
  });

  it("las líneas dicen quién hace qué y cuánto daño (y caben en el mensaje)", () => {
    const rnd = seededRng(3);
    const d = { nombres: ["Neru", "Teto"] as [string, string], luchadores: [S.luchadores.neru!, S.luchadores.teto!] as const };
    for (let k = 0; k < 50; k++) {
      const r = simulate(S, d.luchadores[0], d.luchadores[1], rnd);
      const lines = [...r.turnos.map((t) => turnLine(t, { ...d, luchadores: [...d.luchadores] }, rnd)), finalLine(r, { ...d, luchadores: [...d.luchadores] })];
      for (const [i, t] of r.turnos.entries()) {
        expect(lines[i]).toMatch(new RegExp(`^\\*\\*${t.n}\\.\\*\\* `));
        if (t.dano[0]) expect(lines[i]).toContain(`Neru **−${t.dano[0]}**`);
        if (t.dano[1]) expect(lines[i]).toContain(`Teto **−${t.dano[1]}**`);
      }
      expect(lines.join("\n").length).toBeLessThan(3900);
      expect(lines.at(-1)).toContain(d.nombres[r.ganador]);
    }
  });

  it("cuotas, pago y barra de vida", () => {
    expect(oddsFor(S, 0.5)).toBe(1.9);
    expect(oddsFor(S, 0.99)).toBe(S.apuestas.cuotaMinima);
    expect(oddsFor(S, 0.01)).toBe(S.apuestas.cuotaMaxima);
    expect(payout(100, 1.85)).toBe(185);
    expect(hpBar(15, 30)).toBe("▰▰▰▰▰▱▱▱▱▱ 15/30");
    expect(hpBar(-3, 30)).toBe("▱▱▱▱▱▱▱▱▱▱ 0/30");
  });

  it("límites de apuesta: de 10 a 400 por pelea, solo con lo que tiene", () => {
    expect(checkBet(S, 5, 0, 1000).ok).toBe(false);
    expect(checkBet(S, 400, 0, 1000)).toEqual({ ok: true, total: 400 });
    expect(checkBet(S, 401, 0, 1000).ok).toBe(false);
    expect(checkBet(S, 5, 395, 1000)).toEqual({ ok: true, total: 400 });
    expect(checkBet(S, 10, 395, 1000).ok).toBe(false);
    expect(checkBet(S, 100, 0, 50).ok).toBe(false);
    expect(checkBet(S, 2.5, 0, 50).ok).toBe(false);
  });

  it("la pareja al azar no repite la anterior", () => {
    const rnd = seededRng(4);
    for (let k = 0; k < 100; k++) {
      const [a, b] = pickPair(IDS, ["teto", "neru"], rnd);
      expect(a).not.toBe(b);
      expect([a, b].sort()).not.toEqual(["neru", "teto"]);
    }
  });
});

describe("apuestas y pagos", () => {
  it("cobra solo monedas ganadas, paga a quien acierta y nada a quien falla", () => {
    const { coins, peleas, advance } = setup();
    coins.adjust("gana", "ganadas", 500, "test");
    coins.adjust("pierde", "ganadas", 500, "test");
    coins.adjust("rico", "compradas", 5000, "test");
    const p = peleas.open("neru", "teto", "canal")!;
    expect(peleas.open("miku", "luka", "canal")).toBeNull();
    // Las compradas no se apuestan.
    expect(peleas.bet(p.id, "rico", "neru", 100).ok).toBe(false);
    expect(peleas.bet(p.id, "gana", "neru", 100).ok).toBe(true);
    expect(peleas.bet(p.id, "gana", "neru", 300).ok).toBe(true);
    expect(peleas.bet(p.id, "gana", "neru", 1).ok).toBe(false); // ya tiene 400
    expect(peleas.bet(p.id, "pierde", "neru", 50).ok).toBe(true);
    expect(peleas.bet(p.id, "pierde", "teto", 50).ok).toBe(false); // un solo lado
    expect(coins.wallet("gana").ganadas).toBe(100);
    expect(peleas.totals(p)).toEqual([{ monto: 450, papus: 2 }, { monto: 0, papus: 0 }]);
    advance(S.apuestas.minutos * 60_000);
    expect(peleas.bet(p.id, "pierde", "neru", 10).ok).toBe(false); // cerradas
    const r = peleas.fight(p.id)!;
    const liq = peleas.settle(p.id)!;
    const winner = r.ganador === 0 ? "neru" : "teto";
    const cuota = winner === "neru" ? p.cuotas[0] : p.cuotas[1];
    if (winner === "neru") {
      expect(liq.ganadores.map((x) => x.userId)).toEqual(["gana", "pierde"]);
      expect(coins.wallet("gana").ganadas).toBe(100 + Math.floor(400 * cuota));
    } else {
      expect(liq.perdedores).toHaveLength(2);
      expect(coins.wallet("gana").ganadas).toBe(100);
    }
    expect(coins.wallet("rico").compradas).toBe(5000);
    expect(peleas.active()).toBeNull();
    expect(peleas.settle(p.id)).toBeNull(); // no paga dos veces
  });

  it("si el bot se reinicia a la mitad, devuelve todo lo apostado", () => {
    const { db, coins, peleas } = setup();
    coins.adjust("u", "ganadas", 300, "test");
    const p = peleas.open("miku", "rin", "canal")!;
    peleas.bet(p.id, "u", "rin", 200);
    peleas.fight(p.id);
    // Otro proceso (el bot reiniciado) con la misma base.
    const again = new PeleaService({ db, settings: S, coins });
    const rec = again.recover();
    expect(rec).toHaveLength(1);
    expect(rec[0]!.devueltas[0]).toMatchObject({ userId: "u", cantidad: 200 });
    expect(coins.wallet("u").ganadas).toBe(300);
    expect(again.get(p.id)!.estado).toBe("devuelta");
    expect(again.recover()).toHaveLength(0);
  });
});

describe("imágenes del 1vs1", () => {
  const card = (id: BotId, cuota: number) => ({ name: id, color: "#39c5bb", avatar: readFileSync(avatarFile(id)), ...S.luchadores[id]!, cuota });
  it("dibuja el banner y el GIF del final", async () => {
    const png = await bannerImage(card("neru", 1.85), card("teto", 2.05), { vida: 34, ataque: 6, defensa: 4, agilidad: 80 });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    const gif = await resultGif({ winner: { name: "Neru", color: "#e8d44d", avatar: readFileSync(avatarFile("neru")) }, loser: { name: "Teto", color: "#e58fb5", avatar: readFileSync(avatarFile("teto")) }, subtitle: "por K.O.", seed: 1 });
    expect(gif.subarray(0, 3).toString()).toBe("GIF");
    expect(gif.length).toBeLessThan(8 * 1024 * 1024);
  }, 30_000);
});
