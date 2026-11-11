// Reglas del mercado negro (config/mercado.json, PLAN §3.9). Funciones puras: la hora sorpresa de cada día, si está
// abierto y la validación de los objetos. Todo se paga con Shaula-coins GANADAS (nada pagado da cuota ni XP, regla 1).
import { readFileSync } from "node:fs";
import path from "node:path";
import { dayKey } from "../time";

export type Efecto =
  | "atun"
  | "baguette"
  | "celular"
  | "seguro"
  | "helado"
  | "microfono"
  | "regalo"
  | "luna"
  | "sake"
  | "zanahoria"
  | "doblehelado"
  | "guitarra"
  | "pc"
  | "disquete"
  | "machete"
  | "rol"
  | "objeto";
/** Efectos que se guardan como usos en el inventario de consumibles (/consumibles). */
export const CONSUMIBLES: readonly Efecto[] = ["atun", "baguette", "celular", "seguro", "helado", "microfono", "regalo", "luna", "sake", "zanahoria", "doblehelado", "guitarra", "pc"];
/** Efectos que se compran una vez y duran para siempre (no se compran dos veces). */
export const PERMANENTES: readonly Efecto[] = ["disquete", "machete", "rol", "objeto"];

export interface ObjetoMercado {
  id: string;
  nombre: string;
  emoji: string;
  efecto: Efecto;
  /** Shaula-coins ganadas. */
  precio: number;
  /** Consumibles: cuántas veces sirve cada compra (se suman si compra otro). */
  usos?: number;
  /** Atún: giros extra en un mismo giro de la ruleta. */
  giros?: number;
  /** Baguette: veces que sigue la partida tras fallar, en una misma partida. */
  vidas?: number;
  /** Baguette: segundos para decidir si la usa. Machete: segundos entre un machetazo de mentira y otro. */
  espera?: number;
  /** Luna: días que dura. */
  dias?: number;
  /** Helado: objetos de más en el próximo sobre. */
  extra?: number;
  /** Micrófono: minutos en voz que pide la misión ese día. */
  vozMinutos?: number;
  /** Rol de adorno: nombre y color. */
  rol?: string;
  color?: string;
  /** Adorno de la tarjeta: id en config/objetos.json (rareza "contrabando"). */
  objeto?: string;
  descripcion: string;
}

