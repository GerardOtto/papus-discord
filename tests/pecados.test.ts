import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { Comentarista, fuenteDe } from "../src/pecados/comentarista";
import { lineasTabla } from "../src/pecados/discord";
import { Phrases } from "../src/phrases/catalog";
import { DeckStore } from "../src/phrases/deck";
import { diasRestantes, loadPecados, semanaDe, semanaTerminada, tablaAvaricia, valorAvaricia } from "../src/pecados/rules";
import { memDb } from "./helpers";

const S = loadPecados();
const TZ = "America/Santiago";
const avaricia = S.semanas.find((s) => s.id === "avaricia")!;

function setup(start = Date.UTC(2026, 10, 19, 15, 0)) {
  const db = memDb();
  let now = start;
  const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: TZ, now: () => now });
  return { db, coins, at: (t: number) => (now = t) };
}

describe("calendario de los pecados", () => {
  it("siete semanas seguidas, de jueves a miércoles, en el orden de GyroP", () => {
    expect(S.semanas.map((s) => s.id)).toEqual(["avaricia", "soberbia", "gula", "ira", "lujuria", "envidia", "pereza"]);
    expect(S.semanas[0]!.inicio).toBe("2026-11-19");
    expect(S.semanas[6]!.fin).toBe("2027-01-06");
  });
  it("anfitriones de mothy", () => {
    expect(Object.fromEntries(S.semanas.map((s) => [s.id, s.anfitrion]))).toEqual({ avaricia: "kaito", soberbia: "rin", gula: "meiko", ira: "gumi", lujuria: "gakupo", envidia: "luka", pereza: "miku" });
  });
  it("semana en curso, cierre y días restantes", () => {
    expect(semanaDe(S, "2026-11-18")).toBeNull();
    expect(semanaDe(S, "2026-11-19")?.id).toBe("avaricia");
    expect(semanaDe(S, "2026-11-25")?.id).toBe("avaricia");
    expect(semanaDe(S, "2026-11-26")?.id).toBe("soberbia");
    expect(semanaTerminada(S, "2026-11-26")?.id).toBe("avaricia");
    expect(semanaTerminada(S, "2026-11-25")).toBeNull();
    expect(diasRestantes(avaricia, "2026-11-19")).toBe(7);
    expect(diasRestantes(avaricia, "2026-11-25")).toBe(1);
  });
});

describe("Avaricia", () => {
  it("suma lo que entra y resta solo intercambios entregados, apuestas, quitas de GyroP y machetazos", () => {
    const r = S.avaricia.restar;
    expect(valorAvaricia(100, "pelea 3 ganada", r)).toBe(100);
    expect(valorAvaricia(50, "intercambio #4", r)).toBe(50);
    expect(valorAvaricia(-50, "intercambio #4", r)).toBe(-50);
    expect(valorAvaricia(-30, "apuesta pelea 3", r)).toBe(-30);
    expect(valorAvaricia(-30, "apuesta ruleta de Némesis", r)).toBe(-30);
    expect(valorAvaricia(-30, "apuesta de ajedrez 9", r)).toBe(-30);
    expect(valorAvaricia(-30, "boleto carrera 2", r)).toBe(-30);
    expect(valorAvaricia(-10, "machetazo 2026-11-20", r)).toBe(-10);
    expect(valorAvaricia(-200, "compra fondo_x", r)).toBe(0);
    expect(valorAvaricia(-200, "mercado atun", r)).toBe(0);
    expect(valorAvaricia(-200, "sobre", r)).toBe(0);
  });

  it("pasarse monedas entre amigos no sube a nadie en total", () => {
    const { db, coins } = setup();
    coins.adjust("a", "monedas", 1000, "nivel 10");
    coins.transfer("a", "b", 600, "intercambio #1");
    const t = tablaAvaricia(db, S, avaricia, TZ);
    expect(t).toEqual([
      { userId: "b", puntos: 600 },
      { userId: "a", puntos: 400 },
    ]);
  });

  it("solo cuenta los días de la semana (hora de Chile) y no resta lo gastado en la tienda", () => {
    const { db, coins, at } = setup();
    at(Date.UTC(2026, 10, 19, 2, 59)); // 18 nov. 23:59 en Chile: aún no empieza
    coins.adjust("a", "monedas", 5000, "nivel 30");
    at(Date.UTC(2026, 10, 19, 3, 0)); // 19 nov. 00:00 en Chile
    coins.adjust("a", "monedas", 100, "participación 2026-11-19");
    coins.spend("a", 300, "mercado atun");
    coins.spend("a", 40, "apuesta pelea 1");
    coins.adjust("a", "monedas", 80, "pelea 1 ganada");
    at(Date.UTC(2026, 10, 26, 3, 0)); // 26 nov.: ya es la Soberbia
    coins.adjust("a", "monedas", 9999, "nivel 31");
    expect(tablaAvaricia(db, S, avaricia, TZ)).toEqual([{ userId: "a", puntos: 140 }]);
  });

  it("tabla con medallas y sin pings", () => {
    expect(lineasTabla([], 5, "Shaulitas")).toMatch(/Nadie/);
    const txt = lineasTabla([{ userId: "1", puntos: 1500 }, { userId: "2", puntos: 20 }, { userId: "3", puntos: 10 }, { userId: "4", puntos: 5 }], 5, "Shaulitas");
    expect(txt.split("\n")).toHaveLength(4);
    expect(txt).toContain("🥇 <@1>");
    expect(txt).toContain("**4.** <@4>");
  });
});

