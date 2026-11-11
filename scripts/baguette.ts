// Publica la entrega Baguette de un video con el bot de Luka: las notas de produccion en #notas-de-producción (un
// mensaje por bloque) y el adelanto de 24 h en #adelantos. Sin --enviar solo muestra lo que publicaria.
//   npm run baguette -- --carpeta "<carpeta del video>" [--mensaje "texto del adelanto"] [--limite-mb 20] [--enviar]
// --limite-mb reemplaza el limite calculado por el nivel de mejoras (GyroP: el servidor admite hasta 20 MB, 21-10-2026);
// si Discord rechaza el archivo, el error se muestra y las notas ya publicadas quedan.
// El texto del adelanto sale de "Discord (Baguette)/Adelanto.txt" o de --mensaje. Lo que ya publico Luka con el mismo
// texto no se repite (se puede volver a correr si algo fallo a la mitad).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { REST, Routes } from "discord.js";
import { channelKey } from "../src/discord/channels";
import { loadConfig, loadDotEnv } from "../src/config";
import { readDelivery, uploadLimitBytes } from "../src/services/baguette";

const { values: args } = parseArgs({ options: { carpeta: { type: "string" }, mensaje: { type: "string" }, enviar: { type: "boolean", default: false }, "limite-mb": { type: "string" } } });
if (!args.carpeta) throw new Error('Falta --carpeta "<carpeta del video>"');

loadDotEnv();
const config = loadConfig();
// Sin reintentos y con espera larga: un video tarda en subir, y discord.js por defecto lo reintenta a los 15 s aunque
// Discord ya lo haya recibido (el 21 oct. 2026 el adelanto salio tres veces).
const rest = new REST({ timeout: 180_000, retries: 0 }).setToken(config.tokens.luka);
const G = config.guildId;
const delivery = readDelivery(args.carpeta);
const teaserText = args.mensaje?.trim() || delivery.teaserText;

type Channel = { id: string; name: string; type: number };
type Message = { id: string; content: string; author: { id: string }; attachments: { filename: string }[] };
const channels = (await rest.get(Routes.guildChannels(G))) as Channel[];
const channel = (name: string) => {
  const ch = channels.find((c) => c.type === 0 && channelKey(c.name) === channelKey(name));
  if (!ch) throw new Error(`No existe el canal ${name}`);
  return ch;
};
const notesCh = channel("notas-de-producción");
const teaserCh = channel("adelantos");
const me = (await rest.get(Routes.user())) as { id: string };
const recent = async (id: string) => ((await rest.get(Routes.channelMessages(id), { query: new URLSearchParams({ limit: "50" }) })) as Message[]).filter((m) => m.author.id === me.id);
const link = (ch: Channel, id: string) => `https://discord.com/channels/${G}/${ch.id}/${id}`;

const guild = (await rest.get(Routes.guild(G))) as { premium_tier: number };
const limit = args["limite-mb"] ? Number(args["limite-mb"]) * 1024 * 1024 : uploadLimitBytes(guild.premium_tier);
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

console.log(`#${notesCh.name}: ${delivery.notes.length} mensajes (${delivery.notes.map((m) => m.length).join(", ")} caracteres)`);
if (delivery.teaser) {
  console.log(`#${teaserCh.name}: ${path.basename(delivery.teaser.file)} (${mb(delivery.teaser.bytes)}, límite del servidor ${mb(limit)})`);
  console.log(`  Texto: ${teaserText ?? "(falta: Adelanto.txt o --mensaje)"}`);
} else console.log(`#${teaserCh.name}: sin adelanto en la carpeta`);
if (delivery.teaser && delivery.teaser.bytes > limit) throw new Error(`El adelanto pesa ${mb(delivery.teaser.bytes)} y el servidor permite ${mb(limit)}: genera uno más liviano`);
if (delivery.teaser && !teaserText) throw new Error("Falta el texto del adelanto (Adelanto.txt o --mensaje)");
if (!args.enviar) {
  console.log("\nVista previa: nada publicado. Agrega --enviar para que Luka lo publique.");
  process.exit(0);
}

const done = await recent(notesCh.id);
for (const [i, content] of delivery.notes.entries()) {
  const prev = done.find((m) => m.content === content);
  if (prev) {
    console.log(`= nota ${i + 1} ya estaba: ${link(notesCh, prev.id)}`);
    continue;
  }
  const m = (await rest.post(Routes.channelMessages(notesCh.id), { body: { content, allowed_mentions: { parse: [] } } })) as Message;
  console.log(`✔ nota ${i + 1}: ${link(notesCh, m.id)}`);
}
if (delivery.teaser && teaserText) {
  const name = path.basename(delivery.teaser.file);
  const prev = (await recent(teaserCh.id)).find((m) => m.content === teaserText && m.attachments.some((a) => a.filename === name.replace(/ /g, "_") || a.filename === name));
  if (prev) console.log(`= el adelanto ya estaba: ${link(teaserCh, prev.id)}`);
  else {
    const m = (await rest.post(Routes.channelMessages(teaserCh.id), {
      body: { content: teaserText, allowed_mentions: { parse: [] } },
      files: [{ name, data: readFileSync(delivery.teaser.file), contentType: "video/mp4" }],
    })) as Message;
    console.log(`✔ adelanto: ${link(teaserCh, m.id)}`);
  }
}
