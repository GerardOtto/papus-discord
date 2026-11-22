// Reglas del 1vs1 de los Vocaloids (config/peleas.json, PLAN §3.7). Funciones puras: la pelea por turnos (acciones al
// azar con pesos), las lineas que se van agregando al mensaje, la cuota de cada Vocaloid (simulando muchas peleas) y lo
// que cobra cada apuesta. La pelea y el ganador los decide el codigo, nunca el LLM (regla 4).
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, type BotId } from "../config";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export const ACCIONES = ["ataque", "bloqueo", "esquiva", "especial"] as const;
export type Accion = (typeof ACCIONES)[number];

export interface Especial {
  nombre: string;
  texto: string;
  /** Golpe fuerte (en vez del ataque normal) o, si no, cura. */
  dano?: number;
  cura?: number;
}

/** Id de un luchador: el de un Vocaloid del servidor (bot) o el de un invitado (config/peleas.json). */
export type FighterId = string;

/** De dónde viene: un Vocaloid del servidor, un personaje de los videos del canal o un invitado especial. */
export const GRUPOS = ["vocaloid", "invitado", "especial"] as const;
export type Grupo = (typeof GRUPOS)[number];

export interface Luchador {
  por: string;
  /** Luchador Papu (💥 Triple Baka, PLAN §2): su id de Discord (npm run peleas:papu). */
  papu?: string;
  /** Solo invitados (no son bots): nombre, color "#RRGGBB" y grupo. El avatar sale de assets/peleas/luchadores/<id>.png. */
  nombre?: string;
  color?: string;
  grupo?: Grupo;
  vida: number;
  ataque: number;
  defensa: number;
  /** % de esquivar con exito cuando elige esquivar. */
  agilidad: number;
  /** Estilo: pesos propios de cada accion (los que falten, los de pelea.acciones). Miku esquiva mas, Teto bloquea mas. */
  acciones?: Partial<Record<Accion, number>>;
  movimientos: { ataque: string[]; bloqueo: string[]; esquiva: string[]; especial: Especial };
}

export interface PeleaSettings {
  activo: boolean;
  apuestas: { minima: number; maxima: number; minutos: number; margen: number; simulaciones: number; cuotaMinima: number; cuotaMaxima: number };
  horarios: string[];
  /** Zona de los horarios (IANA). Sin ella, la de la cuota (Chile). */
  zona?: string;
  canal: string;
  respaldo: string;
  pelea: { lineaMs: number; maxTurnos: number; acciones: Record<Accion, number> };
  /**
   * 2 contra 2 (18 nov. 2026): parte de las peleas automáticas sale en equipos (`probabilidad`, 0 a 1) y su máximo de
   * turnos. Sin esto, todas las automáticas son 1vs1 (con /pelea modo:2vs2 se lanzan igual, con el doble de turnos).
   */
  equipos?: { probabilidad: number; maxTurnos: number };
  luchadores: Record<FighterId, Luchador>;
}

