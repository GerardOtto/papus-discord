// #vitrina: cuando GyroP publica en un canal de nivel de solo lectura (adelantos, notas, motor, boveda…), Teto avisa
// en #vitrina DONDE hay algo nuevo y para QUIEN, nunca QUE es (no se regala el contenido). Un aviso por canal cada
// cierto tiempo, para no llenar la vitrina si GyroP sube varias cosas seguidas.
import type { ServerLayout } from "../setup/layout";
import { nameKey } from "../setup/layout";

export const VITRINA_COOLDOWN_MS = 6 * 3_600_000;

/** Canales que se anuncian (clave sin emoji -> nivel con su emoji, ej. "🥖 Baguette"). */
export function vitrinaChannels(layout: Pick<ServerLayout, "niveles" | "categorias">): Map<string, string> {
  const tiers = new Set(layout.niveles.map((n) => nameKey(n.rol)));
  const out = new Map<string, string>();
  for (const cat of layout.categorias) {
    if (!tiers.has(nameKey(cat.leen))) continue;
    for (const ch of cat.canales) if (!ch.escriben) out.set(nameKey(ch.nombre), cat.nombre);
  }
  return out;
}

export function shouldTease(lastAt: number | null, now: number, cooldownMs = VITRINA_COOLDOWN_MS): boolean {
  return lastAt === null || now - lastAt >= cooldownMs;
}
