// Marcador de texto de las peleas (pedido de GyroP, 18 nov. 2026: el relato de una línea larga por segundo no se
// alcanzaba a leer). Un solo mensaje que se edita cada turno: la cara de cada luchador, barras de vida de cuadritos,
// quién se enfrenta y una línea corta con lo que pasó. El relato largo de siempre queda guardado para el botón
// «📜 Ver relato». Funciones puras: src/discord/peleas.ts las publica.
import type { Accion, Turno } from "./rules";

export interface LuchadorMarcador {
  nombre: string;
  /** Emoji con su cara (el de las carreras) o null. */
  cara: string | null;
  vida: number;
  max: number;
}

/** Barra de 10 cuadritos: verde sobre la mitad, amarilla sobre un cuarto, roja abajo; negra si cayó. */
export function barra(vida: number, max: number, n = 10): string {
  const v = Math.max(0, vida);
  const llenos = v <= 0 ? 0 : Math.max(1, Math.round((v / max) * n));
  const p = v / max;
  const color = p > 0.5 ? "🟩" : p > 0.25 ? "🟨" : "🟥";
  return color.repeat(llenos) + "⬛".repeat(n - llenos);
}

/** Una línea por luchador: «▶️ <cara> **Miku** 🟨🟨🟨⬛… 13/24» o «💀 ~~Miku~~ ⬛⬛… fuera». */
export function lineaLuchador(l: LuchadorMarcador, activo: boolean): string {
  if (l.vida <= 0) return `💀 ~~${l.nombre}~~ ${barra(0, l.max)} fuera`;
  return `${activo ? "▶️" : "▫️"} ${l.cara ? `${l.cara} ` : ""}**${l.nombre}** ${barra(l.vida, l.max)} ${Math.max(0, l.vida)}/${l.max}`;
}

const ACCION: Record<Accion, string> = { ataque: "⚔️ ATACA", bloqueo: "🛡️ BLOQUEA", esquiva: "💨 ESQUIVA", especial: "🌟" };

/** «⚔️ Miku ATACA → 🛡️ Luka BLOQUEA · Luka −2» (corta: se lee de un vistazo). */
export function lineaAccion(t: Turno, nombres: [string, string], especiales: [string, string]): string {
  const que = (k: 0 | 1) => (t.acciones[k] === "especial" ? `🌟 ${nombres[k]} usa **${especiales[k]}**` : `${ACCION[t.acciones[k]].split(" ")[0]} ${nombres[k]} ${ACCION[t.acciones[k]].split(" ")[1]}`);
  const efectos: string[] = [];
  for (const k of [0, 1] as const) {
    if (t.dano[k]) efectos.push(`${nombres[k]} **−${t.dano[k]}**`);
    if (t.cura[k]) efectos.push(`${nombres[k]} **+${t.cura[k]}**`);
    if (t.esquivo[k]) efectos.push(`¡${nombres[k]} esquiva!`);
  }
  return `${que(0)}  →  ${que(1)}  ·  ${efectos.join(" · ") || "sin daño"}`;
}

/** La tabla: el equipo (o luchador) de la izquierda, «— VS —» y el de la derecha. */
export function tabla(lados: [LuchadorMarcador[], LuchadorMarcador[]], activos: [number, number] | null): string {
  const bloque = (k: 0 | 1) => lados[k].map((l, i) => lineaLuchador(l, !!activos && activos[k] === i)).join("\n");
  return [bloque(0), "**— VS —**", bloque(1)].join("\n");
}

/** La tabla y debajo lo último que pasó (sin líneas: «¡Suena la campana!»). */
export function marcador(lados: [LuchadorMarcador[], LuchadorMarcador[]], activos: [number, number] | null, ultimo: string[]): string {
  return [tabla(lados, activos), "", ...(ultimo.length ? ultimo : ["🔔 ¡Suena la campana!"])].join("\n");
}

/**
 * El relato línea por línea arriba y la tabla abajo (GyroP, 18 nov. 2026: que se siga imprimiendo como antes, con la
 * tabla debajo). Si no cabe en `max` caracteres (el recuadro de Discord admite 4.096), se quitan las primeras líneas del
 * relato; la tabla nunca se corta.
 */
export function conRelato(tablaTexto: string, lineas: readonly string[], max = 4000): string {
  if (!lineas.length) return `🔔 ¡Suena la campana!\n\n${tablaTexto}`;
  let desde = 0;
  const armar = () => `${desde ? "-# ⋯\n" : ""}${lineas.slice(desde).join("\n")}\n\n${tablaTexto}`;
  while (desde < lineas.length - 1 && armar().length > max) desde++;
  const d = armar();
  // Una sola línea gigante (no pasa en la práctica): se recorta el relato, nunca la tabla.
  return d.length <= max ? d : `${d.slice(0, Math.max(0, max - tablaTexto.length - 3))}…\n\n${tablaTexto}`;
}
