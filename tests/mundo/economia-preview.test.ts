import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/db/database";
import type { D1Query } from "../../src/cloud/d1";
import { loadLevelSettings } from "../../src/levels/rules";
import { LevelService } from "../../src/levels/service";
import { EconomiaPlazaPreview } from "../../src/mundo/economia-preview";
import type { RouletteService } from "../../src/ruleta/service";
import type { Quota } from "../../src/quota/quota";

describe("EconomiaPlazaPreview", () => {
  const abiertos: ReturnType<typeof openDb>[] = [];
  afterEach(() => {
    for (const db of abiertos.splice(0)) db.close();
  });

  it("persists fishing XP in the isolated ledger and enforces its cooldown", async () => {
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
    `);
    const query: D1Query = async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      const statement = preview.prepare(sql);
      if (/^\\s*SELECT/i.test(sql) || /RETURNING/i.test(sql)) {
        return statement.all(...(params as never[])) as unknown as T[];
      }
      statement.run(...(params as never[]));
      return [];
    };
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const roulette = { dayOf: () => "2026-11-12" } as unknown as RouletteService;
    let now = 1_000_000;
    const economy = new EconomiaPlazaPreview({
      query, db: source, levels, coins: null, mercado: null,
      roulette, quota: {} as Quota, now: () => now, rnd: () => 0.99,
    });

    const fish = economy.acciones()["pesca.capturar"]!;
    const first = await fish({ id: "123456789012345678", nombre: "Papu" }, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstData = first.datos as { xp: number; sandbox: boolean; xpTotalSandbox: number };
    expect(firstData.sandbox).toBe(true);
    expect(firstData.xp).toBeGreaterThan(0);
    expect(firstData.xpTotalSandbox).toBe(firstData.xp);

    const cooldown = await fish({ id: "123456789012345678", nombre: "Papu" }, null);
    expect(cooldown.ok).toBe(false);

    now += 30_001;
    const second = await fish({ id: "123456789012345678", nombre: "Papu" }, null);
    expect(second.ok).toBe(true);
    if (second.ok) expect((second.datos as { xpTotalSandbox: number }).xpTotalSandbox).toBeGreaterThan(firstData.xpTotalSandbox);

    const persisted = await query<{ estado: string; revision: number }>(
      "SELECT estado, revision FROM mundo_sandbox WHERE papu_id = ?", "123456789012345678",
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.revision).toBe(2);
  });
});
