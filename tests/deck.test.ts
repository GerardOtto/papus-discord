import { describe, expect, it } from "vitest";
import { DeckStore, fill } from "../src/phrases/deck";
import { memDb, seededRng } from "./helpers";

describe("DeckStore", () => {
  it("recorre el mazo entero sin repetir antes de rebarajar", () => {
    const d = new DeckStore(memDb(), seededRng(1));
    const first = Array.from({ length: 30 }, () => d.next("teto.bienvenida", 30));
    expect(new Set(first).size).toBe(30);
  });

  it("no repite la ultima frase al empezar un mazo nuevo", () => {
    for (let seed = 0; seed < 200; seed++) {
      const d = new DeckStore(memDb(), seededRng(seed));
      let last = -1;
      for (let i = 0; i < 9; i++) {
        const n = d.next("x", 3);
        expect(n).not.toBe(last);
        last = n;
      }
    }
  });

  it("sobrevive a un reinicio: sigue el mismo mazo", () => {
    const db = memDb();
    const a = new DeckStore(db, seededRng(7));
    const seen = Array.from({ length: 10 }, () => a.next("k", 20));
    const b = new DeckStore(db, seededRng(99));
    const rest = Array.from({ length: 10 }, () => b.next("k", 20));
    expect(new Set([...seen, ...rest]).size).toBe(20);
  });

  it("rebaraja si el grupo cambia de tamano y mantiene mazos separados", () => {
    const d = new DeckStore(memDb(), seededRng(3));
    d.next("a", 5);
    expect(d.next("a", 8)).toBeLessThan(8);
    expect(d.next("b", 1)).toBe(0);
    expect(() => d.next("c", 0)).toThrow();
  });
});

describe("fill", () => {
  it("reemplaza los campos y deja visibles los que faltan", () => {
    expect(fill("¡{papu} ganó {tema}!", { papu: "Ana", tema: "Ievan Polkka" })).toBe("¡Ana ganó Ievan Polkka!");
    expect(fill("hola {papu}")).toBe("hola {papu}");
  });
});
