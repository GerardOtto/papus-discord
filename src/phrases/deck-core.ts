// Logica pura del mazo de frases (sin base de datos): la usan DeckStore (PC, SQLite) y el worker (Cloudflare, D1).
export type Rng = () => number;

export interface DeckState {
  order: number[];
  pos: number;
  size: number;
}

function shuffle(n: number, rng: Rng): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Siguiente frase del mazo: se baraja, se recorre entero y se vuelve a barajar sin repetir la ultima.
 * Devuelve el indice elegido y el estado a guardar.
 */
export function advanceDeck(state: DeckState | null, size: number, rng: Rng): { index: number; next: DeckState } {
  if (size <= 0) throw new Error("El mazo esta vacio");
  let order: number[];
  let pos: number;
  if (!state || state.size !== size) {
    // Mazo nuevo, o el grupo cambio de tamano (se agregaron o quitaron frases): se baraja de nuevo.
    order = shuffle(size, rng);
    pos = 0;
  } else if (state.pos >= size) {
    const last = state.order[size - 1]!;
    order = shuffle(size, rng);
    if (size > 1 && order[0] === last) [order[0], order[1]] = [order[1]!, order[0]!];
    pos = 0;
  } else {
    order = state.order;
    pos = state.pos;
  }
  return { index: order[pos]!, next: { order, pos: pos + 1, size } };
}

/** Reemplaza {campos} de una frase; los que falten quedan tal cual para detectarlos en las pruebas. */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
