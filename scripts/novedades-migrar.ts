// Muda #novedades (texto, archivado como #novedades-antiguas) al foro #✨・novedades (PLAN §8; pedido de GyroP,
// 13 nov. 2026). Cada novedad pasa a ser una publicación del mismo bot (lo que escribió GyroP con su cuenta lo
// publica Miku, firmado), de la más antigua a la más nueva, con título y etiqueta puestos a mano (TITULOS), la fecha
// original y el enlace al mensaje. SIN MENCIONES: <@Papu> y <@&rol> se cambian por el nombre escrito, y además se
// envía con allowed_mentions vacío (nadie recibe aviso ni queda agregado a la publicación). Los adjuntos y las
// imágenes de los recuadros se vuelven a subir. Deja las etiquetas del foro, el orden por fecha de creación y la
// publicación fijada «📌 Qué es este canal» (content/canales.json → novedades). El canal antiguo no se toca.
// Guarda lo migrado en la base: volver a correrlo no duplica.
//   npm run novedades:migrar             -> muestra qué haría (títulos, etiquetas y el texto sin menciones)
//   npm run novedades:migrar -- --apply  -> lo hace
import { readFileSync } from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { CORE_BOT_IDS, loadConfig, loadDotEnv, type CoreBotId } from "../src/config";
import { kvGet, kvSet, openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { EngineReader } from "../src/engine/reader";
import { NOVEDADES_ETIQUETAS } from "../src/setup/novedades";

const VIEJO = "novedades-antiguas";
const NUEVO = "novedades";
/** Hilo fijado en un foro (flag de Discord). */
const PINNED = 1 << 1;
/** Lo que un bot puede subir por mensaje sin mejoras del servidor. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Título y etiquetas de cada mensaje del canal antiguo (revisado el 13 nov. 2026). `junto` = va dentro de la
 * publicación de ese otro mensaje (un anuncio que salió en dos mensajes seguidos).
 */
const TITULOS: Record<string, { titulo: string; etiquetas: string[]; junto?: string }> = {
  "1561340651356946584": { titulo: "🛠️ Notas del día 1 del server", etiquetas: ["Parche"] },
  "1561697741573328987": { titulo: "🛠️ Parche del día 2", etiquetas: ["Parche"] },
  "1562248890885869729": { titulo: "📈 Llegaron los niveles", etiquetas: ["Novedad"] },
  "1562838379446534195": { titulo: "🛠️ Parche del 22 de octubre", etiquetas: ["Parche"] },
  "1562852212542013553": { titulo: "💍 Bodas con las Vocaloids", etiquetas: ["Novedad"] },
  "1562856237958168607": { titulo: "💔 Divorcio con /divorcio", etiquetas: ["Parche"] },
  "1562955416684593324": { titulo: "🎙️ Más XP en los canales de voz", etiquetas: ["Parche"] },
  "1563713196223897632": { titulo: "🎰 La ruleta de los Papus", etiquetas: ["Novedad"] },
  "1564034733925466223": { titulo: "🛠️ Parche del 25 de octubre", etiquetas: ["Parche"] },
  "1564356856405696684": { titulo: "🧠 Llegó la trivia Vocaloid", etiquetas: ["Novedad"] },
  "1564414895523364905": { titulo: "🧠 Parche de la trivia", etiquetas: ["Parche"] },
  "1564440102648938538": { titulo: "🎁 Llegan los Sorteos de los Papus", etiquetas: ["Novedad"] },
  "1564640779169833110": { titulo: "🪙 Llegó la Tienda Shaula", etiquetas: ["Novedad", "Temporada"] },
  "1566204497787748384": { titulo: "🩵 Parche del 31 de octubre", etiquetas: ["Parche"] },
  "1566658787669188649": { titulo: "📦 Parche del 2 de noviembre: +5000 preguntas", etiquetas: ["Parche"] },
  "1568799895664459817": { titulo: "🩵 Parche del 7 de noviembre", etiquetas: ["Parche"] },
  "1568831808546545809": { titulo: "🔔 Parche: avisos, peleas y sobres", etiquetas: ["Parche"] },
  "1569200188810076316": { titulo: "🕶️ Llegó el mercado negro", etiquetas: ["Novedad"] },
  "1570602555938054226": { titulo: "🔫 Ruleta de Némesis, bodas con Mango y colores", etiquetas: ["Novedad"] },
  "1570803586286223390": { titulo: "🎄 Temporada 2: «Navidad y los 7 pecados»", etiquetas: ["Temporada"] },
  "1570881129312161853": { titulo: "✨ Gran actualización: Shaulitas y membresías nuevas", etiquetas: ["Novedad", "Membresías"] },
  "1570881132566937752": { titulo: "", etiquetas: [], junto: "1570881129312161853" },
};

loadDotEnv();
const config = loadConfig();
const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(import.meta.dirname, "..");
const rest = Object.fromEntries(CORE_BOT_IDS.map((id) => [id, new REST().setToken(config.tokens[id])])) as Record<CoreBotId, REST>;
const mango = config.mangoToken ? new REST().setToken(config.mangoToken) : null;
const db = openDb(path.join(config.dataDir, "papus.sqlite"));

interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  type?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string; icon_url?: string };
  author?: { name: string; url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
}
interface Msg {
  id: string;
  type: number;
  content: string;
  timestamp: string;
  pinned: boolean;
  author: { id: string; bot?: boolean; username: string };
  attachments: { url: string; filename: string; size: number }[];
  embeds: Embed[];
}
interface Canal {
  id: string;
  name: string;
  type: number;
  available_tags?: { id: string; name: string }[];
  default_sort_order?: number | null;
}