describe("Gallerian comenta las ganancias", () => {
  function comentarista(start = Date.UTC(2026, 10, 19, 15, 0)) {
    const { db, coins, at } = setup(start);
    let now = start;
    const enviados: { canal: string; bot: string; texto: string }[] = [];
    const tareas: (() => void)[] = [];
    const c = new Comentarista({
      db,
      settings: S,
      phrases: new Phrases(new DeckStore(db)),
      timeZone: TZ,
      now: () => now,
      canal: (n) => `#${n}`,
      canalNemesis: (id) => (id === "n1" ? "#donde-se-jugo" : null),
      esBot: (u) => u === "bot",
      sendable: async (bot, canal) => ({ send: async (m: { content: string }) => void enviados.push({ canal, bot, texto: m.content }) }) as never,
      programar: (fn) => void tareas.push(fn),
      log: () => {},
    });
    coins.onGain = (u, n, m) => c.onGain(u, n, m);
    const correr = async () => {
      for (const t of tareas.splice(0)) t();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { coins, enviados, correr, avanzar: (ms: number) => { now += ms; at(now); } };
  }

  it("fuentes: participar en el chat, devoluciones y GyroP no cuentan", () => {
    expect(fuenteDe(S, "pelea 7 ganada")).toBe("casino");
    expect(fuenteDe(S, "carrera 3 (boletos acertados)")).toBe("casino");
    expect(fuenteDe(S, "ruleta de Némesis n1 ganada")).toBe("nemesis");
    expect(fuenteDe(S, "ajedrez 4 ganado")).toBe("casino");
    expect(fuenteDe(S, "intercambio #12")).toBe("centro-de-comercio");
    expect(fuenteDe(S, "nivel 20")).toBe("general");
    expect(fuenteDe(S, "participación 2026-11-19")).toBeNull();
    expect(fuenteDe(S, "pelea 7 cancelada (devolución)")).toBeNull();
    expect(fuenteDe(S, "pelea 7 perdida (Seguro de Gakupo)")).toBeNull();
    expect(fuenteDe(S, "GyroP: regalo")).toBeNull();
  });

  it("Kaito comenta en el canal del evento, con su puesto, y no menos de 100", async () => {
    const { coins, enviados, correr } = comentarista();
    coins.adjust("a", "monedas", 99, "pelea 1 ganada");
    coins.adjust("b", "monedas", 150, "ruleta de Némesis n1 ganada");
    coins.adjust("bot", "monedas", 120, "pelea 2 ganada");
    await correr();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.bot).toBe("kaito");
    expect(enviados[0]!.canal).toBe("#donde-se-jugo");
    expect(enviados[0]!.texto).toContain("<@b>");
    expect(enviados[0]!.texto).toMatch(/va 1\.º/);
  });

  it("los ganadores del mismo evento van en un solo mensaje", async () => {
    const { coins, enviados, correr } = comentarista();
    coins.adjust("a", "monedas", 300, "pelea 5 ganada");
    coins.adjust("b", "monedas", 200, "pelea 5 ganada");
    await correr();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.canal).toBe("#casino");
    expect(enviados[0]!.texto).toContain("<@a>");
    expect(enviados[0]!.texto).toContain("<@b>");
  });

  it("una vez cada 30 min y hasta 10 al día por Papu", async () => {
    const { coins, enviados, correr, avanzar } = comentarista(Date.UTC(2026, 10, 19, 4, 0));
    coins.adjust("a", "monedas", 100, "pelea 1 ganada");
    await correr();
    avanzar(29 * 60_000);
    coins.adjust("a", "monedas", 100, "pelea 2 ganada");
    await correr();
    expect(enviados).toHaveLength(1);
    for (let i = 0; i < 12; i++) {
      avanzar(31 * 60_000);
      coins.adjust("a", "monedas", 100, `pelea x${i} ganada`);
      await correr();
    }
    expect(enviados).toHaveLength(10);
  });

  it("fuera de la semana de la Avaricia no dice nada", async () => {
    const { coins, enviados, correr } = comentarista(Date.UTC(2026, 10, 26, 15, 0));
    coins.adjust("a", "monedas", 500, "pelea 1 ganada");
    await correr();
    expect(enviados).toHaveLength(0);
  });
});
