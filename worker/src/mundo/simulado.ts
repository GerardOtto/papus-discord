// Solo para probar la plaza en el PC (wrangler dev con ACTIVIDAD_PRUEBA=1 y Papus de prueba): el bot no lee la base
// local, asi que la sala responde las acciones con datos de ejemplo. Nunca corre en produccion (ahi las acciones de
// Papus de prueba no existen: sin ACTIVIDAD_PRUEBA no hay Papus de prueba).
import ruleta from "../../../config/ruleta.json";
import type { Accion, Casilla, Resultado, RuletaEstado, RuletaGiro } from "./acciones";

const casillas: Casilla[] = ruleta.premios.map((p) => ({ icono: p.icono, etiqueta: p.etiqueta, color: p.color, nombre: p.nombre }));
/** Tiradas usadas por cada Papu de prueba (se pierden al reiniciar wrangler: da igual). */
const usadas = new Map<string, number>();
const TIRADAS = 3;

const TITULOS: Record<string, [string, string]> = {
  xp: ["¡+120 XP!", "Nivel 12 · ¡a seguir!"],
  cuota: ["¡+2 mensajes!", "con los Vocaloids, solo hoy"],
  cuota_llena: ["¡Cuota llena!", "+3 mensajes con los Vocaloids"],
  sobre: ["¡Un sobre común!", "gratis, en la tienda de Shaula-coins"],
};

export function simular(accion: Accion, papu: { id: string; nombre: string }): Resultado {
  const n = usadas.get(papu.id) ?? 0;
  const estado = (u: number): RuletaEstado => ({
    tiradas: TIRADAS - u,
    usadas: u,
    bloqueada: false,
    misiones: [
      { id: "voz", nombre: "2 h en voz", icono: "🎙️", hecha: true, actual: 120, meta: 120 },
      { id: "mensajes", nombre: "200 mensajes", icono: "💬", hecha: true, actual: 200, meta: 200 },
      { id: "nivel", nombre: "Subir de nivel", icono: "🆙", hecha: true, actual: 1, meta: 1 },
    ],
    extras: ["🧪 Modo de prueba: datos de ejemplo, el premio no se guarda en ningún lado."],
    casillas,
  });
  if (accion === "ruleta.estado") return { ok: true, datos: estado(n) };
  if (n >= TIRADAS) return { ok: false, motivo: "¡Ya giraste todas las de hoy! (modo de prueba: reinicia wrangler para volver a girar)" };
  usadas.set(papu.id, n + 1);
  const index = Math.floor(Math.random() * casillas.length);
  const [titulo, subtitulo] = TITULOS[ruleta.premios[index]!.tipo] ?? ["¡Premio!", ""];
  const datos: RuletaGiro = { giro: { papu: papu.id, nombre: papu.nombre, index, titulo, subtitulo, origen: "plaza" }, texto: titulo, tiradas: TIRADAS - n - 1 };
  return { ok: true, datos };
}
