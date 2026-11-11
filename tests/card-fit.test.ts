import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { CARD_H, CARD_W, normalizeBackground } from "../src/levels/card";

/** Imagen alta: mitad de arriba roja, mitad de abajo azul. */
function tallImage(): Buffer {
  const c = createCanvas(300, 600);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 300, 300);
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(0, 300, 300, 300);
  return c.toBuffer("image/png");
}

async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const img = await loadImage(png);
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!];
}

describe("ajuste del fondo propio de la tarjeta", () => {
  it("arriba muestra lo de arriba y abajo lo de abajo", async () => {
    const top = await normalizeBackground(tallImage(), "arriba");
    const bottom = await normalizeBackground(tallImage(), "abajo");
    expect((await pixel(top!, CARD_W / 2, CARD_H / 2))[0]).toBeGreaterThan(200);
    expect((await pixel(bottom!, CARD_W / 2, CARD_H / 2))[2]).toBeGreaterThan(200);
  });

  it("completa muestra la imagen entera (arriba rojo, abajo azul) en el centro", async () => {
    const full = await normalizeBackground(tallImage(), "completa");
    expect((await pixel(full!, CARD_W / 2, 10))[0]).toBeGreaterThan(200);
    expect((await pixel(full!, CARD_W / 2, CARD_H - 10))[2]).toBeGreaterThan(200);
  });
});
