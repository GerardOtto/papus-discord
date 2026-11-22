import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings, priceOf } from "../src/coins/rules";
import { CoinService, conDescuento } from "../src/coins/service";
import { loadLevelSettings } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { antiguedadPara, conMultiplicador, lanzamientos, limpiarTitulo, loadMembresiaSettings, multiplicadorXp, nivelDe, puedeLanzar } from "../src/membresias/rules";
import { MembresiaService, viaLanzamiento } from "../src/membresias/service";
import { memDb, seededRng } from "./helpers";

const TZ = "America/Santiago";
const M = loadMembresiaSettings();
const CAT = loadCatalog();
const DAY = 86_400_000;
const nivel = (id: string) => M.niveles.find((n) => n.id === id)!;

function setup() {
  const db = memDb();
  let now = Date.parse("2026-11-28T12:00:00-03:00");
  const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: CAT, timeZone: TZ, now: () => now });
  const m = new MembresiaService({ db, settings: M, coins, now: () => now, rnd: seededRng(7) });
  return { db, coins, m, at: (t: number) => (now = t), now: () => now };
}

describe("reglas de las membresías", () => {
  it("vale el nivel más alto que tenga; sin rol, nada", () => {
    expect(nivelDe(M, ["🥬 Puerro", "🥖 Baguette", "Papu"])?.id).toBe("baguette");
    expect(nivelDe(M, ["Papu"])).toBeNull();
    expect(multiplicadorXp(null)).toBe(1);
    expect(multiplicadorXp(nivel("puerro"))).toBe(1.2);
  });

  it("los beneficios suben con el nivel (decisiones de GyroP, 13 nov. 2026)", () => {
    for (let k = 1; k < M.niveles.length; k++) {
      const [a, b] = [M.niveles[k - 1]!, M.niveles[k]!];
      expect(b.xp).toBeGreaterThan(a.xp);
      expect(b.peleas.dia).toBeGreaterThanOrEqual(a.peleas.dia);
      expect(b.bodas.dia).toBeGreaterThanOrEqual(a.bodas.dia);
      expect(b.recuperar).toBeGreaterThan(a.recuperar);
      expect(b.descuento).toBeGreaterThanOrEqual(a.descuento);
      expect(b.sobres.ve * b.sobres.cantidad).toBeGreaterThanOrEqual(a.sobres.ve * a.sobres.cantidad);
    }
    // Puerro: 1 pelea al azar y ninguna boda; Baguette ya elige luchadores; Triple Baka se pone a sí mismo.
    expect(lanzamientos(nivel("puerro"), "pelea")).toEqual({ dia: 1, elige: false, propio: false });
    expect(lanzamientos(nivel("puerro"), "boda").dia).toBe(0);
    expect(lanzamientos(nivel("baguette"), "pelea").elige).toBe(true);
    expect(lanzamientos(nivel("baguette"), "boda").elige).toBe(false);
    expect(lanzamientos(nivel("triple-baka"), "pelea").propio).toBe(true);
    expect(puedeLanzar(nivel("atun"), "boda", 0)).toBe(true);
    expect(puedeLanzar(nivel("atun"), "boda", 1)).toBe(false);
    expect(puedeLanzar(null, "pelea", 0)).toBe(false);
  });

  it("multiplicador de XP, antigüedad y título propio", () => {
    expect(conMultiplicador(100, nivel("puerro"))).toBe(120);
    expect(conMultiplicador(100, null)).toBe(100);
    expect(antiguedadPara(M, 0)).toEqual([]);
    expect(antiguedadPara(M, 6)).toEqual(["insignia-antiguedad-1", "insignia-antiguedad-3", "insignia-antiguedad-6"]);
    for (const a of M.antiguedad) expect(CAT.find((o) => o.id === a.objeto)).toMatchObject({ tipo: "insignia", rareza: "membresia" });
    expect(limpiarTitulo("  La   reina del karaoke ", 32)).toBe("La reina del karaoke");
    expect(limpiarTitulo("visita https://x.com", 32)).toBeNull();
    expect(limpiarTitulo("<@123> manda", 32)).toBeNull();
    expect(limpiarTitulo("a".repeat(40), 32)).toBeNull();
  });

  it("toda la XP ganada se multiplica por la membresía (no la de los intercambios)", () => {
    const db = memDb();
    const levels = new LevelService({ db, settings: loadLevelSettings(), timeZone: TZ });
    levels.membershipBoost = (id) => (id === "socio" ? 1.5 : 1);
    levels.bonus("socio", 100);
    levels.bonus("papu", 100);
    expect(levels.store.get("socio").xp).toBe(150);
    expect(levels.store.get("papu").xp).toBe(100);
    levels.transferXp("papu", "socio", 50);
    expect(levels.store.get("socio").xp).toBe(200);
  });
});

