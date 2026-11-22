import { describe, expect, it } from "vitest";
import { FONDOS_T2 } from "../scripts/temporada2-catalogo";
import { EFECTOS } from "../src/coins/efectos";
import { loadCatalog } from "../src/coins/rules";

describe("propuesta de fondos de la temporada 2", () => {
  it("ids únicos y todos en el catálogo como temporada 2 (aprobada el 13 nov. 2026)", () => {
    const ids = FONDOS_T2.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const t2 = new Set(loadCatalog().filter((o) => o.temporada === "t2").map((o) => o.id));
    expect(ids.filter((id) => !t2.has(id))).toEqual([]);
  });

  it("cada fondo usa una escena que existe y trae personajes y descripción", () => {
    for (const f of FONDOS_T2) {
      expect(EFECTOS[f.efecto], f.id).toBeDefined();
      expect(f.pjs.length, f.id).toBeGreaterThan(0);
      expect(f.pjs.length, f.id).toBeLessThanOrEqual(6);
      expect(f.descripcion.length, f.id).toBeGreaterThan(10);
      for (const pj of f.pjs) expect(pj, f.id).toMatch(/^(navidad|modelo|motor):[a-z0-9]+\/[a-z]+$/);
    }
  });

  it("las fotos son solo de licencia libre, con su crédito (nunca fotogramas de PV)", () => {
    for (const f of FONDOS_T2.filter((x) => x.foto)) {
      expect(f.foto!.credito, f.id).toMatch(/CC0|dominio público|CC BY/);
      expect(f.foto!.fuente, f.id).toMatch(/^bg_(enbi_(calle_noche|puente|casa_noche|cuarto_noche)|judg_real_(incendio|tormenta|galeria)|ben_(comedor|salon_victoriano)|wrath_real_(bosque|nieve|cerezo))$/);
    }
  });

  it("hay de todas las rarezas y pocas míticas", () => {
    const n = (r: string) => FONDOS_T2.filter((f) => f.rareza === r).length;
    for (const r of ["comun", "rara", "epica", "legendaria", "mitica"]) expect(n(r), r).toBeGreaterThan(0);
    expect(n("mitica")).toBeLessThanOrEqual(3);
  });
});
