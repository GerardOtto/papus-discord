import { describe, expect, it } from "vitest";
import { BOT_IDS } from "../src/config";
import { loadPhraseFile, Phrases, REQUIRED_FIELDS, REQUIRED_GROUPS } from "../src/phrases/catalog";
import { DeckStore } from "../src/phrases/deck";
import { memDb, seededRng } from "./helpers";

const KNOWN_FIELDS = new Set(["papu", "papus", "tema", "ganador", "video", "fecha", "texto", "n", "motivo", "canal", "nivel", "niveles", "votaciones", "rango", "premio", "mision", "racha", "xp", "monedas", "objeto", "rareza", "proxima", "cierra", "de"]);

describe.each(BOT_IDS)("frases de %s", (bot) => {
  const groups = loadPhraseFile(bot);

  it("tiene todos los grupos obligatorios con 30 a 40 frases", () => {
    for (const g of REQUIRED_GROUPS[bot]) {
      expect(groups[g], `${bot}.${g}`).toBeDefined();
      expect(groups[g]!.length, `${bot}.${g}`).toBeGreaterThanOrEqual(30);
      expect(groups[g]!.length, `${bot}.${g}`).toBeLessThanOrEqual(40);
    }
  });

  it("no repite frases dentro de un grupo", () => {
    for (const [g, list] of Object.entries(groups)) {
      const dupes = list.filter((p, i) => list.indexOf(p) !== i);
      expect(dupes, `${bot}.${g}`).toEqual([]);
    }
  });

  it("cada frase lleva los campos obligatorios y solo campos conocidos", () => {
    for (const [g, list] of Object.entries(groups)) {
      for (const p of list) {
        for (const f of REQUIRED_FIELDS[`${bot}.${g}`] ?? []) expect(p, `${bot}.${g}`).toContain(`{${f}}`);
        for (const [, f] of p.matchAll(/\{(\w+)\}/g)) expect(KNOWN_FIELDS.has(f!), `${bot}.${g}: {${f}}`).toBe(true);
      }
    }
  });

  it("ninguna frase menciona a everyone ni amenaza con expulsar o banear", () => {
    for (const list of Object.values(groups))
      for (const p of list) {
        expect(p).not.toMatch(/@everyone|@here/);
        expect(p.toLowerCase()).not.toMatch(/\b(ban|baneo|banear|baneado|baneada)\b|expuls/);
      }
  });
});

describe("Phrases", () => {
  it("elige del mazo sin repetir y reemplaza campos", () => {
    const p = new Phrases(new DeckStore(memDb(), seededRng(5)));
    const seen = new Set(Array.from({ length: 30 }, () => p.pick("teto", "bienvenida", { papu: "<@1>" })));
    expect(seen.size).toBe(30);
    for (const s of seen) expect(s).toContain("<@1>");
  });

  it("falla claro si el grupo no existe", () => {
    const p = new Phrases(new DeckStore(memDb()));
    expect(p.has("miku", "noexiste")).toBe(false);
    expect(() => p.pick("miku", "noexiste")).toThrow(/miku.noexiste/);
  });
});
