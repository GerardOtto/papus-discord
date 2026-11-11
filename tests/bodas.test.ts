import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderWeddingBanner } from "../src/bodas/banner";
import { answerWords, genderWords, isCorrect, loadRiddles, loadWeddingSettings, planSlots, weddingRole, weddingXp, zonedTime } from "../src/bodas/rules";
import { channelKey } from "../src/discord/channels";
import { WeddingService } from "../src/bodas/service";
import { CHAT_BOT_IDS } from "../src/config";
import { levelFor, loadLevelSettings, xpToReach } from "../src/levels/rules";
import { WEDDING_BOTS } from "../src/phrases/catalog";
import { DeckStore } from "../src/phrases/deck";
import { memDb, seededRng } from "./helpers";

const S = loadWeddingSettings();
const R = loadRiddles();
const L = loadLevelSettings();
const H = 3_600_000;

describe("configuracion de las bodas", () => {
  it("juegan los 15 Vocaloids (los chicos desde el 25 oct. 2026), todos con frases, adivinanzas y emoji", () => {
    expect(Object.keys(S.chicas).sort()).toEqual([...WEDDING_BOTS].sort());
    expect(WEDDING_BOTS).toHaveLength(15);
    for (const boy of ["kaito", "gakupo", "len"]) expect(S.chicas[boy as "kaito"]?.chico, boy).toBe(true);
    expect(S.chicas).toHaveProperty("ruko");
    for (const girl of WEDDING_BOTS) {
      expect(R[girl]?.length, girl).toBeGreaterThanOrEqual(10);
      for (const r of R[girl]!) {
        expect(r.adivinanza.trim(), girl).not.toBe("");
        expect(r.respuestas.length, r.adivinanza).toBeGreaterThan(0);
        // La respuesta no viene escrita en la adivinanza.
        expect(isCorrect(r.adivinanza.slice(0, 40), [r.respuestas[0]!]), r.adivinanza).toBe(false);
      }
    }
  });

  it("decisiones de GyroP: Teto inaugura, hasta 3 al día, 24 h, sin repetir esposa 3 días, nivel completo bajo el 40", () => {
    expect(S.inaugural).toBe("teto");
    expect(S.porDia).toBe(3);
    expect(S.horas).toBe(24);
    expect(S.diasSinRepetir).toBe(3);
    expect(S.recompensa).toEqual({ nivelCompletoHasta: 40, porcentaje: 0.25 });
    expect(L.honor.nivel).toBe(40);
  });

  it("rol 'Espos@ de …' con el corazón de la chica", () => {
    expect(weddingRole(S, "teto")).toBe("❤️ Espos@ de Teto");
    expect(weddingRole(S, "adachirei")).toBe("🧡 Espos@ de Adachi Rei");
    expect(weddingRole(S, "ruko")).toBe("💙 Espos@ de Ruko");
  });

  it("el rol temporal de Kaito nunca se confunde con el de Piña (ni ningún rol de boda con uno especial)", () => {
    expect(weddingRole(S, "kaito")).toBe("🍨 Espos@ (temporal) de Kaito");
    // Teto busca y borra los roles de boda por su nombre sin emojis ni signos: no pueden coincidir con otro.
    const especiales = (JSON.parse(readFileSync(path.join(import.meta.dirname, "../config/especiales.json"), "utf8")) as { papus: { rol?: string }[] }).papus
      .map((p) => p.rol)
      .filter((r): r is string => !!r);
    expect(especiales).toContain("💙 Esposa de Kaito");
    const keys = WEDDING_BOTS.map((b) => channelKey(weddingRole(S, b)));
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of especiales) expect(keys, r).not.toContain(channelKey(r));
  });

  it("los textos van en masculino con los chicos", () => {
    expect(genderWords(S, "kaito")).toEqual({ el: "él", casado: "casado", soltero: "soltero" });
    expect(genderWords(S, "miku")).toEqual({ el: "ella", casado: "casada", soltero: "soltera" });
  });

  it("los chicos siguen existiendo como bots de conversación", () => {
    expect(CHAT_BOT_IDS).toContain("kaito");
  });
});

