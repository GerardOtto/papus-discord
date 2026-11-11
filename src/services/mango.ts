// Mango9374 (config/mango.json; pedido de GyroP, 28 oct. 2026): bot que imita a un Papu real. Sin LLM ni cuota
// (regla 4). Desde el 31 oct. 2026 (GyroP) se le puede nombrar sin limite: a un @ de un Papu le da sus numeros del dia
// (src/services/estadisticas.ts), salvo con `probabilidadFrase` (1/3), que suelta una de sus frases; a GyroP, siempre
// los totales del servidor. No es un Vocaloid: no esta en BOT_IDS (sin lore, charla de #general, bodas ni trivia).
import { readFileSync } from "node:fs";
import path from "node:path";

export interface MangoSettings {
  /** Nombre del bot en Discord. */
  nombre: string;
  /** Id de Discord (o nombre de usuario) del Papu real, de quien copia la foto de perfil. */
  usuario: string;
  frases: string[];
  /** Probabilidad de contestar con una frase en vez de los numeros (a GyroP, nunca). */
  probabilidadFrase: number;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadMangoSettings(file = path.join(REPO_ROOT, "config/mango.json")): MangoSettings {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<MangoSettings>;
  const frases = (raw.frases ?? []).map((f) => f.trim()).filter(Boolean);
  if (!raw.nombre || !raw.usuario || frases.length === 0) throw new Error(`${file}: faltan nombre, usuario o frases`);
  const p = raw.probabilidadFrase ?? 1 / 3;
  if (!(p >= 0 && p <= 1)) throw new Error(`${file}: probabilidadFrase va de 0 a 1`);
  return { nombre: raw.nombre, usuario: raw.usuario.toLowerCase(), frases, probabilidadFrase: p };
}

export type MangoAnswer = { kind: "frase"; text: string } | { kind: "numeros" } | { kind: "totales" };

export class MangoService {
  constructor(
    readonly settings: MangoSettings,
    private readonly random: () => number = Math.random,
  ) {}

  /** Que contesta a un @ (sin limite al dia): GyroP, los totales; un Papu, sus numeros o, a veces, una frase. */
  answer(isOwner: boolean): MangoAnswer {
    if (isOwner) return { kind: "totales" };
    if (this.random() >= this.settings.probabilidadFrase) return { kind: "numeros" };
    const f = this.settings.frases;
    return { kind: "frase", text: f[Math.min(f.length - 1, Math.floor(this.random() * f.length))]! };
  }
}

/** El mensaje nombra con @ a este usuario (responderle sin @ no cuenta). */
export function mentionsUser(content: string, userId: string): boolean {
  return [...content.matchAll(/<@!?(\d+)>/g)].some(([, id]) => id === userId);
}

/**
 * Papu perdonado por GyroP de al menos un machetazo (o strike, antes del 28 oct. 2026), segun la linea de #moderación
 * "🧽 GyroP perdonó 1 machetazo y 2 advertencias de <@id>". Perdonar solo advertencias o el silencio no cuenta.
 */
export function pardonedFromLog(text: string): string | null {
  const m = /^🧽 GyroP perdonó (.+?) de <@!?(\d+)>/u.exec(text);
  return m && /\d+ (machetazos?|strikes?)\b/.test(m[1]!) ? m[2]! : null;
}
