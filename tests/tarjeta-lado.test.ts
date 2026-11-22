import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { renderCard, type CardData } from "../src/levels/card";
import { LevelStore } from "../src/levels/store";
import { memDb } from "./helpers";

const AVATAR = (() => {
  const c = createCanvas(64, 64);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#00FF00";
  ctx.fillRect(0, 0, 64, 64);
  return c.toBuffer("image/png");
})();

const base: CardData = {
  name: "Papu", avatar: AVATAR, level: 5, max: 99, prestige: 0, into: 10, needed: 100, tier: 1, rankName: "Demo",
  position: 3, quota: { daily: 2, limit: 3, donated: 0, donatedCap: 5 }, frase: "hola", accent: "#3355AA", background: null, multiplier: 1,
};

async function verde(png: Buffer, x: number, y: number): Promise<boolean> {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  return g! > 200 && r! < 60 && b! < 60;
}

describe("/tarjeta lado (datos a la derecha)", () => {
  it("por defecto el avatar va a la izquierda; con lado derecho, a la derecha", async () => {
    const izq = await renderCard(base);
    expect(await verde(izq, 145, 165)).toBe(true);
    expect(await verde(izq, 855, 165)).toBe(false);
    const der = await renderCard({ ...base, lado: "derecha" });
    expect(await verde(der, 855, 165)).toBe(true);
    expect(await verde(der, 145, 165)).toBe(false);
  });

  it("se guarda por Papu y vuelve a la izquierda con null", () => {
    const store = new LevelStore(memDb());
    expect(store.get("ana").card.lado).toBeNull();
    store.setCard("ana", { lado: "derecha" });
    expect(store.get("ana").card.lado).toBe("derecha");
    store.setCard("ana", { lado: null });
    expect(store.get("ana").card.lado).toBeNull();
  });
});
