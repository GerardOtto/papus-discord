import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { buscar, describir, estaVacio, loadIntercambioSettings, normalizar, vacio, type Paquete } from "../src/intercambios/rules";
import { IntercambioService } from "../src/intercambios/service";
import { loadLevelSettings, xpToReach } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { loadMercadoSettings } from "../src/mercado/rules";
import { MercadoService } from "../src/mercado/service";
import { Quota } from "../src/quota/quota";
import { loadRouletteSettings } from "../src/ruleta/rules";
import { RouletteService } from "../src/ruleta/service";
import { loadTriviaSettings } from "../src/trivia/rules";
import { TriviaService } from "../src/trivia/service";
import type { WeddingService } from "../src/bodas/service";
import { memDb, seededRng } from "./helpers";

const TZ = "America/Santiago";
const NOON = Date.parse("2026-11-10T12:00:00-03:00");
const S = loadIntercambioSettings();
const L = loadLevelSettings();

function setup() {
  const db = memDb();
  let now = NOON;
  const clock = () => now;
  const levels = new LevelService({ db, settings: L, timeZone: TZ });
  const quota = new Quota(db, (id, d) => levels.limitFor(id, d), TZ);
  const roulette = new RouletteService({ db, settings: loadRouletteSettings(), levels, quota, timeZone: TZ, now: clock, rnd: seededRng(3) });
  const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: TZ, now: clock });
  const trivia = new TriviaService({ db, settings: loadTriviaSettings(), questions: [], levels, timeZone: TZ, now: clock, rnd: seededRng(5) });
  const mercado = new MercadoService({ db, settings: loadMercadoSettings(), coins, quota, roulette, trivia, weddings: {} as WeddingService, timeZone: TZ, now: clock });
  const svc = new IntercambioService({ db, settings: S, coins, levels, quota, mercado, timeZone: TZ, now: clock });
  return { db, svc, coins, levels, quota, mercado, tick: (ms: number) => (now += ms) };
}

const P = (p: Partial<Paquete>): Paquete => ({ ...vacio(), ...p, sobres: { ...vacio().sobres, ...p.sobres } });

describe("reglas de los intercambios", () => {
  it("normaliza: enteros, topes, sin repetidos ni ceros", () => {
    const p = normalizar({ ganadas: 10.7, xp: -5, objetos: ["a", "a", "b"], consumibles: { x: 0, y: 2 } } as Partial<Paquete>);
    expect(p.ganadas).toBe(10);
    expect(p.xp).toBe(0);
    expect(p.objetos).toEqual(["a", "b"]);
    expect(p.consumibles).toEqual({ y: 2 });
    expect(estaVacio(vacio())).toBe(true);
    expect(estaVacio(P({ sobres: { comun: 1, raro: 0, legendario: 0 } }))).toBe(false);
  });

  it("describe cada cosa en una línea y busca objetos por nombre sin acentos", () => {
    const lines = describir(P({ ganadas: 1500, niveles: 1, objetos: ["pentagrama"] }), { objeto: () => ({ nombre: "Pentagrama" }), consumible: () => null });
    expect(lines).toEqual(["🪙 **1.500** Shaula-coins ganadas", "🆙 **1** nivel (la XP depende del nivel de quien los entregue)", "🖼️ **Pentagrama**"]);
    // Con quien los entrega conocido, los niveles se traducen a su XP.
    const conXp = describir(P({ niveles: 3 }), { objeto: () => null, consumible: () => null }, 12345);
    expect(conXp).toEqual(["🆙 **3** niveles (= **12.345** XP)"]);
    expect(buscar([{ id: "a", nombre: "Cinta de casete" }, { id: "b", nombre: "Canción" }], "cancion")?.id).toBe("b");
    expect(buscar([{ id: "a", nombre: "Cinta de casete" }], "cinta")?.id).toBe("a");
  });
});

