import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import {
  bolsaBase,
  checkBoleto,
  cuotasBolsa,
  cuotasEnVivo,
  elegirCorredores,
  filaDe,
  loadCarreraSettings,
  loadFrasesCarrera,
  pagoBoleto,
  probabilidades,
  seeded,
  simularCarrera,
  type CarreraSettings,
} from "../src/carreras/rules";
import { CarreraService } from "../src/carreras/service";
import { zonedTime } from "../src/bodas/rules";
import { loadPeleaSettings } from "../src/peleas/rules";
import { memDb, seededRng } from "./helpers";

const S = loadCarreraSettings();
const F = loadFrasesCarrera();
const IDS = Object.keys(S.corredores);
const corr = (ids: string[]) => ids.map((id) => S.corredores[id]!);

/** Config de prueba: menos simulaciones (más rápido) y, si hace falta, otra bolsa base. */
const conf = (extra: Partial<CarreraSettings["apuestas"]> = {}): CarreraSettings => ({ ...S, apuestas: { ...S.apuestas, simulaciones: 300, ...extra } });

function setup(settings: CarreraSettings = conf(), semilla = 7) {
  const db = memDb();
  let now = Date.UTC(2026, 10, 16, 21, 0);
  const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now });
  const carreras = new CarreraService({ db, settings, frases: F, coins, now: () => now, rnd: seededRng(5), semilla: () => semilla });
  return { db, coins, carreras, advance: (ms: number) => (now += ms) };
}

