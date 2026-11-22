// Wiki de fichas (peleas, carreras) como publicación del foro #📚・guías (pedido de GyroP, 16 nov. 2026): en el canal
// del casino se perdían hacia arriba con cada banner. Una publicación cerrada de Teto: el primer mensaje (la guía) y
// luego un mensaje por grupo de fichas. Volver a correrlo EDITA los mismos mensajes (ids en la base del PC, como
// npm run guias:foro: la clave `foro:<clave>` sirve también para enlazarla con {guia:<clave>}).
import { REST, Routes } from "discord.js";
import { kvGet, kvSet, type Db } from "../src/db/database";
import { channelKey } from "../src/discord/channels";

export interface WikiMensaje {
  key: string;
  embeds: { title: string; description: string; color: number; footer?: { text: string } }[];
}

export interface WikiForo {
  rest: REST;
  db: Db;
  guildId: string;
  /** Clave de la publicación: `foro:<clave>` (y `<clave>:<mensaje>` para los mensajes de fichas). */
  clave: string;
  titulo: string;
  etiquetas: string[];
  mensajes: WikiMensaje[];
  apply: boolean;
}

/** Publica o edita la wiki en #📚・guías. Devuelve el id de la publicación (null en la vista previa sin publicar). */
export async function publicarWikiForo(w: WikiForo): Promise<string | null> {
  const { rest, db } = w;
  const chans = (await rest.get(Routes.guildChannels(w.guildId))) as { id: string; name: string; type: number; available_tags?: { id: string; name: string }[] }[];
  const foro = chans.find((c) => c.type === 15 && channelKey(c.name) === "guias");
  if (!foro) throw new Error("No existe el foro #📚・guías");
  const tags = (foro.available_tags ?? []).filter((t) => w.etiquetas.includes(t.name)).map((t) => t.id);
  for (const m of w.mensajes) if (m.embeds.some((e) => e.description.length > 4096)) throw new Error(`El mensaje ${m.key} pasa de 4096 caracteres`);
  let threadId = kvGet(db, `foro:${w.clave}`);
  if (threadId) {
    const existe = await rest.get(Routes.channel(threadId)).then(() => true).catch(() => false);
    if (!existe) threadId = null;
  }
  if (!w.apply) {
    w.mensajes.forEach((m, i) => {
      const len = m.embeds.reduce((n, e) => n + e.description.length + e.title.length, 0);
      const ya = i === 0 ? !!threadId : !!threadId && !!kvGet(db, `${w.clave}:${m.key}`);
      console.log(`• #${foro.name} «${w.titulo}» · ${m.key}: ${ya ? "editar" : "publicar"} (${len} caracteres)`);
    });
    return threadId;
  }
  const body = (m: WikiMensaje) => ({ content: "", embeds: m.embeds, allowed_mentions: { parse: [] } });
  const [primero, ...resto] = w.mensajes;
  if (!primero) throw new Error("La wiki no tiene mensajes");
  if (threadId) {
    // Abierta un momento para editar y agregar mensajes; al final se vuelve a cerrar.
    await rest.patch(Routes.channel(threadId), { body: { locked: false, archived: false } });
    await rest.patch(Routes.channelMessage(threadId, threadId), { body: body(primero) });
    console.log(`✔ «${w.titulo}» · ${primero.key}: editado`);
  } else {
    const t = (await rest.post(Routes.threads(foro.id), { body: { name: w.titulo, applied_tags: tags, message: body(primero) } })) as { id: string };
    threadId = t.id;
    kvSet(db, `foro:${w.clave}`, threadId);
    console.log(`✔ «${w.titulo}» · ${primero.key}: publicado`);
  }
  for (const m of resto) {
    const prev = kvGet(db, `${w.clave}:${m.key}`);
    const ok = prev ? await rest.patch(Routes.channelMessage(threadId, prev), { body: body(m) }).then(() => true).catch(() => false) : false;
    if (ok) console.log(`✔ «${w.titulo}» · ${m.key}: editado`);
    else {
      const id = ((await rest.post(Routes.channelMessages(threadId), { body: body(m) })) as { id: string }).id;
      kvSet(db, `${w.clave}:${m.key}`, id);
      console.log(`✔ «${w.titulo}» · ${m.key}: publicado`);
    }
  }
  await rest.patch(Routes.channel(threadId), { body: { name: w.titulo, applied_tags: tags, locked: true } });
  return threadId;
}

/** Borra los mensajes viejos de la wiki que estaban en un canal de texto (kv `<prefijo>:<key>`), si existen. */
export async function borrarWikiCanal(rest: REST, db: Db, prefijo: string, keys: string[], apply: boolean): Promise<void> {
  for (const k of keys) {
    const raw = kvGet(db, `${prefijo}:${k}`);
    if (!raw) continue;
    const { channelId, messageId } = JSON.parse(raw) as { channelId: string; messageId: string };
    if (!apply) {
      console.log(`• borrar el mensaje viejo «${k}» del canal (${messageId})`);
      continue;
    }
    await rest.delete(Routes.channelMessage(channelId, messageId)).catch(() => {});
    kvSet(db, `${prefijo}:${k}`, "");
    console.log(`✔ borrado el mensaje viejo «${k}» del canal`);
  }
}
