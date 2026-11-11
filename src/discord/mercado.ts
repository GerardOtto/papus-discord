// Mercado negro en Discord (PLAN §3.9). Una hora al día, a una hora sorpresa, Neru abre el puesto en #tienda-shaula y
// etiqueta a los 🕶️ Traficante (avisos de #tus-roles); al cerrar, edita su mensaje. Todo lo que abre cada Papu es
// privado: el mercado (comprar con monedas ganadas) y /consumibles (lo que tiene y el PC de Adachi Rei). El Atún, la
// Baguette y el Celular se usan solos en /ruleta y /trivia. Las reglas y el estado viven en src/mercado/.
// La vitrina rota cada día (5 objetos): un banner con los objetos sobre podios y, debajo, una fila de 5 botones iguales
// en el mismo orden, para que cada botón quede bajo su objeto (pedido de GyroP, 9 nov. 2026).
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type MessageActionRowComponentBuilder,
  type SendableChannels,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import type { BotId } from "../config";
import type { CoinService } from "../coins/service";
import { kvGet, kvSet, type Db } from "../db/database";
import { logError, type LogFn } from "../log";
import { mercadoBanner } from "../mercado/banner";
import { PERMANENTES, type ObjetoMercado } from "../mercado/rules";
import type { MercadoService } from "../mercado/service";
import type { Phrases } from "../phrases/catalog";
import { avisoPing } from "./avisos";
import { channelKey, findTextChannel } from "./channels";

const P = "mercado:";
const ANUNCIO_KEY = "mercado:anuncio";
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));
const unix = (t: number) => Math.ceil(t / 1000);
/** Dónde se usa cada consumible (para /consumibles). */
const COMO: Record<string, string> = {
  atun: "se usa solo en **/ruleta**: al girar, ves el premio antes que nadie y puedes descartarlo.",
  baguette: "se usa solo en **/trivia**: si fallas, Teto te ofrece seguir con tu racha.",
  celular: "se usa en **/trivia**: botón 📱 en las preguntas de opciones.",
  seguro: "se usa en el **1vs1**: después de apostar (o en «Mi apuesta»), toca 🍆 Asegurar.",
  helado: "se usa solo: el próximo sobre que abras en **/tienda** trae un objeto más.",
  microfono: "se activa aquí abajo, para el día de hoy (misión de voz de **/ruleta**).",
  regalo: "se usa aquí abajo: eliges a qué Papu le regalas una tirada de hoy.",
  luna: "se activa aquí abajo y dura 2 semanas: los mensajes que te contesta un Vocaloid dan el triple de XP.",
  sake: "se usa aquí abajo mientras haya una adivinanza de boda abierta.",
  zanahoria: "se usa en **/trivia**: botón 🥕 para elegir el tema de la siguiente pregunta.",
  doblehelado: "se usa aquí abajo: convierte un sobre común regalado en uno raro.",
  guitarra: "se usa en **/trivia**: botón 🎸 durante una partida con XP.",
  disquete: "para siempre: tus tiradas de **/ruleta** sin usar se guardan para los días siguientes.",
  machete: "para siempre: **/machetear** (Neru) para dar machetazos de mentira.",
  pc: "se usa aquí abajo: reinicia tu día sin quitarte nada.",
};

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
interface Screen {
  content: string;
  components: Row[];
  /** El banner de la vitrina (o nada). attachments: [] quita la imagen de la pantalla anterior al editar. */
  files: AttachmentBuilder[];
  attachments: [];
}
const NOFILES = { files: [] as AttachmentBuilder[], attachments: [] as [] };
/** Mismo texto en los 5 botones de la vitrina: así miden lo mismo y cada uno queda bajo su objeto del banner. */
const BOTON_VITRINA = "¡Lo quiero!";

export interface MercadoDiscordDeps {
  mercado: MercadoService;
  coins: CoinService;
  phrases: Phrases;
  db: Db;
  owners: ReadonlySet<string>;
  clients: Partial<Record<BotId, Client>>;
  online: readonly BotId[];
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  log: LogFn;
}

/** El mensaje de Neru de la apertura en curso (para cerrarlo al terminar). */
interface Anuncio {
  day: string;
  channelId: string;
  messageId: string;
  bot: BotId;
  cerrado: boolean;
}

export class MercadoDiscord {
  constructor(private readonly d: MercadoDiscordDeps) {}

  private get m(): MercadoService {
    return this.d.mercado;
  }

  /** Último banner dibujado (la vitrina cambia una vez al día). */
  private bannerCache: { key: string; png: Buffer } | null = null;

