import { describe, expect, it } from "vitest";
import { addDays, loadCatalog, loadCoinSettings, rollSobre, sobrePool } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { loadLevelSettings } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { BANNER_W, COL_W, fitLines, mercadoBanner } from "../src/mercado/banner";
import { abierta, aperturaDe, aperturaHoy, CONSUMIBLES, dayStart, loadMercadoSettings, openingHour, proximaApertura, vitrinaDe, type MercadoSettings } from "../src/mercado/rules";
import type { WeddingService } from "../src/bodas/service";
import { MercadoService } from "../src/mercado/service";
import { loadPeleaSettings } from "../src/peleas/rules";
import { PeleaService } from "../src/peleas/service";
import { Quota } from "../src/quota/quota";
import { loadRouletteSettings } from "../src/ruleta/rules";
import { RouletteService } from "../src/ruleta/service";
import { loadTriviaSettings, type Question } from "../src/trivia/rules";
import { TriviaService } from "../src/trivia/service";
import { dayKey } from "../src/time";
import { createCanvas } from "@napi-rs/canvas";
import { memDb, seededRng } from "./helpers";

const TZ = "America/Santiago";
const M = loadMercadoSettings();
const NOON = Date.parse("2026-11-10T12:00:00-03:00");

const q = (id: string): Question => ({ id, kind: "opciones", topic: "t", level: "facil", text: `¿${id}?`, answer: `bien-${id}`, wrong: ["mal1", "mal2", "mal3"], accepted: [] });

/** Todo conectado como en src/main.ts, con un reloj que se puede mover. */
function setup(questions: Question[] = ["a", "b", "c", "d", "e", "f"].map(q)) {
  const db = memDb();
  let now = NOON;
  const clock = () => now;
  const levels = new LevelService({ db, settings: loadLevelSettings(), timeZone: TZ });
  const quota = new Quota(db, (id, d) => levels.limitFor(id, d), TZ);
  const roulette = new RouletteService({ db, settings: loadRouletteSettings(), levels, quota, timeZone: TZ, now: clock, rnd: seededRng(3) });
  const coins = new CoinService({
    db,
    settings: loadCoinSettings(),
    catalog: loadCatalog(),
    timeZone: TZ,
    now: clock,
    missions: (st, userId, day) => {
      const list = roulette.missionsFor(userId, day, st);
      return { done: list.filter((m) => m.done).length, total: list.length };
    },
  });
  const trivia = new TriviaService({ db, settings: loadTriviaSettings(), questions, levels, timeZone: TZ, now: clock, rnd: seededRng(5) });
  // Adivinanza de boda abierta de mentira (para el Sake de Haku).
  let riddle: { messageId: string; respuesta: string } | null = null;
  const weddings = {
    active: () => (riddle ? { messageId: riddle.messageId } : null),
    riddleOf: () => ({ respuestas: [riddle!.respuesta] }),
  } as unknown as WeddingService;
  // Aquí la vitrina muestra todo (para comprar cualquier objeto); la rotación de 5 se prueba aparte.
  const mercado = new MercadoService({ db, settings: { ...M, vitrina: M.objetos.length }, coins, quota, roulette, trivia, weddings, timeZone: TZ, now: clock });
  const atun = mercado.byEfecto("atun")!;
  const bag = mercado.byEfecto("baguette")!;
  roulette.useAtun({ giros: atun.giros!, ...mercado.port("atun") });
  coins.useHelado({ extra: mercado.byEfecto("helado")!.extra!, ...mercado.port("helado") });
  const pset = loadPeleaSettings();
  const peleas = new PeleaService({ db, settings: { ...pset, apuestas: { ...pset.apuestas, simulaciones: 200 } }, coins, now: clock, rnd: seededRng(9) });
  peleas.useSeguro({ ...mercado.port("seguro"), devolver: (id) => mercado.devolver(id, "seguro") });
  trivia.useConsumables({
    baguette: { vidas: bag.vidas!, espera: bag.espera!, ...mercado.port("baguette") },
    celular: mercado.port("celular"),
    guitarra: mercado.port("guitarra"),
    zanahoria: mercado.port("zanahoria"),
  });
  roulette.useDisquete((id) => mercado.tieneEfecto(id, "disquete"));
  levels.quotaBoost = (id, at) => mercado.quotaBoost(id, at);
  return {
    db,
    levels,
    quota,
    roulette,
    coins,
    trivia,
    mercado,
    peleas,
    setRiddle: (r: typeof riddle) => (riddle = r),
    later: (ms: number) => (now += ms),
    at: (t: number) => (now = t),
    /** Mensajes que dan XP (cada uno 3 s despues y distinto). */
    voice: (userId: string, minutes: number) => {
      for (let i = 0; i < minutes; i++) levels.onVoiceMinute([[{ id: userId, muted: false }, { id: "otro", muted: false }]], (now += 60_000));
    },
    talk: (userId: string, n: number) => {
      for (let i = 0; i < n; i++) levels.onMessage(userId, `mensaje numero ${i} de prueba ${now}`, (now += 3000));
    },
    /** Compra en el mercado (abierto a la fuerza) con monedas ganadas regaladas para eso. */
    give: (userId: string, objetoId: string) => {
      mercado.abrirAhora(60, now);
      coins.adjust(userId, "ganadas", mercado.byId.get(objetoId)!.precio, "prueba");
      const r = mercado.comprar(userId, objetoId, now);
      if (!r.ok) throw new Error(r.motivo);
      return r;
    },
  };
}

