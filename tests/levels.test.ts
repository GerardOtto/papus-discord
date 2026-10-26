import { describe, expect, it } from "vitest";
import { renderCard } from "../src/levels/card";
import {
  eventEnd,
  levelFor,
  loadLevelSettings,
  messageXp,
  multiplierAt,
  nickWithLevel,
  passGate,
  progress,
  quotaFor,
  quotaWithTransition,
  rankFor,
  releaseWindows,
  stripNickTag,
  voiceXp,
  wordCount,
  xpToReach,
  type LevelSettings,
} from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { StrikeStore } from "../src/moderation/strikes";
import { Quota } from "../src/quota/quota";
import { memDb } from "./helpers";

const TZ = "America/Santiago";
const S = loadLevelSettings();
// 21 de octubre de 2026, 12:00 en Chile (miercoles).
const NOON = new Date("2026-10-21T15:00:00Z");

describe("curva de niveles", () => {
  it("empieza en 1, el 2 pide 43 XP y el maximo es 99", () => {
    expect(levelFor(S, 0)).toBe(1);
    expect(xpToReach(S, 2)).toBe(43);
    expect(levelFor(S, 42)).toBe(1);
    expect(levelFor(S, 43)).toBe(2);
    expect(levelFor(S, 10_000_000)).toBe(99);
  });

  it("cada nivel pide mas XP que el anterior", () => {
    for (let l = 2; l < 99; l++) expect(xpToReach(S, l + 1) - xpToReach(S, l)).toBeGreaterThan(xpToReach(S, l) - xpToReach(S, l - 1));
  });

  it("el avance dentro del nivel cuadra con la curva", () => {
    const p = progress(S, xpToReach(S, 10) + 5);
    expect(p).toEqual({ level: 10, into: 5, needed: xpToReach(S, 11) - xpToReach(S, 10) });
    expect(progress(S, 10_000_000)).toEqual({ level: 99, into: 1, needed: 1 });
  });

  it("rangos: Papu nuevo, honor en el 40 y Salon de la fama en el 99", () => {
    expect(rankFor(S, 1).nombre).toBe("Papu nuevo");
    expect(S.honor.nivel).toBe(40);
    expect(rankFor(S, S.honor.nivel)).toMatchObject({ nombre: "Papu de honor", estilo: 3 });
    expect(rankFor(S, 39).nombre).not.toBe("Papu de honor");
    expect(rankFor(S, 99)).toEqual({ index: S.rangos.length - 1, nombre: "Salón de la fama", estilo: 10 });
  });

  it("los rangos cambian cada 3 o 4 niveles hasta el 99 y su insignia nunca baja", () => {
    for (let i = 1; i < S.rangos.length; i++) {
      const [a, b] = [S.rangos[i - 1]!, S.rangos[i]!];
      expect(b.desde - a.desde, b.nombre).toBeGreaterThanOrEqual(3);
      expect(b.desde - a.desde, b.nombre).toBeLessThanOrEqual(5);
      expect(b.estilo, b.nombre).toBeGreaterThanOrEqual(a.estilo);
    }
    expect(new Set(S.rangos.map((r) => r.nombre)).size).toBe(S.rangos.length);
  });
});

