import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #tus-roles unificado (pedido de GyroP, 13 nov. 2026): un solo mensaje de Miku con todos los menús, cada uno
// debajo de su explicación (componentes v2: con 6 menús no cabe en un mensaje con embed).
describe("guía unificada de #tus-roles", () => {
  const guias = JSON.parse(readFileSync("content/canales.json", "utf8")) as Record<string, { canal?: string; menu?: string[]; secciones?: { menu?: string[] }[]; reemplaza?: string[] }>;

  it("un solo mensaje lleva colores, países, avisos, pronombres, género y cumpleaños", () => {
    const g = guias["tus-roles"]!;
    expect(g.menu).toBeUndefined();
    expect(g.secciones!.flatMap((s) => s.menu ?? [])).toEqual(["colores", "paises", "avisos", "pronombres", "genero", "cumple"]);
    expect(g.reemplaza).toContain("tus-roles-identidad");
  });

  it("ninguna otra guía publica en #tus-roles", () => {
    const otras = Object.entries(guias).filter(([k, g]) => !k.startsWith("$") && k !== "tus-roles" && g.canal === "tus-roles");
    expect(otras).toEqual([]);
    expect(guias["tus-roles-identidad"]).toBeUndefined();
  });
});
