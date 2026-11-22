// Carreras de los Vocaloids en Discord (PLAN §3.14). Teto publica el banner «¡Se abren las apuestas!» con el tablero en
// vivo (cuotas de las apuestas mutuas) y tres botones: Ganador, Segundo y Tercero; cada uno abre una ventanita para
// elegir al Vocaloid y el monto (se pueden comprar varios boletos). Al cerrar, la carrera se ve en una pista vertical
// de emojis que se edita cada turno, y al final sale el podio con los pagos de cada bolsa y lo que cobró cada Papu.
// Carreras automáticas a horas al azar (config/carreras.json) y /carrera de GyroP, los Mods y las membresías.
import { existsSync, readFileSync } from "node:fs";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type ModalSubmitInteraction,
  type SendableChannels,
} from "discord.js";
import type { AmbientEvent } from "../ambiente/service";
import { bannerApuestas, bannerPodio, repartirApostadores, VERSIONES_APUESTAS, type Apostador, type PodioCorredor } from "../carreras/images";
import { elegirCorredores, EMOJI_TIPO, filaDe, NOMBRE_TIPO, TIPOS, type Tipo } from "../carreras/rules";
import type { Carrera, CarreraService, Liquidacion } from "../carreras/service";
import { weekStart } from "../coins/rules";
import { BOT_IDS, type BotId } from "../config";
import { logError, type LogFn } from "../log";
import { marcoDe } from "../membresias/marco";
import { viaLanzamiento, type LanzarPort } from "../membresias/service";
import { avatarFile } from "../peleas/images";
import type { Phrases } from "../phrases/catalog";
import { colorKey } from "../setup/color-menu";
import { dayKey } from "../time";
import type { Lanzador } from "./peleas";
import { findTextChannel } from "./channels";

