// Mazos de frases fijas (regla 4): se baraja, se recorre entero y se vuelve a barajar sin repetir
// la ultima. El estado vive en SQLite para que un reinicio no provoque repeticiones.
import { transaction, type Db } from "../db/database";
import { advanceDeck, type Rng } from "./deck-core";

export { fill, type Rng } from "./deck-core";

export class DeckStore {
  constructor(
    private readonly db: Db,
    private readonly rng: Rng = Math.random,
  ) {}

  /** Indice de la siguiente frase del mazo `key` con `size` frases. */
  next(key: string, size: number): number {
    if (size <= 0) throw new Error(`El mazo ${key} esta vacio`);
    if (size === 1) return 0;
    return transaction(this.db, () => {
      const row = this.db.prepare("SELECT order_json, pos, size FROM decks WHERE deck_key = ?").get(key) as
        | { order_json: string; pos: number; size: number }
        | undefined;
      const { index, next } = advanceDeck(row ? { order: JSON.parse(row.order_json) as number[], pos: row.pos, size: row.size } : null, size, this.rng);
      this.db
        .prepare(
          `INSERT INTO decks (deck_key, order_json, pos, size) VALUES (?, ?, ?, ?)
           ON CONFLICT(deck_key) DO UPDATE SET order_json = excluded.order_json, pos = excluded.pos, size = excluded.size`,
        )
        .run(key, JSON.stringify(next.order), next.pos, next.size);
      return index;
    });
  }
}
