// Mango9374 en Discord (src/services/mango.ts): su propio cliente, fuera de los Vocaloids. Contesta cada @ con los
// numeros del dia (o, a veces, una frase fija) y lleva la foto de perfil del Papu real al que imita.
import { Client, Events, GatewayIntentBits, type Guild, type Message } from "discord.js";
import { kvGet, kvSet, type Db } from "../db/database";
import { logError, type LogFn } from "../log";
import { mentionsUser, type MangoService } from "../services/mango";

const AVATAR_KEY = "mango:avatar";

export interface MangoDeps {
  service: MangoService;
  token: string;
  db: Db;
  owners: ReadonlySet<string>;
  /** Numeros del dia ya escritos (src/services/estadisticas.ts): los de un Papu y los totales para GyroP. */
  stats: { papu: (userId: string) => string; server: () => string };
  report: (text: string) => Promise<void>;
  log: LogFn;
}

export class MangoDiscord {
  readonly client: Client;

  constructor(private readonly d: MangoDeps) {
    this.client = new Client({ intents: [GatewayIntentBits.Guilds], enforceNonce: true, allowedMentions: { parse: ["users"], repliedUser: true } }); // como SAFE_MENTIONS de app.ts
    this.client.on(Events.Error, (e) => logError("cliente mango", e));
  }

  get userId(): string | null {
    return this.client.user?.id ?? null;
  }

  async start(): Promise<void> {
    const ready = new Promise<void>((resolve) => this.client.once(Events.ClientReady, () => resolve()));
    await this.client.login(this.d.token);
    await ready;
    this.client.user!.setPresence({ status: "online" });
    this.d.log(`mango en línea como ${this.client.user!.tag}`);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  /** Nombre del bot y foto del Papu real (solo si cambiaron: Discord limita los cambios de perfil). */
  async syncProfile(guild: Guild): Promise<void> {
    const me = this.client.user!;
    const { nombre, usuario } = this.d.service.settings;
    if (me.username !== nombre) {
      await me.setUsername(nombre).catch((e) => this.d.report(`⚠️ Mango9374: no pude cambiarle el nombre (${(e as Error).message}); ponlo en el Developer Portal.`));
    }
    const real = /^\d+$/.test(usuario)
      ? await guild.members.fetch(usuario).catch(() => null)
      : (await guild.members.search({ query: usuario, limit: 10 }).catch(() => null))?.find((x) => x.user.username.toLowerCase() === usuario);
    if (!real) {
      await this.d.report(`⚠️ Mango9374: no encuentro a ${usuario} en el servidor para copiar su foto (config/mango.json).`);
      return;
    }
    const hash = real.user.avatar;
    if (!hash || kvGet(this.d.db, AVATAR_KEY) === hash) return;
    try {
      await me.setAvatar(real.user.displayAvatarURL({ extension: "png", size: 512 }));
      kvSet(this.d.db, AVATAR_KEY, hash);
      this.d.log(`Mango9374: foto de perfil copiada de ${real.user.username}`);
    } catch (e) {
      await this.d.report(`⚠️ Mango9374: no pude ponerle la foto de ${real.user.username} (${(e as Error).message}). Se reintenta al reconectar.`);
    }
  }

  /** Un @ a Mango (sin limite): los numeros del dia o, a veces, una frase. Devuelve si contesto. */
  async onMessage(m: Message): Promise<boolean> {
    const id = this.userId;
    if (!id || !mentionsUser(m.content, id)) return false;
    const a = this.d.service.answer(this.d.owners.has(m.author.id));
    const content = a.kind === "frase" ? a.text : a.kind === "totales" ? this.d.stats.server() : this.d.stats.papu(m.author.id);
    const ch = await this.client.channels.fetch(m.channelId);
    if (!ch?.isSendable()) throw new Error(`mango no puede escribir en el canal ${m.channelId}`);
    // Solo avisa al que lo nombro (el top de XP de los totales sale sin notificar).
    await ch.send({ content, reply: { messageReference: m.id, failIfNotExists: false }, allowedMentions: { users: [m.author.id], repliedUser: true } });
    return true;
  }
}