const channels = (await rest.miku.get(Routes.guildChannels(config.guildId))) as Canal[];
// Antes de renombrarlo (solo para la vista previa) el canal antiguo todavía se llama #novedades.
const viejo = channels.find((c) => c.type === 0 && channelKey(c.name) === VIEJO) ?? (APPLY ? undefined : channels.find((c) => c.type === 0 && channelKey(c.name) === NUEVO));
const nuevo = channels.find((c) => c.type === 15 && channelKey(c.name) === NUEVO);
if (!viejo || (!nuevo && APPLY)) {
  console.log(`✘ Falta ${!viejo ? `#${VIEJO} (el #novedades de texto, renombrado)` : `el foro #${NUEVO}`}: npm run servidor -- --solo-canales --apply`);
  process.exit(1);
}
if (!nuevo) console.log(`• (vista previa: el foro #${NUEVO} aún no existe; se crea con npm run servidor -- --solo-canales --apply)`);

// Etiquetas del foro y orden por fecha de creación (un comentario nuevo no sube una novedad vieja).
let tags = nuevo?.available_tags ?? [];
const faltan = NOVEDADES_ETIQUETAS.filter((e) => !tags.some((t) => t.name === e));
// Sin moderar: Discord solo deja poner etiquetas moderadas a quien tiene Gestionar hilos, y los Vocaloids no lo tienen.
// Igual solo los bots y GyroP pueden crear publicaciones aquí (los Papus solo comentan).
const moderadas = tags.some((t) => (t as { moderated?: boolean }).moderated);
if (nuevo && (faltan.length || moderadas || nuevo.default_sort_order !== 1)) {
  console.log(`${APPLY ? "✔" : "•"} #${NUEVO}: ${faltan.length ? `etiquetas ${faltan.join(", ")}; ` : ""}ordenar por fecha de creación`);
  if (APPLY) {
    const body = { available_tags: [...tags.map((t) => ({ ...t, moderated: false })), ...faltan.map((name) => ({ name, moderated: false }))].slice(0, 20), default_sort_order: 1 };
    tags = ((await rest.teto.patch(Routes.channel(nuevo.id), { body })) as Canal).available_tags ?? [];
  }
}
const tagIds = (names: string[]) => names.map((n) => tags.find((t) => t.name === n)?.id).filter((x): x is string => !!x);

// Nombres de los Papus y roles mencionados (la mención se vuelve texto).
const roles = new Map(((await rest.miku.get(Routes.guildRoles(config.guildId))) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
const nombres = new Map<string, string>();
async function nombre(id: string): Promise<string> {
  if (!nombres.has(id)) {
    const m = (await rest.miku.get(Routes.guildMember(config.guildId, id)).catch(() => null)) as { nick?: string | null; user: { username: string; global_name?: string | null } } | null;
    const u = m ? null : ((await rest.miku.get(Routes.user(id)).catch(() => null)) as { username: string; global_name?: string | null } | null);
    // El nombre de la cuenta, no el apodo del servidor (cambia seguido y lleva el nivel: «… ✦63»).
    nombres.set(id, m?.user.global_name ?? m?.user.username ?? u?.global_name ?? u?.username ?? "un Papu");
  }
  return nombres.get(id)!;
}
async function sinMenciones(text: string): Promise<string> {
  let out = text.replace(/<@&(\d+)>/g, (_, id: string) => `**${roles.get(id) ?? "un rol"}**`).replace(/@(everyone|here)/g, "$1");
  for (const [m, id] of [...out.matchAll(/<@!?(\d+)>/g)].map((x) => [x[0], x[1]!] as const)) out = out.replace(m, `**${await nombre(id)}**`);
  return out;
}

// Todos los mensajes del canal antiguo, del más antiguo al más nuevo.
const todos: Msg[] = [];
for (let before: string | undefined; ; ) {
  const lote = (await rest.miku.get(Routes.channelMessages(viejo.id), { query: new URLSearchParams({ limit: "100", ...(before ? { before } : {}) }) })) as Msg[];
  todos.push(...lote);
  if (lote.length < 100) break;
  before = lote.at(-1)!.id;
}
// Fuera: la guía fijada de Luka (va como publicación fijada aparte) y los avisos del sistema ("fijó un mensaje").
const novedades = todos.reverse().filter((m) => m.type === 0 && !m.pinned);
const fecha = (iso: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" }).format(new Date(iso));
const BOTS: Record<string, CoreBotId | "mango"> = { teto: "teto", miku: "miku", luka: "luka", neru: "neru", mango9374: "mango" };
const quien = (m: Msg) => (m.author.bot ? BOTS[m.author.username.toLowerCase()] : undefined);
const restDe = (b: CoreBotId | "mango") => (b === "mango" ? (mango ?? rest.miku) : rest[b]);

/** Mensaje listo para publicar: texto sin menciones, recuadros y archivos vueltos a subir. */
async function preparar(m: Msg, encabezado: string) {
  const files: { name: string; data: Buffer }[] = [];
  const subir = async (url: string, name: string) => {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = Buffer.from(await r.arrayBuffer());
    if (data.length > MAX_BYTES) return null;
    files.push({ name, data });
    return `attachment://${name}`;
  };
  const embeds: Embed[] = [];
  for (const [i, e] of m.embeds.entries()) {
    if (e.type && e.type !== "rich") continue; // vistas previas de enlaces: Discord las vuelve a armar sola
    const x: Embed = { ...e, type: undefined };
    if (x.description) x.description = await sinMenciones(x.description);
    if (x.fields) x.fields = await Promise.all(x.fields.map(async (f) => ({ ...f, name: await sinMenciones(f.name), value: await sinMenciones(f.value) })));
    for (const k of ["image", "thumbnail"] as const) {
      const u = x[k]?.url;
      if (!u) continue;
      const ext = path.extname(new URL(u).pathname) || ".png";
      const nuevoUrl = APPLY ? await subir(u, `${k}-${i}${ext}`) : u;
      if (nuevoUrl) x[k] = { url: nuevoUrl };
      else delete x[k];
    }
    if (x.footer) x.footer = { text: x.footer.text };
    embeds.push(x);
  }
  const grandes: string[] = [];
  for (const a of m.attachments) {
    if (a.size > MAX_BYTES || !APPLY || !(await subir(a.url, a.filename))) grandes.push(a.filename);
  }
  const original = `https://discord.com/channels/${config.guildId}/${viejo!.id}/${m.id}`;
  const pie = `-# 📅 ${fecha(m.timestamp)}${quien(m) ? "" : " · ✍️ escrito por GyroP"} · [mensaje original](${original})`;
  let content = [encabezado, await sinMenciones(m.content.trim()), pie].filter(Boolean).join("\n\n");
  if (content.length > 2000) content = content.slice(0, 1990 - pie.length) + "…\n\n" + pie;
  return {
    body: { content, embeds, attachments: files.map((f, i) => ({ id: i, filename: f.name })), allowed_mentions: { parse: [] } },
    files,
    grandes: APPLY ? grandes.filter((g) => !files.some((f) => f.name === g)) : m.attachments.filter((a) => a.size > MAX_BYTES).map((a) => a.filename),
  };
}

const pausa = () => new Promise((r) => setTimeout(r, 1500));
let hechos = 0;
console.log(`${novedades.length} novedades en #${viejo.name} → foro #${NUEVO}\n`);
for (const m of novedades) {
  if (kvGet(db, `novedades:migrado:${m.id}`)) continue;
  const t = TITULOS[m.id] ?? { titulo: (m.content.split("\n")[0] ?? "").replace(/[#*_~`>]/g, "").trim().slice(0, 90) || "✨ Novedad", etiquetas: ["Novedad"] };
  const bot = quien(m) ?? "miku";
  const { body, files, grandes } = await preparar(m, "");
  if (!APPLY) {
    console.log(`• ${fecha(m.timestamp)} · ${t.junto ? `(dentro de la publicación de ${t.junto})` : `«${t.titulo}» [${t.etiquetas.join(", ")}]`} · lo publica ${bot}${TITULOS[m.id] ? "" : " (título automático)"}`);
    const menciones = m.content.match(/<@[!&]?\d+>/g);
    if (menciones) console.log(`   menciones → ${(await Promise.all(menciones.map(sinMenciones))).join(", ")}`);
    if (m.attachments.length || m.embeds.length) console.log(`   ${m.attachments.length} archivo(s), ${m.embeds.length} recuadro(s)${grandes.length ? ` · muy pesado, va como enlace: ${grandes.join(", ")}` : ""}`);
    continue;
  }
  if (grandes.length) body.content = `${body.content}\n-# 📎 ${grandes.join(", ")}: en el mensaje original`.slice(0, 2000);
  if (t.junto) {
    const hilo = kvGet(db, `novedades:migrado:${t.junto}`);
    if (!hilo) {
      console.log(`✘ ${m.id}: va junto a ${t.junto}, que aún no está migrado`);
      continue;
    }
    await restDe(bot).post(Routes.channelMessages(hilo), { body, files });
    kvSet(db, `novedades:migrado:${m.id}`, hilo);
  } else {
    const hilo = (await restDe(bot).post(Routes.threads(nuevo!.id), { body: { name: t.titulo.slice(0, 100), applied_tags: tagIds(t.etiquetas), message: body }, files })) as { id: string };
    kvSet(db, `novedades:migrado:${m.id}`, hilo.id);
  }
  hechos++;
  console.log(`✔ ${fecha(m.timestamp)} · ${t.junto ? "(continuación)" : t.titulo}`);
  await pausa();
}

// «📌 Qué es este canal»: la guía de content/canales.json, fijada y sin comentarios (va al final para quedar arriba).
const guia = (JSON.parse(readFileSync(path.join(ROOT, "content/canales.json"), "utf8")) as Record<string, { bot: CoreBotId; reaccion: string; titulo: string; texto: string; pie?: string }>)[NUEVO]!;
if (!kvGet(db, "novedades:fijada")) {
  if (!APPLY) console.log(`\n• publicación fijada «📌 Qué es este canal» (${guia.bot}), sin comentarios`);
  else {
    const color = new EngineReader(config.engineDir).character(guia.bot).color;
    const thumb = `${guia.bot}_${guia.reaccion}.png`;
    const files = [{ name: thumb, data: readFileSync(path.join(ROOT, "assets/bots/reacciones", thumb)) }];
    const linkable = new Map(channels.filter((c) => [0, 5, 15, 16].includes(c.type)).map((c) => [channelKey(c.name), c.id]));
    const texto = guia.texto.replace(/\{([a-z0-9-]+)\}/g, (s, k: string) => (linkable.has(k) ? `<#${linkable.get(k)}>` : s));
    const embed = { title: guia.titulo, description: texto, color, thumbnail: { url: `attachment://${thumb}` }, ...(guia.pie ? { footer: { text: guia.pie } } : {}) };
    const message = { embeds: [embed], attachments: [{ id: 0, filename: thumb }], allowed_mentions: { parse: [] } };
    const hilo = (await rest[guia.bot].post(Routes.threads(nuevo!.id), { body: { name: "📌 Qué es este canal", message }, files })) as { id: string };
    // Fijar y cerrar (y las etiquetas, arriba) lo hace Teto: es la que tiene Gestionar canales.
    await rest.teto.patch(Routes.channel(hilo.id), { body: { flags: PINNED, locked: true } }).catch((e) => console.log(`  ⚠️ no se pudo fijar: ${(e as Error).message}`));
    kvSet(db, "novedades:fijada", hilo.id);
    console.log("✔ «📌 Qué es este canal» publicada y fijada");
  }
}
console.log(APPLY ? `\n${hechos} novedades mudadas a #${NUEVO}.` : "\nPara hacerlo: npm run novedades:migrar -- --apply");
db.close();
