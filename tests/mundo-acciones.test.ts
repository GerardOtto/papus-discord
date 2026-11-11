// Plaza de los Papus: acciones que ejecuta el bot (worker/src/mundo/acciones.ts, src/mundo/puente.ts) y la ruleta
// grande (cola de giros, /ruleta con las reglas de Discord, giros de Discord y avisos de misiones).
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { anguloFinal, avanzar, COLA_MAX, COLA_VACIA, formar, GIRO_MS, proximoCambio, puesto, type Giro, type RuletaEstado, type RuletaGiro } from "../worker/src/mundo/acciones";
import { destino, OBSTACULOS } from "../worker/src/mundo/juego";
import type { D1Query } from "../src/cloud/d1";
import { loadLevelSettings } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { MundoPuente } from "../src/mundo/puente";
import { accionesRuleta, ruletaEstado } from "../src/mundo/ruleta";
import { Quota } from "../src/quota/quota";
import { loadRouletteSettings } from "../src/ruleta/rules";
import { RouletteService } from "../src/ruleta/service";
import type { ConversationService } from "../src/services/conversation";
import { memDb } from "./helpers";

const giro = (papu: string, origen: Giro["origen"] = "plaza"): Giro => ({ papu, nombre: papu, index: 1, titulo: "¡+10 XP!", subtitulo: "Nivel 2", origen });

describe("mundo: cola de la ruleta grande", () => {
  it("gira de a uno, en orden, y cada giro se ve completo", () => {
    let c = formar(COLA_VACIA, giro("a"), 0);
    expect(c.actual?.papu).toBe("a");
    c = formar(c, giro("b"), 1000);
    c = formar(c, giro("c", "discord"), 2000);
    expect(c.actual?.papu).toBe("a");
    expect(c.cola.map((g) => g.papu)).toEqual(["b", "c"]);
    expect(puesto(c, "a")).toBe(0);
    expect(puesto(c, "b")).toBe(1);
    expect(puesto(c, "c")).toBeNull(); // los de Discord no son "mi giro"
    expect(proximoCambio(c)).toBe(GIRO_MS);
    expect(avanzar(c, GIRO_MS - 1)).toBe(c); // sin cambios: el mismo objeto
    c = avanzar(c, GIRO_MS);
    expect([c.actual?.papu, c.actual?.inicio]).toEqual(["b", GIRO_MS]);
    // La sala durmio de mas: el siguiente empieza ahora (no se salta ninguno).
    c = avanzar(c, GIRO_MS * 5);
    expect([c.actual?.papu, c.actual?.inicio]).toEqual(["c", GIRO_MS * 5]);
    c = avanzar(c, GIRO_MS * 6);
    expect(c).toEqual({ actual: null, cola: [] });
  });

  it("la fila tiene tope para los giros de Discord, no para los de la plaza", () => {
    let c = formar(COLA_VACIA, giro("x"), 0);
    for (let i = 0; i < COLA_MAX + 3; i++) c = formar(c, giro(`d${i}`, "discord"), 1);
    expect(c.cola).toHaveLength(COLA_MAX);
    c = formar(c, giro("p"), 2);
    expect(c.cola.at(-1)?.papu).toBe("p");
  });

  it("la casilla ganadora queda bajo la flecha de arriba", () => {
    const n = 9;
    for (const i of [0, 4, 8]) {
      const a = anguloFinal(i, n);
      expect(a).toBeGreaterThan(Math.PI * 2 * 4);
      // Girar la rueda `a` (antihorario) lleva el centro de la casilla i (horario desde arriba) a arriba.
      const centro = (i + 0.5) * ((Math.PI * 2) / n);
      const vueltas = (a - centro) / (Math.PI * 2);
      expect(vueltas - Math.round(vueltas)).toBeCloseTo(0);
    }
  });

  it("/ruleta lleva frente a la ruleta, fuera de los obstaculos", () => {
    for (const r of [0, 0.5, 0.999]) {
      const p = destino("ruleta", () => r)!;
      expect(Math.hypot(p.x - 38, p.z - 0)).toBeLessThan(7);
      expect(OBSTACULOS.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r)).toBe(false);
    }
    expect(destino("luna")).toBeNull();
    expect(destino(42)).toBeNull();
  });
});

