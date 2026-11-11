// Niveles en Discord (PLAN §niveles): XP de mensajes y voz, avisos de Teto, rol de honor, nivel en el apodo (si el
// Papu lo activa), tarjeta /nivel y su personalizacion /tarjeta, ranking (/ranking y /publicar-ranking) y eventos de XP
// (/evento, y los fijos que anuncia Miku).
// Las reglas viven en src/levels/; aqui solo se habla con Discord. Los avisos son frases fijas (regla 4).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
  type SendableChannels,
} from "discord.js";
import { BOT_IDS, type BotId } from "../config";
import { kvGet, kvSet, type Db } from "../db/database";
import { logError, type LogFn } from "../log";
import { normalizeBackground, renderCardAny, type BackgroundFit, type CardData, type CardEquip } from "../levels/card";
import { podiumBots, renderRanking, RANKING_TOP, type RankingRow } from "../levels/ranking";
import { activeEvents, eventEnd, nickWithLevel, stripNickTag } from "../levels/rules";
import type { LevelChange, LevelService, Standing } from "../levels/service";
import type { RuleSet } from "../moderation/rules";
import type { Phrases } from "../phrases/catalog";
import type { Quota } from "../quota/quota";
import { dayKey } from "../time";
import { avisoPing } from "./avisos";
import { CHANNELS, channelKey, findTextChannel } from "./channels";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ASSETS = path.resolve(import.meta.dirname, "../../assets/bots");
/** Ranking automático de cada día: canal y hora (de la zona de la cuota, Chile). */
const RANKING_CANAL = "ranking";
const RANKING_HORA = 12;
const RANKING_DAY_KEY = "niveles:ranking_diario";

export interface LevelsDiscordDeps {
  levels: LevelService;
  quota: Quota;
  phrases: Phrases;
  rules: RuleSet;
  db: Db;
  owners: ReadonlySet<string>;
  /** GyroP o un Mod: aprueban o rechazan los fondos de tarjeta. Sin esto, solo GyroP. */
  isStaff?: (userId: string) => Promise<boolean>;
  teto: Client;
  timeZone: string;
  /** Carpeta de datos (data/): aqui se guardan los fondos propios de las tarjetas (data/tarjetas/). */
  dataDir: string;
  /** Color por defecto de la tarjeta (el de Teto). */
  defaultAccent: string;
  /** Color de cada Vocaloid "#RRGGBB" (luces del podio del ranking). */
  botColors: Record<BotId, string>;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  grantRole: (userId: string, roleName: string, reason: string) => Promise<void>;
  report: (text: string) => Promise<void>;
  modChannel: () => Promise<SendableChannels | null>;
  /** Objetos de las Shaula-coins equipados (src/coins/; sin tienda, la tarjeta de siempre). */
  equipment?: (userId: string) => Promise<CardEquip>;
  /** Subio de nivel: bono de Shaula-coins (src/coins/). */
  onLevelUp?: (change: LevelChange) => void;
  log: LogFn;
}

/** La tarjeta como archivo: nivel.gif si se mueve (objetos animados), si no nivel.png. */
export function cardFile(card: { data: Buffer; gif: boolean }): AttachmentBuilder {
  return new AttachmentBuilder(card.data, { name: card.gif ? "nivel.gif" : "nivel.png" });
}

/** Donde paso lo que hizo subir (el mensaje), para avisar ahi mismo. Sin canal: #general. */
export interface LevelContext {
  channelId?: string;
  messageId?: string;
}

export class LevelsDiscord {
  private nickWarned = false;
  private rankingWarned = false;

  constructor(private readonly d: LevelsDiscordDeps) {}

  private get settings() {
    return this.d.levels.settings;
  }

  // ───────────────────────── XP ─────────────────────────

  /** Mensaje ya revisado por Neru. Devuelve la XP base (para doblarla si un Vocaloid contesta). */
  async onMessage(userId: string, text: string, ctx: LevelContext): Promise<number> {
    const { base, change } = this.d.levels.onMessage(userId, text);
    // El aviso (con la tarjeta) va aparte: no retrasa la respuesta de los Vocaloids.
    if (change) void this.handle(change, ctx).catch((e) => logError("aviso de nivel", e));
    return base;
  }

  async onBotReply(userId: string, base: number, ctx: LevelContext): Promise<void> {
    const change = this.d.levels.onBotReply(userId, base);
    if (change) await this.handle(change, ctx);
  }

