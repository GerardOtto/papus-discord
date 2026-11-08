// Sorteo en Discord (PLAN §3.5): /sorteo de Teto (solo GyroP) pone a todos los Papus en la ruleta y la gira. El giro
// lo ve primero solo GyroP, con botones: se lo queda, girar otra vez sin el (para no premiar a un AFK), darselo a otro
// o cancelar. Al confirmar, Teto publica en el canal el GIF que cae en el ganador final y se entrega el premio. Las
// reglas y los sorteos abiertos viven en src/sorteo/.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type SendableChannels,
  type UserSelectMenuInteraction,
} from "discord.js";
import type { BotId } from "../config";
import type { CharacterInfo } from "../engine/reader";
import { stripNickTag } from "../levels/rules";
import { logError, type LogFn } from "../log";
import type { Phrases } from "../phrases/catalog";
import type { DeckStore } from "../phrases/deck";
import { renderWheelGif } from "../ruleta/wheel";
import { sliceColors } from "../sorteo/rules";
import type { Candidate, Draw, SorteoResult, SorteoService } from "../sorteo/service";
import type { LevelsDiscord } from "./levels";

const ASSETS = path.resolve(import.meta.dirname, "../../assets/bots");
const PREFIX = "sorteo:";
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);

export interface SorteoDiscordDeps {
  sorteo: SorteoService;
  levelsDiscord: LevelsDiscord;
  phrases: Phrases;
  decks: DeckStore;
  characters: Record<BotId, CharacterInfo>;
  /** Vocaloids conectados: entre ellos se turna quien presenta el sorteo. */
  online: readonly BotId[];
  /** GyroP: el unico que sortea, y nunca entra en la ruleta. */
  owners: ReadonlySet<string>;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  log: LogFn;
}

type Payload = { content: string; components: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder>[]; files: AttachmentBuilder[]; attachments: [] };

export class SorteoDiscord {
  /** Los GIF se dibujan de a uno (el servidor es chico). */
  private queue: Promise<unknown> = Promise.resolve();
  /** El ultimo GIF de cada sorteo abierto y en quien cae: al confirmar se publica ese mismo. */
  private gifs = new Map<string, { winner: string; gif: Buffer }>();

  constructor(private readonly d: SorteoDiscordDeps) {}

  private get s(): SorteoService {
    return this.d.sorteo;
  }

  private candidate(m: GuildMember): Candidate {
    return { id: m.id, name: stripNickTag(m.displayName), avatarUrl: m.displayAvatarURL({ extension: "png", size: 128 }) };
  }

  /** Puede ganar: un Papu de verdad (ni bots ni GyroP). */
  private eligible(m: GuildMember): boolean {
    return !m.user.bot && !this.d.owners.has(m.id);
  }

  // ───────────────────────── comando ─────────────────────────

