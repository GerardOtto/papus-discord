// Reglas del ajedrez (idea de Mango9374 en #ideas-y-opiniones; GyroP, 18 nov. 2026). Sin dependencias: lo usan el
// worker (la sala valida cada jugada) y la página del celular de Neru (jugadas posibles y los Vocaloids rivales).
// Tablero de 64 casillas: índice = fila * 8 + columna, fila 0 = la 1 de las blancas, columna 0 = la «a».
// Piezas en letras FEN: mayúsculas blancas (PNBRQK), minúsculas negras. Jugadas en notación UCI: "e2e4", "e7e8q".

export type Color = "w" | "b";

export interface Posicion {
  tablero: string[];
  turno: Color;
  /** Enroques que aún se pueden hacer: K, Q (blancas), k, q (negras). */
  enroques: string;
  /** Casilla donde se puede capturar al paso (o null). */
  alPaso: number | null;
  /** Medias jugadas desde la última captura o jugada de peón (regla de las 50 jugadas). */
  medias: number;
  /** Número de la jugada (sube después de las negras). */
  numero: number;
}

export interface Jugada {
  de: number;
  a: number;
  /** Pieza a la que corona un peón (n, b, r, q, en minúscula). */
  corona?: string;
  captura?: string;
  especial?: "enroque" | "alpaso" | "doble";
}

export const INICIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const COLUMNAS = "abcdefgh";
export const casilla = (nombre: string): number => (Number(nombre[1]) - 1) * 8 + COLUMNAS.indexOf(nombre[0]!);
export const nombreCasilla = (i: number): string => `${COLUMNAS[i % 8]}${Math.floor(i / 8) + 1}`;
export const colorDe = (p: string): Color | null => (!p ? null : p === p.toUpperCase() ? "w" : "b");
const otro = (c: Color): Color => (c === "w" ? "b" : "w");

// ───────────────────────── FEN ─────────────────────────

export function leerFen(fen: string): Posicion {
  const [filas, turno, enroques, alPaso, medias, numero] = fen.trim().split(/\s+/);
  const tablero: string[] = new Array(64).fill("");
  const rs = (filas ?? "").split("/");
  if (rs.length !== 8) throw new Error(`FEN inválido: ${fen}`);
  rs.forEach((r, k) => {
    const fila = 7 - k;
    let col = 0;
    for (const ch of r) {
      if (/\d/.test(ch)) col += Number(ch);
      else {
        if (!/^[pnbrqkPNBRQK]$/.test(ch) || col > 7) throw new Error(`FEN inválido: ${fen}`);
        tablero[fila * 8 + col++] = ch;
      }
    }
    if (col !== 8) throw new Error(`FEN inválido: ${fen}`);
  });
  return {
    tablero,
    turno: turno === "b" ? "b" : "w",
    enroques: enroques && enroques !== "-" ? enroques : "",
    alPaso: alPaso && alPaso !== "-" ? casilla(alPaso) : null,
    medias: Number(medias ?? 0) || 0,
    numero: Number(numero ?? 1) || 1,
  };
}

export function escribirFen(p: Posicion): string {
  const filas: string[] = [];
  for (let fila = 7; fila >= 0; fila--) {
    let s = "", vacias = 0;
    for (let col = 0; col < 8; col++) {
      const x = p.tablero[fila * 8 + col]!;
      if (!x) vacias++;
      else {
        if (vacias) s += vacias;
        vacias = 0;
        s += x;
      }
    }
    filas.push(s + (vacias ? vacias : ""));
  }
  return `${filas.join("/")} ${p.turno} ${p.enroques || "-"} ${p.alPaso === null ? "-" : nombreCasilla(p.alPaso)} ${p.medias} ${p.numero}`;
}

/** Clave de la posición para la triple repetición (sin los contadores). */
export const clavePosicion = (p: Posicion): string => escribirFen(p).split(" ").slice(0, 4).join(" ");

// ───────────────────────── ataques ─────────────────────────

const SALTOS_CABALLO: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const REY: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const RECTAS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONALES: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const en = (fila: number, col: number) => fila >= 0 && fila < 8 && col >= 0 && col < 8;

