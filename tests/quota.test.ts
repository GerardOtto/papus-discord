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

describe("time", () => {
  it("dayKey usa la zona horaria", () => {
    expect(dayKey(new Date("2026-10-16T02:00:00Z"), TZ)).toBe("2026-10-15");
    expect(dayKey(new Date("2026-10-16T02:00:00Z"), "UTC")).toBe("2026-10-16");
  });

  it("nextDayStart da la medianoche siguiente en la zona", () => {
    expect(new Date(nextDayStart(NOON, TZ)).toISOString()).toBe("2026-10-16T03:00:00.000Z");
  });
});
