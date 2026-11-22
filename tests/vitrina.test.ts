import { describe, expect, it } from "vitest";
import { colorKey, colorMenu, colorMenus, countryMenu, isColorMenu, NO_COLOR, NO_COUNTRY, splitCountry } from "../src/setup/color-menu";
import { loadPeleaSettings } from "../src/peleas/rules";
import { loadLayout } from "../src/setup/layout";
import { shouldTease, VITRINA_COOLDOWN_MS, vitrinaChannels } from "../src/services/vitrina";

describe("vitrina", () => {
  const v = vitrinaChannels(loadLayout());

  it("con #vitrina archivada (13 nov. 2026) ya no anuncia nada", () => {
    expect(v.size).toBe(0);
  });

  it("anuncia los canales de solo lectura de los niveles (acceso del canal o de su categoría), sin los archivados", () => {
    const l = {
      niveles: [{ rol: "🥖 Baguette", color: "#fff" }, { rol: "💥 Triple Baka", color: "#fff" }],
      categorias: [
        { nombre: "x", leen: "todos", canales: [{ nombre: "👀・vitrina", escriben: false }] },
        { nombre: "💎 Membresías", leen: "🥖 Baguette", canales: [{ nombre: "👀・adelantos", leen: "🥖 Baguette", escriben: false }, { nombre: "🔐・bóveda", leen: "💥 Triple Baka", escriben: false }, { nombre: "☕・charla-vip", escriben: true }] },
        { nombre: "📦 Archivo", leen: "todos", canales: [{ nombre: "🎬・notas", leen: "🥖 Baguette", escriben: false, archivado: true }] },
      ],
    };
    const w = vitrinaChannels(l);
    expect(w.get("adelantos")).toBe("🥖 Baguette");
    expect(w.get("boveda")).toBe("💥 Triple Baka");
    expect(w.has("charla-vip")).toBe(false);
    expect(w.has("notas")).toBe(false);
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

  it("colores de todos los Vocaloids (también las 4 chicas desde el 12 nov. 2026) y de los invitados de los videos", () => {
    const keys = new Set(palette.map((c) => colorKey(c.rol)));
    for (const k of ["teto", "miku", "luka", "neru", "ruko", "kanon", "anon", "momonemomo", "ted", "nero", "lily", "defoko", "kafu"]) expect(keys.has(k), k).toBe(true);
    expect(new Set(palette.map((c) => c.color.toUpperCase())).size).toBe(palette.length);
    expect(keys.size).toBe(palette.length);
    // El morado Triple Baka sigue siendo del nivel.
    const triple = layout.niveles.find((n) => colorKey(n.rol) === "triplebaka")!;
    for (const c of palette) expect(c.color.toUpperCase()).not.toBe(triple.color.toUpperCase());
    // Nunca los invitados especiales del 1vs1 (Don Ramón, Godzilla, Shaula, Mango9374, la Piña).
    const peleas = loadPeleaSettings();
    for (const [id, l] of Object.entries(peleas.luchadores)) if (l?.grupo === "especial") expect(keys.has(colorKey(l.nombre ?? id)), id).toBe(false);
  });

  it("menús de Discord con un valor por color y 'sin color' (dos menús parejos si pasan de 24)", () => {
    const menus = colorMenus(palette) as { components: { custom_id: string; options: { label: string; value: string }[] }[] }[];
    expect(menus).toHaveLength(Math.ceil(palette.length / 24));
    const options = menus.flatMap((m) => m.components[0]!.options);
    expect(options.filter((o) => o.value !== NO_COLOR).map((o) => o.value)).toEqual(palette.map((c) => colorKey(c.rol)));
    for (const m of menus) {
      expect(m.components[0]!.options.length).toBeLessThanOrEqual(25);
      expect(m.components[0]!.options.at(-1)!.value).toBe(NO_COLOR);
      expect(isColorMenu(m.components[0]!.custom_id)).toBe(true);
    }
    expect(new Set(menus.map((m) => m.components[0]!.custom_id)).size).toBe(menus.length);
    expect(options[0]).toMatchObject({ label: "Rin y Len", value: "rinylen" });
    expect(isColorMenu("papu_pais")).toBe(false);
    expect(colorKey("🎨 Adachi Rei")).toBe("adachirei");
    expect(() => colorMenu(palette.slice(0, 24))).not.toThrow();
  });
});

describe("países de #tus-roles", () => {
  const layout = loadLayout();
  const paises = layout.paisesPapu!.paises;

  it("en #tus-roles, con bandera y nombre completo, sin repetir ni chocar con otros roles", () => {
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