/** ¿Ataca alguna pieza de color `por` la casilla `sq`? */
export function atacada(t: string[], sq: number, por: Color): boolean {
  const f = Math.floor(sq / 8), c = sq % 8;
  const mia = (p: string, tipo: string) => p === (por === "w" ? tipo.toUpperCase() : tipo);
  // Peones: atacan en diagonal hacia adelante.
  const fp = por === "w" ? f - 1 : f + 1;
  for (const dc of [-1, 1]) if (en(fp, c + dc) && mia(t[fp * 8 + c + dc]!, "p")) return true;
  for (const [df, dc] of SALTOS_CABALLO) if (en(f + df, c + dc) && mia(t[(f + df) * 8 + c + dc]!, "n")) return true;
  for (const [df, dc] of REY) if (en(f + df, c + dc) && mia(t[(f + df) * 8 + c + dc]!, "k")) return true;
  for (const [dirs, tipos] of [[RECTAS, ["r", "q"]], [DIAGONALES, ["b", "q"]]] as const) {
    for (const [df, dc] of dirs) {
      let ff = f + df, cc = c + dc;
      while (en(ff, cc)) {
        const p = t[ff * 8 + cc]!;
        if (p) {
          if (tipos.some((x) => mia(p, x))) return true;
          break;
        }
        ff += df;
        cc += dc;
      }
    }
  }
  return false;
}

const reyDe = (t: string[], c: Color) => t.indexOf(c === "w" ? "K" : "k");

export const enJaque = (p: Posicion, c: Color = p.turno): boolean => atacada(p.tablero, reyDe(p.tablero, c), otro(c));

// ───────────────────────── jugadas ─────────────────────────

function pseudo(p: Posicion): Jugada[] {
  const t = p.tablero, yo = p.turno;
  const out: Jugada[] = [];
  const add = (de: number, a: number, extra: Partial<Jugada> = {}) => {
    const cap = t[a];
    out.push({ de, a, ...(cap ? { captura: cap } : {}), ...extra });
  };
  for (let sq = 0; sq < 64; sq++) {
    const pz = t[sq]!;
    if (!pz || colorDe(pz) !== yo) continue;
    const f = Math.floor(sq / 8), c = sq % 8, tipo = pz.toLowerCase();
    if (tipo === "p") {
      const dir = yo === "w" ? 1 : -1, inicio = yo === "w" ? 1 : 6, ultima = yo === "w" ? 7 : 0;
      const coronar = (de: number, a: number, extra: Partial<Jugada> = {}) => {
        if (Math.floor(a / 8) === ultima) for (const cr of ["q", "r", "b", "n"]) add(de, a, { ...extra, corona: cr });
        else add(de, a, extra);
      };
      const uno = (f + dir) * 8 + c;
      if (en(f + dir, c) && !t[uno]) {
        coronar(sq, uno);
        const dos = (f + 2 * dir) * 8 + c;
        if (f === inicio && !t[dos]) add(sq, dos, { especial: "doble" });
      }
      for (const dc of [-1, 1]) {
        if (!en(f + dir, c + dc)) continue;
        const a = (f + dir) * 8 + c + dc;
        if (t[a] && colorDe(t[a]!) !== yo) coronar(sq, a);
        else if (a === p.alPaso) out.push({ de: sq, a, captura: yo === "w" ? "p" : "P", especial: "alpaso" });
      }
    } else if (tipo === "n" || tipo === "k") {
      for (const [df, dc] of tipo === "n" ? SALTOS_CABALLO : REY) {
        if (!en(f + df, c + dc)) continue;
        const a = (f + df) * 8 + c + dc;
        if (!t[a] || colorDe(t[a]!) !== yo) add(sq, a);
      }
      if (tipo === "k") {
        // Enroques: el rey y la torre sin moverse, nada en medio y el rey no pasa por casillas atacadas.
        const base = yo === "w" ? 0 : 56, enemigo = otro(yo);
        const [corto, largo] = yo === "w" ? ["K", "Q"] : ["k", "q"];
        const torre = yo === "w" ? "R" : "r";
        if (sq === base + 4 && !atacada(t, sq, enemigo)) {
          if (p.enroques.includes(corto) && t[base + 7] === torre && !t[base + 5] && !t[base + 6] && !atacada(t, base + 5, enemigo) && !atacada(t, base + 6, enemigo))
            out.push({ de: sq, a: base + 6, especial: "enroque" });
          if (p.enroques.includes(largo) && t[base] === torre && !t[base + 1] && !t[base + 2] && !t[base + 3] && !atacada(t, base + 3, enemigo) && !atacada(t, base + 2, enemigo))
            out.push({ de: sq, a: base + 2, especial: "enroque" });
        }
      }
    } else {
      const dirs = tipo === "b" ? DIAGONALES : tipo === "r" ? RECTAS : [...RECTAS, ...DIAGONALES];
      for (const [df, dc] of dirs) {
        let ff = f + df, cc = c + dc;
        while (en(ff, cc)) {
          const a = ff * 8 + cc;
          if (t[a]) {
            if (colorDe(t[a]!) !== yo) add(sq, a);
            break;
          }
          add(sq, a);
          ff += df;
          cc += dc;
        }
      }
    }
  }
  return out;
}