// ───────────────────────── bot ─────────────────────────

const TZ = "America/Santiago";
const NOON = Date.parse("2026-10-24T12:00:00-03:00");
const PAPU = "123456789012345678";

function ruleta() {
  const db = memDb();
  let now = NOON;
  const levels = new LevelService({ db, settings: loadLevelSettings(), timeZone: TZ });
  const quota = new Quota(db, (id, d) => levels.limitFor(id, d), TZ);
  const r = new RouletteService({ db, settings: loadRouletteSettings(), levels, quota, timeZone: TZ, now: () => now, rnd: () => 0 });
  const talk = (n: number) => {
    for (let i = 0; i < n; i++) levels.onMessage(PAPU, `mensaje numero ${i} de prueba`, (now += 3000));
  };
  return { r, talk, at: () => now };
}

describe("mundo: la ruleta con las reglas de Discord", () => {
  it("el panel trae las misiones con su avance, las tiradas y las casillas", () => {
    const { r, talk } = ruleta();
    talk(r.settings.misiones.mensajes);
    const e = ruletaEstado(r, PAPU);
    expect(e.tiradas).toBe(r.status(PAPU).left);
    expect(e.tiradas).toBeGreaterThanOrEqual(1);
    const msj = e.misiones.find((m) => m.id === "mensajes")!;
    expect([msj.hecha, msj.actual, msj.meta]).toEqual([true, r.settings.misiones.mensajes, r.settings.misiones.mensajes]);
    expect(e.misiones.find((m) => m.id === "nivel")).toMatchObject({ meta: 1 });
    expect(e.casillas).toHaveLength(r.settings.premios.length);
  });

  it("girar gasta la tirada y aplica el premio; sin tiradas, dice por que", async () => {
    const { r, talk } = ruleta();
    const despues: string[] = [];
    const acc = accionesRuleta({ roulette: r, textos: () => ({ titulo: "¡Premio!", subtitulo: "sub", premio: "**+10 XP**" }), despues: async (id) => void despues.push(id) });
    const sin = await acc["ruleta.girar"]({ id: PAPU, nombre: "Ana" });
    expect(sin).toEqual({ ok: false, motivo: expect.stringContaining("misión") });
    talk(r.settings.misiones.mensajes);
    const antes = r.status(PAPU).left;
    const ok = await acc["ruleta.girar"]({ id: PAPU, nombre: "Ana" });
    expect(ok.ok).toBe(true);
    const d = (ok as { datos: RuletaGiro }).datos;
    expect(d).toMatchObject({ texto: "+10 XP", tiradas: antes - 1, giro: { papu: PAPU, nombre: "Ana", index: 0, origen: "plaza" } });
    expect(despues).toEqual([PAPU]);
    expect(r.status(PAPU).used).toBe(1);
    for (let i = 1; i < antes; i++) await acc["ruleta.girar"]({ id: PAPU, nombre: "Ana" });
    const otra = await acc["ruleta.girar"]({ id: PAPU, nombre: "Ana" });
    expect(otra.ok).toBe(false);
    expect(despues).toHaveLength(antes);
  });
});

// ───────────────────────── puente ─────────────────────────

