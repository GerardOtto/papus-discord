// Beneficios de las membresías de Ko-fi (config/membresias.json, PLAN §2; decisiones de GyroP del 13 nov. 2026).
// Funciones puras: el nivel de un Papu según sus roles (vale el más alto), el multiplicador de XP, cuántas peleas y
// bodas puede lanzar, los sobres temáticos de regalo y el descuento de la tienda. Nada pagado es azar: los sobres de
// membresía se eligen y nunca traen renders.
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export type EstiloBanner = "basico" | "brillo" | "particulas" | "animado";

export interface NivelMembresia {
  rol: string;
  id: string;
  nombre: string;
  emoji: string;
  color: string;
  xp: number;
  peleas: { dia: number; elige: boolean; propio?: boolean };
  bodas: { dia: number; elige: boolean };
  /** Carreras que lanza al día (PLAN §3.14): siempre con corredores al azar. Sin el campo, 0. */
  carreras?: { dia: number };
  sobres: { cantidad: number; ve: number; elige: number; mitico: number };
  recuperar: number;
  descuento: number;
  vitrinaSiguiente: boolean;
  tituloPropio: boolean;
  insigniaExtra: boolean;
  /** /color con hex propio (Celular y más). */
  colorPropio: boolean;
  /** Recibe el fondo de membresía de la temporada (Baguette y más). */
  fondo: boolean;
  /** Se turna para patrocinar el ranking diario: su tarjeta va al pie de la imagen (Baguette y más; antes «presentado por @Papu»). */
  presentaRanking: boolean;
  /** Su nombre en la portada de la trivia multijugador (Celular y más). */
  nombrePortada: boolean;
  banner: EstiloBanner;
}

export interface MembresiaSettings {
  activo: boolean;
  niveles: NivelMembresia[];
  /** Fondo de membresía de la temporada en curso (id en config/objetos.json). */
  fondoTemporada?: string;
  antiguedad: { meses: number; objeto: string }[];
  lanzar: { bodaEsperaMin: number };
  periodoDias: number;
  tituloPropio: { max: number };
}

const ESTILOS: EstiloBanner[] = ["basico", "brillo", "particulas", "animado"];

export function loadMembresiaSettings(file = path.join(REPO_ROOT, "config/membresias.json")): MembresiaSettings {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const s = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$"))) as unknown as MembresiaSettings;
  if (!s.niveles?.length) throw new Error("config/membresias.json: faltan niveles");
  const ids = new Set<string>();
  for (const n of s.niveles) {
    if (ids.has(n.id)) throw new Error(`config/membresias.json: id repetido ${n.id}`);
    ids.add(n.id);
    if (!(n.xp >= 1 && n.xp <= 3)) throw new Error(`config/membresias.json: ${n.id}.xp va de 1 a 3`);
    if (!(n.sobres.elige >= 1 && n.sobres.elige <= n.sobres.ve)) throw new Error(`config/membresias.json: ${n.id}.sobres: elige va de 1 a ve`);
    if (!(n.descuento >= 0 && n.descuento < 100)) throw new Error(`config/membresias.json: ${n.id}.descuento va de 0 a 99`);
    if (!ESTILOS.includes(n.banner)) throw new Error(`config/membresias.json: ${n.id}.banner desconocido`);
    if (!/^#[0-9a-f]{6}$/i.test(n.color)) throw new Error(`config/membresias.json: ${n.id}.color es #RRGGBB`);
  }
  if (!(s.periodoDias > 0)) throw new Error("config/membresias.json: periodoDias debe ser mayor que 0");
  return s;
}

/** El nivel de membresía más alto que tiene (según sus roles), o null. */
export function nivelDe(s: MembresiaSettings, roleNames: readonly string[]): NivelMembresia | null {
  if (!s.activo) return null;
  for (let i = s.niveles.length - 1; i >= 0; i--) if (roleNames.includes(s.niveles[i]!.rol)) return s.niveles[i]!;
  return null;
}

/** Multiplicador de XP por su membresía (1 sin membresía). */
export function multiplicadorXp(n: NivelMembresia | null): number {
  return n?.xp ?? 1;
}

/** Aplica el multiplicador a una cantidad de XP (redondeo hacia abajo; nunca resta). */
export function conMultiplicador(xp: number, n: NivelMembresia | null): number {
  if (xp <= 0 || !n) return xp;
  return Math.floor(xp * n.xp);
}

/** Insignias de antigüedad que le corresponden con esos meses. */
export function antiguedadPara(s: MembresiaSettings, meses: number): string[] {
  return s.antiguedad.filter((a) => meses >= a.meses).map((a) => a.objeto);
}

export type QueLanza = "pelea" | "boda" | "carrera";

/** Cuántas peleas, bodas o carreras puede lanzar hoy (0 = no puede) y si elige a los personajes (en carreras, nunca). */
export function lanzamientos(n: NivelMembresia | null, que: QueLanza): { dia: number; elige: boolean; propio: boolean } {
  if (!n) return { dia: 0, elige: false, propio: false };
  if (que === "carrera") return { dia: n.carreras?.dia ?? 0, elige: false, propio: false };
  const x = que === "pelea" ? n.peleas : n.bodas;
  return { dia: x.dia, elige: x.elige, propio: que === "pelea" && !!n.peleas.propio };
}

/** Le quedan lanzamientos hoy (usados = los que ya lanzó hoy). */
export function puedeLanzar(n: NivelMembresia | null, que: QueLanza, usados: number): boolean {
  return usados < lanzamientos(n, que).dia;
}

/** Lo mismo que `normalizar` del título propio: sin espacios de más; null si no sirve (vacío, largo o caracteres raros). */
export function limpiarTitulo(texto: string, max: number): string | null {
  const t = texto.replace(/\s+/g, " ").trim();
  if (!t || t.length > max) return null;
  // Letras (con acentos), números, espacios y signos simples. Sin @, enlaces ni emojis personalizados.
  if (!/^[\p{L}\p{N} .,!¡?¿'"\-~♡♪★☆]+$/u.test(t)) return null;
  return t;
}
