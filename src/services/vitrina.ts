// #vitrina: cuando GyroP publica en un canal de nivel de solo lectura (adelantos, notas, motor, boveda…), Teto avisa
// en #vitrina DONDE hay algo nuevo y para QUIEN, nunca QUE es (no se regala el contenido). Un aviso por canal cada
// cierto tiempo, para no llenar la vitrina si GyroP sube varias cosas seguidas.
import type { ServerLayout } from "../setup/layout";
import { nameKey } from "../setup/layout";

export const VITRINA_COOLDOWN_MS = 6 * 3_600_000;

/**
 * Canales que se anuncian (clave sin emoji -> nivel con su emoji, ej. "🥖 Baguette"): los de solo lectura de un nivel
 * (el acceso del canal o el de su categoría), sin los archivados. Si #vitrina está archivada (PLAN §8, 13 nov. 2026),
 * ninguno: ya no se anuncia nada.
 */
export function vitrinaChannels(layout: Pick<ServerLayout, "niveles" | "categorias">): Map<string, string> {
  const tiers = new Map(layout.niveles.map((n) => [nameKey(n.rol), n.rol]));
  const out = new Map<string, string>();
  const vitrina = layout.categorias.flatMap((c) => c.canales).find((ch) => nameKey(ch.nombre) === "vitrina");
  if (!vitrina || vitrina.archivado) return out;
  for (const cat of layout.categorias) {
    for (const ch of cat.canales) {
      const nivel = tiers.get(nameKey(ch.leen ?? cat.leen));
      if (nivel && !ch.escriben && !ch.archivado) out.set(nameKey(ch.nombre), nivel);
    }
  }
  return out;
}

export function shouldTease(lastAt: number | null, now: number, cooldownMs = VITRINA_COOLDOWN_MS): boolean {
  return lastAt === null || now - lastAt >= cooldownMs;
}
