// Bodas en Discord (PLAN §3.2): la chica deja su adivinanza en #general, Neru abre el hilo de respuestas, el codigo
// revisa cada intento (nunca el LLM) y al primer acierto: XP de regalo, cuota reiniciada, rol "Espos@ de …" por
// 24 horas (Teto lo crea y lo borra) y el banner de boda. Las reglas y el estado viven en src/bodas/.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type SendableChannels,
} from "discord.js";
import { BOT_IDS, type BotId } from "../config";
import type { CharacterInfo } from "../engine/reader";
import { logError, type LogFn } from "../log";
import { BANNER_STYLES, renderWeddingBanner } from "../bodas/banner";
import { genderWords, isCorrect, weddingRole, weddingXp } from "../bodas/rules";
import type { ActiveRiddle, RiddleKind, WeddingService } from "../bodas/service";
import { progress, rankFor, stripNickTag } from "../levels/rules";
import type { LevelService } from "../levels/service";
import type { Phrases } from "../phrases/catalog";
import type { Quota } from "../quota/quota";
import { channelKey, findTextChannel } from "./channels";
import type { LevelsDiscord } from "./levels";

const ASSETS = path.resolve(import.meta.dirname, "../../assets/bots");

export interface BodasDiscordDeps {
  weddings: WeddingService;
  levels: LevelService;
  levelsDiscord: LevelsDiscord;
  quota: Quota;
  phrases: Phrases;
  characters: Record<BotId, CharacterInfo>;
  online: readonly BotId[];
  owners: ReadonlySet<string>;
  clients: Partial<Record<BotId, Client>>;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  timeZone: string;
  log: LogFn;
}

/** Lo que la app sabe de un mensaje de un Papu (ya revisado por Neru). */
export interface BodaMessage {
  messageId: string;
  channelId: string;
  authorId: string;
  /** Nombre visible (sin la etiqueta de nivel). */
  authorName: string;
  text: string;
  /** Id del mensaje al que responde, si responde a uno. */
  repliedTo: string | null;
}

export class BodasDiscord {
  private busy = false;

  constructor(private readonly d: BodasDiscordDeps) {}

  private get w(): WeddingService {
    return this.d.weddings;
  }

  private girlName(bot: BotId): string {
    return this.w.settings.chicas[bot]?.nombre ?? this.d.characters[bot].displayName;
  }