/** Aplica una jugada (sin revisar si es legal) y devuelve la posición nueva. */
export function aplicar(p: Posicion, j: Jugada): Posicion {
  const t = [...p.tablero];
  const pz = t[j.de]!;
  const yo = p.turno;
  t[j.a] = j.corona ? (yo === "w" ? j.corona.toUpperCase() : j.corona) : pz;
  t[j.de] = "";
  if (j.especial === "alpaso") t[j.a + (yo === "w" ? -8 : 8)] = "";
  if (j.especial === "enroque") {
    const base = yo === "w" ? 0 : 56;
    if (j.a === base + 6) [t[base + 5], t[base + 7]] = [t[base + 7]!, ""];
    else [t[base + 3], t[base]] = [t[base]!, ""];
  }
  // Enroques que se pierden: se movió el rey o una torre, o capturaron una torre en su esquina.
  let enroques = p.enroques;
  const quita = (sq: number) => {
    if (sq === 4) enroques = enroques.replace(/[KQ]/g, "");
    if (sq === 60) enroques = enroques.replace(/[kq]/g, "");
    if (sq === 0) enroques = enroques.replace("Q", "");
    if (sq === 7) enroques = enroques.replace("K", "");
    if (sq === 56) enroques = enroques.replace("q", "");
    if (sq === 63) enroques = enroques.replace("k", "");
  };
  quita(j.de);
  quita(j.a);
  const peon = pz.toLowerCase() === "p";
  return {
    tablero: t,
    turno: otro(yo),
    enroques,
    alPaso: j.especial === "doble" ? (j.de + j.a) / 2 : null,
    medias: peon || j.captura ? 0 : p.medias + 1,
    numero: yo === "b" ? p.numero + 1 : p.numero,
  };
}

/** Jugadas legales (no dejan al propio rey en jaque). */
export function legales(p: Posicion): Jugada[] {
  return pseudo(p).filter((j) => !enJaque(aplicar(p, j), p.turno));
}

export const uci = (j: Jugada): string => `${nombreCasilla(j.de)}${nombreCasilla(j.a)}${j.corona ?? ""}`;

/** La jugada legal que corresponde a un texto UCI ("e2e4", "e7e8q"; sin letra, corona a dama). */
export function buscarJugada(p: Posicion, texto: string): Jugada | null {
  const m = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/.exec(texto.trim().toLowerCase());
  if (!m) return null;
  const de = casilla(m[1]!), a = casilla(m[2]!);
  const opciones = legales(p).filter((j) => j.de === de && j.a === a);
  if (!opciones.length) return null;
  return opciones.find((j) => (j.corona ?? "") === (m[3] ?? (opciones[0]!.corona ? "q" : ""))) ?? null;
}

// ───────────────────────── final ─────────────────────────

export type Final = "jaque_mate" | "ahogado" | "material" | "cincuenta" | "repeticion" | null;

/** Sin material para dar mate: rey solo, o rey con un alfil o un caballo contra rey solo. */
function sinMaterial(t: string[]): boolean {
  const resto = t.filter((x) => x && x.toLowerCase() !== "k");
  if (!resto.length) return true;
  return resto.length === 1 && /[bn]/i.test(resto[0]!);
}

/** ¿Terminó? `repeticiones` = cuántas veces se vio la posición actual (triple repetición = tablas). */
export function final(p: Posicion, repeticiones = 1): Final {
  if (!legales(p).length) return enJaque(p) ? "jaque_mate" : "ahogado";
  if (sinMaterial(p.tablero)) return "material";
  if (p.medias >= 100) return "cincuenta";
  if (repeticiones >= 3) return "repeticion";
  return null;
}

/** Cuenta las posiciones a `n` jugadas (perft: sirve para comprobar las reglas contra números conocidos). */
export function perft(p: Posicion, n: number): number {
  if (n === 0) return 1;
  const js = legales(p);
  if (n === 1) return js.length;
  let total = 0;
  for (const j of js) total += perft(aplicar(p, j), n - 1);
  return total;
}
