import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { ARTE_T2, FONDOS_PV, FONDOS_T2, INSIGNIAS_DIBUJADAS_T2, TEXTOS_T2 } from "../scripts/temporada2-catalogo";
import { INSIGNIAS_T2 } from "../src/coins/arte-t2-extra";
import { AROS, BARRAS, BORDES, GEO, NOMBRES } from "../src/coins/arte";
import { loadCatalog } from "../src/coins/rules";
import { CARD_H, CARD_W } from "../src/levels/card";

function pintado(draw: (ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, t: number) => void, t: number): Uint8ClampedArray {
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext("2d");
  draw(ctx, t);
  return ctx.getImageData(0, 0, CARD_W, CARD_H).data;
}
const distintos = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.some((v, i) => Math.abs(v - b[i]!) > 24);

describe("arte propio de la temporada 2 (propuesta)", () => {
  it("ids únicos entre sí y todos en el catálogo como temporada 2", () => {
    const ids = [...ARTE_T2.map((a) => a.id), ...FONDOS_T2.map((f) => f.id), ...TEXTOS_T2.map((x) => x.id), ...INSIGNIAS_DIBUJADAS_T2.map((x) => x.id), ...FONDOS_PV.map((x) => x.id)];
    expect(new Set(ids).size).toBe(ids.length);
    const t2 = new Set(loadCatalog().filter((o) => o.temporada === "t2").map((o) => o.id));
    expect(ids.filter((id) => !t2.has(id))).toEqual([]);
  });

  it("los fondos de PV recortan una franja dentro del video de 720 px", () => {
    for (const f of FONDOS_PV) {
      expect(f.y, f.id).toBeGreaterThanOrEqual(0);
      expect(f.y + 435, f.id).toBeLessThanOrEqual(720);
      expect(f.id, f.id).toMatch(/^pv-/);
    }
  });

  it("insignias con un emoji y títulos cortos (caben en la tarjeta)", () => {
    for (const x of TEXTOS_T2) {
      expect(x.valor.length, x.id).toBeGreaterThan(0);
      if (x.tipo === "insignia") expect([...x.valor].length, x.id).toBeLessThanOrEqual(2);
      else expect(x.valor.length, x.id).toBeLessThanOrEqual(30);
    }
  });

  it("cada insignia dibujada tiene su dibujo y llena el centro del círculo de 128×128", () => {
    for (const x of INSIGNIAS_DIBUJADAS_T2) {
      const c = createCanvas(128, 128);
      const ctx = c.getContext("2d");
      expect(INSIGNIAS_T2[x.id], x.id).toBeDefined();
      INSIGNIAS_T2[x.id]!(ctx);
      expect(ctx.getImageData(64, 64, 1, 1).data[3], x.id).toBeGreaterThan(200);
      expect(ctx.getImageData(1, 1, 1, 1).data[3], x.id).toBe(0);
    }
  });

  for (const a of ARTE_T2) {
    it(`${a.id}: tiene dibujo, pinta algo y ${a.animado ? "se mueve y cierra el bucle" : "es fijo"}`, () => {
      const draw = (ctx: Parameters<typeof pintado>[0] extends (c: infer C, t: number) => void ? C : never, t: number) => {
        if (a.tipo === "borde") BORDES[a.id]!(ctx, t);
        else if (a.tipo === "aro") AROS[a.id]!(ctx, t);
        else if (a.tipo === "barra") BARRAS[a.id]!(ctx, t, GEO.tx, GEO.by, 400, GEO.bh);
        else {
          NOMBRES[a.id]!.paint(ctx, t, GEO.tx, 300);
          ctx.fillRect(GEO.tx, 60, 300, 40);
        }
      };
      const registro = { borde: BORDES, barra: BARRAS, aro: AROS, nombre: NOMBRES }[a.tipo];
      expect(registro[a.id]).toBeDefined();
      const a0 = pintado(draw, 0);
      expect(a0.some((v) => v > 0)).toBe(true);
      expect(distintos(a0, pintado(draw, 0.37))).toBe(!!a.animado);
      expect(distintos(a0, pintado(draw, 1))).toBe(false);
    });
  }
});