export function loadPeleaSettings(file = path.join(REPO_ROOT, "config/peleas.json")): PeleaSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as PeleaSettings;
  const a = s.apuestas;
  if (!(a.minima > 0 && a.maxima >= a.minima)) throw new Error("config/peleas.json: apuestas.minima > 0 y maxima >= minima");
  if (!(a.minutos > 0) || !(a.margen >= 0 && a.margen < 0.5) || !(a.simulaciones >= 100)) throw new Error("config/peleas.json: revisa apuestas.minutos, margen (0 a 0,5) y simulaciones (100 o más)");
  if (!(a.cuotaMinima >= 1 && a.cuotaMaxima > a.cuotaMinima)) throw new Error("config/peleas.json: cuotaMinima >= 1 y cuotaMaxima > cuotaMinima");
  if (s.horarios.some((h) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h))) throw new Error("config/peleas.json: los horarios son HH:MM");
  if (s.zona) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: s.zona });
    } catch {
      throw new Error(`config/peleas.json: zona "${s.zona}" no es una zona horaria (ej.: America/Mexico_City)`);
    }
  }
  if (s.equipos && !(s.equipos.probabilidad >= 0 && s.equipos.probabilidad <= 1 && s.equipos.maxTurnos >= 3)) throw new Error("config/peleas.json: equipos.probabilidad va de 0 a 1 y equipos.maxTurnos >= 3");
  if (!(s.pelea.lineaMs >= 500) || !(s.pelea.maxTurnos >= 3)) throw new Error("config/peleas.json: pelea.lineaMs >= 500 y maxTurnos >= 3");
  if (ACCIONES.some((x) => !(s.pelea.acciones[x] >= 0)) || s.pelea.acciones.ataque <= 0) throw new Error("config/peleas.json: pelea.acciones necesita pesos (el ataque mayor que 0)");
  const ids = Object.keys(s.luchadores);
  if (ids.length < 2) throw new Error("config/peleas.json: hacen falta al menos 2 luchadores");
  for (const id of ids) {
    const l = s.luchadores[id]!;
    if (!/^[a-z0-9]+$/.test(id)) throw new Error(`config/peleas.json: el id "${id}" va en minúsculas, sin espacios ni signos`);
    // Un invitado (no es un bot) necesita su nombre y su color; un Vocaloid del servidor los saca del motor.
    if (!BOT_IDS.includes(id as BotId) && (!l.nombre || !/^#[0-9A-Fa-f]{6}$/.test(l.color ?? "")))
      throw new Error(`config/peleas.json: ${id} no es un Vocaloid del servidor: necesita 'nombre' y 'color' (#RRGGBB)`);
    if (l.grupo && !GRUPOS.includes(l.grupo)) throw new Error(`config/peleas.json: grupo de ${id} debe ser ${GRUPOS.join(", ")}`);
    if (!(l.vida > 0 && l.ataque > 0 && l.defensa >= 0 && l.agilidad >= 0 && l.agilidad < 100)) throw new Error(`config/peleas.json: estadísticas inválidas de ${id}`);
    const m = l.movimientos;
    if (!m.ataque?.length || !m.bloqueo?.length || !m.esquiva?.length) throw new Error(`config/peleas.json: a ${id} le faltan movimientos`);
    if (!m.especial?.nombre || !m.especial.texto || !((m.especial.dano ?? 0) > 0 || (m.especial.cura ?? 0) > 0)) throw new Error(`config/peleas.json: el especial de ${id} necesita nombre, texto y 'dano' o 'cura'`);
  }
  return s;
}

// ───────────────────────── la pelea ─────────────────────────

/** Un turno ya resuelto (las dos acciones a la vez). Indices: 0 = el de la izquierda, 1 = el de la derecha. */
export interface Turno {
  n: number;
  acciones: [Accion, Accion];
  /** Daño recibido por cada uno en el turno. */
  dano: [number, number];
  /** Vida recuperada por cada uno. */
  cura: [number, number];
  /** Si esquivo con exito (null = no esquivo o no lo atacaron). */
  esquivo: [boolean | null, boolean | null];
  /** Vida despues del turno. */
  vida: [number, number];
}

export interface Resultado {
  turnos: Turno[];
  ganador: 0 | 1;
  /** Nadie cayo: gano por puntos (mas vida en %). */
  porPuntos: boolean;
}

const pickWeighted = <T extends string>(weights: [T, number][], rnd: () => number): T => {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [k, w] of weights) if ((r -= w) < 0) return k;
  return weights[weights.length - 1]![0];
};

function chooseAction(s: PeleaSettings, l: Luchador, vida: number, especialUsado: boolean, rnd: () => number): Accion {
  const w = { ...s.pelea.acciones, ...l.acciones };
  const curar = !l.movimientos.especial.dano;
  const puedeEspecial = !especialUsado && (!curar || vida < l.vida * 0.6);
  return pickWeighted<Accion>([["ataque", w.ataque], ["bloqueo", w.bloqueo], ["esquiva", w.esquiva], ["especial", puedeEspecial ? w.especial : 0]], rnd);
}

/** Parte de la agilidad que vale como esquiva de reflejo (cuando no eligio esquivar). */
export const REFLEJO = 1 / 3;

