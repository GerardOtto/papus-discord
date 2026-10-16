import { describe, expect, it } from "vitest";
import { BOT_IDS } from "../src/config";
import { DeckStore } from "../src/phrases/deck";
import { nextPresenceBot, parseFarewell, QUICK_RESTART_MS, startDecision, type FarewellRecord } from "../src/services/presence";
import { memDb, seededRng } from "./helpers";

const NOW = 1_800_000_000_000;
const farewell = (minutesAgo: number): FarewellRecord => ({ bot: "neru", channelId: "c", messageId: "m", at: NOW - minutesAgo * 60_000 });

describe("startDecision", () => {
  it("primera vez: saluda", () => {
    expect(startDecision(null, null, NOW)).toEqual({ greet: true, deleteFarewell: null });
  });

  it("reinicio rápido (< 30 min): no saluda y borra la despedida", () => {
    const f = farewell(5);
    expect(startDecision(f.at, f, NOW)).toEqual({ greet: false, deleteFarewell: f });
  });

  it("volvieron después de un rato: saluda y deja la despedida", () => {
    const f = farewell(45);
    expect(startDecision(f.at, f, NOW)).toEqual({ greet: true, deleteFarewell: null });
  });

  it("caída sin despedida (PC apagado de golpe): decide por la última vez en línea", () => {
    expect(startDecision(NOW - 2 * 3_600_000, null, NOW).greet).toBe(true);
    expect(startDecision(NOW - QUICK_RESTART_MS + 1000, null, NOW).greet).toBe(false);
  });
});

describe("nextPresenceBot", () => {
  it("rota entre los 4 sin repetir", () => {
    const decks = new DeckStore(memDb(), seededRng(9));
    const four = Array.from({ length: 4 }, () => nextPresenceBot(decks));
    expect([...four].sort()).toEqual([...BOT_IDS].sort());
  });
});

describe("parseFarewell", () => {
  it("acepta un registro valido y descarta basura", () => {
    const f = farewell(1);
    expect(parseFarewell(JSON.stringify(f))).toEqual(f);
    expect(parseFarewell(null)).toBeNull();
    expect(parseFarewell("{roto")).toBeNull();
    expect(parseFarewell(JSON.stringify({ ...f, bot: "kaito" }))).toBeNull();
  });
});
