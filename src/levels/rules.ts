// Reglas de los niveles por participacion (config/niveles.json, PLAN §niveles). Funciones puras: las usan los bots
// (src/levels/service.ts) y el calculo inicial con el historial del servidor (scripts/niveles.ts), asi dan lo mismo.
// Nada de pago da XP ni cuota (regla 1): solo escribir y hablar en voz.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface LevelSettings {
  curva: { base: number; exponente: number; maximo: number };
  xpPorPalabras: { hasta?: number; xp: number }[];
  esperaSegundos: number;
  repetidos: number;
  multiplicadorBots: number;
  /** silenciado: con el microfono silenciado. maximoMinutosDia: minutos con XP de voz por Papu y por dia. */
  voz: { xpPorPapu: number; maximoPorMinuto: number; silenciado?: { xpPorPapu: number; maximoPorMinuto: number }; maximoMinutosDia?: number };
  /** pisoRolManual: nivel minimo de quien tiene el rol (dado a mano o desde antes de subir el honor al 40). */
  honor: { nivel: number; rol: string; pisoRolManual?: number };
  cuota: { desde: number; mensajes: number }[];
  cuotaPrestigio: number;
  /** Mensajes ganados que no caben en la cuota llena: XP por cada uno (fraccion de lo que pide su nivel, con minimo). */
  cuotaSobrante?: { porcentajeNivel: number; minimo: number };
  transicion: { mensajes: number; hasta: string } | null;
  /** estilo: insignia de la tarjeta y del ranking (0 gris … 10 Salon de la fama), ver tierFill en card.ts. */
  rangos: { desde: number; nombre: string; estilo: number }[];
  /** Ventana de XP multiplicada desde la salida de cada video del calendario. */
  estrenos?: { multiplicador: number; horas: number };
  eventos: XpEvent[];
}

/** Ventana de XP multiplicada: /evento de GyroP o el estreno de un video. */
export interface XpWindow {
  multiplicador: number;
  desde?: number;
  hasta: number;
}

export interface XpEvent {
  nombre: string;
  multiplicador: number;
  /** dia: 0 = domingo … 6 = sabado; horas "HH:MM" en la zona de la cuota. */
  semanal?: { dia: number; desde: string; hasta: string };
  /** "MM-DD": todo el dia. */
  anual?: string;
}

export function loadLevelSettings(file = path.join(path.resolve(import.meta.dirname, "../.."), "config/niveles.json")): LevelSettings {
  return JSON.parse(readFileSync(file, "utf8")) as LevelSettings;
}

// ───────────────────────── curva ─────────────────────────

/** XP total para llegar al nivel `level` (el 1 es gratis). */
export function xpToReach(s: LevelSettings, level: number): number {
  if (level <= 1) return 0;
  return Math.round(s.curva.base * Math.pow(level - 1, s.curva.exponente));
}

export function levelFor(s: LevelSettings, xp: number): number {
  let level = 1;
  while (level < s.curva.maximo && xp >= xpToReach(s, level + 1)) level++;
  return level;
}

/** Avance dentro del nivel actual (para la barra de la tarjeta). En el maximo, la barra va llena. */
export function progress(s: LevelSettings, xp: number): { level: number; into: number; needed: number } {
  const level = levelFor(s, xp);
  if (level >= s.curva.maximo) return { level, into: 1, needed: 1 };
  const from = xpToReach(s, level);
  return { level, into: xp - from, needed: xpToReach(s, level + 1) - from };
}

/** Rango de un nivel: indice en la lista (para notar el cambio), nombre y estilo de la insignia. */
export function rankFor(s: LevelSettings, level: number): { index: number; nombre: string; estilo: number } {
  let index = 0;
  s.rangos.forEach((r, i) => {
    if (level >= r.desde) index = i;
  });
  const r = s.rangos[index]!;
  return { index, nombre: r.nombre, estilo: r.estilo };
}

// ───────────────────────── XP por mensaje ─────────────────────────

/** Palabras reales: sin enlaces, emojis personalizados ni menciones; una "palabra" lleva al menos una letra o numero. */
export function wordCount(text: string): number {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/<[@#][!&]?\d+>/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function messageXp(s: LevelSettings, text: string): number {
  const words = wordCount(text);
  for (const b of s.xpPorPalabras) if (b.hasta === undefined || words <= b.hasta) return b.xp;
  return s.xpPorPalabras.at(-1)!.xp;
}

/** Ultimo mensaje que dio XP y los ultimos textos (para la espera y los repetidos). */
export interface GateState {
  lastAt: number;
  recent: string[];
}

const normalizeText = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Decide si un mensaje da XP: pasada la espera y sin repetir uno de los ultimos. Devuelve el estado nuevo (o null si
 * no da XP; entonces el estado no cambia). Los mensajes sin texto (solo imagen o sticker) no cuentan como repetidos.
 */
export function passGate(s: LevelSettings, state: GateState, text: string, at: number): GateState | null {
  if (at - state.lastAt < s.esperaSegundos * 1000) return null;
  const t = normalizeText(text);
  if (t && state.recent.includes(t)) return null;
  return { lastAt: at, recent: t ? [t, ...state.recent].slice(0, s.repetidos) : state.recent };
}

/** XP de un minuto en voz con `others` Papus mas en el canal (0 si estas solo); `muted`: con el microfono silenciado. */
export function voiceXp(s: LevelSettings, others: number, muted = false): number {
  const r = (muted && s.voz.silenciado) || s.voz;
  return Math.min(Math.max(0, others) * r.xpPorPapu, r.maximoPorMinuto);
}

// ───────────────────────── eventos ─────────────────────────

function zoned(now: Date, timeZone: string): { weekday: number; hm: string; md: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!);
  return { weekday, hm: `${parts.hour}:${parts.minute}`, md: `${parts.month}-${parts.day}` };
}