const hits = (l: Luchador, a: Accion) => a === "ataque" || (a === "especial" && !!l.movimientos.especial.dano);

/** Lo que pasa en un intercambio entre dos luchadores (sin tocar la vida): acciones, daño, cura y esquivas. */
interface Intercambio {
  acciones: [Accion, Accion];
  dano: [number, number];
  cura: [number, number];
  esquivo: [boolean | null, boolean | null];
}

/** Un intercambio: cada uno elige su acción y se resuelven a la vez. Marca el especial como usado en `usado`. */
function exchange(s: PeleaSettings, L: [Luchador, Luchador], vida: [number, number], usado: [boolean, boolean], rnd: () => number): Intercambio {
  const [a, b] = L;
  const jitter = () => Math.floor(rnd() * 3) - 1;
  let acc: [Accion, Accion] = [chooseAction(s, a, vida[0], usado[0], rnd), chooseAction(s, b, vida[1], usado[1], rnd)];
  // Nadie ataca: se vuelve a sortear una vez (si nadie hace nada, el turno aburre).
  if (!hits(a, acc[0]) && !hits(b, acc[1]) && acc[0] !== "especial" && acc[1] !== "especial")
    acc = [chooseAction(s, a, vida[0], usado[0], rnd), chooseAction(s, b, vida[1], usado[1], rnd)];
  const dano: [number, number] = [0, 0];
  const cura: [number, number] = [0, 0];
  const esquivo: [boolean | null, boolean | null] = [null, null];
  for (const i of [0, 1] as const) {
    const j = (1 - i) as 0 | 1;
    if (acc[i] === "especial") usado[i] = true;
    if (acc[i] === "especial" && L[i].movimientos.especial.cura) cura[i] = L[i].movimientos.especial.cura!;
    if (!hits(L[i], acc[i])) continue;
    const poder = Math.max(1, (acc[i] === "especial" ? L[i].movimientos.especial.dano! : L[i].ataque) + jitter());
    const def = L[j];
    if (acc[j] === "bloqueo") dano[j] = Math.max(0, Math.ceil(poder / 2) - Math.floor(def.defensa / 2));
    else if (acc[j] === "esquiva") {
      esquivo[j] = rnd() * 100 < def.agilidad;
      dano[j] = esquivo[j] ? 0 : poder;
    } else if (rnd() * 100 < def.agilidad * REFLEJO) {
      // Esquiva de reflejo: aunque estaba atacando (o curandose), el agil a veces se salva igual.
      esquivo[j] = true;
    } else dano[j] = Math.max(1, poder - Math.floor(def.defensa / 2));
  }
  return { acciones: acc, dano, cura, esquivo };
}

/** Simula una pelea completa entre `a` (izquierda) y `b` (derecha). */
export function simulate(s: PeleaSettings, a: Luchador, b: Luchador, rnd: () => number = Math.random): Resultado {
  const L: [Luchador, Luchador] = [a, b];
  const vida: [number, number] = [a.vida, b.vida];
  const usado: [boolean, boolean] = [false, false];
  const turnos: Turno[] = [];
  for (let n = 1; n <= s.pelea.maxTurnos; n++) {
    const x = exchange(s, L, vida, usado, rnd);
    for (const i of [0, 1] as const) vida[i] = Math.min(L[i].vida, vida[i] + x.cura[i]) - x.dano[i];
    turnos.push({ n, ...x, vida: [vida[0], vida[1]] });
    if (vida[0] <= 0 || vida[1] <= 0) break;
  }
  const last = turnos[turnos.length - 1]!;
  const ko = last.vida[0] <= 0 || last.vida[1] <= 0;
  let ganador: 0 | 1;
  if (ko && (last.vida[0] > 0) !== (last.vida[1] > 0)) ganador = last.vida[0] > 0 ? 0 : 1;
  else {
    // Los dos cayeron a la vez o se acabo el tiempo: gana quien conserva mas vida (en %); empate, al azar.
    const pa = last.vida[0] / a.vida, pb = last.vida[1] / b.vida;
    ganador = pa === pb ? (rnd() < 0.5 ? 0 : 1) : pa > pb ? 0 : 1;
  }
  return { turnos, ganador, porPuntos: !ko };
}

