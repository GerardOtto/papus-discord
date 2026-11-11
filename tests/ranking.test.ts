import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOT_IDS } from "../src/config";
import { podiumBots, renderRanking, type RankingRow } from "../src/levels/ranking";
import { loadLevelSettings, rankFor, xpToReach } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { memDb } from "./helpers";

const S = loadLevelSettings();
const make = (excluded: string[] = []) => new LevelService({ db: memDb(), settings: S, timeZone: "America/Santiago", unranked: (id) => excluded.includes(id) });

/** Primer dia de un ciclo del podio (dias desde 1970-01-01 multiplo de 5) desde `from`. */
const cycleStart = (from: string) => days(from, 5).find((d) => (Date.parse(`${d}T00:00:00Z`) / 86_400_000) % 5 === 0)!;
const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, k) => new Date(Date.parse(`${from}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10));

describe("podio del ranking: Vocaloids que rotan", () => {
  it("cada dia son tres distintos y en 5 dias seguidos de un ciclo pasan los 15 una sola vez", () => {
    const seen = days(cycleStart("2026-10-18"), 5).flatMap((d) => podiumBots(d, BOT_IDS));
    expect(new Set(seen).size).toBe(15);
    for (const d of days("2026-10-01", 40)) expect(new Set(podiumBots(d, BOT_IDS)).size).toBe(3);
  });

  it("es fijo para un mismo dia y cambia de un dia a otro", () => {
    expect(podiumBots("2026-10-21", BOT_IDS)).toEqual(podiumBots("2026-10-21", BOT_IDS));
    expect(podiumBots("2026-10-21", BOT_IDS)).not.toEqual(podiumBots("2026-10-22", BOT_IDS));
  });

  it("el orden cambia entre ciclos", () => {
    const cycle = (from: string) => days(from, 5).flatMap((d) => podiumBots(d, BOT_IDS));
    const start = cycleStart("2026-10-18");
    expect(cycle(start)).not.toEqual(cycle(days(start, 6)[5]!));
  });

  it("todos los Vocaloids tienen su figura para el podio", () => {
    for (const id of BOT_IDS) expect(existsSync(path.resolve(import.meta.dirname, `../assets/bots/${id}_figura.png`)), id).toBe(true);
  });
});

describe("puestos del ranking", () => {
  it("ordena por estrellas y despues XP, sin GyroP ni quienes ya no estan", () => {
    const lv = make(["gyrop"]);
    lv.store.raiseTo("a", xpToReach(S, 30));
    lv.store.raiseTo("b", xpToReach(S, 45));
    lv.store.raiseTo("c", 10);
    lv.store.prestige("c");
    lv.store.raiseTo("gyrop", xpToReach(S, 99));
    lv.store.raiseTo("se-fue", xpToReach(S, 80));
    const st = lv.standings((id) => id !== "se-fue");
    expect(st.map((s) => [s.userId, s.position])).toEqual([["c", 1], ["b", 2], ["a", 3]]);
    expect(st[1]).toMatchObject({ level: 45, prestige: 0, rank: rankFor(S, 45) });
    expect(st[0]!.prestige).toBe(1);
  });

  it("los empates comparten puesto", () => {
    const lv = make();
    lv.store.raiseTo("a", 500);
    lv.store.raiseTo("b", 500);
    lv.store.raiseTo("c", 100);
    expect(lv.standings(() => true).map((s) => s.position)).toEqual([1, 1, 3]);
  });
});

describe("imagen del ranking", () => {
  const row = (position: number, level: number, prestige = 0): RankingRow => {
    const r = rankFor(S, level);
    return { position, name: `Papu número ${position} con un nombre larguísimo ✿`, avatar: null, level, max: 99, prestige, into: 30, needed: 100, tier: r.estilo, rankName: r.nombre };
  };
  const base = { bots: ["teto", "miku", "luka"] as [string, string, string], colors: { teto: "#E58FB5", miku: "#39C5BB", luka: "#E285B2" }, date: "21 oct. 2026" };

  it("dibuja el top 10 con la fila de quien lo pidio y todos los rangos", async () => {
    const rows = [row(1, 99, 2), ...[1, 10, 22, 40, 50, 62, 70, 78, 86].map((l, k) => row(10 - k, l)).reverse()];
    const png = await renderRanking({ ...base, rows, me: row(57, 3) });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("funciona con menos de tres Papus y con un Vocaloid sin figura", async () => {
    const png = await renderRanking({ ...base, bots: ["teto", "no-existe", "luka"], rows: [row(1, 12)], me: null });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
