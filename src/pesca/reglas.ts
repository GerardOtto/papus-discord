// Reglas puras de pesca para la Plaza de los Papus.
// La captura decide el tamaño del pez; esta funcion traduce ese tamaño a XP usando
// la barra que le falta al Papu para alcanzar su siguiente nivel.
// La escritura de XP debe hacerse exclusivamente mediante LevelService.bonus()
// en el proceso de bot autorizado; nunca desde el Worker ni desde una sala Durable Object.

import { progress, type LevelSettings } from "../levels/rules";

export const TAMANOS_PEZ = ["pequeno", "mediano", "grande"] as const;
export type TamanoPez = (typeof TAMANOS_PEZ)[number];

export const PORCENTAJE_XP_PESCA: Readonly<Record<TamanoPez, number>> = {
  pequeno: 0.05,
  mediano: 0.10,
  grande: 0.20,
};

export interface RecompensaPesca {
  tamano: TamanoPez;
  porcentaje: number;
  xp: number;
  /** XP que faltaban al empezar la captura para subir al siguiente nivel. */
  barraNecesaria: number;
}

/**
 * Calcula la recompensa de una captura como fraccion de la barra del nivel actual.
 * La barra se mide entre el XP total del nivel actual y el umbral del siguiente.
 * Devuelve null para tamaños invalidos; en el nivel maximo no entrega XP adicional.
 */
export function recompensaPesca(
  settings: LevelSettings,
  xpTotal: number,
  tamano: TamanoPez,
): RecompensaPesca | null {
  if (!TAMANOS_PEZ.includes(tamano)) return null;
  if (!Number.isFinite(xpTotal) || xpTotal < 0) return null;

  const avance = progress(settings, xpTotal);
  if (avance.level >= settings.curva.maximo) {
    return { tamano, porcentaje: PORCENTAJE_XP_PESCA[tamano], xp: 0, barraNecesaria: 0 };
  }

  const porcentaje = PORCENTAJE_XP_PESCA[tamano];
  const barraNecesaria = avance.needed;
  return {
    tamano,
    porcentaje,
    barraNecesaria,
    xp: Math.max(1, Math.round(barraNecesaria * porcentaje)),
  };
}

/** Convierte una captura a un mensaje legible sin duplicar la logica de calculo. */
export function textoRecompensaPesca(r: RecompensaPesca): string {
  const porcentaje = Math.round(r.porcentaje * 100);
  const nombre = r.tamano === "pequeno" ? "pequeño" : r.tamano;
  return r.xp > 0
    ? `🐟 Pez ${nombre}: +${r.xp} XP (${porcentaje}% de tu barra)`
    : `🐟 Pez ${nombre}: ya alcanzaste el nivel máximo; no se suma XP`;
}
