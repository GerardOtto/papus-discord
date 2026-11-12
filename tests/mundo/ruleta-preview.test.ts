import { describe, expect, it } from "vitest";
import type { RouletteService } from "../../src/ruleta/service";
import { accionesRuletaPreview } from "../../src/mundo/ruleta-preview";

describe("accionesRuletaPreview", () => {
  it("returns a visible demo spin without consuming a real roulette turn", async () => {
    let spins = 0;
    let now = 1_000;
    const roulette = {
      status: () => ({ blocked: false }),
      settings: { premios: [{ nombre: "Premio de prueba", etiqueta: "XP", color: "#cc3344", icono: "⭐" }] },
      spin: () => { spins++; throw new Error("preview must never call RouletteService.spin"); },
    } as unknown as RouletteService;
    const actions = accionesRuletaPreview(roulette, () => now, () => 0);
    const state = await actions["ruleta.estado"]({ id: "papu-1", nombre: "Papu" }, null);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect((state.datos as { simulacion?: boolean }).simulacion).toBe(true);
      expect((state.datos as { tiradas: number }).tiradas).toBe(0);
    }

    const result = await actions["ruleta.girar"]({ id: "papu-1", nombre: "Papu" }, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const giro = result.datos as { giro: { titulo: string; subtitulo: string }; tiradas: number; simulado?: boolean };
      expect(giro.simulado).toBe(true);
      expect(giro.tiradas).toBe(0);
      expect(giro.giro.titulo).toContain("DEMO");
      expect(giro.giro.subtitulo).toContain("sin premio real");
    }
    expect(spins).toBe(0);

    const cooldown = await actions["ruleta.girar"]({ id: "papu-1", nombre: "Papu" }, null);
    expect(cooldown.ok).toBe(false);
    now += 5_000;
    expect((await actions["ruleta.girar"]({ id: "papu-1", nombre: "Papu" }, null)).ok).toBe(true);
  });

  it("respects a roulette block even in preview", async () => {
    const roulette = {
      status: () => ({ blocked: true }),
      settings: { premios: [{ nombre: "Premio", etiqueta: "XP", color: "#cc3344", icono: "⭐" }] },
    } as unknown as RouletteService;
    const action = accionesRuletaPreview(roulette)["ruleta.girar"];
    const result = await action({ id: "papu-2", nombre: "Papu" }, null);
    expect(result.ok).toBe(false);
  });
});
