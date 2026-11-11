// Reglas de la ruleta de los Papus (config/ruleta.json, PLAN §3.3). Funciones puras: misiones cumplidas, tiradas
// disponibles, premio al azar y XP del premio. El premio lo decide el codigo, nunca el LLM (regla 4).
import { readFileSync } from "node:fs";
import path from "node:path";
import { progress, type LevelSettings } from "../levels/rules";

export type PrizeKind = "xp" | "cuota" | "cuota_llena" | "sobre";

export interface Prize {
  tipo: PrizeKind;
  /** xp: fraccion de la XP que pide el nivel actual. */
  porcentaje?: number;
  /** cuota: mensajes extra del dia. sobre: sobres comunes gratis de la tienda (1 si falta). */
  valor?: number;
  peso: number;
  /** Emoji de la casilla ("⭐⭐"). */
  icono: string;
  /** Texto corto de la casilla ("XP", "+2"). */
  etiqueta: string;
  nombre: string;
  /** "#RRGGBB" */
  color: string;
}

export interface RouletteSettings {
  misiones: { vozMinutos: number; mensajes: number; subirNivel: boolean };
  bloqueoPorStrike: boolean;
  canalAvisos: string | null;
  xpMinima: number;
  premios: Prize[];
}

export type MissionId = "voz" | "mensajes" | "nivel";

/** Lo que hizo un Papu hoy (tabla xp_dia). */
export interface DayStats {
  vozMin: number;
  mensajes: number;
  subio: boolean;
  castigo: boolean;
}

export interface MissionStatus {
  id: MissionId;
  /** "2 h en voz" */
  nombre: string;
  done: boolean;
  /** Avance para mostrar ("75/120 min"). */
  avance: string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadRouletteSettings(file = path.join(REPO_ROOT, "config/ruleta.json")): RouletteSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as RouletteSettings;
  if (s.premios.length < 2) throw new Error("config/ruleta.json: hacen falta al menos 2 premios");
  for (const p of s.premios) {
    if (!(p.peso > 0)) throw new Error(`config/ruleta.json: el premio "${p.etiqueta}" necesita un peso mayor que 0`);
    if (p.tipo === "xp" && !(p.porcentaje! > 0)) throw new Error(`config/ruleta.json: el premio "${p.etiqueta}" necesita 'porcentaje'`);
    if (p.tipo === "cuota" && !(p.valor! > 0)) throw new Error(`config/ruleta.json: el premio "${p.etiqueta}" necesita 'valor'`);
    if (!/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error(`config/ruleta.json: color invalido en "${p.etiqueta}"`);
  }
  return s;
}

function hours(min: number): string {
  return min % 60 === 0 ? `${min / 60} h` : `${min} min`;
}

/** Las misiones del dia, en orden (las apagadas en la config no salen). */
export function missions(s: RouletteSettings, d: DayStats): MissionStatus[] {
  const m = s.misiones;
  const out: MissionStatus[] = [
    { id: "voz", nombre: `${hours(m.vozMinutos)} en voz`, done: d.vozMin >= m.vozMinutos, avance: `${Math.min(d.vozMin, m.vozMinutos)}/${m.vozMinutos} min` },
    { id: "mensajes", nombre: `${m.mensajes} mensajes`, done: d.mensajes >= m.mensajes, avance: `${Math.min(d.mensajes, m.mensajes)}/${m.mensajes}` },
  ];
  if (m.subirNivel) out.push({ id: "nivel", nombre: "Subir de nivel", done: d.subio, avance: d.subio ? "¡listo!" : "pendiente" });
  return out;
}

/**
 * Tiradas del dia: una por mision cumplida, mas las regaladas (Naranja y platano de Rin y Len, mercado negro), menos
 * las usadas (0 si un strike la bloqueo).
 */
export function spinsLeft(s: RouletteSettings, d: DayStats, used: number, regaladas = 0): number {
  if (s.bloqueoPorStrike && d.castigo) return 0;
  return Math.max(0, missions(s, d).filter((x) => x.done).length + regaladas - used);
}

/** Premio al azar segun los pesos (tambien los del sorteo). Devuelve el indice de la casilla. */
export function pickPrize(s: { premios: readonly { peso: number }[] }, rnd: () => number = Math.random): number {
  const total = s.premios.reduce((a, p) => a + p.peso, 0);
  let r = rnd() * total;
  for (let i = 0; i < s.premios.length; i++) {
    r -= s.premios[i]!.peso;
    if (r < 0) return i;
  }
  return s.premios.length - 1;
}

/** XP de un premio de XP: porcentaje de lo que pide su nivel actual (con minimo), por el multiplicador del evento. */
export function prizeXp(s: { xpMinima: number }, ls: LevelSettings, prize: { porcentaje?: number }, xp: number, multiplier: number): number {
  const { needed } = progress(ls, xp);
  return Math.round(Math.max(s.xpMinima, (prize.porcentaje ?? 0) * needed) * multiplier);
}
