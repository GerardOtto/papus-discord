import { describe, expect, it } from "vitest";
import type { LevelSettings } from "../../src/levels/rules";
import { recompensaPesca, textoRecompensaPesca } from "../../src/pesca/reglas";

const settings = {
  curva: { base: 100, exponente: 1, maximo: 10 },
  rangos: [{ desde: 1, nombre: "Papu", estilo: 0 }],
} as LevelSettings;

describe("recompensaPesca", () => {
  it("calcula el porcentaje sobre la barra que falta del nivel actual", () => {
    expect(recompensaPesca(settings, 150, "pequeno")?.xp).toBe(5);
    expect(recompensaPesca(settings, 150, "mediano")?.xp).toBe(10);
    expect(recompensaPesca(settings, 150, "grande")?.xp).toBe(20);
  });

  it("escala la recompensa al aumentar la barra del nivel", () => {
    expect(recompensaPesca(settings, 850, "grande")?.xp).toBe(20);
  });

  it("no concede XP adicional al nivel máximo", () => {
    expect(recompensaPesca(settings, 900, "grande")?.xp).toBe(0);
  });

  it("rechaza tamaño o XP inválidos", () => {
    expect(recompensaPesca(settings, 10, "gigante" as never)).toBeNull();
    expect(recompensaPesca(settings, Number.NaN, "pequeno")).toBeNull();
  });

  it("genera un resumen de la captura", () => {
    const r = recompensaPesca(settings, 150, "grande")!;
    expect(textoRecompensaPesca(r)).toContain("+20 XP");
    expect(textoRecompensaPesca(r)).toContain("20% de tu barra");
  });
});
