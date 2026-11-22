import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { EFECTOS } from "../src/coins/efectos";
import { escena, hasArt } from "../src/coins/equip";
import type { Objeto } from "../src/coins/rules";
import { CARD_FRAMES, CARD_H, CARD_W } from "../src/levels/card";

function cuadro(paint: (ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, t: number) => void, t: number): Uint8ClampedArray {
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext("2d");
  paint(ctx, t);
  return ctx.getImageData(0, 0, CARD_W, CARD_H).data;
}

/** Fracción de pixeles que cambian entre dos cuadros (canal a canal, con tolerancia). */
function diferencia(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 24) n++;
  return n / (a.length / 4);
}

describe("escenas animadas de los fondos (temporada 2)", () => {
  const foto = createCanvas(CARD_W, CARD_H);
  const fctx = foto.getContext("2d");
  fctx.fillStyle = "#334455";
  fctx.fillRect(0, 0, CARD_W, CARD_H);

  for (const [id, ef] of Object.entries(EFECTOS)) {
    it(`${id}: pinta todo el fondo, se mueve y el bucle cierra sin salto`, () => {
      const paint = escena(id, null, []);
      const a = cuadro(paint, 0);
      // Fondo opaco en toda la tarjeta (la escena dibujada no deja huecos).
      for (let i = 3; i < a.length; i += 4 * 997) expect(a[i]).toBe(255);
      // Se mueve entre cuadros…
      expect(diferencia(a, cuadro(paint, 0.5))).toBeGreaterThan(0.001);
      // …y el último cuadro empalma con el primero: el paso de t = 1 - 1/N a t = 1 es como cualquier otro paso.
      const paso = diferencia(cuadro(paint, 0.25), cuadro(paint, 0.25 + 1 / CARD_FRAMES));
      const cierre = diferencia(cuadro(paint, 1 - 1 / CARD_FRAMES), cuadro(paint, 1));
      expect(diferencia(a, cuadro(paint, 1))).toBeLessThan(0.002);
      expect(cierre).toBeLessThan(Math.max(0.05, paso * 4));
    });

    it(`${id}: sobre una foto deja ver la foto y también cierra el bucle`, () => {
      const paint = escena(id, null, [], foto as never);
      expect(diferencia(cuadro(paint, 0), cuadro(paint, 1))).toBeLessThan(0.002);
      expect(ef.sobreFoto).toBeTypeOf("function");
    });
  }

  it("el catálogo solo acepta efectos que existen", () => {
    const base = { id: "x", nombre: "x", tipo: "fondo", rareza: "rara", origen: "render", descripcion: "", temporada: "t2" } as Objeto;
    expect(hasArt({ ...base, efecto: "nieve" })).toBe(true);
    expect(hasArt({ ...base, efecto: "no-existe" })).toBe(false);
    expect(hasArt(base)).toBe(true);
  });
});
