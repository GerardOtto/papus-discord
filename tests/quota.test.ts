import { describe, expect, it } from "vitest";
import { Quota } from "../src/quota/quota";
import { dayKey, nextDayStart } from "../src/time";
import { memDb } from "./helpers";

const TZ = "America/Santiago";
// 15 de octubre de 2026, 12:00 en Chile (UTC-3 en horario de verano).
const NOON = new Date("2026-10-15T15:00:00Z");

describe("Quota", () => {
  it("concede una unidad por @ hasta agotar el limite diario", () => {
    const q = new Quota(memDb(), 5, TZ);
    expect(q.reserve("papu", 3, NOON).units).toBe(3);
    expect(q.remaining("papu", NOON)).toBe(2);
    // Mensaje con 4 @: solo alcanzan los 2 primeros.
    expect(q.reserve("papu", 4, NOON).units).toBe(2);
    expect(q.reserve("papu", 1, NOON).units).toBe(0);
  });

  it("sin limite solo para quien diga la lista (GyroP o el Papu especial de config/especiales.json)", () => {
    const q = new Quota(memDb(), 2, TZ, { has: (id) => id === "pina" });
    expect(q.reserve("pina", 10, NOON).units).toBe(10);
    expect(q.remaining("pina", NOON)).toBe(Number.POSITIVE_INFINITY);
    expect(q.reserve("otro", 10, NOON).units).toBe(2);
  });

  it("es independiente por Papu", () => {
    const q = new Quota(memDb(), 5, TZ);
    q.reserve("a", 5, NOON);
    expect(q.remaining("b", NOON)).toBe(5);
  });

  it("GyroP la reinicia a mano: a todos o a un Papu, solo el dia de hoy", () => {
    const q = new Quota(memDb(), 5, TZ);
    const ayer = new Date(NOON.getTime() - 86_400_000);
    q.reserve("a", 5, ayer);
    q.reserve("a", 5, NOON);
    q.reserve("b", 2, NOON);
    expect(q.reset("b", NOON)).toBe(1);
    expect(q.remaining("b", NOON)).toBe(5);
    expect(q.remaining("a", NOON)).toBe(0);
    expect(q.reset(null, NOON)).toBe(1);
    expect(q.remaining("a", NOON)).toBe(5);
    expect(q.remaining("a", ayer)).toBe(0);
  });

  it("se reinicia a medianoche de Chile, no de UTC", () => {
    const q = new Quota(memDb(), 5, TZ);
    q.reserve("papu", 5, new Date("2026-10-15T23:30:00-03:00"));
    // 00:30 UTC del 16 sigue siendo el 15 en Chile.
    expect(q.remaining("papu", new Date("2026-10-16T00:30:00Z"))).toBe(0);
    expect(q.remaining("papu", new Date("2026-10-16T00:00:30-03:00"))).toBe(5);
  });

  it("devuelve unidades al dia de la reserva (espera maxima o APIs caidas)", () => {
    const q = new Quota(memDb(), 5, TZ);
    const res = q.reserve("papu", 3, NOON);
    q.refund(res, 1);
    expect(q.remaining("papu", NOON)).toBe(3);
    q.refund(res);
    expect(q.remaining("papu", NOON)).toBe(5);
  });

  it("nunca devuelve mas de lo reservado", () => {
    const q = new Quota(memDb(), 5, TZ);
    q.reserve("papu", 2, NOON);
    const r2 = q.reserve("papu", 1, NOON);
    q.refund(r2, 10);
    expect(q.remaining("papu", NOON)).toBe(3);
  });

  it("solo los exentos explicitos (GyroP) no tienen limite", () => {
    const q = new Quota(memDb(), 5, TZ, new Set(["gyrop"]));
    expect(q.reserve("gyrop", 50, NOON).units).toBe(50);
    expect(q.remaining("gyrop", NOON)).toBe(Infinity);
  });

  it("un dueño agregado despues de crear la cuota (al conectar a Discord) queda sin limite", () => {
    const owners = new Set<string>();
    const q = new Quota(memDb(), 5, TZ, owners);
    owners.add("gyrop");
    expect(q.reserve("gyrop", 10, NOON).units).toBe(10);
    expect(q.remaining("gyrop", NOON)).toBe(Infinity);
  });

  it("persiste entre instancias (un reinicio no regala cuota)", () => {
    const db = memDb();
    new Quota(db, 5, TZ).reserve("papu", 4, NOON);
    expect(new Quota(db, 5, TZ).remaining("papu", NOON)).toBe(1);
  });
});

