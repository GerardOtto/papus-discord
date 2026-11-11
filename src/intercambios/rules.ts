// Reglas de los intercambios entre Papus (config/intercambios.json, PLAN §3.11). Funciones puras: el paquete de cada
// lado de una oferta (lo que se entrega o se pide), su validación y cómo se describe. El servicio (service.ts) revisa
// que cada uno tenga lo suyo y hace el cambio de una vez, en una sola transacción.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Objeto, Rareza, TipoSobre } from "../coins/rules";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export interface IntercambioSettings {
  activo: boolean;
  /** Canal de los anuncios (#centro-de-comercio). */
  canal: string;
  tema: string;
  /** Modo lento del canal, en segundos (Discord admite hasta 21.600). */
  lento: number;
  /** Cuánto dura una oferta abierta (las que llevan cuota vencen al terminar el día). */
  venceHoras: number;
  /** Ofertas abiertas a la vez por Papu. */
  maxAbiertas: number;
  /** Para intercambiar: nivel mínimo (o prestigio) y días en el servidor. */
  requisitos: { nivel: number; dias: number };
}

export function loadIntercambioSettings(file = path.join(REPO_ROOT, "config/intercambios.json")): IntercambioSettings {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const s = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$"))) as unknown as IntercambioSettings;
  if (!(Number.isInteger(s.lento) && s.lento >= 0 && s.lento <= 21_600)) throw new Error("config/intercambios.json: lento va de 0 a 21600 segundos");
  if (!(s.venceHoras > 0)) throw new Error("config/intercambios.json: venceHoras debe ser mayor que 0");
  if (!(Number.isInteger(s.maxAbiertas) && s.maxAbiertas >= 1)) throw new Error("config/intercambios.json: maxAbiertas debe ser 1 o más");
  if (!(s.requisitos?.nivel >= 1 && s.requisitos?.dias >= 0)) throw new Error("config/intercambios.json: requisitos necesita nivel (≥1) y dias (≥0)");
  if (!s.canal) throw new Error("config/intercambios.json: falta canal");
  return s;
}

/** Lo que un lado entrega (o pide). Las cantidades son enteros ≥ 0. */
export interface Paquete {
  ganadas: number;
  compradas: number;
  xp: number;
  /** Niveles del que entrega, contados como su XP (la XP total no cambia: quien recibe puede subir más o menos). */
  niveles: number;
  /** Mensajes de la cuota de hoy (como /donar). */
  cuota: number;
  sobres: Record<TipoSobre, number>;
  /** Objetos de la colección (ids de config/objetos.json). */
  objetos: string[];
  /** Consumibles del mercado negro: id del objeto -> usos. */
  consumibles: Record<string, number>;
}

/** Las cantidades que se escriben con un número (el resto son listas). */
export const CANTIDADES = ["ganadas", "compradas", "xp", "niveles", "cuota"] as const;
export type Cantidad = (typeof CANTIDADES)[number];
export const TIPOS_SOBRE: readonly TipoSobre[] = ["comun", "raro", "legendario"];

/** Topes por oferta (para que un error de tipeo no mueva una fortuna). */
export const TOPES: Record<Cantidad, number> = { ganadas: 1_000_000, compradas: 1_000_000, xp: 10_000_000, niveles: 98, cuota: 1_000 };
const MAX_OBJETOS = 20;

/** Rarezas que no se cambian: son de una persona (fundadores) o de su membresía. */
export const RAREZAS_SIN_CAMBIO: readonly Rareza[] = ["fundador", "membresia"];

export const vacio = (): Paquete => ({ ganadas: 0, compradas: 0, xp: 0, niveles: 0, cuota: 0, sobres: { comun: 0, raro: 0, legendario: 0 }, objetos: [], consumibles: {} });

export function estaVacio(p: Paquete): boolean {
  return CANTIDADES.every((k) => p[k] === 0) && TIPOS_SOBRE.every((t) => p.sobres[t] === 0) && p.objetos.length === 0 && Object.values(p.consumibles).every((n) => n === 0);
}

