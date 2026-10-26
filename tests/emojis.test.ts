import { describe, expect, it } from "vitest";
import { emojiMarkup, linkEmojis } from "../src/discord/emojis";

const EMOJIS = new Map([
  ["teto_hola", emojiMarkup({ name: "teto_hola", id: "1561227751388749836" })],
  ["miku_baila", emojiMarkup({ name: "miku_baila", id: "1561197609333563434", animated: true })],
]);

describe("emojis del servidor en lo que escribe el LLM", () => {
  it("convierte :nombre: en el emoji del servidor (fijo o animado)", () => {
    expect(linkEmojis("¡Hola, papu! :teto_hola:", EMOJIS)).toBe("¡Hola, papu! <:teto_hola:1561227751388749836>");
    expect(linkEmojis(":miku_baila::teto_hola:", EMOJIS)).toBe("<a:miku_baila:1561197609333563434><:teto_hola:1561227751388749836>");
    expect(linkEmojis("uy :Teto_Hola:", EMOJIS)).toBe("uy <:teto_hola:1561227751388749836>");
  });

  it("deja igual los que ya traen id, los que el servidor no tiene y las horas", () => {
    for (const t of ["<:teto_hola:1561227751388749836>", "<a:miku_baila:1561197609333563434>", ":kafu_hola: hola", "a las 10:30:15", "sin emojis"]) {
      expect(linkEmojis(t, EMOJIS)).toBe(t);
    }
  });
});
