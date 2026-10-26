import { describe, expect, it } from "vitest";
import { transaction } from "../src/db/database";
import { loadLevelSettings, progress } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { Quota } from "../src/quota/quota";
import { loadRouletteSettings, missions, pickPrize, prizeXp, spinsLeft, type RouletteSettings } from "../src/ruleta/rules";
import { RouletteService } from "../src/ruleta/service";
import { renderWheelGif } from "../src/ruleta/wheel";
import { memDb } from "./helpers";

const TZ = "America/Santiago";
const LS = loadLevelSettings();
const S = loadRouletteSettings();
const NOON = Date.parse("2026-10-24T12:00:00-03:00");
const idle = { vozMin: 0, mensajes: 0, subio: false, castigo: false };

/** Ruleta con todo lo necesario y un reloj que se puede mover. */
function setup(settings: RouletteSettings = S, rnd = () => 0) {
  const db = memDb();
  let now = NOON;
  const levels = new LevelService({ db, settings: LS, timeZone: TZ });
  const quota = new Quota(db, (id, d) => levels.limitFor(id, d), TZ);
  const r = new RouletteService({ db, settings, levels, quota, timeZone: TZ, now: () => now, rnd });
  const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(now));
  return {
    db,
    levels,
    quota,
    r,
    day,
    at: (t: number) => (now = t),
    /** Mensajes que dan XP (cada uno 3 s despues y distinto, como pide la espera de los niveles). */
    talk: (userId: string, n: number) => {
      for (let i = 0; i < n; i++) levels.onMessage(userId, `mensaje numero ${i} de prueba`, (now += 3000));
    },
    voice: (userId: string, minutes: number) => {
      for (let i = 0; i < minutes; i++) levels.onVoiceMinute([[{ id: userId, muted: false }, { id: "otro", muted: false }]], (now += 60_000));
    },
  };
}

describe("reglas de la ruleta", () => {
  it("la config trae premios validos de XP y de cuota", () => {
    expect(S.premios.length).toBeGreaterThanOrEqual(2);
    expect(S.premios.some((p) => p.tipo === "xp")).toBe(true);
    expect(S.premios.some((p) => p.tipo === "cuota")).toBe(true);
  });

  it("una tirada por mision cumplida, menos las usadas", () => {
    const done = { vozMin: S.misiones.vozMinutos, mensajes: S.misiones.mensajes, subio: true, castigo: false };
    expect(missions(S, idle).every((m) => !m.done)).toBe(true);
    expect(spinsLeft(S, idle, 0)).toBe(0);
    expect(spinsLeft(S, { ...idle, mensajes: S.misiones.mensajes }, 0)).toBe(1);
    expect(spinsLeft(S, done, 0)).toBe(3);
    expect(spinsLeft(S, done, 2)).toBe(1);
    expect(spinsLeft(S, done, 3)).toBe(0);
  });

  it("un strike del dia bloquea la ruleta", () => {
    const done = { vozMin: 999, mensajes: 999, subio: true, castigo: true };
    expect(spinsLeft(S, done, 0)).toBe(0);
    expect(spinsLeft({ ...S, bloqueoPorStrike: false }, done, 0)).toBe(3);
  });

  it("el premio sale segun los pesos", () => {
    const s = { ...S, premios: [{ ...S.premios[0]!, peso: 3 }, { ...S.premios[1]!, peso: 1 }] };
    expect(pickPrize(s, () => 0)).toBe(0);
    expect(pickPrize(s, () => 0.74)).toBe(0);
    expect(pickPrize(s, () => 0.76)).toBe(1);
    expect(pickPrize(s, () => 0.9999)).toBe(1);
    const counts = [0, 0];
    let x = 0;
    for (let i = 0; i < 4000; i++) counts[pickPrize(s, () => (x = (x + 0.6180339887) % 1))]!++;
    expect(counts[0]! / 4000).toBeCloseTo(0.75, 1);
  });

  it("la XP del premio es un porcentaje del nivel actual, con minimo y multiplicador", () => {
    const xpPrize = S.premios.find((p) => p.tipo === "xp")!;
    const at1 = progress(LS, 0).needed; // nivel 1
    expect(prizeXp(S, LS, xpPrize, 0, 1)).toBe(Math.round(Math.max(S.xpMinima, xpPrize.porcentaje! * at1)));
    const big = 60_000; // nivel ~30: lejos del minimo y del maximo
    const need = progress(LS, big).needed;
    expect(progress(LS, big).level).toBeLessThan(LS.curva.maximo);
    expect(prizeXp(S, LS, xpPrize, big, 1)).toBe(Math.round(xpPrize.porcentaje! * need));
    expect(prizeXp(S, LS, xpPrize, big, 2)).toBe(Math.round(xpPrize.porcentaje! * need * 2));
  });
});