describe("XP por mensaje", () => {
  it("cuenta solo palabras reales (sin enlaces, emojis personalizados ni menciones)", () => {
    expect(wordCount("hola <@123> mira https://youtu.be/x <:teto:999> 🥖 xd")).toBe(3);
    expect(wordCount("")).toBe(0);
  });

  it("un mensaje largo da mas que uno de una palabra, con tope", () => {
    expect(messageXp(S, "xd")).toBe(1);
    expect(messageXp(S, "qué buena canción")).toBe(3);
    expect(messageXp(S, "yo la escuché en el video de Teto ayer")).toBe(10);
    expect(messageXp(S, "palabra ".repeat(200))).toBe(14);
  });

  it("espera de 2 s entre mensajes y sin repetir los ultimos 3", () => {
    let g = passGate(S, { lastAt: 0, recent: [] }, "hola", 10_000)!;
    expect(g).not.toBeNull();
    expect(passGate(S, g, "otra cosa", 11_000)).toBeNull();
    expect(passGate(S, g, "HOLA ", 13_000)).toBeNull();
    g = passGate(S, g, "otra cosa", 13_000)!;
    expect(g.recent).toEqual(["otra cosa", "hola"]);
    // Solo imagen o sticker: no cuenta como repetido.
    g = passGate(S, g, "", 16_000)!;
    expect(passGate(S, g, "", 19_000)).not.toBeNull();
  });

  it("voz: xpPorPapu por cada otro Papu, 0 si estas solo, con tope", () => {
    expect(voiceXp(S, 0)).toBe(0);
    expect(voiceXp(S, 1)).toBeCloseTo(S.voz.xpPorPapu);
    expect(voiceXp(S, 4)).toBeCloseTo(4 * S.voz.xpPorPapu);
    expect(voiceXp(S, 50)).toBe(S.voz.maximoPorMinuto);
  });

  it("voz silenciado: lo de antes por 1,4 (decision de GyroP)", () => {
    expect(voiceXp(S, 5, true)).toBeCloseTo(5 * 1.4);
    expect(voiceXp(S, 50, true)).toBe(14);
  });

  it("voz: con 5 Papus en el nivel 50 se sube un nivel en unas 4 horas (decision de GyroP)", () => {
    const minutes = (xpToReach(S, 51) - xpToReach(S, 50)) / Math.round(voiceXp(S, 5));
    expect(minutes / 60).toBeGreaterThan(3.5);
    expect(minutes / 60).toBeLessThan(4.5);
  });
});

describe("eventos de XP", () => {
  const withWeekly: LevelSettings = { ...S, eventos: [{ nombre: "Prueba", multiplicador: 1.5, semanal: { dia: 3, desde: "11:00", hasta: "13:00" } }] };

  it("vale el mayor y no se suman", () => {
    expect(multiplierAt(S, NOON, TZ)).toBe(1);
    expect(multiplierAt(withWeekly, NOON, TZ)).toBe(1.5);
    expect(multiplierAt(withWeekly, NOON, TZ, [{ multiplicador: 2, hasta: NOON.getTime() + 1 }])).toBe(2);
    expect(multiplierAt(withWeekly, NOON, TZ, [{ multiplicador: 3, hasta: NOON.getTime() }])).toBe(1.5);
  });

  it("aniversario del servidor el 17 de octubre", () => {
    expect(multiplierAt(S, new Date("2027-10-17T15:00:00Z"), TZ)).toBe(3);
  });

  it("estreno de un video: ventana desde su hora de salida", () => {
    const [w] = releaseWindows(S, [{ at: NOON.getTime() }]);
    expect(w!.hasta - w!.desde!).toBe(S.estrenos!.horas * 3_600_000);
    expect(multiplierAt(S, new Date(NOON.getTime() - 60_000), TZ, [w!])).toBe(1);
    expect(multiplierAt(S, new Date(NOON.getTime() + 60_000), TZ, [w!])).toBe(S.estrenos!.multiplicador);
  });

  it("un evento semanal termina a su hora", () => {
    expect(eventEnd(withWeekly.eventos[0]!, NOON, TZ)).toBe(Date.parse("2026-10-21T13:00:00-03:00"));
  });
});

describe("cuota por nivel (regla 1: nada de pago la cambia)", () => {
  it("sube con el nivel y con prestigio es la de prestigio", () => {
    expect(quotaFor(S, 1, 0)).toBe(3);
    expect(quotaFor(S, 5, 0)).toBe(5);
    expect(quotaFor(S, S.honor.nivel, 0)).toBe(12);
    expect(quotaFor(S, 99, 0)).toBe(18);
    expect(quotaFor(S, 1, 1)).toBe(S.cuotaPrestigio);
  });

  it("los veteranos conservan 12 hasta el fin de la transicion", () => {
    const end = Date.parse(S.transicion!.hasta);
    expect(quotaWithTransition(S, 1, 0, true, new Date(end - 1))).toBe(12);
    expect(quotaWithTransition(S, 1, 0, true, new Date(end))).toBe(3);
    expect(quotaWithTransition(S, 1, 0, false, new Date(end - 1))).toBe(3);
  });

  it("la cuota usa el limite de cada Papu", () => {
    const q = new Quota(memDb(), (id) => (id === "alto" ? 8 : 3), TZ);
    expect(q.reserve("bajo", 5, NOON).units).toBe(3);
    expect(q.reserve("alto", 5, NOON).units).toBe(5);
    expect(q.limitFor("alto", NOON)).toBe(8);
  });
});

