// Configuracion desde el entorno (.env). Los tokens nunca se imprimen ni se guardan en registros.
import { existsSync } from "node:fs";
import path from "node:path";

export const BOT_IDS = ["teto", "miku", "luka", "neru"] as const;
export type BotId = (typeof BOT_IDS)[number];

export interface Config {
  tokens: Record<BotId, string>;
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

  const tokens = Object.fromEntries(BOT_IDS.map((id) => [id, req(`DISCORD_TOKEN_${id.toUpperCase()}`)])) as Record<
    BotId,
    string
  >;
  const guildId = req("DISCORD_GUILD_ID");
  if (missing.length) throw new ConfigError(`Faltan variables en .env: ${missing.join(", ")}`);

  const dailyQuota = Number(opt(env, "DAILY_QUOTA") ?? 7);
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
