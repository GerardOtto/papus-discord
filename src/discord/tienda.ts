// Tienda de Shaula-coins en Discord (PLAN §3.6). Teto fija en #tienda-shaula un menú con dibujos y botones; cada
// botón abre pantallas privadas (solo las ve quien toca) para comprar monedas, ver la vitrina, abrir sobres, mirar la
// colección y equipar la tarjeta. Los pagos (PayPal.me y transferencia en Chile) llegan a #registro-compras, donde
// GyroP toca «Llegó» o «No llegó». Miku anuncia cada vitrina nueva. Las reglas y el estado viven en src/coins/.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type APIMessageComponentEmoji,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type MessageActionRowComponentBuilder,
  type SendableChannels,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { BotId } from "../config";
import { kvGet, kvSet, type Db } from "../db/database";
import { toCardEquip } from "../coins/equip";
import { boletaImage, coleccionSheet, menuTiendaImage, monederoImage, paquetesImage, stackImages, sobreGif, TIENDA_DIR, vitrinaImage, type DatosBanco } from "../coins/images";
import { RAREZA_NOMBRE, RAREZAS_REGALO, TIPO_NOMBRE, TIPOS, TIPOS_SOBRE, addDays, paySplit, priceOf, sobreKind, weekday, type Objeto, type Tipo, type TipoSobre } from "../coins/rules";
import type { CoinService, Pedido } from "../coins/service";
import { stripNickTag } from "../levels/rules";
import { logError, type LogFn } from "../log";
import type { Phrases } from "../phrases/catalog";
import { channelKey, findTextChannel } from "./channels";
import { fileVersion, StoredImages } from "./imagenes-fijas";
import { cardFile, type LevelsDiscord } from "./levels";

