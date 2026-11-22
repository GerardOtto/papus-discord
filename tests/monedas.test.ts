import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLECCION_DIR, hasArt, toCardEquip } from "../src/coins/equip";
import { coleccionSheet, monederoImage, sobreGif, vitrinaImage } from "../src/coins/images";
import {
  addDays,
  availableOn,
  dayEarnings,
  levelBonus,
  missionSobre,
  loadCatalog,
  loadCoinSettings,
  membershipBadges,
  priceOf,
  rollSobre,
  seasonSchedule,
  sobreKind,
  sobrePool,
  temporadasActivas,
  weekStart,
  weekday,
  type CoinSettings,
  type Objeto,
} from "../src/coins/rules";
import { CoinService, conDescuento } from "../src/coins/service";
import { loadMembresiaSettings } from "../src/membresias/rules";
import { loadLevelSettings } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { renderCardAny } from "../src/levels/card";
import { memDb } from "./helpers";

const S = loadCoinSettings();
const CAT = loadCatalog();
const TZ = "America/Santiago";
const idle = { xp: 0, mensajes: 0, vozMin: 0, castigo: false, misiones: 0, misionesTotal: 0, bodas: 0, racha: false };

/** Generador al azar reproducible. */
function lcg(seed = 1) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("config y catálogo", () => {
  it("cargan, y cada objeto tiene su dibujo, su miniatura y (si es render) su imagen", () => {
    expect(S.precios.comun).toBeGreaterThan(0);
    expect(CAT.length).toBeGreaterThan(60);
    for (const o of CAT) {
      expect(hasArt(o), o.id).toBe(true);
      expect(existsSync(path.join(COLECCION_DIR, "miniaturas", `${o.id}.png`)), `miniatura ${o.id}`).toBe(true);
      if (o.imagen) expect(existsSync(path.join(COLECCION_DIR, o.imagen)), `imagen ${o.id}`).toBe(true);
    }
  });
});

describe("ganar", () => {
  it("1 moneda cada 20 XP con tope, más bonos; con strike, nada", () => {
    expect(dayEarnings(S, { ...idle, xp: 200 })).toBe(10);
    expect(dayEarnings(S, { ...idle, xp: 99_999 })).toBe(S.ganar.topeActividad);
    expect(dayEarnings(S, { ...idle, xp: 200, mensajes: 3, misiones: 2, bodas: 1, racha: true })).toBe(10 + S.ganar.primerMensaje + 20 + 40 + 50);
    expect(dayEarnings(S, { ...idle, xp: 5000, mensajes: 9, castigo: true })).toBe(0);
  });

  it("completar todas las misiones de la ruleta da un sobre (no con strike ni sin ruleta)", () => {
    expect(missionSobre(S, { ...idle, misiones: 3, misionesTotal: 3 })).toBe(S.sobre.porMisiones);
    expect(missionSobre(S, { ...idle, misiones: 2, misionesTotal: 3 })).toBe(false);
    expect(missionSobre(S, { ...idle, misiones: 3, misionesTotal: 3, castigo: true })).toBe(false);
    expect(missionSobre(S, idle)).toBe(false);
  });

  it("bono por nivel y rango nuevo; bajar no da nada", () => {
    expect(levelBonus(S, 10, 12, true)).toBe(2 * S.ganar.subirNivel + S.ganar.rangoNuevo);
    expect(levelBonus(S, 12, 10, false)).toBe(0);
  });
});

