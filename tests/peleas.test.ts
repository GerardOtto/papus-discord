import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { BOT_IDS, type BotId } from "../src/config";
import { avatarFile, bannerImage, resultGif } from "../src/peleas/images";
import { checkBet, equipo, finalLine, finalLineTeams, hpBar, loadPeleaSettings, maxTurnosEquipo, miembros, oddsFor, payout, pickPair, pickTeams, simulate, simulateTeams, turnLine, winChance, type PeleaSettings } from "../src/peleas/rules";
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
    // Invitados (pedido de GyroP, 8 nov. 2026; Meowl, sugerencia de Wiwi, 16 nov.): los de los videos y los especiales.
    expect(INVITADOS.sort()).toEqual(
      ["anon", "defoko", "donramon", "godzilla", "kafu", "kanon", "lily", "mango", "meowl", "momo", "nero", "pina", "shaula", "ted"].sort(),
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

  it("un luchador Papu (npm run peleas:papu: estadísticas en el promedio) queda equilibrado contra todos", () => {
    const s = { ...S, apuestas: { ...S.apuestas, simulaciones: 600 } };
    const rnd = seededRng(2);
    const todos = Object.values(S.luchadores).map((l) => l!);
    const prom = (k: "vida" | "ataque" | "defensa" | "agilidad") => Math.round(todos.reduce((a, l) => a + l[k], 0) / todos.length);
    const papu = { ...todos[0]!, nombre: "Papu", papu: "1", vida: prom("vida"), ataque: prom("ataque"), defensa: prom("defensa"), agilidad: prom("agilidad"), acciones: undefined, movimientos: { ataque: ["x"], bloqueo: ["x"], esquiva: ["x"], especial: { nombre: "Poder Papu", texto: "x", dano: 8 } } };
    const ps = IDS.map((b) => winChance(s, papu, S.luchadores[b]!, rnd));
    for (const p of ps) {
      expect(p).toBeGreaterThan(0.15);
      expect(p).toBeLessThan(0.85);
    }
    const m = ps.reduce((x, y) => x + y) / ps.length;
    expect(m).toBeGreaterThan(0.4);
    expect(m).toBeLessThan(0.6);
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
    // En decimales, 300 × 2,03 = 608,999… y 400 × 2,05 = 819,999…: antes se perdía 1 Shaulita (16 nov. 2026).
    expect(payout(300, 2.03)).toBe(609);
    expect(payout(400, 2.05)).toBe(820);
    expect(hpBar(15, 30)).toBe("▰▰▰▰▰▱▱▱▱▱ 15/30");
    expect(hpBar(-3, 30)).toBe("▱▱▱▱▱▱▱▱▱▱ 0/30");
  });

  it("límites de apuesta: de 10 a 1.000 por pelea, solo con lo que tiene", () => {
    expect(checkBet(S, 5, 0, 2000).ok).toBe(false);
    expect(checkBet(S, 1000, 0, 2000)).toEqual({ ok: true, total: 1000 });
    expect(checkBet(S, 1001, 0, 2000).ok).toBe(false);
    expect(checkBet(S, 5, 995, 2000)).toEqual({ ok: true, total: 1000 });
    expect(checkBet(S, 10, 995, 2000).ok).toBe(false);
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
  it("cobra Shaulitas, paga a quien acierta y nada a quien falla", () => {
    const { coins, peleas, advance } = setup();
    coins.adjust("gana", "monedas", 500, "test");
    coins.adjust("pierde", "monedas", 500, "test");
    const p = peleas.open("neru", "teto", "canal")!;
    expect(peleas.open("miku", "luka", "canal")).toBeNull();
    // Sin Shaulitas no se apuesta.
    expect(peleas.bet(p.id, "rico", "neru", 100).ok).toBe(false);
    expect(peleas.bet(p.id, "gana", "neru", 100).ok).toBe(true);
    expect(peleas.bet(p.id, "gana", "neru", 300).ok).toBe(true);
    expect(peleas.bet(p.id, "gana", "neru", 101).ok).toBe(false); // solo le quedan 100
    expect(peleas.bet(p.id, "pierde", "neru", 50).ok).toBe(true);
    expect(peleas.bet(p.id, "pierde", "teto", 50).ok).toBe(false); // un solo lado
    expect(coins.wallet("gana").monedas).toBe(100);
    expect(peleas.totals(p)).toEqual([{ monto: 450, papus: 2 }, { monto: 0, papus: 0 }]);
    advance(S.apuestas.minutos * 60_000);
    expect(peleas.bet(p.id, "pierde", "neru", 10).ok).toBe(false); // cerradas
    const r = peleas.fight(p.id)!;
    const liq = peleas.settle(p.id)!;
    const winner = r.ganador === 0 ? "neru" : "teto";
    const cuota = winner === "neru" ? p.cuotas[0] : p.cuotas[1];
    if (winner === "neru") {
      expect(liq.ganadores.map((x) => x.userId)).toEqual(["gana", "pierde"]);
      expect(coins.wallet("gana").monedas).toBe(100 + Math.floor(400 * cuota));
    } else {
      expect(liq.perdedores).toHaveLength(2);
      expect(coins.wallet("gana").monedas).toBe(100);
    }
    expect(coins.wallet("rico").monedas).toBe(0);
    expect(peleas.active()).toBeNull();
    expect(peleas.settle(p.id)).toBeNull(); // no paga dos veces
  });

  it("si el bot se reinicia a la mitad, devuelve todo lo apostado", () => {
    const { db, coins, peleas } = setup();
    coins.adjust("u", "monedas", 300, "test");
    const p = peleas.open("miku", "rin", "canal")!;
    peleas.bet(p.id, "u", "rin", 200);
    peleas.fight(p.id);
    // Otro proceso (el bot reiniciado) con la misma base.
    const again = new PeleaService({ db, settings: S, coins });
    const rec = again.recover();
    expect(rec).toHaveLength(1);
    expect(rec[0]!.devueltas[0]).toMatchObject({ userId: "u", cantidad: 200 });
    expect(coins.wallet("u").monedas).toBe(300);
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

describe("2 contra 2 (idea de Wicho, salón de la fama; GyroP, 18 nov. 2026)", () => {
  it("la config trae la probabilidad de las automáticas y el máximo de turnos", () => {
    expect(S.equipos?.probabilidad).toBeGreaterThan(0);
    expect(S.equipos?.probabilidad).toBeLessThan(1);
    expect(maxTurnosEquipo(S)).toBeGreaterThan(S.pelea.maxTurnos);
  });

  it("pierde el equipo que se queda sin nadie en pie; el que cae no vuelve a pelear", () => {
    const rnd = seededRng(3);
    for (let k = 0; k < 200; k++) {
      const [a, b] = pickTeams(IDS, rnd);
      const A = miembros(a).map((x) => S.luchadores[x]!), B = miembros(b).map((x) => S.luchadores[x]!);
      const r = simulateTeams(S, A, B, rnd);
      expect(r.turnos.length).toBeLessThanOrEqual(maxTurnosEquipo(S));
      const fuera: [Set<number>, Set<number>] = [new Set(), new Set()];
      for (const t of r.turnos) {
        expect(fuera[0].has(t.par[0]) || fuera[1].has(t.par[1])).toBe(false);
        for (const [lado, i] of t.caen) fuera[lado].add(i);
      }
      const last = r.turnos[r.turnos.length - 1]!;
      if (!r.porPuntos) {
        const perdio = (1 - r.ganador) as 0 | 1;
        const ganoVivo = last.vidas[r.ganador].some((v) => v > 0);
        if (ganoVivo) expect(last.vidas[perdio].every((v) => v <= 0)).toBe(true);
      }
    }
  });

  it("la cuota del equipo sale de simular el 2vs2 y nadie repetido entra a una pelea", () => {
    const { peleas } = setup();
    expect(() => peleas.open(equipo("teto", "miku"), equipo("miku", "neru"), null)).toThrow();
    expect(() => peleas.open("teto", equipo("miku", "neru"), null)).toThrow();
    const p = peleas.open(equipo("teto", "miku"), equipo("neru", "luka"), null)!;
    expect(p.cuotas[0]).toBeGreaterThanOrEqual(S.apuestas.cuotaMinima);
    expect(p.cuotas[1]).toBeLessThanOrEqual(S.apuestas.cuotaMaxima);
    const pa = peleas.chance(p.a, p.b);
    expect(pa).toBeGreaterThan(0.2);
    expect(pa).toBeLessThan(0.8);
  });

  it("se apuesta por un equipo y cobra quien acertó (apuesta × cuota)", () => {
    const { peleas, coins, advance } = setup();
    coins.adjust("ana", "monedas", 1000, "t");
    coins.adjust("beto", "monedas", 1000, "t");
    const p = peleas.open(equipo("teto", "miku"), equipo("neru", "luka"), null)!;
    expect(peleas.bet(p.id, "ana", "teto", 100).ok).toBe(false);
    expect(peleas.bet(p.id, "ana", p.a, 100).ok).toBe(true);
    expect(peleas.bet(p.id, "beto", p.b, 200).ok).toBe(true);
    const otro = peleas.bet(p.id, "ana", p.b, 50);
    expect(otro.ok).toBe(false);
    expect(otro.ok ? "" : otro.motivo).toMatch(/otro equipo/);
    advance(S.apuestas.minutos * 60_000);
    const r = peleas.fight(p.id)!;
    expect("par" in r.turnos[0]!).toBe(true);
    const liq = peleas.settle(p.id)!;
    const ganador = r.ganador === 0 ? p.a : p.b;
    const quien = ganador === p.a ? "ana" : "beto";
    const apuesta = quien === "ana" ? 100 : 200;
    expect(liq.ganadores.map((x) => x.userId)).toEqual([quien]);
    expect(liq.ganadores[0]!.pago).toBe(payout(apuesta, r.ganador === 0 ? p.cuotas[0] : p.cuotas[1]));
  });

  it("la última línea habla del equipo", () => {
    const r = simulateTeams(S, [S.luchadores.teto!, S.luchadores.miku!], [S.luchadores.neru!, S.luchadores.luka!], seededRng(9));
    const t = finalLineTeams(r, ["Teto y Miku", "Neru y Luka"]);
    expect(t).toMatch(r.ganador === 0 ? /Teto y Miku/ : /Neru y Luka/);
  });
});

describe("/pelea registra el 2vs2 (18 nov. 2026)", () => {
  it("trae modo (1vs1 o 2vs2) y los cuatro luchadores", async () => {
    const { commandsFor } = await import("../src/discord/commands");
    const pelea = (commandsFor("teto", [], []) as { name: string; options?: { name: string; choices?: { value: string }[] }[] }[]).find((c) => c.name === "pelea")!;
    const nombres = pelea.options!.map((o) => o.name);
    expect(nombres).toEqual(expect.arrayContaining(["modo", "vocaloid1", "vocaloid2", "vocaloid3", "vocaloid4", "cancelar"]));
    expect(pelea.options!.find((o) => o.name === "modo")!.choices!.map((c) => c.value)).toEqual(["1vs1", "2vs2"]);
  });
});

describe("marcador de texto y relato (GyroP, 18 nov. 2026)", () => {
  it("barras de 10 cuadritos por color; el que cae, en negro y tachado", async () => {
    const { barra, lineaLuchador, marcador } = await import("../src/peleas/marcador");
    expect(barra(34, 34)).toBe("🟩".repeat(10));
    expect(barra(12, 24)).toBe("🟨".repeat(5) + "⬛".repeat(5));
    expect(barra(1, 34)).toBe("🟥" + "⬛".repeat(9));
    expect(barra(0, 34)).toBe("⬛".repeat(10));
    expect(lineaLuchador({ nombre: "Miku", cara: "<:miku:1>", vida: 12, max: 24 }, true)).toBe(`▶️ <:miku:1> **Miku** ${"🟨".repeat(5)}${"⬛".repeat(5)} 12/24`);
    expect(lineaLuchador({ nombre: "Miku", cara: null, vida: -2, max: 24 }, false)).toContain("💀 ~~Miku~~");
    const m = marcador([[{ nombre: "Teto", cara: null, vida: 34, max: 34 }], [{ nombre: "Neru", cara: null, vida: 5, max: 20 }]], [0, 0], ["algo pasó"]);
    expect(m.split("\n")).toEqual([expect.stringContaining("▶️ **Teto**"), "**— VS —**", expect.stringContaining("▶️ **Neru**"), "", "algo pasó"]);
  });

  it("la línea corta del turno dice qué hizo cada uno y el daño", async () => {
    const { lineaAccion } = await import("../src/peleas/marcador");
    const t = { n: 3, acciones: ["ataque", "bloqueo"] as ["ataque", "bloqueo"], dano: [0, 2] as [number, number], cura: [0, 0] as [number, number], esquivo: [null, null] as [null, null], vida: [20, 30] as [number, number] };
    expect(lineaAccion(t, ["Neru", "Teto"], ["Machetazo", "Baguette"])).toBe("⚔️ Neru ATACA  →  🛡️ Teto BLOQUEA  ·  Teto **−2**");
    const e = { ...t, acciones: ["especial", "esquiva"] as ["especial", "esquiva"], dano: [0, 0] as [number, number], esquivo: [null, true] as [null, boolean] };
    expect(lineaAccion(e, ["Neru", "Teto"], ["Machetazo", "Baguette"])).toBe("🌟 Neru usa **Machetazo**  →  💨 Teto ESQUIVA  ·  ¡Teto esquiva!");
  });

  it("el relato completo se guarda con la pelea", () => {
    const { peleas } = setup();
    const p = peleas.open("teto", "miku", null)!;
    expect(peleas.relato(p.id)).toBeNull();
    peleas.setRelato(p.id, "**1.** algo\n**2.** otra cosa");
    expect(peleas.relato(p.id)).toBe("**1.** algo\n**2.** otra cosa");
  });
});

describe("relato línea por línea + tabla abajo (GyroP, 18 nov. 2026)", () => {
  it("el relato va arriba de la tabla y, si no cabe, se van las primeras líneas", async () => {
    const { conRelato } = await import("../src/peleas/marcador");
    expect(conRelato("TABLA", [])).toBe("🔔 ¡Suena la campana!\n\nTABLA");
    expect(conRelato("TABLA", ["**1.** a", "**2.** b"])).toBe("**1.** a\n**2.** b\n\nTABLA");
    const lineas = Array.from({ length: 40 }, (_, k) => `**${k + 1}.** ${"x".repeat(150)}`);
    const d = conRelato("TABLA", lineas);
    expect(d.length).toBeLessThanOrEqual(4000);
    expect(d.startsWith("-# ⋯\n")).toBe(true);
    expect(d.endsWith(`${lineas[39]!}\n\nTABLA`)).toBe(true);
    expect(d).not.toContain("**1.** ");
  });
});