describe("regalo de membresía", () => {
  it("sobres temáticos cada 30 días, un mes más y su insignia de antigüedad", () => {
    const { m, coins, at, now } = setup();
    const r = m.regalo("u", nivel("celular"))!;
    expect(r).toMatchObject({ sobres: 2, miticos: 0, meses: 1 });
    expect(r.insignias.map((o) => o.id)).toEqual(["insignia-antiguedad-1"]);
    expect(m.pendientes("u")).toHaveLength(2);
    expect(m.regalo("u", nivel("celular"))).toBeNull();
    at(now() + 31 * DAY);
    expect(m.regalo("u", nivel("triple-baka"))).toMatchObject({ sobres: 2, miticos: 1, meses: 2 });
    expect(m.pendientes("u").filter((s) => s.clase === "mitico")).toHaveLength(1);
    expect(coins.owned("u").has("insignia-antiguedad-1")).toBe(true);
  });

  it("la primera vez cuenta los meses desde su primera insignia de membresía", () => {
    const { m, coins, db, now } = setup();
    coins.membershipBadges("u", ["🐟 Atún"]);
    db.prepare("UPDATE inventario SET at = ? WHERE user_id = 'u'").run(now() - 95 * DAY);
    expect(m.regalo("u", nivel("atun"))?.meses).toBe(4);
    expect(coins.owned("u").has("insignia-antiguedad-3")).toBe(true);
  });
});

describe("sobres temáticos elegibles (nada pagado es azar)", () => {
  it("solo ofrece temas con objetos suficientes y nunca trae renders", () => {
    const { m } = setup();
    m.regalo("u", nivel("baguette"));
    const s = m.pendientes("u")[0]!;
    const temas = m.temas("u", s);
    expect(temas.map((t) => t.id)).toContain("todo");
    for (const t of temas) expect(t.faltan).toBeGreaterThanOrEqual(s.elige);
    // flower tiene un solo objeto: no alcanza para elegir 4.
    expect(temas.some((t) => t.id === "p:flower")).toBe(false);
    const r = m.elegirTema("u", s.id, "p:luka");
    if ("ok" in r) throw new Error(r.motivo);
    expect(r.opciones!.length).toBe(Math.min(s.ve, temas.find((t) => t.id === "p:luka")!.faltan));
    for (const id of r.opciones!) {
      const o = CAT.find((x) => x.id === id)!;
      expect(o.origen).not.toBe("render");
      expect(o.personajes).toContain("luka");
      expect(o.rareza).not.toBe("mitica");
    }
    // Orden fijo: de mayor a menor rareza (no hay azar).
    const orden = { comun: 0, rara: 1, epica: 2, legendaria: 3 } as Record<string, number>;
    const r2 = r.opciones!.map((id) => orden[CAT.find((x) => x.id === id)!.rareza]!);
    expect([...r2].sort((a, b) => b - a)).toEqual(r2);
  });

  it("se lleva exactamente los que puede elegir, y el sobre se cierra", () => {
    const { m, coins } = setup();
    m.regalo("u", nivel("puerro"));
    const s = m.pendientes("u")[0]!;
    const r = m.elegirTema("u", s.id, "todo");
    if ("ok" in r) throw new Error(r.motivo);
    expect(r.opciones).toHaveLength(5);
    expect(m.elegir("u", s.id, r.opciones!.slice(0, 3)).ok).toBe(false);
    expect(m.elegir("u", s.id, ["noche-de-estreno", r.opciones![0]!]).ok).toBe(false);
    const ok = m.elegir("u", s.id, r.opciones!.slice(0, 2));
    expect(ok.ok).toBe(true);
    for (const id of r.opciones!.slice(0, 2)) expect(coins.owned("u").has(id)).toBe(true);
    expect(m.pendientes("u")).toHaveLength(0);
    expect(m.elegir("u", s.id, r.opciones!.slice(2, 4)).ok).toBe(false);
  });

  it("cambiar de tema antes de elegir; nadie abre el sobre de otro", () => {
    const { m } = setup();
    m.regalo("u", nivel("puerro"));
    const s = m.pendientes("u")[0]!;
    expect("ok" in m.elegirTema("otro", s.id, "todo")).toBe(true);
    m.elegirTema("u", s.id, "todo");
    expect(m.cambiarTema("u", s.id)).toBe(true);
    expect(m.sobre(s.id)!.opciones).toBeNull();
  });

  it("el mítico muestra todas las míticas que faltan (sin renders) y se elige una", () => {
    const { m } = setup();
    m.regalo("u", nivel("triple-baka"));
    const s = m.pendientes("u").find((x) => x.clase === "mitico")!;
    const r = m.elegirTema("u", s.id, "todo");
    if ("ok" in r) throw new Error(r.motivo);
    const miticasArte = CAT.filter((o) => o.rareza === "mitica" && o.origen !== "render");
    expect(r.opciones!.length).toBe(miticasArte.length);
    expect(m.elegir("u", s.id, [r.opciones![0]!]).ok).toBe(true);
  });

  it("el de prestigio (ganado jugando) sí puede traer renders y míticas", () => {
    const { m } = setup();
    m.darSobrePrestigio("u", 15, 5, "prestigio ★1");
    const s = m.pendientes("u")[0]!;
    const opciones = m.temas("u", s).find((t) => t.id === "todo")!;
    expect(opciones.faltan).toBeGreaterThan(CAT.filter((o) => o.origen === "arte" && priceOf(loadCoinSettings(), o) !== null).length);
    const r = m.elegirTema("u", s.id, "todo");
    if ("ok" in r) throw new Error(r.motivo);
    expect(r.opciones).toHaveLength(15);
  });
});