describe("config del mercado negro", () => {
  it("trae el Atún, la Baguette, el Celular, el PC, el rol pirata y los adornos de burla", () => {
    const ids = M.objetos.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(["atun-luka", "baguette-teto", "celular-neru", "pc-adachi-rei", "triple-baka-pirata", "insignia-ban-shaula", "titulo-caos", "titulo-lucho"]));
    expect(M.objetos.find((o) => o.id === "atun-luka")).toMatchObject({ usos: 3, giros: 2 });
    expect(M.objetos.find((o) => o.id === "baguette-teto")).toMatchObject({ usos: 5, vidas: 2 });
    expect(M.objetos.find((o) => o.id === "pc-adachi-rei")).toMatchObject({ usos: 3 });
    expect(M.objetos.find((o) => o.id === "triple-baka-pirata")!.precio).toBe(1_000_000);
  });

  it("el PC es el consumible más caro, y todo cuesta más que el mejor día con apuestas (~1.000)", () => {
    const consumibles = M.objetos.filter((o) => CONSUMIBLES.includes(o.efecto));
    const pc = consumibles.find((o) => o.efecto === "pc")!;
    for (const o of consumibles) if (o !== pc) expect(o.precio, o.id).toBeLessThan(pc.precio);
    for (const o of M.objetos) expect(o.precio, o.id).toBeGreaterThan(1000);
  });

  it("los adornos de burla son de contrabando: nunca en vitrinas, sobres ni para fabricar", () => {
    const db = memDb();
    const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: TZ });
    for (const o of M.objetos.filter((x) => x.efecto === "objeto")) {
      const obj = coins.byId.get(o.objeto!)!;
      expect(obj.rareza, o.id).toBe("contrabando");
      expect(coins.schedule.some((v) => v.objetos.includes(obj.id)), o.id).toBe(false);
      expect(coins.craft("u", obj.id).ok, o.id).toBe(false);
    }
  });
});