describe("servicio de la ruleta", () => {
  it("sin misiones no hay tirada", () => {
    const t = setup();
    expect(t.r.status("a").left).toBe(0);
    expect(t.r.spin("a")).toBeNull();
  });

  it("las tres misiones dan tres tiradas y no mas", () => {
    const t = setup();
    t.talk("a", S.misiones.mensajes);
    expect(t.r.status("a").missions.find((m) => m.id === "mensajes")!.done).toBe(true);
    t.voice("a", S.misiones.vozMinutos);
    expect(t.r.status("a").missions.find((m) => m.id === "voz")!.done).toBe(true);
    // 200 mensajes y 2 h de voz ya lo subieron de nivel: las tres cumplidas.
    expect(t.r.status("a").left).toBe(3);
    expect(t.r.spin("a")!.left).toBe(2);
    expect(t.r.spin("a")!.left).toBe(1);
    expect(t.r.spin("a")!.left).toBe(0);
    expect(t.r.spin("a")).toBeNull();
  });

  it("solo cuentan los mensajes que dan XP (sin repetidos ni sin espera)", () => {
    const t = setup();
    for (let i = 0; i < 50; i++) t.levels.onMessage("a", "el mismo mensaje", NOON + i * 3000);
    for (let i = 0; i < 50; i++) t.levels.onMessage("a", `rapido ${i}`, NOON + 500_000 + i * 100);
    expect(t.levels.store.dayStats("a", t.day()).mensajes).toBeLessThan(10);
  });

  it("subir de nivel cuenta una sola tirada al dia", () => {
    const t = setup();
    t.levels.bonus("a", progress(LS, 0).needed, NOON);
    t.levels.bonus("a", 100_000, NOON);
    expect(t.r.status("a").left).toBe(1);
  });

  it("al otro dia las misiones y las tiradas vuelven a cero", () => {
    const t = setup();
    t.levels.bonus("a", 100, NOON);
    t.r.spin("a");
    expect(t.r.status("a").used).toBe(1);
    t.at(NOON + 24 * 3_600_000);
    expect(t.r.status("a")).toMatchObject({ used: 0, left: 0 });
  });

  it("premio de XP: se suma y puede subir de nivel", () => {
    const t = setup(S, () => 0); // primera casilla (XP)
    expect(S.premios[0]!.tipo).toBe("xp");
    t.levels.bonus("a", progress(LS, 0).needed, NOON);
    const before = t.levels.store.get("a").xp;
    const res = t.r.spin("a")!;
    expect(res.prize.tipo).toBe("xp");
    expect(res.xp).toBeGreaterThanOrEqual(S.xpMinima);
    expect(t.levels.store.get("a").xp).toBe(before + res.xp);
  });

  it("premio de cuota: mensajes extra solo por hoy, y el reinicio de cuota no los borra", () => {
    const i = S.premios.findIndex((p) => p.tipo === "cuota");
    const total = S.premios.reduce((a, p) => a + p.peso, 0);
    const before = S.premios.slice(0, i).reduce((a, p) => a + p.peso, 0);
    const t = setup(S, () => (before + 0.5) / total);
    t.levels.bonus("a", 100, NOON);
    const limit = t.quota.remaining("a", new Date(NOON));
    const res = t.r.spin("a")!;
    expect(res.prize.tipo).toBe("cuota");
    expect(t.quota.remaining("a", new Date(NOON))).toBe(limit + res.messages);
    t.quota.reserve("a", 2, new Date(NOON));
    t.quota.reset("a", new Date(NOON));
    expect(t.quota.remaining("a", new Date(NOON))).toBe(limit + res.messages);
    expect(t.quota.remaining("a", new Date(NOON + 24 * 3_600_000))).toBe(t.quota.limitFor("a", new Date(NOON + 24 * 3_600_000)));
  });

  it("cuota llena: devuelve lo gastado hoy, o 1 extra si no habia gastado nada", () => {
    const i = S.premios.findIndex((p) => p.tipo === "cuota_llena");
    const total = S.premios.reduce((a, p) => a + p.peso, 0);
    const before = S.premios.slice(0, i).reduce((a, p) => a + p.peso, 0);
    const t = setup(S, () => (before + 0.5) / total);
    t.levels.bonus("a", 100, NOON);
    const limit = t.quota.remaining("a", new Date(NOON));
    t.quota.reserve("a", 2, new Date(NOON));
    expect(t.r.spin("a")!.messages).toBe(2);
    expect(t.quota.remaining("a", new Date(NOON))).toBe(limit);

    const u = setup(S, () => (before + 0.5) / total);
    u.levels.bonus("b", 100, NOON);
    const lim = u.quota.remaining("b", new Date(NOON));
    expect(u.r.spin("b")!.messages).toBe(1);
    expect(u.quota.remaining("b", new Date(NOON))).toBe(lim + 1);
  });

  it("un strike de Neru bloquea la ruleta ese dia", () => {
    const t = setup();
    t.levels.bonus("a", 100, NOON);
    expect(t.r.status("a").left).toBe(1);
    t.levels.onStrike("a", NOON);
    expect(t.r.status("a")).toMatchObject({ left: 0, blocked: true });
    expect(t.r.spin("a")).toBeNull();
    expect(t.r.newlyCompleted("a")).toEqual([]);
  });

  it("cada mision cumplida se avisa una sola vez", () => {
    const t = setup();
    expect(t.r.newlyCompleted("a")).toEqual([]);
    t.levels.bonus("a", 100, NOON);
    expect(t.r.newlyCompleted("a").map((m) => m.id)).toEqual(["nivel"]);
    expect(t.r.newlyCompleted("a")).toEqual([]);
    t.talk("a", S.misiones.mensajes);
    expect(t.r.newlyCompleted("a").map((m) => m.id)).toEqual(["mensajes"]);
  });

  it("las transacciones anidadas usan la de afuera (la tirada suma XP dentro de la suya)", () => {
    const db = memDb();
    db.exec("CREATE TABLE t (x INTEGER)");
    expect(() => transaction(db, () => transaction(db, () => db.exec("INSERT INTO t VALUES (1)")))).not.toThrow();
    expect(() =>
      transaction(db, () => {
        transaction(db, () => db.exec("INSERT INTO t VALUES (2)"));
        throw new Error("falla");
      }),
    ).toThrow("falla");
    expect((db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n).toBe(1);
  });
});

describe("GIF de la ruleta", () => {
  it("es un GIF que se reproduce una vez y pesa menos de lo que acepta Discord", async () => {
    const gif = await renderWheelGif({
      prizes: S.premios.map((p) => ({ icono: p.icono, etiqueta: p.etiqueta, color: p.color })),
      winner: 3,
      papu: { name: "テト大好き ✨", avatar: null },
      host: { name: "Teto", color: "#d64f6b", figure: null },
      title: "¡+2 mensajes!",
      subtitle: "con los Vocaloids, solo hoy",
      seed: 7,
    });
    expect(gif.subarray(0, 6).toString()).toBe("GIF89a");
    // Sin la extension NETSCAPE2.0 no hay repeticion: queda en el ultimo cuadro (la ruleta apuntando al premio).
    expect(gif.includes(Buffer.from("NETSCAPE2.0"))).toBe(false);
    expect(gif.length).toBeLessThan(8 * 1024 * 1024);
  });
});