  /** "jueves 23 de octubre, 18:40" (hora de Chile) */
  until(t: number): string {
    return new Intl.DateTimeFormat("es-CL", { timeZone: this.d.timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
  }

  // ───────────────────────── cada minuto ─────────────────────────

  /** Cierra lo vencido, quita roles de bodas terminadas y abre la adivinanza que toque. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const expired = this.w.expire();
      if (expired) await this.closeUnanswered(expired).catch((e) => logError("adivinanza sin respuesta", e));
      await this.removeEndedRoles().catch((e) => logError("roles de boda vencidos", e));
      const inaugural = this.w.inauguralPending();
      if (inaugural && !this.w.active()) {
        const bot = this.w.pickBride(this.d.online, inaugural);
        if (bot) await this.open(bot, "inaugural");
        return;
      }
      // La que se acaba de divorciar deja otra adivinanza en cuanto no haya otra abierta (no gasta una del dia).
      const divorced = this.w.afterDivorce(this.d.online);
      if (divorced) {
        await this.open(divorced, "divorcio");
        return;
      }
      const slot = this.w.dueSlot();
      if (slot === null) return;
      this.w.useSlot(slot);
      if (!(await this.someoneAround())) {
        this.d.log("💍 Hora de adivinanza sin Papus en #general: la oportunidad se pierde");
        return;
      }
      const bot = this.w.pickBride(this.d.online);
      if (bot) await this.open(bot, "normal");
    } finally {
      this.busy = false;
    }
  }

  /** ¿Algun Papu escribio en #general en los ultimos `actividadMinutos`? */
  private async someoneAround(): Promise<boolean> {
    const ch = findTextChannel(this.d.guild(), this.w.settings.canal);
    if (!ch) return false;
    const since = Date.now() - this.w.settings.actividadMinutos * 60_000;
    const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
    return !!msgs?.some((m) => !m.author.bot && m.createdTimestamp >= since);
  }

  /** La chica publica su adivinanza y Neru abre el hilo de respuestas debajo. */
  private async open(bot: BotId, kind: RiddleKind): Promise<void> {
    const s = this.w.settings;
    const channel = findTextChannel(this.d.guild(), s.canal);
    if (!channel) return void (await this.d.report(`⚠️ Bodas: no encuentro #${s.canal}.`));
    const { index, riddle } = this.w.nextRiddle(bot);
    const name = this.girlName(bot);
    const intro = this.d.phrases.pick(bot, "boda_adivinanza", { texto: `**${riddle.adivinanza}**` });
    const rules = [
      `> 💍 **Respondan en el hilo de abajo 🧵** (aquí afuera no cuenta). Quien acierte primero se casa con ${name} por **24 horas**.`,
      `> ✍️ ${s.intentos} intentos por Papu · ⏳ ${s.duracionMinutos} min · los casados no juegan hasta que termine su boda.`,
    ].join("\n");
    const ch = await this.d.sendable(bot, channel.id);
    const msg = await ch.send({ content: `${intro}\n\n${rules}`, allowedMentions: { parse: [] } });
    let threadId: string | null = null;
    try {
      // El hilo lo abre Neru (tiene los permisos de moderacion); las chicas de conversacion no tienen permisos propios.
      const neruCh = await this.d.clients.neru!.channels.fetch(channel.id);
      if (neruCh && "messages" in neruCh) {
        const m = await neruCh.messages.fetch(msg.id);
        const thread = await m.startThread({ name: `💍 Adivinanza de ${name}`, autoArchiveDuration: ThreadAutoArchiveDuration.OneHour, reason: "Adivinanza de boda" });
        threadId = thread.id;
      }
    } catch (e) {
      await this.d.report(`⚠️ Bodas: Neru no pudo abrir el hilo (necesita "Crear hilos públicos" en #${s.canal}). Valen las respuestas al mensaje. ${(e as Error).message}`);
    }
    this.w.opened({ bot, index, channelId: channel.id, messageId: msg.id, threadId }, kind);
    // Sin la respuesta: #registro-bots lo ven los Mods, que tambien juegan.
    await this.d.report(`💍 ${name} dejó una adivinanza en #${s.canal}${kind === "inaugural" ? " (la inaugural)" : kind === "divorcio" ? " (tras su divorcio)" : kind === "manual" ? " (la pidió GyroP con /boda)" : ""}.`);
  }

  // ───────────────────────── mensajes ─────────────────────────

  /** Canal o hilo de la adivinanza abierta: Neru no cuenta ahi el flood. */
  floodFree(channelId: string): boolean {
    return this.w.floodFree(channelId);
  }

  /**
   * Mensaje de un Papu. Devuelve true si era de la adivinanza (un intento en el hilo, o una respuesta al mensaje fuera
   * del hilo): entonces no va al LLM ni gasta cuota.
   */
  async onMessage(m: BodaMessage): Promise<boolean> {
    const r = this.w.active();
    if (!r) return false;
    const inThread = r.threadId ? m.channelId === r.threadId : m.repliedTo === r.messageId;
    if (inThread) {
      await this.guess(r, m);
      return true;
    }
    if (m.repliedTo === r.messageId) {
      await this.remindThread(r, m);
      return true;
    }
    return false;
  }

  private async react(bot: BotId, channelId: string, messageId: string, emoji: string): Promise<void> {
    const ch = await this.d.sendable(bot, channelId).catch(() => null);
    if (ch && "messages" in ch) await (await ch.messages.fetch(messageId).catch(() => null))?.react(emoji).catch(() => {});
  }

  private async say(bot: BotId, channelId: string, content: string, replyTo: string, users: string[] = []): Promise<void> {
    const ch = await this.d.sendable(bot, channelId);
    await ch.send({ content, reply: { messageReference: replyTo, failIfNotExists: false }, allowedMentions: { users, repliedUser: false } });
  }

  private async guess(r: ActiveRiddle, m: BodaMessage): Promise<void> {
    const res = this.w.guess(m.authorId, m.text, this.d.owners.has(m.authorId));
    switch (res.kind) {
      case "acierto":
        return this.celebrate(res.riddle, m, res.answer);
      case "fallo":
        return this.react(r.bot, m.channelId, m.messageId, "❌");
      case "sin_intentos":
        if (res.last) await this.react(r.bot, m.channelId, m.messageId, "🚫");
        return;
      case "casado":
        await this.react(r.bot, m.channelId, m.messageId, "🔒");
        if (this.w.shouldRemind(`casado:${m.authorId}`)) {
          const wed = this.w.weddingOf(m.authorId);
          await this.say(r.bot, m.channelId, `🔒 <@${m.authorId}>, ya estás casad@ con ${this.girlName(res.with)}: vuelves a jugar cuando termine tu boda${wed ? ` (${this.until(wed.endsAt)})` : ""}.`, m.messageId, [m.authorId]);
        }
        return;
      case "repite":
        await this.react(r.bot, m.channelId, m.messageId, "🔒");
        if (this.w.shouldRemind(`repite:${m.authorId}`)) {
          await this.say(r.bot, m.channelId, `🔒 <@${m.authorId}>, te casaste con ${this.girlName(r.bot)} hace poco: con ${genderWords(this.w.settings, r.bot).el} vuelves a intentarlo pasados ${this.w.settings.diasSinRepetir} días de tu boda. ¡Con el resto sí puedes!`, m.messageId, [m.authorId]);
        }
        return;
      case "ignorado":
        return;
    }
  }

  /** Respondio al mensaje de la adivinanza fuera del hilo: se le dice donde va (una vez); si acerto, Neru la borra. */
  private async remindThread(r: ActiveRiddle, m: BodaMessage): Promise<void> {
    const spoiler = isCorrect(m.text, this.w.riddleOf(r).respuestas);
    if (spoiler) {
      const ch = await this.d.sendable("neru", m.channelId).catch(() => null);
      if (ch && "messages" in ch) await ch.messages.delete(m.messageId).catch(() => {});
    }
    if (!spoiler && !this.w.shouldRemind(m.authorId)) return;
    const where = r.threadId ? `<#${r.threadId}>` : "el hilo";
    const extra = spoiler ? " (Neru borró tu respuesta para que nadie la copie: escríbela allá)" : "";
    const ch = await this.d.sendable(r.bot, m.channelId);
    await ch.send({ content: `👉 <@${m.authorId}>, las respuestas van en el hilo 🧵 ${where}${extra}.`, allowedMentions: { users: [m.authorId] } });
  }

  // ───────────────────────── boda ─────────────────────────

  private async celebrate(r: ActiveRiddle, m: BodaMessage, answer: string): Promise<void> {
    const bot = r.bot;
    const name = this.girlName(bot);
    const ls = this.d.levels.settings;
    const before = this.d.levels.snapshot(m.authorId);
    const mult = this.d.levels.multiplier();
    const gained = weddingXp(this.w.settings, ls, before.xp, mult);
    const change = this.d.levels.bonus(m.authorId, gained);
    const after = this.d.levels.snapshot(m.authorId);
    this.w.marry(bot, m.authorId, m.authorName, gained);
    this.d.quota.reset(m.authorId);
    this.d.log(`💍 ${m.authorName} se casó con ${name} (+${gained} XP)`);

    // En el hilo: quien gano y la respuesta; despues se cierra.
    await this.say(bot, m.channelId, `💍 ¡<@${m.authorId}> lo adivinó! La respuesta era **${answer}**. ¡Gracias por jugar, Papus!`, m.messageId, [m.authorId]).catch((e) => logError("boda (hilo)", e));
    await this.closeThread(r);

    await this.giveRole(bot, m.authorId).catch((e) => logError("rol de boda", e));
    if (change) await this.d.levelsDiscord.handle(change, {}, { quiet: true }).catch((e) => logError("nivel por boda", e));

    const banner = await this.banner(bot, m.authorId, m.authorName, before, after, gained, mult).catch((e) => (logError("banner de boda", e), null));
    const ch = await this.d.sendable(bot, r.channelId);
    await ch.send({
      content: this.d.phrases.pick(bot, "boda_acierto", { papu: `<@${m.authorId}>` }),
      files: banner ? [new AttachmentBuilder(banner, { name: "boda.png" })] : [],
      reply: { messageReference: r.messageId, failIfNotExists: false },
      allowedMentions: { users: [m.authorId], repliedUser: false },
    });
    await this.d.report(`💍 <@${m.authorId}> se casó con ${name} hasta el ${this.until(Date.now() + this.w.settings.horas * 3_600_000)} (+${gained} XP, cuota reiniciada).`);
  }

  /** Nadie acerto a tiempo: la chica se despide (frase fija) y revela la respuesta en el hilo. */
  private async closeUnanswered(r: ActiveRiddle): Promise<void> {
    const answer = this.w.riddleOf(r).respuestas[0]!;
    const ch = await this.d.sendable(r.bot, r.channelId);
    await ch.send({ content: this.d.phrases.pick(r.bot, "boda_desierta"), reply: { messageReference: r.messageId, failIfNotExists: false }, allowedMentions: { parse: [] } });
    if (r.threadId) {
      const t = await this.d.sendable(r.bot, r.threadId).catch(() => null);
      await t?.send({ content: `⌛ Se acabó el tiempo. La respuesta era **${answer}**. ¡A la próxima, Papus!`, allowedMentions: { parse: [] } }).catch(() => {});
    }
    await this.closeThread(r);
  }

  private async closeThread(r: ActiveRiddle): Promise<void> {
    if (!r.threadId) return;
    const thread = await this.d.clients.neru!.channels.fetch(r.threadId).catch(() => null);
    if (!thread?.isThread()) return;
    await thread.setLocked(true).catch((e) => logError("cerrar hilo de boda", e));
    await thread.setArchived(true).catch((e) => logError("cerrar hilo de boda", e));
  }

  /** /boda de GyroP: la chica elegida (o la siguiente del mazo) deja su adivinanza ya, sin horario ni gastar las del dia. */
  async boda(i: ChatInputCommandInteraction): Promise<void> {
    if (!this.d.owners.has(i.user.id)) return void (await i.reply({ content: "¡Eso solo lo usa GyroP! 🥖", flags: MessageFlags.Ephemeral }));
    const chosen = i.options.getString("vocaloid") as BotId | null;
    const active = this.w.active();
    if (active) {
      return void (await i.reply({ content: `Ya hay una adivinanza abierta de ${this.girlName(active.bot)} (cierra ${this.until(active.endsAt)}). Espera a que termine.`, flags: MessageFlags.Ephemeral }));
    }
    if (chosen && !this.d.online.includes(chosen)) return void (await i.reply({ content: `${this.girlName(chosen)} no está conectada.`, flags: MessageFlags.Ephemeral }));
    const married = chosen ? this.w.weddings().find((x) => x.bot === chosen) : null;
    if (married) {
      return void (await i.reply({ content: `${this.girlName(chosen!)} está ${genderWords(this.w.settings, chosen!).casado} con ${married.name} hasta el ${this.until(married.endsAt)}. Elige a otra.`, flags: MessageFlags.Ephemeral }));
    }
    const bot = this.w.pickBride(this.d.online, chosen);
    if (!bot) return void (await i.reply({ content: "No hay ningún Vocaloid libre y conectado ahora.", flags: MessageFlags.Ephemeral }));
    if (this.busy) return void (await i.reply({ content: "Estoy revisando las bodas; inténtalo en unos segundos.", flags: MessageFlags.Ephemeral }));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    this.busy = true;
    try {
      await this.open(bot, "manual");
    } finally {
      this.busy = false;
    }
    await i.editReply(`¡Listo! ${this.girlName(bot)} dejó su adivinanza en #${this.w.settings.canal}. No gastó ninguna de las del día.`);
  }

  // ───────────────────────── divorcio ─────────────────────────

  /** /divorcio: pide confirmacion con un boton (solo lo ve quien lo usa). */
  async divorcio(i: ChatInputCommandInteraction): Promise<void> {
    const wed = this.w.weddingOf(i.user.id);
    if (!wed) {
      return void (await i.reply({ content: "No estás casad@ con ninguna Vocaloid. Para casarte, adivina la próxima adivinanza en #general. 💍", flags: MessageFlags.Ephemeral }));
    }
    const name = this.girlName(wed.bot);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`boda:divorcio:${wed.id}`).setLabel(`Sí, divorciarme de ${name}`).setStyle(ButtonStyle.Danger),
    );
    await i.reply({
      content: `¿Seguro? Te divorcias de **${name}**: conservas la XP y la cuota que ganaste, pero pierdes el rol, y con ${genderWords(this.w.settings, wed.bot).el} no puedes volver a jugar hasta ${this.w.settings.diasSinRepetir} días después de tu boda. Dejará otra adivinanza. No se puede deshacer.`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }

  /** Botones de las bodas. Devuelve false si el boton no es de aqui. */
  async button(i: ButtonInteraction): Promise<boolean> {
    const [kind, action, id] = i.customId.split(":");
    if (kind !== "boda" || action !== "divorcio") return false;
    const wed = this.w.weddingOf(i.user.id);
    if (!wed || String(wed.id) !== id) {
      await i.update({ content: "Esa boda ya terminó. 💍", components: [] });
      return true;
    }
    const done = this.w.divorce(i.user.id)!;
    const name = this.girlName(done.bot);
    await i.update({ content: `Listo: te divorciaste de ${name}. Conservas tu XP y tu cuota. Con ${genderWords(this.w.settings, done.bot).el} vuelves a jugar en ${this.w.settings.diasSinRepetir} días desde tu boda.`, components: [] });
    this.d.log(`💔 ${done.name} se divorció de ${name}`);
    await this.removeEndedRoles().catch((e) => logError("rol de boda (divorcio)", e));
    const channel = findTextChannel(this.d.guild(), this.w.settings.canal);
    if (channel) {
      const ch = await this.d.sendable(done.bot, channel.id);
      await ch.send({ content: this.d.phrases.pick(done.bot, "boda_divorcio", { papu: `<@${i.user.id}>` }), allowedMentions: { users: [i.user.id] } });
    }
    await this.d.report(`💔 <@${i.user.id}> se divorció de ${name}. Deja otra adivinanza.`);
    // La nueva adivinanza sale ya (o cuando se cierre la que este abierta).
    await this.tick().catch((e) => logError("bodas (tras divorcio)", e));
    return true;
  }

  // ───────────────────────── rol ─────────────────────────

  private async tetoGuild(): Promise<Guild> {
    return this.d.clients.teto!.guilds.fetch(this.d.guild().id);
  }

  /**
   * Rol "<corazón> Espos@ de <chica>": Teto lo crea con el color de la chica, lo más arriba que puede (asi el color se
   * ve), pero siempre bajo el rol de Neru: si quedara encima, Neru no podria silenciar a los casados (caso real del
   * 22 oct. 2026). Uno que ya existe y quedo sobre Neru se baja.
   */
  private async giveRole(bot: BotId, userId: string): Promise<void> {
    const guild = await this.tetoGuild();
    const name = weddingRole(this.w.settings, bot);
    let role = guild.roles.cache.find((x) => channelKey(x.name) === channelKey(name));
    const created = !role;
    if (!role) {
      role = await guild.roles.create({ name, colors: { primaryColor: this.d.characters[bot].color }, permissions: [], mentionable: false, hoist: false, reason: "Boda con una Vocaloid (24 h)" });
    }
    const neruId = this.d.clients.neru?.user?.id;
    const neru = neruId ? await guild.members.fetch(neruId).catch(() => null) : null;
    const ceiling = Math.min(guild.members.me?.roles.highest.position ?? 0, neru?.roles.highest.position ?? Infinity);
    if (ceiling > 1 && (created || role.position >= ceiling)) await role.setPosition(ceiling - 1).catch((e) => logError("posición del rol de boda", e));
    await guild.members.addRole({ user: userId, role: role.id, reason: `Se casó con ${this.girlName(bot)} (24 h)` });
  }

  /** Bodas terminadas: Teto borra su rol (solo existe mientras dura la boda). */
  private async removeEndedRoles(): Promise<void> {
    const ended = this.w.ended();
    if (!ended.length) return;
    const guild = await this.tetoGuild();
    for (const wed of ended) {
      const busy = this.w.weddings().some((x) => x.bot === wed.bot);
      const name = weddingRole(this.w.settings, wed.bot);
      const role = guild.roles.cache.find((x) => channelKey(x.name) === channelKey(name));
      if (role && !busy) await role.delete(wed.divorcedAt ? `Divorcio de ${this.girlName(wed.bot)}` : `Terminó la boda de 24 h con ${this.girlName(wed.bot)}`);
      else if (role) await guild.members.removeRole({ user: wed.userId, role: role.id }).catch(() => {});
      this.w.roleRemoved(wed.id);
      if (!wed.divorcedAt) this.d.log(`💍 Terminó la boda de ${wed.name} con ${this.girlName(wed.bot)}`);
    }
  }

  // ───────────────────────── banner ─────────────────────────

  private async banner(
    bot: BotId,
    userId: string,
    papuName: string,
    before: ReturnType<LevelService["snapshot"]>,
    after: ReturnType<LevelService["snapshot"]>,
    gained: number,
    mult: number,
  ): Promise<Buffer> {
    const figure = (b: string) => {
      const f = path.join(ASSETS, `${b}_figura.png`);
      return existsSync(f) ? readFileSync(f) : null;
    };
    const seed = Date.now() % 100_000;
    const others = BOT_IDS.filter((b) => b !== bot)
      .map((b) => ({ b, k: ((seed * 31 + b.charCodeAt(0) * 17 + b.length * 7) % 97) / 97 }))
      .sort((x, y) => x.k - y.k)
      .map((x) => figure(x.b))
      .filter((x): x is Buffer => !!x)
      .slice(0, 8);
    const mb = await this.d.guild().members.fetch(userId).catch(() => null);
    const avatar = mb
      ? await fetch(mb.displayAvatarURL({ extension: "png", size: 256 }))
          .then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null))
          .catch(() => null)
      : null;
    const ls = this.d.levels.settings;
    const prev = progress(ls, before.xp);
    const rank = rankFor(ls, after.level);
    return renderWeddingBanner({
      style: Math.floor(Math.random() * BANNER_STYLES),
      bride: { name: this.d.characters[bot].displayName, color: `#${this.d.characters[bot].color.toString(16).padStart(6, "0")}`, figure: figure(bot) },
      crowd: others,
      papu: { name: stripNickTag(mb?.displayName ?? papuName), avatar },
      role: weddingRole(this.w.settings, bot),
      before: { level: prev.level, into: prev.into, needed: prev.needed },
      after: { level: after.level, into: after.into, needed: after.needed, max: after.max, tier: rank.estilo, rankName: rank.nombre },
      gained,
      multiplier: mult,
      date: new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: this.d.timeZone }).format(new Date()),
      seed,
    });
  }
}
