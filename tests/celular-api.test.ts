import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { PuenteCelular } from "../src/celular/puente";
import { completo, elegidoDelDia, type CelularSettings, type Personaje } from "../src/celular/rules";
import { sqliteSql } from "../src/cloud/sql";
import { Celular } from "../worker/src/celular/api";
import type { DatosCelular, EstadoSilueta, EstadoVocaloidle, Inicio } from "../worker/src/celular/tipos";

const ROOT = path.resolve(import.meta.dirname, "..");
const settings = JSON.parse(readFileSync(path.join(ROOT, "config/celular.json"), "utf8")) as CelularSettings;
const { personajes } = JSON.parse(readFileSync(path.join(ROOT, "content/vocaloidle.json"), "utf8")) as { personajes: Personaje[] };
const niveles = settings.silueta.bloques.length + 1;
const datos: DatosCelular = {
  settings,
  personajes,
  silueta: ["miku", "teto", "luka"].map((id) => ({ id, imagenes: [Array.from({ length: niveles }, (_, k) => `${id}-${k}.webp`)] })),
};
// 18 nov. 2026, 18:00 UTC (mediodía en México).
const T0 = Date.UTC(2026, 10, 18, 18, 0);
const PAPU = "123456789012345678";

function montar(now = () => T0) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(ROOT, "worker/schema.sql"), "utf8"));
  const sql = sqliteSql(db);
  const pedidas: string[] = [];
  const cel = new Celular({
    sql,
    datos,
    clientId: "1",
    clientSecret: "s",
    prueba: true,
    now,
    identificar: async (s) => (s.token === "bueno" ? { id: PAPU, nombre: "Papu", avatar: "a.png" } : s.token === "fuera" ? { motivo: "No eres del servidor" } : null),
    asset: async (ruta) => (pedidas.push(ruta), new Response("img", { headers: { "content-type": "image/webp" } })),
  });
  const pedir = async (ruta: string, cuerpo?: unknown, sesion = "") => {
    const r = await cel.handle(
      new Request(`https://w.test/celular/api/${ruta}`, {
        method: cuerpo === undefined ? "GET" : "POST",
        headers: { "x-celular-sesion": sesion, "content-type": "application/json" },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      }),
    );
    return r!;
  };
  const entrar = async () => ((await (await pedir("entrar", { token: "bueno" })).json()) as { sesion: string }).sesion;
  return { db, sql, cel, pedir, entrar, pedidas };
}

const json = async <T>(r: Response) => (await r.json()) as T;

describe("celular: entrada", () => {
  it("da una sesión solo a los Papus del servidor", async () => {
    const { pedir, entrar } = montar();
    expect((await pedir("entrar", { token: "fuera" })).status).toBe(403);
    expect((await pedir("entrar", { token: "malo" })).status).toBe(401);
    const s = await entrar();
    expect(s.length).toBeGreaterThan(20);
    expect((await pedir("inicio")).status).toBe(401);
    expect((await pedir("inicio", undefined, s)).status).toBe(200);
  });

  it("la sesión vence", async () => {
    let t = T0;
    const { pedir, entrar } = montar(() => t);
    const s = await entrar();
    t += settings.sesionHoras * 3_600_000 + 1;
    expect((await pedir("inicio", undefined, s)).status).toBe(401);
  });

  it("guarda el tema y pide el perfil a Neru", async () => {
    const { pedir, entrar, db } = montar();
    const s = await entrar();
    let i = await json<Inicio>(await pedir("inicio", undefined, s));
    expect(i.prefs).toEqual({ tema: "neru", iconos: "tema" });
    expect(i.perfil).toEqual({ shaulitas: null, tarjeta: null });
    expect(i.opciones.vocaloidle).toHaveLength(personajes.length);
    await pedir("prefs", { tema: "miku", iconos: "orig" }, s);
    await pedir("prefs", { tema: "nada" }, s);
    i = await json<Inicio>(await pedir("inicio", undefined, s));
    expect(i.prefs).toEqual({ tema: "miku", iconos: "orig" });
    expect(db.prepare("SELECT pedido_at > actualizado_at AS p FROM celular_perfiles").get()).toEqual({ p: 1 });
  });
});

