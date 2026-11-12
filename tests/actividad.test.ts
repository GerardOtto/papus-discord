// Trivia multijugador (Actividad de Discord): la sala (worker/src/actividad/juego.ts), el pool de prueba y la XP que
// aplica Teto desde D1 (src/trivia/actividad.ts).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/database";
import { loadLevelSettings } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { ActividadTrivia } from "../src/trivia/actividad";
import { answerXp, loadTriviaSettings, type Question } from "../src/trivia/rules";
import { TriviaService } from "../src/trivia/service";
import { GRACIA_MS, Sala } from "../worker/src/actividad/juego";
import pool from "../worker/src/actividad/pool.json";
import { avatarUrl, xpDeAcierto } from "../worker/src/actividad/perfil";
import type { Pool, PreguntaPool, Vista } from "../worker/src/actividad/tipos";
import { memDb, seededRng } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "..");
const POOL = pool as unknown as Pool;
const S = loadTriviaSettings();
const LS = loadLevelSettings();

const op = (id: string, extra: Partial<PreguntaPool> = {}): PreguntaPool => ({
  id,
  tipo: "opciones",
  dificultad: "facil",
  categoria: "opciones-t",
  texto: `¿${id}?`,
  respuesta: `bien-${id}`,
  otras: ["mal1", "mal2", "mal3"],
  aceptadas: [],
  segundos: 20,
  ...extra,
});
const tx = (id: string): PreguntaPool => ({ ...op(id), tipo: "texto", respuesta: "Kasane Teto", otras: [], aceptadas: ["Kasane Teto", "teto"] });

function setup(preguntas: PreguntaPool[] = [op("a"), op("b"), op("c"), op("d")], xp: (p: string, r: number, factor?: number) => number | null = (_p, r, factor = 1) => 10 * r * factor) {
  let now = 1_000_000;
  const sala = new Sala({ pool: preguntas, now: () => now, rnd: seededRng(3), xp });
  const unir = (...ids: string[]) => ids.forEach((id) => sala.unir({ id, nombre: id.toUpperCase(), avatar: "x.png" }));
  /** Indice de la opcion correcta y de una incorrecta en pantalla. */
  const opciones = () => {
    const p = sala.vista("x").pregunta!;
    const bien = p.opciones.findIndex((o) => o.startsWith("bien-"));
    return { nonce: p.nonce, bien, mal: (bien + 1) % p.opciones.length };
  };
  return { sala, unir, opciones, later: (ms: number) => (now += ms), at: () => now };
}

/** Pasa de la respuesta revelada a la siguiente pregunta. */
function siguiente(t: ReturnType<typeof setup>) {
  t.later(10_000);
  t.sala.tick();
}

