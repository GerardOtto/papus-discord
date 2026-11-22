// Punto de entrada: arma las piezas y conecta los bots (las 4 chicas y los Vocaloids de conversacion con token). `npm start`.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATE_FOLDERS, VideoCatalog } from "./catalog/videos";
import { BOT_IDS, CHAT_BOT_IDS, CORE_BOT_IDS, loadConfig, loadDotEnv, type BotId } from "./config";
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
import { dayKey } from "./time";
import { loadModerationSettings, RuleSet } from "./moderation/rules";
import { StrikeStore } from "./moderation/strikes";
import { Phrases } from "./phrases/catalog";
import { DeckStore } from "./phrases/deck";
import { Quota } from "./quota/quota";
import { ImageAllowance } from "./quota/imagenes";
import { fetchImage } from "./llm/image";
import { LevelService } from "./levels/service";
import { loadLevelSettings } from "./levels/rules";
import { loadLayout } from "./setup/layout";
import { GeneralChat } from "./services/charla";
import { ConversationService, type ChatPort } from "./services/conversation";
import { mundoFromEnv } from "./mundo/puente";
import { buildCalendar } from "./calendar/setup";
import { channelKey } from "./discord/channels";
import { Especiales, loadEspeciales } from "./services/especiales";
import { founderSettings } from "./services/founders";
import { vitrinaChannels } from "./services/vitrina";
import { ModerationService } from "./services/moderation";
import { loadPrivacySettings, PrivacyGuard } from "./services/privacy";
import { loadRiddles, loadWeddingSettings } from "./bodas/rules";
import { loadRouletteSettings } from "./ruleta/rules";
import { RouletteService } from "./ruleta/service";
import { loadCatalog, loadCoinSettings } from "./coins/rules";
import { CoinService } from "./coins/service";
import { loadMembresiaSettings } from "./membresias/rules";
import { MembresiaService } from "./membresias/service";
import { loadSorteoSettings } from "./sorteo/rules";
import { SorteoService } from "./sorteo/service";
import { loadPeleaSettings } from "./peleas/rules";
import { PeleaService } from "./peleas/service";
import { loadCarreraSettings, loadFrasesCarrera } from "./carreras/rules";
import { CarreraService } from "./carreras/service";
import { loadNemesisSettings } from "./nemesis/rules";
import { NemesisService } from "./nemesis/service";
import { WeddingService } from "./bodas/service";
import { loadQuestions, loadTriviaSettings } from "./trivia/rules";
import { actividadFromEnv } from "./trivia/actividad";
import { puenteFromEnv } from "./celular/puente";
import { CumpleService, loadCumpleSettings } from "./cumpleanos/service";
import { AjedrezPuente, loadAjedrezSettings } from "./ajedrez/puente";
import { d1FromEnv } from "./cloud/d1";
import { TriviaService } from "./trivia/service";
import { loadMercadoSettings } from "./mercado/rules";
import { MercadoService } from "./mercado/service";
import { loadIntercambioSettings } from "./intercambios/rules";
import { IntercambioService } from "./intercambios/service";
import { loadMangoSettings, MangoService } from "./services/mango";
import { clock, inHours, loadAmbientSettings, loadPolls } from "./ambiente/rules";
import { AmbientCounters, AmbientService } from "./ambiente/service";
import { loadAdivinanzasSettings, loadBanco } from "./adivinanzas/rules";
import { AdivinanzasService } from "./adivinanzas/service";
import { bannerAdivinanza, bannerGanador, bannerNadie } from "./adivinanzas/images";
import { avatarFile } from "./peleas/images";

