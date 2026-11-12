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
import { loadTriviaSettings } from "../../src/trivia/rules";

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
      trivia: loadTriviaSettings(), questionLevels: {}, questionTotals: { facil: 0, medio: 0, dificil: 0 }, timeZone: "America/Santiago",
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
      trivia: loadTriviaSettings(), questionLevels: {}, questionTotals: { facil: 0, medio: 0, dificil: 0 }, timeZone: "America/Santiago",
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
    source.prepare("INSERT INTO xp_dia (user_id, day, voz_min) VALUES (?, ?, ?)").run(userId, "2026-11-11", 120);
    preview.prepare("INSERT INTO mundo_sandbox (papu_id, estado, revision, actualizado_at) VALUES (?, ?, 0, ?)").run(
      userId,
      JSON.stringify({
        version: 1, xp: 0,
        wallet: { ganadas: 10_000_000, compradas: 0, ecos: 0, gratis: 0, gratisRaro: 0, gratisLeg: 0, sobres: 0, sinEpica: 0, sinLegendaria: 0, hoy: 0 },
        inventario: [], consumibles: { "microfono-meiko": 2, "atun-luka": 1 }, comprasMercado: ["disquete-adachi-rei"],
        ruletaDia: "2026-11-11", ruletaUsadas: 0, pescaAt: 0, disqueteProcesadoDia: "2026-11-11", ruletaGuardadas: 0,
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
    const economy = new EconomiaPlazaPreview({ query, db: source, levels, coins, mercado, roulette, quota, now: () => now, rnd: (() => { let roll = 0; return () => roll++ === 0 ? 0.01 : 0.4; })(), trivia: loadTriviaSettings(), questionLevels: {}, questionTotals: { facil: 0, medio: 0, dificil: 0 }, timeZone: "America/Santiago" });
    const papu = { id: userId, nombre: "Papu" };
    const usar = economy.acciones()["mercado.usar"]!;
    const activar = await usar(papu, { id: "microfono-meiko" });
    expect(activar.ok).toBe(true);
    const estado = await economy.acciones()["ruleta.estado"]!(papu, null);
    expect(estado.ok).toBe(true);
    if (estado.ok) {
      const voz = (estado.datos as { misiones: { id: string; nombre: string; meta: number; actual: number; hecha: boolean }[] }).misiones.find((m) => m.id === "voz");
      expect(voz).toMatchObject({ nombre: "60 min en voz", meta: 60, actual: 60, hecha: true });
      expect((estado.datos as { tiradas: number }).tiradas).toBe(2);
      expect((estado.datos as { extras: string[] }).extras.some((x) => x.includes("1 tiradas guardadas"))).toBe(true);
    }
    const repetido = await usar(papu, { id: "microfono-meiko" });
    expect(repetido.ok).toBe(false);
    const consumibles = source.prepare("SELECT usos FROM consumibles WHERE user_id = ? AND objeto = ?").get(userId, "microfono-meiko") as { usos: number };
    expect(consumibles.usos).toBe(2);
    const ledger = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", userId);
    expect(JSON.parse(ledger[0]!.estado).consumibles["microfono-meiko"]).toBe(1);

    const girar = economy.acciones()["ruleta.girar"]!;
    const primerGiro = await girar(papu, null);
    expect(primerGiro.ok).toBe(true);
    if (!primerGiro.ok) return;
    expect((primerGiro.datos as { atun?: { girosRestantes: number } }).atun?.girosRestantes).toBe(2);
    const primerIndex = (primerGiro.datos as { giro: { index: number } }).giro.index;
    const reloaded = new EconomiaPlazaPreview({ query, db: source, levels, coins, mercado, roulette, quota, now: () => now, rnd: () => 0.4, trivia: loadTriviaSettings(), questionLevels: {}, questionTotals: { facil: 0, medio: 0, dificil: 0 }, timeZone: "America/Santiago" });
    await reloaded.preload();
    const estadoRecargado = await reloaded.acciones()["ruleta.estado"]!(papu, null);
    expect(estadoRecargado.ok).toBe(true);
    if (estadoRecargado.ok) expect((estadoRecargado.datos as { atunPendiente?: { girosRestantes: number } }).atunPendiente?.girosRestantes).toBe(2);
    const antesDeAceptar = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", userId);
    expect(JSON.parse(antesDeAceptar[0]!.estado).xp).toBe(0);
    const giroConPremioPendiente = await reloaded.acciones()["ruleta.girar"]!(papu, null);
    expect(giroConPremioPendiente.ok).toBe(true);
    const siguePendiente = await reloaded.acciones()["ruleta.estado"]!(papu, null);
    if (siguePendiente.ok) expect((siguePendiente.datos as { atunPendiente?: unknown }).atunPendiente).toBeUndefined();

    // El siguiente giro reserva otro premio; los descartes no aplican XP ni recompensas hasta aceptar.
    const segundoGiro = await reloaded.acciones()["ruleta.girar"]!(papu, null);
    expect(segundoGiro.ok).toBe(true);
    if (!segundoGiro.ok) return;
    const segundoIndex = (segundoGiro.datos as { giro: { index: number } }).giro.index;
    const descartarRecargado = reloaded.acciones()["ruleta.descartar"]!;
    const primerDescarte = await descartarRecargado(papu, null);
    expect(primerDescarte.ok).toBe(true);
    if (!primerDescarte.ok) return;
    expect((primerDescarte.datos as { giro: { index: number }; atun: { girosRestantes: number } }).giro.index).not.toBe(segundoIndex);
    expect((primerDescarte.datos as { atun: { girosRestantes: number } }).atun.girosRestantes).toBe(1);
    const segundoDescarte = await descartarRecargado(papu, null);
    expect(segundoDescarte.ok).toBe(true);
    if (segundoDescarte.ok) expect((segundoDescarte.datos as { atun: { girosRestantes: number } }).atun.girosRestantes).toBe(0);
    const tercerDescarte = await descartarRecargado(papu, null);
    expect(tercerDescarte.ok).toBe(false);
    const aceptar = await reloaded.acciones()["ruleta.aceptar"]!(papu, null);
    expect(aceptar.ok).toBe(true);
    const ledgerFinal = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", userId);
    const final = JSON.parse(ledgerFinal[0]!.estado) as { consumibles: Record<string, number>; atunPendiente?: unknown; ruletaUsadas: number };
    expect(final.consumibles["atun-luka"]).toBe(0);
    expect(final.atunPendiente).toBeUndefined();
    expect(final.ruletaUsadas).toBe(2);
  });


  it("applies multiplayer trivia XP and completion rewards once in the isolated ledger", async () => {
    const source=openDb(":memory:"), preview=openDb(":memory:"); abiertos.push(source,preview);
    preview.exec(`CREATE TABLE mundo_sandbox (papu_id TEXT PRIMARY KEY, estado TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL);
      CREATE TABLE actividad_perfiles (papu_id TEXT PRIMARY KEY, xp_base INTEGER NOT NULL DEFAULT 0, tope INTEGER NOT NULL DEFAULT 0, pedido_at INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE actividad_aciertos_preview (id INTEGER PRIMARY KEY AUTOINCREMENT, partida TEXT NOT NULL, papu_id TEXT NOT NULL, pregunta TEXT NOT NULL, dificultad TEXT NOT NULL, racha INTEGER NOT NULL, xp_mostrada INTEGER, canal TEXT, creado_at INTEGER NOT NULL, aplicado INTEGER NOT NULL DEFAULT 0, xp INTEGER, multiplicador INTEGER NOT NULL DEFAULT 1);`);
    const query:D1Query=async <T>(sql:string,...params:unknown[]):Promise<T[]>=>{
      const st=preview.prepare(sql);
      if(/RETURNING/i.test(sql)||/^\s*SELECT/i.test(sql))return st.all(...(params as never[])) as unknown as T[];
      st.run(...(params as never[]));return [];
    };
    const user="123456789012345678", now=Date.parse("2026-11-12T12:00:00-03:00");
    const levels=new LevelService({db:source,settings:loadLevelSettings(),timeZone:"America/Santiago"});
    const roulette={dayOf:()=>"2026-11-12"} as unknown as RouletteService;
    preview.prepare("INSERT INTO actividad_aciertos_preview (partida,papu_id,pregunta,dificultad,racha,creado_at,multiplicador) VALUES (?,?,?,?,?,?,?)").run("partida-1",user,"pregunta-1","facil",1,now,2);
    preview.prepare("INSERT INTO actividad_perfiles (papu_id,pedido_at,actualizado_at) VALUES (?,?,0)").run(user,now);
    const economy=new EconomiaPlazaPreview({query,db:source,levels,coins:null,mercado:null,roulette,quota:{} as Quota,now:()=>now,
      trivia:loadTriviaSettings(),questionLevels:{"pregunta-1":"facil"},questionTotals:{facil:1,medio:0,dificil:0},timeZone:"America/Santiago"});
    expect(await economy.syncTrivia()).toBe(1);
    const row=preview.prepare("SELECT aplicado,xp FROM actividad_aciertos_preview").get() as {aplicado:number;xp:number};
    expect(row.aplicado).toBe(1);expect(row.xp).toBe(20);
    const saved=preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id=?").get(user) as {estado:string};
    const state=JSON.parse(saved.estado) as {xp:number;wallet:{gratis:number};triviaSuperadas:string[];triviaPremios:string[]};
    expect(state.xp).toBe(row.xp);expect(state.triviaSuperadas).toContain("pregunta-1");
    expect(state.triviaPremios).toContain("facil");expect(state.wallet.gratis).toBe(1);
    expect(await economy.syncTrivia()).toBe(0);
    const again=preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id=?").get(user) as {estado:string};
    expect(JSON.parse(again.estado).xp).toBe(row.xp);
  });

  it("PC de Adachi reinicia topes y contadores solo en el ledger sandbox", async () => {
    const source=openDb(":memory:"), preview=openDb(":memory:"); abiertos.push(source,preview);
    preview.exec("CREATE TABLE mundo_sandbox (papu_id TEXT PRIMARY KEY, estado TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL); CREATE TABLE mundo_perfiles (papu_id TEXT PRIMARY KEY, pedido_at INTEGER NOT NULL DEFAULT 0)");
    preview.exec("CREATE TABLE actividad_perfiles (papu_id TEXT PRIMARY KEY, xp_base INTEGER NOT NULL DEFAULT 0, tope INTEGER NOT NULL DEFAULT 0, pedido_at INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL DEFAULT 0)");
    const query:D1Query=async <T>(sql:string,...params:unknown[]):Promise<T[]>=>{
      const st=preview.prepare(sql);
      if(/RETURNING/i.test(sql)||/^\s*SELECT/i.test(sql))return st.all(...(params as never[])) as unknown as T[];
      st.run(...(params as never[]));return [];
    };
    const user="123456789012345678",now=Date.parse("2026-11-12T12:00:00-03:00"),day="2026-11-12";
    const state={version:1,xp:900,wallet:{ganadas:0,compradas:0,ecos:0,gratis:0,gratisRaro:0,gratisLeg:0,sobres:0,sinEpica:0,sinLegendaria:0,hoy:0},inventario:[],consumibles:{"pc-adachi-rei":1},comprasMercado:[],ruletaDia:day,ruletaUsadas:2,ruletaRegaloDia:day,ruletaRegalos:2,pescaAt:0,cuotaExtraDia:day,cuotaExtra:0,cuotaUsada:5,triviaDia:day,triviaXpDia:30,triviaPartidasDia:["partida-antigua"]};
    preview.prepare("INSERT INTO mundo_sandbox (papu_id,estado,revision,actualizado_at) VALUES (?,?,0,?)").run(user,JSON.stringify(state),now);
    const levels=new LevelService({db:source,settings:loadLevelSettings(),timeZone:"America/Santiago"});
    const roulette={dayOf:()=>day,status:()=>({used:3,left:0,blocked:false,missions:[]})} as unknown as RouletteService;
    const quota={used:()=>12,donated:()=>0} as unknown as Quota;
    const economy=new EconomiaPlazaPreview({query,db:source,levels,coins:null,mercado:{byId:new Map()} as unknown as MercadoService,roulette,quota,now:()=>now,
      trivia:loadTriviaSettings(),questionLevels:{},questionTotals:{facil:0,medio:0,dificil:0},timeZone:"America/Santiago"});
    const result=await economy.acciones()["mercado.usar"]!({id:user,nombre:"Papu"},{id:"pc-adachi-rei"});
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const saved=preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id=?").get(user) as {estado:string};
    const next=JSON.parse(saved.estado) as typeof state & {ruletaResetUsadas:number;cuotaResetBase:number};
    expect(next.xp).toBe(900);expect(next.triviaXpDia).toBe(0);expect(next.triviaPartidasDia).toEqual([]);
    expect(next.ruletaUsadas).toBe(0);expect(next.ruletaResetUsadas).toBe(3);expect(next.cuotaResetBase).toBe(12);expect(next.ruletaRegalos).toBe(2);
    expect(next.cuotaUsada).toBe(0);expect(next.consumibles["pc-adachi-rei"]).toBe(0);
  });


  it("credits activity coins from sandbox XP and PC resets only the sandbox activity cap", async () => {
    const source = openDb(":memory:");
    const preview = openDb(":memory:");
    abiertos.push(source, preview);
    preview.exec("CREATE TABLE mundo_sandbox (papu_id TEXT PRIMARY KEY, estado TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL); CREATE TABLE actividad_perfiles (papu_id TEXT PRIMARY KEY, xp_base INTEGER NOT NULL DEFAULT 0, tope INTEGER NOT NULL DEFAULT 0, pedido_at INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL DEFAULT 0)");
    const query: D1Query = async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      const statement = preview.prepare(sql);
      if (/RETURNING/i.test(sql) || /^\s*SELECT/i.test(sql)) return statement.all(...(params as never[])) as unknown as T[];
      statement.run(...(params as never[]));
      return [];
    };
    const user = "123456789012345678";
    const day = "2026-11-12";
    let now = Date.parse("2026-11-12T12:00:00-03:00");
    source.prepare("INSERT INTO monedero (user_id, ganadas) VALUES (?, 0)").run(user);
    source.prepare("INSERT INTO consumibles (user_id, objeto, usos) VALUES (?, ?, 1)").run(user, "pc-adachi-rei");
    const coinSettings = loadCoinSettings();
    coinSettings.ganar.xpPorMoneda = 1;
    coinSettings.ganar.topeActividad = 2;
    coinSettings.ganar.subirNivel = 0;
    coinSettings.ganar.rangoNuevo = 0;
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const coins = new CoinService({ db: source, settings: coinSettings, catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now });
    const roulette = { dayOf: () => day, status: () => ({ used: 0, left: 0, blocked: false, missions: [] }) } as unknown as RouletteService;
    const quota = { used: () => 0, donated: () => 0 } as unknown as Quota;
    const economy = new EconomiaPlazaPreview({
      query, db: source, levels, coins, mercado: { byId: new Map() } as unknown as MercadoService,
      roulette, quota, now: () => now, rnd: () => 0.99, trivia: loadTriviaSettings(),
      questionLevels: {}, questionTotals: { facil: 0, medio: 0, dificil: 0 }, timeZone: "America/Santiago",
    });
    const fish = economy.acciones()["pesca.capturar"]!;
    const first = await fish({ id: user, nombre: "Papu" }, null);
    expect(first.ok).toBe(true);
    let row = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", user);
    const firstCoins = JSON.parse(row[0]!.estado).wallet.ganadas as number;
    expect(firstCoins).toBeGreaterThan(0);

    // El PC conserva lo ya ganado, pero abre un nuevo tramo con su propio tope de actividad.
    const reset = await economy.acciones()["mercado.usar"]!({ id: user, nombre: "Papu" }, { id: "pc-adachi-rei" });
    expect(reset.ok).toBe(true);
    now += 30_001;
    const second = await fish({ id: user, nombre: "Papu" }, null);
    expect(second.ok).toBe(true);
    row = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", user);
    const finalCoins = JSON.parse(row[0]!.estado).wallet.ganadas as number;
    expect(finalCoins).toBeGreaterThan(firstCoins);
    expect(finalCoins).toBeLessThanOrEqual(firstCoins + 2);
    const real = source.prepare("SELECT ganadas FROM monedero WHERE user_id = ?").get(user) as { ganadas: number };
    expect(real.ganadas).toBe(0);
  });

  it("recovers a trivia acierto if the ledger CAS commits but marking the D1 row fails", async () => {
    const source = openDb(":memory:");
    const preview = openDb(":memory:");
    abiertos.push(source, preview);
    preview.exec(`
      CREATE TABLE mundo_sandbox (papu_id TEXT PRIMARY KEY, estado TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL);
      CREATE TABLE mundo_perfiles (papu_id TEXT PRIMARY KEY, pedido_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE actividad_perfiles (papu_id TEXT PRIMARY KEY, xp_base INTEGER NOT NULL DEFAULT 0, tope INTEGER NOT NULL DEFAULT 0, pedido_at INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE actividad_aciertos_preview (id INTEGER PRIMARY KEY AUTOINCREMENT, partida TEXT NOT NULL, papu_id TEXT NOT NULL, pregunta TEXT NOT NULL, dificultad TEXT NOT NULL, racha INTEGER NOT NULL, xp_mostrada INTEGER, canal TEXT, creado_at INTEGER NOT NULL, aplicado INTEGER NOT NULL DEFAULT 0, xp INTEGER, multiplicador INTEGER NOT NULL DEFAULT 1);
    `);
    let failMark = true;
    const query: D1Query = async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      if (/UPDATE actividad_aciertos_preview/i.test(sql) && failMark) {
        failMark = false;
        throw new Error("simulated D1 interruption after ledger commit");
      }
      const statement = preview.prepare(sql);
      if (/RETURNING/i.test(sql) || /^\s*SELECT/i.test(sql)) return statement.all(...(params as never[])) as unknown as T[];
      statement.run(...(params as never[]));
      return [];
    };
    const user = "123456789012345678";
    const now = Date.parse("2026-11-12T12:00:00-03:00");
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const roulette = { dayOf: () => "2026-11-12" } as unknown as RouletteService;
    preview.prepare("INSERT INTO actividad_aciertos_preview (partida,papu_id,pregunta,dificultad,racha,creado_at,multiplicador) VALUES (?,?,?,?,?,?,?)")
      .run("partida-reintento", user, "pregunta-reintento", "facil", 1, now, 1);
    const economy = new EconomiaPlazaPreview({
      query, db: source, levels, coins: null, mercado: null, roulette, quota: {} as Quota,
      now: () => now, trivia: loadTriviaSettings(), questionLevels: { "pregunta-reintento": "facil" },
      questionTotals: { facil: 1, medio: 0, dificil: 0 }, timeZone: "America/Santiago",
    });

    await expect(economy.syncTrivia()).rejects.toThrow("simulated D1 interruption after ledger commit");
    const first = preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id = ?").get(user) as { estado: string };
    const afterCommit = JSON.parse(first.estado) as { xp: number; triviaAciertosResultados: Record<string, number>; wallet: { gratis: number } };
    expect(afterCommit.xp).toBe(10);
    expect(afterCommit.triviaAciertosResultados["1"]).toBe(10);
    expect(afterCommit.wallet.gratis).toBe(1);

    expect(await economy.syncTrivia()).toBe(1);
    const row = preview.prepare("SELECT aplicado, xp FROM actividad_aciertos_preview WHERE id = 1").get() as { aplicado: number; xp: number };
    const final = preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id = ?").get(user) as { estado: string };
    expect(row).toEqual({ aplicado: 1, xp: 10 });
    expect((JSON.parse(final.estado) as { xp: number; wallet: { gratis: number } })).toMatchObject({ xp: 10, wallet: { gratis: 1 } });
  });

  it("does not advance hitos in a non-XP run when the setting restricts them", async () => {
    const source = openDb(":memory:");
    const preview = openDb(":memory:");
    abiertos.push(source, preview);
    preview.exec(`
      CREATE TABLE mundo_sandbox (papu_id TEXT PRIMARY KEY, estado TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL);
      CREATE TABLE mundo_perfiles (papu_id TEXT PRIMARY KEY, pedido_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE actividad_perfiles (papu_id TEXT PRIMARY KEY, xp_base INTEGER NOT NULL DEFAULT 0, tope INTEGER NOT NULL DEFAULT 0, pedido_at INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE actividad_aciertos_preview (id INTEGER PRIMARY KEY AUTOINCREMENT, partida TEXT NOT NULL, papu_id TEXT NOT NULL, pregunta TEXT NOT NULL, dificultad TEXT NOT NULL, racha INTEGER NOT NULL, xp_mostrada INTEGER, canal TEXT, creado_at INTEGER NOT NULL, aplicado INTEGER NOT NULL DEFAULT 0, xp INTEGER, multiplicador INTEGER NOT NULL DEFAULT 1);
    `);
    const query: D1Query = async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      const statement = preview.prepare(sql);
      if (/RETURNING/i.test(sql) || /^\s*SELECT/i.test(sql)) return statement.all(...(params as never[])) as unknown as T[];
      statement.run(...(params as never[]));
      return [];
    };
    const user = "123456789012345678";
    const now = Date.parse("2026-11-12T12:00:00-03:00");
    const day = "2026-11-12";
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const roulette = { dayOf: () => day } as unknown as RouletteService;
    const settings = loadTriviaSettings();
    settings.limites.partidasConXp = 1;
    settings.hitos = { soloPartidasConXp: true };
    const state = {
      version: 1, xp: 0,
      wallet: { ganadas: 0, compradas: 0, ecos: 0, gratis: 0, gratisRaro: 0, gratisLeg: 0, sobres: 0, sinEpica: 0, sinLegendaria: 0, hoy: 0 },
      inventario: [], consumibles: {}, comprasMercado: [], ruletaDia: day, ruletaUsadas: 0, pescaAt: 0,
      cuotaExtraDia: day, cuotaExtra: 0, cuotaUsada: 0, subioDia: "",
      triviaDia: day, triviaXpDia: 0, triviaPartidasDia: ["legacy:partida-ya-contada"],
      triviaSuperadas: [], triviaPremios: [], triviaHitos: { facil: { aciertos: 199, premios: 0 } }, triviaAciertosAplicados: [],
    };
    preview.prepare("INSERT INTO mundo_sandbox (papu_id,estado,revision,actualizado_at) VALUES (?,?,0,?)").run(user, JSON.stringify(state), now);
    preview.prepare("INSERT INTO actividad_aciertos_preview (partida,papu_id,pregunta,dificultad,racha,creado_at,multiplicador) VALUES (?,?,?,?,?,?,?)")
      .run("partida-sin-xp", user, "pregunta-unica", "facil", 1, now, 1);
    const economy = new EconomiaPlazaPreview({
      query, db: source, levels, coins: null, mercado: null, roulette, quota: {} as Quota,
      now: () => now, trivia: settings, questionLevels: { "pregunta-unica": "facil" },
      questionTotals: { facil: 1, medio: 0, dificil: 0 }, timeZone: "America/Santiago",
    });

    expect(await economy.syncTrivia()).toBe(1);
    const row = preview.prepare("SELECT xp FROM actividad_aciertos_preview").get() as { xp: number };
    const saved = preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id = ?").get(user) as { estado: string };
    const result = JSON.parse(saved.estado) as { xp: number; wallet: { gratis: number }; triviaHitos: { facil: { aciertos: number } } };
    expect(row.xp).toBe(0);
    expect(result.xp).toBe(0);
    expect(result.triviaHitos.facil.aciertos).toBe(199);
    expect(result.wallet.gratis).toBe(1);
  });

  it("transfers a gifted roulette spin only between sandbox ledgers", async () => {
    const source=openDb(":memory:"),preview=openDb(":memory:");abiertos.push(source,preview);
    preview.exec("CREATE TABLE mundo_sandbox (papu_id TEXT PRIMARY KEY, estado TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL); CREATE TABLE mundo_perfiles (papu_id TEXT PRIMARY KEY, pedido_at INTEGER NOT NULL DEFAULT 0)");
    preview.exec("CREATE TABLE actividad_perfiles (papu_id TEXT PRIMARY KEY, xp_base INTEGER NOT NULL DEFAULT 0, tope INTEGER NOT NULL DEFAULT 0, pedido_at INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL DEFAULT 0)");
    const query:D1Query=async <T>(sql:string,...params:unknown[]):Promise<T[]>=>{const st=preview.prepare(sql);if(/RETURNING/i.test(sql)||/^\s*SELECT/i.test(sql))return st.all(...(params as never[])) as unknown as T[];st.run(...(params as never[]));return [];};
    const sender="123456789012345678",recipient="223456789012345678",now=Date.parse("2026-11-12T12:00:00-03:00"),day="2026-11-12";
    const state=(uses:number)=>({version:1,xp:100,wallet:{ganadas:0,compradas:0,ecos:0,gratis:0,gratisRaro:0,gratisLeg:0,sobres:0,sinEpica:0,sinLegendaria:0,hoy:0},inventario:[],consumibles:{"regalo-rin-len":uses},comprasMercado:[],ruletaDia:day,ruletaUsadas:0,pescaAt:0,cuotaExtraDia:day,cuotaExtra:0,cuotaUsada:0});
    preview.prepare("INSERT INTO mundo_sandbox (papu_id,estado,revision,actualizado_at) VALUES (?,?,0,?)").run(sender,JSON.stringify(state(1)),now);
    preview.prepare("INSERT INTO mundo_sandbox (papu_id,estado,revision,actualizado_at) VALUES (?,?,0,?)").run(recipient,JSON.stringify(state(0)),now);
    preview.prepare("INSERT INTO mundo_perfiles (papu_id,pedido_at) VALUES (?,0)").run(recipient);
    const levels=new LevelService({db:source,settings:loadLevelSettings(),timeZone:"America/Santiago"});
    const roulette={dayOf:()=>day,status:()=>({used:0,left:0,blocked:false,missions:[]})} as unknown as RouletteService;
    const economy=new EconomiaPlazaPreview({query,db:source,levels,coins:null,mercado:{byId:new Map()} as unknown as MercadoService,roulette,quota:{} as Quota,now:()=>now,
      trivia:loadTriviaSettings(),questionLevels:{},questionTotals:{facil:0,medio:0,dificil:0},timeZone:"America/Santiago"});
    const result=await economy.acciones()["mercado.usar"]!({id:sender,nombre:"Remitente"},{id:"regalo-rin-len",para:recipient});
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const from=JSON.parse((preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id=?").get(sender) as {estado:string}).estado);
    const to=JSON.parse((preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id=?").get(recipient) as {estado:string}).estado);
    expect(from.consumibles["regalo-rin-len"]).toBe(0);expect(to.ruletaRegalos).toBe(1);expect(to.ruletaRegaloDia).toBe(day);
  });

  it("delivers Rin and Len gifts as isolated daily spins and deduplicates retries", async () => {
    const source = openDb(":memory:");
    const preview = openDb(":memory:");
    abiertos.push(source, preview);
    preview.exec(`
      CREATE TABLE mundo_sandbox (papu_id TEXT PRIMARY KEY, estado TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL);
      CREATE TABLE mundo_perfiles (papu_id TEXT PRIMARY KEY, pedido_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE actividad_perfiles (papu_id TEXT PRIMARY KEY, xp_base INTEGER NOT NULL DEFAULT 0, tope INTEGER NOT NULL DEFAULT 0, pedido_at INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE actividad_aciertos_preview (id INTEGER PRIMARY KEY AUTOINCREMENT, partida TEXT NOT NULL, papu_id TEXT NOT NULL, pregunta TEXT NOT NULL, dificultad TEXT NOT NULL, racha INTEGER NOT NULL, xp_mostrada INTEGER, canal TEXT, creado_at INTEGER NOT NULL, aplicado INTEGER NOT NULL DEFAULT 0, xp INTEGER, multiplicador INTEGER NOT NULL DEFAULT 1);
    `);
    const query: D1Query = async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      const statement = preview.prepare(sql);
      if (/RETURNING/i.test(sql) || /^\s*SELECT/i.test(sql)) return statement.all(...(params as never[])) as unknown as T[];
      statement.run(...(params as never[]));
      return [];
    };
    const sender = "123456789012345678";
    const target = "223456789012345678";
    const now = Date.parse("2026-11-12T12:00:00-03:00");
    preview.prepare("INSERT INTO mundo_perfiles (papu_id,pedido_at) VALUES (?,0)").run(target);
    source.prepare("INSERT INTO monedero (user_id, ganadas) VALUES (?, ?)").run(sender, 10_000);
    source.prepare("INSERT INTO consumibles (user_id, objeto, usos) VALUES (?, ?, ?)").run(sender, "regalo-rin-len", 2);
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const quota = new Quota(source, (id, at) => levels.limitFor(id, at), "America/Santiago");
    const coins = new CoinService({ db: source, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now });
    const roulette = new RouletteService({ db: source, settings: loadRouletteSettings(), levels, quota, timeZone: "America/Santiago", now: () => now });
    const mercado = new MercadoService({ db: source, settings: loadMercadoSettings(), coins, quota, roulette, timeZone: "America/Santiago", now: () => now });
    const economy = new EconomiaPlazaPreview({ query, db: source, levels, coins, mercado, roulette, quota, now: () => now, trivia: loadTriviaSettings(), questionLevels: {}, questionTotals: { facil: 0, medio: 0, dificil: 0 }, timeZone: "America/Santiago" });
    const usar = economy.acciones()["mercado.usar"]!;
    const result = await usar({ id: sender, nombre: "Remitente" }, { id: "regalo-rin-len", para: target });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const senderRow = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", sender);
    const targetRow = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", target);
    const from = JSON.parse(senderRow[0]!.estado) as { consumibles: Record<string, number>; regalosPendientes?: Record<string, unknown> };
    const to = JSON.parse(targetRow[0]!.estado) as { ruletaRegaloDia: string; ruletaRegalos: number; regalosRecibidos: string[] };
    expect(from.consumibles["regalo-rin-len"]).toBe(1);
    expect(from.regalosPendientes).toBeUndefined();
    expect(to).toMatchObject({ ruletaRegaloDia: "2026-11-12", ruletaRegalos: 1 });
    expect(to.regalosRecibidos).toHaveLength(1);

    // Simula caída después de acreditar al destinatario pero antes de limpiar la cola del remitente.
    const giftId = "gift-replay";
    from.consumibles["regalo-rin-len"] = 0;
    from.regalosPendientes = {
      [giftId]: { para: target, day: "2026-11-12" },
      "gift-expirado": { para: target, day: "2026-11-11" },
    };
    to.regalosRecibidos.push(giftId);
    preview.prepare("UPDATE mundo_sandbox SET estado = ?, revision = revision + 1 WHERE papu_id = ?").run(JSON.stringify(from), sender);
    preview.prepare("UPDATE mundo_sandbox SET estado = ?, revision = revision + 1 WHERE papu_id = ?").run(JSON.stringify(to), target);
    await economy.syncTrivia();
    const after = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", target);
    const received = JSON.parse(after[0]!.estado) as { ruletaRegalos: number };
    expect(received.ruletaRegalos).toBe(1);
    const senderAfter = await query<{ estado: string }>("SELECT estado FROM mundo_sandbox WHERE papu_id = ?", sender);
    const senderState = JSON.parse(senderAfter[0]!.estado) as { consumibles: Record<string, number>; regalosPendientes?: Record<string, unknown> };
    expect(senderState.consumibles["regalo-rin-len"]).toBe(1);
    expect(senderState.regalosPendientes).toBeUndefined();
  });
  it("locks consumable use while an Atun prize is pending and supports explicit acceptance", async () => {
    const source = openDb(":memory:");
    const preview = openDb(":memory:");
    abiertos.push(source, preview);
    preview.exec("CREATE TABLE mundo_sandbox (papu_id TEXT PRIMARY KEY, estado TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL)");
    const query: D1Query = async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      const statement = preview.prepare(sql);
      if (/RETURNING/i.test(sql) || /^\s*SELECT/i.test(sql)) return statement.all(...(params as never[])) as unknown as T[];
      statement.run(...(params as never[]));
      return [];
    };
    const user = "123456789012345678";
    const now = Date.parse("2026-11-12T12:00:00-03:00");
    const day = "2026-11-12";
    const levels = new LevelService({ db: source, settings: loadLevelSettings(), timeZone: "America/Santiago" });
    const roulette = { dayOf: () => day } as unknown as RouletteService;
    const state = {
      version: 1, xp: 0,
      wallet: { ganadas: 100, compradas: 0, ecos: 0, gratis: 0, gratisRaro: 0, gratisLeg: 0, sobres: 0, sinEpica: 0, sinLegendaria: 0, hoy: 0 },
      inventario: [], consumibles: { "microfono-meiko": 1 }, comprasMercado: [],
      ruletaDia: day, ruletaUsadas: 1, pescaAt: 0, cuotaExtraDia: day, cuotaExtra: 0, cuotaUsada: 0, subioDia: "",
      atunPendiente: { day, index: 0, giros: 0, gastoUso: false, xp: 10, mensajes: 0, sobres: 0, nivelAntes: 1 },
    };
    preview.prepare("INSERT INTO mundo_sandbox (papu_id,estado,revision,actualizado_at) VALUES (?,?,0,?)").run(user, JSON.stringify(state), now);
    const economy = new EconomiaPlazaPreview({ query, db: source, levels, coins: null, mercado: { byId: new Map() } as unknown as MercadoService, roulette, quota: {} as Quota, now: () => now, trivia: loadTriviaSettings(), questionLevels: {}, questionTotals: { facil: 0, medio: 0, dificil: 0 }, timeZone: "America/Santiago" });
    const usar = economy.acciones()["mercado.usar"]!;
    const blocked = await usar({ id: user, nombre: "Papu" }, { id: "microfono-meiko" });
    expect(blocked.ok).toBe(false);
    const before = preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id = ?").get(user) as { estado: string };
    expect((JSON.parse(before.estado) as { consumibles: Record<string, number> }).consumibles["microfono-meiko"]).toBe(1);
    const accepted = await economy.acciones()["ruleta.aceptar"]!({ id: user, nombre: "Papu" }, null);
    expect(accepted.ok).toBe(true);
    const after = preview.prepare("SELECT estado FROM mundo_sandbox WHERE papu_id = ?").get(user) as { estado: string };
    expect((JSON.parse(after.estado) as { atunPendiente?: unknown }).atunPendiente).toBeUndefined();
  });
});