describe("config de las carreras", () => {
  it("corren los 29 luchadores del 1vs1 (sin los Papus luchadores), cada uno con su emoji y sus jugadas", () => {
    const peleas = loadPeleaSettings();
    const luchadores = Object.entries(peleas.luchadores).filter(([, l]) => !l.papu).map(([id]) => id);
    expect(IDS.sort()).toEqual(luchadores.sort());
    expect(IDS).toHaveLength(29);
    for (const id of IDS) {
      const r = S.corredores[id]!;
      expect(r.velocidad + r.arranque + r.resistencia, id).toBe(18);
      expect(r.jugadas.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it("las jugadas genéricas son entre 30 y 40, todas con el nombre", () => {
    expect(F.buenas.length + F.malas.length).toBeGreaterThanOrEqual(30);
    expect(F.buenas.length + F.malas.length).toBeLessThanOrEqual(40);
  });
});

describe("la carrera", () => {
  it("la misma semilla da la misma carrera", () => {
    const g = IDS.slice(0, 6);
    const a = simularCarrera(S, corr(g), g, F, seeded(123));
    const b = simularCarrera(S, corr(g), g, F, seeded(123));
    expect(b).toEqual(a);
    expect(simularCarrera(S, corr(g), g, F, seeded(124)).turnos).not.toEqual(a.turnos);
  });

  it("todos llegan, en un orden sin repetir, y dura entre 12 y 30 turnos en promedio unos 18", () => {
    const rnd = seededRng(3);
    let total = 0;
    for (let k = 0; k < 300; k++) {
      const g = elegirCorredores(IDS, 6, null, rnd);
      const r = simularCarrera(S, corr(g), g, F, rnd);
      expect([...r.llegada].sort()).toEqual([0, 1, 2, 3, 4, 5]);
      expect(r.cruce.every((c) => c !== null)).toBe(true);
      expect(r.turnos.length).toBeGreaterThanOrEqual(10);
      expect(r.turnos.length).toBeLessThanOrEqual(S.carrera.maxTurnos);
      total += r.turnos.length;
      // Las jugadas no se repiten dentro de una carrera.
      const textos = r.turnos.flatMap((t) => (t.jugada ? [t.jugada.texto] : []));
      expect(new Set(textos).size).toBe(textos.length);
    }
    expect(total / 300).toBeGreaterThan(14);
    expect(total / 300).toBeLessThan(24);
  });

  it("está equilibrada: en carreras de 6 al azar cada corredor gana entre el 12 % y el 22 %", () => {
    const rnd = seededRng(11);
    const wins = new Map<string, number>(), runs = new Map<string, number>();
    for (let k = 0; k < 12000; k++) {
      const g = elegirCorredores(IDS, 6, null, rnd);
      const r = simularCarrera(S, corr(g), g, F, rnd);
      for (const id of g) runs.set(id, (runs.get(id) ?? 0) + 1);
      const w = g[r.llegada[0]!]!;
      wins.set(w, (wins.get(w) ?? 0) + 1);
    }
    for (const id of IDS) {
      const p = (wins.get(id) ?? 0) / runs.get(id)!;
      expect(p, id).toBeGreaterThan(0.12);
      expect(p, id).toBeLessThan(0.22);
    }
  });

  it("la fila de la pista: arriba al largar, abajo cerca de la meta y en la meta al llegar", () => {
    expect(filaDe(S, 0)).toBe(0);
    expect(filaDe(S, S.carrera.meta - 0.01)).toBe(S.carrera.filas - 1);
    expect(filaDe(S, S.carrera.meta)).toBe(S.carrera.filas);
  });

  it("el grupo al azar no repite el anterior", () => {
    const rnd = seededRng(4);
    const prev = IDS.slice(0, 6);
    for (let k = 0; k < 50; k++) {
      const g = elegirCorredores(IDS, 6, prev, rnd);
      expect(new Set(g).size).toBe(6);
      expect([...g].sort()).not.toEqual([...prev].sort());
    }
  });
});

describe("apuestas mutuas (como en el hipódromo)", () => {
  // Ejemplo del PLAN §3.14: Miku (0), Teto (1), Neru (2).
  it("Ganador: la bolsa neta se reparte entre lo apostado al 1.º", () => {
    const bolsa = [500, 300, 200];
    expect(cuotasBolsa(S, "ganador", bolsa, [2, 0, 1]).get(2)).toBe(4.75);
    expect(cuotasBolsa(S, "ganador", bolsa, [0, 2, 1]).get(0)).toBe(1.9);
    expect(cuotasBolsa(S, "ganador", bolsa, [2, 0, 1]).size).toBe(1);
  });

  it("Segundo: se devuelve lo apostado a los 2 primeros y la ganancia se parte en dos", () => {
    const q = cuotasBolsa(S, "segundo", [300, 200, 100], [2, 0, 1]);
    expect(q.get(2)).toBe(1.85);
    expect(q.get(0)).toBe(1.28);
    expect(q.has(1)).toBe(false);
  });

  it("Tercero: la ganancia se parte en tres; si la bolsa no alcanza, paga el mínimo", () => {
    const q = cuotasBolsa(S, "tercero", [100, 100, 100, 300], [0, 1, 2, 3]);
    // neta 570, se devuelven 300, ganancia 270 → 90 a cada uno → ×1,9
    expect([q.get(0), q.get(1), q.get(2)]).toEqual([1.9, 1.9, 1.9]);
    const casiTodos = cuotasBolsa(S, "tercero", [500, 400, 300, 1], [0, 1, 2, 3]);
    expect([...casiTodos.values()].every((x) => x === S.apuestas.pagoMinimo)).toBe(true);
  });

  it("sin nada apostado a un acertado, la ganancia se reparte entre los demás", () => {
    const q = cuotasBolsa(S, "segundo", [0, 100, 100], [0, 1, 2]);
    expect(q.has(0)).toBe(false);
    expect(q.get(1)).toBe(1.9);
  });

  it("el pago del boleto se redondea hacia abajo, sin perder Shaulitas por los decimales", () => {
    expect(pagoBoleto(33, 1.85)).toBe(61);
    // En decimales, 100 × 2,26 = 225,999…: antes pagaba 225 (caso real del 16 nov. 2026).
    expect(pagoBoleto(100, 2.26)).toBe(226);
    for (let n = 1; n <= 1000; n++) for (const q of [1.05, 1.1, 2.03, 2.05, 2.26, 3.23, 4.75, 9.61]) expect(pagoBoleto(n, q)).toBe(Math.floor((n * Math.round(q * 100)) / 100));
  });

  it("la bolsa base de Teto suma lo configurado, todos tienen algo y el favorito más", () => {
    const p = probabilidades(S, corr(IDS.slice(0, 6)), F, seededRng(1), 400);
    const base = bolsaBase(S, p);
    for (const t of ["ganador", "segundo", "tercero"] as const) {
      expect(base[t].reduce((a, b) => a + b, 0)).toBe(S.apuestas.bolsaBase);
      expect(base[t].every((x) => x >= 1)).toBe(true);
      const fav = p[t].indexOf(Math.max(...p[t]));
      expect(base[t][fav]).toBe(Math.max(...base[t]));
    }
  });

  it("las cuotas en vivo: más apostado a uno = paga menos", () => {
    const v = cuotasEnVivo(S, { ganador: [500, 100, 100], segundo: [300, 300, 100], tercero: [200, 200, 200] });
    expect(v.ganador[0]).toBeLessThan(v.ganador[1]!);
    expect(v.ganador[1]).toBe(v.ganador[2]);
    expect(v.segundo[2]).toBeGreaterThan(v.segundo[0]!);
    expect(v.tercero.every((x) => x >= S.apuestas.pagoMinimo)).toBe(true);
  });

  it("boletos: mínimo por boleto, máximo por carrera y lo que tiene", () => {
    expect(checkBoleto(S, 5, 0, 1000).ok).toBe(false);
    expect(checkBoleto(S, 10, 0, 1000)).toEqual({ ok: true, total: 10 });
    expect(checkBoleto(S, 600, 500, 2000).ok).toBe(false);
    expect(checkBoleto(S, 500, 500, 2000)).toEqual({ ok: true, total: 1000 });
    expect(checkBoleto(S, 50, 0, 40).ok).toBe(false);
    expect(checkBoleto(S, 1.5, 0, 40).ok).toBe(false);
  });
});

describe("servicio de las carreras", () => {
  const g = ["teto", "miku", "neru", "kaito", "gumi", "pina"];

  it("vende varios boletos, sortea con la semilla y paga con apuestas mutuas", () => {
    const { coins, carreras, advance } = setup();
    coins.adjust("a", "monedas", 1000, "test");
    coins.adjust("b", "monedas", 300, "test");
    const c = carreras.open(g, "canal")!;
    expect(carreras.open(g, "canal")).toBeNull();
    expect(carreras.apostar(c.id, "pobre", "miku", "ganador", 50).ok).toBe(false);
    // Varios boletos del mismo Papu, a varios Vocaloids y en varias bolsas.
    for (const id of g) expect(carreras.apostar(c.id, "a", id, "ganador", 100).ok).toBe(true);
    expect(carreras.apostar(c.id, "a", "miku", "tercero", 300).ok).toBe(true);
    expect(carreras.apostar(c.id, "a", "miku", "segundo", 200).ok).toBe(false); // pasaría de 1.000 por carrera
    expect(carreras.apostar(c.id, "b", "luka", "ganador", 50).ok).toBe(false); // no corre
    expect(carreras.apostar(c.id, "b", "teto", "tercero", 300).ok).toBe(true);
    expect(coins.wallet("a").monedas).toBe(100);
    expect(coins.wallet("b").monedas).toBe(0);
    const bolsas = carreras.bolsas(c);
    expect(bolsas.ganador.reduce((x, y) => x + y, 0)).toBe(S.apuestas.bolsaBase + 600);

    advance(S.apuestas.minutos * 60_000);
    expect(carreras.apostar(c.id, "a", "teto", "ganador", 10).ok).toBe(false);
    const r = carreras.correr(c.id, g)!;
    expect(carreras.correr(c.id, g)).toBeNull();
    const liq = carreras.liquidar(c.id, g)!;
    expect(liq.resultado).toEqual(r);
    const llegada = r.llegada.map((i) => g[i]!);
    expect(liq.carrera.llegada).toEqual(llegada);
    // A le acertó al ganador (un boleto de 100 de los 6 de Ganador): cobra 100 × la cuota de Ganador.
    const qGan = liq.carrera.cuotas!.ganador[llegada[0]!]!;
    const ganador = liq.boletos.find((b) => b.userId === "a" && b.tipo === "ganador" && b.corredor === llegada[0])!;
    expect(ganador.pago).toBe(Math.floor(100 * qGan));
    expect(liq.boletos.filter((b) => b.tipo === "ganador" && b.corredor !== llegada[0]).every((b) => b.pago === 0)).toBe(true);
    // Lo que cobró cada uno quedó en su monedero.
    const cobroA = liq.boletos.filter((b) => b.userId === "a").reduce((x, b) => x + b.pago, 0);
    expect(coins.wallet("a").monedas).toBe(100 + cobroA);
    const tetoPodio = llegada.slice(0, 3).includes("teto");
    expect(coins.wallet("b").monedas > 0).toBe(tetoPodio);
    expect(liq.repartido[llegada[0]!]).toBeGreaterThan(0);
    expect(carreras.active()).toBeNull();
    expect(carreras.liquidar(c.id, g)).toBeNull();
  });

  it("la misma semilla guardada reproduce la carrera (se puede comprobar después)", () => {
    const { carreras } = setup(conf(), 99);
    const c = carreras.open(g, null)!;
    const r = carreras.correr(c.id, g)!;
    expect(carreras.resultado(carreras.get(c.id)!, g)).toEqual(r);
  });

  it("si el bot se reinicia o la cancelan, devuelve todos los boletos", () => {
    const { coins, carreras } = setup();
    coins.adjust("a", "monedas", 500, "test");
    const c = carreras.open(g, "canal")!;
    carreras.apostar(c.id, "a", "miku", "ganador", 100);
    carreras.apostar(c.id, "a", "neru", "tercero", 200);
    expect(coins.wallet("a").monedas).toBe(200);
    const out = carreras.cancel()!;
    expect(out.devueltos).toHaveLength(2);
    expect(coins.wallet("a").monedas).toBe(500);
    expect(carreras.get(c.id)!.estado).toBe("devuelta");
    expect(carreras.active()).toBeNull();
  });

  it("horario: 3 carreras al día en la ventana, separadas y lejos de las peleas; cada hora se usa una vez", () => {
    const db = memDb();
    let now = Date.UTC(2026, 10, 16, 18, 0); // 12:00 en México
    const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now });
    const carreras = new CarreraService({ db, settings: conf(), frases: F, coins, now: () => now, rnd: seededRng(8), peleas: { horarios: ["16:00", "21:00"], zona: "America/Mexico_City" } });
    const slots = carreras.slots();
    expect(slots).toHaveLength(S.porDia);
    expect(carreras.slots()).toEqual(slots); // se guarda: no se vuelve a sortear
    const desde = zonedTime("2026-11-16", S.horario.desde, S.horario.zona), hasta = zonedTime("2026-11-16", S.horario.hasta, S.horario.zona);
    const peleas = ["16:00", "21:00"].map((h) => zonedTime("2026-11-16", h, "America/Mexico_City"));
    for (const [k, t] of slots.entries()) {
      expect(t).toBeGreaterThanOrEqual(desde);
      expect(t).toBeLessThanOrEqual(hasta);
      expect(peleas.every((p) => Math.abs(p - t) > S.lejosDePeleasMinutos * 60_000)).toBe(true);
      if (k) expect(t - slots[k - 1]!).toBeGreaterThanOrEqual(S.separacionMinutos * 60_000);
    }
    expect(carreras.dueSlot()).toBeNull();
    expect(carreras.nextSlot()).toBe(slots[0]);
    now = slots[0]! + 60_000;
    expect(carreras.dueSlot()).toBe(slots[0]);
    carreras.useSlot(slots[0]!);
    expect(carreras.dueSlot()).toBeNull();
    expect(carreras.nextSlot()).toBe(slots[1]);
    // Si los bots estaban apagados y pasaron más de 15 min, esa carrera se pierde.
    now = slots[1]! + 20 * 60_000;
    expect(carreras.dueSlot()).toBeNull();
  });

  it("cuenta las carreras que lanzó un Papu (tope de membresía)", () => {
    const { carreras, advance } = setup();
    const desde = Date.UTC(2026, 10, 16, 0, 0);
    const c = carreras.open(g, null, "papu")!;
    carreras.correr(c.id, g);
    carreras.liquidar(c.id, g);
    advance(60_000);
    carreras.open(["miku", "luka", "rin", "len", "ia", "haku"], null, "otro");
    expect(carreras.lanzadasDesde("papu", desde)).toBe(1);
    expect(carreras.lanzadasDesde("nadie", desde)).toBe(0);
  });
});
