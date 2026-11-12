// Acciones de la plaza que ejecuta el bot (como un comando de Discord, con las mismas reglas): la pagina las pide, la
// sala las deja en D1 (mundo_acciones), el bot las toma cada pocos segundos (src/mundo/puente.ts) y deja el resultado,
// y la sala se lo entrega al Papu. Tambien la cola de la ruleta grande: el premio se decide al girar (en el bot), y la
// ruleta de la plaza muestra los giros de a uno, para todos, en el orden en que llegaron (de la plaza o de Discord).
// Funciones puras: las comparten la sala, la pagina y las pruebas.

/** Acciones que la plaza le puede pedir al bot. */
export const ACCIONES = ["ruleta.estado", "ruleta.girar", "pesca.capturar", "tienda.estado", "tienda.comprar", "mercado.estado", "mercado.comprar"] as const;
export type Accion = (typeof ACCIONES)[number];
export const esAccion = (a: unknown): a is Accion => typeof a === "string" && (ACCIONES as readonly string[]).includes(a);

/** Acciones mas seguidas que esto se ignoran (doble clic o script). */
export const ACCION_MIN_MS = 400;
/** Despues de esto la sala deja de esperar el resultado (el bot tampoco toma una accion tan vieja). */
export const ACCION_VENCE_MS = 60_000;

export interface Mision {
  id: string;
  /** "2 h en voz" */
  nombre: string;
  icono: string;
  hecha: boolean;
  actual: number;
  meta: number;
}

/** Casilla de la ruleta (config/ruleta.json -> premios). */
export interface Casilla {
  icono: string;
  etiqueta: string;
  color: string;
  nombre: string;
}

/** Panel de la ruleta de un Papu (lo mismo que /ruleta en Discord). */
export interface RuletaEstado {
  /** El preview muestra el progreso real de misiones, pero no permite consumir tiradas ni premios. */
  soloLectura?: boolean;
  tiradas: number;
  usadas: number;
  bloqueada: boolean;
  misiones: Mision[];
  /** Notas del mercado negro (Micrófono de Meiko, Disquete, regalos de Rin y Len, Atún de Luka). */
  extras: string[];
  casillas: Casilla[];
}

/** Lo que la ruleta grande muestra de un giro (y el Papu ve en su ventana al terminar). */
export interface Giro {
  papu: string;
  nombre: string;
  index: number;
  /** "¡+312 XP!" */
  titulo: string;
  /** "Nivel 12 · ¡a seguir!" */
  subtitulo: string;
  origen: "plaza" | "discord";
}

/** Lo que devuelve "ruleta.girar" cuando salio bien: el giro, el premio en palabras y las tiradas que quedan. */
export interface RuletaGiro {
  giro: Giro;
  /** "+312 XP (¡subió al nivel 13!)" */
  texto: string;
  tiradas: number;
}

/** Resultado de una accion: lo que devuelve el bot, o un motivo si no se pudo. */
export type Resultado = { ok: true; datos: unknown } | { ok: false; motivo: string };

// ───────────────────────── cola de la ruleta grande ─────────────────────────

/** Lo que dura cada giro en la ruleta de la plaza: la vuelta y el premio a la vista. */
export const GIRO_MS = 8000;
/** Giros esperando como maximo (los de Discord de mas se pierden: igual salieron en Discord). */
export const COLA_MAX = 12;

export interface ColaRuleta {
  actual: (Giro & { inicio: number }) | null;
  cola: Giro[];
}

export const COLA_VACIA: ColaRuleta = { actual: null, cola: [] };

/** Agrega un giro a la fila (o lo pone a girar si la ruleta esta libre). */
export function formar(c: ColaRuleta, g: Giro, ahora: number): ColaRuleta {
  const libre = avanzar(c, ahora);
  if (!libre.actual) return { actual: { ...g, inicio: ahora }, cola: libre.cola };
  if (libre.cola.length >= COLA_MAX && g.origen === "discord") return libre;
  return { actual: libre.actual, cola: [...libre.cola, g] };
}

/** Termina el giro que ya cumplio su tiempo y pone a girar el siguiente. */
export function avanzar(c: ColaRuleta, ahora: number): ColaRuleta {
  let { actual, cola } = c;
  while (actual && ahora >= actual.inicio + GIRO_MS) {
    const fin = actual.inicio + GIRO_MS;
    const [sig, ...resto] = cola;
    // El siguiente empieza al terminar el anterior; si la alarma llego tarde, ahora (cada giro se ve completo).
    actual = sig ? { ...sig, inicio: Math.max(fin, ahora) } : null;
    cola = resto;
  }
  return actual === c.actual && cola === c.cola ? c : { actual, cola };
}

/** Cuando hay que volver a mirar la cola (fin del giro actual), o null si esta quieta. */
export function proximoCambio(c: ColaRuleta): number | null {
  return c.actual ? c.actual.inicio + GIRO_MS : null;
}

/** Puesto del Papu: 0 = girando ahora, 1 = el siguiente…; null si no esta. */
export function puesto(c: ColaRuleta, papu: string): number | null {
  if (c.actual?.papu === papu && c.actual.origen === "plaza") return 0;
  const i = c.cola.findIndex((g) => g.papu === papu && g.origen === "plaza");
  return i < 0 ? null : i + 1;
}

/**
 * Angulo final de la rueda (radianes, sentido antihorario visto de frente) para que la casilla `index` de `n` quede bajo
 * la flecha de arriba, despues de `vueltas` vueltas completas. Las casillas van en el sentido del reloj desde arriba.
 */
export function anguloFinal(index: number, n: number, vueltas = 5): number {
  const paso = (Math.PI * 2) / n;
  return vueltas * Math.PI * 2 + (index + 0.5) * paso;
}