const P = "tienda:";
const MENU_KEY = "tienda:menu";
const MENU_VERSION = "3";
const VITRINA_KEY = "tienda:vitrina_anunciada";
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));
const DIAS = ["el domingo", "el lunes", "el martes", "el miércoles", "el jueves", "el viernes", "el sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "24 de noviembre" (día AAAA-MM-DD). */
const fecha = (day: string) => `${Number(day.slice(8, 10))} de ${MESES[Number(day.slice(5, 7)) - 1]}`;
const RAREZA_ICONO: Record<string, string> = { comun: "⬜", rara: "🟦", epica: "🟪", legendaria: "🟨", mitica: "🌈", fundador: "⭐", membresia: "💎" };

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
  /** PayPal.me de GyroP (sin él, no se ofrece) y datos de su cuenta en Chile (sin ellos, no hay transferencia). Del .env. */
  pagos: { paypalMe: string | null; banco: DatosBanco | null };
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
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
    await this.ensureMenu().catch((e) => logError("menú de la tienda", e));
    await this.tick().catch((e) => logError("tienda", e));
  }

  /** Cada minuto: vitrina nueva (Miku la anuncia); cada hora: regalos de membresía y pedidos vencidos. */
  async tick(): Promise<void> {
    if (!this.c.settings.activo) return;
    await this.announceVitrina().catch((e) => logError("vitrina nueva", e));
    if (Date.now() - this.lastHourly < 3_600_000) return;
    this.lastHourly = Date.now();
    await this.membershipGifts().catch((e) => logError("regalos de membresía", e));
    for (const p of this.c.expireOrders()) await this.report(`⌛ Venció el pedido ${p.codigo} de <@${p.userId}> (${p.paquete}, sin confirmar).`).catch(() => {});
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

  private channel(key: "tienda" | "registro") {
    return findTextChannel(this.d.guild(), this.c.settings.canales[key]);
  }

  private menuButtons(prefix: "m" | "n"): Row[] {
    return [
      this.row(
        this.btn(`${prefix}:comprar`, "Comprar monedas", { icon: "moneda", style: ButtonStyle.Success }),
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
      content: `¡Hola, Papu! ${this.icon("moneda")} Aquí compras monedas, abres sobres y adornas tu tarjeta de nivel. **Toca un dibujo:** solo tú ves lo que abres.\n📅 ${this.temporada()}\n-# Todo lo bueno se consigue gratis participando. Las monedas compradas solo compran objetos de arte propio a precio fijo, sin azar. Nada de esto da XP ni cuota.`,
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
    const img = await this.serial(() => vitrinaImage(cartas, "Vitrina nueva", `Cambia ${this.nextChange(v.hasta)} · los fondos con Vocaloids se pagan con monedas ganadas`));
    await send.send({
      content: this.d.phrases.pick(bot, "vitrina_nueva", { proxima: this.nextChange(v.hasta) }),
      files: [new AttachmentBuilder(img, { name: "vitrina.png" })],
      allowedMentions: { parse: [] },
    });
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

  private async membershipGifts(): Promise<void> {
    const guild = this.d.guild();
    const tiers = Object.keys(this.c.settings.membresias);
    const members = new Set<string>();
    for (const role of guild.roles.cache.values()) if (tiers.includes(role.name)) for (const id of role.members.keys()) members.add(id);
    for (const id of members) {
      const mb = guild.members.cache.get(id);
      if (!mb || mb.user.bot) continue;
      const roles = mb.roles.cache.map((r) => r.name);
      await this.membershipBadges(id, roles);
      const gift = this.c.membership(id, roles);
      if (gift) await this.registro(`🎁 Regalo de membresía: <@${id}> recibió **${fmt(gift.monedas)}** monedas compradas (${gift.rol}).`);
    }
  }

  /**
   * Insignias de membresía (pedido de GyroP, 31 oct. 2026): la del rol de Ko-fi, para siempre. La app la llama también
   * cuando un Papu recibe el rol; aquí, cada hora y al conectar (así quienes ya lo tenían la reciben al instante).
   */
  async membershipBadges(userId: string, roleNames: string[]): Promise<void> {
    const nuevas = this.c.membershipBadges(userId, roleNames);
    if (nuevas.length) await this.registro(`💎 Insignia de membresía para <@${userId}>: ${nuevas.map((o) => `${o.valor} ${o.nombre}`).join(", ")}.`);
  }

  private async registro(content: string, components: Row[] = []): Promise<string | null> {
    const ch = this.channel("registro");
    if (!ch) {
      await this.report(content);
      return null;
    }
    const send = await this.d.sendable("teto", ch.id);
    const msg = await send.send({ content, components, allowedMentions: { parse: [] } });
    return msg.id;
  }

  // ───────────────────────── pantallas ─────────────────────────

  private header(userId: string): string {
    this.c.sync(userId, 7);
    const w = this.c.wallet(userId);
    const especiales = [w.gratisRaro ? `**${w.gratisRaro}** raro${w.gratisRaro === 1 ? "" : "s"}` : "", w.gratisLeg ? `**${w.gratisLeg}** legendario${w.gratisLeg === 1 ? "" : "s"}` : ""].filter(Boolean);
    const gratis = w.gratis || especiales.length ? ` · 🎁 sobres gratis: ${[w.gratis ? `**${w.gratis}** común${w.gratis === 1 ? "" : "es"}` : "", ...especiales].filter(Boolean).join(", ")}` : "";
    return `${this.icon("moneda")} **${fmt(w.ganadas)}** ganadas · **${fmt(w.compradas)}** compradas · 🔁 **${fmt(w.ecos)}** Ecos${gratis}`;
  }

  private async screen(userId: string, name: string, arg?: string): Promise<Screen> {
    if (!this.c.settings.activo) return { content: "La tienda está cerrada por ahora. 🥖", components: [] };
    switch (name) {
      case "menu": return this.menuScreen(userId);
      case "comprar": return this.comprarScreen(userId);
      case "metodo": return this.metodoScreen(userId, arg!);
      case "vitrina": return this.vitrinaScreen(userId);
      case "probar": return this.probarScreen(userId, arg!);
      case "confirmar": return this.confirmarScreen(userId, arg!);
      case "sobres": return this.sobresScreen(userId);
      case "coleccion": return this.coleccionScreen(userId, (arg as Tipo) ?? "fondo");
      case "fabricar": return this.fabricarScreen(userId, (arg as Tipo) ?? "fondo");
      case "tarjeta": return this.tarjetaScreen(userId);
      case "equipar": return this.equiparScreen(userId, arg as Tipo);
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

  private async comprarScreen(userId: string): Promise<Screen> {
    const s = this.c.settings;
    const ids = s.paquetes.map((p) => p.id);
    const pic = await this.picture("paquetes", `${this.assetVersion(...ids.map((id) => `paquetes/${id}.png`))}-${ids.join(",")}`, () => paquetesImage(ids), "paquetes.png");
    const open = this.d.pagos.paypalMe || this.d.pagos.banco;
    return {
      content: [
        this.header(userId),
        `## ${this.icon("moneda")} Comprar monedas`,
        "Las monedas **compradas** sirven en la tienda para objetos de **arte propio** (bordes, barras, efectos, aros, insignias, títulos y fondos dibujados), a precio fijo y sin azar.",
        "Los **sobres** y los **fondos con Vocaloids** se consiguen solo con monedas **ganadas** participando. Las membresías de Ko-fi traen monedas de regalo cada mes.",
        open ? "Elige un paquete:" : "\n⏳ Las compras aún no están abiertas: GyroP está terminando de configurarlas.",
      ].join("\n"),
      ...pic,
      components: [
        this.row(...s.paquetes.map((p) => this.btn(`n:metodo:${p.id}`, `${p.nombre} · ${fmt(p.monedas)}`, { icon: "moneda", style: ButtonStyle.Success, disabled: !open }))),
        this.back(),
      ],
    };
  }

  private metodoScreen(userId: string, paqueteId: string): Screen {
    const p = this.c.settings.paquetes.find((x) => x.id === paqueteId)!;
    const can = this.c.canPurchase(userId, p.usd);
    if (!can.ok)
      return {
        content: can.motivo === "bloqueado" ? "Por ahora no puedes comprar monedas. Si crees que es un error, escríbele a GyroP." : "Llegaste a tu límite de compras de este mes. ¡Gracias por tu apoyo! 💖",
        components: [this.back("n:comprar")],
      };
    const buttons: ButtonBuilder[] = [];
    if (this.d.pagos.paypalMe) buttons.push(this.btn(`a:paypal:${p.id}`, `PayPal · ${p.usd} USD`, { icon: "mundo", style: ButtonStyle.Primary }));
    if (this.d.pagos.banco) buttons.push(this.btn(`a:transfer:${p.id}`, `Transferencia (Chile) · $${fmt(p.clp)}`, { icon: "banco", style: ButtonStyle.Primary }));
    return {
      content: [
        `## ¿Cómo quieres pagar tu ${p.nombre}? (${fmt(p.monedas)} monedas)`,
        this.d.pagos.paypalMe ? `${this.icon("mundo")} **PayPal**: desde México o cualquier país, con tarjeta o saldo. **${p.usd} USD**.` : "",
        this.d.pagos.banco ? `${this.icon("banco")} **Transferencia (solo Chile)**: desde tu banco, más barato. **$${fmt(p.clp)} CLP**.` : "",
        "-# GyroP revisa cada pago y te llegan las monedas cuando lo confirma (te aviso por mensaje privado).",
      ]
        .filter(Boolean)
        .join("\n"),
      components: [this.row(...buttons), this.back("n:comprar")],
    };
  }

  private orderScreen(p: Pedido): Screen {
    const pack = this.c.settings.paquetes.find((x) => x.id === p.paquete)!;
    if (p.metodo === "paypal") {
      const url = `https://paypal.me/${encodeURIComponent(this.d.pagos.paypalMe!)}/${p.usd}USD`;
      return {
        content: [
          `## ${this.icon("mundo")} Tu pedido ${p.codigo}`,
          `1. Toca **Abrir PayPal** y paga **${p.usd} USD**.`,
          `2. En la nota o mensaje del pago escribe: **${p.codigo}** (así GyroP sabe que eres tú).`,
          "3. Vuelve aquí y toca **Ya pagué**.",
          `-# ${pack.nombre}: ${fmt(p.monedas)} monedas. Si no pagas, el pedido vence solo en ${this.c.settings.pagos.venceDias} días.`,
        ].join("\n"),
        components: [this.row(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel("Abrir PayPal"), this.btn(`a:avise:${p.codigo}`, "Ya pagué", { icon: "ok", style: ButtonStyle.Success })), this.back("n:comprar")],
      };
    }
    return {
      content: [
        `## ${this.icon("banco")} Tu pedido ${p.codigo}`,
        `Transfiere **$${fmt(p.clp)} CLP** a la cuenta de la boleta y escribe **${p.codigo}** en el comentario. Después toca **Ya transferí**.`,
        `-# ${pack.nombre}: ${fmt(p.monedas)} monedas. Si no transfieres, el pedido vence solo en ${this.c.settings.pagos.venceDias} días.`,
      ].join("\n"),
      components: [
        this.row(this.btn(`a:avise:${p.codigo}`, "Ya transferí", { icon: "ok", style: ButtonStyle.Success }), this.btn(`a:datos:${p.codigo}`, "Ver los datos en texto")),
        this.back("n:comprar"),
      ],
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
    const components: Row[] = [];
    if (disponibles.length)
      components.push(
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}s:vitrina`)
            .setPlaceholder("Elige un objeto para probarlo en tu tarjeta")
            .addOptions(
              disponibles.map((o) => ({
                label: `${o.nombre} · ${fmt(priceOf(this.c.settings, o)!)} monedas`.slice(0, 100),
                description: `${RAREZA_NOMBRE[o.rareza]} · ${TIPO_NOMBRE[o.tipo]}${o.origen === "render" ? " · solo monedas ganadas" : ""}`.slice(0, 100),
                value: o.id,
                emoji: RAREZA_ICONO[o.rareza],
              })),
            ),
        ),
      );
    components.push(this.back());
    return {
      content: `${this.header(userId)}\n## ${this.icon("tienda")} Tienda de la semana\n📅 ${this.temporada()}\nLos fondos con Vocaloids (marcados «Solo ganadas») se pagan con monedas ganadas; lo demás, con cualquier moneda (primero se usan las compradas).${tienes.length ? `\n✅ Ya tienes: ${tienes.join(", ")}.` : ""}${disponibles.length ? "" : "\n🎉 ¡Ya tienes todo lo de esta vitrina!"}`,
      ...pic,
      components,
    };
  }

  /** La vitrina dibujada (la misma para todos). */
  private vitrinaPng(ids: string[], hasta: string): Promise<Buffer> {
    const cartas = ids.map((id) => this.c.byId.get(id)!).map((objeto) => ({ objeto, precio: priceOf(this.c.settings, objeto) ?? 0, propio: false }));
    return this.serial(() => vitrinaImage(cartas, "Tienda de la semana", `Cambia ${this.nextChange(hasta)} · ${this.temporada(true)}`));
  }

  /** Lo equipado con un objeto de prueba puesto encima. */
  private async preview(userId: string, o: Objeto) {
    const eq = new Map(this.c.equipped(userId));
    if (o.tipo === "insignia") {
      const ins = [o, ...[...eq.entries()].filter(([k]) => k.startsWith("insignia")).map(([, v]) => v).filter((x) => x.id !== o.id)].slice(0, 3);
      for (const k of [...eq.keys()]) if (k.startsWith("insignia")) eq.delete(k);
      ins.forEach((x, i) => eq.set(`insignia${i + 1}`, x));
    } else eq.set(o.tipo, o);
    return this.serial(async () => this.d.levelsDiscord.card(userId, await toCardEquip(eq, this.c.founderNumber(userId))));
  }

  private async probarScreen(userId: string, id: string): Promise<Screen> {
    const o = this.c.byId.get(id);
    if (!o) return this.vitrinaScreen(userId);
    const card = await this.preview(userId, o);
    const precio = priceOf(this.c.settings, o)!;
    return {
      content: `## ${this.icon("probar")} Así se vería tu tarjeta con ${o.nombre}\n${RAREZA_ICONO[o.rareza]} ${RAREZA_NOMBRE[o.rareza]} · ${TIPO_NOMBRE[o.tipo]} · **${fmt(precio)}** monedas${o.origen === "render" ? " (solo ganadas)" : ""}\n-# Vista previa: nada se gasta hasta que confirmes.`,
      files: [cardFile(card)],
      components: [this.row(this.btn(`n:confirmar:${o.id}`, `Comprar por ${fmt(precio)}`, { icon: "moneda", style: ButtonStyle.Success })), this.back("n:vitrina")],
    };
  }

  private confirmarScreen(userId: string, id: string): Screen {
    const o = this.c.byId.get(id)!;
    const precio = priceOf(this.c.settings, o)!;
    this.c.sync(userId, 7);
    const pago = paySplit(precio, this.c.wallet(userId), o.origen === "render");
    if (!pago)
      return {
        content:
          o.origen === "render"
            ? `Te faltan monedas **ganadas** para ${o.nombre} (${fmt(precio)}). Este fondo usa un render de los Vocaloids: solo se paga con lo que ganas participando. ¡Sigue chateando y entrando a voz!`
            : `Te faltan monedas para ${o.nombre} (${fmt(precio)}). Puedes juntarlas participando o comprar un paquete.`,
        components: [this.row(...(o.origen === "render" ? [] : [this.btn("n:comprar", "Comprar monedas", { icon: "moneda", style: ButtonStyle.Success })]), this.btn("n:vitrina", "Volver", { icon: "volver" }))],
      };
    const parts = [pago.compradas ? `${fmt(pago.compradas)} compradas` : "", pago.ganadas ? `${fmt(pago.ganadas)} ganadas` : ""].filter(Boolean).join(" y ");
    return {
      content: `## ¿Compras ${o.nombre}?\nSe paga con ${parts}.`,
      components: [this.row(this.btn(`a:comprar:${o.id}`, "Sí, comprar", { icon: "ok", style: ButtonStyle.Success }), this.btn("n:vitrina", "Cancelar", { style: ButtonStyle.Danger }))],
    };
  }

  private async sobresScreen(userId: string): Promise<Screen> {
    const head = this.header(userId);
    const w = this.c.wallet(userId);
    const s = this.c.settings.sobre;
    // Fila 1: comprar cada clase con ganadas. Fila 2: los gratis que tenga (y Probabilidades).
    const free: ButtonBuilder[] = [];
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
          disabled: w.ganadas < k.precio!,
        }),
      );
    const raro = sobreKind(this.c.settings, "raro");
    const leg = sobreKind(this.c.settings, "legendario");
    const cuantos = (o: [number, number][]) => (o.length === 1 ? `${o[0]![0]}` : `${o[0]![0]} a ${o[o.length - 1]![0]}`);
    const precioDe = (k: { precio: number | null }) => (k.precio !== null ? `**${fmt(k.precio)} ganadas**` : "solo de premio");
    return {
      content: [
        head,
        `## ${this.icon("sobre")} Sobres`,
        `📅 ${this.temporada()}`,
        `📦 **Sobre común**: ${cuantos(s.objetos)} objetos sorpresa de la temporada · **${fmt(s.precio)} ganadas**`,
        `💜 **${raro.nombre}**: ${cuantos(raro.objetos)} objetos, **al menos una Épica** · ${precioDe(raro)}`,
        `💛 **${leg.nombre}**: ${cuantos(leg.objetos)} objetos, **al menos una Legendaria** · ${precioDe(leg)}`,
        `Las compradas no abren sobres. Te regalo **un común** cada día que completes todas las misiones de la ruleta (/ruleta), y otro cada lunes si participaste ${s.semanal.diasMinimos} días de la semana anterior; la ruleta también puede darte uno. La trivia regala raros y legendarios (/trivia).`,
        `Garantía Épica: ${w.sinEpica % s.garantiaEpica} de ${s.garantiaEpica} · Garantía Legendaria: ${w.sinLegendaria % s.garantiaLegendaria} de ${s.garantiaLegendaria}. Los repetidos se vuelven Ecos para fabricar lo que te falte.`,
      ].join("\n"),
      ...(await this.staticPicture("sobre-cerrado.png", "sobre.png")),
      components: [this.row(...paid), this.row(...free), this.back()],
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
    return {
      content: `## ${this.icon("tarjeta")} Mi tarjeta\nAsí sale en /nivel, en tus avisos de nivel y en el ranking. Elige qué parte cambiar:`,
      files: [cardFile(card)],
      components: [
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

  private equiparScreen(userId: string, tipo: Tipo): Screen {
    const own = this.c.owned(userId);
    const objs = this.c.catalog.filter((o) => o.tipo === tipo && own.has(o.id)).slice(0, 24);
    if (!objs.length) return { content: `Aún no tienes ningún objeto de tipo **${TIPO_NOMBRE[tipo]}**. Consíguelos en sobres, en la tienda o fabricándolos.`, components: [this.back("n:tarjeta")] };
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${P}s:equipar:${tipo}`)
      .setPlaceholder(tipo === "insignia" ? "Elige hasta 3 insignias" : `Elige tu ${TIPO_NOMBRE[tipo].toLowerCase()}`)
      .addOptions([
        ...(tipo === "insignia" ? [] : [{ label: "Quitar (la de siempre)", value: "__nada" }]),
        ...objs.map((o) => ({ label: o.nombre.slice(0, 100), description: `${RAREZA_NOMBRE[o.rareza]}${o.animado ? " · animado" : ""}`, value: o.id, emoji: RAREZA_ICONO[o.rareza] })),
      ]);
    if (tipo === "insignia") menu.setMinValues(0).setMaxValues(Math.min(3, objs.length));
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
        `**Gratis, participando:** ganas monedas chateando y en voz (1 cada ${s.ganar.xpPorMoneda} XP, hasta ${s.ganar.topeActividad} al día), +${s.ganar.primerMensaje} por tu primer mensaje del día, +${s.ganar.mision} por misión de la ruleta, +${s.ganar.subirNivel} por nivel, +${s.ganar.rangoNuevo} por rango nuevo, +${s.ganar.boda} por boda y +${s.ganar.racha7} por 7 días seguidos. Además, un sobre gratis cada día que completes las misiones de la ruleta y otro cada lunes.`,
        "**Con monedas ganadas** abres sobres y compras **todo** lo de la tienda, incluidos los fondos con Vocaloids.",
        "**Con monedas compradas** (o el regalo mensual de las membresías) solo compras objetos de arte propio, a precio fijo. Nada pagado es azar.",
        `**Probabilidad de cada objeto de un sobre:** ${odds}. Épica segura cada ${s.sobre.garantiaEpica} sobres y Legendaria cada ${s.sobre.garantiaLegendaria}. El **sobre raro** cambia su objeto más bajo por una Épica si no le salió ninguna, y el **legendario** lo mismo con una Legendaria.`,
        "-# Nada de esto da XP, cuota ni mensajes extra con los Vocaloids.",
      ].join("\n"),
      ...(await this.staticPicture("ayuda.png", "ayuda.png")),
      components: [this.back()],
    };
  }

  // ───────────────────────── botones y menús ─────────────────────────

  private payload(s: Screen) {
    return { content: s.content.slice(0, 2000), files: s.files ?? [], embeds: s.embeds ?? [], components: s.components ?? [], attachments: [] as never[], allowedMentions: { parse: [] as never[] } };
  }

  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(P)) return false;
    const [kind, action, arg] = i.customId.slice(P.length).split(":");
    try {
      if (kind === "m") {
        // Botón del menú fijado: abre una pantalla privada nueva.
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await i.editReply(this.payload(await this.screen(i.user.id, action!, arg)));
      } else if (kind === "n") {
        await i.deferUpdate();
        await i.editReply(this.payload(await this.screen(i.user.id, action!, arg)));
      } else if (kind === "a") await this.action(i, action!, arg!);
      else if (kind === "adm") await this.admin(i, action!, arg!);
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
      else if (kind === "parte") s = this.equiparScreen(user, i.values[0] as Tipo);
      else if (kind === "equipar") {
        const tipo = arg as Tipo;
        const ids = i.values.filter((v) => v !== "__nada");
        this.c.equip(user, tipo, ids.length ? ids : null);
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

  private async action(i: ButtonInteraction, action: string, arg: string): Promise<void> {
    const user = i.user.id;
    await i.deferUpdate();
    const show = async (s: Screen) => void (await i.editReply(this.payload(s)));
    switch (action) {
      case "paypal":
      case "transfer": {
        const p = this.c.createOrder(user, arg, action === "paypal" ? "paypal" : "transferencia");
        if ("ok" in p) return show(this.metodoScreen(user, arg));
        const s = this.orderScreen(p);
        if (p.metodo === "transferencia" && this.d.pagos.banco) s.files = [new AttachmentBuilder(await boletaImage(p.codigo, this.c.settings.paquetes.find((x) => x.id === p.paquete)!.nombre, p.monedas, p.clp, this.d.pagos.banco), { name: "boleta.png" })];
        return show(s);
      }
      case "datos": {
        const p = this.c.order(arg);
        const b = this.d.pagos.banco;
        if (!p || !b || p.userId !== user) return;
        await i.followUp({
          content: `\`\`\`\n${b.nombre}\nRUT ${b.rut}\n${b.banco} · ${b.tipo}\nN.º ${b.numero}\n${b.correo}\nMonto: ${p.clp}\nComentario: ${p.codigo}\n\`\`\``,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      case "avise": {
        const p = this.c.order(arg);
        if (!p || p.userId !== user) return;
        if (p.estado === "pendiente" || (p.estado === "avisado" && !p.registroId)) {
          const spent = this.c.spentThisMonth(user);
          const registroId = await this.registro(
            [
              `🧾 **${p.metodo === "paypal" ? "PayPal" : "Transferencia"} por confirmar** · ${p.codigo}`,
              `Papu: <@${user}> · Paquete: ${p.paquete} (${fmt(p.monedas)} monedas)`,
              `Monto: ${p.metodo === "paypal" ? `${p.usd} USD` : `$${fmt(p.clp)} CLP`} · Este mes ya pagó: ${spent} USD`,
            ].join("\n"),
            [this.row(this.btn(`adm:ok:${p.codigo}`, "Llegó", { style: ButtonStyle.Success }), this.btn(`adm:no:${p.codigo}`, "No llegó", { style: ButtonStyle.Danger }), this.btn(`adm:bloq:${user}`, "Bloquear compras"))],
          );
          this.c.markNotified(p.codigo, registroId);
        }
        return show({
          content: `${this.icon("ok")} ¡Gracias! Le avisé a GyroP. Cuando vea tu pago (${p.codigo}), te llegan las **${fmt(p.monedas)}** monedas y te aviso por mensaje privado.`,
          components: [this.back()],
        });
      }
      case "comprar": {
        const r = this.c.buy(user, arg);
        const o = this.c.byId.get(arg)!;
        if (!r.ok) return show(r.motivo.startsWith("no_alcanza") ? this.confirmarScreen(user, arg) : { content: r.motivo, components: [this.back("n:vitrina")] });
        this.c.equip(user, o.tipo, o.tipo === "insignia" ? [o.id, ...[...this.c.equipped(user).entries()].filter(([k]) => k.startsWith("insignia")).map(([, x]) => x.id)].slice(0, 3) : [o.id]);
        const s = await this.tarjetaScreen(user);
        return show({ ...s, content: `${this.icon("ok")} ¡**${o.nombre}** es tuyo y ya lo tienes puesto!\n${s.content}` });
      }
      case "sobre": {
        // "gratis" / "raro" / "legendario" = abrir uno regalado; "pago" / "pago-raro" / "pago-legendario" = comprarlo.
        const pago = arg.startsWith("pago");
        const clase = pago ? arg.slice(5) : arg;
        const tipo: TipoSobre = clase === "raro" || clase === "legendario" ? clase : "comun";
        const r = this.c.openSobre(user, !pago, tipo);
        if (!r || !("objetos" in r)) {
          const sc = await this.sobresScreen(user);
          const falta = !r || r.motivo === "no_alcanza" ? `Te faltan monedas ganadas para el ${sobreKind(this.c.settings, tipo).nombre.toLowerCase()}.` : r.motivo;
          return show({ ...sc, content: `${falta}\n${sc.content}` });
        }
        const titulo = tipo === "comun" ? "¡Sobre abierto!" : `¡${sobreKind(this.c.settings, tipo).nombre} abierto!`;
        const gif = await this.serial(() => sobreGif(r.objetos, titulo));
        const lines = r.objetos.map((x) => `${RAREZA_ICONO[x.objeto.rareza]} **${x.objeto.nombre}** · ${TIPO_NOMBRE[x.objeto.tipo]}${x.nuevo ? " · ¡nuevo!" : ` · repetido (+${x.ecos} Ecos)`}`);
        await show({
          content: [`## ${this.icon("sobre")} ${titulo}`, ...lines, this.header(user)].join("\n"),
          files: [new AttachmentBuilder(gif, { name: "sobre.gif" })],
          components: [this.row(this.btn("n:sobres", "Abrir otro", { icon: "sobre", style: ButtonStyle.Primary }), this.btn("n:tarjeta", "Mi tarjeta", { icon: "tarjeta" }), this.btn("n:coleccion", "Mi colección", { icon: "mochila" }))],
        });
        // Solo lo ve quien lo abre, como la trivia: publicarlo en el canal lo llenaba (pedido de GyroP, 27 oct. 2026).
        return;
      }
    }
  }

  private async admin(i: ButtonInteraction, action: string, arg: string): Promise<void> {
    if (!this.d.owners.has(i.user.id)) return void (await i.reply({ content: "Solo GyroP puede confirmar pagos.", flags: MessageFlags.Ephemeral }));
    await i.deferUpdate();
    const stamp = (text: string, components: Row[] = []) => i.editReply({ content: `${i.message.content}\n${text}`, components, allowedMentions: { parse: [] } });
    if (action === "bloq") {
      this.c.setBlocked(arg, true);
      await i.followUp({ content: `⛔ <@${arg}> ya no puede comprar monedas. Para desbloquear: /monedas bloquear papu:@ no.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    const p = this.c.order(arg);
    if (!p) return;
    if (action === "ok") {
      const r = this.c.confirmOrder(p.codigo)!;
      await stamp(`✅ Confirmado por GyroP: +${fmt(r.monedas)} monedas compradas.`, [this.row(this.btn(`adm:dev:${p.codigo}`, "Devolver", { style: ButtonStyle.Danger }))]);
      await this.dm(p.userId, this.d.phrases.pick("teto", "monedas_llegaron", { papu: `<@${p.userId}>`, monedas: fmt(p.monedas) }));
    } else if (action === "no") {
      this.c.rejectOrder(p.codigo);
      await stamp("❌ No llegó.");
      await this.dm(p.userId, `Hola, GyroP no encontró tu pago del pedido ${p.codigo}. Si sí pagaste, respóndele con el comprobante (o pídelo en #reportes-y-reclamos) y lo revisa. 🥖`);
    } else if (action === "dev") {
      this.c.refundOrder(p.codigo);
      await stamp("↩️ Devuelto: se quitaron esas monedas. Recuerda devolver el dinero en PayPal o por transferencia.");
    }
  }

  private async dm(userId: string, content: string): Promise<void> {
    const user = await this.d.clients.teto.users.fetch(userId).catch(() => null);
    await user?.send({ content, allowedMentions: { parse: [] } }).catch(() => this.registro(`(No pude escribirle por privado a <@${userId}>.)`));
  }

  // ───────────────────────── comandos ─────────────────────────

  /** /tienda: abre el menú en privado (para quien prefiera el comando). */
  async tienda(i: ChatInputCommandInteraction): Promise<void> {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await i.editReply(this.payload(await this.screen(i.user.id, "menu")));
  }

  /** /monedas (solo GyroP): panel del mes, dar, quitar, límite y bloqueo. */
  async monedas(i: ChatInputCommandInteraction): Promise<void> {
    if (!this.d.owners.has(i.user.id)) return void (await i.reply({ content: "Este comando es solo de GyroP.", flags: MessageFlags.Ephemeral }));
    const sub = i.options.getSubcommand();
    const target = i.options.getUser("papu");
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (sub === "panel") {
      const rows = this.c.monthBuyers();
      const total = rows.reduce((a, r) => a + r.usd, 0);
      return void (await reply(
        rows.length
          ? [`**Compras de este mes: ${total} USD**`, ...rows.map((r) => `<@${r.userId}> · ${r.usd} USD en ${r.compras} compra${r.compras === 1 ? "" : "s"}${r.limite != null ? ` · límite ${r.limite} USD` : ""}${r.bloqueado ? " · ⛔ bloqueado" : ""}`)].join("\n")
          : "Aún no hay compras confirmadas este mes.",
      ));
    }
    if (!target) return void (await reply("Falta el Papu."));
    if (sub === "dar" || sub === "quitar") {
      const n = i.options.getInteger("cantidad", true) * (sub === "quitar" ? -1 : 1);
      const bolsillo = (i.options.getString("bolsillo") ?? "ganadas") as "ganadas" | "compradas" | "ecos";
      const w = this.c.adjust(target.id, bolsillo, n, `GyroP: ${i.options.getString("motivo") ?? sub}`);
      return void (await reply(`Listo: <@${target.id}> tiene ${fmt(w.ganadas)} ganadas, ${fmt(w.compradas)} compradas y ${fmt(w.ecos)} Ecos.`));
    }
    if (sub === "limite") {
      const usd = i.options.getNumber("usd", true);
      this.c.setLimit(target.id, usd > 0 ? usd : null);
      return void (await reply(usd > 0 ? `<@${target.id}> puede comprar hasta ${usd} USD al mes.` : `<@${target.id}> ya no tiene límite.`));
    }
    if (sub === "bloquear") {
      const on = i.options.getBoolean("bloquear", true);
      this.c.setBlocked(target.id, on);
      return void (await reply(on ? `⛔ <@${target.id}> no puede comprar monedas.` : `✅ <@${target.id}> puede volver a comprar.`));
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