describe("horario del mercado negro", () => {
  it("abre una vez al día, a una hora en punto dentro de la ventana, y siempre la misma para ese día", () => {
    const hours = new Set<number>();
    for (let i = 0; i < 90; i++) {
      const day = dayKey(new Date(NOON + i * 86_400_000), M.zona);
      const h = openingHour(M, day);
      expect(h).toBeGreaterThanOrEqual(M.horario.desde);
      expect(h).toBeLessThan(M.horario.hasta);
      expect(openingHour(M, day)).toBe(h);
      hours.add(h);
      const a = aperturaDe(M, day);
      const local = new Intl.DateTimeFormat("en-GB", { timeZone: M.zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(a.abre));
      expect(local).toBe(`${String(h).padStart(2, "0")}:00`);
      expect(a.cierra - a.abre).toBe(M.horario.minutos * 60_000);
    }
    // Es sorpresa: no sale siempre a la misma hora.
    expect(hours.size).toBeGreaterThan(5);
  });

  it("el día empieza a medianoche de la zona", () => {
    const t = dayStart("2026-11-10", "America/Mexico_City");
    expect(new Date(t).toISOString()).toBe("2026-11-10T06:00:00.000Z");
  });

  it("abierto solo durante su hora; al cerrar, la próxima es la de mañana", () => {
    const hoy = aperturaHoy(M, NOON);
    expect(abierta(hoy, hoy.abre - 1)).toBe(false);
    expect(abierta(hoy, hoy.abre)).toBe(true);
    expect(abierta(hoy, hoy.cierra - 1)).toBe(true);
    expect(abierta(hoy, hoy.cierra)).toBe(false);
    expect(proximaApertura(M, hoy.abre - 1)).toEqual(hoy);
    const manana = proximaApertura(M, hoy.cierra);
    expect(manana.day > hoy.day).toBe(true);
    expect(manana.abre).toBeGreaterThan(hoy.cierra);
  });

  it("GyroP puede abrirlo a mano por un rato", () => {
    const s = setup();
    const hoy = aperturaHoy(M, NOON);
    const fuera = hoy.abre - 3 * 3_600_000 > dayStart(hoy.day, M.zona) ? hoy.abre - 3 * 3_600_000 : hoy.cierra + 3_600_000;
    s.at(fuera);
    expect(s.mercado.estado().abierto).toBe(false);
    s.mercado.abrirAhora(10);
    expect(s.mercado.estado().abierto).toBe(true);
    s.later(10 * 60_000);
    expect(s.mercado.estado().abierto).toBe(false);
  });

  it("apagado en la config, nunca abre", () => {
    const off: MercadoSettings = { ...M, activo: false };
    const s = setup();
    const m = new MercadoService({ db: s.db, settings: off, coins: s.coins, quota: s.quota, timeZone: TZ });
    expect(m.estado(aperturaHoy(M, NOON).abre).abierto).toBe(false);
  });
});

describe("compras del mercado negro", () => {
  it("cerrado no vende", () => {
    const s = setup();
    s.coins.adjust("u", "ganadas", 100_000, "prueba");
    const hoy = aperturaHoy(M, NOON);
    expect(s.mercado.comprar("u", "atun-luka", hoy.cierra + 1)).toEqual({ ok: false, motivo: "cerrado" });
  });

  it("solo con monedas ganadas: las compradas no alcanzan", () => {
    const s = setup();
    s.mercado.abrirAhora();
    s.coins.adjust("u", "compradas", 100_000, "prueba");
    expect(s.mercado.comprar("u", "atun-luka")).toEqual({ ok: false, motivo: "no_alcanza" });
    expect(s.coins.wallet("u").compradas).toBe(100_000);
    s.coins.adjust("u", "ganadas", 7500, "prueba");
    const r = s.mercado.comprar("u", "atun-luka");
    expect(r.ok).toBe(true);
    expect(s.coins.wallet("u")).toMatchObject({ ganadas: 0, compradas: 100_000 });
  });

  it("los consumibles suman sus usos; se ven en el inventario", () => {
    const s = setup();
    expect(s.give("u", "atun-luka").usos).toBe(3);
    expect(s.give("u", "atun-luka").usos).toBe(6);
    s.give("u", "pc-adachi-rei");
    expect(s.mercado.inventario("u").map((c) => [c.objeto.id, c.usos])).toEqual([
      ["atun-luka", 6],
      ["pc-adachi-rei", 3],
    ]);
  });

  it("los adornos van a la colección y no se compran dos veces", () => {
    const s = setup();
    s.give("u", "insignia-ban-shaula");
    expect(s.coins.owned("u").has("insignia-ban-shaula")).toBe(true);
    s.coins.adjust("u", "ganadas", 10_000, "prueba");
    expect(s.mercado.comprar("u", "insignia-ban-shaula")).toEqual({ ok: false, motivo: "ya_lo_tienes" });
    expect(s.coins.equip("u", "insignia", ["insignia-ban-shaula"]).ok).toBe(true);
  });

  it("el rol pirata se compra una vez y Discord lo pone", () => {
    const s = setup();
    const r = s.give("u", "triple-baka-pirata");
    expect(r.rol).toBe("🏴‍☠️ Triple Baka Pirata");
    s.coins.adjust("u", "ganadas", 1_000_000, "prueba");
    expect(s.mercado.comprar("u", "triple-baka-pirata")).toEqual({ ok: false, motivo: "ya_lo_tienes" });
  });

  it("gastar un uso; sin usos, no", () => {
    const s = setup();
    s.give("u", "celular-neru");
    for (let i = 0; i < 10; i++) expect(s.mercado.consume("u", "celular")).toBe(true);
    expect(s.mercado.consume("u", "celular")).toBe(false);
    expect(s.mercado.inventario("u")).toEqual([]);
  });
});

describe("Atún de Luka en la ruleta", () => {
  it("descarta el premio y gira hasta 2 veces más, gastando un solo uso por giro", () => {
    const s = setup();
    s.talk("u", 200);
    const left = s.roulette.status("u").left;
    expect(left).toBeGreaterThanOrEqual(1);
    s.give("u", "atun-luka");
    const p = s.roulette.draw("u")!;
    expect(p).toMatchObject({ giros: 0, atun: false });
    // Volver a sortear devuelve el mismo giro (no sirve para cambiarlo).
    expect(s.roulette.draw("u")).toEqual(p);
    expect(s.roulette.reroll("u")).toMatchObject({ ok: true, pending: { giros: 1, atun: true } });
    expect(s.mercado.usosDe("u", "atun")).toBe(2);
    expect(s.roulette.reroll("u")).toMatchObject({ ok: true, pending: { giros: 2 } });
    expect(s.mercado.usosDe("u", "atun")).toBe(2);
    expect(s.roulette.reroll("u")).toEqual({ ok: false, motivo: "sin_giros" });
    const final = s.roulette.pending("u")!.index;
    const res = s.roulette.claim("u")!;
    expect(res.index).toBe(final);
    expect(res.left).toBe(left - 1);
    expect(s.roulette.pending("u")).toBeNull();
    // El siguiente giro es otro: el Atún gasta otro uso.
    if (left > 1) {
      s.roulette.draw("u");
      s.roulette.reroll("u");
      expect(s.mercado.usosDe("u", "atun")).toBe(1);
    }
  });

  it("sin Atún no se puede volver a girar; girar normal aplica el giro pendiente", () => {
    const s = setup();
    s.talk("u", 200);
    const left = s.roulette.status("u").left;
    const p = s.roulette.draw("u")!;
    expect(s.roulette.reroll("u")).toEqual({ ok: false, motivo: "sin_atun" });
    expect(s.roulette.spin("u")!.index).toBe(p.index);
    expect(s.roulette.status("u").left).toBe(left - 1);
  });
});

describe("Baguette de Teto en la trivia", () => {
  const wrong = (t: TriviaService, user: string) => {
    const sh = t.active(user)!;
    return t.answerOption(user, sh.nonce, (sh.correct + 1) % 4);
  };
  const right = (t: TriviaService, user: string) => {
    const sh = t.active(user)!;
    return t.answerOption(user, sh.nonce, sh.correct);
  };

  it("sin Baguette, fallar termina la partida", () => {
    const s = setup();
    s.trivia.start("u", "c", "facil");
    expect(wrong(s.trivia, "u").kind).toBe("fallo");
  });

  it("sigue la partida con la racha hasta 2 veces, gastando un solo uso; la tercera vez termina", () => {
    const s = setup();
    s.give("u", "baguette-teto");
    s.trivia.start("u", "c", "facil");
    right(s.trivia, "u");
    const f1 = wrong(s.trivia, "u");
    expect(f1).toMatchObject({ kind: "salvable", vidas: 2, gasta: true, streak: 1, usos: 5 });
    if (f1.kind !== "salvable") throw new Error();
    // En pausa no se puede contestar.
    expect(s.trivia.answerOption("u", s.trivia.active("u")!.nonce, 0).kind).toBe("vieja");
    const r1 = s.trivia.revive("u", f1.nonce);
    expect(r1).toMatchObject({ kind: "sigue", vidas: 1, gasto: true });
    expect(s.mercado.usosDe("u", "baguette")).toBe(4);
    expect(s.trivia.active("u")!.streak).toBe(1);
    right(s.trivia, "u");
    const f2 = wrong(s.trivia, "u");
    expect(f2).toMatchObject({ kind: "salvable", vidas: 1, gasta: false, streak: 2 });
    if (f2.kind !== "salvable") throw new Error();
    expect(s.trivia.revive("u", f2.nonce)).toMatchObject({ kind: "sigue", vidas: 0, gasto: false });
    expect(s.mercado.usosDe("u", "baguette")).toBe(4);
    const f3 = wrong(s.trivia, "u");
    expect(f3.kind).toBe("fallo");
    if (f3.kind === "fallo") expect(f3.end.streak).toBe(2);
  });

  it("cada partida distinta gasta un uso; a las 5 se acaba", () => {
    const s = setup();
    s.give("u", "baguette-teto");
    for (let i = 0; i < 5; i++) {
      s.trivia.start("u", "c", "facil");
      const f = wrong(s.trivia, "u");
      if (f.kind !== "salvable") throw new Error(`partida ${i}: ${f.kind}`);
      s.trivia.revive("u", f.nonce);
      const g = wrong(s.trivia, "u");
      if (g.kind === "salvable") s.trivia.giveUp("u", g.nonce);
    }
    expect(s.mercado.usosDe("u", "baguette")).toBe(0);
    s.trivia.start("u", "c", "facil");
    expect(wrong(s.trivia, "u").kind).toBe("fallo");
  });

  it("si no decide a tiempo (o elige terminar), la partida termina como siempre", () => {
    const s = setup();
    s.give("u", "baguette-teto");
    s.trivia.start("u", "c", "facil");
    const f = wrong(s.trivia, "u");
    if (f.kind !== "salvable") throw new Error();
    expect(s.trivia.timeout("u", f.nonce)).toBeNull();
    s.later(M.objetos.find((o) => o.efecto === "baguette")!.espera! * 1000);
    expect(s.trivia.timeout("u", f.nonce)?.kind).toBe("fallo");
    expect(s.trivia.active("u")).toBeNull();
    expect(s.mercado.usosDe("u", "baguette")).toBe(5);
    s.trivia.start("u", "c", "facil");
    const g = wrong(s.trivia, "u");
    if (g.kind !== "salvable") throw new Error();
    expect(s.trivia.giveUp("u", g.nonce).kind).toBe("fallo");
    expect(s.mercado.usosDe("u", "baguette")).toBe(5);
  });

  it("también sirve si se acaba el tiempo de la pregunta", () => {
    const s = setup();
    s.give("u", "baguette-teto");
    const { shown } = s.trivia.start("u", "c", "facil");
    s.later(shown.deadline - NOON + 1);
    expect(s.trivia.timeout("u", shown.nonce)).toMatchObject({ kind: "salvable", reason: "tiempo" });
  });
});

describe("Celular de Neru en la trivia", () => {
  it("borra dos opciones incorrectas (nunca la correcta), una vez por pregunta", () => {
    const s = setup();
    s.give("u", "celular-neru");
    const { shown } = s.trivia.start("u", "c", "facil");
    const r = s.trivia.fiftyFifty("u", shown.nonce);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.shown.hidden).toHaveLength(2);
    expect(r.shown.hidden).not.toContain(r.shown.correct);
    expect(s.trivia.fiftyFifty("u", shown.nonce)).toEqual({ ok: false, motivo: "no_aplica" });
    expect(s.mercado.usosDe("u", "celular")).toBe(9);
  });

  it("sin usos no hace nada", () => {
    const s = setup();
    const { shown } = s.trivia.start("u", "c", "facil");
    expect(s.trivia.fiftyFifty("u", shown.nonce)).toEqual({ ok: false, motivo: "sin_usos" });
    expect(s.trivia.active("u")!.hidden).toBeUndefined();
  });
});

