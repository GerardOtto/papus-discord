// Ambiente casual de los Vocaloids (PLAN §3.13): configuracion (config/ambiente.json), preguntas al aire
// (content/encuestas.json) y las decisiones puras (que palabra toca a que bot, en que momento del dia estamos).
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, type BotId } from "../config";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export interface ReactionRule {
  patron: string;
  emoji: string;
}

export interface Moment {
  id: string;
  /** Hora de inicio (incluida) y de fin (excluida), en la zona de la cuota. */
  desde: number;
  hasta: number;
  /** 0 = domingo … 6 = sabado; vacio = todos los dias. */
  dias: number[];
  /** Solo si un Papu escribio hace poco en #general. */
  conGente: boolean;
  situacion: string;
}

export interface AmbientSettings {
  activo: boolean;
  reacciones: { activo: boolean; probabilidad: number; maxPorBotDia: number; esperaCanalSeg: number; excluir: string[]; reglas: Partial<Record<BotId, ReactionRule[]>> };
  metiche: { activo: boolean; probabilidad: number; esperaCanalMin: number; maxDia: number; canales: string[]; nombres: Partial<Record<BotId, string>> };
  eventos: { activo: boolean; probabilidad: number; maxDia: number; esperaMin: number; rachaTrivia: number };
  encuestas: { activo: boolean; silencioHoras: number; maxDia: number; resultadoHoras: number; desde: number; hasta: number };
  momentos: { activo: boolean; lista: Moment[] };
  dramas: { activo: boolean; probabilidad: number; turnos: number; maxDia: number; desde: number; hasta: number };
}

export interface Poll {
  pregunta: string;
  opciones: { emoji: string; texto: string }[];
}

/** Quita las claves "$comentario" a cualquier profundidad. */
const strip = <T>(o: T): T => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith("$") ? undefined : v))) as T;

export function loadAmbientSettings(file = path.join(REPO_ROOT, "config/ambiente.json")): AmbientSettings {
  const s = strip(JSON.parse(readFileSync(file, "utf8")) as AmbientSettings);
  for (const bot of [...Object.keys(s.reacciones.reglas), ...Object.keys(s.metiche.nombres)])
    if (!(BOT_IDS as readonly string[]).includes(bot)) throw new Error(`config/ambiente.json: "${bot}" no es un Vocaloid`);
  if (s.dramas.turnos < 2) throw new Error("config/ambiente.json: dramas.turnos debe ser 2 o más");
  // Valida las expresiones al arrancar (una mala no debe romper cada mensaje).
  for (const rules of Object.values(s.reacciones.reglas)) for (const r of rules ?? []) wordRegex(r.patron);
  for (const p of Object.values(s.metiche.nombres)) if (p) wordRegex(p);
  return s;
}

export function loadPolls(file = path.join(REPO_ROOT, "content/encuestas.json")): Poll[] {
  const polls = (JSON.parse(readFileSync(file, "utf8")) as { encuestas: Poll[] }).encuestas;
  for (const p of polls) {
    const emojis = p.opciones.map((o) => o.emoji);
    if (p.opciones.length < 2 || p.opciones.length > 4 || new Set(emojis).size !== emojis.length)
      throw new Error(`content/encuestas.json: «${p.pregunta}» necesita de 2 a 4 opciones con emojis distintos`);
  }
  return polls;
}

// \b de JavaScript no conoce las tildes ("me aburrí" no terminaria en limite de palabra): se cambia por uno con Unicode.
const W = "[\\p{L}\\p{N}_]";
const BOUNDARY = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
const cache = new Map<string, RegExp>();

/** Expresion de config/ambiente.json, sin distinguir mayusculas y con \b que entiende las tildes. */
export function wordRegex(pattern: string): RegExp {
  let re = cache.get(pattern);
  if (!re) {
    re = new RegExp(pattern.replace(/\\b/g, BOUNDARY), "iu");
    cache.set(pattern, re);
  }
  return re;
}

/** Vocaloids (conectados) a los que les toca reaccionar a este texto, con su emoji. */
export function reactionCandidates(s: AmbientSettings["reacciones"], text: string, active: readonly BotId[]): { bot: BotId; emoji: string }[] {
  const out: { bot: BotId; emoji: string }[] = [];
  for (const bot of active) {
    const rule = (s.reglas[bot] ?? []).find((r) => wordRegex(r.patron).test(text));
    if (rule) out.push({ bot, emoji: rule.emoji });
  }
  return out;
}

/** Vocaloids (conectados) nombrados en el texto sin @, en el orden en que aparecen. */
export function namedBots(s: AmbientSettings["metiche"], text: string, active: readonly BotId[]): BotId[] {
  const found: { bot: BotId; at: number }[] = [];
  for (const bot of active) {
    const p = s.nombres[bot];
    if (!p) continue;
    const m = wordRegex(p).exec(text);
    if (m) found.push({ bot, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.bot);
}

/** Hora (0-23) y dia de la semana (0 = domingo) de `date` en `timeZone`. */
export function clock(date: Date, timeZone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")!.value);
  return { hour, weekday };
}

/** La hora esta en [desde, hasta) (si desde > hasta, cruza la medianoche). */
export function inHours(hour: number, desde: number, hasta: number): boolean {
  return desde <= hasta ? hour >= desde && hour < hasta : hour >= desde || hour < hasta;
}

/** Momentos que tocan ahora (sin mirar si ya salieron hoy ni si hay gente). */
export function momentsNow(list: readonly Moment[], date: Date, timeZone: string): Moment[] {
  const { hour, weekday } = clock(date, timeZone);
  return list.filter((m) => inHours(hour, m.desde, m.hasta) && (m.dias.length === 0 || m.dias.includes(weekday)));
}

/** Emoji sin el selector de variacion (Discord a veces lo guarda sin el U+FE0F: "🏖️" vs "🏖"). */
export const emojiKey = (e: string): string => e.replace(/️/g, "");

/** Votos de cada opcion (sin contar la reaccion del propio bot que pregunto). */
export function pollResult(poll: Poll, counts: Record<string, number>, botReacted: boolean): { texto: string; emoji: string; votos: number }[] {
  const byKey = new Map<string, number>();
  for (const [e, n] of Object.entries(counts)) byKey.set(emojiKey(e), (byKey.get(emojiKey(e)) ?? 0) + n);
  return poll.opciones
    .map((o) => ({ texto: o.texto, emoji: o.emoji, votos: Math.max(0, (byKey.get(emojiKey(o.emoji)) ?? 0) - (botReacted ? 1 : 0)) }))
    .sort((a, b) => b.votos - a.votos);
}
