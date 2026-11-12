// Puente entre el mundo de los Papus (prototipo de Actividad 3D, worker/src/mundo/) y los Vocaloids. La plaza deja
// en la base D1 del worker cada @ a un Vocaloid y pide el nivel y la cuota de quien entra; Teto, cada pocos segundos:
// 1) toma los @ nuevos y los responde con el MISMO servicio de conversacion que en Discord (misma cuota diaria
//    compartida, misma cola y misma cadena de LLM: reglas 1, 4 y 5). Lo que diria en Discord (respuesta, "escribiendo",
//    reaccion de cuota agotada o de espera) queda en mundo_respuestas y la plaza lo muestra como burbuja;
// 2) deja en mundo_perfiles el nivel y la cuota restante de los Papus que lo pidieron (y de quien acaba de hablar).
// 3) ejecuta las acciones de la plaza (/ruleta…, worker/src/mundo/acciones.ts) con las mismas reglas que en Discord;
// 4) deja en mundo_eventos lo que pasa en Discord y la plaza muestra (giros de la ruleta, "ya tienes una tirada").
// Las menciones y acciones quedan marcadas antes de atenderlas: nunca se atienden (ni se cobran) dos veces.
// Para gastar poco de la API de Cloudflare, cada vuelta empieza con una sola consulta que dice que hay pendiente.
import path from "node:path";
import type { BotId } from "../config";
import { d1Client, workerDatabaseId, type D1Query } from "../cloud/d1";
import type { HistoryLine } from "../llm/prompt";
import type {
  ChatPort,
  ConversationOutcome,
  ConversationService,
} from "../services/conversation";
import {
  ACCION_VENCE_MS,
  esAccion,
  type Accion,
  type Resultado,
} from "../../worker/src/mundo/acciones";
import { huella, type EstadoMundo } from "./estado";

/** Menciones por vuelta (las demas quedan para la siguiente). */
const LOTE = 10;
/** Mensajes del chat por vuelta para #plaza-papus. */
const LOTE_CHAT = 60;
/** Cada cuanto se revisa la foto del servidor para la plaza. */
const ESTADO_MS = 5_000;
/** Acciones por vuelta. */
const LOTE_ACCIONES = 10;
/** Cada cuanto se borran los eventos y acciones viejos (de mas de un dia). */
const LIMPIEZA_MS = 3_600_000;
const DIA_MS = 86_400_000;

/** Quien pide una accion en la plaza. */
export interface PapuPlaza {
  id: string;
  nombre: string;
}

/** Atiende una accion de la plaza (lo conecta Discord: ruleta…). Devuelve lo que ve el Papu. */
export type Atender = (
  papu: PapuPlaza,
  datos: unknown,
) => Promise<Resultado> | Resultado;

/** Un mensaje del chat de la plaza (de un Papu, o la respuesta de un Vocaloid con `bot`). */
export interface LineaChat {
  id: number;
  papu_id: string | null;
  autor: string;
  bot: string | null;
  texto: string;
  creado_at: number;
}

/**
 * Lineas para #plaza-papus: "<@id>: texto" (Discord muestra el nombre del Papu, sin avisarle: se envia sin menciones)
 * y "**Teto**: texto" para los Vocaloids. Sin markdown ni menciones del texto original (no puede pingear ni dar formato).
 */
