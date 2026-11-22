// Reglas de las carreras de los Vocaloids (config/carreras.json, PLAN §3.14). Funciones puras: la carrera por turnos
// (con jugadas de frases fijas), la cuota de la mañana (simulando muchas carreras), la bolsa base de Teto y el reparto
// de las apuestas mutuas (como en el hipódromo: cada bolsa, menos el margen, se reparte entre los boletos acertados).
// La carrera y el resultado los decide el código, nunca el LLM (regla 4).
import { readFileSync } from "node:fs";
import path from "node:path";
import { zonedTime } from "../bodas/rules";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export const TIPOS = ["ganador", "segundo", "tercero"] as const;
/** Ganador = llega 1.º; Segundo = 1.º o 2.º; Tercero = entre los 3 primeros (podio). */
export type Tipo = (typeof TIPOS)[number];
/** Cuántos lugares acierta cada tipo. */
export const LUGARES: Record<Tipo, number> = { ganador: 1, segundo: 2, tercero: 3 };
export const NOMBRE_TIPO: Record<Tipo, string> = { ganador: "Ganador", segundo: "Segundo", tercero: "Tercero" };
export const EMOJI_TIPO: Record<Tipo, string> = { ganador: "🥇", segundo: "🥈", tercero: "🥉" };

export interface Jugada {
  /** Sin el nombre: «se detuvo por un helado 🍦». */
  texto: string;
  /** Lo que avanza ese turno (en vez de su avance normal). */
  avance: number;
}

export interface Corredor {
  velocidad: number;
  arranque: number;
  resistencia: number;
  /** Nombre del emoji con su cara (del servidor o de la aplicación de Teto). */
  emoji: string;
  jugadas: Jugada[];
}

export interface CarreraSettings {
  activo: boolean;
  canal: string;
  respaldo: string;
  rolAviso: string;
  porDia: number;
  horario: { zona: string; desde: string; hasta: string };
  separacionMinutos: number;
  lejosDePeleasMinutos: number;
  actividadMinutos: number;
  corredoresPorCarrera: number;
  apuestas: { minimaBoleto: number; maximaCarrera: number; minutos: number; margen: number; pagoMinimo: number; bolsaBase: number; simulaciones: number };
  carrera: { meta: number; filas: number; turnoMs: number; maxTurnos: number; jugada: number; propia: number; avanceBueno: number; avanceMalo: number };
  corredores: Record<string, Corredor>;
}

export interface FrasesCarrera {
  buenas: string[];
  malas: string[];
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function loadCarreraSettings(file = path.join(REPO_ROOT, "config/carreras.json")): CarreraSettings {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const s = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$"))) as unknown as CarreraSettings;
  const bad = (m: string) => new Error(`config/carreras.json: ${m}`);
  if (!(s.porDia >= 0) || !HM.test(s.horario.desde) || !HM.test(s.horario.hasta) || s.horario.desde >= s.horario.hasta) throw bad("revisa porDia y horario (desde < hasta, HH:MM)");
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: s.horario.zona });
  } catch {
    throw bad(`zona "${s.horario.zona}" no es una zona horaria`);
  }
  const a = s.apuestas;
  if (!(a.minimaBoleto > 0 && a.maximaCarrera >= a.minimaBoleto)) throw bad("apuestas.minimaBoleto > 0 y maximaCarrera >= minimaBoleto");
  if (!(a.minutos > 0) || !(a.margen >= 0 && a.margen < 0.5) || !(a.pagoMinimo >= 1) || !(a.bolsaBase >= 0) || !(a.simulaciones >= 100)) throw bad("revisa apuestas (minutos, margen 0 a 0,5, pagoMinimo >= 1, bolsaBase, simulaciones >= 100)");
  const c = s.carrera;
  if (!(c.meta > 0 && c.filas >= 3 && c.turnoMs >= 1000 && c.maxTurnos >= 10 && c.jugada >= 0 && c.jugada <= 1 && c.propia >= 0 && c.propia <= 1)) throw bad("revisa carrera (meta, filas >= 3, turnoMs >= 1000, maxTurnos >= 10, probabilidades de 0 a 1)");
  const ids = Object.keys(s.corredores);
  if (!(s.corredoresPorCarrera >= 3 && s.corredoresPorCarrera <= 8)) throw bad("corredoresPorCarrera va de 3 a 8");
  if (ids.length < s.corredoresPorCarrera) throw bad(`hacen falta al menos ${s.corredoresPorCarrera} corredores`);
  for (const id of ids) {
    const r = s.corredores[id]!;
    for (const k of ["velocidad", "arranque", "resistencia"] as const) if (!(Number.isInteger(r[k]) && r[k] >= 1 && r[k] <= 10)) throw bad(`${id}.${k} va de 1 a 10`);
    if (!r.emoji) throw bad(`${id} necesita 'emoji'`);
    if (r.jugadas.some((j) => !j.texto || !(j.avance >= 0))) throw bad(`jugadas de ${id}: texto y avance >= 0`);
  }
  return s;
}

