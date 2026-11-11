import { describe, expect, it } from "vitest";
import { loadLevelSettings, progress, xpToReach } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { Quota } from "../src/quota/quota";
import { renderWheelGif } from "../src/ruleta/wheel";
import { loadSorteoSettings, pickWinner, sliceColors, type SorteoSettings } from "../src/sorteo/rules";
import { SorteoService, type Candidate } from "../src/sorteo/service";
import { memDb } from "./helpers";

const TZ = "America/Santiago";
const LS = loadLevelSettings();
const S = loadSorteoSettings();
const NOON = Date.parse("2026-10-26T12:00:00-03:00");

const papus = (n: number): Candidate[] => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `Papu ${i}`, avatarUrl: null }));

/** rnd fijo: con 0 sale siempre el primero que quede (premio y Papu). */
function setup(settings: SorteoSettings = S, rnd = () => 0) {
  const db = memDb();
  const levels = new LevelService({ db, settings: LS, timeZone: TZ });
  const quota = new Quota(db, (id, d) => levels.limitFor(id, d), TZ);
  const s = new SorteoService({ db, settings, levels, quota, now: () => NOON, rnd });
  return { db, levels, quota, s };
}

describe("reglas del sorteo", () => {
  it("la config de verdad carga", () => {
    expect(S.premios.length).toBeGreaterThan(0);
  });

  it("el ganador sale de los que no se descartaron", () => {
    const list = papus(3);
    expect(pickWinner(list, new Set(["u0"]), () => 0)!.id).toBe("u1");
    expect(pickWinner(list, new Set(["u0", "u1"]), () => 0.99)!.id).toBe("u2");
    expect(pickWinner(list, new Set(["u0", "u1", "u2"]))).toBeNull();
  });

  it("dos casillas juntas nunca tienen el mismo color (tampoco la ultima con la primera)", () => {
    for (const n of [2, 3, 9, 10, 19, 28, 300]) {
      const c = sliceColors(S.colores, n);
      for (let i = 0; i < n; i++) expect(c[i], `n=${n} i=${i}`).not.toBe(c[(i + 1) % n]);
    }
  });
});