describe("PC de Adachi Rei", () => {
  it("reinicia la cuota, la ruleta, la trivia y el tope de monedas sin quitar lo ganado", () => {
    const qs = Array.from({ length: 40 }, (_, i) => q(`p${i}`));
    const s = setup(qs);
    const lim = s.trivia.settings.limites.partidasConXp;
    // Un día lleno: 200 mensajes (misión cumplida y tope de monedas), la tirada usada, cuota gastada y todas las partidas con XP.
    s.talk("u", 200);
    let tiradas = 0;
    while (s.roulette.spin("u")) tiradas++;
    expect(tiradas).toBeGreaterThanOrEqual(1);
    expect(s.roulette.status("u").left).toBe(0);
    s.quota.reserve("u", 3, new Date(s.later(0)));
    for (let i = 0; i < lim; i++) {
      s.trivia.start("u", "c", "facil");
      const sh = s.trivia.active("u")!;
      s.trivia.answerOption("u", sh.nonce, (sh.correct + 1) % 4);
    }
    expect(s.trivia.start("u", "c", "facil").info.withXp).toBe(false);
    s.trivia.answerOption("u", s.trivia.active("u")!.nonce, 9);
    s.coins.sync("u", 1);
    const tope = loadCoinSettings().ganar.topeActividad;
    const ganadasAntes = s.coins.wallet("u").ganadas;
    const xpAntes = s.levels.store.get("u").xp;

    s.give("u", "pc-adachi-rei");
    const r = s.mercado.usarPc("u")!;
    expect(r).toMatchObject({ mensajes: 3, tiradas, partidas: lim + 1, monedas: tope, usos: 2 });
    expect(s.quota.used("u", new Date(s.later(0)))).toBe(0);
    expect(s.roulette.status("u").left).toBe(tiradas);
    expect(s.trivia.start("u", "c", "facil").info).toMatchObject({ run: 1, withXp: true });
    // No pierde nada: ni XP, ni monedas.
    expect(s.levels.store.get("u").xp).toBeGreaterThanOrEqual(xpAntes);
    expect(s.coins.wallet("u").ganadas).toBe(ganadasAntes);
    // El tope de monedas por actividad vuelve a empezar: con 200 mensajes más, gana otro tope completo.
    s.trivia.answerOption("u", s.trivia.active("u")!.nonce, 9);
    s.talk("u", 200);
    s.coins.sync("u", 1);
    expect(s.coins.activityToday("u").actividad).toBe(2 * tope);
  });

  it("sin usos no hace nada", () => {
    const s = setup();
    expect(s.mercado.usarPc("u")).toBeNull();
  });
});

