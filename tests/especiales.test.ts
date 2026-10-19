import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Especiales, loadEspeciales, specialRoleColor } from "../src/services/especiales";
import { loadLayout, nameKey } from "../src/setup/layout";

const PINA = "545054807463821313";

describe("trato especial de un Papu (config/especiales.json)", () => {
  const list = loadEspeciales();
  const e = new Especiales(list);

  it("solo Piña, por su id: sin limite, su rol de adorno y su trato con Kaito", () => {
    expect(list).toHaveLength(1);
    expect(e.unlimited(PINA)).toBe(true);
    expect(e.unlimited("123456789012345678")).toBe(false);
    expect(e.roles()).toEqual([[PINA, "💙 Esposa de Kaito"]]);
    expect(e.notesFor(PINA, ["kaito", "teto"]).kaito).toContain("esposa");
    expect(e.notesFor(PINA, ["teto", "miku"])).toEqual({});
    expect(e.notesFor("123456789012345678", ["kaito"])).toEqual({});
  });

  it("el rol existe en config/servidor.json", () => {
    const keys = loadLayout().rolesExtra.map((r) => nameKey(r.rol));
    for (const [, rol] of e.roles()) expect(keys).toContain(nameKey(rol));
  });

  it("marca a quien se ponga su nombre sin ser ella", () => {
    expect(e.imitated("123456789012345678", "🍍 piña 🍍")).toBe("🍍♡Piña♡🍍");
    expect(e.imitated("123456789012345678", "Pina")).toBe("🍍♡Piña♡🍍");
    expect(e.imitated(PINA, "🍍♡Piña♡🍍")).toBeNull();
    expect(e.imitated("123456789012345678", "Espinaca")).toBeNull();
  });

  it("rechaza ids invalidos y bots desconocidos", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "especiales-"));
    const file = (papus: unknown) => {
      const f = path.join(dir, `${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({ papus }));
      return f;
    };
    expect(() => loadEspeciales(file([{ id: "Piña", nombre: "x", sinLimite: true, trato: {} }]))).toThrow(/id/);
    expect(() => loadEspeciales(file([{ id: PINA, nombre: "x", sinLimite: true, trato: { rin: "hola" } }]))).toThrow(/rin/);
  });
});

describe("color del rol especial (sobre los niveles)", () => {
  const palette = ["🎨 Kaito", "🎨 Rin y Len"];
  const AZUL = 0x1e40af;

  it("sin color de #tu-color, el suyo; con uno elegido, ese (aunque tenga niveles e insignias)", () => {
    const nivel = { name: "💥 Triple Baka", color: 0xff0000, position: 20 };
    const honor = { name: "🏅 Papu de honor", color: 0xc9d1dc, position: 5 };
    expect(specialRoleColor(AZUL, [nivel, honor], palette)).toBe(AZUL);
    expect(specialRoleColor(AZUL, [nivel, honor, { name: "🎨 Kaito", color: 0x3d6bff, position: 8 }], palette)).toBe(0x3d6bff);
  });

  it("el rol de esposa está marcado sobreNiveles en config/servidor.json", () => {
    const r = loadLayout().rolesExtra.find((x) => nameKey(x.rol) === nameKey("💙 Esposa de Kaito"));
    expect(r?.sobreNiveles).toBe(true);
  });
});
