import { describe, expect, it } from "vitest";
import { isCorrect } from "../src/bodas/answer";
import { BOT_IDS, type BotId } from "../src/config";
import { CATEGORIAS, esIntento, letrasPista, loadAdivinanzasSettings, loadBanco, lunesAnterior, lunesDe, pistaEn, planDelDia, pozo, relojLocal, type Adivinanza, type AdivinanzasSettings } from "../src/adivinanzas/rules";
import { AdivinanzasService, type AdivinanzasPort, type Publicacion } from "../src/adivinanzas/service";
import { bannerAdivinanza, bannerGanador, bannerNadie } from "../src/adivinanzas/images";
import { DeckStore } from "../src/phrases/deck";
import { memDb, seededRng } from "./helpers";

const settings = loadAdivinanzasSettings();
const banco = loadBanco();
// Viernes 20 nov. 2026, 15:00 en México (UTC-6).
const VIE_15H = Date.parse("2026-11-20T21:00:00Z");

describe("reglas de ¡Adivina, Papu!", () => {
  it("el pozo parte en 50, llega a 150 a los 15 s y se queda; la dorada vale el doble", () => {
    expect(pozo(settings, 0, false)).toBe(50);
    expect(pozo(settings, 7_500, false)).toBe(100);
    expect(pozo(settings, 15_000, false)).toBe(150);
    expect(pozo(settings, 28_000, false)).toBe(150);
    expect(pozo(settings, 0, true)).toBe(100);
    expect(pozo(settings, 20_000, true)).toBe(300);
  });

  it("dura 30 segundos con pistas a los 5 y 10 s", () => {
    expect(settings.duracionSeg).toBe(30);
    expect(pistaEn(settings, 4_000)).toBe(0);
    expect(pistaEn(settings, 5_000)).toBe(1);
    expect(pistaEn(settings, 10_000)).toBe(2);
  });

  it("destapa la primera letra de cada palabra y una de cada tres", () => {
    expect(letrasPista("reloj")).toBe("R _ _ O _");
    expect(letrasPista("pan francés")).toBe("P _ _   F _ _ N _ _ S");
    expect(letrasPista("cv03")).toBe("C _ 0 3");
  });

  it("los intentos: respuestas al mensaje siempre; si no, solo mensajes cortos y sin @", () => {
    expect(esIntento(settings, "reloj", false)).toBe(true);
    expect(esIntento(settings, "jajaja qué difícil está esta, no tengo idea de nada", false)).toBe(false);
    expect(esIntento(settings, "<@123> hola", false)).toBe(false);
    expect(esIntento(settings, "una respuesta muy pero muy larga que igual es para la adivinanza", true)).toBe(true);
  });

  it("plan del día: entre 4 y 6, dentro del horario y separadas", () => {
    for (let i = 0; i < 30; i++) {
      const plan = planDelDia(settings, seededRng(i + 1));
      expect(plan.length).toBeGreaterThanOrEqual(settings.porDia.min);
      expect(plan.length).toBeLessThanOrEqual(settings.porDia.max);
      for (const m of plan) expect(m).toBeGreaterThanOrEqual(settings.desde * 60);
      for (const m of plan) expect(m).toBeLessThan(settings.hasta * 60);
      for (let k = 1; k < plan.length; k++) expect(plan[k]! - plan[k - 1]!).toBeGreaterThanOrEqual(settings.separacionMin);
    }
  });

  it("semanas de lunes a domingo", () => {
    expect(lunesDe("2026-11-20")).toBe("2026-11-16");
    expect(lunesDe("2026-11-16")).toBe("2026-11-16");
    expect(lunesDe("2026-11-22")).toBe("2026-11-16");
    expect(lunesAnterior("2026-11-23")).toBe("2026-11-16");
    expect(relojLocal(new Date(VIE_15H), settings.zonaHoraria)).toMatchObject({ day: "2026-11-20", hora: 15, weekday: 5 });
  });

  it("banco amplio, sin repetidas, de todas las categorías y con su respuesta aceptada", () => {
    const list = banco.adivinanzas;
    expect(list.length).toBeGreaterThanOrEqual(600);
    expect(new Set(list.map((a) => a.t)).size).toBe(list.length);
    for (const c of Object.keys(CATEGORIAS)) expect(list.filter((a) => a.c === c).length, c).toBeGreaterThanOrEqual(30);
    for (const a of list) expect(isCorrect(a.r[0]!, a.r), a.t).toBe(true);
    for (const k of ["intro", "acierto", "nadie"] as const) expect(banco.frases[k].length).toBeGreaterThanOrEqual(30);
  });
});

