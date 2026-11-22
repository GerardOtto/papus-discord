// Intercambios en Discord (PLAN §3.11). /intercambio (Teto) abre una pantalla privada para armar la oferta, como en
// Steam: lo que entregas y lo que pides, abierta o dirigida a un Papu. Teto la anuncia en #centro-de-comercio con
// botones: Aceptar (pide confirmar), Contraoferta (abre la pantalla con los lados al revés), Rechazar y Retirar. Al
// cerrarse, Teto edita el anuncio. El canal tiene modo lento largo: es para avisos y reacciones, no para charlar.
// Las reglas y el estado viven en src/intercambios/.
import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type SendableChannels,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import type { BotId } from "../config";
import type { CoinService } from "../coins/service";
import { ofertaImage } from "../coins/images";
import { RAREZA_NOMBRE, TIPO_NOMBRE, type TipoSobre } from "../coins/rules";
import { buscar, CANTIDADES, describir, objetoCambiable, precioCasa, tocaOfertaCasa, TOPES, vacio, type Cantidad, type Paquete } from "../intercambios/rules";
import { priceOf, sobrePool, temporadasActivas, type Objeto } from "../coins/rules";
import { dayKey } from "../time";
import type { AceptarFail, Falta, IntercambioService, Oferta } from "../intercambios/service";
import type { LevelService } from "../levels/service";
import { logError, type LogFn } from "../log";
import { CONSUMIBLES } from "../mercado/rules";
import type { MercadoService } from "../mercado/service";
import type { Phrases } from "../phrases/catalog";
import { channelKey, CHANNELS, findTextChannel } from "./channels";
import type { LevelsDiscord } from "./levels";

const P = "inter:";
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));
const unix = (t: number) => Math.ceil(t / 1000);
const DAY_MS = 86_400_000;

type Lado = "da" | "pide";
type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
interface Screen {
  content: string;
  components: Row[];
}

/** Lo que se puede agregar a cada lado (el menú "➕ Agregar…"). */
const TIPOS: { value: string; label: string; emoji: string; desc: string }[] = [
  { value: "monedas", label: "Shaulitas", emoji: "🪙", desc: "Las que ganas jugando" },
  { value: "xp", label: "XP", emoji: "✨", desc: "Experiencia (no cuenta como actividad del día)" },
  { value: "niveles", label: "Niveles", emoji: "🆙", desc: "Se cambian como la XP de esos niveles de quien entrega" },
  { value: "cuota", label: "Mensajes de la cuota de hoy", emoji: "💬", desc: "Como /donar; la oferta vence a medianoche" },
  { value: "sobre:comun", label: "Sobres comunes", emoji: "🎁", desc: "Sobres regalados por abrir" },
  { value: "sobre:raro", label: "Sobres raros", emoji: "🎁", desc: "Sobres regalados por abrir" },
  { value: "sobre:legendario", label: "Sobres legendarios", emoji: "🎁", desc: "Sobres regalados por abrir" },
  { value: "objeto", label: "Objetos de la colección", emoji: "🖼️", desc: "Fondos, bordes, insignias, títulos…" },
  { value: "consumible", label: "Consumibles del mercado negro", emoji: "🎒", desc: "Usos de Atún, Baguette, PC…" },
];
const NOMBRE_CANTIDAD: Record<Cantidad, string> = { monedas: "Shaulitas", xp: "XP", niveles: "niveles", cuota: "mensajes de la cuota de hoy" };
const SOBRE: Record<TipoSobre, string> = { comun: "sobres comunes", raro: "sobres raros", legendario: "sobres legendarios" };

/** La oferta que un Papu está armando (en memoria: si los bots se reinician, se arma de nuevo). */
interface Borrador {
  para: string | null;
  da: Paquete;
  pide: Paquete;
  /** Contraoferta a esta oferta (el destinatario queda fijo). */
  padre: number | null;
}

export interface IntercambiosDiscordDeps {
  svc: IntercambioService;
  coins: CoinService;
  levels: LevelService;
  levelsDiscord: LevelsDiscord;
  mercado: MercadoService | null;
  phrases: Phrases;
  owners: ReadonlySet<string>;
  clients: Partial<Record<BotId, Client>>;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  /** Zona de la cuota: horas y días de las ofertas de los Vocaloids. */
  timeZone?: string;
  /** Nombre de cada Vocaloid (para los registros). */
  botName?: (bot: BotId) => string;
  log: LogFn;
  rnd?: () => number;
}

export class IntercambiosDiscord {
  private readonly borradores = new Map<string, Borrador>();

  constructor(private readonly d: IntercambiosDiscordDeps) {}

  private get s(): IntercambioService {
    return this.d.svc;
  }

  private btn(id: string, label: string, emoji: string, style = ButtonStyle.Secondary, disabled = false): ButtonBuilder {
    return new ButtonBuilder().setCustomId(`${P}${id}`).setLabel(label.slice(0, 80)).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  }