describe("Seguro de Gakupo en el 1vs1", () => {
  it("si su Vocaloid pierde, le devuelve toda la apuesta; quien gana cobra igual", () => {
    const s = setup();
    s.give("a", "seguro-gakupo");
    s.give("b", "seguro-gakupo");
    s.coins.adjust("a", "ganadas", 400, "prueba");
    s.coins.adjust("b", "ganadas", 400, "prueba");
    const p = s.peleas.open("neru", "teto", "canal")!;
    expect(s.peleas.insure(p.id, "a").ok).toBe(false); // primero apostar
    s.peleas.bet(p.id, "a", "neru", 300);
    s.peleas.bet(p.id, "b", "teto", 300);
    expect(s.peleas.insure(p.id, "a")).toEqual({ ok: true, usos: 4 });
    expect(s.peleas.insure(p.id, "a").ok).toBe(false); // una vez por pelea
    s.peleas.insure(p.id, "b");
    s.peleas.bet(p.id, "a", "neru", 100); // lo que sume despues tambien queda cubierto
    s.later(p.cierraAt - Date.now() + 1);
    s.peleas.fight(p.id);
    const liq = s.peleas.settle(p.id)!;
    const perdedor = liq.perdedores[0]!;
    expect(perdedor.seguro).toBe(true);
    expect(perdedor.pago).toBe(perdedor.cantidad);
    // El perdedor queda como estaba antes de apostar.
    expect(s.coins.wallet(perdedor.userId).ganadas).toBe(400);
    expect(s.coins.wallet(liq.ganadores[0]!.userId).ganadas).toBeGreaterThan(400);
  });

  it("si la pelea se cancela, vuelve la apuesta y también el uso del seguro", () => {
    const s = setup();
    s.give("a", "seguro-gakupo");
    s.coins.adjust("a", "ganadas", 100, "prueba");
    const p = s.peleas.open("neru", "teto", "canal")!;
    s.peleas.bet(p.id, "a", "neru", 100);
    s.peleas.insure(p.id, "a");
    expect(s.mercado.usosDe("a", "seguro")).toBe(4);
    s.peleas.cancel();
    expect(s.mercado.usosDe("a", "seguro")).toBe(5);
    expect(s.coins.wallet("a").ganadas).toBe(100);
  });
});