// ───────────────────────── 2 contra 2 ─────────────────────────
// Modalidad alternativa del 1vs1 (idea de Wicho en #ideas-y-opiniones, salón de la fama; GyroP, 18 nov. 2026): se
// apuesta por un equipo. Un equipo se guarda como "teto+miku" en la misma pelea (mismas apuestas, pagos y devolución).

/** Separador de los miembros de un equipo en su id ("teto+miku"). */
export const EQUIPO_SEP = "+";

/** Miembros de un lado: uno (1vs1) o dos (2vs2). */
export const miembros = (lado: FighterId): FighterId[] => lado.split(EQUIPO_SEP);

export const esEquipo = (lado: FighterId): boolean => lado.includes(EQUIPO_SEP);

export const equipo = (a: FighterId, b: FighterId): FighterId => `${a}${EQUIPO_SEP}${b}`;

/** Un turno del 2vs2: se enfrentan el miembro `par[0]` del equipo de la izquierda y el `par[1]` del de la derecha. */
export interface TurnoEquipo {
  n: number;
  par: [number, number];
  /** El intercambio de esos dos, como un turno del 1vs1 (su `vida` es la de ellos dos al terminar). */
  turno: Turno;
  /** Vida de cada miembro de cada equipo al terminar el turno. */
  vidas: [number[], number[]];
  /** Miembros que cayeron en este turno: [equipo, miembro]. */
  caen: [0 | 1, number][];
}

export interface ResultadoEquipos {
  turnos: TurnoEquipo[];
  ganador: 0 | 1;
  porPuntos: boolean;
}

/** Turnos como mucho del 2vs2 (hay el doble de vida en juego). */
export const maxTurnosEquipo = (s: PeleaSettings) => s.equipos?.maxTurnos ?? s.pelea.maxTurnos * 2;

/**
 * Simula un 2vs2: en cada turno se enfrentan un miembro en pie de cada equipo (al azar) con las reglas del 1vs1. Pierde
 * el equipo que se queda sin nadie en pie; si se acaba el tiempo (o caen los últimos a la vez), gana el que conserva más
 * vida en total (en %).
 */
export function simulateTeams(s: PeleaSettings, A: Luchador[], B: Luchador[], rnd: () => number = Math.random): ResultadoEquipos {
  const T = [A, B] as const;
  const vidas: [number[], number[]] = [A.map((l) => l.vida), B.map((l) => l.vida)];
  const usado: [boolean[], boolean[]] = [A.map(() => false), B.map(() => false)];
  const turnos: TurnoEquipo[] = [];
  const vivos = (k: 0 | 1) => vidas[k].flatMap((v, i) => (v > 0 ? [i] : []));
  const pct = (k: 0 | 1) => vidas[k].reduce((a, v) => a + Math.max(0, v), 0) / T[k].reduce((a, l) => a + l.vida, 0);
  for (let n = 1; n <= maxTurnosEquipo(s); n++) {
    const va = vivos(0), vb = vivos(1);
    const par: [number, number] = [va[Math.floor(rnd() * va.length)]!, vb[Math.floor(rnd() * vb.length)]!];
    const L: [Luchador, Luchador] = [A[par[0]]!, B[par[1]]!];
    const vida: [number, number] = [vidas[0][par[0]]!, vidas[1][par[1]]!];
    const us: [boolean, boolean] = [usado[0][par[0]]!, usado[1][par[1]]!];
    const x = exchange(s, L, vida, us, rnd);
    usado[0][par[0]] = us[0];
    usado[1][par[1]] = us[1];
    const caen: [0 | 1, number][] = [];
    for (const k of [0, 1] as const) {
      const v = Math.min(L[k].vida, vida[k] + x.cura[k]) - x.dano[k];
      vidas[k][par[k]] = v;
      vida[k] = v;
      if (v <= 0) caen.push([k, par[k]]);
    }
    turnos.push({ n, par, turno: { n, ...x, vida: [vida[0], vida[1]] }, vidas: [[...vidas[0]], [...vidas[1]]], caen });
    if (!vivos(0).length || !vivos(1).length) break;
  }
  const fuera = [!vivos(0).length, !vivos(1).length];
  let ganador: 0 | 1;
  if (fuera[0] !== fuera[1]) ganador = fuera[0] ? 1 : 0;
  else {
    const pa = pct(0), pb = pct(1);
    ganador = pa === pb ? (rnd() < 0.5 ? 0 : 1) : pa > pb ? 0 : 1;
  }
  return { turnos, ganador, porPuntos: !(fuera[0] || fuera[1]) };
}

