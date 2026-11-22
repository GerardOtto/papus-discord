// Cuota en la tarjeta (pedido de GyroP, 14 nov. 2026): «Cuota diaria 10/20 - Donados 3/5», lo que queda sobre lo que cabe.
import { describe, expect, it } from "vitest";
import { quotaText, renderCard, type CardData } from "../src/levels/card";

describe("cuota en la tarjeta", () => {
  it("muestra cada espacio: lo que queda sobre lo que cabe", () => {
    expect(quotaText({ daily: 10, limit: 20, donated: 3, donatedCap: 5 })).toBe("Cuota diaria 10/20 - Donados 3/5");
    expect(quotaText({ daily: 0, limit: 3, donated: 0, donatedCap: 5 })).toBe("Cuota diaria 0/3 - Donados 0/5");
  });

  it("dibuja la tarjeta con números grandes y evento sin fallar", async () => {
    const d: CardData = {
      name: "Papu", avatar: null, level: 34, max: 99, prestige: 0, into: 207, needed: 1850, tier: 3, rankName: "Acto de apertura",
      position: 14, quota: { daily: 1000, limit: 1000, donated: 1000, donatedCap: 1000 }, frase: null, accent: "#39C5BB", background: null, multiplier: 2,
    };
    const png = await renderCard(d);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