describe("Helado de Kaito en los sobres", () => {
  it("el sobre trae un objeto más (con el mismo azar)", () => {
    const S = loadCoinSettings();
    const pool = sobrePool(loadCatalog(), S.temporada.id, "2026-11-10");
    const pity = { sinEpica: 0, sinLegendaria: 0 };
    for (const tipo of ["comun", "raro", "legendario"] as const) {
      const base = rollSobre(S, pool, pity, seededRng(4), tipo).objetos.length;
      expect(rollSobre(S, pool, pity, seededRng(4), tipo, 1).objetos.length, tipo).toBe(base + 1);
    }
  });

  it("se usa solo al abrir un sobre y se gasta", () => {
    const s = setup();
    s.give("u", "helado-kaito");
    s.coins.giveSobres("u", "legendario", 2);
    const r = s.coins.openSobre("u", true, "legendario");
    if (!("objetos" in r)) throw new Error(r.motivo);
    expect(r.helado).toBe(1);
    expect(r.objetos).toHaveLength(6);
    expect(s.mercado.usosDe("u", "helado")).toBe(2);
  });
});

describe("Micrófono de Meiko en la ruleta", () => {
  it("por un día, la misión de voz pide 1 h (también para las monedas por misión)", () => {
    const s = setup();
    s.voice("u", 60);
    expect(s.roulette.status("u").missions.find((m) => m.id === "voz")!.done).toBe(false);
    s.give("u", "microfono-meiko");
    expect(s.mercado.activarMicrofono("u")).toEqual({ ok: true, minutos: 60, usos: 4 });
    expect(s.mercado.activarMicrofono("u")).toEqual({ ok: false, motivo: "ya_activo" });
    const st = s.roulette.status("u");
    expect(st.vozReducida).toBe(true);
    expect(st.missions.find((m) => m.id === "voz")!.done).toBe(true);
    // Al día siguiente vuelve a pedir 2 h.
    s.later(86_400_000);
    expect(s.roulette.status("u").vozReducida).toBe(false);
  });
});

describe("Naranja y plátano de Rin y Len", () => {
  it("regala una tirada de hoy a otro Papu", () => {
    const s = setup();
    s.give("u", "regalo-rin-len");
    expect(s.roulette.status("v").left).toBe(0);
    expect(s.mercado.regalarTirada("u", "u")).toEqual({ ok: false, motivo: "a_ti" });
    expect(s.mercado.regalarTirada("u", "v")).toEqual({ ok: true, usos: 2 });
    expect(s.roulette.status("v")).toMatchObject({ left: 1, regaladas: 1 });
    expect(s.roulette.spin("v")).not.toBeNull();
    expect(s.roulette.status("v").left).toBe(0);
  });

  it("sin usos no regala", () => {
    const s = setup();
    expect(s.mercado.regalarTirada("u", "v")).toEqual({ ok: false, motivo: "sin_usos" });
  });
});

