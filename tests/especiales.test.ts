import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Especiales, loadEspeciales, specialRoleColor } from "../src/services/especiales";
import { loadLayout, nameKey } from "../src/setup/layout";

const PINA = "545054807463821313";
const RAPTOR = "1556419039864299652";

describe("trato especial de un Papu (config/especiales.json)", () => {
  const list = loadEspeciales();
  const e = new Especiales(list);

  it("Piña, por su id: sin limite, su rol de adorno y su trato con Kaito", () => {
    expect(e.unlimited(PINA)).toBe(true);
    expect(e.unlimited("123456789012345678")).toBe(false);
    expect(e.roles()).toContainEqual([PINA, "💙 Esposa de Kaito"]);
    expect(e.notesFor(PINA, ["kaito", "teto"]).kaito).toContain("esposa");
    expect(e.notesFor(PINA, ["teto", "luka"])).toEqual({});
    expect(e.notesFor("123456789012345678", ["kaito"])).toEqual({});
  });

  it("solo Piña tiene mensajes ilimitados: los demas tratos son de duracion fija y sin limite no", () => {
    expect(list.filter((p) => p.sinLimite).map((p) => p.id)).toEqual([PINA]);
    for (const p of list.filter((x) => x.id !== PINA)) expect(p.hasta).toBeTruthy();
  });

  it("el marido de Miku dura 24 horas: rol temporal y trato solo con Miku", () => {
    const raptor = list.find((p) => p.id === RAPTOR)!;
    const fin = Date.parse(raptor.hasta!);
    const during = new Especiales(list, () => fin - 60_000);
    expect(during.unlimited(RAPTOR)).toBe(false);
    expect(during.roles()).toContainEqual([RAPTOR, "💚 Marido de Miku"]);
    expect(during.temporaryRoles().get("💚 Marido de Miku")).toBe("#39C5BB");
    expect(during.notesFor(RAPTOR, ["miku", "teto"])).toEqual({ miku: expect.stringContaining("Quien te escribe es raptorpau152") });
    // Cualquier otro Papu que le pregunte: Miku sabe con quien esta casada (y Teto no recibe nada).
    expect(during.notesFor("123456789012345678", ["miku", "teto"])).toEqual({ miku: expect.stringContaining("casada") });
    // Sabe a qué hora termina (hora de Chile), para no inventarlo.
    expect(during.notesFor("123456789012345678", ["miku"]).miku).toContain("termina el jueves, 22 de octubre, 14:41 (hora de Chile)");
    expect(e.notesFor(PINA, ["kaito"]).kaito).not.toContain("termina");
    expect(new Especiales(list, () => fin + 1).notesFor("123456789012345678", ["miku"])).toEqual({});
    expect(during.nextExpiry()).toBe(fin);
    expect(during.expiredRoles()).toEqual([]);
    const after = new Especiales(list, () => fin + 1);
    expect(after.get(RAPTOR)).toBeUndefined();
    expect(after.notesFor(RAPTOR, ["miku"])).toEqual({});
    expect(after.roles()).not.toContainEqual([RAPTOR, "💚 Marido de Miku"]);
    expect(after.expiredRoles()).toEqual(["💚 Marido de Miku"]);
    expect(after.nextExpiry()).toBeNull();
  });

  it("los roles permanentes existen en config/servidor.json (los temporales los crea Teto)", () => {
    const keys = loadLayout().rolesExtra.map((r) => nameKey(r.rol));
    for (const p of list.filter((x) => x.rol && !x.hasta)) expect(keys).toContain(nameKey(p.rol!));
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
    expect(() => loadEspeciales(file([{ id: PINA, nombre: "x", sinLimite: true, trato: { kafu: "hola" } }]))).toThrow(/kafu/);
    expect(() => loadEspeciales(file([{ id: PINA, nombre: "x", sinLimite: false, hasta: "mañana", trato: {} }]))).toThrow(/hasta/);
    expect(() => loadEspeciales(file([{ id: PINA, nombre: "x", sinLimite: false, colorRol: "verde", trato: {} }]))).toThrow(/colorRol/);
  });
});

describe("color del rol especial (sobre los niveles)", () => {
  const palette = ["🎨 Kaito", "🎨 Rin y Len"];
  const AZUL = 0x1e40af;

  it("sin color de #tus-roles, el suyo; con uno elegido, ese (aunque tenga niveles e insignias)", () => {
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
