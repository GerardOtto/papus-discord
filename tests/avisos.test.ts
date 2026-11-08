import { describe, expect, it } from "vitest";
import { findAvisoRole } from "../src/discord/avisos";
import { channelKey } from "../src/discord/channels";
import { AVISOS_MENU_ID, avisosChange, avisosMenu, colorKey, colorMenu, countryMenu } from "../src/setup/color-menu";
import { loadLayout } from "../src/setup/layout";
import { loadPeleaSettings, nextSlotAt } from "../src/peleas/rules";

describe("avisos de #tus-roles", () => {
  const layout = loadLayout();
  const avisos = layout.avisosPapu!.avisos;

  it("en el mismo canal que los colores y los países, con los nombres de GyroP", () => {
    expect(layout.avisosPapu!.canal).toBe("tus-roles");
    expect(layout.coloresPapu!.canal).toBe("tus-roles");
    expect(layout.paisesPapu!.canal).toBe("tus-roles");
    // El canal existe en la estructura (renombrado desde #tu-color, sin duplicarlo).
    const canal = layout.categorias.flatMap((c) => c.canales).filter((c) => channelKey(c.nombre) === "tus-roles");
    expect(canal).toHaveLength(1);
    expect(canal[0]!.antes).toContain("🎨・tu-color");
    expect(Object.fromEntries(avisos.map((a) => [a.id, a.rol]))).toEqual({ peleas: "⚔️ Ludópata", bodas: "💍 Rizzler", estrenos: "🎬 Estrenos" });
  });

  it("sus roles no chocan con otros roles del servidor", () => {
    const others = [...layout.niveles, ...layout.rolesExtra, ...layout.coloresPapu!.colores].map((r) => colorKey(r.rol));
    const all = [...others, ...layout.paisesPapu!.paises.map(colorKey)];
    const keys = avisos.map((a) => colorKey(a.rol));
    expect(new Set(keys).size).toBe(avisos.length);
    for (const k of keys) expect(all).not.toContain(k);
  });

  it("menú de selección múltiple que se puede dejar vacío, distinto de los otros dos", () => {
    const menu = avisosMenu(avisos) as { components: { custom_id: string; min_values: number; max_values: number; options: { label: string; value: string; emoji: { name: string } }[] }[] };
    const m = menu.components[0]!;
    expect(m.custom_id).toBe(AVISOS_MENU_ID);
    const ids = [colorMenu([]), countryMenu([])].map((x) => (x as { components: { custom_id: string }[] }).components[0]!.custom_id);
    expect(ids).not.toContain(AVISOS_MENU_ID);
    expect(m.min_values).toBe(0);
    expect(m.max_values).toBe(avisos.length);
    expect(m.options[0]).toMatchObject({ label: "Peleas 1vs1 · Ludópata", value: "ludopata", emoji: { name: "⚔️" } });
  });

  it("queda con exactamente lo marcado: da lo nuevo, quita lo desmarcado y no toca lo demás", () => {
    const idOf = new Map([["ludopata", "r1"], ["rizzler", "r2"], ["estrenos", "r3"]]);
    expect(avisosChange(avisos, ["rizzler"], ["r1", "otro"], idOf)).toEqual({ add: ["r2"], remove: ["r1"], quedan: ["💍 Rizzler"], faltan: [] });
    expect(avisosChange(avisos, [], ["r1", "r3"], idOf)).toEqual({ add: [], remove: ["r1", "r3"], quedan: [], faltan: [] });
    expect(avisosChange(avisos, ["ludopata", "estrenos"], ["r1"], idOf)).toEqual({ add: ["r3"], remove: [], quedan: ["⚔️ Ludópata", "🎬 Estrenos"], faltan: [] });
    // Rol que todavia no existe en el servidor: se avisa, el resto se aplica.
    expect(avisosChange(avisos, ["rizzler", "ludopata"], [], new Map([["ludopata", "r1"]]))).toEqual({ add: ["r1"], remove: [], quedan: ["⚔️ Ludópata"], faltan: ["💍 Rizzler"] });
  });

  it("encuentra el rol del aviso sin importar emojis ni acentos, y nunca un rol de bot", () => {
    const roles = [
      { id: "b", name: "Ludopata", managed: true },
      { id: "x", name: "⚔ Ludopata" },
      { id: "y", name: "💍 Rizzler" },
    ];
    expect(findAvisoRole(roles, avisos, "peleas")).toBe("x");
    expect(findAvisoRole(roles, avisos, "bodas")).toBe("y");
    expect(findAvisoRole(roles, avisos, "estrenos")).toBeNull();
  });
});

describe("horarios de las peleas", () => {
  it("en hora de México, con 5 minutos para apostar", () => {
    const s = loadPeleaSettings();
    expect(s.zona).toBe("America/Mexico_City");
    expect(s.apuestas.minutos).toBe(5);
  });

  it("próxima pelea: la siguiente hora de la lista en la zona pedida", () => {
    const mx = "America/Mexico_City"; // UTC-6 (sin horario de verano desde 2022)
    const at = (iso: string) => Date.parse(iso);
    // 8 nov. 2026, 10:00 de México -> 16:00 de México el mismo día.
    expect(nextSlotAt(["16:00", "21:00"], mx, at("2026-11-08T16:00:00Z"))).toBe(at("2026-11-08T22:00:00Z"));
    // Justo a las 16:00 ya no cuenta esa: la siguiente es la de las 21:00.
    expect(nextSlotAt(["16:00", "21:00"], mx, at("2026-11-08T22:00:00Z"))).toBe(at("2026-11-09T03:00:00Z"));
    // Después de la última del día -> la primera de mañana.
    expect(nextSlotAt(["16:00", "21:00"], mx, at("2026-11-09T04:00:00Z"))).toBe(at("2026-11-09T22:00:00Z"));
    expect(nextSlotAt([], mx, Date.now())).toBeNull();
  });
});
