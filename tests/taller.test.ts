import { describe, expect, it } from "vitest";
import { loadMembresiaSettings } from "../src/membresias/rules";
import { puedeAportar, TallerService } from "../src/taller/service";
import { memDb } from "./helpers";

const N = loadMembresiaSettings().niveles;
const nivel = (id: string) => N.find((n) => n.id === id)!;

describe("taller de los Papus", () => {
  it("cada aporte desde su nivel (los niveles son acumulativos)", () => {
    expect(puedeAportar(N, null, "pregunta")).toBe(false);
    expect(puedeAportar(N, nivel("puerro"), "pregunta")).toBe(false);
    expect(puedeAportar(N, nivel("atun"), "pregunta")).toBe(true);
    expect(puedeAportar(N, nivel("atun"), "adivinanza")).toBe(true);
    expect(puedeAportar(N, nivel("atun"), "frase")).toBe(false);
    expect(puedeAportar(N, nivel("baguette"), "frase")).toBe(true);
    expect(puedeAportar(N, nivel("baguette"), "luchador")).toBe(false);
    expect(puedeAportar(N, nivel("celular"), "luchador")).toBe(true);
    expect(puedeAportar(N, nivel("celular"), "consumible")).toBe(false);
    expect(puedeAportar(N, nivel("triple-baka"), "consumible")).toBe(true);
    expect(puedeAportar(N, nivel("triple-baka"), "pregunta")).toBe(true);
  });

  it("queda pendiente, se resuelve una sola vez y lo aprobado se lista", () => {
    let t = 1000;
    const s = new TallerService(memDb(), () => t);
    const a = s.crear("u", "Papu", "pregunta", { texto: "¿Quién canta Triple Baka?", correcta: "Miku, Teto y Neru", incorrectas: ["Rin", "Len", "Luka"], dificultad: "facil" });
    expect(a).toMatchObject({ estado: "pendiente", nombre: "Papu" });
    expect(s.pendientes("u")).toBe(1);
    expect(s.resolver(a.id, true, "gyrop")?.estado).toBe("aprobado");
    expect(s.resolver(a.id, false, "mod")).toBeNull();
    expect(s.aprobados("pregunta").map((x) => x.id)).toEqual([a.id]);
    expect(s.pendientes("u")).toBe(0);
    // Luchadores propuestos: se cuentan desde el inicio de la temporada (los rechazados no cuentan).
    const l = s.crear("u", "Papu", "luchador", { nombre: "Kasane Ted", detalle: "El hermano de Teto" });
    expect(s.contar("u", "luchador", 0)).toBe(1);
    s.resolver(l.id, false, "gyrop");
    expect(s.contar("u", "luchador", 0)).toBe(0);
    t = 5000;
    s.crear("u", "Papu", "luchador", { nombre: "Otro", detalle: "x" });
    expect(s.contar("u", "luchador", 4000)).toBe(1);
  });
});
