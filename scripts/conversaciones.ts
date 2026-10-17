// Exporta las conversaciones con los Vocaloids para revisarlas (alucinaciones, voz de cada personaje). SOLO LECTURA:
// Neru lee el historial de todos los canales e hilos activos; no escribe nada en Discord.
//   npm run conversaciones                      -> desde hoy a medianoche de Chile
//   npm run conversaciones -- --desde 2026-10-17
//   npm run conversaciones -- --horas 6
// Salida: data/revision/conversaciones-<fecha>.md (data/ no va al repo). Los Papus salen con seudonimo; borrar el
// archivo cuando termine la revision.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { BOT_IDS, loadConfig, loadDotEnv } from "../src/config";
import { EngineReader } from "../src/engine/reader";
import { loadPhraseFile } from "../src/phrases/catalog";
import { buildExchanges, fixedPhraseMatcher, renderReview, type RawMessage } from "../src/review/conversations";
import { dayKey, nextDayStart } from "../src/time";

loadDotEnv();
const config = loadConfig();
const tz = config.quotaTimeZone;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Inicio (ms) del dia AAAA-MM-DD en la zona de la cuota. */
const dayStart = (day: string) => nextDayStart(new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000), tz);
const hours = arg("--horas");
const fromDay = arg("--desde") ?? dayKey(new Date(), tz);
if (!hours && !/^\d{4}-\d{2}-\d{2}$/.test(fromDay)) throw new Error("--desde debe ser AAAA-MM-DD");
const since = hours ? Date.now() - Number(hours) * 3_600_000 : dayStart(fromDay);

// Id de usuario de cada bot: la primera parte del token (sin llamar a Discord). Nombre: el del motor.
const engine = new EngineReader(config.engineDir);
const bots = new Map<string, string>();
for (const id of config.activeBots) {
  const userId = Buffer.from(config.tokens[id]!.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  bots.set(userId, engine.character(id).displayName);
}

const rest = new REST().setToken(config.tokens.neru);
const G = config.guildId;
const guild = (await rest.get(Routes.guild(G))) as { owner_id: string };
const owners = new Set([guild.owner_id, ...(config.ownerId ? [config.ownerId] : [])]);

type Channel = { id: string; name: string; type: number };
type ApiMessage = { id: string; author: { id: string }; content: string; timestamp: string; message_reference?: { message_id?: string } };
const TEXT_TYPES = new Set([0, 2, 5, 10, 11, 12]); // texto, chat de voz, anuncios e hilos
const channels = ((await rest.get(Routes.guildChannels(G))) as Channel[]).filter((c) => TEXT_TYPES.has(c.type));
const threads = ((await rest.get(Routes.guildActiveThreads(G))) as { threads: Channel[] }).threads;

const messages: RawMessage[] = [];
let skipped = 0;
for (const ch of [...channels, ...threads]) {
  let before: string | undefined;
  try {
    for (;;) {
      const query = new URLSearchParams({ limit: "100", ...(before ? { before } : {}) });
      const page = (await rest.get(Routes.channelMessages(ch.id), { query })) as ApiMessage[];
      for (const m of page) {
        const at = Date.parse(m.timestamp);
        if (at < since) continue;
        messages.push({ id: m.id, channel: ch.name, authorId: m.author.id, content: m.content, createdAt: at, replyToId: m.message_reference?.message_id ?? null });
      }
      const oldest = page.at(-1);
      if (page.length < 100 || !oldest || Date.parse(oldest.timestamp) < since) break;
      before = oldest.id;
    }
  } catch {
    skipped++; // canal que Neru no puede leer
  }
}

const phrases = BOT_IDS.flatMap((b) => Object.values(loadPhraseFile(b)).flat());
const exchanges = buildExchanges({ messages, bots, owners, isFixedPhrase: fixedPhraseMatcher(phrases) });
const label = hours ? `últimas ${hours} h` : `desde el ${fromDay}`;
const out = path.join(config.dataDir, "revision", `conversaciones-${hours ? `${dayKey(new Date(), tz)}-${hours}h` : fromDay}.md`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, renderReview(exchanges, `Conversaciones con los Vocaloids (${label})`, tz));

const llm = exchanges.flatMap((e) => e.answers).filter((a) => !a.fixed).length;
console.log(`✔ ${messages.length} mensajes leídos en ${channels.length + threads.length - skipped} canales${skipped ? ` (${skipped} sin acceso)` : ""}`);
console.log(`✔ ${exchanges.length} conversaciones, ${llm} respuestas del LLM`);
console.log(`✔ informe: ${out}`);
