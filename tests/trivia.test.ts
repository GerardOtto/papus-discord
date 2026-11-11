import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLevelSettings, progress } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { renderFigure, renderPicture } from "../src/trivia/images";
import { renderLynx } from "../src/trivia/lince";
import { answerXp, dailyCap, DIFICULTADES, loadAudioClips, loadGenerated, loadQuestions, loadTriviaSettings, playOrder, runCost, shuffledOptions, textCorrect, timerFor, type Dificultad, type PictureMode, type Question, type TriviaSettings } from "../src/trivia/rules";
import { STALE_MS, TriviaService } from "../src/trivia/service";
import { memDb, seededRng } from "./helpers";

const TZ = "America/Santiago";
const LS = loadLevelSettings();
const S = loadTriviaSettings();
const NOON = Date.parse("2026-10-26T12:00:00-03:00");
const ALL = loadQuestions(S, { rnd: seededRng(1) });

const q = (id: string, kind: "opciones" | "texto" = "opciones", level: Dificultad = "facil"): Question =>
  kind === "opciones"
    ? { id, kind, topic: "t", level, text: `¿${id}?`, answer: `bien-${id}`, wrong: ["mal1", "mal2", "mal3"], accepted: [] }
    : { id, kind, topic: "t", level, text: `¿${id}?`, answer: "Kasane Teto", wrong: [], accepted: ["Kasane Teto", "teto"] };

function setup(questions: Question[] = [q("a"), q("b"), q("c", "texto")], db = memDb(), settings = S) {
  let now = NOON;
  const levels = new LevelService({ db, settings: LS, timeZone: TZ });
  const sobres: string[] = [];
  const t = new TriviaService({ db, settings, questions, levels, giveSobre: (id, tipo, n = 1) => sobres.push(`${id}:${tipo}${n > 1 ? `x${n}` : ""}`), timeZone: TZ, now: () => now, rnd: seededRng(7) });
  return { db, levels, t, sobres, at: (x: number) => (now = x), later: (ms: number) => (now += ms) };
}

/** Responde bien la pregunta en pantalla. */
function right(t: TriviaService, user: string) {
  const s = t.active(user)!;
  return s.question.kind === "opciones" ? t.answerOption(user, s.nonce, s.correct) : t.answerText(user, s.nonce, "teto");
}