export interface MercadoSettings {
  activo: boolean;
  canal: string;
  respaldo: string;
  zona: string;
  semilla: string;
  /** Abre a una hora en punto entre `desde` y `hasta` (sin incluirla), durante `minutos`. */
  horario: { desde: number; hasta: number; minutos: number };
  /** Objetos a la venta en cada apertura (rotan cada día; en unos pocos días salen todos). */
  vitrina: number;
  objetos: ObjetoMercado[];
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadMercadoSettings(file = path.join(REPO_ROOT, "config/mercado.json")): MercadoSettings {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const s = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$"))) as unknown as MercadoSettings;
  const h = s.horario;
  if (!(Number.isInteger(h.desde) && Number.isInteger(h.hasta) && h.desde >= 0 && h.hasta <= 24 && h.desde < h.hasta))
    throw new Error("config/mercado.json: horario.desde y horario.hasta son horas enteras de 0 a 24, y desde va antes");
  if (!(h.minutos > 0 && h.minutos <= 24 * 60)) throw new Error("config/mercado.json: horario.minutos debe ser mayor que 0");
  if (!(Number.isInteger(s.vitrina) && s.vitrina >= 1 && s.vitrina <= 5)) throw new Error("config/mercado.json: vitrina va de 1 a 5 (un botón por objeto, en una sola fila de Discord)");
  const ids = new Set<string>();
  for (const o of s.objetos) {
    if (ids.has(o.id)) throw new Error(`config/mercado.json: id repetido ${o.id}`);
    ids.add(o.id);
    if (!(Number.isInteger(o.precio) && o.precio > 0)) throw new Error(`config/mercado.json: ${o.id} necesita un precio entero mayor que 0`);
    if (CONSUMIBLES.includes(o.efecto) && !(Number.isInteger(o.usos) && o.usos! > 0)) throw new Error(`config/mercado.json: ${o.id} necesita 'usos'`);
    if (o.efecto === "atun" && !(o.giros! > 0)) throw new Error(`config/mercado.json: ${o.id} necesita 'giros'`);
    if (o.efecto === "baguette" && !(o.vidas! > 0 && o.espera! > 0)) throw new Error(`config/mercado.json: ${o.id} necesita 'vidas' y 'espera'`);
    if (o.efecto === "helado" && !(Number.isInteger(o.extra) && o.extra! > 0)) throw new Error(`config/mercado.json: ${o.id} necesita 'extra'`);
    if (o.efecto === "microfono" && !(Number.isInteger(o.vozMinutos) && o.vozMinutos! > 0)) throw new Error(`config/mercado.json: ${o.id} necesita 'vozMinutos'`);
    if (o.efecto === "luna" && !(o.dias! > 0)) throw new Error(`config/mercado.json: ${o.id} necesita 'dias'`);
    if (o.efecto === "machete" && !(o.espera! >= 0)) throw new Error(`config/mercado.json: ${o.id} necesita 'espera'`);
    if (o.efecto === "rol" && !(o.rol && /^#[0-9a-f]{6}$/i.test(o.color ?? ""))) throw new Error(`config/mercado.json: ${o.id} necesita 'rol' y 'color'`);
    if (o.efecto === "objeto" && !o.objeto) throw new Error(`config/mercado.json: ${o.id} necesita 'objeto'`);
  }
  for (const e of [...CONSUMIBLES, "disquete", "machete"] as const) if (s.objetos.filter((o) => o.efecto === e).length > 1) throw new Error(`config/mercado.json: solo puede haber un objeto con efecto '${e}'`);
  return s;
}

/** Número del 0 al 1 que sale siempre igual para el mismo texto (FNV-1a). */
function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** Hora (en punto, en la zona del mercado) a la que abre el día `day` ("AAAA-MM-DD"). */
export function openingHour(s: MercadoSettings, day: string): number {
  const { desde, hasta } = s.horario;
  return desde + Math.floor(hash01(`${s.semilla}|${day}`) * (hasta - desde));
}

/** Momento (ms) en que empieza el día `day` en `timeZone` (soporta cambios de horario). */
export function dayStart(day: string, timeZone: string): number {
  // Medianoche UTC de ese día, menos 14 h (la zona más adelantada), y se avanza hasta entrar en el día.
  let t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - 14 * 3_600_000;
  while (dayKey(new Date(t), timeZone) < day) t += 3_600_000;
  t -= 3_600_000;
  while (dayKey(new Date(t), timeZone) < day) t += 60_000;
  return t;
}

export interface Apertura {
  /** Día (en la zona del mercado) de esta apertura. */
  day: string;
  abre: number;
  cierra: number;
}

/** La apertura de un día (en la zona del mercado). */
export function aperturaDe(s: MercadoSettings, day: string): Apertura {
  const abre = dayStart(day, s.zona) + openingHour(s, day) * 3_600_000;
  return { day, abre, cierra: abre + s.horario.minutos * 60_000 };
}

/** La apertura de hoy (en la zona del mercado), haya pasado o no. */
export function aperturaHoy(s: MercadoSettings, now: number): Apertura {
  return aperturaDe(s, dayKey(new Date(now), s.zona));
}

/** La próxima apertura que aún no termina (la de hoy si sigue abierta o no ha abierto; si no, la de mañana). */
export function proximaApertura(s: MercadoSettings, now: number): Apertura {
  const hoy = aperturaHoy(s, now);
  if (now < hoy.cierra) return hoy;
  // 36 h después del inicio de hoy siempre cae mañana (aunque el día dure 23 o 25 h).
  return aperturaDe(s, dayKey(new Date(dayStart(hoy.day, s.zona) + 36 * 3_600_000), s.zona));
}

/** ¿Está abierta la apertura `a` en `now`? */
export const abierta = (a: Apertura, now: number) => now >= a.abre && now < a.cierra;

/** Números al azar que salen siempre iguales para la misma semilla (mulberry32). */
function seeded(seed: string): () => number {
  let a = Math.floor(hash01(seed) * 4294967296);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Los objetos a la venta el día `day` (en la zona del mercado), en el orden del banner. Rotan en ciclos: los objetos se
 * barajan (siempre igual para el mismo ciclo) y cada día del ciclo saca los `vitrina` siguientes; así, en
 * ceil(objetos / vitrina) días salen todos al menos una vez. Los lugares que sobran al final del ciclo repiten los
 * primeros de la baraja (nunca dos veces el mismo en un día).
 */
export function vitrinaDe(s: MercadoSettings, day: string): string[] {
  const ids = s.objetos.map((o) => o.id);
  const k = Math.min(s.vitrina, ids.length);
  const dias = Math.ceil(ids.length / k);
  const n = Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000);
  const ciclo = Math.floor(n / dias);
  const rnd = seeded(`${s.semilla}|ciclo|${ciclo}`);
  const baraja = [...ids];
  for (let i = baraja.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [baraja[i], baraja[j]] = [baraja[j]!, baraja[i]!];
  }
  const lugares = [...baraja, ...baraja].slice(0, dias * k);
  const hoy = n - ciclo * dias;
  return lugares.slice(hoy * k, hoy * k + k);
}