export function lineasRegistro(
  lineas: LineaChat[],
  nombreBot: (bot: string) => string,
): string[] {
  const limpio = (t: string) =>
    t
      .replace(/([\\*_~`|>#-])/g, "\\$1")
      .replace(/@/g, "@\u200b")
      .replace(/https?:\/\//g, (m) => m.replace("//", "/\u200b/"));
  return lineas.map((l) => {
    const quien = l.bot
      ? `**${nombreBot(l.bot)}**`
      : /^\d{5,25}$/.test(l.papu_id ?? "")
        ? `<@${l.papu_id}>`
        : `**${limpio(l.autor)}**`;
    return `${quien}: ${limpio(l.texto)}`;
  });
}

/** Junta lineas en mensajes de hasta `max` caracteres (una linea mas larga se corta). */
export function agruparLineas(lineas: string[], max: number): string[] {
  const out: string[] = [];
  let actual = "";
  for (const l of lineas.map((x) => x.slice(0, max))) {
    if (actual && actual.length + 1 + l.length > max) {
      out.push(actual);
      actual = "";
    }
    actual = actual ? `${actual}\n${l}` : l;
  }
  if (actual) out.push(actual);
  return out;
}

/** Una mencion mas vieja que esto ya no se responde (la plaza dejo de esperarla). */
const VENCE_MS = 120_000;

export interface MundoStats {
  nivel: number;
  prestigio: number;
  /** null = sin limite (GyroP y el regalo de config/especiales.json). */
  restante: number | null;
  limite: number | null;
  /** Tiradas de la ruleta que le quedan hoy. */
  ruletas: number;
}

export interface MundoDeps {
  query: D1Query;
  /** Mismo armado que en Discord (cuota, cola, LLM, privacidad, notas de bodas y especiales). */
  makeConversation: (port: ChatPort) => ConversationService;
  /** Vocaloids conectados (los demas no responden en la plaza). */
  bots: readonly BotId[];
  owners: Pick<ReadonlySet<string>, "has">;
  stats: (papuId: string) => MundoStats;
  /** Renderiza la misma tarjeta de /nivel, sin cuota privada. */
  tarjetaPublica?: (papuId: string) => Promise<{ data: Buffer; gif: boolean } | null>;
  now?: () => number;
  log?: (msg: string) => void;
}

interface Mencion {
  id: number;
  sala: string;
  papu_id: string;
  papu_nombre: string;
  texto: string;
  bots: string;
  historial: string;
  creado_at: number;
}

export class MundoPuente {
  private readonly now: () => number;
  private readonly conversation: ConversationService;
  /** Menciones que se estan respondiendo ("m<id>" -> datos), para que el puerto sepa a que plaza y Papu va cada cosa. */
  private readonly enCurso = new Map<string, Mencion>();
  private readonly tareas = new Set<Promise<void>>();
  /** Le respondio al menos un Vocaloid: la misma XP que un @ respondido en Discord. Lo conecta Discord. */
  onAnswered: ((papuId: string, text: string) => Promise<void>) | null = null;
  /** Mensajes nuevos del chat de la plaza, para el registro de #plaza-papus. Lo conecta Discord. */
  onChat: ((lineas: LineaChat[]) => Promise<void>) | null = null;
  /** Arma la foto del servidor para las zonas de la plaza (boda, pelea, mercado, fama, sorteo). Lo conecta Discord. */
  estado: (() => EstadoMundo) | null = null;
  /** Acciones de la plaza que sabe atender el bot (las demas responden "aun no"). Las conecta Discord. */
  acciones: Partial<Record<Accion, Atender>> = {};
  /** Renderizador público de /nivel; el bot principal lo conecta al arrancar. */
  tarjetaPublica: MundoDeps["tarjetaPublica"];
  private estadoAt = 0;
  private estadoHuella = "";
  private limpiezaAt = 0;

  constructor(private readonly d: MundoDeps) {
    this.now = d.now ?? Date.now;
    this.tarjetaPublica = d.tarjetaPublica;
    this.conversation = d.makeConversation(this.port());
  }

  /**
   * Una vuelta: una consulta dice que hay pendiente y solo entonces se toma: menciones (se responden en segundo
   * plano), acciones, perfiles pedidos y chat para #plaza-papus. Ademas la foto del servidor cada minuto.
   */
  async sync(): Promise<number> {
    const corteAcciones = this.now() - ACCION_VENCE_MS;
    const [hay] = await this.d.query<{
      menciones: number;
      acciones: number;
      accionesInterrumpidas: number;
      perfiles: number;
      chat: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM mundo_menciones WHERE tomado = 0) AS menciones,
        (SELECT COUNT(*) FROM mundo_acciones WHERE tomado = 0) AS acciones,
        (SELECT COUNT(*) FROM mundo_acciones WHERE tomado = 1 AND creado_at <= ?) AS accionesInterrumpidas,
        (SELECT COUNT(*) FROM mundo_perfiles WHERE pedido_at >= actualizado_at) AS perfiles,
        (SELECT COUNT(*) FROM mundo_chat WHERE publicado = 0) AS chat`,
      corteAcciones,
    );
    // Si el proceso se reinició después de reclamar una acción, no puede quedar
    // pendiente para siempre. No se reejecuta a ciegas: el ledger pudo confirmarla
    // antes de la caída, así que se devuelve un resultado de recuperación explícito.
    if (hay?.accionesInterrumpidas) {
      await this.d.query(
        "UPDATE mundo_acciones SET tomado = 2, resultado = ? WHERE tomado = 1 AND creado_at <= ?",
        JSON.stringify({ ok: false, motivo: "La acción se interrumpió antes de confirmar su respuesta. Revisa tu progreso antes de repetirla." }),
        corteAcciones,
      );
    }
    let rows: Mencion[] = [];
    if (hay?.menciones) {
      rows = await this.d.query<Mencion>(
        `UPDATE mundo_menciones SET tomado = 1 WHERE id IN (SELECT id FROM mundo_menciones WHERE tomado = 0 ORDER BY id LIMIT ${LOTE}) RETURNING id, sala, papu_id, papu_nombre, texto, bots, historial, creado_at`,
      );
      for (const m of rows.sort((a, b) => a.id - b.id)) {
        const t = this.atender(m).catch((e) =>
          this.d.log?.(
            `✘ mundo: mención ${m.id}: ${(e as Error)?.message ?? e}`,
          ),
        );
        this.tareas.add(t);
        void t.finally(() => this.tareas.delete(t));
      }
    }
    if (hay?.acciones) await this.tomarAcciones();
    if (hay?.perfiles) {
      const pedidos = await this.d.query<{ papu_id: string }>(
        "SELECT papu_id FROM mundo_perfiles WHERE pedido_at >= actualizado_at LIMIT 50",
      );
      for (const p of pedidos) await this.guardarPerfil(p.papu_id);
    }
    if (hay?.chat) await this.registro();
    if (this.tarjetaPublica) {
      const [pendientes] = await this.d.query<{ total: number }>("SELECT COUNT(*) AS total FROM mundo_tarjeta_pedidos WHERE estado = 0");
      if (pendientes?.total) await this.generarTarjetas();
    }
    await this.publicarEstado();
    await this.limpiar();
    return rows.length;
  }

  /** Acciones de la plaza (/ruleta…): se marcan tomadas, se atienden en orden y se deja el resultado. */
  private async tomarAcciones(): Promise<void> {
    const filas = await this.d.query<{
      id: number;
      papu_id: string;
      papu_nombre: string;
      accion: string;
      datos: string;
      creado_at: number;
    }>(
      `UPDATE mundo_acciones SET tomado = 1 WHERE id IN (SELECT id FROM mundo_acciones WHERE tomado = 0 ORDER BY id LIMIT ${LOTE_ACCIONES}) RETURNING id, papu_id, papu_nombre, accion, datos, creado_at`,
    );
    for (const f of filas.sort((a, b) => a.id - b.id)) {
      let r: Resultado;
      const atender = esAccion(f.accion) ? this.acciones[f.accion] : undefined;
      if (this.now() - f.creado_at > ACCION_VENCE_MS)
        r = { ok: false, motivo: "Tardé demasiado: inténtalo de nuevo." };
      // Las tiradas, monedas, etc. son de Papus de Discord: en `wrangler dev` (Papus de prueba) no hay de quien.
      else if (!/^\d{5,25}$/.test(f.papu_id))
        r = {
          ok: false,
          motivo:
            "En el modo de prueba no hay ruleta ni tienda: son de tu cuenta de Discord.",
        };
      else if (!atender)
        r = { ok: false, motivo: "Eso todavía no se puede hacer en la plaza." };
      else {
        let datos: unknown = null;
        try {
          datos = JSON.parse(f.datos);
        } catch {
          // datos ilegibles: la accion decide con null
        }
        r = await Promise.resolve()
          .then(() => atender({ id: f.papu_id, nombre: f.papu_nombre }, datos))
          .catch((e) => {
            this.d.log?.(
              `✘ mundo: acción ${f.accion} de ${f.papu_id}: ${(e as Error)?.message ?? e}`,
            );
            return {
              ok: false as const,
              motivo:
                "Algo falló en el servidor. Inténtalo de nuevo en un rato.",
            };
          });
      }
      await this.d.query(
        "UPDATE mundo_acciones SET tomado = 2, resultado = ? WHERE id = ?",
        JSON.stringify(r),
        f.id,
      );
      if (r.ok) await this.guardarPerfil(f.papu_id).catch(() => {});
    }
  }

  /**
   * Algo que paso en Discord y la plaza muestra: un giro de la ruleta (todas las plazas) o un aviso para un Papu. Si
   * Cloudflare no responde se pierde (la plaza es un espejo, no la fuente de verdad).
   */
  async evento(
    tipo: "ruleta" | "aviso",
    datos: unknown,
    papuId: string | null = null,
  ): Promise<void> {
    await this.d
      .query(
        "INSERT INTO mundo_eventos (papu_id, tipo, datos, creado_at) VALUES (?, ?, ?, ?)",
        papuId,
        tipo,
        JSON.stringify(datos),
        this.now(),
      )
      .catch((e) =>
        this.d.log?.(`✘ mundo: evento ${tipo}: ${(e as Error)?.message ?? e}`),
      );
    // Un aviso suele venir con cambios en su perfil (una tirada mas): la plaza lo actualiza.
    if (papuId) await this.guardarPerfil(papuId).catch(() => {});
  }

  /** Cada hora: borra eventos y acciones de mas de un dia (y menciones y respuestas ya atendidas). */
  private async limpiar(): Promise<void> {
    if (this.now() - this.limpiezaAt < LIMPIEZA_MS) return;
    this.limpiezaAt = this.now();
    const viejo = this.now() - DIA_MS;
    await this.d.query("DELETE FROM mundo_eventos WHERE creado_at < ?", viejo);
    await this.d.query("DELETE FROM mundo_acciones WHERE creado_at < ?", viejo);
    if (this.d.tarjetaPublica) {
      await this.d.query("DELETE FROM mundo_tarjeta_pedidos WHERE creado_at < ? AND entregado = 1", viejo);
      const tarjetasViejas = this.now() - 7 * DIA_MS;
      await this.d.query("DELETE FROM mundo_tarjeta_partes WHERE papu_id IN (SELECT papu_id FROM mundo_tarjetas WHERE actualizado_at < ?)", tarjetasViejas);
      await this.d.query("DELETE FROM mundo_tarjetas WHERE actualizado_at < ?", tarjetasViejas);
    }
  }

  /** Cada cinco segundos: publica cambios del servidor, solo si cambió el contenido. */
  private async publicarEstado(): Promise<void> {
    if (!this.estado || this.now() - this.estadoAt < ESTADO_MS) return;
    this.estadoAt = this.now();
    const e = this.estado();
    const h = huella(e);
    if (h === this.estadoHuella) return;
    await this.d.query(
      "INSERT INTO mundo_estado (clave, valor, actualizado_at) VALUES ('servidor', ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_at = excluded.actualizado_at",
      JSON.stringify(e),
      e.at,
    );
    this.estadoHuella = h;
  }

  /** Publica en #plaza-papus el chat nuevo (sin conexion a Discord, queda en la base hasta la proxima vuelta). */
  private async registro(): Promise<void> {
    if (!this.onChat) return;
    const lineas = await this.d.query<LineaChat>(
      `UPDATE mundo_chat SET publicado = 1 WHERE id IN (SELECT id FROM mundo_chat WHERE publicado = 0 ORDER BY id LIMIT ${LOTE_CHAT}) RETURNING id, papu_id, autor, bot, texto, creado_at`,
    );
    if (lineas.length) await this.onChat(lineas.sort((a, b) => a.id - b.id));
  }

  /** Espera a que terminen las respuestas en curso (pruebas y cierre ordenado). */
  async esperar(): Promise<void> {
    while (this.tareas.size) await Promise.all([...this.tareas]);
  }

  private async atender(m: Mencion): Promise<void> {
    try {
      const bots = m.bots
        .split(",")
        .filter((b): b is BotId =>
          (this.d.bots as readonly string[]).includes(b),
        );
      if (!bots.length || this.now() - m.creado_at > VENCE_MS) return;
      // Las cuotas son de Papus de Discord: en `wrangler dev` (Papus de prueba) no hay a quien cobrar.
      if (!/^\d{5,25}$/.test(m.papu_id)) {
        await this.responder(
          m,
          bots[0]!,
          "aviso",
          "En el modo de prueba los Vocaloids no responden: la cuota es de tu cuenta de Discord.",
        );
        return;
      }
      this.enCurso.set(`m${m.id}`, m);
      const outcome: ConversationOutcome = await this.conversation.handle({
        // El "canal" es la propia mencion: asi la respuesta, el "escribiendo" y las reacciones saben a quien van.
        messageId: `m${m.id}`,
        channelId: `m${m.id}`,
        authorId: m.papu_id,
        authorName: m.papu_nombre,
        fromOwner: this.d.owners.has(m.papu_id),
        text: m.texto,
        bots,
        history: async () => historial(m.historial),
      });
      if ((outcome === "answered" || outcome === "partial") && this.onAnswered)
        await this.onAnswered(m.papu_id, m.texto).catch(() => {});
    } finally {
      this.enCurso.delete(`m${m.id}`);
      await this.d.query(
        "UPDATE mundo_menciones SET tomado = 2 WHERE id = ?",
        m.id,
      );
      await this.guardarPerfil(m.papu_id).catch(() => {});
    }
  }

  private port(): ChatPort {
    const de = (channelId: string) => {
      const m = this.enCurso.get(channelId);
      if (!m) throw new Error(`mención ${channelId} sin plaza`);
      return m;
    };
    return {
      reply: async (bot, channelId, _replyTo, content) => {
        const m = de(channelId);
        await this.responder(
          m,
          bot,
          "texto",
          aTextoPlano(content, m.papu_id, m.papu_nombre),
        );
      },
      typing: (bot, channelId) => {
        // Un solo aviso: en la plaza la burbuja de "escribiendo" dura hasta que llega la respuesta.
        const m = this.enCurso.get(channelId);
        if (m) void this.responder(m, bot, "escribiendo", "").catch(() => {});
        return () => {};
      },
      react: async (bot, channelId, _messageId, emoji) => {
        await this.responder(de(channelId), bot, "reaccion", emoji);
      },
    };
  }

  private async responder(
    m: Mencion,
    bot: BotId,
    tipo: "texto" | "escribiendo" | "reaccion" | "aviso",
    texto: string,
  ): Promise<void> {
    await this.d.query(
      "INSERT INTO mundo_respuestas (sala, mencion_id, papu_id, bot, tipo, texto, creado_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      m.sala,
      m.id,
      m.papu_id,
      bot,
      tipo,
      texto.slice(0, 600),
      this.now(),
    );
  }

  /** Genera tarjetas solo bajo demanda y las guarda en el D1 de esta instancia (preview o producción). */
  private async generarTarjetas(): Promise<void> {
    const pedidos = await this.d.query<{ papu_id: string }>(
      "SELECT DISTINCT papu_id FROM mundo_tarjeta_pedidos WHERE estado = 0 ORDER BY papu_id LIMIT 10",
    );
    for (const { papu_id } of pedidos) {
      try {
        const [cache] = await this.d.query<{ actualizado_at: number }>(
          "SELECT actualizado_at FROM mundo_tarjetas WHERE papu_id = ?",
          papu_id,
        );
        if (cache && this.now() - cache.actualizado_at < 60_000) {
          await this.d.query("UPDATE mundo_tarjeta_pedidos SET estado = 1 WHERE papu_id = ? AND estado = 0", papu_id);
          continue;
        }
        if (!this.tarjetaPublica) throw new Error("El renderizador de tarjetas no está conectado.");
        const card = await this.tarjetaPublica(papu_id);
        if (!card?.data?.length) throw new Error("No se pudo generar la tarjeta.");
        if (card.data.length > 600_000) throw new Error("La tarjeta supera el tamaño permitido para la Plaza.");
        const encoded = card.data.toString("base64");
        const partes = encoded.match(/.{1,16000}/g) ?? [];
        await this.d.query("DELETE FROM mundo_tarjetas WHERE papu_id = ?", papu_id);
        await this.d.query("DELETE FROM mundo_tarjeta_partes WHERE papu_id = ?", papu_id);
        for (let i = 0; i < partes.length; i++) {
          await this.d.query(
            "INSERT INTO mundo_tarjeta_partes (papu_id, parte, datos) VALUES (?, ?, ?)",
            papu_id, i, partes[i]!,
          );
        }
        await this.d.query(
          "INSERT INTO mundo_tarjetas (papu_id, mime, actualizado_at) VALUES (?, ?, ?) ON CONFLICT(papu_id) DO UPDATE SET mime = excluded.mime, actualizado_at = excluded.actualizado_at",
          papu_id, card.gif ? "image/gif" : "image/png", this.now(),
        );
        await this.d.query("UPDATE mundo_tarjeta_pedidos SET estado = 1 WHERE papu_id = ? AND estado = 0", papu_id);
      } catch (e) {
        this.d.log?.(`✘ mundo: tarjeta de ${papu_id}: ${(e as Error)?.message ?? e}`);
        await this.d.query("UPDATE mundo_tarjeta_pedidos SET estado = 2 WHERE papu_id = ? AND estado = 0", papu_id).catch(() => {});
      }
    }
  }

  private async guardarPerfil(papuId: string): Promise<void> {
    const s = /^\d{5,25}$/.test(papuId)
      ? this.d.stats(papuId)
      : { nivel: 1, prestigio: 0, restante: 0, limite: 0, ruletas: 0 };
    await this.d.query(
      "INSERT INTO mundo_perfiles (papu_id, nivel, prestigio, restante, limite, ruletas, pedido_at, actualizado_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(papu_id) DO UPDATE SET nivel = excluded.nivel, prestigio = excluded.prestigio, restante = excluded.restante, limite = excluded.limite, ruletas = excluded.ruletas, actualizado_at = excluded.actualizado_at",
      papuId,
      s.nivel,
      s.prestigio,
      s.restante,
      s.limite,
      s.ruletas,
      this.now() + 1,
    );
  }
}

function historial(json: string): HistoryLine[] {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (l): l is HistoryLine =>
          !!l && typeof l.author === "string" && typeof l.text === "string",
      )
      .slice(-12)
      .map((l) => ({
        author: l.author.slice(0, 40),
        text: l.text.slice(0, 200),
      }));
  } catch {
    return [];
  }
}

