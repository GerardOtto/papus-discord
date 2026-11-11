// Ruleta de los Papus en la plaza (PLAN §3.3 y §3.10): lo mismo que /ruleta en Discord, con las mismas reglas
// (src/ruleta/service.ts). La plaza pide el panel ("ruleta.estado") y gira ("ruleta.girar"); aqui se arma lo que ve.
// El premio lo decide el codigo, nunca el LLM (regla 4).
import type { Casilla, Giro, Mision, Resultado, RuletaEstado, RuletaGiro } from "../../worker/src/mundo/acciones";
import type { MissionId } from "../ruleta/rules";
import type { RouletteService, RouletteStatus, SpinResult } from "../ruleta/service";

const ICONO: Record<MissionId, string> = { voz: "🎙️", mensajes: "💬", nivel: "🆙" };

/** "75/120 min" -> 75 y 120 (la mision de subir de nivel: 0 o 1 de 1). */
function avance(a: string, hecha: boolean): { actual: number; meta: number } {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(a);
  return m ? { actual: Number(m[1]), meta: Number(m[2]) } : { actual: hecha ? 1 : 0, meta: 1 };
}

/** Panel de la ruleta para la plaza (como el de /ruleta en Discord). */
export function ruletaEstado(r: RouletteService, userId: string, st: RouletteStatus = r.status(userId)): RuletaEstado {
  const misiones: Mision[] = st.missions.map((m) => ({ id: m.id, nombre: m.nombre, icono: ICONO[m.id], hecha: m.done, ...avance(m.avance, m.done) }));
  const atun = r.atun?.usos(userId) ?? 0;
  const extras = [
    st.vozReducida ? "🎤 Micrófono de Meiko activo: hoy la misión de voz pide menos." : "",
    st.guardadas ? `💾 Disquete de Adachi Rei: ${st.guardadas} ${st.guardadas === 1 ? "tirada guardada" : "tiradas guardadas"} de días anteriores.` : "",
    st.regaladas ? `🍊🍌 Hoy te regalaron ${st.regaladas} ${st.regaladas === 1 ? "tirada" : "tiradas"} (Rin y Len).` : "",
    // En la plaza se gira directo: elegir el premio con el Atun se hace en Discord.
    atun > 0 ? `🐟 Tienes el Atún de Luka (${atun} ${atun === 1 ? "uso" : "usos"}): para descartar un premio, gira con /ruleta en Discord.` : "",
  ].filter(Boolean);
  const casillas: Casilla[] = r.settings.premios.map((p) => ({ icono: p.icono, etiqueta: p.etiqueta, color: p.color, nombre: p.nombre }));
  return { tiradas: st.left, usadas: st.used, bloqueada: st.blocked, misiones, extras, casillas };
}

/** Motivo para no girar (sin tiradas o con machetazo), como lo diria el panel de Discord. */
export function sinGiro(st: RouletteStatus): string {
  if (st.blocked) return "🚫 Neru te dio un machetazo: sin ruleta por ahora.";
  if (st.used >= st.missions.length + st.regaladas + st.guardadas) return "¡Ya giraste todas las de hoy! Vuelven mañana.";
  return "Aún no tienes tiradas: cumple una misión y gana una.";
}

/** Lo que muestran la ruleta grande y el registro de #plaza-papus de un giro ya aplicado. */
export function giroPlaza(
  papu: { id: string; nombre: string },
  res: SpinResult,
  textos: { titulo: string; subtitulo: string; premio: string },
  origen: Giro["origen"],
): RuletaGiro {
  return {
    giro: { papu: papu.id, nombre: papu.nombre, index: res.index, titulo: textos.titulo, subtitulo: textos.subtitulo, origen },
    texto: textos.premio.replace(/\*\*/g, ""),
    tiradas: res.left,
  };
}

export interface RuletaPlazaDeps {
  roulette: RouletteService;
  /** Titulo y subtitulo del GIF y el premio en palabras (los mismos textos que en Discord). */
  textos: (res: SpinResult) => { titulo: string; subtitulo: string; premio: string };
  /** Despues de girar, como en Discord: rol de nivel y apodo si subio, y misiones nuevas. */
  despues: (userId: string, res: SpinResult) => Promise<void>;
}

/** Las acciones de la ruleta para el puente de la plaza. */
export function accionesRuleta(d: RuletaPlazaDeps): Record<"ruleta.estado" | "ruleta.girar", (papu: { id: string; nombre: string }) => Promise<Resultado> | Resultado> {
  return {
    "ruleta.estado": (papu) => ({ ok: true, datos: ruletaEstado(d.roulette, papu.id) }),
    "ruleta.girar": async (papu) => {
      const res = d.roulette.spin(papu.id);
      if (!res) return { ok: false, motivo: sinGiro(d.roulette.status(papu.id)) };
      await d.despues(papu.id, res).catch(() => {});
      return { ok: true, datos: giroPlaza(papu, res, d.textos(res), "plaza") };
    },
  };
}
