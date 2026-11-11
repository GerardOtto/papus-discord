// Reglas de las Shaula-coins (PLAN §3.6, config/monedas.json y config/objetos.json). Funciones puras: monedas del
// día, sobres con garantías, Ecos, cómo se paga una compra y el calendario de vitrinas de la temporada (todos los
// objetos salen al menos una vez). Nada de esto da XP ni cuota (regla 1).
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export type Rareza = "comun" | "rara" | "epica" | "legendaria" | "mitica" | "fundador" | "membresia" | "contrabando";
export const RAREZAS_SOBRE = ["comun", "rara", "epica", "legendaria", "mitica"] as const;
export type RarezaSobre = (typeof RAREZAS_SOBRE)[number];
export type Tipo = "fondo" | "borde" | "barra" | "nombre" | "aro" | "insignia" | "titulo";
export const TIPOS: Tipo[] = ["fondo", "borde", "barra", "nombre", "aro", "insignia", "titulo"];
export const TIPO_NOMBRE: Record<Tipo, string> = { fondo: "Fondo", borde: "Borde", barra: "Barra de XP", nombre: "Efecto de nombre", aro: "Aro de avatar", insignia: "Insignia", titulo: "Título" };
export const RAREZA_NOMBRE: Record<Rareza, string> = { comun: "Común", rara: "Rara", epica: "Épica", legendaria: "Legendaria", mitica: "Mítica", fundador: "Fundador", membresia: "Membresía", contrabando: "Contrabando" };
export const RAREZA_COLOR: Record<Rareza, string> = { comun: "#C9CED6", rara: "#39C5BB", epica: "#B36BFF", legendaria: "#FFC83D", mitica: "#FF5FA2", fundador: "#F6E7B0", membresia: "#FF8FB1", contrabando: "#8FE36B" };
const ORDEN: Record<Rareza, number> = { comun: 0, rara: 1, epica: 2, legendaria: 3, mitica: 4, fundador: 5, membresia: 5, contrabando: 5 };
/**
 * Rarezas que no se venden en la tienda, no salen en sobres ni se fabrican: se regalan (fundadores, insignias de
 * membresía) o se compran en el mercado negro (contrabando, config/mercado.json).
 */
export const RAREZAS_REGALO: readonly Rareza[] = ["fundador", "membresia", "contrabando"];

export interface Objeto {
  id: string;
  nombre: string;
  tipo: Tipo;
  rareza: Rareza;
  /** "arte" = dibujado con código (cualquier moneda); "render" = imagen de Diva-a-Render (solo ganadas). */
  origen: "arte" | "render";
  animado?: boolean;
  /** Insignia: el emoji. Título: el texto. */
  valor?: string;
  /** Ruta dentro de assets/coleccion (fondos con renders, insignias de fundador y de membresía). */
  imagen?: string;
  descripcion: string;
  temporada: string;
  /** Días del año (MM-DD, hora de Chile) en que puede salir; fuera de ellos no sale en sobres ni vitrinas. */
  limitado?: { desde: string; hasta: string; texto: string };
}

export interface CoinSettings {
  activo: boolean;
  ganar: { xpPorMoneda: number; topeActividad: number; primerMensaje: number; mision: number; boda: number; racha7: number; subirNivel: number; rangoNuevo: number };
  sobre: {
    precio: number;
    objetos: [number, number][];
    probabilidades: Record<RarezaSobre, number>;
    garantiaEpica: number;
    garantiaLegendaria: number;
    semanal: { diasMinimos: number };
    /** 1 sobre gratis cada día que complete todas las misiones de la ruleta. */
    porMisiones: boolean;
    /** Clases de sobre: cuántos objetos, la rareza mínima garantizada y su precio en ganadas (sin precio, solo se regala). */
    tipos?: Partial<Record<TipoSobre, { nombre: string; objetos?: [number, number][]; minimo?: RarezaSobre; precio?: number }>>;
  };
  precios: Record<"comun" | "rara" | "epica" | "legendaria", number>;
  ecos: Record<RarezaSobre, number>;
  paquetes: { id: string; nombre: string; monedas: number; usd: number; clp: number }[];
  pagos: { venceDias: number };
  membresias: Record<string, number>;
  /** Insignia permanente de cada rol de membresía (id en config/objetos.json, rareza "membresia"). */
  insigniasMembresia?: Record<string, string>;
  vitrinas: { dias: number[]; arte: number; renders: number };
  temporada: { id: string; nombre: string; desde: string; hasta: string };
  canales: { tienda: string; registro: string };
  fundadores: { id: string; numero: number; nombre: string }[];
}