  /** El banner de la vitrina de hoy (podios con nombre y precio), dibujado una vez por vitrina. */
  private async banner(items: ObjetoMercado[]): Promise<AttachmentBuilder> {
    const key = items.map((o) => `${o.id}:${o.precio}`).join("|");
    if (this.bannerCache?.key !== key) {
      const png = await mercadoBanner(items.map((o) => ({ emoji: o.emoji, nombre: o.nombre, precio: o.precio, detalle: o.usos ? `${o.usos} ${o.usos === 1 ? "uso" : "usos"}` : "para siempre" })));
      this.bannerCache = { key, png };
    }
    return new AttachmentBuilder(this.bannerCache.png, { name: "mercado-negro.png" });
  }

  /**
   * La fila de 5 botones bajo el banner, en el mismo orden. Con `userId` (pantalla privada) se apagan los permanentes
   * que ya tiene; el texto no cambia, para que todos midan lo mismo.
   */
  private vitrinaRow(items: ObjetoMercado[], userId?: string): Row {
    return this.row(
      ...items.map((o) => {
        const tiene = !!userId && PERMANENTES.includes(o.efecto) && this.m.tiene(userId, o);
        // Sin emoji (ya está en el banner): así cada botón mide casi lo mismo que su columna (110 px de 550).
        return new ButtonBuilder().setCustomId(`${P}ver:${o.id}`).setLabel(BOTON_VITRINA).setStyle(tiene ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(tiene);
      }),
    );
  }

  private btn(id: string, label: string, emoji: string, style = ButtonStyle.Secondary, disabled = false): ButtonBuilder {
    return new ButtonBuilder().setCustomId(`${P}${id}`).setLabel(label.slice(0, 80)).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  }

  private row(...items: MessageActionRowComponentBuilder[]): Row {
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...items);
  }

  // ───────────────────────── arranque y aviso ─────────────────────────

  /** Al conectar: el rol del aviso (si falta) y el estado del aviso de Neru. */
  async start(): Promise<void> {
    await this.ensureAvisoRole().catch((e) => logError("rol de aviso del mercado", e));
    await this.tick();
  }

  /** Cada minuto: si abrió, Neru lo anuncia (una vez por apertura); si cerró, edita su mensaje. */
  async tick(): Promise<void> {
    if (!this.m.settings.activo) return;
    const st = this.m.estado();
    const prev = JSON.parse(kvGet(this.d.db, ANUNCIO_KEY) ?? "null") as Anuncio | null;
    if (st.abierto && prev?.day !== st.apertura.day) return void (await this.announce(st.apertura.day, st.apertura.cierra).catch((e) => logError("aviso del mercado negro", e)));
    if (!st.abierto && prev && !prev.cerrado) await this.close(prev).catch((e) => logError("cierre del mercado negro", e));
  }

  /** El rol 🕶️ Traficante (avisos de #tus-roles): como los demás avisos, sin color, sin permisos y no mencionable. */
  private async ensureAvisoRole(): Promise<void> {
    const guild = this.d.guild();
    if (avisoPing(guild, "mercado")) return;
    const client = this.d.clients.teto;
    if (!client) return;
    const g = await client.guilds.fetch(guild.id);
    const name = "🕶️ Traficante";
    if (g.roles.cache.some((r) => channelKey(r.name) === channelKey(name))) return;
    await g.roles.create({ name, permissions: [], mentionable: false, hoist: false, reason: "Aviso del mercado negro (#tus-roles)" });
    this.d.log(`🕶️ Mercado negro: rol ${name} creado`);
  }

  private async announce(day: string, cierra: number): Promise<void> {
    const guild = this.d.guild();
    const ch = findTextChannel(guild, this.m.settings.canal, this.m.settings.respaldo);
    if (!ch) return void this.d.log(`🕶️ Mercado negro: falta el canal #${this.m.settings.canal}`);
    const bot: BotId = this.d.online.includes("neru") ? "neru" : "teto";
    const send = await this.d.sendable(bot, ch.id);
    const ping = avisoPing(guild, "mercado");
    const items = this.m.vitrina();
    // El aviso de la apertura anterior (ya cerrado) se borra: en el canal queda solo el de hoy (pedido de GyroP, 10 nov. 2026).
    await this.deletePrevious().catch((e) => logError("borrar el aviso anterior del mercado", e));
    const msg = await send.send({
      content: [
        `🕶️ ${this.d.phrases.pick("neru", "mercado_abre", { cierra: `<t:${unix(cierra)}:R>` })}${ping ? ` ${ping.mention}` : ""}`,
        "-# Hoy en el puesto (cambia cada día). Solo con Shaula-coins ganadas; lo que abres aquí solo lo ves tú.",
      ].join("\n"),
      files: [await this.banner(items)],
      components: [this.vitrinaRow(items)],
      allowedMentions: ping ? { roles: [ping.roleId] } : { parse: [] },
    });
    kvSet(this.d.db, ANUNCIO_KEY, JSON.stringify({ day, channelId: ch.id, messageId: msg.id, bot, cerrado: false } satisfies Anuncio));
    this.d.log(`🕶️ Mercado negro abierto hasta ${new Date(cierra).toISOString()}`);
  }

