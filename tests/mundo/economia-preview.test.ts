import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/db/database";
import type { D1Query } from "../../src/cloud/d1";
import { loadLevelSettings } from "../../src/levels/rules";
import { loadCoinSettings, loadCatalog } from "../../src/coins/rules";
import { CoinService } from "../../src/coins/service";
import { loadMercadoSettings, aperturaHoy } from "../../src/mercado/rules";
import { MercadoService } from "../../src/mercado/service";
import { loadRouletteSettings } from "../../src/ruleta/rules";
import { RouletteService } from "../../src/ruleta/service";
import { Quota } from "../../src/quota/quota";
import { LevelService } from "../../src/levels/service";
import { EconomiaPlazaPreview } from "../../src/mundo/economia-preview";

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
      if (/^\s*SELECT/i.test(sql) || /RETURNING/i.test(sql)) {
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
  it("completes shop and black-market purchases without touching the source wallet", async () => {
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
      if (/^\s*(SELECT|UPDATE)/i.test(sql) || /RETURNING/i.test(sql)) {
        return statement.all(...(params as never[])) as unknown as T[];
      }
      statement.run(...(params as never[]));
      return [];
    };
    const userId = "123456789012345678";
    source.prepare("INSERT INTO monedero (user_id, ganadas, compradas) VALUES (?, ?, ?)").run(userId, 10_000_000, 10_000_000);
    let now = Date.parse("2026-11-12T12:00:00-03:00");
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const quota = new Quota(source, (id, at) => levels.limitFor(id, at), "America/Santiago");
    const coins = new CoinService({
      db: source, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now,
    });
    const roulette = new RouletteService({
      db: source, settings: loadRouletteSettings(), levels, quota, timeZone: "America/Santiago", now: () => now,
    });
    const marketSettings = loadMercadoSettings();
    const mercado = new MercadoService({
      db: source, settings: marketSettings, coins, quota, roulette, timeZone: "America/Santiago", now: () => now,
    });
    const economy = new EconomiaPlazaPreview({
      query, db: source, levels, coins, mercado, roulette, quota, now: () => now, rnd: () => 0.2,
    });
    const actions = economy.acciones();
    const papu = { id: userId, nombre: "Papu" };

    const tienda = await actions["tienda.estado"]!(papu, null);
    expect(tienda.ok).toBe(true);
    if (!tienda.ok) return;
    const articulo = (tienda.datos as { objetos: { id: string; precio: number | null }[] }).objetos.find((o) => o.precio !== null);
    expect(articulo).toBeDefined();
    const compraTienda = await actions["tienda.comprar"]!(papu, { id: articulo!.id });
    expect(compraTienda.ok).toBe(true);
    const duplicado = await actions["tienda.comprar"]!(papu, { id: articulo!.id });
    expect(duplicado.ok).toBe(false);

    const referencia = Date.parse("2026-11-12T12:00:00-06:00");
    now = aperturaHoy(marketSettings, referencia).abre + 1_000;
    const mercadoEstado = await actions["mercado.estado"]!(papu, null);
    expect(mercadoEstado.ok).toBe(true);
    if (!mercadoEstado.ok) return;
    expect((mercadoEstado.datos as { abierto: boolean }).abierto).toBe(true);
    const articuloMercado = (mercadoEstado.datos as { objetos: { id: string; owned: boolean }[] }).objetos.find((o) => !o.owned);
    expect(articuloMercado).toBeDefined();
    const compraMercado = await actions["mercado.comprar"]!(papu, { id: articuloMercado!.id });
    expect(compraMercado.ok).toBe(true);

    const walletReal = source.prepare("SELECT ganadas, compradas FROM monedero WHERE user_id = ?").get(userId) as { ganadas: number; compradas: number };
    expect(walletReal).toEqual({ ganadas: 10_000_000, compradas: 10_000_000 });
    const ledger = await query<{ estado: string; revision: number }>(
      "SELECT estado, revision FROM mundo_sandbox WHERE papu_id = ?", userId,
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.revision).toBe(2);
    const sandbox = JSON.parse(ledger[0]!.estado) as { wallet: { ganadas: number; compradas: number }; inventario: string[] };
    expect(sandbox.wallet.compradas).toBeLessThan(10_000_000);
    expect(sandbox.wallet.ganadas).toBeLessThan(10_000_000);
    expect(sandbox.inventario).toContain(articulo!.id);
  });


  it("applies roulette prizes and the level-up bonus only to the sandbox ledger", async () => {
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
      if (/^\\s*(SELECT|UPDATE)/i.test(sql) || /RETURNING/i.test(sql)) {
        return statement.all(...(params as never[])) as unknown as T[];
      }
      statement.run(...(params as never[]));
      return [];
    };
    const userId = "123456789012345678";
    preview.prepare(
      "INSERT INTO mundo_sandbox (papu_id, estado, revision, actualizado_at) VALUES (?, ?, 0, ?)",
    ).run(userId, JSON.stringify({
      version: 1, xp: 0,
      wallet: { ganadas: 0, compradas: 0, ecos: 0, gratis: 0, gratisRaro: 0, gratisLeg: 0, sobres: 0, sinEpica: 0, sinLegendaria: 0, hoy: 0 },
      inventario: [], consumibles: {}, comprasMercado: [],
      ruletaDia: "2026-11-12", ruletaUsadas: 0, pescaAt: 0,
      cuotaExtraDia: "2026-11-12", cuotaExtra: 0, cuotaUsada: 0, subioDia: "",
    }), Date.parse("2026-11-12T12:00:00-03:00"));
    const now = Date.parse("2026-11-12T12:00:00-03:00");
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const quota = new Quota(source, (id, at) => levels.limitFor(id, at), "America/Santiago");
    const rouletteSettings = loadRouletteSettings();
    rouletteSettings.premios = [{
      ...rouletteSettings.premios[0]!,
      tipo: "xp",
      porcentaje: 1,
      peso: 1,
    }];
    const roulette = {
      settings: rouletteSettings,
      dayOf: () => "2026-11-12",
      status: () => ({
        missions: [
          { id: "voz", nombre: "Voz", avance: "0/120 min", done: false },
          { id: "mensajes", nombre: "Mensajes", avance: "0/200", done: false },
          { id: "nivel", nombre: "Subir de nivel", avance: "0/1", done: false },
        ],
        used: 0, left: 1, blocked: false, pending: null, regaladas: 0, guardadas: 0, vozReducida: false,
      }),
      atun: null,
    } as unknown as RouletteService;
    const economy = new EconomiaPlazaPreview({
      query, db: source, levels, coins: null, mercado: null, roulette, quota,
      now: () => now, rnd: () => 0,
    });
    const actions = economy.acciones();
    const papu = { id: userId, nombre: "Papu" };
    const xpRealAntes = levels.store.get(userId).xp;

    const first = await actions["ruleta.girar"]!(papu, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((first.datos as { sandbox: boolean }).sandbox).toBe(true);
    const xpSandbox = JSON.parse((await query<{ estado: string }>(
      "SELECT estado FROM mundo_sandbox WHERE papu_id = ?", userId,
    ))[0]!.estado) as { xp: number; ruletaUsadas: number; subioDia?: string };
    expect(xpSandbox.xp).toBeGreaterThan(xpRealAntes);
    expect(xpSandbox.ruletaUsadas).toBe(1);
    expect(xpSandbox.subioDia).toBe("2026-11-12");
    expect(levels.store.get(userId).xp).toBe(xpRealAntes);

    const state = await actions["ruleta.estado"]!(papu, null);
    expect(state.ok).toBe(true);
    if (state.ok) {
      const data = state.datos as { sandbox: boolean; tiradas: number; misiones: { id: string; hecha: boolean }[] };
      expect(data.sandbox).toBe(true);
      expect(data.tiradas).toBe(1);
      expect(data.misiones.find((m) => m.id === "nivel")?.hecha).toBe(true);
    }

    const bonusSpin = await actions["ruleta.girar"]!(papu, null);
    expect(bonusSpin.ok).toBe(true);
    const exhausted = await actions["ruleta.girar"]!(papu, null);
    expect(exhausted.ok).toBe(false);
    expect(levels.store.get(userId).xp).toBe(xpRealAntes);
  });

});
