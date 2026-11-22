// Los Vocaloids como rivales de ajedrez (celular de Neru; 18 nov. 2026). Corre en el navegador del Papu: no gasta el
// servidor. Búsqueda alfa-beta con material y tablas de posición; el nivel define la profundidad y cuánto se equivoca.
import { aplicar, colorDe, enJaque, legales, type Jugada, type Posicion } from "./motor";

/** 1 = fácil (se equivoca seguido), 2 = media, 3 = difícil. */
export type Nivel = 1 | 2 | 3;

const VALOR: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Tablas de posición (desde el lado de las blancas, fila 8 arriba), valores clásicos simplificados.
const PST: Record<string, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

/** Valor de la posición para el que mueve (positivo = le conviene). */
export function evaluar(p: Posicion): number {
  let s = 0;
  p.tablero.forEach((x, sq) => {
    if (!x) return;
    const t = x.toLowerCase();
    const blanca = colorDe(x) === "w";
    // La tabla está escrita con la fila 8 arriba: para las blancas se da vuelta.
    const idx = blanca ? (7 - Math.floor(sq / 8)) * 8 + (sq % 8) : sq;
    const v = VALOR[t]! + PST[t]![idx]!;
    s += blanca ? v : -v;
  });
  return p.turno === "w" ? s : -s;
}

const MATE = 100_000;

/** Capturas primero (la pieza más valiosa capturada por la más barata), luego coronaciones. */
function ordenar(p: Posicion, js: Jugada[]): Jugada[] {
  const peso = (j: Jugada) => (j.captura ? 10 * VALOR[j.captura.toLowerCase()]! - VALOR[p.tablero[j.de]!.toLowerCase()]! / 10 : 0) + (j.corona ? 800 : 0);
  return [...js].sort((a, b) => peso(b) - peso(a));
}

function negamax(p: Posicion, prof: number, alfa: number, beta: number, alto: { nodos: number; max: number }): number {
  const js = legales(p);
  if (!js.length) return enJaque(p) ? -MATE - prof : 0;
  if (prof === 0 || ++alto.nodos > alto.max) return evaluar(p);
  let mejor = -Infinity;
  for (const j of ordenar(p, js)) {
    const v = -negamax(aplicar(p, j), prof - 1, -beta, -alfa, alto);
    if (v > mejor) mejor = v;
    if (v > alfa) alfa = v;
    if (alfa >= beta) break;
  }
  return mejor;
}

const PROFUNDIDAD: Record<Nivel, number> = { 1: 1, 2: 2, 3: 3 };
/** Margen (en centipeones) dentro del cual elige al azar: los fáciles juegan peor. */
const DESCUIDO: Record<Nivel, number> = { 1: 160, 2: 35, 3: 0 };

/** La jugada del Vocaloid. `rnd` para que sea reproducible en las pruebas. */
export function elegirJugada(p: Posicion, nivel: Nivel, rnd: () => number = Math.random): Jugada | null {
  const js = legales(p);
  if (!js.length) return null;
  const alto = { nodos: 0, max: 60_000 };
  const notas = ordenar(p, js).map((j) => ({ j, v: -negamax(aplicar(p, j), PROFUNDIDAD[nivel] - 1, -Infinity, Infinity, alto) }));
  const mejor = Math.max(...notas.map((x) => x.v));
  // El mate nunca se deja pasar; si no, cualquiera dentro del margen de su nivel.
  const buenas = notas.filter((x) => x.v >= (mejor >= MATE ? mejor : mejor - DESCUIDO[nivel]));
  return buenas[Math.floor(rnd() * buenas.length)]!.j;
}