export function loadCoinSettings(file = path.join(REPO_ROOT, "config/monedas.json")): CoinSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as CoinSettings;
  const prob = Object.values(s.sobre.probabilidades).reduce((a, b) => a + b, 0);
  if (Math.abs(prob - 100) > 0.01) throw new Error(`config/monedas.json: las probabilidades del sobre suman ${prob}, deben sumar 100`);
  if (!(s.sobre.precio > 0) || !s.sobre.objetos.length) throw new Error("config/monedas.json: el sobre necesita precio y cantidades de objetos");
  for (const [tipo, t] of Object.entries(s.sobre.tipos ?? {})) {
    if (t?.precio !== undefined && !(Number.isInteger(t.precio) && t.precio > 0)) throw new Error(`config/monedas.json: sobre.tipos.${tipo}.precio debe ser un entero mayor que 0`);
  }
  for (const p of s.paquetes) if (!(p.monedas > 0 && p.usd > 0 && p.clp > 0)) throw new Error(`config/monedas.json: paquete inválido ${p.id}`);
  if (s.vitrinas.dias.some((d) => d < 0 || d > 6)) throw new Error("config/monedas.json: vitrinas.dias van de 0 (domingo) a 6 (sábado)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.temporada.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(s.temporada.hasta) || s.temporada.desde >= s.temporada.hasta)
    throw new Error("config/monedas.json: temporada.desde y temporada.hasta son AAAA-MM-DD, y desde va antes");
  return s;
}

export function loadCatalog(file = path.join(REPO_ROOT, "config/objetos.json")): Objeto[] {
  const doc = JSON.parse(readFileSync(file, "utf8")) as { objetos: Objeto[] };
  const ids = new Set<string>();
  for (const o of doc.objetos) {
    if (ids.has(o.id)) throw new Error(`config/objetos.json: id repetido ${o.id}`);
    ids.add(o.id);
    if (!TIPOS.includes(o.tipo)) throw new Error(`config/objetos.json: tipo desconocido en ${o.id}`);
    if (!(o.rareza in ORDEN)) throw new Error(`config/objetos.json: rareza desconocida en ${o.id}`);
    if (o.origen === "render" && !o.imagen) throw new Error(`config/objetos.json: ${o.id} es un render y necesita 'imagen'`);
    if ((o.tipo === "insignia" || o.tipo === "titulo") && !o.valor) throw new Error(`config/objetos.json: ${o.id} necesita 'valor'`);
  }
  return doc.objetos;
}

// ───────────────────────── fechas (días "AAAA-MM-DD", ya en hora de Chile) ─────────────────────────

const toUtc = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * 86_400_000);
/** 0 = domingo … 6 = sábado. */
export const weekday = (day: string) => new Date(toUtc(day)).getUTCDay();
/** Lunes de la semana del día (las semanas van de lunes a domingo). */
export const weekStart = (day: string) => addDays(day, -((weekday(day) + 6) % 7));

/** ¿Puede salir hoy? (objetos de temporada limitada, como el especial de Halloween). */
export function availableOn(o: Objeto, day: string): boolean {
  if (!o.limitado) return true;
  const md = day.slice(5);
  const { desde, hasta } = o.limitado;
  return desde <= hasta ? md >= desde && md <= hasta : md >= desde || md <= hasta;
}

// ───────────────────────── ganar ─────────────────────────

/** Lo que hizo un Papu en un día (de xp_dia, la ruleta y las bodas). */
export interface DayActivity {
  xp: number;
  mensajes: number;
  vozMin: number;
  castigo: boolean;
  misiones: number;
  /** Misiones de la ruleta de ese día (0 sin ruleta). */
  misionesTotal: number;
  bodas: number;
  /** Ese día completó una racha de 7 días seguidos escribiendo (7, 14, 21…). */
  racha: boolean;
  /**
   * PC de Adachi Rei (mercado negro): XP del día cuando lo usó y monedas por actividad ya ganadas antes. Desde ahí el
   * tope de actividad vuelve a empezar, sin quitar lo de antes.
   */
  reinicio?: { xp: number; previa: number };
}

