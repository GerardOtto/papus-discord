// Desafío semanal de los 7 pecados (config/pecados.json; GyroP, 18 nov. 2026). Una semana por pecado; el anfitrión
// (dueño del pecado en las Evillious Chronicles de mothy) publica el progreso junto al ranking diario de Teto.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BotId } from "../config";
import type { Db } from "../db/database";
import { dayKey } from "../time";

export interface SemanaPecado {
  id: string;
  nombre: string;
  emoji: string;
  anfitrion: BotId;
  inicio: string;
  fin: string;
  titulo: string;
}

export interface PecadosSettings {
  semanas: SemanaPecado[];
  avaricia: { restar: string[] };
  comentarista: {
    minimo: number;
    esperaMin: number;
    maxDiaPorPapu: number;
    retrasoSeg: number;
    fuentes: { motivo: string; canal: string }[];
  };
  top: number;
}

export interface Puesto {
  userId: string;
  puntos: number;
}

const FILE = path.resolve(import.meta.dirname, "../../config/pecados.json");
const DAY_MS = 86_400_000;

export function loadPecados(file = FILE): PecadosSettings {
  const raw = JSON.parse(readFileSync(file, "utf8")) as PecadosSettings;
  for (const s of raw.semanas) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(s.fin) || s.fin < s.inicio) throw new Error(`config/pecados.json: fechas inválidas en ${s.id}`);
  }
  return raw;
}

/** Semana en curso el día `day` (AAAA-MM-DD). */
export function semanaDe(settings: PecadosSettings, day: string): SemanaPecado | null {
  return settings.semanas.find((s) => s.inicio <= day && day <= s.fin) ?? null;
}

/** Semana que terminó justo el día anterior a `day` (para anunciar su cierre). */
export function semanaTerminada(settings: PecadosSettings, day: string): SemanaPecado | null {
  return settings.semanas.find((s) => addDay(s.fin) === day) ?? null;
}

export function addDay(day: string, n = 1): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Días que quedan contando hoy (el último día cuenta como 1). */
export function diasRestantes(s: SemanaPecado, day: string): number {
  return Math.round((Date.parse(`${s.fin}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / DAY_MS) + 1;
}

/** Cuánto suma un movimiento a la Avaricia: todo lo que entra; de lo que sale, solo los motivos de `restar`. */
export function valorAvaricia(cantidad: number, motivo: string, restar: string[]): number {
  if (cantidad > 0) return cantidad;
  return restar.some((r) => motivo.startsWith(r)) ? cantidad : 0;
}

/** Tabla de la Avaricia entre `inicio` y `fin` (días en `timeZone`), de mayor a menor (solo puntajes > 0). */
export function tablaAvaricia(db: Db, settings: PecadosSettings, s: SemanaPecado, timeZone: string): Puesto[] {
  // Rango con un día de holgura a cada lado; el día exacto se filtra con la zona horaria.
  const desde = Date.parse(`${s.inicio}T00:00:00Z`) - DAY_MS;
  const hasta = Date.parse(`${s.fin}T23:59:59Z`) + DAY_MS;
  const rows = db
    .prepare("SELECT user_id, cantidad, motivo, at FROM movimientos WHERE bolsillo = 'ganadas' AND at BETWEEN ? AND ?")
    .all(desde, hasta) as { user_id: string; cantidad: number; motivo: string; at: number }[];
  const total = new Map<string, number>();
  for (const r of rows) {
    const d = dayKey(new Date(r.at), timeZone);
    if (d < s.inicio || d > s.fin) continue;
    const v = valorAvaricia(r.cantidad, r.motivo, settings.avaricia.restar);
    if (v) total.set(r.user_id, (total.get(r.user_id) ?? 0) + v);
  }
  return [...total]
    .map(([userId, puntos]) => ({ userId, puntos }))
    .filter((p) => p.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos);
}

/** Tabla del pecado de esa semana; null si su meta aún no está programada. */
export function tablaPecado(db: Db, settings: PecadosSettings, s: SemanaPecado, timeZone: string): Puesto[] | null {
  if (s.id === "avaricia") return tablaAvaricia(db, settings, s, timeZone);
  return null;
}