  private row(...items: MessageActionRowComponentBuilder[]): Row {
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...items);
  }

  private nombres = {
    objeto: (id: string) => {
      const o = this.d.coins.byId.get(id);
      return o ? { nombre: o.nombre } : null;
    },
    consumible: (id: string) => {
      const o = this.d.mercado?.byId.get(id);
      return o ? { nombre: o.nombre, emoji: o.emoji } : null;
    },
  };

  /**
   * El paquete en líneas. `quien` = quien lo entrega (para traducir los niveles a XP con su nivel de hoy; null si aún no
   * se sabe); `xp` = la XP ya calculada (la que se movió en un trato hecho).
   */
  private lista(p: Paquete, quien: string | null, xp?: number | null): string {
    const l = describir(p, this.nombres, xp ?? this.xpNiveles(p, quien));
    return l.length ? l.map((x) => `- ${x}`).join("\n") : "-# (nada todavía)";
  }

  /** XP que valen los niveles del paquete según el nivel de quien los entrega (null si no se sabe o no le alcanzan). */
  private xpNiveles(p: Paquete, quien: string | null): number | null {
    return p.niveles && quien ? this.d.levels.xpOfLevels(quien, p.niveles) : null;
  }

  // ───────────────────────── canal ─────────────────────────

  /** Al conectar: el canal #centro-de-comercio (si falta, Teto lo crea en la categoría de #general) con su modo lento. */
  async start(): Promise<void> {
    await this.ensureChannel().catch((e) => logError("canal de intercambios", e));
    await this.tick();
  }

  private async ensureChannel(): Promise<void> {
    const client = this.d.clients.teto;
    if (!client) return;
    const g = await client.guilds.fetch(this.d.guild().id);
    const { canal, tema, lento } = this.s.settings;
    let ch = g.channels.cache.find((c) => c.type === ChannelType.GuildText && channelKey(c.name) === channelKey(canal));
    if (!ch) {
      const general = g.channels.cache.find((c) => c.type === ChannelType.GuildText && channelKey(c.name) === channelKey(CHANNELS.general));
      ch = await g.channels.create({ name: canal, type: ChannelType.GuildText, topic: tema, rateLimitPerUser: lento, parent: general && "parentId" in general ? general.parentId : null, reason: "Intercambios entre Papus (PLAN §3.11)" });
      this.d.log(`🤝 Intercambios: canal #${canal} creado`);
      await this.d.report(`🤝 Creé el canal <#${ch.id}> para los intercambios (modo lento de ${Math.round(lento / 60)} min). Revisa sus permisos y su lugar en la lista.`);
      return;
    }
    if (ch.type === ChannelType.GuildText && ch.rateLimitPerUser !== lento) await ch.setRateLimitPerUser(lento, "Modo lento de los intercambios (config/intercambios.json)");
  }

  private canal() {
    return findTextChannel(this.d.guild(), this.s.settings.canal);
  }

  /** Cada minuto: vence las ofertas pasadas de su hora y edita sus anuncios. */
  async tick(): Promise<void> {
    if (!this.s.settings.activo) return;
    for (const o of this.s.vencer()) await this.cerrarAnuncio(o, "⌛ **Venció** sin que nadie la aceptara.").catch((e) => logError("oferta vencida", e));
    await this.ofertaCasa().catch((e) => logError("oferta de un Vocaloid", e));
  }

  // ───────────────────────── ofertas de los Vocaloids (idea de Piña; GyroP, 18 nov. 2026) ─────────────────────────

  /** Objetos que puede ofrecer un Vocaloid: suyos, de la temporada en curso, que se venden en la tienda. */
  candidatosCasa(bot: BotId, day: string): Objeto[] {
    const ofrecidos = new Set(this.s.abiertasCasa().flatMap((o) => o.da.objetos));
    return sobrePool(this.d.coins.catalog, temporadasActivas(this.d.coins.settings, day), day).filter(
      (o) => o.personajes?.includes(bot) && o.rareza !== "mitica" && priceOf(this.d.coins.settings, o) !== null && objetoCambiable(o) && !ofrecidos.has(o.id),
    );
  }

  /** Cada minuto: a veces un Vocaloid conectado ofrece un objeto suyo (config/intercambios.json -> casa). */
  private async ofertaCasa(now = Date.now()): Promise<void> {
    const c = this.s.settings.casa;
    if (!c?.activo || !this.s.settings.activo) return;
    const tz = this.d.timeZone ?? "America/Santiago";
    const [hora, minuto] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(now)).split(":").map(Number) as [number, number];
    const recientes = this.s.casaDesde(now - DAY_MS);
    const day = dayKey(new Date(now), tz);
    const hoy = recientes.filter((o) => dayKey(new Date(o.creadoAt), tz) === day).length;
    const desdeUltimaMin = recientes.length ? (now - recientes[0]!.creadoAt) / 60_000 : Infinity;
    const rnd = this.d.rnd ?? Math.random;
    if (!tocaOfertaCasa(c, { hora, minuto, hoy, abiertas: this.s.abiertasCasa().length, desdeUltimaMin }, rnd)) return;
    const ch = this.canal();
    const general = findTextChannel(this.d.guild(), CHANNELS.general);
    if (!ch || !general) return;
    // Un Vocaloid conectado al azar que tenga algo que ofrecer.
    const bots = (Object.entries(this.d.clients) as [BotId, Client][])
      .filter(([, cl]) => cl?.user)
      .map(([bot, cl]) => ({ bot, userId: cl.user!.id, objetos: this.candidatosCasa(bot, day) }))
      .filter((b) => b.objetos.length);
    if (!bots.length) return;
    const b = bots[Math.floor(rnd() * bots.length)]!;
    const objeto = b.objetos[Math.floor(rnd() * b.objetos.length)]!;
    const precio = precioCasa(priceOf(this.d.coins.settings, objeto)!, c.factorPrecio);
    const o = this.s.crearCasa(b.bot, b.userId, [objeto.id], precio);
    const send = await this.d.sendable("teto", ch.id);
    const msg = await send.send({ ...this.anuncio(o), files: await this.imagenOferta(o), allowedMentions: { parse: [] } });
    this.s.setMensaje(o.id, ch.id, msg.id);
    // El Vocaloid avisa en #general con una frase fija (sin LLM ni cuota).
    const texto = this.d.phrases.pick("ofertas", "oferta_casa", { objeto: objeto.nombre, precio: fmt(precio), canal: msg.url });
    const gen = await this.d.sendable(b.bot, general.id);
    await gen.send({ content: `🤝 ${texto}`, allowedMentions: { parse: [] } });
    this.d.log(`🤝 Oferta #${o.id} de ${this.d.botName?.(b.bot) ?? b.bot}: ${objeto.nombre} por ${precio}`);
  }

  // ───────────────────────── quién puede ─────────────────────────

  /** Nivel mínimo (o prestigio) y días en el servidor. Devuelve el motivo si no puede, o null. */
  private async noPuede(userId: string, quien: "tu" | "otro" = "tu"): Promise<string | null> {
    if (this.d.owners.has(userId)) return null;
    const { nivel, dias } = this.s.settings.requisitos;
    const lv = this.d.levels.level(userId);
    const mb = await this.d.guild().members.fetch(userId).catch(() => null);
    if (!mb) return quien === "tu" ? "No te encuentro en el servidor." : "Ese Papu no está en el servidor.";
    if (mb.user.bot) return "Los Vocaloids no intercambian. 🥖";
    const sujeto = quien === "tu" ? "necesitas" : "ese Papu necesita";
    if (lv.level < nivel && lv.prestige === 0) return `Para intercambiar ${sujeto} el **nivel ${nivel}** (${quien === "tu" ? "vas en el" : "va en el"} ${lv.level}).`;
    if ((mb.joinedTimestamp ?? 0) > Date.now() - dias * DAY_MS) return `Para intercambiar ${sujeto} **${dias} días** en el servidor.`;
    return null;
  }

  // ───────────────────────── pantallas ─────────────────────────

  private borrador(userId: string): Borrador {
    let b = this.borradores.get(userId);
    if (!b) this.borradores.set(userId, (b = { para: null, da: vacio(), pide: vacio(), padre: null }));
    return b;
  }

  private link(o: Oferta): string {
    return o.canal && o.mensaje ? `https://discord.com/channels/${this.d.guild().id}/${o.canal}/${o.mensaje}` : `#${o.id}`;
  }

  private menuScreen(userId: string, header = ""): Screen {
    const mias = this.s.abiertasDe(userId);
    const para = this.s.abiertasPara(userId);
    const linea = (o: Oferta, quien: string) => `- [Oferta #${o.id}](${this.link(o)}) ${quien} · vence <t:${unix(o.venceAt)}:R>`;
    return {
      content: [
        header,
        "## 🤝 Intercambios",
        "Armas lo que **entregas** y lo que **pides**: Shaulitas, XP, niveles, cuota de hoy, sobres, objetos de tu colección y consumibles. Teto la anuncia en el centro de comercio; cuando los dos están de acuerdo, se cambia todo de una vez.",
        mias.length ? `**Tus ofertas abiertas** (${mias.length}/${this.s.settings.maxAbiertas}):\n${mias.map((o) => linea(o, o.para ? `para <@${o.para}>` : "🌐 abierta")).join("\n")}` : "",
        para.length ? `**Ofertas para ti:**\n${para.map((o) => linea(o, `de <@${o.de}>`)).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      components: [this.row(this.btn("nueva", "Nueva oferta", "📝", ButtonStyle.Success))],
    };
  }

  private builderScreen(userId: string, header = ""): Screen {
    const b = this.borrador(userId);
    const destino = b.para ? `para <@${b.para}>` : "🌐 **abierta** (cualquier Papu puede aceptarla)";
    const tipos = (lado: Lado) =>
      new StringSelectMenuBuilder()
        .setCustomId(`${P}add:${lado}`)
        .setPlaceholder(lado === "da" ? "📤 Agregar a lo que ENTREGAS…" : "📥 Agregar a lo que PIDES…")
        .addOptions(TIPOS.map((t) => ({ value: t.value, label: t.label, emoji: t.emoji, description: t.desc })));
    const listo = describir(b.da, this.nombres).length > 0 && describir(b.pide, this.nombres).length > 0;
    return {
      content: [
        header,
        `## 📝 ${b.padre ? `Contraoferta a la #${b.padre}` : "Tu oferta"} · ${destino}`,
        `**📤 Entregas:**\n${this.lista(b.da, userId)}`,
        `**📥 Pides:**\n${this.lista(b.pide, b.para)}`,
        "-# Elige qué agregar en los menús; para quitar algo, ponle 0 (los objetos se desmarcan). Nada se aparta al publicar: al aceptar se revisa que los dos tengan lo suyo.",
      ]
        .filter(Boolean)
        .join("\n"),
      components: [
        this.row(tipos("da")),
        this.row(tipos("pide")),
        this.row(
          new UserSelectMenuBuilder()
            .setCustomId(`${P}para`)
            .setPlaceholder(b.padre ? "La contraoferta va a quien hizo la oferta" : b.para ? "Cambiar a qué Papu se la ofreces" : "👤 Ofrecérsela a un Papu (opcional)")
            .setMinValues(1)
            .setMaxValues(1)
            .setDisabled(!!b.padre),
        ),
        this.row(
          this.btn("publicar", "Publicar oferta", "📨", ButtonStyle.Success, !listo),
          this.btn("abierta", "Hacerla abierta", "🌐", ButtonStyle.Secondary, !b.para || !!b.padre),
          this.btn("vaciar", "Empezar de nuevo", "🧹", ButtonStyle.Danger),
          this.btn("menu", "Mis ofertas", "🤝"),
        ),
      ],
    };
  }

  /** Lo que tiene un Papu de una cantidad (para mostrarlo en el formulario). */
  private tiene(userId: string, kind: string): number | null {
    const w = this.d.coins.wallet(userId);
    if (kind === "monedas") return w.monedas;
    if (kind === "xp") return this.d.levels.store.get(userId).xp;
    if (kind === "niveles") return this.d.levels.level(userId).level - 1;
    // La cuota cambia durante el día: se revisa al publicar y al aceptar.
    if (kind === "cuota") return null;
    if (kind.startsWith("sobre:")) return this.d.coins.sobresGratis(userId, kind.slice(6) as TipoSobre);
    if (kind.startsWith("c=")) return this.d.mercado?.usos(userId, kind.slice(2)) ?? 0;
    return null;
  }

  private actual(p: Paquete, kind: string): number {
    if ((CANTIDADES as readonly string[]).includes(kind)) return p[kind as Cantidad];
    if (kind.startsWith("sobre:")) return p.sobres[kind.slice(6) as TipoSobre];
    if (kind.startsWith("c=")) return p.consumibles[kind.slice(2)] ?? 0;
    return 0;
  }

  private nombreDe(kind: string): string {
    if ((CANTIDADES as readonly string[]).includes(kind)) return NOMBRE_CANTIDAD[kind as Cantidad];
    if (kind.startsWith("sobre:")) return SOBRE[kind.slice(6) as TipoSobre];
    if (kind.startsWith("c=")) return `usos de ${this.d.mercado?.byId.get(kind.slice(2))?.nombre ?? "ese consumible"}`;
    return kind;
  }

  private cantidadModal(userId: string, lado: Lado, kind: string): ModalBuilder {
    const b = this.borrador(userId);
    const p = b[lado];
    // Lo que tiene quien entrega: tú si es tu lado; el otro Papu si pides y ya está elegido.
    const dueño = lado === "da" ? userId : b.para;
    const t = dueño ? this.tiene(dueño, kind) : null;
    const quien = lado === "da" ? "Tienes" : "Tiene";
    const label = `¿Cuántos ${this.nombreDe(kind)}? (0 = quitar)`.slice(0, 45);
    const input = new TextInputBuilder()
      .setCustomId("cantidad")
      .setLabel(label)
      .setPlaceholder(t !== null ? `${quien} ${fmt(t)}` : "Un número")
      .setRequired(false)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(9);
    const ahora = this.actual(p, kind);
    if (ahora > 0) input.setValue(String(ahora));
    return new ModalBuilder()
      .setCustomId(`${P}m:${lado}:${kind}`)
      .setTitle(lado === "da" ? "Lo que entregas" : "Lo que pides")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  /** Objetos que se pueden poner en un lado: los tuyos (entregas) o los del otro Papu / todo el catálogo (pides). */
  private candidatos(userId: string, lado: Lado) {
    const b = this.borrador(userId);
    const dueño = lado === "da" ? userId : b.para;
    const cambiables = this.d.coins.catalog.filter(objetoCambiable);
    if (!dueño) return cambiables;
    const owned = this.d.coins.owned(dueño);
    return cambiables.filter((o) => owned.has(o.id));
  }

  private objetoModal(lado: Lado): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(`${P}mo:${lado}`)
      .setTitle(lado === "da" ? "Objeto que entregas" : "Objeto que pides")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("nombre").setLabel("Nombre del objeto (otra vez = quitarlo)").setPlaceholder("Ej.: Cinta de casete").setStyle(TextInputStyle.Short).setMaxLength(60),
        ),
      );
  }

  private objetoScreen(userId: string, lado: Lado): Screen | null {
    const b = this.borrador(userId);
    const list = this.candidatos(userId, lado);
    if (!list.length || list.length > 25) return null;
    const sel = new Set(b[lado].objetos);
    return {
      content: `**${lado === "da" ? "📤 ¿Qué objetos entregas?" : "📥 ¿Qué objetos pides?"}** Marca todos los que quieras (y desmarca los que no).`,
      components: [
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}obj:${lado}`)
            .setPlaceholder("Elige objetos")
            .setMinValues(0)
            .setMaxValues(list.length)
            .addOptions(list.map((o) => ({ value: o.id, label: o.nombre.slice(0, 100), description: `${TIPO_NOMBRE[o.tipo]} · ${RAREZA_NOMBRE[o.rareza]}`, default: sel.has(o.id) }))),
        ),
        this.row(this.btn("volver", "Volver a la oferta", "⬅️")),
      ],
    };
  }

  private consumibleScreen(userId: string, lado: Lado): Screen {
    const b = this.borrador(userId);
    const dueño = lado === "da" ? userId : b.para;
    const list = (this.d.mercado?.settings.objetos ?? []).filter((o) => CONSUMIBLES.includes(o.efecto));
    if (!list.length) return this.builderScreen(userId, "No hay consumibles del mercado negro.\n");
    return {
      content: `**${lado === "da" ? "📤 ¿Qué consumible entregas?" : "📥 ¿Qué consumible pides?"}** Después eliges cuántos usos.`,
      components: [
        this.row(
          new StringSelectMenuBuilder()
            .setCustomId(`${P}cons:${lado}`)
            .setPlaceholder("Elige un consumible")
            .addOptions(
              list.map((o) => ({ value: o.id, label: o.nombre.slice(0, 100), emoji: o.emoji, ...(dueño ? { description: `${lado === "da" ? "Tienes" : "Tiene"} ${this.d.mercado!.usos(dueño, o.id)} usos` } : {}) })),
            ),
        ),
        this.row(this.btn("volver", "Volver a la oferta", "⬅️")),
      ],
    };
  }

  // ───────────────────────── comando ─────────────────────────

  /** /intercambio [papu]: con un Papu, arma una oferta para él; sin, tus ofertas. */
  async intercambio(i: ChatInputCommandInteraction): Promise<void> {
    const no = await this.noPuede(i.user.id);
    if (no) return void (await i.reply({ content: `🤝 ${no}`, flags: MessageFlags.Ephemeral }));
    const papu = i.options.getUser("papu");
    if (papu) {
      if (papu.id === i.user.id) return void (await i.reply({ content: "🤝 No puedes intercambiar contigo mismo.", flags: MessageFlags.Ephemeral }));
      const otro = await this.noPuede(papu.id, "otro");
      if (otro) return void (await i.reply({ content: `🤝 ${otro}`, flags: MessageFlags.Ephemeral }));
      const b = this.borrador(i.user.id);
      if (b.padre) this.borradores.set(i.user.id, { para: papu.id, da: vacio(), pide: vacio(), padre: null });
      else b.para = papu.id;
      return void (await i.reply({ ...this.builderScreen(i.user.id), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }));
    }
    await i.reply({ ...this.menuScreen(i.user.id), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  // ───────────────────────── botones ─────────────────────────

  async button(i: ButtonInteraction): Promise<boolean> {
    if (!i.customId.startsWith(P)) return false;
    const [, action, arg] = i.customId.split(":");
    const userId = i.user.id;
    const id = Number(arg);
    const priv = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } } as const;
    switch (action) {
      case "nueva": {
        if (this.borrador(userId).padre) this.borradores.delete(userId);
        return void (await i.update({ ...this.builderScreen(userId), allowedMentions: { parse: [] } })), true;
      }
      case "menu":
        return void (await i.update({ ...this.menuScreen(userId), allowedMentions: { parse: [] } })), true;
      case "volver":
        return void (await i.update({ ...this.builderScreen(userId), allowedMentions: { parse: [] } })), true;
      case "vaciar": {
        const b = this.borrador(userId);
        this.borradores.set(userId, { para: b.padre ? b.para : null, da: vacio(), pide: vacio(), padre: b.padre });
        return void (await i.update({ ...this.builderScreen(userId), allowedMentions: { parse: [] } })), true;
      }
      case "abierta":
        this.borrador(userId).para = null;
        return void (await i.update({ ...this.builderScreen(userId), allowedMentions: { parse: [] } })), true;
      case "publicar":
        return void (await this.publicar(i)), true;
      case "acc": {
        const no = await this.noPuede(userId);
        if (no) return void (await i.reply({ content: `🤝 ${no}`, ...priv })), true;
        const r = this.s.revisar(id, userId);
        if (!r.ok) return void (await i.reply({ content: this.motivoAceptar(r.motivo), ...priv })), true;
        const o = r.oferta;
        await i.reply({
          content: [`🤝 **¿Aceptas la oferta #${o.id} de <@${o.de}>?**`, `**📤 Entregas:**\n${this.lista(o.pide, userId)}`, `**📥 Recibes:**\n${this.lista(o.da, o.de)}`, "-# No se puede deshacer."].join("\n"),
          components: [this.row(this.btn(`si:${o.id}`, "Sí, hacer el intercambio", "✅", ButtonStyle.Success))],
          ...priv,
        });
        return true;
      }
      case "si":
        return void (await this.aceptar(i, id)), true;
      case "con": {
        const o = this.s.get(id);
        if (!o || o.estado !== "abierta") return void (await i.reply({ content: "Esa oferta ya está cerrada.", ...priv })), true;
        if (o.casa) return void (await i.reply({ content: "Las ofertas de los Vocaloids no se contraofertan: es tómalo o déjalo. 😌", ...priv })), true;
        if (o.de === userId) return void (await i.reply({ content: "Es tu oferta: si quieres cambiarla, retírala y publica otra.", ...priv })), true;
        if (o.para && o.para !== userId) return void (await i.reply({ content: "Esa oferta es para otro Papu.", ...priv })), true;
        const no = await this.noPuede(userId);
        if (no) return void (await i.reply({ content: `🤝 ${no}`, ...priv })), true;
        // Los lados al revés: lo que pidió es lo que tú entregarías.
        this.borradores.set(userId, { para: o.de, da: structuredClone(o.pide), pide: structuredClone(o.da), padre: o.id });
        return void (await i.reply({ ...this.builderScreen(userId, "🔁 Cambia lo que quieras y publícala: le llega a quien hizo la oferta.\n"), ...priv })), true;
      }
      case "rec": {
        const o = this.s.rechazar(id, userId);
        if (!o) return void (await i.reply({ content: "Solo el Papu al que iba dirigida puede rechazarla (y tiene que estar abierta).", ...priv })), true;
        await i.deferUpdate();
        await this.cerrarAnuncio(o, `✖️ <@${userId}> la **rechazó**.`);
        return true;
      }
      case "ret": {
        const o = this.s.retirar(id, userId, this.d.owners.has(userId));
        if (!o) return void (await i.reply({ content: "Solo quien hizo la oferta puede retirarla (y tiene que estar abierta).", ...priv })), true;
        await i.deferUpdate();
        await this.cerrarAnuncio(o, o.de === userId ? "🗑️ La **retiró** quien la hizo." : "🗑️ La **retiró** GyroP.");
        return true;
      }
    }
    return false;
  }

  private async publicar(i: ButtonInteraction): Promise<void> {
    const userId = i.user.id;
    const b = this.borrador(userId);
    const no = (await this.noPuede(userId)) ?? (b.para ? await this.noPuede(b.para, "otro") : null);
    if (no) return void (await i.update({ ...this.builderScreen(userId, `🤝 ${no}\n`), allowedMentions: { parse: [] } }));
    const ch = this.canal();
    if (!ch) return void (await i.update({ ...this.builderScreen(userId, `Falta el canal #${this.s.settings.canal}; GyroP ya lo sabe.\n`), allowedMentions: { parse: [] } }));
    await i.deferUpdate();
    const r = this.s.crear(userId, b.para, b.da, b.pide, b.padre);
    if (!r.ok) {
      const motivo =
        r.motivo === "vacia"
          ? "Tienes que entregar algo y pedir algo."
          : r.motivo === "a_ti"
            ? "No puedes ofrecerte algo a ti mismo."
            : r.motivo === "demasiadas"
              ? `Ya tienes ${this.s.settings.maxAbiertas} ofertas abiertas: retira una antes (botón 🗑️ en su anuncio).`
              : r.motivo === "padre"
                ? "La oferta a la que contestabas ya se cerró."
                : `Te falta:\n${r.motivo.falta.map((f) => `- ${this.falta(f)}`).join("\n")}`;
      return void (await i.editReply({ ...this.builderScreen(userId, `❌ ${motivo}\n`), allowedMentions: { parse: [] } }));
    }
    const o = r.oferta;
    const send = await this.d.sendable("teto", ch.id);
    const msg = await send.send({ ...this.anuncio(o), files: await this.imagenOferta(o), allowedMentions: { users: o.para ? [o.para] : [] } });
    this.s.setMensaje(o.id, ch.id, msg.id);
    if (r.cerrada) await this.cerrarAnuncio(r.cerrada, `🔁 <@${userId}> contestó con una [contraoferta](${msg.url}).`).catch((e) => logError("contraoferta", e));
    this.borradores.delete(userId);
    await i.editReply({ ...this.menuScreen(userId, `✅ **Publicada:** ${msg.url}\n`), allowedMentions: { parse: [] } });
    this.d.log(`🤝 Oferta #${o.id} de ${userId}${o.para ? ` para ${o.para}` : " (abierta)"}`);
  }

  private async aceptar(i: ButtonInteraction, id: number): Promise<void> {
    await i.deferUpdate();
    const no = await this.noPuede(i.user.id);
    if (no) return void (await i.editReply({ content: `🤝 ${no}`, components: [] }));
    // La XP de los niveles se calcula antes del trato (después, quien los entregó ya bajó).
    const antes = this.s.get(id);
    const fijo = { da: antes ? this.xpNiveles(antes.da, antes.de) : null, pide: antes ? this.xpNiveles(antes.pide, i.user.id) : null };
    const r = this.s.aceptar(id, i.user.id);
    if (!r.ok) return void (await i.editReply({ content: this.motivoAceptar(r.motivo), components: [], allowedMentions: { parse: [] } }));
    const o = r.oferta;
    await i.editReply({ content: `✅ **¡Trato hecho!** Ya tienes lo de la oferta #${o.id}.`, components: [] });
    // Apodo y rol de honor de los dos (sin anuncio ni bono de monedas por subir).
    for (const c of r.cambios) await this.d.levelsDiscord.handle(c, {}, { quiet: true, sinBono: true }).catch((e) => logError("nivel por intercambio", e));
    const frase = this.d.phrases.pick("teto", "intercambio_hecho", { de: `<@${o.de}>`, papu: `<@${i.user.id}>` });
    await this.cerrarAnuncio(o, `✅ ${frase}`, fijo).catch((e) => logError("anuncio del intercambio", e));
    this.d.log(`🤝 Intercambio #${o.id}: ${o.de} ↔ ${i.user.id}`);
    await this.d.report(`🤝 Intercambio #${o.id} hecho: <@${o.de}> entregó ${describir(o.da, this.nombres, fijo.da).join(", ")} · <@${i.user.id}> entregó ${describir(o.pide, this.nombres, fijo.pide).join(", ")}.`);
  }

  // ───────────────────────── menús y formularios ─────────────────────────

  async select(i: StringSelectMenuInteraction): Promise<boolean> {
    if (!i.customId.startsWith(P)) return false;
    const [, action, lado] = i.customId.split(":") as [string, string, Lado];
    const userId = i.user.id;
    const b = this.borrador(userId);
    if (action === "add") {
      const kind = i.values[0] ?? "";
      if (kind === "objeto") {
        const sc = this.objetoScreen(userId, lado);
        // Más de 25 (el tope de un menú de Discord): se busca por nombre.
        if (!sc) return void (await i.showModal(this.objetoModal(lado))), true;
        return void (await i.update(sc)), true;
      }
      if (kind === "consumible") return void (await i.update(this.consumibleScreen(userId, lado))), true;
      await i.showModal(this.cantidadModal(userId, lado, kind));
      return true;
    }
    if (action === "obj") {
      b[lado].objetos = i.values.slice(0, 20);
      return void (await i.update({ ...this.builderScreen(userId), allowedMentions: { parse: [] } })), true;
    }
    if (action === "cons") {
      await i.showModal(this.cantidadModal(userId, lado, `c=${i.values[0]}`));
      return true;
    }
    return false;
  }

  async userSelect(i: UserSelectMenuInteraction): Promise<boolean> {
    if (i.customId !== `${P}para`) return false;
    const to = i.users.first();
    if (!to) return true;
    const b = this.borrador(i.user.id);
    if (to.id === i.user.id) return void (await i.update({ ...this.builderScreen(i.user.id, "🤝 No puedes intercambiar contigo mismo.\n"), allowedMentions: { parse: [] } })), true;
    const no = await this.noPuede(to.id, "otro");
    if (no) return void (await i.update({ ...this.builderScreen(i.user.id, `🤝 ${no}\n`), allowedMentions: { parse: [] } })), true;
    b.para = to.id;
    await i.update({ ...this.builderScreen(i.user.id), allowedMentions: { parse: [] } });
    return true;
  }

  async modal(i: ModalSubmitInteraction): Promise<boolean> {
    if (!i.customId.startsWith(P)) return false;
    const [, action, lado, ...rest] = i.customId.split(":") as [string, string, Lado, ...string[]];
    const kind = rest.join(":");
    const userId = i.user.id;
    const b = this.borrador(userId);
    let header = "";
    if (action === "m") {
      const raw = i.fields.getTextInputValue("cantidad").replace(/[.\s]/g, "") || "0";
      if (!/^\d+$/.test(raw)) header = "❌ Escribe solo un número.\n";
      else {
        const n = Number(raw);
        const p = b[lado];
        if ((CANTIDADES as readonly string[]).includes(kind)) p[kind as Cantidad] = Math.min(n, TOPES[kind as Cantidad]);
        else if (kind.startsWith("sobre:")) p.sobres[kind.slice(6) as TipoSobre] = Math.min(n, 1_000);
        else if (kind.startsWith("c=")) {
          const id = kind.slice(2);
          if (n > 0) p.consumibles[id] = Math.min(n, 1_000);
          else delete p.consumibles[id];
        }
        // Aviso temprano: lo que entregas, ¿lo tienes? (se revisa de verdad al publicar y al aceptar).
        if (lado === "da" && n > 0) {
          const t = this.tiene(userId, kind);
          if (t !== null && t < n) header = `⚠️ Solo tienes ${fmt(t)} ${this.nombreDe(kind)}.\n`;
        }
      }
    } else if (action === "mo") {
      const o = buscar(this.candidatos(userId, lado), i.fields.getTextInputValue("nombre"));
      if (!o) header = "❌ No encontré ese objeto (o no se puede cambiar).\n";
      else {
        const l = b[lado].objetos;
        b[lado].objetos = l.includes(o.id) ? l.filter((x) => x !== o.id) : [...l, o.id].slice(0, 20);
      }
    } else return false;
    const sc = { ...this.builderScreen(userId, header), allowedMentions: { parse: [] } };
    if (i.isFromMessage()) await i.update(sc);
    else await i.reply({ ...sc, flags: MessageFlags.Ephemeral });
    return true;
  }

  // ───────────────────────── celular de Neru (app Comercio, PLAN §3.15) ─────────────────────────

  private nombreDePapu(id: string | null): string | null {
    if (!id) return null;
    const mb = this.d.guild().members.cache.get(id);
    return mb ? mb.displayName.replace(/\s*[★✦].*$/, "") : "un Papu";
  }

  private ofertaVista(o: Oferta, yo: string): unknown {
    const lineas = (p: Paquete, quien: string | null) => describir(p, this.nombres, this.xpNiveles(p, quien)).map((l) => l.replace(/\*\*/g, ""));
    return {
      id: o.id,
      de: { id: o.de, nombre: this.nombreDePapu(o.de) },
      para: o.para ? { id: o.para, nombre: this.nombreDePapu(o.para) } : null,
      padre: o.padre,
      da: lineas(o.da, o.de),
      pide: lineas(o.pide, o.para ?? yo),
      daPaquete: o.da,
      pidePaquete: o.pide,
      vence: o.venceAt,
      mia: o.de === yo,
    };
  }

  /** Lo que tiene un Papu para intercambiar (tu lado o el del otro): cantidades, sobres, objetos que se cambian y consumibles. */
  celularInventario(userId: string): unknown {
    const w = this.d.coins.wallet(userId);
    const owned = this.d.coins.owned(userId);
    return {
      monedas: w.monedas,
      xp: this.d.levels.store.get(userId).xp,
      niveles: Math.max(0, this.d.levels.level(userId).level - 1),
      sobres: { comun: this.d.coins.sobresGratis(userId, "comun"), raro: this.d.coins.sobresGratis(userId, "raro"), legendario: this.d.coins.sobresGratis(userId, "legendario") },
      objetos: this.d.coins.catalog.filter((o) => objetoCambiable(o) && owned.has(o.id)).map((o) => ({ id: o.id, nombre: o.nombre, tipo: TIPO_NOMBRE[o.tipo], rareza: RAREZA_NOMBRE[o.rareza] })),
      consumibles: (this.d.mercado?.settings.objetos ?? [])
        .filter((o) => CONSUMIBLES.includes(o.efecto))
        .map((o) => ({ id: o.id, nombre: o.nombre, emoji: o.emoji, usos: this.d.mercado!.usos(userId, o.id) }))
        .filter((c) => c.usos > 0),
    };
  }

  /** Ofertas tuyas, para ti y abiertas de otros, y tu inventario. */
  async celularEstado(userId: string): Promise<unknown> {
    const s = this.s.settings;
    return {
      activo: s.activo,
      puede: await this.noPuede(userId),
      maxAbiertas: s.maxAbiertas,
      mias: this.s.abiertasDe(userId).map((o) => this.ofertaVista(o, userId)),
      paraMi: this.s.abiertasPara(userId).map((o) => this.ofertaVista(o, userId)),
      abiertas: this.s.abiertasGlobales(userId).map((o) => this.ofertaVista(o, userId)),
      inventario: this.celularInventario(userId),
    };
  }

  /** Publicar una oferta (o contraoferta) armada en el celular: mismas reglas y el mismo anuncio en el centro de comercio. */
  async celularPublicar(userId: string, b: { para: string | null; da: unknown; pide: unknown; padre: number | null }, noSePuede: (msg: string) => Error): Promise<string> {
    if (!this.s.settings.activo) throw noSePuede("Los intercambios están apagados por ahora.");
    let para = b.para;
    if (b.padre) {
      const padre = this.s.get(b.padre);
      if (!padre || padre.estado !== "abierta") throw noSePuede("La oferta a la que contestabas ya se cerró.");
      if (padre.para && padre.para !== userId) throw noSePuede("Esa oferta es para otro Papu.");
      para = padre.de;
    }
    const no = (await this.noPuede(userId)) ?? (para ? await this.noPuede(para, "otro") : null);
    if (no) throw noSePuede(no.replace(/\*\*/g, ""));
    const ch = this.canal();
    if (!ch) throw noSePuede(`Falta el canal #${this.s.settings.canal}; GyroP ya lo sabe.`);
    const r = this.s.crear(userId, para, b.da as Paquete, b.pide as Paquete, b.padre);
    if (!r.ok) {
      throw noSePuede(
        r.motivo === "vacia"
          ? "Tienes que entregar algo y pedir algo."
          : r.motivo === "a_ti"
            ? "No puedes ofrecerte algo a ti mismo."
            : r.motivo === "demasiadas"
              ? `Ya tienes ${this.s.settings.maxAbiertas} ofertas abiertas: retira una antes.`
              : r.motivo === "padre"
                ? "La oferta a la que contestabas ya se cerró."
                : `Te falta: ${r.motivo.falta.map((f) => this.falta(f)).join("; ")}.`,
      );
    }
    const o = r.oferta;
    const send = await this.d.sendable("teto", ch.id);
    const msg = await send.send({ ...this.anuncio(o), files: await this.imagenOferta(o), allowedMentions: { users: o.para ? [o.para] : [] } });
    this.s.setMensaje(o.id, ch.id, msg.id);
    if (r.cerrada) await this.cerrarAnuncio(r.cerrada, `🔁 <@${userId}> contestó con una [contraoferta](${msg.url}) desde el 📱 celular de Neru.`).catch((e) => logError("contraoferta", e));
    this.d.log(`🤝 Oferta #${o.id} de ${userId}${o.para ? ` para ${o.para}` : " (abierta)"} (celular)`);
    return `¡Publicada! Teto la anunció en #${this.s.settings.canal} (oferta #${o.id}).`;
  }

  /** Aceptar, rechazar o retirar una oferta desde el celular. */
  async celularResponder(userId: string, id: number, accion: string, noSePuede: (msg: string) => Error): Promise<string> {
    if (accion === "aceptar") {
      const no = await this.noPuede(userId);
      if (no) throw noSePuede(no.replace(/\*\*/g, ""));
      const antes = this.s.get(id);
      const fijo = { da: antes ? this.xpNiveles(antes.da, antes.de) : null, pide: antes ? this.xpNiveles(antes.pide, userId) : null };
      const r = this.s.aceptar(id, userId);
      if (!r.ok) throw noSePuede(this.motivoAceptar(r.motivo).replace(/\*\*|❌ /g, "").replace(/\n- /g, " "));
      const o = r.oferta;
      for (const c of r.cambios) await this.d.levelsDiscord.handle(c, {}, { quiet: true, sinBono: true }).catch((e) => logError("nivel por intercambio", e));
      const frase = this.d.phrases.pick("teto", "intercambio_hecho", { de: `<@${o.de}>`, papu: `<@${userId}>` });
      await this.cerrarAnuncio(o, `✅ ${frase}`, fijo).catch((e) => logError("anuncio del intercambio", e));
      this.d.log(`🤝 Intercambio #${o.id}: ${o.de} ↔ ${userId} (celular)`);
      await this.d.report(`🤝 Intercambio #${o.id} hecho desde el celular: <@${o.de}> entregó ${describir(o.da, this.nombres, fijo.da).join(", ")} · <@${userId}> entregó ${describir(o.pide, this.nombres, fijo.pide).join(", ")}.`);
      return `¡Trato hecho! Ya tienes lo de la oferta #${o.id}.`;
    }
    if (accion === "rechazar") {
      const o = this.s.rechazar(id, userId);
      if (!o) throw noSePuede("Solo el Papu al que iba dirigida puede rechazarla (y tiene que estar abierta).");
      await this.cerrarAnuncio(o, `✖️ <@${userId}> la **rechazó**.`).catch((e) => logError("rechazo", e));
      return "La rechazaste.";
    }
    if (accion === "retirar") {
      const o = this.s.retirar(id, userId, this.d.owners.has(userId));
      if (!o) throw noSePuede("Solo quien hizo la oferta puede retirarla (y tiene que estar abierta).");
      await this.cerrarAnuncio(o, "🗑️ La **retiró** quien la hizo.").catch((e) => logError("retiro", e));
      return "La retiraste.";
    }
    throw noSePuede("No sé hacer eso.");
  }

  // ───────────────────────── anuncios ─────────────────────────

  private anuncio(o: Oferta): { content: string; components: Row[] } {
    if (o.casa)
      return {
        content: this.texto(o, `-# Vence <t:${unix(o.venceAt)}:R>. Oferta de un Vocaloid: sin contraofertas; se la lleva el primer Papu que la acepte.`),
        components: [this.row(this.btn(`acc:${o.id}`, "Aceptar", "✅", ButtonStyle.Success), this.btn(`ret:${o.id}`, "Retirar (GyroP)", "🗑️"))],
      };
    const botones = [this.btn(`acc:${o.id}`, "Aceptar", "✅", ButtonStyle.Success), this.btn(`con:${o.id}`, "Contraoferta", "🔁", ButtonStyle.Primary)];
    if (o.para) botones.push(this.btn(`rec:${o.id}`, "Rechazar", "✖️", ButtonStyle.Danger));
    botones.push(this.btn(`ret:${o.id}`, "Retirar", "🗑️"));
    return { content: this.texto(o, `-# Vence <t:${unix(o.venceAt)}:R>. Con 🔁 cambias lo que se da o se pide y se la devuelves.`), components: [this.row(...botones)] };
  }

  /** `fijo` = la XP que valieron los niveles de cada lado al hacerse el trato (si no, se calcula con el nivel de hoy). */
  private texto(o: Oferta, pie: string, fijo?: { da: number | null; pide: number | null }): string {
    return [
      `## 🤝 Oferta #${o.id}${o.padre ? ` · 🔁 contraoferta a la #${o.padre}` : ""}`,
      o.para ? `De <@${o.de}> para <@${o.para}>` : o.casa ? `De <@${o.de}> · 🎤 **oferta de un Vocaloid**: precio fijo` : `De <@${o.de}> · 🌐 **abierta**: cualquier Papu puede aceptarla`,
      `**📤 Entrega:**\n${this.lista(o.da, o.de, fijo?.da)}`,
      `**📥 Pide:**\n${this.lista(o.pide, o.para ?? (o.estado === "hecha" ? o.con : null), fijo?.pide)}`,
      pie,
    ].join("\n");
  }

  /**
   * Las cartas de los objetos de la tarjeta que se entregan o se piden (pedido de GyroP, 20 nov. 2026), en un JPG con
   * el anuncio. Sin objetos, nada. Si falla el dibujo, el anuncio sale igual (solo con los nombres).
   */
  private async imagenOferta(o: Oferta): Promise<AttachmentBuilder[]> {
    const objs = (ids: string[]) => ids.map((id) => this.d.coins.byId.get(id)).filter((x): x is Objeto => !!x);
    const img = await ofertaImage({ titulo: `Oferta #${o.id}`, entrega: objs(o.da.objetos), pide: objs(o.pide.objetos) }).catch((e) => (logError("imagen de la oferta", e), null));
    return img ? [new AttachmentBuilder(img, { name: `oferta-${o.id}.jpg` })] : [];
  }

  /** Edita el anuncio de una oferta cerrada: sin botones y con cómo terminó. */
  private async cerrarAnuncio(o: Oferta, estado: string, fijo?: { da: number | null; pide: number | null }): Promise<void> {
    if (!o.canal || !o.mensaje) return;
    const send = await this.d.sendable("teto", o.canal).catch(() => null);
    if (!send || !("messages" in send)) return;
    const msg = await send.messages.fetch(o.mensaje).catch(() => null);
    await msg?.edit({ content: this.texto(o, estado, fijo), components: [], allowedMentions: { parse: [] } });
  }

  // ───────────────────────── textos ─────────────────────────

  private falta(f: Falta): string {
    const obj = (id: string) => this.d.coins.byId.get(id)?.nombre ?? id;
    switch (f.que) {
      case "monedas":
      case "xp":
        return `${NOMBRE_CANTIDAD[f.que]}: tiene ${fmt(f.tiene)}, pide ${fmt(f.pide)}`;
      case "cuota":
        return `mensajes de la cuota de hoy: le quedan ${f.tiene}, pide ${f.pide}`;
      case "niveles":
        return `niveles: puede entregar hasta ${f.tiene} (no se baja del nivel 1), pide ${f.pide}`;
      case "sobre":
        return `${SOBRE[f.tipo as TipoSobre]}: tiene ${f.tiene}, pide ${f.pide}`;
      case "objeto":
        return `no tiene ${obj(f.id)}`;
      case "objeto_no_se_cambia":
        return `${obj(f.id)} no se puede intercambiar (fundadores, membresías y exclusivos)`;
      case "consumible":
        return `${this.d.mercado?.byId.get(f.id)?.nombre ?? f.id}: tiene ${f.tiene} usos, pide ${f.pide}`;
      case "ya_tiene_objeto":
        return `ya tiene ${obj(f.id)}`;
      case "cuota_llena":
        return `no le cabe tanta cuota hoy: le caben ${f.cabe} mensajes entre su cuota diaria y sus donados, son ${f.pide}`;
      case "sin_limite":
        return "tiene cuota sin límite (regalo de GyroP): no la cambia";
      case "xp_maxima":
        return `pasaría el nivel máximo: le caben ${fmt(f.cabe)} XP, son ${fmt(f.pide)}`;
    }
  }

  private motivoAceptar(m: AceptarFail): string {
    if (m === "no_existe") return "Esa oferta no existe.";
    if (m === "cerrada") return "Esa oferta ya está cerrada.";
    if (m === "vencida") return "Esa oferta ya venció.";
    if (m === "no_es_para_ti") return "Esa oferta es para otro Papu. Puedes armar la tuya con /intercambio.";
    if (m === "propia") return "Es tu oferta: no puedes aceptarla tú.";
    if ("faltaTuyo" in m) return `❌ No se puede todavía. De tu lado:\n${m.faltaTuyo.map((f) => `- ${this.falta(f)}`).join("\n")}`;
    return `❌ No se puede ahora: quien la hizo ya no tiene todo lo suyo.\n${m.faltaDe.map((f) => `- ${this.falta(f)}`).join("\n")}`;
  }
}
