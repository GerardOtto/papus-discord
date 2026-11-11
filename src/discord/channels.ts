// Canales por nombre (PLAN §8). Se comparan sin acentos, emojis ni signos: "🔒-moderación" = "moderacion".
import { ChannelType, type Guild, type TextChannel } from "discord.js";

export const CHANNELS = {
  bienvenida: "bienvenida",
  general: "general",
  moderacion: "moderacion",
  registro: "registro-bots",
  hablaVocaloids: "habla-con-los-vocaloids",
  reportes: "reportes-y-reclamos",
  /** Registro del chat del mundo de los Papus (solo lectura). */
  plaza: "plaza-papus",
} as const;

export function channelKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

export function findTextChannel(guild: Guild, ...names: string[]): TextChannel | null {
  for (const name of names) {
    const ch = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && channelKey(c.name) === channelKey(name));
    if (ch) return ch as TextChannel;
  }
  return null;
}

/** Junta menciones en mensajes de hasta `max` menciones (para bienvenidas grupales). */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
