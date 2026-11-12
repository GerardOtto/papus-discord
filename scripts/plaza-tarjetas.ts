// Puente aislado de tarjetas y misiones de la Plaza preview: npm run plaza:tarjetas (docs/PLAZA_PREVIEW.md).
// Proceso aparte de los bots: no se conecta a Discord como bot (solo REST con el token de Teto), lee la base de los bots
// en SOLO LECTURA y escribe únicamente en el D1 del preview (PLAZA_PREVIEW_D1_DATABASE_ID, nunca el de producción).
//
// Variables (además del .env de los bots, que se lee pero no se modifica):
//   PLAZA_PREVIEW_D1_DATABASE_ID   UUID del D1 papus-plaza-preview (obligatorio)
//   PLAZA_DATA_DIR                 carpeta con papus.sqlite y tarjetas/ (obligatorio; se abre en solo lectura)
//   PAPUS_ENV_FILE                 .env de los bots a leer (opcional; en la nube lo entrega systemd)
// Prueba sin D1: npm run plaza:tarjetas -- --probar=<id de un Papu> [--salida=tarjeta.png]
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CORE_BOT_IDS, loadConfig, loadDotEnv } from "../src/config";
import { toCardEquip } from "../src/coins/equip";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { loadMercadoSettings } from "../src/mercado/rules";
import { MercadoService } from "../src/mercado/service";
import { EngineReader } from "../src/engine/reader";
import { loadLevelSettings, progress } from "../src/levels/rules";
import { LevelService } from "../src/levels/service";
import { abrirSoloLectura, crearPuentePreview, crearTarjetaPublica, DiscordLectura } from "../src/mundo/tarjetas-preview";
import { Quota } from "../src/quota/quota";
import { Especiales, loadEspeciales } from "../src/services/especiales";
import { loadModerationSettings } from "../src/moderation/rules";
import { StrikeStore } from "../src/moderation/strikes";
import { loadRouletteSettings } from "../src/ruleta/rules";
import { RouletteService } from "../src/ruleta/service";
import { EconomiaPlazaPreview } from "../src/mundo/economia-preview";

const ROOT = path.resolve(import.meta.dirname, "..");
const CADA_MS = 3_000;
const ACENTO_TETO = "#d43c4c";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

