// #🎨・fanart en Discord (PLAN §8; pedidos de GyroP del 13 nov. 2026): canal multimedia donde cada fanart es una
// publicación. /redes de Teto guarda (o quita) el Instagram y el X del Papu; cuando publica un fanart, Teto responde con
// una frase fija y sus redes (sin IA ni cuota). Los fanarts que se trajeron del canal antiguo (npm run fanart:migrar)
// tienen el botón «Quitar mi fanart», que solo sirve a quien lo compartió.
import { ChannelType, MessageFlags, type AnyThreadChannel, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { enlacesRedes, usuarioInstagram, usuarioX, type RedesStore } from "../fanart/redes";
import { logError } from "../log";
import type { Phrases } from "../phrases/catalog";
import { channelKey } from "./channels";

export const FANART_CANAL = "fanart";
export const QUITAR_FANART = "fanart:quitar:";

export interface FanartDiscordDeps {
  redes: RedesStore;
  phrases: Phrases;
  /** Teto (su id), para no responderse a sí misma en los fanarts migrados. */
  tetoId: () => string | undefined;
  owners: ReadonlySet<string>;
  isStaff: (userId: string) => Promise<boolean>;
  /** Filtro fijo de Neru (el motivo si no pasa). */
  filtro: (text: string) => string | null;
  report: (text: string) => Promise<void>;
}

export class FanartDiscord {
  constructor(private readonly d: FanartDiscordDeps) {}

  /** /redes instagram x: guarda las dos (lo que venga vacío se quita). */
  async redes(i: ChatInputCommandInteraction): Promise<void> {
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const igTxt = i.options.getString("instagram")?.trim() ?? "";
    const xTxt = i.options.getString("x")?.trim() ?? "";
    const instagram = igTxt ? usuarioInstagram(igTxt) : null;
    const x = xTxt ? usuarioX(xTxt) : null;
    if (igTxt && !instagram) return void (await reply("Ese no parece un usuario de Instagram. Escríbelo así: `tu.usuario` (sin enlaces). 📸"));
    if (xTxt && !x) return void (await reply("Ese no parece un usuario de X. Escríbelo así: `tu_usuario` (hasta 15 letras, sin enlaces). 𝕏"));
    for (const u of [instagram, x]) {
      const malo = u ? this.d.filtro(u) : null;
      if (malo) return void (await reply(`No puedo guardar ese usuario (${malo}). 🎨`));
    }
    this.d.redes.set(i.user.id, { instagram, x });
    if (!instagram && !x) return void (await reply("Listo: quité tus redes. Tus fanarts ya no las muestran. 🎨"));
    await reply(`¡Listo! En tus fanarts saldrá: ${enlacesRedes({ instagram, x }).join(" · ")}. Para quitarlas, usa /redes sin nada. 🎨`);
  }

  /** Publicación nueva en #fanart: Teto responde con una frase fija y las redes del artista (si las guardó). */
  async onThreadCreate(t: AnyThreadChannel, nuevo: boolean): Promise<void> {
    if (!nuevo || !t.parent || (t.parent.type !== ChannelType.GuildMedia && t.parent.type !== ChannelType.GuildForum) || channelKey(t.parent.name) !== FANART_CANAL) return;
    const autor = t.ownerId;
    if (!autor || autor === this.d.tetoId()) return;
    const redes = enlacesRedes(this.d.redes.get(autor));
    await t.send({
      content: this.d.phrases.pick("teto", "fanart_nuevo", { papu: `<@${autor}>`, redes: redes.length ? `\nSíguelo: ${redes.join(" · ")}` : "" }),
      allowedMentions: { users: [autor] },
    });
  }

  /** «Quitar mi fanart» (fanarts traídos del canal antiguo): solo quien lo compartió (o GyroP o un Mod) lo borra. */
  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(QUITAR_FANART)) return false;
    const autor = i.customId.slice(QUITAR_FANART.length);
    if (i.user.id !== autor && !this.d.owners.has(i.user.id) && !(await this.d.isStaff(i.user.id))) {
      return void (await i.reply({ content: "Solo quien compartió este fanart puede quitarlo. 🎨", flags: MessageFlags.Ephemeral })), true;
    }
    const hilo = i.channel?.isThread() ? i.channel : null;
    await i.reply({ content: "Listo, lo quito. 🎨", flags: MessageFlags.Ephemeral });
    await hilo?.delete("lo pidió quien lo compartió").catch((e) => logError("quitar fanart", e));
    await this.d.report(`🎨 <@${i.user.id}> quitó un fanart migrado de <@${autor}>.`).catch(() => {});
    return true;
  }
}