describe("celular: Vocaloidle", () => {
  it("da pistas, no repite intentos, y al acertar deja la XP para Neru (una vez)", async () => {
    const { pedir, entrar, db } = montar();
    const s = await entrar();
    const ids = personajes.filter(completo).map((p) => p.id);
    const e0 = await json<EstadoVocaloidle>(await pedir("vocaloidle", undefined, s));
    expect(e0.pistas).toEqual([]);
    const secreto = elegidoDelDia(ids, e0.numero, "papus-vocaloidle-v1");
    const otro = ids.find((x) => x !== secreto)!;
    const e1 = await json<EstadoVocaloidle>(await pedir("vocaloidle", { personaje: otro }, s));
    expect(e1.pistas).toHaveLength(1);
    expect(e1.resuelto).toBe(false);
    expect(e1.compartir).toBeNull();
    expect((await pedir("vocaloidle", { personaje: otro }, s)).status).toBe(400);
    expect((await pedir("vocaloidle", { personaje: "nadie" }, s)).status).toBe(400);
    const e2 = await json<EstadoVocaloidle>(await pedir("vocaloidle", { personaje: secreto }, s));
    expect(e2.resuelto).toBe(true);
    expect(e2.aciertos).toBe(3);
    expect(e2.compartir).toMatch(/^Vocaloidle #\d+ · 2 intentos/);
    expect((await pedir("vocaloidle", { personaje: ids.find((x) => x !== secreto && x !== otro)! }, s)).status).toBe(400);
    expect(db.prepare("SELECT papu_id, juego, intentos, aciertos FROM celular_premios").all()).toEqual([{ papu_id: PAPU, juego: "vocaloidle", intentos: 2, aciertos: 3 }]);
  });
});

describe("celular: Silueta", () => {
  it("solo deja ver la imagen del nivel ganado y la clara al resolver", async () => {
    const { pedir, entrar, pedidas } = montar();
    const s = await entrar();
    const e0 = await json<EstadoSilueta>(await pedir("silueta", undefined, s));
    expect(e0.nivel).toBe(0);
    expect((await pedir("silueta/imagen?nivel=1", undefined, s)).status).toBe(403);
    expect((await pedir("silueta/imagen?nivel=0", undefined, s)).status).toBe(200);
    const secreto = elegidoDelDia(["luka", "miku", "teto"], e0.numero, "papus-silueta-v1");
    expect(pedidas[0]).toBe(`/celular/s/${secreto}-0.webp`);
    const otro = ["luka", "miku", "teto"].find((x) => x !== secreto)!;
    const e1 = await json<EstadoSilueta>(await pedir("silueta", { personaje: otro }, s));
    expect(e1.nivel).toBe(1);
    expect(e1.respuesta).toBeNull();
    const e2 = await json<EstadoSilueta>(await pedir("silueta", { personaje: secreto }, s));
    expect(e2).toMatchObject({ resuelto: true, nivel: niveles - 1, aciertos: 3 });
    expect(e2.respuesta).toBeTruthy();
    expect(e2.compartir).toMatch(/🟥🟩$/);
    expect((await pedir(`silueta/imagen?nivel=${niveles - 1}`, undefined, s)).status).toBe(200);
  });
});

describe("celular: puente de Neru", () => {
  it("aplica la XP una sola vez y deja el perfil", async () => {
    const { pedir, entrar, sql, db } = montar();
    const s = await entrar();
    const ids = personajes.filter(completo).map((p) => p.id);
    const n = (await json<EstadoVocaloidle>(await pedir("vocaloidle", undefined, s))).numero;
    await pedir("vocaloidle", { personaje: elegidoDelDia(ids, n, "papus-vocaloidle-v1") }, s);
    const dados: [string, number][] = [];
    const query = async <T>(q: string, ...args: unknown[]) => {
      if (/^\s*(SELECT|UPDATE[\s\S]*RETURNING)/i.test(q)) return sql.all<T>(q, ...args);
      await sql.run(q, ...args);
      return [] as T[];
    };
    const puente = new PuenteCelular({ query, trivia: { dailyGameXp: (id, a) => (dados.push([id, a]), { xp: 40 * a, change: null }) }, now: () => T0 + 5000 });
    puente.perfil = async () => ({ shaulitas: 1234, tarjeta: Buffer.from("png") });
    expect(await puente.sync()).toEqual({ premios: 1, perfiles: 1 });
    expect(await puente.sync()).toEqual({ premios: 0, perfiles: 0 });
    expect(dados).toEqual([[PAPU, 3]]);
    expect(db.prepare("SELECT xp FROM celular_premios").get()).toEqual({ xp: 120 });
    const i = await json<Inicio>(await pedir("inicio", undefined, s));
    expect(i.perfil.shaulitas).toBe(1234);
    expect(i.perfil.tarjeta).toBe(`data:image/png;base64,${Buffer.from("png").toString("base64")}`);
  });
});

describe("celular: pedidos a Neru y Mi tarjeta", () => {
  it("de punta a punta: la página pide, Neru resuelve con lo que el Papu tiene, y nadie ve pedidos ajenos", async () => {
    const { CoinService } = await import("../src/coins/service");
    const { loadCatalog, loadCoinSettings } = await import("../src/coins/rules");
    const { LevelStore } = await import("../src/levels/store");
    const { AppsCelular } = await import("../src/discord/celular");
    const { memDb } = await import("./helpers");
    const { pedir, entrar, sql } = montar();
    const s = await entrar();

    const cat = loadCatalog();
    const db = memDb();
    const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: cat, timeZone: "America/Santiago", now: () => T0 });
    const store = new LevelStore(db);
    const apps = new AppsCelular({
      coins,
      store,
      cardData: async () => ({ name: "Papu", avatar: null, level: 5, max: 99, prestige: 0, into: 1, needed: 10, tier: 1, rankName: "Demo", position: 1, quota: null, frase: null, accent: "#3355AA", background: null, multiplier: 1 }),
      founder: () => null,
    });
    const borde = cat.find((o) => o.tipo === "borde" && o.origen === "arte")!;
    const ajeno = cat.find((o) => o.tipo === "fondo")!;
    coins.grant(PAPU, borde.id, "prueba");

    const query = async <T>(q: string, ...args: unknown[]) => {
      if (/^\s*(SELECT|UPDATE[\s\S]*RETURNING)/i.test(q)) return sql.all<T>(q, ...args);
      await sql.run(q, ...args);
      return [] as T[];
    };
    const { resolverPedidos } = await import("../src/celular/puente");
    const neru = () => resolverPedidos({ query, now: () => T0 }, (p) => apps.manejar(p));
    const nuevo = async (cuerpo: unknown) => (await json<{ id: number }>(await pedir("pedido", cuerpo, s))).id;
    const leer = async (id: number) => json<{ estado: string; resultado: Record<string, unknown> }>(await pedir(`pedido/${id}`, undefined, s));

    expect((await pedir("pedido", { app: "hackear", accion: "x" }, s)).status).toBe(400);
    const e1 = await nuevo({ app: "tarjeta", accion: "estado" });
    expect((await leer(e1)).estado).toBe("pendiente");
    expect(await neru()).toBe(1);
    const r1 = await leer(e1);
    expect(r1.estado).toBe("listo");
    expect((r1.resultado.objetos as { id: string }[]).map((o) => o.id)).toEqual([borde.id]);
    expect(String(r1.resultado.imagen).length).toBeGreaterThan(1000);

    const vacio = { fondo: null, borde: null, barra: null, nombre: null, aro: null, titulo: null, insignias: [], lado: "izquierda" };
    const g = await nuevo({ app: "tarjeta", accion: "guardar", datos: { eleccion: { ...vacio, borde: borde.id, fondo: ajeno.id, lado: "derecha" } } });
    await neru();
    expect(String((await leer(g)).resultado.mensaje)).toMatch(/Guardado.*no se pusieron/);
    expect(coins.equipped(PAPU).get("borde")?.id).toBe(borde.id);
    expect(coins.equipped(PAPU).get("fondo")).toBeUndefined();
    expect(store.get(PAPU).card.lado).toBe("derecha");

    const malo = await nuevo({ app: "tarjeta", accion: "guardar", datos: { eleccion: { borde: "<script>" } } });
    const otra = await nuevo({ app: "tienda", accion: "estado" });
    await neru();
    expect(await leer(malo)).toMatchObject({ estado: "error", resultado: { mensaje: expect.stringMatching(/No entendí/) } });
    expect(await leer(otra)).toMatchObject({ estado: "error", resultado: { mensaje: expect.stringMatching(/cerrada/) } });

    // Otro Papu no ve el pedido.
    await sql.run("INSERT INTO celular_sesiones (token, papu_id, nombre, avatar, vence_at, creado_at) VALUES ('otrasesion-1234567890abcdef', 'otro', 'Otro', 'a', ?, ?)", T0 + 3_600_000, T0);
    expect((await pedir(`pedido/${e1}`, undefined, "otrasesion-1234567890abcdef")).status).toBe(404);
  });

  it("no deja apilar pedidos ni abrir salas ajenas a la trivia del celular", async () => {
    const { pedir, entrar } = montar();
    const s = await entrar();
    for (let k = 0; k < 4; k++) expect((await pedir("pedido", { app: "tarjeta", accion: "estado" }, s)).status).toBe(200);
    expect((await pedir("pedido", { app: "tarjeta", accion: "estado" }, s)).status).toBe(429);
    expect((await pedir("trivia/sala?instancia=actividad-123")).status).toBe(400);
    expect((await pedir("trivia/media/../../secreto.json")).status).not.toBe(200);
    expect((await pedir("trivia/media/x.json")).status).toBe(401);
  });
});

