import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOT_IDS, CORE_BOT_IDS } from "../src/config";
import { EngineDataError, EngineReader } from "../src/engine/reader";
import { FIXTURE_ENGINE } from "./helpers";

describe("EngineReader (fixture)", () => {
  const r = new EngineReader(FIXTURE_ENGINE);

  it("arma la ficha del personaje con su lore, dinamicas y color", () => {
    const teto = r.character("teto");
    expect(teto.displayName).toBe("Teto");
    expect(teto.color).toBe(0xe58fb5);
    expect(teto.lore).toEqual(["Ama las baguettes."]);
    expect(teto.shared).toEqual(["Triple Baka."]);
    expect(teto.community).toEqual(["Teto pera."]);
    expect(r.character("luka").shared).toEqual([]);
  });

  it("los Vocaloids fuera del elenco del motor toman sus datos de content/lore-extra.json; el motor manda", () => {
    expect(r.character("kaito").lore).toEqual(["Le gusta el helado."]);
    const ia = r.character("ia");
    expect(ia.displayName).toBe("IA");
    expect(ia.lore.join(" ")).toMatch(/1st PLACE/);
    // El elenco de los videos (/pedido) sigue siendo el del motor.
    expect(r.cast().map((c) => c.id)).not.toContain("ia");
  });

  it("devuelve la imagen de una emocion solo si el archivo existe", () => {
    const neru = r.character("neru");
    expect(r.reactionImage(neru, "enojado")).toBe(path.join(FIXTURE_ENGINE, "assets/characters/neru/enojado.png"));
    expect(r.reactionImage(neru, "feliz")).toBeNull();
    expect(r.reactionImage(neru, "inexistente")).toBeNull();
  });

  it("resuelve rutas con variables y avisa si falta una", () => {
    expect(r.resolve("avatars", { id: "miku" })).toBe(path.join(FIXTURE_ENGINE, "assets/characters/miku/"));
    expect(() => r.resolve("avatars")).toThrow(EngineDataError);
    expect(() => r.resolve("noexiste")).toThrow(EngineDataError);
  });

  it("explica que falta cuando un dato no existe", () => {
    expect(() => r.readJson("calendario")).toThrow(/calendario/);
    expect(r.missing()).toContain("calendario");
  });

  it("no expone ningun metodo de escritura (solo lectura)", () => {
    const methods = Object.getOwnPropertyNames(EngineReader.prototype);
    expect(methods.filter((m) => /write|save|put|delete|remove|mkdir/i.test(m))).toEqual([]);
  });
});

describe("EngineReader (motor real en ../Proyecto1)", () => {
  const r = new EngineReader(path.resolve(import.meta.dirname, "../../Proyecto1"));

  it("tiene todos los datos listados en engine-paths.json", () => {
    expect(r.missing()).toEqual([]);
  });

  it("tiene lore y color de todos los bots, y avatares de las 4 chicas", () => {
    for (const id of BOT_IDS) {
      const c = r.character(id);
      expect(c.lore.length, id).toBeGreaterThan(0);
      expect(c.color, id).toBeGreaterThan(0);
    }
    for (const id of CORE_BOT_IDS) expect(r.reactionImage(r.character(id), "saludando"), id).not.toBeNull();
  });
});