/** Eventos de config/niveles.json activos ahora (en la zona de la cuota). */
export function activeEvents(s: LevelSettings, now: Date, timeZone: string): XpEvent[] {
  const z = zoned(now, timeZone);
  return s.eventos.filter((e) => {
    if (e.anual) return e.anual === z.md;
    if (e.semanal) return e.semanal.dia === z.weekday && z.hm >= e.semanal.desde && z.hm < e.semanal.hasta;
    return false;
  });
}

/** Momento (ms) en que termina un evento fijo activo: la hora "hasta" de hoy, o la medianoche si es anual. */
export function eventEnd(e: XpEvent, now: Date, timeZone: string): number {
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const nowMin = toMin(zoned(now, timeZone).hm);
  const endMin = e.semanal ? toMin(e.semanal.hasta) : 24 * 60;
  const t = now.getTime() + (endMin - nowMin) * 60_000;
  return t - (t % 60_000);
}

/** Multiplicador vigente: el mayor entre los eventos fijos y las ventanas (/evento, estrenos). No se suman. */
export function multiplierAt(s: LevelSettings, now: Date, timeZone: string, windows: XpWindow[] = []): number {
  const t = now.getTime();
  const fixed = activeEvents(s, now, timeZone).map((e) => e.multiplicador);
  const extra = windows.filter((w) => (w.desde ?? 0) <= t && t < w.hasta).map((w) => w.multiplicador);
  return Math.max(1, ...fixed, ...extra);
}

/** Video del calendario con su hora de salida (ms) y, si la tiene, la XP propia de su estreno (un video fijado). */
export interface Release {
  title: string;
  at: number;
  multiplicador?: number;
  horas?: number;
}

/** Ventanas de estreno de los videos del calendario. */
export function releaseWindows(s: LevelSettings, releases: Pick<Release, "at" | "multiplicador" | "horas">[]): XpWindow[] {
  const e = s.estrenos;
  if (!e) return [];
  return releases.map((r) => ({ multiplicador: r.multiplicador ?? e.multiplicador, desde: r.at, hasta: r.at + (r.horas ?? e.horas) * 3_600_000 }));
}

// ───────────────────────── cuota ─────────────────────────

export function quotaFor(s: LevelSettings, level: number, prestige: number): number {
  if (prestige > 0) return s.cuotaPrestigio;
  let n = s.cuota[0]?.mensajes ?? 0;
  for (const t of s.cuota) if (level >= t.desde) n = t.mensajes;
  return n;
}

/** Cuota con el piso de transicion para quienes ya estaban en el servidor al lanzar los niveles. */
export function quotaWithTransition(s: LevelSettings, level: number, prestige: number, veteran: boolean, now: Date): number {
  const base = quotaFor(s, level, prestige);
  const t = s.transicion;
  if (!veteran || !t || now.getTime() >= Date.parse(t.hasta)) return base;
  return Math.max(base, t.mensajes);
}

// ───────────────────────── apodo ─────────────────────────

const NICK_MAX = 32;
/** " ✦57" o " ★2✦57" al final del apodo. */
const TAG_RE = /\s*(?:★\d+)?✦\d+$/u;

export function nickTag(level: number, prestige: number): string {
  return ` ${prestige > 0 ? `★${prestige}` : ""}✦${level}`;
}

/** Quita la etiqueta de nivel de un nombre (para el LLM y para recordar el apodo propio del Papu). */
export function stripNickTag(name: string): string {
  return name.replace(TAG_RE, "").trim();
}

/** Apodo con el nivel: "karin ✦57". Si no cabe en 32 caracteres, se acorta el nombre, nunca la etiqueta. */
export function nickWithLevel(base: string, level: number, prestige: number): string {
  const tag = nickTag(level, prestige);
  const chars = [...stripNickTag(base)];
  const room = NICK_MAX - [...tag].length;
  const name = (chars.length > room ? chars.slice(0, room).join("").trimEnd() : chars.join("")) || "Papu";
  return `${name}${tag}`;
}
