// Todos los bots en un solo programa (PLAN §4). Neru es el "centro": recibe los mensajes, modera primero y
// luego reparte las menciones; cada bot publica con su propia aplicacion. Los bots no se responden entre ellos.
// Las 4 chicas tienen tareas; Gakupo, Kaito, flower, IA, Haku, Gumi, Rin, Len, Meiko, Adachi Rei y Ruko solo conversan
// (se conectan si tienen token).
import {
  ActivityType,
  AttachmentBuilder,
  ChannelType,
  ThreadAutoArchiveDuration,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  Client,
  Events,
  Partials,
  GatewayIntentBits,
  MessageFlags,
  MessageType,
  PermissionFlagsBits,
  REST,
  Routes,
  type AutoModerationActionOptions,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type Collection,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
  type TextChannel,
  type Message,
  type SendableChannels,
} from "discord.js";
import { BOT_IDS, type BotId, type Config, type CoreBotId } from "../config";
import { kvDelete, kvGet, kvSet, type Db } from "../db/database";
import type { CharacterInfo } from "../engine/reader";
import { logError, type LogFn } from "../log";
import { buildAutoModRules, type AutoModRuleSpec } from "../moderation/automod";
import type { StrikeStore } from "../moderation/strikes";
import type { Phrases } from "../phrases/catalog";
import type { DeckStore } from "../phrases/deck";
import type { CalendarService } from "../calendar/service";
import { emojiMarkup, linkEmojis } from "./emojis";
import { specialRoleColor, type Especiales } from "../services/especiales";
import { founderWindowOpen, needsFounder, type FounderSettings } from "../services/founders";
import { GENERAL_CHAT_MS, type ChannelMessage, type CharlaPort, type CharlaTalker, type GeneralChat } from "../services/charla";
import { AMBIENT_TICK_MS, type AmbientEvent, type AmbientPort, type AmbientService } from "../ambiente/service";
import { ADIVINANZAS_TICK_MS, type AdivinanzasPort, type AdivinanzasService } from "../adivinanzas/service";
import { adivinanzasPort } from "./adivinanzas";
import { nextPresenceBot, parseFarewell, startDecision, type FarewellRecord } from "../services/presence";
import { shouldTease } from "../services/vitrina";
import type { Quota } from "../quota/quota";
import type { LevelService } from "../levels/service";
import { stripNickTag } from "../levels/rules";
import { RuleSet } from "../moderation/rules";
import { LevelsDiscord } from "./levels";
import { publicarPecados } from "../pecados/discord";
import { Comentarista } from "../pecados/comentarista";
import { loadPecados } from "../pecados/rules";
import { BodasDiscord } from "./bodas";
import { RuletaDiscord } from "./ruleta";
import { SorteoDiscord } from "./sorteo";
import { MercadoDiscord } from "./mercado";
import { IntercambiosDiscord } from "./intercambios";
import type { IntercambioService } from "../intercambios/service";
import type { MercadoService } from "../mercado/service";
import { PeleasDiscord } from "./peleas";
import { CarrerasDiscord } from "./carreras";
import { NemesisDiscord } from "./nemesis";
import type { NemesisService } from "../nemesis/service";
import { TiendaDiscord } from "./tienda";
import { toCardEquip } from "../coins/equip";
import type { CardEquip } from "../levels/card";
import { premiarPrestigio } from "../levels/prestigio";
import { SalonDeLaFama } from "./salon";
import { TallerDiscord } from "./taller";
import { FanartDiscord } from "./fanart";
import { RedesStore } from "../fanart/redes";
import { TallerService } from "../taller/service";
import { marcoDe } from "../membresias/marco";
import { multiplicadorXp } from "../membresias/rules";
import type { LanzarPort, MembresiaService } from "../membresias/service";
import type { CoinService } from "../coins/service";
import { TriviaDiscord } from "./trivia";
import { MangoDiscord } from "./mango";
import { textoDespedida } from "../services/despedidas";
import { CumpleDiscord } from "./cumple";
import type { CumpleService } from "../cumpleanos/service";
import type { AjedrezPuente } from "../ajedrez/puente";
import { pardonedFromLog, type MangoService } from "../services/mango";
import { DayStats, papuText, serverText } from "../services/estadisticas";
import type { ActividadTrivia } from "../trivia/actividad";
import type { PuenteCelular } from "../celular/puente";
import { AppsCelular } from "./celular";
import { NoSePuede } from "../celular/puente";
import { armarEstado } from "../mundo/estado";
import { agruparLineas, lineasRegistro, type MundoPuente } from "../mundo/puente";
import { accionesRuleta, giroPlaza } from "../mundo/ruleta";
import type { TriviaService } from "../trivia/service";
import type { RouletteService, SpinResult } from "../ruleta/service";
import type { SorteoService } from "../sorteo/service";
import type { PeleaService } from "../peleas/service";
import type { CarreraService } from "../carreras/service";
import type { Apostador } from "../carreras/images";
import type { WeddingService } from "../bodas/service";
import type { ModerationSettings } from "../moderation/rules";
import { isTrivialReply, mentionedBots, type ChatPort, type ConversationService } from "../services/conversation";
import { pickImage, type ImageAttachment } from "../llm/image";
import type { AutoModHit, ModerationPort, ModerationService, NeruGif } from "../services/moderation";
import { MAX_TICKETS_PER_DAY, TicketStore } from "../services/tickets";
import { fillMentions, loadAnuncios, markAnuncio, mentionedUsernames, pendingAnuncios } from "../services/anuncios";
import { planWelcomeCleanup, type WelcomeMessage } from "../services/welcome-cleanup";
import { dayKey, nextDayStart } from "../time";
import { CHANNELS, channelKey, chunk, findTextChannel } from "./channels";
import { commandsFor, contextMenusFor, STRIKE_MENU, WARN_MENU } from "./commands";
import { TarjetaWeb } from "./tarjeta-web";
import path from "node:path";

/** GIFs de Neru (assets/neru), adjuntos debajo de sus avisos. */
const NERU_GIFS: Record<NeruGif, string> = {
  advertencia: path.resolve(import.meta.dirname, "../../assets/neru/advertencia.gif"),
};

/**
 * Menciones por defecto de todos los bots: solo usuarios, nunca @everyone, @here ni roles. El rol Vocaloids tiene el
 * permiso de mencionar a todos (Discord lo exige para los avisos por nivel), asi que este candado y el `allowedMentions`
 * de cada envio son lo que impide que un Papu logre que un bot repita "@everyone" (decision de GyroP, 18 oct. 2026).
 */
export const SAFE_MENTIONS = { parse: ["users"] as const, repliedUser: true };

const INTENTS: Record<BotId, GatewayIntentBits[]> = {
  neru: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
    // Quien esta en voz con quien: XP por minuto en voz (niveles).
    GatewayIntentBits.GuildVoiceStates,
  ],
  // Reacciones: ⭐ de GyroP o un Mod lleva un mensaje al #salón-de-la-fama (src/discord/salon.ts).
  teto: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions],
  miku: [GatewayIntentBits.Guilds],
  luka: [GatewayIntentBits.Guilds],
  gakupo: [GatewayIntentBits.Guilds],
  kaito: [GatewayIntentBits.Guilds],
  flower: [GatewayIntentBits.Guilds],
  ia: [GatewayIntentBits.Guilds],
  haku: [GatewayIntentBits.Guilds],
  gumi: [GatewayIntentBits.Guilds],
  rin: [GatewayIntentBits.Guilds],
  len: [GatewayIntentBits.Guilds],
  meiko: [GatewayIntentBits.Guilds],
  adachirei: [GatewayIntentBits.Guilds],
  ruko: [GatewayIntentBits.Guilds],
};

const STATUS: Record<BotId, string> = {
  teto: "🥖 en el estudio con GyroP",
  miku: "🎤 lista para la próxima votación",
  luka: "🐟 revisando tips",
  neru: "📱 vigilando… o algo",
  gakupo: "🍆 afilando la katana",
  kaito: "🍦 buscando su helado",
  flower: "🎸 afinando la guitarra",
  ia: "🌙 mirando las estrellas",
  haku: "🌧️ practicando… otra vez",
  gumi: "🥕 lista para lo que sea",
  rin: "🍊 con la apisonadora lista",
  len: "🍌 ensayando… y presumiendo",
  meiko: "🎤 la primera en el escenario",
  adachirei: "🤖 procesando… procesando…",
  ruko: "🌓 acercándose",
};

const HISTORY_LINES = 5;
/** Bots cuyos comandos atiende este programa (Miku y Luka: Cloudflare). */
const LOCAL_COMMAND_BOTS: CoreBotId[] = ["teto", "neru"];
const HEARTBEAT_MS = 60_000;
/** Cada cuanto Teto aplica la XP de la trivia multijugador (Actividad) y calcula los perfiles pedidos. */
const ACTIVIDAD_MS = 8_000;
/** Pedidos de las apps del celular de Neru (Mi tarjeta, Tienda…): la página espera la respuesta. */
const CELULAR_PEDIDOS_MS = 2_000;
/** El mundo se revisa mas seguido: un @ a un Vocaloid espera respuesta en vivo. */
const MUNDO_MS = 3_000;
const CALENDAR_EVERY_MS = 60 * 60_000;
const ROLES_SWEEP_MS = 60 * 60_000;
const CALENDAR_KEY = "calendario:mensaje";
const LAST_SEEN_KEY = "last_seen";
const FAREWELL_KEY = "farewell";

export interface AppDeps {
  config: Config;
  db: Db;
  quota: Quota;
  /** Niveles por participacion (src/levels/): XP, cuota por nivel, apodo y tarjeta. */
  levels: LevelService;
  /** Colores que se pueden elegir para la tarjeta de nivel (/tarjeta). */
  cardColors: { name: string; value: string }[];
  strikes: StrikeStore;
  phrases: Phrases;
  /** Mazos persistidos (para rotar que bot saluda o se despide). */
  decks: DeckStore;
  characters: Record<BotId, CharacterInfo>;
  moderationSettings: ModerationSettings;
  /** Se crean con los puertos de esta app (necesitan los clientes conectados). */
  makeConversation: (port: ChatPort) => ConversationService;
  /** Peso maximo (MB) de una imagen que los Vocaloids miran (PLAN §5.1); null = no ven imagenes. */
  visionMaxMB?: number | null;
  makeModeration: (port: ModerationPort, exempt: () => ReadonlySet<string>) => ModerationService;
  /** Charla espontanea en #general (cada 20 min, src/services/charla.ts). */
  makeGeneralChat: (port: CharlaPort) => GeneralChat;
  /** Ambiente casual (PLAN §3.13: reacciones, metiches, comentarios, preguntas al aire, momentos); null = apagado. */
  makeAmbient?: (talker: CharlaTalker, port: AmbientPort) => AmbientService | null;
  /** «¡Adivina, Papu!» (PLAN §3.17): adivinanzas al aire con pozo de Shaulitas; null = apagado. */
  makeAdivinanzas?: (port: AdivinanzasPort) => { service: AdivinanzasService; rolSabelotodo: string; rolAviso: string | null } | null;
  /** Dueños (compartido con la cuota): aqui se agrega el dueño del servidor al conectar. */
  owners: Set<string>;
  /** Trato especial de un Papu concreto (config/especiales.json): sin cuota, su rol de adorno y su trato con un bot. */
  especiales?: Especiales;
  /** Roles especiales cuyo color sigue al de #tus-roles (`sobreNiveles`): nombre -> color propio; y la paleta. */
  specialColors?: { base: Map<string, number>; palette: string[] };
  /** Insignia Fundador por tiempo limitado (null = ya no se entrega). */
  founders: FounderSettings | null;
  /** Rol que Teto da a cada Papu al entrar (null = ninguno). */
  everyoneRole: string | null;
  /** Rol de los Mods (dan machetazos y advertencias con Neru, como GyroP; null = sin Mods). */
  modRole?: string | null;
  /** Rol de adorno de quien GyroP perdono de un machetazo (🔪 Sobreviviente; null = no se da). */
  survivorRole?: { rol: string; color: string } | null;
  /** Mango9374, el que imita a un Papu real (src/services/mango.ts; null = sin token, no se conecta). */
  mango?: MangoService | null;
  /** Canales de nivel que se anuncian en #vitrina (clave -> nivel con emoji). */
  vitrina: Map<string, string>;
  /** Bodas con las Vocaloids (src/bodas/; null = desactivadas). */
  weddings?: WeddingService | null;
  /** Ruleta de los Papus (src/ruleta/; null = desactivada). */
  roulette?: RouletteService | null;
  /** Trivia de los Papus (src/trivia/; null = desactivada). */
  trivia?: TriviaService | null;
  /** Trivia multijugador (Actividad de Discord): XP de los aciertos guardados en D1 (null = sin token de Cloudflare). */
  actividad?: ActividadTrivia | null;
  /** Celular de Neru (PLAN §3.15): XP de los retos del día y perfil (Shaulitas y tarjeta) en D1 (null = sin Cloudflare). */
  celular?: PuenteCelular | null;
  /** Mundo de los Papus (Actividad 3D): @ a los Vocaloids de la plaza y nivel/cuota de cada Papu (null = sin Cloudflare). */
  mundo?: MundoPuente | null;
  /** Sorteo de GyroP (src/sorteo/; null = desactivado). */
  sorteo?: SorteoService | null;
  /** 1vs1 de los Vocaloids con apuestas de Shaulitas (src/peleas/; null = desactivado). */
  peleas?: PeleaService | null;
  /** Carreras de los Vocaloids con apuestas mutuas (src/carreras/; null = desactivado). PLAN §3.14. */
  carreras?: CarreraService | null;
  /** Ruleta de Némesis: ruleta rusa entre dos Papus con Shaulitas (src/nemesis/; null = desactivada). */
  nemesis?: NemesisService | null;
  /** Shaulitas: tienda, sobres y objetos de la tarjeta (src/coins/; null = desactivada). */
  coins?: CoinService | null;
  /** Cumpleaños de los Papus y los Vocaloids (src/cumpleanos/; null = desactivado). */
  cumple?: CumpleService | null;
  /** Ajedrez del celular: apuestas y avisos de Neru (src/ajedrez/puente.ts; null = sin Cloudflare o sin tienda). */
  ajedrez?: AjedrezPuente | null;
  /** Mercado negro: consumibles con Shaulitas (src/mercado/; null = desactivado). */
  mercado?: MercadoService | null;
  /** Intercambios entre Papus (src/intercambios/; null = desactivados). */
  intercambios?: IntercambioService | null;
  /** Membresías de Ko-fi: XP, lanzar peleas y bodas, sobres temáticos, descuentos (src/membresias/; null sin tienda). */
  membresias?: MembresiaService | null;
  /** Personalizar la tarjeta en la web (PAPUS_WEB y TARJETA_CLAVE del .env; null = sin el botón). */
  tarjetaWeb?: { base: string; clave: string } | null;
  /** Calendario automatico de #calendario (null = desactivado: falta el token de Cloudflare o la carpeta). */
  calendar: { service: CalendarService; channel: string; publicar: boolean } | null;
  log: LogFn;
}

export class PapusApp {
  readonly clients: Record<BotId, Client>;
  private readonly botByUserId = new Map<string, BotId>();
  private guild!: Guild;
  private ownerId: string | null;
  private conversation!: ConversationService;
  private moderation!: ModerationService;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private calendarTimer: ReturnType<typeof setInterval> | null = null;
  private actividadTimer: ReturnType<typeof setInterval> | null = null;
  private celularTimer: ReturnType<typeof setInterval> | null = null;
  private ajedrezTimer: ReturnType<typeof setInterval> | null = null;
  private celularPedidosTimer: ReturnType<typeof setInterval> | null = null;
  private mundoTimer: ReturnType<typeof setInterval> | null = null;
  private rolesTimer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private chatTimer: ReturnType<typeof setInterval> | null = null;
  private generalChat!: GeneralChat;
  private ambient: AmbientService | null = null;
  private ambientTimer: ReturnType<typeof setInterval> | null = null;
  private adivinanzas: AdivinanzasService | null = null;
  private adivinanzasTimer: ReturnType<typeof setInterval> | null = null;
  private levels!: LevelsDiscord;
  /** Desafío semanal de los 7 pecados (config/pecados.json). */
  private readonly pecados = loadPecados();
  private bodas: BodasDiscord | null = null;
  private ruleta: RuletaDiscord | null = null;
  private trivia: TriviaDiscord | null = null;
  private sorteo: SorteoDiscord | null = null;
  private mercado: MercadoDiscord | null = null;
  private intercambios: IntercambiosDiscord | null = null;
  private peleas: PeleasDiscord | null = null;
  private carreras: CarrerasDiscord | null = null;
  /** Emojis de la aplicación de Teto (nombre → "<:x:id>"): las caras de los corredores de las carreras. */
  private appEmojis = new Map<string, string>();
  private nemesis: NemesisDiscord | null = null;
  private tienda: TiendaDiscord | null = null;
  private cumple: CumpleDiscord | null = null;
  /** Taller de los Papus: /aportar (PLAN §2; necesita las membresías). */
  private taller: TallerDiscord | null = null;
  /** #🎨・fanart: /redes y la respuesta de Teto en cada fanart (PLAN §8). */
  private fanart: FanartDiscord | null = null;
  private readonly mango: MangoDiscord | null;
  /** Mensajes enviados por dia y los numeros que da Mango9374. */
  private readonly dayStats: DayStats;

