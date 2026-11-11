// Guía/wiki del 1vs1 en #⚔️・peleas (pedido de GyroP, 8 nov. 2026): cómo funciona, qué hace cada estadística y la ficha
// de cada luchador (estadísticas, estilo y especial), armada desde config/peleas.json para que nunca quede vieja.
// La publica Teto: 4 mensajes (guía + Vocaloids + invitados de los videos + invitados especiales); la guía queda fijada.
// Volver a correrlo EDITA los mismos mensajes (ids guardados en la base, como npm run guias).
//   npm run peleas:wiki             -> muestra qué haría (y el largo de cada mensaje)
//   npm run peleas:wiki -- --apply  -> publica o edita
import { existsSync } from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { BOT_IDS, loadConfig, loadDotEnv, type BotId } from "../src/config";
import { kvGet, kvSet, openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { EngineReader } from "../src/engine/reader";
import { avatarFile } from "../src/peleas/images";
import { loadPeleaSettings, REFLEJO, type Luchador } from "../src/peleas/rules";

loadDotEnv();
const config = loadConfig();
const APPLY = process.argv.includes("--apply");
const S = loadPeleaSettings();
const engine = new EngineReader(config.engineDir);
const rest = new REST().setToken(config.tokens.teto);
const db = openDb(path.join(config.dataDir, "papus.sqlite"));

// Emojis del servidor (Ajustes → Emojis) y, para quien no tiene uno propio, un emoji de su objeto.
const EMOJI: Record<string, string> = {
  teto: "<:taladro:1561212697050353744>",
  miku: "<:miku_puerro:1561212613323399188>",
  luka: "<:tako_luka:1561212695208923137>",
  neru: "<a:neru_phone:1561227738579341373>",
  gakupo: "<:gakupo:1561227703347052564>",
  kaito: "<:kaito_helado:1561197570448166922>",
  flower: "<:flower_presume:1561197537526812693>",
  ia: "<:ia_timida:1561197565658013742>",
  haku: "<:haku_chibi:1561197556246257745>",
  gumi: "<:kiwi_gumi:1561197572389871697>",
  rin: "<a:rin_fist_pump:1561227745340694569>",
  len: "<a:len_banana:1561197580489064558>",
  meiko: "<:meiko_nendo:1561197600819118130>",
  adachirei: "<:rei_nerd:1561212684228231239>",
  ruko: "👁️",
  defoko: "<a:defoko_saludo:1561197535836766309>",
  ted: "🥖",
  nero: "📱",
  lily: "🎸",
  kafu: "🌀",
  momo: "🍑",
  kanon: "💜",
  anon: "🧡",
  donramon: "🎩",
  mango: "🥭",
  godzilla: "🦖",
  shaula: "🦂",
  pina: "🍍",
};
const E = {
  nerd: "<:gato_nerd:1561227707247894599>",
  pulgar: "<:gato_pulgar:1561227709143719976>",
  tetoBaila: "<a:teto_baila:1561212701408239746>",
  sorpresa: "<:gato_sorprendido:1561227711001665567>",
  pera: "<:pera:1561227741955625051>",
};

const name = (id: string) => (BOT_IDS.includes(id as BotId) ? engine.character(id as BotId).displayName : S.luchadores[id]!.nombre ?? id);
const color = (id: string) =>
  BOT_IDS.includes(id as BotId) ? engine.character(id as BotId).color : parseInt((S.luchadores[id]!.color ?? "#FFB020").slice(1), 16);

/** Estilo en palabras, según los pesos de sus acciones. */
function estilo(l: Luchador): string {
  const w = { ...S.pelea.acciones, ...l.acciones };
  if (w.esquiva >= 30) return "💨 ágil";
  if (w.bloqueo >= 30) return "🧱 resistente";
  if (w.ataque >= 55) return "🔥 agresivo";
  return "⚖️ equilibrado";
}

function ficha(id: string): string {
  const l = S.luchadores[id]!;
  const e = l.movimientos.especial;
  const efecto = e.dano ? `golpe de **${e.dano}**` : `cura **${e.cura}** de vida`;
  const pronto = existsSync(avatarFile(id)) ? "" : " · ⏳ *llega pronto*";
  return [
    `${EMOJI[id] ?? "⭐"} **${name(id)}** · ${estilo(l)}${pronto}`,
    `> ❤️ ${l.vida} · ⚔️ ${l.ataque} · 🛡️ ${l.defensa} · 👟 ${l.agilidad} %`,
    `> 🌟 *${e.nombre}*: ${efecto}`,
    `> -# ${l.por}`,
  ].join("\n");
}

const a = S.apuestas;
const guia = {
  title: "⚔️ Guía de las peleas 1vs1 ✧٩(ˊᗜˋ*)و✧",
  description: [
    `¡Dos luchadores se dan con todo y tú apuestas quién gana! ${E.tetoBaila}`,
    "",
    "**🗓️ Cuándo**",
    `> ⏰ peleas solas a las **${S.horarios.join(" y ")}** (hora de México)`,
    `> 💰 tienes **${a.minutos} minutos** para apostar desde que sale el banner`,
    `> 🔔 ¿quieres que te avise? elige **⚔️ Ludópata** en {tus-roles}: te etiqueto al abrir las apuestas y otra vez cuando quedan 15 segundos`,
    "",
    "**🪙 Cómo apostar**",
    `> toca el botón del luchador y escribe cuánto: de **${a.minima} a ${a.maxima}** Shaula-coins **ganadas** (las compradas no se apuestan)`,
    "> si gana, cobras **tu apuesta × la cuota**; si pierde, la pierdes (｡•́︿•̀｡)",
    `> la **cuota** sale de simular la pelea ${fmt(a.simulaciones)} veces: el favorito paga poco (×${String(a.cuotaMinima).replace(".", ",")}) y el que casi nunca gana paga mucho (hasta ×${a.cuotaMaxima})`,
    "",
    `**📊 Qué hace cada número** ${E.nerd}`,
    "> ❤️ **Vida**: cuánto aguanta. Si llega a 0, ¡cae!",
    "> ⚔️ **Ataque**: cuánto quita cada golpe (a veces 1 más o 1 menos, por suerte)",
    "> 🛡️ **Defensa**: le resta al golpe que recibe la mitad de su defensa (siempre entra al menos 1)",
    `> 👟 **Agilidad**: la chance (en %) de esquivar cuando decide esquivar. Aunque esté atacando, a veces esquiva por reflejo (con ${Math.round(REFLEJO * 100)} % de su agilidad)`,
    "",
    "**🎲 Qué pasa en cada turno**",
    "> los dos eligen al azar qué hacer, a la vez:",
    "> 👊 **atacar** · 🛡️ **bloquear** (recibe la mitad del golpe, menos la mitad de su defensa: ¡puede quedar en 0!) · 💨 **esquivar** (si falla, recibe el golpe entero)",
    "> 🌟 **especial**: una sola vez por pelea. Es un golpe fuerte o una curación (la curación solo cuando le queda menos del 60 % de vida)",
    `> ⏱️ como mucho **${S.pelea.maxTurnos} turnos**: si nadie cae, gana quien conserve más vida (en %)`,
    "> 🤝 **¿empate?** si los dos caen en el mismo golpe, gana el que quedó menos lejos de 0 (también en %); y si quedan exactamente igual, se tira una moneda 🪙",
    "",
    "**🎭 Estilos**",
    "> 🔥 **agresivo**: ataca casi siempre · 💨 **ágil**: esquiva mucho · 🧱 **resistente**: bloquea mucho · ⚖️ **equilibrado**: un poco de todo",
    "",
    `Todos ganan más o menos la mitad de sus peleas: ¡ningún luchador está roto! ${E.pulgar} Las fichas de cada uno están aquí abajo 👇`,
    "-# Nada de esto da XP ni cuota con los Vocaloids: las apuestas son solo con Shaula-coins ganadas.",
  ].join("\n"),
};

const grupos: { key: string; title: string; ids: string[]; intro: string }[] = [
  { key: "vocaloids", title: "🎤 Los Vocaloids del servidor", ids: Object.keys(S.luchadores).filter((id) => BOT_IDS.includes(id as BotId)), intro: "¡Los de siempre! (≧▽≦)" },
  { key: "invitados", title: "🎬 Invitados de los videos", ids: Object.keys(S.luchadores).filter((id) => S.luchadores[id]!.grupo === "invitado"), intro: `Los que han salido en los videos del canal ${E.sorpresa}` },
  { key: "especiales", title: "🌟 Invitados especiales", ids: Object.keys(S.luchadores).filter((id) => S.luchadores[id]!.grupo === "especial"), intro: `Elegidos por GyroP. Sí, la Piña es una piña ${E.pera}` },
];

function fmt(n: number) {
  return new Intl.NumberFormat("es-CL").format(n);
}

const channels = (await rest.get(Routes.guildChannels(config.guildId))) as { id: string; name: string; type: number }[];
const byKey = new Map(channels.filter((c) => c.type === 0).map((c) => [channelKey(c.name), c]));
const link = (text: string) => text.replace(/\{([a-z0-9-]+)\}/g, (m, k: string) => (byKey.get(k) ? `<#${byKey.get(k)!.id}>` : m));
const ch = byKey.get(channelKey(S.canal));
if (!ch) throw new Error(`No existe #${S.canal}`);

const messages = [
  { key: "guia", embeds: [{ title: guia.title, description: link(guia.description), color: color("teto"), footer: { text: "Teto ・ ¡que gane el mejor! 🥖" } }] },
  ...grupos.map((g) => ({
    key: g.key,
    embeds: [{ title: g.title, description: [g.intro, "", ...g.ids.map(ficha)].join("\n"), color: color(g.ids[0]!) }],
  })),
];
for (const m of messages) {
  const len = m.embeds.reduce((n, e) => n + e.description.length + e.title.length, 0);
  if (m.embeds.some((e) => e.description.length > 4096)) throw new Error(`El mensaje ${m.key} pasa de 4096 caracteres`);
  const prev = JSON.parse(kvGet(db, `peleas-wiki:${m.key}`) ?? "null") as { channelId: string; messageId: string } | null;
  const editable = prev?.channelId === ch.id;
  if (!APPLY) {
    console.log(`• #${ch.name} · ${m.key}: ${editable ? "editar" : "publicar"} (${len} caracteres)`);
    continue;
  }
  const body = { content: "", embeds: m.embeds, allowed_mentions: { parse: [] } };
  let id: string | null = null;
  if (editable) {
    id = await rest
      .patch(Routes.channelMessage(ch.id, prev!.messageId), { body })
      .then(() => prev!.messageId)
      .catch(() => null);
  }
  if (!id) {
    id = ((await rest.post(Routes.channelMessages(ch.id), { body })) as { id: string }).id;
    if (m.key === "guia") await rest.put(Routes.channelPin(ch.id, id)).catch((e) => console.log(`(no pude fijar la guía: ${e})`));
  }
  kvSet(db, `peleas-wiki:${m.key}`, JSON.stringify({ channelId: ch.id, messageId: id }));
  console.log(`✔ #${ch.name} · ${m.key}: ${editable && id === prev!.messageId ? "editado" : "publicado"}`);
}
