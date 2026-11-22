// Trae los fanarts de #🎨・fanart-de-los-papus (texto, archivado) al canal multimedia #🎨・fanart (PLAN §8; pedido de
// GyroP, 13 nov. 2026). Cada mensaje con imágenes o enlaces pasa a ser una publicación de Teto, del más antiguo al más
// nuevo: «Fanart compartido por @Papu» (la mención no notifica), la fecha, el texto original, las imágenes vueltas a
// subir, el enlace al original, la etiqueta «Del canal antiguo» y el botón «Quitar mi fanart» (solo para quien lo
// compartió). El canal antiguo no se toca. Guarda lo migrado en la base: volver a correrlo no duplica.
// También deja las etiquetas del canal (personajes y tipo; Discord admite 20).
//   npm run fanart:migrar             -> muestra qué haría
//   npm run fanart:migrar -- --apply  -> lo hace
import path from "node:path";
import { REST, Routes } from "discord.js";
import { loadConfig, loadDotEnv } from "../src/config";
import { kvGet, kvSet, openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { QUITAR_FANART } from "../src/discord/fanart";

const VIEJO = "fanart-de-los-papus";
const NUEVO = "fanart";
const ANTIGUO = "Del canal antiguo";
/** Etiquetas del canal: personajes, tipo y la de los migrados (20 como máximo). */
const ETIQUETAS = ["Teto", "Miku", "Luka", "Neru", "Rin", "Len", "Kaito", "Meiko", "Gumi", "Gakupo", "IA", "flower", "Haku", "Adachi Rei", "Ruko", "Varios", "Dibujo", "Cosplay", "3D", ANTIGUO];
/** Lo que un bot puede subir por mensaje sin mejoras del servidor. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Papus cuyas imágenes no se traen (pedidos de GyroP, 13 nov. 2026: Piña, Yamato, Wicho el Bicho, GyroP y MrMetto). */
const EXCLUIDOS = new Set(["545054807463821313", "1249192248881451153", "972182598312935445", "312684937918545924", "1303768908775428096"]);

loadDotEnv();
const config = loadConfig();
const APPLY = process.argv.includes("--apply");
const rest = new REST().setToken(config.tokens.teto);
const db = openDb(path.join(config.dataDir, "papus.sqlite"));

interface Msg {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; bot?: boolean; username: string; global_name?: string | null };
  attachments: { url: string; filename: string; size: number; content_type?: string }[];
  embeds: { url?: string; image?: unknown; thumbnail?: unknown; video?: unknown }[];
}

