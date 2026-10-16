import { describe, expect, it } from "vitest";
import { founderSettings, founderWindowOpen, needsFounder } from "../src/services/founders";
import { loadLayout } from "../src/setup/layout";

const layout = {
  niveles: [{ rol: "Puerro" }, { rol: "Atún" }, { rol: "Triple Baka" }],
  rolesExtra: [{ rol: "Vocaloids" }, { rol: "Fundador", hasta: "2026-10-24T00:00:00-03:00" }],
};
const s = founderSettings(layout)!;
const UNTIL = Date.parse("2026-10-24T03:00:00Z");

describe("Fundador", () => {
  it("lee la fecha de cierre (hora de Chile)", () => {
    expect(s.until).toBe(UNTIL);
    expect(s.tiers).toEqual(["Puerro", "Atún", "Triple Baka"]);
  });

  it("sin fecha no se entrega", () => {
    expect(founderSettings({ niveles: [], rolesExtra: [{ rol: "Fundador" }] })).toBeNull();
    expect(() => founderSettings({ niveles: [], rolesExtra: [{ rol: "Fundador", hasta: "pronto" }] })).toThrow();
  });

  it("solo a quien tiene un nivel y aún no la insignia", () => {
    expect(needsFounder(s, ["Puerro"])).toBe(true);
    expect(needsFounder(s, ["atun"])).toBe(true);
    expect(needsFounder(s, ["Triple Baka", "Fundador"])).toBe(false);
    expect(needsFounder(s, ["Papu"])).toBe(false);
    expect(needsFounder(s, [])).toBe(false);
  });

  it("abierto durante la semana; después, solo si los bots estaban apagados al cierre", () => {
    expect(founderWindowOpen(s, UNTIL - 1)).toBe(true);
    expect(founderWindowOpen(s, UNTIL)).toBe(false);
    expect(founderWindowOpen(s, UNTIL + 3_600_000, UNTIL - 3_600_000)).toBe(true);
    expect(founderWindowOpen(s, UNTIL + 3_600_000, UNTIL + 60_000)).toBe(false);
  });

  it("la config del servidor tiene la semana de fundadores", () => {
    expect(founderSettings(loadLayout())?.until).toBe(UNTIL);
  });
});