describe("Luna de IA", () => {
  it("por 2 semanas, los mensajes que contesta un Vocaloid dan el triple de XP", () => {
    const s = setup();
    const mult = loadLevelSettings().multiplicadorBots;
    const xp = () => s.levels.store.get("u").xp;
    let before = xp();
    s.levels.onBotReply("u", 100, s.later(0));
    const normal = xp() - before;
    expect(normal).toBe(Math.round(100 * (mult - 1)));
    s.give("u", "luna-ia");
    const r = s.mercado.activarLuna("u");
    expect(r.ok).toBe(true);
    expect(s.mercado.activarLuna("u")).toEqual({ ok: false, motivo: "ya_activa" });
    before = xp();
    s.levels.onBotReply("u", 100, s.later(0));
    expect(xp() - before).toBe(Math.round(100 * (mult * 3 - 1)));
    s.later(14 * 86_400_000);
    expect(s.mercado.quotaBoost("u")).toBe(1);
  });
});

describe("Sake de Haku", () => {
  it("da la forma de la respuesta de la adivinanza abierta, un uso por adivinanza", () => {
    const s = setup();
    s.give("u", "sake-haku");
    expect(s.mercado.sake("u")).toEqual({ ok: false, motivo: "sin_adivinanza" });
    s.setRiddle({ messageId: "m1", respuesta: "Ievan Polkka" });
    expect(s.mercado.sake("u")).toEqual({ ok: true, pista: "▢▢▢▢▢   ▢▢▢▢▢▢", palabras: 2, letras: 11, usos: 4, gasto: true });
    expect(s.mercado.sake("u")).toMatchObject({ ok: true, usos: 4, gasto: false });
    s.setRiddle({ messageId: "m2", respuesta: "puerro" });
    expect(s.mercado.sake("u")).toMatchObject({ ok: true, pista: "▢▢▢▢▢▢", usos: 3 });
  });
});

describe("Zanahoria de Gumi y Guitarra de flower en la trivia", () => {
  const tq = (id: string, topic: string): Question => ({ ...q(id), topic });

  it("la Zanahoria pone una pregunta del tema elegido como la siguiente", () => {
    const s = setup([tq("a1", "canciones"), tq("a2", "canciones"), tq("a3", "canciones"), tq("b1", "emojis")]);
    s.give("u", "zanahoria-gumi");
    const { shown } = s.trivia.start("u", "c", "facil");
    if (shown.question.topic === "emojis") return; // sin otro tema que elegir después
    expect(s.trivia.topics("u").map((t) => t.topic)).toContain("emojis");
    expect(s.trivia.carrot("u", shown.nonce, "emojis").ok).toBe(true);
    expect(s.trivia.extras("u").carrot).toBe("emojis");
    expect(s.trivia.carrot("u", shown.nonce, "canciones")).toEqual({ ok: false, motivo: "no_aplica" });
    const r = s.trivia.answerOption("u", shown.nonce, shown.correct);
    if (r.kind !== "acierto") throw new Error(r.kind);
    expect(r.next!.question.topic).toBe("emojis");
    expect(s.mercado.usosDe("u", "zanahoria")).toBe(9);
  });

  it("la Guitarra dobla la XP de los aciertos de esa partida (una vez por partida)", () => {
    const s = setup();
    const play = (user: string, guitar: boolean) => {
      const { shown } = s.trivia.start(user, "c", "facil");
      if (guitar) expect(s.trivia.guitar(user, shown.nonce).ok).toBe(true);
      const r = s.trivia.answerOption(user, shown.nonce, shown.correct);
      return r.kind === "acierto" ? r.xp : -1;
    };
    const normal = play("v", false);
    s.give("u", "guitarra-flower");
    expect(play("u", true)).toBe(normal * 2);
    expect(s.trivia.guitar("u", s.trivia.active("u")!.nonce)).toEqual({ ok: false, motivo: "no_aplica" });
    expect(s.mercado.usosDe("u", "guitarra")).toBe(4);
  });
});

describe("Doble helado de Kaito", () => {
  it("convierte un sobre común regalado en uno raro", () => {
    const s = setup();
    s.give("u", "doble-helado-kaito");
    expect(s.mercado.mejorarSobre("u")).toEqual({ ok: false, motivo: "sin_sobre" });
    expect(s.mercado.usosDe("u", "doblehelado")).toBe(3);
    s.coins.giveSobres("u", "comun", 1);
    expect(s.mercado.mejorarSobre("u")).toEqual({ ok: true, usos: 2 });
    expect(s.coins.wallet("u")).toMatchObject({ gratis: 0, gratisRaro: 1 });
  });
});