  /** Cada minuto: XP a quienes estan en voz con otros Papus (sin bots, sin ensordecidos, fuera del canal AFK; silenciados, menos). */
  async voiceTick(isBot: (userId: string) => boolean): Promise<void> {
    const guild = this.d.guild();
    const byChannel = new Map<string, { id: string; muted: boolean }[]>();
    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId || vs.channelId === guild.afkChannelId) continue;
      if (vs.member?.user.bot || isBot(vs.id) || vs.selfDeaf || vs.serverDeaf) continue;
      byChannel.set(vs.channelId, [...(byChannel.get(vs.channelId) ?? []), { id: vs.id, muted: !!(vs.selfMute || vs.serverMute) }]);
    }
    for (const change of this.d.levels.onVoiceMinute([...byChannel.values()])) await this.handle(change, {});
  }

  /** Machetazo de Neru: pierde la XP del dia (y el apodo se corrige si bajo de nivel). Devuelve cuanta, para el perdon. */
  onStrike(userId: string, at = Date.now()): { day: string; xp: number } {
    const { day, xp, change } = this.d.levels.onStrike(userId, at);
    if (change) void this.syncNick(userId).catch((e) => logError("apodo con nivel", e));
    return { day, xp };
  }

  /**
   * Perdon de GyroP: vuelve la XP que quitaron los machetazos. Sin anuncio de Teto ni bono de monedas por subir: solo
   * recupera lo que ya tenia (el apodo se corrige).
   */
  async onForgive(userId: string, taken: { day: string; xp: number }[]): Promise<number> {
    const before = this.d.levels.store.get(userId).xp;
    const change = this.d.levels.onForgive(userId, taken);
    if (change) await this.syncNick(userId).catch((e) => logError("apodo con nivel", e));
    return this.d.levels.store.get(userId).xp - before;
  }

  /** Anuncia y aplica un cambio de nivel: rol de honor, apodo y frase de Teto (o 🆙 en el mensaje). */
  async handle(change: LevelChange, ctx: LevelContext, opts: { quiet?: boolean; sinBono?: boolean } = {}): Promise<void> {
    // sinBono: subida por un intercambio (src/intercambios/). Sin monedas por subir: si no, bajar y volver a subir con
    // XP cambiada daría monedas cada vez.
    if (change.to > change.from && !opts.sinBono) {
      try {
        this.d.onLevelUp?.(change);
      } catch (e) {
        logError("monedas por nivel", e);
      }
    }
    await this.syncNick(change.userId).catch((e) => logError("apodo con nivel", e));
    if (change.to < change.from) return;
    // GyroP sube de nivel solo para verlo: sin rol de honor ni aviso de "Papu de honor". Discord no deja que un bot
    // le cambie el apodo al dueño del servidor, asi que Teto le avisa cada subida en #registro-bots (pedido de GyroP).
    if (this.d.owners.has(change.userId)) {
      change = { ...change, honor: false };
      await this.d.report(`🆙 GyroP subió al nivel ${change.to}${change.rankUp ? ` (rango nuevo: ${change.rankUp})` : ""}.`).catch(() => {});
    }
    // Ya era de honor (del nivel 25, antes del cambio al 40, o dado a mano): no se le anuncia otra vez.
    if (change.honor && (await this.hasHonorRole(change.userId))) change = { ...change, honor: false };
    if (change.honor) {
      await this.d.grantRole(change.userId, this.settings.honor.rol, `Nivel ${this.settings.honor.nivel}: Papu de honor`).catch((e) => logError("rol de honor", e));
    }
    // Subida por una boda (src/discord/bodas.ts): el banner ya lo celebra, sin frase de Teto.
    if (opts.quiet) return;
    const papu = `<@${change.userId}>`;
    const group = change.max ? "nivel_maximo" : change.honor ? "papu_de_honor" : change.rankUp ? "sube_rango" : null;
    if (!group) {
      // Subida comun: solo una reaccion de Teto en el mensaje (asi los canales no se llenan de avisos).
      if (ctx.channelId && ctx.messageId) {
        const ch = await this.d.sendable("teto", ctx.channelId).catch(() => null);
        if (ch && "messages" in ch) await (await ch.messages.fetch(ctx.messageId).catch(() => null))?.react("🆙").catch(() => {});
      }
      return;
    }
    const content = this.d.phrases.pick("teto", group, { papu, nivel: change.to, rango: change.rankUp ?? "" });
    await this.announce(change.userId, content, ctx);
  }

  private async hasHonorRole(userId: string): Promise<boolean> {
    const mb = await this.d.guild().members.fetch(userId).catch(() => null);
    const rol = channelKey(this.settings.honor.rol);
    return !!mb?.roles.cache.some((r) => channelKey(r.name) === rol);
  }

  /** Frase de Teto con la tarjeta del Papu, en el canal donde subio (o en #general). */
  private async announce(userId: string, content: string, ctx: LevelContext): Promise<void> {
    const general = findTextChannel(this.d.guild(), CHANNELS.general);
    const channelId = ctx.channelId ?? general?.id;
    if (!channelId) return;
    const ch = await this.d.sendable("teto", channelId).catch(() => null);
    if (!ch) return;
    const card = await this.card(userId).catch((e) => (logError("tarjeta de nivel", e), null));
    await ch.send({
      content,
      files: card ? [cardFile(card)] : [],
      allowedMentions: { users: [userId] },
      ...(ctx.messageId ? { reply: { messageReference: ctx.messageId, failIfNotExists: false } } : {}),
    });
  }

  // ───────────────────────── honor y roles ─────────────────────────

  /**
   * Repaso (al conectar y cada hora): quien tiene el rol de honor empieza al menos en su nivel, y quien llego al nivel
   * de honor tiene el rol (por si subio con los bots apagados o se lo quitaron sin querer).
   */
  async sweep(members: Iterable<GuildMember>): Promise<void> {
    const rol = channelKey(this.settings.honor.rol);
    for (const mb of members) {
      if (mb.user.bot || this.d.owners.has(mb.id)) continue;
      const hasHonor = mb.roles.cache.some((r) => channelKey(r.name) === rol);
      if (hasHonor) this.d.levels.ensureHonor(mb.id);
      const { level, prestige } = this.d.levels.level(mb.id);
      if (!hasHonor && (level >= this.settings.honor.nivel || prestige > 0)) {
        await this.d.grantRole(mb.id, this.settings.honor.rol, `Nivel ${this.settings.honor.nivel}: Papu de honor`).catch((e) => logError("rol de honor", e));
      }
      if (this.d.levels.store.get(mb.id).nick) await this.syncNick(mb.id, mb).catch((e) => logError("apodo con nivel", e));
    }
  }

  /** Cambios de un miembro: rol de honor dado a mano (sube al nivel de honor) y apodo cambiado por el Papu. */
  async onMemberUpdate(old: GuildMember | PartialGuildMember, member: GuildMember): Promise<void> {
    if (member.user.bot) return;
    const rol = channelKey(this.settings.honor.rol);
    const had = old.partial ? false : old.roles.cache.some((r) => channelKey(r.name) === rol);
    if (!had && member.roles.cache.some((r) => channelKey(r.name) === rol)) {
      const change = this.d.levels.ensureHonor(member.id);
      if (change) this.d.log(`🏅 ${member.user.username} recibió el rol de honor: sube al nivel ${change.to}`);
    }
    const rec = this.d.levels.store.get(member.id);
    if (!rec.nick) return;
    const want = this.desiredNick(member.id, rec.nickBase ?? baseName(member));
    if (member.nickname === want) return;
    // El Papu se cambio el apodo: ese es su nombre nuevo; se le vuelve a poner el nivel.
    this.d.levels.store.setNick(member.id, true, baseName(member));
    await this.syncNick(member.id, member);
  }

  // ───────────────────────── apodo ─────────────────────────

  private desiredNick(userId: string, base: string): string {
    const { level, prestige } = this.d.levels.level(userId);
    return nickWithLevel(base, level, prestige);
  }

  private async tetoMember(userId: string): Promise<GuildMember | null> {
    const guild = await this.d.teto.guilds.fetch(this.d.guild().id);
    return guild.members.fetch(userId).catch(() => null);
  }

  /** Pone (o corrige) "nombre ✦N" si el Papu lo activo. */
  async syncNick(userId: string, member?: GuildMember): Promise<void> {
    const rec = this.d.levels.store.get(userId);
    if (!rec.nick) return;
    const mb = member && member.client === this.d.teto ? member : await this.tetoMember(userId);
    if (!mb) return;
    const want = this.desiredNick(userId, rec.nickBase ?? baseName(mb));
    if (mb.nickname === want) return;
    try {
      await mb.setNickname(want, "Nivel en el apodo (lo activó el Papu con /nivel)");
    } catch (e) {
      if (!this.nickWarned) {
        this.nickWarned = true;
        await this.d.report(`⚠️ No pude poner el nivel en el apodo de <@${userId}>: Teto necesita "Gestionar apodos" y su rol más arriba que el de los Papus (${(e as Error).message}).`);
      }
    }
  }

  private async setNickMode(i: ButtonInteraction, on: boolean): Promise<void> {
    // Primero se contesta: cambiar el apodo puede tardar más de los 3 s que da Discord ("Unknown interaction", 21 oct. 2026).
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const mb = await this.tetoMember(i.user.id);
    if (!mb) return void (await i.editReply({ content: "No te encuentro en el servidor. 🥖" }));
    if (this.d.owners.has(i.user.id) || mb.id === mb.guild.ownerId) {
      return void (await i.editReply({ content: "Al dueño del servidor Discord no me deja cambiarle el apodo. 🥖" }));
    }
    const base = baseName(mb);
    if (on) {
      this.d.levels.store.setNick(mb.id, true, base);
      await this.syncNick(mb.id, mb);
      const fresh = await mb.fetch(true).catch(() => mb);
      const ok = fresh.nickname === this.desiredNick(mb.id, base);
      await i.editReply({
        content: ok
          ? `¡Listo! Ahora te ves como **${fresh.nickname}** en todo el servidor. Si te cambias el apodo, le vuelvo a poner el nivel. ¡teto-teetoo!`
          : "No pude cambiarte el apodo (le avisé a GyroP). Lo intento de nuevo en un rato. 🥖",
      });
      return;
    }
    this.d.levels.store.setNick(mb.id, false, null);
    // Vuelve su nombre de siempre: si era su nombre de cuenta, sin apodo.
    const account = mb.user.globalName ?? mb.user.username;
    await mb.setNickname(base === account ? null : base, "Quitó el nivel del apodo").catch(() => {});
    await i.editReply({ content: "Listo, quité el nivel de tu apodo. Cuando quieras lo vuelves a poner con /nivel. 🥖" });
  }

  // ───────────────────────── tarjeta ─────────────────────────

  private background(userId: string, fondo: string | null): Buffer | null {
    const file =
      fondo === "propia" ? path.join(this.cardsDir, `${userId}.png`) : fondo?.startsWith("bot:") ? path.join(ASSETS, `${fondo.slice(4)}_banner.png`) : null;
    return file && existsSync(file) ? readFileSync(file) : null;
  }

  private get cardsDir(): string {
    return path.join(this.d.dataDir, "tarjetas");
  }

  /** Tarjeta con lo equipado (o con `equip`, para probar un objeto antes de comprarlo): GIF si algo se mueve. */
  async card(userId: string, equip?: CardEquip): Promise<{ data: Buffer; gif: boolean }> {
    const e = equip ?? (await this.d.equipment?.(userId).catch((err) => (logError("objetos de la tarjeta", err), {} as CardEquip))) ?? {};
    return renderCardAny(await this.cardData(userId), e);
  }

  async cardData(userId: string): Promise<CardData> {
    const guild = this.d.guild();
    const mb = await guild.members.fetch(userId).catch(() => null);
    const user = mb?.user ?? (await guild.client.users.fetch(userId));
    const snap = this.d.levels.snapshot(userId);
    const avatar = await fetchAvatar((mb ?? user).displayAvatarURL({ extension: "png", size: 256 }));
    const position = this.standings().find((st) => st.userId === userId)?.position ?? snap.position;
    const left = this.d.quota.remaining(userId);
    const limit = this.d.quota.limitFor(userId) + this.d.quota.extra(userId);
    return {
      name: stripNickTag(mb?.displayName ?? user.displayName),
      avatar,
      level: snap.level,
      max: snap.max,
      prestige: snap.prestige,
      into: snap.into,
      needed: snap.needed,
      tier: snap.rank.estilo,
      rankName: snap.rank.nombre,
      position,
      quota: Number.isFinite(limit) ? { left, limit } : null,
      frase: snap.card.frase,
      accent: snap.card.color ?? this.d.defaultAccent,
      background: this.background(userId, snap.card.fondo),
      multiplier: this.d.levels.multiplier(),
    };
  }

  /** /nivel: tarjeta propia (con botones de apodo y prestigio) o de otro Papu. */
  async nivel(i: ChatInputCommandInteraction): Promise<void> {
    const target = i.options.getUser("papu") ?? i.user;
    if (target.bot) return void (await i.reply({ content: "Los Vocaloids no tenemos nivel… ¡somos el nivel! 🥖", flags: MessageFlags.Ephemeral }));
    const show = i.options.getBoolean("mostrar") ?? false;
    await i.deferReply(show ? {} : { flags: MessageFlags.Ephemeral });
    const card = await this.card(target.id);
    const own = target.id === i.user.id;
    const rec = this.d.levels.store.get(i.user.id);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      rec.nick
        ? new ButtonBuilder().setCustomId("nivel:apodo:off").setLabel("Quitar el nivel de mi apodo").setStyle(ButtonStyle.Secondary)
        : new ButtonBuilder().setCustomId("nivel:apodo:on").setLabel("✦ Poner mi nivel en el apodo").setStyle(ButtonStyle.Primary),
    );
    if (own && this.d.levels.level(i.user.id).level >= this.settings.curva.maximo) {
      row.addComponents(new ButtonBuilder().setCustomId("nivel:prestigio").setLabel("★ Prestigiar").setStyle(ButtonStyle.Success));
    }
    await i.editReply({
      files: [cardFile(card)],
      components: own && !show ? [row] : [],
      allowedMentions: { parse: [] },
    });
  }

  // ───────────────────────── ranking ─────────────────────────

  /** Puestos entre quienes siguen en el servidor (la cache de miembros la refresca el repaso de cada hora). */
  standings(): Standing[] {
    const members = this.d.guild().members.cache;
    return this.d.levels.standings((id) => {
      const mb = members.get(id);
      return !!mb && !mb.user.bot;
    });
  }

  /** Imagen del ranking; con `viewerId`, agrega su fila si no esta entre los primeros. Null si nadie tiene nivel. */
  async rankingImage(viewerId: string | null, now = new Date()): Promise<Buffer | null> {
    const all = this.standings();
    if (!all.length) return null;
    const top = all.slice(0, RANKING_TOP);
    const mine = viewerId && !top.some((st) => st.userId === viewerId) ? all.find((st) => st.userId === viewerId) ?? null : null;
    const [rows, me] = await Promise.all([Promise.all(top.map((st) => this.rankingRow(st))), mine ? this.rankingRow(mine) : null]);
    return renderRanking({
      rows,
      me,
      bots: podiumBots(dayKey(now, this.d.timeZone), BOT_IDS),
      colors: this.d.botColors,
      date: new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: this.d.timeZone }).format(now),
    });
  }

  private async rankingRow(st: Standing): Promise<RankingRow> {
    const guild = this.d.guild();
    const mb = guild.members.cache.get(st.userId) ?? (await guild.members.fetch(st.userId).catch(() => null));
    return {
      position: st.position,
      name: mb ? stripNickTag(mb.displayName) : "Papu",
      avatar: mb ? await fetchAvatar(mb.displayAvatarURL({ extension: "png", size: 128 })) : null,
      level: st.level,
      max: this.settings.curva.maximo,
      prestige: st.prestige,
      into: st.into,
      needed: st.needed,
      tier: st.rank.estilo,
      rankName: st.rank.nombre,
    };
  }

  /** /ranking: lo ve solo quien lo pide (con su puesto abajo si no esta entre los primeros). */
  async ranking(i: ChatInputCommandInteraction): Promise<void> {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const png = await this.rankingImage(i.user.id);
    if (!png) return void (await i.editReply("Todavía nadie tiene nivel. ¡Escribe y sé el primero! 🥖"));
    await i.editReply({ files: [new AttachmentBuilder(png, { name: "ranking.png" })], allowedMentions: { parse: [] } });
  }

  /** /publicar-ranking (solo GyroP): Teto lo publica en el canal donde se usa, para todos. */
  async publicarRanking(i: ChatInputCommandInteraction): Promise<void> {
    if (!this.d.owners.has(i.user.id)) return void (await i.reply({ content: "¡Eso solo lo usa GyroP! Tú puedes verlo con /ranking. 🥖", flags: MessageFlags.Ephemeral }));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const png = await this.rankingImage(null);
    if (!png) return void (await i.editReply("Todavía nadie tiene nivel: no hay ranking que publicar."));
    const ch = i.channelId ? await this.d.sendable("teto", i.channelId).catch(() => null) : null;
    if (!ch) return void (await i.editReply("No puedo escribir en este canal."));
    await this.sendRanking(ch, png);
    await i.editReply("Listo, publiqué el ranking aquí. 🥖");
  }

  private async sendRanking(ch: SendableChannels, png: Buffer): Promise<void> {
    await ch.send({
      content: this.d.phrases.pick("teto", "ranking"),
      files: [new AttachmentBuilder(png, { name: "ranking.png" })],
      allowedMentions: { parse: [] },
    });
  }

  /**
   * Cada minuto: una vez al día, desde las RANKING_HORA (hora de la cuota), Teto publica el ranking en #ranking, como
   * /publicar-ranking (pedido de GyroP, 10 nov. 2026). Si el canal no existe, no hace nada.
   */
  async publishDailyRanking(now = new Date()): Promise<void> {
    const day = dayKey(now, this.d.timeZone);
    if (kvGet(this.d.db, RANKING_DAY_KEY) === day) return;
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: this.d.timeZone }).format(now));
    if (hour < RANKING_HORA) return;
    const canal = findTextChannel(this.d.guild(), RANKING_CANAL);
    if (!canal) {
      if (!this.rankingWarned) await this.d.report(`⚠️ No encuentro el canal #${RANKING_CANAL}: Teto no puede publicar el ranking del día.`).catch(() => {});
      this.rankingWarned = true;
      return;
    }
    kvSet(this.d.db, RANKING_DAY_KEY, day);
    const png = await this.rankingImage(null, now);
    if (!png) return;
    await this.sendRanking(await this.d.sendable("teto", canal.id), png);
    this.d.log(`🏆 Ranking del día publicado en #${canal.name}`);
  }

  /** /tarjeta: frase, color, fondo y la imagen propia (que GyroP aprueba antes de que se vea). */
  async tarjeta(i: ChatInputCommandInteraction): Promise<void> {
    const frase = i.options.getString("frase");
    const color = i.options.getString("color");
    const fondo = i.options.getString("fondo");
    const imagen = i.options.getAttachment("imagen");
    const ajuste = i.options.getString("ajuste") as BackgroundFit | null;
    if (frase === null && !color && !fondo && !imagen && !ajuste) {
      return void (await i.reply({ content: "Dime qué cambiar: **frase**, **color**, **fondo**, **imagen** o **ajuste**. Mira cómo queda con /nivel. 🥖", flags: MessageFlags.Ephemeral }));
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const done: string[] = [];
    if (frase !== null) {
      const text = frase.trim() === "-" ? null : frase.trim().replace(/\s+/g, " ");
      const bad = text ? this.d.rules.check({ text, targetsSomeone: true, memberAgeHours: 1e6, personalData: true }) : null;
      if (bad?.remove) return void (await i.editReply("Esa frase no pasa las reglas del servidor (Neru me la rebotó). Prueba con otra. 🥖"));
      this.d.levels.store.setCard(i.user.id, { frase: text });
      done.push(text ? "frase" : "frase quitada");
    }
    if (color) {
      this.d.levels.store.setCard(i.user.id, { color });
      done.push("color");
    }
    if (fondo) {
      if (fondo === "propia" && !existsSync(path.join(this.cardsDir, `${i.user.id}.png`))) {
        return void (await i.editReply("Todavía no tienes una imagen aprobada. Súbela con la opción **imagen** y GyroP la revisa. 🥖"));
      }
      this.d.levels.store.setCard(i.user.id, { fondo: fondo === "ninguno" ? null : fondo === "propia" ? "propia" : `bot:${fondo}` });
      done.push("fondo");
    }
    let pending = false;
    if (imagen) {
      if (!imagen.contentType?.startsWith("image/") || imagen.size > MAX_UPLOAD_BYTES) {
        return void (await i.editReply("La imagen tiene que ser PNG, JPG o WEBP y pesar menos de 8 MB. 🥖"));
      }
      const raw = await fetch(imagen.url).then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null)).catch(() => null);
      const png = raw ? await normalizeBackground(raw, ajuste ?? "centro") : null;
      if (!png) return void (await i.editReply("No pude abrir esa imagen. Prueba con otra (PNG o JPG). 🥖"));
      mkdirSync(this.cardsDir, { recursive: true });
      writeFileSync(path.join(this.cardsDir, `pendiente-${i.user.id}.png`), png);
      // El original se guarda para cambiar el ajuste después sin volver a pedir la aprobación (es la misma imagen).
      writeFileSync(path.join(this.cardsDir, `pendiente-${i.user.id}.orig`), raw!);
      await this.askApproval(i.user.id, png);
      pending = true;
    } else if (ajuste) {
      const original = path.join(this.cardsDir, `${i.user.id}.orig`);
      if (!existsSync(original)) {
        return void (await i.editReply("Para cambiar el ajuste, sube tu imagen otra vez con **imagen** y elige el **ajuste** en el mismo comando. 🥖"));
      }
      const png = await normalizeBackground(readFileSync(original), ajuste);
      if (!png) return void (await i.editReply("No pude volver a abrir tu imagen. Súbela de nuevo con **imagen**. 🥖"));
      writeFileSync(path.join(this.cardsDir, `${i.user.id}.png`), png);
      done.push("ajuste de la imagen");
    }
    const parts = [done.length ? `¡Listo! Cambié tu ${done.join(", ")}.` : "", pending ? "Tu imagen le llegó a GyroP: cuando la apruebe, aparece sola en tu tarjeta." : "", "Mira cómo queda con /nivel. ¡teto-teetoo!"];
    await i.editReply(parts.filter(Boolean).join(" "));
  }

  /** Imagen nueva de una tarjeta: va a #moderación con botones para GyroP (menores en el servidor: nada sin revisar). */
  private async askApproval(userId: string, png: Buffer): Promise<void> {
    const ch = await this.d.modChannel();
    if (!ch) return;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tarjeta:ok:${userId}`).setLabel("Aprobar").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tarjeta:no:${userId}`).setLabel("Rechazar").setStyle(ButtonStyle.Danger),
    );
    await ch.send({
      content: `🖼️ <@${userId}> quiere esta imagen de fondo en su tarjeta de nivel. ¿La aprueba?`,
      files: [new AttachmentBuilder(png, { name: "fondo.png" })],
      components: [row],
      allowedMentions: { parse: [] },
    });
  }

  // ───────────────────────── botones ─────────────────────────

  /** Botones de /nivel y de la revision de fondos. Devuelve false si el boton no es de los niveles. */
  async button(i: ButtonInteraction): Promise<boolean> {
    const [kind, action, userId] = i.customId.split(":");
    if (kind === "nivel" && action === "apodo") {
      await this.setNickMode(i, userId === "on");
      return true;
    }
    if (kind === "nivel" && action === "prestigio") {
      if (userId !== "si") {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("nivel:prestigio:si").setLabel("Sí, volver al nivel 1 con una ★").setStyle(ButtonStyle.Success),
        );
        await i.reply({
          content: "¿Seguro? Vuelves al **nivel 1** con una estrella ★ más. Conservas la cuota de prestigio y el rol de honor. No se puede deshacer.",
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      const stars = this.d.levels.prestige(i.user.id);
      if (stars === null) return void (await i.reply({ content: "Para prestigiar hay que estar en el nivel 99. 🥖", flags: MessageFlags.Ephemeral })), true;
      await i.update({ content: `¡Hecho! Ahora tienes ${stars} ★. ¡teto-teetoo!`, components: [] });
      await this.syncNick(i.user.id).catch((e) => logError("apodo con nivel", e));
      await this.announce(i.user.id, this.d.phrases.pick("teto", "prestigio", { papu: `<@${i.user.id}>`, n: stars }), { channelId: i.channelId ?? undefined });
      await this.d.report(`★ <@${i.user.id}> prestigió (${stars} ★).`);
      return true;
    }
    if (kind === "tarjeta" && (action === "ok" || action === "no") && userId) {
      const staff = this.d.owners.has(i.user.id) || !!(await this.d.isStaff?.(i.user.id));
      if (!staff) return void (await i.reply({ content: "eso lo deciden gyrop y los mods. 📱", flags: MessageFlags.Ephemeral })), true;
      const pending = path.join(this.cardsDir, `pendiente-${userId}.png`);
      if (!existsSync(pending)) return void (await i.update({ content: `${i.message.content}\n(ya no hay imagen pendiente)`, components: [] })), true;
      const original = path.join(this.cardsDir, `pendiente-${userId}.orig`);
      if (action === "ok") {
        renameSync(pending, path.join(this.cardsDir, `${userId}.png`));
        if (existsSync(original)) renameSync(original, path.join(this.cardsDir, `${userId}.orig`));
        else rmSync(path.join(this.cardsDir, `${userId}.orig`), { force: true });
        this.d.levels.store.setCard(userId, { fondo: "propia" });
      } else {
        rmSync(pending, { force: true });
        rmSync(original, { force: true });
      }
      const by = this.d.owners.has(i.user.id) ? "" : ` (por <@${i.user.id}>)`;
      await i.update({ content: `${i.message.content}\n${action === "ok" ? "✅ Aprobada: ya sale en su tarjeta." : "🚫 Rechazada."}${by}`, components: [], allowedMentions: { parse: [] } });
      return true;
    }
    return false;
  }

  // ───────────────────────── eventos ─────────────────────────

  /** /evento de GyroP: Miku lo anuncia en #general. */
  async evento(i: ChatInputCommandInteraction): Promise<void> {
    if (!this.d.owners.has(i.user.id)) return void (await i.reply({ content: "¡Eso solo lo usa GyroP! 🥖", flags: MessageFlags.Ephemeral }));
    const mult = i.options.getNumber("multiplicador", true);
    if (mult <= 0) {
      this.d.levels.endEvent();
      await i.reply({ content: "Evento terminado. La XP vuelve a la normal (salvo los eventos fijos de config/niveles.json).", flags: MessageFlags.Ephemeral });
      return;
    }
    const e = this.d.levels.startEvent(mult, i.options.getInteger("horas") ?? 24);
    await this.announceEvent(mult, e.hasta);
    await i.reply({ content: `¡Listo! XP ×${fmtMult(mult)} hasta <t:${Math.floor(e.hasta / 1000)}:f>. Miku lo anunció en #general.`, flags: MessageFlags.Ephemeral });
  }

  /** Eventos fijos (aniversario) y estrenos de videos: Miku los anuncia una vez al empezar. Se llama cada minuto. */
  async announceFixedEvents(now = new Date()): Promise<void> {
    const release = this.d.levels.activeRelease(now.getTime());
    if (release && !kvGet(this.d.db, `niveles:estreno:${release.at}`)) {
      kvSet(this.d.db, `niveles:estreno:${release.at}`, "1");
      await this.announceEvent(release.window.multiplicador, release.window.hasta, true);
    }
    for (const e of activeEvents(this.settings, now, this.d.timeZone)) {
      const key = `niveles:anunciado:${e.nombre}:${dayKey(now, this.d.timeZone)}`;
      if (kvGet(this.d.db, key)) continue;
      kvSet(this.d.db, key, "1");
      await this.announceEvent(e.multiplicador, eventEnd(e, now, this.d.timeZone));
    }
  }

  /** Miku anuncia la XP multiplicada en #general. Si es un estreno, etiqueta el aviso 🎬 Estrenos de #tus-roles. */
  private async announceEvent(mult: number, until: number, estreno = false): Promise<void> {
    const general = findTextChannel(this.d.guild(), CHANNELS.general);
    if (!general) return;
    const ch = await this.d.sendable("miku", general.id);
    const ping = estreno ? avisoPing(this.d.guild(), "estrenos") : null;
    const text = this.d.phrases.pick("miku", "evento_xp", { n: `×${fmtMult(mult)}`, fecha: `<t:${Math.floor(until / 1000)}:t>` });
    await ch.send({ content: ping ? `🔔 ${ping.mention}\n${text}` : text, allowedMentions: ping ? { roles: [ping.roleId] } : { parse: [] } });
  }
}

const fmtMult = (n: number) => String(n).replace(".", ",");

async function fetchAvatar(url: string): Promise<Buffer | null> {
  return fetch(url)
    .then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null))
    .catch(() => null);
}

/** Nombre del Papu sin la etiqueta de nivel: su apodo, o su nombre de cuenta. */
function baseName(mb: GuildMember): string {
  return stripNickTag(mb.nickname ?? mb.user.globalName ?? mb.user.username);
}
