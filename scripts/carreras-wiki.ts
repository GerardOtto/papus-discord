// Guía/wiki de las carreras en el foro #📚・guías («📖 Fichas de las carreras», cerrada; PLAN §3.14, pedido de GyroP, 16 nov. 2026): cómo se apuesta (apuestas mutuas
// como en el hipódromo), cómo se reparte (con el ejemplo) y la ficha de carrera de cada corredor, armada desde
// config/carreras.json para que nunca quede vieja. La publica Teto: la guía y las fichas.
// Volver a correrlo EDITA los mismos mensajes (ids en la base del PC; correrlo desde el PC).
//   npm run carreras:wiki             -> muestra qué haría (y el largo de cada mensaje)
//   npm run carreras:wiki -- --apply  -> publica o edita
import path from "node:path";
import { REST, Routes } from "discord.js";
import { loadCarreraSettings } from "../src/carreras/rules";
import { BOT_IDS, loadConfig, loadDotEnv, type BotId } from "../src/config";
import { openDb } from "../src/db/database";
import { channelKey } from "../src/discord/channels";
import { EngineReader } from "../src/engine/reader";
import { loadMembresiaSettings } from "../src/membresias/rules";
import { loadPeleaSettings } from "../src/peleas/rules";
import { borrarWikiCanal, publicarWikiForo } from "./wiki-foro";

loadDotEnv();
const config = loadConfig();
const APPLY = process.argv.includes("--apply");
const S = loadCarreraSettings();
const P = loadPeleaSettings();
const M = loadMembresiaSettings();
const engine = new EngineReader(config.engineDir);
const rest = new REST().setToken(config.tokens.teto);
const db = openDb(path.join(config.dataDir, "papus.sqlite"));

const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
const name = (id: string) => (BOT_IDS.includes(id as BotId) ? engine.character(id as BotId).displayName : (P.luchadores[id]?.nombre ?? id));

// Caras: emojis de la aplicación de Teto y del servidor (por nombre).
const app = (await rest.get(Routes.currentApplication())) as { id: string };
const appEmojis = ((await rest.get(Routes.applicationEmojis(app.id))) as { items: { id: string; name: string; animated?: boolean }[] }).items;
const guildEmojis = (await rest.get(Routes.guildEmojis(config.guildId))) as { id: string; name: string; animated?: boolean }[];
const emoji = (n: string) => {
  const e = appEmojis.find((x) => x.name === n) ?? guildEmojis.find((x) => x.name === n);
  return e ? `<${e.animated ? "a" : ""}:${e.name}:${e.id}>` : "🏇";
};

const barras = (n: number) => "▰".repeat(n) + "▱".repeat(10 - n);
function ficha(id: string): string {
  const r = S.corredores[id]!;
  const fuerte = r.arranque >= Math.max(r.velocidad, r.resistencia) ? "🚀 sale disparado" : r.resistencia >= Math.max(r.velocidad, r.arranque) ? "🔋 aguanta hasta el final" : "💨 vuela en la recta";
  return [
    `${emoji(r.emoji)} **${name(id)}** · ${fuerte}`,
    `> 🚀 Arranque \`${barras(r.arranque)}\` · 💨 Velocidad \`${barras(r.velocidad)}\` · 🔋 Resistencia \`${barras(r.resistencia)}\``,
    `> -# ${r.jugadas.map((j) => `«${j.texto}»`).join(" · ")}`,
  ].join("\n");
}