const channels = (await rest.get(Routes.guildChannels(config.guildId))) as { id: string; name: string; type: number; available_tags?: { id: string; name: string }[] }[];
const viejo = channels.find((c) => c.type === 0 && channelKey(c.name) === VIEJO);
const nuevo = channels.find((c) => c.type === 16 && channelKey(c.name) === NUEVO) ?? channels.find((c) => c.type === 15 && channelKey(c.name) === NUEVO);
if (!viejo || !nuevo) {
  console.log(`✘ Falta ${!viejo ? `#${VIEJO}` : `el canal #${NUEVO} (npm run servidor -- --solo-canales --apply)`}.`);
  process.exit(1);
}

// Etiquetas del canal nuevo.
let tags = nuevo.available_tags ?? [];
const faltan = ETIQUETAS.filter((e) => !tags.some((t) => t.name === e));
if (faltan.length) {
  console.log(`${APPLY ? "✔" : "•"} etiquetas de #${nuevo.name}: ${faltan.join(", ")}`);
  if (APPLY) tags = ((await rest.patch(Routes.channel(nuevo.id), { body: { available_tags: [...tags, ...faltan.map((name) => ({ name, moderated: name === ANTIGUO }))].slice(0, 20) } })) as typeof nuevo).available_tags ?? [];
}
const antiguo = tags.find((t) => t.name === ANTIGUO)?.id;

// Todos los mensajes del canal antiguo, del más antiguo al más nuevo.
const todos: Msg[] = [];
for (let before: string | undefined; ; ) {
  const lote = (await rest.get(Routes.channelMessages(viejo.id), { query: new URLSearchParams({ limit: "100", ...(before ? { before } : {}) }) })) as Msg[];
  todos.push(...lote);
  if (lote.length < 100) break;
  before = lote.at(-1)!.id;
}
/** GIF (reacciones de klipy, tenor o giphy, o un .gif subido): no son fanart (GyroP, 13 nov. 2026). */
const esGif = (m: Msg) =>
  m.attachments.some((a) => /\.gif$/i.test(a.filename) || a.content_type === "image/gif") ||
  m.embeds.some((e) => (e as { type?: string }).type === "gifv" || /tenor|giphy|klipy/i.test(e.url ?? "")) ||
  /https?:\/\/(\S*\.)?(tenor|giphy|klipy)\.com/i.test(m.content);
const fanarts = todos.reverse().filter((m) => !m.author.bot && !EXCLUIDOS.has(m.author.id) && !esGif(m) && (m.attachments.length || m.embeds.some((e) => e.image || e.thumbnail || e.video)));
const fecha = (iso: string) => new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago" }).format(new Date(iso));
console.log(`${fanarts.length} fanarts de ${new Set(fanarts.map((m) => m.author.id)).size} Papus en #${viejo.name} (${todos.length} mensajes en total).`);

let hechos = 0, saltados = 0;
for (const m of fanarts) {
  if (kvGet(db, `fanart:migrado:${m.id}`)) continue;
  const nombre = m.author.global_name ?? m.author.username;
  const original = `https://discord.com/channels/${config.guildId}/${viejo.id}/${m.id}`;
  const texto = m.content.trim().slice(0, 1500);
  const imagenes = m.attachments.filter((a) => a.size <= MAX_BYTES).slice(0, 10);
  if (!APPLY) {
    console.log(`• ${fecha(m.timestamp)} · ${nombre}: ${imagenes.length} archivo(s)${m.attachments.length > imagenes.length ? " (alguno muy pesado: va como enlace)" : ""}${!m.attachments.length ? " · solo enlace" : ""}`);
    continue;
  }
  const files: { name: string; data: Buffer }[] = [];
  for (const a of imagenes) {
    const r = await fetch(a.url);
    if (r.ok) files.push({ name: a.filename, data: Buffer.from(await r.arrayBuffer()) });
  }
  const content = [`🎨 **Fanart compartido por <@${m.author.id}>** · ${fecha(m.timestamp)}`, texto ? `> ${texto.replace(/\n/g, "\n> ")}` : "", `🔗 [Mensaje original](${original})`].filter(Boolean).join("\n");
  const body = {
    name: `Fanart de ${nombre}`.slice(0, 100),
    applied_tags: antiguo ? [antiguo] : [],
    message: {
      content,
      allowed_mentions: { parse: [] },
      attachments: files.map((f, i) => ({ id: i, filename: f.name })),
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "Quitar mi fanart", custom_id: `${QUITAR_FANART}${m.author.id}` }] }],
    },
  };
  try {
    const t = (await rest.post(Routes.threads(nuevo.id), { body, files })) as { id: string };
    kvSet(db, `fanart:migrado:${m.id}`, t.id);
    hechos++;
    console.log(`✔ ${fecha(m.timestamp)} · ${nombre}`);
  } catch (e) {
    // Un canal multimedia pide al menos una imagen o video: los que eran solo un enlace sin vista previa se saltan.
    saltados++;
    console.log(`✘ ${fecha(m.timestamp)} · ${nombre}: ${(e as Error).message} (${original})`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(APPLY ? `\n${hechos} fanarts traídos a #${nuevo.name}${saltados ? `; ${saltados} no se pudieron (arriba, con su enlace)` : ""}.` : "\nPara hacerlo: npm run fanart:migrar -- --apply");
db.close();