describe("sala de la trivia multijugador", () => {
  it("si todos contestan, la pregunta termina al instante y muestra quien eligio que", () => {
    const t = setup();
    t.unir("ana", "beto");
    expect(t.sala.host).toBe("ana");
    expect(t.sala.empezar("ana").ok).toBe(true);
    const { nonce, bien, mal } = t.opciones();
    expect(t.sala.responder("ana", nonce, { opcion: bien })).toBe(true);
    // Una sola respuesta por pregunta.
    expect(t.sala.responder("ana", nonce, { opcion: mal })).toBe(false);
    const v1 = t.sala.vista("beto");
    expect(v1.fase).toBe("pregunta");
    expect(v1.pregunta!.elecciones[bien]).toEqual(["ana"]);
    expect(v1.jugadores.find((j) => j.id === "ana")!.respondio).toBe(true);
    t.sala.responder("beto", nonce, { opcion: mal });
    const v = t.sala.vista("ana");
    expect(v.fase).toBe("revelar");
    expect(v.revelar!.correcta).toBe(bien);
    expect(v.revelar!.resultados.ana).toMatchObject({ ok: true, xp: 10 });
    expect(v.revelar!.resultados.beto).toMatchObject({ ok: false, xp: 0 });
    expect(t.sala.sacarAciertos()).toEqual([{ papu: "ana", pregunta: v.pregunta!.texto.slice(1, -1), dificultad: "facil", racha: 1, xp: 10 }]);
    expect(t.sala.sacarAciertos()).toEqual([]);
  });

  it("si falta alguien, espera el tiempo; quien no contesto falla", () => {
    const t = setup([op("a"), op("b")]);
    t.unir("ana", "beto");
    t.sala.empezar("ana");
    const { nonce, bien } = t.opciones();
    t.sala.responder("ana", nonce, { opcion: bien });
    t.later(19_000);
    t.sala.tick();
    expect(t.sala.fase).toBe("pregunta");
    expect(t.sala.vista("ana").pregunta!.restante).toBe(1000);
    t.later(1000 + GRACIA_MS);
    t.sala.tick();
    const v = t.sala.vista("ana");
    expect(v.fase).toBe("revelar");
    expect(v.revelar!.resultados.beto).toEqual({ ok: false, xp: 0 });
    // Fuera de tiempo ya no vale.
    expect(t.sala.responder("beto", nonce, { opcion: bien })).toBe(false);
  });

  it("la vista de la pregunta no trae la respuesta antes de revelarla", () => {
    const t = setup([tx("t1")]);
    t.unir("ana");
    t.sala.empezar("ana");
    const v = JSON.stringify(t.sala.vista("ana"));
    expect(v).not.toContain("Kasane Teto");
    expect(v).not.toContain("revelar");
  });

  it("las de texto se revisan como /trivia (sin acentos ni mayúsculas) y cada uno ve lo que escribieron", () => {
    const t = setup([tx("t1"), tx("t2")]);
    t.unir("ana", "beto");
    t.sala.empezar("ana");
    const nonce = t.sala.vista("ana").pregunta!.nonce;
    expect(t.sala.responder("ana", nonce, { texto: "   " })).toBe(false);
    t.sala.responder("ana", nonce, { texto: "¡TETO!" });
    t.sala.responder("beto", nonce, { texto: "miku" });
    const r = t.sala.vista("beto").revelar!;
    expect(r.resultados.ana).toMatchObject({ ok: true, texto: "¡TETO!" });
    expect(r.resultados.beto).toMatchObject({ ok: false, texto: "miku" });
    expect(r.respuesta).toBe("Kasane Teto");
  });

  it("eliminatoria: quien falla cae, si fallan todos nadie cae, y gana el ultimo en pie", () => {
    const t = setup([op("a"), op("b"), op("c"), op("d")]);
    t.unir("ana", "beto", "caro");
    t.sala.empezar("ana");
    // 1) Caro falla: cae.
    let o = t.opciones();
    t.sala.responder("ana", o.nonce, { opcion: o.bien });
    t.sala.responder("beto", o.nonce, { opcion: o.bien });
    t.sala.responder("caro", o.nonce, { opcion: o.mal });
    expect(t.sala.vista("ana").revelar!.caen).toEqual(["caro"]);
    siguiente(t);
    // Caro ya no puede contestar; la pregunta termina cuando contestan los dos en pie.
    o = t.opciones();
    expect(t.sala.responder("caro", o.nonce, { opcion: o.bien })).toBe(false);
    // 2) Fallan los dos que quedan: nadie cae.
    t.sala.responder("ana", o.nonce, { opcion: o.mal });
    t.sala.responder("beto", o.nonce, { opcion: o.mal });
    expect(t.sala.vista("ana").revelar).toMatchObject({ caen: [], nadieCae: true });
    siguiente(t);
    // 3) Beto falla: Ana gana.
    o = t.opciones();
    t.sala.responder("ana", o.nonce, { opcion: o.bien });
    t.sala.responder("beto", o.nonce, { opcion: o.mal });
    siguiente(t);
    const v = t.sala.vista("caro");
    expect(v.fase).toBe("fin");
    expect(v.fin).toEqual({ motivo: "ganador", ganador: "ana", preguntas: 3 });
    expect(v.jugadores.find((j) => j.id === "ana")).toMatchObject({ aciertos: 2, xp: 10 + 10 });
  });

  it("eliminatoria en solitario: al primer fallo se acaba", () => {
    const t = setup();
    t.unir("ana");
    t.sala.empezar("ana");
    let o = t.opciones();
    t.sala.responder("ana", o.nonce, { opcion: o.bien });
    siguiente(t);
    o = t.opciones();
    t.sala.responder("ana", o.nonce, { opcion: o.mal });
    siguiente(t);
    expect(t.sala.vista("ana").fin).toEqual({ motivo: "eliminados", preguntas: 2 });
  });

  it("la racha sube la XP de cada acierto seguido y se corta al fallar", () => {
    const t = setup();
    t.unir("ana", "beto");
    t.sala.configurar("ana", { modo: "cooperativo" });
    t.sala.empezar("ana");
    const rachas: number[] = [];
    for (const ok of [true, true, false, true]) {
      const o = t.opciones();
      t.sala.responder("ana", o.nonce, { opcion: ok ? o.bien : o.mal });
      t.sala.responder("beto", o.nonce, { opcion: o.bien });
      rachas.push(...t.sala.sacarAciertos().filter((a) => a.papu === "ana").map((a) => a.racha));
      siguiente(t);
    }
    expect(rachas).toEqual([1, 2, 1]);
  });

  it("cooperativo: quien falla sigue jugando, y el equipo pierde cuando todos fallaron al menos una vez", () => {
    const t = setup([op("a"), op("b"), op("c"), op("d")]);
    t.unir("ana", "beto");
    t.sala.configurar("ana", { modo: "cooperativo" });
    t.sala.empezar("ana");
    let o = t.opciones();
    t.sala.responder("ana", o.nonce, { opcion: o.mal });
    t.sala.responder("beto", o.nonce, { opcion: o.bien });
    siguiente(t);
    expect(t.sala.fase).toBe("pregunta");
    expect(t.sala.vista("ana").jugadores.find((j) => j.id === "ana")!.fallo).toBe(true);
    // Ana ya fallo, pero sigue contestando (y ganando XP).
    o = t.opciones();
    expect(t.sala.responder("ana", o.nonce, { opcion: o.bien })).toBe(true);
    t.sala.responder("beto", o.nonce, { opcion: o.mal });
    siguiente(t);
    expect(t.sala.vista("ana").fin).toEqual({ motivo: "todos-fallaron", preguntas: 2 });
  });

  it("sin mas preguntas, la partida termina", () => {
    const t = setup([op("a")]);
    t.unir("ana", "beto");
    t.sala.configurar("ana", { modo: "cooperativo" });
    t.sala.empezar("ana");
    const o = t.opciones();
    t.sala.responder("ana", o.nonce, { opcion: o.bien });
    t.sala.responder("beto", o.nonce, { opcion: o.bien });
    siguiente(t);
    expect(t.sala.vista("ana").fin!.motivo).toBe("sin-preguntas");
  });

  it("solo el anfitrion configura y empieza; si se va, pasa al siguiente", () => {
    const t = setup([op("a", { dificultad: "dificil" }), op("b")]);
    t.unir("ana", "beto");
    expect(t.sala.configurar("beto", { modo: "cooperativo" })).toBe(false);
    expect(t.sala.empezar("beto").ok).toBe(false);
    t.sala.configurar("ana", { eleccion: "medio" });
    expect(t.sala.empezar("ana")).toEqual({ ok: false, motivo: "No hay preguntas de esa dificultad." });
    expect(t.sala.disponibles()).toEqual({ mezcla: 2, facil: 1, medio: 0, dificil: 1 });
    t.sala.salir("ana");
    expect(t.sala.host).toBe("beto");
    t.sala.configurar("beto", { eleccion: "dificil" });
    t.sala.empezar("beto");
    expect(t.sala.vista("beto").pregunta!.dificultad).toBe("dificil");
  });

  it("quien llega con la partida empezada mira hasta la siguiente", () => {
    const t = setup();
    t.unir("ana");
    t.sala.empezar("ana");
    t.unir("beto");
    const o = t.opciones();
    expect(t.sala.responder("beto", o.nonce, { opcion: o.bien })).toBe(false);
    expect(t.sala.vista("beto").jugadores.find((j) => j.id === "beto")!.juega).toBe(false);
    // Ana contesta: no espera a Beto.
    t.sala.responder("ana", o.nonce, { opcion: o.mal });
    expect(t.sala.fase).toBe("revelar");
    siguiente(t);
    expect(t.sala.otra("ana")).toBe(true);
    t.sala.empezar("ana");
    expect(t.sala.vista("beto").jugadores.find((j) => j.id === "beto")!.juega).toBe(true);
  });

  it("si se van todos los que juegan, la partida se cierra; si se va uno, no se le espera", () => {
    const t = setup();
    t.unir("ana", "beto");
    t.sala.configurar("ana", { modo: "cooperativo" });
    t.sala.empezar("ana");
    const o = t.opciones();
    t.sala.responder("ana", o.nonce, { opcion: o.bien });
    t.sala.salir("beto");
    expect(t.sala.fase).toBe("revelar");
    siguiente(t);
    t.sala.salir("ana");
    expect((t.sala.vista("ana") as Vista).fin?.motivo).toBe("abandonaron");
  });

  it("XP desconocida (Teto aun no calcula el perfil) se muestra como pendiente", () => {
    const t = setup([op("a")], () => null);
    t.unir("ana");
    t.sala.empezar("ana");
    const o = t.opciones();
    t.sala.responder("ana", o.nonce, { opcion: o.bien });
    expect(t.sala.vista("ana").revelar!.resultados.ana!.xp).toBeNull();
    expect(t.sala.sacarAciertos()[0]!.xp).toBeNull();
  });
});

