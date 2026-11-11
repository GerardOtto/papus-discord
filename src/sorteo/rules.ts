// Reglas del sorteo de los Papus (config/sorteo.json, PLAN §3.5). Funciones puras: premio al azar, ganador al azar sin
// los descartados y colores de las casillas. El premio y el giro los decide el codigo, nunca el LLM (regla 4).
import { readFileSync } from "node:fs";
import path from "node:path";

export type SorteoPrizeKind = "xp" | "fijo" | "manual";

export interface SorteoPrize {
  tipo: SorteoPrizeKind;
  /** xp: fraccion de la XP que pide el nivel actual del ganador. */
  porcentaje?: number;
  /** fijo (se pueden combinar): XP exacta, niveles completos y mensajes extra con los Vocaloids solo ese dia. */
  xp?: number;
  niveles?: number;
  mensajes?: number;
  peso: number;
  icono: string;
  nombre: string;
}

export interface SorteoSettings {
  xpMinima: number;
  premios: SorteoPrize[];
  colores: string[];
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadSorteoSettings(file = path.join(REPO_ROOT, "config/sorteo.json")): SorteoSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as SorteoSettings;
  if (!s.premios.length) throw new Error("config/sorteo.json: hace falta al menos un premio");
  for (const p of s.premios) {
    if (!(p.peso > 0)) throw new Error(`config/sorteo.json: el premio "${p.nombre}" necesita un peso mayor que 0`);
    if (p.tipo !== "xp" && p.tipo !== "fijo" && p.tipo !== "manual") throw new Error(`config/sorteo.json: tipo invalido en "${p.nombre}"`);
    if (p.tipo === "xp" && !(p.porcentaje! > 0)) throw new Error(`config/sorteo.json: el premio "${p.nombre}" necesita 'porcentaje'`);
    if (p.tipo === "fijo" && !(p.xp! > 0 || p.niveles! > 0 || p.mensajes! > 0)) throw new Error(`config/sorteo.json: el premio "${p.nombre}" necesita 'xp', 'niveles' o 'mensajes'`);
  }
  if (s.colores.length < 2 || s.colores.some((c) => !/^#[0-9a-f]{6}$/i.test(c))) throw new Error("config/sorteo.json: hacen falta al menos 2 colores #RRGGBB");
  return s;
}

/** Nombre de un premio fijo: "+500 XP · +2 niveles · +3 mensajes con los Vocaloids hoy". */
export function fixedName(p: { xp?: number; niveles?: number; mensajes?: number }): string {
  const parts: string[] = [];
  if (p.xp) parts.push(`+${new Intl.NumberFormat("es-CL").format(p.xp)} XP`);
  if (p.niveles) parts.push(`+${p.niveles} ${p.niveles === 1 ? "nivel" : "niveles"}`);
  if (p.mensajes) parts.push(`+${p.mensajes} ${p.mensajes === 1 ? "mensaje" : "mensajes"} con los Vocaloids hoy`);
  return parts.join(" · ");
}

/** Ganador al azar entre los que no se descartaron. Null si no queda nadie. */
export function pickWinner<T extends { id: string }>(candidates: readonly T[], excluded: ReadonlySet<string>, rnd: () => number = Math.random): T | null {
  const pool = candidates.filter((c) => !excluded.has(c.id));
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))]! : null;
}

/** Color de cada casilla: la paleta en orden; la ultima nunca repite el color de la primera (quedan juntas). */
export function sliceColors(colors: readonly string[], n: number): string[] {
  const out = Array.from({ length: n }, (_, i) => colors[i % colors.length]!);
  if (n > 2 && out[n - 1] === out[0]) out[n - 1] = colors.find((c) => c !== out[0] && c !== out[n - 2]) ?? out[n - 1]!;
  return out;
}