// ───────────────────────── servicio ─────────────────────────

class FakePort implements AdivinanzasPort {
  posts: { bot: BotId; channelId: string; p: Publicacion }[] = [];
  edits: Publicacion[] = [];
  replies: { messageId: string; p: Publicacion }[] = [];
  reactions: { messageId: string; emoji: string }[] = [];
  weekly: string[] = [];
  roles: [string, string | null][] = [];
  ultimo: { channelId: string; at: number } | null = null;
  async ultimoPapu() {
    return this.ultimo;
  }
  async publicar(bot: BotId, channelId: string, p: Publicacion) {
    this.posts.push({ bot, channelId, p });
    return `msg${this.posts.length}`;
  }
  async editar(_b: BotId, _c: string, _m: string, p: Publicacion) {
    this.edits.push(p);
  }
  async responder(_b: BotId, _c: string, messageId: string, p: Publicacion) {
    this.replies.push({ messageId, p });
  }
  async reaccionar(_b: BotId, _c: string, messageId: string, emoji: string) {
    this.reactions.push({ messageId, emoji });
  }
  async semanal(content: string) {
    this.weekly.push(content);
  }
  async sabelotodo(nuevo: string, anterior: string | null) {
    this.roles.push([nuevo, anterior]);
    return true;
  }
}

const RIDDLE: Adivinanza = { c: "general", t: "Tengo agujas y no coso. ¿Qué soy?", r: ["reloj", "relojes"], p: "Marca la hora" };

function setup(over: (s: AdivinanzasSettings) => void = () => {}) {
  const s = structuredClone(settings);
  s.dorada.cada = 1e9; // nunca dorada salvo que se pida
  over(s);
  const db = memDb();
  const port = new FakePort();
  let now = VIE_15H;
  const pagos: [string, number][] = [];
  const png = async () => Buffer.from("png");
  const svc = new AdivinanzasService({
    db,
    settings: s,
    banco: [RIDDLE],
    frases: banco.frases,
    decks: new DeckStore(db, seededRng(7)),
    port,
    render: { adivinanza: png, ganador: png, nadie: png },
    pagar: (u, n) => void pagos.push([u, n]),
    active: () => ["teto", "miku"],
    names: Object.fromEntries(BOT_IDS.map((b) => [b, b])) as Record<BotId, string>,
    colors: Object.fromEntries(BOT_IDS.map((b) => [b, "#ff0000"])) as Record<BotId, string>,
    avatar: () => null,
    now: () => now,
    rng: seededRng(3),
  });
  return { svc, port, pagos, db, advance: (ms: number) => (now += ms), at: () => now };
}

const msg = (text: string, authorId = "u1", repliedTo: string | null = null) => ({ channelId: "gen", messageId: `m${Math.random()}`, authorId, authorName: `Papu ${authorId}`, text, repliedTo });