describe("celular: apps que piden a Neru (enrutado y validaciones)", () => {
  const pedido = (app: string, accion: string, datos: unknown = null, papu = PAPU) => ({ id: 1, papu, nombre: "Papu", app, accion, datos });

  async function apps() {
    const { AppsCelular } = await import("../src/discord/celular");
    const { LevelStore } = await import("../src/levels/store");
    const { memDb } = await import("./helpers");
    const llamadas: unknown[][] = [];
    const a = new AppsCelular({
      coins: null,
      store: new LevelStore(memDb()),
      cardData: async () => {
        throw new Error("no");
      },
      founder: () => null,
      mercado: {
        celularEstado: () => ({ abierto: true }),
        celularComprar: async (u, id) => (llamadas.push(["comprar", u, id]), "Trato hecho"),
        celularUsar: async (u, acc, para, fail) => {
          if (acc === "nada") throw fail("No se usa así");
          llamadas.push(["usar", u, acc, para]);
          return "Usado";
        },
      },
      donar: { estado: () => ({ quedan: 3, tope: 5, sinLimite: false }), donar: async (f, t, n) => (llamadas.push(["donar", f, t, n]), "Regalado") },
      tienda: { celularEstado: async () => ({ monedas: 10 }), celularComprar: async () => "Comprado", celularSobre: (_u, modo, arg) => ({ titulo: `${modo}:${arg}`, objetos: [] }) },
      ruleta: { celularEstado: () => ({ quedan: 1 }), girar: async (_u, acc) => ({ resultado: { acc } }) },
      comercio: {
        celularEstado: async () => ({ mias: [] }),
        celularInventario: (u) => ({ de: u }),
        celularPublicar: async (u, b) => (llamadas.push(["publicar", u, b.para, b.padre]), "Publicada"),
        celularResponder: async (u, id, acc) => (llamadas.push(["responder", u, id, acc]), "Hecho"),
      },
      buscarPapus: async () => [{ id: PAPU, nombre: "Yo" }, { id: "234567890123456789", nombre: "Otro" }],
    });
    return { a, llamadas };
  }

  it("cada app llega a su módulo y los ids de Papus se revisan", async () => {
    const { a, llamadas } = await apps();
    const OTRO = "234567890123456789";
    expect(await a.manejar(pedido("mercado", "comprar", { id: "atun" }))).toMatchObject({ mensaje: "Trato hecho" });
    expect(await a.manejar(pedido("mochila", "usar", { accion: "regalo", para: OTRO }))).toMatchObject({ mensaje: "Usado" });
    await a.manejar(pedido("mochila", "usar", { accion: "regalo", para: "<@hack>" }));
    await expect(a.manejar(pedido("mochila", "usar", { accion: "nada" }))).rejects.toThrow("No se usa así");
    expect(await a.manejar(pedido("donar", "donar", { para: OTRO, cantidad: 2 }))).toMatchObject({ mensaje: "Regalado" });
    await expect(a.manejar(pedido("donar", "donar", { para: PAPU, cantidad: 2 }))).rejects.toThrow(/a ti mismo/);
    await expect(a.manejar(pedido("donar", "donar", { para: OTRO, cantidad: 0 }))).rejects.toThrow(/cuántos/);
    expect(await a.manejar(pedido("tienda", "sobre", { modo: "gratis", arg: "raro" }))).toMatchObject({ abierto: { titulo: "gratis:raro" } });
    expect(await a.manejar(pedido("ruleta", "girar", { accion: "quedar" }))).toMatchObject({ resultado: { acc: "quedar" } });
    await expect(a.manejar(pedido("ruleta", "girar", { accion: "trampa" }))).rejects.toThrow(/No sé/);
    expect(await a.manejar(pedido("comercio", "publicar", { para: OTRO, padre: 7, da: {}, pide: {} }))).toMatchObject({ mensaje: "Publicada" });
    await a.manejar(pedido("comercio", "responder", { id: 3, accion: "aceptar" }));
    await expect(a.manejar(pedido("comercio", "inventario", { de: "x" }))).rejects.toThrow(/Elige/);
    expect(await a.manejar(pedido("donar", "buscar-papus", { q: "o" }))).toEqual({ papus: [] });
    expect(await a.manejar(pedido("donar", "buscar-papus", { q: "ot" }))).toEqual({ papus: [{ id: OTRO, nombre: "Otro" }] });
    expect(llamadas).toEqual([
      ["comprar", PAPU, "atun"],
      ["usar", PAPU, "regalo", OTRO],
      ["usar", PAPU, "regalo", null],
      ["donar", PAPU, OTRO, 2],
      ["publicar", PAPU, OTRO, 7],
      ["responder", PAPU, 3, "aceptar"],
    ]);
  });

  it("Roles se resuelve en el worker con las reglas de #tus-roles", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(path.join(ROOT, "worker/schema.sql"), "utf8"));
    const elegidos: unknown[] = [];
    const cel = new Celular({
      sql: sqliteSql(db),
      datos,
      now: () => T0,
      identificar: async () => ({ id: PAPU, nombre: "Papu", avatar: "a" }),
      roles: { estado: async () => ({ colores: [] }), elegir: async (_p, d) => (elegidos.push(d), (d as { tipo?: string }).tipo === "color" ? { ok: true, mensaje: "Listo" } : { ok: false, mensaje: "No" }) },
    });
    const req = (ruta: string, cuerpo?: unknown, s = "") =>
      cel.handle(new Request(`https://w.test/celular/api/${ruta}`, { method: cuerpo === undefined ? "GET" : "POST", headers: { "x-celular-sesion": s }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
    const s = ((await (await req("entrar", { token: "x" }))!.json()) as { sesion: string }).sesion;
    expect((await req("roles"))!.status).toBe(401);
    expect(await (await req("roles", undefined, s))!.json()).toEqual({ colores: [] });
    expect(await (await req("roles", { tipo: "color", valor: "miku" }, s))!.json()).toEqual({ mensaje: "Listo" });
    expect((await req("roles", { tipo: "pais" }, s))!.status).toBe(400);
    expect(elegidos).toHaveLength(2);
  });
});

describe("celular: ajedrez (18 nov. 2026)", () => {
  it("retar, aceptar y jugar por la API; errores en 400", async () => {
    const { pedir, entrar, db } = montar();
    const yo = await entrar();
    const RIVAL = "987654321098765432";
    db.prepare("INSERT INTO celular_sesiones (token, papu_id, nombre, avatar, vence_at, creado_at) VALUES (?, ?, 'Rival', 'a.png', ?, ?)").run("sesion-del-rival-123456789", RIVAL, T0 + 3_600_000, T0);
    const menu = await json<{ rivales: unknown[]; mias: unknown[] }>(await pedir("ajedrez", undefined, yo));
    expect(menu.rivales.length).toBeGreaterThan(3);
    expect((await pedir("ajedrez/retar", { rival: { id: "x" }, apuesta: 0 }, yo)).status).toBe(400);
    const reto = await json<{ id: string; estado: string }>(await pedir("ajedrez/retar", { rival: { id: RIVAL, nombre: "Rival" }, apuesta: 0 }, yo));
    expect(reto.estado).toBe("reto");
    const v = await json<{ estado: string; blanco: string }>(await pedir("ajedrez/responder", { id: reto.id, accion: "aceptar" }, "sesion-del-rival-123456789"));
    expect(v.estado).toBe("jugando");
    const blanco = v.blanco === PAPU ? yo : "sesion-del-rival-123456789";
    const negro = blanco === yo ? "sesion-del-rival-123456789" : yo;
    expect((await pedir("ajedrez/jugar", { id: reto.id, jugada: "e7e5" }, negro)).status).toBe(400);
    const j = await json<{ jugadas: string[] }>(await pedir("ajedrez/jugar", { id: reto.id, jugada: "e2e4" }, blanco));
    expect(j.jugadas).toEqual(["e2e4"]);
    expect((await pedir(`ajedrez/partida?id=${reto.id}`, undefined, negro)).status).toBe(200);
  });
});