describe("respuestas (las revisa el código, nunca el LLM)", () => {
  it("normaliza mayúsculas, acentos, signos, menciones y artículos", () => {
    expect(answerWords("¡Es LA Luna! 🌙 <@123>")).toEqual(["es", "luna"]);
  });

  it("acepta la respuesta dentro de una frase corta", () => {
    expect(isCorrect("la luna", ["luna"])).toBe(true);
    expect(isCorrect("creo que es la LUNA!!", ["luna"])).toBe(true);
    expect(isCorrect("Atun", ["atún"])).toBe(true);
    expect(isCorrect("estrella fugaz?", ["estrella fugaz"])).toBe(true);
  });

  it("no acepta otra cosa, palabras parecidas ni listas largas de intentos", () => {
    expect(isCorrect("el sol", ["luna"])).toBe(false);
    expect(isCorrect("lunar", ["luna"])).toBe(false);
    expect(isCorrect("sol estrella cometa nube planeta luna marte", ["luna"])).toBe(false);
    expect(isCorrect("estrella", ["estrella fugaz"])).toBe(false);
  });
});

describe("XP de la boda", () => {
  const need = (l: number) => xpToReach(L, l + 1) - xpToReach(L, l);

  it("bajo el nivel 40: un nivel completo; con evento ×2, dos niveles", () => {
    const xp = xpToReach(L, 18) + 100;
    expect(weddingXp(S, L, xp, 1)).toBe(need(18));
    expect(levelFor(L, xp + weddingXp(S, L, xp, 1))).toBe(19);
    expect(weddingXp(S, L, xp, 2)).toBe(need(18) + need(19));
    expect(levelFor(L, xp + weddingXp(S, L, xp, 2))).toBe(20);
    expect(weddingXp(S, L, xp, 3)).toBe(need(18) + need(19) + need(20));
  });

  it("desde el nivel 40: el 25 % de su nivel (doble con ×2)", () => {
    const xp = xpToReach(L, 45);
    expect(weddingXp(S, L, xp, 1)).toBe(Math.round(need(45) * 0.25));
    expect(weddingXp(S, L, xp, 2)).toBe(Math.round(need(45) * 0.5));
  });

  it("el 39 todavía recibe un nivel completo", () => {
    expect(weddingXp(S, L, xpToReach(L, 39), 1)).toBe(need(39));
  });
});

describe("horario", () => {
  it("convierte la hora de México", () => {
    // 22 oct. 2026: México (UTC-6, sin horario de verano).
    expect(new Date(zonedTime("2026-10-22", "14:00", "America/Mexico_City")).toISOString()).toBe("2026-10-22T20:00:00.000Z");
  });

  it("hasta 3 horas dentro de la ventana, separadas al menos 90 min", () => {
    const slots = planSlots(S, "2026-10-22", 3, seededRng(4));
    const from = zonedTime("2026-10-22", S.horario.desde, S.horario.zona);
    const to = zonedTime("2026-10-22", S.horario.hasta, S.horario.zona);
    expect(slots).toHaveLength(3);
    for (const t of slots) expect(t >= from && t <= to).toBe(true);
    for (let i = 1; i < slots.length; i++) expect(slots[i]! - slots[i - 1]!).toBeGreaterThanOrEqual(90 * 60_000);
  });
});

