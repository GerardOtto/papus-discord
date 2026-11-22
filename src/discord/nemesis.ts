// Ruleta de Némesis en Discord (PLAN §3.12). /nemesis rival apuesta: Teto publica el desafío (banner Papu vs Papu con
// Némesis al centro) en el canal donde se usa el comando con «Aceptar» y «Rechazar». Si acepta, abre la mesa: un mensaje que se edita en cada
// turno, con la imagen de quién jala y el botón del gatillo (si no lo toca a tiempo, jala Némesis); cada disparo es un
// GIF (gira el tambor, suspenso, *click* o ¡BANG!). Al final, el GIF del ganador con las monedas cayendo y el pago.
// Desde el 14 nov. 2026 (GyroP), a veces un Vocaloid desafía a un Papu activo (houseTick): lo publica ese Vocaloid, jala
// su gatillo solo y la apuesta sube con cada victoria suya y vuelve al inicio cuando pierde.
// Las reglas y el estado viven en src/nemesis/.
import type { AmbientEvent } from "../ambiente/service";
import type { BotId } from "../config";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type SendableChannels,
} from "discord.js";
import { stripNickTag } from "../levels/rules";
import { logError, type LogFn } from "../log";
import type { MarcoMembresia } from "../membresias/marco";
import { avatarPng, bannerImage, shotGif, shotGifMs, turnImage, type Jugador } from "../nemesis/images";
import { apuestaCasa, chanceAt, chancePorMinuto, enVentana, reparto } from "../nemesis/rules";
import type { Disparo, Duelo, NemesisService } from "../nemesis/service";
import { resultGif } from "../peleas/images";
import type { Phrases } from "../phrases/catalog";
import { dayKey } from "../time";
import { findTextChannel } from "./channels";

const PREFIX = "nemesis:";
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const unix = (t: number) => Math.floor(t / 1000);

export interface NemesisDiscordDeps {
  /** Ambiente casual (PLAN §3.13): un Vocaloid comenta el resultado en #general. */
  ambient?: (e: AmbientEvent) => void;
  svc: NemesisService;
  phrases: Phrases;
  /** GyroP: cancela la ruleta en curso. */
  owners: ReadonlySet<string>;
  /** GyroP o un Mod: también la cancelan. */
  isStaff?: (userId: string) => Promise<boolean>;
  /** Estilo de la membresía de Ko-fi según sus roles (marco y cinta del banner del retador, PLAN §2). */
  membresia?: (roleNames: string[]) => MarcoMembresia | undefined;
  guild: () => Guild;
  /** Canal en el que escribe Teto (o `bot`, el Vocaloid que desafió). */
  sendable: (channelId: string, bot?: BotId) => Promise<SendableChannels>;
  /** Qué Vocaloid es este usuario de Discord (undefined = no es uno de nuestros bots). */
  botOf?: (userId: string) => BotId | undefined;
  /** Ids de Discord de los Vocaloids conectados que pueden desafiar. */
  houseBots?: () => string[];
  /** Zona de la cuota (ventana horaria y día de los desafíos de los Vocaloids). */
  timeZone?: string;
  rnd?: () => number;
  report: (text: string) => Promise<void>;
  log: LogFn;
}

export class NemesisDiscord {
  private expireTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Mesa de la partida en curso, lo que ya pasó (una línea por disparo) y los avatares. */
  private mesa: { id: string; msg: Message; lines: string[]; jugadores: [Jugador, Jugador] } | null = null;
  /** Hay un disparo en pantalla (no se acepta otro hasta el turno siguiente). */
  private busy = false;
  /** Último mensaje de cada Papu (para los desafíos de los Vocaloids: "activo recientemente"). En memoria. */
  private readonly lastSeen = new Map<string, number>();

  constructor(private readonly d: NemesisDiscordDeps) {}

  private get s(): NemesisService {
    return this.d.svc;
  }

  // ───────────────────────── arranque ─────────────────────────

