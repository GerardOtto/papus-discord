// Calculo inicial de los niveles con el historial del servidor (PLAN §niveles). Neru lee todos los canales e hilos
// activos (SOLO LECTURA en Discord) y aplica las mismas reglas que los bots (src/levels/rules.ts): XP por largo, espera,
// repetidos y doble con @ a un Vocaloid. Los Papus de honor empiezan al menos en su nivel. Todos los miembros de ahora
// quedan como veteranos (piso de cuota de transicion, config/niveles.json).
//   npm run niveles             -> vista previa (no escribe nada)
//   npm run niveles -- --apply  -> guarda en data/papus.sqlite (con los bots detenidos: npm run detener)
import path from "node:path";
import { REST, Routes } from "discord.js";
import { loadConfig, loadDotEnv } from "../src/config";
import { openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { levelFor, loadLevelSettings, messageXp, passGate, xpToReach, type GateState } from "../src/levels/rules";
import { LevelStore } from "../src/levels/store";

loadDotEnv();
const config = loadConfig();
const settings = loadLevelSettings();
const APPLY = process.argv.includes("--apply");

const botIds = new Set(
  config.activeBots.map((id) => Buffer.from(config.tokens[id]!.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()),
);
const rest = new REST().setToken(config.tokens.neru);
const G = config.guildId;
const guild = (await rest.get(Routes.guild(G))) as { owner_id: string };
const owners = new Set([guild.owner_id, ...(config.ownerId ? [config.ownerId] : [])]);

type Channel = { id: string; name: string; type: number };
type ApiMessage = { author: { id: string; bot?: boolean }; content: string; timestamp: string; mentions?: { id: string }[] };
const TEXT_TYPES = new Set([0, 2, 5, 10, 11, 12]); // texto, chat de voz, anuncios e hilos
const channels = ((await rest.get(Routes.guildChannels(G))) as Channel[]).filter((c) => TEXT_TYPES.has(c.type));
const threads = ((await rest.get(Routes.guildActiveThreads(G))) as { threads: Channel[] }).threads;

const messages: { userId: string; at: number; text: string; bot: boolean }[] = [];
for (const ch of [...channels, ...threads]) {
  let before: string | undefined;
  try {
    for (;;) {
      const query = new URLSearchParams({ limit: "100", ...(before ? { before } : {}) });
      const page = (await rest.get(Routes.channelMessages(ch.id), { query })) as (ApiMessage & { id: string })[];
      for (const m of page) {
        if (m.author.bot || owners.has(m.author.id)) continue;
        messages.push({ userId: m.author.id, at: Date.parse(m.timestamp), text: m.content, bot: (m.mentions ?? []).some((u) => botIds.has(u.id)) });
      }
      if (page.length < 100) break;
      before = page.at(-1)!.id;
    }
  } catch {
    // Canal sin acceso para Neru: se salta.
  }
}
messages.sort((a, b) => a.at - b.at);

// Mismas reglas que en vivo. El historial no dice si el Vocaloid contesto: con @ se cuenta doble.
const gates = new Map<string, GateState>();
const xp = new Map<string, number>();
for (const m of messages) {
  const gate = passGate(settings, gates.get(m.userId) ?? { lastAt: 0, recent: [] }, m.text, m.at);
  if (!gate) continue;
  gates.set(m.userId, gate);
  xp.set(m.userId, (xp.get(m.userId) ?? 0) + messageXp(settings, m.text) * (m.bot ? settings.multiplicadorBots : 1));
}

// Miembros de ahora (veteranos) y Papus de honor.
type ApiMember = { user: { id: string; bot?: boolean }; roles: string[] };
const roles = (await rest.get(Routes.guildRoles(G))) as { id: string; name: string }[];
const honorRole = roles.find((r) => channelKey(r.name) === channelKey(settings.honor.rol))?.id;
const members: ApiMember[] = [];
for (let after = "0"; ; ) {
  const page = (await rest.get(Routes.guildMembers(G), { query: new URLSearchParams({ limit: "1000", after }) })) as ApiMember[];
  members.push(...page);
  if (page.length < 1000) break;
  after = page.at(-1)!.user.id;
}
const papus = members.filter((m) => !m.user.bot && !owners.has(m.user.id));
const honorFloor = xpToReach(settings, settings.honor.pisoRolManual ?? settings.honor.nivel);
let honors = 0;
for (const m of papus) {
  if (honorRole && m.roles.includes(honorRole)) {
    honors++;
    xp.set(m.user.id, Math.max(xp.get(m.user.id) ?? 0, honorFloor));
  }
}
// Quien ya no esta en el servidor no se guarda.
const inGuild = new Set(papus.map((m) => m.user.id));
for (const id of [...xp.keys()]) if (!inGuild.has(id)) xp.delete(id);

const levels = [...inGuild].map((id) => levelFor(settings, xp.get(id) ?? 0));
const buckets: [string, (l: number) => boolean][] = [
  ["1", (l) => l === 1],
  ["2-4", (l) => l >= 2 && l <= 4],
  ["5-9", (l) => l >= 5 && l <= 9],
  ["10-19", (l) => l >= 10 && l <= 19],
  [`20-${settings.honor.nivel - 1}`, (l) => l >= 20 && l < settings.honor.nivel],
  [`${settings.honor.nivel}+ (honor)`, (l) => l >= settings.honor.nivel],
];
console.log(`Mensajes leídos: ${messages.length} · Papus en el servidor: ${papus.length} · de honor: ${honors}`);
for (const [name, test] of buckets) console.log(`  nivel ${name}: ${levels.filter(test).length}`);
const top = [...xp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`Los 10 más altos (XP → nivel): ${top.map(([, n]) => `${n}→${levelFor(settings, n)}`).join(", ")}`);

if (!APPLY) {
  console.log("\nVista previa: no se guardó nada. Para guardar: npm run detener, npm run niveles -- --apply, y vuelve a encender los bots.");
} else {
  const db = openDb(path.join(config.dataDir, "papus.sqlite"));
  new LevelStore(db).importInitial(xp, papus.map((m) => m.user.id));
  db.close();
  console.log(`\n✅ Guardado: ${xp.size} Papus con XP y ${papus.length} veteranos (cuota de transición hasta ${settings.transicion?.hasta ?? "—"}).`);
}