  /** Borra el mensaje de Neru de la apertura anterior (si sigue ahí). */
  private async deletePrevious(): Promise<void> {
    const prev = JSON.parse(kvGet(this.d.db, ANUNCIO_KEY) ?? "null") as Anuncio | null;
    if (!prev) return;
    const send = await this.d.sendable(prev.bot, prev.channelId).catch(() => null);
    if (!send || !("messages" in send)) return;
    const msg = await send.messages.fetch(prev.messageId).catch(() => null);
    await msg?.delete();
  }

  private async close(a: Anuncio): Promise<void> {
    kvSet(this.d.db, ANUNCIO_KEY, JSON.stringify({ ...a, cerrado: true }));
    const send = await this.d.sendable(a.bot, a.channelId).catch(() => null);
    if (!send || !("messages" in send)) return;
    const msg = await send.messages.fetch(a.messageId).catch(() => null);
    await msg?.edit({ content: "🕶️ **El mercado negro cerró.** Vuelve mañana, a otra hora sorpresa y con otros objetos…\n-# Elige el aviso 🕶️ Traficante en #tus-roles y Neru te etiqueta cuando abra.", components: [], attachments: [] });
  }

  // ───────────────────────── pantallas ─────────────────────────

  private ganadas(userId: string): number {
    this.d.coins.sync(userId, 2);
    return this.d.coins.wallet(userId).ganadas;
  }

  private estado(o: ObjetoMercado, userId: string): string {
    if (PERMANENTES.includes(o.efecto)) return this.m.tiene(userId, o) ? " · ✅ ya lo tienes" : "";
    const u = this.m.usos(userId, o.id);
    return u ? ` · 🎒 tienes ${u} ${u === 1 ? "uso" : "usos"}` : "";
  }

  private closedScreen(): Screen {
    const h = this.m.settings.horario;
    return {
      ...NOFILES,
      content: [
        "🕶️ **El mercado negro está cerrado.**",
        `Abre **una hora al día**, a una hora sorpresa (entre las ${h.desde}:00 y las ${h.hasta}:00, hora de México). Neru avisa en #${this.m.settings.canal} cuando abre.`,
        "-# Elige el aviso 🕶️ Traficante en #tus-roles para que te etiquete.",
      ].join("\n"),
      components: [this.row(this.btn("consumibles", "Mis consumibles", "🎒"))],
    };
  }

  private async menuScreen(userId: string, header = ""): Promise<Screen> {
    const st = this.m.estado();
    if (!st.abierto) return this.closedScreen();
    const ganadas = this.ganadas(userId);
    const items = this.m.vitrina();
    const tuyos = items.map((o) => this.estado(o, userId)).map((e, k) => (e ? `${items[k]!.emoji}${e}` : "")).filter(Boolean);
    return {
      content: [
        header,
        `🕶️ **Mercado negro** · cierra <t:${unix(st.apertura.cierra)}:R> · 🪙 tienes **${fmt(ganadas)}** ganadas`,
        tuyos.length ? `-# ${tuyos.join(" · ")}` : "",
        "-# Toca el botón bajo cada objeto para ver qué hace y comprarlo. Mañana, otros objetos.",
      ]
        .filter(Boolean)
        .join("\n"),
      files: [await this.banner(items)],
      attachments: [],
      components: [this.vitrinaRow(items, userId), this.row(this.btn("consumibles", "Mis consumibles", "🎒"))],
    };
  }

