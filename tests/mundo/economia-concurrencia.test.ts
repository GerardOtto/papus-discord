import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/db/database";
import type { D1Query } from "../../src/cloud/d1";
import { loadLevelSettings } from "../../src/levels/rules";
import { LevelService } from "../../src/levels/service";
import { EconomiaPlazaPreview } from "../../src/mundo/economia-preview";
import { RouletteService } from "../../src/ruleta/service";
import type { Quota } from "../../src/quota/quota";
import { loadTriviaSettings } from "../../src/trivia/rules";

describe("EconomiaPlazaPreview: concurrencia", () => {
  const abiertos: ReturnType<typeof openDb>[] = [];
  afterEach(() => {
    for (const db of abiertos.splice(0)) db.close();
  });

  it("serializa dos capturas simultáneas: solo una concede XP y consume el cooldown", async () => {
    const source = openDb(":memory:");
    const preview = openDb(":memory:");
    abiertos.push(source, preview);
    preview.exec(`
      CREATE TABLE mundo_sandbox (
        papu_id TEXT PRIMARY KEY,
        estado TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        actualizado_at INTEGER NOT NULL
      );
      CREATE TABLE mundo_perfiles (
        papu_id TEXT PRIMARY KEY,
        pedido_at INTEGER NOT NULL DEFAULT 0,
        actualizado_at INTEGER NOT NULL DEFAULT 0
      );
    `);

    const query: D1Query = async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      const statement = preview.prepare(sql);
      if (/^\\s*(SELECT|UPDATE)/i.test(sql) && /RETURNING/i.test(sql)) {
        return statement.all(...(params as never[])) as unknown as T[];
      }
      if (/^\\s*SELECT/i.test(sql)) {
        return statement.all(...(params as never[])) as unknown as T[];
      }
      statement.run(...(params as never[]));
      return [];
    };

    const now = 1_000_000;
    const userId = "123456789012345678";
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const roulette = { dayOf: () => "2026-11-12" } as unknown as RouletteService;
    const economy = new EconomiaPlazaPreview({
      query,
      db: source,
      levels,
      coins: null,
      mercado: null,
      roulette,
      quota: {} as Quota,
      now: () => now,
      rnd: () => 0.99,
      trivia: loadTriviaSettings(),
      questionLevels: {},
      questionTotals: { facil: 0, medio: 0, dificil: 0 },
      timeZone: "America/Santiago",
    });

    const capture = economy.acciones()["pesca.capturar"]!;
    const results = await Promise.all([
      capture({ id: userId, nombre: "Papu" }, null),
      capture({ id: userId, nombre: "Papu" }, null),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const rows = await query<{ estado: string; revision: number }>(
      "SELECT estado, revision FROM mundo_sandbox WHERE papu_id = ?",
      userId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revision).toBe(1);
    const state = JSON.parse(rows[0]!.estado) as { xp: number; pescaAt: number };
    expect(state.xp).toBeGreaterThan(0);
    expect(state.pescaAt).toBe(now);
  });
});