describe("Disquete de Adachi Rei", () => {
  it("las tiradas no usadas se guardan para los días siguientes, para siempre", () => {
    const s = setup();
    s.give("u", "disquete-adachi-rei");
    expect(s.mercado.comprar("u", "disquete-adachi-rei")).toEqual({ ok: false, motivo: "ya_lo_tienes" });
    s.talk("u", 200);
    const hoy = s.roulette.status("u").left;
    expect(hoy).toBeGreaterThanOrEqual(1);
    s.later(86_400_000);
    expect(s.roulette.status("u")).toMatchObject({ guardadas: hoy, left: hoy });
    s.roulette.spin("u");
    // Lo que le quede al final del día (el premio pudo subirlo de nivel: otra misión cumplida) pasa a mañana.
    const quedan = s.roulette.status("u").left;
    s.later(86_400_000);
    expect(s.roulette.status("u").guardadas).toBe(quedan);
  });

  it("sin Disquete, se pierden a medianoche", () => {
    const s = setup();
    s.talk("v", 200);
    s.later(86_400_000);
    expect(s.roulette.status("v")).toMatchObject({ guardadas: 0, left: 0 });
  });
});

describe("Machete de Neru", () => {
  it("machetazos de mentira para siempre, con espera entre uno y otro", () => {
    const s = setup();
    expect(s.mercado.machetazo("u")).toEqual({ ok: false, motivo: "sin_machete" });
    s.give("u", "machete-neru");
    expect(s.mercado.machetazo("u")).toEqual({ ok: true });
    expect(s.mercado.machetazo("u")).toMatchObject({ ok: false, motivo: "espera" });
    s.later(M.objetos.find((o) => o.efecto === "machete")!.espera! * 1000);
    expect(s.mercado.machetazo("u")).toEqual({ ok: true });
  });
});

describe("vitrina rotativa del mercado negro", () => {
  it("cada día salen 5 objetos distintos, siempre los mismos para ese día", () => {
    expect(M.vitrina).toBe(5);
    for (let i = 0; i < 30; i++) {
      const day = addDays("2026-11-09", i);
      const v = vitrinaDe(M, day);
      expect(v).toHaveLength(5);
      expect(new Set(v).size).toBe(5);
      expect(vitrinaDe(M, day)).toEqual(v);
    }
  });

  it("en cada ciclo de ceil(objetos / 5) días salen todos, y cambia de un día a otro", () => {
    const dias = Math.ceil(M.objetos.length / M.vitrina);
    // El ciclo empieza en un día múltiplo de `dias` desde 1970.
    const n0 = Math.ceil(Date.UTC(2026, 10, 9) / 86_400_000 / dias) * dias;
    const start = new Date(n0 * 86_400_000).toISOString().slice(0, 10);
    for (let c = 0; c < 5; c++) {
      const vistos = new Set<string>();
      for (let d = 0; d < dias; d++) for (const id of vitrinaDe(M, addDays(start, c * dias + d))) vistos.add(id);
      expect(vistos.size, `ciclo ${c}`).toBe(M.objetos.length);
    }
    expect(vitrinaDe(M, "2026-11-09")).not.toEqual(vitrinaDe(M, "2026-11-10"));
  });

  it("solo se compra lo de la vitrina de hoy", () => {
    const s = setup();
    const m = new MercadoService({ db: s.db, settings: M, coins: s.coins, quota: s.quota, timeZone: TZ, now: () => NOON });
    m.abrirAhora(60, NOON);
    s.coins.adjust("u", "ganadas", 2_000_000, "prueba");
    const hoy = m.vitrina(NOON).map((o) => o.id);
    const fuera = M.objetos.find((o) => !hoy.includes(o.id))!;
    expect(m.comprar("u", fuera.id, NOON)).toEqual({ ok: false, motivo: "no_esta" });
    expect(m.comprar("u", hoy[0]!, NOON).ok).toBe(true);
  });
});

describe("banner del mercado negro", () => {
  it("dibuja la vitrina del día (1100 px de ancho: 5 columnas iguales)", async () => {
    const items = vitrinaDe(M, "2026-11-10").map((id) => M.objetos.find((o) => o.id === id)!);
    const png = await mercadoBanner(items.map((o) => ({ emoji: o.emoji, nombre: o.nombre, precio: o.precio, detalle: o.usos ? `${o.usos} usos` : "para siempre" })));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(BANNER_W);
  });

  it("los nombres nunca se salen de su columna (se achican, parten o cortan)", () => {
    const ctx = createCanvas(10, 10).getContext("2d");
    const maxW = COL_W - 22;
    for (const o of M.objetos) {
      const r = fitLines(ctx, o.nombre, maxW, 24, 15, 2);
      ctx.font = `700 ${r.size}px sans-serif`;
      expect(r.lines.length, o.id).toBeLessThanOrEqual(2);
    }
    const largo = fitLines(ctx, "Supercalifragilisticoespialidoso".repeat(3), maxW, 24, 15, 2);
    expect(largo.lines).toHaveLength(1);
    expect(largo.lines[0]!.endsWith("…")).toBe(true);
  });
});
