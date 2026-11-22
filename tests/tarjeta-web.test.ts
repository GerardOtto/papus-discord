import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CoinService } from "../src/coins/service";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { aplicar, elegidos, snapshot, type Eleccion } from "../src/coins/tarjeta-web";
import { TarjetaWeb } from "../src/discord/tarjeta-web";
import { LevelStore } from "../src/levels/store";
import { sqliteSql } from "../src/cloud/sql";
import { leerEleccion, MAX_PEDIDOS, tarjeta } from "../worker/src/tarjeta/api";
import { memDb } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLAVE = "clave-de-prueba-123";
const PAPU = "123456789012345678";
const CAT = loadCatalog();

function worker(now: () => number) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(ROOT, "worker/schema.sql"), "utf8"));
  const deps = { sql: sqliteSql(db), clave: CLAVE, now };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) =>
    (await tarjeta(new Request(String(url), init), deps)) ?? new Response("no", { status: 404 })) as typeof fetch;
  return { db, deps, fetchFn };
}

function bot(fetchFn: typeof fetch, now: () => number) {
  const db = memDb();
  const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: CAT, timeZone: "America/Santiago", now });
  const store = new LevelStore(db);
  const web = new TarjetaWeb({
    coins,
    store,
    cardData: async () => ({
      name: "Papu", avatar: null, level: 5, max: 99, prestige: 0, into: 1, needed: 10, tier: 1, rankName: "Demo", position: 1,
      quota: null, frase: null, accent: "#3355AA", background: null, multiplier: 1,
    }),
    founder: () => null,
    base: "https://web.test",
    clave: CLAVE,
    fetch: fetchFn,
    now,
  });
  return { coins, store, web };
}

const borde = CAT.find((o) => o.tipo === "borde" && o.origen === "arte")!;
const otroBorde = CAT.find((o) => o.tipo === "borde" && o.origen === "arte" && o.id !== borde.id)!;
const insignias = CAT.filter((o) => o.tipo === "insignia" && o.rareza === "comun").slice(0, 4);
const vacio = (): Eleccion => ({ fondo: null, borde: null, barra: null, nombre: null, aro: null, titulo: null, insignias: [], lado: "izquierda" });

