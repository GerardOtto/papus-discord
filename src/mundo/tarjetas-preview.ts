// Puente AISLADO de tarjetas para la Plaza preview (docs/PLAZA_PREVIEW.md). Corre como un proceso aparte del bot
// (scripts/plaza-tarjetas.ts): no inicia sesión en Discord (solo REST, con el token de Teto), abre la base de los bots
// en SOLO LECTURA y escribe únicamente en el D1 del preview, nunca en el de producción.
import { DatabaseSync } from "node:sqlite";
import type { Db } from "../db/database";
import { d1Client, workerDatabaseId } from "../cloud/d1";
import { renderCard, type CardData, type CardEquip } from "../levels/card";
import { cardBackground, cardDataFrom, fetchAvatar } from "../levels/card-data";
import type { LevelService } from "../levels/service";
import type { ConversationService } from "../services/conversation";
import { MundoPuente, type MundoStats } from "./puente";

const SNOWFLAKE = /^\d{5,25}$/;
const DISCORD_API = "https://discord.com/api/v10";
/** Cada cuánto se vuelve a pedir la lista de miembros (para el puesto del ranking, como /nivel). */
const MIEMBROS_MS = 3_600_000;

/** Abre la base de los bots sin poder escribirla: ni migraciones ni WAL ni nada (cualquier escritura falla). */
export function abrirSoloLectura(file: string): Db {
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec("PRAGMA query_only = ON;");
  return db;
}

export class ConfigPreviewError extends Error {}

/** ID del D1 del preview: obligatorio y nunca el de producción (worker/wrangler.toml). */
export function idPreview(env: NodeJS.ProcessEnv, root: string): string {
  const id = env.PLAZA_PREVIEW_D1_DATABASE_ID?.trim();
  if (!id) throw new ConfigPreviewError("Falta PLAZA_PREVIEW_D1_DATABASE_ID: el puente de tarjetas no arranca sin el D1 del preview.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ConfigPreviewError("PLAZA_PREVIEW_D1_DATABASE_ID no parece un UUID de D1.");
  const produccion = workerDatabaseId(root);
  if (produccion && produccion === id) throw new ConfigPreviewError("PLAZA_PREVIEW_D1_DATABASE_ID es el D1 de producción: no se usa.");
  return id;
}

interface MiembroApi {
  nick?: string | null;
  avatar?: string | null;
  user: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean };
}

export interface MiembroDiscord {
  nombre: string;
  avatarUrl: string;
}

/** Nombre visible y avatar (el del servidor si tiene) como los muestra discord.js (displayName / displayAvatarURL). */
export function miembroDesdeApi(guildId: string, m: MiembroApi): MiembroDiscord {
  const u = m.user;
  const avatarUrl = m.avatar
    ? `https://cdn.discordapp.com/guilds/${guildId}/users/${u.id}/avatars/${m.avatar}.png?size=256`
    : u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
  return { nombre: m.nick ?? u.global_name ?? u.username, avatarUrl };
}

/** Lectura de Discord solo por REST (sin sesión de gateway: no hay un segundo Teto conectado). */
export class DiscordLectura {
  private miembros: { ids: Set<string>; at: number } | null = null;

