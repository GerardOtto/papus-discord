// Reglas puras del celular de Neru (PLAN §3.15): el reto del día (el mismo para todos), Vocaloidle (comparar un
// intento con el personaje secreto), Silueta (cuánto se aclara la imagen) y la XP de los juegos diarios. Sin node:
// las usan el bot, los scripts y el worker de Cloudflare.

export interface CelularSettings {
  /** Día del reto n.º 1 (AAAA-MM-DD, hora de `zonaHoraria`). */
  inicio: string;
  zonaHoraria: string;
  xp: { tramos: [number, number][]; minimo: number };
  silueta: { lado: number; bloques: number[]; imagenesPorPersonaje: number };
  sesionHoras: number;
}

export interface Personaje {
  id: string;
  nombre: string;
  empresa: string | null;
  anio: number | null;
  pelo: string | null;
  origen: string | null;
  voz: string | null;
}

/** Personaje con todos los datos: el único que puede salir en Vocaloidle. */
export type PersonajeCompleto = { [K in keyof Personaje]: NonNullable<Personaje[K]> };

export type Juego = "vocaloidle" | "silueta";

// ───────────────────────── el día ─────────────────────────

/** AAAA-MM-DD de `t` en la zona horaria dada. */
export function diaClave(t: number, zona: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
  const v = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/** Número del reto de ese día (1 = `inicio`). Antes del inicio da 1. */
export function numeroReto(dia: string, inicio: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(1, Math.round((utc(dia) - utc(inicio)) / 86_400_000) + 1);
}

/** Milisegundos hasta la próxima medianoche de la zona (para «nuevo reto en…»). */
export function msHastaManana(t: number, zona: string): number {
  const hoy = diaClave(t, zona);
  let lo = t;
  let hi = t + 26 * 3_600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (diaClave(mid, zona) === hoy) lo = mid;
    else hi = mid;
  }
  return hi - t;
}

/** Hash de 32 bits (FNV-1a) de un texto. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function azar(semilla: number): () => number {
  let s = semilla | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajar<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * El elegido del reto `n` entre `ids`: cada vuelta (tantos días como ids) los recorre todos en un orden barajado con
 * `sal`, sin repetir dentro de la vuelta ni de una vuelta a la siguiente. El mismo para todos los Papus.
 */
export function elegidoDelDia(ids: readonly string[], n: number, sal: string): string {
  if (!ids.length) throw new Error("No hay personajes para el reto del día");
  const base = [...ids].sort();
  const len = base.length;
  const vuelta = Math.floor((n - 1) / len);
  const orden = (v: number) => barajar(base, azar(hash32(`${sal}:${v}`)));
  const actual = orden(vuelta);
  // Que el primero de una vuelta no sea el último de la anterior.
  if (vuelta > 0 && len > 1 && actual[0] === orden(vuelta - 1)[len - 1]) [actual[0], actual[1]] = [actual[1]!, actual[0]!];
  return actual[(n - 1) % len]!;
}

// ───────────────────────── XP ─────────────────────────

/** Aciertos de trivia que vale resolver el reto en `intentos` (3 en 1-3, 2 en 4-6, 1 desde el 7). */
export function aciertosPorIntentos(s: CelularSettings, intentos: number): number {
  for (const [hasta, aciertos] of s.xp.tramos) if (intentos <= hasta) return aciertos;
  return s.xp.minimo;
}

// ───────────────────────── Vocaloidle ─────────────────────────

export function completo(p: Personaje): p is PersonajeCompleto {
  return p.empresa != null && p.anio != null && p.pelo != null && p.origen != null && p.voz != null;
}

export type Color = "verde" | "amarillo" | "rojo";
export interface Celda {
  valor: string;
  color: Color;
}
export interface Pista {
  id: string;
  nombre: string;
  empresa: Celda;
  anio: Celda & { flecha: "antes" | "despues" | null };
  pelo: Celda;
  origen: Celda;
  voz: Celda;
  acierto: boolean;
}

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const primera = (s: string) => normal(s).split(/\s+/)[0] ?? "";
const deFans = (s: string) => normal(s).includes("fans");

/** Compara un intento con el secreto: 🟩 coincide, 🟨 casi (año a 1; mismo tono de pelo; ambos hechos por fans), 🟥 no. */
export function comparar(intento: PersonajeCompleto, secreto: PersonajeCompleto): Pista {
  const igual = (a: string, b: string) => normal(a) === normal(b);
  const celda = (valor: string, ok: boolean, casi = false): Celda => ({ valor, color: ok ? "verde" : casi ? "amarillo" : "rojo" });
  const dif = secreto.anio - intento.anio;
  return {
    id: intento.id,
    nombre: intento.nombre,
    empresa: celda(intento.empresa, igual(intento.empresa, secreto.empresa)),
    anio: { ...celda(String(intento.anio), dif === 0, Math.abs(dif) === 1), flecha: dif < 0 ? "antes" : dif > 0 ? "despues" : null },
    pelo: celda(intento.pelo, igual(intento.pelo, secreto.pelo), primera(intento.pelo) === primera(secreto.pelo)),
    origen: celda(intento.origen, igual(intento.origen, secreto.origen), deFans(intento.origen) && deFans(secreto.origen)),
    voz: celda(intento.voz, igual(intento.voz, secreto.voz)),
    acierto: intento.id === secreto.id,
  };
}

const CUADRO: Record<Color, string> = { verde: "🟩", amarillo: "🟨", rojo: "🟥" };

/** Resultado para compartir sin spoilers: una fila de cuadritos por intento. */
export function compartir(numero: number, pistas: readonly Pista[]): string {
  const filas = pistas.map((p) => [p.empresa, p.anio, p.pelo, p.origen, p.voz].map((c) => CUADRO[c.color]).join(""));
  return [`Vocaloidle #${numero} · ${pistas.length} ${pistas.length === 1 ? "intento" : "intentos"}`, ...filas].join("\n");
}

/** Busca un personaje por id o por nombre (sin acentos ni mayúsculas; vale el apellido o el nombre de pila). */
export function buscarPersonaje<T extends Personaje>(lista: readonly T[], texto: string): T | null {
  const q = normal(texto);
  if (!q) return null;
  return lista.find((p) => p.id === q || normal(p.nombre) === q) ?? lista.find((p) => normal(p.nombre).split(/\s+/).includes(q)) ?? null;
}

// ───────────────────────── Silueta ─────────────────────────

/** Nivel de la imagen (0 = la más pixelada) tras `fallidos` intentos fallidos; resuelto = la clara. */
export function nivelSilueta(s: CelularSettings, fallidos: number, resuelto: boolean): number {
  const clara = s.silueta.bloques.length;
  return resuelto ? clara : Math.min(fallidos, clara);
}