/** Probabilidad de que gane el equipo de la izquierda (simulando muchas peleas, alternando los lados). */
export function winChanceTeams(s: PeleaSettings, A: Luchador[], B: Luchador[], rnd: () => number = Math.random): number {
  let wins = 0;
  for (let k = 0; k < s.apuestas.simulaciones; k++) {
    if (k % 2 === 0) wins += simulateTeams(s, A, B, rnd).ganador === 0 ? 1 : 0;
    else wins += simulateTeams(s, B, A, rnd).ganador === 1 ? 1 : 0;
  }
  return wins / s.apuestas.simulaciones;
}

/** Dos equipos al azar (cuatro luchadores distintos). */
export function pickTeams(ids: readonly FighterId[], rnd: () => number = Math.random): [FighterId, FighterId] {
  if (ids.length < 4) throw new Error("hacen falta al menos 4 luchadores para un 2vs2");
  const pool = [...ids];
  const out: FighterId[] = [];
  for (let k = 0; k < 4; k++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
  return [equipo(out[0]!, out[1]!), equipo(out[2]!, out[3]!)];
}

/** Última línea del 2vs2. `nombres` = nombre de cada equipo («Teto y Miku»). */
export function finalLineTeams(r: ResultadoEquipos, nombres: [string, string]): string {
  const w = nombres[r.ganador];
  const l = nombres[1 - r.ganador]!;
  if (r.porPuntos) return `⏱️ ¡Se acabó el tiempo! **${w}** ganan por puntos (les queda más vida).`;
  const last = r.turnos[r.turnos.length - 1]!;
  if (last.vidas.every((v) => v.every((x) => x <= 0))) return `💀 ¡Caen los últimos de los dos equipos a la vez! **${w}** ganan por un pelo.`;
  return `💀 ¡**${l}** quedan fuera! **${w}** ganan la pelea.`;
}

// ───────────────────────── cuotas y apuestas ─────────────────────────

/** Probabilidad de que gane el de la izquierda (simulando muchas peleas). Mismo `rnd` sembrado = mismo numero. */
export function winChance(s: PeleaSettings, a: Luchador, b: Luchador, rnd: () => number = Math.random): number {
  let wins = 0;
  for (let k = 0; k < s.apuestas.simulaciones; k++) {
    // Se alterna el lado para que el orden de resolucion no favorezca a nadie.
    if (k % 2 === 0) wins += simulate(s, a, b, rnd).ganador === 0 ? 1 : 0;
    else wins += simulate(s, b, a, rnd).ganador === 1 ? 1 : 0;
  }
  return wins / s.apuestas.simulaciones;
}

/** Cuánto paga cada Shaulita apostada a un Vocaloid que gana con probabilidad `p` (con dos decimales). */
export function oddsFor(s: PeleaSettings, p: number): number {
  const { margen, cuotaMinima, cuotaMaxima } = s.apuestas;
  const raw = p > 0 ? (1 - margen) / p : cuotaMaxima;
  return Math.min(cuotaMaxima, Math.max(cuotaMinima, Math.floor(raw * 100) / 100));
}

/**
 * Lo que recibe quien acierta (apuesta incluida). Con enteros (la cuota en centésimos): 300 × 2,03 en decimales da
 * 608,999… y se perdía 1 Shaulita al redondear hacia abajo (corregido el 16 nov. 2026).
 */
export const payout = (apuesta: number, cuota: number) => Math.floor((apuesta * Math.round(cuota * 100)) / 100);

export type BetCheck = { ok: true; total: number } | { ok: false; motivo: string };

/** ¿Puede apostar `cantidad` más? (`previa` = lo que ya aposto en esta pelea, al mismo lado). */
export function checkBet(s: PeleaSettings, cantidad: number, previa: number, ganadas: number): BetCheck {
  const { minima, maxima } = s.apuestas;
  if (!Number.isInteger(cantidad) || cantidad <= 0) return { ok: false, motivo: `Escribe un número entero de Shaulitas (de ${minima} a ${maxima}).` };
  if (previa === 0 && cantidad < minima) return { ok: false, motivo: `La apuesta mínima es de ${minima} Shaulitas.` };
  if (previa + cantidad > maxima)
    return { ok: false, motivo: previa ? `Ya apostaste ${previa}: puedes sumar hasta ${maxima - previa} más (el máximo por pelea es ${maxima}).` : `El máximo por pelea es de ${maxima} Shaulitas.` };
  if (cantidad > ganadas) return { ok: false, motivo: `No te alcanza: tienes ${ganadas} Shaulitas.` };
  return { ok: true, total: previa + cantidad };
}

/** Pareja al azar entre los luchadores, sin repetir exactamente la anterior (en cualquier orden). */
export function pickPair(ids: readonly FighterId[], previous: readonly FighterId[] | null, rnd: () => number = Math.random): [FighterId, FighterId] {
  if (ids.length < 2) throw new Error("hacen falta al menos 2 luchadores");
  for (let tries = 0; ; tries++) {
    const a = ids[Math.floor(rnd() * ids.length)]!;
    let b = ids[Math.floor(rnd() * (ids.length - 1))]!;
    if (b === a) b = ids[ids.length - 1]!;
    const same = previous && previous.includes(a) && previous.includes(b);
    if (!same || ids.length === 2 || tries > 20) return [a, b];
  }
}

// ───────────────────────── texto ─────────────────────────

export interface Nombres {
  nombres: [string, string];
  luchadores: [Luchador, Luchador];
}

const pick = <T>(list: readonly T[], rnd: () => number): T => list[Math.floor(rnd() * list.length)]!;

/** Que hace cada uno en el turno (fragmento: "suelta un machetazo", "usa **Ievan Polkka**: hace girar…"). */
function move(l: Luchador, a: Accion, rnd: () => number): string {
  if (a === "especial") return `usa **${l.movimientos.especial.nombre}**: ${l.movimientos.especial.texto}`;
  return pick(l.movimientos[a], rnd);
}

const ICON: Record<"golpe" | "choque" | "bloqueo" | "esquiva" | "falla" | "especial" | "cura" | "nada", string> = {
  golpe: "👊",
  choque: "⚔️",
  bloqueo: "🛡️",
  esquiva: "💨",
  falla: "💥",
  especial: "🌟",
  cura: "💚",
  nada: "👀",
};

/**
 * Linea de un turno, para el mensaje que se va editando:
 * "**3.** 🛡️ Neru suelta un machetazo, pero Teto se cubre con una baguette → Teto **−1**".
 */
export function turnLine(t: Turno, d: Nombres, rnd: () => number = Math.random): string {
  const [na, nb] = d.nombres;
  const [la, lb] = d.luchadores;
  const [aa, ab] = t.acciones;
  const atk = [hits(la, aa), hits(lb, ab)] as const;
  const mv = [move(la, aa, rnd), move(lb, ab, rnd)] as const;
  const names = [na, nb] as const;
  let icon: string;
  let text: string;
  if (atk[0] && atk[1]) {
    icon = aa === "especial" || ab === "especial" ? ICON.especial : ICON.choque;
    text = `${na} ${mv[0]} y ${nb} ${mv[1]}`;
  } else if (atk[0] || atk[1]) {
    const i = atk[0] ? 0 : 1;
    const j = 1 - i;
    const acc = t.acciones[j]!;
    const heEsp = t.acciones[i] === "especial";
    if (acc === "esquiva" && t.esquivo[j]) {
      icon = ICON.esquiva;
      text = `${names[i]} ${mv[i]}, pero ${names[j]} ${mv[j]}`;
    } else if (acc === "esquiva") {
      icon = ICON.falla;
      text = `${names[i]} ${mv[i]}; ${names[j]} intenta esquivar, ¡pero no alcanza!`;
    } else if (acc === "bloqueo") {
      icon = ICON.bloqueo;
      text = `${names[i]} ${mv[i]}, pero ${names[j]} ${mv[j]}`;
    } else {
      // El otro uso su especial de curar mientras lo atacaban.
      icon = ICON.cura;
      text = `${names[j]} ${mv[j]}, y ${names[i]} aprovecha: ${mv[i]}`;
    }
    if (heEsp && icon !== ICON.cura) icon = ICON.especial;
  } else if (aa === "especial" || ab === "especial") {
    icon = ICON.cura;
    text = aa === "especial" && ab === "especial" ? `${na} ${mv[0]}, y ${nb} también: ${mv[1]}` : aa === "especial" ? `${na} ${mv[0]} mientras ${nb} ${mv[1]}` : `${nb} ${mv[1]} mientras ${na} ${mv[0]}`;
  } else {
    icon = ICON.nada;
    text = `${na} ${mv[0]} y ${nb} ${mv[1]}: se miden sin atacar`;
  }
  const effects: string[] = [];
  for (const i of [0, 1] as const) {
    if (t.cura[i]) effects.push(`${names[i]} **+${t.cura[i]}**`);
    if (t.dano[i]) effects.push(`${names[i]} **−${t.dano[i]}**`);
  }
  for (const i of [0, 1] as const) {
    if (atk[1 - i] && t.acciones[i] === "bloqueo" && !t.dano[i]) effects.push(`¡bloqueo perfecto de ${names[i]}!`);
    else if (t.esquivo[i] && t.acciones[i] !== "esquiva") effects.push(`¡${names[i]} lo esquiva de reflejo!`);
    else if (t.esquivo[i]) effects.push(`¡${names[i]} lo esquiva!`);
  }
  const tail = effects.join(" · ") || "sin daño";
  return `**${t.n}.** ${icon} ${text} → ${tail}`;
}

/** Ultima linea: quien cae (o el final por puntos). */
export function finalLine(r: Resultado, d: Nombres): string {
  const w = d.nombres[r.ganador];
  const l = d.nombres[1 - r.ganador]!;
  const last = r.turnos[r.turnos.length - 1]!;
  if (r.porPuntos) return `⏱️ ¡Se acabó el tiempo! **${w}** gana por puntos (le queda más vida).`;
  if (last.vida[0] <= 0 && last.vida[1] <= 0) return `💀 ¡Caen los dos a la vez! **${w}** queda en pie por un pelo: ¡gana!`;
  return `💀 ¡**${l}** cae! **${w}** gana la pelea.`;
}

/** Barra de vida para el mensaje: "▰▰▰▰▰▰▱▱▱▱ 18/30". */
export function hpBar(vida: number, max: number, size = 10): string {
  const v = Math.max(0, vida);
  const full = Math.round((v / max) * size);
  return `${"▰".repeat(full)}${"▱".repeat(size - full)} ${v}/${max}`;
}

/** "HH:MM" de `date` en la zona `timeZone`. */
export function clockIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** Momento (ms, al minuto) de la proxima pelea automatica despues de `now`, o null si no hay horarios. */
export function nextSlotAt(horarios: string[], timeZone: string, now: number): number | null {
  if (!horarios.length) return null;
  const want = new Set(horarios);
  // Minuto a minuto (como mucho dos dias): asi sirve con cualquier zona y con los cambios de horario.
  let t = now - (now % 60_000) + 60_000;
  for (let i = 0; i < 2 * 24 * 60 + 1; i++, t += 60_000) if (want.has(clockIn(new Date(t), timeZone))) return t;
  return null;
}

/** "HH:MM" que toca ahora (o null), si coincide con un horario de la config. */
export function dueSlot(s: PeleaSettings, hhmm: string): string | null {
  return s.horarios.includes(hhmm) ? hhmm : null;
}