describe("sobres", () => {
  const pool = sobrePool(CAT, S.temporada.id, "2026-11-10");

  it("trae de 3 a 5 objetos de la temporada, nunca de fundadores", () => {
    const rnd = lcg(7);
    for (let i = 0; i < 200; i++) {
      const r = rollSobre(S, pool, { sinEpica: 0, sinLegendaria: 0 }, rnd);
      expect(r.objetos.length).toBeGreaterThanOrEqual(3);
      expect(r.objetos.length).toBeLessThanOrEqual(5);
      expect(r.objetos.every((o) => o.rareza !== "fundador")).toBe(true);
    }
  });

  it("garantías: el sobre 10 sin Épica trae una; el 40 sin Legendaria, una Legendaria", () => {
    const allCommon = () => 0; // siempre la primera opción: 3 objetos comunes
    const e = rollSobre(S, pool, { sinEpica: S.sobre.garantiaEpica - 1, sinLegendaria: 0 }, allCommon);
    expect(e.objetos.some((o) => ["epica", "legendaria", "mitica"].includes(o.rareza))).toBe(true);
    expect(e.pity.sinEpica).toBe(0);
    const l = rollSobre(S, pool, { sinEpica: 0, sinLegendaria: S.sobre.garantiaLegendaria - 1 }, allCommon);
    expect(l.objetos.some((o) => o.rareza === "legendaria")).toBe(true);
    const c = rollSobre(S, pool, { sinEpica: 2, sinLegendaria: 5 }, allCommon);
    expect(c.pity).toEqual({ sinEpica: 3, sinLegendaria: 6 });
  });

  it("el sobre raro asegura una Épica y el legendario una Legendaria; nunca regalos", () => {
    const allCommon = () => 0;
    const raro = rollSobre(S, pool, { sinEpica: 0, sinLegendaria: 0 }, allCommon, "raro");
    expect(raro.objetos.length).toBe(S.sobre.tipos!.raro!.objetos![0]![0]);
    expect(raro.objetos.some((o) => ["epica", "legendaria", "mitica"].includes(o.rareza))).toBe(true);
    const leg = rollSobre(S, pool, { sinEpica: 0, sinLegendaria: 0 }, allCommon, "legendario");
    expect(leg.objetos).toHaveLength(5);
    expect(leg.objetos.some((o) => o.rareza === "legendaria")).toBe(true);
    expect(leg.pity).toEqual({ sinEpica: 0, sinLegendaria: 0 });
    expect(pool.some((o) => o.rareza === "membresia" || o.rareza === "fundador")).toBe(false);
  });

  it("el especial de Halloween solo sale en su semana", () => {
    const halloween = CAT.find((o) => o.limitado)!;
    expect(availableOn(halloween, "2026-10-31")).toBe(true);
    expect(availableOn(halloween, "2026-11-10")).toBe(false);
    expect(pool.some((o) => o.id === halloween.id)).toBe(false);
  });
});