function main(): void {
  if (process.env.PAPUS_ENV_FILE) loadDotEnv(process.env.PAPUS_ENV_FILE);
  // Solo hacen falta el token de Teto y el servidor; loadConfig exige los de los 4 Vocaloids principales.
  for (const id of CORE_BOT_IDS) process.env[`DISCORD_TOKEN_${id.toUpperCase()}`] ||= "sin-usar";
  const config = loadConfig(process.env, ROOT);
  const tetoToken = process.env.DISCORD_TOKEN_TETO?.trim();
  if (!tetoToken || tetoToken === "sin-usar") throw new Error("Falta DISCORD_TOKEN_TETO (solo se usa para leer nombres y avatares por REST).");

  const dataDir = process.env.PLAZA_DATA_DIR?.trim();
  if (!dataDir || !existsSync(path.join(dataDir, "papus.sqlite"))) throw new Error("PLAZA_DATA_DIR debe apuntar a la carpeta con papus.sqlite.");
  const db = abrirSoloLectura(path.join(dataDir, "papus.sqlite"));

  const owners = new Set<string>(config.ownerId ? [config.ownerId] : []);
  const especiales = new Especiales(loadEspeciales(), Date.now, config.quotaTimeZone);
  const moderation = loadModerationSettings();
  const strikes = new StrikeStore(db, moderation.limites.strikeDias);
  const levels = new LevelService({
    db,
    settings: loadLevelSettings(),
    timeZone: config.quotaTimeZone,
    unranked: (id) => owners.has(id),
    xpBlocked: (id, at) => strikes.xpBlocked(id, at),
  });
  const quota = new Quota(db, (id, now) => levels.limitFor(id, now), config.quotaTimeZone, {
    has: (id) => owners.has(id) || especiales.unlimited(id),
  });
  const coinSettings = loadCoinSettings();
  const coins = coinSettings.activo
    ? new CoinService({ db, settings: coinSettings, catalog: loadCatalog(), timeZone: config.quotaTimeZone })
    : null;

  // Solo consulta misiones reales. No se conecta la acción de girar: este proceso abre SQLite en solo lectura.
  const roulette = new RouletteService({ db, settings: loadRouletteSettings(), levels, quota, timeZone: config.quotaTimeZone });

  const mercado = coins
    ? new MercadoService({ db, settings: loadMercadoSettings(), coins, quota, roulette, timeZone: config.quotaTimeZone })
    : null;

  let acento = ACENTO_TETO;
  try {
    acento = `#${new EngineReader(config.engineDir).character("teto").color.toString(16).padStart(6, "0")}`;
  } catch (e) {
    log(`⚠ sin datos del motor para el color de Teto (${(e as Error)?.message ?? e}); uso ${ACENTO_TETO}`);
  }

  const tarjetaPublica = crearTarjetaPublica({
    levels,
    discord: new DiscordLectura(tetoToken, config.guildId),
    equipment: coins ? async (id) => toCardEquip(coins.equipped(id), coins.founderNumber(id)) : undefined,
    dataDir,
    defaultAccent: acento,
    log,
  });

  // --probar=<id> [--salida=archivo.png]: dibuja una tarjeta a un archivo y sale, sin tocar ningún D1.
  const probar = process.argv.find((a) => a.startsWith("--probar="))?.slice(9);
  if (probar) {
    const salida = process.argv.find((a) => a.startsWith("--salida="))?.slice(9) ?? `tarjeta-${probar}.png`;
    void tarjetaPublica(probar).then((card) => {
      if (!card) throw new Error(`No se pudo dibujar la tarjeta de ${probar}.`);
      writeFileSync(salida, card.data);
      log(`✔ tarjeta de prueba: ${salida} (${Math.round(card.data.length / 1024)} KB)`);
      db.close();
    }).catch((e) => (log(`✘ ${(e as Error)?.message ?? e}`), process.exit(1)));
    return;
  }

  let economia: EconomiaPlazaPreview | null = null;
  const { puente, databaseId, query } = crearPuentePreview({
    env: process.env,
    root: ROOT,
    owners,
    // Perfil del preview: XP y tiradas del ledger aislado; cuota de Discord siempre de solo lectura.
    stats: (id) => {
      const record = levels.store.get(id);
      const xp = economia?.xp(id) ?? record.xp;
      const restante = quota.remaining(id);
      const limite = quota.limitFor(id);
      return {
        nivel: progress(levels.settings, xp).level,
        prestigio: record.prestige,
        restante: Number.isFinite(restante) ? restante : null,
        limite: Number.isFinite(limite) ? limite : null,
        ruletas: Math.max(0, roulette.status(id).left - (economia?.ruletasUsadas(id) ?? 0)),
      };
    },
    tarjetaPublica: async (id) => {
      const t0 = Date.now();
      const card = await tarjetaPublica(id);
      if (card) log(`✔ tarjeta de ${id} (${Math.round(card.data.length / 1024)} KB, ${Date.now() - t0} ms)`);
      return card;
    },
    log,
  });
  economia = new EconomiaPlazaPreview({ query, db, levels, coins, mercado, roulette, quota });
  await economia.preload();
  puente.acciones = economia.acciones();
  log(`✔ mundoPreview listo: D1 ${databaseId.slice(0, 8)}… (preview), base en solo lectura: ${dataDir}`);

  let ocupado = false;
  let parar = false;
  let fallos = 0;
  const timer = setInterval(() => {
    if (ocupado || parar) return;
    ocupado = true;
    void puente
      .sync()
      .then(() => {
        if (fallos) log(`✔ sincronización recuperada tras ${fallos} fallo(s)`);
        fallos = 0;
      })
      .catch((e) => {
        // Sin inundar el registro si Cloudflare se cae: el primero y luego cada 100.
        if (fallos++ % 100 === 0) log(`✘ sincronización de tarjetas: ${(e as Error)?.message ?? e}`);
      })
      .finally(() => (ocupado = false));
  }, CADA_MS);

  const salir = (senal: string) => {
    if (parar) return;
    parar = true;
    clearInterval(timer);
    log(`■ ${senal}: deteniendo el puente de tarjetas`);
    void puente.esperar().finally(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => salir("SIGTERM"));
  process.on("SIGINT", () => salir("SIGINT"));
}

try {
  main();
} catch (e) {
  log(`✘ ${(e as Error)?.message ?? e}`);
  process.exit(1);
}
