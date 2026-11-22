import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { avatarPng, bannerImage, shotGif, shotGifMs, turnImage } from "../src/nemesis/images";
import { chanceAt, checkApuesta, loadNemesisSettings, reparto, shooterAt } from "../src/nemesis/rules";
import { NemesisService } from "../src/nemesis/service";
import { memDb, seededRng } from "./helpers";

const S = loadNemesisSettings();

function setup(rnd = seededRng(7)) {
  const db = memDb();
  let now = Date.UTC(2026, 10, 12, 20, 0);
  const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: "America/Santiago", now: () => now });
  const svc = new NemesisService({ db, settings: S, coins, now: () => now, rnd });
  coins.adjust("a", "monedas", 2000, "test");
  coins.adjust("b", "monedas", 2000, "test");
  return { db, coins, svc, advance: (ms: number) => (now += ms) };
}

/** Juega hasta el ¡BANG! y devuelve el último disparo. */
function playOut(svc: NemesisService, id: string) {
  for (let k = 0; k < S.recamaras; k++) {
    const x = svc.get(id)!;
    const r = svc.pull(id, x.turno, svc.shooter(x));
    if (!r.ok) throw new Error(r.motivo);
    if (r.disparo.bang) return r.disparo;
  }
  throw new Error("nunca salió la bala");
}

describe("reglas de la Ruleta de Némesis", () => {
  it("config de GyroP: de 10 a 1.000 ganadas, Némesis cobra el 20 %, 6 recámaras", () => {
    expect(S.activo).toBe(true);
    expect(S.apuesta).toEqual({ minima: 10, maxima: 1000 });
    expect(S.tajada).toBe(0.2);
    expect(S.recamaras).toBe(6);
  });

  it("límites de la apuesta y solo con lo que tiene", () => {
    expect(checkApuesta(S, 9, 5000).ok).toBe(false);
    expect(checkApuesta(S, 1001, 5000).ok).toBe(false);
    expect(checkApuesta(S, 2.5, 5000).ok).toBe(false);
    expect(checkApuesta(S, 500, 499).ok).toBe(false);
    expect(checkApuesta(S, 1000, 1000).ok).toBe(true);
  });

  it("el ganador se lleva su apuesta y el 80 % de la del otro", () => {
    expect(reparto(S, 500)).toEqual({ tajada: 100, premio: 900 });
    expect(reparto(S, 10)).toEqual({ tajada: 2, premio: 18 });
  });

  it("los turnos se alternan y la bala es cada vez más probable", () => {
    expect([0, 1, 2, 3].map((t) => shooterAt(1, t))).toEqual([1, 0, 1, 0]);
    expect(chanceAt(S, 0)).toBeCloseTo(1 / 6);
    expect(chanceAt(S, 5)).toBe(1);
  });
});