describe("servicio del sorteo", () => {
  it("girar otra vez descarta al que salio y no lo vuelve a sacar", () => {
    const { s } = setup();
    const draw = s.start(papus(3), "canal")!;
    expect(draw.winner.id).toBe("u0");
    expect(s.reroll(draw.id)!.winner.id).toBe("u1");
    expect(s.reroll(draw.id)!.winner.id).toBe("u2");
    expect([...draw.excluded]).toEqual(["u0", "u1"]);
    // Ya no queda nadie: el ganador se mantiene.
    expect(s.reroll(draw.id)).toBeNull();
    expect(s.get(draw.id)!.winner.id).toBe("u2");
    expect(draw.spins).toBe(3);
  });

  it("darselo a otro: aunque estuviera descartado o no estuviera en la ruleta", () => {
    const { s } = setup();
    const draw = s.start(papus(2), "canal")!;
    s.reroll(draw.id);
    expect(s.assign(draw.id, papus(1)[0]!)!.winner.id).toBe("u0");
    expect(draw.excluded.has("u0")).toBe(false);
    s.assign(draw.id, { id: "nuevo", name: "Recien llegado", avatarUrl: null });
    expect(draw.candidates.map((c) => c.id)).toContain("nuevo");
    expect(draw.winner.id).toBe("nuevo");
  });

  it("el premio de XP se entrega solo al confirmar, y el sorteo se cierra", () => {
    const xpPrize: SorteoSettings = { ...S, xpMinima: 50, premios: [{ tipo: "xp", porcentaje: 1, peso: 1, icono: "🆙", nombre: "un nivel" }] };
    const { s, levels, db } = setup(xpPrize);
    const draw = s.start(papus(2), "canal")!;
    expect(levels.store.get("u0").xp).toBe(0);
    const res = s.confirm(draw.id)!;
    expect(res.xp).toBe(Math.round(Math.max(50, progress(LS, 0).needed)));
    expect(levels.store.get("u0").xp).toBe(res.xp);
    expect(res.levelAfter).toBeGreaterThan(res.levelBefore);
    expect(s.get(draw.id)).toBeNull();
    expect(s.confirm(draw.id)).toBeNull();
    const row = db.prepare("SELECT user_id, detalle FROM sorteos").get() as { user_id: string; detalle: string };
    expect(row.user_id).toBe("u0");
    expect(JSON.parse(row.detalle)).toMatchObject({ tipo: "xp", giros: 1, papus: 2 });
  });

  it("el premio escrito por GyroP es manual: no da XP", () => {
    const { s, levels } = setup();
    const draw = s.start(papus(2), "canal", { texto: "  Un dibujo de GyroP  " })!;
    expect(draw.prize).toMatchObject({ tipo: "manual", nombre: "Un dibujo de GyroP" });
    expect(s.confirm(draw.id)!.xp).toBe(0);
    expect(levels.store.get("u0").xp).toBe(0);
  });

  it("GyroP elige XP, niveles y mensajes a mano (se pueden combinar)", () => {
    const { s, levels, quota } = setup();
    levels.bonus("u0", progress(LS, 0).needed * 2 + 10, NOON);
    quota.reserve("u0", 3, new Date(NOON)); // gasto 3: los 3 mensajes del premio caben
    const before = levels.snapshot("u0");
    const draw = s.start(papus(2), "canal", { xp: 7, niveles: 2, mensajes: 3 })!;
    expect(draw.prize).toMatchObject({ tipo: "fijo", nombre: "+7 XP · +2 niveles · +3 mensajes con los Vocaloids hoy" });
    const res = s.confirm(draw.id)!;
    expect(res.levelAfter).toBe(before.level + 2);
    // El avance dentro del nivel se queda, mas la XP fija.
    expect(levels.snapshot("u0").into).toBe(before.into + 7);
    expect(res).toMatchObject({ messages: 3, overflow: 0 });
    expect(quota.remaining("u0", new Date(NOON))).toBe(levels.limitFor("u0", new Date(NOON)));
  });

  it("con la cuota llena, los mensajes del premio se vuelven XP (GyroP, 31 oct. 2026)", () => {
    const { s, levels, quota } = setup();
    levels.bonus("u0", 500, NOON);
    const extraXp = levels.overflowXp("u0", 2);
    const draw = s.start(papus(2), "canal", { mensajes: 2 })!;
    const res = s.confirm(draw.id)!;
    expect(res).toMatchObject({ messages: 0, overflow: 2, xp: extraXp });
    expect(quota.extra("u0", new Date(NOON))).toBe(0);
  });

  it("los niveles no pasan del maximo; con texto, el texto es el nombre y se entrega solo", () => {
    const { s, levels } = setup();
    levels.bonus("u0", xpToReach(LS, LS.curva.maximo - 1), NOON);
    const draw = s.start(papus(2), "canal", { texto: "Campeón del karaoke", niveles: 5 })!;
    expect(draw.prize).toMatchObject({ tipo: "fijo", nombre: "Campeón del karaoke" });
    expect(s.confirm(draw.id)!.levelAfter).toBe(LS.curva.maximo);
  });

  it("cancelar no entrega nada; sin Papus no hay sorteo", () => {
    const { s, db } = setup();
    const draw = s.start(papus(2), "canal")!;
    expect(s.cancel(draw.id)).toBe(true);
    expect(s.confirm(draw.id)).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM sorteos").get() as { n: number }).n).toBe(0);
    expect(s.start([], "canal")).toBeNull();
  });
});

describe("GIF del sorteo", () => {
  it("con cientos de Papus sigue siendo un GIF que Discord acepta", async () => {
    const list = papus(300);
    const colors = sliceColors(S.colores, list.length);
    const gif = await renderWheelGif({
      prizes: list.map((p, i) => ({ icono: "", etiqueta: p.name, color: colors[i]! })),
      winner: 123,
      labels: "nombres",
      heading: "SORTEO",
      tagline: "🎁 ⭐ medio nivel de XP",
      host: { name: "Teto", color: "#d64f6b", figure: null },
      badge: "🎉 ¡GANADOR! 🎉",
      title: "テト大好き ✨ con un nombre larguísimo",
      subtitle: "⭐ medio nivel de XP",
      winnerAvatar: null,
      seed: 7,
    });
    expect(gif.subarray(0, 6).toString()).toBe("GIF89a");
    expect(gif.length).toBeLessThan(8 * 1024 * 1024);
  });
});
