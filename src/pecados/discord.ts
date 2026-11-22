// Desafío de los 7 pecados en #ranking: el anfitrión de la semana publica el progreso justo después del ranking
// diario de Teto (GyroP, 18 nov. 2026) y, el día siguiente al fin, el cierre con el ganador.
import type { SendableChannels } from "discord.js";
import type { BotId } from "../config";
import type { Db } from "../db/database";
import { kvGet, kvSet } from "../db/database";
import type { Phrases } from "../phrases/catalog";
import { diasRestantes, semanaDe, semanaTerminada, tablaPecado, type PecadosSettings, type Puesto, type SemanaPecado } from "./rules";

export interface PecadosDeps {
  db: Db;
  settings: PecadosSettings;
  phrases: Phrases;
  timeZone: string;
  /** Canal desde el bot pedido; si ese Vocaloid no está conectado, lanza (y se usa Teto). */
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  log: (text: string) => void;
}

const MEDALLAS = ["🥇", "🥈", "🥉"];
const fmt = (n: number) => n.toLocaleString("es-CL");

export function lineasTabla(tabla: Puesto[], top: number, unidad: string): string {
  if (!tabla.length) return "_Nadie suma todavía. ¡El título está libre!_";
  return tabla
    .slice(0, top)
    .map((p, i) => `${MEDALLAS[i] ?? `**${i + 1}.**`} <@${p.userId}> — ${fmt(p.puntos)} ${unidad}`)
    .join("\n");
}

const UNIDAD: Record<string, string> = { avaricia: "Shaulitas" };

async function canalDe(d: PecadosDeps, bot: BotId, channelId: string): Promise<SendableChannels> {
  try {
    return await d.sendable(bot, channelId);
  } catch {
    return d.sendable("teto", channelId);
  }
}

/** Llamar después del ranking del día (ya publicado una sola vez por día). */
export async function publicarPecados(d: PecadosDeps, channelId: string, day: string): Promise<void> {
  const cerrada = semanaTerminada(d.settings, day);
  if (cerrada) await cierre(d, cerrada, channelId);
  const s = semanaDe(d.settings, day);
  if (s) await progreso(d, s, channelId, day);
}

async function progreso(d: PecadosDeps, s: SemanaPecado, channelId: string, day: string): Promise<void> {
  const tabla = tablaPecado(d.db, d.settings, s, d.timeZone);
  if (!tabla || !d.phrases.has("pecados", `${s.id}_progreso`)) return;
  const quedan = diasRestantes(s, day);
  const ch = await canalDe(d, s.anfitrion, channelId);
  await ch.send({
    content: `${d.phrases.pick("pecados", `${s.id}_progreso`)}\n\n${s.emoji} **Desafío de la ${s.nombre}** · ${quedan === 1 ? "¡último día!" : `quedan ${quedan} días`}\n${lineasTabla(tabla, d.settings.top, UNIDAD[s.id] ?? "puntos")}`,
    allowedMentions: { parse: [] },
  });
  d.log(`${s.emoji} Progreso de la ${s.nombre} publicado`);
}

async function cierre(d: PecadosDeps, s: SemanaPecado, channelId: string): Promise<void> {
  const key = `pecados:cierre:${s.id}`;
  if (kvGet(d.db, key)) return;
  const tabla = tablaPecado(d.db, d.settings, s, d.timeZone);
  if (!tabla || !d.phrases.has("pecados", `${s.id}_cierre`)) return;
  kvSet(d.db, key, "1");
  const ganador = tabla[0];
  const ch = await canalDe(d, s.anfitrion, channelId);
  if (!ganador) {
    await ch.send({ content: `${s.emoji} La semana de la ${s.nombre} terminó sin nadie en la tabla. El título queda sin dueño.`, allowedMentions: { parse: [] } });
    return;
  }
  const unidad = UNIDAD[s.id] ?? "puntos";
  await ch.send({
    content: `${d.phrases.pick("pecados", `${s.id}_cierre`, { papu: `<@${ganador.userId}>`, monedas: fmt(ganador.puntos) })}\n\n${s.emoji} **${s.titulo}** · resultado final\n${lineasTabla(tabla, 3, unidad)}`,
    allowedMentions: { users: [ganador.userId] },
  });
  await d.report(`${s.emoji} Terminó la ${s.nombre}: ganó <@${ganador.userId}> con ${fmt(ganador.puntos)} ${unidad}. Falta entregarle el título «${s.titulo}».`).catch(() => {});
  d.log(`${s.emoji} Cierre de la ${s.nombre}: ${ganador.userId}`);
}