  private async itemScreen(userId: string, id: string, header = ""): Promise<Screen> {
    const o = this.m.byId.get(id);
    const st = this.m.estado();
    if (!st.abierto) return this.closedScreen();
    if (!o || !this.m.vitrina().some((x) => x.id === id)) return this.menuScreen(userId, "Ese objeto ya no está en la vitrina de hoy.");
    const ganadas = this.ganadas(userId);
    const tiene = this.m.tiene(userId, o);
    const falta = o.precio - ganadas;
    const why = tiene ? "✅ Ya lo tienes." : falta > 0 ? `💸 Te faltan **${fmt(falta)}** ganadas.` : `Después te quedarían **${fmt(ganadas - o.precio)}** ganadas.`;
    return {
      ...NOFILES,
      content: [
        header,
        `${o.emoji} **${o.nombre}** · **${fmt(o.precio)}** Shaula-coins ganadas${o.usos ? ` · ${o.usos} usos` : ""}`,
        o.descripcion,
        o.efecto in COMO ? `-# ${COMO[o.efecto]}` : "",
        "",
        `🪙 Tienes **${fmt(ganadas)}** ganadas. ${why}${this.estado(o, userId)}`,
        `-# El mercado cierra <t:${unix(st.apertura.cierra)}:R>. No hay devoluciones.`,
      ]
        .filter((l, k) => l !== "" || k > 3)
        .join("\n"),
      components: [this.row(this.btn(`comprar:${o.id}`, `Comprar por ${fmt(o.precio)}`, "🕶️", ButtonStyle.Success, tiene || falta > 0), this.btn("menu", "Volver", "⬅️"))],
    };
  }

  private consumiblesScreen(userId: string, header = ""): Screen {
    const inv = this.m.inventario(userId);
    const st = this.m.estado();
    const siempre = this.m.settings.objetos.filter((o) => (o.efecto === "disquete" || o.efecto === "machete") && this.m.tiene(userId, o));
    const luna = this.m.lunaHasta(userId);
    const lines = [
      ...inv.map((c) => `${c.objeto.emoji} **${c.objeto.nombre}** · ${c.usos} ${c.usos === 1 ? "uso" : "usos"}\n-# ${COMO[c.objeto.efecto] ?? c.objeto.descripcion}`),
      ...siempre.map((o) => `${o.emoji} **${o.nombre}** · para siempre\n-# ${COMO[o.efecto] ?? o.descripcion}`),
      ...(luna ? [`🌙 **Luna de IA activa** hasta <t:${unix(luna)}:f> (<t:${unix(luna)}:R>): XP triple en tus mensajes con los Vocaloids.`] : []),
    ];
    if (!lines.length) lines.push("No tienes consumibles. Se compran en el mercado negro, con monedas ganadas.");
    const pc = this.m.byEfecto("pc");
    const pcUsos = pc ? this.m.usos(userId, pc.id) : 0;
    const buttons: ButtonBuilder[] = [];
    if (pc && pcUsos > 0) buttons.push(this.btn("pc", `Usar ${pc.nombre}`, pc.emoji, ButtonStyle.Danger));
    const mic = this.m.byEfecto("microfono");
    if (mic && this.m.usos(userId, mic.id) > 0) {
      const activo = this.m.microfonoHoy(userId);
      buttons.push(this.btn("microfono", activo ? "Micrófono activo hoy" : "Activar micrófono hoy", mic.emoji, ButtonStyle.Primary, activo));
    }
    const regalo = this.m.byEfecto("regalo");
    if (regalo && this.m.usos(userId, regalo.id) > 0) buttons.push(this.btn("regalo", "Regalar una tirada", regalo.emoji, ButtonStyle.Primary));
    const lunaO = this.m.byEfecto("luna");
    if (lunaO && this.m.usos(userId, lunaO.id) > 0) buttons.push(this.btn("luna", luna ? "Luna ya activa" : "Activar la Luna (2 semanas)", lunaO.emoji, ButtonStyle.Primary, !!luna));
    const sake = this.m.byEfecto("sake");
    if (sake && this.m.usos(userId, sake.id) > 0) buttons.push(this.btn("sake", "Pista de la adivinanza", sake.emoji, ButtonStyle.Primary));
    const doble = this.m.byEfecto("doblehelado");
    if (doble && this.m.usos(userId, doble.id) > 0) buttons.push(this.btn("doblehelado", "Sobre común → raro", doble.emoji, ButtonStyle.Primary));
    buttons.push(st.abierto ? this.btn("menu", "Ir al mercado negro", "🕶️", ButtonStyle.Success) : this.btn("cerrado", "Mercado cerrado", "🕶️", ButtonStyle.Secondary, true));
    return {
      ...NOFILES,
      content: [
        header,
        "🎒 **Tus consumibles**",
        "",
        ...lines,
        "",
        st.abierto ? `-# 🕶️ El mercado negro está abierto: cierra <t:${unix(st.apertura.cierra)}:R>.` : "-# 🕶️ El mercado negro abre una hora al día, a una hora sorpresa. Neru avisa a los 🕶️ Traficante (#tus-roles).",
      ]
        .filter((l, k) => l !== "" || k > 0)
        .join("\n"),
      // Discord admite hasta 5 botones por fila.
      components: Array.from({ length: Math.ceil(buttons.length / 5) }, (_, k) => this.row(...buttons.slice(k * 5, k * 5 + 5))),
    };
  }

