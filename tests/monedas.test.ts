import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLECCION_DIR, hasArt, toCardEquip } from "../src/coins/equip";
import { boletaImage, coleccionSheet, monederoImage, sobreGif, vitrinaImage } from "../src/coins/images";
import {
  availableOn,
  dayEarnings,
  levelBonus,
  missionSobre,
  loadCatalog,
  loadCoinSettings,
  membershipBadges,
  membershipGift,
  paySplit,
  priceOf,
  rollSobre,
  seasonSchedule,
  sobreKind,
  sobrePool,
  weekStart,
  weekday,
  type CoinSettings,
  type Objeto,
} from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
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

  it("el paquete más grande alcanza para todo el arte propio de la temporada (decisión de GyroP)", () => {
    const arte = CAT.filter((o) => o.temporada === S.temporada.id && o.origen === "arte" && priceOf(S, o) !== null);
    const total = arte.reduce((a, o) => a + priceOf(S, o)!, 0);
    expect(Math.max(...S.paquetes.map((p) => p.monedas))).toBeGreaterThanOrEqual(total);
  });

  it("en Chile la transferencia sale más barata que PayPal", () => {
    for (const p of S.paquetes) expect(p.clp).toBeLessThan(p.usd * 900);
  });
});

describe("ganar", () => {
  it("1 moneda cada 20 XP con tope, más bonos; con strike, nada", () => {
    expect(dayEarnings(S, { ...idle, xp: 200 })).toBe(10);
    expect(dayEarnings(S, { ...idle, xp: 99_999 })).toBe(S.ganar.topeActividad);
    expect(dayEarnings(S, { ...idle, xp: 200, mensajes: 3, misiones: 2, bodas: 1, racha: true })).toBe(10 + 5 + 20 + 40 + 50);
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
  it("se paga primero con compradas; los renders, solo con ganadas", () => {
    expect(paySplit(150, { ganadas: 100, compradas: 100 }, false)).toEqual({ compradas: 100, ganadas: 50 });
    expect(paySplit(150, { ganadas: 100, compradas: 900 }, true)).toBeNull();
    expect(paySplit(150, { ganadas: 200, compradas: 900 }, true)).toEqual({ compradas: 0, ganadas: 150 });
  });

  it("las vitrinas cambian lunes y jueves y cada objeto que se vende sale al menos una vez en la temporada", () => {
    const sched = seasonSchedule(S, CAT);
    expect(sched[0]!.desde).toBe(S.temporada.desde);
    for (const v of sched.slice(1)) expect(S.vitrinas.dias).toContain(weekday(v.desde));
    for (const v of sched.slice(0, -1)) expect(Date.parse(v.hasta) - Date.parse(v.desde)).toBeGreaterThanOrEqual(2 * 86_400_000);
    const seen = new Set(sched.flatMap((v) => v.objetos));
    const vende = CAT.filter((o) => o.temporada === S.temporada.id && priceOf(S, o) !== null);
    // Los limitados fuera de la temporada (Halloween, si la temporada no lo incluye) no pueden salir.
    const posibles = vende.filter((o) => {
      for (const v of sched) for (let d = v.desde; d < v.hasta; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) if (availableOn(o, d)) return true;
      return false;
    });
    for (const o of posibles) expect(seen.has(o.id), o.id).toBe(true);
    for (const v of sched) {
      const objs = v.objetos.map((id) => CAT.find((o) => o.id === id)!);
      expect(objs.filter((o) => o.origen === "arte").length).toBeLessThanOrEqual(S.vitrinas.arte);
      expect(objs.filter((o) => o.origen === "render").length).toBeLessThanOrEqual(S.vitrinas.renders);
      expect(new Set(v.objetos).size).toBe(v.objetos.length);
    }
  });

  it("cada rol de membresía tiene su insignia, que no se vende ni se fabrica", () => {
    const ids = Object.values(S.insigniasMembresia!);
    expect(Object.keys(S.insigniasMembresia!)).toEqual(Object.keys(S.membresias));
    for (const id of ids) {
      const o = CAT.find((x) => x.id === id)!;
      expect(o, id).toBeDefined();
      expect(o).toMatchObject({ tipo: "insignia", rareza: "membresia" });
      expect(priceOf(S, o)).toBeNull();
    }
    expect(membershipBadges(S, ["🥬 Puerro", "💥 Triple Baka", "Papu"])).toEqual(["insignia-membresia-puerro", "insignia-membresia-triple-baka"]);
  });

  it("el regalo de membresía es el del nivel más alto", () => {
    expect(membershipGift(S, ["🥬 Puerro", "🥖 Baguette"])).toEqual({ rol: "🥖 Baguette", monedas: S.membresias["🥖 Baguette"] });
    expect(membershipGift(S, ["Papu"])).toBeNull();
  });
});

/** Servicio con niveles de verdad y un reloj que se puede mover. */
function setup(settings: CoinSettings = S) {
  const db = memDb();
  let now = Date.parse("2026-11-10T12:00:00-03:00");
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
    expect(w1.ganadas).toBeGreaterThan(S.ganar.primerMensaje);
    coins.sync("u");
    expect(coins.wallet("u").ganadas).toBe(w1.ganadas);
    levels.onStrike("u");
    db.prepare("UPDATE xp_dia SET castigo = 1 WHERE user_id = 'u'").run();
    coins.sync("u");
    expect(coins.wallet("u").ganadas).toBe(0);
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

  it("abrir sobres cuesta ganadas, guarda objetos y los repetidos dan Ecos", () => {
    const { coins } = setup();
    expect(coins.openSobre("u", false)).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "ganadas", S.sobre.precio * 30, "prueba");
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const r = coins.openSobre("u", false);
      if ("ok" in r) throw new Error(r.motivo);
      total += r.objetos.length;
    }
    const w = coins.wallet("u");
    expect(w.ganadas).toBe(0);
    expect(w.sobres).toBe(30);
    expect(coins.owned("u").size).toBeLessThan(total);
    expect(w.ecos).toBeGreaterThan(0);
  });

  it("la compra respeta la vitrina, los bolsillos y no deja comprar dos veces", () => {
    const { coins } = setup();
    const v = coins.vitrina()!;
    const render = v.objetos.map((id) => coins.byId.get(id)!).find((o) => o.origen === "render")!;
    const arte = v.objetos.map((id) => coins.byId.get(id)!).find((o) => o.origen === "arte")!;
    coins.adjust("u", "compradas", 5000, "prueba");
    expect(coins.buy("u", render.id)).toEqual({ ok: false, motivo: "no_alcanza_ganadas" });
    const ok = coins.buy("u", arte.id);
    expect("pago" in ok && ok.pago.compradas).toBe(priceOf(S, arte));
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

  it("un pedido se paga una sola vez al confirmarlo, y el límite y el bloqueo de GyroP se respetan", () => {
    const { coins } = setup();
    const p = coins.createOrder("u", "bolsa", "paypal");
    if ("ok" in p) throw new Error(p.motivo);
    expect(p.codigo).toMatch(/^SC-[A-Z2-9]{4}$/);
    coins.markNotified(p.codigo, "msg");
    coins.confirmOrder(p.codigo);
    coins.confirmOrder(p.codigo);
    expect(coins.wallet("u").compradas).toBe(p.monedas);
    expect(coins.spentThisMonth("u")).toBe(p.usd);
    coins.setLimit("u", p.usd + 1);
    expect(coins.createOrder("u", "bolsa", "paypal")).toEqual({ ok: false, motivo: "limite" });
    coins.setBlocked("u", true);
    expect(coins.createOrder("u", "punado", "transferencia")).toEqual({ ok: false, motivo: "bloqueado" });
    coins.refundOrder(p.codigo);
    expect(coins.wallet("u").compradas).toBe(0);
  });

  it("regalo de membresía cada 30 días y paquete de fundadores una sola vez", () => {
    const { coins, at, now } = setup();
    expect(coins.membership("u", ["🐟 Atún"])?.monedas).toBe(S.membresias["🐟 Atún"]);
    expect(coins.membership("u", ["🐟 Atún"])).toBeNull();
    at(now() + 31 * 86_400_000);
    expect(coins.membership("u", ["🐟 Atún"])).not.toBeNull();
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

  it("los sobres raros y legendarios se regalan o se compran con ganadas, a su precio", () => {
    const { coins } = setup();
    coins.adjust("u", "ganadas", 1000, "prueba");
    expect(coins.openSobre("u", true, "legendario")).toMatchObject({ ok: false });
    // Raro: 500 ganadas, al menos una Épica.
    const raro = coins.openSobre("u", false, "raro");
    expect(raro).toMatchObject({ tipo: "raro", gratis: false });
    if ("objetos" in raro) expect(raro.objetos.some((x) => ["epica", "legendaria", "mitica"].includes(x.objeto.rareza))).toBe(true);
    expect(coins.wallet("u").ganadas).toBe(500);
    // Legendario: 1.200, no alcanza con 500.
    expect(coins.openSobre("u", false, "legendario")).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "ganadas", 700, "prueba");
    const leg = coins.openSobre("u", false, "legendario");
    expect(leg).toMatchObject({ tipo: "legendario", gratis: false });
    expect(coins.wallet("u").ganadas).toBe(0);
    // Las compradas nunca abren sobres.
    coins.adjust("u", "compradas", 5000, "prueba");
    expect(coins.openSobre("u", false, "raro")).toEqual({ ok: false, motivo: "no_alcanza" });
    coins.adjust("u", "ganadas", 1000, "prueba");
    coins.giveSobres("u", "legendario");
    coins.giveSobres("u", "comun", 2);
    expect(coins.wallet("u")).toMatchObject({ gratis: 2, gratisRaro: 0, gratisLeg: 1 });
    const r = coins.openSobre("u", true, "legendario");
    expect(r).toMatchObject({ tipo: "legendario", gratis: true });
    if (!("objetos" in r)) return;
    expect(r.objetos.some((x) => x.objeto.rareza === "legendaria")).toBe(true);
    expect(coins.wallet("u")).toMatchObject({ gratisLeg: 0, ganadas: 1000, compradas: 5000 });
  });
});

describe("precios de los sobres", () => {
  const s = loadCoinSettings();
  it("común 200, raro 500 y legendario 1.200 (solo ganadas)", () => {
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

  it("monedero, boleta, vitrina, colección y sobre se dibujan", async () => {
    const objs = CAT.slice(0, 4);
    const w = { ganadas: 450, compradas: 1200, ecos: 21, gratis: 1, gratisRaro: 0, gratisLeg: 0, sobres: 3, sinEpica: 3, sinLegendaria: 3, hoy: 35 };
    for (const buf of [
      await monederoImage("Papu de prueba", w, 10, 60),
      await boletaImage("SC-ABCD", "Bolsa", 3100, 4000, { banco: "Banco", tipo: "Cuenta", numero: "1", rut: "1-9", nombre: "N", correo: "c@c.cl" }),
      await vitrinaImage(objs.map((o) => ({ objeto: o, precio: 60, propio: false })), "Vitrina", "sub"),
      await coleccionSheet(objs, new Set([objs[0]!.id]), "Bordes"),
    ])
      expect(buf.subarray(1, 4).toString()).toBe("PNG");
    const gif = await sobreGif(objs.slice(0, 3).map((objeto, i) => ({ objeto, nuevo: i > 0, ecos: i ? 0 : 6 })));
    expect(gif.subarray(0, 3).toString()).toBe("GIF");
  }, 60_000);
});