  async sorteo(i: ChatInputCommandInteraction): Promise<void> {
    if (!this.d.owners.has(i.user.id)) {
      await i.reply({ content: "¡Eso solo lo usa GyroP! 🥖", flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const members = await this.d.guild().members.fetch();
    const candidates = [...members.values()]
      .filter((m) => this.eligible(m))
      .map((m) => this.candidate(m))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const draw = this.s.start(candidates, i.channelId, {
      texto: i.options.getString("premio"),
      xp: i.options.getInteger("xp"),
      niveles: i.options.getInteger("niveles"),
      mensajes: i.options.getInteger("mensajes"),
    });
    if (!draw) {
      await i.editReply({ content: "No hay Papus para sortear. 🥖" });
      return;
    }
    await i.editReply(await this.preview(draw));
  }

  // ───────────────────────── botones ─────────────────────────

  /** Botones del sorteo. Devuelve false si el boton no es de aqui. */
  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(PREFIX)) return false;
    const [, action, drawId] = i.customId.split(":") as [string, string, string];
    if (!this.d.owners.has(i.user.id)) {
      await i.reply({ content: "¡Eso solo lo usa GyroP! 🥖", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!this.s.get(drawId)) {
      await i.update({ content: "Este sorteo ya se cerró (o se reinició el bot). Abre otro con /sorteo.", components: [], files: [], attachments: [] });
      return true;
    }
    if (action === "cancelar") {
      this.s.cancel(drawId);
      this.gifs.delete(drawId);
      await i.update({ content: "Sorteo cancelado: nadie se enteró. 🤫", components: [], files: [], attachments: [] });
      return true;
    }
    await i.deferUpdate();
    if (action === "otra") {
      const draw = this.s.reroll(drawId);
      if (!draw) {
        await i.followUp({ content: "Ya no queda nadie más en la ruleta: elige a alguien con el menú o cancela.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await i.editReply(await this.preview(draw));
    } else if (action === "ok") {
      await this.confirm(i, drawId);
    }
    return true;
  }

  /** Menu "Dárselo a otro Papu…". Devuelve false si no es de aqui. */
  async userSelect(i: UserSelectMenuInteraction): Promise<boolean> {
    if (!i.customId.startsWith(PREFIX)) return false;
    const drawId = i.customId.split(":")[2]!;
    if (!this.d.owners.has(i.user.id)) {
      await i.reply({ content: "¡Eso solo lo usa GyroP! 🥖", flags: MessageFlags.Ephemeral });
      return true;
    }
    const member = await this.d.guild().members.fetch(i.values[0]!).catch(() => null);
    if (!member || !this.eligible(member)) {
      await i.reply({ content: "Ese no puede ganar (es un bot, eres tú o ya no está en el servidor).", flags: MessageFlags.Ephemeral });
      return true;
    }
    const draw = this.s.assign(drawId, this.candidate(member));
    if (!draw) {
      await i.update({ content: "Este sorteo ya se cerró (o se reinició el bot). Abre otro con /sorteo.", components: [], files: [], attachments: [] });
      return true;
    }
    await i.deferUpdate();
    await i.editReply(await this.preview(draw));
    return true;
  }

  // ───────────────────────── vista previa y publicacion ─────────────────────────

  private prizeLine(draw: Draw): string {
    return `${draw.prize.icono} ${draw.prize.nombre}`;
  }

  /** Lo que ve solo GyroP: el GIF del giro, en quien cayo y los botones para decidir. */
  private async preview(draw: Draw): Promise<Payload> {
    const gif = await this.gif(draw);
    const left = draw.candidates.filter((c) => c.id !== draw.winner.id && !draw.excluded.has(c.id)).length;
    const content = [
      `🎰 **Sorteo** · premio: **${this.prizeLine(draw)}**${draw.prize.tipo === "manual" ? " (lo entregas tú)" : ""}`,
      `Cayó en <@${draw.winner.id}> (**${draw.winner.name}**) · giro ${draw.spins} · ${draw.candidates.length} Papus en la ruleta${draw.excluded.size ? ` · ${draw.excluded.size} descartados` : ""}.`,
      "",
      "¿Se lo queda? Solo tú ves esto: al confirmar, Teto publica el giro en este canal.",
    ].join("\n");
    const id = draw.id;
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}ok:${id}`).setLabel("Se lo queda").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}otra:${id}`).setLabel("Girar otra vez (sin este)").setEmoji("🔁").setStyle(ButtonStyle.Primary).setDisabled(left === 0),
      new ButtonBuilder().setCustomId(`${PREFIX}cancelar:${id}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
    );
    const select = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${PREFIX}elegir:${id}`).setPlaceholder("Dárselo a otro Papu…"));
    return { content, components: [buttons, select], files: [new AttachmentBuilder(gif, { name: "sorteo.gif" })], attachments: [] };
  }

  private async confirm(i: ButtonInteraction, drawId: string): Promise<void> {
    const res = this.s.confirm(drawId);
    if (!res) return;
    const { draw } = res;
    const cached = this.gifs.get(drawId);
    this.gifs.delete(drawId);
    const gif = cached?.winner === draw.winner.id ? cached.gif : await this.gif(draw);
    const premio = this.prizeText(res);
    try {
      const ch = await this.d.sendable("teto", draw.channelId);
      await ch.send({
        content: this.d.phrases.pick("teto", "sorteo_ganador", { papu: `<@${draw.winner.id}>`, premio }),
        files: [new AttachmentBuilder(gif, { name: "sorteo.gif" })],
        allowedMentions: { users: [draw.winner.id] },
      });
      await i.editReply({ content: `✅ ¡Publicado! <@${draw.winner.id}> se lleva ${premio}.`, components: [], files: [], attachments: [] });
    } catch (e) {
      logError("sorteo (publicar)", e);
      await i.editReply({ content: `⚠️ No pude publicarlo en el canal (el premio sí quedó para <@${draw.winner.id}>): ${(e as Error).message}`, components: [], files: [], attachments: [] });
    }
    // La XP pudo subirlo de nivel: rol de honor y apodo (sin frase de Teto: el GIF ya lo celebra).
    if (res.change) await this.d.levelsDiscord.handle(res.change, {}, { quiet: true }).catch((e) => logError("nivel por sorteo", e));
    const descartados = draw.excluded.size ? ` Descartados: ${[...draw.excluded].map((id) => `<@${id}>`).join(", ")}.` : "";
    await this.d.report(
      draw.prize.tipo === "manual"
        ? `🎁 Sorteo: entrégale a mano a <@${draw.winner.id}> **${this.prizeLine(draw)}**.${descartados}`
        : `🎁 Sorteo: <@${draw.winner.id}> ganó ${premio}.${descartados}`,
    );
    this.d.log(`🎁 Sorteo: ${draw.winner.name} ganó ${premio.replace(/\*/g, "")} (giro ${draw.spins}, ${draw.candidates.length} Papus)`);
  }

  /** "**⭐ medio nivel de XP** (+1.234 XP, ¡subió al nivel 14!)" (para la frase y el registro). */
  private prizeText(res: SorteoResult): string {
    const base = `**${this.prizeLine(res.draw)}**`;
    const parts: string[] = [];
    if (res.xp) parts.push(`+${fmt(res.xp)} XP`);
    if (res.levelAfter > res.levelBefore) parts.push(`¡subió al nivel ${res.levelAfter}!`);
    if (res.messages) parts.push(`+${res.messages} ${res.messages === 1 ? "mensaje" : "mensajes"} con los Vocaloids hoy`);
    if (res.overflow) parts.push(`${res.overflow} ${res.overflow === 1 ? "mensaje no cabía" : "mensajes no cabían"} en su cuota y se volvieron XP`);
    // Lo que ya dice el nombre (un premio fijo sin texto: "+500 XP · +3 mensajes…") no se repite.
    const extra = parts.filter((x) => !res.draw.prize.nombre.includes(x));
    return extra.length ? `${base} (${extra.join(", ")})` : base;
  }

  /** Vocaloid que presenta el sorteo (se turnan, sin repetir hasta pasar por todos los conectados). */
  private host(): BotId {
    const list = this.d.online.filter((b) => existsSync(path.join(ASSETS, `${b}_figura.png`)));
    if (!list.length) return "teto";
    return list[this.d.decks.next("sorteo.anfitrion", list.length)]!;
  }

  /** Dibuja el giro que cae en el ganador actual del sorteo (y lo guarda para publicarlo igual al confirmar). */
  private gif(draw: Draw): Promise<Buffer> {
    const job = this.queue.then(async () => {
      const host = this.host();
      const c = this.d.characters[host];
      const figure = path.join(ASSETS, `${host}_figura.png`);
      const avatar = draw.winner.avatarUrl
        ? await fetch(draw.winner.avatarUrl)
            .then(async (x) => (x.ok ? Buffer.from(await x.arrayBuffer()) : null))
            .catch(() => null)
        : null;
      const colors = sliceColors(this.s.settings.colores, draw.candidates.length);
      const gif = await renderWheelGif({
        prizes: draw.candidates.map((p, n) => ({ icono: "", etiqueta: p.name, color: colors[n]! })),
        winner: draw.candidates.findIndex((p) => p.id === draw.winner.id),
        labels: "nombres",
        heading: "SORTEO",
        tagline: `🎁 ${this.prizeLine(draw)}`,
        host: { name: c.displayName, color: `#${c.color.toString(16).padStart(6, "0")}`, figure: existsSync(figure) ? readFileSync(figure) : null },
        badge: "🎉 ¡GANADOR! 🎉",
        title: draw.winner.name,
        subtitle: this.prizeLine(draw),
        winnerAvatar: avatar,
        seed: Date.now() % 1_000_000,
      });
      this.gifs.set(draw.id, { winner: draw.winner.id, gif });
      return gif;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
