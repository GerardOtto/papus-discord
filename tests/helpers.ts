import path from "node:path";
import { openDb } from "../src/db/database";

export const FIXTURE_ENGINE = path.resolve(import.meta.dirname, "fixtures/engine");
export const memDb = () => openDb(":memory:");

/** RNG determinista (mulberry32) para barajar en las pruebas. */
export function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BASE_ENV = {
  DISCORD_TOKEN_TETO: "t",
  DISCORD_TOKEN_MIKU: "m",
  DISCORD_TOKEN_LUKA: "l",
  DISCORD_TOKEN_NERU: "n",
  DISCORD_GUILD_ID: "123",
};
