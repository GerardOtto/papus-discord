// Durable Object del mundo de los Papus (prototipo): una plaza por instancia de la Actividad. Solo reenvia poses, chat
// y aspectos entre los Papus conectados. Usa WebSockets con hibernacion (state.acceptWebSocket) y no tiene reloj: entre
// mensajes el objeto duerme y Cloudflare cobra 1 de cada 20 mensajes entrantes (los salientes no cuentan). Todo el
// estado de cada Papu vive en el "attachment" de su socket, que sobrevive a la hibernacion.
// El chat pasa por las reglas fijas de Neru (regla 3: nunca el LLM). Nada de aqui da XP ni cuota (regla 1).
// Un @ a un Vocaloid de la plaza (@Teto) queda en D1 (mundo_menciones) y lo responde el bot con la misma cuota, cola y
// LLM que en Discord (src/mundo/puente.ts). Mientras haya algo pendiente, una alarma revisa D1 cada 2 s y entrega las
// respuestas como burbujas; sin pendientes no hay alarma y el objeto vuelve a dormir.
// Acciones (/ruleta…, acciones.ts): igual que los @, quedan en D1 (mundo_acciones) y el bot las ejecuta con las reglas
// de Discord. Mientras haya Papus conectados, un latido cada 5 s lee lo que paso en Discord (mundo_eventos: giros de la
// ruleta, "ya tienes una tirada"). La cola de la ruleta grande vive en el almacenamiento del objeto.
import moderacion from "../../../config/moderacion.json";
import { RuleSet, type ModerationSettings } from "../../../src/moderation/rules";
import { identificar } from "../actividad/identidad";
import { ACCION_MIN_MS, ACCION_VENCE_MS, avanzar, COLA_VACIA, esAccion, formar, GIRO_MS, proximoCambio, type ColaRuleta, type Giro, type Resultado, type RuletaGiro } from "./acciones";
import { aparicion, ASPECTO_INICIAL, CHAT_MIN_MS, destino, HISTORIAL, leerPose, limpiarChat, MAX_PAPUS, mencionados, MOV_MIN_MS, moverValido, validarAspecto, ZONAS } from "./juego";
import type { Aspecto, Aviso, PapuPublico, Pedido, Respuesta } from "./tipos";
import { simular } from "./simulado";
import { COOKIE_TOKEN, leerCookie } from "./web";

export interface MundoEnv {
  DB: D1Database;
  GUILD_ID: string;
  ACTIVIDAD_PRUEBA?: string;
  /** Preview aislado: no encola menciones ni acciones que requieren el puente de bots. */
  MUNDO_PREVIEW?: string;
}

/** Lo que guarda cada socket. `id` null = aun no dijo quien es. */
interface Ficha {
  id: string | null;
  papu?: PapuPublico;
  /** Ultimo movimiento y ultimo chat aceptados (ms). */
  movAt: number;
  chatAt: number;
  /** Ultima accion pedida (ms). */
  accionAt?: number;
  sentado?: boolean;
  /** Ultimo perfil (nivel y cuota) que se le mostro. */
  statsAt?: number;
  /** Ultima version de los perfiles publicos enviados a este socket. */
  perfilesAt?: Record<string, number>;
  /** Navegador: token de Discord de la cookie (solo hasta comprobar quien es). */
  token?: string;
}

/** Cada cuanto revisa D1 la alarma mientras espera respuestas o perfiles. */
const REVISION_MS = 2000;
/** Despues de esto deja de esperar una mencion (el bot la descarta igual a los 2 min). */
const ESPERA_MS = 120_000;
/** Con Papus conectados y nada pendiente: cada cuanto mira si paso algo en Discord. */
const LATIDO_MS = 5000;
/** Eventos de Discord mas viejos que esto ya no se muestran (la plaza estaba vacia). */
const EVENTO_VENCE_MS = 120_000;

let reglas: RuleSet | null = null;
const neru = () => (reglas ??= new RuleSet(moderacion as ModerationSettings));