/** Se puede cambiar este objeto de la colección. */
export const objetoCambiable = (o: Objeto): boolean => !RAREZAS_SIN_CAMBIO.includes(o.rareza);

const entero = (n: unknown, max: number): number => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
};

/** Limpia un paquete (leído de la base o armado en pantalla): enteros dentro de los topes, sin repetidos ni ceros. */
export function normalizar(raw: Partial<Paquete> | null | undefined): Paquete {
  const p = vacio();
  if (!raw) return p;
  for (const k of CANTIDADES) p[k] = entero(raw[k], TOPES[k]);
  for (const t of TIPOS_SOBRE) p.sobres[t] = entero(raw.sobres?.[t], 1_000);
  p.objetos = [...new Set((raw.objetos ?? []).filter((id) => typeof id === "string" && id))].slice(0, MAX_OBJETOS);
  for (const [id, n] of Object.entries(raw.consumibles ?? {})) {
    const v = entero(n, 1_000);
    if (v > 0) p.consumibles[id] = v;
  }
  return p;
}

/** ¿El paquete lleva cuota de hoy? (entonces la oferta vence al terminar el día). */
export const llevaCuota = (...ps: Paquete[]): boolean => ps.some((p) => p.cuota > 0);

const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));
const SOBRE_NOMBRE: Record<TipoSobre, [string, string]> = { comun: ["sobre común", "sobres comunes"], raro: ["sobre raro", "sobres raros"], legendario: ["sobre legendario", "sobres legendarios"] };

export interface Nombres {
  objeto: (id: string) => { nombre: string; emoji?: string } | null;
  consumible: (id: string) => { nombre: string; emoji: string } | null;
}

/**
 * Una línea por cosa del paquete (para el anuncio y las pantallas). Vacío -> []. `xpNiveles` = la XP que valen sus
 * niveles según el nivel de quien los entrega (null si todavía no se sabe quién, como en una oferta abierta que los pide).
 */
export function describir(p: Paquete, n: Nombres, xpNiveles: number | null = null): string[] {
  const out: string[] = [];
  if (p.ganadas) out.push(`🪙 **${fmt(p.ganadas)}** Shaula-coins ganadas`);
  if (p.compradas) out.push(`💳 **${fmt(p.compradas)}** Shaula-coins compradas`);
  if (p.xp) out.push(`✨ **${fmt(p.xp)}** XP`);
  if (p.niveles) {
    const xp = xpNiveles !== null ? `= **${fmt(xpNiveles)}** XP` : "la XP depende del nivel de quien los entregue";
    out.push(`🆙 **${p.niveles}** ${p.niveles === 1 ? "nivel" : "niveles"} (${xp})`);
  }
  if (p.cuota) out.push(`💬 **${p.cuota}** ${p.cuota === 1 ? "mensaje" : "mensajes"} de la cuota de hoy`);
  for (const t of TIPOS_SOBRE) if (p.sobres[t]) out.push(`🎁 **${p.sobres[t]}** ${SOBRE_NOMBRE[t][p.sobres[t] === 1 ? 0 : 1]}`);
  for (const id of p.objetos) {
    const o = n.objeto(id);
    out.push(`🖼️ ${o ? `**${o.nombre}**` : `\`${id}\``}`);
  }
  for (const [id, usos] of Object.entries(p.consumibles)) {
    const c = n.consumible(id);
    out.push(`${c?.emoji ?? "🎒"} **${c?.nombre ?? id}** × ${usos} ${usos === 1 ? "uso" : "usos"}`);
  }
  return out;
}

/** Quita acentos, signos y mayúsculas (para buscar un objeto por su nombre). */
export function clave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Busca un objeto por nombre: primero exacto, después el que empieza así, después el que lo contiene. */
export function buscar<T extends { id: string; nombre: string }>(lista: readonly T[], texto: string): T | null {
  const q = clave(texto);
  if (!q) return null;
  return (
    lista.find((o) => clave(o.nombre) === q || o.id === texto.trim()) ??
    lista.find((o) => clave(o.nombre).startsWith(q)) ??
    lista.find((o) => clave(o.nombre).includes(q)) ??
    null
  );
}