describe("pool de prueba de la Actividad", () => {
  it("tiene todas las preguntas de /trivia, de las tres dificultades y de cada tipo", () => {
    expect(POOL.preguntas.length).toBeGreaterThan(5000);
    for (const d of ["facil", "medio", "dificil"] as const) expect(POOL.preguntas.filter((q) => q.dificultad === d).length).toBeGreaterThanOrEqual(15);
    const cats = new Set(POOL.preguntas.map((q) => q.categoria));
    for (const c of ["audio-opciones", "audio-texto", "verdadero-falso", "texto-adivinanzas", "figura-silueta", "figura-pixel", "figura-zoom"]) expect(cats).toContain(c);
    for (const m of ["normal", "silueta", "pixel", "zoom", "mitad", "gris", "piezas", "franjas"]) expect(cats).toContain(`imagen-${m}`);
    expect(new Set(POOL.preguntas.map((q) => q.id)).size).toBe(POOL.preguntas.length);
  });

  it("cada pregunta esta bien armada y sus archivos no delatan la respuesta", () => {
    for (const q of POOL.preguntas) {
      if (q.tipo === "opciones") expect([1, 3], q.id).toContain(q.otras.length);
      else expect(q.aceptadas, q.id).toContain(q.respuesta);
      expect(q.segundos, q.id).toBeGreaterThan(0);
      if (q.media) {
        expect(q.media.archivo, q.id).toMatch(/^[0-9a-f]{16}\.(mp3|webp|png)$/);
        const file = path.join(ROOT, "worker/public/actividad/media", q.media.archivo);
        if (existsSync(path.join(ROOT, "worker/public/actividad"))) expect(existsSync(file), file).toBe(true);
      }
    }
    expect(POOL.preguntas.filter((q) => q.media?.tipo === "audio").length).toBeGreaterThanOrEqual(2);
  });
});

