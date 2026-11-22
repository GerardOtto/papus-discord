// #salón-de-la-fama para todos los Papus (PLAN §2; decisión de GyroP, 13 nov. 2026): las ideas llegan solas, en la
// charla o en #ideas-y-opiniones. Cuando GyroP o un Mod le pone ⭐ al mensaje de un Papu, Teto lo copia al salón con
// su autor, la fecha y el enlace al original (una sola vez por mensaje). Sin LLM: es un aviso fijo.
import { EmbedBuilder, type Guild, type Message, type MessageReaction, type PartialMessageReaction, type PartialUser, type SendableChannels, type User } from "discord.js";
import { kvGet, kvSet, type Db } from "../db/database";
import { logError } from "../log";
import { findTextChannel } from "./channels";

export const SALON_EMOJI = "⭐";
const SALON_CANAL = "salon-de-la-fama";

export interface SalonDeps {
  db: Db;
  owners: ReadonlySet<string>;
  isStaff: (userId: string) => Promise<boolean>;
  guild: () => Guild;
  sendable: (channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
}

export class SalonDeLaFama {
  constructor(private readonly d: SalonDeps) {}

  /** Una reacción nueva (de Teto, que ve todos los canales). */
  async onReaction(r: MessageReaction | PartialMessageReaction, u: User | PartialUser): Promise<void> {
    if (r.emoji.name !== SALON_EMOJI || u.bot) return;
    if (!this.d.owners.has(u.id) && !(await this.d.isStaff(u.id))) return;
    const msg = r.message.partial ? await r.message.fetch().catch(() => null) : (r.message as Message);
    if (!msg || msg.author.bot || !msg.inGuild()) return;
    const key = `salon:${msg.id}`;
    if (kvGet(this.d.db, key)) return;
    const salon = findTextChannel(this.d.guild(), SALON_CANAL);
    if (!salon || salon.id === msg.channelId) return;
    kvSet(this.d.db, key, String(Date.now()));
    try {
      const imagen = msg.attachments.find((a) => a.contentType?.startsWith("image/"))?.url;
      const embed = new EmbedBuilder()
        .setColor(0xffd86b)
        .setAuthor({ name: msg.member?.displayName ?? msg.author.displayName, iconURL: msg.author.displayAvatarURL({ size: 64 }) })
        .setDescription((msg.content || "*(sin texto)*").slice(0, 3800))
        .addFields({ name: "Original", value: `[Ir al mensaje](${msg.url}) · <#${msg.channelId}>` })
        .setTimestamp(msg.createdAt);
      if (imagen) embed.setImage(imagen);
      const ch = await this.d.sendable(salon.id);
      await ch.send({ content: `🏆 Idea de <@${msg.author.id}> para el salón de la fama. ¡Gracias por aportar, Papu! ✨`, embeds: [embed], allowedMentions: { users: [msg.author.id] } });
      await this.d.report(`🏆 <@${u.id}> llevó al salón de la fama un mensaje de <@${msg.author.id}>.`);
    } catch (e) {
      logError("salón de la fama", e);
    }
  }
}