describe("contenido de la trivia", () => {
  it("hay mas de 500 preguntas, sin ids repetidos", () => {
    expect(ALL.length).toBeGreaterThan(500);
    expect(new Set(ALL.map((x) => x.id)).size).toBe(ALL.length);
  });

  it("cada pregunta de opciones tiene 4 opciones distintas (o Verdadero y Falso) que caben en un boton", () => {
    for (const x of ALL.filter((x) => x.kind === "opciones")) {
      const opts = [x.answer, ...x.wrong];
      if (opts.length === 2) expect(new Set(opts), x.id).toEqual(new Set(["Verdadero", "Falso"]));
      else expect(new Set(opts).size, x.id).toBe(4);
      for (const o of opts) expect(o.length, `${x.id}: ${o}`).toBeLessThanOrEqual(80);
    }
  });

  it("cada pregunta de texto acepta su propia respuesta", () => {
    for (const x of ALL.filter((x) => x.kind === "texto")) expect(textCorrect(x, x.answer), x.id).toBe(true);
  });

  it("las tres dificultades tienen preguntas parejas, y las siluetas van según cómo se muestran", () => {
    const raw = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../content/trivia.json"), "utf8")) as { preguntas: { id: string; dificultad?: string }[] }).preguntas;
    for (const x of raw) expect(DIFICULTADES, x.id).toContain(x.dificultad);
    for (const c of loadAudioClips()) expect(DIFICULTADES, c.id).toContain(c.dificultad);
    for (const d of DIFICULTADES) expect(ALL.filter((x) => x.level === d).length, d).toBeGreaterThan(150);
    for (const x of ALL.filter((x) => x.image)) expect(x.level).toBe(S.siluetasDificultad[x.image!.mode]);
    expect(Object.values(S.dificultades).map((d) => d.premio)).toEqual(["comun", "raro", "legendario"]);
  });

  it("hay siluetas de los 15 Vocaloids y preguntas de audio en el manifiesto", () => {
    expect(ALL.filter((x) => x.image).length).toBe(15 * S.siluetas.length);
    expect(loadAudioClips().length).toBeGreaterThan(50);
  });

  it("las preguntas de audio cuyo archivo falta no salen", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trivia-"));
    const clip = loadAudioClips()[0]!;
    writeFileSync(path.join(dir, clip.archivo), "x");
    const withOne = loadQuestions(S, { audioDir: dir, rnd: seededRng(1) }).filter((x) => x.audio);
    expect(withOne.map((x) => x.id)).toEqual([clip.id]);
  });

  it("hay más de 5000 preguntas generadas, variadas y casi sin años (decisión de GyroP, 2 nov. 2026)", () => {
    const g = loadGenerated();
    const all = [...g.preguntas, ...g.imagenes, ...g.clips];
    expect(all.length).toBeGreaterThanOrEqual(5000);
    const ids = new Set([...ALL.map((x) => x.id)]);
    for (const x of g.preguntas) expect(ids.has(x.id), x.id).toBe(true);
    // Muchos tipos distintos, ninguno se come la trivia.
    const temas = new Map<string, number>();
    for (const x of all) temas.set(x.tema ?? "-", (temas.get(x.tema ?? "-") ?? 0) + 1);
    expect(temas.size).toBeGreaterThanOrEqual(7);
    for (const [t, n] of temas) expect(n / all.length, t).toBeLessThan(0.5);
    // Sin preguntas de años (las más difíciles y las que menos se disfrutan): ninguna respuesta es un año, salvo el
    // título de la canción «1925».
    expect(all.filter((x) => /^(19|20)\d\d$/.test(x.respuesta) && x.respuesta !== "1925").map((x) => x.id)).toEqual([]);
    for (const x of all) expect(DIFICULTADES, x.id).toContain(x.dificultad);
  });

  it("las preguntas de imagen generadas salen solo si su archivo está dibujado", () => {
    const g = loadGenerated();
    const modes: PictureMode[] = ["normal", "silueta", "pixel", "zoom", "mitad", "gris", "piezas", "franjas"];
    for (const p of g.imagenes) expect(modes, p.id).toContain(p.modo);
    const dir = mkdtempSync(path.join(tmpdir(), "trivia-img-"));
    const one = g.imagenes[0]!;
    writeFileSync(path.join(dir, one.archivo), "x");
    const qs = loadQuestions(S, { pictureDir: dir, rnd: seededRng(1) }).filter((x) => x.picture);
    expect(qs.map((x) => x.id)).toEqual([one.id]);
    expect(timerFor(S, qs[0]!)).toBe(S.segundos.imagen);
  });

  it("dibuja una imagen del motor de cada forma", async () => {
    const src = path.resolve(import.meta.dirname, "../assets/bots/teto_figura.png");
    for (const m of ["normal", "silueta", "pixel", "zoom", "mitad", "gris", "piezas", "franjas"] as PictureMode[]) {
      const png = await renderPicture(src, m, `prueba-${m}`);
      expect(png.subarray(1, 4).toString(), m).toBe("PNG");
    }
  });

  it("dibuja el diploma animado del Papu Lince", async () => {
    const gif = await renderLynx({ name: "Un Papu con un apodo larguísimo que no cabe en el diploma", avatar: null, total: 5733, levels: [{ nombre: "Fácil", total: 2025, color: "#57d38c" }, { nombre: "Media", total: 2773, color: "#f2c94c" }, { nombre: "Difícil", total: 935, color: "#ff6b6b" }], date: "2 de noviembre de 2026" });
    expect(gif.subarray(0, 6).toString()).toBe("GIF89a");
    expect(gif.length).toBeLessThan(8 * 1024 * 1024);
    expect(S.secreto).toMatchObject({ rol: "🐾 Papu Lince", sobres: { tipo: "legendario", cantidad: 2 } });
  });

  it("dibuja una silueta", async () => {
    const png = await renderFigure("miku", "silueta");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("reglas", () => {
  it("el tiempo depende del tipo de pregunta", () => {
    expect(timerFor(S, q("a"))).toBe(S.segundos.opciones);
    expect(timerFor(S, q("c", "texto"))).toBe(S.segundos.texto);
    expect(timerFor(S, { ...q("a"), audio: "x.mp3" })).toBe(S.segundos.audio);
  });

  it("las opciones se barajan y se sabe cual es la correcta", () => {
    const { options, correct } = shuffledOptions(q("a"), seededRng(3));
    expect(options).toHaveLength(4);
    expect(options[correct]).toBe("bien-a");
  });

  it("primero salen las preguntas que el Papu no ha visto", () => {
    const qs = ["a", "b", "c", "d"].map((x) => q(x));
    const order = playOrder(qs, new Set(["a", "b"]), seededRng(2));
    expect(order.slice(0, 2).sort()).toEqual(["c", "d"]);
    expect(order.slice(2).sort()).toEqual(["a", "b"]);
  });

  it("la XP crece con el nivel, con lo que crece el Papu y con la racha", () => {
    const base = { xp: 0, dailyAvg: 0, streak: 1, multiplier: 1 };
    expect(answerXp(S, LS, base)).toBe(S.xp.minimo);
    const xp30 = 25_000;
    const need = progress(LS, xp30).needed;
    const byLevel = answerXp(S, LS, { ...base, xp: xp30 });
    expect(byLevel).toBe(Math.round(S.xp.porcentajeNivel * need));
    // Un Papu que viene creciendo mucho gana mas, hasta el tope de su nivel.
    expect(answerXp(S, LS, { ...base, xp: xp30, dailyAvg: 2500 })).toBe(Math.round(S.xp.porcentajeDia * 2500));
    expect(answerXp(S, LS, { ...base, xp: xp30, dailyAvg: 1e6 })).toBe(Math.round(S.xp.topeNivel * need));
    // Racha larga: el doble como maximo; evento ×2.
    expect(answerXp(S, LS, { ...base, xp: xp30, streak: 999 })).toBe(Math.round(byLevel * 2));
    expect(answerXp(S, LS, { ...base, xp: xp30, multiplier: 2 })).toBe(Math.round(S.xp.porcentajeNivel * need * 2));
  });

  it("el tope del dia es una fraccion del nivel, con minimo y multiplicador", () => {
    expect(dailyCap(S, LS, 0)).toBe(S.limites.topeDiaMinimo);
    const need = progress(LS, 25_000).needed;
    expect(dailyCap(S, LS, 25_000)).toBe(Math.round(S.limites.topeDiaNivel * need));
    expect(dailyCap(S, LS, 25_000, 2)).toBe(Math.round(S.limites.topeDiaNivel * need * 2));
  });
});

describe("partidas de más (decisión de GyroP, 2 nov. 2026)", () => {
  // GyroP quitó el castigo el mismo 2 nov. 2026 (`castigo: null`); se prueba con uno explícito por si vuelve.
  const C = { desdePartida: 16, porcentajeNivel: 0.05, minimo: 20, factor: 2 };
  const SC: TriviaSettings = { ...S, limites: { ...S.limites, castigo: C } };

  it("sin castigo en la configuración, ninguna partida cuesta XP", () => {
    expect(S.limites.castigo).toBeNull();
    for (let run = 1; run <= 40; run++) expect(runCost(S, LS, 25_000, run)).toBe(0);
    const { t, levels } = setup([q("a")]);
    levels.bonus("p", 30_000, NOON);
    const before = levels.store.get("p").xp;
    for (let n = 1; n <= 25; n++) {
      expect(t.nextCost("p")).toBe(0);
      const r = t.start("p", "c", "facil");
      expect(r.info.cost).toBe(0);
      expect(r.change).toBeNull();
      const s = t.active("p")!;
      t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    }
    expect(levels.store.get("p").xp).toBe(before);
  });

  it("las primeras 15 del día no cuestan; desde la 16 cuestan XP, el doble cada vez", () => {
    for (let run = 1; run < C.desdePartida; run++) expect(runCost(SC, LS, 25_000, run)).toBe(0);
    const base = Math.max(C.minimo, C.porcentajeNivel * progress(LS, 25_000).needed);
    expect(runCost(SC, LS, 25_000, C.desdePartida)).toBe(Math.round(base));
    expect(runCost(SC, LS, 25_000, C.desdePartida + 1)).toBe(Math.round(base * C.factor));
    expect(runCost(SC, LS, 25_000, C.desdePartida + 3)).toBe(Math.round(base * C.factor ** 3));
    expect(runCost(SC, LS, 0, C.desdePartida)).toBe(C.minimo);
  });

  it("empezar la partida 16 le quita la XP al Papu (sin bajar de 0) y lo dice la partida", () => {
    const { t, levels, db, later } = setup([q("a"), q("b")], memDb(), SC);
    levels.bonus("p", 30_000, NOON);
    const fail = () => {
      const s = t.active("p")!;
      t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    };
    for (let n = 1; n < C.desdePartida; n++) {
      expect(t.nextCost("p")).toBe(0);
      expect(t.start("p", "c", "facil").info.cost).toBe(0);
      fail();
    }
    const before = levels.store.get("p").xp;
    const cost = t.nextCost("p");
    expect(cost).toBe(runCost(SC, LS, before, C.desdePartida));
    const r = t.start("p", "c", "facil");
    expect(r.info).toMatchObject({ run: C.desdePartida, cost });
    expect(levels.store.get("p").xp).toBe(before - cost);
    const day = db.prepare("SELECT trivia_castigo AS c, xp FROM xp_dia WHERE user_id = 'p'").get() as { c: number; xp: number };
    expect(day.c).toBe(cost);
    expect(day.xp).toBeGreaterThanOrEqual(0);
    fail();
    // La siguiente cuesta el doble (o más, si su nivel bajó poco); nunca lo deja bajo 0.
    expect(t.nextCost("p")).toBeGreaterThan(cost);
    for (let k = 0; k < 12; k++) {
      t.start("p", "c", "facil");
      fail();
    }
    expect(levels.store.get("p").xp).toBe(0);
    // Al día siguiente vuelven a ser gratis.
    later(86_400_000);
    expect(t.nextCost("p")).toBe(0);
  });

  it("si cobrarla lo baja de nivel, avisa el cambio", () => {
    const { t, levels } = setup([q("a")], memDb(), SC);
    levels.bonus("p", 5_000, NOON);
    const downs = [];
    for (let n = 1; n < C.desdePartida + 6; n++) {
      const r = t.start("p", "c", "facil");
      if (r.change) downs.push(r.change);
      const s = t.active("p")!;
      t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    }
    expect(downs.length).toBeGreaterThan(0);
    for (const c of downs) expect(c.to).toBeLessThan(c.from);
  });
});

describe("partidas", () => {
  it("cada acierto da XP al instante y la racha sigue", () => {
    const { t, levels } = setup();
    t.start("p", "canal", "facil");
    const r = right(t, "p");
    expect(r.kind).toBe("acierto");
    if (r.kind !== "acierto") return;
    expect(r.xp).toBeGreaterThan(0);
    expect(levels.store.get("p").xp).toBe(r.xp);
    expect(r.streak).toBe(1);
    expect(r.next?.number).toBe(2);
  });

  it("al fallar termina la partida y se guarda la racha", () => {
    const { t } = setup();
    t.start("p", "canal", "facil");
    right(t, "p");
    const s = t.active("p")!;
    const r = s.question.kind === "opciones" ? t.answerOption("p", s.nonce, (s.correct + 1) % 4) : t.answerText("p", s.nonce, "miku");
    expect(r.kind).toBe("fallo");
    if (r.kind !== "fallo") return;
    expect(r.end).toMatchObject({ streak: 1, reason: "error", channelId: "canal", best: 1, record: true });
    expect(t.active("p")).toBeNull();
    expect(t.best("p")).toBe(1);
  });

  it("si se acaba el tiempo, la respuesta no vale", () => {
    const { t, later } = setup();
    const { shown } = t.start("p", "c", "facil");
    later(S.segundos.opciones * 1000 + 10);
    const r = t.answerOption("p", shown.nonce, shown.correct);
    expect(r.kind).toBe("tiempo");
  });

  it("el temporizador cierra la pregunta vencida (y no una ya respondida)", () => {
    const { t, later } = setup();
    const { shown } = t.start("p", "c", "facil");
    expect(t.timeout("p", shown.nonce)).toBeNull();
    right(t, "p");
    later(60_000);
    expect(t.timeout("p", shown.nonce)).toBeNull();
    const now = t.active("p")!;
    expect(t.timeout("p", now.nonce)?.kind).toBe("tiempo");
  });

  it("un boton viejo no cuenta y no se puede abrir otra partida a la vez", () => {
    const { t } = setup();
    const { shown } = t.start("p", "c", "facil");
    expect(t.start("p", "c", "facil").busy).toBe(true);
    right(t, "p");
    expect(t.answerOption("p", shown.nonce, shown.correct).kind).toBe("vieja");
  });

  it("acertar todas sin fallar es la racha perfecta (el secreto)", () => {
    const { t } = setup();
    t.start("p", "c", "facil");
    right(t, "p");
    right(t, "p");
    const r = right(t, "p");
    expect(r.kind).toBe("acierto");
    if (r.kind !== "acierto") return;
    expect(r.next).toBeNull();
    expect(r.end).toMatchObject({ reason: "perfecta", streak: 3 });
    expect(t.perfectBefore("p")).toBe(true);
  });

  it("la siguiente partida empieza por las preguntas no vistas", () => {
    const { t } = setup([q("a"), q("b"), q("c"), q("d")]);
    const first = t.start("p", "c", "facil").shown.question.id;
    const s = t.active("p")!;
    t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    expect(t.start("p", "c", "facil").shown.question.id).not.toBe(first);
  });

  it("la XP de la trivia no cuenta para medir cuanto crece el Papu", () => {
    const { t, levels, at } = setup();
    at(NOON - 86_400_000);
    levels.bonus("p", 1000, NOON - 86_400_000);
    t.start("p", "c", "facil");
    right(t, "p");
    at(NOON);
    expect(t.dailyAvg("p")).toBe(1000);
    expect(t.correctToday("p")).toBe(0);
  });

  it("solo las primeras partidas del dia dan XP; despues se juega por la racha", () => {
    const { t, levels, later } = setup([q("a"), q("b"), q("c"), q("d"), q("e")]);
    const N = S.limites.partidasConXp;
    for (let n = 1; n <= N; n++) {
      const { info, shown } = t.start("p", "c", "facil");
      expect(info).toMatchObject({ run: n, withXp: true });
      t.answerOption("p", shown.nonce, (shown.correct + 1) % 4);
    }
    const before = levels.store.get("p").xp;
    const { info } = t.start("p", "c", "facil");
    expect(info.withXp).toBe(false);
    const r = right(t, "p");
    expect(r.kind === "acierto" && r.xp).toBe(0);
    expect(levels.store.get("p").xp).toBe(before);
    expect(t.correctToday("p")).toBe(1);
    // Al dia siguiente vuelven las partidas con XP.
    const s = t.active("p")!;
    t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    later(86_400_000);
    expect(t.start("p", "c", "facil").info).toMatchObject({ run: 1, withXp: true });
  });

  it("una partida solo trae preguntas de su dificultad", () => {
    const { t } = setup([q("f1"), q("f2"), q("m1", "opciones", "medio"), q("d1", "opciones", "dificil")]);
    const seen: string[] = [t.start("p", "c", "medio").shown.question.id];
    const r = right(t, "p");
    expect(r.kind === "acierto" && r.next).toBeNull(); // la media solo tenia una
    expect(seen).toEqual(["m1"]);
    expect(t.start("p", "c", "facil").shown.question.id).toMatch(/^f/);
  });

  it("cada pregunta acertada cuenta una vez como superada, por dificultad", () => {
    const { t } = setup([q("f1"), q("f2"), q("f3"), q("m1", "opciones", "medio")]);
    const first = t.start("p", "c", "facil").shown.question.id;
    right(t, "p");
    let s = t.active("p")!;
    t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    expect(t.progress("p")).toMatchObject({ facil: { done: 1, total: 3, prize: false }, medio: { done: 0, total: 1 }, dificil: { done: 0, total: 0 } });
    // La siguiente partida empieza por las que no ha superado.
    const next = t.start("p", "c", "facil").shown.question.id;
    right(t, "p");
    s = t.active("p")!;
    t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    expect(t.progress("p").facil.done).toBe(2);
    expect(next).not.toBe(first);
  });

  it("superar toda una dificultad da su sobre una sola vez; las tres, el secreto", () => {
    const { t, sobres } = setup([q("f1"), q("m1", "opciones", "medio"), q("d1", "opciones", "dificil")]);
    t.start("p", "c", "facil");
    const a = right(t, "p");
    expect(a).toMatchObject({ kind: "acierto", completed: "facil", secret: false });
    expect(sobres).toEqual(["p:comun"]);
    t.start("p", "c", "facil");
    expect(right(t, "p")).toMatchObject({ completed: null, secret: false });
    expect(sobres).toEqual(["p:comun"]);
    t.start("p", "c", "dificil");
    expect(right(t, "p")).toMatchObject({ completed: "dificil", secret: false });
    t.start("p", "c", "medio");
    expect(right(t, "p")).toMatchObject({ completed: "medio", secret: true });
    // Las tres: Papu Lince, con sus dos sobres legendarios (una sola vez).
    expect(sobres).toEqual(["p:comun", "p:legendario", "p:raro", "p:legendariox2"]);
    expect(t.isLynx("p")).toBe(true);
    expect(t.progress("p")).toMatchObject({ facil: { prize: true }, medio: { prize: true }, dificil: { prize: true } });
  });

  it("quien ya tenía los tres sobres (Larper) es Papu Lince al superar las preguntas nuevas", () => {
    const db = memDb();
    const old = setup([q("f1"), q("m1", "opciones", "medio"), q("d1", "opciones", "dificil")], db);
    for (const l of ["facil", "medio", "dificil"] as const) {
      old.t.start("p", "c", l);
      right(old.t, "p");
    }
    db.prepare("DELETE FROM trivia_premios WHERE dificultad = 'todas'").run(); // como antes del 2 nov. 2026
    // Llegan preguntas nuevas: no está completo hasta superarlas.
    const { t, sobres } = setup([q("f1"), q("f2"), q("m1", "opciones", "medio"), q("d1", "opciones", "dificil")], db);
    expect(t.isLynx("p")).toBe(false);
    t.start("p", "c", "facil");
    const r = right(t, "p");
    expect(r).toMatchObject({ kind: "acierto", completed: null, secret: true });
    expect(sobres).toEqual(["p:legendariox2"]);
    t.start("p", "c", "facil");
    expect(right(t, "p")).toMatchObject({ secret: false });
    expect(sobres).toEqual(["p:legendariox2"]);
  });

  it("la XP de la trivia no pasa del tope del dia", () => {
    const qs = Array.from({ length: 60 }, (_, k) => q(`q${k}`));
    const { t, levels } = setup(qs);
    t.start("p", "c", "facil");
    let total = 0;
    for (let k = 0; k < 59; k++) {
      const r = right(t, "p");
      if (r.kind === "acierto") total += r.xp;
    }
    expect(total).toBe(dailyCap(S, LS, 0));
    expect(levels.store.get("p").xp).toBe(total);
    expect(t.active("p")!.number).toBe(60);
  });
});

describe("hitos (pedido de GyroP, 7 nov. 2026)", () => {
  const withHitos = (cada: number, soloPartidasConXp = true): TriviaSettings => ({
    ...S,
    hitos: { soloPartidasConXp },
    dificultades: {
      ...S.dificultades,
      facil: { ...S.dificultades.facil, hito: { cada, premio: "comun", mensaje: "{papu} {n}" } },
      medio: { ...S.dificultades.medio, hito: { cada, premio: "raro", mensaje: "{papu} {n}" } },
      dificil: { ...S.dificultades.dificil, hito: undefined },
    },
  });
  const many = (level: Dificultad, n = 30) => Array.from({ length: n }, (_, k) => q(`${level}${k}`, "opciones", level));

  it("la configuración trae hitos en las tres dificultades", () => {
    for (const d of DIFICULTADES) expect(S.dificultades[d].hito?.cada).toBeGreaterThan(0);
    expect(S.dificultades).toMatchObject({ facil: { hito: { premio: "comun" } }, medio: { hito: { premio: "raro" } }, dificil: { hito: { premio: "legendario" } } });
  });

  it("cada tantos aciertos de una dificultad da su sobre, una y otra vez (también repitiendo preguntas)", () => {
    const { t, sobres } = setup([...many("facil", 2), ...many("medio", 2)], memDb(), withHitos(3));
    const hits: (string | null)[] = [];
    for (let k = 0; k < 4; k++) {
      t.start("p", "c", "facil");
      for (let j = 0; j < 2; j++) {
        const r = right(t, "p");
        if (r.kind === "acierto") hits.push(r.milestone ? `${r.milestone.level}:${r.milestone.n}` : null);
      }
    }
    expect(hits).toEqual([null, null, "facil:3", null, null, "facil:6", null, null]);
    expect(t.milestones("p", "facil")).toEqual({ aciertos: 8, cada: 3, left: 1, premio: "comun" });
    // La media cuenta aparte.
    expect(t.milestones("p", "medio")).toMatchObject({ aciertos: 0, left: 3 });
    expect(sobres.filter((x) => x === "p:comun")).toHaveLength(2 + 1); // 2 hitos + superar todas las fáciles
  });

  it("solo cuentan los aciertos de las partidas con XP del día (si así está configurado)", () => {
    const { t } = setup(many("facil"), memDb(), withHitos(100));
    for (let n = 1; n <= S.limites.partidasConXp; n++) {
      const { shown } = t.start("p", "c", "facil");
      right(t, "p");
      const s = t.active("p")!;
      t.answerOption("p", s.nonce, (s.correct + 1) % 4);
      expect(shown).toBeTruthy();
    }
    expect(t.milestones("p", "facil")!.aciertos).toBe(S.limites.partidasConXp);
    t.start("p", "c", "facil");
    right(t, "p");
    expect(t.milestones("p", "facil")!.aciertos).toBe(S.limites.partidasConXp);

    const libre = setup(many("facil"), memDb(), withHitos(100, false));
    for (let n = 0; n <= S.limites.partidasConXp; n++) {
      libre.t.start("p", "c", "facil");
      right(libre.t, "p");
      const s = libre.t.active("p")!;
      libre.t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    }
    expect(libre.t.milestones("p", "facil")!.aciertos).toBe(S.limites.partidasConXp + 1);
  });

  it("sin hito en una dificultad no hay premio", () => {
    const { t, sobres } = setup(many("dificil", 3), memDb(), withHitos(1));
    t.start("p", "c", "dificil");
    const r = right(t, "p");
    expect(r.kind === "acierto" && r.milestone).toBeNull();
    expect(t.milestones("p", "dificil")).toBeNull();
    expect(sobres).toEqual([]);
  });
});

describe("partidas colgadas (la de Wicho el Bicho, 5 nov. 2026)", () => {
  it("si el temporizador nunca corrió, la siguiente partida cierra la vieja por tiempo y empieza otra", () => {
    const { t, later } = setup();
    const first = t.start("p", "c", "facil").shown;
    right(t, "p"); // pasó a la siguiente, pero Discord no alcanzó a mostrarla: sin temporizador
    expect(t.start("p", "c", "facil").busy).toBe(true); // aún en su tiempo: sigue siendo la misma
    expect(t.reap("p")).toBeNull();
    later(24 * 3_600_000);
    const end = t.reap("p");
    expect(end).toMatchObject({ reason: "tiempo", streak: 1 });
    const again = t.start("p", "c", "facil");
    expect(again.busy).toBe(false);
    expect(again.shown.nonce).not.toBe(first.nonce);
  });

  it("start también la cierra solo, aunque nadie llame a reap", () => {
    const { t, later } = setup();
    t.start("p", "c", "facil");
    later(STALE_MS + 60_000);
    expect(t.start("p", "c", "facil").busy).toBe(false);
    expect(t.best("p")).toBe(0);
  });
});

describe("hitos iniciales (quienes ya tenían avance, 7 nov. 2026)", () => {
  it("dan los sobres de los hitos que ya pasaron, una sola vez, contando las superadas de cada dificultad", () => {
    const db = memDb();
    const qs = [...Array.from({ length: 7 }, (_, k) => q(`f${k}`)), ...Array.from({ length: 2 }, (_, k) => q(`m${k}`, "opciones", "medio"))];
    const settings: TriviaSettings = {
      ...S,
      dificultades: {
        ...S.dificultades,
        facil: { ...S.dificultades.facil, hito: { cada: 3, premio: "comun", mensaje: "x" } },
        medio: { ...S.dificultades.medio, hito: { cada: 3, premio: "raro", mensaje: "x" } },
      },
    };
    const ins = db.prepare("INSERT INTO trivia_superadas (user_id, pregunta) VALUES (?, ?)");
    for (let k = 0; k < 7; k++) ins.run("p", `f${k}`);
    ins.run("p", "m0");
    ins.run("p", "ya-no-existe");
    const { t, sobres } = setup(qs, db, settings);
    expect(t.seedMilestones()).toEqual([{ userId: "p", level: "facil", aciertos: 7, sobres: 2 }]);
    expect(sobres).toEqual(["p:comunx2"]);
    expect(t.milestones("p", "facil")).toMatchObject({ aciertos: 7, left: 2 });
    expect(t.milestones("p", "medio")).toMatchObject({ aciertos: 1, left: 2 });
    // No se repite al reiniciar, y el siguiente hito sigue desde ahí.
    expect(t.seedMilestones()).toEqual([]);
    expect(sobres).toEqual(["p:comunx2"]);
  });
});