describe("WeddingService", () => {
  const T0 = Date.parse("2026-10-22T21:00:00Z"); // 15:00 en México
  function make() {
    const db = memDb();
    let t = T0;
    const w = new WeddingService({ db, settings: S, riddles: R, decks: new DeckStore(db, seededRng(3)), now: () => t, rnd: seededRng(9) });
    return { w, at: (ms: number) => (t = ms), advance: (ms: number) => (t += ms), now: () => t };
  }
  const open = (w: WeddingService, bot: "teto" | "miku" = "teto", kind: "normal" | "inaugural" | "divorcio" = "normal") => {
    const { index } = w.nextRiddle(bot);
    return w.opened({ bot, index, channelId: "general", messageId: "msg", threadId: "hilo" }, kind);
  };
  const answerOf = (w: WeddingService) => w.riddleOf(w.active()!).respuestas[0]!;

  it("la inaugural de Teto sale una vez y cuenta para el día", () => {
    const { w } = make();
    expect(w.inauguralPending()).toBe("teto");
    expect(w.pickBride(["teto", "miku"], "teto")).toBe("teto");
    open(w, "teto", "inaugural");
    expect(w.inauguralPending()).toBeNull();
    expect(w.countToday()).toBe(1);
    // Con una adivinanza abierta no se abre otra.
    expect(w.dueSlot()).toBeNull();
  });

  it("errores con ❌, tres intentos por Papu y el primero que acierta gana", () => {
    const { w } = make();
    open(w);
    expect(w.guess("a", "una sandía", false)).toEqual({ kind: "fallo", left: 2 });
    expect(w.guess("a", "una piña", false)).toEqual({ kind: "fallo", left: 1 });
    expect(w.guess("a", "un melón", false)).toEqual({ kind: "sin_intentos", last: true });
    expect(w.guess("a", answerOf(w), false)).toEqual({ kind: "sin_intentos", last: false });
    const answer = answerOf(w);
    expect(w.guess("b", answer, false)).toMatchObject({ kind: "acierto", answer });
    // Ya no hay adivinanza: el segundo que acierta no cuenta.
    expect(w.guess("c", answer, false)).toEqual({ kind: "ignorado" });
    expect(w.active()).toBeNull();
  });

  it("GyroP no juega", () => {
    const { w } = make();
    open(w);
    expect(w.guess("gyrop", answerOf(w), true)).toEqual({ kind: "ignorado" });
  });

  it("boda de 24 h: el Papu casado no juega y no repite esposa en 3 días", () => {
    const { w, advance } = make();
    w.marry("teto", "a", "karin", 500);
    open(w, "miku");
    expect(w.guess("a", "algo", false)).toEqual({ kind: "casado", with: "teto" });
    w.expire(Date.now() + 10 * H);
    advance(25 * H);
    expect(w.weddingOf("a")).toBeNull();
    expect(w.repeats("a", "teto")).toBe(true);
    expect(w.repeats("a", "miku")).toBe(false);
    advance(2 * 24 * H);
    expect(w.repeats("a", "teto")).toBe(false);
  });

  it("una chica casada no vuelve a dejar adivinanza hasta que termina su boda", () => {
    const { w, advance } = make();
    w.marry("teto", "a", "karin", 500);
    expect(w.pickBride(["teto"], "teto")).toBeNull();
    for (let i = 0; i < 20; i++) expect(w.pickBride(["teto", "miku"])).toBe("miku");
    advance(24 * H);
    expect(w.pickBride(["teto"], "teto")).toBe("teto");
  });

  it("al vencer, Teto quita el rol una sola vez", () => {
    const { w, advance } = make();
    const wed = w.marry("luka", "a", "karin", 500);
    expect(w.ended()).toEqual([]);
    expect(w.nextEnd()).toBe(wed.endsAt);
    advance(24 * H);
    expect(w.ended().map((x) => x.id)).toEqual([wed.id]);
    w.roleRemoved(wed.id);
    expect(w.ended()).toEqual([]);
  });

  it("si nadie acierta, la adivinanza se cierra al acabar el tiempo", () => {
    const { w, advance } = make();
    open(w);
    expect(w.expire()).toBeNull();
    advance(S.duracionMinutos * 60_000);
    expect(w.expire()?.bot).toBe("teto");
    expect(w.active()).toBeNull();
  });

  it("sin flood solo en #general y el hilo mientras dura", () => {
    const { w } = make();
    expect(w.floodFree("general")).toBe(false);
    open(w);
    expect(w.floodFree("general")).toBe(true);
    expect(w.floodFree("hilo")).toBe(true);
    expect(w.floodFree("otro")).toBe(false);
  });

  it("'contesta en el hilo' una sola vez por Papu", () => {
    const { w } = make();
    open(w);
    expect(w.shouldRemind("a")).toBe(true);
    expect(w.shouldRemind("a")).toBe(false);
    expect(w.shouldRemind("b")).toBe(true);
  });

  it("horas del día: se usan una vez y las que pasaron hace rato se pierden", () => {
    const { w, at } = make();
    const slots = w.slots();
    at(slots[0]! + 60_000);
    expect(w.dueSlot()).toBe(slots[0]);
    w.useSlot(slots[0]!);
    expect(w.dueSlot()).toBeNull();
    at(slots[1]! + 30 * 60_000);
    expect(w.dueSlot()).toBeNull();
  });

  it("lo que sabe la chica: su espos@ y hasta cuándo, y que no juzga respuestas", () => {
    const { w } = make();
    w.marry("miku", "a", "karin", 500);
    open(w, "teto");
    const until = () => "jueves 23 de octubre, 18:00";
    const own = w.notesFor("a", ["miku", "teto", "luka"], until);
    expect(own.miku).toMatch(/karin, tu espos@/);
    expect(own.miku).toMatch(/jueves 23 de octubre/);
    expect(own.teto).toMatch(/no digas si está bien o mal/);
    expect(own.luka).toBeUndefined();
    expect(w.notesFor("b", ["miku"], until).miku).toMatch(/casada.*karin/);
    // Sin insistir con la duracion (pedido de GyroP): solo la dice si le preguntan.
    for (const note of [own.miku!, own.teto!, w.notesFor("b", ["miku"], until).miku!]) {
      expect(note).not.toMatch(/24 horas|recuerdas/);
    }
    expect(own.miku).toMatch(/NO menciones cuánto dura/);
  });

  it("Kaito casado de juego: en masculino y sabe que su esposa de verdad sigue siendo Piña", () => {
    const { w } = make();
    w.marry("kaito", "a", "karin", 500);
    const until = () => "jueves 23 de octubre, 18:00";
    const other = w.notesFor("b", ["kaito"], until).kaito!;
    expect(other).toMatch(/Estás casado, en broma, con karin/);
    expect(other).toMatch(/Piña/);
    const own = w.notesFor("a", ["kaito"], until).kaito!;
    expect(own).toMatch(/nunca le dices "esposa" ni "amor"/);
    expect(own).not.toMatch(/24 horas/);
    // Una chica casada no recibe la nota de Kaito.
    w.marry("miku", "c", "mafer", 500);
    expect(w.notesFor("b", ["miku"], until).miku).not.toMatch(/Piña/);
  });
});