export function loadFrasesCarrera(file = path.join(REPO_ROOT, "content/frases/carreras.json")): FrasesCarrera {
  const f = JSON.parse(readFileSync(file, "utf8")) as FrasesCarrera;
  if (!f.buenas?.length || !f.malas?.length) throw new Error("content/frases/carreras.json: faltan 'buenas' o 'malas'");
  if ([...f.buenas, ...f.malas].some((t) => !t.includes("{n}"))) throw new Error("content/frases/carreras.json: cada frase lleva {n}");
  return f;
}

// ───────────────────────── azar sembrado ─────────────────────────

/** Generador con semilla (mulberry32): la misma semilla da la misma carrera (así se puede comprobar). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── la carrera ─────────────────────────

export interface TurnoCarrera {
  n: number;
  /** Avance acumulado de cada corredor después del turno (no pasa de la meta). */
  pos: number[];
  /** La jugada del turno (si hubo): índice del corredor y la frase ya armada. */
  jugada: { corredor: number; texto: string; buena: boolean } | null;
}

export interface ResultadoCarrera {
  turnos: TurnoCarrera[];
  /** Índices de los corredores en orden de llegada. */
  llegada: number[];
  /** Turno en que cruzó cada uno (por índice; null si no llegó antes del máximo). */
  cruce: (number | null)[];
  /** Hubo foto final entre dos del podio (llegaron casi a la vez). */
  fotoFinal: [number, number] | null;
}

/**
 * Avance normal de un turno, con azar. Cada estadística manda en un tercio de la pista: el arranque en el primero, la
 * velocidad en el del medio y la resistencia en el último (así, con la misma suma, todos tienen chances parecidas).
 */
function avance(s: CarreraSettings, r: Corredor, pos: number, rnd: () => number): number {
  const meta = s.carrera.meta;
  const stat = pos < meta / 3 ? r.arranque : pos < (meta * 2) / 3 ? r.velocidad : r.resistencia;
  return 6 * (meta / 100) * (0.8 + 0.04 * stat) * (0.5 + rnd());
}

/**
 * Simula la carrera completa de `corredores` (en ese orden). `nombres` arma las frases de las jugadas. Termina cuando
 * llegan todos (o en `maxTurnos`: los que no llegaron, por lo que avanzaron).
 */
