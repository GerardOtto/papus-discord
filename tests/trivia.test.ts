import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLevelSettings, progress } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { renderFigure } from "../src/trivia/images";
import { answerXp, loadAudioClips, loadQuestions, loadTriviaSettings, playOrder, shuffledOptions, textCorrect, timerFor, type Question } from "../src/trivia/rules";
import { TriviaService } from "../src/trivia/service";
import { memDb, seededRng } from "./helpers";

const TZ = "America/Santiago";
const LS = loadLevelSettings();
const S = loadTriviaSettings();
const NOON = Date.parse("2026-10-26T12:00:00-03:00");
const ALL = loadQuestions(S, { rnd: seededRng(1) });

const q = (id: string, kind: "opciones" | "texto" = "opciones"): Question =>
  kind === "opciones"
    ? { id, kind, topic: "t", text: `¿${id}?`, answer: `bien-${id}`, wrong: ["mal1", "mal2", "mal3"], accepted: [] }
    : { id, kind, topic: "t", text: `¿${id}?`, answer: "Kasane Teto", wrong: [], accepted: ["Kasane Teto", "teto"] };

function setup(questions: Question[] = [q("a"), q("b"), q("c", "texto")]) {
  const db = memDb();
  let now = NOON;
  const levels = new LevelService({ db, settings: LS, timeZone: TZ });
  const t = new TriviaService({ db, settings: S, questions, levels, timeZone: TZ, now: () => now, rnd: seededRng(7) });
  return { db, levels, t, at: (x: number) => (now = x), later: (ms: number) => (now += ms) };
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

  it("cada pregunta de opciones tiene 4 opciones distintas que caben en un boton", () => {
    for (const x of ALL.filter((x) => x.kind === "opciones")) {
      const opts = [x.answer, ...x.wrong];
      expect(new Set(opts).size, x.id).toBe(4);
      for (const o of opts) expect(o.length, `${x.id}: ${o}`).toBeLessThanOrEqual(80);
    }
  });

  it("cada pregunta de texto acepta su propia respuesta", () => {
    for (const x of ALL.filter((x) => x.kind === "texto")) expect(textCorrect(x, x.answer), x.id).toBe(true);
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
    const base = { xp: 0, dailyAvg: 0, streak: 1, correctToday: 0, multiplier: 1 };
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

  it("muchos aciertos en el dia valen menos", () => {
    const p = { xp: 25_000, dailyAvg: 0, streak: 1, multiplier: 1 };
    const full = answerXp(S, LS, { ...p, correctToday: 0 });
    expect(answerXp(S, LS, { ...p, correctToday: S.diario[0]!.desde })).toBe(Math.round((full * S.diario[0]!.factor)));
    expect(answerXp(S, LS, { ...p, correctToday: S.diario[1]!.desde })).toBe(Math.round(S.xp.porcentajeNivel * progress(LS, 25_000).needed * S.diario[1]!.factor));
  });
});

describe("partidas", () => {
  it("cada acierto da XP al instante y la racha sigue", () => {
    const { t, levels } = setup();
    t.start("p", "canal");
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
    t.start("p", "canal");
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
    const { shown } = t.start("p", "c");
    later(S.segundos.opciones * 1000 + 10);
    const r = t.answerOption("p", shown.nonce, shown.correct);
    expect(r.kind).toBe("tiempo");
  });

  it("el temporizador cierra la pregunta vencida (y no una ya respondida)", () => {
    const { t, later } = setup();
    const { shown } = t.start("p", "c");
    expect(t.timeout("p", shown.nonce)).toBeNull();
    right(t, "p");
    later(60_000);
    expect(t.timeout("p", shown.nonce)).toBeNull();
    const now = t.active("p")!;
    expect(t.timeout("p", now.nonce)?.kind).toBe("tiempo");
  });

  it("un boton viejo no cuenta y no se puede abrir otra partida a la vez", () => {
    const { t } = setup();
    const { shown } = t.start("p", "c");
    expect(t.start("p", "c").busy).toBe(true);
    right(t, "p");
    expect(t.answerOption("p", shown.nonce, shown.correct).kind).toBe("vieja");
  });

  it("acertar todas sin fallar es la racha perfecta (el secreto)", () => {
    const { t } = setup();
    t.start("p", "c");
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
    const first = t.start("p", "c").shown.question.id;
    const s = t.active("p")!;
    t.answerOption("p", s.nonce, (s.correct + 1) % 4);
    expect(t.start("p", "c").shown.question.id).not.toBe(first);
  });

  it("la XP de la trivia no cuenta para medir cuanto crece el Papu", () => {
    const { t, levels, at } = setup();
    at(NOON - 86_400_000);
    levels.bonus("p", 1000, NOON - 86_400_000);
    t.start("p", "c");
    right(t, "p");
    at(NOON);
    expect(t.dailyAvg("p")).toBe(1000);
    expect(t.correctToday("p")).toBe(0);
  });
});
