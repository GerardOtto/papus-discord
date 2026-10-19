// Publica (o edita) el mensaje fijado de guía de cada canal (content/canales.json), cada uno con su Vocaloid:
// tarjeta con el color del bot, su imagen de reacción y, si corresponde, una imagen grande. Guarda el id de cada
// mensaje en la base del bot: volver a correrlo EDITA el mismo mensaje (no duplica ni vuelve a fijar).
//   npm run guias             -> muestra qué haría
//   npm run guias -- --apply  -> publica/edita y fija
//   npm run guias -- --apply reglas general  -> solo esos canales
// Imágenes de reacción: python scripts/make_reactions.py (assets/bots/reacciones/).
import { readFileSync } from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { CORE_BOT_IDS, loadConfig, loadDotEnv, type CoreBotId } from "../src/config";
import { kvGet, kvSet, openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { EngineReader } from "../src/engine/reader";
import { colorMenu } from "../src/setup/color-menu";
import { loadLayout } from "../src/setup/layout";

interface Guide {
  bot: CoreBotId;
  reaccion: string;
  imagen?: string;
  titulo: string;
  texto: string;
  pie?: string;
  /** Menu adjunto: "colores" = paleta de #tu-color (config/servidor.json -> coloresPapu). */
  menu?: "colores";
}

loadDotEnv();
const config = loadConfig();
const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(import.meta.dirname, "..");
// Canales elegidos (ej.: npm run guias -- --apply reglas general): solo esas guias, sin tocar las demas.
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const guides = Object.entries(JSON.parse(readFileSync(path.join(ROOT, "content/canales.json"), "utf8")) as Record<string, Guide>).filter(
  ([k]) => !k.startsWith("$") && (!only.length || only.includes(k)),
);
const engine = new EngineReader(config.engineDir);
// Las guias las publican las 4 chicas (los Vocaloids de conversacion no tienen guias).
const color = Object.fromEntries(CORE_BOT_IDS.map((id) => [id, engine.character(id).color])) as Record<CoreBotId, number>;
const rest = Object.fromEntries(CORE_BOT_IDS.map((id) => [id, new REST().setToken(config.tokens[id])])) as Record<CoreBotId, REST>;
const db = openDb(path.join(config.dataDir, "papus.sqlite"));

const channels = (await rest.teto.get(Routes.guildChannels(config.guildId))) as { id: string; name: string; type: number }[];
const byKey = new Map(channels.filter((c) => c.type === 0).map((c) => [channelKey(c.name), c]));
const link = (text: string) =>
  text.replace(/\{([a-z0-9-]+)\}/g, (m, k: string) => {
    const ch = byKey.get(k);
    if (!ch) throw new Error(`Enlace a un canal que no existe: ${m}`);
    return `<#${ch.id}>`;
  });

let done = 0;
for (const [key, g] of guides) {
  const ch = byKey.get(key);
  if (!ch) {
    console.log(`✘ no existe el canal "${key}" (revisa config/servidor.json)`);
    continue;
  }
  const thumb = `${g.bot}_${g.reaccion}.png`;
  const files = [{ name: thumb, data: readFileSync(path.join(ROOT, "assets/bots/reacciones", thumb)) }];
  const embed: Record<string, unknown> = {
    title: g.titulo,
    description: link(g.texto),
    color: color[g.bot],
    thumbnail: { url: `attachment://${thumb}` },
    ...(g.pie ? { footer: { text: g.pie } } : {}),
  };
  if (g.imagen) {
    const big = path.basename(g.imagen);
    files.push({ name: big, data: readFileSync(path.join(ROOT, g.imagen)) });
    embed.image = { url: `attachment://${big}` };
  }
  if ((embed.description as string).length > 4096) throw new Error(`El texto de ${key} pasa de 4096 caracteres`);

  const stateKey = `guia:${key}`;
  const prev = JSON.parse(kvGet(db, stateKey) ?? "null") as { bot: CoreBotId; channelId: string; messageId: string } | null;
  const editable = prev && prev.bot === g.bot && prev.channelId === ch.id;
  if (!APPLY) {
    console.log(`• #${ch.name}: ${editable ? "editar" : "publicar y fijar"} el mensaje de ${g.bot} (${(embed.description as string).length} caracteres)`);
    continue;
  }
  const components = g.menu === "colores" ? [colorMenu(loadLayout().coloresPapu?.colores ?? [])] : [];
  const body = { embeds: [embed], components, attachments: files.map((f, i) => ({ id: i, filename: f.name })), allowed_mentions: { parse: [] } };
  let messageId: string;
  if (editable) {
    try {
      await rest[g.bot].patch(Routes.channelMessage(ch.id, prev.messageId), { body, files });
      messageId = prev.messageId;
      console.log(`✔ #${ch.name}: mensaje de ${g.bot} editado`);
    } catch {
      // Lo borraron a mano: se publica de nuevo.
      messageId = ((await rest[g.bot].post(Routes.channelMessages(ch.id), { body, files })) as { id: string }).id;
      console.log(`✔ #${ch.name}: mensaje de ${g.bot} publicado de nuevo (el anterior no existía)`);
    }
  } else {
    messageId = ((await rest[g.bot].post(Routes.channelMessages(ch.id), { body, files })) as { id: string }).id;
    console.log(`✔ #${ch.name}: mensaje de ${g.bot} publicado`);
  }
  try {
    await rest[g.bot].put(Routes.channelPin(ch.id, messageId));
  } catch (e) {
    console.log(`  ⚠️ no se pudo fijar: ${(e as Error).message}`);
  }
  kvSet(db, stateKey, JSON.stringify({ bot: g.bot, channelId: ch.id, messageId }));
  done++;
}
console.log(APPLY ? `\n${done} mensajes listos y fijados.` : `\n${guides.length} mensajes por publicar. Para hacerlo: npm run guias -- --apply`);
db.close();