  /** Al conectar: devuelve lo apostado en partidas que quedaron a medias (reinicio) y lo avisa en sus mensajes. */
  async start(): Promise<void> {
    for (const { duelo, devuelto } of this.s.recover()) {
      await this.annotate(duelo, "⚠️ Esta ruleta se canceló (me reinicié a la mitad). Le devolví a cada uno lo que puso.");
      await this.d.report(`🔫 Ruleta de Némesis <@${duelo.retador}> vs <@${duelo.rival}> cancelada por reinicio: devolví ${fmt(devuelto)} Shaulitas.`);
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.expireTimer) clearTimeout(this.expireTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.expireTimer = this.turnTimer = null;
  }

  /** Cada minuto (respaldo del temporizador): vence el desafío sin respuesta y, a veces, desafía un Vocaloid. */
  async tick(now = Date.now()): Promise<void> {
    if (this.stopped) return;
    const x = this.s.expire();
    if (x) await this.expired(x);
    await this.houseTick(now);
  }

  /** Un Papu escribió (de app.ts): cuenta como activo para los desafíos de los Vocaloids. */
  seen(userId: string, at = Date.now()): void {
    this.lastSeen.set(userId, at);
    if (this.lastSeen.size > 2000) {
      const limit = at - (this.s.settings.bots?.activoMinutos ?? 30) * 60_000;
      for (const [id, t] of this.lastSeen) if (t < limit) this.lastSeen.delete(id);
    }
  }

  /** Quién publica una partida: el Vocaloid que desafió (desafío de la casa) o Teto. */
  private poster(x: Duelo): BotId {
    return (x.casa && this.d.botOf?.(x.retador)) || "teto";
  }

  private send(x: Duelo, channelId: string): Promise<SendableChannels> {
    return this.d.sendable(channelId, this.poster(x));
  }

  // ───────────────────────── desafíos de los Vocaloids ─────────────────────────

  /**
   * Cada minuto en la ventana del día, con la probabilidad justa para que salgan en promedio `porDia`: un Vocaloid al
   * azar desafía a un Papu que escribió hace poco, al que le alcanza la apuesta y que no desafiaron hace poco.
   */
  async houseTick(now = Date.now()): Promise<boolean> {
    const b = this.s.settings.bots;
    const tz = this.d.timeZone;
    const bots = this.d.houseBots?.() ?? [];
    const rnd = this.d.rnd ?? Math.random;
    if (!b?.activo || !tz || !bots.length || this.s.active()) return false;
    const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
    if (!enVentana(b, hora)) return false;
    const recientes = this.s.houseChallengesSince(now - Math.max(26, b.esperaPapuHoras) * 3_600_000);
    const hoy = dayKey(new Date(now), tz);
    if (recientes.filter((r) => dayKey(new Date(r.creadaAt), tz) === hoy).length >= b.porDia) return false;
    if (recientes[0] && now - recientes[0].creadaAt < b.esperaMinutos * 60_000) return false;
    if (rnd() >= chancePorMinuto(b)) return false;
    const apuesta = this.s.houseBet();
    const recienDesafiados = new Set(recientes.filter((r) => now - r.creadaAt < b.esperaPapuHoras * 3_600_000).map((r) => r.rival));
    const candidatos = [...this.lastSeen]
      .filter(([id, t]) => now - t <= b.activoMinutos * 60_000 && !recienDesafiados.has(id) && !this.d.botOf?.(id) && this.s.coinsOf(id) >= apuesta)
      .map(([id]) => id);
    if (!candidatos.length) return false;
    const rival = candidatos[Math.floor(rnd() * candidatos.length)]!;
    const botUser = bots[Math.floor(rnd() * bots.length)]!;
    const bot = this.d.botOf?.(botUser);
    if (!bot) return false;
    const channel = findTextChannel(this.d.guild(), b.canal, b.respaldo);
    if (!channel) return false;
    const member = await this.d.guild().members.fetch(rival).catch(() => null);
    if (!member || member.user.bot) return false;
    const res = this.s.challengeHouse(botUser, rival, channel.id);
    if (!res.ok) return false;
    const x = res.duelo;
    try {
      await this.publishChallenge(x, channel.id);
    } catch (e) {
      this.s.cancel();
      logError("ruleta de Némesis (desafío de un Vocaloid)", e);
      return false;
    }
    this.d.log(`🔫 Ruleta de Némesis: ${bot} desafía a ${member.user.username} por ${x.apuesta} (racha de la casa ${this.s.houseStreak()})`);
    return true;
  }

  /** Publica el banner del desafío con sus botones y arma el vencimiento. */
  private async publishChallenge(x: Duelo, channelId: string): Promise<void> {
    const jugadores = await Promise.all([this.jugador(x.retador), this.jugador(x.rival)]);
    const { tajada, premio } = reparto(this.s.settings, x.apuesta);
    const membresia = x.casa ? undefined : this.d.membresia?.(this.d.guild().members.cache.get(x.retador)?.roles.cache.map((r) => r.name) ?? []);
    const png = await bannerImage({ retador: jugadores[0], rival: jugadores[1], apuesta: x.apuesta, premio, tajada, recamaras: this.s.settings.recamaras, membresia });
    const ch = await this.send(x, channelId);
    const msg = await ch.send({
      content: this.challengeText(x),
      files: [new AttachmentBuilder(png, { name: "ruleta-de-nemesis.png" })],
      components: [this.challengeButtons(x)],
      allowedMentions: { users: [x.rival] },
    });
    this.s.setMessage(x.id, channelId, msg.id);
    if (this.expireTimer) clearTimeout(this.expireTimer);
    this.expireTimer = setTimeout(() => void this.tick().catch((e) => logError("ruleta de Némesis (vencer)", e)), Math.max(0, x.venceAt - Date.now()) + 500);
  }

  /** Agrega una línea al mensaje del desafío y a la mesa (y les quita los botones). */
  private async annotate(x: Duelo, text: string): Promise<void> {
    if (!x.canal) return;
    const ch = await this.send(x, x.canal).catch(() => null);
    if (!ch || !("messages" in ch)) return;
    for (const id of [x.mensaje, x.mesa]) {
      if (!id) continue;
      const msg = await ch.messages.fetch(id).catch(() => null);
      await msg?.edit({ content: `${msg.content}\n\n${text}`.slice(0, 2000), components: [] }).catch(() => {});
    }
  }

  // ───────────────────────── /nemesis ─────────────────────────

  async nemesis(i: ChatInputCommandInteraction): Promise<void> {
    if (i.options.getBoolean("cancelar")) return this.cancel(i);
    const rival = i.options.getUser("rival");
    const apuesta = i.options.getInteger("apuesta");
    const { minima, maxima } = this.s.settings.apuesta;
    if (!rival || apuesta === null) {
      return void (await i.reply({ content: `Elige a tu \`rival\` y cuánto pone cada uno en \`apuesta\` (de ${minima} a ${fmt(maxima)} Shaulitas). 🔫`, flags: MessageFlags.Ephemeral }));
    }
    if (rival.bot) return void (await i.reply({ content: "Los Vocaloids no juegan a la ruleta. Desafía a un Papu. 🔫", flags: MessageFlags.Ephemeral }));
    const member = await this.d.guild().members.fetch(rival.id).catch(() => null);
    if (!member) return void (await i.reply({ content: "Ese Papu no está en el servidor.", flags: MessageFlags.Ephemeral }));
    // En el canal donde se usa el comando (pedido de GyroP, 12 nov. 2026); si Teto no puede escribir ahí, en #casino.
    const here = await this.d.sendable(i.channelId).then(() => ({ id: i.channelId }), () => null);
    const channel = here ?? findTextChannel(this.d.guild(), this.s.settings.canal, this.s.settings.respaldo);
    if (!channel) return void (await i.reply({ content: "No puedo escribir en este canal. Usa el comando en otro. 🙈", flags: MessageFlags.Ephemeral }));
    const res = this.s.challenge(i.user.id, rival.id, apuesta, channel.id);
    if (!res.ok) return void (await i.reply({ content: `❌ ${res.motivo}`, flags: MessageFlags.Ephemeral }));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const x = res.duelo;
    try {
      await this.publishChallenge(x, channel.id);
    } catch (e) {
      // Sin el mensaje no se puede aceptar: se cancela y se devuelve la apuesta.
      this.s.cancel();
      await i.editReply("No pude publicar el desafío. Te devolví tu apuesta. 🙏");
      throw e;
    }
    await i.editReply(`🔫 ¡Desafío enviado en <#${channel.id}>! Puse tus ${fmt(x.apuesta)} Shaulitas en la mesa: si <@${x.rival}> no acepta, te las devuelvo.`);
    this.d.log(`🔫 Ruleta de Némesis: ${i.user.username} desafía a ${rival.username} por ${x.apuesta}`);
  }

  private async cancel(i: ChatInputCommandInteraction): Promise<void> {
    const owner = this.d.owners.has(i.user.id);
    if (!owner && !(await this.d.isStaff?.(i.user.id))) return void (await i.reply({ content: "¡Cancelarla solo lo hacen GyroP y los Mods! 🥖", flags: MessageFlags.Ephemeral }));
    const res = this.s.cancel();
    if (!res) return void (await i.reply({ content: "No hay ninguna Ruleta de Némesis en curso.", flags: MessageFlags.Ephemeral }));
    this.clearTimers();
    this.mesa = null;
    await this.annotate(res.duelo, `🚫 ${owner ? "GyroP" : "Un Mod"} canceló esta ruleta: le devolví a cada uno lo que puso.`);
    await i.reply({ content: `🚫 Ruleta cancelada: devolví ${fmt(res.devuelto)} Shaulitas.`, flags: MessageFlags.Ephemeral });
  }

  private challengeText(x: Duelo): string {
    const { tajada, premio } = reparto(this.s.settings, x.apuesta);
    const reto = this.d.phrases.pick("nemesis", "nemesis_reto", { de: `<@${x.retador}>`, papu: `<@${x.rival}>`, monedas: fmt(x.apuesta) });
    if (x.casa) {
      const racha = this.s.houseStreak();
      return [
        `🔫 <@${x.rival}>, <@${x.retador}> te desafía a la **Ruleta de Némesis**.`,
        `> ${reto}`,
        racha > 0
          ? `🔥 Los Vocaloids llevan **${racha}** ${racha === 1 ? "victoria seguida" : "victorias seguidas"}: por eso la apuesta subió a **${fmt(x.apuesta)}** Shaulitas.`
          : `🎲 La apuesta de los Vocaloids está en **${fmt(x.apuesta)}** Shaulitas: cada vez que uno gana, sube para el siguiente Papu.`,
        `💰 Tú pones **${fmt(x.apuesta)}**; ${this.botName(x.retador)} juega por la casa. Una bala, ${this.s.settings.recamaras} recámaras: si sobrevives te llevas **${fmt(premio)}** (Némesis cobra ${fmt(tajada)}); si caes, pierdes lo que pusiste. Rechazar no cuesta nada.`,
        `⏳ Tienes hasta <t:${unix(x.venceAt)}:R> para aceptar.`,
      ].join("\n");
    }
    return [
      `🔫 <@${x.rival}>, te desafían a la **Ruleta de Némesis**.`,
      `> ${reto}`,
      `💰 Cada uno pone **${fmt(x.apuesta)}** Shaulitas. Una bala, ${this.s.settings.recamaras} recámaras, se turnan para jalar el gatillo: el que sobreviva se lleva **${fmt(premio)}** (Némesis cobra ${fmt(tajada)} de la apuesta del que cae).`,
      `⏳ Tienes hasta <t:${unix(x.venceAt)}:R> para aceptar.`,
    ].join("\n");
  }

  private challengeButtons(x: Duelo): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}ok:${x.id}`).setLabel("Aceptar el desafío").setEmoji("🔫").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}no:${x.id}`).setLabel("Rechazar").setStyle(ButtonStyle.Secondary),
    );
  }

  /** Nombre de un Vocaloid para el texto (su apodo en el servidor). */
  private botName(userId: string): string {
    const mb = this.d.guild().members.cache.get(userId);
    return `**${stripNickTag(mb?.displayName ?? this.d.botOf?.(userId) ?? "el Vocaloid")}**`;
  }

  /** ¿Le toca jalar a un Vocaloid? (desafío de la casa, turno del retador). */
  private botTurn(x: Duelo): boolean {
    return x.casa && this.s.shooter(x) === x.retador;
  }

  /** Nombre y avatar de un Papu (para las imágenes). */
  private async jugador(userId: string): Promise<Jugador> {
    const mb = await this.d.guild().members.fetch(userId).catch(() => null);
    const avatar = mb
      ? await fetch(mb.displayAvatarURL({ extension: "png", size: 256 }))
          .then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null))
          .catch(() => null)
      : null;
    return { name: stripNickTag(mb?.displayName ?? "Papu"), avatar };
  }

  private async expired(x: Duelo): Promise<void> {
    this.expireTimer = null;
    await this.annotate(x, x.casa ? `⌛ <@${x.rival}> no aceptó a tiempo. La apuesta de los Vocaloids sigue en ${fmt(x.apuesta)} Shaulitas.` : `⌛ <@${x.rival}> no aceptó a tiempo. Le devolví sus ${fmt(x.apuesta)} Shaulitas a <@${x.retador}>.`);
  }

  // ───────────────────────── botones ─────────────────────────

  /** Botones de la ruleta. Devuelve false si el botón no es de aquí. */
  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(PREFIX)) return false;
    const [, action, id, turno] = i.customId.split(":") as [string, string, string, string | undefined];
    if (action === "ok") {
      const res = this.s.accept(id, i.user.id);
      if (!res.ok) return void (await i.reply({ content: `❌ ${res.motivo}`, flags: MessageFlags.Ephemeral })), true;
      if (this.expireTimer) clearTimeout(this.expireTimer);
      this.expireTimer = null;
      await i.update({ content: `${i.message.content}\n\n✅ <@${i.user.id}> aceptó. Némesis carga el revólver… 🔫`.slice(0, 2000), components: [], allowedMentions: { parse: [] } });
      await this.open(res.duelo).catch((e) => logError("ruleta de Némesis (mesa)", e));
      return true;
    }
    if (action === "no") {
      const res = this.s.reject(id, i.user.id);
      if (!res.ok) return void (await i.reply({ content: `❌ ${res.motivo}`, flags: MessageFlags.Ephemeral })), true;
      if (this.expireTimer) clearTimeout(this.expireTimer);
      this.expireTimer = null;
      const x = res.duelo;
      const line = res.retirado ? `↩️ <@${x.retador}> retiró el desafío.` : `🙅 <@${x.rival}> rechazó el desafío.`;
      const tail = x.casa ? `No perdió nada; la apuesta de los Vocaloids sigue en ${fmt(x.apuesta)} Shaulitas.` : `Le devolví sus ${fmt(x.apuesta)} Shaulitas a <@${x.retador}>.`;
      await i.update({ content: `${i.message.content}\n\n${line} ${tail}`.slice(0, 2000), components: [], allowedMentions: { parse: [] } });
      return true;
    }
    if (action === "g" && turno !== undefined) {
      if (this.busy) return void (await i.reply({ content: "Espera: el tambor todavía está girando. 🔫", flags: MessageFlags.Ephemeral })), true;
      const res = this.s.pull(id, Number(turno), i.user.id);
      if (!res.ok) return void (await i.reply({ content: `❌ ${res.motivo}`, flags: MessageFlags.Ephemeral })), true;
      await i.deferUpdate().catch(() => {});
      await this.shot(res.disparo).catch((e) => logError("ruleta de Némesis (disparo)", e));
      return true;
    }
    return false;
  }

  // ───────────────────────── la mesa ─────────────────────────

  private header(x: Duelo): string {
    return `🔫 **Ruleta de Némesis** · <@${x.retador}> vs <@${x.rival}> · 🪙 ${fmt(x.apuesta)}${x.casa ? " (la casa no pone)" : " cada uno"}`;
  }

  private turnText(x: Duelo, lines: string[]): string {
    const who = this.s.shooter(x);
    const left = this.s.settings.recamaras - x.turno;
    const limit = unix(Date.now() + this.s.settings.turnoSegundos * 1000);
    return [
      this.header(x),
      ...lines,
      this.botTurn(x)
        ? `👉 **Turno ${x.turno + 1}** (bala: 1 de ${left}): le toca a <@${who}>, que ya toma el revólver…`
        : `👉 **Turno ${x.turno + 1}** (bala: 1 de ${left}): <@${who}>, jala el gatillo <t:${limit}:R>. Si no, Némesis jala por ti.`,
    ]
      .join("\n")
      .slice(0, 2000);
  }

  private trigger(x: Duelo): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}g:${x.id}:${x.turno}`).setLabel("Jalar el gatillo").setEmoji("🔫").setStyle(ButtonStyle.Danger),
    );
  }

  private mesaData(x: Duelo, jugadores: [Jugador, Jugador], turno = x.turno) {
    const shooter = this.s.shooter({ ...x, turno }) === x.retador ? (0 as const) : (1 as const);
    return { retador: jugadores[0], rival: jugadores[1], shooter, turno, recamaras: this.s.settings.recamaras };
  }

  /** Abre la mesa (aceptó el desafío): primer turno, etiquetando a los dos. */
  private async open(x: Duelo): Promise<void> {
    if (!x.canal) return;
    const jugadores = (await Promise.all([this.jugador(x.retador), this.jugador(x.rival)])) as [Jugador, Jugador];
    const png = await turnImage(this.mesaData(x, jugadores));
    const ch = await this.send(x, x.canal);
    const msg = await ch.send({
      content: this.turnText(x, []),
      files: [new AttachmentBuilder(png, { name: "mesa.png" })],
      components: this.botTurn(x) ? [] : [this.trigger(x)],
      allowedMentions: { users: [x.retador, x.rival] },
    });
    this.s.setMesa(x.id, msg.id);
    this.mesa = { id: x.id, msg, lines: [], jugadores };
    this.armTurn(x);
  }

  /** Si no jala en `turnoSegundos`, jala Némesis. Si le toca a un Vocaloid, jala él solo a los `botSegundos`. */
  private armTurn(x: Duelo): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    const bot = this.botTurn(x);
    this.turnTimer = setTimeout(
      () => {
        this.turnTimer = null;
        if (this.stopped || this.busy) return;
        const res = this.s.pull(x.id, x.turno, bot ? x.retador : null);
        if (res.ok) void this.shot(res.disparo).catch((e) => logError("ruleta de Némesis (disparo de Némesis)", e));
      },
      (bot ? (this.s.settings.bots?.botSegundos ?? 4) : this.s.settings.turnoSegundos) * 1000,
    );
  }

  /** Muestra un disparo (GIF) y sigue con el turno siguiente o con el final. */
  private async shot(dp: Disparo): Promise<void> {
    const m = this.mesa;
    if (!m || m.id !== dp.duelo.id) return;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.busy = true;
    try {
      const x = dp.duelo;
      const gif = await shotGif(this.mesaData(x, m.jugadores, dp.turno), dp.bang);
      const papu = `<@${dp.quien}>`;
      const phrase = this.d.phrases.pick("nemesis", dp.bang ? "nemesis_bang" : "nemesis_click", { papu });
      const pct = Math.round(chanceAt(this.s.settings, dp.turno) * 100);
      m.lines.push(`**${dp.turno + 1}.** ${dp.bang ? "💥" : "😮‍💨"} ${phrase}${dp.auto ? " *(se le acabó el tiempo: jaló Némesis)*" : ""} · ${pct} % de bala`);
      await m.msg
        .edit({ content: [this.header(x), ...m.lines].join("\n").slice(0, 2000), files: [new AttachmentBuilder(gif, { name: "disparo.gif" })], attachments: [], components: [], allowedMentions: { parse: [] } })
        .catch((e) => logError("ruleta de Némesis (GIF)", e));
      await sleep(shotGifMs(dp.bang) + this.s.settings.pausaMs);
      if (this.stopped) return;
      if (dp.bang) {
        this.mesa = null;
        await this.final(x, m.jugadores);
        return;
      }
      const png = await turnImage(this.mesaData(x, m.jugadores));
      await m.msg
        .edit({ content: this.turnText(x, m.lines), files: [new AttachmentBuilder(png, { name: "mesa.png" })], attachments: [], components: this.botTurn(x) ? [] : [this.trigger(x)], allowedMentions: { parse: [] } })
        .catch((e) => logError("ruleta de Némesis (turno)", e));
      this.armTurn(x);
    } finally {
      this.busy = false;
    }
  }

  /** El final: GIF del ganador con las monedas cayendo, la frase de Némesis y el pago. */
  private async final(x: Duelo, jugadores: [Jugador, Jugador]): Promise<void> {
    if (!x.canal || !x.ganador) return;
    const gana = x.ganador === x.retador ? 0 : 1;
    const pierde = (1 - gana) as 0 | 1;
    const ids = [x.retador, x.rival];
    const gif = await resultGif({
      winner: { name: jugadores[gana].name, color: "#4dff7a", avatar: await avatarPng(jugadores[gana]) },
      loser: { name: jugadores[pierde].name, color: "#8a8a96", avatar: await avatarPng(jugadores[pierde]) },
      subtitle: `sobrevivió a la Ruleta de Némesis en el turno ${x.turno + 1}`,
      seed: Date.now() % 1_000_000,
    });
    const premio = x.premio ?? 0;
    const tajada = x.tajada ?? 0;
    const casaGana = x.casa && gana === 0;
    const pago = x.casa
      ? casaGana
        ? `🪙 <@${ids[pierde]}> pierde sus ${fmt(x.apuesta)} Shaulitas. Racha de los Vocaloids: **${this.s.houseStreak()}**; el próximo Papu que desafíen se juega **${fmt(this.s.houseBet())}**.`
        : `🪙 <@${ids[gana]}> recupera sus ${fmt(x.apuesta)} y le gana ${fmt(premio - x.apuesta)} a la casa (Némesis cobra ${fmt(tajada)}). Se cortó la racha de los Vocaloids: la apuesta vuelve a **${fmt(apuestaCasa(this.s.settings, 0))}**.`
      : `🪙 <@${ids[gana]}> recupera sus ${fmt(x.apuesta)} y gana ${fmt(premio - x.apuesta)} de <@${ids[pierde]}>, que pierde ${fmt(x.apuesta)}. Némesis se queda con ${fmt(tajada)}.`;
    const content = [
      `🏆 ${this.d.phrases.pick("nemesis", "nemesis_ganador", { papu: `<@${ids[gana]}>`, monedas: fmt(casaGana ? x.apuesta : premio) })}`,
      pago,
      "-# ¿Te atreves? Desafía a otro Papu con `/nemesis`.",
    ].join("\n");
    const ch = await this.send(x, x.canal);
    await ch.send({ content, files: [new AttachmentBuilder(gif, { name: "ganador.gif" })], allowedMentions: { parse: [] } });
    await this.d.report(
      x.casa
        ? `🔫 Ruleta de Némesis (desafío de un Vocaloid): <@${ids[gana]}> le ganó a <@${ids[pierde]}> en el turno ${x.turno + 1}. Apuesta ${fmt(x.apuesta)} · ${casaGana ? "el Papu la perdió" : `pagado ${fmt(premio)} · tajada ${fmt(tajada)}`} · racha de la casa ${this.s.houseStreak()}.`
        : `🔫 Ruleta de Némesis: <@${ids[gana]}> le ganó a <@${ids[pierde]}> en el turno ${x.turno + 1}. Apuesta ${fmt(x.apuesta)} c/u · pagado ${fmt(premio)} · tajada ${fmt(tajada)}.`,
    );
    this.d.log(`🔫 Ruleta de Némesis: ganó ${jugadores[gana].name} (turno ${x.turno + 1}, apuesta ${x.apuesta})`);
    this.d.ambient?.({
      tipo: "nemesis",
      situacion: `En la Ruleta de Némesis (un juego de azar de mentira con Shaulitas, nadie sale herido), ${jugadores[gana].name} le ganó a ${jugadores[pierde].name} en el turno ${x.turno + 1} y se llevó su apuesta de ${fmt(x.apuesta)} Shaulitas.`,
      bots: [],
      comenta: "otro",
    });
  }
}
