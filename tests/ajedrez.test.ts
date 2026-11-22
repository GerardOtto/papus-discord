import { describe, expect, it } from "vitest";
import { aplicar, buscarJugada, clavePosicion, escribirFen, final, INICIAL, leerFen, legales, perft, uci } from "../src/ajedrez/motor";

const jugar = (fen: string, ...js: string[]) => js.reduce((p, x) => aplicar(p, buscarJugada(p, x)!), leerFen(fen));

describe("motor de ajedrez (idea de Mango9374; 18 nov. 2026)", () => {
  it("perft de la posición inicial: 20, 400, 8.902", () => {
    const p = leerFen(INICIAL);
    expect([1, 2, 3].map((n) => perft(p, n))).toEqual([20, 400, 8902]);
  });

  it("perft de Kiwipete (enroques, al paso, coronaciones y clavadas): 48, 2.039, 97.862", () => {
    const p = leerFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    expect([1, 2, 3].map((n) => perft(p, n))).toEqual([48, 2039, 97862]);
  });

  it("perft de las posiciones 3 y 4 de la wiki de programación de ajedrez", () => {
    expect([1, 2, 3, 4].map((n) => perft(leerFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), n))).toEqual([14, 191, 2812, 43238]);
    expect([1, 2, 3].map((n) => perft(leerFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"), n))).toEqual([6, 264, 9467]);
  });

  it("FEN de ida y vuelta", () => {
    for (const f of [INICIAL, "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", "8/8/8/3pP3/8/8/8/k6K w - d6 0 3"]) expect(escribirFen(leerFen(f))).toBe(f);
  });

  it("mate del pastor, ahogado, tablas por material y repetición", () => {
    const mate = jugar(INICIAL, "e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7");
    expect(final(mate)).toBe("jaque_mate");
    expect(final(leerFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"))).toBe("ahogado");
    expect(final(leerFen("8/8/8/4k3/8/8/2B5/4K3 w - - 0 1"))).toBe("material");
    expect(final(leerFen(INICIAL), 3)).toBe("repeticion");
    expect(final(leerFen(INICIAL))).toBeNull();
  });

  it("jugadas UCI: inválidas no; corona a dama si no se dice", () => {
    const p = leerFen(INICIAL);
    expect(buscarJugada(p, "e2e5")).toBeNull();
    expect(buscarJugada(p, "hola")).toBeNull();
    const c = leerFen("8/P7/8/8/8/8/8/k6K w - - 0 1");
    expect(buscarJugada(c, "a7a8")?.corona).toBe("q");
    expect(buscarJugada(c, "a7a8n")?.corona).toBe("n");
    expect(legales(p).map(uci)).toContain("g1f3");
    expect(clavePosicion(jugar(INICIAL, "g1f3", "g8f6", "f3g1", "f6g8"))).toBe(clavePosicion(p));
  });
});

describe("los Vocaloids juegan ajedrez (en el navegador)", () => {
  it("dan mate en una si pueden (niveles 2 y 3) y se comen una dama regalada", async () => {
    const { elegirJugada } = await import("../src/ajedrez/ia");
    const mateEn1 = leerFen("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1");
    for (const n of [2, 3] as const) expect(uci(elegirJugada(mateEn1, n, () => 0)!)).toBe("d1d8");
    const dama = leerFen("4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1");
    for (const n of [2, 3] as const) expect(uci(elegirJugada(dama, n, () => 0)!)).toBe("d1d5");
  });

  it("siempre juegan legal y el nivel difícil responde rápido desde la posición inicial", async () => {
    const { elegirJugada } = await import("../src/ajedrez/ia");
    let p = leerFen(INICIAL);
    const t0 = Date.now();
    for (let k = 0; k < 6 && !final(p); k++) {
      const j = elegirJugada(p, 3, () => 0.5)!;
      expect(legales(p).map(uci)).toContain(uci(j));
      p = aplicar(p, j);
    }
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
});

describe("partidas entre Papus (D1 del worker)", () => {
  async function setup() {
    const { DatabaseSync } = await import("node:sqlite");
    const { readFileSync } = await import("node:fs");
    const { sqliteSql } = await import("../src/cloud/sql");
    const { Partidas } = await import("../src/ajedrez/partidas");
    const s = JSON.parse(readFileSync("config/ajedrez.json", "utf8"));
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("worker/schema.sql", "utf8"));
    let t = 1_800_000_000_000;
    const P = new Partidas(sqliteSql(db), s, { now: () => t, rnd: () => 0.1 });
    return { P, db, s, avanzar: (ms: number) => (t += ms) };
  }
  const ana = { id: "ana", nombre: "Ana" }, beto = { id: "beto", nombre: "Beto" };

  it("reto sin apuesta: se sortean colores, se juega por turnos y el mate termina la partida", async () => {
    const { P } = await setup();
    const r = await P.retar(ana, beto, 0);
    expect(r.estado).toBe("reto");
    await expect(P.retar(ana, { id: "cata", nombre: "Cata" }, 0)).rejects.toThrow(/en curso/);
    await expect(P.responder(r.id, "ana", "aceptar")).rejects.toThrow(/otro Papu/);
    const v = await P.responder(r.id, "beto", "aceptar");
    expect(v.estado).toBe("jugando");
    const blanco = v.blanco!, negro = blanco === "ana" ? "beto" : "ana";
    await expect(P.jugar(r.id, negro, "e7e5")).rejects.toThrow(/turno/);
    await expect(P.jugar(r.id, blanco, "e2e5")).rejects.toThrow(/no se puede/);
    for (const [quien, j] of [[blanco, "e2e4"], [negro, "e7e5"], [blanco, "f1c4"], [negro, "b8c6"], [blanco, "d1h5"], [negro, "g8f6"], [blanco, "h5f7"]] as const) await P.jugar(r.id, quien, j);
    const fin = await P.ver(r.id, "ana");
    expect(fin).toMatchObject({ estado: "terminada", ganador: blanco, motivo: "jaque_mate" });
    expect(fin.jugadas).toHaveLength(7);
  });

  it("con apuesta espera a Neru; el reloj en cero pierde; rendirse; retos que vencen", async () => {
    const { P, db, s, avanzar } = await setup();
    await expect(P.retar(ana, beto, 5)).rejects.toThrow(/apuesta/);
    const r = await P.retar(ana, beto, 100);
    expect((await P.responder(r.id, "beto", "aceptar")).estado).toBe("aceptada");
    await expect(P.jugar(r.id, "ana", "e2e4")).rejects.toThrow(/todavía no empieza/);
    db.prepare("UPDATE ajedrez_partidas SET estado = 'jugando', cobrada = 1, turno_desde = ? WHERE id = ?").run(1_800_000_000_000, r.id);
    avanzar(s.relojMin * 60_000 + 1);
    const v = await P.ver(r.id, "beto");
    expect(v).toMatchObject({ estado: "terminada", motivo: "tiempo" });
    expect(v.ganador).not.toBe(v.blanco);
    const r2 = await P.retar(ana, beto, 0);
    const v2 = await P.responder(r2.id, "beto", "aceptar");
    expect((await P.rendirse(r2.id, "ana")).ganador).toBe("beto");
    expect(v2.estado).toBe("jugando");
    const r3 = await P.retar(ana, beto, 0);
    avanzar(s.retoMin * 60_000);
    expect((await P.ver(r3.id, "ana")).estado).toBe("vencida");
  });
});

describe("Neru cobra, paga y avisa (VM)", () => {
  async function setup() {
    const { DatabaseSync } = await import("node:sqlite");
    const { readFileSync } = await import("node:fs");
    const { sqliteSql } = await import("../src/cloud/sql");
    const { Partidas } = await import("../src/ajedrez/partidas");
    const { AjedrezPuente, loadAjedrezSettings } = await import("../src/ajedrez/puente");
    const { CoinService } = await import("../src/coins/service");
    const { loadCatalog, loadCoinSettings } = await import("../src/coins/rules");
    const { memDb } = await import("./helpers");
    const s = loadAjedrezSettings();
    const d1 = new DatabaseSync(":memory:");
    d1.exec(readFileSync("worker/schema.sql", "utf8"));
    const query = async <T>(sql: string, ...p: unknown[]) => d1.prepare(sql).all(...(p as (string | number | null)[])) as unknown as T[];
    const db = memDb();
    const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago" });
    const P = new Partidas(sqliteSql(d1), s, { rnd: () => 0.1 });
    const neru = new AjedrezPuente({ db, query, coins, settings: s });
    return { P, neru, coins, s, d1 };
  }
  const ana = { id: "ana", nombre: "Ana" }, beto = { id: "beto", nombre: "Beto" };

  it("avisa el reto, cobra a los dos, paga al ganador menos la comisión y avisa el resultado", async () => {
    const { P, neru, coins, s } = await setup();
    coins.adjust("ana", "monedas", 500, "t");
    coins.adjust("beto", "monedas", 500, "t");
    const r = await P.retar(ana, beto, 200);
    const a1 = await neru.tick();
    expect(a1).toHaveLength(1);
    expect(a1[0]!).toMatchObject({ tipo: "reto", menciones: ["beto"] });
    expect(await neru.tick()).toEqual([]);
    await P.responder(r.id, "beto", "aceptar");
    await neru.tick();
    expect(coins.wallet("ana").monedas).toBe(300);
    expect(coins.wallet("beto").monedas).toBe(300);
    expect((await P.ver(r.id, "ana")).estado).toBe("jugando");
    await P.rendirse(r.id, "beto");
    const a2 = await neru.tick();
    expect(a2.map((x) => x.tipo)).toEqual(["resultado"]);
    expect(coins.wallet("ana").monedas).toBe(300 + Math.floor(400 * (1 - s.comision)));
    expect(coins.wallet("beto").monedas).toBe(300);
    await neru.tick();
    expect(coins.wallet("ana").monedas).toBe(300 + Math.floor(400 * (1 - s.comision)));
  });

  it("si a uno no le alcanza, se cancela y nadie pierde", async () => {
    const { P, neru, coins } = await setup();
    coins.adjust("ana", "monedas", 500, "t");
    coins.adjust("beto", "monedas", 50, "t");
    const r = await P.retar(ana, beto, 200);
    await P.responder(r.id, "beto", "aceptar");
    const av = await neru.tick();
    expect(av.some((x) => x.tipo === "cancelada")).toBe(true);
    expect((await P.ver(r.id, "ana")).estado).toBe("cancelada");
    expect(coins.wallet("ana").monedas).toBe(500);
    expect(coins.wallet("beto").monedas).toBe(50);
  });
});