  private pcScreen(userId: string): Screen {
    const pc = this.m.byEfecto("pc")!;
    const usos = this.m.usos(userId, pc.id);
    if (usos <= 0) return this.consumiblesScreen(userId);
    return {
      ...NOFILES,
      content: [
        `${pc.emoji} **¿Usar el ${pc.nombre}?** (te quedan ${usos} ${usos === 1 ? "uso" : "usos"})`,
        "Adachi Rei reinicia tu día **sin quitarte nada de lo que ganaste**:",
        "• 💬 tu cuota con los Vocaloids vuelve a estar llena (lo que donaste no vuelve);",
        "• 🎰 las tiradas de la ruleta de tus misiones cumplidas vuelven a estar disponibles;",
        "• 🧠 las partidas con XP y el tope de XP de la trivia empiezan de cero;",
        "• 🪙 el tope de Shaula-coins por actividad vuelve a empezar.",
        "-# Conviene usarlo cuando ya gastaste todo lo de hoy. Se recarga a medianoche igual que siempre.",
      ].join("\n"),
      components: [this.row(this.btn("pc:si", "Sí, reiniciar mi día", pc.emoji, ButtonStyle.Danger), this.btn("consumibles", "Mejor no", "⬅️"))],
    };
  }

  // ───────────────────────── comandos y botones ─────────────────────────

  /** /consumibles [abrir_mercado] [minutos]: tu inventario; GyroP puede abrir el mercado ahora. */
  async consumibles(i: ChatInputCommandInteraction): Promise<void> {
    if (i.options.getBoolean("abrir_mercado")) {
      if (!this.d.owners.has(i.user.id)) return void (await i.reply({ content: "Solo GyroP puede abrir el mercado negro a mano. 🕶️", flags: MessageFlags.Ephemeral }));
      const a = this.m.abrirAhora(i.options.getInteger("minutos") ?? undefined);
      await i.reply({ content: `🕶️ Mercado negro abierto hasta <t:${unix(a.cierra)}:t>. Neru lo anuncia en un momento.`, flags: MessageFlags.Ephemeral });
      await this.tick();
      return;
    }
    await i.reply({ ...this.consumiblesScreen(i.user.id), flags: MessageFlags.Ephemeral });
  }

