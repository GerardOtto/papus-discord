// Todos los bots en un solo programa (PLAN §4). Neru es el "centro": recibe los mensajes, modera primero y
// luego reparte las menciones; cada bot publica con su propia aplicacion. Los bots no se responden entre ellos.
// Las 4 chicas tienen tareas; Gakupo, Kaito, flower, IA, Haku, Gumi, Rin, Len, Meiko, Adachi Rei y Ruko solo conversan
// (se conectan si tienen token).
import {
  ActivityType,
  ChannelType,
  ThreadAutoArchiveDuration,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  MessageType,
  REST,
  Routes,
  type AutoModerationActionOptions,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type Collection,
  type Guild,
  type GuildMember,
  type Message,
  type SendableChannels,
} from "discord.js";
import { type BotId, type Config, type CoreBotId } from "../config";
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
import { GENERAL_CHAT_MS, type ChannelMessage, type CharlaPort, type GeneralChat } from "../services/charla";
import { nextPresenceBot, parseFarewell, startDecision, type FarewellRecord } from "../services/presence";
import { shouldTease } from "../services/vitrina";
import type { Quota } from "../quota/quota";
import type { LevelService } from "../levels/service";
import { stripNickTag } from "../levels/rules";
import { RuleSet } from "../moderation/rules";
import { LevelsDiscord } from "./levels";
import { BodasDiscord } from "./bodas";
import { RuletaDiscord } from "./ruleta";
import { TriviaDiscord } from "./trivia";
import type { TriviaService } from "../trivia/service";
import type { RouletteService } from "../ruleta/service";
import type { WeddingService } from "../bodas/service";
import type { ModerationSettings } from "../moderation/rules";
import { isTrivialReply, mentionedBots, type ChatPort, type ConversationService } from "../services/conversation";
import type { AutoModHit, ModerationPort, ModerationService } from "../services/moderation";
import { MAX_TICKETS_PER_DAY, TicketStore } from "../services/tickets";
import { fillMentions, loadAnuncios, markAnuncio, mentionedUsernames, pendingAnuncios } from "../services/anuncios";
import { planWelcomeCleanup, type WelcomeMessage } from "../services/welcome-cleanup";
import { dayKey, nextDayStart } from "../time";
import { CHANNELS, channelKey, chunk, findTextChannel } from "./channels";
import { commandsFor, contextMenusFor, STRIKE_DELETE_MENU, STRIKE_MENU, WARN_MENU } from "./commands";

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
  teto: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
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
  makeModeration: (port: ModerationPort, exempt: () => ReadonlySet<string>) => ModerationService;
  /** Charla espontanea en #general (cada 20 min, src/services/charla.ts). */
  makeGeneralChat: (port: CharlaPort) => GeneralChat;
  /** Dueños (compartido con la cuota): aqui se agrega el dueño del servidor al conectar. */
  owners: Set<string>;
  /** Trato especial de un Papu concreto (config/especiales.json): sin cuota, su rol de adorno y su trato con un bot. */
  especiales?: Especiales;
  /** Roles especiales cuyo color sigue al de #tu-color (`sobreNiveles`): nombre -> color propio; y la paleta. */
  specialColors?: { base: Map<string, number>; palette: string[] };
  /** Insignia Fundador por tiempo limitado (null = ya no se entrega). */
  founders: FounderSettings | null;
  /** Rol que Teto da a cada Papu al entrar (null = ninguno). */
  everyoneRole: string | null;
  /** Rol de los Mods (dan strikes y avisos con Neru, como GyroP; null = sin Mods). */
  modRole?: string | null;
  /** Canales de nivel que se anuncian en #vitrina (clave -> nivel con emoji). */
  vitrina: Map<string, string>;
  /** Bodas con las Vocaloids (src/bodas/; null = desactivadas). */
  weddings?: WeddingService | null;
  /** Ruleta de los Papus (src/ruleta/; null = desactivada). */
  roulette?: RouletteService | null;
  /** Trivia de los Papus (src/trivia/; null = desactivada). */
  trivia?: TriviaService | null;
  /** Calendario automatico de #calendario (null = desactivado: falta el token de Cloudflare o la carpeta). */
  calendar: { service: CalendarService; channel: string } | null;
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
  private rolesTimer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private chatTimer: ReturnType<typeof setInterval> | null = null;
  private generalChat!: GeneralChat;
  private levels!: LevelsDiscord;
  private bodas: BodasDiscord | null = null;
  private ruleta: RuletaDiscord | null = null;
  private trivia: TriviaDiscord | null = null;

  constructor(private readonly d: AppDeps) {
    this.ownerId = d.config.ownerId;
    this.tickets = new TicketStore(d.db);
    // enforceNonce: si Discord crea el mensaje pero la confirmacion no llega, discord.js reintenta el envio; con el
    // nonce, Discord devuelve el mensaje que ya existe en vez de publicarlo dos veces (caso real del 21 oct. 2026: Miku
    // respondio dos veces lo mismo a los 8 @ de un Papu).
    this.clients = Object.fromEntries(d.config.activeBots.map((id) => [id, new Client({ intents: INTENTS[id], enforceNonce: true, allowedMentions: { parse: [...SAFE_MENTIONS.parse], repliedUser: SAFE_MENTIONS.repliedUser } })])) as Record<BotId, Client>;
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
      log: this.d.log,
    });
    if (this.d.weddings) {
      this.bodas = new BodasDiscord({
        weddings: this.d.weddings,
        levels: this.d.levels,
        levelsDiscord: this.levels,
        quota: this.d.quota,
        phrases: this.d.phrases,
        characters: this.d.characters,
        online: config.activeBots,
        owners: this.d.owners,
        clients: this.clients,
        guild: () => this.guild,
        sendable: (bot, channelId) => this.sendable(bot, channelId),
        report: (text) => this.report(text),
        timeZone: config.quotaTimeZone,
        log: this.d.log,
      });
    }
    if (this.d.roulette) {
      this.ruleta = new RuletaDiscord({
        roulette: this.d.roulette,
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
    // Strike de Neru: se pierde la XP del dia.
    this.d.strikes.onAdd = (userId) => void this.levels.onStrike(userId).catch((e) => logError("XP por strike", e));

    await this.registerCommands();
    await this.syncAutoMod();
    this.wireEvents();

    const lastSeen = Number(kvGet(this.d.db, LAST_SEEN_KEY) ?? 0);
    await this.greetOnStart(lastSeen || null).catch((e) => logError("saludo", e));
    if (lastSeen > 0) await this.reconnectTasks(lastSeen).catch((e) => logError("tareas de reconexión", e));
    await this.cleanWelcome().catch((e) => logError("limpieza de #bienvenida", e));
    await this.sendAnuncios().catch((e) => logError("avisos de una vez", e));
    this.touchLastSeen();
    this.lastBeat = Date.now();
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.rolesTimer = setInterval(() => void this.sweepRoles().catch((e) => logError("repaso de roles", e)), ROLES_SWEEP_MS);
    this.generalChat = this.d.makeGeneralChat(this.charlaPort());
    this.chatTimer = setInterval(() => {
      if (!this.stopping) void this.generalChat.tick().catch((e) => logError("charla en #general", e));
    }, GENERAL_CHAT_MS);
    if (this.d.calendar) {
      void this.updateCalendar().catch((e) => logError("calendario", e));
      this.calendarTimer = setInterval(() => void this.updateCalendar().catch((e) => logError("calendario", e)), CALENDAR_EVERY_MS);
    }
    await this.report(`✅ Bots en línea (${config.activeBots.join(", ")}).`);
    // Bodas: la adivinanza inaugural sale apenas arrancan los bots con el parche (y lo vencido se cierra).
    void this.bodas?.tick().catch((e) => logError("bodas", e));
  }

  private stopping = false;
  private readonly tipNudges = new Map<string, number>();
  private readonly tickets: TicketStore;

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.calendarTimer) clearInterval(this.calendarTimer);
    if (this.rolesTimer) clearInterval(this.rolesTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    if (this.chatTimer) clearInterval(this.chatTimer);
    await this.farewell().catch((e) => logError("despedida", e));
    this.touchLastSeen();
    await Promise.all(this.d.config.activeBots.map((id) => this.clients[id].destroy()));
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
    void this.levels
      .voiceTick((id) => this.botByUserId.has(id))
      .then(() => this.ruleta?.voiceCheck((id) => this.botByUserId.has(id)))
      .catch((e) => logError("XP en voz", e));
    void this.pollLaunched()
      .then(() => this.levels.announceFixedEvents())
      .catch((e) => logError("evento de XP", e));
    if (!this.stopping) void this.bodas?.tick().catch((e) => logError("bodas", e));
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
    // Ko-fi da el rol del nivel; si es la primera semana, Teto agrega la insignia Fundador.
    this.clients.teto.on(Events.GuildMemberUpdate, (old, member) => {
      if (member.guild.id === this.guild.id) void this.levels.onMemberUpdate(old, member).catch((e) => logError("niveles (miembro)", e));
      if (this.d.especiales?.get(member.id)) void this.syncSpecialColor(member).catch((e) => logError("color de rol especial", e));
      const f = this.d.founders;
      if (!f || member.user.bot || member.guild.id !== this.guild.id || !founderWindowOpen(f, Date.now())) return;
      if (needsFounder(f, member.roles.cache.map((r) => r.name))) void this.grantFounders([member.id]).catch((e) => logError("Fundador", e));
    });
    for (const id of this.d.config.activeBots) {
      this.clients[id].on(Events.InteractionCreate, (i) => {
        if (i.isChatInputCommand()) void this.onCommand(id, i).catch((e) => logError(`comando /${i.commandName}`, e));
        else if (i.isButton())
          void (async () => (await this.trivia?.button(i)) || (await this.bodas?.button(i)) || (await this.ruleta?.button(i)) || (await this.levels.button(i)))().catch((e) => logError(`botón ${i.customId}`, e));
        else if (i.isModalSubmit()) void this.trivia?.modal(i).catch((e) => logError(`formulario ${i.customId}`, e));
        else if (id === "neru" && i.isMessageContextMenuCommand() && i.commandName === WARN_MENU)
          void this.warnFromMenu(i).catch((e) => logError("advertir (menú)", e));
        else if (id === "neru" && i.isMessageContextMenuCommand() && i.commandName === STRIKE_MENU)
          void this.strikeFromMenu(i).catch((e) => logError("strike (menú)", e));
        else if (id === "neru" && i.isMessageContextMenuCommand() && i.commandName === STRIKE_DELETE_MENU)
          void this.strikeFromMenu(i, true).catch((e) => logError("strike y borrar (menú)", e));
      });
      this.clients[id].on(Events.Error, (e) => logError(`cliente ${id}`, e));
    }
  }

  private async onMessage(m: Message): Promise<void> {
    if (m.author.bot || m.system || !m.inGuild() || m.guildId !== this.guild.id) return;
    if (m.type !== MessageType.Default && m.type !== MessageType.Reply) return;

    // 1) Moderacion primero (reglas fijas, nunca el LLM).
    const replied = m.reference?.messageId ? await m.fetchReference().catch(() => null) : null;
    const others = m.mentions.users.filter((u) => !u.bot && u.id !== m.author.id);
    const targetsSomeone = others.size > 0 || (!!replied && !replied.author.bot && replied.author.id !== m.author.id);
    // A los Vocaloids tampoco se les falta el respeto (GyroP): mencionar o responder a uno de nuestros bots.
    const targetsBot = m.mentions.users.some((u) => this.botByUserId.has(u.id)) || (!!replied && this.botByUserId.has(replied.author.id));
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

    // 2) Menciones a los bots (en orden; responder a un bot cuenta como mencionarlo).
    const bots = mentionedBots(m.content, this.botByUserId, replied?.author.bot ? replied.author.id : null);
    if (bots.length === 0) {
      await this.tipWithoutSource(m).catch((e) => logError("falta de fuente", e));
      return;
    }
    // Responder a un bot con "XD" o un emoji, sin @, no es hablarle: no gasta cuota ni recibe respuesta.
    if (mentionedBots(m.content, this.botByUserId).length === 0 && isTrivialReply(m.content)) return;
    const outcome = await this.conversation.handle({
      messageId: m.id,
      channelId: m.channelId,
      authorId: m.author.id,
      authorName: this.speakerName(m),
      fromOwner: this.d.owners.has(m.author.id),
      text: m.cleanContent,
      bots,
      history: () => this.history(m),
    });
    if (outcome === "answered" || outcome === "partial") await this.levels.onBotReply(m.author.id, xpBase, ctx).catch((e) => logError("XP con Vocaloid", e));
  }

  /** En #tips-y-curiosidades, un dato sin enlace recibe la frase de Luka "falta la fuente" (max. una cada 30 min por Papu). */
  private async tipWithoutSource(m: Message): Promise<void> {
    if (!("name" in m.channel) || channelKey(m.channel.name ?? "") !== "tips-y-curiosidades") return;
    if (/https?:\/\//i.test(m.content) || m.content.trim().length < 15) return;
    const last = this.tipNudges.get(m.author.id) ?? 0;
    if (Date.now() - last < 30 * 60_000) return;
    this.tipNudges.set(m.author.id, Date.now());
    const ch = await this.sendable("luka", m.channelId);
    await ch.send({
      content: this.d.phrases.pick("luka", "falta_fuente", { papu: `<@${m.author.id}>` }),
      reply: { messageReference: m.id, failIfNotExists: false },
      allowedMentions: { users: [m.author.id] },
    });
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
      const left = this.d.quota.remaining(i.user.id);
      const extra = this.d.quota.extra(i.user.id);
      const limit = this.d.quota.limitFor(i.user.id) + extra;
      const hours = Math.ceil((nextDayStart(new Date(), this.d.config.quotaTimeZone) - Date.now()) / 3_600_000);
      const text = Number.isFinite(left)
        ? `Te quedan **${left} de ${limit}** mensajes con los Vocaloids hoy${extra ? ` (${extra} extra de la ruleta 🎰)` : ""} (se comparten entre todos los Vocaloids; cada @ cuenta uno). Se recargan en ~${hours} h, a medianoche de Chile. Tu cuota sube con tu nivel: míralo con /nivel.`
        : this.d.owners.has(i.user.id)
          ? "No tienes límite de mensajes (eres GyroP)."
          : "No tienes límite de mensajes con los Vocaloids: es un regalo de GyroP. 💙";
      await i.reply({ content: text, flags: MessageFlags.Ephemeral });
      return;
    }
    if (bot === "teto" && i.commandName === "nivel") return this.levels.nivel(i);
    if (bot === "teto" && i.commandName === "tarjeta") return this.levels.tarjeta(i);
    if (bot === "teto" && i.commandName === "ranking") return this.levels.ranking(i);
    if (bot === "teto" && i.commandName === "boda") {
      if (!this.bodas) return void (await i.reply({ content: "Las bodas están apagadas por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.bodas.boda(i);
    }
    if (bot === "teto" && i.commandName === "ruleta") {
      if (!this.ruleta) return void (await i.reply({ content: "La ruleta está apagada por ahora. 🥖", flags: MessageFlags.Ephemeral }));
      return this.ruleta.ruleta(i);
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
    if (bot === "neru" && i.commandName === "strike") {
      const target = i.options.getUser("papu", true);
      return this.manualStrike(i, target.id, target.bot, i.channelId, { motivo: i.options.getString("motivo") ?? undefined });
    }
    if (bot === "neru" && i.commandName === "reporte") return this.openTicket(i);
    if (bot === "neru" && i.commandName === "cerrar-ticket") return this.closeTicket(i);
    if (bot === "neru" && (i.commandName === "strikes" || i.commandName === "perdonar")) {
      // Consultar strikes: GyroP y los Mods. Perdonar: solo GyroP (los strikes merecidos se quedan).
      const allowed = this.d.owners.has(i.user.id) || (i.commandName === "strikes" && (await this.isMod(i.user.id)));
      if (!allowed) {
        await i.reply({ content: i.commandName === "strikes" ? "eso solo lo usan gyrop y los mods. 📱" : "eso solo lo usa GyroP. 📱", flags: MessageFlags.Ephemeral });
        return;
      }
      const target = i.options.getUser("papu", true);
      if (i.commandName === "strikes") {
        await i.reply({ content: `${target} tiene ${this.d.strikes.active(target.id)} strikes activos (vencen a los 3 días).`, flags: MessageFlags.Ephemeral });
      } else {
        const n = this.d.strikes.clear(target.id);
        // Perdonar tambien levanta el silencio (timeout de Discord) que siga vigente, sea de Neru, de AutoMod o manual.
        const member = await this.guild.members.fetch(target.id).catch(() => null);
        const silenced = !!member?.isCommunicationDisabled();
        let unsilenced = false;
        if (silenced && member) {
          if (member.moderatable) {
            await member.timeout(null, "Perdonado por GyroP (/perdonar)");
            unsilenced = true;
          } else {
            await this.modLog(`⚠️ No pude quitarle el silencio a ${target}: el rol de Neru debe estar más arriba que el suyo.`);
          }
        }
        if (!n && !unsilenced) {
          const content = silenced
            ? `${target} no tiene strikes activos y no pude quitarle el silencio (revisa el rol de Neru). 📱`
            : `${target} no tiene strikes activos ni silencio. no hay nada que perdonar. 📱`;
          await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
          return;
        }
        // En publico, en el canal donde GyroP lo usa: que todos vean que el castigo se levanto (decision de GyroP, 18 oct. 2026).
        await i.reply({ content: this.d.phrases.pick("neru", "perdon", { papu: `<@${target.id}>` }), allowedMentions: { users: [target.id] } });
        const what = [n ? `${n} strikes` : "", unsilenced ? "el silencio" : ""].filter(Boolean).join(" y ");
        await this.modLog(`🧽 GyroP perdonó ${what} de ${target}.`);
      }
    }
  }

  // ───────────────────────── avisos sin castigo ─────────────────────────

  private async warnFromMenu(i: MessageContextMenuCommandInteraction): Promise<void> {
    const m = i.targetMessage;
    await this.warn(i, m.author.id, m.author.bot, m.channelId, { messageId: m.id, excerpt: m.content });
  }

  /** Aviso de GyroP o de un Mod en boca de Neru: frase fija en el canal, sin borrar ni strike (ModerationService.warn). */
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
    await this.moderation.warn({ userId, channelId, ...extra, por });
    await i.editReply("listo. avisé sin strike. quedó en #moderación. 📱");
  }

  private async strikeFromMenu(i: MessageContextMenuCommandInteraction, borrar = false): Promise<void> {
    const m = i.targetMessage;
    await this.manualStrike(i, m.author.id, m.author.bot, m.channelId, { messageId: m.id, excerpt: m.content, borrar });
  }

  /** Strike de GyroP o de un Mod en boca de Neru: misma escalera que los automaticos; borra el mensaje solo con `borrar` (ModerationService.strike). */
  private async manualStrike(
    i: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
    userId: string,
    isBot: boolean,
    channelId: string,
    extra: { messageId?: string; excerpt?: string; motivo?: string; borrar?: boolean },
  ): Promise<void> {
    const por = await this.moderator(i, userId, isBot, "…a ese no le puedo poner strike. 📱");
    if (!por) return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const active = await this.moderation.strike({ userId, channelId, ...extra, por });
    if (active === null) {
      await i.editReply("a ese Papu los strikes se los pone gyrop. le avisé sin strike y quedó en #moderación. 📱");
      return;
    }
    await i.editReply(`listo. strike puesto${extra.borrar ? " y mensaje borrado" : ""}, lleva ${active} activos. quedó en #moderación. 📱`);
  }

  /**
   * Quien puede dar strikes y avisos con Neru: GyroP o un Mod. Devuelve como sale en #moderacion ("GyroP" o
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
        await ch.send({ content: this.withEmojis(content), reply: { messageReference: replyTo, failIfNotExists: false }, allowedMentions: { parse: [], repliedUser: false } });
      },
      typing: (bot) => {
        const general = findTextChannel(this.guild, CHANNELS.general);
        return general ? this.chatPort().typing(bot, general.id) : () => {};
      },
      emojis: () => this.emojiNames(),
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
      say: async (channelId, content, pingUserId, replyTo) => {
        const ch = await this.sendable("neru", channelId);
        await ch.send({
          content,
          allowedMentions: { users: pingUserId ? [pingUserId] : [], repliedUser: false },
          ...(replyTo ? { reply: { messageReference: replyTo, failIfNotExists: false } } : {}),
        });
      },
      log: async (e) => {
        const lines = [
          `**${e.kind}** · <@${e.userId}>${e.channelId ? ` en <#${e.channelId}>` : ""}`,
          `${e.detail} → ${e.action}${e.activeStrikes !== null ? ` · strikes activos: ${e.activeStrikes}` : ""}`,
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
    // `npm run worker:deploy`. Aqui solo los de Teto y Neru, que usan la base local (cuota y strikes).
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
    const target = findTextChannel(this.guild, cal.channel);
    if (!target) return;
    const weeks = await cal.service.build();
    this.d.levels.setReleases(cal.service.releases(weeks));
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

  /** Rol especial sobre los niveles: toma el color de #tu-color que elija su dueña, o vuelve al suyo. */
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
    await role.setColors({ primaryColor: want }, "Color de #tu-color de su dueña (config/especiales.json)");
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
    const niveles = findTextChannel(this.guild, "niveles-ko-fi");
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

