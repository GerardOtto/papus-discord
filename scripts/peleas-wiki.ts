// Guía/wiki del 1vs1 (pedido de GyroP, 8 nov. 2026): cómo funciona, qué hace cada estadística y la ficha de cada
// luchador (estadísticas, estilo y especial), armada desde config/peleas.json para que nunca quede vieja. Desde el
// 16 nov. 2026 va en el foro #📚・guías («📖 Fichas del 1vs1», cerrada; antes en el canal, donde se perdía hacia
// arriba). La publica Teto: guía + Vocaloids + invitados de los videos + invitados especiales.
// Volver a correrlo EDITA los mismos mensajes (ids en la base del PC; correrlo desde el PC).
//   npm run peleas:wiki             -> muestra qué haría (y el largo de cada mensaje)
//   npm run peleas:wiki -- --apply  -> publica o edita
import { existsSync } from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { BOT_IDS, loadConfig, loadDotEnv, type BotId } from "../src/config";
import { openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { EngineReader } from "../src/engine/reader";
import { avatarFile } from "../src/peleas/images";
import { loadPeleaSettings, maxTurnosEquipo, REFLEJO, type Luchador } from "../src/peleas/rules";
import { borrarWikiCanal, publicarWikiForo } from "./wiki-foro";

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
  meowl: "🦉",
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
  title: "⚔️ Guía de las peleas 1vs1 y 2vs2 ✧٩(ˊᗜˋ*)و✧",
  description: [
    `¡Dos luchadores se dan con todo y tú apuestas quién gana! ${E.tetoBaila}`,
    "",
    "**🗓️ Cuándo**",
    `> ⏰ peleas solas a las **${S.horarios.join(" y ")}** (hora de México)`,
    `> 💰 tienes **${a.minutos} minutos** para apostar desde que sale el banner`,
    `> 🔔 ¿quieres que te avise? elige **⚔️ Ludópata** en {tus-roles}: te etiqueto al abrir las apuestas y otra vez cuando quedan 15 segundos`,
    "",
    "**🪙 Cómo apostar**",
    `> toca el botón del luchador y escribe cuánto: de **${a.minima} a ${a.maxima}** Shaulitas`,
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
    "**👥 2 contra 2**",
    `> a veces la pelea sale **en equipos** (más o menos ${Math.round((S.equipos?.probabilidad ?? 0) * 100)} de cada 100 automáticas) y apuestas por **un equipo**; también se lanza con \`/pelea modo:2vs2\``,
    "> en cada turno se enfrenta **uno de cada equipo**, elegido al azar entre los que siguen en pie, con las mismas reglas de arriba",
    "> cada uno pelea con **sus propios números**: el que cae queda fuera 💀 y su compañero sigue solo",
    `> gana el equipo que deja al otro **sin nadie en pie**; si pasan **${maxTurnosEquipo(S)} turnos**, el que conserva más vida en total (en %)`,
    "> 📊 en el banner, la **vida** es la suma de los dos y **ataque, defensa y agilidad** son el promedio: solo para comparar, porque en la pelea cada uno usa los suyos",
    `> 🎲 la cuota sale de simular ese 2vs2 ${fmt(a.simulaciones)} veces: importa quién se cruza con quién y cuánto aguanta el que queda solo`,
    "",
    "**🎭 Estilos**",
    "> 🔥 **agresivo**: ataca casi siempre · 💨 **ágil**: esquiva mucho · 🧱 **resistente**: bloquea mucho · ⚖️ **equilibrado**: un poco de todo",
    "",
    `Todos ganan más o menos la mitad de sus peleas: ¡ningún luchador está roto! ${E.pulgar} Las fichas de cada uno están aquí abajo 👇`,
    "-# Nada de esto da XP ni cuota con los Vocaloids: las apuestas son solo con Shaulitas.",
  ].join("\n"),
};

const grupos: { key: string; title: string; ids: string[]; intro: string }[] = [
  { key: "vocaloids", title: "🎤 Los Vocaloids del servidor", ids: Object.keys(S.luchadores).filter((id) => BOT_IDS.includes(id as BotId)), intro: "¡Los de siempre! (≧▽≦)" },
  { key: "invitados", title: "🎬 Invitados de los videos", ids: Object.keys(S.luchadores).filter((id) => S.luchadores[id]!.grupo === "invitado"), intro: `Los que han salido en los videos del canal ${E.sorpresa}` },
  { key: "especiales", title: "🌟 Invitados especiales", ids: Object.keys(S.luchadores).filter((id) => S.luchadores[id]!.grupo === "especial"), intro: `Elegidos por GyroP (y Meowl, idea de Wiwi). Sí, la Piña es una piña ${E.pera}` },
];

function fmt(n: number) {
  return new Intl.NumberFormat("es-CL").format(n);
}

const channels = (await rest.get(Routes.guildChannels(config.guildId))) as { id: string; name: string; type: number }[];
const byKey = new Map(channels.filter((c) => c.type === 0).map((c) => [channelKey(c.name), c]));
const link = (text: string) => text.replace(/\{([a-z0-9-]+)\}/g, (m, k: string) => (byKey.get(k) ? `<#${byKey.get(k)!.id}>` : m));

const messages = [
  { key: "guia", embeds: [{ title: guia.title, description: link(guia.description), color: color("teto"), footer: { text: "Teto ・ ¡que gane el mejor! 🥖" } }] },
  ...grupos.map((g) => ({
    key: g.key,
    embeds: [{ title: g.title, description: [g.intro, "", ...g.ids.map(ficha)].join("\n"), color: color(g.ids[0]!) }],
  })),
];
// En el foro #📚・guías (pedido de GyroP, 16 nov. 2026): en el canal se perdían hacia arriba con cada banner.
await publicarWikiForo({ rest, db, guildId: config.guildId, clave: "fichas-peleas", titulo: "📖 Fichas del 1vs1", etiquetas: ["🎮 Juegos"], mensajes: messages, apply: APPLY });
await borrarWikiCanal(rest, db, "peleas-wiki", messages.map((m) => m.key), APPLY);
