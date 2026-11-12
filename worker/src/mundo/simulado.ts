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

const ultimoGiroPreview = new Map<string, number>();
const ESPERA_GIRO_PREVIEW_MS = 5_000;

/** Giro puramente visual del preview: no consulta ni modifica RouletteService. */
export function simularRuletaPreview(
  papu: { id: string; nombre: string },
  now: () => number = Date.now,
  rnd: () => number = Math.random,
): Resultado {
  const t = now();
  const ultimo = ultimoGiroPreview.get(papu.id) ?? 0;
  if (t - ultimo < ESPERA_GIRO_PREVIEW_MS) {
    return { ok: false, motivo: `Espera ${Math.ceil((ESPERA_GIRO_PREVIEW_MS - (t - ultimo)) / 1000)} s para probar otro giro.` };
  }
  if (!casillas.length) return { ok: false, motivo: "La ruleta no tiene casillas configuradas." };
  const index = Math.min(casillas.length - 1, Math.floor(Math.max(0, Math.min(0.999999, rnd())) * casillas.length));
  const premio = ruleta.premios[index]!;
  ultimoGiroPreview.set(papu.id, t);
  const datos: RuletaGiro = {
    giro: {
      papu: papu.id,
      nombre: papu.nombre,
      index,
      titulo: `🧪 DEMO · ${premio.etiqueta}`,
      subtitulo: "Resultado simulado · sin premio real",
      origen: "plaza",
    },
    texto: `Simulación: ${premio.nombre}. No se consumió una tirada ni se entregó una recompensa.`,
    tiradas: 0,
    simulado: true,
  };
  return { ok: true, datos };
}

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