/**
 * Monedas por actividad (1 cada `xpPorMoneda` XP del día, hasta `topeActividad`). Tras el PC de Adachi Rei, lo de antes
 * más un tramo nuevo con su propio tope.
 */
export function activityCoins(s: CoinSettings, a: Pick<DayActivity, "xp" | "reinicio">): number {
  const g = s.ganar;
  const tramo = (xp: number) => Math.min(g.topeActividad, Math.floor(Math.max(0, xp) / g.xpPorMoneda));
  return a.reinicio ? a.reinicio.previa + tramo(a.xp - a.reinicio.xp) : tramo(a.xp);
}

/** Monedas ganadas en el día (sin los bonos por nivel, que se suman al subir). Con machetazo, 0. */
export function dayEarnings(s: CoinSettings, a: DayActivity): number {
  if (a.castigo) return 0;
  const g = s.ganar;
  const actividad = activityCoins(s, a);
  return actividad + (a.mensajes > 0 ? g.primerMensaje : 0) + a.misiones * g.mision + a.bodas * g.boda + (a.racha ? g.racha7 : 0);
}

/** ¿Ese día completó todas las misiones de la ruleta (sin machetazo)? Da 1 sobre gratis. */
export function missionSobre(s: CoinSettings, a: DayActivity): boolean {
  return s.sobre.porMisiones && !a.castigo && a.misionesTotal > 0 && a.misiones >= a.misionesTotal;
}

/** Bono por subir de nivel: por cada nivel, más el rango nuevo. */
export function levelBonus(s: CoinSettings, from: number, to: number, rankUp: boolean): number {
  if (to <= from) return 0;
  return (to - from) * s.ganar.subirNivel + (rankUp ? s.ganar.rangoNuevo : 0);
}

// ───────────────────────── sobres ─────────────────────────

export interface Pity {
  /** Sobres seguidos sin Épica o mejor. */
  sinEpica: number;
  /** Sobres seguidos sin Legendaria o mejor. */
  sinLegendaria: number;
}

function pickWeighted<T>(items: [T, number][], rnd: () => number): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r < 0) return v;
  }
  return items[items.length - 1]![0];
}

/** Objetos que pueden salir en un sobre ese día: los de la temporada (sin regalos y respetando los limitados). */
export function sobrePool(catalog: Objeto[], temporada: string, day: string): Objeto[] {
  return catalog.filter((o) => o.temporada === temporada && !RAREZAS_REGALO.includes(o.rareza) && availableOn(o, day));
}

/** Clases de sobre: el común (el de siempre), el raro y el legendario (con una rareza mínima asegurada; también premios de la trivia). */
export type TipoSobre = "comun" | "raro" | "legendario";
export const TIPOS_SOBRE: TipoSobre[] = ["comun", "raro", "legendario"];

/** Cómo es un sobre de esa clase (el común usa lo de siempre; sin config, el raro asegura Épica y el legendario, Legendaria). */
export function sobreKind(s: CoinSettings, tipo: TipoSobre): { nombre: string; objetos: [number, number][]; minimo: RarezaSobre | null; precio: number | null } {
  const def = { comun: { nombre: "Sobre común" }, raro: { nombre: "Sobre raro", minimo: "epica" as const }, legendario: { nombre: "Sobre legendario", minimo: "legendaria" as const } }[tipo];
  const t = { ...def, ...s.sobre.tipos?.[tipo] };
  // Precio en ganadas: el común, el de siempre (sobre.precio); los demás, el suyo o ninguno (solo se regalan).
  const precio = tipo === "comun" ? s.sobre.precio : (t.precio ?? null);
  return { nombre: t.nombre, objetos: t.objetos ?? s.sobre.objetos, minimo: ("minimo" in t ? t.minimo : null) ?? null, precio };
}