describe("recuperar objetos de vitrinas pasadas", () => {
  it("solo con membresía, con su descuento y hasta su tope de 30 días", () => {
    const { m, coins, at, now } = setup();
    const lista = m.recuperables("u");
    expect(lista.length).toBeGreaterThan(0);
    // Ya pasó el 25 nov.: los de la temporada 1 salieron del pozo y se recuperan.
    expect(lista.some((o) => o.temporada === "t1")).toBe(true);
    expect(lista.some((o) => (coins.vitrina()?.objetos ?? []).includes(o.id))).toBe(false);
    const o = lista[0]!;
    expect(m.recuperar("u", null, o.id).ok).toBe(false);
    expect(m.recuperar("u", nivel("puerro"), o.id)).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "monedas", 10_000, "prueba");
    const r = m.recuperar("u", nivel("puerro"), o.id);
    expect(r).toMatchObject({ ok: true, precio: conDescuento(priceOf(coins.settings, o)!, 10) });
    expect(coins.wallet("u").monedas).toBe(10_000 - conDescuento(priceOf(coins.settings, o)!, 10));
    const otro = m.recuperables("u")[0]!;
    expect(m.recuperar("u", nivel("puerro"), otro.id).ok).toBe(false); // Puerro: 1 cada 30 días
    at(now() + 31 * DAY);
    // Pasados los 30 días, otro más (lo que hoy está en vitrina no se recupera: se compra ahí).
    expect(m.recuperar("u", nivel("puerro"), m.recuperables("u")[0]!.id).ok).toBe(true);
  });
});

describe("de dónde sale cada lanzamiento", () => {
  it("primero los del día de su membresía; las peleas, después, la semanal del prestigio", () => {
    const { m } = setup();
    const day = "2026-11-28", week = "2026-11-23";
    expect(viaLanzamiento({ membresias: m }, nivel("puerro"), 0, "u", "pelea", day, week)).toMatchObject({ via: "membresia", elige: false });
    m.anotarLanzamiento("u", "pelea", day);
    expect(viaLanzamiento({ membresias: m }, nivel("puerro"), 0, "u", "pelea", day, week)).toBeNull();
    // Con prestigio: 1 pelea a la semana eligiendo a los luchadores (aunque no tenga membresía).
    expect(viaLanzamiento({ membresias: m }, nivel("puerro"), 1, "u", "pelea", day, week)).toMatchObject({ via: "prestigio", elige: true, day: week });
    m.anotarLanzamiento("u", "pelea-prestigio", week);
    expect(viaLanzamiento({ membresias: m }, null, 1, "u", "pelea", "2026-11-29", week)).toBeNull();
    // Bodas: Puerro no lanza; Atún sí (al azar); Celular elige. El prestigio no da bodas.
    expect(viaLanzamiento({ membresias: m }, nivel("puerro"), 3, "u", "boda", day, week)).toBeNull();
    expect(viaLanzamiento({ membresias: m }, nivel("atun"), 0, "u", "boda", day, week)).toMatchObject({ via: "membresia", elige: false });
    expect(viaLanzamiento({ membresias: m }, nivel("celular"), 0, "u", "boda", day, week)).toMatchObject({ elige: true });
  });
});

