import { describe, expect, it } from "vitest";
import { BOT_IDS } from "../src/config";
import { fillMentions, loadAnuncios, markAnuncio, mentionedUsernames, pendingAnuncios } from "../src/services/anuncios";
import { memDb } from "./helpers";

describe("avisos de una sola vez (config/anuncios.json)", () => {
  it("el archivo es valido: ids unicos, bots conocidos y sin @everyone", () => {
    const all = loadAnuncios();
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    for (const a of all) {
      expect(BOT_IDS).toContain(a.bot);
      expect(a.texto).not.toMatch(/@everyone|@here/);
    }
  });

  it("menciona por nombre de usuario (no por apodo)", () => {
    const texto = "{@roasted_bread} Ruko ha llegado!";
    expect(mentionedUsernames(texto)).toEqual(["roasted_bread"]);
    expect(fillMentions(texto, new Map([["roasted_bread", "42"]]))).toBe("<@42> Ruko ha llegado!");
    expect(fillMentions(texto, new Map())).toBeNull();
  });

  it("sale una vez y solo con su bot conectado", () => {
    const db = memDb();
    const all = [{ id: "llegada-ruko", bot: "ruko" as const, canal: "general", texto: "hola" }];
    expect(pendingAnuncios(db, all, ["teto"])).toEqual([]);
    expect(pendingAnuncios(db, all, ["teto", "ruko"])).toHaveLength(1);
    markAnuncio(db, "llegada-ruko");
    expect(pendingAnuncios(db, all, ["teto", "ruko"])).toEqual([]);
  });
});
