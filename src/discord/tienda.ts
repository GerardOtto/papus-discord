// Tienda de las Shaulitas en Discord (PLAN §3.6). Teto fija en #tienda-shaula un menú con dibujos y botones; cada
// botón abre pantallas privadas (solo las ve quien toca) para ver la vitrina, abrir sobres, mirar la colección,
// equipar la tarjeta y, con membresía (PLAN §2), abrir los sobres temáticos elegibles, recuperar objetos de vitrinas
// pasadas y ver la vitrina que viene. Las Shaulitas ya no se venden (13 nov. 2026): se ganan jugando. Miku anuncia
// cada vitrina nueva. Las reglas y el estado viven en src/coins/ y src/membresias/.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIMessageComponentEmoji,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type SendableChannels,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { BotId } from "../config";
import { kvDelete, kvGet, kvSet, type Db } from "../db/database";
import { toCardEquip } from "../coins/equip";
import { coleccionSheet, menuTiendaImage, monederoImage, stackImages, sobreGif, TIENDA_DIR, vitrinaImage } from "../coins/images";
import { RAREZA_NOMBRE, RAREZAS_REGALO, TIPO_NOMBRE, TIPOS, TIPOS_SOBRE, addDays, priceOf, sobreKind, weekday, type Objeto, type Tipo, type TipoSobre } from "../coins/rules";
import { conDescuento, type CoinService, type SobreResult } from "../coins/service";
import { nombreTema } from "../coins/temas";
import { stripNickTag } from "../levels/rules";
import { limpiarTitulo, type NivelMembresia } from "../membresias/rules";
import type { MembresiaService } from "../membresias/service";
import { logError, type LogFn } from "../log";
import { loadPremiosIdeas, pagarPremiosIdeas } from "../coins/premios";
import type { Phrases } from "../phrases/catalog";
import { channelKey, findTextChannel } from "./channels";
import { fileVersion, StoredImages } from "./imagenes-fijas";
import { cardFile, type LevelsDiscord } from "./levels";
import type { TarjetaWeb } from "./tarjeta-web";

