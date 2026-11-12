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
  // Los efectos del mercado se ejercitan exclusivamente sobre el ledger sandbox.
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
    let now = Date.parse("2026-11-12T12:00:00-06:00");
    source.prepare("INSERT INTO monedero (user_id, ganadas, compradas) VALUES (?, ?, ?)").run(userId, 10_000_000, 10_000_000);
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


  it("activates the Meiko microphone only once per day and lowers the sandbox voice mission", async () => {
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
      if (/^\s*(SELECT|UPDATE)/i.test(sql) || /RETURNING/i.test(sql)) return statement.all(...(params as never[])) as unknown as T[];
      statement.run(...(params as never[]));
      return [];
    };
    const userId = "123456789012345678";
    let now = Date.parse("2026-11-12T12:00:00-03:00");
    source.prepare("INSERT INTO monedero (user_id, ganadas) VALUES (?, ?)").run(userId, 10_000_000);
    source.prepare("INSERT INTO consumibles (user_id, objeto, usos) VALUES (?, ?, ?)").run(userId, "microfono-meiko", 2);
    source.prepare("INSERT INTO xp_dia (user_id, day, voz_min) VALUES (?, ?, ?)").run(userId, "2026-11-12", 65);
    preview.prepare("INSERT INTO mundo_sandbox (papu_id, estado, revision, actualizado_at) VALUES (?, ?, 0, ?)").run(
      userId,
      JSON.stringify({
        version: 1, xp: 0,
        wallet: { ganadas: 10_000_000, compradas: 0, ecos: 0, gratis: 0, gratisRaro: 0, gratisLeg: 0, sobres: 0, sinEpica: 0, sinLegendaria: 0, hoy: 0 },
        inventario: [], consumibles: { "microfono-meiko": 2 }, comprasMercado: [],
        ruletaDia: "2026-11-12", ruletaUsadas: 0, pescaAt: 0,
        cuotaExtraDia: "2026-11-12", cuotaExtra: 0, cuotaUsada: 0, subioDia: "",
      }),
      now,
    );
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const quota = new Quota(source, (id, at) => levels.limitFor(id, at), "America/Santiago");
    const coins = new CoinService({ db: source, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now });
    const roulette = new RouletteService({ db: source, settings: loadRouletteSettings(), levels, quota, timeZone: "America/Santiago", now: () => now });
    const marketSettings = loadMercadoSettings();
    const mercado = new MercadoService({ db: source, settings: marketSettings, coins, quota, roulette, timeZone: "America/Santiago", now: () => now });
    const economy = new EconomiaPlazaPreview({ query, db: source, levels, coins, mercado, roulette, quota, now: () => now, rnd: () => 0.1 });
    const papu = { id: userId, nombre: "Papu" };
    const usar = economy.acciones()["mercado.usar"]!;
    const activar = await usar(papu, { id: "microfono-meiko" });
    expect(activar.ok).toBe(true);
    const estado = await economy.acciones()["ruleta.estado"]!(papu, null);
    expect(estado.ok).toBe(true);
    if (estado.ok) {
      const voz = (estado.datos as { misiones: { id: string; nombre: string; meta: number; actual: number; hecha: boolean }[] }).misiones.find((m) => m.id === "voz");
      expect(voz).toMatchObject({ nombre: "60 min en voz", meta: 60, actual: 60, hecha: true });
      expect((estado.datos as { tiradas: number }).tiradas).toBe(1);
    }
    const repetido = await usar(papu, { id: "microfono-meiko" });
    expect(repetido.ok).toBe(false);
    const consumibles = source.prepare("SELECT usos FROM consumibles WHERE user_id = ? AND objeto = ?").get(userId, "microfono-meiko") as { usos: number };
    expect(consumibles.usos).toBe(2);
    const ledger = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", userId);
    expect(JSON.parse(ledger[0]!.estado).consumibles["microfono-meiko"]).toBe(1);
  });


});