/**
 * Abre un sobre: cuántos objetos, la rareza de cada uno (con garantías: el sobre N sin Épica trae una; igual con
 * Legendaria) y cuál de esa rareza. Si una rareza no tiene objetos, baja a la siguiente que tenga.
 */
export function rollSobre(s: CoinSettings, pool: Objeto[], pity: Pity, rnd: () => number = Math.random, tipo: TipoSobre = "comun", extra = 0): { objetos: Objeto[]; pity: Pity } {
  const kind = sobreKind(s, tipo);
  // extra = objetos de más (Helado de Kaito, mercado negro).
  const n = pickWeighted(kind.objetos, rnd) + extra;
  const byRarity = new Map<RarezaSobre, Objeto[]>();
  for (const r of RAREZAS_SOBRE) byRarity.set(r, pool.filter((o) => o.rareza === r));
  const rarities: RarezaSobre[] = Array.from({ length: n }, () => pickWeighted(RAREZAS_SOBRE.map((r) => [r, s.sobre.probabilidades[r]] as [RarezaSobre, number]), rnd));
  const best = () => Math.max(...rarities.map((r) => ORDEN[r]));
  // Garantías: se cumplen subiendo el objeto más bajo del sobre.
  const lift = (to: RarezaSobre) => {
    let low = 0;
    rarities.forEach((r, i) => (ORDEN[r] < ORDEN[rarities[low]!] ? (low = i) : 0));
    rarities[low] = to;
  };
  if (pity.sinLegendaria + 1 >= s.sobre.garantiaLegendaria && best() < ORDEN.legendaria) lift("legendaria");
  if (pity.sinEpica + 1 >= s.sobre.garantiaEpica && best() < ORDEN.epica) lift("epica");
  // Sobre raro o legendario: al menos un objeto de su rareza mínima.
  if (kind.minimo && best() < ORDEN[kind.minimo]) lift(kind.minimo);
  const objetos = rarities.map((r) => {
    let idx = RAREZAS_SOBRE.indexOf(r);
    while (idx > 0 && !byRarity.get(RAREZAS_SOBRE[idx]!)!.length) idx--;
    const list = byRarity.get(RAREZAS_SOBRE[idx]!)!.length ? byRarity.get(RAREZAS_SOBRE[idx]!)! : pool;
    return list[Math.floor(rnd() * list.length)]!;
  });
  const top = Math.max(...objetos.map((o) => ORDEN[o.rareza]));
  return {
    objetos,
    pity: { sinEpica: top >= ORDEN.epica ? 0 : pity.sinEpica + 1, sinLegendaria: top >= ORDEN.legendaria ? 0 : pity.sinLegendaria + 1 },
  };
}

/** Ecos por un repetido (10 % de su precio). */
export function ecosFor(s: CoinSettings, r: Rareza): number {
  return RAREZAS_REGALO.includes(r) ? 0 : s.ecos[r as RarezaSobre];
}

/** Precio en la tienda (y costo de fabricarlo en Ecos). null = no se vende ni se fabrica (míticas y regalos). */
export function priceOf(s: CoinSettings, o: Objeto): number | null {
  return o.rareza === "mitica" || RAREZAS_REGALO.includes(o.rareza) ? null : s.precios[o.rareza as keyof CoinSettings["precios"]];
}

// ───────────────────────── pagar ─────────────────────────

/** Cómo se paga una compra: primero con compradas, después con ganadas. Los renders, solo con ganadas. null = no alcanza. */
export function paySplit(precio: number, wallet: { ganadas: number; compradas: number }, soloGanadas: boolean): { compradas: number; ganadas: number } | null {
  const compradas = soloGanadas ? 0 : Math.min(wallet.compradas, precio);
  const ganadas = precio - compradas;
  return ganadas <= wallet.ganadas ? { compradas, ganadas } : null;
}

// ───────────────────────── vitrinas ─────────────────────────

export interface Vitrina {
  /** Día en que abre (AAAA-MM-DD) y día en que la reemplaza la siguiente (no incluido). */
  desde: string;
  hasta: string;
  objetos: string[];
}

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Calendario de vitrinas de la temporada: una por cada día de cambio (lunes y jueves) entre desde y hasta. Cada objeto
 * que se vende (sin míticas ni fundadores) sale al menos una vez, en una vitrina de los días en que está disponible;
 * los lugares que sobran repiten primero los de mayor rareza. Es determinista (misma temporada, mismo calendario).
 */