function puente() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.resolve(import.meta.dirname, "../worker/schema.sql"), "utf8"));
  const consultas: string[] = [];
  const query: D1Query = async <T,>(sql: string, ...params: unknown[]) => {
    consultas.push(sql);
    return db.prepare(sql).all(...(params as never[])) as T[];
  };
  const p = new MundoPuente({
    query,
    makeConversation: () => ({}) as ConversationService,
    bots: ["teto"],
    owners: new Set(),
    stats: () => ({ nivel: 3, prestigio: 0, restante: 2, limite: 3, ruletas: 2 }),
  });
  const pedir = (accion: string, papu = PAPU, creado = Date.now()) =>
    db.prepare("INSERT INTO mundo_acciones (sala, papu_id, papu_nombre, accion, ref, creado_at) VALUES ('plaza', ?, 'Ana', ?, 7, ?)").run(papu, accion, creado);
  const resultado = (id: number | bigint) => {
    const f = db.prepare("SELECT tomado, resultado FROM mundo_acciones WHERE id = ?").get(id) as { tomado: number; resultado: string };
    return { tomado: f.tomado, ...JSON.parse(f.resultado) };
  };
  return { db, p, consultas, pedir, resultado };
}

describe("mundo: puente de acciones y eventos", () => {
  it("sin nada pendiente, una sola consulta por vuelta", async () => {
    const { p, consultas } = puente();
    await p.sync();
    consultas.length = 0;
    await p.sync();
    expect(consultas).toHaveLength(1);
  });

  it("atiende cada accion una vez, con el Papu que la pidio, y deja el resultado", async () => {
    const { p, pedir, resultado } = puente();
    const vistos: string[] = [];
    const estado: RuletaEstado = { tiradas: 2, usadas: 0, bloqueada: false, misiones: [], extras: [], casillas: [] };
    p.acciones["ruleta.estado"] = (papu) => {
      vistos.push(`${papu.id}:${papu.nombre}`);
      return { ok: true, datos: estado };
    };
    const id = pedir("ruleta.estado").lastInsertRowid;
    await p.sync();
    await p.sync();
    expect(vistos).toEqual([`${PAPU}:Ana`]);
    expect(resultado(id)).toEqual({ tomado: 2, ok: true, datos: estado });
  });

  it("acciones de prueba, desconocidas, viejas o que fallan: un motivo, nunca se quedan colgadas", async () => {
    const { p, pedir, resultado } = puente();
    p.acciones["ruleta.girar"] = () => {
      throw new Error("boom");
    };
    const prueba = pedir("ruleta.estado", "prueba-Ana").lastInsertRowid;
    const falta = pedir("ruleta.estado").lastInsertRowid;
    const vieja = pedir("ruleta.girar", PAPU, Date.now() - 120_000).lastInsertRowid;
    const falla = pedir("ruleta.girar").lastInsertRowid;
    await p.sync();
    expect(resultado(prueba)).toMatchObject({ tomado: 2, ok: false, motivo: expect.stringContaining("modo de prueba") });
    expect(resultado(falta)).toMatchObject({ ok: false, motivo: expect.stringContaining("todavía") });
    expect(resultado(vieja)).toMatchObject({ ok: false, motivo: expect.stringContaining("Tardé") });
    expect(resultado(falla)).toMatchObject({ ok: false, motivo: expect.stringContaining("falló") });
  });

  it("los eventos de Discord quedan en D1 y un aviso pone al dia el perfil (tiradas)", async () => {
    const { db, p } = puente();
    await p.evento("ruleta", giro("u1", "discord"));
    await p.evento("aviso", { texto: "🎡 ¡Cumpliste 200 mensajes!" }, PAPU);
    const ev = db.prepare("SELECT papu_id, tipo, datos FROM mundo_eventos ORDER BY id").all() as { papu_id: string | null; tipo: string; datos: string }[];
    expect(ev.map((e) => [e.papu_id, e.tipo])).toEqual([
      [null, "ruleta"],
      [PAPU, "aviso"],
    ]);
    expect(JSON.parse(ev[0]!.datos)).toMatchObject({ papu: "u1", origen: "discord" });
    expect(db.prepare("SELECT ruletas FROM mundo_perfiles WHERE papu_id = ?").get(PAPU)).toEqual({ ruletas: 2 });
  });
});