describe("divorcio", () => {
  const T0 = Date.parse("2026-10-22T21:00:00Z");
  function make() {
    const db = memDb();
    let t = T0;
    const w = new WeddingService({ db, settings: S, riddles: R, decks: new DeckStore(db, seededRng(3)), now: () => t, rnd: seededRng(9) });
    return { w, advance: (ms: number) => (t += ms) };
  }
  const open = (w: WeddingService, bot: "teto" | "miku", kind: "normal" | "divorcio" | "manual") => {
    const { index } = w.nextRiddle(bot);
    return w.opened({ bot, index, channelId: "general", messageId: "msg", threadId: "hilo" }, kind);
  };
  const until = () => "jueves";

  it("termina la boda ya: el rol se quita y la XP se conserva", () => {
    const { w, advance } = make();
    w.marry("teto", "a", "karin", 900);
    advance(H);
    expect(w.divorce("b")).toBeNull();
    const done = w.divorce("a")!;
    expect(done).toMatchObject({ bot: "teto", xp: 900, divorcedAt: T0 + H, endsAt: T0 + H });
    expect(w.weddingOf("a")).toBeNull();
    expect(w.ended().map((x) => x.id)).toEqual([done.id]);
  });

  it("con su ex no juega hasta 3 días después de la boda; con las demás, sí", () => {
    const { w, advance } = make();
    w.marry("teto", "a", "karin", 900);
    w.divorce("a");
    expect(w.afterDivorce(["teto", "miku"])).toBe("teto");
    open(w, "teto", "divorcio");
    expect(w.guess("a", "algo", false)).toEqual({ kind: "repite" });
    w.expire(T0 + 10 * H);
    open(w, "miku", "normal");
    expect(w.guess("a", "algo", false)).toMatchObject({ kind: "fallo" });
    w.expire(T0 + 10 * H);
    advance(3 * 24 * H);
    expect(w.repeats("a", "teto")).toBe(false);
  });

  it("la ex deja otra adivinanza (una sola vez) y no gasta las del día", () => {
    const { w } = make();
    w.marry("teto", "a", "karin", 900);
    w.divorce("a");
    open(w, "miku", "normal");
    // Con otra adivinanza abierta, espera.
    expect(w.afterDivorce(["teto", "miku"])).toBeNull();
    w.expire(T0 + 10 * H);
    expect(w.afterDivorce(["teto"])).toBe("teto");
    expect(w.afterDivorce(["miku"])).toBeNull();
    const before = w.countToday();
    open(w, "teto", "divorcio");
    expect(w.countToday()).toBe(before);
    w.expire(T0 + 10 * H);
    expect(w.afterDivorce(["teto"])).toBeNull();
  });

  it("/boda de GyroP no gasta las del día y cubre la revancha pendiente", () => {
    const { w } = make();
    w.marry("teto", "a", "karin", 900);
    w.divorce("a");
    open(w, "teto", "manual");
    expect(w.countToday()).toBe(0);
    w.expire(T0 + 10 * H);
    expect(w.afterDivorce(["teto"])).toBeNull();
  });

  it("la ex olvida a su espos@: sabe que está soltera, y al volver a casarse solo recuerda al nuevo", () => {
    const { w, advance } = make();
    w.marry("teto", "a", "karin", 900);
    w.divorce("a");
    const n = w.notesFor("a", ["teto"], until).teto!;
    expect(n).toMatch(/Ya NO estás casada/);
    expect(n).not.toMatch(/karin, tu espos@/);
    expect(w.notesFor("b", ["teto"], until).teto).toMatch(/karin se divorció/);
    advance(H);
    w.marry("teto", "b", "lolo", 500);
    const fresh = w.notesFor("b", ["teto"], until).teto!;
    expect(fresh).toMatch(/lolo, tu espos@/);
    expect(fresh).not.toMatch(/karin/);
  });

  it("la nota de divorcio se borra sola al día siguiente", () => {
    const { w, advance } = make();
    w.marry("miku", "a", "karin", 900);
    w.divorce("a");
    advance(25 * H);
    expect(w.notesFor("a", ["miku"], until).miku).toBeUndefined();
  });
});

describe("banner de boda", () => {
  const asset = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../assets/bots", f));

  it("dibuja los 3 estilos, subiendo de nivel o no, con y sin imágenes", async () => {
    for (let style = 0; style < 3; style++) {
      for (const leveled of [false, true]) {
        const png = await renderWeddingBanner({
          style,
          bride: { name: "Kasane Teto", color: "#E91E63", figure: style === 2 ? null : asset("teto_figura.png") },
          crowd: style === 1 ? [] : [asset("miku_figura.png"), asset("luka_figura.png")],
          papu: { name: "karin_vocaloid ✿ con un nombre larguísimo", avatar: style === 0 ? Buffer.from("no es imagen") : null },
          role: "❤️ Espos@ de Teto",
          before: { level: 18, into: 300, needed: 1000 },
          after: { level: leveled ? 19 : 18, into: leveled ? 300 : 900, needed: 1000, max: 99, tier: 1, rankName: "Estudio en casa" },
          gained: 600,
          multiplier: leveled ? 2 : 1,
          date: "22 oct. 2026",
          seed: style,
        });
        expect(png.subarray(1, 4).toString()).toBe("PNG");
      }
    }
  });
});