const QUEUE_CONCURRENCY = 4;
const MAX_WAIT_MS = 2 * 60_000;

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const db = openDb(path.join(config.dataDir, "papus.sqlite"));
  const engine = new EngineReader(config.engineDir, config.deliveryDir);
  const missing = engine.missing();
  if (missing.length) log(`⚠️ Faltan datos del motor: ${missing.join(", ")}`);
  const offline = CHAT_BOT_IDS.filter((id) => !config.activeBots.includes(id));
  if (offline.length) log(`Sin token en .env (no se conectan): ${offline.join(", ")}`);
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
  // Ver imagenes (PLAN §5.1): cadena aparte con modelos que las leen. Gemini se llama igual que el de texto porque
  // comparte su cupo diario; groq-vision tiene el suyo (cupo por modelo en Groq).
  const visionSettings = llmSettings.vision?.activo ? llmSettings.vision : null;
  const visionBuilt = visionSettings ? buildProviders({ providers: visionSettings.providers, timeoutMs: llmSettings.timeoutMs }) : null;
  if (visionBuilt?.skipped.length) log(`⚠️ Visión sin clave (omitidos): ${visionBuilt.skipped.join(", ")}`);
  for (const [name, n] of Object.entries(visionBuilt?.dailyLimits ?? {})) dailyLimits[name] ??= n;

  const moderationSettings = loadModerationSettings();
  const strikes = new StrikeStore(db, moderationSettings.limites.strikeDias);
  const decks = new DeckStore(db);
  const phrases = new Phrases(decks);
  // Dueños (GyroP): sin limite de cuota y exentos de moderacion; pagar NO da exencion. La app agrega al
  // dueño del servidor al conectar, y como el Set es compartido, la cuota y Neru lo ven al instante.
  const owners = new Set<string>(config.ownerId ? [config.ownerId] : []);
  // Trato especial de un Papu concreto (config/especiales.json): regalo de GyroP, no de un nivel de Ko-fi.
  const especiales = new Especiales(loadEspeciales(), Date.now, config.quotaTimeZone);
  // Niveles por participacion: fijan la cuota de cada Papu (regla 1: nada de pago la cambia). GyroP no sube de nivel.
  // Con 2 o mas machetazos de Neru no se gana XP de ninguna forma.
  const levels = new LevelService({
    db,
    settings: loadLevelSettings(),
    timeZone: config.quotaTimeZone,
    unranked: (id) => owners.has(id),
    xpBlocked: (id, at) => strikes.xpBlocked(id, at),
  });
  const quota = new Quota(db, (id, now) => levels.limitFor(id, now), config.quotaTimeZone, { has: (id) => owners.has(id) || especiales.unlimited(id) }, levels.settings.donadosMax);
  // Bodas con las Vocaloids (config/bodas.json, PLAN §3.2): adivinanzas fijas, revisadas por el codigo.
  const weddings = new WeddingService({ db, settings: loadWeddingSettings(), riddles: loadRiddles(), decks });
  // Ruleta de los Papus (config/ruleta.json, PLAN §3.3): tiradas por misiones del dia; premios de XP y cuota extra.
  // La casilla del sobre da sobres comunes de la tienda (coins se crea abajo; sin tienda, la casilla no sale).
  const roulette = new RouletteService({
    db,
    settings: loadRouletteSettings(),
    levels,
    quota,
    giveSobres: loadCoinSettings().activo ? (id, n) => coins?.giveSobres(id, "comun", n) : undefined,
    timeZone: config.quotaTimeZone,
  });
  // Shaulitas (config/monedas.json y config/objetos.json, PLAN §3.6): solo adornan la tarjeta (regla 1). Lo ganado
  // participando se pone al dia cada vez que el Papu gana XP.
  const coinSettings = loadCoinSettings();
  const coins = coinSettings.activo
    ? new CoinService({
        db,
        settings: coinSettings,
        catalog: loadCatalog(),
        timeZone: config.quotaTimeZone,
        // Con el Micrófono de Meiko (mercado negro), la misión de voz de ese Papu ese día pide menos.
        missions: (st, userId, day) => {
          const list = roulette.missionsFor(userId, day, st);
          return { done: list.filter((m) => m.done).length, total: list.length };
        },
      })
    : null;
  if (coins) levels.afterAward = (userId) => coins.sync(userId, 1);
  // Membresías de Ko-fi (config/membresias.json, PLAN §2): XP, lanzar peleas y bodas, sobres temáticos elegibles,
  // recuperar objetos de vitrinas pasadas y descuento (necesita la tienda).
  const membresias = coins ? new MembresiaService({ db, settings: loadMembresiaSettings(), coins }) : null;
  // Sorteo de GyroP (config/sorteo.json, PLAN §3.5): todos los Papus en la ruleta; GyroP decide si el ganador se queda el premio.
  const sorteo = new SorteoService({ db, settings: loadSorteoSettings(), levels, quota });
  // 1vs1 de los Vocaloids (config/peleas.json, PLAN §3.7): apuestas solo con Shaulitas (sin tienda, no hay peleas).
  const peleaSettings = loadPeleaSettings();
  const peleas = coins && peleaSettings.activo ? new PeleaService({ db, settings: peleaSettings, coins }) : null;
  // Carreras de los Vocaloids (config/carreras.json, PLAN §3.14): apuestas mutuas solo con Shaulitas (sin tienda, no hay).
  const carreraSettings = loadCarreraSettings();
  const carreras =
    coins && carreraSettings.activo
      ? new CarreraService({ db, settings: carreraSettings, frases: loadFrasesCarrera(), coins, peleas: { horarios: peleaSettings.horarios, zona: peleaSettings.zona ?? carreraSettings.horario.zona } })
      : null;
  // Ruleta de Némesis (config/nemesis.json, PLAN §3.12): ruleta rusa entre dos Papus, solo con Shaulitas.
  const nemesisSettings = loadNemesisSettings();
  const nemesis = coins && nemesisSettings.activo ? new NemesisService({ db, settings: nemesisSettings, coins }) : null;
  // Trivia de los Papus (config/trivia.json, PLAN §3.4): preguntas fijas revisadas por el codigo; XP por acierto.
  const triviaSettings = loadTriviaSettings();
  // Superar todas las preguntas de una dificultad da su sobre de la tienda (comun, raro o legendario).
  const trivia = new TriviaService({ db, settings: triviaSettings, questions: loadQuestions(triviaSettings), levels, giveSobre: coins ? (id, tipo, n) => coins.giveSobres(id, tipo, n) : undefined, timeZone: config.quotaTimeZone });
  log(`Trivia: ${trivia.total} preguntas`);
  // Hitos de aciertos (7 nov. 2026): una sola vez, quienes ya tenian avance reciben los sobres de los hitos que pasaron.
  for (const h of trivia.seedMilestones()) log(`🎁 Trivia: hitos iniciales de ${h.userId} en ${h.level}: ${h.aciertos} aciertos → ${h.sobres} sobre(s)`);
  // Mercado negro (config/mercado.json, PLAN §3.9): una hora al dia; consumibles para la ruleta y la trivia y el PC de
  // Adachi Rei, solo con Shaulitas (sin tienda, no hay mercado).
  const mercadoSettings = loadMercadoSettings();
  const mercado = coins && mercadoSettings.activo ? new MercadoService({ db, settings: mercadoSettings, coins, quota, roulette, trivia, weddings, timeZone: config.quotaTimeZone }) : null;
  if (mercado) {
    const atun = mercado.byEfecto("atun");
    const baguette = mercado.byEfecto("baguette");
    if (atun) roulette.useAtun({ giros: atun.giros!, ...mercado.port("atun") });
    const helado = mercado.byEfecto("helado");
    if (helado) coins!.useHelado({ extra: helado.extra!, ...mercado.port("helado") });
    if (peleas && mercado.byEfecto("seguro")) peleas.useSeguro({ ...mercado.port("seguro"), devolver: (id) => mercado.devolver(id, "seguro") });
    trivia.useConsumables({
      baguette: baguette ? { vidas: baguette.vidas!, espera: baguette.espera!, ...mercado.port("baguette") } : undefined,
      celular: mercado.byEfecto("celular") ? mercado.port("celular") : undefined,
      guitarra: mercado.byEfecto("guitarra") ? mercado.port("guitarra") : undefined,
      zanahoria: mercado.byEfecto("zanahoria") ? mercado.port("zanahoria") : undefined,
    });
    // Disquete de Adachi Rei (tiradas guardadas) y Luna de IA (XP triple de los mensajes que contesta un Vocaloid).
    roulette.useDisquete((id) => mercado.tieneEfecto(id, "disquete"));
    levels.quotaBoost = (id, at) => mercado.quotaBoost(id, at);
  }
  // Intercambios entre Papus (config/intercambios.json, PLAN §3.10): Shaulitas, XP, niveles, cuota, sobres, objetos
  // y consumibles, como las ofertas de Steam (sin tienda, no hay intercambios).
  const intercambioSettings = loadIntercambioSettings();
  const intercambios = coins && intercambioSettings.activo ? new IntercambioService({ db, settings: intercambioSettings, coins, levels, quota, mercado, timeZone: config.quotaTimeZone }) : null;
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
  const chain = new LLMChain(providers, usage, Date.now, router, log);
  const visionChain = visionBuilt?.providers.length ? new LLMChain(visionBuilt.providers, usage, Date.now, null, log) : null;
  const imageAllowance = visionSettings ? new ImageAllowance(db, visionSettings.porPapuAlDia, config.quotaTimeZone, owners) : null;
  if (visionSettings) log(visionChain ? `Visión: ${visionBuilt!.providers.map((p) => p.name).join(" → ")} (${visionSettings.porPapuAlDia} imágenes al día por Papu)` : "⚠️ Visión activa pero sin proveedores con clave: los bots no ven imágenes");

  // Estado para el icono de la bandeja (data/estado.json, sin claves): consumo de cada API hoy (dia de Chile).
  const writeStatus = () => {
    // Con la vision: groq-vision suma su fila; Gemini ya sale (comparte el cupo con el de texto).
    const visionOnly = visionBuilt ? visionSettings!.providers.filter((p) => !llmSettings.providers.some((x) => x.name === p.name)) : [];
    const apis = [...llmSettings.providers, ...visionOnly]
      .filter((p) => providers.some((x) => x.name === p.name) || !!visionBuilt?.providers.some((x) => x.name === p.name))
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

  const today = () =>
    new Intl.DateTimeFormat("es-CL", { timeZone: config.quotaTimeZone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const until = (t: number) =>
    new Intl.DateTimeFormat("es-CL", { timeZone: config.quotaTimeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
  const llmOpts = { maxTokens: llmSettings.maxTokens, temperature: llmSettings.temperature };

  // Ambiente casual de los Vocaloids (config/ambiente.json, PLAN §3.13): reacciones, metiches, comentarios de lo que
  // pasa, preguntas al aire, momentos del dia y minidramas. Nada gasta la cuota de los Papus.
  const ambientSettings = loadAmbientSettings();
  const ambientCounters = new AmbientCounters(db, config.quotaTimeZone);
  const dramas = ambientSettings.activo && ambientSettings.dramas.activo ? ambientSettings.dramas : null;

  const layout = loadLayout();
  // Conversaciones con los Vocaloids: la misma cuota, cola y LLM en Discord y en el mundo de los Papus (src/mundo/).
  const makeConversation = (port: ChatPort) =>
    new ConversationService({
      quota,
      queue,
      chain,
      phrases,
      personas,
      characters,
      port,
      llm: llmOpts,
      videos: (text) => videos.relevantTo(text),
      culture: personas.culture(),
      privacy,
      // Lo que saben los bots: el trato especial de GyroP y las bodas vigentes (con quien y hasta cuando).
      notesFor: (id, bots) => {
        const a = especiales.notesFor(id, bots);
        const b = weddings.notesFor(id, bots, until);
        return Object.fromEntries(bots.flatMap((bot) => {
          const n = [a[bot], b[bot]].filter(Boolean).join(" ");
          return n ? [[bot, n]] : [];
        }));
      },
      log,
      today,
      vision:
        visionChain && imageAllowance && visionSettings
          ? {
              chain: visionChain,
              allowance: imageAllowance,
              extraUnits: visionSettings.cuotaExtra,
              load: (img, signal) => fetchImage(img, visionSettings.ladoMax, visionSettings.maxMB, fetch, signal),
            }
          : undefined,
    });
  // Mundo de los Papus (Actividad 3D): un @ a un Vocaloid de la plaza se responde como en Discord; la plaza muestra
  // el nivel y la cuota del dia de cada Papu.
  const mundo = mundoFromEnv(process.env, {
    makeConversation,
    bots: config.activeBots,
    owners,
    stats: (id) => {
      const { level, prestige } = levels.level(id);
      const restante = quota.remaining(id);
      const limite = quota.limitFor(id);
      return {
        nivel: level,
        prestigio: prestige,
        restante: Number.isFinite(restante) ? restante : null,
        limite: Number.isFinite(limite) ? limite : null,
        ruletas: roulette.status(id).left,
      };
    },
    log,
  });
  app = new PapusApp({
    config,
    db,
    quota,
    levels,
    // Colores de la tarjeta de nivel: los de las 4 chicas y la paleta de #tus-roles (solo adorno, regla 1).
    // Desde el 12 nov. 2026 las 4 chicas tambien estan en la paleta: sin repetir nombres.
    cardColors: [
      ...CORE_BOT_IDS.map((id) => ({ name: characters[id].displayName, value: `#${characters[id].color.toString(16).padStart(6, "0")}` })),
      ...(layout.coloresPapu?.colores ?? []).map((c) => ({ name: c.rol.replace(/^\S+\s+/, ""), value: c.color })),
    ].filter((c, k, all) => all.findIndex((x) => x.name.toLowerCase() === c.name.toLowerCase()) === k),
    strikes,
    phrases,
    decks,
    characters,
    moderationSettings,
    owners,
    especiales,
    specialColors: {
      base: new Map(layout.rolesExtra.filter((r) => r.sobreNiveles).map((r) => [channelKey(r.rol), parseInt(r.color.slice(1), 16)])),
      palette: (layout.coloresPapu?.colores ?? []).map((c) => c.rol),
    },
    founders: founderSettings(layout),
    everyoneRole: layout.rolesExtra.find((r) => r.todos)?.rol ?? null,
    modRole: layout.rolesExtra.find((r) => r.mod)?.rol ?? null,
    survivorRole: layout.rolesExtra.find((r) => r.sobreviviente) ?? null,
    // Mango9374 (config/mango.json): a su @, los numeros del dia o una frase fija.
    mango: config.mangoToken ? new MangoService(loadMangoSettings()) : null,
    vitrina: vitrinaChannels(layout),
    weddings,
    roulette,
    trivia,
    // Trivia multijugador (Actividad de Discord): Teto aplica la XP de sus aciertos desde la base D1 del worker.
    actividad: actividadFromEnv(process.env, trivia),
    // Celular de Neru (PLAN §3.15): Neru aplica la XP de los retos del dia y deja el perfil de cada Papu en D1.
    celular: trivia ? puenteFromEnv(process.env, { trivia }) : null,
    // Cumpleaños (config/cumpleanos.json): los de los Papus están en D1 (los registran en #tus-roles, con el worker).
    cumple: new CumpleService({ db, query: d1FromEnv(process.env), settings: loadCumpleSettings(), timeZone: config.quotaTimeZone }),
    // Ajedrez del celular de Neru (config/ajedrez.json): Neru cobra y paga las apuestas y avisa en #general.
    ajedrez: (() => {
      const query = d1FromEnv(process.env);
      return query && coins ? new AjedrezPuente({ db, query, coins, settings: loadAjedrezSettings() }) : null;
    })(),
    mundo,
    sorteo,
    peleas,
    carreras,
    nemesis,
    coins,
    mercado,
    intercambios,
    membresias,
    tarjetaWeb: process.env.PAPUS_WEB?.trim() && process.env.TARJETA_CLAVE?.trim() ? { base: process.env.PAPUS_WEB.trim().replace(/\/+$/, ""), clave: process.env.TARJETA_CLAVE.trim() } : null,
    calendar: buildCalendar({ db, env: process.env, deliveryDir: config.deliveryDir, engineDir: config.engineDir }),
    log,
    makeConversation,
    visionMaxMB: visionChain && visionSettings ? visionSettings.maxMB : null,
    makeModeration: (port, exempt) => new ModerationService(new RuleSet(moderationSettings), strikes, phrases, port, exempt),
    makeGeneralChat: (port) =>
      new GeneralChat({
        decks,
        phrases,
        chain,
        queue,
        personas,
        characters,
        port,
        active: () => config.activeBots,
        llm: llmOpts,
        culture: personas.culture(),
        privacy,
        today,
        log,
        drama: dramas
          ? { turnos: dramas.turnos, allowed: () => inHours(clock(new Date(), config.quotaTimeZone).hour, dramas.desde, dramas.hasta) && ambientCounters.get("drama") < dramas.maxDia && Math.random() < dramas.probabilidad, used: () => void ambientCounters.bump("drama") }
          : undefined,
      }),
    makeAmbient: (talker, port) =>
      ambientSettings.activo
        ? new AmbientService({
            db,
            settings: ambientSettings,
            polls: loadPolls(),
            decks,
            talker,
            port,
            active: () => config.activeBots,
            names: Object.fromEntries(BOT_IDS.map((id) => [id, characters[id].displayName])) as Record<BotId, string>,
            timeZone: config.quotaTimeZone,
            log,
          })
        : null,
    makeAdivinanzas: (port) => {
      const settings = loadAdivinanzasSettings();
      if (!settings.activo || !coins) return null;
      const banco = loadBanco();
      const avatars = new Map<BotId, Buffer | null>();
      const service = new AdivinanzasService({
        db,
        settings,
        banco: banco.adivinanzas,
        frases: banco.frases,
        decks,
        port,
        render: { adivinanza: bannerAdivinanza, ganador: bannerGanador, nadie: bannerNadie },
        pagar: (userId, cantidad, motivo) => void coins.adjust(userId, "monedas", cantidad, motivo),
        active: () => config.activeBots,
        names: Object.fromEntries(BOT_IDS.map((id) => [id, characters[id].displayName])) as Record<BotId, string>,
        colors: Object.fromEntries(BOT_IDS.map((id) => [id, `#${characters[id].color.toString(16).padStart(6, "0")}`])) as Record<BotId, string>,
        avatar: (bot) => {
          if (!avatars.has(bot)) avatars.set(bot, existsSync(avatarFile(bot)) ? readFileSync(avatarFile(bot)) : null);
          return avatars.get(bot)!;
        },
        log,
      });
      const aviso = loadLayout().avisosPapu?.avisos.find((a) => a.id === "adivinanzas")?.rol ?? null;
      return { service, rolSabelotodo: settings.semanal.rol, rolAviso: aviso };
    },
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
    imageAllowance?.prune();
    strikes.prune();
    ambientCounters.prune(dayKey(new Date(Date.now() - 7 * 86_400_000), config.quotaTimeZone));
    levels.store.prune(dayKey(new Date(Date.now() - 60 * 86_400_000), config.quotaTimeZone));
  }, 24 * 3_600_000);
}

main().catch((e) => {
  logError("No se pudo arrancar", e);
  process.exit(1);
});