describe("lanzamientos del día", () => {
  it("se anotan y se devuelven por Papu, día y tipo", () => {
    const { m } = setup();
    m.anotarLanzamiento("u", "pelea", "2026-11-28");
    m.anotarLanzamiento("u", "pelea", "2026-11-28");
    expect(m.lanzadosHoy("u", "pelea", "2026-11-28")).toBe(2);
    expect(m.lanzadosHoy("u", "boda", "2026-11-28")).toBe(0);
    m.devolverLanzamiento("u", "pelea", "2026-11-28");
    expect(m.lanzadosHoy("u", "pelea", "2026-11-28")).toBe(1);
  });
});

describe("estilo de membresía en las imágenes", () => {
  it("cada nivel tiene su marco y la tarjeta se dibuja con su cinta", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const { decorarMembresia, marcoDe } = await import("../src/membresias/marco");
    const { renderCard } = await import("../src/levels/card");
    expect(marcoDe(null)).toBeUndefined();
    for (const n of M.niveles) {
      const m = marcoDe(n)!;
      expect(m).toEqual({ estilo: n.banner, color: n.color, nombre: n.nombre });
      const c = createCanvas(400, 200);
      for (const t of [0, 0.5]) decorarMembresia(c.getContext("2d"), 400, 200, m, t);
      const png = await renderCard({ name: "Papu", avatar: null, level: 5, max: 99, prestige: 0, into: 1, needed: 10, tier: 1, rankName: "Oyente", position: 1, quota: null, frase: null, accent: "#39C5BB", background: null, multiplier: 1, membresia: m });
      expect(png.subarray(1, 4).toString()).toBe("PNG");
    }
  });
});

describe("premio por prestigiar", () => {
  it("Shaulitas, sobre elegible, insignia que sube (y reemplaza a la anterior), marco y aro una vez", async () => {
    const { premiarPrestigio, renderPrestigioBanner } = await import("../src/levels/prestigio");
    const { nickTag, prestigeMark, stripNickTag } = await import("../src/levels/rules");
    const ls = loadLevelSettings();
    const { coins, m } = setup();
    const p1 = premiarPrestigio(ls, coins, m, "u", 1)!;
    expect(p1.monedas).toBe(5000);
    expect(coins.wallet("u").monedas).toBe(5000);
    expect(p1.objetos.map((o) => o.id).sort()).toEqual(["aro-de-prestigio", "insignia-prestigio-1", "marco-de-prestigio"]);
    expect(m.pendientes("u").map((s) => s.clase)).toEqual(["prestigio"]);
    coins.equip("u", "insignia", ["insignia-prestigio-1"]);
    const p2 = premiarPrestigio(ls, coins, m, "u", 2)!;
    expect(p2.objetos.map((o) => o.id)).toEqual(["insignia-prestigio-2"]);
    expect(coins.equipped("u").get("insignia1")?.id).toBe("insignia-prestigio-2");
    // Del 5 en adelante, la de arcoíris.
    expect(premiarPrestigio(ls, coins, m, "u", 7)!.objetos.map((o) => o.id)).toEqual(["insignia-prestigio-5"]);
    // La estrella del apodo cambia con cada prestigio y se puede quitar del nombre.
    expect([1, 2, 3, 4, 5, 9].map((n) => prestigeMark(n))).toEqual(["★", "✯", "✪", "❂", "🌟", "🌟"]);
    expect(prestigeMark(5, true)).toBe("✹");
    expect(nickTag(12, 2)).toBe(" ✯2✦12");
    expect(stripNickTag("karin 🌟6✦3")).toBe("karin");
    expect(stripNickTag("karin ★1✦99")).toBe("karin");
    const png = await renderPrestigioBanner({ name: "Papu", avatar: null, stars: 3, detalle: "sobre · 5.000 Shaulitas" });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("fondo de membresía de la temporada", () => {
  it("lo reciben Baguette y más, una sola vez; no se vende", () => {
    const { m, coins } = setup();
    expect(m.fondoTemporada("a", nivel("atun"))).toBeNull();
    expect(m.fondoTemporada("b", nivel("baguette"))?.id).toBe(M.fondoTemporada);
    expect(m.fondoTemporada("b", nivel("baguette"))).toBeNull();
    const o = CAT.find((x) => x.id === M.fondoTemporada)!;
    expect(o).toMatchObject({ tipo: "fondo", rareza: "membresia", animado: true });
    expect(priceOf(coins.settings, o)).toBeNull();
  });
});
