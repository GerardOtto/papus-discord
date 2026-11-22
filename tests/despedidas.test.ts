import { describe, expect, it } from "vitest";
import { textoDespedida, tiempoEnServidor } from "../src/services/despedidas";
import { loadPhraseFile } from "../src/phrases/catalog";

const DIA = 86_400_000;

describe("#despedidas (idea de Flor_fino, 18 nov. 2026)", () => {
  it("dice cuánto estuvo y su nivel, sin mencionarlo", () => {
    const t = textoDespedida((p) => `Adiós, ${p}.`, { nombre: "Flor", usuario: "flor_fino2", entro: 0, nivel: 12, prestigio: 0 }, 33 * DIA + 5);
    expect(t).toBe("👋 Adiós, **Flor** (@flor_fino2).\n-# Estuvo **33** días · nivel 12");
    expect(t).not.toMatch(/<@/);
  });

  it("si el nombre es su usuario no lo repite; con prestigio lo muestra; sin fecha de entrada, solo el nivel", () => {
    expect(textoDespedida((p) => p, { nombre: "wiwi", usuario: "WIWI", entro: null, nivel: 3, prestigio: 1 }, 0)).toBe("👋 **@WIWI**\n-# Prestigio 1, nivel 3");
    expect(tiempoEnServidor(0, DIA - 1)).toBe("llegó hoy mismo");
    expect(tiempoEnServidor(0, DIA)).toBe("estuvo **1** día");
  });

  it("Teto tiene 30 frases de despedida, todas con {papu}", () => {
    const f = loadPhraseFile("teto").se_fue!;
    expect(f.length).toBeGreaterThanOrEqual(30);
    for (const x of f) expect(x).toContain("{papu}");
  });
});