describe("tienda", () => {
  it("las vitrinas cambian lunes y jueves y cada objeto que se vende sale al menos una vez en la temporada", () => {
    const sched = seasonSchedule(S, CAT);
    expect(sched[0]!.desde).toBe(S.temporada.desde);
    // Cambian lunes y jueves, salvo el día en que una temporada incluida sale del pozo.
    const cortes = (S.temporada.incluye ?? []).flatMap((x) => (typeof x === "string" ? [] : [x.hasta]));
    for (const v of sched.slice(1)) if (!cortes.includes(v.desde)) expect(S.vitrinas.dias).toContain(weekday(v.desde));
    for (const v of sched.slice(0, -1)) expect(Date.parse(v.hasta) - Date.parse(v.desde)).toBeGreaterThanOrEqual(2 * 86_400_000);
    const seen = new Set(sched.flatMap((v) => v.objetos));
    const vende = CAT.filter((o) => o.temporada === S.temporada.id && priceOf(S, o) !== null);
    // Los limitados fuera de la temporada (Halloween, si la temporada no lo incluye) no pueden salir.
    const posibles = vende.filter((o) => {
      for (const v of sched) for (let d = v.desde; d < v.hasta; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) if (availableOn(o, d)) return true;
      return false;
    });
    // Los sumados a mitad de temporada ('agregado') no tienen lugar asegurado: salen en sobres y se fabrican.
    for (const o of posibles.filter((x) => !x.agregado)) expect(seen.has(o.id), o.id).toBe(true);
    for (const v of sched) {
      const objs = v.objetos.map((id) => CAT.find((o) => o.id === id)!);
      expect(objs.filter((o) => o.origen === "arte").length).toBeLessThanOrEqual(S.vitrinas.arte);
      expect(objs.filter((o) => o.origen === "render").length).toBeLessThanOrEqual(S.vitrinas.renders);
      expect(new Set(v.objetos).size).toBe(v.objetos.length);
    }
  });

  it("los objetos agregados a mitad de temporada no cambian las vitrinas anteriores y solo reemplazan repetidos", () => {
    // Como era la temporada 1 (las insignias «Fan de…» se sumaron a mitad de ella).
    const T1: CoinSettings = { ...S, temporada: { id: "t1", nombre: "Lanzamiento", desde: "2026-10-27", hasta: "2026-11-25" }, vitrinas: { ...S.vitrinas, arte: 5, renders: 4 } };
    const C1 = CAT.filter((o) => o.temporada !== "t2");
    const late = C1.filter((o) => o.agregado);
    expect(late.map((o) => o.id)).toContain("insignia-fan-miku");
    const before = seasonSchedule(T1, C1.filter((o) => !o.agregado));
    const after = seasonSchedule(T1, C1);
    expect(after.length).toBe(before.length);
    after.forEach((v, k) => {
      const b = before[k]!;
      const nuevos = v.objetos.filter((id) => late.some((o) => o.id === id));
      if (late.every((o) => v.desde < o.agregado!)) expect(v.objetos).toEqual(b.objetos);
      for (const id of nuevos) expect(v.desde >= late.find((o) => o.id === id)!.agregado!).toBe(true);
      // Lo que se quitó para hacerles lugar seguía saliendo en otra vitrina.
      for (const id of b.objetos.filter((x) => !v.objetos.includes(x))) expect(after.some((w) => w.objetos.includes(id)), id).toBe(true);
    });
    // Insignias «Fan de…»: comunes, con su corazón dibujado.
    for (const o of CAT.filter((x) => x.id.startsWith("insignia-fan-"))) {
      expect(o).toMatchObject({ tipo: "insignia", rareza: "comun", origen: "arte" });
      expect(existsSync(path.join(COLECCION_DIR, o.imagen!)), o.id).toBe(true);
    }
  });

  it("la temporada 1 sigue en el pozo de la 2 solo hasta el 24 nov.; desde el 25 las vitrinas son solo de la 2", () => {
    expect(S.temporada.incluye).toEqual([{ id: "t1", hasta: "2026-11-25" }]);
    expect(temporadasActivas(S, "2026-11-24")).toEqual(["t2", "t1"]);
    expect(temporadasActivas(S, "2026-11-25")).toEqual(["t2"]);
    // Sobres: la 1 sale hasta el 24 nov.
    expect(sobrePool(CAT, temporadasActivas(S, "2026-11-24"), "2026-11-24").some((o) => o.temporada === "t1")).toBe(true);
    expect(sobrePool(CAT, temporadasActivas(S, "2026-12-01"), "2026-12-01").some((o) => o.temporada === "t1")).toBe(false);
    const sch = seasonSchedule(S, CAT);
    // Hasta el corte, las vitrinas son las que ya estaban armadas con el pozo compartido (lo que ya se vio no cambia).
    const compartido: CoinSettings = { ...S, temporada: { ...S.temporada, incluye: ["t1"] } };
    const antes = seasonSchedule(compartido, CAT);
    for (const v of sch.filter((x) => x.desde < "2026-11-25")) expect(v.objetos, v.desde).toEqual(antes.find((x) => x.desde === v.desde)!.objetos);
    // Abre una vitrina justo el 25 nov. y ninguna dura menos de 2 días.
    expect(sch.some((v) => v.desde === "2026-11-25")).toBe(true);
    expect(sch.find((v) => v.hasta === "2026-11-25")).toBeDefined();
    for (const v of sch.slice(0, -1)) expect(Date.parse(v.hasta) - Date.parse(v.desde)).toBeGreaterThanOrEqual(2 * 86_400_000);
    for (let k = 1; k < sch.length; k++) expect(sch[k]!.desde).toBe(sch[k - 1]!.hasta);
    // Desde el corte: solo la temporada 2, y cada objeto suyo que se vende sale al menos una vez.
    const despues = sch.filter((v) => v.desde >= "2026-11-25");
    const salen = new Set(despues.flatMap((v) => v.objetos));
    for (const id of salen) expect(CAT.find((o) => o.id === id)!.temporada, id).toBe("t2");
    const dias: string[] = [];
    for (let d = "2026-11-25"; d < S.temporada.hasta; d = addDays(d, 1)) dias.push(d);
    const vende = CAT.filter((o) => o.temporada === "t2" && priceOf(S, o) !== null && dias.some((d) => availableOn(o, d)));
    expect(vende.filter((o) => !salen.has(o.id)).map((o) => o.id)).toEqual([]);
    for (const v of sch) expect(v.objetos.length).toBeLessThanOrEqual(S.vitrinas.arte + S.vitrinas.renders);
  });

  it("un pozo compartido sin fecha suma la temporada pasada en toda la temporada", () => {
    const compartido: CoinSettings = { ...S, temporada: { ...S.temporada, incluye: ["t1"] } };
    expect(temporadasActivas(compartido, "2026-12-30")).toEqual(["t2", "t1"]);
    const salen = new Set(seasonSchedule(compartido, CAT).flatMap((v) => v.objetos));
    expect(CAT.some((o) => o.temporada === "t1" && salen.has(o.id))).toBe(true);
  });

  it("cada rol de membresía tiene su insignia, que no se vende ni se fabrica", () => {
    const ids = Object.values(S.insigniasMembresia!);
    expect(Object.keys(S.insigniasMembresia!)).toEqual(loadMembresiaSettings().niveles.map((n) => n.rol));
    for (const id of ids) {
      const o = CAT.find((x) => x.id === id)!;
      expect(o, id).toBeDefined();
      expect(o).toMatchObject({ tipo: "insignia", rareza: "membresia" });
      expect(priceOf(S, o)).toBeNull();
    }
    expect(membershipBadges(S, ["🥬 Puerro", "💥 Triple Baka", "Papu"])).toEqual(["insignia-membresia-puerro", "insignia-membresia-triple-baka"]);
  });

});