export class SalaMundo implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: MundoEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Se espera un WebSocket", { status: 426 });
    const instancia = new URL(request.url).searchParams.get("instancia");
    if (instancia && !(await this.state.storage.get("sala"))) await this.state.storage.put("sala", instancia);
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    // Desde el navegador ("Entrar con Discord") el token viene en la cookie; desde la Actividad, en el saludo.
    const token = leerCookie(request.headers.get("Cookie"), COOKIE_TOKEN) ?? undefined;
    server.serializeAttachment({ id: null, movAt: 0, chatAt: 0, token } satisfies Ficha);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 2000) return;
    let m: Pedido;
    try {
      m = JSON.parse(raw) as Pedido;
    } catch {
      return;
    }
    const ficha = ws.deserializeAttachment() as Ficha;
    if (!ficha.id || !ficha.papu) {
      if (m.t === "hola") await this.hola(ws, { ...m, token: m.token ?? ficha.token });
      return;
    }
    const papu = ficha.papu;
    const now = Date.now();

    if (m.t === "mov") {
      if (now - ficha.movAt < MOV_MIN_MS) return;
      const pose = leerPose(m as unknown as Record<string, unknown>);
      if (!pose) return;
      if (!moverValido(papu, pose, now - ficha.movAt)) {
        ficha.movAt = now;
        ws.serializeAttachment(ficha);
        return this.enviar(ws, { t: "corrige", x: papu.x, z: papu.z, r: papu.r, a: 0, m: papu.m });
      }
      Object.assign(papu, pose);
      ficha.movAt = now;
      ws.serializeAttachment(ficha);
      return this.todos({ t: "mov", id: papu.id, ...pose }, ws);
    }

    if (m.t === "chat") {
      const texto = limpiarChat(m.texto);
      if (!texto) return;
      if (now - ficha.chatAt < CHAT_MIN_MS) return; // rafaga de un script: se ignora sin aviso
      ficha.chatAt = now;
      ws.serializeAttachment(ficha);
      const r = neru();
      const falta = r.check({ text: texto, targetsSomeone: false, memberAgeHours: 9999 });
      if (falta?.remove) return this.enviar(ws, { t: "aviso", texto: `Neru: ese mensaje no se publica (${falta.detail}). 📵` });
      if (r.selfHarmPhrase(texto)) this.enviar(ws, { t: "aviso", texto: `Neru: no estás solo, Papu. 💛 ${r.settings.lineasDeAyuda ?? ""}`.trim() });
      this.todos({ t: "chat", id: papu.id, texto });
      await this.registrar(papu.id, papu.nombre, null, texto);
      const historial = ((await this.state.storage.get<{ author: string; text: string }[]>("historial")) ?? []).slice(-HISTORIAL);
      const bots = mencionados(texto);
      if (bots.length && this.env.MUNDO_PREVIEW === "1") {
        this.enviar(ws, { t: "aviso", texto: "Los Vocaloids todavía no están conectados en esta versión de pruebas. El chat entre Papus sí funciona. 🌱" });
      } else if (bots.length) await this.mencionar(papu, texto, bots, historial);
      await this.state.storage.put("historial", [...historial, { author: papu.nombre, text: texto }].slice(-HISTORIAL));
      return;
    }

    if (m.t === "tarjeta") {
      if (this.env.MUNDO_PREVIEW !== "1") return this.enviar(ws, { t: "tarjeta", ref: m.ref, papu: m.papu, estado: "error", motivo: "Las tarjetas estarán disponibles en el preview." });
      if (!Number.isSafeInteger(m.ref) || m.ref < 1 || !/^[0-9]{5,25}$/.test(m.papu)) return;
      const compartir = m.compartir === true;
      if (compartir && m.papu !== papu.id) return this.enviar(ws, { t: "tarjeta", ref: m.ref, papu: m.papu, estado: "error", motivo: "Solo puedes compartir tu propia tarjeta." });
      const objetivo = this.conectados().find((c) => c.ficha.papu?.id === m.papu);
      if (!objetivo) return this.enviar(ws, { t: "tarjeta", ref: m.ref, papu: m.papu, estado: "error", motivo: "Ese Papu ya no está conectado a la Plaza." });
      const sala = await this.sala();
      // Una tarjeta fresca se sirve desde D1 en esta misma interacción, sin esperar el polling del puente Node.
      const meta = await this.env.DB.prepare("SELECT mime, actualizado_at FROM mundo_tarjetas WHERE papu_id = ?")
        .bind(m.papu).first<{ mime: string; actualizado_at: number }>();
      if (meta && now - meta.actualizado_at < 60_000) {
        const partes = await this.env.DB.prepare("SELECT datos FROM mundo_tarjeta_partes WHERE papu_id = ? ORDER BY parte")
          .bind(m.papu).all<{ datos: string }>();
        const datos = partes.results.map((p) => p.datos).join("");
        if (datos && datos.length <= 900_000) {
          const aviso: Aviso = compartir
            ? { t: "tarjeta-compartida", ref: m.ref, papu: m.papu, mime: meta.mime, datos }
            : { t: "tarjeta", ref: m.ref, papu: m.papu, estado: "lista", mime: meta.mime, datos };
          if (compartir) this.todos(aviso);
          else this.enviar(ws, aviso);
          return;
        }
      }
      await this.env.DB.prepare("INSERT INTO mundo_tarjeta_pedidos (sala, solicitante_id, papu_id, ref, creado_at) VALUES (?, ?, ?, ?, ?)")
        // ref negativo identifica el broadcast sin cambiar el esquema D1 ni confundir una visita al propio perfil.
        .bind(sala, papu.id, m.papu, compartir ? -m.ref : m.ref, now).run();
      this.enviar(ws, { t: "aviso", texto: "Preparando la tarjeta de nivel… 🪄" });
      return this.programar();
    }

    if (m.t === "accion") {
      // En preview las acciones solo llegan al puente aislado, que debe operar en modo lectura/sandbox.
      if (now - (ficha.accionAt ?? 0) < ACCION_MIN_MS || !esAccion(m.accion) || !Number.isInteger(m.ref)) return;
      ficha.accionAt = now;
      ws.serializeAttachment(ficha);
      const datos = JSON.stringify(m.datos ?? null);
      if (datos.length > 500) return;
      const sala = await this.sala();
      // En el PC (wrangler dev) el bot no lee la base local: la sala hace de bot con datos de ejemplo, y el resultado
      // queda listo en D1 para que siga el mismo camino que en produccion.
      const simulado = this.env.ACTIVIDAD_PRUEBA === "1" && papu.id.startsWith("prueba-") ? JSON.stringify(simular(m.accion, papu)) : null;
      await this.env.DB.prepare("INSERT INTO mundo_acciones (sala, papu_id, papu_nombre, accion, datos, ref, creado_at, tomado, resultado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(sala, papu.id, papu.nombre, m.accion, datos, m.ref, now, simulado ? 2 : 0, simulado)
        .run();
      return this.programar();
    }

    if (m.t === "ir") {
      const pose = destino(m.lugar);
      if (!pose || now - ficha.movAt < MOV_MIN_MS) return;
      Object.assign(papu, pose);
      ficha.movAt = now;
      ws.serializeAttachment(ficha);
      this.enviar(ws, { t: "corrige", ...pose });
      return this.todos({ t: "mov", id: papu.id, ...pose, s: 1 }, ws);
    }

    if (m.t === "sentarse") {
      const fogata = ZONAS.find((z) => z.id === "fogata");
      if (!fogata || Math.hypot(papu.x - fogata.x, papu.z - fogata.z) > 9) {
        return this.enviar(ws, { t: "aviso", texto: "Acércate a la fogata para sentarte junto a los demás. 🔥" });
      }
      ficha.sentado = m.sentado === true;
      ws.serializeAttachment(ficha);
      this.todos({ t: "fogata", id: papu.id, sentado: ficha.sentado });
      return;
    }

    if (m.t === "aspecto") {
      const aspecto = validarAspecto(m.aspecto);
      if (!aspecto) return;
      papu.aspecto = aspecto;
      ws.serializeAttachment(ficha);
      this.todos({ t: "aspecto", id: papu.id, aspecto });
      return this.guardarAspecto(papu.id, aspecto);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.salir(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.salir(ws);
  }

  private async hola(ws: WebSocket, m: Extract<Pedido, { t: "hola" }>): Promise<void> {
    const quien = await identificar(m, this.env, "Este mundo es del servidor de los Papus: entra al servidor para pasear. 🌳");
    if (!quien) return this.enviar(ws, { t: "error", texto: "No pude comprobar quién eres. Cierra y vuelve a abrir la Actividad." });
    if ("motivo" in quien) return this.enviar(ws, { t: "error", texto: quien.motivo });
    // El mismo Papu en otra pestaña: se queda la nueva.
    for (const otro of this.conectados()) {
      if (otro.ficha.papu?.id !== quien.id) continue;
      this.enviar(otro.ws, { t: "error", texto: "Abriste el mundo en otra ventana." });
      otro.ws.serializeAttachment({ id: null, movAt: 0, chatAt: 0 } satisfies Ficha);
      otro.ws.close(4000, "otra ventana");
      this.todos({ t: "sale", id: quien.id }, otro.ws);
    }
    const presentes = this.conectados().map((c) => c.ficha.papu!);
    if (presentes.length >= MAX_PAPUS) return this.enviar(ws, { t: "error", texto: `La plaza está llena (${MAX_PAPUS} Papus). Abre la Actividad en otro canal de voz.` });
    const papu: PapuPublico = { id: quien.id, nombre: quien.nombre, aspecto: validarAspecto(m.aspecto) ?? ASPECTO_INICIAL, ...aparicion() };
    ws.serializeAttachment({ id: quien.id, papu, movAt: Date.now(), chatAt: 0 } satisfies Ficha);
    this.enviar(ws, { t: "bienvenida", yo: quien.id, papus: [...presentes, papu] });
    for (const c of this.conectados()) if (c.ficha.sentado) this.enviar(ws, { t: "fogata", id: c.ficha.papu!.id, sentado: true });
    this.enviar(ws, this.avisoRuleta(await this.ruleta()));
    this.todos({ t: "entra", papu }, ws);
    await this.guardarAspecto(papu.id, papu.aspecto);
    // Su nivel y su cuota del dia: los calcula el bot (src/mundo/puente.ts); si ya habia uno, se muestra de inmediato.
    await this.env.DB.prepare(
      "INSERT INTO mundo_perfiles (papu_id, pedido_at) VALUES (?, ?) ON CONFLICT(papu_id) DO UPDATE SET pedido_at = excluded.pedido_at",
    )
      .bind(quien.id, Date.now())
      .run();
    await this.entregarPerfiles();
    await this.programar();
  }

  /** Como se ve el Papu: el altar y los podios lo muestran asi aunque no este conectado. */
  private async guardarAspecto(papuId: string, aspecto: Aspecto): Promise<void> {
    await this.env.DB.prepare(
      "INSERT INTO mundo_aspectos (papu_id, aspecto, actualizado_at) VALUES (?, ?, ?) ON CONFLICT(papu_id) DO UPDATE SET aspecto = excluded.aspecto, actualizado_at = excluded.actualizado_at",
    )
      .bind(papuId, JSON.stringify(aspecto), Date.now())
      .run()
      .catch((e) => console.error("mundo: aspecto", e));
  }

  /** Registro del chat para #plaza-papus (lo publica el bot). Si D1 falla, el chat sigue igual. */
  private async registrar(papuId: string | null, autor: string, bot: string | null, texto: string): Promise<void> {
    const sala = (await this.state.storage.get<string>("sala")) ?? "plaza";
    await this.env.DB.prepare("INSERT INTO mundo_chat (sala, papu_id, autor, bot, texto, creado_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(sala, papuId, autor, bot, texto, Date.now())
      .run()
      .catch((e) => console.error("mundo: registro del chat", e));
  }

  /** Deja el @ en D1 para que lo responda el bot. */
  private async mencionar(papu: PapuPublico, texto: string, bots: string[], historial: { author: string; text: string }[]): Promise<void> {
    const sala = (await this.state.storage.get<string>("sala")) ?? "plaza";
    await this.env.DB.prepare("INSERT INTO mundo_menciones (sala, papu_id, papu_nombre, texto, bots, historial, creado_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(sala, papu.id, papu.nombre, texto, bots.join(","), JSON.stringify(historial), Date.now())
      .run();
    await this.programar();
  }

  /** Arma la alarma si no hay una. */
  private async programar(): Promise<void> {
    if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + REVISION_MS);
  }

  private async sala(): Promise<string> {
    return (await this.state.storage.get<string>("sala")) ?? "plaza";
  }

  /**
   * Revisa D1 (una consulta para saber que hay y solo despues lo que haga falta): respuestas de los Vocaloids,
   * resultados de acciones, perfiles y eventos de Discord; avanza la ruleta grande. Se vuelve a armar si queda algo
   * pendiente (2 s), si hay Papus conectados (latido de 5 s) o cuando termina el giro de la ruleta.
   */
  async alarm(): Promise<void> {
    const sala = await this.sala();
    const ahora = Date.now();
    const eventoId = await this.ultimoEvento();
    const hay = await this.env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM mundo_respuestas WHERE sala = ?1 AND entregado = 0) AS respuestas,
        (SELECT COUNT(*) FROM mundo_menciones WHERE sala = ?1 AND tomado < 2 AND creado_at > ?2) AS menciones,
        (SELECT COUNT(*) FROM mundo_acciones WHERE sala = ?1 AND tomado = 2 AND entregado = 0) AS listas,
        (SELECT COUNT(*) FROM mundo_acciones WHERE sala = ?1 AND tomado < 2 AND creado_at > ?3) AS acciones,
        (SELECT COUNT(*) FROM mundo_eventos WHERE id > ?4) AS eventos`,
    )
      .bind(sala, ahora - ESPERA_MS, ahora - ACCION_VENCE_MS, eventoId)
      .first<{ respuestas: number; menciones: number; listas: number; acciones: number; eventos: number }>();
    if (hay?.respuestas) await this.entregarRespuestas(sala);
    if (hay?.listas) await this.entregarAcciones(sala);
    if (hay?.eventos) await this.leerEventos(eventoId);
    const tarjetas = this.env.MUNDO_PREVIEW === "1"
      ? await this.env.DB.prepare("SELECT COUNT(*) AS cantidad FROM mundo_tarjeta_pedidos WHERE sala = ? AND (estado = 0 OR (estado > 0 AND entregado = 0))").bind(sala).first<{ cantidad: number }>()
      : null;
    if (tarjetas?.cantidad) await this.entregarTarjetas(sala);
    await this.moverRuleta();
    const perfiles = await this.entregarPerfiles();
    const pendiente = (hay?.menciones ?? 0) + (hay?.acciones ?? 0) + (tarjetas?.cantidad ?? 0) + perfiles > 0;
    const cuando = [pendiente ? ahora + REVISION_MS : null, this.conectados().length ? ahora + LATIDO_MS : null, proximoCambio(await this.ruleta())].filter(
      (x): x is number => x !== null,
    );
    if (cuando.length) await this.state.storage.setAlarm(Math.max(ahora + 250, Math.min(...cuando)));
  }

  /** Respuestas de los Vocaloids a los @. */
  private async entregarRespuestas(sala: string): Promise<void> {
    const { results } = await this.env.DB.prepare("SELECT id, papu_id, bot, tipo, texto FROM mundo_respuestas WHERE sala = ? AND entregado = 0 ORDER BY id LIMIT 50")
      .bind(sala)
      .all<{ id: number; papu_id: string; bot: string; tipo: Respuesta["tipo"]; texto: string }>();
    if (results.length) {
      await this.env.DB.prepare(`UPDATE mundo_respuestas SET entregado = 1 WHERE id IN (${results.map(() => "?").join(",")})`)
        .bind(...results.map((r) => r.id))
        .run();
      for (const r of results) {
        // Los avisos (modo de prueba) solo los ve quien hablo; lo demas lo ve toda la plaza.
        const a: Aviso = { t: "vocaloid", bot: r.bot, tipo: r.tipo, texto: r.texto, papu: r.papu_id };
        if (r.tipo !== "aviso") this.todos(a);
        else for (const c of this.conectados()) if (c.ficha.papu?.id === r.papu_id) this.enviar(c.ws, a);
        if (r.tipo === "texto") await this.registrar(null, r.bot, r.bot, r.texto);
      }
    }
  }

  /** Resultados de las acciones: al Papu que las pidio. Un giro de la ruleta ademas entra a la fila de la ruleta grande. */
  private async entregarAcciones(sala: string): Promise<void> {
    const { results } = await this.env.DB.prepare(
      "UPDATE mundo_acciones SET entregado = 1 WHERE id IN (SELECT id FROM mundo_acciones WHERE sala = ? AND tomado = 2 AND entregado = 0 ORDER BY id LIMIT 50) RETURNING id, papu_id, papu_nombre, accion, ref, resultado",
    )
      .bind(sala)
      .all<{ id: number; papu_id: string; papu_nombre: string; accion: string; ref: number; resultado: string | null }>();
    for (const r of results.sort((a, b) => a.id - b.id)) {
      if (!esAccion(r.accion)) continue;
      let resultado: Resultado;
      try {
        resultado = JSON.parse(r.resultado ?? "null") as Resultado;
        if (!resultado || typeof resultado.ok !== "boolean") throw new Error("sin resultado");
      } catch {
        resultado = { ok: false, motivo: "No me llegó la respuesta. Inténtalo de nuevo." };
      }
      if (r.accion === "ruleta.girar" && resultado.ok) {
        const g = resultado.datos as RuletaGiro;
        await this.girar({ ...g.giro, papu: r.papu_id, nombre: r.papu_nombre, origen: "plaza" });
        await this.registrar(null, "teto", "teto", `🎰 ${r.papu_nombre} giró la ruleta grande: ${g.texto}`);
      }
      for (const c of this.conectados()) if (c.ficha.papu?.id === r.papu_id) this.enviar(c.ws, { t: "accion", ref: r.ref, accion: r.accion, resultado });
    }
  }

  /** Entrega las tarjetas ya generadas por el puente. Solo al Papu que las solicitó. */
  private async entregarTarjetas(sala: string): Promise<void> {
    await this.env.DB.prepare("UPDATE mundo_tarjeta_pedidos SET estado = 2 WHERE sala = ? AND estado = 0 AND creado_at < ?").bind(sala, Date.now() - 30_000).run();
    const { results } = await this.env.DB.prepare(
      "SELECT id, solicitante_id, papu_id, ref, estado, creado_at FROM mundo_tarjeta_pedidos WHERE sala = ? AND entregado = 0 AND estado > 0 ORDER BY id LIMIT 10",
    ).bind(sala).all<{ id: number; solicitante_id: string; papu_id: string; ref: number; estado: number; creado_at: number }>();
    for (const pedido of results) {
      const compartida = pedido.ref < 0;
      const ref = Math.abs(pedido.ref);
      const cliente = this.conectados().find((c) => c.ficha.papu?.id === pedido.solicitante_id);
      if (!cliente && !compartida) {
        if (Date.now() - pedido.creado_at > 60_000) await this.env.DB.prepare("UPDATE mundo_tarjeta_pedidos SET entregado = 1 WHERE id = ?").bind(pedido.id).run();
        continue;
      }
      if (pedido.estado === 2) {
        if (cliente) this.enviar(cliente.ws, { t: "tarjeta", ref, papu: pedido.papu_id, estado: "error", motivo: "No pude generar la tarjeta. Inténtalo de nuevo en un momento." });
      } else {
        const meta = await this.env.DB.prepare("SELECT mime FROM mundo_tarjetas WHERE papu_id = ?").bind(pedido.papu_id).first<{ mime: string }>();
        const partes = await this.env.DB.prepare("SELECT datos FROM mundo_tarjeta_partes WHERE papu_id = ? ORDER BY parte").bind(pedido.papu_id).all<{ datos: string }>();
        const datos = partes.results.map((p) => p.datos).join("");
        if (!meta || !datos || datos.length > 900_000) {
          if (cliente) this.enviar(cliente.ws, { t: "tarjeta", ref, papu: pedido.papu_id, estado: "error", motivo: "La tarjeta todavía no está disponible. Inténtalo de nuevo." });
        } else if (compartida) {
          this.todos({ t: "tarjeta-compartida", ref, papu: pedido.papu_id, mime: meta.mime, datos });
        } else if (cliente) {
          this.enviar(cliente.ws, { t: "tarjeta", ref, papu: pedido.papu_id, estado: "lista", mime: meta.mime, datos });
        }
      }
      await this.env.DB.prepare("UPDATE mundo_tarjeta_pedidos SET entregado = 1 WHERE id = ?").bind(pedido.id).run();
    }
  }

  /** Id del ultimo evento de Discord visto (la primera vez, el mas nuevo: los de antes no se muestran). */
  private async ultimoEvento(): Promise<number> {
    const visto = await this.state.storage.get<number>("evento");
    if (visto !== undefined) return visto;
    const fila = await this.env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM mundo_eventos").first<{ id: number }>();
    await this.state.storage.put("evento", fila?.id ?? 0);
    return fila?.id ?? 0;
  }

  /** Lo que paso en Discord: giros de la ruleta (a la fila de la ruleta grande) y avisos para un Papu. */
  private async leerEventos(desde: number): Promise<void> {
    const { results } = await this.env.DB.prepare("SELECT id, papu_id, tipo, datos, creado_at FROM mundo_eventos WHERE id > ? ORDER BY id LIMIT 50")
      .bind(desde)
      .all<{ id: number; papu_id: string | null; tipo: string; datos: string; creado_at: number }>();
    if (!results.length) return;
    await this.state.storage.put("evento", results[results.length - 1]!.id);
    const viejo = Date.now() - EVENTO_VENCE_MS;
    for (const e of results) {
      if (e.creado_at < viejo) continue;
      let datos: Record<string, unknown>;
      try {
        datos = JSON.parse(e.datos) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (e.tipo === "ruleta") await this.girar({ ...(datos as unknown as Giro), origen: "discord" });
      else if (e.tipo === "aviso" && e.papu_id && typeof datos.texto === "string") {
        for (const c of this.conectados()) if (c.ficha.papu?.id === e.papu_id) this.enviar(c.ws, { t: "aviso", texto: datos.texto });
      }
    }
  }

  // ───────────────────────── ruleta grande ─────────────────────────

  private async ruleta(): Promise<ColaRuleta> {
    return (await this.state.storage.get<ColaRuleta>("ruleta")) ?? COLA_VACIA;
  }

  private avisoRuleta(c: ColaRuleta): Aviso {
    const ahora = Date.now();
    const { actual, cola } = avanzar(c, ahora);
    if (!actual) return { t: "ruleta", actual: null, cola: [] };
    const { inicio, ...giro } = actual;
    return {
      t: "ruleta",
      actual: { ...giro, restanteMs: Math.max(0, inicio + GIRO_MS - ahora) },
      cola: cola.map(({ papu, nombre, origen }) => ({ papu, nombre, origen })),
    };
  }

  /** Un giro nuevo a la fila (o a girar ya, si esta libre); todos ven el cambio. */
  private async girar(g: Giro): Promise<void> {
    const c = formar(await this.ruleta(), g, Date.now());
    await this.state.storage.put("ruleta", c);
    this.todos(this.avisoRuleta(c));
    await this.programar();
  }

  /** Termina el giro que ya cumplio su tiempo y pasa al siguiente (todos ven el cambio). */
  private async moverRuleta(): Promise<void> {
    const antes = await this.ruleta();
    const c = avanzar(antes, Date.now());
    if (c === antes) return;
    await this.state.storage.put("ruleta", c);
    this.todos(this.avisoRuleta(c));
  }

  /** Manda a cada Papu su perfil si hay uno mas nuevo que el que vio. Devuelve cuantos pedidos siguen sin respuesta. */
  private async entregarPerfiles(): Promise<number> {
    const conectados = this.conectados();
    const ids = [...new Set(conectados.map((c) => c.ficha.papu!.id))];
    if (!ids.length) return 0;
    const { results } = await this.env.DB.prepare(
      `SELECT papu_id, nivel, prestigio, restante, limite, ruletas, pedido_at, actualizado_at FROM mundo_perfiles WHERE papu_id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<{ papu_id: string; nivel: number; prestigio: number; restante: number | null; limite: number | null; ruletas: number; pedido_at: number; actualizado_at: number }>();
    let pendientes = 0;
    const reciente = Date.now() - 60_000;
    for (const p of results) {
      if (p.pedido_at >= p.actualizado_at && p.pedido_at > reciente) pendientes++;
      if (!p.actualizado_at) continue;
      for (const c of conectados) {
        c.ficha.perfilesAt ??= {};
        if ((c.ficha.perfilesAt[p.papu_id] ?? 0) < p.actualizado_at) {
          c.ficha.perfilesAt[p.papu_id] = p.actualizado_at;
          c.ws.serializeAttachment(c.ficha);
          this.enviar(c.ws, { t: "perfil", id: p.papu_id, nivel: p.nivel, prestigio: p.prestigio });
        }
        if (c.ficha.papu!.id === p.papu_id && (c.ficha.statsAt ?? 0) < p.actualizado_at) {
          c.ficha.statsAt = p.actualizado_at;
          c.ws.serializeAttachment(c.ficha);
          // Cuota y tiradas solo se envian al propio Papu.
          this.enviar(c.ws, { t: "stats", nivel: p.nivel, prestigio: p.prestigio, restante: p.restante, limite: p.limite, ruletas: p.ruletas ?? 0 });
        }
      }
    }
    return pendientes;
  }

  private salir(ws: WebSocket): void {
    const ficha = ws.deserializeAttachment() as Ficha | null;
    if (!ficha?.id) return;
    if (ficha.sentado) this.todos({ t: "fogata", id: ficha.id, sentado: false }, ws);
    ws.serializeAttachment({ id: null, movAt: 0, chatAt: 0 } satisfies Ficha);
    this.todos({ t: "sale", id: ficha.id }, ws);
  }

  /** Sockets con un Papu ya identificado. */
  private conectados(): { ws: WebSocket; ficha: Ficha }[] {
    return this.state
      .getWebSockets()
      .map((ws) => ({ ws, ficha: ws.deserializeAttachment() as Ficha }))
      .filter((c) => c.ficha?.id && c.ficha.papu);
  }

  private todos(a: Aviso, menos?: WebSocket): void {
    const data = JSON.stringify(a);
    for (const { ws } of this.conectados()) if (ws !== menos) this.mandar(ws, data);
  }

  private enviar(ws: WebSocket, a: Aviso): void {
    this.mandar(ws, JSON.stringify(a));
  }

  private mandar(ws: WebSocket, data: string): void {
    try {
      ws.send(data);
    } catch {
      // Socket cerrado: lo limpia webSocketClose.
    }
  }
}
