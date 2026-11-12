// Reglas del mundo de los Papus (prototipo de Actividad 3D), funciones puras sin red ni Discord: el mapa, las
// velocidades, que movimiento se acepta y que chat se publica. La sala (sala.ts) solo reenvia: no tiene reloj propio,
// para que el Durable Object hiberne entre mensajes y casi no gaste el plan gratuito de Cloudflare.
import type { Aspecto, Pose } from "./tipos";

/** Radio del mundo (unidades, ~1 m): la plaza central y 10 zonas alrededor (mapa de zonas, decisiones de GyroP, 9 nov. 2026). */
export const RADIO = 54;
/** Velocidades maximas (unidades por segundo). */
export const VELOCIDAD = { camina: 3.2, corre: 6.5, montura: 11 } as const;
/** Cada cuanto manda su pose la pagina como maximo (y solo si se movio). */
export const ENVIO_MS = 200;
/** Mensajes de movimiento mas seguidos que esto se ignoran (pagina modificada o con tirones). */
export const MOV_MIN_MS = 60;
export const CHAT_MAX = 120;
/**
 * Sin limite de mensajes por tiempo para las personas (decision de GyroP, 9 nov. 2026: sobre la cabeza quedan los 3
 * ultimos). Solo frena scripts que manden rafagas: abrir la caja, escribir y enviar toma mas que esto.
 */
export const CHAT_MIN_MS = 250;
export const MAX_PAPUS = 40;

/** La fogata tiene seis asientos compartidos; el índice se reserva por conexión activa. */
export const ASIENTOS_FOGATA = 6;

export function asientoDisponible(ocupados: Iterable<number>): number | null {
  const usados = new Set([...ocupados].filter((n) => Number.isInteger(n) && n >= 0 && n < ASIENTOS_FOGATA));
  for (let i = 0; i < ASIENTOS_FOGATA; i++) if (!usados.has(i)) return i;
  return null;
}

/** Pose mirando hacia el centro de la fogata. Rechaza índices fuera del rango para no crear asientos fantasma. */
export function poseAsientoFogata(fogata: { x: number; z: number }, asiento: number): Pose | null {
  if (!Number.isInteger(asiento) || asiento < 0 || asiento >= ASIENTOS_FOGATA) return null;
  const angulo = (asiento / ASIENTOS_FOGATA) * Math.PI * 2 + 0.3;
  return {
    x: fogata.x + Math.cos(angulo) * 3,
    z: fogata.z + Math.sin(angulo) * 3,
    r: angulo + Math.PI,
    a: 0,
    m: 0,
  };
}

/** Opciones de personalizacion (la pagina las dibuja; la sala solo valida el indice). */
export const ASPECTOS = {
  ropa: ["#39c5bb", "#d4344a", "#e8a0c8", "#f2d541", "#3b6fd9", "#7a4fd6", "#4a9a4a", "#2b2b33"],
  piel: ["#ffe0c8", "#f1c27d", "#c68642", "#8d5524"],
  sombrero: ["nada", "fiesta", "copa", "gato", "puerro"],
} as const;

/**
 * Zonas del mundo, una por funcion del servidor. `x`/`z` = centro (norte = -z, arriba en pantalla). Todas dan su frente
 * al sur (+z), hacia donde esta siempre la camara: asi cada zona se ve de frente, este donde este (si miraran a la
 * fuente, las del sur y los costados se verian de espaldas o de lado).
 */
export const ZONAS = [
  { id: "arena", nombre: "Arena del 1vs1", x: 0, z: -38 },
  { id: "comercio", nombre: "Calle del comercio", x: 26, z: -26 },
  { id: "ruleta", nombre: "Ruleta grande", x: 38, z: 0 },
  { id: "escuela", nombre: "Escuela de la trivia", x: 26, z: 26 },
  { id: "estanque", nombre: "Estanque", x: 9, z: 38 },
  { id: "fogata", nombre: "Fogata", x: -9, z: 38 },
  { id: "altar", nombre: "Altar de bodas", x: -26, z: 26 },
  { id: "fama", nombre: "Salón de la fama", x: -38, z: 0 },
  { id: "sorteo", nombre: "Escenario del sorteo", x: -26, z: -26 },
] as const;

export type ZonaId = (typeof ZONAS)[number]["id"] | "tablon" | "tienda" | "mercado";

/** Punto del mundo a partir de coordenadas locales de una zona (lx = hacia el este, lz = hacia su frente, el sur). */
export function enZona(cx: number, cz: number, lx: number, lz: number): { x: number; z: number } {
  return { x: cx + lx, z: cz + lz };
}

/** Las dos tiendas de la calle del comercio, una junto a la otra. */
export const TIENDAS = (() => {
  const c = ZONAS[1];
  return [
    { id: "tienda" as const, nombre: "Tienda Shaula", x: c.x - 4.2, z: c.z, color: "#e8a0c8" },
    { id: "mercado" as const, nombre: "Mercado negro", x: c.x + 4.2, z: c.z, color: "#4b2a63" },
  ];
})();

/** Tablon de anuncios junto a la fuente (votaciones, noticias, tips, estrenos y calendario). */
export const TABLON = { x: 0, z: 9 };