  /** Botones del mercado. Devuelve false si el botón no es de aquí. */
  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(P)) return false;
    const [, action, arg] = i.customId.split(":");
    const userId = i.user.id;
    // El botón del aviso de Neru es público: abre una pantalla privada nueva.
    if (action === "abrir" || action === "ver") {
      const publico = !i.message.flags.has(MessageFlags.Ephemeral);
      if (publico) await i.deferReply({ flags: MessageFlags.Ephemeral });
      else await i.deferUpdate();
      const sc = action === "ver" && arg ? await this.itemScreen(userId, arg) : await this.menuScreen(userId);
      await i.editReply(sc);
      return true;
    }
    if (action === "menu") {
      await i.deferUpdate();
      await i.editReply(await this.menuScreen(userId));
      return true;
    }
    if (action === "consumibles") return void (await i.update(this.consumiblesScreen(userId))), true;
    if (action === "pc" && arg === "si") return void (await this.usePc(i)), true;
    if (action === "pc") return void (await i.update(this.pcScreen(userId))), true;
    if (action === "comprar" && arg) return void (await this.buy(i, arg)), true;
    if (action === "microfono") return void (await this.useMicrofono(i)), true;
    if (action === "regalo") return void (await i.update(this.regaloScreen(userId))), true;
    if (action === "luna") return void (await this.useLuna(i)), true;
    if (action === "sake") return void (await this.useSake(i)), true;
    if (action === "doblehelado") return void (await this.useDobleHelado(i)), true;
    return false;
  }

  /** Menú de objetos del mercado. Devuelve false si no es de aquí. */
  async select(i: StringSelectMenuInteraction): Promise<boolean> {
    if (i.customId !== `${P}ver`) return false;
    await i.deferUpdate();
    await i.editReply(await this.itemScreen(i.user.id, i.values[0] ?? ""));
    return true;
  }

  private async buy(i: ButtonInteraction, id: string): Promise<void> {
    // Responder a Discord antes (dar el rol puede tardar más de 3 s).
    await i.deferUpdate();
    const r = this.m.comprar(i.user.id, id);
    if (!r.ok) {
      const motivo = { cerrado: "🚪 El mercado ya cerró. Vuelve mañana.", no_existe: "Ese objeto ya no está.", no_esta: "Ese objeto ya no está en la vitrina de hoy.", ya_lo_tienes: "✅ Ya lo tienes.", no_alcanza: "💸 No te alcanzan las monedas ganadas." }[r.motivo];
      await i.editReply(r.motivo === "cerrado" ? this.closedScreen() : await this.itemScreen(i.user.id, id, motivo));
      return;
    }
    const o = r.objeto;
    let extra = "";
    if (r.rol) {
      const ok = await this.giveRole(i.user.id, o).then(
        () => true,
        (e) => (logError("rol del mercado negro", e), false),
      );
      extra = ok ? `\nYa tienes el rol **${r.rol}** en tu perfil.` : "\n⚠️ No pude ponerte el rol ahora; GyroP ya lo sabe y te lo pone a mano.";
      if (!ok) await this.d.report(`⚠️ Mercado negro: no pude darle el rol ${r.rol} a <@${i.user.id}> (lo compró). Pónselo a mano.`);
    } else if (o.efecto === "objeto") extra = "\nYa está en tu colección: equípalo en /tienda → Mi tarjeta.";
    else if (o.efecto === "disquete" || o.efecto === "machete") extra = `\nEs tuyo para siempre: ${COMO[o.efecto]}`;
    else extra = `\nAhora tienes **${r.usos} ${r.usos === 1 ? "uso" : "usos"}**. ${COMO[o.efecto] ?? ""}`;
    await i.editReply(await this.itemScreen(i.user.id, id, `🕶️ **Trato hecho.** Neru te pasó ${o.emoji} **${o.nombre}** por debajo de la mesa.${extra}\n`));
    this.d.log(`🕶️ Mercado negro: ${i.user.id} compró ${o.id} por ${o.precio}`);
    await this.d.report(`🕶️ <@${i.user.id}> compró ${o.emoji} **${o.nombre}** en el mercado negro (${fmt(o.precio)} ganadas; le quedan ${fmt(r.wallet.ganadas)}).`);
  }

  /** Micrófono de Meiko: hoy la misión de voz de la ruleta pide menos. */
  private async useMicrofono(i: ButtonInteraction): Promise<void> {
    const r = this.m.activarMicrofono(i.user.id);
    const header = r.ok
      ? `🎤 **Micrófono de Meiko activado.** *«¡Hoy cantamos menos rato, pero con más ganas!»* La misión de voz de /ruleta pide **${r.minutos} min** por hoy. Te quedan ${r.usos} ${r.usos === 1 ? "uso" : "usos"}.\n`
      : r.motivo === "ya_activo"
        ? "🎤 Ya lo activaste hoy.\n"
        : "🎤 No te quedan usos del Micrófono de Meiko.\n";
    await i.update(this.consumiblesScreen(i.user.id, header));
    if (r.ok) await this.d.report(`🎤 <@${i.user.id}> activó el Micrófono de Meiko (misión de voz de ${r.minutos} min hoy).`);
  }

  /** Naranja y plátano de Rin y Len: elegir a qué Papu regalarle una tirada. */
  private regaloScreen(userId: string, header = ""): Screen {
    const o = this.m.byEfecto("regalo");
    const usos = o ? this.m.usos(userId, o.id) : 0;
    if (!o || usos <= 0) return this.consumiblesScreen(userId);
    return {
      ...NOFILES,
      content: [header, `${o.emoji}🍌 **¿A quién le regalas una tirada de la ruleta?** (te quedan ${usos} ${usos === 1 ? "regalo" : "regalos"})`, "-# Vale solo para hoy. Teto lo anuncia en este canal."]
        .filter(Boolean)
        .join("\n"),
      components: [
        this.row(new UserSelectMenuBuilder().setCustomId(`${P}regalo-a`).setPlaceholder("Elige a un Papu").setMinValues(1).setMaxValues(1)),
        this.row(this.btn("consumibles", "Volver", "⬅️")),
      ],
    };
  }

  /** Menú de Papus del regalo de Rin y Len. Devuelve false si no es de aquí. */
  async userSelect(i: UserSelectMenuInteraction): Promise<boolean> {
    if (i.customId !== `${P}regalo-a`) return false;
    const to = i.users.first();
    if (!to) return true;
    if (to.bot) return void (await i.update(this.regaloScreen(i.user.id, "🤖 Los Vocaloids no giran la ruleta. Elige a un Papu.\n"))), true;
    const r = this.m.regalarTirada(i.user.id, to.id);
    if (!r.ok) {
      const motivo = {
        a_ti: "🍊 No puedes regalarte una tirada a ti mismo.",
        bloqueado: "🚫 Ese Papu tiene la ruleta bloqueada por un machetazo de Neru: perdería tu regalo.",
        sin_usos: "🍊 Ya no te quedan regalos de Rin y Len.",
        sin_ruleta: "La ruleta está apagada.",
      }[r.motivo];
      await i.update(r.motivo === "sin_usos" ? this.consumiblesScreen(i.user.id, `${motivo}\n`) : this.regaloScreen(i.user.id, `${motivo}\n`));
      return true;
    }
    await i.update(this.consumiblesScreen(i.user.id, `🍊🍌 **¡Listo!** Le regalaste una tirada a <@${to.id}>. Te quedan ${r.usos} ${r.usos === 1 ? "regalo" : "regalos"}.\n`));
    const text = this.d.phrases.pick("teto", "ruleta_regalo", { papu: `<@${to.id}>`, de: `<@${i.user.id}>` });
    const ch = i.channelId ? await this.d.sendable("teto", i.channelId).catch(() => null) : null;
    if (ch) await ch.send({ content: text, allowedMentions: { users: [to.id] } }).catch((e) => logError("regalo de tirada", e));
    await this.d.report(`🍊🍌 <@${i.user.id}> le regaló una tirada de la ruleta a <@${to.id}>.`);
    return true;
  }

  /** Luna de IA: 2 semanas de XP triple en los mensajes que contesta un Vocaloid. */
  private async useLuna(i: ButtonInteraction): Promise<void> {
    const r = this.m.activarLuna(i.user.id);
    const header = r.ok
      ? `🌙 **La Luna de IA ya brilla para ti.** *«…mientras la luna esté arriba, cada palabra cuenta tres veces.»* Hasta <t:${unix(r.hasta)}:f>.\n`
      : r.motivo === "ya_activa"
        ? "🌙 Tu Luna de IA ya está activa.\n"
        : "🌙 No te quedan Lunas de IA.\n";
    await i.update(this.consumiblesScreen(i.user.id, header));
    if (r.ok) await this.d.report(`🌙 <@${i.user.id}> activó la Luna de IA (XP triple con los Vocaloids hasta <t:${unix(r.hasta)}:f>).`);
  }

  /** Sake de Haku: forma de la respuesta de la adivinanza de boda abierta (solo la ve quien la pide). */
  private async useSake(i: ButtonInteraction): Promise<void> {
    const r = this.m.sake(i.user.id);
    const header = r.ok
      ? `🍶 *Haku, medio dormida: «…hic. la respuesta tiene ${r.palabras === 1 ? "una palabra" : `${r.palabras} palabras`} y ${r.letras} letras… no le digas a nadie.»*\n# \`${r.pista}\`\n-# ${r.gasto ? `Gastaste 1 Sake (te quedan ${r.usos}).` : "Ya la habías visto: no gastaste otro."} Sin contar artículos ni acentos al responder.\n`
      : r.motivo === "sin_adivinanza"
        ? "🍶 No hay ninguna adivinanza de boda abierta ahora. Guárdalo para la próxima (el aviso 💍 Rizzler de #tus-roles te etiqueta).\n"
        : "🍶 No te quedan Sakes de Haku.\n";
    await i.update(this.consumiblesScreen(i.user.id, header));
  }

  /** Doble helado de Kaito: un sobre común regalado pasa a ser raro. */
  private async useDobleHelado(i: ButtonInteraction): Promise<void> {
    const r = this.m.mejorarSobre(i.user.id);
    const header = r.ok
      ? `🍨 **¡Kaito le puso doble bola a tu sobre!** Un sobre común pasó a ser **raro** (Épica segura): ábrelo en /tienda → Sobres. Te quedan ${r.usos}.\n`
      : r.motivo === "sin_sobre"
        ? "🍨 No tienes sobres comunes regalados para mejorar (salen en la ruleta, las misiones del día y cada lunes).\n"
        : "🍨 No te quedan Dobles helados de Kaito.\n";
    await i.update(this.consumiblesScreen(i.user.id, header));
  }

  /**
   * /machetear (Neru, con el Machete de Neru del mercado negro): machetazo de mentira. Neru lo anuncia con una frase fija
   * y la aclaración de que no cuenta. No es moderación: no da strike ni quita nada (regla 3).
   */
  async machetear(i: ChatInputCommandInteraction): Promise<void> {
    const target = i.options.getUser("papu", true);
    if (target.id === i.user.id) return void (await i.reply({ content: "…no te puedes machetear a ti mismo. bueno, sí, pero no. 📱", flags: MessageFlags.Ephemeral }));
    const r = this.m.machetazo(i.user.id);
    if (!r.ok) {
      const content = r.motivo === "sin_machete" ? "🔪 Necesitas el **Machete de Neru** del mercado negro (/consumibles)." : `🔪 Neru está afilando el machete: el próximo, <t:${unix(r.desde)}:R>.`;
      return void (await i.reply({ content, flags: MessageFlags.Ephemeral }));
    }
    const text = this.d.phrases.pick("neru", "machetazo_ficticio", { papu: `<@${target.id}>`, de: `<@${i.user.id}>` });
    await i.reply({ content: `🔪 ${text}\n-# machetazo de mentira: no cuenta, no quita nada (Machete de Neru del mercado negro).`, allowedMentions: { users: [target.id] } });
    this.d.log(`🔪 Machetazo de mentira: ${i.user.id} → ${target.id}`);
  }

  private async usePc(i: ButtonInteraction): Promise<void> {
    const pc = this.m.byEfecto("pc")!;
    const r = this.m.usarPc(i.user.id);
    if (!r) return void (await i.update(this.consumiblesScreen(i.user.id)));
    const lines = [
      `${pc.emoji} **Adachi Rei reinició tu día.** *«Proceso completado. Sus datos de hoy fueron… reiniciados. Lo ganado se conserva.»*`,
      `• 💬 ${r.mensajes ? `${r.mensajes} ${r.mensajes === 1 ? "mensaje vuelve" : "mensajes vuelven"} a tu cuota` : "tu cuota está llena"}`,
      `• 🎰 ${r.tiradas ? `${r.tiradas} ${r.tiradas === 1 ? "tirada vuelve" : "tiradas vuelven"} a la ruleta (/ruleta)` : "la ruleta cuenta de cero (cada misión cumplida da su tirada)"}`,
      `• 🧠 la trivia vuelve a la partida 1 con XP${r.xpTrivia ? ` (llevabas ${fmt(r.xpTrivia)} XP de trivia hoy, que se quedan)` : ""}`,
      `• 🪙 el tope de monedas por actividad vuelve a empezar (te quedas las ${fmt(r.monedas)} de hoy)`,
      `-# Te quedan ${r.usos} ${r.usos === 1 ? "uso" : "usos"} del ${pc.nombre}.`,
      "",
    ];
    await i.update(this.consumiblesScreen(i.user.id, lines.join("\n")));
    this.d.log(`💻 PC de Adachi Rei: ${i.user.id} reinició su día (${JSON.stringify(r)})`);
    await this.d.report(`💻 <@${i.user.id}> usó el PC de Adachi Rei: +${r.mensajes} mensajes, ${r.tiradas} tiradas y ${r.partidas} partidas de trivia de vuelta (le quedan ${r.usos} usos).`);
  }

  /**
   * Rol de adorno del mercado (Triple Baka Pirata): lo crea si falta, con su color, lo más arriba que Teto puede pero bajo
   * Neru (si no, Neru no podría moderar a quien lo tenga), y se lo pone.
   */
  private async giveRole(userId: string, o: ObjetoMercado): Promise<void> {
    const client = this.d.clients.teto!;
    const guild = await client.guilds.fetch(this.d.guild().id);
    let role = guild.roles.cache.find((r) => channelKey(r.name) === channelKey(o.rol!));
    if (!role) {
      role = await guild.roles.create({ name: o.rol!, colors: { primaryColor: parseInt(o.color!.slice(1), 16) }, permissions: [], mentionable: false, hoist: false, reason: "Rol del mercado negro" });
      const neruId = this.d.clients.neru?.user?.id;
      const neru = neruId ? await guild.members.fetch(neruId).catch(() => null) : null;
      const ceiling = Math.min(guild.members.me?.roles.highest.position ?? 0, neru?.roles.highest.position ?? Infinity);
      if (ceiling > 1) await role.setPosition(ceiling - 1).catch((e) => logError("posición del rol del mercado", e));
    }
    await guild.members.addRole({ user: userId, role: role.id, reason: `Lo compró en el mercado negro (${o.id})` });
  }
}
