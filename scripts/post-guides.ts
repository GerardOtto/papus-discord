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
import { kvDelete, kvGet, kvSet, openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { EngineReader } from "../src/engine/reader";
import { avisosMenu, colorMenus, countryMenu } from "../src/setup/color-menu";
import { identidadMenu, type IdentidadConfig } from "../src/setup/identidad";
import { cumpleBoton } from "../src/setup/cumple";
import { loadLayout } from "../src/setup/layout";

interface Guide {
  bot: CoreBotId;
  reaccion: string;
  imagen?: string;
  titulo: string;
  texto: string;
  pie?: string;
  /**
   * Menus adjuntos: "colores" = paleta de #tus-roles (config/servidor.json -> coloresPapu; uno o dos menus); "paises" =
   * paisesPapu; "avisos" = avisosPapu; "pronombres" y "genero" = identidadPapu; "cumple" = botón del cumpleaños (src/setup/cumple.ts).
   */
  menu?: Menu[];
  /**
   * Bloques con su texto y sus menus justo debajo (unificar #tus-roles, pedido de GyroP 13 nov. 2026: con 6 menus no
   * cabe en un mensaje con embed, que admite 5 filas). Con secciones la guia va con componentes v2 (un recuadro con
   * el color del bot) y `menu` no se usa.
   */
  secciones?: { texto: string; menu?: Menu[] }[];
  /** Canal donde va, si no es la clave (un segundo mensaje fijado en el mismo canal). */
  canal?: string;
  /** Claves anteriores de la misma guia (canal renombrado): edita el mensaje que ya estaba en vez de publicar otro. */
  antes?: string[];
  /** Guias que esta absorbe: al publicarla, Miku borra esos mensajes (ej. el de pronombres, ahora dentro de #tus-roles). */
  reemplaza?: string[];
  /** El canal es un foro: la guia va como publicacion fijada con su propio script (novedades: npm run novedades:migrar). */
  foro?: boolean;
}

type Menu = "colores" | "paises" | "avisos" | "pronombres" | "genero" | "cumple";
/** Mensaje con componentes v2: sin content ni embeds, todo va en `components`. */
const IS_COMPONENTS_V2 = 1 << 15;

loadDotEnv();
const config = loadConfig();
const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(import.meta.dirname, "..");
// Canales elegidos (ej.: npm run guias -- --apply reglas general): solo esas guias, sin tocar las demas.
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const guides = Object.entries(JSON.parse(readFileSync(path.join(ROOT, "content/canales.json"), "utf8")) as Record<string, Guide>).filter(
  ([k, g]) => !k.startsWith("$") && !(g as Guide).foro && (!only.length || only.includes(k)),
);
const engine = new EngineReader(config.engineDir);
// Las guias las publican las 4 chicas (los Vocaloids de conversacion no tienen guias).
const color = Object.fromEntries(CORE_BOT_IDS.map((id) => [id, engine.character(id).color])) as Record<CoreBotId, number>;
const rest = Object.fromEntries(CORE_BOT_IDS.map((id) => [id, new REST().setToken(config.tokens[id])])) as Record<CoreBotId, REST>;
const db = openDb(path.join(config.dataDir, "papus.sqlite"));

const channels = (await rest.teto.get(Routes.guildChannels(config.guildId))) as { id: string; name: string; type: number }[];
// Texto (0) para publicar; para los enlaces {canal}, también anuncios (5), foro (15) y multimedia (16).
const byKey = new Map(channels.filter((c) => c.type === 0).map((c) => [channelKey(c.name), c]));
const linkable = new Map(channels.filter((c) => [0, 5, 15, 16].includes(c.type)).map((c) => [channelKey(c.name), c]));
const link = (text: string) =>
  text.replace(/\{([a-z0-9-]+)\}/g, (m, k: string) => {
    // {mundo}: enlace a la Plaza de los Papus en el navegador (MUNDO_URL en .env, p. ej. https://papus-bots.<sub>.workers.dev/mundo/).
    if (k === "mundo") {
      const url = process.env.MUNDO_URL?.trim();
      if (!url) throw new Error("Falta MUNDO_URL en .env (enlace al mundo de los Papus, para la guía de #plaza-papus)");
      return `**[abre la plaza](${url})**`;
    }
    const ch = linkable.get(k);
    if (!ch) throw new Error(`Enlace a un canal que no existe: ${m}`);
    return `<#${ch.id}>`;
  });

const layout = loadLayout();
const identidad = (layout as unknown as { identidadPapu?: IdentidadConfig }).identidadPapu;
/** Filas de menús (colores puede ser dos: más de 24 colores). */
function menusDe(menus: Menu[]): Record<string, unknown>[] {
  return menus.flatMap((m) => {
    if (m === "colores") return colorMenus(layout.coloresPapu?.colores ?? []);
    if (m === "paises") return [countryMenu(layout.paisesPapu?.paises ?? [])];
    if (m === "avisos") return [avisosMenu(layout.avisosPapu?.avisos ?? [])];
    if (m === "cumple") return [cumpleBoton()];
    if (!identidad) throw new Error("Falta identidadPapu en config/servidor.json");
    return [identidadMenu(identidad, m)];
  });
}
/** Borra un mensaje de guía que ya no va (si ya no existía, no pasa nada). */
async function borrar(m: { bot: CoreBotId; channelId: string; messageId: string }, que: string): Promise<void> {
  try {
    await rest[m.bot].delete(Routes.channelMessage(m.channelId, m.messageId));
    console.log(`  🗑️ borré ${que}`);
  } catch {
    console.log(`  · ${que} ya no existía`);
  }
}

let done = 0;
for (const [key, g] of guides) {
  const ch = byKey.get(g.canal ?? key);
  if (!ch) {
    console.log(`✘ no existe el canal "${g.canal ?? key}" (revisa config/servidor.json)`);
    continue;
  }
  const thumb = `${g.bot}_${g.reaccion}.png`;
  const files = [{ name: thumb, data: readFileSync(path.join(ROOT, "assets/bots/reacciones", thumb)) }];
  let big: string | undefined;
  if (g.imagen) {
    big = path.basename(g.imagen);
    files.push({ name: big, data: readFileSync(path.join(ROOT, g.imagen)) });
  }
  const attachments = files.map((f, i) => ({ id: i, filename: f.name }));
  const v2 = !!g.secciones?.length;
  let body: Record<string, unknown>;
  let chars: number;
  if (v2) {
    // Un recuadro con el color del bot: titulo e intro con su imagen al lado, y cada seccion con sus menus debajo.
    const texts = [`## ${g.titulo}\n${link(g.texto)}`, ...g.secciones!.map((s) => link(s.texto)), ...(g.pie ? [`-# ${g.pie}`] : [])];
    chars = texts.reduce((n, t) => n + t.length, 0);
    if (chars > 4000) throw new Error(`El texto de ${key} pasa de 4000 caracteres (límite de los componentes v2)`);
    const hijos: Record<string, unknown>[] = [
      { type: 9, components: [{ type: 10, content: texts[0] }], accessory: { type: 11, media: { url: `attachment://${thumb}` } } },
      ...(big ? [{ type: 12, items: [{ media: { url: `attachment://${big}` } }] }] : []),
      ...g.secciones!.flatMap((s, k) => [{ type: 14, divider: true, spacing: 2 }, { type: 10, content: texts[k + 1] }, ...menusDe(s.menu ?? [])]),
      ...(g.pie ? [{ type: 14, divider: false, spacing: 1 }, { type: 10, content: texts.at(-1) }] : []),
    ];
    const contar = (cs: Record<string, unknown>[]): number =>
      cs.reduce((n, c) => n + 1 + contar((c.components as Record<string, unknown>[] | undefined) ?? []) + (c.accessory ? 1 : 0), 0);
    const total = 1 + contar(hijos);
    if (total > 40) throw new Error(`La guía de ${key} lleva ${total} componentes (Discord admite 40)`);
    body = { flags: IS_COMPONENTS_V2, components: [{ type: 17, accent_color: color[g.bot], components: hijos }], attachments, allowed_mentions: { parse: [] } };
  } else {
    const embed: Record<string, unknown> = {
      title: g.titulo,
      description: link(g.texto),
      color: color[g.bot],
      thumbnail: { url: `attachment://${thumb}` },
      ...(g.pie ? { footer: { text: g.pie } } : {}),
      ...(big ? { image: { url: `attachment://${big}` } } : {}),
    };
    chars = (embed.description as string).length;
    if (chars > 4096) throw new Error(`El texto de ${key} pasa de 4096 caracteres`);
    // Los colores pueden ser varios menus (mas de 24 colores): una fila cada uno (maximo 5 filas por mensaje).
    const components = menusDe(g.menu ?? []);
    if (components.length > 5) throw new Error(`La guía de ${key} lleva ${components.length} menús (Discord admite 5 filas; usa "secciones")`);
    body = { embeds: [embed], components, attachments, allowed_mentions: { parse: [] } };
  }

  const stateKey = `guia:${key}`;
  const saved = kvGet(db, stateKey) ?? (g.antes ?? []).map((k) => kvGet(db, `guia:${k}`)).find((v) => v) ?? null;
  const prev = JSON.parse(saved ?? "null") as { bot: CoreBotId; channelId: string; messageId: string; v2?: boolean } | null;
  // Un mensaje con embed no se puede pasar a componentes v2 (ni al reves) editandolo: se borra y se publica de nuevo.
  const editable = prev && prev.bot === g.bot && prev.channelId === ch.id && !!prev.v2 === v2;
  const viejos = (g.reemplaza ?? []).flatMap((k) => {
    const s = JSON.parse(kvGet(db, `guia:${k}`) ?? "null") as { bot: CoreBotId; channelId: string; messageId: string } | null;
    return s ? [{ key: k, ...s }] : [];
  });
  if (!APPLY) {
    const accion = editable ? "editar" : prev ? "borrar el anterior, publicar y fijar" : "publicar y fijar";
    console.log(`• #${ch.name}: ${accion} el mensaje de ${g.bot} (${chars} caracteres${v2 ? ", componentes v2" : ""})`);
    for (const o of viejos) console.log(`  y borrar el mensaje de "${o.key}" (lo absorbe este)`);
    continue;
  }
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
    if (prev) await borrar(prev, `el mensaje anterior de "${key}"`);
  }
  try {
    await rest[g.bot].put(Routes.channelPin(ch.id, messageId));
  } catch (e) {
    console.log(`  ⚠️ no se pudo fijar: ${(e as Error).message}`);
  }
  kvSet(db, stateKey, JSON.stringify({ bot: g.bot, channelId: ch.id, messageId, ...(v2 ? { v2 } : {}) }));
  for (const o of viejos) {
    await borrar(o, `el mensaje de "${o.key}" (ahora va dentro de este)`);
    kvDelete(db, `guia:${o.key}`);
  }
  done++;
}
console.log(APPLY ? `\n${done} mensajes listos y fijados.` : `\n${guides.length} mensajes por publicar. Para hacerlo: npm run guias -- --apply`);
db.close();
