import { describe, expect, it } from "vitest";
import { NOVEDADES_ETIQUETAS, tituloDe } from "../src/setup/novedades";

describe("foro #novedades", () => {
  it("título: la primera línea con texto, sin formato, menciones ni enlaces", () => {
    expect(tituloDe("## 🛠️ **Parche** del 22\nmás texto")).toBe("🛠️ Parche del 22");
    expect(tituloDe("https://youtu.be/x\n\n> Gracias <@123>", "📰 ")).toBe("📰 Gracias");
    expect(tituloDe("", "🎬 Estreno: ")).toBe("🎬 Estreno:");
    expect(tituloDe("")).toBe("✨ Novedad");
  });

  it("título: hasta 100 caracteres (lo que admite Discord)", () => {
    const t = tituloDe("a".repeat(150));
    expect(t.length).toBe(100);
    expect(t.endsWith("…")).toBe(true);
  });

  it("etiquetas: sin repetir y dentro del límite de Discord (20)", () => {
    expect(new Set(NOVEDADES_ETIQUETAS).size).toBe(NOVEDADES_ETIQUETAS.length);
    expect(NOVEDADES_ETIQUETAS.length).toBeLessThanOrEqual(20);
  });
});