describe("cuota ganada y /donar (GyroP, 31 oct. 2026)", () => {
  it("lo ganado solo cabe hasta llenar la cuota; lo demás sobra (se vuelve XP)", () => {
    const q = new Quota(memDb(), 5, TZ);
    expect(q.grant("a", 2, NOON)).toEqual({ added: 0, overflow: 2 });
    q.reserve("a", 3, NOON);
    expect(q.room("a", NOON)).toBe(3);
    expect(q.grant("a", 4, NOON)).toEqual({ added: 3, overflow: 1 });
    expect(q.remaining("a", NOON)).toBe(5);
    expect(new Quota(memDb(), 5, TZ, { has: () => true }).grant("x", 2, NOON)).toEqual({ added: 0, overflow: 2 });
  });

  it("donar quita de la cuota diaria del que dona y llega al espacio de donados del otro, con tope (14 nov. 2026)", () => {
    const q = new Quota(memDb(), 5, TZ, new Set(), 3);
    expect(q.donate("a", "b", 6, NOON)).toEqual({ ok: false, motivo: "no_alcanza" });
    // Con la cuota diaria llena igual le cabe: los donados van aparte (tope 3).
    expect(q.donate("a", "b", 4, NOON)).toEqual({ ok: false, motivo: "llena" });
    expect(q.donate("a", "b", 3, NOON)).toEqual({ ok: true, units: 3 });
    expect(q.dailyLeft("a", NOON)).toBe(2);
    expect(q.dailyLeft("b", NOON)).toBe(5);
    expect(q.donatedLeft("b", NOON)).toBe(3);
    expect(q.remaining("b", NOON)).toBe(8);
    expect(q.donatedRoom("b", NOON)).toBe(0);
    expect(q.donated("a", NOON)).toBe(3);
    // Lo donado no vuelve con un reinicio (boda, /reiniciar-cuota): solo lo gastado con los Vocaloids.
    q.reserve("a", 1, NOON);
    q.reset("a", NOON);
    expect(q.remaining("a", NOON)).toBe(2);
    expect(q.used("a", NOON)).toBe(3);
  });

  it("se gastan primero los diarios; al devolver, primero los donados; el reinicio rellena los dos espacios", () => {
    const q = new Quota(memDb(), 2, TZ, new Set(), 5);
    q.donate("a", "b", 2, NOON);
    const r = q.reserve("b", 3, NOON);
    expect(r).toMatchObject({ units: 3, fromDonated: 1 });
    expect(q.dailyLeft("b", NOON)).toBe(0);
    expect(q.donatedLeft("b", NOON)).toBe(1);
    q.refund(r, 1);
    expect(q.donatedLeft("b", NOON)).toBe(2);
    q.refund(r, 1);
    expect(q.dailyLeft("b", NOON)).toBe(1);
    expect(q.spent("b", NOON)).toBe(1);
    q.reserve("b", 3, NOON);
    q.reset("b", NOON);
    expect(q.dailyLeft("b", NOON)).toBe(2);
    expect(q.donatedLeft("b", NOON)).toBe(2);
    // Lo donado a otro no se vuelve a regalar: solo se dona de la cuota diaria.
    q.reserve("b", 2, NOON);
    expect(q.donate("b", "c", 1, NOON)).toEqual({ ok: false, motivo: "no_alcanza" });
  });

  it("lo que llega por intercambio entra en cualquier espacio libre: primero el diario, después donados", () => {
    const q = new Quota(memDb(), 5, TZ, new Set(), 3);
    q.reserve("b", 2, NOON);
    expect(q.roomFor("b", "cualquiera", NOON)).toBe(5);
    expect(q.roomFor("b", "donados", NOON)).toBe(3);
    expect(q.donate("a", "b", 4, NOON, "cualquiera")).toEqual({ ok: true, units: 4 });
    expect(q.dailyLeft("b", NOON)).toBe(5);
    expect(q.donatedLeft("b", NOON)).toBe(2);
    expect(q.donate("c", "b", 2, NOON, "cualquiera")).toEqual({ ok: false, motivo: "llena" });
    expect(q.donate("c", "b", 1, NOON, "cualquiera")).toEqual({ ok: true, units: 1 });
  });

  it("quien no tiene límite no dona, y a quien no tiene límite no se le dona", () => {
    const q = new Quota(memDb(), 5, TZ, { has: (id) => id === "pina" });
    expect(q.donate("pina", "a", 1, NOON)).toEqual({ ok: false, motivo: "sin_limite" });
    expect(q.donate("a", "pina", 1, NOON)).toEqual({ ok: false, motivo: "llena" });
  });
});

describe("time", () => {
  it("dayKey usa la zona horaria", () => {
    expect(dayKey(new Date("2026-10-16T02:00:00Z"), TZ)).toBe("2026-10-15");
    expect(dayKey(new Date("2026-10-16T02:00:00Z"), "UTC")).toBe("2026-10-16");
  });

  it("nextDayStart da la medianoche siguiente en la zona", () => {
    expect(new Date(nextDayStart(NOON, TZ)).toISOString()).toBe("2026-10-16T03:00:00.000Z");
  });
});