  constructor(private readonly d: AppDeps) {
    this.ownerId = d.config.ownerId;
    this.tickets = new TicketStore(d.db);
    // enforceNonce: si Discord crea el mensaje pero la confirmacion no llega, discord.js reintenta el envio; con el
    // nonce, Discord devuelve el mensaje que ya existe en vez de publicarlo dos veces (caso real del 21 oct. 2026: Miku
    // respondio dos veces lo mismo a los 8 @ de un Papu).
    this.clients = Object.fromEntries(d.config.activeBots.map((id) => [id, new Client({ intents: INTENTS[id], ...(id === "teto" ? { partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User] } : {}), enforceNonce: true, allowedMentions: { parse: [...SAFE_MENTIONS.parse], repliedUser: SAFE_MENTIONS.repliedUser } })])) as Record<BotId, Client>;
    this.dayStats = new DayStats({ db: d.db, quota: d.quota, levels: d.levels, timeZone: d.config.quotaTimeZone, roulette: d.roulette, weddings: d.weddings, trivia: d.trivia, coins: d.coins, owners: d.owners });
    const names = { ...Object.fromEntries(BOT_IDS.map((b) => [b, d.characters[b].displayName])), mango: d.weddings?.settings.chicas.mango?.nombre ?? "Mango9374" };
    this.mango =
      d.mango && d.config.mangoToken
        ? new MangoDiscord({
            service: d.mango,
            token: d.config.mangoToken,
            db: d.db,
            owners: d.owners,
            stats: { papu: (id) => papuText(this.dayStats.papu(id), names), server: () => serverText(this.dayStats.server()) },
            report: (t) => this.report(t),
            log: d.log,
          })
        : null;
  }

  async start(): Promise<void> {
    const { config, log } = this.d;
    await Promise.all(
      config.activeBots.map(async (id) => {
        const client = this.clients[id];
        const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
        await client.login(config.tokens[id]!);
        await ready;
        this.botByUserId.set(client.user!.id, id);
        client.user!.setPresence({ status: "online", activities: [{ name: "estado", type: ActivityType.Custom, state: STATUS[id] }] });
        log(`${id} en línea como ${client.user!.tag}`);
      }),
    );
    // Mango9374 es opcional: si no conecta, los demas siguen.
    const mangoUp = await this.mango?.start().then(() => true, (e) => (logError("Mango9374", e), false));

    this.guild = await this.clients.neru.guilds.fetch(config.guildId);
    await this.guild.channels.fetch();
    this.ownerId ??= this.guild.ownerId;
    this.d.owners.add(this.guild.ownerId);
    if (this.ownerId) this.d.owners.add(this.ownerId);

    this.conversation = this.d.makeConversation(this.chatPort());
    this.moderation = this.d.makeModeration(this.moderationPort(), () => this.d.owners);
    this.levels = new LevelsDiscord({
      levels: this.d.levels,
      quota: this.d.quota,
      phrases: this.d.phrases,
      rules: new RuleSet(this.d.moderationSettings),
      db: this.d.db,
      owners: this.d.owners,
      isStaff: (userId) => this.isStaff(userId),
      teto: this.clients.teto,
      timeZone: config.quotaTimeZone,
      dataDir: config.dataDir,
      defaultAccent: `#${this.d.characters.teto.color.toString(16).padStart(6, "0")}`,
      botColors: Object.fromEntries(Object.entries(this.d.characters).map(([id, c]) => [id, `#${c.color.toString(16).padStart(6, "0")}`])) as Record<BotId, string>,
      guild: () => this.guild,
      sendable: (bot, channelId) => this.sendable(bot, channelId),
      grantRole: (userId, roleName, reason) => this.grantRole(userId, roleName, reason),
      report: (text) => this.report(text),
      modChannel: async () => {
        const ch = findTextChannel(this.guild, CHANNELS.moderacion);
        return ch ? this.sendable("neru", ch.id) : null;
      },
      // Objetos de las Shaulitas en la tarjeta y bono por subir de nivel (PLAN §3.6).
      equipment: this.d.coins ? (userId) => this.cardEquip(userId) : undefined,
      onLevelUp: this.d.coins ? (change) => void this.d.coins!.onLevelChange(change) : undefined,
      membresia: (roles) => marcoDe(this.d.membresias?.nivel(roles)),
      presentador: () => this.presentadorRanking(),
      despuesDelRanking: (channelId, day) =>
        publicarPecados(
          { db: this.d.db, settings: this.pecados, phrases: this.d.phrases, timeZone: config.quotaTimeZone, sendable: (bot, id) => this.sendable(bot, id), report: (t) => this.report(t), log: this.d.log },
          channelId,
          day,
        ),
      premioPrestigio: this.d.coins ? (userId, stars) => premiarPrestigio(this.d.levels.settings, this.d.coins!, this.d.membresias ?? null, userId, stars) : undefined,
      log: this.d.log,
    });
    // Gallerian (Kaito) comenta las ganancias de Shaulitas en la semana de la Avaricia (src/pecados/comentarista.ts).
    if (this.d.coins) {
      const comentarista = new Comentarista({
        db: this.d.db,
        settings: this.pecados,
        phrases: this.d.phrases,
        timeZone: config.quotaTimeZone,
        canal: (nombre) => findTextChannel(this.guild, nombre)?.id ?? null,
        canalNemesis: (id) => (this.d.db.prepare("SELECT canal FROM nemesis WHERE id = ?").get(id) as { canal: string | null } | undefined)?.canal ?? null,
        esBot: (userId) => Object.values(this.clients).some((c) => c.user?.id === userId) || this.mango?.client.user?.id === userId,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        log: this.d.log,
      });
      this.d.coins.onGain = (userId, cantidad, motivo) => comentarista.onGain(userId, cantidad, motivo);
    }
    if (this.d.weddings) {
      this.bodas = new BodasDiscord({
        ambient: (e) => this.ambientEvent(e),
        weddings: this.d.weddings,
        levels: this.d.levels,
        levelsDiscord: this.levels,
        quota: this.d.quota,
        phrases: this.d.phrases,
        characters: this.d.characters,
        // Mango9374 tambien se casa (pedido de GyroP, 12 nov. 2026) si conecto y esta en config/bodas.json.
        online: mangoUp ? [...config.activeBots, "mango"] : config.activeBots,
        owners: this.d.owners,
        isStaff: (userId) => this.isStaff(userId),
        lanzar: this.lanzarPort(),
        sobreTematico: this.d.coins ? (userId, bot) => this.d.coins!.regalarTematicoDe(userId, bot) : undefined,
        clients: mangoUp ? { ...this.clients, mango: this.mango!.client } : this.clients,
        guild: () => this.guild,
        sendable: async (bot, channelId) => {
          if (bot !== "mango") return this.sendable(bot, channelId);
          const ch = await this.mango!.client.channels.fetch(channelId);
          if (!ch?.isSendable()) throw new Error(`mango no puede escribir en el canal ${channelId}`);
          return ch;
        },
        report: (text) => this.report(text),
        timeZone: config.quotaTimeZone,
        log: this.d.log,
      });
    }
    if (this.d.roulette) {
      this.ruleta = new RuletaDiscord({
        roulette: this.d.roulette,
        membresia: (roles) => marcoDe(this.d.membresias?.nivel(roles)),
        levelsDiscord: this.levels,
        phrases: this.d.phrases,
        decks: this.d.decks,
        characters: this.d.characters,
        online: config.activeBots,
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        log: this.d.log,
      });
    }
    if (this.d.trivia) {
      this.trivia = new TriviaDiscord({
        ambient: (e) => this.ambientEvent(e),
        trivia: this.d.trivia,
        levelsDiscord: this.levels,
        phrases: this.d.phrases,
        online: config.activeBots,
        clients: this.clients,
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        log: this.d.log,
      });
    }
    if (this.d.sorteo) {
      this.sorteo = new SorteoDiscord({
        sorteo: this.d.sorteo,
        levelsDiscord: this.levels,
        phrases: this.d.phrases,
        decks: this.d.decks,
        characters: this.d.characters,
        online: config.activeBots,
        owners: this.d.owners,
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        log: this.d.log,
      });
    }
    if (this.d.peleas) {
      this.peleas = new PeleasDiscord({
        ambient: (e) => this.ambientEvent(e),
        peleas: this.d.peleas,
        phrases: this.d.phrases,
        db: this.d.db,
        characters: this.d.characters,
        owners: this.d.owners,
        isStaff: (userId) => this.isStaff(userId),
        lanzar: this.lanzarPort(),
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        timeZone: config.quotaTimeZone,
        // Cara de cada luchador en el marcador (los emojis de las carreras: aplicación de Teto o del servidor).
        cara: (id) => {
          const nombre = this.d.carreras?.settings.corredores[id]?.emoji;
          return nombre ? (this.appEmojis.get(nombre) ?? this.guild.emojis.cache.find((e) => e.name === nombre)?.toString() ?? null) : null;
        },
        log: this.d.log,
      });
    }
    if (this.d.carreras) {
      const carreras = this.d.carreras;
      this.carreras = new CarrerasDiscord({
        carreras,
        phrases: this.d.phrases,
        info: (id) => {
          const ch = this.d.characters[id as BotId];
          const l = this.d.peleas?.settings.luchadores[id];
          return { nombre: ch?.displayName ?? l?.nombre ?? id, color: ch ? `#${ch.color.toString(16).padStart(6, "0")}` : (l?.color ?? "#ffb020") };
        },
        emoji: (name) => this.appEmojis.get(name) ?? this.guild.emojis.cache.find((e) => e.name === name)?.toString() ?? null,
        papus: (ids) => this.apostadores(ids),
        honor: () => this.papusDeHonor(),
        peleaActiva: () => !!this.d.peleas?.active(),
        ambient: (e) => this.ambientEvent(e),
        pique: async (bot, target, situacion) => (await this.generalChat.tick({ force: true, bot, target, pique: situacion })) !== "skipped",
        online: () => config.activeBots,
        owners: this.d.owners,
        isStaff: (userId) => this.isStaff(userId),
        lanzar: this.lanzarPort(),
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        timeZone: config.quotaTimeZone,
        log: this.d.log,
      });
    }
    if (this.d.nemesis) {
      this.nemesis = new NemesisDiscord({
        ambient: (e) => this.ambientEvent(e),
        membresia: (roles) => marcoDe(this.d.membresias?.nivel(roles)),
        svc: this.d.nemesis,
        phrases: this.d.phrases,
        owners: this.d.owners,
        isStaff: (userId) => this.isStaff(userId),
        guild: () => this.guild,
        sendable: (channelId, bot) => this.sendable(bot ?? "teto", channelId),
        // Desafíos de los Vocaloids (14 nov. 2026): cualquier Vocaloid conectado puede retar a un Papu activo.
        botOf: (userId) => this.botByUserId.get(userId),
        houseBots: () => [...this.botByUserId.keys()],
        timeZone: config.quotaTimeZone,
        report: (text) => this.report(text),
        log: this.d.log,
      });
    }
    // Multiplicador de XP de las membresías (PLAN §2): según los roles de Ko-fi que tenga en el servidor. Y el de su
    // cumpleaños (×2 todo el día, 18 nov. 2026): se multiplican.
    if (this.d.membresias || this.d.cumple) {
      const m = this.d.membresias;
      const c = this.d.cumple;
      this.d.levels.membershipBoost = (id) => {
        const mb = m ? this.guild?.members.cache.get(id) : null;
        return (mb ? multiplicadorXp(m!.nivel(mb.roles.cache.map((r) => r.name))) : 1) * (c?.boost(id) ?? 1);
      };
    }
    if (this.d.cumple) {
      this.cumple = new CumpleDiscord({
        cumple: this.d.cumple,
        coins: this.d.coins,
        phrases: this.d.phrases,
        guild: () => this.guild,
        online: () => this.d.config.activeBots,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        displayName: (bot) => this.d.characters[bot].displayName,
        owners: this.d.owners,
        isStaff: (userId) => this.isStaff(userId),
        report: (text) => this.report(text),
        log: this.d.log,
      });
    }
    if (this.d.membresias) {
      const m = this.d.membresias;
      this.taller = new TallerDiscord({
        taller: new TallerService(this.d.db),
        niveles: m.settings.niveles,
        nivel: (id) => this.lanzarPort()!.nivel(id),
        owners: this.d.owners,
        isStaff: (userId) => this.isStaff(userId),
        filtro: (text) => {
          const v = new RuleSet(this.d.moderationSettings).check({ text, targetsSomeone: true, memberAgeHours: 1e6, personalData: true });
          return v ? v.detail : null;
        },
        temporadaDesde: () => Date.parse(`${this.d.coins?.settings.temporada.desde ?? "2026-01-01"}T00:00:00-03:00`),
        trivia: this.d.trivia ?? null,
        weddings: this.d.weddings ?? null,
        peleas: this.d.peleas ?? null,
        nombreDe: (id) => this.d.characters[id as BotId]?.displayName ?? this.d.peleas?.settings.luchadores[id]?.nombre ?? (id === "mango" ? "Mango9374" : id),
        teto: this.clients.teto,
        guild: () => this.guild,
        sendable: (channelId) => this.sendable("teto", channelId),
        report: (text) => this.report(text),
      });
      this.taller.start();
    }
    if (this.d.coins && this.d.membresias) {
      this.tienda = new TiendaDiscord({
        coins: this.d.coins,
        levelsDiscord: this.levels,
        phrases: this.d.phrases,
        db: this.d.db,
        owners: this.d.owners,
        clients: this.clients,
        online: config.activeBots,
        membresias: this.d.membresias!,
        web: this.d.tarjetaWeb
          ? new TarjetaWeb({
              coins: this.d.coins,
              store: this.d.levels.store,
              cardData: (userId) => this.levels.cardData(userId),
              founder: (userId) => this.d.coins!.founderNumber(userId),
              base: this.d.tarjetaWeb.base,
              clave: this.d.tarjetaWeb.clave,
              log: (msg) => this.d.log(`⚠️ ${msg}`),
            })
          : null,
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        filtro: (text) => {
          const v = new RuleSet(this.d.moderationSettings).check({ text, targetsSomeone: true, memberAgeHours: 1e6, personalData: true });
          return v ? v.detail : null;
        },
        log: this.d.log,
      });
    }
    if (this.d.mercado && this.d.coins) {
      this.mercado = new MercadoDiscord({
        mercado: this.d.mercado,
        coins: this.d.coins,
        phrases: this.d.phrases,
        db: this.d.db,
        owners: this.d.owners,
        clients: this.clients,
        online: config.activeBots,
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        log: this.d.log,
      });
    }
    if (this.d.intercambios && this.d.coins) {
      this.intercambios = new IntercambiosDiscord({
        svc: this.d.intercambios,
        coins: this.d.coins,
        levels: this.d.levels,
        levelsDiscord: this.levels,
        mercado: this.d.mercado ?? null,
        phrases: this.d.phrases,
        owners: this.d.owners,
        clients: this.clients,
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        timeZone: this.d.config.quotaTimeZone,
        botName: (bot) => this.d.characters[bot].displayName,
        log: this.d.log,
      });
    }
    // Machetazo de Neru: se pierde la XP del dia (queda anotada para devolverla al perdonar).
    this.d.strikes.onAdd = (userId, now) => {
      try {
        return this.levels.onStrike(userId, now);
      } catch (e) {
        logError("XP por machetazo", e);
        return null;
      }
    };

    await this.registerCommands();
    await this.syncAutoMod();
    this.wireEvents();
    if (mangoUp) void this.mango!.syncProfile(this.guild).catch((e) => logError("perfil de Mango9374", e));
    void this.trivia?.syncSecretRole().catch((e) => logError("rol secreto de la trivia", e));
    void this.pastSurvivors().catch((e) => logError("sobrevivientes anteriores", e));

    const lastSeen = Number(kvGet(this.d.db, LAST_SEEN_KEY) ?? 0);
    await this.greetOnStart(lastSeen || null).catch((e) => logError("saludo", e));
    if (lastSeen > 0) await this.reconnectTasks(lastSeen).catch((e) => logError("tareas de reconexión", e));
    await this.cleanWelcome().catch((e) => logError("limpieza de #bienvenida", e));
    await this.sendAnuncios().catch((e) => logError("avisos de una vez", e));
    // #despedidas: Teto lo crea al arrancar si no existe (antes esperaba a que alguien se fuera).
    await this.ensureFarewellChannel().catch((e) => logError("canal de despedidas", e));
    this.touchLastSeen();
    this.lastBeat = Date.now();
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.rolesTimer = setInterval(() => void this.sweepRoles().catch((e) => logError("repaso de roles", e)), ROLES_SWEEP_MS);
    this.generalChat = this.d.makeGeneralChat(this.charlaPort());
    this.chatTimer = setInterval(() => {
      if (!this.stopping) void this.generalChat.tick().catch((e) => logError("charla en #general", e));
    }, GENERAL_CHAT_MS);
    this.ambient = this.d.makeAmbient?.(this.generalChat, this.ambientPort()) ?? null;
    if (this.ambient) {
      const ambient = this.ambient;
      this.ambientTimer = setInterval(() => {
        if (!this.stopping) void ambient.tick().catch((e) => logError("ambiente (reloj)", e));
      }, AMBIENT_TICK_MS);
    }
    // «¡Adivina, Papu!» (PLAN §3.17): el reloj cada 5 s (pistas, pozo, final a los 2 min y el plan del día).
    let rolSabelotodo = "🧠 Sabelotodo";
    const adiv = this.d.makeAdivinanzas?.(
      adivinanzasPort({ guild: () => this.guild, clients: this.clients, sendable: (bot, id) => this.sendable(bot, id), get rolSabelotodo() { return rolSabelotodo; }, log: this.d.log }),
    ) ?? null;
    if (adiv) {
      rolSabelotodo = adiv.rolSabelotodo;
      this.adivinanzas = adiv.service;
      if (adiv.rolAviso) void this.ensurePlainRole(adiv.rolAviso, "Aviso de #tus-roles: ¡Adivina, Papu!").catch((e) => logError("rol de aviso de adivinanzas", e));
      this.adivinanzasTimer = setInterval(() => {
        if (!this.stopping) void adiv.service.tick().catch((e) => logError("adivinanzas al aire", e));
      }, ADIVINANZAS_TICK_MS);
    }
    if (this.d.actividad) {
      const actividad = this.d.actividad;
      actividad.onChange = (change, channelId) => this.levels.handle(change, channelId ? { channelId } : {});
      actividad.onPremio = async (userId, premio, channelId) => void (await this.trivia?.premioActividad(userId, premio, channelId));
      let busy = false;
      let mecenasAt = 0;
      this.actividadTimer = setInterval(() => {
        if (busy || this.stopping) return;
        busy = true;
        // Cada hora: «Con el apoyo de…» de la portada (membresías con nombrePortada: Celular y más; PLAN §2).
        if (this.d.membresias && Date.now() - mecenasAt > 3_600_000) {
          mecenasAt = Date.now();
          const roles = new Set(this.d.membresias.settings.niveles.filter((n) => n.nombrePortada).map((n) => n.rol));
          const nombres = new Set<string>();
          for (const r of this.guild.roles.cache.values()) if (roles.has(r.name)) for (const mb of r.members.values()) if (!mb.user.bot && !this.d.owners.has(mb.id)) nombres.add(stripNickTag(mb.displayName));
          void actividad.setMecenas([...nombres]).catch((e) => logError("portada de la trivia", e));
        }
        void actividad
          .sync()
          .then((n) => n && this.d.log(`🧠 Trivia multijugador: XP de ${n} acierto(s) aplicada`))
          .catch((e) => logError("trivia multijugador", e))
          .finally(() => (busy = false));
      }, ACTIVIDAD_MS);
    }
    if (this.d.celular) {
      const celular = this.d.celular;
      celular.onChange = (change) => this.levels.handle(change, {});
      celular.perfil = async (userId) => {
        if (!(await this.guild.members.fetch(userId).catch(() => null))) return null;
        return { shaulitas: this.d.coins?.wallet(userId).monedas ?? 0, tarjeta: await this.levels.cardPng(userId) };
      };
      const apps = new AppsCelular({
        coins: this.d.coins ?? null,
        store: this.d.levels.store,
        cardData: (userId) => this.levels.cardData(userId),
        founder: (userId) => this.d.coins?.founderNumber(userId) ?? null,
        mercado: this.mercado,
        tienda: this.tienda,
        comercio: this.intercambios,
        ruleta: this.ruleta
          ? {
              celularEstado: (userId) => this.ruleta!.celularEstado(userId),
              girar: async (userId, accion, noSePuede) => {
                const mb = await this.guild.members.fetch(userId).catch(() => null);
                const nombre = stripNickTag(mb?.displayName ?? "Papu");
                const avatar = mb?.user.displayAvatarURL({ extension: "png", size: 128 }) ?? "";
                return this.ruleta!.celularGirar(userId, accion, nombre, avatar, noSePuede);
              },
            }
          : null,
        donar: {
          estado: (userId) => {
            const left = this.d.quota.dailyLeft(userId);
            return { quedan: Number.isFinite(left) ? left : 0, tope: this.d.quota.donatedCap, sinLimite: !Number.isFinite(left) };
          },
          donar: (fromId, toId, n) => this.donarDesdeCelular(fromId, toId, n),
        },
        buscarPapus: async (q) => {
          const found = await this.guild.members.search({ query: q, limit: 15 }).catch(() => null);
          return found ? [...found.values()].filter((m) => !m.user.bot).map((m) => ({ id: m.id, nombre: stripNickTag(m.displayName) })) : [];
        },
      });
      celular.manejar = (p) => apps.manejar(p);
      // Pedidos de las apps (Mi tarjeta…): vuelta rápida, para que la página no espere.
      let ocupado = false;
      this.celularPedidosTimer = setInterval(() => {
        if (ocupado || this.stopping) return;
        ocupado = true;
        void celular
          .pedidos((msg) => this.d.log(`⚠️ ${msg}`))
          .catch((e) => logError("pedidos del celular", e))
          .finally(() => (ocupado = false));
      }, CELULAR_PEDIDOS_MS);
      let busy = false;
      this.celularTimer = setInterval(() => {
        if (busy || this.stopping) return;
        busy = true;
        void celular
          .sync()
          .then((r) => r.premios && this.d.log(`📱 Celular de Neru: XP de ${r.premios} reto(s) aplicada`))
          .catch((e) => logError("celular de Neru", e))
          .finally(() => (busy = false));
      }, ACTIVIDAD_MS);
    }
    if (this.d.ajedrez) {
      // Ajedrez (celular de Neru): cada 5 s Neru cobra y paga las apuestas y avisa retos y resultados en #general.
      const ajedrez = this.d.ajedrez;
      let ocupadoAj = false;
      this.ajedrezTimer = setInterval(() => {
        if (ocupadoAj || this.stopping) return;
        ocupadoAj = true;
        void ajedrez
          .tick()
          .then(async (avisos) => {
            const general = avisos.length ? findTextChannel(this.guild, CHANNELS.general) : null;
            if (!general) return;
            const ch = await this.sendable("neru", general.id);
            for (const a of avisos) await ch.send({ content: a.texto, allowedMentions: { users: a.menciones } });
          })
          .catch((e) => logError("ajedrez", e))
          .finally(() => (ocupadoAj = false));
      }, 5000);
    }
    if (this.d.mundo) {
      const mundo = this.d.mundo;
      // Un @ respondido en la plaza da la misma XP que en Discord (la del mensaje y la de la respuesta del Vocaloid).
      mundo.onAnswered = async (userId, text) => {
        const base = await this.levels.onMessage(userId, text, {});
        await this.levels.onBotReply(userId, base, {});
      };
      // Foto del servidor para las zonas de la plaza: la boda mas reciente, la pelea, el mercado, los podios y el sorteo.
      mundo.estado = () =>
        armarEstado({
          ultimaBoda: () => {
            const r = this.d.db.prepare("SELECT bot, user_id, nombre, inicio, fin, divorcio FROM bodas ORDER BY inicio DESC LIMIT 1").get() as
              | { bot: string; user_id: string; nombre: string; inicio: number; fin: number; divorcio: number | null }
              | undefined;
            return r ? { bot: r.bot, userId: r.user_id, name: r.nombre, startedAt: r.inicio, endsAt: r.fin, divorcedAt: r.divorcio } : null;
          },
          pelea: () => {
            if (!this.d.peleas) return null;
            const p = this.d.peleas.active();
            if (p) return { a: p.a, b: p.b, cuotas: p.cuotas, estado: p.estado, cierraAt: p.cierraAt, ganador: p.ganador };
            const r = this.d.db.prepare("SELECT a, b, cuota_a, cuota_b, estado, cierra_at, ganador FROM peleas ORDER BY creada_at DESC LIMIT 1").get() as
              | { a: string; b: string; cuota_a: number; cuota_b: number; estado: string; cierra_at: number; ganador: string | null }
              | undefined;
            return r ? { a: r.a, b: r.b, cuotas: [r.cuota_a, r.cuota_b], estado: r.estado, cierraAt: r.cierra_at, ganador: r.ganador } : null;
          },
          mercado: () => this.d.mercado?.estado() ?? { abierto: false, apertura: { abre: 0, cierra: 0 } },
          ranking: () => this.levels.standings(),
          ultimoSorteo: () =>
            (this.d.db.prepare("SELECT user_id AS userId, detalle, at FROM sorteos ORDER BY at DESC LIMIT 1").get() as { userId: string; detalle: string; at: number } | undefined) ?? null,
          nombre: (id) => {
            const mb = this.guild?.members.cache.get(id);
            return stripNickTag(mb?.displayName ?? mb?.user.username ?? "Papu");
          },
          luchador: (id) => this.d.characters[id as BotId]?.displayName ?? this.d.peleas?.settings.luchadores[id]?.nombre ?? id,
          casillas: () => this.d.roulette?.settings.premios.map((p) => ({ icono: p.icono, etiqueta: p.etiqueta, color: p.color, nombre: p.nombre })) ?? [],
        });
      // Ruleta en la plaza (decisiones de GyroP, 9 nov. 2026): /ruleta y la ventana giran con las mismas reglas que en
      // Discord; los giros de Discord tambien giran la ruleta grande, y la plaza avisa al Papu cuando gana una tirada.
      const ruleta = this.ruleta;
      if (ruleta && this.d.roulette) {
        const roulette = this.d.roulette;
        const textos = (res: SpinResult) => {
          const g = ruleta.gifText(res);
          return { titulo: g.title, subtitulo: g.subtitle, premio: ruleta.prizeText(res) };
        };
        Object.assign(
          mundo.acciones,
          accionesRuleta({
            roulette,
            textos,
            despues: async (userId, res) => {
              if (res.change) await this.levels.handle(res.change, {}, { quiet: true }).catch((e) => logError("nivel por ruleta (plaza)", e));
              await ruleta.onActivity(userId, {}).catch((e) => logError("misiones de ruleta (plaza)", e));
            },
          }),
        );
        ruleta.alGirar = (userId, name, res) => void mundo.evento("ruleta", giroPlaza({ id: userId, nombre: name }, res, textos(res), "discord").giro);
        ruleta.alCumplir = (userId, misiones, left) => {
          const cuales = misiones.map((m) => m.nombre).join(" y ");
          const texto = `🎡 ¡Cumpliste ${cuales}! Tienes ${left} ${left === 1 ? "tirada" : "tiradas"} en la ruleta grande: escribe /ruleta.`;
          void mundo.evento("aviso", { texto }, userId);
        };
      }
      // Registro del chat de la plaza en #plaza-papus (solo lectura), en mensajes agrupados y sin avisar a nadie.
      mundo.onChat = async (lineas) => {
        const ch = this.guild ? findTextChannel(this.guild, CHANNELS.plaza) : null;
        if (!ch) return;
        for (const parte of agruparLineas(lineasRegistro(lineas, (bot) => this.d.characters[bot as BotId]?.displayName ?? bot), 1900)) {
          await ch.send({ content: parte, allowedMentions: { parse: [] } });
        }
      };
      let busy = false;
      this.mundoTimer = setInterval(() => {
        if (busy || this.stopping) return;
        busy = true;
        void mundo
          .sync()
          .then((n) => n && this.d.log(`🌳 Mundo: ${n} @ a los Vocaloids`))
          .catch((e) => logError("mundo de los Papus", e))
          .finally(() => (busy = false));
      }, MUNDO_MS);
    }
    if (this.d.calendar) {
      void this.updateCalendar().catch((e) => logError("calendario", e));
      this.calendarTimer = setInterval(() => void this.updateCalendar().catch((e) => logError("calendario", e)), CALENDAR_EVERY_MS);
    }
    await this.report(`✅ Bots en línea (${[...config.activeBots, ...(mangoUp ? ["mango9374"] : [])].join(", ")}).`);
    // Tienda de Shaulitas: emojis, paquete de fundadores, menu fijado y vitrina del dia.
    void this.tienda?.start().catch((e) => logError("tienda", e));
    // 1vs1: lo apostado en una pelea que quedo a medias (reinicio) se devuelve.
    void this.peleas?.start().catch((e) => logError("peleas", e));
    // Carreras: las caras de los corredores (emojis de la aplicación de Teto) y lo apostado en una carrera a medias.
    void this.loadAppEmojis()
      .then(() => this.carreras?.start())
      .catch((e) => logError("carreras", e));
    void this.nemesis?.start().catch((e) => logError("ruleta de Némesis", e));
    // Mercado negro: rol del aviso y el mensaje de Neru (abre una hora al dia, a una hora sorpresa).
    void this.mercado?.start().catch((e) => logError("mercado negro", e));
    // Intercambios: el canal #centro-de-comercio (con su modo lento) y las ofertas vencidas.
    void this.intercambios?.start().catch((e) => logError("intercambios", e));
    // Bodas: la adivinanza inaugural sale apenas arrancan los bots con el parche (y lo vencido se cierra).
    void this.bodas?.tick().catch((e) => logError("bodas", e));
  }

  private stopping = false;
  private readonly tickets: TicketStore;

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.calendarTimer) clearInterval(this.calendarTimer);
    if (this.actividadTimer) clearInterval(this.actividadTimer);
    if (this.celularTimer) clearInterval(this.celularTimer);
    if (this.ajedrezTimer) clearInterval(this.ajedrezTimer);
    if (this.celularPedidosTimer) clearInterval(this.celularPedidosTimer);
    if (this.mundoTimer) clearInterval(this.mundoTimer);
    if (this.rolesTimer) clearInterval(this.rolesTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    if (this.chatTimer) clearInterval(this.chatTimer);
    if (this.ambientTimer) clearInterval(this.ambientTimer);
    if (this.adivinanzasTimer) clearInterval(this.adivinanzasTimer);
    this.peleas?.stop();
    this.carreras?.stop();
    this.nemesis?.stop();
    await this.farewell().catch((e) => logError("despedida", e));
    this.touchLastSeen();
    await Promise.all([...this.d.config.activeBots.map((id) => this.clients[id].destroy()), this.mango?.stop()]);
  }

  /** Saludo en #general al conectarse, salvo reinicio rapido (entonces se borra la despedida anterior). */
  private async greetOnStart(lastSeen: number | null): Promise<void> {
    const farewell = parseFarewell(kvGet(this.d.db, FAREWELL_KEY));
    kvDelete(this.d.db, FAREWELL_KEY);
    const { greet, deleteFarewell } = startDecision(lastSeen, farewell);
    if (deleteFarewell) {
      const ch = await this.sendable(deleteFarewell.bot, deleteFarewell.channelId).catch(() => null);
      if (ch && "messages" in ch) await ch.messages.delete(deleteFarewell.messageId).catch(() => {});
    }
    if (!greet) return;
    const general = findTextChannel(this.guild, CHANNELS.general);
    if (!general) return;
    const bot = nextPresenceBot(this.d.decks);
    const ch = await this.sendable(bot, general.id);
    await ch.send({ content: this.d.phrases.pick(bot, "saludo_conexion"), allowedMentions: { parse: [] } });
  }

  /** Avisos de una sola vez de config/anuncios.json (p. ej. la llegada de Ruko). Si no se puede, quedan pendientes. */
  private async sendAnuncios(): Promise<void> {
    for (const a of pendingAnuncios(this.d.db, loadAnuncios(), this.d.config.activeBots)) {
      const ids = new Map<string, string>();
      for (const name of mentionedUsernames(a.texto)) {
        const found = await this.guild.members.search({ query: name, limit: 10 }).catch(() => null);
        const mb = found?.find((x) => x.user.username.toLowerCase() === name);
        if (mb) ids.set(name, mb.id);
      }
      const content = fillMentions(a.texto, ids);
      const target = findTextChannel(this.guild, a.canal);
      if (!content || !target) {
        await this.report(`⚠️ Aviso "${a.id}" pendiente: ${target ? "no encuentro al Papu que menciona" : `no encuentro #${a.canal}`}.`);
        continue;
      }
      try {
        const ch = await this.sendable(a.bot, target.id);
        await ch.send({ content, allowedMentions: { users: [...ids.values()] } });
        markAnuncio(this.d.db, a.id);
        this.d.log(`Aviso "${a.id}" publicado por ${a.bot} en #${a.canal}`);
      } catch (e) {
        await this.report(`⚠️ Aviso "${a.id}" pendiente: ${a.bot} no pudo escribir en #${a.canal} (¿ya está en el servidor?): ${(e as Error).message}`);
      }
    }
  }

  /** Despedida en #general al apagar; se guarda para poder borrarla si el reinicio es rapido. */
  private async farewell(): Promise<void> {
    const general = this.guild ? findTextChannel(this.guild, CHANNELS.general) : null;
    if (!general) return;
    const bot = nextPresenceBot(this.d.decks);
    const ch = await this.sendable(bot, general.id);
    const msg = await ch.send({ content: this.d.phrases.pick(bot, "despedida"), allowedMentions: { parse: [] } });
    const record: FarewellRecord = { bot, channelId: general.id, messageId: msg.id, at: Date.now() };
    kvSet(this.d.db, FAREWELL_KEY, JSON.stringify(record));
  }

  /** Aviso en #registro-bots (y consola). */
  async report(text: string): Promise<void> {
    this.d.log(text);
    const ch = this.guild ? findTextChannel(this.guild, CHANNELS.registro) : null;
    await ch?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }

  private touchLastSeen(): void {
    kvSet(this.d.db, LAST_SEEN_KEY, String(Date.now()));
  }

  private lastBeat = 0;

  /** Papus conectados en voz ahora (sin bots ni el canal AFK; para los minutos en voz de Mango9374). */
  private inVoice(): string[] {
    const guild = this.guild;
    if (!guild) return [];
    return [...guild.voiceStates.cache.values()]
      .filter((vs) => vs.channelId && vs.channelId !== guild.afkChannelId && !vs.member?.user.bot && !this.botByUserId.has(vs.id))
      .map((vs) => vs.id);
  }

  /**
   * Latido cada minuto. Si entre dos latidos paso mucho tiempo, el PC estuvo suspendido: al despertar se saluda (si
   * fueron mas de 30 min) y se hacen las tareas de reconexion (bienvenidas, resumen de Neru, "ya volvi").
   */
  private beat(): void {
    const now = Date.now();
    const gap = now - this.lastBeat;
    this.lastBeat = now;
    const prevSeen = Number(kvGet(this.d.db, LAST_SEEN_KEY) ?? now);
    this.touchLastSeen();
    try {
      this.dayStats.countVoiceMinute(this.inVoice());
    } catch (e) {
      logError("minutos en voz", e);
    }
    void this.levels
      .voiceTick((id) => this.botByUserId.has(id))
      .then(() => this.ruleta?.voiceCheck((id) => this.botByUserId.has(id)))
      .catch((e) => logError("XP en voz", e));
    void this.pollLaunched()
      .then(() => this.levels.announceFixedEvents())
      .catch((e) => logError("evento de XP", e));
    if (!this.stopping) void this.bodas?.tick().catch((e) => logError("bodas", e));
    if (!this.stopping) void this.tienda?.tick().catch((e) => logError("tienda", e));
    if (!this.stopping) void this.peleas?.tick().catch((e) => logError("pelea automática", e));
    if (!this.stopping) void this.carreras?.tick().catch((e) => logError("carrera automática", e));
    if (!this.stopping) void this.nemesis?.tick().catch((e) => logError("ruleta de Némesis", e));
    if (!this.stopping) void this.mercado?.tick().catch((e) => logError("mercado negro", e));
    if (!this.stopping) void this.intercambios?.tick().catch((e) => logError("intercambios", e));
    if (!this.stopping) void this.levels.publishDailyRanking().catch((e) => logError("ranking del día", e));
    if (!this.stopping) void this.cumple?.tick().catch((e) => logError("cumpleaños", e));
    if (gap < HEARTBEAT_MS * 3) return;
    this.d.log(`El PC despertó tras ${Math.round(gap / 60_000)} min de suspensión`);
    void (async () => {
      await this.greetOnStart(prevSeen);
      await this.reconnectTasks(prevSeen);
    })().catch((e) => logError("despertar", e));
  }

  // ───────────────────────── eventos ─────────────────────────

  private wireEvents(): void {
    const neru = this.clients.neru;
    neru.on(Events.MessageCreate, (m) => void this.onMessage(m).catch((e) => logError("mensaje", e)));
    // #salón-de-la-fama: ⭐ de GyroP o un Mod (PLAN §2).
    const salon = new SalonDeLaFama({
      db: this.d.db,
      owners: this.d.owners,
      isStaff: (userId) => this.isStaff(userId),
      guild: () => this.guild,
      sendable: (channelId) => this.sendable("teto", channelId),
      report: (text) => this.report(text),
    });
    this.clients.teto.on(Events.MessageReactionAdd, (r, u) => void salon.onReaction(r, u).catch((e) => logError("salón de la fama", e)));
    // #🎨・fanart: Teto responde cada publicación nueva con las redes del artista (PLAN §8).
    this.fanart = new FanartDiscord({
      redes: new RedesStore(this.d.db),
      phrases: this.d.phrases,
      tetoId: () => this.clients.teto.user?.id,
      owners: this.d.owners,
      isStaff: (userId) => this.isStaff(userId),
      filtro: (text) => {
        const v = new RuleSet(this.d.moderationSettings).check({ text, targetsSomeone: true, memberAgeHours: 1e6, personalData: false });
        return v ? v.detail : null;
      },
      report: (text) => this.report(text),
    });
    this.clients.teto.on(Events.ThreadCreate, (t, nuevo) => void this.fanart?.onThreadCreate(t, nuevo).catch((e) => logError("fanart nuevo", e)));
    neru.on(Events.AutoModerationActionExecution, (exec) => {
      if (exec.action.type !== AutoModerationActionType.BlockMessage || exec.guild.id !== this.guild.id) return;
      const ruleName = exec.autoModerationRule?.name ?? "AutoMod";
      void this.moderation
        .handleAutoModHit({ userId: exec.userId, channelId: exec.channelId, ruleName, content: exec.content })
        .catch((e) => logError("AutoMod", e));
    });
    this.clients.teto.on(Events.GuildMemberAdd, (member) => {
      if (member.user.bot || member.guild.id !== this.guild.id) return;
      void this.welcome([member.id]).catch((e) => logError("bienvenida", e));
      void this.grantEveryone([member.id]).catch((e) => logError("rol Papu", e));
    });
    // #despedidas (idea de Flor_fino; GyroP, 18 nov. 2026): Teto avisa quién se fue, con frase fija.
    this.clients.teto.on(Events.GuildMemberRemove, (member) => {
      if (member.user.bot || member.guild.id !== this.guild.id) return;
      void this.saySeFue(member).catch((e) => logError("despedida", e));
    });
    // Ko-fi da el rol del nivel; si es la primera semana, Teto agrega la insignia Fundador.
    this.clients.teto.on(Events.GuildMemberUpdate, (old, member) => {
      if (member.guild.id === this.guild.id) void this.levels.onMemberUpdate(old, member).catch((e) => logError("niveles (miembro)", e));
      if (this.d.especiales?.get(member.id)) void this.syncSpecialColor(member).catch((e) => logError("color de rol especial", e));
      // Rol de membresia nuevo: su insignia permanente para la tarjeta (pedido de GyroP, 31 oct. 2026).
      if (!member.user.bot && member.guild.id === this.guild.id && member.roles.cache.size > old.roles.cache.size)
        void this.tienda?.membershipBadges(member.id, member.roles.cache.map((r) => r.name)).catch((e) => logError("insignia de membresía", e));
      const f = this.d.founders;
      if (!f || member.user.bot || member.guild.id !== this.guild.id || !founderWindowOpen(f, Date.now())) return;
      if (needsFounder(f, member.roles.cache.map((r) => r.name))) void this.grantFounders([member.id]).catch((e) => logError("Fundador", e));
    });
    for (const id of this.d.config.activeBots) {
      this.clients[id].on(Events.InteractionCreate, (i) => {
        if (i.isChatInputCommand()) void this.onCommand(id, i).catch((e) => logError(`comando /${i.commandName}`, e));
        else if (i.isAutocomplete() && (i.commandName === "pelea" || i.commandName === "aportar")) void this.peleas?.autocomplete(i).catch((e) => logError("autocompletar /pelea", e));
        else if (i.isButton())
          void (async () => (await this.trivia?.button(i)) || (await this.bodas?.button(i)) || (await this.ruleta?.button(i)) || (await this.sorteo?.button(i)) || (await this.peleas?.button(i)) || (await this.carreras?.button(i)) || (await this.nemesis?.button(i)) || (await this.mercado?.button(i)) || (await this.intercambios?.button(i)) || (await this.tienda?.button(i)) || (await this.taller?.button(i)) || (await this.fanart?.button(i)) || (await this.levels.button(i)))().catch((e) => logError(`botón ${i.customId}`, e));
        else if (i.isUserSelectMenu()) void (async () => (await this.sorteo?.userSelect(i)) || (await this.mercado?.userSelect(i)) || (await this.intercambios?.userSelect(i)))().catch((e) => logError(`menú ${i.customId}`, e));
        else if (i.isStringSelectMenu()) void (async () => (await this.mercado?.select(i)) || (await this.intercambios?.select(i)) || (await this.trivia?.select(i)) || (await this.tienda?.select(i)))().catch((e) => logError(`menú ${i.customId}`, e));
        else if (i.isModalSubmit()) void (async () => (await this.peleas?.modal(i)) || (await this.carreras?.modal(i)) || (await this.trivia?.modal(i)) || (await this.intercambios?.modal(i)) || (await this.tienda?.modal(i)))().catch((e) => logError(`formulario ${i.customId}`, e));
        else if (id === "neru" && i.isMessageContextMenuCommand() && i.commandName === WARN_MENU)
          void this.warnFromMenu(i).catch((e) => logError("advertir (menú)", e));
        else if (id === "neru" && i.isMessageContextMenuCommand() && i.commandName === STRIKE_MENU)
          void this.strikeFromMenu(i).catch((e) => logError("machetazo (menú)", e));
      });
      this.clients[id].on(Events.Error, (e) => logError(`cliente ${id}`, e));
    }
  }

  private async onMessage(m: Message): Promise<void> {
    if (m.system || !m.inGuild() || m.guildId !== this.guild.id) return;
    if (m.type !== MessageType.Default && m.type !== MessageType.Reply) return;
    // Mensajes del dia de Papus y Vocaloids (los numeros de Mango9374).
    if (!m.author.bot || this.botByUserId.has(m.author.id)) {
      try {
        this.dayStats.countMessage(m.author.id, m.author.bot);
      } catch (e) {
        logError("contar mensaje", e);
      }
    }
    if (m.author.bot) return;
    this.nemesis?.seen(m.author.id);

    // 1) Moderacion primero (reglas fijas, nunca el LLM).
    const replied = m.reference?.messageId ? await m.fetchReference().catch(() => null) : null;
    const others = m.mentions.users.filter((u) => !u.bot && u.id !== m.author.id);
    const targetsSomeone = others.size > 0 || (!!replied && !replied.author.bot && replied.author.id !== m.author.id);
    // A los Vocaloids tampoco se les falta el respeto (GyroP): mencionar o responder a uno de nuestros bots.
    // (Mango9374 tambien: imita a un Papu real.)
    const ours = (id: string) => this.botByUserId.has(id) || id === this.mango?.userId;
    const targetsBot = m.mentions.users.some((u) => ours(u.id)) || (!!replied && ours(replied.author.id));
    const joined = m.member?.joinedTimestamp ?? Date.now();
    const violation = await this.moderation.handle({
      messageId: m.id,
      channelId: m.channelId,
      authorId: m.author.id,
      text: m.content,
      targetsSomeone,
      targetsBot,
      memberAgeHours: (Date.now() - joined) / 3_600_000,
      freeLanguage: this.isFreeChannel(m),
      noFlood: this.bodas?.floodFree(m.channelId) ?? false,
    });
    if (violation?.remove) return;

    // Habla de hacerse daño: frase fija de apoyo de Neru + aviso a GyroP, en vez de la respuesta del LLM.
    if (await this.moderation.support({ messageId: m.id, channelId: m.channelId, authorId: m.author.id, text: m.content })) return;

    // Niveles: XP por el mensaje (por largo, con espera y sin repetidos). Doble si un Vocaloid le contesta.
    const ctx = { channelId: m.channelId, messageId: m.id };
    const xpBase = await this.levels.onMessage(m.author.id, m.content, ctx).catch((e) => (logError("XP del mensaje", e), 0));
    // Ruleta: el mensaje pudo cumplir la mision de mensajes o la de subir de nivel (Teto avisa).
    void this.ruleta?.onActivity(m.author.id, ctx).catch((e) => logError("misiones de ruleta", e));

    // GyroP publico en un canal de nivel: aviso en #vitrina (donde y para quien, nunca que).
    // (Los reportes van por tickets, /reporte: un aviso por ticket, no por mensaje.)
    if (this.d.owners.has(m.author.id)) await this.teaseVitrina(m.channelId).catch((e) => logError("vitrina", e));

    // Bodas: un intento en el hilo de la adivinanza (lo revisa el codigo, nunca el LLM) o una respuesta al mensaje de
    // la adivinanza fuera del hilo: no van a los Vocaloids ni gastan cuota.
    const boda = await this.bodas
      ?.onMessage({ messageId: m.id, channelId: m.channelId, authorId: m.author.id, authorName: this.speakerName(m), text: m.content, repliedTo: m.reference?.messageId ?? null })
      .catch((e) => (logError("bodas (mensaje)", e), false));
    if (boda) return;

    // ¡Adivina, Papu! (PLAN §3.17): un intento de la adivinanza al aire de este canal (lo revisa el codigo, nunca el
    // LLM). Si lo fue, no va a los Vocaloids ni gasta cuota.
    const adivinanza = await this.adivinanzas
      ?.onMessage({ channelId: m.channelId, messageId: m.id, authorId: m.author.id, authorName: this.speakerName(m), text: m.content, repliedTo: m.reference?.messageId ?? null })
      .catch((e) => (logError("adivinanzas (mensaje)", e), false));
    if (adivinanza) return;

    // Mango9374: frase fija a su @, una vez al dia por Papu (sin LLM ni cuota). Los Vocaloids nombrados en el mismo
    // mensaje contestan igual.
    await this.mango?.onMessage(m).catch((e) => logError("Mango9374", e));
    void this.mango?.react(m).catch((e) => logError("Mango9374 (reacción)", e));

    // 2) Menciones a los bots (en orden; responder a un bot cuenta como mencionarlo).
    const bots = mentionedBots(m.content, this.botByUserId, replied?.author.bot ? replied.author.id : null);
    // Ambiente casual (PLAN §3.13): una reaccion con emoji o un Vocaloid metiche si lo nombran sin @ (sin cuota).
    void this.ambient
      ?.onMessage({ id: m.id, channelId: m.channelId, channelName: "name" in m.channel ? m.channel.name : "", authorName: this.speakerName(m), text: m.cleanContent, addressed: bots.length > 0 || targetsBot })
      .catch((e) => logError("ambiente (mensaje)", e));
    if (bots.length === 0) return;
    // Imagen para los Vocaloids (PLAN §5.1): la del mensaje o, si no trae, la del mensaje al que responde ("@Teto
    // ¿qué opinas de esto?" respondiendo a un dibujo). Nunca la de un mensaje de un bot.
    const image = this.imageOf(m, replied);
    // Responder a un bot con "XD" o un emoji, sin @, no es hablarle: no gasta cuota ni recibe respuesta. Con una imagen
    // si lo es (le esta mostrando algo).
    if (mentionedBots(m.content, this.botByUserId).length === 0 && isTrivialReply(m.content) && !(image && m.attachments.size)) return;
    const outcome = await this.conversation.handle({
      messageId: m.id,
      channelId: m.channelId,
      authorId: m.author.id,
      authorName: this.speakerName(m),
      fromOwner: this.d.owners.has(m.author.id),
      text: m.cleanContent,
      bots,
      history: () => this.history(m),
      image,
    });
    if (outcome === "answered" || outcome === "partial") await this.levels.onBotReply(m.author.id, xpBase, ctx).catch((e) => logError("XP con Vocaloid", e));
  }

  /**
   * /donar (pedido de GyroP, 31 oct. 2026): un Papu le cede mensajes de su cuota diaria de hoy a otro (los pierde él). Al
   * otro le llegan a su espacio de donados, con tope (14 nov. 2026). Sale publico para que el otro se entere.
   */
  private async donar(i: ChatInputCommandInteraction): Promise<void> {
    const to = i.options.getUser("papu", true);
    const n = i.options.getInteger("cantidad", true);
    const no = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (to.bot) return void (await no("Los Vocaloids no usan cuota: regálasela a un Papu. 🥖"));
    if (to.id === i.user.id) return void (await no("No puedes donarte a ti mismo, Papu. 🥖"));
    const r = this.d.quota.donate(i.user.id, to.id, n);
    if (!r.ok) {
      const left = this.d.quota.dailyLeft(i.user.id);
      const room = this.d.quota.donatedRoom(to.id);
      const cap = this.d.quota.donatedCap;
      const why =
        r.motivo === "sin_limite"
          ? "Tus mensajes no tienen límite: es un regalo solo para ti, así que no se pueden donar. 💙"
          : r.motivo === "no_alcanza"
            ? `Solo se dona de tu cuota diaria, y te ${left === 1 ? "queda **1 mensaje**" : `quedan **${left} mensajes**`} hoy: no alcanza para donar ${n}. (Lo que te donaron a ti no se vuelve a regalar.)`
            : room > 0
              ? `A ${to} solo le ${room === 1 ? "cabe **1 donado** más" : `caben **${room} donados** más`} hoy (máximo ${cap} sin usar).`
              : `${to} ya tiene sus **${cap} donados** del día sin usar: no le cabe más. Guárdalos para ti. 🥖`;
      return void (await no(why));
    }
    const left = this.d.quota.remaining(i.user.id);
    const got = this.d.quota.donatedLeft(to.id);
    await i.reply({
      content: `🎁 ${i.user} le regaló **${n} ${n === 1 ? "mensaje" : "mensajes"}** con los Vocaloids a ${to} (solo por hoy). ¡Qué buen Papu! 🥖\n-# A ${i.user.username} le ${left === 1 ? "queda 1" : `quedan ${left}`} hoy · ${to.username}: donados ${got}/${this.d.quota.donatedCap} · /donar`,
      allowedMentions: { users: [to.id] },
    });
    this.d.log(`🎁 ${i.user.username} donó ${n} mensajes a ${to.username}`);
  }

  /**
   * Donar desde el celular de Neru (PLAN §3.15): las mismas reglas que /donar; Teto lo anuncia en #general para que el
   * otro se entere. Lanza NoSePuede con el motivo.
   */
  private async donarDesdeCelular(fromId: string, toId: string, n: number): Promise<string> {
    const to = await this.guild.members.fetch(toId).catch(() => null);
    if (!to) throw new NoSePuede("Ese Papu ya no está en el servidor.");
    if (to.user.bot) throw new NoSePuede("Los Vocaloids no usan cuota: regálasela a un Papu.");
    const r = this.d.quota.donate(fromId, toId, n);
    if (!r.ok) {
      const left = this.d.quota.dailyLeft(fromId);
      const room = this.d.quota.donatedRoom(toId);
      const cap = this.d.quota.donatedCap;
      throw new NoSePuede(
        r.motivo === "sin_limite"
          ? "Tus mensajes no tienen límite: es un regalo solo para ti, así que no se pueden donar."
          : r.motivo === "no_alcanza"
            ? `Solo se dona de tu cuota diaria, y te ${left === 1 ? "queda 1 mensaje" : `quedan ${left} mensajes`} hoy.`
            : room > 0
              ? `A ${stripNickTag(to.displayName)} solo le ${room === 1 ? "cabe 1 donado" : `caben ${room} donados`} más hoy (máximo ${cap} sin usar).`
              : `${stripNickTag(to.displayName)} ya tiene sus ${cap} donados del día sin usar.`,
      );
    }
    const left = this.d.quota.remaining(fromId);
    const got = this.d.quota.donatedLeft(toId);
    const general = findTextChannel(this.guild, CHANNELS.general);
    const ch = general ? await this.sendable("teto", general.id).catch(() => null) : null;
    if (ch) {
      await ch
        .send({
          content: `🎁 <@${fromId}> le regaló **${n} ${n === 1 ? "mensaje" : "mensajes"}** con los Vocaloids a <@${toId}> (solo por hoy) desde el 📱 celular de Neru. ¡Qué buen Papu! 🥖\n-# ${stripNickTag(to.displayName)}: donados ${got}/${this.d.quota.donatedCap} · /donar`,
          allowedMentions: { users: [toId] },
        })
        .catch((e) => logError("anuncio de donar (celular)", e));
    }
    this.d.log(`🎁 ${fromId} donó ${n} mensajes a ${toId} (celular)`);
    return `Listo: le regalaste ${n} ${n === 1 ? "mensaje" : "mensajes"} a ${stripNickTag(to.displayName)}. Te ${left === 1 ? "queda 1" : `quedan ${left}`} hoy.`;
  }

  /** Primera imagen que se puede mirar del mensaje, o del que responde si el suyo no trae (y no es de un bot). */
  private imageOf(m: Message, replied: Message | null): ImageAttachment | null {
    const max = this.d.visionMaxMB;
    if (!max) return null;
    const of = (x: Message) => pickImage([...x.attachments.values()].map((a) => ({ url: a.url, contentType: a.contentType, size: a.size })), max);
    return of(m) ?? (replied && !replied.author.bot ? of(replied) : null);
  }

  private async history(m: Message) {
    const msgs = await m.channel.messages.fetch({ before: m.id, limit: HISTORY_LINES }).catch(() => null);
    if (!msgs) return [];
    // El mensaje al que responde va siempre, aunque ya haya quedado fuera de las ultimas lineas (caso real del 19 oct.
    // 2026: Lolo le respondio "No, explica" a una pregunta de Luka de 7 mensajes atras y ella no sabia de que hablaba).
    const replied = m.reference?.messageId ? await m.fetchReference().catch(() => null) : null;
    const lines = [...msgs.values()].reverse();
    if (replied && !msgs.has(replied.id)) lines.unshift(replied);
    return lines
      .filter((x) => x.cleanContent.trim())
      .map((x) => {
        const bot = this.botByUserId.get(x.author.id);
        const author = bot ? this.d.characters[bot].displayName : this.speakerName(x);
        return { author: x.id === replied?.id ? `${author} (el mensaje al que le están respondiendo)` : author, text: x.cleanContent };
      });
  }

  /** Nombre para el LLM: GyroP por su id (un Papu que se ponga "GyroP" de apodo queda marcado como Papu). */
  private speakerName(m: Message): string {
    if (this.d.owners.has(m.author.id)) return "GyroP";
    // Sin la etiqueta de nivel del apodo ("karin ✦57" -> "karin"): el LLM no necesita el numero.
    const name = stripNickTag(m.member?.displayName ?? m.author.displayName);
    if (/gyro\s*p/i.test(name)) return `${name} (un Papu, no GyroP)`;
    const imitated = this.d.especiales?.imitated(m.author.id, name);
    return imitated ? `${name} (un Papu, no ${imitated})` : name;
  }

  private async onCommand(bot: BotId, i: ChatInputCommandInteraction): Promise<void> {
    if (bot === "teto" && i.commandName === "cuota") {
      const q = this.d.quota;
      const left = q.remaining(i.user.id);
      const limit = q.limitFor(i.user.id);
      const hours = Math.ceil((nextDayStart(new Date(), this.d.config.quotaTimeZone) - Date.now()) / 3_600_000);
      const text = Number.isFinite(left)
        ? `**Cuota diaria ${q.dailyLeft(i.user.id)}/${limit} - Donados ${q.donatedLeft(i.user.id)}/${q.donatedCap}**\n` +
          `Te quedan **${left}** mensajes con los Vocaloids hoy (se comparten entre todos; cada @ cuenta uno, y se gastan primero los diarios). ` +
          `Tu cuota diaria sube con tu nivel (/nivel) y la rellenan la ruleta y el sorteo. Los **donados** son los que te regalan otros Papus con /donar: te caben hasta ${q.donatedCap} sin usar. ` +
          `Lo que recibes por /intercambio entra donde haya espacio: primero en tu cuota diaria y después en donados. Solo se dona de la cuota diaria. Todo se recarga en ~${hours} h, a medianoche de Chile.`
        : this.d.owners.has(i.user.id)
          ? "No tienes límite de mensajes (eres GyroP)."
          : "No tienes límite de mensajes con los Vocaloids: es un regalo de GyroP. 💙";
      await i.reply({ content: text, flags: MessageFlags.Ephemeral });
      return;
    }
    if (bot === "teto" && i.commandName === "donar") return this.donar(i);
    if (bot === "teto" && i.commandName === "nivel") return this.levels.nivel(i);
    if (bot === "teto" && i.commandName === "tarjeta") {
      if (!this.tienda) return void (await i.reply({ content: "La tienda está apagada, así que la tarjeta no se puede personalizar por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.tienda.tarjeta(i);
    }
    if (bot === "teto" && i.commandName === "ranking") return this.levels.ranking(i);
    if (bot === "teto" && i.commandName === "boda") {
      if (!this.bodas) return void (await i.reply({ content: "Las bodas están apagadas por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.bodas.boda(i);
    }
    if (bot === "teto" && i.commandName === "ruleta") {
      if (!this.ruleta) return void (await i.reply({ content: "La ruleta está apagada por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.ruleta.ruleta(i);
    }
    if (bot === "teto" && (i.commandName === "tienda" || i.commandName === "monedas")) {
      if (!this.tienda) return void (await i.reply({ content: "La tienda está cerrada por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return i.commandName === "tienda" ? this.tienda.tienda(i) : this.tienda.monedas(i);
    }
    if (bot === "teto" && i.commandName === "redes") {
      if (!this.fanart) return void (await i.reply({ content: "Aún estoy despertando. Inténtalo en un momento. 🥖", flags: MessageFlags.Ephemeral }));
      return this.fanart.redes(i);
    }
    if (bot === "teto" && i.commandName === "aportar") {
      if (!this.taller) return void (await i.reply({ content: "El taller está cerrado por ahora. ✍️", flags: MessageFlags.Ephemeral }));
      return this.taller.aportar(i);
    }
    if (bot === "teto" && i.commandName === "color") {
      if (!this.tienda) return void (await i.reply({ content: "La tienda está cerrada por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.tienda.colorPropio(i);
    }
    if (bot === "teto" && i.commandName === "pelea") {
      if (!this.peleas) return void (await i.reply({ content: "Las peleas están apagadas por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.peleas.pelea(i);
    }
    if (bot === "teto" && i.commandName === "cumple") {
      if (!this.cumple) return void (await i.reply({ content: "Los cumpleaños están apagados por ahora. 🎂", flags: MessageFlags.Ephemeral }));
      return this.cumple.command(i);
    }
    if (bot === "teto" && i.commandName === "carrera") {
      if (!this.carreras) return void (await i.reply({ content: "Las carreras están apagadas por ahora. 🏇", flags: MessageFlags.Ephemeral }));
      return this.carreras.carrera(i);
    }
    if (bot === "teto" && i.commandName === "nemesis") {
      if (!this.nemesis) return void (await i.reply({ content: "La Ruleta de Némesis está cerrada por ahora. 🔫", flags: MessageFlags.Ephemeral }));
      return this.nemesis.nemesis(i);
    }
    if (bot === "teto" && i.commandName === "sorteo") {
      if (!this.sorteo) return void (await i.reply({ content: "El sorteo está apagado por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.sorteo.sorteo(i);
    }
    if (bot === "teto" && i.commandName === "consumibles") {
      if (!this.mercado) return void (await i.reply({ content: "El mercado negro está cerrado por ahora. 🕶️", flags: MessageFlags.Ephemeral }));
      return this.mercado.consumibles(i);
    }
    if (bot === "teto" && i.commandName === "intercambio") {
      if (!this.intercambios) return void (await i.reply({ content: "Los intercambios están apagados por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.intercambios.intercambio(i);
    }
    if (bot === "teto" && i.commandName === "trivia") {
      if (!this.trivia) return void (await i.reply({ content: "La trivia está apagada por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.trivia.trivia(i);
    }
    if (bot === "teto" && i.commandName === "divorcio") {
      if (!this.bodas) return void (await i.reply({ content: "Las bodas están apagadas por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.bodas.divorcio(i);
    }
    if (bot === "teto" && i.commandName === "publicar-ranking") return this.levels.publicarRanking(i);
    if (bot === "teto" && i.commandName === "adivinanza") return this.lanzarAdivinanza(i);
    if (bot === "teto" && i.commandName === "evento") return this.levels.evento(i);
    if (bot === "teto" && i.commandName === "reiniciar-cuota") {
      if (!this.d.owners.has(i.user.id)) {
        await i.reply({ content: "¡Eso solo lo usa GyroP! 🥖", flags: MessageFlags.Ephemeral });
        return;
      }
      const target = i.options.getUser("papu");
      const n = this.d.quota.reset(target?.id ?? null);
      const who = target ? `${target}` : "todos los Papus";
      await i.reply({ content: `¡Listo! Cuota de hoy reiniciada para ${who} (${n} con mensajes usados). ¡teto-teetoo!`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      await this.report(`🔄 GyroP reinició la cuota de hoy para ${who} (${n} con mensajes usados).`);
      return;
    }
    if (bot === "teto" && i.commandName === "charla") {
      if (!this.d.owners.has(i.user.id)) {
        await i.reply({ content: "¡Eso solo lo usa GyroP! 🥖", flags: MessageFlags.Ephemeral });
        return;
      }
      const bot = (i.options.getString("vocaloid") as BotId | null) ?? undefined;
      const target = (i.options.getString("a") as BotId | null) ?? undefined;
      const offline = [bot, target].filter((b): b is BotId => !!b && !this.d.config.activeBots.includes(b));
      if (offline.length || (bot && bot === target)) {
        const msg = offline.length ? `${offline.map((b) => this.d.characters[b].displayName).join(" y ")} no está conectado.` : "Un Vocaloid no puede preguntarse a sí mismo.";
        await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
        return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const outcome = await this.generalChat.tick({ force: true, bot, target, topic: i.options.getString("tema") ?? undefined });
      const text: Record<typeof outcome, string> = {
        commented: "¡Listo! Un Vocaloid comentó la plática en #general.",
        asked: "¡Listo! Un Vocaloid le preguntó algo a otro en #general (y ya le contestó).",
        drama: "¡Listo! Se armó un minidrama en #general entre dos Vocaloids.",
        fallback: "El LLM no respondió, así que fue una frase fija en #general.",
        skipped: "No se pudo: ya hay una charla en curso, o no encuentro #general.",
      };
      await i.editReply(text[outcome]);
      return;
    }
    if (bot === "neru" && i.commandName === "advertir") {
      const target = i.options.getUser("papu", true);
      return this.warn(i, target.id, target.bot, i.channelId, { motivo: i.options.getString("motivo") ?? undefined });
    }
    if (bot === "neru" && i.commandName === "machetazo") {
      const target = i.options.getUser("papu", true);
      return this.manualStrike(i, target.id, target.bot, i.channelId, { motivo: i.options.getString("motivo") ?? undefined });
    }
    if (bot === "neru" && i.commandName === "celular") {
      // Abre la Actividad de Neru en el canal (respuesta LAUNCH_ACTIVITY de Discord).
      return void (await i.launchActivity().catch(async (e) => {
        logError("abrir el celular de Neru", e);
        await i.reply({ content: "uy, el celular no quiso prender aquí. ábrelo desde 🚀 Actividades en un canal de voz. 📱", flags: MessageFlags.Ephemeral }).catch(() => {});
      }));
    }
    if (bot === "neru" && i.commandName === "machetear") {
      if (!this.mercado) return void (await i.reply({ content: "…el mercado negro está cerrado por ahora. 📱", flags: MessageFlags.Ephemeral }));
      return this.mercado.machetear(i);
    }
    if (bot === "neru" && i.commandName === "reporte") return this.openTicket(i);
    if (bot === "neru" && i.commandName === "cerrar-ticket") return this.closeTicket(i);
    if (bot === "neru" && (i.commandName === "machetazos" || i.commandName === "perdonar")) {
      // Consultar machetazos y perdonar: GyroP y los Mods (perdonar a Mods desde el 8 nov. 2026, pedido de GyroP).
      const owner = this.d.owners.has(i.user.id);
      if (!owner && !(await this.isMod(i.user.id))) {
        await i.reply({ content: "eso solo lo usan gyrop y los mods. 📱", flags: MessageFlags.Ephemeral });
        return;
      }
      const target = i.options.getUser("papu", true);
      // Un Mod no se perdona a si mismo (lo decide GyroP u otro Mod).
      if (i.commandName === "perdonar" && !owner && target.id === i.user.id) {
        await i.reply({ content: "a ti mismo no. pídeselo a gyrop o a otro mod. 📱", flags: MessageFlags.Ephemeral });
        return;
      }
      const por = owner ? "GyroP" : `Mod <@${i.user.id}>`;
      if (i.commandName === "machetazos") {
        const m = this.d.strikes.active(target.id);
        const w = this.d.strikes.warnings(target.id);
        const content = `${target} tiene ${m} ${m === 1 ? "machetazo activo" : "machetazos activos"} y ${w} ${w === 1 ? "advertencia" : "advertencias"} (vencen a los 3 días)${this.d.strikes.xpBlocked(target.id) ? ". no gana XP mientras tenga 2 o más" : ""}.`;
        await i.reply({ content, flags: MessageFlags.Ephemeral });
      } else {
        // Perdonar revierte el machetazo: borra machetazos y advertencias, devuelve la XP que quitaron y levanta el silencio.
        const cleared = this.d.strikes.clear(target.id);
        const n = cleared.machetazos + cleared.advertencias;
        const xpBack = cleared.xp.length ? await this.levels.onForgive(target.id, cleared.xp) : 0;
        // Perdonar tambien levanta el silencio (timeout de Discord) que siga vigente, sea de Neru, de AutoMod o manual.
        const member = await this.guild.members.fetch(target.id).catch(() => null);
        const silenced = !!member?.isCommunicationDisabled();
        let unsilenced = false;
        if (silenced && member) {
          if (member.moderatable) {
            await member.timeout(null, `Perdonado por ${owner ? "GyroP" : `Mod ${i.user.username}`} (/perdonar)`);
            unsilenced = true;
          } else {
            await this.modLog(`⚠️ No pude quitarle el silencio a ${target}: el rol de Neru debe estar más arriba que el suyo.`);
          }
        }
        if (!n && !unsilenced) {
          const content = silenced
            ? `${target} no tiene machetazos ni advertencias, y no pude quitarle el silencio (revisa el rol de Neru). 📱`
            : `${target} no tiene machetazos, advertencias ni silencio. no hay nada que perdonar. 📱`;
          await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
          return;
        }
        // En publico, en el canal donde GyroP (o el Mod) lo usa: que todos vean que el castigo se levanto (decision de GyroP, 18 oct. 2026).
        await i.reply({ content: this.d.phrases.pick("neru", "perdon", { papu: `<@${target.id}>` }), allowedMentions: { users: [target.id] } });
        const what = [
          cleared.machetazos ? `${cleared.machetazos} ${cleared.machetazos === 1 ? "machetazo" : "machetazos"}` : "",
          cleared.advertencias ? `${cleared.advertencias} ${cleared.advertencias === 1 ? "advertencia" : "advertencias"}` : "",
          unsilenced ? "el silencio" : "",
        ].filter(Boolean);
        const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} y ${what.at(-1)}` : what[0];
        await this.modLog(`🧽 ${por} perdonó ${list} de ${target}${xpBack > 0 ? ` (le devolví ${xpBack} XP)` : ""}.`);
        // Sobrevivio a un machetazo: rol de adorno para siempre (decision de GyroP, 28 oct. 2026).
        if (cleared.machetazos) await this.grantSurvivor(target.id).catch((e) => logError("rol Sobreviviente", e));
      }
    }
  }

  // ───────────────────────── avisos sin castigo ─────────────────────────

  private async warnFromMenu(i: MessageContextMenuCommandInteraction): Promise<void> {
    const m = i.targetMessage;
    await this.warn(i, m.author.id, m.author.bot, m.channelId, { messageId: m.id, excerpt: m.content });
  }

  /** Advertencia de GyroP o de un Mod en boca de Neru: frase fija en el canal; la 3.ª activa es un machetazo (ModerationService.warn). */
  private async warn(
    i: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
    userId: string,
    isBot: boolean,
    channelId: string,
    extra: { messageId?: string; excerpt?: string; motivo?: string },
  ): Promise<void> {
    const por = await this.moderator(i, userId, isBot, "…a ese no le puedo llamar la atención. 📱");
    if (!por) return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await this.moderation.warn({ userId, channelId, ...extra, por });
    await i.editReply(
      r.machetazo
        ? `listo. era su 3.ª advertencia: machetazo${extra.messageId ? " y mensaje borrado" : ""}, lleva ${r.machetazo.active} activos. quedó en #moderación. 📱`
        : `listo. advertencia ${r.warnings} de 3. quedó en #moderación. 📱`,
    );
  }

  private async strikeFromMenu(i: MessageContextMenuCommandInteraction): Promise<void> {
    const m = i.targetMessage;
    await this.manualStrike(i, m.author.id, m.author.bot, m.channelId, { messageId: m.id, excerpt: m.content });
  }

  /** Machetazo de GyroP o de un Mod en boca de Neru: misma escalera que los automaticos y borra el mensaje (ModerationService.strike). */
  private async manualStrike(
    i: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
    userId: string,
    isBot: boolean,
    channelId: string,
    extra: { messageId?: string; excerpt?: string; motivo?: string },
  ): Promise<void> {
    const por = await this.moderator(i, userId, isBot, "…a ese no le puedo dar un machetazo. 📱");
    if (!por) return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const active = await this.moderation.strike({ userId, channelId, ...extra, por });
    await i.editReply(`listo. machetazo puesto${extra.messageId ? " y mensaje borrado" : ""}, lleva ${active} activos. quedó en #moderación. 📱`);
  }

  /**
   * Quien puede dar machetazos y advertencias con Neru: GyroP o un Mod. Devuelve como sale en #moderacion ("GyroP" o
   * "Mod <@id>"), o null si ya respondio que no. A GyroP, a los bots, a uno mismo y (para un Mod) a otro Mod no se les
   * sanciona.
   */
  private async moderator(
    i: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
    targetId: string,
    isBot: boolean,
    refusal: string,
  ): Promise<string | null> {
    const owner = this.d.owners.has(i.user.id);
    if (!owner && !(await this.isMod(i.user.id))) {
      await i.reply({ content: "eso solo lo usan gyrop y los mods. 📱", flags: MessageFlags.Ephemeral });
      return null;
    }
    if (isBot || this.d.owners.has(targetId) || targetId === i.user.id) {
      await i.reply({ content: refusal, flags: MessageFlags.Ephemeral });
      return null;
    }
    if (!owner && (await this.isMod(targetId))) {
      await i.reply({ content: "entre mods no. si un mod se porta mal, avísale a gyrop. 📱", flags: MessageFlags.Ephemeral });
      return null;
    }
    return owner ? "GyroP" : `Mod <@${i.user.id}>`;
  }

  /**
   * Lo equipado en la tarjeta y, si su membresía lo permite (Baguette y más), su título propio en lugar del equipado
   * (PLAN §2).
   */
  private async cardEquip(userId: string): Promise<CardEquip> {
    const e = await toCardEquip(this.d.coins!.equipped(userId), this.d.coins!.founderNumber(userId));
    const m = this.d.membresias;
    const titulo = m?.titulo(userId);
    const mb = titulo ? this.guild?.members.cache.get(userId) : undefined;
    if (titulo && mb && m!.nivel(mb.roles.cache.map((r) => r.name))?.tituloPropio) e.titulo = { texto: titulo, color: "#FFD86B" };
    return e;
  }

  /**
   * Patrocinador del ranking (PLAN §2; su tarjeta al pie de la imagen desde el 18 nov. 2026): se turnan las membresías con `presentaRanking` (Baguette y más), en orden
   * fijo, uno por publicación. null si no hay ninguno.
   */
  private async presentadorRanking(): Promise<string | null> {
    const m = this.d.membresias;
    if (!m) return null;
    const roles = new Set(m.settings.niveles.filter((n) => n.presentaRanking).map((n) => n.rol));
    const ids = new Set<string>();
    for (const r of this.guild.roles.cache.values()) if (roles.has(r.name)) for (const id of r.members.keys()) if (!this.d.owners.has(id)) ids.add(id);
    const lista = [...ids].sort();
    if (!lista.length) return null;
    const k = Number(kvGet(this.d.db, "ranking:presentador") ?? 0) % lista.length;
    kvSet(this.d.db, "ranking:presentador", String(k + 1));
    return lista[k]!;
  }

  /** Emojis de la aplicación de Teto (las caras de los corredores de las carreras, PLAN §3.14). */
  private async loadAppEmojis(): Promise<void> {
    const app = this.clients.teto?.application;
    if (!app) return;
    const emojis = await app.emojis.fetch();
    this.appEmojis = new Map(emojis.map((e) => [e.name ?? "", e.toString()]));
  }

  /** Nombre, icono y membresía de los Papus que apostaron en una carrera (para el podio). */
  private async apostadores(ids: string[]): Promise<Map<string, Apostador>> {
    const out = new Map<string, Apostador>();
    const niveles = this.d.membresias?.settings.niveles ?? [];
    const members = ids.length ? await this.guild.members.fetch({ user: ids }).catch(() => null) : null;
    await Promise.all(
      ids.map(async (id) => {
        const mb = members?.get(id) ?? null;
        const n = mb ? (this.d.membresias?.nivel(mb.roles.cache.map((r) => r.name)) ?? null) : null;
        const url = mb?.displayAvatarURL({ extension: "png", size: 64 });
        const avatar = url ? await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? Buffer.from(b) : null)).catch(() => null) : null;
        out.set(id, { id, nombre: mb?.displayName ?? "Papu", avatar, marco: marcoDe(n), nivel: n ? niveles.indexOf(n) : -1 });
      }),
    );
    return out;
  }

  /** Papus de honor (rol 🏅 del nivel 40) para las vallas del podio de las carreras: hasta 12 al azar, con su icono. */
  private async papusDeHonor(): Promise<Apostador[]> {
    const key = channelKey(this.d.levels.settings.honor.rol);
    const role = this.guild.roles.cache.find((r) => channelKey(r.name) === key);
    if (!role) return [];
    const ids = [...role.members.keys()].sort(() => Math.random() - 0.5).slice(0, 12);
    return [...(await this.apostadores(ids)).values()].map((p) => ({ ...p, marco: undefined, nivel: -1 }));
  }

  /** Membresías y prestigio para /pelea y /boda (PLAN §2): el nivel según sus roles y sus prestigios. */
  private lanzarPort(): LanzarPort | undefined {
    const m = this.d.membresias;
    if (!m) return undefined;
    return {
      membresias: m,
      nivel: async (id) => {
        const mb = this.guild.members.cache.get(id) ?? (await this.guild.members.fetch(id).catch(() => null));
        return mb ? m.nivel(mb.roles.cache.map((r) => r.name)) : null;
      },
      prestigio: (id) => this.d.levels.store.get(id).prestige,
    };
  }

  /** /adivinanza (GyroP y Mods): un Vocaloid suelta ahora una adivinanza al aire en este canal. */
  private async lanzarAdivinanza(i: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.isStaff(i.user.id))) return void (await i.reply({ content: "Eso solo lo pueden usar GyroP y los Mods. 🥖", flags: MessageFlags.Ephemeral }));
    if (!this.adivinanzas) return void (await i.reply({ content: "¡Adivina, Papu! está apagado por ahora. 🥖", flags: MessageFlags.Ephemeral }));
    if (this.adivinanzas.abierta()) return void (await i.reply({ content: "Ya hay una adivinanza corriendo: espera a que termine. 🧩", flags: MessageFlags.Ephemeral }));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const vocaloid = i.options.getString("vocaloid") as BotId | null;
    const id = await this.adivinanzas.soltar({ channelId: i.channelId, bot: vocaloid ?? undefined, dorada: i.options.getBoolean("dorada") ?? undefined });
    await i.editReply(id ? "🧩 ¡Listo! Ya salió la adivinanza." : "No pude soltarla (¿el Vocaloid no está conectado o no puede escribir aquí?).");
  }

  /** Crea un rol sin color, sin permisos y no mencionable si no existe (avisos de #tus-roles). */
  private async ensurePlainRole(name: string, reason: string): Promise<void> {
    const guild = await this.clients.teto.guilds.fetch(this.guild.id);
    await guild.roles.fetch();
    if (guild.roles.cache.some((r) => channelKey(r.name) === channelKey(name))) return;
    await guild.roles.create({ name, permissions: [], mentionable: false, hoist: false, reason });
    this.d.log(`Rol ${name} creado`);
  }

  /** GyroP o un Mod: lanzan peleas y bodas, perdonan y aprueban fondos de tarjeta (pedido de GyroP, 8 nov. 2026). */
  private async isStaff(userId: string): Promise<boolean> {
    return this.d.owners.has(userId) || (await this.isMod(userId));
  }

  /** Tiene el rol Mod (config/servidor.json, `mod`). Lo da GyroP a mano. */
  private async isMod(userId: string): Promise<boolean> {
    const role = this.d.modRole;
    if (!role) return false;
    const member = await this.guild.members.fetch(userId).catch(() => null);
    return !!member?.roles.cache.some((r) => channelKey(r.name) === channelKey(role));
  }

  // ───────────────────────── tickets (#reportes-y-reclamos) ─────────────────────────

  /** /reporte: hilo privado con el Papu y GyroP, un solo aviso en #registro-bots. */
  private async openTicket(i: ChatInputCommandInteraction): Promise<void> {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = findTextChannel(this.guild, CHANNELS.reportes);
    if (!channel) {
      await i.editReply("no encuentro #reportes-y-reclamos. avísale a gyrop por privado. 📱");
      return;
    }
    const day = dayKey(new Date(), this.d.config.quotaTimeZone);
    const live = new Map<string, boolean>();
    const prev = this.tickets.openFor(i.user.id);
    if (prev) {
      const t = await this.clients.neru.channels.fetch(prev).catch(() => null);
      live.set(prev, !!t?.isThread() && !t.archived);
    }
    const check = this.tickets.canOpen(i.user.id, day, (id) => live.get(id) ?? false);
    if (!check.ok) {
      await i.editReply(
        check.reason === "abierto"
          ? `ya tienes un ticket abierto: <#${check.threadId}>. escribe ahí. 📱`
          : `ya abriste ${MAX_TICKETS_PER_DAY} tickets hoy. mañana. o escribe en el que ya tienes.`,
      );
      return;
    }
    const n = this.tickets.nextNumber();
    const name = i.member && "displayName" in i.member ? i.member.displayName : i.user.username;
    const neruChannel = await this.clients.neru.channels.fetch(channel.id);
    if (!neruChannel || neruChannel.type !== ChannelType.GuildText) throw new Error("#reportes-y-reclamos no es un canal de texto");
    const thread = await neruChannel.threads.create({
      name: `🎫 ${String(n).padStart(3, "0")} · ${name}`.slice(0, 100),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Ticket de ${i.user.username}`,
    });
    this.tickets.opened(i.user.id, thread.id, day);
    const motivo = i.options.getString("motivo", true);
    const people = [i.user.id, ...(this.ownerId ? [this.ownerId] : [])];
    await thread.send({
      content: [
        `ticket #${n} de <@${i.user.id}>${this.ownerId ? ` para <@${this.ownerId}>` : ""}. solo ustedes dos lo ven. 📱`,
        `> ${motivo.replace(/\n/g, "\n> ")}`,
        "si tienes una captura, súbela aquí. gyrop responde cuando pueda.",
      ].join("\n\n"),
      allowedMentions: { users: people },
    });
    await this.report(`🎫 Ticket #${n} de <@${i.user.id}>: <#${thread.id}>`);
    await i.editReply(`listo, tu ticket: <#${thread.id}>. no es que me importe… pero gyrop lo va a ver.`);
  }

  /** /cerrar-ticket: dentro del hilo del ticket, lo cierra con candado (solo GyroP). */
  private async closeTicket(i: ChatInputCommandInteraction): Promise<void> {
    if (!this.d.owners.has(i.user.id)) {
      await i.reply({ content: "eso solo lo usa GyroP. 📱", flags: MessageFlags.Ephemeral });
      return;
    }
    const ch = i.channel;
    if (!ch?.isThread() || !this.tickets.ownerOf(ch.id)) {
      await i.reply({ content: "úsalo dentro del hilo de un ticket. 📱", flags: MessageFlags.Ephemeral });
      return;
    }
    const userId = this.tickets.close(ch.id);
    await i.reply({ content: `ticket cerrado. gracias por avisar, <@${userId}>. si pasa otra cosa, /reporte de nuevo. 📱`, allowedMentions: { users: userId ? [userId] : [] } });
    const thread = await this.clients.neru.channels.fetch(ch.id);
    if (thread?.isThread()) {
      await thread.setLocked(true).catch((e) => logError("cerrar ticket", e));
      await thread.setArchived(true).catch((e) => logError("cerrar ticket", e));
    }
  }

  // ───────────────────────── puertos ─────────────────────────

  private async sendable(bot: BotId, channelId: string): Promise<SendableChannels> {
    const ch = await this.clients[bot].channels.fetch(channelId);
    if (!ch?.isSendable()) throw new Error(`${bot} no puede escribir en el canal ${channelId}`);
    return ch;
  }

  /** ":teto_hola:" del LLM -> emoji del servidor (si no, Discord lo muestra como texto). */
  private withEmojis(text: string): string {
    return linkEmojis(text, new Map(this.guild.emojis.cache.filter((e) => !!e.name).map((e) => [e.name!.toLowerCase(), emojiMarkup({ name: e.name!, id: e.id, animated: e.animated })])));
  }

  private emojiNames(): string[] {
    return this.guild.emojis.cache.filter((e) => !!e.name && e.available !== false).map((e) => e.name!);
  }

  private chatPort(): ChatPort {
    return {
      reply: async (bot, channelId, replyTo, content, pingUserId) => {
        const ch = await this.sendable(bot, channelId);
        await ch.send({
          content: this.withEmojis(content),
          reply: { messageReference: replyTo, failIfNotExists: false },
          allowedMentions: { users: [pingUserId], repliedUser: true },
        });
      },
      typing: (bot, channelId) => {
        let stopped = false;
        const tick = () => void this.sendable(bot, channelId).then((ch) => (!stopped ? ch.sendTyping() : undefined)).catch(() => {});
        tick();
        const timer = setInterval(tick, 8000);
        return () => {
          stopped = true;
          clearInterval(timer);
        };
      },
      react: async (bot, channelId, messageId, emoji) => {
        const ch = await this.sendable(bot, channelId);
        if (!("messages" in ch)) return;
        const msg = await ch.messages.fetch(messageId);
        await msg.react(emoji);
      },
      emojis: () => this.emojiNames(),
    };
  }

  private charlaPort(): CharlaPort {
    const generalId = () => {
      const general = findTextChannel(this.guild, CHANNELS.general);
      if (!general) throw new Error("no hay #general");
      return general.id;
    };
    return {
      recent: async (limit) => {
        const general = findTextChannel(this.guild, CHANNELS.general);
        if (!general) return null;
        const msgs = [...(await general.messages.fetch({ limit })).values()].reverse();
        // Solo del mas nuevo hace falta saber si un bot le contestaba a un Papu (para no hablar dos veces seguidas).
        const newest = msgs.at(-1);
        const ref = newest?.reference?.messageId && this.botByUserId.has(newest.author.id) ? await newest.fetchReference().catch(() => null) : null;
        return msgs.map((x): ChannelMessage => {
          const bot = this.botByUserId.get(x.author.id) ?? null;
          return {
            id: x.id,
            author: bot ? this.d.characters[bot].displayName : this.speakerName(x),
            bot,
            repliesToHuman: x === newest && !!ref && !ref.author.bot,
            text: x.cleanContent,
            at: x.createdTimestamp,
          };
        });
      },
      post: async (bot, content, mention) => {
        const ch = await this.sendable(bot, generalId());
        const target = mention ? this.clients[mention]?.user?.id : undefined;
        const text = this.withEmojis(content);
        const msg = await ch.send({ content: target ? `<@${target}> ${text}` : text, allowedMentions: target ? { users: [target] } : { parse: [] } });
        return msg.id;
      },
      reply: async (bot, replyTo, content) => {
        const ch = await this.sendable(bot, generalId());
        const msg = await ch.send({ content: this.withEmojis(content), reply: { messageReference: replyTo, failIfNotExists: false }, allowedMentions: { parse: [], repliedUser: false } });
        return msg.id;
      },
      typing: (bot) => {
        const general = findTextChannel(this.guild, CHANNELS.general);
        return general ? this.chatPort().typing(bot, general.id) : () => {};
      },
      emojis: () => this.emojiNames(),
    };
  }

  /** Un evento del servidor para el ambiente casual (sin esperar: nunca frena el juego que lo produjo). */
  private ambientEvent(e: AmbientEvent): void {
    void this.ambient?.onEvent(e).catch((err) => logError(`ambiente (${e.tipo})`, err));
  }

  private ambientPort(): AmbientPort {
    const general = () => findTextChannel(this.guild, CHANNELS.general);
    return {
      react: (bot, channelId, messageId, emoji) => this.chatPort().react(bot, channelId, messageId, emoji),
      reply: async (bot, channelId, messageId, content) => {
        const ch = await this.sendable(bot, channelId);
        await ch.send({ content: this.withEmojis(content), reply: { messageReference: messageId, failIfNotExists: false }, allowedMentions: { parse: [], repliedUser: false } });
      },
      history: async (channelId, messageId) => {
        const ch = await this.clients.neru.channels.fetch(channelId).catch(() => null);
        if (!ch || !ch.isTextBased() || !("messages" in ch)) return [];
        const msgs = await ch.messages.fetch({ before: messageId, limit: HISTORY_LINES }).catch(() => null);
        if (!msgs) return [];
        return [...msgs.values()]
          .reverse()
          .filter((x) => x.cleanContent.trim())
          .map((x) => {
            const bot = this.botByUserId.get(x.author.id);
            return { author: bot ? this.d.characters[bot].displayName : this.speakerName(x), text: x.cleanContent };
          });
      },
      lastPapuInGeneral: async () => {
        const ch = general();
        if (!ch) return null;
        const msgs = await ch.messages.fetch({ limit: 50 });
        // Sin un Papu en los ultimos 50 mensajes, hace mucho que nadie escribe.
        return [...msgs.values()].find((x) => !x.author.bot && !x.system)?.createdTimestamp ?? 0;
      },
      postGeneral: async (bot, content) => {
        const ch = general();
        if (!ch) return;
        await (await this.sendable(bot, ch.id)).send({ content: this.withEmojis(content), allowedMentions: { parse: [] } });
      },
      postPoll: async (bot, content, emojis) => {
        const ch = general();
        if (!ch) return null;
        const msg = await (await this.sendable(bot, ch.id)).send({ content, allowedMentions: { parse: [] } });
        for (const e of emojis) await msg.react(e).catch((err) => logError(`reacción ${e} de la pregunta al aire`, err));
        return { channelId: ch.id, messageId: msg.id };
      },
      pollCounts: async (channelId, messageId) => {
        const ch = await this.clients.neru.channels.fetch(channelId).catch(() => null);
        if (!ch || !ch.isTextBased() || !("messages" in ch)) return null;
        const msg = await ch.messages.fetch(messageId).catch(() => null);
        if (!msg) return null;
        return Object.fromEntries(msg.reactions.cache.map((r) => [r.emoji.name ?? "", r.count]));
      },
    };
  }

  private moderationPort(): ModerationPort {
    return {
      deleteMessage: async (channelId, messageId) => {
        const ch = await this.sendable("neru", channelId);
        if ("messages" in ch) await ch.messages.delete(messageId);
      },
      timeout: async (userId, minutes, reason) => {
        const member = await this.guild.members.fetch(userId);
        if (!member.moderatable) {
          await this.modLog(`⚠️ No pude silenciar a <@${userId}>: el rol de Neru debe estar más arriba que el suyo.`);
          return;
        }
        await member.timeout(minutes * 60_000, reason);
      },
      say: async (channelId, content, pingUserId, replyTo, gif) => {
        const ch = await this.sendable("neru", channelId);
        await ch.send({
          content,
          ...(gif ? { files: [new AttachmentBuilder(NERU_GIFS[gif], { name: `${gif}.gif` })] } : {}),
          allowedMentions: { users: pingUserId ? [pingUserId] : [], repliedUser: false },
          ...(replyTo ? { reply: { messageReference: replyTo, failIfNotExists: false } } : {}),
        });
      },
      log: async (e) => {
        const lines = [
          `**${e.kind}** · <@${e.userId}>${e.channelId ? ` en <#${e.channelId}>` : ""}`,
          `${e.detail} → ${e.action}${e.activeStrikes !== null ? ` · machetazos activos: ${e.activeStrikes}` : ""}`,
          e.excerpt ? `> ${e.excerpt.slice(0, 400).replace(/\n/g, "\n> ")}` : "",
        ].filter(Boolean);
        await this.modLog(lines.join("\n"));
      },
      notifyOwner: async (content) => {
        await this.modLog(`${this.ownerId ? `<@${this.ownerId}> ` : ""}${content}`, true);
      },
    };
  }

  private async modLog(content: string, pingOwner = false): Promise<void> {
    const ch = findTextChannel(this.guild, CHANNELS.moderacion);
    if (!ch) {
      this.d.log(`[moderación] ${content}`);
      return;
    }
    const neruCh = await this.sendable("neru", ch.id);
    await neruCh.send({ content, allowedMentions: { users: pingOwner && this.ownerId ? [this.ownerId] : [] } });
  }

  // ───────────────────────── AutoMod y comandos ─────────────────────────

  private async registerCommands(): Promise<void> {
    // Miku y Luka responden sus comandos desde Cloudflare (worker/), 24/7: sus comandos los registra
    // `npm run worker:deploy`. Aqui solo los de Teto y Neru, que usan la base local (cuota y machetazos).
    for (const id of LOCAL_COMMAND_BOTS) {
      const client = this.clients[id];
      const rest = new REST().setToken(this.d.config.tokens[id]);
      await rest
        .put(Routes.applicationGuildCommands(client.application!.id, this.d.config.guildId), { body: [...commandsFor(id, [], this.d.cardColors), ...contextMenusFor(id)] })
        .catch((e) => logError(`registrar comandos de ${id}`, e));
    }
  }

  /** Canal libre (`canalesLibres`), o un hilo dentro de uno. */
  private isFreeChannel(m: Message): boolean {
    const free = this.d.moderationSettings.canalesLibres ?? [];
    const ch = m.channel.isThread() ? m.channel.parent : m.channel;
    return !!ch && "name" in ch && free.includes(channelKey(ch.name ?? ""));
  }

  private async syncAutoMod(): Promise<void> {
    const alert = findTextChannel(this.guild, CHANNELS.moderacion);
    const free = (this.d.moderationSettings.canalesLibres ?? []).flatMap((n) => findTextChannel(this.guild, n)?.id ?? []);
    const existing = await this.guild.autoModerationRules.fetch();
    for (const spec of buildAutoModRules(this.d.moderationSettings)) {
      const data = { ...autoModPayload(spec, alert?.id ?? null), exemptChannels: spec.exemptFreeChannels ? free : [] };
      const found = existing.find((r) => r.name === spec.name);
      try {
        if (found) await found.edit(data);
        else await this.guild.autoModerationRules.create(data);
      } catch (e) {
        await this.report(`⚠️ AutoMod: no pude ${found ? "actualizar" : "crear"} la regla "${spec.name}": ${(e as Error).message}`);
      }
    }
    this.d.log(`AutoMod sincronizado${alert ? "" : " (sin canal #moderación: las alertas no se guardan)"}`);
  }

  // ───────────────────────── bienvenidas y reconexión ─────────────────────────

  /** #👋・despedidas: Teto lo crea si falta (solo lectura, justo debajo de #bienvenida). */
  private async ensureFarewellChannel(): Promise<TextChannel | null> {
    const found = findTextChannel(this.guild, CHANNELS.despedidas);
    if (found) return found;
    const welcome = findTextChannel(this.guild, CHANNELS.bienvenida);
    const g = await this.clients.teto.guilds.fetch(this.guild.id);
    const ch = await g.channels.create({
      name: "👋・despedidas",
      type: ChannelType.GuildText,
      topic: "Teto avisa aquí quién se fue del servidor. Solo lectura.",
      parent: welcome?.parentId ?? null,
      position: welcome ? welcome.position + 1 : undefined,
      permissionOverwrites: [{ id: g.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] }],
      reason: "Canal de despedidas (idea de Flor_fino, 18 nov. 2026)",
    });
    await this.report(`👋 Creé el canal <#${ch.id}> para las despedidas (solo lectura). Revisa su lugar en la lista.`);
    await this.guild.channels.fetch(ch.id).catch(() => null);
    return findTextChannel(this.guild, CHANNELS.despedidas);
  }

  private async saySeFue(member: GuildMember | PartialGuildMember): Promise<void> {
    // A los baneados no se les despide (eso es cosa de GyroP).
    if (await this.guild.bans.fetch(member.id).then(() => true, () => false)) return;
    const target = await this.ensureFarewellChannel();
    if (!target) return;
    const ch = await this.sendable("teto", target.id);
    const lv = this.d.levels.level(member.id);
    const content = textoDespedida(
      (papu) => this.d.phrases.pick("teto", "se_fue", { papu }),
      { nombre: member.displayName ?? member.user.globalName ?? member.user.username, usuario: member.user.username, entro: member.joinedTimestamp ?? null, nivel: lv.level, prestigio: lv.prestige },
      Date.now(),
    );
    await ch.send({ content, allowedMentions: { parse: [] } });
  }

  private async welcome(userIds: string[]): Promise<void> {
    const target = findTextChannel(this.guild, CHANNELS.bienvenida, CHANNELS.general);
    if (!target) return;
    const ch = await this.sendable("teto", target.id);
    if (userIds.length === 1) {
      await ch.send({ content: this.d.phrases.pick("teto", "bienvenida", { papu: `<@${userIds[0]}>` }), allowedMentions: { users: userIds } });
    } else {
      for (const group of chunk(userIds, 25)) {
        const papus = group.map((u) => `<@${u}>`).join(", ");
        await ch.send({ content: this.d.phrases.pick("teto", "bienvenida_grupal", { papus }), allowedMentions: { users: group } });
      }
    }
    await this.cleanWelcome().catch((e) => logError("limpieza de #bienvenida", e));
  }

  /**
   * Limpieza de #bienvenida (src/services/welcome-cleanup.ts): desde el décimo Papu saludado, borra los mensajes sin
   * fijar de más de 2 horas para que la guía de Teto no quede enterrada. Si aún no cumplen las 2 horas, vuelve a mirar
   * a esa hora. Borra Neru (tiene "Gestionar mensajes" por la moderación).
   */
  private async cleanWelcome(): Promise<void> {
    const target = findTextChannel(this.guild, CHANNELS.bienvenida);
    if (!target || this.stopping) return;
    const ch = await this.clients.neru.channels.fetch(target.id);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    const tetoId = this.clients.teto.user?.id;
    const fetched = await ch.messages.fetch({ limit: 100 });
    const messages: WelcomeMessage[] = fetched.map((m) => ({
      id: m.id,
      at: m.createdTimestamp,
      pinned: m.pinned,
      papus: m.author.id === tetoId ? Math.max(1, m.mentions.users.filter((u) => !u.bot).size) : 0,
    }));
    const plan = planWelcomeCleanup(messages, Date.now());
    if (plan.remove.length) {
      // bulkDelete solo acepta mensajes de menos de 14 días; los más viejos se borran uno por uno.
      const deleted = await ch.bulkDelete(plan.remove, true);
      for (const id of plan.remove.filter((x) => !deleted.has(x))) await ch.messages.delete(id).catch(() => {});
      this.d.log(`🧹 #bienvenida: ${plan.remove.length} saludos viejos borrados (la guía fijada queda arriba)`);
    }
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    this.welcomeTimer = plan.nextAt
      ? setTimeout(() => void this.cleanWelcome().catch((e) => logError("limpieza de #bienvenida", e)), Math.max(0, plan.nextAt - Date.now()) + 1000)
      : null;
  }

  /** Al volver (PLAN §9): bienvenida grupal, resumen de Neru y "ya volví" donde quedaron menciones sin responder. */
  private async reconnectTasks(lastSeen: number): Promise<void> {
    const members = await this.guild.members.fetch();
    const newcomers = members.filter((mb) => !mb.user.bot && (mb.joinedTimestamp ?? 0) > lastSeen).map((mb) => mb.id);
    if (newcomers.length) await this.welcome(newcomers);

    await this.sweepRoles(members, lastSeen);

    const hits = await this.offlineAutoModHits(lastSeen);
    const summary = await this.moderation.applyOfflineHits(hits);
    const general = findTextChannel(this.guild, CHANNELS.general);
    if (summary && general) await (await this.sendable("neru", general.id)).send({ content: summary, allowedMentions: { parse: [] } });

    const botIds = new Set(this.botByUserId.keys());
    for (const ch of this.guild.channels.cache.values()) {
      if (!ch.isTextBased() || ch.isThread() || ch.isVoiceBased()) continue;
      const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => null);
      const pending = msgs?.some(
        (x) => x.createdTimestamp > lastSeen && !x.author.bot && [...x.mentions.users.keys()].some((u) => botIds.has(u)),
      );
      if (pending) {
        const tetoCh = await this.sendable("teto", ch.id).catch(() => null);
        await tetoCh?.send({ content: this.d.phrases.pick("teto", "ya_volvi"), allowedMentions: { parse: [] } });
      }
    }
  }

  private launchedFailing = false;

  /**
   * Estrenos de /estreno (worker, base D1): abren la XP multiplicada. Si D1 falla, se conservan los ya leídos y el
   * error se registra una vez por racha (se consulta cada minuto).
   */
  private async pollLaunched(): Promise<void> {
    const cal = this.d.calendar;
    if (!cal) return;
    try {
      this.d.levels.setLaunched(await cal.service.launched());
      this.launchedFailing = false;
    } catch (e) {
      if (!this.launchedFailing) logError("estrenos de D1", e);
      this.launchedFailing = true;
    }
  }

  /**
   * Calendario fijado de Miku en #calendario: uno por semana (el anterior se desfija) y se edita cuando cambia algo
   * (ganó una votación, se asignó un video). La frase de Miku se elige una vez por semana (regla 4).
   */
  private async updateCalendar(): Promise<void> {
    const cal = this.d.calendar;
    if (!cal) return;
    const weeks = await cal.service.build();
    // Los estrenos del calendario siguen dando XP doble aunque ya no se publique (PLAN §8: #calendario archivado el 13
    // nov. 2026; para lo que no está en el calendario, /estreno de Miku).
    this.d.levels.setReleases(cal.service.releases(weeks));
    if (!cal.publicar) return;
    const target = findTextChannel(this.guild, cal.channel);
    if (!target) return;
    const text = cal.service.render(weeks);
    const key = weeks[0]!.monday;
    const prev = JSON.parse(kvGet(this.d.db, CALENDAR_KEY) ?? "null") as { key: string; channelId: string; messageId: string; intro: string; text: string } | null;
    const ch = await this.sendable("miku", target.id);
    if (!("messages" in ch)) return;
    const embed = (intro: string) => ({
      title: "📅 Calendario de videos",
      description: intro.replace("§", text).slice(0, 4096),
      color: this.d.characters.miku.color,
      footer: { text: "Las horas salen en tu zona horaria ・ Miku lo actualiza sola" },
    });
    if (prev && prev.key === key && prev.channelId === target.id) {
      if (prev.text === text) return;
      const msg = await ch.messages.fetch(prev.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed(prev.intro)] });
        kvSet(this.d.db, CALENDAR_KEY, JSON.stringify({ ...prev, text }));
        return;
      }
    }
    const intro = this.d.phrases.pick("miku", "calendario", { texto: "§" });
    const msg = await ch.send({ embeds: [embed(intro)], allowedMentions: { parse: [] } });
    await msg.pin().catch((e) => logError("fijar calendario", e));
    if (prev && prev.channelId === target.id) {
      const old = await ch.messages.fetch(prev.messageId).catch(() => null);
      await old?.unpin().catch(() => {});
    }
    kvSet(this.d.db, CALENDAR_KEY, JSON.stringify({ key, channelId: target.id, messageId: msg.id, intro, text }));
    this.d.log(`Calendario publicado (semana del ${key})`);
  }

  /**
   * Repaso de roles automaticos: Papu a quien no lo tenga y Fundador en su semana. Corre al conectarse y cada hora,
   * porque Discord a veces no avisa una entrada (o el rol del nivel llega con los bots apagados).
   */
  private async sweepRoles(members?: Collection<string, GuildMember>, lastSeen: number | null = null): Promise<void> {
    const list = members ?? (await this.guild.members.fetch());
    const everyone = this.d.everyoneRole;
    if (everyone) {
      const missing = list.filter((mb) => !mb.user.bot && !mb.roles.cache.some((r) => channelKey(r.name) === channelKey(everyone))).map((mb) => mb.id);
      if (missing.length) await this.grantEveryone(missing).catch((e) => logError("rol Papu", e));
    }
    const f = this.d.founders;
    if (f && founderWindowOpen(f, Date.now(), lastSeen)) {
      const missing = list.filter((mb) => !mb.user.bot && needsFounder(f, mb.roles.cache.map((r) => r.name))).map((mb) => mb.id);
      if (missing.length) await this.grantFounders(missing).catch((e) => logError("Fundador", e));
    }
    await this.levels.sweep(list.values()).catch((e) => logError("niveles (repaso)", e));
    await this.syncTemporaryRoles().catch((e) => logError("roles temporales", e));
    for (const [id, rol] of this.d.especiales?.roles() ?? []) {
      const mb = list.get(id);
      if (mb && !mb.roles.cache.some((r) => channelKey(r.name) === channelKey(rol))) {
        await this.grantRole(id, rol, "Rol especial que dio GyroP (config/especiales.json)").catch((e) => logError(`rol ${rol}`, e));
      }
      if (mb) await this.syncSpecialColor(await mb.fetch(true)).catch((e) => logError(`color de ${rol}`, e));
    }
  }

  /**
   * Roles temporales de config/especiales.json (`hasta`): Teto los crea mientras duran (sin permisos, solo de adorno)
   * y los borra al vencer, a la hora exacta (no espera al repaso de cada hora).
   */
  private async syncTemporaryRoles(): Promise<void> {
    const esp = this.d.especiales;
    if (!esp) return;
    const guild = await this.clients.teto.guilds.fetch(this.guild.id);
    const find = (rol: string) => guild.roles.cache.find((r) => channelKey(r.name) === channelKey(rol));
    for (const rol of esp.expiredRoles()) {
      const role = find(rol);
      if (!role) continue;
      await role.delete("Venció el rol temporal (config/especiales.json)");
      this.d.log(`Rol temporal ${rol} vencido: borrado`);
    }
    for (const [rol, color] of esp.temporaryRoles()) {
      if (find(rol)) continue;
      await guild.roles.create({ name: rol, colors: color ? { primaryColor: parseInt(color.slice(1), 16) } : undefined, permissions: [], mentionable: false, hoist: false, reason: "Rol temporal (config/especiales.json)" });
      this.d.log(`Rol temporal ${rol} creado`);
    }
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const next = esp.nextExpiry();
    // setTimeout no acepta mas de ~24,8 dias; uno mas lejano lo atrapa un repaso posterior.
    if (next !== null && next - Date.now() < 2 ** 31 - 1) {
      this.expiryTimer = setTimeout(() => void this.sweepRoles().catch((e) => logError("roles temporales", e)), Math.max(0, next - Date.now()) + 1000);
    }
  }

  /** Rol especial sobre los niveles: toma el color de #tus-roles que elija su dueña, o vuelve al suyo. */
  private async syncSpecialColor(member: GuildMember): Promise<void> {
    const rol = this.d.especiales?.get(member.id)?.rol;
    const sc = this.d.specialColors;
    const base = rol ? sc?.base.get(channelKey(rol)) : undefined;
    if (!rol || !sc || base === undefined) return;
    const guild = await this.clients.teto.guilds.fetch(this.guild.id);
    const role = guild.roles.cache.find((r) => channelKey(r.name) === channelKey(rol));
    if (!role || !member.roles.cache.has(role.id)) return;
    const want = specialRoleColor(base, member.roles.cache.map((r) => ({ name: r.name, color: r.colors.primaryColor, position: r.position })), sc.palette);
    if (role.colors.primaryColor === want) return;
    await role.setColors({ primaryColor: want }, "Color de #tus-roles de su dueña (config/especiales.json)");
    this.d.log(`${rol}: color #${want.toString(16).padStart(6, "0")}`);
  }

  /** Da la insignia Fundador (con los permisos de Teto) y avisa en #registro-bots. */
  private async grantFounders(userIds: string[]): Promise<void> {
    const f = this.d.founders;
    if (!f) return;
    for (const id of userIds) {
      await this.grantRole(id, f.role, "Fundador: nivel de Ko-fi en la primera semana");
      await this.report(`⭐ <@${id}> es Fundador (nivel de Ko-fi en la primera semana).`);
    }
  }

  /** Rol Papu para todos (al entrar, o al volver para quienes entraron con los bots apagados). */
  private async grantEveryone(userIds: string[]): Promise<void> {
    const role = this.d.everyoneRole;
    if (!role) return;
    for (const id of userIds) await this.grantRole(id, role, "Rol de todos los Papus");
  }

  /** 🔪 Sobreviviente (solo adorno): Teto lo crea si no existe (sin correr npm run servidor) y se lo da. */
  private async grantSurvivor(userId: string): Promise<void> {
    if (!this.d.survivorRole) return;
    const { rol, color } = this.d.survivorRole;
    const guild = await this.clients.teto.guilds.fetch(this.guild.id);
    if (!guild.roles.cache.some((r) => channelKey(r.name) === channelKey(rol))) {
      await guild.roles.create({ name: rol, colors: { primaryColor: parseInt(color.slice(1), 16) }, permissions: [], mentionable: false, hoist: false, reason: "Rol de adorno: perdonados de un machetazo" });
      this.d.log(`Rol ${rol} creado`);
    }
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.roles.cache.some((r) => channelKey(r.name) === channelKey(rol))) return;
    await this.grantRole(userId, rol, "Perdonado de un machetazo por GyroP (/perdonar)");
    this.d.log(`${rol} para ${member.user.username}`);
  }

  /**
   * Una sola vez: los perdonados antes de que existiera 🔪 Sobreviviente (28 oct. 2026), leidos de las lineas
   * "🧽 GyroP perdonó …" de Neru en #moderación. Si no se puede leer el canal, se reintenta al reconectar.
   */
  private async pastSurvivors(): Promise<void> {
    const key = "sobrevivientes:anteriores";
    if (!this.d.survivorRole || kvGet(this.d.db, key)) return;
    const ch = findTextChannel(this.guild, CHANNELS.moderacion);
    const neruId = this.clients.neru.user!.id;
    if (!ch) return;
    const ids = new Set<string>();
    let before: string | undefined;
    for (let page = 0; page < 30; page++) {
      const msgs = await ch.messages.fetch({ limit: 100, before });
      for (const x of msgs.values()) {
        const id = x.author.id === neruId ? pardonedFromLog(x.content) : null;
        if (id) ids.add(id);
      }
      if (msgs.size < 100) break;
      before = msgs.last()!.id;
    }
    for (const id of ids) await this.grantSurvivor(id).catch((e) => logError("rol Sobreviviente", e));
    kvSet(this.d.db, key, String(Date.now()));
    if (ids.size) await this.report(`🔪 Sobreviviente para ${ids.size} ${ids.size === 1 ? "Papu perdonado" : "Papus perdonados"} antes de que existiera el rol.`);
  }

  /** Da un rol con los permisos de Teto ("Gestionar roles"). */
  private async grantRole(userId: string, roleName: string, reason: string): Promise<void> {
    const guild = await this.clients.teto.guilds.fetch(this.guild.id);
    const role = guild.roles.cache.find((r) => channelKey(r.name) === channelKey(roleName));
    if (!role) throw new Error(`No existe el rol ${roleName} (npm run servidor -- --apply)`);
    await guild.members.addRole({ user: userId, role: role.id, reason });
  }

  private async teaseVitrina(channelId: string): Promise<void> {
    const ch = this.guild.channels.cache.get(channelId);
    const nivel = ch ? this.d.vitrina.get(channelKey(ch.name)) : undefined;
    const vitrina = findTextChannel(this.guild, "vitrina");
    if (!ch || !nivel || !vitrina) return;
    const key = `vitrina:${channelId}`;
    const now = Date.now();
    if (!shouldTease(Number(kvGet(this.d.db, key) ?? NaN) || null, now)) return;
    kvSet(this.d.db, key, String(now));
    const niveles = findTextChannel(this.guild, "membresias", "niveles-ko-fi");
    const content = this.d.phrases.pick("teto", "vitrina_nuevo", { canal: `<#${ch.id}>`, nivel, niveles: niveles ? `<#${niveles.id}>` : "ko-fi.com/tetociencia/tiers" });
    await (await this.sendable("teto", vitrina.id)).send({ content, allowedMentions: { parse: [] } });
  }

  /** Alertas de AutoMod en #moderación posteriores a la ultima vez que los bots estuvieron en linea. */
  private async offlineAutoModHits(lastSeen: number): Promise<AutoModHit[]> {
    const ch = findTextChannel(this.guild, CHANNELS.moderacion);
    if (!ch) return [];
    const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
    if (!msgs) return [];
    return [...msgs.values()]
      .filter((x) => x.type === MessageType.AutoModerationAction && x.createdTimestamp > lastSeen)
      .map((x) => {
        const fields = x.embeds[0]?.fields ?? [];
        const field = (n: string) => fields.find((f) => f.name === n)?.value ?? null;
        return {
          userId: x.author.id,
          channelId: field("channel_id"),
          ruleName: field("rule_name") ?? "AutoMod",
          content: x.embeds[0]?.description ?? "",
        };
      });
  }
}

function autoModPayload(spec: AutoModRuleSpec, alertChannelId: string | null) {
  const actions: AutoModerationActionOptions[] = [
    { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: spec.blockMessage } },
  ];
  if (alertChannelId) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannelId } });
  if (spec.timeoutSeconds && spec.trigger.type !== "spam") {
    actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: spec.timeoutSeconds } });
  }
  const t = spec.trigger;
  const trigger =
    t.type === "keyword"
      ? {
          triggerType: AutoModerationRuleTriggerType.Keyword,
          triggerMetadata: { keywordFilter: t.keywords, regexPatterns: t.regex, allowList: t.allow },
        }
      : t.type === "mention_spam"
        ? {
            triggerType: AutoModerationRuleTriggerType.MentionSpam,
            triggerMetadata: { mentionTotalLimit: t.limit, mentionRaidProtectionEnabled: true },
          }
        : { triggerType: AutoModerationRuleTriggerType.Spam };
  return {
    name: spec.name,
    eventType: AutoModerationRuleEventType.MessageSend,
    ...trigger,
    actions,
    enabled: true,
  };
}