/**
 * Lo que un Vocaloid publicaria en Discord, como texto para una burbuja: la mencion al Papu como "@Nombre", emojis
 * del servidor como :nombre:, sin negritas ni subtextos.
 */
export function aTextoPlano(
  content: string,
  papuId: string,
  papuNombre: string,
): string {
  return content
    .replace(/<@!?(\d+)>/g, (_, id: string) =>
      id === papuId ? `@${papuNombre}` : "@Papu",
    )
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<#\d+>/g, "#canal")
    .replace(/^-# /gm, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** null si falta el token de Cloudflare o el worker no esta desplegado: los Vocaloids no responden en la plaza. */
export function mundoFromEnv(
  env: NodeJS.ProcessEnv,
  deps: Omit<MundoDeps, "query">,
  root = path.resolve(import.meta.dirname, "../.."),
  databaseIdOverride?: string,
): MundoPuente | null {
  const token = env.CLOUDFLARE_DEPLOY_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const produccionId = workerDatabaseId(root);
  const solicitado = databaseIdOverride?.trim();
  // Cinturón de seguridad: nunca permitir que el puente llamado "preview" apunte al D1 de producción.
  if (solicitado && produccionId && solicitado === produccionId) {
    deps.log?.("⚠ Plaza preview desactivada: su D1 coincide con el D1 de producción.");
    return null;
  }
  const databaseId = solicitado || produccionId;
  if (!token || !accountId || !databaseId) return null;
  return new MundoPuente({
    ...deps,
    query: d1Client({ accountId, token, databaseId }),
  });
}