const PREFIX = "carrera:";
/** Cada cuánto, como mucho, se actualizan el tablero del banner y la ventanilla. */
const BOARD_EVERY_MS = 5000;
/** Cuánto antes del cierre se etiqueta otra vez a los 🏇 Burreros. */
const LAST_CALL_MS = 15_000;
const MAX_COBROS = 20;
/** Boletos que se ven en la ventanilla (los más nuevos). */
const VENTANILLA = 10;
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
const fmtCuota = (n: number) => `×${n.toFixed(2).replace(".", ",")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LUGAR = ["1.º", "2.º", "3.º", "4.º", "5.º", "6.º", "7.º", "8.º"];

export interface CarrerasDiscordDeps {
  carreras: CarreraService;
  phrases: Phrases;
  /** Nombre y color (#RRGGBB) de un corredor: el del motor (Vocaloids) o el de config/peleas.json (invitados). */
  info: (id: string) => { nombre: string; color: string };
  /** Emoji de la cara de un corredor por su nombre (del servidor o de la aplicación de Teto): "<:x:id>" o null. */
  emoji: (name: string) => string | null;
  /** Nombre, icono y membresía de los Papus que apostaron (para el podio). Sin esto, salen sin icono. */
  papus?: (ids: string[]) => Promise<Map<string, Apostador>>;
  /** Papus de honor (rol 🏅) para llenar las vallas del podio. */
  honor?: () => Promise<Apostador[]>;
  /** ¿Hay una pelea en curso? (comparten el canal: una carrera nunca sale durante una pelea). */
  peleaActiva?: () => boolean;
  /** Ambiente casual (PLAN §3.13): un Vocaloid que corrió comenta la carrera en #general. */
  ambient?: (e: AmbientEvent) => void;
  /**
   * Pique entre Vocaloids por la carrera (pedido de GyroP, 16 nov. 2026): el que le fue mejor provoca al que le fue
   * peor en #general (minidrama si queda cupo del día). Devuelve false si no se pudo.
   */
  pique?: (bot: BotId, target: BotId, situacion: string) => Promise<boolean>;
  /** Vocaloids conectados (para el pique). */
  online?: () => readonly BotId[];
  owners: ReadonlySet<string>;
  isStaff?: (userId: string) => Promise<boolean>;
  lanzar?: LanzarPort;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  timeZone: string;
  log: LogFn;
  rnd?: () => number;
}

export class CarrerasDiscord {
  private banner: Message | null = null;
  /** «🎟️ Ventanilla» bajo el banner: los últimos boletos, a la vista de todos (pedido de GyroP, 16 nov. 2026). */
  private ventanilla: Message | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCallTimer: ReturnType<typeof setTimeout> | null = null;
  private boardTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private busy = false;
  /** Frase de Teto y mención del aviso del banner de la carrera en curso (las ediciones las conservan). */
  private head: { id: string; text: string; ping?: string } | null = null;
  private lanzador: (Lanzador & { carrera: string }) | null = null;

  constructor(private readonly d: CarrerasDiscordDeps) {}

  private get s(): CarreraService {
    return this.d.carreras;
  }

  private get rnd(): () => number {
    return this.d.rnd ?? Math.random;
  }

  private name(id: string): string {
    return this.d.info(id).nombre;
  }

  /** Cara del corredor (su emoji) o, si falta, un caballito. */
  private face(id: string): string {
    return this.d.emoji(this.s.settings.corredores[id]?.emoji ?? id) ?? "🏇";
  }

  /** Corredores que pueden correr: los de la config con avatar (para las imágenes) y emoji (para la pista). */
  private runners(): string[] {
    return this.s.ids.filter((id) => existsSync(avatarFile(id)) && !!this.d.emoji(this.s.settings.corredores[id]!.emoji));
  }

  /** Rol 🏇 de los avisos (config/carreras.json → rolAviso), si existe. */
  private ping(): { mention: string; roleId: string } | null {
    const key = colorKey(this.s.settings.rolAviso);
    const role = this.d.guild().roles.cache.find((r) => !r.managed && colorKey(r.name) === key);
    return role ? { mention: `<@&${role.id}>`, roleId: role.id } : null;
  }

  // ───────────────────────── arranque y horario ─────────────────────────

  /** Al conectar: devuelve lo apostado en carreras que quedaron a medias (reinicio) y lo avisa en su banner. */
  async start(): Promise<void> {
    for (const { carrera, devueltos } of this.s.recover()) {
      const total = devueltos.reduce((a, b) => a + b.cantidad, 0);
      if (carrera.canal && carrera.mensaje) {
        const ch = await this.d.sendable("teto", carrera.canal).catch(() => null);
        const msg = ch && "messages" in ch ? await ch.messages.fetch(carrera.mensaje).catch(() => null) : null;
        await msg?.edit({ content: `${msg.content}\n\n⚠️ Esta carrera se canceló (me reinicié a la mitad). Le devolví a cada Papu lo que apostó.`, components: [] }).catch(() => {});
      }
      await this.d.report(`🏇 Carrera cancelada por reinicio: devolví ${fmt(total)} Shaulitas (${devueltos.length} boletos).`);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of [this.closeTimer, this.lastCallTimer, this.boardTimer]) if (t) clearTimeout(t);
  }

  /** Cada minuto: si toca una carrera automática y hay Papus en #general, la abre. */
  async tick(now = Date.now()): Promise<void> {
    if (this.stopped || this.busy || !this.s.settings.porDia) return;
    const slot = this.s.dueSlot(now);
    if (slot === null) return;
    this.busy = true;
    try {
      this.s.useSlot(slot);
      if (this.d.peleaActiva?.()) return void this.d.log("🏇 Hora de carrera durante una pelea: esta vez se pierde");
      if (!(await this.someoneAround())) return void this.d.log("🏇 Hora de carrera sin Papus en #general: esta vez se pierde");
      const ch = findTextChannel(this.d.guild(), this.s.settings.canal, this.s.settings.respaldo);
      if (!ch) return void (await this.d.report(`🏇 No encontré #${this.s.settings.canal} (ni #${this.s.settings.respaldo}) para la carrera.`));
      await this.launch(ch.id);
    } finally {
      this.busy = false;
    }
  }

  private async someoneAround(): Promise<boolean> {
    const ch = findTextChannel(this.d.guild(), "general");
    if (!ch) return false;
    const since = Date.now() - this.s.settings.actividadMinutos * 60_000;
    const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
    return !!msgs?.some((m) => !m.author.bot && m.createdTimestamp >= since);
  }

  // ───────────────────────── /carrera ─────────────────────────

  async carrera(i: ChatInputCommandInteraction): Promise<void> {
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const owner = this.d.owners.has(i.user.id);
    const staff = owner || !!(await this.d.isStaff?.(i.user.id));
    if (i.options.getBoolean("cancelar")) {
      if (!staff) return void (await reply("Cancelar carreras es solo de GyroP y los Mods. 🥖"));
      const res = this.s.cancel();
      if (!res) return void (await reply("No hay ninguna carrera en curso."));
      this.stop();
      this.stopped = false;
      await this.banner?.edit({ content: `${this.banner.content}\n\n🚫 ${owner ? "GyroP" : "Un Mod"} canceló esta carrera: le devolví a cada Papu lo que apostó.`, components: [] }).catch(() => {});
      this.banner = null;
      const total = res.devueltos.reduce((a, b) => a + b.cantidad, 0);
      return void (await reply(`🚫 Carrera cancelada: devolví ${fmt(total)} Shaulitas (${res.devueltos.length} boletos).`));
    }
    if (this.s.active()) return void (await reply("Ya hay una carrera en curso: espera a que termine. 🏇"));
    if (this.d.peleaActiva?.()) return void (await reply("Hay una pelea en curso en el canal: espera a que termine. ⚔️"));
    const ch = findTextChannel(this.d.guild(), this.s.settings.canal, this.s.settings.respaldo);
    if (!ch) return void (await reply(`No encontré #${this.s.settings.canal}.`));
    if (staff) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const ok = await this.launch(ch.id).catch((e) => (logError("carrera", e), false));
      return void (await i.editReply({ content: ok ? `🏇 ¡Carrera lanzada en <#${ch.id}>!` : "No pude lanzarla (¿ya hay otra en curso?)." }));
    }
    // Membresías (PLAN §2): 1 a 3 carreras al día, siempre con corredores al azar.
    const l = this.d.lanzar;
    if (!l) return void (await reply("¡Eso solo lo usan GyroP y los Mods! 🥖"));
    const n = await l.nivel(i.user.id);
    const day = dayKey(new Date(), this.d.timeZone);
    const via = viaLanzamiento(l, n, 0, i.user.id, "carrera", day, weekStart(day));
    if (!via || via.via !== "membresia") {
      const dia = n?.carreras?.dia ?? 0;
      return void (await reply(
        dia ? `Ya lanzaste tus **${dia}** ${dia === 1 ? "carrera" : "carreras"} de hoy. ¡Mañana hay más! 🏇` : "Lanzar carreras es un beneficio de las **membresías** de Ko-fi. Mira #💎・membresías. 🏇",
      ));
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    l.membresias.anotarLanzamiento(i.user.id, via.key, via.day);
    const ok = await this.launch(ch.id, { userId: i.user.id, nivel: n, prestigio: false }).catch((e) => (logError("carrera lanzada", e), false));
    if (!ok) l.membresias.devolverLanzamiento(i.user.id, via.key, via.day);
    await i.editReply({ content: ok ? `🏇 ¡Lanzaste una carrera en <#${ch.id}>! Los corredores salen al azar.` : "No pude lanzarla (¿ya hay otra en curso?). No se te descontó." });
  }

  // ───────────────────────── banner, tablero y apuestas ─────────────────────────

  /** Tablero corto (pedido de GyroP: mucho texto): cada corredor con su cara y su cuota de Ganador en vivo, de a dos. */
  private board(c: Carrera): string {
    const vivo = this.s.enVivo(c);
    const celdas = c.corredores.map((id, k) => `${this.face(id)} **${this.name(id)}** ${fmtCuota(vivo.ganador[k]!)}`);
    const filas: string[] = [];
    for (let k = 0; k < celdas.length; k += 2) filas.push(celdas.slice(k, k + 2).join("   "));
    return filas.join("\n");
  }

  private bannerText(c: Carrera, open: boolean, ping?: string): string {
    if (this.head?.id !== c.id) {
      const nombres = c.corredores.map((id) => `**${this.name(id)}**`);
      const texto = `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
      this.head = { id: c.id, text: this.d.phrases.pick("teto", "carrera_anuncio", { texto }), ping };
    }
    const por = this.lanzador?.carrera === c.id ? this.lanzador : null;
    const lanzada = por ? `\n🎟️ Carrera lanzada por <@${por.userId}>${por.nivel ? ` · ${por.nivel.emoji} ${por.nivel.nombre}` : ""}` : "";
    const head = (this.head.ping ? `🔔 ${this.head.ping}\n${this.head.text}` : this.head.text) + lanzada;
    const reglas = open ? `🥇 llega 1.º · 🥈 1.º o 2.º · 🥉 al podio · cierra <t:${Math.floor(c.cierraAt / 1000)}:R>` : "🔒 **Apuestas cerradas**: ¡largan!";
    let text = [head, reglas, "", this.board(c)].join("\n");
    if (text.length > 1990) text = `${text.slice(0, 1985)}…`;
    return text;
  }

  private buttons(c: Carrera, open: boolean): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const t of TIPOS)
      row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}t:${c.id}:${t}`).setLabel(NOMBRE_TIPO[t]).setEmoji(EMOJI_TIPO[t]).setStyle(t === "ganador" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!open));
    row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}mis:${c.id}`).setLabel("Mis boletos").setEmoji("🎟️").setStyle(ButtonStyle.Secondary));
    return row;
  }

  /** Abre una carrera en `channelId` con corredores al azar. `por` = el Papu que la lanzó con su membresía. */
  async launch(channelId: string, por?: Lanzador): Promise<boolean> {
    const ids = this.runners();
    if (ids.length < this.s.settings.corredoresPorCarrera) {
      await this.d.report(`🏇 No hay corredores suficientes con emoji y avatar (${ids.length}): revisa los emojis de la aplicación de Teto.`);
      return false;
    }
    const grupo = elegirCorredores(ids, this.s.settings.corredoresPorCarrera, this.s.lastGroup(), this.rnd);
    const c = this.s.open(grupo, channelId, por?.userId ?? null);
    if (!c) return false;
    this.lanzador = por ? { ...por, carrera: c.id } : null;
    try {
      const corredores = c.corredores.map((id) => ({ nombre: this.name(id), color: this.d.info(id).color, avatar: readFileSync(avatarFile(id)) }));
      const version = VERSIONES_APUESTAS[Math.floor(this.rnd() * VERSIONES_APUESTAS.length)]!;
      const hora = new Intl.DateTimeFormat("es-MX", { timeZone: this.s.settings.horario.zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
      const png = await bannerApuestas({ version, corredores, hora, minutos: this.s.settings.apuestas.minutos, membresia: marcoDe(por?.nivel) });
      const ch = await this.d.sendable("teto", channelId);
      const ping = this.ping();
      this.banner = await ch.send({
        content: this.bannerText(c, true, ping?.mention),
        files: [new AttachmentBuilder(png, { name: "carrera.png" })],
        components: [this.buttons(c, true)],
        allowedMentions: ping ? { roles: [ping.roleId] } : { parse: [] },
      });
      this.s.setMessage(c.id, channelId, this.banner.id);
      this.ventanilla = await ch.send({ content: this.ventanillaText(c), allowedMentions: { parse: [] } }).catch((e) => (logError("ventanilla de la carrera", e), null));
    } catch (e) {
      // Sin banner no se puede apostar: se cancela (todavía no hay boletos que devolver).
      this.s.cancel();
      throw e;
    }
    this.d.log(`🏇 Carrera abierta: ${c.corredores.map((id) => this.name(id)).join(", ")}`);
    this.closeTimer = setTimeout(() => void this.run(c.id).catch((e) => logError("carrera", e)), Math.max(0, c.cierraAt - Date.now()));
    const lastCall = c.cierraAt - Date.now() - LAST_CALL_MS;
    if (lastCall > 0) this.lastCallTimer = setTimeout(() => void this.lastCall(c.id).catch((e) => logError("último aviso de la carrera", e)), lastCall);
    return true;
  }

  private async lastCall(id: string): Promise<void> {
    this.lastCallTimer = null;
    const c = this.s.get(id);
    if (this.stopped || !c || c.estado !== "abierta" || !c.canal || !this.banner) return;
    const ping = this.ping();
    if (!ping) return;
    const ch = await this.d.sendable("teto", c.canal);
    await ch.send({
      content: `🔔 ${ping.mention} ¡Quedan **${LAST_CALL_MS / 1000} segundos** para apostar en la carrera! ⏳🏇`,
      reply: { messageReference: this.banner.id, failIfNotExists: false },
      allowedMentions: { roles: [ping.roleId], repliedUser: false },
    });
  }

  private refreshBoard(id: string): void {
    if (this.boardTimer) return;
    this.boardTimer = setTimeout(() => {
      this.boardTimer = null;
      const c = this.s.get(id);
      if (!c || c.estado !== "abierta" || !this.banner) return;
      void this.banner.edit({ content: this.bannerText(c, true) }).catch((e) => logError("tablero de la carrera", e));
      void this.ventanilla?.edit({ content: this.ventanillaText(c) }).catch((e) => logError("ventanilla de la carrera", e));
    }, BOARD_EVERY_MS);
  }

  /** Emoji del corredor para el menú de la ventanita ({ id, name } si es personalizado). */
  private optionEmoji(id: string): { id: string; name: string } | string {
    const m = this.face(id).match(/^<a?:(\w+):(\d+)>$/);
    return m ? { id: m[2]!, name: m[1]! } : this.face(id);
  }

  /** Botones del banner. Devuelve false si no es de aquí. */
  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(PREFIX)) return false;
    const [, action, id, tipo] = i.customId.split(":") as [string, string, string, Tipo | undefined];
    const c = this.s.get(id);
    if (action === "mis") {
      await i.reply({ content: this.misBoletos(c, i.user.id), flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action !== "t" || !tipo || !TIPOS.includes(tipo)) return false;
    if (!c || c.estado !== "abierta" || Date.now() >= c.cierraAt) return void (await i.reply({ content: "Las apuestas de esta carrera ya se cerraron. 🏇", flags: MessageFlags.Ephemeral })), true;
    const { minimaBoleto, maximaCarrera } = this.s.settings.apuestas;
    const previa = this.s.boletosDe(c.id, i.user.id).reduce((a, b) => a + b.cantidad, 0);
    const room = maximaCarrera - previa;
    if (room < minimaBoleto) return void (await i.reply({ content: `Ya apostaste el máximo (${fmt(maximaCarrera)}) en esta carrera. ¡Suerte! 🍀`, flags: MessageFlags.Ephemeral })), true;
    const monedas = this.s.coinsOf(i.user.id);
    if (monedas < minimaBoleto) return void (await i.reply({ content: `No te alcanza: tienes ${fmt(monedas)} Shaulitas y cada boleto es de al menos ${minimaBoleto}. Se ganan participando en el servidor. 🪙`, flags: MessageFlags.Ephemeral })), true;
    const vivo = this.s.enVivo(c)[tipo];
    const menu = new StringSelectMenuBuilder()
      .setCustomId("corredor")
      .setPlaceholder("Elige a tu Vocaloid")
      .addOptions(
        c.corredores.map((x, k) =>
          new StringSelectMenuOptionBuilder()
            .setValue(x)
            .setLabel((tipo === "ganador" ? `${this.name(x)} · ${fmtCuota(vivo[k]!)}` : this.name(x)).slice(0, 100))
            .setEmoji(this.optionEmoji(x)),
        ),
      );
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}m:${c.id}:${tipo}`)
      .setTitle(`Boleto ${NOMBRE_TIPO[tipo]} ${EMOJI_TIPO[tipo]}`)
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(tipo === "ganador" ? "¿Quién llega 1.º?" : tipo === "segundo" ? "¿Quién llega 1.º o 2.º?" : "¿Quién llega al podio?")
          .setStringSelectMenuComponent(menu),
        new LabelBuilder()
          .setLabel("¿Cuántas Shaulitas?")
          .setDescription(`De ${minimaBoleto} a ${Math.min(room, monedas)} · tienes ${fmt(monedas)}${previa ? ` · llevas ${fmt(previa)} en esta carrera` : ""}`.slice(0, 100))
          .setTextInputComponent(new TextInputBuilder().setCustomId("cantidad").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(4).setRequired(true)),
      );
    await i.showModal(modal);
    return true;
  }

  private misBoletos(c: Carrera | null, userId: string): string {
    if (!c) return "Esa carrera ya no existe.";
    const mios = this.s.boletosDe(c.id, userId);
    const monedas = this.s.coinsOf(userId);
    if (!mios.length) return `Todavía no tienes boletos en esta carrera. Tienes ${fmt(monedas)} Shaulitas.`;
    const vivo = c.estado === "abierta" ? this.s.enVivo(c) : null;
    const lines = mios.map((b) => {
      const k = c.corredores.indexOf(b.corredor);
      const q = c.cuotas?.[b.tipo]?.[b.corredor] ?? vivo?.[b.tipo][k];
      const pago = c.estado === "terminada" ? (b.pago ? ` → cobraste **${fmt(b.pago)}**` : " → no acertó") : q ? ` → si acierta, ≈${fmt(Math.floor(b.cantidad * q))}` : "";
      return `${EMOJI_TIPO[b.tipo]} ${NOMBRE_TIPO[b.tipo]} · ${this.face(b.corredor)} **${this.name(b.corredor)}** · ${fmt(b.cantidad)}${pago}`;
    });
    const total = mios.reduce((a, b) => a + b.cantidad, 0);
    return [`🎟️ **Tus boletos** (${fmt(total)} apostadas · tienes ${fmt(monedas)} Shaulitas):`, ...lines, c.estado === "abierta" ? "-# Las cuotas cambian hasta el cierre; el pago final es el de la bolsa al cerrar." : ""].join("\n");
  }

  /** «🎟️ Ventanilla»: los últimos boletos (las menciones no notifican). */
  private ventanillaText(c: Carrera): string {
    const bs = this.s.boletos(c.id);
    if (!bs.length) return "🎟️ **Ventanilla**\n-# Todavía no hay boletos. ¡Sé el primero!";
    const ult = bs.slice(-VENTANILLA);
    const lines = ult.map((b) => `<@${b.userId}> → ${EMOJI_TIPO[b.tipo]} ${this.face(b.corredor)} ${this.name(b.corredor)} · ${fmt(b.cantidad)}`);
    const resto = bs.length - ult.length;
    const total = bs.reduce((a, b) => a + b.cantidad, 0);
    return ["🎟️ **Ventanilla**", ...lines, `-# ${resto ? `…y ${resto} ${resto === 1 ? "boleto" : "boletos"} más · ` : ""}${fmt(total)} Shaulitas apostadas`].join("\n");
  }

  /** Ventanita del boleto. Devuelve false si no es de aquí. */
  async modal(i: ModalSubmitInteraction): Promise<boolean> {
    if (!i.customId.startsWith(`${PREFIX}m:`)) return false;
    const [, , id, tipo] = i.customId.split(":") as [string, string, string, Tipo];
    const corredor = i.fields.getStringSelectValues("corredor")[0] ?? "";
    const raw = i.fields.getTextInputValue("cantidad").replace(/[.\s]/g, "");
    const cantidad = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const res = this.s.apostar(id, i.user.id, corredor, tipo, cantidad);
    if (!res.ok) return void (await i.reply({ content: `❌ ${res.motivo}`, flags: MessageFlags.Ephemeral })), true;
    // Público en la ventanilla; en privado, solo lo justo.
    await i.reply({ content: `✅ ¡Listo! Te quedan ${fmt(res.monedas)} Shaulitas. 🍀`, flags: MessageFlags.Ephemeral });
    this.refreshBoard(id);
    return true;
  }

  // ───────────────────────── la carrera ─────────────────────────

  /** La pista vertical: caras arriba, filas de ▫️ con cada corredor en su fila y la meta abajo. */
  private pista(c: Carrera, pos: readonly number[]): string {
    const filas = this.s.settings.carrera.filas;
    const caras = c.corredores.map((id) => this.face(id));
    const rows = [caras.join(" ")];
    for (let r = 0; r < filas; r++) rows.push(pos.map((p, k) => (filaDe(this.s.settings, p) === r ? caras[k]! : "▫️")).join(" "));
    rows.push(pos.map((p, k) => (filaDe(this.s.settings, p) === filas ? caras[k]! : "🏁")).join(" "));
    return rows.join("\n");
  }

  private raceText(c: Carrera, titulo: string, pos: readonly number[], jugadas: string[], llegados: number[]): string {
    const llegada = llegados.length ? `🏁 ${llegados.map((k, n) => `${LUGAR[n]} ${this.name(c.corredores[k]!)}`).join(" · ")}` : "";
    let text = [titulo, this.pista(c, pos), ...jugadas.slice(-3).map((j) => `> ${j}`), llegada].filter(Boolean).join("\n");
    if (text.length > 1990) text = `${text.slice(0, 1985)}…`;
    return text;
  }

  /** Cierra las apuestas, muestra la carrera turno a turno, paga y publica el podio. */
  private async run(id: string): Promise<void> {
    this.closeTimer = null;
    if (this.stopped) return;
    const c0 = this.s.get(id);
    if (!c0) return;
    const nombres = c0.corredores.map((x) => this.name(x));
    const r = this.s.correr(id, nombres);
    const c = this.s.get(id);
    if (!r || !c || !c.canal) return;
    if (this.boardTimer) clearTimeout(this.boardTimer);
    this.boardTimer = null;
    await this.banner?.edit({ content: this.bannerText(c, false), components: [this.buttons(c, false)] }).catch((e) => logError("banner de la carrera", e));
    await this.ventanilla?.edit({ content: this.ventanillaText(c) }).catch((e) => logError("ventanilla de la carrera", e));
    this.ventanilla = null;
    const ch = await this.d.sendable("teto", c.canal);
    const cero = c.corredores.map(() => 0);
    const msg = await ch.send({ content: this.raceText(c, "🏇 **¡En sus marcas…!**", cero, [], []), allowedMentions: { parse: [] } });
    const step = this.s.settings.carrera.turnoMs;
    const jugadas: string[] = [];
    const llegados: number[] = [];
    for (const t of r.turnos) {
      await sleep(step);
      if (this.stopped) return;
      if (t.jugada) jugadas.push(t.jugada.texto);
      // Los que cruzaron en este turno, en el orden de llegada.
      for (const k of r.llegada) if (r.cruce[k] === t.n && !llegados.includes(k)) llegados.push(k);
      await msg.edit({ content: this.raceText(c, `🏇 **¡Largaron!** · turno ${t.n}`, t.pos, jugadas, llegados) }).catch((e) => logError("turno de la carrera", e));
    }
    await sleep(step);
    if (this.stopped) return;
    const last = r.turnos.at(-1)!;
    const foto = r.fotoFinal ? `📸 **¡Foto final!** ${this.name(c.corredores[r.fotoFinal[0]]!)} le gana por una nariz a ${this.name(c.corredores[r.fotoFinal[1]]!)}.` : null;
    await msg.edit({ content: this.raceText(c, "🏁 **¡Llegada!**", last.pos, foto ? [...jugadas, foto] : jugadas, r.llegada) }).catch((e) => logError("final de la carrera", e));
    const liq = this.s.liquidar(id, nombres);
    this.banner = null;
    if (liq) await this.publish(liq);
  }

  private async publish(liq: Liquidacion): Promise<void> {
    const c = liq.carrera;
    const llegada = c.llegada!;
    const podio = llegada.slice(0, 3);
    const cuotas = c.cuotas!;
    // Imagen del podio: todos los que apostaron (con membresía primero) con su icono; las vallas, patrocinadores y Papus de honor.
    const userIds = [...new Set(liq.boletos.map((b) => b.userId))];
    const papus = (await this.d.papus?.(userIds).catch((e) => (logError("Papus del podio", e), null))) ?? new Map<string, Apostador>();
    const papu = (uid: string): Apostador => papus.get(uid) ?? { id: uid, nombre: "Papu", nivel: -1 };
    const honor = (await this.d.honor?.().catch(() => [])) ?? [];
    const rep = repartirApostadores(
      podio,
      liq.boletos.map((b) => ({ papu: papu(b.userId), corredor: b.corredor, monto: b.cantidad })),
      honor,
      this.rnd,
    );
    const pod = (id: string): PodioCorredor => ({
      nombre: this.name(id),
      color: this.d.info(id).color,
      avatar: readFileSync(avatarFile(id)),
      pagos: { ganador: cuotas.ganador[id], segundo: cuotas.segundo[id], tercero: cuotas.tercero[id] },
      repartido: liq.repartido[id] ?? 0,
      apostadores: rep.porCorredor.get(id) ?? [],
    });
    const hora = new Intl.DateTimeFormat("es-MX", { timeZone: this.s.settings.horario.zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(c.creadaAt));
    const lanzador = c.lanzadaPor && this.lanzador?.carrera === c.id ? this.lanzador : null;
    const png = await bannerPodio({ podio: [pod(podio[0]!), pod(podio[1]!), pod(podio[2]!)], vallas: rep.vallas, tambien: rep.tambien, hora, membresia: marcoDe(lanzador?.nivel) });

    const ganador = llegada[0]!;
    const out = [this.d.phrases.pick("teto", "carrera_ganador", { ganador: `**${this.name(ganador)}**` })];
    out.push(`🏁 ${llegada.map((id, n) => `${LUGAR[n]} ${this.face(id)} ${this.name(id)}`).join(" · ")}`);
    const pagos = TIPOS.map((t) => {
      const q = Object.entries(cuotas[t]);
      return `${EMOJI_TIPO[t]} ${NOMBRE_TIPO[t]}: ${q.length ? q.map(([id, x]) => `${this.name(id)} ${fmtCuota(x)}`).join(", ") : "nadie"}`;
    });
    out.push(`🎟️ **Pagos** · ${pagos.join(" · ")}`);
    // Cómo le fue a cada Papu (pedido de GyroP, 16 nov. 2026): lo que cobró con su ganancia o pérdida neta (sus
    // boletos suman lo apostado en toda la carrera), y lo que perdió quien no acertó ninguno.
    if (!liq.boletos.length) out.push("Nadie apostó en esta carrera. ¡La próxima, Burreros! 🪙");
    else {
      const neto = (n: number) => (n >= 0 ? `**+${fmt(n)}**` : `**−${fmt(-n)}**`);
      const porPapu = new Map<string, { cobro: number; apostado: number }>();
      for (const b of liq.boletos) {
        const p = porPapu.get(b.userId) ?? { cobro: 0, apostado: 0 };
        p.cobro += b.pago;
        p.apostado += b.cantidad;
        porPapu.set(b.userId, p);
      }
      const todos = [...porPapu].map(([userId, p]) => ({ userId, ...p, neto: p.cobro - p.apostado })).sort((a, b) => b.neto - a.neto);
      const cobran = todos.filter((x) => x.cobro > 0);
      const pierden = todos.filter((x) => x.cobro === 0).sort((a, b) => b.apostado - a.apostado);
      if (cobran.length) {
        out.push("🪙 **Cobran:**");
        for (const x of cobran.slice(0, MAX_COBROS)) out.push(`• <@${x.userId}> cobra **${fmt(x.cobro)}** (apostó ${fmt(x.apostado)} · ${neto(x.neto)})`);
        if (cobran.length > MAX_COBROS) out.push(`…y ${cobran.length - MAX_COBROS} Papus más.`);
      } else out.push("Nadie acertó: ¡la casa se queda con todo! 😱");
      if (pierden.length) {
        out.push("💸 **Pierden:**");
        for (const x of pierden.slice(0, MAX_COBROS)) out.push(`• <@${x.userId}> pierde **${fmt(x.apostado)}**`);
        if (pierden.length > MAX_COBROS) out.push(`…y ${pierden.length - MAX_COBROS} Papus más.`);
      }
    }
    const next = this.s.nextSlot();
    if (next) {
      const roles = findTextChannel(this.d.guild(), "tus-roles");
      out.push(`⏰ Próxima carrera: <t:${Math.floor(next / 1000)}:F> (<t:${Math.floor(next / 1000)}:R>).${roles ? ` ¿Quieres que te avise? Elige el aviso en <#${roles.id}> 🔔` : ""}`);
    }
    let content = out.join("\n");
    if (content.length > 1990) content = `${content.slice(0, 1985)}…`;
    const ch = await this.d.sendable("teto", c.canal!);
    await ch.send({ content, files: [new AttachmentBuilder(png, { name: "podio.png" })], allowedMentions: { parse: [] } });

    const apostado = liq.boletos.reduce((a, b) => a + b.cantidad, 0);
    const pagado = liq.boletos.reduce((a, b) => a + b.pago, 0);
    await this.d.report(`🏇 Carrera: ${llegada.map((id, n) => `${n + 1}. ${this.name(id)}`).join(", ")}. Apostado ${fmt(apostado)} · pagado ${fmt(pagado)} · ${userIds.length} Papus.`);
    this.d.log(`🏇 Ganó ${this.name(ganador)} · apostado ${apostado}, pagado ${pagado}`);
    await this.reaccion(c, apostado, liq.cobros[0] ? { nombre: papu(liq.cobros[0].userId).nombre, cobro: liq.cobros[0].cobro } : null);
  }

  /**
   * Reacción de los Vocaloids en #general: el que le fue mejor provoca al que le fue peor (pique, pedido de GyroP) o,
   * si no se puede, uno de los que corrieron comenta la carrera (ambiente casual).
   */
  private async reaccion(c: Carrera, apostado: number, mayor: { nombre: string; cobro: number } | null): Promise<void> {
    const llegada = c.llegada!;
    const bots = llegada.filter((id): id is BotId => (BOT_IDS as readonly string[]).includes(id));
    const online = this.d.online?.() ?? [];
    const conectados = bots.filter((b) => online.includes(b));
    const resumen = `En la carrera de caballos del servidor (de mentira, con Shaulitas), quedaron así: ${llegada.map((id, n) => `${n + 1}.º ${this.name(id)}`).join(", ")}.`;
    if (this.d.pique && conectados.length >= 2 && this.rnd() < 0.6) {
      const mejor = conectados[0]!, peor = conectados.at(-1)!;
      const lugar = (b: BotId) => llegada.indexOf(b) + 1;
      const situacion = `${resumen} Tú (${this.name(mejor)}) llegaste ${lugar(mejor)}.º y ${this.name(peor)} llegó ${lugar(peor)}.º.`;
      if (await this.d.pique(mejor, peor, situacion).catch(() => false)) return;
    }
    this.d.ambient?.({
      tipo: "carrera",
      situacion: `${resumen} Los Papus apostaron ${fmt(apostado)} Shaulitas${mayor ? ` y ${mayor.nombre} fue quien más cobró (${fmt(mayor.cobro)})` : ""}. Si corriste y ganaste, presume; si perdiste, pon excusas o pide la revancha.`,
      bots: bots.length ? [bots.at(-1)!, bots[0]!] : [],
      comenta: bots.length ? "involucrado" : "otro",
    });
  }
}
