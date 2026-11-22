import { describe, expect, it } from "vitest";
import layout from "../config/servidor.json";
import {
  claveIdentidad,
  ESCRIBIR,
  identidadMenu,
  identidadModal,
  QUITAR,
  rolIdentidad,
  tipoDeMenu,
  tipoDeModal,
  validarIdentidad,
  type IdentidadConfig,
} from "../src/setup/identidad";

const CFG = (layout as unknown as { identidadPapu: IdentidadConfig }).identidadPapu;
const limpio = () => false;

describe("pronombres y género (#tus-roles)", () => {
  it("la configuración cabe en un menú de Discord y no repite opciones", () => {
    for (const lista of [CFG.pronombres, CFG.generos]) {
      expect(lista.length).toBeGreaterThan(0);
      expect(lista.length).toBeLessThanOrEqual(23);
      expect(new Set(lista.map(claveIdentidad)).size).toBe(lista.length);
    }
    expect(CFG.maxLargo).toBeLessThanOrEqual(25);
  });

  it("los menús llevan las opciones, escribir y quitar", () => {
    const menu = identidadMenu(CFG, "pronombres") as { components: { custom_id: string; options: { value: string }[] }[] };
    const values = menu.components[0]!.options.map((o) => o.value);
    expect(menu.components[0]!.custom_id).toBe("papu_pronombres");
    expect(values).toContain("elle");
    expect(values.slice(-2)).toEqual([ESCRIBIR, QUITAR]);
    expect(tipoDeMenu("papu_genero")).toBe("genero");
    expect(tipoDeMenu("papu_color")).toBeNull();
  });

  it("la ventanita respeta el largo máximo y se reconoce al volver", () => {
    const modal = identidadModal(CFG, "genero") as { custom_id: string; components: { components: { max_length: number }[] }[] };
    expect(modal.components[0]!.components[0]!.max_length).toBe(CFG.maxLargo);
    expect(tipoDeModal(modal.custom_id)).toBe("genero");
    expect(tipoDeModal("papu_identidad_modal:otro")).toBeNull();
  });

  it("nombre del rol con prefijo fijo y clave sin acentos ni espacios de más", () => {
    expect(rolIdentidad("genero", "No binario")).toBe("Género: No binario");
    expect(rolIdentidad("pronombres", "elle/ella")).toBe("Pronombres: elle/ella");
    expect(claveIdentidad("  Él / ELLE ")).toBe("el/elle");
  });

  it("acepta texto normal y lo limpia", () => {
    expect(validarIdentidad(CFG, "  elle /  ella ", limpio)).toEqual({ ok: true, texto: "elle/ella" });
    expect(validarIdentidad(CFG, "Demigénero", limpio)).toEqual({ ok: true, texto: "Demigénero" });
  });

  it("rechaza vacío, largo, símbolos, enlaces y menciones", () => {
    for (const t of ["   ", "x".repeat(CFG.maxLargo + 1), "<@123>", "@everyone", "https://x.com", "😀", "a#b", "a:b"]) {
      expect(validarIdentidad(CFG, t, limpio).ok).toBe(false);
    }
  });

  it("rechaza burlas de la lista aunque no sean groserías, sin tocar palabras parecidas", () => {
    expect(validarIdentidad(CFG, "Helicóptero de combate", limpio).ok).toBe(false);
    expect(validarIdentidad(CFG, "APACHE", limpio).ok).toBe(false);
    expect(validarIdentidad(CFG, "Avionetas", limpio).ok).toBe(true); // palabra completa, no por partes
  });

  it("rechaza lo que el filtro fijo de Neru marca como ofensivo", () => {
    expect(validarIdentidad(CFG, "algo feo", (t) => t.includes("feo"))).toEqual({ ok: false, motivo: "No puedo usar ese texto." });
  });
});