describe("personalizar la tarjeta en la web", () => {
  it("la página solo puede pedir ids con forma válida (y hasta 3 insignias)", () => {
    expect(leerEleccion({ borde: "aro-simple", insignias: ["a", "b"], lado: "derecha" })).toMatchObject({ borde: "aro-simple", lado: "derecha" });
    expect(leerEleccion({ borde: "<script>" })).toBeNull();
    expect(leerEleccion({ insignias: ["a", "b", "c", "d"] })).toBeNull();
    expect(leerEleccion("hola")).toBeNull();
  });

  it("solo aplica lo que el Papu tiene y del tipo correcto", () => {
    const { coins } = bot(worker(() => 0).fetchFn, () => 0);
    coins.grant(PAPU, borde.id, "prueba");
    coins.grant(PAPU, insignias[0]!.id, "prueba");
    const e = { ...vacio(), borde: otroBorde.id, fondo: borde.id, insignias: [insignias[0]!.id, insignias[1]!.id] };
    expect(elegidos(coins, PAPU, e).descartados.sort()).toEqual([otroBorde.id, borde.id, insignias[1]!.id].sort());
    aplicar(coins, PAPU, { ...e, borde: borde.id });
    expect(coins.equipped(PAPU).get("borde")?.id).toBe(borde.id);
    expect(coins.equipped(PAPU).get("fondo")).toBeUndefined();
    expect(coins.equipped(PAPU).get("insignia1")?.id).toBe(insignias[0]!.id);
    expect(snapshot(coins, PAPU, "Papu", null).objetos.map((o) => o.id).sort()).toEqual([borde.id, insignias[0]!.id].sort());
  });

  it("de punta a punta: enlace, vista previa, guardar y el enlace vence", async () => {
    let t = 1_800_000_000_000;
    const now = () => t;
    const w = worker(now);
    const { coins, store, web } = bot(w.fetchFn, now);
    coins.grant(PAPU, borde.id, "prueba");
    const url = await web.abrir(PAPU, "Ana");
    const tok = new URL(url).searchParams.get("t")!;
    expect(tok.length).toBeGreaterThanOrEqual(40);
    const page = (p: string, init?: RequestInit) => w.fetchFn(`https://web.test/tarjeta/api/s/${tok}${p}`, init);

    const datos = (await (await page("")).json()) as { nombre: string; objetos: { id: string }[]; tarjeta: string };
    expect(datos.nombre).toBe("Ana");
    expect(datos.objetos.map((o) => o.id)).toEqual([borde.id]);
    expect(datos.tarjeta.length).toBeGreaterThan(1000);

    // Vista previa: no cambia nada de lo puesto.
    const pedir = async (tipo: string, eleccion: Eleccion) =>
      ((await (await page("/pedido", { method: "POST", body: JSON.stringify({ tipo, eleccion }) })).json()) as { id: number }).id;
    const v = await pedir("vista", { ...vacio(), borde: borde.id, lado: "derecha" });
    expect(await web.tick()).toBe(1);
    const rv = (await (await page(`/pedido/${v}`)).json()) as { estado: string; imagen: boolean };
    expect(rv).toMatchObject({ estado: "listo", imagen: true });
    expect((await page(`/pedido/${v}/imagen`)).headers.get("content-type")).toBe("image/jpeg");
    expect(coins.equipped(PAPU).get("borde")).toBeUndefined();

    // Guardar: lo pone (y el lado), pero no lo que no tiene.
    const g = await pedir("guardar", { ...vacio(), borde: borde.id, fondo: otroBorde.id, lado: "derecha" });
    await web.tick();
    expect(((await (await page(`/pedido/${g}`)).json()) as { mensaje: string }).mensaje).toMatch(/Guardado.*no se pusieron/);
    expect(coins.equipped(PAPU).get("borde")?.id).toBe(borde.id);
    expect(coins.equipped(PAPU).get("fondo")).toBeUndefined();
    expect(store.get(PAPU).card.lado).toBe("derecha");
    const despues = (await (await page("")).json()) as { nombre: string; equipado: Eleccion };
    expect(despues).toMatchObject({ nombre: "Ana", equipado: { borde: borde.id, lado: "derecha" } });

    // A los 30 min el enlace vence.
    t += 31 * 60_000;
    expect((await page("")).status).toBe(410);
  });

  it("la API del bot pide la clave; la página no puede apilar pedidos", async () => {
    const t = 1_800_000_000_000;
    const w = worker(() => t);
    const sin = await w.fetchFn("https://web.test/tarjeta/api/pendientes", { headers: { "x-papus-clave": "otra" } });
    expect(sin.status).toBe(401);
    const s = await w.fetchFn("https://web.test/tarjeta/api/sesion", {
      method: "POST",
      headers: { "x-papus-clave": CLAVE },
      body: JSON.stringify({ papu: PAPU, datos: { nombre: "Ana", objetos: [], equipado: vacio() } }),
    });
    const { token } = (await s.json()) as { token: string };
    const pedir = () => w.fetchFn(`https://web.test/tarjeta/api/s/${token}/pedido`, { method: "POST", body: JSON.stringify({ tipo: "vista", eleccion: vacio() }) });
    expect((await pedir()).status).toBe(200);
    expect((await pedir()).status).toBe(429); // el anterior sigue pendiente
    expect((await w.fetchFn("https://web.test/tarjeta/api/s/token-que-no-existe-0123456789/pedido/1")).status).toBe(410);
    expect(MAX_PEDIDOS).toBeGreaterThan(10);
    // La página se sirve y no la indexan los buscadores.
    const html = await w.fetchFn("https://web.test/tarjeta/");
    expect(html.headers.get("x-robots-tag")).toBe("noindex");
    expect(await html.text()).toContain("Vista previa");
  });
});
