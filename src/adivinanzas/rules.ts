// «¡Adivina, Papu!» (PLAN §3.17): configuración (config/adivinanzas.json), banco (content/adivinanzas.json) y las
// decisiones puras: cuánto vale el pozo en cada momento, qué pista toca, las letras destapadas y el plan del día.
import { readFileSync } from "node:fs";
import path from "node:path";
import { answerWords } from "../bodas/answer";
import { BOT_IDS, type BotId } from "../config";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export const CATEGORIAS = {
  general: { nombre: "Cultura general", color: "#4C8DFF" },
  vocaloid: { nombre: "Vocaloid", color: "#39C5BB" },
  utau: { nombre: "UTAU", color: "#D23246" },
  utaite: { nombre: "Utaites y productores", color: "#9B6CFF" },
  tetociencia: { nombre: "TetoCiencia", color: "#FF8A3D" },
  server: { nombre: "El server", color: "#E8C21A" },
} as const;
export type Categoria = keyof typeof CATEGORIAS;

export interface Adivinanza {
  /** Categoría (CATEGORIAS). */
  c: Categoria;
  /** El texto de la adivinanza. */
  t: string;
  /** Respuestas aceptadas; la primera es la que se revela. */
  r: string[];
  /** Pista en palabras (sale a los pistas.palabras segundos). */
  p: string;
  /** Si está en primera persona de un Vocaloid, solo la deja ese (si está conectado; si no, se salta). */
  bot?: BotId;
}

export interface FrasesAdivinanzas {
  /** Al soltarla. */
  intro: string[];
  /** Al acertar: {papu}, {premio}, {respuesta}. */
  acierto: string[];
  /** Nadie acertó: {respuesta}. */
  nadie: string[];
}

export interface AdivinanzasSettings {
  activo: boolean;
  zonaHoraria: string;
  porDia: { min: number; max: number };
  desde: number;
  hasta: number;
  separacionMin: number;
  reintentoMin: number;
  conGenteMin: number;
  canales: string[];
  duracionSeg: number;
  subidaSeg: number;
  pozoBase: number;
  pozoMax: number;
  pistas: { palabras: number; letras: number };
  actualizarSeg: number;
  intentos: number;
  maxPalabrasIntento: number;
  dorada: { cada: number; multiplicador: number };
  bote: { porFallida: number; max: number };
  maxPremiosDia: number;
  semanal: { rol: string; dia: number; hora: number; top: number };
}

const strip = <T>(o: T): T => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith("$") ? undefined : v))) as T;

export function loadAdivinanzasSettings(file = path.join(REPO_ROOT, "config/adivinanzas.json")): AdivinanzasSettings {
  const s = strip(JSON.parse(readFileSync(file, "utf8")) as AdivinanzasSettings);
  if (s.pozoMax < s.pozoBase) throw new Error("config/adivinanzas.json: pozoMax debe ser mayor o igual que pozoBase");
  if (!(s.pistas.palabras < s.pistas.letras && s.pistas.letras < s.duracionSeg)) throw new Error("config/adivinanzas.json: las pistas van antes del final y en orden");
  if (s.porDia.min > s.porDia.max || s.porDia.min < 0) throw new Error("config/adivinanzas.json: porDia inválido");
  return s;
}

export function loadBanco(file = path.join(REPO_ROOT, "content/adivinanzas.json")): { adivinanzas: Adivinanza[]; frases: FrasesAdivinanzas } {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { adivinanzas: Adivinanza[]; frases: FrasesAdivinanzas };
  validarBanco(raw.adivinanzas);
  for (const k of ["intro", "acierto", "nadie"] as const) if (!raw.frases[k]?.length) throw new Error(`content/adivinanzas.json: faltan frases «${k}»`);
  return { adivinanzas: raw.adivinanzas, frases: raw.frases };
}