describe("intercambios", () => {
  it("una oferta abierta la acepta cualquiera y cambia todo de una vez", () => {
    const { svc, coins, mercado } = setup();
    coins.adjust("a", "ganadas", 1000, "test");
    coins.adjust("b", "compradas", 500, "test");
    coins.grant("b", "pentagrama", "test");
    coins.giveSobres("a", "raro", 2);
    const r = svc.crear("a", null, P({ ganadas: 800, sobres: { comun: 0, raro: 1, legendario: 0 } }), P({ compradas: 300, objetos: ["pentagrama"] }));
    expect(r.ok).toBe(true);
    const id = (r as { oferta: { id: number } }).oferta.id;
    expect(svc.aceptar(id, "a")).toEqual({ ok: false, motivo: "propia" });
    const h = svc.aceptar(id, "b");
    expect(h.ok).toBe(true);
    expect(coins.wallet("a")).toMatchObject({ ganadas: 200, compradas: 300, gratisRaro: 1 });
    expect(coins.wallet("b")).toMatchObject({ ganadas: 800, compradas: 200, gratisRaro: 1 });
    expect(coins.owned("a").has("pentagrama")).toBe(true);
    expect(coins.owned("b").has("pentagrama")).toBe(false);
    expect(svc.get(id)).toMatchObject({ estado: "hecha", con: "b" });
    // Ya cerrada: nadie más la acepta.
    expect(svc.aceptar(id, "c")).toEqual({ ok: false, motivo: "cerrada" });
    void mercado;
  });

  it("no publica lo que no tienes ni ofertas vacías", () => {
    const { svc } = setup();
    expect(svc.crear("a", null, P({ ganadas: 10 }), vacio())).toEqual({ ok: false, motivo: "vacia" });
    expect(svc.crear("a", "a", P({ ganadas: 10 }), P({ xp: 1 }))).toEqual({ ok: false, motivo: "a_ti" });
    const r = svc.crear("a", null, P({ ganadas: 10 }), P({ xp: 1 }));
    expect(r).toEqual({ ok: false, motivo: { falta: [{ que: "ganadas", tiene: 0, pide: 10 }] } });
  });

  it("si al aceptar ya no tiene lo suyo, no cambia nada", () => {
    const { svc, coins } = setup();
    coins.adjust("a", "ganadas", 100, "test");
    coins.adjust("b", "ganadas", 50, "test");
    const id = (svc.crear("a", null, P({ ganadas: 100 }), P({ ganadas: 50 })) as { oferta: { id: number } }).oferta.id;
    coins.spendGanadas("a", 60, "gastó");
    const r = svc.aceptar(id, "b");
    expect(r.ok).toBe(false);
    expect(coins.wallet("a").ganadas).toBe(40);
    expect(coins.wallet("b").ganadas).toBe(50);
    expect(svc.get(id)?.estado).toBe("abierta");
  });

  it("niveles se cambian como su XP y no cuentan como XP del día", () => {
    const { svc, levels, db, quota } = setup();
    levels.store.raiseTo("a", xpToReach(L, 20) + 7);
    // Con la cuota llena no cabe el mensaje que pide: gasta uno antes.
    quota.reserve("a", 1, new Date(NOON));
    const xp3 = xpToReach(L, 20) - xpToReach(L, 17);
    const id = (svc.crear("a", "b", P({ niveles: 3 }), P({ cuota: 1 })) as { oferta: { id: number } }).oferta.id;
    const h = svc.aceptar(id, "b");
    expect(h.ok).toBe(true);
    expect(levels.store.get("a").xp).toBe(xpToReach(L, 17) + 7);
    expect(levels.store.get("b").xp).toBe(xp3);
    expect(levels.level("a").level).toBe(17);
    expect((db.prepare("SELECT COUNT(*) AS n FROM xp_dia").get() as { n: number }).n).toBe(0);
    // Cambios de nivel de los dos (para el apodo y el honor).
    expect((h as { cambios: { userId: string }[] }).cambios.map((c) => c.userId).sort()).toEqual(["a", "b"]);
  });

  it("no se puede bajar del nivel 1 ni pasar XP sobre el máximo", () => {
    const { svc, levels } = setup();
    levels.store.raiseTo("a", xpToReach(L, 3));
    expect(svc.crear("a", null, P({ niveles: 3 }), P({ ganadas: 1 }))).toMatchObject({ ok: false, motivo: { falta: [{ que: "niveles" }] } });
    levels.store.raiseTo("b", xpToReach(L, L.curva.maximo));
    levels.store.raiseTo("c", 10_000);
    const id = (svc.crear("c", "b", P({ xp: 500 }), P({ cuota: 1 })) as { oferta: { id: number } }).oferta.id;
    expect(svc.aceptar(id, "b")).toMatchObject({ ok: false, motivo: { faltaTuyo: [{ que: "xp_maxima" }] } });
  });

  it("cuota de hoy: se pasa como /donar y la oferta vence al terminar el día", () => {
    const { svc, quota, coins, tick } = setup();
    coins.adjust("b", "ganadas", 100, "test");
    const r = svc.crear("a", null, P({ cuota: 2 }), P({ ganadas: 100 }));
    expect(r.ok).toBe(true);
    const o = (r as { oferta: { id: number; venceAt: number } }).oferta;
    expect(o.venceAt).toBe(Date.parse("2026-11-11T00:00:00-03:00"));
    quota.reserve("b", 2, new Date(NOON));
    const before = quota.remaining("a", new Date(NOON));
    expect(svc.aceptar(o.id, "b").ok).toBe(true);
    expect(quota.remaining("a", new Date(NOON))).toBe(before - 2);
    expect(quota.extra("b", new Date(NOON))).toBe(2);
    // Otra con cuota vence a medianoche.
    coins.adjust("b", "ganadas", 100, "test");
    const id2 = (svc.crear("a", null, P({ cuota: 1 }), P({ ganadas: 100 })) as { oferta: { id: number } }).oferta.id;
    tick(13 * 3_600_000);
    expect(svc.vencer().map((x) => x.id)).toEqual([id2]);
    expect(svc.aceptar(id2, "b")).toEqual({ ok: false, motivo: "cerrada" });
  });

  it("dirigida: solo ese Papu acepta, rechaza o contraoferta (y la original se cierra)", () => {
    const { svc, coins } = setup();
    coins.adjust("a", "ganadas", 500, "test");
    coins.adjust("b", "ganadas", 500, "test");
    const id = (svc.crear("a", "b", P({ ganadas: 100 }), P({ ganadas: 300 })) as { oferta: { id: number } }).oferta.id;
    expect(svc.aceptar(id, "c")).toEqual({ ok: false, motivo: "no_es_para_ti" });
    expect(svc.rechazar(id, "c")).toBeNull();
    const c = svc.crear("b", "a", P({ ganadas: 200 }), P({ ganadas: 100 }), id);
    expect(c.ok).toBe(true);
    expect(svc.get(id)?.estado).toBe("contraofertada");
    const cid = (c as { oferta: { id: number } }).oferta.id;
    expect(svc.aceptar(cid, "a").ok).toBe(true);
    expect(coins.wallet("a").ganadas).toBe(600);
    expect(coins.wallet("b").ganadas).toBe(400);
  });

  it("los consumibles pasan sus usos y los objetos de fundador no se cambian", () => {
    const { svc, coins, mercado, db } = setup();
    db.prepare("INSERT INTO consumibles (user_id, objeto, usos) VALUES ('a', 'atun-luka', 3)").run();
    coins.grant("a", "insignia-fundador", "test");
    coins.adjust("b", "ganadas", 10, "test");
    expect(svc.crear("a", null, P({ objetos: ["insignia-fundador"] }), P({ ganadas: 10 }))).toMatchObject({ ok: false, motivo: { falta: [{ que: "objeto_no_se_cambia" }] } });
    const id = (svc.crear("a", null, P({ consumibles: { "atun-luka": 2 } }), P({ ganadas: 10 })) as { oferta: { id: number } }).oferta.id;
    expect(svc.aceptar(id, "b").ok).toBe(true);
    expect(mercado.usos("a", "atun-luka")).toBe(1);
    expect(mercado.usos("b", "atun-luka")).toBe(2);
  });

  it("el objeto equipado se desequipa al entregarlo; quien ya lo tiene no lo recibe", () => {
    const { svc, coins } = setup();
    coins.grant("a", "pentagrama", "test");
    coins.grant("c", "pentagrama", "test");
    coins.equip("a", coins.byId.get("pentagrama")!.tipo, ["pentagrama"]);
    coins.adjust("b", "ganadas", 10, "test");
    coins.adjust("c", "ganadas", 10, "test");
    const id = (svc.crear("a", null, P({ objetos: ["pentagrama"] }), P({ ganadas: 10 })) as { oferta: { id: number } }).oferta.id;
    expect(svc.aceptar(id, "c")).toMatchObject({ ok: false, motivo: { faltaTuyo: [{ que: "ya_tiene_objeto" }] } });
    expect(svc.aceptar(id, "b").ok).toBe(true);
    expect([...coins.equipped("a").values()].map((o) => o.id)).not.toContain("pentagrama");
  });

  it("tope de ofertas abiertas por Papu y retirar", () => {
    const { svc, coins } = setup();
    coins.adjust("a", "ganadas", 100, "test");
    const ids = Array.from({ length: S.maxAbiertas }, () => (svc.crear("a", null, P({ ganadas: 1 }), P({ xp: 1 })) as { oferta: { id: number } }).oferta.id);
    expect(svc.crear("a", null, P({ ganadas: 1 }), P({ xp: 1 }))).toEqual({ ok: false, motivo: "demasiadas" });
    expect(svc.retirar(ids[0]!, "b")).toBeNull();
    expect(svc.retirar(ids[0]!, "a")?.estado).toBe("cancelada");
    expect(svc.crear("a", null, P({ ganadas: 1 }), P({ xp: 1 })).ok).toBe(true);
  });
});