/** Servicio con niveles de verdad y un reloj que se puede mover. */
function setup(settings: CoinSettings = S) {
  const db = memDb();
  let now = Date.parse("2026-11-20T12:00:00-03:00");
  let said = 0;
  const levels = new LevelService({ db, settings: loadLevelSettings(), timeZone: TZ });
  const coins = new CoinService({ db, settings, catalog: CAT, timeZone: TZ, now: () => now, rnd: lcg(3) });
  return {
    db,
    levels,
    coins,
    at: (t: number) => (now = t),
    now: () => now,
    /** Mensajes que dan XP: cada uno distinto (los niveles ignoran los repetidos) y 3 s después del anterior. */
    talk: (userId: string, n: number) => {
      for (let i = 0; i < n; i++) levels.onMessage(userId, `un mensaje bastante largo numero ${(said += 1)} para que de harta experiencia`, (now += 3000));
    },
  };
}

describe("monedero", () => {
  it("lo ganado participando se paga una sola vez y el strike lo quita", () => {
    const { coins, levels, talk, db } = setup();
    talk("u", 30);
    coins.sync("u");
    const w1 = coins.wallet("u");
    expect(w1.monedas).toBeGreaterThan(S.ganar.primerMensaje);
    coins.sync("u");
    expect(coins.wallet("u").monedas).toBe(w1.monedas);
    levels.onStrike("u");
    db.prepare("UPDATE xp_dia SET castigo = 1 WHERE user_id = 'u'").run();
    coins.sync("u");
    expect(coins.wallet("u").monedas).toBe(0);
  });

  it("sobre gratis el lunes si participó 3 días la semana anterior", () => {
    const { coins, talk, at } = setup();
    for (const d of ["2026-11-03", "2026-11-04", "2026-11-05"]) {
      at(Date.parse(`${d}T12:00:00-03:00`));
      talk("u", 2);
    }
    at(Date.parse("2026-11-10T12:00:00-03:00"));
    expect(weekStart("2026-11-10")).toBe("2026-11-09");
    coins.sync("u");
    expect(coins.wallet("u").gratis).toBe(1);
    coins.sync("u");
    expect(coins.wallet("u").gratis).toBe(1);
  });

  it("el sobre de las misiones se da una sola vez por día", () => {
    const db = memDb();
    const now = Date.parse("2026-11-10T12:00:00-03:00");
    const levels = new LevelService({ db, settings: loadLevelSettings(), timeZone: TZ });
    let done = 0;
    const coins = new CoinService({ db, settings: S, catalog: CAT, timeZone: TZ, now: () => now, missions: () => ({ done, total: 3 }) });
    levels.onMessage("u", "un mensaje para que exista el dia de hoy en la tabla", now);
    coins.sync("u");
    expect(coins.wallet("u").gratis).toBe(0);
    done = 3;
    coins.sync("u");
    coins.sync("u");
    expect(coins.wallet("u").gratis).toBe(1);
  });

  it("abrir sobres cuesta Shaulitas, guarda objetos y los repetidos dan Ecos", () => {
    const { coins } = setup();
    expect(coins.openSobre("u", false)).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "monedas", S.sobre.precio * 30, "prueba");
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const r = coins.openSobre("u", false);
      if ("ok" in r) throw new Error(r.motivo);
      total += r.objetos.length;
    }
    const w = coins.wallet("u");
    expect(w.monedas).toBe(0);
    expect(w.sobres).toBe(30);
    expect(coins.owned("u").size).toBeLessThan(total);
    expect(w.ecos).toBeGreaterThan(0);
  });

  it("sobres temáticos: solo objetos del tema (renders incluidos), comprados, con común regalado + Ecos o de boda", () => {
    const { coins, db } = setup();
    const t = S.sobre.tematico!;
    const temas = coins.temasTematicos();
    expect(temas.map((x) => x.id)).toContain("p:teto");
    expect(temas.every((x) => x.faltan >= t.minimo && x.id !== "todo")).toBe(true);
    const pool = coins.poolTematico("p:miku");
    expect(pool.some((o) => o.origen === "render")).toBe(true);
    expect(pool.every((o) => o.personajes?.includes("miku") && !["fundador", "membresia", "contrabando", "prestigio"].includes(o.rareza))).toBe(true);

    expect(coins.openTematico("u", "p:miku", "pago")).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "monedas", t.precio * 5, "prueba");
    for (let i = 0; i < 5; i++) {
      const r = coins.openTematico("u", "p:miku", "pago");
      if ("ok" in r) throw new Error(r.motivo);
      expect(r.objetos.every((x) => x.objeto.personajes?.includes("miku"))).toBe(true);
    }
    expect(coins.wallet("u").monedas).toBe(0);

    // Un común regalado + Ecos.
    expect(coins.openTematico("u", "x:navidad", "regalado")).toMatchObject({ ok: false });
    coins.giveSobres("u", "comun");
    coins.adjust("u", "ecos", t.ecos, "prueba");
    const antes = coins.wallet("u").ecos;
    const r = coins.openTematico("u", "x:navidad", "regalado");
    if ("ok" in r) throw new Error(r.motivo);
    expect(r.objetos.every((x) => x.objeto.temas?.includes("navidad"))).toBe(true);
    expect(coins.wallet("u").gratis).toBe(0);
    expect(coins.wallet("u").ecos).toBe(antes - t.ecos + r.ecos);

    // Boda: un sobre de esa Vocaloid, que se abre una sola vez (Mango9374 no tiene objetos).
    expect(coins.regalarTematicoDe("u", "teto")).toBe("Sobre de Teto");
    expect(coins.regalarTematicoDe("u", "mango")).toBeNull();
    const [p] = coins.tematicosPendientes("u");
    expect(p).toMatchObject({ tema: "p:teto", origen: "boda" });
    const b = coins.openTematico("u", "ignorado", p!.id);
    if ("ok" in b) throw new Error(b.motivo);
    expect(b.tema).toBe("p:teto");
    expect(b.objetos.every((x) => x.objeto.personajes?.includes("teto"))).toBe(true);
    expect(coins.tematicosPendientes("u")).toEqual([]);
    expect(coins.openTematico("u", "p:teto", p!.id)).toMatchObject({ ok: false });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sobres_tematicos WHERE abierto_at IS NOT NULL").get()).toEqual({ n: 1 });
  });

  it("la compra respeta la vitrina y el descuento de membresía, y no deja comprar dos veces", () => {
    const { coins } = setup();
    const v = coins.vitrina()!;
    const render = v.objetos.map((id) => coins.byId.get(id)!).find((o) => o.origen === "render")!;
    const arte = v.objetos.map((id) => coins.byId.get(id)!).find((o) => o.origen === "arte")!;
    expect(coins.buy("u", render.id)).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "monedas", 5000, "prueba");
    // Los renders también se compran con Shaulitas (se ganan jugando).
    expect(coins.buy("u", render.id)).toMatchObject({ ok: true, pago: priceOf(S, render) });
    const ok = coins.buy("u", arte.id, 20);
    expect("pago" in ok && ok.pago).toBe(conDescuento(priceOf(S, arte)!, 20));
    expect(conDescuento(150, 15)).toBe(127);
    expect(conDescuento(60, 0)).toBe(60);
    expect(coins.buy("u", arte.id)).toEqual({ ok: false, motivo: "Ya lo tienes." });
    const fuera = CAT.find((o) => priceOf(S, o) !== null && !v.objetos.includes(o.id))!;
    expect(coins.buy("u", fuera.id)).toEqual({ ok: false, motivo: "Ese objeto ya no está en la vitrina." });
  });

  it("fabricar cuesta el precio en Ecos; equipar solo lo que tiene", () => {
    const { coins } = setup();
    const o = CAT.find((x) => x.rareza === "rara" && x.tipo === "borde")!;
    expect(coins.craft("u", o.id)).toEqual({ ok: false, motivo: "no_alcanza_ecos" });
    coins.adjust("u", "ecos", priceOf(S, o)!, "prueba");
    expect(coins.craft("u", o.id)).toMatchObject({ ok: true });
    expect(coins.equip("u", "borde", ["noche-de-estreno"])).toEqual({ ok: false, motivo: "No tienes ese objeto." });
    coins.equip("u", "borde", [o.id]);
    expect(coins.equipped("u").get("borde")?.id).toBe(o.id);
    coins.equip("u", "borde", null);
    expect(coins.equipped("u").has("borde")).toBe(false);
  });

  it("paquete de fundadores una sola vez", () => {
    const { coins } = setup();
    const f = S.fundadores[1]!;
    expect(coins.grantFounders()).toContain(f.id);
    expect(coins.grantFounders()).toEqual([]);
    expect(coins.owned(f.id).has("noche-de-estreno")).toBe(true);
    expect(coins.founderNumber(f.id)).toBe(f.numero);
  });

  it("la insignia de membresía se da una vez, para siempre, y se pone si hay lugar", () => {
    const { coins } = setup();
    expect(coins.membershipBadges("u", ["🐟 Atún"]).map((o) => o.id)).toEqual(["insignia-membresia-atun"]);
    expect(coins.membershipBadges("u", ["🐟 Atún"])).toEqual([]);
    expect(coins.equipped("u").get("insignia1")?.id).toBe("insignia-membresia-atun");
    // Aunque deje la membresía, la sigue teniendo.
    coins.membershipBadges("u", []);
    expect(coins.owned("u").has("insignia-membresia-atun")).toBe(true);
    // Con las tres insignias puestas, no le cambia lo que eligió.
    const tres = ["insignia-puerro", "insignia-atun", "insignia-baguette"];
    coins.adjust("v", "ecos", 1000, "prueba");
    for (const id of tres) expect(coins.craft("v", id)).toMatchObject({ ok: true });
    coins.equip("v", "insignia", tres);
    expect(coins.membershipBadges("v", ["💥 Triple Baka"])).toHaveLength(1);
    expect([...coins.equipped("v").values()].map((o) => o.id)).toEqual(tres);
  });

  it("los sobres raros y legendarios se regalan o se compran con Shaulitas, a su precio", () => {
    const { coins } = setup();
    coins.adjust("u", "monedas", 1000, "prueba");
    expect(coins.openSobre("u", true, "legendario")).toMatchObject({ ok: false });
    // Raro: 500, al menos una Épica.
    const raro = coins.openSobre("u", false, "raro");
    expect(raro).toMatchObject({ tipo: "raro", gratis: false });
    if ("objetos" in raro) expect(raro.objetos.some((x) => ["epica", "legendaria", "mitica"].includes(x.objeto.rareza))).toBe(true);
    expect(coins.wallet("u").monedas).toBe(500);
    // Legendario: 1.200, no alcanza con 500.
    expect(coins.openSobre("u", false, "legendario")).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "monedas", 700, "prueba");
    const leg = coins.openSobre("u", false, "legendario");
    expect(leg).toMatchObject({ tipo: "legendario", gratis: false });
    expect(coins.wallet("u").monedas).toBe(0);
    expect(coins.openSobre("u", false, "raro")).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "monedas", 1000, "prueba");
    coins.giveSobres("u", "legendario");
    coins.giveSobres("u", "comun", 2);
    expect(coins.wallet("u")).toMatchObject({ gratis: 2, gratisRaro: 0, gratisLeg: 1 });
    const r = coins.openSobre("u", true, "legendario");
    expect(r).toMatchObject({ tipo: "legendario", gratis: true });
    if (!("objetos" in r)) return;
    expect(r.objetos.some((x) => x.objeto.rareza === "legendaria")).toBe(true);
    expect(coins.wallet("u")).toMatchObject({ gratisLeg: 0, monedas: 1000 });
  });
});

