// Reglas de las bodas con las Vocaloids (config/bodas.json, PLAN §3.2). Funciones puras: revisar respuestas, la XP
// de regalo y el horario del dia. Las respuestas las revisa el codigo, nunca el LLM (regla 4).
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, type BotId } from "../config";
import { levelFor, xpToReach, type LevelSettings } from "../levels/rules";

/**
 * Quien se casa ademas de los 15 Vocaloids: Mango9374 (pedido de GyroP, 12 nov. 2026). No es un Vocaloid (no esta en
 * BOT_IDS): habla con su propio cliente, sin LLM, y sus frases de boda estan en content/frases/mango.json.
 */
export const EXTRA_BRIDES = ["mango"] as const;
export type BrideId = BotId | (typeof EXTRA_BRIDES)[number];
export const isBotBride = (b: BrideId): b is BotId => (BOT_IDS as readonly string[]).includes(b);

export interface WeddingSettings {
  /**
   * Quienes se casan (desde el 25 oct. 2026 tambien los chicos; la clave se quedo como "chicas"). corazon = emoji del
   * rol; chico = textos en masculino; rol = nombre del rol si no es el de siempre (Kaito: no confundirlo con el de Piña);
   * nota = lo que sabe el Vocaloid mientras esta casado (manda sobre lo general). color = "#RRGGBB" del rol (solo
   * Mango9374, que no tiene ficha en el motor).
   */
  chicas: Partial<Record<BrideId, { nombre: string; corazon: string; chico?: boolean; rol?: string; nota?: string; color?: string }>>;
  inaugural: BrideId | null;
  canal: string;
  porDia: number;
  horario: { zona: string; desde: string; hasta: string };
  separacionMinutos: number;
  actividadMinutos: number;
  duracionMinutos: number;
  intentos: number;
  horas: number;
  diasSinRepetir: number;
  recompensa: { nivelCompletoHasta: number; porcentaje: number };
}

export interface Riddle {
  adivinanza: string;
  /** Respuestas aceptadas (la primera es la que se revela). */
  respuestas: string[];
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadWeddingSettings(file = path.join(REPO_ROOT, "config/bodas.json")): WeddingSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as WeddingSettings;
  for (const [id, c] of Object.entries(s.chicas)) {
    if (![...BOT_IDS, ...EXTRA_BRIDES].includes(id as BrideId)) throw new Error(`config/bodas.json: Vocaloid desconocida "${id}"`);
    if (!isBotBride(id as BrideId) && !/^#[0-9a-f]{6}$/i.test(c?.color ?? "")) throw new Error(`config/bodas.json: ${id} necesita 'color' (#RRGGBB)`);
  }
  if (s.inaugural && !s.chicas[s.inaugural]) throw new Error(`config/bodas.json: la inaugural (${s.inaugural}) no está en 'chicas'`);
  return s;
}

export function loadRiddles(file = path.join(REPO_ROOT, "content/bodas.json")): Partial<Record<BrideId, Riddle[]>> {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$"))) as Partial<Record<BrideId, Riddle[]>>;
}

/** "❤️ Espos@ de Teto" (o el rol propio de la config, como el de Kaito). */
export function weddingRole(s: WeddingSettings, bot: BrideId): string {
  const c = s.chicas[bot]!;
  return c.rol ?? `${c.corazon} Espos@ de ${c.nombre}`;
}

/** Palabras que cambian si el Vocaloid es chico: "ella"/"él", "casada"/"casado", "soltera"/"soltero". */
export function genderWords(s: WeddingSettings, bot: BrideId): { el: string; casado: string; soltero: string } {
  return s.chicas[bot]?.chico ? { el: "él", casado: "casado", soltero: "soltero" } : { el: "ella", casado: "casada", soltero: "soltera" };
}

// ───────────────────────── respuestas ─────────────────────────

// Las funciones viven en ./answer (puras, sin archivos: tambien las usa el worker de Cloudflare).
export { answerWords, isCorrect } from "./answer";

// ───────────────────────── recompensa ─────────────────────────

/**
 * XP de regalo por casarse (GyroP): bajo el nivel `nivelCompletoHasta`, un nivel completo desde donde esta; desde ese
 * nivel, `porcentaje` de lo que pide su nivel actual. El evento de XP la multiplica: ×2 = dos niveles completos (o el
 * doble del porcentaje); ×1,5 = un nivel y medio.
 */
export function weddingXp(s: WeddingSettings, ls: LevelSettings, xp: number, multiplier: number): number {
  const need = (l: number) => xpToReach(ls, l + 1) - xpToReach(ls, l);
  const level = levelFor(ls, xp);
  const m = Math.max(1, multiplier);
  if (level >= s.recompensa.nivelCompletoHasta) return Math.round(need(level) * s.recompensa.porcentaje * m);
  const whole = Math.floor(m);
  let total = 0;
  for (let k = 0; k < whole; k++) total += need(level + k);
  return Math.round(total + (m - whole) * need(level + whole));
}

// ───────────────────────── horario ─────────────────────────

/** Momento (ms) de "HH:MM" del dia `day` (AAAA-MM-DD) en la zona `timeZone`. */
export function zonedTime(day: string, hm: string, timeZone: string): number {
  const guess = Date.parse(`${day}T${hm}:00Z`);
  // Diferencia entre la hora de la zona y UTC en ese momento (se repite una vez por los cambios de horario).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value]),
    );
    const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    t += guess - shown;
  }
  return t;
}

/**
 * Horas del dia para las adivinanzas: `n` momentos al azar dentro de la ventana, separados al menos
 * `separacionMinutos` (si no caben, menos). Ordenados.
 */
export function planSlots(s: WeddingSettings, day: string, n: number, rnd: () => number): number[] {
  const from = zonedTime(day, s.horario.desde, s.horario.zona);
  const to = zonedTime(day, s.horario.hasta, s.horario.zona);
  const gap = s.separacionMinutos * 60_000;
  const out: number[] = [];
  for (let tries = 0; out.length < n && tries < 200; tries++) {
    const t = from + Math.floor(rnd() * Math.max(1, (to - from) / 60_000)) * 60_000;
    if (out.every((x) => Math.abs(x - t) >= gap)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}