describe("partidas", () => {
  it("el retador paga al desafiar y se le devuelve si el rival rechaza", () => {
    const { coins, svc } = setup();
    const r = svc.challenge("a", "b", 500, "canal");
    if (!r.ok) throw new Error(r.motivo);
    expect(coins.wallet("a").monedas).toBe(1500);
    // Una a la vez.
    expect(svc.challenge("b", "a", 100, "canal").ok).toBe(false);
    expect(svc.reject(r.duelo.id, "c").ok).toBe(false);
    expect(svc.reject(r.duelo.id, "b").ok).toBe(true);
    expect(coins.wallet("a").monedas).toBe(2000);
    expect(svc.active()).toBeNull();
  });

  it("sin Shaulitas no se apuesta; nadie se desafía a sí mismo", () => {
    const { coins, svc } = setup();
    expect(coins.wallet("rico").monedas).toBe(0);
    expect(svc.challenge("rico", "a", 100, null).ok).toBe(false);
    expect(svc.challenge("a", "a", 100, null).ok).toBe(false);
    const r = svc.challenge("a", "rico", 100, null);
    if (!r.ok) throw new Error(r.motivo);
    expect(svc.accept(r.duelo.id, "rico").ok).toBe(false);
    expect(coins.wallet("rico").monedas).toBe(0);
  });

  it("vence si no acepta a tiempo (y se devuelve la apuesta)", () => {
    const { coins, svc, advance } = setup();
    const r = svc.challenge("a", "b", 300, null);
    if (!r.ok) throw new Error(r.motivo);
    expect(svc.expire()).toBeNull();
    advance(S.aceptarMinutos * 60_000);
    expect(svc.accept(r.duelo.id, "b").ok).toBe(false);
    expect(svc.expire()?.estado).toBe("vencida");
    expect(coins.wallet("a").monedas).toBe(2000);
  });

  it("al aceptar paga el rival; el turno es de uno a la vez y el que sobrevive cobra menos la tajada", () => {
    const { coins, svc } = setup();
    const r = svc.challenge("a", "b", 500, null);
    if (!r.ok) throw new Error(r.motivo);
    expect(svc.accept(r.duelo.id, "a").ok).toBe(false); // el retador no acepta su propio desafío
    const ok = svc.accept(r.duelo.id, "b");
    if (!ok.ok) throw new Error(ok.motivo);
    expect(coins.wallet("b").monedas).toBe(1500);
    const x = ok.duelo;
    expect(x.bala).toBeGreaterThanOrEqual(0);
    expect(x.bala).toBeLessThan(S.recamaras);
    // El que no le toca no puede jalar; un turno viejo tampoco vale.
    const other = svc.shooter(x) === "a" ? "b" : "a";
    expect(svc.pull(x.id, 0, other).ok).toBe(false);
    expect(svc.pull(x.id, 3, svc.shooter(x)).ok).toBe(false);
    const last = playOut(svc, x.id);
    expect(last.turno).toBe(x.bala);
    const end = svc.get(x.id)!;
    const ganador = last.quien === "a" ? "b" : "a";
    expect(end).toMatchObject({ estado: "terminada", ganador, tajada: 100, premio: 900 });
    expect(coins.wallet(ganador).monedas).toBe(1500 + 900);
    expect(coins.wallet(last.quien).monedas).toBe(1500);
    // Ya terminó: no se dispara más.
    expect(svc.pull(x.id, end.turno, ganador).ok).toBe(false);
  });

  it("si se acaba el tiempo, Némesis jala por él", () => {
    const { svc } = setup();
    const r = svc.challenge("a", "b", 50, null);
    if (!r.ok) throw new Error(r.motivo);
    const x = (svc.accept(r.duelo.id, "b") as { ok: true; duelo: ReturnType<NemesisService["get"]> & object }).duelo;
    const shot = svc.pull(x.id, 0, null);
    if (!shot.ok) throw new Error(shot.motivo);
    expect(shot.disparo.auto).toBe(true);
    expect(shot.disparo.quien).toBe(svc.shooter(x));
  });

  it("es pareja: cada uno gana cerca de la mitad de las veces", () => {
    const rnd = seededRng(11);
    let wins = 0;
    const N = 600;
    for (let k = 0; k < N; k++) {
      const { svc } = setup(rnd);
      const r = svc.challenge("a", "b", 10, null);
      if (!r.ok) throw new Error(r.motivo);
      svc.accept(r.duelo.id, "b");
      const last = playOut(svc, r.duelo.id);
      if (last.quien === "b") wins++;
    }
    expect(wins / N).toBeGreaterThan(0.42);
    expect(wins / N).toBeLessThan(0.58);
  });

  it("un reinicio a la mitad devuelve lo que puso cada uno", () => {
    const { coins, svc } = setup();
    const r = svc.challenge("a", "b", 700, null);
    if (!r.ok) throw new Error(r.motivo);
    svc.accept(r.duelo.id, "b");
    const back = svc.recover();
    expect(back).toHaveLength(1);
    expect(back[0]!.devuelto).toBe(1400);
    expect(coins.wallet("a").monedas).toBe(2000);
    expect(coins.wallet("b").monedas).toBe(2000);
    expect(svc.active()).toBeNull();
  });
});

describe("imágenes", () => {
  const a = { name: "Wicho el Bicho", avatar: readFileSync("assets/bots/teto_avatar.png") };
  const b = { name: "Papu sin foto", avatar: null };

  it("banner, mesa y GIF del disparo", async () => {
    const png = await bannerImage({ retador: a, rival: b, apuesta: 500, premio: 900, tajada: 100, recamaras: 6 });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    const mesa = { retador: a, rival: b, shooter: 1 as const, turno: 2, recamaras: 6 };
    expect((await turnImage(mesa)).subarray(1, 4).toString()).toBe("PNG");
    const gif = await shotGif(mesa, true);
    expect(gif.subarray(0, 6).toString()).toBe("GIF89a");
    expect(gif.length).toBeLessThan(8 * 1024 * 1024);
    expect(shotGifMs(true)).toBeGreaterThan(shotGifMs(false));
    expect((await avatarPng(b)).subarray(1, 4).toString()).toBe("PNG");
  });
});