describe("precios de los sobres", () => {
  const s = loadCoinSettings();
  it("común 200, raro 500 y legendario 1.200", () => {
    expect(sobreKind(s, "comun").precio).toBe(200);
    expect(sobreKind(s, "raro").precio).toBe(500);
    expect(sobreKind(s, "legendario").precio).toBe(1200);
  });
  it("cada clase cuesta más que la anterior y el legendario más que un objeto Legendario de la tienda", () => {
    const [c, r, l] = (["comun", "raro", "legendario"] as const).map((t) => sobreKind(s, t).precio!);
    expect(c).toBeLessThan(r!);
    expect(r).toBeLessThan(l!);
    expect(l).toBeGreaterThan(s.precios.legendaria);
    expect(r).toBeGreaterThan(s.precios.epica);
  });
  it("una clase sin precio solo se regala", () => {
    const sin = { ...s, sobre: { ...s.sobre, tipos: { ...s.sobre.tipos, raro: { nombre: "Sobre raro", minimo: "epica" as const } } } };
    expect(sobreKind(sin, "raro").precio).toBeNull();
  });
});

describe("imágenes", () => {
  const card = { name: "Papu de prueba", avatar: null, level: 12, max: 99, prestige: 0, into: 50, needed: 200, tier: 1, rankName: "Voz de regadera", position: 3, quota: null, frase: null, accent: "#39C5BB", background: null, multiplier: 1 };

  it("la tarjeta sale como GIF si algo se mueve y como PNG si no", async () => {
    const byId = new Map(CAT.map((o) => [o.id, o]));
    const quieto = await renderCardAny(card, await toCardEquip(new Map([["borde", byId.get("pentagrama")!]]), null));
    expect(quieto.gif).toBe(false);
    expect(quieto.data.subarray(1, 4).toString()).toBe("PNG");
    const anim = await renderCardAny(card, await toCardEquip(new Map<string, Objeto>([["fondo", byId.get("mar-de-luces")!], ["insignia1", byId.get("insignia-fundador")!]]), 4));
    expect(anim.gif).toBe(true);
    expect(anim.data.subarray(0, 3).toString()).toBe("GIF");
  }, 30_000);

  it("monedero, vitrina, colección y sobre se dibujan", async () => {
    const objs = CAT.slice(0, 4);
    const w = { monedas: 450, ecos: 21, gratis: 1, gratisRaro: 0, gratisLeg: 0, sobres: 3, sinEpica: 3, sinLegendaria: 3, hoy: 35 };
    for (const buf of [
      await monederoImage("Papu de prueba", w, 10, 60),
      await vitrinaImage(objs.map((o) => ({ objeto: o, precio: 60, propio: false })), "Vitrina", "sub"),
      await coleccionSheet(objs, new Set([objs[0]!.id]), "Bordes"),
    ])
      expect(buf.subarray(1, 4).toString()).toBe("PNG");
    const gif = await sobreGif(objs.slice(0, 3).map((objeto, i) => ({ objeto, nuevo: i > 0, ecos: i ? 0 : 6 })));
    expect(gif.subarray(0, 3).toString()).toBe("GIF");
  }, 60_000);
});

describe("premio por ideas (GyroP, 18 nov. 2026)", () => {
  it("paga porIdea por cada idea, una sola vez por ronda y por Papu", async () => {
    const { loadPremiosIdeas, pagarPremiosIdeas } = await import("../src/coins/premios");
    const { memDb } = await import("./helpers");
    const { CoinService } = await import("../src/coins/service");
    const { loadCatalog, loadCoinSettings } = await import("../src/coins/rules");
    const db = memDb();
    const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago" });
    const p = loadPremiosIdeas();
    expect(p.porIdea).toBe(100);
    const pina = p.rondas["2026-11-18"]!.find((x) => x.nombre.includes("Piña"))!;
    const pagos = pagarPremiosIdeas(db, coins, p);
    expect(pagos.find((x) => x.id === pina.id)?.monto).toBe(100 * pina.ideas.length);
    expect(coins.wallet(pina.id).monedas).toBe(100 * pina.ideas.length);
    expect(pagarPremiosIdeas(db, coins, p)).toEqual([]);
    expect(coins.wallet(pina.id).monedas).toBe(100 * pina.ideas.length);
  });
});