export function simularCarrera(s: CarreraSettings, corredores: readonly Corredor[], nombres: readonly string[], frases: FrasesCarrera, rnd: () => number): ResultadoCarrera {
  const { meta, maxTurnos, jugada: pJugada, propia, avanceBueno, avanceMalo } = s.carrera;
  const n = corredores.length;
  const pos = new Array<number>(n).fill(0);
  const cruce: (number | null)[] = new Array(n).fill(null);
  /** Fracción del turno en que cruzó (menor = antes). */
  const fraccion = new Array<number>(n).fill(Infinity);
  const usadas = new Set<string>();
  const turnos: TurnoCarrera[] = [];
  for (let t = 1; t <= maxTurnos && cruce.some((c) => c === null); t++) {
    let jugada: TurnoCarrera["jugada"] = null;
    let avanceJugada = 0;
    const corriendo = cruce.flatMap((c, i) => (c === null ? [i] : []));
    if (rnd() < pJugada && corriendo.length) {
      const i = corriendo[Math.floor(rnd() * corriendo.length)]!;
      const r = corredores[i]!;
      const propias = r.jugadas.filter((j) => !usadas.has(`${i}:${j.texto}`));
      if (propias.length && rnd() < propia) {
        const j = propias[Math.floor(rnd() * propias.length)]!;
        usadas.add(`${i}:${j.texto}`);
        jugada = { corredor: i, texto: `${nombres[i]} ${j.texto}`, buena: j.avance >= avanceBueno / 2 };
        avanceJugada = j.avance;
      } else {
        const buena = rnd() < 0.5;
        const lista = (buena ? frases.buenas : frases.malas).filter((f) => !usadas.has(f));
        if (lista.length) {
          const f = lista[Math.floor(rnd() * lista.length)]!;
          usadas.add(f);
          jugada = { corredor: i, texto: f.replaceAll("{n}", nombres[i]!), buena };
          avanceJugada = buena ? avanceBueno : avanceMalo;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (cruce[i] !== null) continue;
      const extra = jugada?.corredor === i ? avanceJugada * (meta / 100) : avance(s, corredores[i]!, pos[i]!, rnd);
      const antes = pos[i]!;
      if (antes + extra >= meta) {
        cruce[i] = t;
        fraccion[i] = extra > 0 ? (meta - antes) / extra : 1;
        pos[i] = meta;
      } else pos[i] = antes + extra;
    }
    turnos.push({ n: t, pos: [...pos], jugada });
  }
  // Orden de llegada: primero el turno, después la fracción del turno; si siguen iguales, al azar. Los que no llegaron,
  // por lo que avanzaron.
  const desempate = pos.map(() => rnd());
  const llegada = [...pos.keys()].sort((a, b) => {
    const ca = cruce[a] ?? Infinity, cb = cruce[b] ?? Infinity;
    if (ca !== cb) return ca - cb;
    if (ca === Infinity) return pos[b]! - pos[a]! || desempate[a]! - desempate[b]!;
    return fraccion[a]! - fraccion[b]! || desempate[a]! - desempate[b]!;
  });
  let fotoFinal: [number, number] | null = null;
  for (let k = 0; k < Math.min(3, llegada.length - 1) && !fotoFinal; k++) {
    const a = llegada[k]!, b = llegada[k + 1]!;
    if (cruce[a] !== null && cruce[a] === cruce[b] && Math.abs(fraccion[a]! - fraccion[b]!) < 0.03) fotoFinal = [a, b];
  }
  return { turnos, llegada, cruce, fotoFinal };
}

/** Fila de la pista (0 = la de arriba) donde se dibuja un corredor con avance `p`; `filas` = llegó (la meta). */
export function filaDe(s: CarreraSettings, p: number): number {
  const { meta, filas } = s.carrera;
  if (p >= meta) return filas;
  return Math.min(filas - 1, Math.floor((p / meta) * filas));
}

// ───────────────────────── probabilidades y cuota de la mañana ─────────────────────────

/** Probabilidad de cada corredor de llegar 1.º, entre los 2 primeros y entre los 3 primeros. */
export interface Probabilidades {
  ganador: number[];
  segundo: number[];
  tercero: number[];
}

export function probabilidades(s: CarreraSettings, corredores: readonly Corredor[], frases: FrasesCarrera, rnd: () => number, simulaciones = s.apuestas.simulaciones): Probabilidades {
  const n = corredores.length;
  const out: Probabilidades = { ganador: new Array(n).fill(0), segundo: new Array(n).fill(0), tercero: new Array(n).fill(0) };
  const nombres = corredores.map(() => "x");
  for (let k = 0; k < simulaciones; k++) {
    const { llegada } = simularCarrera(s, corredores, nombres, frases, rnd);
    llegada.forEach((i, lugar) => {
      if (lugar < 1) out.ganador[i]!++;
      if (lugar < 2) out.segundo[i]!++;
      if (lugar < 3) out.tercero[i]!++;
    });
  }
  for (const t of TIPOS) out[t] = out[t].map((v) => v / simulaciones);
  return out;
}

/** Cuota de la mañana (guía, antes de que nadie apueste): lo que pagaría Ganador si las bolsas siguieran la probabilidad. */
export function cuotaManana(s: CarreraSettings, p: number): number {
  const raw = p > 0 ? (1 - s.apuestas.margen) / p : 99;
  return Math.max(s.apuestas.pagoMinimo, Math.floor(raw * 100) / 100);
}

/** Reparte `total` en enteros proporcionales a `pesos` (resto mayor) con al menos 1 para cada uno. */
function repartir(total: number, pesos: readonly number[]): number[] {
  const n = pesos.length;
  if (total <= 0) return new Array(n).fill(0);
  const suma = pesos.reduce((a, b) => a + Math.max(0, b), 0);
  const w = suma > 0 ? pesos.map((p) => Math.max(0, p) / suma) : pesos.map(() => 1 / n);
  const exacto = w.map((x) => x * Math.max(0, total - n));
  const out = exacto.map((x) => Math.floor(x) + 1);
  let falta = total - out.reduce((a, b) => a + b, 0);
  const orden = exacto.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; falta > 0; k = (k + 1) % n, falta--) out[orden[k]![1]]!++;
  return out;
}

/** Bolsa base de Teto: `bolsaBase` Shaulitas en cada bolsa, repartidas según la probabilidad (más al favorito). */
export function bolsaBase(s: CarreraSettings, p: Probabilidades): Record<Tipo, number[]> {
  return { ganador: repartir(s.apuestas.bolsaBase, p.ganador), segundo: repartir(s.apuestas.bolsaBase, p.segundo), tercero: repartir(s.apuestas.bolsaBase, p.tercero) };
}

// ───────────────────────── apuestas mutuas ─────────────────────────

const piso2 = (x: number) => Math.floor(x * 100 + 1e-9) / 100;

/**
 * Cuota que paga cada corredor acertado de una bolsa (como en el hipódromo). `bolsa[i]` = lo apostado a i (con la base
 * de Teto); `llegada` = orden de llegada. Ganador: la bolsa neta entre lo apostado al 1.º. Segundo y Tercero: a los
 * boletos de los 2 (o 3) primeros se les devuelve lo apostado y la ganancia que sobra se parte en partes iguales entre
 * esos corredores (los que tienen algo apostado). Nunca menos de `pagoMinimo` (la casa pone la diferencia).
 */
export function cuotasBolsa(s: CarreraSettings, tipo: Tipo, bolsa: readonly number[], llegada: readonly number[]): Map<number, number> {
  const { margen, pagoMinimo } = s.apuestas;
  const ganan = llegada.slice(0, LUGARES[tipo]).filter((i) => (bolsa[i] ?? 0) > 0);
  const out = new Map<number, number>();
  if (!ganan.length) return out;
  const neta = bolsa.reduce((a, b) => a + b, 0) * (1 - margen);
  const apostado = ganan.reduce((a, i) => a + bolsa[i]!, 0);
  const ganancia = Math.max(0, neta - apostado);
  for (const i of ganan) out.set(i, Math.max(pagoMinimo, piso2((bolsa[i]! + ganancia / ganan.length) / bolsa[i]!)));
  return out;
}

/**
 * Lo que recibe un boleto acertado (apuesta incluida). Con enteros (la cuota en centésimos): 100 × 2,26 en decimales da
 * 225,999… y se perdía 1 Shaulita al redondear hacia abajo (16 nov. 2026).
 */
export const pagoBoleto = (cantidad: number, cuota: number) => Math.floor((cantidad * Math.round(cuota * 100)) / 100);

/**
 * Cuota en vivo de cada corredor (para el tablero). Ganador: exacta si ganara ahora. Segundo y Tercero: aproximada
 * (depende de quiénes lo acompañen): se supone que los otros lugares los ocupan corredores con lo apostado promedio.
 */
export function cuotasEnVivo(s: CarreraSettings, bolsas: Record<Tipo, readonly number[]>): Record<Tipo, number[]> {
  const { margen, pagoMinimo } = s.apuestas;
  const out = {} as Record<Tipo, number[]>;
  for (const tipo of TIPOS) {
    const bolsa = bolsas[tipo];
    const n = bolsa.length;
    const total = bolsa.reduce((a, b) => a + b, 0);
    const neta = total * (1 - margen);
    const k = LUGARES[tipo];
    out[tipo] = bolsa.map((x) => {
      if (x <= 0) return 0;
      const otros = k > 1 && n > 1 ? ((k - 1) * (total - x)) / (n - 1) : 0;
      const ganancia = Math.max(0, neta - x - otros);
      return Math.max(pagoMinimo, piso2((x + ganancia / k) / x));
    });
  }
  return out;
}

export type ChequeoBoleto = { ok: true; total: number } | { ok: false; motivo: string };

/** ¿Puede comprar un boleto de `cantidad`? `previa` = lo que ya apostó en esta carrera (todos sus boletos). */
export function checkBoleto(s: CarreraSettings, cantidad: number, previa: number, monedas: number): ChequeoBoleto {
  const { minimaBoleto, maximaCarrera } = s.apuestas;
  if (!Number.isInteger(cantidad) || cantidad <= 0) return { ok: false, motivo: `Escribe un número entero de Shaulitas (de ${minimaBoleto} a ${maximaCarrera}).` };
  if (cantidad < minimaBoleto) return { ok: false, motivo: `Cada boleto es de al menos ${minimaBoleto} Shaulitas.` };
  if (previa + cantidad > maximaCarrera)
    return { ok: false, motivo: previa ? `Ya apostaste ${previa} en esta carrera: puedes sumar hasta ${maximaCarrera - previa} más (el máximo por carrera es ${maximaCarrera}).` : `El máximo por carrera es de ${maximaCarrera} Shaulitas.` };
  if (cantidad > monedas) return { ok: false, motivo: `No te alcanza: tienes ${monedas} Shaulitas.` };
  return { ok: true, total: previa + cantidad };
}

// ───────────────────────── horario ─────────────────────────

/**
 * Horas de las carreras automáticas de `day` (AAAA-MM-DD, en la zona de la config): `porDia` momentos al azar dentro de
 * la ventana, separados al menos `separacionMinutos` y a más de `lejosDePeleasMinutos` de las peleas automáticas
 * (`peleas` = sus "HH:MM" en `peleasZona`). Si no caben, menos. Ordenados.
 */
export function planCarreras(s: CarreraSettings, day: string, peleas: readonly string[], peleasZona: string, rnd: () => number): number[] {
  const from = zonedTime(day, s.horario.desde, s.horario.zona);
  const to = zonedTime(day, s.horario.hasta, s.horario.zona);
  const gap = s.separacionMinutos * 60_000;
  const lejos = s.lejosDePeleasMinutos * 60_000;
  const peleasAt = peleas.map((hm) => zonedTime(day, hm, peleasZona));
  const out: number[] = [];
  for (let tries = 0; out.length < s.porDia && tries < 400; tries++) {
    const t = from + Math.floor(rnd() * Math.max(1, (to - from) / 60_000)) * 60_000;
    if (out.every((x) => Math.abs(x - t) >= gap) && peleasAt.every((p) => Math.abs(p - t) > lejos)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** Grupo de corredores al azar, sin repetir exactamente el de la carrera anterior. */
export function elegirCorredores(ids: readonly string[], n: number, anterior: readonly string[] | null, rnd: () => number = Math.random): string[] {
  if (ids.length < n) throw new Error(`hacen falta al menos ${n} corredores`);
  for (let intento = 0; ; intento++) {
    const copia = [...ids];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [copia[i], copia[j]] = [copia[j]!, copia[i]!];
    }
    const grupo = copia.slice(0, n);
    const igual = anterior && anterior.length === n && grupo.every((x) => anterior.includes(x));
    if (!igual || ids.length === n || intento > 20) return grupo;
  }
}