describe("¡Adivina, Papu! (servicio)", () => {
  it("el que acierta cobra el pozo según el tiempo y la adivinanza se cierra", async () => {
    const { svc, port, pagos, advance } = setup();
    await svc.soltar({ channelId: "gen" });
    expect(port.posts).toHaveLength(1);
    expect(port.posts[0]!.p.aviso).toBe(true);
    advance(7_500);
    expect(await svc.onMessage(msg("creo que es un reloj"))).toBe(true);
    expect(pagos).toEqual([["u1", 100]]);
    expect(svc.abierta()).toBeNull();
    expect(port.replies).toHaveLength(1);
    // Ya cerrada: el siguiente mensaje es charla normal.
    expect(await svc.onMessage(msg("reloj", "u2"))).toBe(false);
  });

  it("tardar paga más: 150 desde los 15 s", async () => {
    const { svc, pagos, advance } = setup();
    await svc.soltar({ channelId: "gen" });
    advance(22_000);
    await svc.onMessage(msg("reloj"));
    expect(pagos[0]![1]).toBe(150);
  });

  it("fallos: ❌ y máximo 3 intentos por Papu; la charla larga no cuenta", async () => {
    const { svc, port, pagos } = setup();
    await svc.soltar({ channelId: "gen" });
    expect(await svc.onMessage(msg("hoy fui al cine con mis amigos y estuvo muy bueno todo eso"))).toBe(false);
    for (const t of ["brújula", "termómetro", "balanza"]) expect(await svc.onMessage(msg(t))).toBe(true);
    expect(port.reactions.map((r) => r.emoji)).toEqual(["❌", "❌", "❌"]);
    expect(await svc.onMessage(msg("reloj"))).toBe(false); // sin intentos: no cuenta
    expect(pagos).toHaveLength(0);
    expect(await svc.onMessage(msg("reloj", "u2"))).toBe(true);
    expect(pagos[0]![0]).toBe("u2");
  });

  it("en otro canal no cuenta", async () => {
    const { svc, pagos } = setup();
    await svc.soltar({ channelId: "gen" });
    expect(await svc.onMessage({ ...msg("reloj"), channelId: "otro" })).toBe(false);
    expect(pagos).toHaveLength(0);
  });

  it("a los 30 s se revela, sin premio, y la siguiente trae bote", async () => {
    const { svc, port, pagos, advance } = setup();
    await svc.soltar({ channelId: "gen" });
    advance(31_000);
    await svc.tick();
    expect(svc.abierta()).toBeNull();
    expect(port.replies[0]!.p.content).toContain("reloj");
    expect(svc.bote()).toBe(50);
    await svc.soltar({ channelId: "gen" });
    expect(svc.bote()).toBe(0);
    await svc.onMessage(msg("reloj"));
    expect(pagos[0]![1]).toBe(50 + 50);
  });

  it("el bote no pasa del tope", async () => {
    const { svc, advance } = setup();
    for (let i = 0; i < 5; i++) {
      await svc.soltar({ channelId: "gen" });
      advance(31_000);
      await svc.tick();
    }
    expect(svc.bote()).toBe(settings.bote.max);
  });

  it("dorada: pozo ×2", async () => {
    const { svc, pagos, advance } = setup();
    await svc.soltar({ channelId: "gen", dorada: true });
    advance(15_000);
    await svc.onMessage(msg("reloj"));
    expect(pagos[0]![1]).toBe(300);
  });

  it("máximo de premios al día por Papu: acierta pero deja la adivinanza a los demás", async () => {
    const { svc, port, pagos } = setup((s) => (s.maxPremiosDia = 1));
    await svc.soltar({ channelId: "gen" });
    await svc.onMessage(msg("reloj"));
    await svc.soltar({ channelId: "gen" });
    expect(await svc.onMessage(msg("reloj"))).toBe(true);
    expect(port.reactions.at(-1)!.emoji).toBe("🔒");
    expect(svc.abierta()).not.toBeNull();
    await svc.onMessage(msg("reloj", "u2"));
    expect(pagos.map((p) => p[0])).toEqual(["u1", "u2"]);
  });

  it("redibuja el banner cada 5 s mientras corre", async () => {
    const { svc, port, advance } = setup();
    await svc.soltar({ channelId: "gen" });
    for (let i = 0; i < 8; i++) {
      advance(2_000);
      await svc.tick();
    }
    // 16 s: etapas de 5, 10 y 15 s (con las dos pistas).
    expect(port.edits).toHaveLength(3);
    expect(port.edits.at(-1)!.content).toContain("150 Shaulitas");
    expect(port.edits.at(-1)!.content).toContain("💡");
  });

  it("solo sale a su hora si hay gente; sin gente se reintenta más tarde", async () => {
    const { svc, port, at, advance } = setup((s) => {
      s.porDia = { min: 6, max: 6 };
      s.desde = 0;
      s.hasta = 24;
      s.separacionMin = 1;
    });
    // Sin nadie charlando: no sale.
    port.ultimo = null;
    advance(24 * 3_600_000);
    await svc.tick();
    expect(port.posts).toHaveLength(0);
    // Con gente hace poco: sale en el canal de esa gente.
    advance(30 * 60_000);
    port.ultimo = { channelId: "gen", at: at() - 60_000 };
    await svc.tick();
    expect(port.posts).toHaveLength(1);
    expect(port.posts[0]!.channelId).toBe("gen");
  });

  it("nunca dos seguidas: la del plan espera la separación mínima desde la última", async () => {
    const { svc, port, at, advance } = setup((s) => {
      s.porDia = { min: 6, max: 6 };
      s.desde = 0;
      s.hasta = 24;
      s.separacionMin = 45;
    });
    port.ultimo = { channelId: "gen", at: at() };
    await svc.soltar({ channelId: "gen" });
    await svc.onMessage(msg("reloj"));
    // Todo el plan del día ya está atrasado, pero la última salió recién.
    advance(60_000);
    port.ultimo = { channelId: "gen", at: at() };
    await svc.tick();
    expect(port.posts).toHaveLength(1);
    advance(45 * 60_000);
    port.ultimo = { channelId: "gen", at: at() };
    await svc.tick();
    expect(port.posts).toHaveLength(2);
  });

  it("los lunes publica a los que más adivinaron y pasa el rol 🧠 Sabelotodo", async () => {
    const { svc, port, advance } = setup();
    for (const u of ["u1", "u2", "u2"]) {
      await svc.soltar({ channelId: "gen" });
      await svc.onMessage(msg("reloj", u));
    }
    // Lunes 23 nov., 12:30 en México.
    advance(Date.parse("2026-11-23T18:30:00Z") - VIE_15H);
    await svc.tick();
    expect(port.weekly).toHaveLength(1);
    expect(port.weekly[0]).toMatch(/🥇 <@u2> · 2 adivinadas/);
    expect(port.roles).toEqual([["u2", null]]);
    await svc.tick();
    expect(port.weekly).toHaveLength(1);
  });
});

describe("imágenes de ¡Adivina, Papu!", () => {
  it("dibuja los tres banners sin fallar", async () => {
    const base = { avatar: null, color: "#39C5BB" };
    const a = await bannerAdivinanza({ ...base, nombre: "Miku", categoria: CATEGORIAS.vocaloid, texto: "x ".repeat(200), pozo: 90, pozoMax: 150, bote: 50, ms: 45_000, totalMs: 120_000, marcas: { palabras: 40, tope: 60, letras: 80 }, pista: "PISTA 1: algo", dorada: false });
    const g = await bannerGanador({ ...base, papu: "Un Papu con un nombre larguísimo de verdad", respuesta: "reloj", tiempo: "1:05", premio: 150, hoy: 2, dorada: true });
    const n = await bannerNadie({ ...base, respuesta: "reloj", frase: "Nadie, nadita.", bote: 50 });
    for (const b of [a, g, n]) expect(b.subarray(1, 4).toString()).toBe("PNG");
  });
});