describe("apodo con nivel", () => {
  it("agrega y quita la etiqueta", () => {
    expect(nickWithLevel("karin", 57, 0)).toBe("karin ✦57");
    expect(nickWithLevel("karin ✦3", 4, 2)).toBe("karin ★2✦4");
    expect(stripNickTag("karin ★2✦4")).toBe("karin");
    expect(stripNickTag("sin etiqueta")).toBe("sin etiqueta");
  });

  it("nunca pasa de 32 caracteres: acorta el nombre, no el nivel", () => {
    const n = nickWithLevel("a".repeat(40), 99, 12);
    expect([...n].length).toBe(32);
    expect(n.endsWith(" ★12✦99")).toBe(true);
  });
});

describe("LevelService", () => {
  const make = (excluded: string[] = []) => new LevelService({ db: memDb(), settings: S, timeZone: TZ, unranked: (id) => excluded.includes(id) });

  it("suma XP por mensaje y avisa al subir de nivel", () => {
    const lv = make();
    let t = NOON.getTime();
    let change = null;
    for (let i = 0; i < 20 && !change; i++) change = lv.onMessage("papu", `mensaje numero ${i} con varias palabras aqui`, (t += 3000)).change;
    expect(change).toMatchObject({ userId: "papu", from: 1, to: 2, rankUp: null, honor: false });
  });

  it("/estreno abre la XP multiplicada desde el anuncio, sin borrar los del calendario", () => {
    const lv = make();
    const t = NOON.getTime();
    lv.setReleases([{ title: "Del calendario", at: t + 10 * 3_600_000 }]);
    expect(lv.multiplier(new Date(t))).toBe(1);
    lv.setLaunched([{ title: "Triple Baka", at: t - 60_000 }]);
    expect(lv.multiplier(new Date(t))).toBe(S.estrenos!.multiplicador);
    expect(lv.activeRelease(t)?.title).toBe("Triple Baka");
    expect(lv.multiplier(new Date(t + S.estrenos!.horas * 3_600_000))).toBe(1);
    expect(lv.multiplier(new Date(t + 10 * 3_600_000 + 60_000))).toBe(S.estrenos!.multiplicador);
  });

  it("doble XP cuando un Vocaloid contesta", () => {
    const lv = make();
    const { base } = lv.onMessage("papu", "hola Teto como estas hoy", NOON.getTime());
    lv.onBotReply("papu", base, NOON.getTime());
    expect(lv.store.get("papu").xp).toBe(base * 2);
  });

  it("GyroP sube de nivel como todos (solo para verlo; el ranking no lo cuenta)", () => {
    const lv = make(["gyrop"]);
    expect(lv.onMessage("gyrop", "hola a todos los papus", NOON.getTime()).base).toBeGreaterThan(0);
    expect(lv.store.get("gyrop").xp).toBeGreaterThan(0);
    expect(lv.standings(() => true).map((s) => s.userId)).not.toContain("gyrop");
  });

  it("voz: XP solo con otros Papus en el canal", () => {
    const lv = make();
    const p = (id: string, muted = false) => ({ id, muted });
    lv.onVoiceMinute([[p("solo")], [p("a"), p("b"), p("c", true)]], NOON.getTime());
    expect(lv.store.get("solo").xp).toBe(0);
    expect(lv.store.get("a").xp).toBe(Math.round(voiceXp(S, 2)));
    // Silenciado: gana menos, pero cuenta para los demas.
    expect(lv.store.get("c").xp).toBe(Math.round(voiceXp(S, 2, true)));
    expect(lv.store.get("c").xp).toBeLessThan(lv.store.get("a").xp);
  });

  it("voz: tope de minutos por dia, que se renueva al dia siguiente", () => {
    const lv = make();
    const call = [{ id: "a", muted: false }, { id: "b", muted: true }];
    const max = S.voz.maximoMinutosDia!;
    for (let m = 0; m < max + 30; m++) lv.onVoiceMinute([call], NOON.getTime() + m * 60_000);
    expect(lv.store.get("a").xp).toBe(max * Math.round(voiceXp(S, 1)));
    expect(lv.store.get("b").xp).toBe(max * Math.round(voiceXp(S, 1, true)));
    const before = lv.store.get("a").xp;
    lv.onVoiceMinute([call], NOON.getTime() + 24 * 3_600_000);
    expect(lv.store.get("a").xp).toBeGreaterThan(before);
  });

  it("cruzar el nivel de honor lo anuncia una vez (sin estrellas)", () => {
    const lv = make();
    lv.store.raiseTo("papu", xpToReach(S, S.honor.nivel) - 1);
    const { change } = lv.onMessage("papu", "un mensaje largo para cruzar el nivel", NOON.getTime());
    expect(change).toMatchObject({ honor: true, rankUp: "Papu de honor", to: S.honor.nivel });
  });

  it("el rol de honor da al menos su piso (25) y no toca a quien ya esta mas arriba", () => {
    const lv = make();
    expect(lv.ensureHonor("papu")).toMatchObject({ to: S.honor.pisoRolManual });
    expect(lv.ensureHonor("papu")).toBeNull();
    lv.store.raiseTo("alto", xpToReach(S, 33));
    expect(lv.ensureHonor("alto")).toBeNull();
    expect(lv.level("alto").level).toBe(33);
  });

  it("un strike quita la XP del dia (solo la de ese dia)", () => {
    const lv = make();
    const ayer = NOON.getTime() - 86_400_000;
    lv.onMessage("papu", "mensaje de ayer con algunas palabras", ayer);
    const before = lv.store.get("papu").xp;
    lv.onMessage("papu", "mensaje de hoy con algunas palabras", NOON.getTime());
    lv.onStrike("papu", NOON.getTime());
    expect(lv.store.get("papu").xp).toBe(before);
  });

  it("los strikes de Neru avisan a los niveles", () => {
    const db = memDb();
    const strikes = new StrikeStore(db);
    const seen: string[] = [];
    strikes.onAdd = (id) => seen.push(id);
    strikes.add({ userId: "papu", reason: "insulto" });
    expect(seen).toEqual(["papu"]);
  });

  it("prestigio solo en el 99: vuelve al 1 con una estrella y cuota de prestigio", () => {
    const lv = make();
    expect(lv.prestige("papu")).toBeNull();
    lv.store.raiseTo("papu", xpToReach(S, 99));
    expect(lv.prestige("papu")).toBe(1);
    expect(lv.level("papu")).toEqual({ level: 1, prestige: 1 });
    expect(lv.limitFor("papu", NOON)).toBe(S.cuotaPrestigio);
  });

  it("puesto en el servidor: primero las estrellas, despues la XP", () => {
    const lv = make();
    lv.store.raiseTo("a", 500);
    lv.store.raiseTo("b", 900);
    lv.store.prestige("c");
    expect([lv.store.position("c"), lv.store.position("b"), lv.store.position("a")]).toEqual([1, 2, 3]);
  });

  it("evento manual multiplica y se puede terminar", () => {
    const lv = make();
    lv.startEvent(2, 1, NOON.getTime());
    expect(lv.multiplier(NOON)).toBe(2);
    lv.endEvent();
    expect(lv.multiplier(NOON)).toBe(1);
  });

  it("el calculo inicial marca veteranos y fija la XP", () => {
    const lv = make();
    lv.store.importInitial(new Map([["a", 1000]]), ["a", "b"]);
    expect(lv.store.get("a")).toMatchObject({ xp: 1000, veteran: true });
    expect(lv.limitFor("b", NOON)).toBe(12);
  });
});

describe("tarjeta de nivel", () => {
  it("dibuja un PNG en todos los rangos, con y sin avatar ni fondo", async () => {
    for (const [i, r] of S.rangos.entries()) {
      const png = await renderCard({
        name: "karin_vocaloid ✿",
        avatar: null,
        level: r.desde,
        max: 99,
        prestige: r.estilo === 10 ? 2 : 0,
        into: 10,
        needed: 100,
        tier: r.estilo,
        rankName: r.nombre,
        position: 1,
        quota: { left: 2, limit: 3 },
        frase: i % 2 ? null : "Teto es la mejor",
        accent: "#E285B2",
        background: i === 3 ? Buffer.from("no es una imagen") : null,
        multiplier: i === 5 ? 2 : 1,
      });
      expect(png.subarray(1, 4).toString()).toBe("PNG");
    }
  });
});
