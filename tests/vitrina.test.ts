import { describe, expect, it } from "vitest";
import { colorKey, colorMenu, countryMenu, NO_COLOR, NO_COUNTRY, splitCountry } from "../src/setup/color-menu";
import { loadLayout } from "../src/setup/layout";
import { shouldTease, VITRINA_COOLDOWN_MS, vitrinaChannels } from "../src/services/vitrina";

describe("vitrina", () => {
  const v = vitrinaChannels(loadLayout());

  it("anuncia los canales de solo lectura de los niveles, con el nivel y su emoji", () => {
    expect(v.get("adelantos")).toBe("🥖 Baguette");
    expect(v.get("notas-de-produccion")).toBe("🥖 Baguette");
    expect(v.get("proceso-y-motor")).toBe("📱 Celular");
    expect(v.get("boveda")).toBe("💥 Triple Baka");
  });

  it("no anuncia canales públicos, de staff ni de charla (donde escriben los Papus)", () => {
    expect(v.has("general")).toBe(false);
    expect(v.has("moderacion")).toBe(false);
    expect(v.has("charla-vip")).toBe(false);
    expect(v.has("tips-y-curiosidades")).toBe(false);
  });

  it("un aviso por canal cada 6 h", () => {
    expect(shouldTease(null, 1000)).toBe(true);
    expect(shouldTease(1000, 1000 + VITRINA_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldTease(1000, 1000 + VITRINA_COOLDOWN_MS)).toBe(true);
  });
});

describe("paleta de colores", () => {
  const layout = loadLayout();
  const palette = layout.coloresPapu!.colores;

  it("ningún color de la paleta es de un nivel", () => {
    const tierColors = new Set(layout.niveles.map((n) => n.color.toUpperCase()));
    for (const c of palette) expect(tierColors.has(c.color.toUpperCase())).toBe(false);
    expect(new Set(palette.map((c) => c.color.toUpperCase())).size).toBe(palette.length);
    // Reservadas a los niveles (decisión de GyroP): ni con otro tono.
    for (const c of palette) expect(colorKey(c.rol), c.rol).not.toMatch(/^(teto|miku(?!o)|luka|neru|triplebaka)/); // Mikuo es otro personaje
  });

  it("menú de Discord con un valor por color y 'sin color'", () => {
    const menu = colorMenu(palette) as { components: { options: { label: string; value: string }[] }[] };
    const options = menu.components[0]!.options;
    expect(options).toHaveLength(palette.length + 1);
    expect(options[0]).toMatchObject({ label: "Rin y Len", value: "rinylen" });
    expect(options.at(-1)!.value).toBe(NO_COLOR);
    expect(colorKey("🎨 Adachi Rei")).toBe("adachirei");
  });
});

describe("países de #tu-color", () => {
  const layout = loadLayout();
  const paises = layout.paisesPapu!.paises;

  it("en #tu-color, con bandera y nombre completo, sin repetir ni chocar con otros roles", () => {
    expect(layout.paisesPapu!.canal).toBe(layout.coloresPapu!.canal);
    expect(paises[0]).toBe("🇲🇽 México");
    for (const p of paises) expect(splitCountry(p).name.length, p).toBeGreaterThan(3);
    const others = [...layout.niveles, ...layout.rolesExtra, ...layout.coloresPapu!.colores].map((r) => colorKey(r.rol));
    const keys = paises.map(colorKey);
    expect(new Set(keys).size).toBe(paises.length);
    for (const k of keys) expect(others).not.toContain(k);
  });

  it("menú de Discord con la bandera como emoji y 'sin país'", () => {
    const menu = countryMenu(paises) as { components: { custom_id: string; options: { label: string; value: string; emoji?: { name: string } }[] }[] };
    const options = menu.components[0]!.options;
    expect(menu.components[0]!.custom_id).not.toBe((colorMenu([]) as { components: { custom_id: string }[] }).components[0]!.custom_id);
    expect(options).toHaveLength(paises.length + 1);
    expect(options[0]).toEqual({ label: "México", value: "mexico", emoji: { name: "🇲🇽" } });
    expect(options.at(-1)!.value).toBe(NO_COUNTRY);
  });
});
