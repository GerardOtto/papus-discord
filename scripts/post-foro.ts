// Guías del foro #📚・guías (content/guias.json, PLAN §8): una publicación por sistema, con las etiquetas del foro,
// «📌 Empieza aquí» fijada y cerrada a comentarios. Cada publicación la escribe su Vocaloid (tarjeta con su color y su
// imagen de reacción). Guarda el id de cada publicación en la base del bot: volver a correrlo EDITA las mismas (no
// duplica). En el texto, {canal} enlaza un canal y {guia:clave} otra publicación.
//   npm run guias:foro                    -> muestra qué haría
//   npm run guias:foro -- --apply         -> publica o edita
//   npm run guias:foro -- --apply ruleta  -> solo esas guías
import { readFileSync } from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { CORE_BOT_IDS, loadConfig, loadDotEnv, type CoreBotId } from "../src/config";
import { kvGet, kvSet, openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { EngineReader } from "../src/engine/reader";

interface Guia {
  titulo: string;
  etiquetas: string[];
  bot: CoreBotId;
  reaccion: string;
  imagen?: string;
  texto: string;
  fijada?: boolean;
  cerrada?: boolean;
}

const FORO = "guias";
/** Hilo fijado en un foro (flag de Discord). */
const PINNED = 1 << 1;

loadDotEnv();
const config = loadConfig();
const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(import.meta.dirname, "..");
const raw = JSON.parse(readFileSync(path.join(ROOT, "content/guias.json"), "utf8")) as Record<string, unknown>;
const etiquetas = raw.$etiquetas as string[];
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const todas = Object.entries(raw).filter(([k]) => !k.startsWith("$")) as [string, Guia][];
// «Empieza aquí» al final: enlaza a las demás, que así ya existen.
const guias = [...todas.filter(([, g]) => !g.fijada), ...todas.filter(([, g]) => g.fijada)].filter(([k]) => !only.length || only.includes(k));
for (const [k, g] of todas) for (const e of g.etiquetas) if (!etiquetas.includes(e)) throw new Error(`content/guias.json: la etiqueta «${e}» de ${k} no está en $etiquetas`);

const engine = new EngineReader(config.engineDir);
const color = Object.fromEntries(CORE_BOT_IDS.map((id) => [id, engine.character(id).color])) as Record<CoreBotId, number>;
const rest = Object.fromEntries(CORE_BOT_IDS.map((id) => [id, new REST().setToken(config.tokens[id])])) as Record<CoreBotId, REST>;
const db = openDb(path.join(config.dataDir, "papus.sqlite"));

const channels = (await rest.teto.get(Routes.guildChannels(config.guildId))) as { id: string; name: string; type: number }[];
// Texto (0), anuncios (5), foro (15) y multimedia (16).
const byKey = new Map(channels.filter((c) => [0, 5, 15, 16].includes(c.type)).map((c) => [channelKey(c.name), c]));
const foro = byKey.get(FORO);
if (!foro || foro.type !== 15) {
  console.log(`✘ No existe el foro #${FORO} (créalo con: npm run servidor -- --solo-canales --apply).`);
  process.exit(1);
}

const link = (text: string) =>
  text.replace(/\{(guia:)?([a-z0-9-]+)\}/g, (m, guia: string | undefined, k: string) => {
    if (guia) {
      const id = kvGet(db, `foro:${k}`);
      const g = todas.find(([x]) => x === k)?.[1];
      return id ? `<#${id}>` : `**${g?.titulo ?? k}**`;
    }
    const ch = byKey.get(k);
    if (!ch) throw new Error(`Enlace a un canal que no existe: ${m}`);
    return `<#${ch.id}>`;
  });

// Etiquetas del foro: se agregan las que falten (las que ya existen conservan su id).
const foroInfo = (await rest.teto.get(Routes.channel(foro.id))) as { available_tags?: { id: string; name: string; emoji_name?: string | null }[] };
const tags = foroInfo.available_tags ?? [];
const faltan = etiquetas.filter((e) => !tags.some((t) => t.name === e));
if (faltan.length) {
  console.log(`${APPLY ? "✔" : "•"} etiquetas nuevas del foro: ${faltan.join(", ")}`);
  if (APPLY) {
    const nuevas = (await rest.teto.patch(Routes.channel(foro.id), { body: { available_tags: [...tags, ...faltan.map((name) => ({ name, moderated: true }))] } })) as typeof foroInfo;
    tags.splice(0, tags.length, ...(nuevas.available_tags ?? []));
  }
}
const tagIds = (names: string[]) => names.map((n) => tags.find((t) => t.name === n)?.id).filter((x): x is string => !!x);

let done = 0;
for (const [key, g] of guias) {
  const thumb = `${g.bot}_${g.reaccion}.png`;
  const files = [{ name: thumb, data: readFileSync(path.join(ROOT, "assets/bots/reacciones", thumb)) }];
  const embed: Record<string, unknown> = { title: g.titulo, description: link(g.texto), color: color[g.bot], thumbnail: { url: `attachment://${thumb}` } };
  if (g.imagen) {
    const big = path.basename(g.imagen);
    files.push({ name: big, data: readFileSync(path.join(ROOT, g.imagen)) });
    embed.image = { url: `attachment://${big}` };
  }
  if ((embed.description as string).length > 4096) throw new Error(`El texto de ${key} pasa de 4096 caracteres`);
  if (g.titulo.length > 100) throw new Error(`El título de ${key} pasa de 100 caracteres`);
  const message = { embeds: [embed], attachments: files.map((f, i) => ({ id: i, filename: f.name })), allowed_mentions: { parse: [] } };
  const prev = kvGet(db, `foro:${key}`);
  if (!APPLY) {
    console.log(`• ${prev ? "editar" : "publicar"} «${g.titulo}» (${g.bot}; ${g.etiquetas.join(", ")}${g.fijada ? "; fijada" : ""}${g.cerrada ? "; cerrada" : ""})`);
    continue;
  }
  let threadId = prev;
  if (threadId) {
    try {
      // El primer mensaje de una publicación tiene el mismo id que la publicación.
      await rest[g.bot].patch(Routes.channelMessage(threadId, threadId), { body: message, files });
    } catch {
      threadId = null;
    }
  }
  if (!threadId) {
    // Las etiquetas son moderadas (solo quien gestiona hilos las pone): las demás chicas publican sin ellas y Teto se las pone abajo.
    const t = (await rest[g.bot].post(Routes.threads(foro.id), { body: { name: g.titulo, ...(g.bot === "teto" ? { applied_tags: tagIds(g.etiquetas) } : {}), message }, files })) as { id: string };
    threadId = t.id;
    kvSet(db, `foro:${key}`, threadId);
    console.log(`✔ publicada «${g.titulo}»`);
  } else console.log(`✔ editada «${g.titulo}»`);
  // Nombre, etiquetas, fijada y cerrada (lo hace Teto: tiene los permisos del foro).
  await rest.teto.patch(Routes.channel(threadId), { body: { name: g.titulo, applied_tags: tagIds(g.etiquetas), locked: !!g.cerrada, flags: g.fijada ? PINNED : 0 } }).catch((e) => console.log(`  ⚠️ ${(e as Error).message}`));
  done++;
}
console.log(APPLY ? `\n${done} guías listas en #${foro.name}.` : `\n${guias.length} guías por publicar. Para hacerlo: npm run guias:foro -- --apply`);
db.close();