const P = "tienda:";
const MENU_KEY = "tienda:menu";
const MENU_VERSION = "4";
const VITRINA_KEY = "tienda:vitrina_anunciada";
/** El mensaje del último anuncio de vitrina (para borrarlo cuando sale la siguiente). */
const VITRINA_MSG_KEY = "tienda:vitrina_mensaje";
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));
const DIAS = ["el domingo", "el lunes", "el martes", "el miércoles", "el jueves", "el viernes", "el sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "24 de noviembre" (día AAAA-MM-DD). */
const fecha = (day: string) => `${Number(day.slice(8, 10))} de ${MESES[Number(day.slice(5, 7)) - 1]}`;
const RAREZA_ICONO: Record<string, string> = { comun: "⬜", rara: "🟦", epica: "🟪", legendaria: "🟨", mitica: "🌈", fundador: "⭐", membresia: "💎", contrabando: "🕶️", prestigio: "🌟" };

/** Kawaiimojis de los botones: emojis propios de la app de Teto (no ocupan lugares del servidor). Sin ellos, estos. */
const ICONOS = ["moneda", "tienda", "sobre", "mochila", "tarjeta", "ayuda", "banco", "mundo", "volver", "probar", "ok", "monedero"] as const;
type Icono = (typeof ICONOS)[number];
const FALLBACK: Record<Icono, string> = { moneda: "🪙", tienda: "🛒", sobre: "🎁", mochila: "🎒", tarjeta: "🪪", ayuda: "❓", banco: "🏦", mundo: "🌎", volver: "⬅️", probar: "✨", ok: "✅", monedero: "👛" };

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
interface Screen {
  content: string;
  files?: AttachmentBuilder[];
  /** Imagen fija ya guardada (src/discord/imagenes-fijas.ts): se muestra sin volver a subirla. */
  embeds?: EmbedBuilder[];
  components?: Row[];
}

export interface TiendaDiscordDeps {
  coins: CoinService;
  levelsDiscord: LevelsDiscord;
  phrases: Phrases;
  db: Db;
  owners: ReadonlySet<string>;
  clients: Record<BotId, Client>;
  online: readonly BotId[];
  /** Beneficios de las membresías (sobres elegibles, recuperar, descuento, vitrina siguiente). */
  membresias: MembresiaService;
  /** Personalizar la tarjeta en la web (null = sin el botón). */
  web?: TarjetaWeb | null;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  /** Filtro fijo de Neru para lo que escribe un Papu (título propio): el motivo si no pasa, o null. Nunca el LLM. */
  filtro?: (text: string) => string | null;
  log: LogFn;
}

export class TiendaDiscord {
  private emojis = new Map<Icono, APIMessageComponentEmoji & { text: string }>();
  private lastHourly = 0;
  /** Las imágenes pesadas (GIF de tarjetas y sobres) se dibujan de a una: el servidor es chico. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly fijas: StoredImages;
  private readonly versions = new Map<string, string>();

  constructor(private readonly d: TiendaDiscordDeps) {
    this.fijas = new StoredImages({ db: d.db, guild: d.guild });
  }

  /**
   * Imagen fija: se sube una vez y las pantallas la reutilizan (en un embed); si no se pudo guardar, se sube como
   * siempre. `version` cambia solo cuando la imagen cambia.
   */
  private async picture(key: string, version: string, make: () => Promise<Buffer>, name: string): Promise<Pick<Screen, "files" | "embeds">> {
    const url = await this.fijas.url(key, version, make, name).catch((e) => (logError(`imagen fija ${key}`, e), null));
    if (url) return { embeds: [new EmbedBuilder().setColor(0x2b2d31).setImage(url)] };
    return { files: [new AttachmentBuilder(await make(), { name })] };
  }

  /** Versión de una imagen de assets/tienda (por su contenido; se calcula una vez). */
  private assetVersion(...rels: string[]): string {
    const key = rels.join("|");
    let v = this.versions.get(key);
    if (!v) this.versions.set(key, (v = fileVersion(...rels.map((r) => path.join(TIENDA_DIR, r)))));
    return v;
  }

  private staticPicture(rel: string, name: string) {
    return this.picture(rel, this.assetVersion(rel), async () => readFileSync(path.join(TIENDA_DIR, rel)), name);
  }

  private get c(): CoinService {
    return this.d.coins;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // ───────────────────────── arranque y tareas ─────────────────────────

  /** Al conectar: emojis, paquete de fundadores y menú fijado. */
  async start(): Promise<void> {
    await this.loadEmojis().catch((e) => logError("emojis de la tienda", e));
    const founders = this.c.grantFounders();
    if (founders.length) await this.report(`⭐ Paquete de fundadores entregado a ${founders.map((id) => `<@${id}>`).join(", ")}.`);
    for (const e of this.c.grantExclusivos()) await this.report(`🎁 Objeto exclusivo **${e.objeto.nombre}** entregado a <@${e.userId}>.`);
    // Premio por ideas incorporadas (config/premios-ideas.json; GyroP, 18 nov. 2026): una vez por ronda y por Papu.
    try {
      const pagos = pagarPremiosIdeas(this.d.db, this.c, loadPremiosIdeas());
      if (pagos.length)
        await this.report(`💡 Premio por ideas: ${pagos.map((p) => `<@${p.id}> **${p.monto}** (${p.ideas} ${p.ideas === 1 ? "idea" : "ideas"})`).join(" · ")}. Total: ${pagos.reduce((a, p) => a + p.monto, 0)} Shaulitas.`);
    } catch (e) {
      logError("premio por ideas", e);
    }
    await this.ensureMenu().catch((e) => logError("menú de la tienda", e));
    await this.tick().catch((e) => logError("tienda", e));
  }

  /** Cada minuto: vitrina nueva (Miku la anuncia); cada hora: regalos de membresía. */
  async tick(): Promise<void> {
    if (!this.c.settings.activo) return;
    await this.announceVitrina().catch((e) => logError("vitrina nueva", e));
    if (Date.now() - this.lastHourly < 3_600_000) return;
    this.lastHourly = Date.now();
    await this.membershipGifts().catch((e) => logError("regalos de membresía", e));
    await this.colorCleanup().catch((e) => logError("colores propios", e));
  }

  private async loadEmojis(): Promise<void> {
    const app = this.d.clients.teto.application;
    if (!app) return;
    const existing = await app.emojis.fetch();
    for (const name of ICONOS) {
      const key = `tienda_${name}`;
      let e = existing.find((x) => x.name === key) ?? null;
      if (!e) e = await app.emojis.create({ attachment: readFileSync(path.join(TIENDA_DIR, "iconos", `${name}.png`)), name: key }).catch(() => null);
      if (e) this.emojis.set(name, { id: e.id, name: key, text: `<:${key}:${e.id}>` });
    }
  }

  private icon(name: Icono): string {
    return this.emojis.get(name)?.text ?? FALLBACK[name];
  }

  private btn(id: string, label: string, opts: { icon?: Icono; style?: ButtonStyle; disabled?: boolean } = {}): ButtonBuilder {
    const b = new ButtonBuilder().setCustomId(`${P}${id}`).setLabel(label.slice(0, 80)).setStyle(opts.style ?? ButtonStyle.Secondary).setDisabled(!!opts.disabled);
    if (opts.icon) {
      const e = this.emojis.get(opts.icon);
      b.setEmoji(e ? { id: e.id, name: e.name } : FALLBACK[opts.icon]);
    }
    return b;
  }

  private row(...items: MessageActionRowComponentBuilder[]): Row {
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...items);
  }

  private back(to = "n:menu"): Row {
    return this.row(this.btn(to, to === "n:menu" ? "Menú" : "Volver", { icon: "volver" }));
  }

  private report(text: string): Promise<void> {
    return this.d.report(text);
  }

  private channel(key: "tienda") {
    return findTextChannel(this.d.guild(), this.c.settings.canales[key]);
  }

  /** Nivel de membresía de un Papu (según sus roles en el servidor), o null. */
  private async nivel(userId: string): Promise<NivelMembresia | null> {
    const mb = this.d.guild().members.cache.get(userId) ?? (await this.d.guild().members.fetch(userId).catch(() => null));
    return mb ? this.d.membresias.nivel(mb.roles.cache.map((r) => r.name)) : null;
  }

  private menuButtons(prefix: "m" | "n"): Row[] {
    return [
      this.row(
        this.btn(`${prefix}:membresia`, "Mi membresía", { icon: "monedero", style: ButtonStyle.Success }),
        this.btn(`${prefix}:vitrina`, "Tienda de la semana", { icon: "tienda", style: ButtonStyle.Primary }),
        this.btn(`${prefix}:sobres`, "Sobres", { icon: "sobre", style: ButtonStyle.Primary }),
      ),
      this.row(
        this.btn(`${prefix}:coleccion`, "Mi colección", { icon: "mochila" }),
        this.btn(`${prefix}:tarjeta`, "Mi tarjeta", { icon: "tarjeta" }),
        this.btn(`${prefix}:ayuda`, "Ayuda", { icon: "ayuda" }),
      ),
    ];
  }

  /** El mensaje fijado del canal: banner, menú ilustrado y los 6 botones (se edita si cambia la versión). */
  private async ensureMenu(): Promise<void> {
    const ch = this.channel("tienda");
    if (!ch) return void this.d.log(`Tienda: falta el canal #${this.c.settings.canales.tienda} (npm run servidor -- --apply)`);
    const payload = {
      content: `¡Hola, Papu! ${this.icon("moneda")} Aquí gastas tus Shaulitas, abres sobres y adornas tu tarjeta de nivel. **Toca un botón:** solo tú ves lo que abres.\n📅 ${this.temporada()}\n-# Las Shaulitas se ganan jugando (no se venden). Con membresía de Ko-fi tienes sobres temáticos para elegir, descuentos y objetos de vitrinas pasadas: «Mi membresía».`,
      files: [new AttachmentBuilder(await menuTiendaImage(), { name: "tienda-shaula.png" })],
      components: this.menuButtons("m"),
    };
    const prev = JSON.parse(kvGet(this.d.db, MENU_KEY) ?? "null") as { channelId: string; messageId: string; version: string } | null;
    const send = await this.d.sendable("teto", ch.id);
    if (!("messages" in send)) return;
    if (prev?.channelId === ch.id) {
      const msg = await send.messages.fetch(prev.messageId).catch(() => null);
      if (msg) {
        if (prev.version !== MENU_VERSION) await msg.edit({ ...payload, attachments: [] });
        kvSet(this.d.db, MENU_KEY, JSON.stringify({ ...prev, version: MENU_VERSION }));
        return;
      }
    }
    const msg = await send.send(payload);
    await msg.pin().catch(() => {});
    kvSet(this.d.db, MENU_KEY, JSON.stringify({ channelId: ch.id, messageId: msg.id, version: MENU_VERSION }));
  }

  private async announceVitrina(): Promise<void> {
    const v = this.c.vitrina();
    if (!v || kvGet(this.d.db, VITRINA_KEY) === v.desde) return;
    const ch = this.channel("tienda");
    if (!ch) return;
    kvSet(this.d.db, VITRINA_KEY, v.desde);
    const bot: BotId = this.d.online.includes("miku") ? "miku" : "teto";
    const send = await this.d.sendable(bot, ch.id);
    const cartas = v.objetos.map((id) => this.c.byId.get(id)!).map((objeto) => ({ objeto, precio: priceOf(this.c.settings, objeto) ?? 0, propio: false }));
    const img = await this.serial(() => vitrinaImage(cartas, "Vitrina nueva", `Cambia ${this.nextChange(v.hasta)} · ${this.temporada(true)}`));
    // La imagen de la vitrina anterior se borra: en el canal queda solo la de ahora (pedido de GyroP, 10 nov. 2026).
    await this.deleteVitrinaAnterior().catch((e) => logError("borrar la vitrina anterior", e));
    const msg = await send.send({
      content: this.d.phrases.pick(bot, "vitrina_nueva", { proxima: this.nextChange(v.hasta) }),
      files: [new AttachmentBuilder(img, { name: "vitrina.png" })],
      allowedMentions: { parse: [] },
    });
    kvSet(this.d.db, VITRINA_MSG_KEY, JSON.stringify({ bot, channelId: ch.id, messageId: msg.id }));
  }

  /** Borra el anuncio de la vitrina anterior (si sigue ahí). */
  private async deleteVitrinaAnterior(): Promise<void> {
    const prev = JSON.parse(kvGet(this.d.db, VITRINA_MSG_KEY) ?? "null") as { bot: BotId; channelId: string; messageId: string } | null;
    if (prev) {
      const send = await this.d.sendable(prev.bot, prev.channelId).catch(() => null);
      if (!send || !("messages" in send)) return;
      await (await send.messages.fetch(prev.messageId).catch(() => null))?.delete();
      return;
    }
    // Vitrinas de antes de guardar el mensaje: se buscan entre los últimos del canal (de Miku o Teto, con vitrina.png).
    const ch = this.channel("tienda");
    if (!ch) return;
    for (const bot of ["miku", "teto"] as const) {
      const me = this.d.clients[bot]?.user?.id;
      if (!me || !this.d.online.includes(bot)) continue;
      const send = await this.d.sendable(bot, ch.id).catch(() => null);
      if (!send || !("messages" in send)) continue;
      const recent = await send.messages.fetch({ limit: 50 }).catch(() => null);
      for (const m of recent?.values() ?? []) {
        if (m.author.id === me && m.attachments.some((a) => a.name === "vitrina.png")) await m.delete().catch(() => {});
      }
    }
  }

  /** "Temporada 1 «Lanzamiento»: sus objetos están hasta el 24 de noviembre." (corto: para las imágenes). */
  private temporada(corto = false): string {
    const t = this.c.settings.temporada;
    const n = t.id.replace(/^t/, "");
    const ultimo = fecha(addDays(t.hasta, -1));
    return corto ? `Temporada ${n} hasta el ${ultimo}` : `**Temporada ${n} «${t.nombre}»**: sus objetos están hasta el **${ultimo}**.`;
  }

  private nextChange(day: string): string {
    return DIAS[weekday(day)]!;
  }

  /**
   * Regalo de membresía (PLAN §2): al tener el rol y luego cada 30 días, sobres temáticos para elegir (y uno mítico en
   * Triple Baka), un mes más de antigüedad y sus insignias. Teto le avisa por privado.
   */
  private async membershipGifts(): Promise<void> {
    const guild = this.d.guild();
    const tiers = this.d.membresias.settings.niveles.map((n) => n.rol);
    const members = new Set<string>();
    for (const role of guild.roles.cache.values()) if (tiers.includes(role.name)) for (const id of role.members.keys()) members.add(id);
    for (const id of members) {
      const mb = guild.members.cache.get(id);
      if (!mb || mb.user.bot) continue;
      const roles = mb.roles.cache.map((r) => r.name);
      await this.membershipBadges(id, roles);
      const n = this.d.membresias.nivel(roles);
      const fondo = n ? this.d.membresias.fondoTemporada(id, n) : null;
      if (fondo) await this.report(`🖼️ Fondo de membresía «${fondo.nombre}» para <@${id}> (${n!.rol}).`);
      const gift = n ? this.d.membresias.regalo(id, n) : null;
      if (!n || !gift) continue;
      const sobres = `${gift.sobres} ${gift.sobres === 1 ? "sobre temático" : "sobres temáticos"}${gift.miticos ? ` y ${gift.miticos} mítico` : ""}`;
      const ins = gift.insignias.length ? ` y la insignia ${gift.insignias.map((o) => `${o.valor} ${o.nombre}`).join(", ")}` : "";
      await this.report(`🎁 Regalo de membresía (${n.rol}): <@${id}> recibió ${sobres}${ins} · ${gift.meses} ${gift.meses === 1 ? "mes" : "meses"} con membresía.`);
      await this.dm(id, `🎁 ¡Gracias por tu membresía ${n.emoji} **${n.nombre}**! Te dejé **${sobres}** para que elijas tus objetos${ins}. Ábrelos en #tienda-shaula → **Mi membresía** (o con /tienda). 💖`);
    }
  }

  /**
   * Insignias de membresía (pedido de GyroP, 31 oct. 2026): la del rol de Ko-fi, para siempre. La app la llama también
   * cuando un Papu recibe el rol; aquí, cada hora y al conectar (así quienes ya lo tenían la reciben al instante).
   */
  async membershipBadges(userId: string, roleNames: string[]): Promise<void> {
    const nuevas = this.c.membershipBadges(userId, roleNames);
    if (nuevas.length) await this.report(`💎 Insignia de membresía para <@${userId}>: ${nuevas.map((o) => `${o.valor} ${o.nombre}`).join(", ")}.`);
  }

  // ───────────────────────── pantallas ─────────────────────────

  private header(userId: string): string {
    this.c.sync(userId, 7);
    const w = this.c.wallet(userId);
    const especiales = [w.gratisRaro ? `**${w.gratisRaro}** raro${w.gratisRaro === 1 ? "" : "s"}` : "", w.gratisLeg ? `**${w.gratisLeg}** legendario${w.gratisLeg === 1 ? "" : "s"}` : ""].filter(Boolean);
    const gratis = w.gratis || especiales.length ? ` · 🎁 sobres gratis: ${[w.gratis ? `**${w.gratis}** común${w.gratis === 1 ? "" : "es"}` : "", ...especiales].filter(Boolean).join(", ")}` : "";
    const membresia = this.d.membresias.pendientes(userId).length;
    return `${this.icon("moneda")} **${fmt(w.monedas)}** Shaulitas · 🔁 **${fmt(w.ecos)}** Ecos${gratis}${membresia ? ` · 💎 sobres de membresía: **${membresia}**` : ""}`;
  }

  private async screen(userId: string, name: string, arg?: string): Promise<Screen> {
    if (!this.c.settings.activo) return { content: "La tienda está cerrada por ahora. 🥖", components: [] };
    switch (name) {
      case "menu": return this.menuScreen(userId);
      case "membresia": return this.membresiaScreen(userId);
      case "msobre": return this.msobreScreen(userId, Number(arg));
      case "recuperar": return this.recuperarScreen(userId, (arg as Tipo) ?? "fondo");
      case "rprobar": return this.rprobarScreen(userId, arg!);
      case "siguiente": return this.siguienteScreen(userId);
      case "vitrina": return this.vitrinaScreen(userId);
      case "probar": return this.probarScreen(userId, arg!);
      case "confirmar": return this.confirmarScreen(userId, arg!);
      case "sobres": return this.sobresScreen(userId);
      case "coleccion": return this.coleccionScreen(userId, (arg as Tipo) ?? "fondo");
      case "fabricar": return this.fabricarScreen(userId, (arg as Tipo) ?? "fondo");
      case "tarjeta": return this.tarjetaScreen(userId);
      case "equipar": return await this.equiparScreen(userId, arg as Tipo);
      case "ayuda": return this.ayudaScreen(userId);
      default: return this.menuScreen(userId);
    }
  }

  private async menuScreen(userId: string): Promise<Screen> {
    return {
      content: `${this.header(userId)}\n¿Qué quieres hacer?`,
      ...(await this.staticPicture("menu.png", "menu.png")),
      components: this.menuButtons("n"),
    };
  }

  // ───────────────────────── membresía (PLAN §2) ─────────────────────────

  private async membresiaScreen(userId: string): Promise<Screen> {
    const head = this.header(userId);
    const n = await this.nivel(userId);
    const m = this.d.membresias;
    const sobres = m.pendientes(userId);
    if (!n) {
      return {
        content: [
          head,
          `## 💎 Membresías`,
          "Aún no tienes membresía de Ko-fi. Con una tienes, según el nivel: **más XP**, lanzar **peleas, carreras y bodas**, **sobres temáticos** cada mes (eliges qué objetos te llevas, sin azar), recuperar objetos de **vitrinas pasadas**, **descuento** en la tienda y ver la **vitrina siguiente** antes que nadie.",
          "Todos los detalles en #💎・membresías.",
        ].join("\n"),
        components: [...(sobres.length ? [this.row(this.btn(`n:msobre:${sobres[0]!.id}`, `Abrir sobre (${sobres.length})`, { icon: "sobre", style: ButtonStyle.Success }))] : []), this.back()],
      };
    }
    const day = this.c.day();
    const peleas = m.lanzadosHoy(userId, "pelea", day);
    const bodas = m.lanzadosHoy(userId, "boda", day);
    const carreras = m.lanzadosHoy(userId, "carrera", day);
    const rec = m.recuperadosPeriodo(userId);
    const lineas = [
      head,
      `## ${n.emoji} Tu membresía ${n.nombre}`,
      `✨ XP **×${String(n.xp).replace(".", ",")}** · 🛒 **${n.descuento} %** de descuento en la tienda · 📅 ${m.meses(userId)} ${m.meses(userId) === 1 ? "mes" : "meses"} con membresía`,
      `⚔️ Peleas para lanzar hoy: **${Math.max(0, n.peleas.dia - peleas)} de ${n.peleas.dia}** (${n.peleas.elige ? "eliges a los luchadores" : "al azar"}) · usa \`/pelea\``,
      n.carreras?.dia ? `🏇 Carreras para lanzar hoy: **${Math.max(0, n.carreras.dia - carreras)} de ${n.carreras.dia}** (corredores al azar) · usa \`/carrera\`` : "",
      n.bodas.dia ? `💍 Bodas para lanzar hoy: **${Math.max(0, n.bodas.dia - bodas)} de ${n.bodas.dia}** (${n.bodas.elige ? "eliges a la Vocaloid" : "al azar"}) · usa \`/boda\`` : "",
      `🎁 Sobres por abrir: **${sobres.length}** · llegan ${n.sobres.cantidad === 1 ? "1 sobre" : `${n.sobres.cantidad} sobres`} cada ${m.settings.periodoDias} días (ves ${n.sobres.ve} objetos y eliges ${n.sobres.elige})${n.sobres.mitico ? " + 1 mítico" : ""}`,
      `♻️ Objetos de vitrinas pasadas: **${Math.max(0, n.recuperar - rec)} de ${n.recuperar}** para recuperar estos ${m.settings.periodoDias} días`,
    ].filter(Boolean);
    const botones = [
      this.btn(sobres.length ? `n:msobre:${sobres[0]!.id}` : "n:membresia", `Abrir sobre (${sobres.length})`, { icon: "sobre", style: ButtonStyle.Success, disabled: !sobres.length }),
      this.btn("n:recuperar", "Vitrinas pasadas", { icon: "tienda", style: ButtonStyle.Primary, disabled: rec >= n.recuperar }),
      ...(n.vitrinaSiguiente ? [this.btn("n:siguiente", "Vitrina siguiente", { icon: "probar" })] : []),
    ];
    return { content: lineas.join("\n"), components: [this.row(...botones), this.back()] };
  }

  /** Un sobre de membresía (o de prestigio): primero el tema, después elegir los objetos. */
  private async msobreScreen(userId: string, id: number): Promise<Screen> {
    const s = this.d.membresias.sobre(id);
    if (!s || s.userId !== userId || s.abiertoAt !== null) return this.membresiaScreen(userId);
    const nombre = s.clase === "mitico" ? "Sobre mítico" : s.clase === "prestigio" ? "Sobre de prestigio" : "Sobre temático";
    if (!s.opciones) {
      const temas = this.d.membresias.temas(userId, s);
      const head = `## 🎁 ${nombre} · ${s.origen}\n${s.clase === "mitico" ? "Mira las míticas que te faltan y **elige 1**." : `Elige el **tema**: verás **${s.ve}** objetos de ese tema que te faltan y te llevas **${s.elige}**. Nada de azar.`}${s.clase === "prestigio" ? " Este sí puede traer fondos con Vocaloids y míticas." : ""}`;
      if (!temas.length) return { content: `${head}\n\n🎉 ¡Ya tienes todo lo que puede traer este sobre! Guárdalo para cuando lleguen objetos nuevos.`, components: [this.back("n:membresia")] };
      if (s.clase === "mitico") {
        const r = this.d.membresias.elegirTema(userId, id, "todo");
        if ("ok" in r) return { content: `${head}\n${r.motivo}`, components: [this.back("n:membresia")] };
        return this.msobreScreen(userId, id);
      }
      return {
        content: head,
        components: [
          this.row(
            new StringSelectMenuBuilder()
              .setCustomId(`${P}s:mtema:${id}`)
              .setPlaceholder("Elige el tema del sobre")
              .addOptions(temas.slice(0, 25).map((t) => ({ label: t.nombre.slice(0, 100), description: `Te faltan ${t.faltan} de este tema`, value: t.id, emoji: t.emoji }))),
          ),
          this.back("n:membresia"),
        ],
      };
    }
    const objs = s.opciones.map((x) => this.c.byId.get(x)!).filter(Boolean);
    const own = this.c.owned(userId);
    const libres = objs.filter((o) => !own.has(o.id));
    const pide = Math.min(s.elige, libres.length);
    const sheet = await this.serial(() => coleccionSheet(objs, new Set(objs.map((o) => o.id)), `${nombre}: elige ${pide}`));
    return {
      content: `## 🎁 ${nombre} · ${s.origen}\nEstos son tus objetos: **elige ${pide}** en la lista y quedan en tu colección.`,
      files: [new AttachmentBuilder(sheet, { name: "sobre-membresia.png" })],
      components: [
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}s:melegir:${id}`)
            .setPlaceholder(`Elige ${pide} ${pide === 1 ? "objeto" : "objetos"}`)
            .setMinValues(pide)
            .setMaxValues(pide)
            .addOptions(libres.slice(0, 25).map((o) => ({ label: o.nombre.slice(0, 100), description: `${RAREZA_NOMBRE[o.rareza]} · ${TIPO_NOMBRE[o.tipo]}`.slice(0, 100), value: o.id, emoji: RAREZA_ICONO[o.rareza] }))),
        ),
        this.row(...(s.clase === "mitico" ? [] : [this.btn(`a:mcambiar:${id}`, "Cambiar tema", { icon: "volver" })]), this.btn("n:membresia", "Después", { icon: "volver" })),
      ],
    };
  }

  /** Objetos de vitrinas pasadas para recuperar (por tipo, como la colección). */
  private async recuperarScreen(userId: string, tipo: Tipo): Promise<Screen> {
    const n = await this.nivel(userId);
    if (!n) return this.membresiaScreen(userId);
    const lista = this.d.membresias.recuperables(userId);
    const deTipo = lista.filter((o) => o.tipo === tipo);
    const quedan = Math.max(0, n.recuperar - this.d.membresias.recuperadosPeriodo(userId));
    const tabs = TIPOS.map((t) => this.btn(`n:recuperar:${t}`, `${TIPO_NOMBRE[t]} (${lista.filter((o) => o.tipo === t).length})`, { style: t === tipo ? ButtonStyle.Primary : ButtonStyle.Secondary }));
    const components: Row[] = [this.row(...tabs.slice(0, 4)), this.row(...tabs.slice(4))];
    if (deTipo.length && quedan > 0)
      components.push(
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}s:recuperar`)
            .setPlaceholder("Elige un objeto para probarlo en tu tarjeta")
            .addOptions(
              deTipo.slice(0, 25).map((o) => ({
                label: `${o.nombre} · ${fmt(conDescuento(priceOf(this.c.settings, o)!, n.descuento))} Shaulitas`.slice(0, 100),
                description: `${RAREZA_NOMBRE[o.rareza]} · ${o.temporada === this.c.settings.temporada.id ? "de esta temporada" : "de una temporada pasada"}`.slice(0, 100),
                value: o.id,
                emoji: RAREZA_ICONO[o.rareza],
              })),
            ),
        ),
      );
    components.push(this.back("n:membresia"));
    return {
      content: `${this.header(userId)}\n## ♻️ Vitrinas pasadas\nObjetos que ya salieron en una vitrina (y los de temporadas terminadas). Te quedan **${quedan} de ${n.recuperar}** estos ${this.d.membresias.settings.periodoDias} días, con tu **${n.descuento} %** de descuento.${deTipo.length > 25 ? "\n-# Se muestran los 25 de mayor rareza de este tipo." : ""}${!deTipo.length ? `\nNo hay ${TIPO_NOMBRE[tipo].toLowerCase()} para recuperar.` : ""}`,
      components,
    };
  }

  private async rprobarScreen(userId: string, id: string): Promise<Screen> {
    const o = this.c.byId.get(id);
    const n = await this.nivel(userId);
    if (!o || !n) return this.recuperarScreen(userId, "fondo");
    const precio = conDescuento(priceOf(this.c.settings, o)!, n.descuento);
    const card = await this.preview(userId, o);
    return {
      content: `## ♻️ Así se vería tu tarjeta con ${o.nombre}\n${RAREZA_ICONO[o.rareza]} ${RAREZA_NOMBRE[o.rareza]} · ${TIPO_NOMBRE[o.tipo]} · **${fmt(precio)}** Shaulitas (con tu ${n.descuento} %)\n-# Vista previa: nada se gasta hasta que confirmes.`,
      files: [cardFile(card)],
      components: [this.row(this.btn(`a:recuperar:${o.id}`, `Recuperar por ${fmt(precio)}`, { icon: "moneda", style: ButtonStyle.Success })), this.back(`n:recuperar:${o.tipo}`)],
    };
  }

  /** La vitrina que viene (beneficio de membresía). */
  private async siguienteScreen(userId: string): Promise<Screen> {
    const n = await this.nivel(userId);
    if (!n?.vitrinaSiguiente) return this.membresiaScreen(userId);
    const hoy = this.c.vitrina();
    const next = this.c.schedule.find((v) => v.desde > (hoy?.desde ?? this.c.day()));
    if (!next) return { content: "Todavía no hay vitrina siguiente: la temporada termina con esta. 📅", components: [this.back("n:membresia")] };
    const pic = await this.picture("vitrina-siguiente", `${next.desde}-${next.objetos.join(",")}`, () => this.vitrinaPng(next.objetos, next.hasta, "Vitrina siguiente"), "vitrina-siguiente.png");
    return {
      content: `## ✨ Vitrina siguiente\nAbre **${this.nextChange(next.desde)} ${fecha(next.desde)}** a medianoche de Chile. Solo las membresías la ven antes. 🤫`,
      ...pic,
      components: [this.back("n:membresia")],
    };
  }

  private async vitrinaScreen(userId: string): Promise<Screen> {
    const v = this.c.vitrina();
    if (!v) return { content: "No hay vitrina abierta ahora: la temporada aún no empieza o ya terminó. ¡Vuelve pronto!", components: [this.back()] };
    const own = this.c.owned(userId);
    const objs = v.objetos.map((id) => this.c.byId.get(id)!);
    // La misma imagen para todos durante toda la vitrina (lunes o jueves): se dibuja una vez. Lo que ya tienes va en el texto.
    const pic = await this.picture("vitrina", `${v.desde}-${v.objetos.join(",")}`, () => this.vitrinaPng(v.objetos, v.hasta), "vitrina.png");
    const disponibles = objs.filter((o) => !own.has(o.id));
    const tienes = objs.filter((o) => own.has(o.id)).map((o) => o.nombre);
    const desc = (await this.nivel(userId))?.descuento ?? 0;
    const components: Row[] = [];
    if (disponibles.length)
      components.push(
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}s:vitrina`)
            .setPlaceholder("Elige un objeto para probarlo en tu tarjeta")
            .addOptions(
              disponibles.map((o) => ({
                label: `${o.nombre} · ${fmt(conDescuento(priceOf(this.c.settings, o)!, desc))} Shaulitas`.slice(0, 100),
                description: `${RAREZA_NOMBRE[o.rareza]} · ${TIPO_NOMBRE[o.tipo]}`.slice(0, 100),
                value: o.id,
                emoji: RAREZA_ICONO[o.rareza],
              })),
            ),
        ),
      );
    components.push(this.back());
    return {
      content: `${this.header(userId)}\n## ${this.icon("tienda")} Tienda de la semana\n📅 ${this.temporada()}${desc ? `\n💎 Tu membresía te da **${desc} %** de descuento (ya está en los precios de la lista).` : ""}${tienes.length ? `\n✅ Ya tienes: ${tienes.join(", ")}.` : ""}${disponibles.length ? "" : "\n🎉 ¡Ya tienes todo lo de esta vitrina!"}`,
      ...pic,
      components,
    };
  }

  /** La vitrina dibujada (la misma para todos, con los precios de tienda). */
  private vitrinaPng(ids: string[], hasta: string, titulo = "Tienda de la semana"): Promise<Buffer> {
    const cartas = ids.map((id) => this.c.byId.get(id)!).map((objeto) => ({ objeto, precio: priceOf(this.c.settings, objeto) ?? 0, propio: false }));
    return this.serial(() => vitrinaImage(cartas, titulo, `Cambia ${this.nextChange(hasta)} · ${this.temporada(true)}`));
  }

  /** Lo equipado con un objeto de prueba puesto encima. */
  private async preview(userId: string, o: Objeto) {
    const eq = new Map(this.c.equipped(userId));
    if (o.tipo === "insignia") {
      const ins = [o, ...[...eq.entries()].filter(([k]) => k.startsWith("insignia")).map(([, v]) => v).filter((x) => x.id !== o.id)].slice(0, await this.maxInsignias(userId));
      for (const k of [...eq.keys()]) if (k.startsWith("insignia")) eq.delete(k);
      ins.forEach((x, i) => eq.set(`insignia${i + 1}`, x));
    } else eq.set(o.tipo, o);
    return this.serial(async () => this.d.levelsDiscord.card(userId, await toCardEquip(eq, this.c.founderNumber(userId))));
  }

  private async probarScreen(userId: string, id: string): Promise<Screen> {
    const o = this.c.byId.get(id);
    if (!o) return this.vitrinaScreen(userId);
    const card = await this.preview(userId, o);
    const desc = (await this.nivel(userId))?.descuento ?? 0;
    const precio = conDescuento(priceOf(this.c.settings, o)!, desc);
    return {
      content: `## ${this.icon("probar")} Así se vería tu tarjeta con ${o.nombre}\n${RAREZA_ICONO[o.rareza]} ${RAREZA_NOMBRE[o.rareza]} · ${TIPO_NOMBRE[o.tipo]} · **${fmt(precio)}** Shaulitas${desc ? ` (con tu ${desc} % de membresía)` : ""}\n-# Vista previa: nada se gasta hasta que confirmes.`,
      files: [cardFile(card)],
      components: [this.row(this.btn(`n:confirmar:${o.id}`, `Comprar por ${fmt(precio)}`, { icon: "moneda", style: ButtonStyle.Success })), this.back("n:vitrina")],
    };
  }

  private async confirmarScreen(userId: string, id: string): Promise<Screen> {
    const o = this.c.byId.get(id)!;
    const precio = conDescuento(priceOf(this.c.settings, o)!, (await this.nivel(userId))?.descuento ?? 0);
    this.c.sync(userId, 7);
    const w = this.c.wallet(userId);
    if (w.monedas < precio)
      return {
        content: `Te faltan **${fmt(precio - w.monedas)}** Shaulitas para ${o.nombre} (${fmt(precio)}). Se ganan jugando: chatea, entra a voz, completa las misiones de /ruleta y juega /trivia.`,
        components: [this.row(this.btn("n:vitrina", "Volver", { icon: "volver" }))],
      };
    return {
      content: `## ¿Compras ${o.nombre}?\nCuesta **${fmt(precio)}** Shaulitas (te quedarían ${fmt(w.monedas - precio)}).`,
      components: [this.row(this.btn(`a:comprar:${o.id}`, "Sí, comprar", { icon: "ok", style: ButtonStyle.Success }), this.btn("n:vitrina", "Cancelar", { style: ButtonStyle.Danger }))],
    };
  }

  private async sobresScreen(userId: string): Promise<Screen> {
    const head = this.header(userId);
    const w = this.c.wallet(userId);
    const s = this.c.settings.sobre;
    // Fila 1: comprar cada clase con Shaulitas. Fila 2: los gratis que tenga, los de membresía (y Probabilidades).
    const free: ButtonBuilder[] = [];
    const membresia = this.d.membresias.pendientes(userId);
    if (membresia.length) free.push(this.btn(`n:msobre:${membresia[0]!.id}`, `Membresía (${membresia.length})`, { icon: "sobre", style: ButtonStyle.Success }));
    if (w.gratisLeg) free.push(this.btn("a:sobre:legendario", `Abrir legendario (${w.gratisLeg})`, { icon: "sobre", style: ButtonStyle.Success }));
    if (w.gratisRaro) free.push(this.btn("a:sobre:raro", `Abrir raro (${w.gratisRaro})`, { icon: "sobre", style: ButtonStyle.Success }));
    if (w.gratis) free.push(this.btn("a:sobre:gratis", `Abrir gratis (${w.gratis})`, { icon: "sobre", style: ButtonStyle.Success }));
    free.push(this.btn("n:ayuda", "Probabilidades", { icon: "ayuda" }));
    const corto = { comun: "Común", raro: "Raro", legendario: "Legendario" } as const;
    const paid = TIPOS_SOBRE.map((t) => ({ t, k: sobreKind(this.c.settings, t) }))
      .filter((x) => x.k.precio !== null)
      .map(({ t, k }) =>
        this.btn(t === "comun" ? "a:sobre:pago" : `a:sobre:pago-${t}`, `${corto[t]} · ${fmt(k.precio!)}`, {
          icon: "sobre",
          style: t === "comun" ? ButtonStyle.Primary : ButtonStyle.Secondary,
          disabled: w.monedas < k.precio!,
        }),
      );
    const raro = sobreKind(this.c.settings, "raro");
    const leg = sobreKind(this.c.settings, "legendario");
    const cuantos = (o: [number, number][]) => (o.length === 1 ? `${o[0]![0]}` : `${o[0]![0]} a ${o[o.length - 1]![0]}`);
    const precioDe = (k: { precio: number | null }) => (k.precio !== null ? `**${fmt(k.precio)} Shaulitas**` : "solo de premio");
    // Temáticos (PLAN §3.6): al azar dentro del tema elegido, con renders. Se compran, se hacen con un común regalado + Ecos
    // o se ganan en las bodas (el de esa Vocaloid).
    const t = s.tematico;
    const temas = t ? this.c.temasTematicos().slice(0, 25) : [];
    const regalados = t ? this.c.tematicosPendientes(userId) : [];
    const extra: Row[] = [];
    if (temas.length)
      extra.push(
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}s:tematico`)
            .setPlaceholder(`Sobre temático: elige el tema (${fmt(t!.precio)} Shaulitas)`)
            .addOptions(temas.map((x) => ({ label: `${x.nombre}`.slice(0, 100), description: `${x.faltan} objetos posibles`, value: x.id, emoji: x.emoji }))),
        ),
      );
    if (regalados.length)
      extra.push(this.row(...regalados.slice(0, 5).map((x) => this.btn(`a:tabrir:${x.id}`, `Abrir sobre de ${nombreTema(x.tema).nombre}`.slice(0, 80), { icon: "sobre", style: ButtonStyle.Success }))));
    return {
      content: [
        head,
        `## ${this.icon("sobre")} Sobres`,
        `📅 ${this.temporada()}`,
        `📦 **Sobre común**: ${cuantos(s.objetos)} objetos sorpresa de la temporada · **${fmt(s.precio)} Shaulitas**`,
        `💜 **${raro.nombre}**: ${cuantos(raro.objetos)} objetos, **al menos una Épica** · ${precioDe(raro)}`,
        `💛 **${leg.nombre}**: ${cuantos(leg.objetos)} objetos, **al menos una Legendaria** · ${precioDe(leg)}`,
        ...(t ? [`🎯 **Sobre temático**: como el común, pero solo con objetos del tema que elijas (un Vocaloid, una temporada, Navidad…), renders incluidos · **${fmt(t.precio)} Shaulitas**, o un común regalado + **${fmt(t.ecos)} Ecos**. Ganar una boda te regala uno de esa Vocaloid.`] : []),
        ...(regalados.length ? [`🎁 Tienes **${regalados.length}** sobre${regalados.length === 1 ? "" : "s"} temático${regalados.length === 1 ? "" : "s"} de regalo por abrir.`] : []),
        `Te regalo **un común** cada día que completes todas las misiones de la ruleta (/ruleta), y otro cada lunes si participaste ${s.semanal.diasMinimos} días de la semana anterior; la ruleta también puede darte uno. La trivia regala raros y legendarios (/trivia).`,
        `Garantía Épica: ${w.sinEpica % s.garantiaEpica} de ${s.garantiaEpica} · Garantía Legendaria: ${w.sinLegendaria % s.garantiaLegendaria} de ${s.garantiaLegendaria}. Los repetidos se vuelven Ecos para fabricar lo que te falte.`,
      ].join("\n"),
      ...(await this.staticPicture("sobre-cerrado.png", "sobre.png")),
      components: [this.row(...paid), this.row(...free), ...extra.slice(0, 2), this.back()],
    };
  }

  /** Elegido el tema: comprarlo con Shaulitas o hacerlo con un común regalado + Ecos. */
  private tematicoScreen(userId: string, tema: string): Screen {
    const t = this.c.settings.sobre.tematico!;
    const w = this.c.wallet(userId);
    const { nombre, emoji } = nombreTema(tema);
    const pool = this.c.poolTematico(tema);
    const own = this.c.owned(userId);
    const nuevos = pool.filter((o) => !own.has(o.id)).length;
    const id = tema.replace(":", "~");
    return {
      content: [
        this.header(userId),
        `## ${emoji} Sobre temático: ${nombre}`,
        `Trae objetos **al azar** de este tema (${pool.length} posibles; te faltan **${nuevos}**), con las mismas probabilidades y garantías que el común. Los repetidos se vuelven Ecos.`,
      ].join("\n"),
      components: [
        this.row(
          this.btn(`a:tpago:${id}`, `Comprar · ${fmt(t.precio)}`, { icon: "sobre", style: ButtonStyle.Primary, disabled: w.monedas < t.precio }),
          this.btn(`a:tregalo:${id}`, `Común regalado + ${fmt(t.ecos)} Ecos`, { icon: "sobre", style: ButtonStyle.Success, disabled: w.gratis < 1 || w.ecos < t.ecos }),
        ),
        this.back("n:sobres"),
      ],
    };
  }

  /** Muestra lo que salió de un sobre (solo lo ve quien lo abre). */
  private async sobreAbierto(user: string, r: SobreResult, titulo: string): Promise<Screen> {
    const gif = await this.serial(() => sobreGif(r.objetos, titulo));
    const lines = r.objetos.map((x) => `${RAREZA_ICONO[x.objeto.rareza]} **${x.objeto.nombre}** · ${TIPO_NOMBRE[x.objeto.tipo]}${x.nuevo ? " · ¡nuevo!" : ` · repetido (+${x.ecos} Ecos)`}`);
    return {
      content: [
        `## ${this.icon("sobre")} ${titulo}`,
        // Helado de Kaito (mercado negro): objetos de más en este sobre.
        ...(r.helado ? [`🍦 *El Helado de Kaito le puso ${r.helado === 1 ? "un objeto más" : `${r.helado} objetos más`} a tu sobre (te quedan ${this.c.heladoUsos(user)}).*`] : []),
        ...lines,
        this.header(user),
      ].join("\n"),
      files: [new AttachmentBuilder(gif, { name: "sobre.gif" })],
      components: [this.row(this.btn("n:sobres", "Abrir otro", { icon: "sobre", style: ButtonStyle.Primary }), this.btn("n:tarjeta", "Mi tarjeta", { icon: "tarjeta" }), this.btn("n:coleccion", "Mi colección", { icon: "mochila" }))],
    };
  }

  private async coleccionScreen(userId: string, tipo: Tipo): Promise<Screen> {
    const head = this.header(userId);
    const own = this.c.owned(userId);
    const w = this.c.wallet(userId);
    const objs = this.c.catalog.filter((o) => o.tipo === tipo && (!RAREZAS_REGALO.includes(o.rareza) || own.has(o.id)));
    const name = (await this.d.guild().members.fetch(userId).catch(() => null))?.displayName;
    const [mon, sheet] = await this.serial(async () => [
      await monederoImage(stripNickTag(name ?? "Papu"), w, this.c.settings.sobre.garantiaEpica, this.c.settings.ganar.topeActividad),
      await coleccionSheet(objs, own, `${TIPO_NOMBRE[tipo]} · ${objs.filter((o) => own.has(o.id)).length} de ${objs.length}`),
    ]);
    const tabs = TIPOS.map((t) => this.btn(`n:coleccion:${t}`, TIPO_NOMBRE[t], { style: t === tipo ? ButtonStyle.Primary : ButtonStyle.Secondary }));
    const craftable = objs.some((o) => !own.has(o.id) && priceOf(this.c.settings, o) !== null);
    return {
      content: `${head}\n## ${this.icon("mochila")} Mi colección: ${own.size} objetos\nLos que tienen «?» te faltan: salen en sobres, en la tienda o se fabrican con Ecos.`,
      files: [new AttachmentBuilder(await stackImages([mon, sheet]), { name: "coleccion.png" })],
      components: [this.row(...tabs.slice(0, 4)), this.row(...tabs.slice(4)), this.row(this.btn(`n:fabricar:${tipo}`, "Fabricar con Ecos", { icon: "probar", disabled: !craftable }), this.btn("n:tarjeta", "Mi tarjeta", { icon: "tarjeta" }), this.btn("n:menu", "Menú", { icon: "volver" }))],
    };
  }

  private fabricarScreen(userId: string, tipo: Tipo): Screen {
    const own = this.c.owned(userId);
    const w = this.c.wallet(userId);
    const opts = this.c.catalog
      .filter((o) => o.tipo === tipo && !own.has(o.id) && priceOf(this.c.settings, o) !== null)
      .sort((a, b) => priceOf(this.c.settings, a)! - priceOf(this.c.settings, b)!)
      .slice(0, 25);
    const components: Row[] = [];
    if (opts.length)
      components.push(
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}s:fabricar:${tipo}`)
            .setPlaceholder("Elige qué fabricar")
            .addOptions(opts.map((o) => ({ label: `${o.nombre} · ${fmt(priceOf(this.c.settings, o)!)} Ecos`.slice(0, 100), description: `${RAREZA_NOMBRE[o.rareza]}${w.ecos < priceOf(this.c.settings, o)! ? " · te faltan Ecos" : ""}`, value: o.id, emoji: RAREZA_ICONO[o.rareza] }))),
        ),
      );
    components.push(this.back(`n:coleccion:${tipo}`));
    return { content: `## Fabricar: ${TIPO_NOMBRE[tipo]}\nTienes **${fmt(w.ecos)} Ecos**. Fabricar cuesta lo mismo que en la tienda, pero en Ecos. Las Míticas no se fabrican.`, components };
  }

  private async tarjetaScreen(userId: string): Promise<Screen> {
    const card = await this.serial(() => this.d.levelsDiscord.card(userId));
    const own = this.c.owned(userId);
    const eq = this.c.equipped(userId);
    const propio = !!(await this.nivel(userId))?.tituloPropio;
    const titulo = this.d.membresias.titulo(userId);
    // Enlace privado (30 min) a la página de personalizar la tarjeta, listo en el botón: se abre de un toque (pedido de
    // GyroP, 13 nov. 2026). Se crea cada vez que se muestra esta pantalla, así la página trae lo que lleva puesto ahora.
    const web = this.d.web ? await this.webUrl(userId).catch((e) => (logError("tarjeta web", e), null)) : null;
    return {
      content: `## ${this.icon("tarjeta")} Mi tarjeta\nAsí sale en /nivel, en tus avisos de nivel y en el ranking. Elige qué parte cambiar${web ? " o **personalízala en la web**, tocando las imágenes de tus objetos" : ""}:${propio ? `\n✍️ Tu membresía te deja escribir tu **propio título**${titulo ? ` (ahora: «${titulo}»; va en lugar del título equipado)` : ""}.` : ""}${web ? "\n-# El enlace de la web es solo tuyo (no lo compartas) y vence en 30 minutos; si vence, vuelve a abrir «Mi tarjeta»." : ""}`,
      files: [cardFile(card)],
      components: [
        ...(web || propio
          ? [
              this.row(
                ...(web ? [new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(web).setLabel("Personalizar en la web").setEmoji("🌐")] : []),
                ...(propio ? [this.btn("a:titulo", titulo ? "Cambiar mi título" : "Escribir mi título", { icon: "probar", style: ButtonStyle.Success })] : []),
              ),
            ]
          : []),
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}s:parte`)
            .setPlaceholder("¿Qué quieres cambiar?")
            .addOptions(
              TIPOS.map((t) => {
                const n = this.c.catalog.filter((o) => o.tipo === t && own.has(o.id)).length;
                const puesto = t === "insignia" ? [...eq.entries()].filter(([k]) => k.startsWith("insignia")).map(([, o]) => o.nombre).join(", ") : eq.get(t)?.nombre;
                return { label: TIPO_NOMBRE[t], description: `${n} en tu colección · puesto: ${puesto || "ninguno"}`.slice(0, 100), value: t };
              }),
            ),
        ),
        this.back(),
      ],
    };
  }

  private async webUrl(userId: string): Promise<string> {
    const m = await this.d.guild().members.fetch(userId).catch(() => null);
    return this.d.web!.abrir(userId, m?.displayName ?? m?.user.displayName ?? "Papu");
  }

  /** Cuántas insignias puede ponerse: 3, o 4 con membresía Baguette o más (lugar extra, PLAN §2). */
  private async maxInsignias(userId: string): Promise<number> {
    return (await this.nivel(userId))?.insigniaExtra ? 4 : 3;
  }

  private async equiparScreen(userId: string, tipo: Tipo): Promise<Screen> {
    const own = this.c.owned(userId);
    const max = await this.maxInsignias(userId);
    const objs = this.c.catalog.filter((o) => o.tipo === tipo && own.has(o.id)).slice(0, 24);
    if (!objs.length) return { content: `Aún no tienes ningún objeto de tipo **${TIPO_NOMBRE[tipo]}**. Consíguelos en sobres, en la tienda o fabricándolos.`, components: [this.back("n:tarjeta")] };
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${P}s:equipar:${tipo}`)
      .setPlaceholder(tipo === "insignia" ? `Elige hasta ${max} insignias` : `Elige tu ${TIPO_NOMBRE[tipo].toLowerCase()}`)
      .addOptions([
        ...(tipo === "insignia" ? [] : [{ label: "Quitar (la de siempre)", value: "__nada" }]),
        ...objs.map((o) => ({ label: o.nombre.slice(0, 100), description: `${RAREZA_NOMBRE[o.rareza]}${o.animado ? " · animado" : ""}`, value: o.id, emoji: RAREZA_ICONO[o.rareza] })),
      ]);
    if (tipo === "insignia") menu.setMinValues(0).setMaxValues(Math.min(max, objs.length));
    return { content: `## ${TIPO_NOMBRE[tipo]}\nElige cuál ponerte:`, components: [this.row(menu), this.back("n:tarjeta")] };
  }

  private async ayudaScreen(userId: string): Promise<Screen> {
    const s = this.c.settings;
    const odds = Object.entries(s.sobre.probabilidades).map(([r, p]) => `${RAREZA_ICONO[r]} ${RAREZA_NOMBRE[r as keyof typeof RAREZA_NOMBRE]} ${String(p).replace(".", ",")} %`).join(" · ");
    return {
      content: [
        this.header(userId),
        `## ${this.icon("ayuda")} Cómo funciona`,
        `📅 ${this.temporada()} Después, sus objetos dejan de salir en sobres y vitrinas, pero se pueden fabricar con Ecos.`,
        `**Las Shaulitas se ganan jugando:** chateando y en voz (1 cada ${s.ganar.xpPorMoneda} XP, hasta ${s.ganar.topeActividad} al día), +${s.ganar.primerMensaje} por tu primer mensaje del día, +${s.ganar.mision} por misión de la ruleta, +${s.ganar.subirNivel} por nivel, +${s.ganar.rangoNuevo} por rango nuevo, +${s.ganar.boda} por boda y +${s.ganar.racha7} por 7 días seguidos; también en el 1vs1 y la Ruleta de Némesis. Además, un sobre gratis cada día que completes las misiones de la ruleta y otro cada lunes.`,
        "**Con Shaulitas** abres sobres y compras **todo** lo de la tienda. No se venden.",
        "**Membresías de Ko-fi:** sobres temáticos cada mes donde **eliges** tus objetos (nada pagado es azar), descuento, objetos de vitrinas pasadas y la vitrina siguiente. Mira «Mi membresía».",
        `**Probabilidad de cada objeto de un sobre:** ${odds}. Épica segura cada ${s.sobre.garantiaEpica} sobres y Legendaria cada ${s.sobre.garantiaLegendaria}. El **sobre raro** cambia su objeto más bajo por una Épica si no le salió ninguna, y el **legendario** lo mismo con una Legendaria.`,
        "-# Los objetos de la tienda son solo adorno: no dan XP, cuota ni mensajes extra con los Vocaloids.",
      ].join("\n"),
      ...(await this.staticPicture("ayuda.png", "ayuda.png")),
      components: [this.back()],
    };
  }

  // ───────────────────────── título propio (Baguette y más) ─────────────────────────

  private async tituloModal(i: ButtonInteraction): Promise<void> {
    const max = this.d.membresias.settings.tituloPropio.max;
    const actual = this.d.membresias.titulo(i.user.id);
    const campo = new TextInputBuilder()
      .setCustomId("texto")
      .setLabel(`Tu título (hasta ${max} letras; vacío = quitarlo)`)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(max);
    if (actual) campo.setValue(actual);
    await i.showModal(new ModalBuilder().setCustomId(`${P}titulo`).setTitle("Título propio").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(campo)));
  }

  /** La ventanita del título propio: se revisa con el filtro fijo de Neru (nunca el LLM) y queda en la tarjeta. */
  async modal(i: ModalSubmitInteraction): Promise<boolean> {
    if (i.customId !== `${P}titulo`) return false;
    const n = await this.nivel(i.user.id);
    if (!n?.tituloPropio) return void (await i.reply({ content: "El título propio es de las membresías 🥖 Baguette y más.", flags: MessageFlags.Ephemeral })), true;
    const texto = i.fields.getTextInputValue("texto").trim();
    if (!texto) {
      this.d.membresias.setTitulo(i.user.id, null);
      return void (await i.reply({ content: "Listo: quité tu título propio. Vuelve el que tengas equipado. ✨", flags: MessageFlags.Ephemeral })), true;
    }
    const limpio = limpiarTitulo(texto, this.d.membresias.settings.tituloPropio.max);
    const malo = limpio ? this.d.filtro?.(limpio) : "solo letras, números, espacios y signos simples";
    if (!limpio || malo) return void (await i.reply({ content: `No puedo poner ese título (${malo ?? "no se puede"}). Prueba con otro. 🥖`, flags: MessageFlags.Ephemeral })), true;
    this.d.membresias.setTitulo(i.user.id, limpio);
    await this.report(`✍️ <@${i.user.id}> se puso el título propio «${limpio}».`).catch(() => {});
    await i.reply({ content: `¡Listo! Tu tarjeta ahora dice «**${limpio}**». Míralo con /nivel. ✨`, flags: MessageFlags.Ephemeral });
    return true;
  }

  // ───────────────────────── botones y menús ─────────────────────────

  private payload(s: Screen) {
    return { content: s.content.slice(0, 2000), files: s.files ?? [], embeds: s.embeds ?? [], components: s.components ?? [], attachments: [] as never[], allowedMentions: { parse: [] as never[] } };
  }

  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(P)) return false;
    const [kind, action, arg] = i.customId.slice(P.length).split(":");
    try {
      // Título propio (Baguette y más): la ventanita se abre al tiro (no se puede diferir antes).
      if (kind === "a" && action === "titulo") return void (await this.tituloModal(i)), true;
      if (kind === "m") {
        // Botón del menú fijado: abre una pantalla privada nueva.
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await i.editReply(this.payload(await this.screen(i.user.id, action!, arg)));
      } else if (kind === "n") {
        await i.deferUpdate();
        await i.editReply(this.payload(await this.screen(i.user.id, action!, arg)));
      } else if (kind === "a") await this.action(i, action!, arg!);
      else return false;
    } catch (e) {
      logError(`tienda ${i.customId}`, e);
      await i.followUp({ content: "Algo falló en la tienda. Inténtalo de nuevo desde el menú. 🥖", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return true;
  }

  async select(i: StringSelectMenuInteraction): Promise<boolean> {
    if (!i.customId.startsWith(P)) return false;
    const [, kind, arg] = i.customId.slice(P.length).split(":");
    try {
      await i.deferUpdate();
      const user = i.user.id;
      let s: Screen;
      if (kind === "vitrina") s = await this.probarScreen(user, i.values[0]!);
      else if (kind === "recuperar") s = await this.rprobarScreen(user, i.values[0]!);
      else if (kind === "tematico") s = this.tematicoScreen(user, i.values[0]!);
      else if (kind === "mtema") {
        const r = this.d.membresias.elegirTema(user, Number(arg), i.values[0]!);
        s = await this.msobreScreen(user, Number(arg));
        if ("ok" in r) s.content = `${r.motivo}\n${s.content}`;
      } else if (kind === "melegir") {
        const r = this.d.membresias.elegir(user, Number(arg), i.values);
        if (!r.ok) {
          s = await this.msobreScreen(user, Number(arg));
          s.content = `${r.motivo}\n${s.content}`;
        } else {
          const gif = await this.serial(() => sobreGif(r.objetos.map((objeto) => ({ objeto, nuevo: true, ecos: 0 })), "¡Elegiste tus objetos!"));
          const quedan = this.d.membresias.pendientes(user);
          s = {
            content: [`## 🎁 ¡Listo! Ya son tuyos:`, ...r.objetos.map((o) => `${RAREZA_ICONO[o.rareza]} **${o.nombre}** · ${TIPO_NOMBRE[o.tipo]}`), this.header(user)].join("\n"),
            files: [new AttachmentBuilder(gif, { name: "sobre.gif" })],
            components: [
              this.row(
                ...(quedan.length ? [this.btn(`n:msobre:${quedan[0]!.id}`, `Abrir otro (${quedan.length})`, { icon: "sobre", style: ButtonStyle.Success })] : []),
                this.btn("n:tarjeta", "Mi tarjeta", { icon: "tarjeta" }),
                this.btn("n:membresia", "Mi membresía", { icon: "volver" }),
              ),
            ],
          };
        }
      } else if (kind === "parte") s = await this.equiparScreen(user, i.values[0] as Tipo);
      else if (kind === "equipar") {
        const tipo = arg as Tipo;
        const ids = i.values.filter((v) => v !== "__nada");
        this.c.equip(user, tipo, ids.length ? ids : null, await this.maxInsignias(user));
        s = await this.tarjetaScreen(user);
        s.content = `${this.icon("ok")} ¡Listo! ${s.content}`;
      } else if (kind === "fabricar") {
        const r = this.c.craft(user, i.values[0]!);
        const o = this.c.byId.get(i.values[0]!)!;
        s = await this.coleccionScreen(user, arg as Tipo);
        s.content = (r.ok ? `${this.icon("ok")} ¡Fabricaste **${o.nombre}**!\n` : r.motivo === "no_alcanza_ecos" ? `Te faltan Ecos para ${o.nombre}.\n` : `${r.motivo}\n`) + s.content;
      } else return false;
      await i.editReply(this.payload(s));
    } catch (e) {
      logError(`tienda ${i.customId}`, e);
      await i.followUp({ content: "Algo falló en la tienda. Inténtalo de nuevo desde el menú. 🥖", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return true;
  }

  // ───────────────────────── celular de Neru (app Tienda, PLAN §3.15) ─────────────────────────

  /** Lo que muestra la app Tienda: vitrina de la semana (con su descuento) y los sobres que puede abrir o comprar. */
  async celularEstado(userId: string): Promise<unknown> {
    this.c.sync(userId, 7);
    const w = this.c.wallet(userId);
    const desc = (await this.nivel(userId))?.descuento ?? 0;
    const v = this.c.vitrina();
    const own = this.c.owned(userId);
    const s = this.c.settings.sobre;
    const t = s.tematico;
    return {
      monedas: w.monedas,
      ecos: w.ecos,
      descuento: desc,
      temporada: this.temporada(),
      vitrina: v
        ? {
            cambia: this.nextChange(v.hasta),
            objetos: v.objetos
              .map((id) => this.c.byId.get(id)!)
              .map((o) => ({ id: o.id, nombre: o.nombre, tipo: TIPO_NOMBRE[o.tipo], rareza: RAREZA_NOMBRE[o.rareza], precio: conDescuento(priceOf(this.c.settings, o)!, desc), tiene: own.has(o.id) })),
          }
        : null,
      sobres: {
        gratis: w.gratis,
        gratisRaro: w.gratisRaro,
        gratisLeg: w.gratisLeg,
        pago: TIPOS_SOBRE.map((tp) => ({ tipo: tp, k: sobreKind(this.c.settings, tp) }))
          .filter((x) => x.k.precio !== null)
          .map((x) => ({ tipo: x.tipo, nombre: x.k.nombre, precio: x.k.precio! })),
        tematico: t ? { precio: t.precio, ecos: t.ecos, temas: this.c.temasTematicos().slice(0, 40).map((x) => ({ id: x.id, nombre: x.nombre, emoji: x.emoji, faltan: x.faltan })) } : null,
        regalados: t ? this.c.tematicosPendientes(userId).map((x) => ({ id: x.id, nombre: nombreTema(x.tema).nombre })) : [],
        membresia: this.d.membresias.pendientes(userId).length,
      },
    };
  }

  /** Comprar un objeto de la vitrina desde el celular (queda puesto, como en /tienda). */
  async celularComprar(userId: string, id: string, noSePuede: (msg: string) => Error): Promise<string> {
    const o = this.c.byId.get(id);
    const v = this.c.vitrina();
    if (!o || !v?.objetos.includes(id)) throw noSePuede("Ese objeto ya no está en la vitrina.");
    const r = this.c.buy(userId, id, (await this.nivel(userId))?.descuento ?? 0);
    if (!r.ok) throw noSePuede(r.motivo.startsWith("no_alcanza") ? "No te alcanzan las Shaulitas." : r.motivo);
    const max = await this.maxInsignias(userId);
    this.c.equip(userId, o.tipo, o.tipo === "insignia" ? [o.id, ...[...this.c.equipped(userId).entries()].filter(([k]) => k.startsWith("insignia")).map(([, x]) => x.id)].slice(0, max) : [o.id], max);
    return `¡${o.nombre} es tuyo y ya lo tienes puesto! Pagaste ${fmt(r.pago)} Shaulitas.`;
  }

  /**
   * Abrir un sobre desde el celular: `modo` "gratis" (regalado), "pago" (con Shaulitas), "tpago"/"tregalo" (temático por
   * tema) o "tabrir" (temático regalado, por su id). Devuelve lo que salió.
   */
  celularSobre(userId: string, modo: string, arg: string, noSePuede: (msg: string) => Error): unknown {
    const lista = (r: SobreResult) => r.objetos.map((x) => ({ id: x.objeto.id, nombre: x.objeto.nombre, tipo: TIPO_NOMBRE[x.objeto.tipo], rareza: RAREZA_NOMBRE[x.objeto.rareza], nuevo: x.nuevo, ecos: x.ecos }));
    if (modo === "gratis" || modo === "pago") {
      const tipo: TipoSobre = arg === "raro" || arg === "legendario" ? arg : "comun";
      const r = this.c.openSobre(userId, modo === "gratis", tipo);
      if (!r || !("objetos" in r)) throw noSePuede(!r || r.motivo === "no_alcanza" ? `Te faltan Shaulitas para el ${sobreKind(this.c.settings, tipo).nombre.toLowerCase()}.` : r.motivo);
      return { titulo: tipo === "comun" ? "¡Sobre abierto!" : `¡${sobreKind(this.c.settings, tipo).nombre} abierto!`, objetos: lista(r), helado: r.helado ?? 0 };
    }
    if (modo === "tpago" || modo === "tregalo" || modo === "tabrir") {
      const r = this.c.openTematico(userId, arg, modo === "tpago" ? "pago" : modo === "tregalo" ? "regalado" : Number(arg));
      if (!("objetos" in r)) throw noSePuede(r.motivo === "no_alcanza" ? "Te faltan Shaulitas para el sobre temático." : r.motivo === "no_alcanza_ecos" ? "Te faltan Ecos para el sobre temático." : r.motivo);
      const { nombre, emoji } = nombreTema(r.tema);
      return { titulo: `¡Sobre de ${nombre} abierto! ${emoji}`, objetos: lista(r), helado: r.helado ?? 0 };
    }
    throw noSePuede("No sé abrir ese sobre.");
  }

  private async action(i: ButtonInteraction, action: string, arg: string): Promise<void> {
    const user = i.user.id;
    await i.deferUpdate();
    const show = async (s: Screen) => void (await i.editReply(this.payload(s)));
    switch (action) {
      case "comprar": {
        const r = this.c.buy(user, arg, (await this.nivel(user))?.descuento ?? 0);
        const o = this.c.byId.get(arg)!;
        if (!r.ok) return show(r.motivo.startsWith("no_alcanza") ? await this.confirmarScreen(user, arg) : { content: r.motivo, components: [this.back("n:vitrina")] });
        const max = await this.maxInsignias(user);
        this.c.equip(user, o.tipo, o.tipo === "insignia" ? [o.id, ...[...this.c.equipped(user).entries()].filter(([k]) => k.startsWith("insignia")).map(([, x]) => x.id)].slice(0, max) : [o.id], max);
        const s = await this.tarjetaScreen(user);
        return show({ ...s, content: `${this.icon("ok")} ¡**${o.nombre}** es tuyo y ya lo tienes puesto!\n${s.content}` });
      }
      case "recuperar": {
        const r = this.d.membresias.recuperar(user, await this.nivel(user), arg);
        if (!r.ok) {
          const s = await this.recuperarScreen(user, this.c.byId.get(arg)?.tipo ?? "fondo");
          return show({ ...s, content: `${r.motivo === "no_alcanza" ? "💸 No te alcanzan las Shaulitas." : r.motivo}\n${s.content}` });
        }
        await this.report(`♻️ <@${user}> recuperó **${r.objeto.nombre}** de una vitrina pasada (${fmt(r.precio)} Shaulitas).`).catch(() => {});
        const s = await this.tarjetaScreen(user);
        return show({ ...s, content: `${this.icon("ok")} ¡Recuperaste **${r.objeto.nombre}**! Ya está en tu colección: póntelo aquí abajo.\n${s.content}` });
      }
      case "mcambiar": {
        this.d.membresias.cambiarTema(user, Number(arg));
        return show(await this.msobreScreen(user, Number(arg)));
      }
      case "sobre": {
        // "gratis" / "raro" / "legendario" = abrir uno regalado; "pago" / "pago-raro" / "pago-legendario" = comprarlo.
        const pago = arg.startsWith("pago");
        const clase = pago ? arg.slice(5) : arg;
        const tipo: TipoSobre = clase === "raro" || clase === "legendario" ? clase : "comun";
        const r = this.c.openSobre(user, !pago, tipo);
        if (!r || !("objetos" in r)) {
          const sc = await this.sobresScreen(user);
          const falta = !r || r.motivo === "no_alcanza" ? `Te faltan Shaulitas para el ${sobreKind(this.c.settings, tipo).nombre.toLowerCase()}.` : r.motivo;
          return show({ ...sc, content: `${falta}\n${sc.content}` });
        }
        const titulo = tipo === "comun" ? "¡Sobre abierto!" : `¡${sobreKind(this.c.settings, tipo).nombre} abierto!`;
        // Solo lo ve quien lo abre, como la trivia: publicarlo en el canal lo llenaba (pedido de GyroP, 27 oct. 2026).
        return show(await this.sobreAbierto(user, r, titulo));
      }
      case "tpago":
      case "tregalo":
      case "tabrir": {
        // Temáticos: comprado, hecho con un común regalado + Ecos, o regalado (de una boda; su id).
        const tema = arg.replace("~", ":");
        const r = this.c.openTematico(user, tema, action === "tpago" ? "pago" : action === "tregalo" ? "regalado" : Number(arg));
        if (!("objetos" in r)) {
          const falta = r.motivo === "no_alcanza" ? "💸 Te faltan Shaulitas para el sobre temático." : r.motivo === "no_alcanza_ecos" ? "Te faltan Ecos para el sobre temático." : r.motivo;
          const sc = action === "tabrir" ? await this.sobresScreen(user) : this.tematicoScreen(user, tema);
          return show({ ...sc, content: `${falta}\n${sc.content}` });
        }
        const { nombre, emoji } = nombreTema(r.tema);
        return show(await this.sobreAbierto(user, r, `¡Sobre de ${nombre} abierto! ${emoji}`));
      }
    }
  }

  private async dm(userId: string, content: string): Promise<void> {
    const user = await this.d.clients.teto.users.fetch(userId).catch(() => null);
    await user?.send({ content, allowedMentions: { parse: [] } }).catch(() => this.report(`(No pude escribirle por privado a <@${userId}>.)`));
  }

  // ───────────────────────── comandos ─────────────────────────

  // ───────────────────────── color con hex propio (Celular y más) ─────────────────────────

  /**
   * /color hex: rol decorativo solo suyo con ese color (PLAN §2; 📱 Celular y más). Va justo encima de los colores de
   * #tus-roles (así se ve el suyo). Sin hex, se quita. Si deja la membresía, Teto lo borra solo (cada hora).
   */
  async colorPropio(i: ChatInputCommandInteraction): Promise<void> {
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const n = await this.nivel(i.user.id);
    const guild = this.d.guild();
    const key = `color:propio:${i.user.id}`;
    const prev = kvGet(this.d.db, key);
    const hex = i.options.getString("hex")?.trim().replace(/^#?/, "#").toUpperCase() ?? null;
    if (!hex || hex === "#") {
      if (prev) await guild.roles.delete(prev, "color propio quitado").catch(() => {});
      kvDelete(this.d.db, key);
      return void (await reply(prev ? "Listo: quité tu color propio. 🎨" : "No tenías color propio. 🎨"));
    }
    if (!n?.colorPropio) return void (await reply("El color con hex propio es de las membresías 📱 **Celular** y 💥 **Triple Baka**. Mira #💎・membresías. 🎨"));
    if (!/^#[0-9A-F]{6}$/.test(hex)) return void (await reply("Escribe el color así: `#FF5FA2` (seis letras o números después del #). 🎨"));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const mb = await guild.members.fetch(i.user.id);
    const color = parseInt(hex.slice(1), 16);
    let role = prev ? (guild.roles.cache.get(prev) ?? (await guild.roles.fetch(prev).catch(() => null))) : null;
    if (role) await role.edit({ color, name: `🎨 ${hex} de ${stripNickTag(mb.displayName)}`.slice(0, 100) });
    else {
      role = await guild.roles.create({ name: `🎨 ${hex} de ${stripNickTag(mb.displayName)}`.slice(0, 100), color, permissions: [], mentionable: false, hoist: false, reason: "color propio de membresía" });
      // Encima de los colores de #tus-roles (los roles 🎨), para que se vea el suyo.
      const top = Math.max(0, ...guild.roles.cache.filter((r) => r.name.startsWith("🎨") && r.id !== role!.id).map((r) => r.position));
      if (top) await role.setPosition(top).catch(() => {});
      kvSet(this.d.db, key, role.id);
    }
    await mb.roles.add(role, "color propio de membresía");
    await this.report(`🎨 <@${i.user.id}> se puso el color propio ${hex}.`).catch(() => {});
    await i.editReply(`¡Listo! Tu nombre ahora es **${hex}**. Para quitarlo, usa /color sin hex. 🎨`);
  }

  /** Cada hora: borra los colores propios de quien ya no tiene Celular o Triple Baka. */
  private async colorCleanup(): Promise<void> {
    const rows = this.d.db.prepare("SELECT key, value FROM kv WHERE key LIKE 'color:propio:%'").all() as { key: string; value: string }[];
    for (const r of rows) {
      const userId = r.key.slice("color:propio:".length);
      const n = await this.nivel(userId);
      if (n?.colorPropio) continue;
      await this.d.guild().roles.delete(r.value, "ya no tiene la membresía del color propio").catch(() => {});
      kvDelete(this.d.db, r.key);
    }
  }

  /** /tienda: abre el menú en privado (para quien prefiera el comando). */
  async tienda(i: ChatInputCommandInteraction): Promise<void> {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await i.editReply(this.payload(await this.screen(i.user.id, "menu")));
  }

  /** /tarjeta: el enlace privado (30 min) a la página de personalizar la tarjeta, de un toque (pedido de GyroP, 13 nov. 2026). */
  async tarjeta(i: ChatInputCommandInteraction): Promise<void> {
    if (!this.d.web) return void (await i.reply({ content: "La página de la tarjeta está apagada por ahora. Mientras, cámbiala en /tienda → Mi tarjeta. 🥖", flags: MessageFlags.Ephemeral }));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const web = await this.webUrl(i.user.id).catch((e) => (logError("tarjeta web", e), null));
    if (!web) return void (await i.editReply("No pude abrir la página de tu tarjeta. Prueba de nuevo en un ratito. 🥖"));
    await i.editReply({
      content: `## ${this.icon("tarjeta")} Tu tarjeta\nToca el botón y elige tus objetos tocando sus imágenes; la vista previa es tu tarjeta real.\n-# El enlace es solo tuyo (no lo compartas) y vence en 30 minutos; si vence, vuelve a usar /tarjeta.`,
      components: [this.row(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(web).setLabel("Personalizar en la web").setEmoji("🌐"))],
    });
  }

  /** /monedas (solo GyroP): dar o quitar Shaulitas o Ecos. */
  async monedas(i: ChatInputCommandInteraction): Promise<void> {
    if (!this.d.owners.has(i.user.id)) return void (await i.reply({ content: "Este comando es solo de GyroP.", flags: MessageFlags.Ephemeral }));
    const sub = i.options.getSubcommand();
    const target = i.options.getUser("papu");
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (!target) return void (await reply("Falta el Papu."));
    if (sub === "dar" || sub === "quitar") {
      const n = i.options.getInteger("cantidad", true) * (sub === "quitar" ? -1 : 1);
      const bolsillo = (i.options.getString("bolsillo") ?? "monedas") as "monedas" | "ecos";
      const w = this.c.adjust(target.id, bolsillo, n, `GyroP: ${i.options.getString("motivo") ?? sub}`);
      return void (await reply(`Listo: <@${target.id}> tiene ${fmt(w.monedas)} Shaulitas y ${fmt(w.ecos)} Ecos.`));
    }
  }
}

/** ¿El canal es el de la tienda? (para no responder con el LLM ahí; nadie escribe, pero por si acaso). */
export function isShopChannel(name: string, shop: string): boolean {
  return channelKey(name) === channelKey(shop);
}

/** Días para el próximo cambio (para textos). */
export function daysUntil(from: string, to: string): number {
  let n = 0;
  for (let d = from; d < to; d = addDays(d, 1)) n++;
  return n;
}