const a = S.apuestas;
const lanzan = M.niveles.map((n) => `${n.emoji} ${n.carreras?.dia ?? 0}`).join(" · ");
const guia = {
  title: "🏇 Guía de las carreras (◕‿◕)ノ🏁",
  description: [
    `¡${S.corredoresPorCarrera} Vocaloids corren y tú apuestas quién llega primero! Las caras bajan por la pista y la que cruza la 🏁 antes, gana.`,
    "",
    "**🗓️ Cuándo**",
    `> ⏰ **${S.porDia} carreras al día** a horas sorpresa entre las **${S.horario.desde} y las ${S.horario.hasta}** (hora de México), lejos de las peleas`,
    `> 💰 tienes **${a.minutos} minutos** para apostar desde que sale el banner`,
    `> 🔔 ¿quieres que te avise? elige **${S.rolAviso}** en {tus-roles}: te etiqueto al abrir las apuestas y otra vez cuando quedan 15 segundos`,
    `> 🎟️ las membresías lanzan carreras con \`/carrera\` (al día: ${lanzan}); los corredores siempre salen al azar`,
    "",
    "**🎟️ Cómo apostar**",
    "> toca **🥇 Ganador**, **🥈 Segundo** o **🥉 Tercero**, elige al Vocaloid y escribe cuánto",
    "> 🥇 **Ganador**: aciertas si llega **1.º** (paga lo que más)",
    "> 🥈 **Segundo**: aciertas si llega **1.º o 2.º** (paga menos)",
    "> 🥉 **Tercero**: aciertas si llega al **podio** (paga lo que menos)",
    `> puedes comprar **varios boletos**, a varios Vocaloids y en varias bolsas: de **${a.minimaBoleto}** Shaulitas por boleto, hasta **${fmt(a.maximaCarrera)}** por carrera en total`,
    "",
    "**📊 Apuestas mutuas (como en el hipódromo de verdad)**",
    "> cada tipo de apuesta tiene su **bolsa**: todo lo que apuestan los Papus va ahí",
    `> la casa se queda el **${Math.round(a.margen * 100)} %** y el resto se reparte entre los boletos que acertaron. **Mientras más Papus le apuestan a uno, menos paga**`,
    "> por eso las **cuotas cambian hasta el cierre**: el tablero del banner las muestra en vivo, y el pago final es el de la bolsa al cerrar",
    "> 🥈 y 🥉: a los que acertaron se les devuelve lo apostado y la ganancia se parte entre los 2 (o 3) que llegaron",
    `> para que nunca salga una cuota absurda, Teto pone **${fmt(a.bolsaBase)}** Shaulitas en cada bolsa (más al favorito). Y acertar nunca hace perder: paga al menos **×${String(a.pagoMinimo).replace(".", ",")}**`,
    "",
    "**🧮 Ejemplo**",
    "> Bolsa de Ganador: Miku 500 · Teto 300 · Neru 200 = 1.000 → la casa se queda 50 → quedan **950**",
    "> si gana **Neru**: 950 ÷ 200 = paga **×4,75** · si gana **Miku**: 950 ÷ 500 = paga **×1,90**",
    "",
    "**🏁 La carrera**",
    "> cada estadística manda en un tercio de la pista: 🚀 **arranque** al principio, 💨 **velocidad** en el medio y 🔋 **resistencia** al final",
    "> a veces pasa algo (*«Kaito se detuvo por un helado 🍦»*) y cambia todo. Si dos llegan casi juntos: 📸 **¡foto final!**",
    "> la carrera se sortea al cerrar las apuestas: lo que ves es la repetición, nadie la puede cambiar",
    "",
    "Todos ganan más o menos lo mismo: ¡nadie es favorito siempre! Las fichas están aquí abajo 👇",
    "-# Nada de esto da XP ni cuota con los Vocaloids: las apuestas son solo con Shaulitas.",
  ].join("\n"),
};

const ids = Object.keys(S.corredores);
const vocaloids = ids.filter((id) => BOT_IDS.includes(id as BotId));
const invitados = ids.filter((id) => !BOT_IDS.includes(id as BotId));

const channels = (await rest.get(Routes.guildChannels(config.guildId))) as { id: string; name: string; type: number }[];
const byKey = new Map(channels.filter((c) => c.type === 0).map((c) => [channelKey(c.name), c]));
const link = (text: string) => text.replace(/\{([a-z0-9-]+)\}/g, (m, k: string) => (byKey.get(k) ? `<#${byKey.get(k)!.id}>` : m));
const color = engine.character("teto").color;

const messages = [
  { key: "guia", embeds: [{ title: guia.title, description: link(guia.description), color, footer: { text: "Teto ・ ¡arre, arre, Burreros! 🥖" } }] },
  { key: "vocaloids", embeds: [{ title: "🎤 Corredores: los Vocaloids del servidor", description: vocaloids.map(ficha).join("\n"), color: engine.character("miku").color }] },
  { key: "invitados", embeds: [{ title: "🌟 Corredores: los invitados", description: invitados.map(ficha).join("\n"), color: engine.character("neru").color }] },
];
// En el foro #📚・guías (pedido de GyroP, 16 nov. 2026): en el canal se perdían hacia arriba con cada banner.
await publicarWikiForo({ rest, db, guildId: config.guildId, clave: "fichas-carreras", titulo: "📖 Fichas de las carreras", etiquetas: ["🎮 Juegos"], mensajes: messages, apply: APPLY });
await borrarWikiCanal(rest, db, "carreras-wiki", messages.map((m) => m.key), APPLY);