export function seasonSchedule(s: CoinSettings, catalog: Objeto[]): Vitrina[] {
  const { desde, hasta, id } = s.temporada;
  // Abre una el primer día y luego cada día de cambio; una vitrina nunca dura menos de 2 días (si la temporada empieza
  // la víspera de un cambio, la primera sigue hasta el cambio siguiente).
  const starts: string[] = [];
  for (let d = desde; d < hasta; d = addDays(d, 1)) {
    const prev = starts[starts.length - 1];
    if (d === desde || (s.vitrinas.dias.includes(weekday(d)) && prev !== undefined && d >= addDays(prev, 2))) starts.push(d);
  }
  const vitrinas: Vitrina[] = starts.map((d, i) => ({ desde: d, hasta: starts[i + 1] ?? hasta, objetos: [] }));
  if (!vitrinas.length) return [];
  const rnd = seeded(id);
  const vende = catalog.filter((o) => o.temporada === id && priceOf(s, o) !== null);
  const okIn = (o: Objeto, v: Vitrina) => {
    for (let d = v.desde; d < v.hasta; d = addDays(d, 1)) if (availableOn(o, d)) return true;
    return false;
  };
  const place = (group: Objeto[], perVitrina: number) => {
    // Primero los limitados (tienen menos vitrinas posibles), después el resto en orden al azar.
    const order = [...group.filter((o) => o.limitado), ...shuffle(group.filter((o) => !o.limitado), rnd)];
    const used = new Map<Vitrina, number>();
    const count = (v: Vitrina) => used.get(v) ?? 0;
    for (const o of order) {
      const options = vitrinas.filter((v) => okIn(o, v) && count(v) < perVitrina && !v.objetos.includes(o.id));
      if (!options.length) continue;
      const v = options.reduce((a, b) => (count(b) < count(a) ? b : a));
      v.objetos.push(o.id);
      used.set(v, count(v) + 1);
    }
    // Lugares que sobran: repiten, de mayor a menor rareza (sin repetir dentro de la misma vitrina).
    const repeat = [...group].sort((a, b) => ORDEN[b.rareza] - ORDEN[a.rareza]);
    for (const v of vitrinas) {
      for (const o of repeat) {
        if (count(v) >= perVitrina) break;
        if (!v.objetos.includes(o.id) && okIn(o, v)) {
          v.objetos.push(o.id);
          used.set(v, count(v) + 1);
        }
      }
    }
  };
  place(vende.filter((o) => o.origen === "arte"), s.vitrinas.arte);
  place(vende.filter((o) => o.origen === "render"), s.vitrinas.renders);
  return vitrinas;
}

/** Vitrina abierta ese día (null fuera de la temporada). */
export function vitrinaOn(schedule: Vitrina[], day: string): Vitrina | null {
  return schedule.find((v) => v.desde <= day && day < v.hasta) ?? null;
}

/** Código de pedido: SC- y 4 letras o números fáciles de leer (sin O/0 ni I/1). */
export function orderCode(rnd: () => number = Math.random): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `SC-${Array.from({ length: 4 }, () => abc[Math.floor(rnd() * abc.length)]).join("")}`;
}

/** Insignias de membresía que corresponden a sus roles (todas las que tenga; son permanentes). */
export function membershipBadges(s: CoinSettings, roleNames: string[]): string[] {
  return Object.entries(s.insigniasMembresia ?? {}).filter(([rol]) => roleNames.includes(rol)).map(([, id]) => id);
}

/** Regalo de membresía: el del nivel más alto que tenga (el que más monedas da). null si no tiene ninguno. */
export function membershipGift(s: CoinSettings, roleNames: string[]): { rol: string; monedas: number } | null {
  let best: { rol: string; monedas: number } | null = null;
  for (const [rol, monedas] of Object.entries(s.membresias)) if (roleNames.includes(rol) && (!best || monedas > best.monedas)) best = { rol, monedas };
  return best;
}
