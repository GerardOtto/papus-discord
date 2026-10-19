// Configuracion desde el entorno (.env). Los tokens nunca se imprimen ni se guardan en registros.
import { existsSync } from "node:fs";
import path from "node:path";

/** Las 4 chicas con tareas en el servidor (bienvenidas, votaciones, tips, moderacion): sus tokens son obligatorios. */
export const CORE_BOT_IDS = ["teto", "miku", "luka", "neru"] as const;
/** Vocaloids solo para conversar (sin tareas): se conectan solo si su token esta en .env. */
export const CHAT_BOT_IDS = ["gakupo", "kaito", "flower", "ia", "haku", "gumi"] as const;
export const BOT_IDS = [...CORE_BOT_IDS, ...CHAT_BOT_IDS] as const;
export type CoreBotId = (typeof CORE_BOT_IDS)[number];
export type ChatBotId = (typeof CHAT_BOT_IDS)[number];
export type BotId = (typeof BOT_IDS)[number];

export interface Config {
  tokens: Record<CoreBotId, string> & Partial<Record<ChatBotId, string>>;
  /** Bots que se conectan: las 4 chicas y los de conversacion con token. */
  activeBots: BotId[];
  guildId: string;
  /** Usuario de Discord de GyroP (exento de moderacion y unico que usa comandos de administracion). */
  ownerId: string | null;
  llm: {
    groqKey: string | null;
    geminiKey: string | null;
    openrouterKey: string | null;
    cloudflareAccountId: string | null;
    cloudflareToken: string | null;
  };
  engineDir: string;
  deliveryDir: string | null;
  dailyQuota: number;
  quotaTimeZone: string;
  dataDir: string;
}

export class ConfigError extends Error {}

export const isCoreBot = (id: BotId): id is CoreBotId => (CORE_BOT_IDS as readonly string[]).includes(id);

const opt = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const v = env[key]?.trim();
  return v ? v : null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, rootDir = process.cwd()): Config {
  const missing: string[] = [];
  const req = (key: string): string => {
    const v = opt(env, key);
    if (!v) missing.push(key);
    return v ?? "";
  };

  const tokens: Config["tokens"] = Object.fromEntries(CORE_BOT_IDS.map((id) => [id, req(`DISCORD_TOKEN_${id.toUpperCase()}`)])) as Record<
    CoreBotId,
    string
  >;
  for (const id of CHAT_BOT_IDS) {
    const t = opt(env, `DISCORD_TOKEN_${id.toUpperCase()}`);
    if (t) tokens[id] = t;
  }
  const guildId = req("DISCORD_GUILD_ID");
  if (missing.length) throw new ConfigError(`Faltan variables en .env: ${missing.join(", ")}`);

  const dailyQuota = Number(opt(env, "DAILY_QUOTA") ?? 12);
  if (!Number.isInteger(dailyQuota) || dailyQuota < 0) throw new ConfigError("DAILY_QUOTA debe ser un entero >= 0");

  const quotaTimeZone = opt(env, "QUOTA_RESET_TZ") ?? "America/Santiago";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: quotaTimeZone });
  } catch {
    throw new ConfigError(`QUOTA_RESET_TZ no es una zona horaria valida: ${quotaTimeZone}`);
  }

  const deliveryDir = opt(env, "DELIVERY_DIR");
  return {
    tokens,
    activeBots: BOT_IDS.filter((id) => !!tokens[id]),
    guildId,
    ownerId: opt(env, "OWNER_USER_ID"),
    llm: {
      groqKey: opt(env, "GROQ_API_KEY"),
      geminiKey: opt(env, "GEMINI_API_KEY"),
      openrouterKey: opt(env, "OPENROUTER_API_KEY"),
      cloudflareAccountId: opt(env, "CLOUDFLARE_ACCOUNT_ID"),
      cloudflareToken: opt(env, "CLOUDFLARE_API_TOKEN"),
    },
    engineDir: path.resolve(rootDir, opt(env, "ENGINE_DIR") ?? "../Proyecto1"),
    deliveryDir: deliveryDir && existsSync(deliveryDir) ? deliveryDir : null,
    dailyQuota,
    quotaTimeZone,
    dataDir: path.resolve(rootDir, opt(env, "DATA_DIR") ?? "data"),
  };
}

/** Carga .env si existe (Node >= 20.12). */
export function loadDotEnv(file = ".env"): void {
  if (existsSync(file)) process.loadEnvFile(file);
}