/** Edificios y adornos con los que se choca (circulos en el suelo): los mismos en la sala y en la pagina. */
export const OBSTACULOS: { x: number; z: number; r: number }[] = [
  { x: 0, z: 0, r: 3.2 }, // fuente
  { x: TABLON.x, z: TABLON.z, r: 1.2 },
  { x: 0, z: -38, r: 7.2 }, // ring de la arena
  ...TIENDAS.map((t) => ({ x: t.x, z: t.z, r: 2.6 })),
  { x: 38, z: 0, r: 2.2 }, // ruleta
  { x: 26, z: 26 - 2.8, r: 3.6 }, // escuela (la casa queda detras de su pizarra)
  { x: 9 - 2.4, z: 38 + 2, r: 3.9 }, // agua del estanque (ovalada: dos circulos)
  { x: 9 + 2.4, z: 38 + 2, r: 3.9 },
  { x: -9, z: 38, r: 0.9 }, // fuego
  { x: -26, z: 26 - 2.1, r: 1.6 }, // arco del altar
  { x: -38, z: -1, r: 2.6 }, // podios
  { x: -26, z: -26 - 1.5, r: 4 }, // tarima del sorteo
];

export const ASPECTO_INICIAL: Aspecto = { ropa: 0, piel: 0, sombrero: 0 };

const entero = (v: unknown, max: number): number | null => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < max ? (v as number) : null);

/** Aspecto valido o null. */
export function validarAspecto(a: unknown): Aspecto | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const ropa = entero(o.ropa, ASPECTOS.ropa.length);
  const piel = entero(o.piel, ASPECTOS.piel.length);
  const sombrero = entero(o.sombrero, ASPECTOS.sombrero.length);
  return ropa === null || piel === null || sombrero === null ? null : { ropa, piel, sombrero };
}

/** Punto de aparicion: alrededor de la fuente, repartido al azar y sin caer sobre el tablon. */
export function aparicion(rnd: () => number = Math.random): Pose {
  for (let i = 0; ; i++) {
    const ang = rnd() * Math.PI * 2;
    const d = 5 + rnd() * 5;
    const x = round(Math.cos(ang) * d);
    const z = round(Math.sin(ang) * d);
    if (i > 20 || !OBSTACULOS.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 0.6)) return { x, z, r: 0, a: 0, m: 0 };
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Pose que manda la pagina, con forma valida y redondeada, o null. */
export function leerPose(o: Record<string, unknown>): Pose | null {
  const { x, z, r, a, m } = o;
  if (typeof x !== "number" || typeof z !== "number" || typeof r !== "number") return null;
  if (![x, z, r].every(Number.isFinite)) return null;
  if (a !== 0 && a !== 1 && a !== 2) return null;
  if (m !== 0 && m !== 1) return null;
  return { x: round(x), z: round(z), r: round(((r % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)), a, m };
}

/**
 * Acepta el movimiento si cabe en la plaza y no es mas rapido de lo que se puede (con margen por los tirones de red).
 * No revisa los obstaculos: chocar es cosa de la pagina; aqui solo se evita teletransportarse.
 */
export function moverValido(antes: Pose, despues: Pose, ms: number): boolean {
  if (Math.hypot(despues.x, despues.z) > RADIO + 0.5) return false;
  const max = despues.m || antes.m ? VELOCIDAD.montura : VELOCIDAD.corre;
  // Tras una pausa larga cuenta como mucho 1 s: la pagina manda la pose cada 200 ms mientras se mueve.
  const segundos = Math.min(Math.max(ms, 0), 1000) / 1000;
  return Math.hypot(despues.x - antes.x, despues.z - antes.z) <= max * segundos * 1.35 + 0.6;
}

/** Texto del chat limpio (una linea, sin espacios de mas, recortado), o null si queda vacio. */
export function limpiarChat(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const t = texto.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
  return t || null;
}

/** Vocaloids que pasean por la plaza: solo a ellos se les puede hablar con @ (responden como en Discord, con cuota). */
export const VOCALOIDS_PLAZA = [{ id: "teto", nombre: "Kasane Teto", alias: ["teto", "kasane teto", "kasaneteto"] }] as const;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Vocaloids de la plaza a los que les habla el texto ("@Teto hola"), en orden y sin repetir. */
export function mencionados(texto: string): string[] {
  const t = sinAcentos(texto);
  const hits: { id: string; at: number }[] = [];
  for (const v of VOCALOIDS_PLAZA) {
    let at = -1;
    for (const a of v.alias) {
      const m = new RegExp(`@\\s?${a.replace(/\s+/g, "\\s?")}(?![a-z0-9])`).exec(t);
      if (m && (at < 0 || m.index < at)) at = m.index;
    }
    if (at >= 0) hits.push({ id: v.id, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

/** Lineas de chat que se guardan por plaza para darle contexto al Vocaloid (como el historial del canal en Discord). */
export const HISTORIAL = 12;

/** Adonde lleva un comando (/ruleta): frente a la zona, mirando hacia ella (al norte). */
export const DESTINOS: Partial<Record<ZonaId, { x: number; z: number }>> = {
  ruleta: enZona(38, 0, 0, 5.5),
};

/** Destino de un salto con un poco de azar (para que dos Papus no queden uno encima del otro). */
export function destino(lugar: unknown, rnd: () => number = Math.random): Pose | null {
  const d = typeof lugar === "string" ? DESTINOS[lugar as ZonaId] : undefined;
  if (!d) return null;
  return { x: round(d.x + (rnd() - 0.5) * 2.4), z: round(d.z + rnd() * 1.2), r: Math.PI, a: 0, m: 0 };
}