export function validarBanco(list: Adivinanza[]): void {
  for (const a of list) {
    if (!(a.c in CATEGORIAS)) throw new Error(`content/adivinanzas.json: categoría «${a.c}» desconocida (${a.t})`);
    if (!a.t?.trim() || !a.p?.trim() || !a.r?.length || a.r.some((r) => !answerWords(r).length)) throw new Error(`content/adivinanzas.json: adivinanza incompleta: ${a.t}`);
    if (a.bot && !(BOT_IDS as readonly string[]).includes(a.bot)) throw new Error(`content/adivinanzas.json: «${a.bot}» no es un Vocaloid`);
  }
}

/** Pozo (sin el bote) a los `ms` de salir: sube en línea recta de pozoBase a pozoMax en subidaSeg y se queda ahí. */
export function pozo(s: AdivinanzasSettings, ms: number, dorada: boolean): number {
  const f = Math.max(0, Math.min(1, ms / (s.subidaSeg * 1000)));
  const base = Math.round(s.pozoBase + (s.pozoMax - s.pozoBase) * f);
  return dorada ? base * s.dorada.multiplicador : base;
}

/** Pista que se ve a los `ms`: 0 = ninguna, 1 = en palabras, 2 = letras destapadas. */
export function pistaEn(s: AdivinanzasSettings, ms: number): 0 | 1 | 2 {
  if (ms >= s.pistas.letras * 1000) return 2;
  if (ms >= s.pistas.palabras * 1000) return 1;
  return 0;
}

/**
 * Letras destapadas de la respuesta: la primera de cada palabra y una de cada tres; el resto, guiones.
 * "reloj" -> "R _ _ O _"; "pan francés" -> "P _ _   F _ _ N _ _ S". Los números y signos se ven tal cual.
 */
export function letrasPista(respuesta: string): string {
  return respuesta
    .trim()
    .split(/\s+/)
    .map((w) =>
      [...w]
        .map((ch, i) => (!/\p{L}/u.test(ch) || i % 3 === 0 ? ch.toLocaleUpperCase("es") : "_"))
        .join(" "),
    )
    .join("   ");
}

/** "1:05" */
export const mmss = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Día, minutos desde medianoche, hora y día de la semana (0 = domingo) en `timeZone`. */
export function relojLocal(date: Date, timeZone: string): { day: string; minutos: number; hora: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const hora = Number(get("hour")) % 24;
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutos: hora * 60 + Number(get("minute")),
    hora,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

/** Lunes ("AAAA-MM-DD") de la semana del día `day` (también "AAAA-MM-DD"). */
export function lunesDe(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((wd + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana anterior a la del día `day`. */
export function lunesAnterior(day: string): string {
  const d = new Date(`${lunesDe(day)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Horas del día (en minutos desde medianoche) a las que sale una adivinanza: entre porDia.min y porDia.max, dentro de
 * [desde, hasta) y separadas al menos separacionMin (si no caben todas, salen las que quepan).
 */
export function planDelDia(s: AdivinanzasSettings, rng: () => number = Math.random): number[] {
  const n = s.porDia.min + Math.floor(rng() * (s.porDia.max - s.porDia.min + 1));
  const ini = s.desde * 60, fin = s.hasta * 60 - Math.ceil(s.duracionSeg / 60);
  const out: number[] = [];
  for (let intento = 0; out.length < n && intento < n * 40; intento++) {
    const m = ini + Math.floor(rng() * Math.max(1, fin - ini));
    if (out.every((x) => Math.abs(x - m) >= s.separacionMin)) out.push(m);
  }
  return out.sort((a, b) => a - b);
}

/** ¿El mensaje cuenta como intento? Las respuestas al mensaje de la adivinanza siempre; si no, solo los cortos. */
export function esIntento(s: AdivinanzasSettings, text: string, respondeA: boolean): boolean {
  if (respondeA) return true;
  if (/<@!?\d+>/.test(text)) return false; // le habla a alguien (un Vocaloid o un Papu): es charla
  const n = answerWords(text).length;
  return n > 0 && n <= s.maxPalabrasIntento;
}
