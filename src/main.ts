// Punto de entrada: arma las piezas y conecta los 4 bots. `npm start`.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATE_FOLDERS, VideoCatalog } from "./catalog/videos";
import { BOT_IDS, loadConfig, loadDotEnv, type BotId } from "./config";
import { openDb } from "./db/database";
import { PapusApp } from "./discord/app";
import { EngineReader } from "./engine/reader";
import { LLMChain } from "./llm/chain";
import { buildProviders, loadLLMSettings } from "./llm/index";
import { PersonaLibrary } from "./llm/prompt";
import { RequestQueue } from "./llm/queue";
import { GpuMonitor, nvidiaSmiSampler, SmartRouter } from "./llm/router";
import { LLMUsage } from "./llm/usage";
import { log, logError } from "./log";
import { loadModerationSettings, RuleSet } from "./moderation/rules";
import { StrikeStore } from "./moderation/strikes";
import { Phrases } from "./phrases/catalog";
import { DeckStore } from "./phrases/deck";
import { Quota } from "./quota/quota";
import { loadLayout } from "./setup/layout";
import { ConversationService } from "./services/conversation";
import { founderSettings } from "./services/founders";
import { vitrinaChannels } from "./services/vitrina";
import { ModerationService } from "./services/moderation";
import { loadPrivacySettings, PrivacyGuard } from "./services/privacy";

const QUEUE_CONCURRENCY = 4;
const MAX_WAIT_MS = 2 * 60_000;

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const db = openDb(path.join(config.dataDir, "papus.sqlite"));
  const engine = new EngineReader(config.engineDir, config.deliveryDir);
  const missing = engine.missing();
  if (missing.length) log(`⚠️ Faltan datos del motor: ${missing.join(", ")}`);
  const characters = Object.fromEntries(BOT_IDS.map((id) => [id, engine.character(id)])) as Record<BotId, ReturnType<EngineReader["character"]>>;

  // Catalogo de videos (solo nombres de carpetas -> titulo y estado) de las carpetas 1, 2, 5 y 6 del escritorio.
  const videoFolders = Object.fromEntries(
    STATE_FOLDERS.map(({ key }) => [key, engine.resolveDelivery(key)]).filter(([, p]) => p !== null),
  ) as Record<string, string>;
  const videos = new VideoCatalog(videoFolders);
  log(`Catálogo de videos: ${videos.list().length} títulos (solo nombre y estado)`);

  const llmSettings = loadLLMSettings();
  const { providers, skipped, dailyLimits } = buildProviders(llmSettings);
  if (skipped.length) log(`⚠️ Proveedores sin clave (omitidos): ${skipped.join(", ")}`);

  const moderationSettings = loadModerationSettings();
  const strikes = new StrikeStore(db, moderationSettings.limites.strikeDias);
  const decks = new DeckStore(db);
  const phrases = new Phrases(decks);
  // Dueños (GyroP): sin limite de cuota y exentos de moderacion; pagar NO da exencion. La app agrega al
  // dueño del servidor al conectar, y como el Set es compartido, la cuota y Neru lo ven al instante.
  const owners = new Set<string>(config.ownerId ? [config.ownerId] : []);
  const quota = new Quota(db, config.dailyQuota, config.quotaTimeZone, owners);
  const queue = new RequestQueue({ concurrency: QUEUE_CONCURRENCY, maxWaitMs: MAX_WAIT_MS });

  let app: PapusApp | null = null;
  const usage = new LLMUsage(db, config.quotaTimeZone, dailyLimits, (a) =>
    void app?.report(`⚠️ ${a.provider} lleva ${a.used} de ~${a.limit} peticiones hoy (80 %). Si se agota, la cadena pasa al siguiente.`),
  );
  // Reparto: el modelo local primero si la tarjeta esta libre y no esta ocupado con otro Papu; si no, las APIs
  // (ordenadas por lo que les queda del dia). El uso de la GPU se lee con nvidia-smi cada 15 s.
  const gpu = new GpuMonitor(nvidiaSmiSampler());
  gpu.start();
  const router = new SmartRouter({ local: "local", localMaxInFlight: 1, gpu, remaining: (p) => usage.remainingFraction(p), prefer: llmSettings.preferencia });
  const chain = new LLMChain(providers, usage, Date.now, router);

  // Estado para el icono de la bandeja (data/estado.json, sin claves): consumo de cada API hoy (dia de Chile).
  const writeStatus = () => {
    const apis = llmSettings.providers
      .filter((p) => providers.some((x) => x.name === p.name))
      .map((p) => {
        const hoy = usage.today(p.name);
        const limite = p.dailyRequests ?? null;
        return { nombre: p.name, modelo: p.model, hoy, limite, porcentaje: limite ? Math.round((hoy * 100) / limite) : null };
      });
    writeFileSync(path.join(config.dataDir, "estado.json"), `${JSON.stringify({ actualizado: new Date().toISOString(), apis }, null, 2)}
`);
  };
  writeStatus();
  setInterval(writeStatus, 60_000).unref();
  const personas = new PersonaLibrary();
  const privacy = new PrivacyGuard(loadPrivacySettings());

  const layout = loadLayout();
  app = new PapusApp({
    config,
    db,
    quota,
    strikes,
    phrases,
    decks,
    characters,
    moderationSettings,
    owners,
    founders: founderSettings(layout),
    everyoneRole: layout.rolesExtra.find((r) => r.todos)?.rol ?? null,
    vitrina: vitrinaChannels(layout),
    log,
    makeConversation: (port) =>
      new ConversationService({
        quota,
        queue,
        chain,
        phrases,
        personas,
        characters,
        port,
        llm: { maxTokens: llmSettings.maxTokens, temperature: llmSettings.temperature },
        videos: (text) => videos.relevantTo(text),
        culture: personas.culture(),
        privacy,
        log,
      }),
    makeModeration: (port, exempt) => new ModerationService(new RuleSet(moderationSettings), strikes, phrases, port, exempt),
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`Apagando (${signal})…`);
    gpu.stop();
    await app?.stop().catch(() => {});
    db.close();
    process.exit(0);
  };
  // Cierre ordenado pedido desde fuera (icono de la bandeja, npm run detener, cierre de sesion de Windows): si aparece
  // data/detener.flag, las chicas se despiden y el programa se cierra; run-bots.cmd ve el archivo y no lo reinicia.
  const stopFlag = path.join(config.dataDir, "detener.flag");
  rmSync(stopFlag, { force: true }); // uno viejo no debe apagar este arranque
  setInterval(() => {
    if (existsSync(stopFlag)) void shutdown("pedido de detención");
  }, 2000).unref();
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // Windows: SIGHUP al cerrar la ventana de la consola, SIGBREAK con Ctrl+Pausa. (Un apagado forzado del PC
  // no avisa: en ese caso no hay despedida, y los bots solo aparecen desconectados.)
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
  process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
  process.on("unhandledRejection", (e) => logError("promesa sin manejar", e));

  await app.start();
  // Mantenimiento diario: borra registros viejos de cuota y strikes.
  setInterval(() => {
    quota.prune();
    strikes.prune();
  }, 24 * 3_600_000);
}

main().catch((e) => {
  logError("No se pudo arrancar", e);
  process.exit(1);
});
