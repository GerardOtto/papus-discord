// «¡Adivina, Papu!» en Discord (PLAN §3.17): el puerto del servicio (publicar, editar el banner, reaccionar, el
// resumen semanal en #ranking y el rol 🧠 Sabelotodo). El aviso a los 🧩 Adivinadores (#tus-roles) lo da el Vocaloid si
// puede etiquetar roles; si no (los del Coro), lo da Neru justo después.
import { AttachmentBuilder, type Client, type Guild } from "discord.js";
import type { AdivinanzasPort, Publicacion } from "../adivinanzas/service";
import type { BotId } from "../config";
import { logError } from "../log";
import { avisoPing, canPingRoles } from "./avisos";
import { channelKey, findTextChannel } from "./channels";

export interface AdivinanzasPortDeps {
  guild: () => Guild;
  clients: Partial<Record<BotId, Client>>;
  sendable: (bot: BotId, channelId: string) => Promise<import("discord.js").SendableChannels>;
  rolSabelotodo: string;
  log: (msg: string) => void;
}

const file = (p: Publicacion) => [new AttachmentBuilder(p.image, { name: "adivinanza.png" })];

export function adivinanzasPort(d: AdivinanzasPortDeps): AdivinanzasPort {
  const fetchMsg = async (bot: BotId, channelId: string, messageId: string) => {
    const ch = await d.sendable(bot, channelId);
    if (!("messages" in ch)) return null;
    return ch.messages.fetch(messageId).catch(() => null);
  };
  return {
    ultimoPapu: async (nombres) => {
      let best: { channelId: string; at: number } | null = null;
      for (const n of nombres) {
        const ch = findTextChannel(d.guild(), n);
        if (!ch) continue;
        const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
        const at = msgs ? [...msgs.values()].find((x) => !x.author.bot && !x.system)?.createdTimestamp : undefined;
        if (at && (!best || at > best.at)) best = { channelId: ch.id, at };
      }
      return best;
    },
    publicar: async (bot, channelId, p) => {
      const ch = await d.sendable(bot, channelId);
      const ping = p.aviso ? avisoPing(d.guild(), "adivinanzas") : null;
      const channel = d.guild().channels.cache.get(channelId);
      const botUser = d.clients[bot]?.user?.id;
      const inline = !!ping && !!channel && !!botUser && canPingRoles(channel, botUser);
      const msg = await ch.send({
        content: `${inline ? `🔔 ${ping!.mention} ` : ""}${p.content}`,
        files: file(p),
        allowedMentions: inline ? { roles: [ping!.roleId] } : { parse: [] },
      });
      if (ping && !inline) {
        const neru = await d.sendable("neru", channelId).catch(() => null);
        await neru
          ?.send({ content: `🔔 ${ping.mention} ¡Salió una adivinanza! 🧩 El pozo ya está subiendo 👆`, allowedMentions: { roles: [ping.roleId] } })
          .catch((e) => logError("aviso de la adivinanza", e));
      }
      return msg.id;
    },
    editar: async (bot, channelId, messageId, p) => {
      const msg = await fetchMsg(bot, channelId, messageId);
      // Al editar no se vuelve a etiquetar: se conserva lo de arriba (el 🔔) y se cambia el resto.
      const ping = msg?.content.startsWith("🔔 ") ? `${msg.content.split(" ").slice(0, 2).join(" ")} ` : "";
      await msg?.edit({ content: `${ping}${p.content}`, files: file(p), attachments: [], allowedMentions: { parse: [] } });
    },
    responder: async (bot, channelId, messageId, p) => {
      const ch = await d.sendable(bot, channelId);
      await ch.send({ content: p.content, files: file(p), reply: { messageReference: messageId, failIfNotExists: false }, allowedMentions: { users: [...p.content.matchAll(/<@(\d+)>/g)].map((m) => m[1]!), repliedUser: false } });
    },
    reaccionar: async (bot, channelId, messageId, emoji) => {
      const msg = await fetchMsg(bot, channelId, messageId);
      await msg?.react(emoji);
    },
    semanal: async (content) => {
      const ch = findTextChannel(d.guild(), "ranking");
      if (!ch) return;
      await (await d.sendable("teto", ch.id)).send({ content, allowedMentions: { parse: [] } });
    },
    sabelotodo: async (nuevo, anterior) => {
      const teto = d.clients.teto;
      if (!teto) return false;
      const guild = await teto.guilds.fetch(d.guild().id);
      let role = guild.roles.cache.find((r) => channelKey(r.name) === channelKey(d.rolSabelotodo));
      if (!role) {
        role = await guild.roles.create({ name: d.rolSabelotodo, colors: { primaryColor: 0x9b6cff }, permissions: [], mentionable: false, hoist: false, reason: "¡Adivina, Papu!: el que más adivinó en la semana" });
        d.log(`Rol ${d.rolSabelotodo} creado`);
      }
      // Se le quita a cualquiera que lo tenga (no solo al anterior guardado), por si alguien lo dio a mano.
      for (const m of role.members.values()) if (m.id !== nuevo) await m.roles.remove(role, "Ya no es el Sabelotodo de la semana").catch(() => {});
      if (anterior && anterior !== nuevo) await guild.members.removeRole({ user: anterior, role: role.id }).catch(() => {});
      await guild.members.addRole({ user: nuevo, role: role.id, reason: "Sabelotodo de la semana (¡Adivina, Papu!)" });
      return true;
    },
  };
}