describe("XP de la trivia multijugador", () => {
  it("la que muestra la sala es la de /trivia con la racha, recortada al tope del dia", () => {
    for (const xp of [0, 500, 50_000]) {
      const base = answerXp(S, LS, { xp, dailyAvg: 120, streak: 1, multiplier: 1 });
      for (const racha of [1, 5, 30]) {
        const real = answerXp(S, LS, { xp, dailyAvg: 120, streak: racha, multiplier: 1 });
        expect(Math.abs(xpDeAcierto({ base, tope: 1e9, at: 0 }, racha, S.racha) - real)).toBeLessThanOrEqual(1);
      }
    }
    expect(xpDeAcierto({ base: 50, tope: 7, at: 0 }, 3, S.racha)).toBe(7);
    expect(xpDeAcierto({ base: 50, tope: -3, at: 0 }, 3, S.racha)).toBe(0);
    expect(xpDeAcierto({ base: 50, tope: 100, at: 0 }, 1, S.racha, 2)).toBe(100);
  });

  it("avatar del Papu: el del servidor, el suyo o el de Discord por defecto", () => {
    expect(avatarUrl("123456789012345678", { avatar: "a_" + "f".repeat(32) }, { avatar: "1".repeat(32) })).toBe(`api/avatar/123456789012345678/a_${"f".repeat(32)}?g=1`);
    expect(avatarUrl("123456789012345678", null, { avatar: "1".repeat(32) })).toBe(`api/avatar/123456789012345678/${"1".repeat(32)}`);
    expect(avatarUrl("123456789012345678", { avatar: null }, { avatar: null })).toMatch(/^api\/avatar\/default\/[0-5]$/);
  });

  it("comparte todo con /trivia: partidas con XP del dia, superadas, sobre, hitos y mejor racha", () => {
    const db = memDb();
    const NOON = Date.parse("2026-11-08T12:00:00-03:00");
    const levels = new LevelService({ db, settings: LS, timeZone: "America/Santiago" });
    const mk = (id: string): Question => ({ id, kind: "opciones", topic: "t", level: "facil", text: "?", answer: "x", wrong: ["y", "z", "w"], accepted: [] });
    const sobres: string[] = [];
    const trivia = new TriviaService({ db, settings: S, questions: [mk("a"), mk("b")], levels, giveSobre: (id, tipo) => void sobres.push(`${id}:${tipo}`), timeZone: "America/Santiago", now: () => NOON });
    // Dos aciertos en la misma partida multijugador: una sola partida del dia, con XP.
    const r1 = trivia.answerShared("ana", "p1", "a", 1);
    expect(r1.xp).toBeGreaterThan(0);
    expect(trivia.runsToday("ana")).toBe(1);
    const r2 = trivia.answerShared("ana", "p1", "b", 2);
    expect(trivia.runsToday("ana")).toBe(1);
    // Supero las dos fáciles: su sobre, como en /trivia.
    expect(r2.completed).toBe("facil");
    // Y como eran todas las preguntas de la trivia, tambien el secreto del Papu Lince.
    expect(r2.secret).toBe(true);
    expect(sobres).toEqual(["ana:comun", `ana:${S.secreto.sobres.tipo}`]);
    expect(trivia.progress("ana").facil).toMatchObject({ done: 2, total: 2, prize: true });
    expect(trivia.best("ana")).toBe(2);
    expect(trivia.milestones("ana", "facil")!.aciertos).toBe(2);
    // Pasadas las partidas con XP del dia, la multijugador ya no da XP (y la sala lo sabe: tope 0).
    for (let k = 2; k <= S.limites.partidasConXp; k++) trivia.answerShared("ana", `p${k}`, "a", 1);
    expect(trivia.sharedProfile("ana").tope).toBe(0);
    expect(trivia.answerShared("ana", "extra", "a", 1).xp).toBe(0);
    expect(trivia.runsToday("ana")).toBe(S.limites.partidasConXp + 1);
  });

  it("Teto aplica una sola vez cada acierto de D1, con el tope del dia, y deja el perfil para la sala", async () => {
    // D1 de mentira: SQLite en memoria con el esquema del worker.
    const d1 = openDb(":memory:");
    d1.exec(readFileSync(path.join(ROOT, "worker/schema.sql"), "utf8"));
    const query = async <T>(sql: string, ...params: unknown[]) => d1.prepare(sql).all(...(params as never[])) as T[];
    const db = memDb();
    const NOON = Date.parse("2026-11-08T12:00:00-03:00");
    const levels = new LevelService({ db, settings: LS, timeZone: "America/Santiago" });
    const questions: Question[] = [{ id: "a", kind: "opciones", topic: "t", level: "facil", text: "?", answer: "x", wrong: ["y", "z", "w"], accepted: [] }];
    const trivia = new TriviaService({ db, settings: S, questions, levels, timeZone: "America/Santiago", now: () => NOON });
    const act = new ActividadTrivia({ query, trivia, now: () => NOON });
    const changes: (string | null)[] = [];
    act.onChange = async (_c, canal) => void changes.push(canal);

    d1.prepare("INSERT INTO actividad_perfiles (papu_id, pedido_at) VALUES ('ana', ?)").run(NOON - 5);
    const ins = d1.prepare("INSERT INTO actividad_aciertos (partida, papu_id, pregunta, dificultad, racha, canal, creado_at) VALUES ('p', ?, 'a', 'facil', ?, '999', ?)");
    for (let k = 1; k <= 40; k++) ins.run("ana", k, NOON);

    expect(await act.sync()).toBe(40);
    expect(await act.sync()).toBe(0);
    const rows = d1.prepare("SELECT aplicado, xp FROM actividad_aciertos ORDER BY id").all() as { aplicado: number; xp: number }[];
    expect(rows.every((r) => r.aplicado === 1 && r.xp !== null)).toBe(true);
    const total = rows.reduce((s, r) => s + r.xp, 0);
    // Lo mismo que entra en la XP del dia de la trivia, sin pasar el tope de /trivia.
    expect(trivia.xpToday("ana")).toBe(total);
    expect(trivia.sharedProfile("ana").tope).toBe(0);
    expect(levels.store.get("ana").xp).toBe(total);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c === "999")).toBe(true);
    const perfil = d1.prepare("SELECT xp_base, tope, actualizado_at FROM actividad_perfiles WHERE papu_id = 'ana'").get() as { xp_base: number; tope: number; actualizado_at: number };
    expect(perfil.xp_base).toBeGreaterThan(0);
    expect(perfil.tope).toBe(0);
    expect(perfil.actualizado_at).toBeGreaterThan(NOON - 5);
  });
  it("aplica Celular por jugador, Guitarra al doble y Zanahoria a la siguiente pregunta compartida", () => {
    const t=setup([op("a",{tema:"actual"}),op("b",{tema:"personajes"}),op("c",{tema:"audio"})],(_p,_r,f)=>f??1);
    t.unir("ana","beto");
    t.sala.setConsumibles("ana",{celular:1,guitarra:1,zanahoria:1,baguette:0});
    t.sala.empezar("ana");
    const o=t.opciones();
    expect(t.sala.usarCelular("ana",o.nonce)).toBe(true);
    expect(t.sala.vista("ana").pregunta!.ocultas).toHaveLength(2);
    expect(t.sala.vista("beto").pregunta!.ocultas).toEqual([]);
    expect(t.sala.usarGuitarra("ana",o.nonce)).toBe(true);
    expect(t.sala.usarZanahoria("ana",o.nonce,"personajes")).toBe(true);
    t.sala.responder("ana",o.nonce,{opcion:o.bien});
    t.sala.responder("beto",o.nonce,{opcion:o.bien});
    expect(t.sala.sacarAciertos().find(a=>a.papu==="ana")?.factor).toBe(2);
    siguiente(t);
    expect(t.sala.vista("ana").pregunta!.texto).toBe("¿b?");
  });

  it("la Baguette rescata hasta dos fallos conservando la racha en una partida compartida", () => {
    const t=setup([op("a"),op("b"),op("c"),op("d")]);
    t.unir("ana");
    t.sala.setConsumibles("ana",{celular:0,guitarra:0,zanahoria:0,baguette:1});
    t.sala.empezar("ana");
    let o=t.opciones();
    t.sala.responder("ana",o.nonce,{opcion:o.bien});
    siguiente(t);
    o=t.opciones();
    t.sala.responder("ana",o.nonce,{opcion:o.mal});
    expect(t.sala.pendientesRescateBaguette()).toEqual(["ana"]);
    t.sala.activarBaguette("ana");
    expect(t.sala.rescatarBaguette("ana")).toBe(true);
    expect(t.sala.vista("ana").revelar!.resultados.ana).toMatchObject({ok:false,salvado:true});
    expect(t.sala.vista("ana").jugadores[0]).toMatchObject({vivo:true,racha:1});
    siguiente(t);
    o=t.opciones();
    t.sala.responder("ana",o.nonce,{opcion:o.mal});
    expect(t.sala.rescatarBaguette("ana")).toBe(true);
    expect(t.sala.vista("ana").jugadores[0]).toMatchObject({vivo:true,racha:1});
    siguiente(t);
    o=t.opciones();
    t.sala.responder("ana",o.nonce,{opcion:o.mal});
    expect(t.sala.pendientesRescateBaguette()).toEqual([]);
  });

});