  constructor(
    private readonly token: string,
    private readonly guildId: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async get<T>(ruta: string): Promise<{ status: number; body: T | null }> {
    const r = await this.fetchFn(`${DISCORD_API}${ruta}`, {
      headers: { Authorization: `Bot ${this.token}`, "User-Agent": "DiscordBot (papus-plaza-preview, 1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    return { status: r.status, body: r.ok ? ((await r.json()) as T) : null };
  }

  /** Miembro del servidor; si ya no está, su usuario. Null si Discord no lo conoce. */
  async miembro(userId: string): Promise<MiembroDiscord | null> {
    const m = await this.get<MiembroApi>(`/guilds/${this.guildId}/members/${userId}`);
    if (m.body) return miembroDesdeApi(this.guildId, m.body);
    const u = await this.get<MiembroApi["user"]>(`/users/${userId}`);
    return u.body ? miembroDesdeApi(this.guildId, { user: u.body }) : null;
  }

  /** IDs de los Papus (no bots) del servidor, cacheados una hora. Null si Discord no los entrega. */
  async idsMiembros(): Promise<Set<string> | null> {
    if (this.miembros && this.now() - this.miembros.at < MIEMBROS_MS) return this.miembros.ids;
    const ids = new Set<string>();
    let after = "0";
    for (;;) {
      const r = await this.get<MiembroApi[]>(`/guilds/${this.guildId}/members?limit=1000&after=${after}`);
      if (!r.body) return this.miembros?.ids ?? null;
      for (const m of r.body) if (!m.user.bot) ids.add(m.user.id);
      if (r.body.length < 1000) break;
      after = r.body[r.body.length - 1]!.user.id;
    }
    this.miembros = { ids, at: this.now() };
    return ids;
  }
}

export interface TarjetaPreviewDeps {
  levels: Pick<LevelService, "snapshot" | "standings" | "multiplier">;
  discord: Pick<DiscordLectura, "miembro" | "idsMiembros">;
  equipment?: (userId: string) => Promise<CardEquip>;
  dataDir: string;
  defaultAccent: string;
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
}

/** La misma tarjeta de /nivel en modo público: sin cuota diaria y en PNG (como LevelsDiscord.publicCard). */
export function crearTarjetaPublica(d: TarjetaPreviewDeps): (papuId: string) => Promise<{ data: Buffer; gif: boolean } | null> {
  return async (papuId) => {
    if (!SNOWFLAKE.test(papuId)) return null;
    const mb = await d.discord.miembro(papuId);
    if (!mb) return null;
    const snap = d.levels.snapshot(papuId);
    const ids = await d.discord.idsMiembros().catch(() => null);
    const position = (ids && d.levels.standings((id) => ids.has(id)).find((st) => st.userId === papuId)?.position) || snap.position;
    const equip =
      (await d.equipment?.(papuId).catch((e) => (d.log?.(`⚠ objetos de la tarjeta de ${papuId}: ${(e as Error)?.message ?? e}`), {} as CardEquip))) ?? {};
    const data: CardData = cardDataFrom(snap, {
      displayName: mb.nombre,
      avatar: await fetchAvatar(mb.avatarUrl, d.fetchFn),
      position,
      quota: null,
      defaultAccent: d.defaultAccent,
      background: cardBackground(d.dataDir, papuId, snap.card.fondo),
      multiplier: d.levels.multiplier(),
    });
    return { data: await renderCard(data, equip), gif: false };
  };
}

/** Las menciones a los Vocaloids no se atienden en el preview (bots: []): esta conversación nunca se usa. */
const sinConversacion = (): ConversationService =>
  ({
    handle: async () => {
      throw new Error("El preview no conversa: no hay Vocaloids conectados.");
    },
  }) as unknown as ConversationService;

/** Puente al D1 del preview, sin Vocaloids, chat ni foto del servidor; el caller puede añadir acciones explícitamente de solo lectura. */
export function crearPuentePreview(o: {
  env: NodeJS.ProcessEnv;
  root: string;
  stats: (papuId: string) => MundoStats;
  tarjetaPublica: (papuId: string) => Promise<{ data: Buffer; gif: boolean } | null>;
  owners?: ReadonlySet<string>;
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
}): { puente: MundoPuente; databaseId: string; query: ReturnType<typeof d1Client> } {
  const databaseId = idPreview(o.env, o.root);
  const token = o.env.CLOUDFLARE_DEPLOY_TOKEN?.trim();
  const accountId = o.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) throw new ConfigPreviewError("Faltan CLOUDFLARE_DEPLOY_TOKEN o CLOUDFLARE_ACCOUNT_ID.");
  const query = d1Client({ accountId, token, databaseId, fetchFn: o.fetchFn });
  const puente = new MundoPuente({
    query,
    makeConversation: sinConversacion,
    bots: [],
    owners: o.owners ?? new Set(),
    stats: o.stats,
    tarjetaPublica: o.tarjetaPublica,
    log: o.log,
  });
  return { puente, databaseId, query };
}
