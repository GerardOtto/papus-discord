// Logica del worker de Cloudflare (24/7, aunque el PC de GyroP este apagado):
// - Miku: cola de videos personalizados (/pedido, /mi-pedido, /cola), votaciones con encuesta (/votacion),
//   calendario, estrenos y noticias;
// - Luka: tips con fuente (/tip) y Salon de la Fama (/tip-usado);
// - votacion semanal (config/votaciones.json): Miku la abre sola; el segundo lugar pasa a la ronda siguiente;
// - tareas programadas: recordar y cerrar votaciones (ganador), alertas de plazo de pedidos.
// Todo con frases fijas (regla 4, sin LLM ni cuota). Los datos de los pedidos nunca van a un LLM.
import lukaPhrases from "../../content/frases/luka.json";
import mikuPhrases from "../../content/frases/miku.json";
import moderation from "../../config/moderacion.json";
import layout from "../../config/servidor.json";
import votesConfig from "../../config/votaciones.json";
import { RuleSet, type ModerationSettings } from "../../src/moderation/rules";
import { renderBoard } from "../../src/orders/board";
import { OCCASIONS, OrderError, OrderQueue, PRODUCTS, STATE_LABEL, type OccasionId, type Order, type OrderState, type ProductId } from "../../src/orders/queue";
import type { Sql } from "../../src/orders/sql";
import { advanceDeck, fill, type DeckState } from "../../src/phrases/deck-core";
import { COLOR_MENU_ID, colorKey, NO_COLOR } from "../../src/setup/color-menu";
import {
  ideaText,
  nextRoundAt,
  parseHonorSettings,
  parseRoundSettings,
  pickIdeas,
  rankRound,
  resolveTie,
  type HonorSettings,
  type IdeaMessage,
  type RoundResult,
  type RoundSettings,
} from "../../src/votes/rounds";
import { channelKey, DiscordError, type BotKey, type DiscordApi } from "./discord";

export interface Option {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: Option[];
}

export interface Interaction {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id?: string;
  /** Comando (type 2): name/options. Menu (type 3): custom_id/values. */
  data?: { name?: string; options?: Option[]; custom_id?: string; values?: string[] };
  member?: { user: { id: string }; roles: string[] };
  user?: { id: string };
}

export interface Reply {
  content?: string;
  embeds?: Record<string, unknown>[];
}

export interface WorkerDeps {
  sql: Sql;
  discord: DiscordApi;
  guildId: string;
  ownerId: string;
  cast: { id: string; name: string }[];
  colors: Record<BotKey, number>;
  now?: () => number;
  rng?: () => number;
  /** Tope de un comando antes de responder igual con un aviso (para que nunca quede "pensando"). */
  commandTimeoutMs?: number;
  /** Votacion semanal (por defecto, config/votaciones.json). */
  rounds?: RoundSettings;
  /** Votacion de los Papus de honor (por defecto, config/votaciones.json -> honor). */
  honor?: HonorSettings;
}

const PHRASES = { miku: mikuPhrases as unknown as Record<string, string[]>, luka: lukaPhrases as unknown as Record<string, string[]> } satisfies Record<BotKey, Record<string, string[]>>;
const EPHEMERAL = 64;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const unix = (ms: number) => Math.floor(ms / 1000);
const TIERS = (layout as { niveles: { rol: string }[] }).niveles.map((n) => channelKey(n.rol));

/**
 * Roles a los que avisa un anuncio (votacion, ultimo aviso, calendario) en ese canal: los que pueden verlo, es decir,
 * su nivel y los superiores (acumulativos) o el rol del canal ("rol:…"). En canales publicos o de staff, ninguno:
 * los bots nunca mencionan a @everyone (decision de GyroP, 18 oct. 2026).
 */
export function audienceOf(canal: string): string[] {
  for (const cat of (layout as { categorias: { leen: string; canales: { nombre: string; voz?: boolean }[] }[] }).categorias) {
    if (!cat.canales.some((c) => !c.voz && channelKey(c.nombre) === canal)) continue;
    if (cat.leen.startsWith("rol:")) return [channelKey(cat.leen.slice(4))];
    const idx = TIERS.indexOf(channelKey(cat.leen));
    return idx < 0 ? [] : TIERS.slice(idx);
  }
  return [];
}
const BOARD_KEY = "tablero_cola";
const COMMAND_TIMEOUT_MS = 10_000;
const SLOW_REPLY =
  "Esto está tardando más de lo normal 🙈 Puede que se haya registrado igual: revísalo en un momento (por ejemplo con /mi-pedido) antes de intentarlo de nuevo.";
const POLL_QUESTIONS: Record<string, string> = {
  votaciones: "¿Qué tema quieren para el próximo video?",
  "propuestas-de-temas": "¿Cuál eligen, Papus?",
  "preguntas-a-gyrop": "¿Qué tema quieren para el especial?",
  "votacion-de-honor": "¿Qué video quieren que salga esta semana, Papus de honor?",
};

class UserError extends Error {}

interface RoundRow {
  id: number;
  votacion_id: number;
  opciones: string;
  estado: "abierta" | "desempate" | "cerrada";
  votos: string | null;
  empate: string | null;
  abierta_at: number;
}

export class PapusWorker {
  readonly orders: OrderQueue;
  private readonly rules: RuleSet;
  private readonly now: () => number;
  private readonly rng: () => number;
  private channelCache: Map<string, string> | null = null;
  private readonly rounds: RoundSettings;
  private readonly honor: HonorSettings;

  constructor(private readonly d: WorkerDeps) {
    this.now = d.now ?? Date.now;
    this.rng = d.rng ?? Math.random;
    this.rounds = d.rounds ?? parseRoundSettings(votesConfig);
    this.honor = d.honor ?? parseHonorSettings(votesConfig.honor);
    this.rules = new RuleSet(moderation as ModerationSettings);
    this.orders = new OrderQueue(
      d.sql,
      d.cast.map((c) => c.id),
      (text) => {
        const v = this.rules.check({ text, targetsSomeone: false, memberAgeHours: 1000, personalData: true });
        return v && v.kind !== "mayusculas" ? v.detail : null;
      },
      this.now,
    );
  }

  // ───────────────────────── interacciones ─────────────────────────

  /** Respuesta inmediata a Discord (en menos de 3 s) y el trabajo que se hace despues. */
  handle(bot: BotKey, i: Interaction): { response: Record<string, unknown>; work?: () => Promise<void> } {
    if (i.type === 1) return { response: { type: 1 } };
    const isColorMenu = i.type === 3 && i.data?.custom_id === COLOR_MENU_ID;
    if ((i.type !== 2 && !isColorMenu) || !i.data) return { response: { type: 4, data: { content: "No sé qué hacer con eso 🙈", flags: EPHEMERAL } } };
    return {
      // Respuesta diferida y privada: el resultado se escribe despues, cuando termina el trabajo.
      response: { type: 5, data: { flags: EPHEMERAL } },
      work: async () => {
        let reply: Reply;
        // Tope de tiempo: si el comando se demora (Discord lento, base ocupada…), se responde igual con un aviso.
        // El comando puede terminar despues (ej.: el pedido queda guardado); por eso el aviso pide revisar antes de repetir.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), this.d.commandTimeoutMs ?? COMMAND_TIMEOUT_MS)));
        try {
          const r = await Promise.race([this.route(bot, i), timeout]);
          reply = r === "timeout" ? { content: SLOW_REPLY } : r;
          if (r === "timeout") console.error(`/${i.data?.name}: superó el tope de tiempo`);
        } catch (e) {
          reply = { content: e instanceof UserError || e instanceof OrderError ? e.message : "Algo falló de mi lado. Inténtalo de nuevo en un rato 🙏" };
          if (!(e instanceof UserError || e instanceof OrderError)) console.error(`/${i.data?.name}`, e);
        } finally {
          clearTimeout(timer);
        }
        const body = { ...reply, allowed_mentions: { parse: [] } };
        try {
          await this.d.discord.editOriginal(i.application_id, i.token, body);
        } catch (e) {
          // Ultimo recurso: un mensaje privado aparte con el resultado (el "pensando" queda, pero el Papu se entera).
          console.error(`/${i.data?.name}: no se pudo editar la respuesta`, e);
          await this.d.discord.followUp(i.application_id, i.token, { ...body, flags: EPHEMERAL }).catch((e2) => console.error("followUp", e2));
        }
      },
    };
  }

  async route(bot: BotKey, i: Interaction): Promise<Reply> {
    const name = i.data!.name ?? "";
    const user = i.member?.user.id ?? i.user?.id ?? "";
    if (i.type === 3 && i.data!.custom_id === COLOR_MENU_ID) return this.pickColor(user, i.member?.roles ?? [], i.data!.values?.[0] ?? NO_COLOR);
    const o = new Options(i.data!.options ?? []);
    if (bot === "miku") {
      if (name === "pedido") return this.pedido(user, i.member?.roles ?? [], o);
      if (name === "mi-pedido") return this.miPedido(user);
      this.ownerOnly(user);
      if (name === "cola") return this.cola(o);
      if (name === "votacion") return this.votacion(o);
      if (name === "calendario") return this.post("miku", "calendario", "calendario", { texto: splitLines(o.str("texto", true)) });
      if (name === "estreno") return this.estreno(o);
      if (name === "noticia") return this.post("miku", "anuncios", "noticia", { texto: o.str("texto", true) });
    } else {
      if (name === "tip") return this.tip(user, i.member?.roles ?? [], o);
      this.ownerOnly(user);
      if (name === "tip-usado") return this.tipUsado(o);
    }
    throw new UserError("Ese comando no existe (¿quedó viejo?).");
  }

  private ownerOnly(user: string): void {
    if (user !== this.d.ownerId) throw new UserError("Eso solo lo usa GyroP 🎤");
  }

  // ───────────────────────── cola de pedidos (Miku) ─────────────────────────

  private async pedido(user: string, roles: string[], o: Options): Promise<Reply> {
    if (user !== this.d.ownerId && !(await this.hasTier(roles, "triplebaka"))) {
      return { content: "¡Ay, Papu! El video personalizado incluido es del nivel 💥 **Triple Baka** (ko-fi.com/tetociencia/tiers).\nTambién puedes pedir uno con un pago único en la tienda de Ko-fi 🎁" };
    }
    const can = await this.orders.canOrderTripleBaka(user);
    if (!can.ok) {
      return {
        content:
          can.reason === "activo"
            ? `Ya tienes el pedido **#${can.order.id}** en curso (${STATE_LABEL[can.order.estado]}). Cuando se entregue podrás pedir el siguiente 🎁`
            : `Ya pediste tu video de este mes ♡ El próximo lo puedes pedir desde el <t:${unix(can.nextAt)}:D>.`,
      };
    }
    const order = await this.orders.create({
      origen: "triple_baka",
      papuId: user,
      producto: "triple_baka",
      ocasion: o.str("ocasion", true) as OccasionId,
      para: o.str("para", true),
      vocaloids: [o.str("vocaloid", true), o.str("vocaloid2")].filter((v): v is string => !!v),
      detalles: o.str("detalles", true),
      pronunciacion: o.str("pronunciacion"),
      fechaLimite: o.str("fecha_limite"),
      publicar: o.bool("publicar") ?? false,
    });
    const n = (await this.orders.position(order.id)) ?? 1;
    await this.refreshBoard();
    await this.notifyOwner(
      `🎁 **Nuevo pedido #${order.id}** (Triple Baka) de <@${user}> · ${OCCASIONS[order.ocasion]} · plazo <t:${unix(order.plazoAt)}:D>${order.revisar ? `\n⚠️ Revisar: ${order.revisar}` : ""}\nDetalles: \`/cola detalle pedido:${order.id}\``,
    );
    return {
      content: [
        await this.pick("miku", "pedido_recibido", { papu: `<@${user}>`, n }),
        "",
        this.summary(order, false),
        `📬 A más tardar el <t:${unix(order.plazoAt)}:D>. Te aviso cuando empiece y cuando esté listo.`,
      ].join("\n"),
    };
  }

  private async miPedido(user: string): Promise<Reply> {
    const o = await this.orders.latestOf(user);
    if (!o) return { content: "Todavía no tienes pedidos ♡ Si eres 💥 Triple Baka, pide tu video con **/pedido** 🎁" };
    const pos = await this.orders.position(o.id);
    const lines = [`**Pedido #${o.id}** · ${OCCASIONS[o.ocasion]} · ${STATE_LABEL[o.estado]}`];
    if (pos) lines.push(`📍 Vas en el lugar **${pos}** de la cola · a más tardar el <t:${unix(o.plazoAt)}:D>`);
    if (o.estado === "entregado" && o.entregadoAt) lines.push(`✅ Entregado el <t:${unix(o.entregadoAt)}:D>. Si hay un error en el nombre, avísale a GyroP hasta el <t:${unix(o.entregadoAt + 7 * DAY)}:D>.`);
    if (o.estado === "rechazado") lines.push(`🚫 ${o.motivo ?? "No se pudo hacer."} Puedes pedir otro con **/pedido**.`);
    if (o.origen === "triple_baka" && !pos) {
      const can = await this.orders.canOrderTripleBaka(user);
      if (can.ok) lines.push("🎁 Ya puedes pedir tu próximo video con **/pedido**.");
      else if (can.reason === "mes") lines.push(`🗓️ Tu próximo video lo puedes pedir desde el <t:${unix(can.nextAt)}:D>.`);
    }
    return { content: lines.join("\n") };
  }

  private async cola(o: Options): Promise<Reply> {
    const sub = o.sub();
    if (sub === "ver") {
      const active = await this.orders.active();
      const text = active.length ? active.map((x, k) => `**${k + 1}. #${x.id}** ${this.summary(x, true, 160)}`).join("\n\n") : "La cola está vacía ✨";
      return { embeds: [{ title: `🎁 Cola (${active.length})`, description: text.slice(0, 4000), color: this.d.colors.miku }] };
    }
    if (sub === "detalle") {
      const x = await this.orders.get(o.int("pedido", true));
      if (!x) throw new UserError("No existe ese pedido.");
      return { embeds: [{ title: `Pedido #${x.id}`, description: this.summary(x, true).slice(0, 4000), color: this.d.colors.miku }] };
    }
    if (sub === "estado") {
      const estado = o.str("estado", true) as OrderState;
      const motivo = o.str("motivo") ?? (estado === "rechazado" ? "no cumple con las condiciones de los pedidos" : null);
      const x = await this.orders.setState(o.int("pedido", true), estado, motivo);
      await this.refreshBoard();
      await this.notifyPapu(x);
      return { content: `Listo: pedido **#${x.id}** → ${STATE_LABEL[x.estado]}.` };
    }
    if (sub === "agregar") {
      const x = await this.orders.create({
        origen: "tienda",
        papuId: o.str("papu"),
        comprador: o.str("comprador"),
        producto: o.str("producto", true) as ProductId,
        ocasion: o.str("ocasion", true) as OccasionId,
        para: o.str("para", true),
        vocaloids: ["vocaloid", "vocaloid2", "vocaloid3"].map((k) => o.str(k)).filter((v): v is string => !!v),
        detalles: o.str("detalles", true),
        pronunciacion: o.str("pronunciacion"),
        fechaLimite: o.str("fecha_limite"),
        publicar: o.bool("publicar") ?? false,
      });
      await this.refreshBoard();
      return { content: `Pedido de la tienda **#${x.id}** en la cola, lugar **${await this.orders.position(x.id)}** · plazo <t:${unix(x.plazoAt)}:D>.${x.revisar ? `\n⚠️ Revisar: ${x.revisar}` : ""}` };
    }
    throw new UserError("Subcomando desconocido.");
  }

  /** Crea o edita el tablero fijado de Miku en #cola-de-pedidos (nunca muestra para quien es el video). */
  async refreshBoard(): Promise<void> {
    const ch = await this.channel("cola-de-pedidos");
    if (!ch) return;
    const b = renderBoard(await this.orders.active(), await this.orders.deliveredSince(30 * DAY));
    const body = { embeds: [{ title: b.title, description: b.description, color: this.d.colors.miku, footer: { text: b.footer } }], allowed_mentions: { parse: [] } };
    const saved = await this.kvGet(BOARD_KEY);
    if (saved) {
      try {
        await this.d.discord.call("miku", "PATCH", `/channels/${ch}/messages/${saved}`, body);
        return;
      } catch (e) {
        if (!(e instanceof DiscordError && e.status === 404)) throw e;
      }
    }
    const msg = await this.d.discord.call<{ id: string }>("miku", "POST", `/channels/${ch}/messages`, body);
    await this.d.discord.call("miku", "PUT", `/channels/${ch}/pins/${msg.id}`).catch(() => {});
    await this.kvSet(BOARD_KEY, msg.id);
  }

  /** Avisa al Papu el cambio de estado por privado, o en #cola-de-pedidos si tiene los privados cerrados. */
  private async notifyPapu(o: Order): Promise<void> {
    if (!o.papuId) return;
    const group = ({ en_produccion: "pedido_en_produccion", entregado: "pedido_entregado", rechazado: "pedido_rechazado" } as Record<string, string>)[o.estado];
    if (!group) return;
    const content = await this.pick("miku", group, { papu: `<@${o.papuId}>`, motivo: o.motivo ?? "" });
    try {
      const dm = await this.d.discord.call<{ id: string }>("miku", "POST", "/users/@me/channels", { recipient_id: o.papuId });
      await this.d.discord.call("miku", "POST", `/channels/${dm.id}/messages`, { content });
    } catch {
      const ch = await this.channel("cola-de-pedidos");
      if (ch) await this.d.discord.call("miku", "POST", `/channels/${ch}/messages`, { content, allowed_mentions: { users: [o.papuId] } });
    }
  }

  // ───────────────────────── votaciones, calendario, anuncios (Miku) ─────────────────────────

  private async votacion(o: Options): Promise<Reply> {
    const sub = o.sub();
    await this.seedCandidates();
    if (sub === "candidato") return this.addCandidates(o.str("nombre", true));
    if (sub === "candidatos") return this.listCandidates();
    if (sub === "quitar") return this.removeCandidate(o.str("nombre", true));
    if (sub === "semanal") return this.openRoundNow();
    if (sub === "desempate") return this.breakTie(o.str("opcion", true));
    if (sub === "listo") return this.addReady(o.str("nombre", true));
    if (sub === "listos") return this.listHonor();
    if (sub === "quitar-listo") return this.removeReady(o.str("nombre", true));
    if (sub === "honor") return this.openHonorNow();
    const canal = o.str("canal") ?? "votaciones";
    const ch = await this.channel(canal);
    if (!ch) throw new UserError(`No encuentro el canal #${canal}.`);
    if (sub === "cerrar") {
      const v = await this.d.sql.get<{ id: number; message_id: string }>(
        "SELECT id, message_id FROM votaciones WHERE canal = ? AND cerrada = 0 ORDER BY creado_at DESC LIMIT 1",
        canal,
      );
      if (!v) throw new UserError(`No hay votaciones abiertas en #${canal}.`);
      await this.d.discord.call("miku", "POST", `/channels/${ch}/polls/${v.message_id}/expire`);
      await this.d.sql.run("UPDATE votaciones SET ends_at = ? WHERE id = ?", this.now(), v.id);
      return { content: "Listo: la votación se cerró. Miku anuncia el ganador en unos minutos 🎤" };
    }
    const opciones = [1, 2, 3, 4, 5, 6].map((n) => o.str(`opcion${n}`)).filter((v): v is string => !!v?.trim());
    if (new Set(opciones.map((x) => x.toLowerCase())).size !== opciones.length) throw new UserError("Hay opciones repetidas.");
    const dias = o.int("dias") ?? 3;
    const pregunta = o.str("pregunta") ?? POLL_QUESTIONS[canal] ?? "¿Cuál eligen, Papus?";
    const { endsAt } = await this.openPoll(canal, ch, pregunta, opciones, dias);
    return { content: `Votación abierta en <#${ch}> hasta el <t:${unix(endsAt)}:f>. Miku avisa 12 h antes del cierre y anuncia el ganador 🗳️` };
  }

  /** Publica la encuesta nativa con la frase de Miku y la guarda para recordarla y cerrarla. */
  private async openPoll(canal: string, ch: string, pregunta: string, opciones: string[], dias: number): Promise<{ id: number; endsAt: number }> {
    const aviso = await this.audience(canal);
    const content = aviso.mention(await this.pick("miku", "votacion_abierta", { tema: opciones.map((x) => `• ${x}`).join("\n") }));
    const msg = await this.d.discord.call<{ id: string }>("miku", "POST", `/channels/${ch}/messages`, {
      content,
      allowed_mentions: aviso.allowed_mentions,
      poll: {
        question: { text: pregunta },
        answers: opciones.map((text) => ({ poll_media: { text } })),
        duration: dias * 24,
        allow_multiselect: false,
        layout_type: 1,
      },
    });
    const endsAt = this.now() + dias * 24 * HOUR;
    const r = await this.d.sql.run(
      "INSERT INTO votaciones (canal, channel_id, message_id, pregunta, opciones, ends_at, creado_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      canal,
      ch,
      msg.id,
      pregunta,
      JSON.stringify(opciones),
      endsAt,
      this.now(),
    );
    return { id: r.lastRowId, endsAt };
  }

  // ───────────────────────── votacion semanal (Miku) ─────────────────────────

  private async addCandidates(text: string): Promise<Reply> {
    const names = text.split("|").map((x) => x.trim()).filter(Boolean);
    const added: string[] = [];
    const skipped: string[] = [];
    for (const n of names) {
      if (n.length > 55) throw new UserError(`"${n.slice(0, 30)}…" es muy largo (máximo 55 caracteres, lo que cabe en una encuesta).`);
      const prev = await this.d.sql.get<{ id: number; estado: string }>("SELECT id, estado FROM candidatos WHERE nombre = ?", n);
      if (!prev) await this.d.sql.run("INSERT INTO candidatos (nombre, estado, creado_at) VALUES (?, 'espera', ?)", n, this.now());
      else if (prev.estado === "quitado" || prev.estado === "descartado") {
        await this.d.sql.run("UPDATE candidatos SET estado = 'espera', creado_at = ? WHERE id = ?", this.now(), prev.id);
      } else {
        skipped.push(`${n} (${CANDIDATE_LABEL[prev.estado] ?? prev.estado})`);
        continue;
      }
      added.push(n);
    }
    const lines: string[] = [];
    if (added.length) lines.push(`Agregado a la lista de espera: ${added.map((x) => `**${x}**`).join(", ")} 🗳️`);
    if (skipped.length) lines.push(`Ya estaba: ${skipped.join(", ")}`);
    return { content: lines.join("\n") };
  }

  private async removeCandidate(name: string): Promise<Reply> {
    const r = await this.d.sql.run("UPDATE candidatos SET estado = 'quitado' WHERE nombre = ? AND estado IN ('espera', 'sigue')", name.trim());
    if (!r.changes) throw new UserError(`"${name}" no está en la lista de espera (las opciones de una votación abierta no se pueden quitar).`);
    return { content: `Listo: **${name.trim()}** salió de la lista.` };
  }

  private async listCandidates(): Promise<Reply> {
    await this.seedCandidates();
    const rows = await this.d.sql.all<{ nombre: string; estado: string }>(
      "SELECT nombre, estado FROM candidatos WHERE estado IN ('en_votacion', 'sigue', 'espera') ORDER BY CASE estado WHEN 'en_votacion' THEN 0 WHEN 'sigue' THEN 1 ELSE 2 END, creado_at, id",
    );
    const winners = await this.d.sql.all<{ ganador: string; abierta_at: number }>("SELECT ganador, abierta_at FROM rondas WHERE ganador IS NOT NULL ORDER BY id DESC LIMIT 5");
    const last = await this.d.sql.get<{ abierta_at: number }>("SELECT abierta_at FROM rondas ORDER BY id DESC LIMIT 1");
    const open = await this.openRound();
    const count = (estado: string) => rows.filter((r) => r.estado === estado).length;
    // Para la proxima ronda: si hay una abierta, se cuenta con que su segundo lugar siga.
    const missing = (open ? this.rounds.opciones - 1 : this.rounds.opciones - count("sigue")) - count("espera");
    const lines = rows.length ? rows.map((r) => `${CANDIDATE_LABEL[r.estado]} · **${r.nombre}**`) : ["La lista está vacía."];
    lines.push(
      "",
      open?.estado === "desempate"
        ? "⚖️ La última ronda terminó en empate: decide con **/votacion desempate**."
        : open
          ? `🗳️ Hay una ronda abierta. La próxima se abre <t:${unix(nextRoundAt(this.rounds, open.abierta_at))}:R>.`
          : `⏭️ Próxima ronda: <t:${unix(nextRoundAt(this.rounds, last?.abierta_at ?? null))}:f>`,
    );
    if (missing > 0) lines.push(`⚠️ Para la próxima ronda faltan **${missing}** candidatos (/votacion candidato).`);
    if (winners.length) lines.push("", "🏆 Últimos ganadores:", ...winners.map((w) => `• ${w.ganador} (<t:${unix(w.abierta_at)}:D>)`));
    return { embeds: [{ title: "🗳️ Votación semanal", description: lines.join("\n").slice(0, 4000), color: this.d.colors.miku }] };
  }

  /** Candidatos iniciales de la config (solo si la lista esta vacia). */
  private async seedCandidates(): Promise<void> {
    if (await this.d.sql.get<{ id: number }>("SELECT id FROM candidatos LIMIT 1")) return;
    for (const [k, n] of this.rounds.semilla.entries()) {
      await this.d.sql.run("INSERT OR IGNORE INTO candidatos (nombre, estado, creado_at) VALUES (?, 'espera', ?)", n, this.now() + k);
    }
  }

  private openRound(): Promise<RoundRow | undefined> {
    return this.d.sql.get<RoundRow>("SELECT * FROM rondas WHERE estado IN ('abierta', 'desempate') ORDER BY id DESC LIMIT 1");
  }

  private async openRoundNow(): Promise<Reply> {
    const r = await this.startRound();
    if (!r.ok) throw new UserError(r.reason);
    return { content: `Ronda semanal abierta en <#${r.ch}> hasta el <t:${unix(r.endsAt)}:f>: ${r.options.map((x) => `**${x}**`).join(", ")} 🗳️` };
  }

  /** Abre la ronda: el segundo lugar anterior (si hubo) + los mas antiguos de la lista de espera. */
  private async startRound(): Promise<{ ok: true; ch: string; endsAt: number; options: string[] } | { ok: false; reason: string }> {
    await this.seedCandidates();
    const open = await this.openRound();
    if (open?.estado === "abierta") return { ok: false, reason: "Ya hay una ronda semanal abierta." };
    if (open?.estado === "desempate") return { ok: false, reason: "La ronda anterior terminó en empate: decide primero con /votacion desempate." };
    const s = this.rounds;
    const carried = await this.d.sql.all<{ id: number; nombre: string }>("SELECT id, nombre FROM candidatos WHERE estado = 'sigue' ORDER BY id");
    const fresh = await this.d.sql.all<{ id: number; nombre: string }>(
      "SELECT id, nombre FROM candidatos WHERE estado = 'espera' ORDER BY creado_at, id LIMIT ?",
      Math.max(0, s.opciones - carried.length),
    );
    const picked = [...carried, ...fresh].slice(0, s.opciones);
    if (picked.length < s.opciones) {
      return { ok: false, reason: `Faltan ${s.opciones - picked.length} candidatos (hay ${picked.length} de ${s.opciones}). Agrégalos con /votacion candidato.` };
    }
    const ch = await this.channel(s.canal);
    if (!ch) return { ok: false, reason: `No encuentro el canal #${s.canal}.` };
    const options = picked.map((p) => p.nombre);
    const poll = await this.openPoll(s.canal, ch, s.pregunta, options, s.duraDias);
    for (const p of picked) await this.d.sql.run("UPDATE candidatos SET estado = 'en_votacion' WHERE id = ?", p.id);
    await this.d.sql.run("INSERT INTO rondas (votacion_id, opciones, estado, abierta_at) VALUES (?, ?, 'abierta', ?)", poll.id, JSON.stringify(options), this.now());
    await this.toVitrina(await this.pick("miku", "vitrina_votacion", { tema: options.map((x) => `• ${x}`).join("\n"), ...(await this.links()) })).catch((e) =>
      console.error("vitrina", e),
    );
    return { ok: true, ch, endsAt: poll.endsAt, options };
  }

  /** Cada 15 min: abre la ronda cuando toca; si no se puede, avisa a GyroP (una vez al dia). */
  private async roundTasks(): Promise<void> {
    const open = await this.openRound();
    if (open) {
      if (open.estado === "desempate") await this.remindOwner("desempate", "⚖️ La votación semanal terminó en empate y la próxima ronda espera tu decisión: **/votacion desempate**.");
      return;
    }
    const last = await this.d.sql.get<{ abierta_at: number }>("SELECT abierta_at FROM rondas ORDER BY id DESC LIMIT 1");
    if (this.now() < nextRoundAt(this.rounds, last?.abierta_at ?? null)) return;
    const r = await this.startRound();
    if (!r.ok) await this.remindOwner("ronda", `🗳️ Tocaba abrir la votación semanal, pero no se pudo: ${r.reason}`);
  }

  private async remindOwner(kind: string, text: string): Promise<void> {
    const key = `aviso_${kind}:${Math.floor(this.now() / DAY)}`;
    if (await this.kvGet(key)) return;
    await this.kvSet(key, "1");
    await this.notifyOwner(text);
  }

  /** Cierre de una ronda semanal: ganador y segundo lugar que sigue, o empate para GyroP. */
  private async closeRound(round: RoundRow, poll: PollData): Promise<string> {
    const options = JSON.parse(round.opciones) as string[];
    const counts = pollCounts(poll);
    const result = rankRound(options, counts);
    await this.d.sql.run("UPDATE rondas SET votos = ? WHERE id = ?", JSON.stringify(counts), round.id);
    if (!result.winner) {
      await this.d.sql.run("UPDATE rondas SET estado = 'desempate', empate = ? WHERE id = ?", JSON.stringify(result.tied), round.id);
      await this.notifyOwner(`⚖️ Empate en la votación semanal entre ${result.tied.map((x) => `**${x}**`).join(", ")}. Elige con **/votacion desempate**.`);
      return Object.values(counts).some((c) => c > 0)
        ? this.pick("miku", "ganador", { ganador: `${result.tied.join(" y ")} (¡empate! GyroP decide)` })
        : "Nadie votó esta vez… ¡GyroP decide! 🎤";
    }
    return this.finishRound(round, options, result);
  }

  private async finishRound(round: RoundRow, options: string[], result: RoundResult): Promise<string> {
    for (const o of options) {
      const estado = o === result.winner ? "ganador" : o === result.second ? "sigue" : "descartado";
      await this.d.sql.run("UPDATE candidatos SET estado = ? WHERE nombre = ?", estado, o);
    }
    await this.d.sql.run("UPDATE rondas SET estado = 'cerrada', ganador = ?, segundo = ? WHERE id = ?", result.winner, result.second, round.id);
    await this.d.sql.run("UPDATE votaciones SET cerrada = 1, ganador = ? WHERE id = ?", result.winner, round.votacion_id);
    const lines = [await this.pick("miku", "ganador", { ganador: result.winner! })];
    if (result.second) lines.push(`🔁 **${result.second}** quedó en segundo lugar y vuelve a competir en la próxima votación.`);
    const { niveles } = await this.links();
    await this.toVitrina(`${lines.join("\n")}\n🥬 ¿Quieres votar la próxima? Desde Puerro: ${niveles}`).catch((e) => console.error("vitrina", e));
    return lines.join("\n");
  }

  private async breakTie(choice: string): Promise<Reply> {
    const open = await this.openRound();
    if (open?.estado !== "desempate") throw new UserError("No hay ningún empate pendiente.");
    const tied = JSON.parse(open.empate ?? "[]") as string[];
    const winner = tied.find((t) => t.toLowerCase() === choice.trim().toLowerCase());
    if (!winner) throw new UserError(`Elige una de: ${tied.join(", ")}`);
    const options = JSON.parse(open.opciones) as string[];
    const counts = JSON.parse(open.votos ?? "{}") as Record<string, number>;
    const text = await this.finishRound(open, options, resolveTie(options, counts, winner));
    const v = await this.d.sql.get<{ channel_id: string; message_id: string }>("SELECT channel_id, message_id FROM votaciones WHERE id = ?", open.votacion_id);
    if (v) {
      await this.d.discord.call("miku", "POST", `/channels/${v.channel_id}/messages`, {
        content: text,
        message_reference: { message_id: v.message_id, fail_if_not_exists: false },
        allowed_mentions: { parse: [] },
      });
    }
    return { content: `Listo: ganó **${winner}** y Miku ya lo anunció 🎤` };
  }

  private async estreno(o: Options): Promise<Reply> {
    const enlace = o.str("enlace", true);
    if (!/^https?:\/\/\S+$/.test(enlace)) throw new UserError("El enlace tiene que empezar con http:// o https://");
    const content = `${await this.pick("miku", "estreno", { video: o.str("titulo", true) })}\n${enlace}`;
    return this.postContent("miku", "anuncios", content);
  }

  /** Publica una frase del grupo en un canal (calendario, noticias). */
  private async post(bot: BotKey, canal: string, group: string, vars: Record<string, string>): Promise<Reply> {
    return this.postContent(bot, canal, await this.pick(bot, group, vars));
  }

  private async postContent(bot: BotKey, canal: string, content: string): Promise<Reply> {
    const ch = await this.channel(canal);
    if (!ch) throw new UserError(`No encuentro el canal #${canal}.`);
    const aviso = await this.audience(canal);
    await this.d.discord.call(bot, "POST", `/channels/${ch}/messages`, { content: aviso.mention(content), allowed_mentions: aviso.allowed_mentions });
    return { content: `Publicado en <#${ch}> ✨` };
  }

  // ───────────────────────── votacion de los Papus de honor (Miku) ─────────────────────────

  private async addReady(text: string): Promise<Reply> {
    const names = text.split("|").map((x) => x.trim()).filter(Boolean);
    const added: string[] = [];
    for (const n of names) {
      if (n.length > 55) throw new UserError(`"${n.slice(0, 30)}…" es muy largo (máximo 55 caracteres, lo que cabe en una encuesta).`);
      const prev = await this.d.sql.get<{ id: number; estado: string }>("SELECT id, estado FROM listos WHERE nombre = ?", n);
      if (!prev) await this.d.sql.run("INSERT INTO listos (nombre, estado, creado_at) VALUES (?, 'espera', ?)", n, this.now());
      else if (prev.estado === "quitado") await this.d.sql.run("UPDATE listos SET estado = 'espera', creado_at = ? WHERE id = ?", this.now(), prev.id);
      else continue;
      added.push(n);
    }
    return { content: added.length ? `Videos listos para la votación de honor: ${added.map((x) => `**${x}**`).join(", ")} 🏅` : "Esos ya estaban en la lista." };
  }

  private async removeReady(name: string): Promise<Reply> {
    const r = await this.d.sql.run("UPDATE listos SET estado = 'quitado' WHERE nombre = ? AND estado = 'espera'", name.trim());
    if (!r.changes) throw new UserError(`"${name}" no está en la lista de videos listos (o está en una votación abierta).`);
    return { content: `Listo: **${name.trim()}** salió de la lista.` };
  }

  private async lastHonorOpen(): Promise<number | null> {
    return (await this.d.sql.get<{ abierta_at: number }>("SELECT abierta_at FROM rondas_honor ORDER BY id DESC LIMIT 1"))?.abierta_at ?? null;
  }

  private async listHonor(): Promise<Reply> {
    const h = this.honor;
    const ready = await this.d.sql.all<{ nombre: string; estado: string }>(
      "SELECT nombre, estado FROM listos WHERE estado IN ('en_votacion', 'espera') ORDER BY CASE estado WHEN 'en_votacion' THEN 0 ELSE 1 END, creado_at, id",
    );
    const last = await this.lastHonorOpen();
    const open = await this.d.sql.get<{ id: number }>("SELECT id FROM rondas_honor WHERE estado = 'abierta' LIMIT 1");
    const ideas = await this.collectIdeas(last ?? this.now() - h.cadaDias * DAY);
    const lines = ["**🎬 Videos listos**", ...(ready.length ? ready.map((r) => `${r.estado === "en_votacion" ? "🗳️ en votación" : "⏳ en espera"} · **${r.nombre}**`) : ["(ninguno: agrégalos con /votacion listo)"])];
    lines.push("", `**💡 Ideas que van ganando en #${h.charla}** (${h.emoji})`, ...(ideas.length ? ideas.map((i) => `• ${i.text} · ${i.likes} ${h.emoji} · <@${i.authorId}>`) : ["(ninguna con apoyo todavía)"]));
    lines.push("", open ? "🗳️ Hay una votación de honor abierta." : `⏭️ Próxima votación de honor: <t:${unix(nextRoundAt(h, last))}:f>`);
    return { embeds: [{ title: "🏅 Votación de honor", description: lines.join("\n").slice(0, 4000), color: this.d.colors.miku }] };
  }

  /** Ideas de #charla-de-honor desde `since`: las `ideas` con mas reacciones (sin la del autor ni bots), sin usar ni prohibidas. */
  private async collectIdeas(since: number): Promise<IdeaMessage[]> {
    const h = this.honor;
    const ch = await this.channel(h.charla);
    if (!ch) return [];
    type Msg = { id: string; content: string; timestamp: string; pinned?: boolean; author: { id: string; bot?: boolean }; reactions?: { emoji: { name: string }; count: number }[] };
    const msgs: Msg[] = [];
    let before = "";
    for (let page = 0; page < 5; page++) {
      const list = await this.d.discord.call<Msg[]>("miku", "GET", `/channels/${ch}/messages?limit=100${before ? `&before=${before}` : ""}`);
      msgs.push(...list);
      if (list.length < 100 || Date.parse(list.at(-1)!.timestamp) < since) break;
      before = list.at(-1)!.id;
    }
    const raw = msgs
      .filter((m) => !m.author.bot && !m.pinned && Date.parse(m.timestamp) >= since)
      .map((m) => ({ m, n: m.reactions?.find((r) => r.emoji.name === h.emoji)?.count ?? 0 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
    const ideas: IdeaMessage[] = [];
    for (const { m } of raw) {
      if (await this.kvGet(`idea_usada:${m.id}`)) continue;
      const text = ideaText(m.content);
      const v = this.rules.check({ text, targetsSomeone: false, memberAgeHours: 1000, personalData: true });
      if (!text || v?.remove) continue;
      const users = await this.d.discord.call<{ id: string; bot?: boolean }[]>(
        "miku",
        "GET",
        `/channels/${ch}/messages/${m.id}/reactions/${encodeURIComponent(h.emoji)}?limit=100`,
      );
      const likes = users.filter((u) => !u.bot && u.id !== m.author.id).length;
      ideas.push({ id: m.id, authorId: m.author.id, text, createdAt: Date.parse(m.timestamp), likes });
    }
    return pickIdeas(ideas, h.ideas);
  }

  private async openHonorNow(): Promise<Reply> {
    const r = await this.startHonor();
    if (!r.ok) throw new UserError(r.reason);
    return { content: `Votación de honor abierta en <#${r.ch}> hasta el <t:${unix(r.endsAt)}:f>: ${r.options.map((x) => `**${x}**`).join(", ")} 🏅` };
  }

  /** Abre la ronda: hasta `listos` videos listos (los mas antiguos) + las ideas mas apoyadas desde la ronda anterior. */
  private async startHonor(): Promise<{ ok: true; ch: string; endsAt: number; options: string[] } | { ok: false; reason: string }> {
    const h = this.honor;
    if (await this.d.sql.get<{ id: number }>("SELECT id FROM rondas_honor WHERE estado = 'abierta' LIMIT 1")) return { ok: false, reason: "Ya hay una votación de honor abierta." };
    const ready = await this.d.sql.all<{ id: number; nombre: string }>("SELECT id, nombre FROM listos WHERE estado = 'espera' ORDER BY creado_at, id LIMIT ?", h.listos);
    const last = await this.lastHonorOpen();
    const ideas = await this.collectIdeas(last ?? this.now() - h.cadaDias * DAY);
    const seen = new Set<string>();
    const options = [...ready.map((r) => r.nombre), ...ideas.map((i) => i.text)].filter((o) => !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()));
    if (options.length < 2) {
      return {
        ok: false,
        reason: `Hay ${options.length} opción(es) y se necesitan al menos 2: agrega videos listos con /votacion listo, o que los Papus de honor apoyen ideas con ${h.emoji} en #${h.charla}.`,
      };
    }
    const ch = await this.channel(h.canal);
    if (!ch) return { ok: false, reason: `No encuentro el canal #${h.canal}.` };
    const poll = await this.openPoll(h.canal, ch, h.pregunta, options, h.duraDias);
    for (const r of ready) await this.d.sql.run("UPDATE listos SET estado = 'en_votacion' WHERE id = ?", r.id);
    for (const i of ideas) await this.kvSet(`idea_usada:${i.id}`, String(this.now()));
    await this.d.sql.run("INSERT INTO rondas_honor (votacion_id, opciones, estado, abierta_at) VALUES (?, ?, 'abierta', ?)", poll.id, JSON.stringify(options), this.now());
    if (ideas.length) {
      const authors = [...new Set(ideas.map((i) => i.authorId))];
      await this.d.discord.call("miku", "POST", `/channels/${ch}/messages`, {
        content: `💡 Las ideas de la charla de esta semana son de ${authors.map((a) => `<@${a}>`).join(" y ")}. ¡Gracias por proponer! ♡`,
        allowed_mentions: { users: authors },
      });
    }
    return { ok: true, ch, endsAt: poll.endsAt, options };
  }

  /** Cada 15 min: abre la votacion de honor cuando toca; si no hay opciones suficientes, avisa a GyroP (una vez al dia). */
  private async honorTasks(): Promise<void> {
    if (await this.d.sql.get<{ id: number }>("SELECT id FROM rondas_honor WHERE estado = 'abierta' LIMIT 1")) return;
    if (this.now() < nextRoundAt(this.honor, await this.lastHonorOpen())) return;
    const r = await this.startHonor();
    if (!r.ok) await this.remindOwner("honor", `🏅 Tocaba abrir la votación de honor, pero no se pudo: ${r.reason}`);
  }

  /** Al cerrar la encuesta de honor: el video listo que gano queda como ganador; los demas vuelven a la lista. */
  private async closeHonor(votacionId: number, ganador: string[]): Promise<void> {
    const round = await this.d.sql.get<{ id: number; opciones: string }>("SELECT id, opciones FROM rondas_honor WHERE votacion_id = ? AND estado = 'abierta'", votacionId);
    if (!round) return;
    const winner = ganador.length === 1 ? ganador[0]! : null;
    for (const o of JSON.parse(round.opciones) as string[]) {
      await this.d.sql.run("UPDATE listos SET estado = ? WHERE nombre = ? AND estado = 'en_votacion'", o === winner ? "ganador" : "espera", o);
    }
    await this.d.sql.run("UPDATE rondas_honor SET estado = 'cerrada', ganador = ? WHERE id = ?", ganador.join(" | ") || null, round.id);
  }

  // ───────────────────────── color del nombre (menu de Miku en #tu-color) ─────────────────────────

  /** Deja al Papu con un solo color de la paleta (o ninguno). Quien tiene nivel sigue viendose con el de su nivel. */
  private async pickColor(user: string, memberRoles: string[], value: string): Promise<Reply> {
    const palette = PALETTE.map((c) => ({ ...c, key: colorKey(c.rol) }));
    const choice = palette.find((c) => c.key === value) ?? null;
    if (!choice && value !== NO_COLOR) throw new UserError("Ese color ya no está en la paleta 🙈");
    const roles = await this.d.discord.call<{ id: string; name: string; managed?: boolean }[]>("miku", "GET", `/guilds/${this.d.guildId}/roles`);
    // Sin los roles propios de los bots: el de Gumi, Kaito o Haku se llama igual que su color y no se puede asignar.
    const idOf = new Map(roles.filter((r) => !r.managed).map((r) => [colorKey(r.name), r.id]));
    const target = choice ? idOf.get(choice.key) : undefined;
    if (choice && !target) throw new UserError("Ese color todavía no existe en el servidor. Avísale a GyroP 🙈");
    for (const c of palette) {
      const id = idOf.get(c.key);
      if (id && id !== target && memberRoles.includes(id)) await this.d.discord.call("miku", "DELETE", `/guilds/${this.d.guildId}/members/${user}/roles/${id}`);
    }
    if (target && !memberRoles.includes(target)) await this.d.discord.call("miku", "PUT", `/guilds/${this.d.guildId}/members/${user}/roles/${target}`);
    if (!choice) return { content: "Listo: tu nombre vuelve al color de siempre ♡" };
    const tier = await this.hasTier(memberRoles, TIERS[0]!);
    return {
      content: `¡Listo! Ahora eres color **${choice.rol.replace(/^🎨\s*/, "")}** ✨${tier ? "\n(Como tienes un nivel de Ko-fi, en la lista se sigue viendo el color de tu nivel.)" : ""}`,
    };
  }

  /** Aviso en #vitrina (lo que pasa en los canales de los niveles, sin regalar el contenido). */
  private async toVitrina(content: string): Promise<void> {
    const ch = await this.channel("vitrina");
    if (ch) await this.d.discord.call("miku", "POST", `/channels/${ch}/messages`, { content, allowed_mentions: { parse: [] } });
  }

  /** Enlaces a canales para las frases de la vitrina. */
  private async links(): Promise<Record<string, string>> {
    const [niveles, votaciones] = await Promise.all([this.channel("niveles-ko-fi"), this.channel(this.rounds.canal)]);
    return { niveles: niveles ? `<#${niveles}>` : "ko-fi.com/tetociencia/tiers", votaciones: votaciones ? `<#${votaciones}>` : "#votaciones" };
  }

  // ───────────────────────── tips (Luka) ─────────────────────────

  private async tip(user: string, roles: string[], o: Options): Promise<Reply> {
    if (user !== this.d.ownerId && !(await this.hasTier(roles, "atun"))) {
      return { content: "Los tips son del nivel 🐟 **Atún** y superiores (ko-fi.com/tetociencia/tiers). Exactly." };
    }
    const texto = o.str("texto", true).trim();
    const fuente = o.str("fuente", true).trim();
    if (!/^https?:\/\/\S+\.\S+/.test(fuente)) throw new UserError("La fuente tiene que ser un enlace (https://…). Sin fuente es un rumor, no un tip 🐟");
    const v = this.rules.check({ text: texto, targetsSomeone: false, memberAgeHours: 1000, personalData: true });
    if (v?.remove) throw new UserError(`No puedo publicar ese tip: ${v.detail}.`);
    const ch = await this.channel("tips-y-curiosidades");
    if (!ch) throw new UserError("No encuentro #tips-y-curiosidades.");
    const r = await this.d.sql.run("INSERT INTO tips (papu_id, texto, fuente, creado_at) VALUES (?, ?, ?, ?)", user, texto, fuente, this.now());
    const id = r.lastRowId;
    const msg = await this.d.discord.call<{ id: string }>("luka", "POST", `/channels/${ch}/messages`, {
      content: await this.pick("luka", "tip_recibido", { papu: `<@${user}>` }),
      embeds: [{ title: `💡 Tip #${id}`, description: texto, color: this.d.colors.luka, fields: [{ name: "Fuente", value: fuente }] }],
      allowed_mentions: { users: [user] },
    });
    await this.d.sql.run("UPDATE tips SET message_id = ? WHERE id = ?", msg.id, id);
    return { content: `¡Gracias! Tu tip **#${id}** quedó en <#${ch}>. Si llega a un video, sales en los créditos y en el Salón de la Fama 🐟` };
  }

  private async tipUsado(o: Options): Promise<Reply> {
    const id = o.int("tip", true);
    const video = o.str("video", true);
    const t = await this.d.sql.get<{ papu_id: string; texto: string; fuente: string; usado_at: number | null }>("SELECT * FROM tips WHERE id = ?", id);
    if (!t) throw new UserError("No existe ese tip.");
    if (t.usado_at) throw new UserError(`El tip #${id} ya está en el Salón de la Fama.`);
    const ch = await this.channel("salon-de-la-fama");
    if (!ch) throw new UserError("No encuentro #salón-de-la-fama.");
    await this.d.discord.call("luka", "POST", `/channels/${ch}/messages`, {
      content: await this.pick("luka", "tip_usado", { papu: `<@${t.papu_id}>`, video }),
      embeds: [{ title: `🏆 Tip #${id}`, description: t.texto, color: this.d.colors.luka, fields: [{ name: "Fuente", value: t.fuente }] }],
      allowed_mentions: { users: [t.papu_id] },
    });
    await this.d.sql.run("UPDATE tips SET usado_video = ?, usado_at = ? WHERE id = ?", video, this.now(), id);
    return { content: `Listo: el tip #${id} está en <#${ch}> ✨` };
  }

  // ───────────────────────── tareas programadas ─────────────────────────

  /** Cada 15 minutos: recordar y cerrar votaciones; alertas de plazo de los pedidos. */
  async cron(): Promise<void> {
    await this.pollTasks();
    await this.roundTasks().catch((e) => console.error("votación semanal", e));
    await this.honorTasks().catch((e) => console.error("votación de honor", e));
    for (const o of await this.orders.dueSoon()) {
      const key = `aviso_plazo:${o.id}:${o.plazoAt}`;
      if (await this.kvGet(key)) continue;
      await this.kvSet(key, "1");
      await this.notifyOwner(`⏰ El pedido **#${o.id}** (${OCCASIONS[o.ocasion]}) vence <t:${unix(o.plazoAt)}:R> · ${STATE_LABEL[o.estado]}`);
    }
  }

  async pollTasks(): Promise<void> {
    const open = await this.d.sql.all<{ id: number; canal: string; channel_id: string; message_id: string; ends_at: number; recordado: number }>(
      "SELECT id, canal, channel_id, message_id, ends_at, recordado FROM votaciones WHERE cerrada = 0",
    );
    const t = this.now();
    for (const v of open) {
      const ref = { message_reference: { message_id: v.message_id, fail_if_not_exists: false } };
      if (!v.recordado && t >= v.ends_at - 12 * HOUR && t < v.ends_at) {
        const aviso = await this.audience(v.canal);
        await this.d.discord.call("miku", "POST", `/channels/${v.channel_id}/messages`, {
          content: aviso.mention(await this.pick("miku", "ultimo_aviso")),
          ...ref,
          allowed_mentions: aviso.allowed_mentions,
        });
        await this.d.sql.run("UPDATE votaciones SET recordado = 1 WHERE id = ?", v.id);
      }
      if (t < v.ends_at) continue;
      const msg = await this.d.discord.call<{ poll?: PollData }>("miku", "GET", `/channels/${v.channel_id}/messages/${v.message_id}`).catch(() => null);
      if (!msg?.poll) {
        await this.d.sql.run("UPDATE votaciones SET cerrada = 1 WHERE id = ?", v.id);
        continue;
      }
      if (!msg.poll.results?.is_finalized) continue;
      const round = await this.d.sql.get<RoundRow>("SELECT * FROM rondas WHERE votacion_id = ? AND estado = 'abierta'", v.id);
      if (round) {
        const text = await this.closeRound(round, msg.poll);
        await this.d.discord.call("miku", "POST", `/channels/${v.channel_id}/messages`, { content: text, ...ref, allowed_mentions: { parse: [] } });
        await this.d.sql.run("UPDATE votaciones SET cerrada = 1 WHERE id = ?", v.id);
        continue;
      }
      const ganador = pollWinner(msg.poll);
      const content = ganador.length
        ? await this.pick("miku", "ganador", { ganador: ganador.length === 1 ? ganador[0]! : `${ganador.join(" y ")} (¡empate! GyroP decide)` })
        : "Nadie votó esta vez… ¡GyroP decide! 🎤";
      await this.d.discord.call("miku", "POST", `/channels/${v.channel_id}/messages`, { content, ...ref, allowed_mentions: { parse: [] } });
      await this.d.sql.run("UPDATE votaciones SET cerrada = 1, ganador = ? WHERE id = ?", ganador.join(" | ") || null, v.id);
      await this.closeHonor(v.id, ganador).catch((e) => console.error("cierre de honor", e));
    }
  }

  // ───────────────────────── apoyo ─────────────────────────

  private async notifyOwner(text: string): Promise<void> {
    const ch = await this.channel("registro-bots");
    if (!ch) return;
    await this.d.discord.call("miku", "POST", `/channels/${ch}/messages`, { content: `<@${this.d.ownerId}> ${text}`, allowed_mentions: { users: [this.d.ownerId] } });
  }

  /** Id de un canal por su nombre sin emoji ("votaciones", "salon-de-la-fama"…). */
  async channel(key: string): Promise<string | null> {
    if (!this.channelCache?.has(key)) {
      const list = await this.d.discord.call<{ id: string; name: string; type: number }[]>("miku", "GET", `/guilds/${this.d.guildId}/channels`);
      this.channelCache = new Map(list.filter((c) => c.type === 0).map((c) => [channelKey(c.name), c.id]));
    }
    return this.channelCache.get(key) ?? null;
  }

  /** Mencion a los roles que ven el canal (audienceOf), solo esos: nunca @everyone ni @here. */
  private async audience(canal: string): Promise<{ mention: (text: string) => string; allowed_mentions: { parse: string[]; roles: string[] } }> {
    const keys = new Set(audienceOf(canal));
    const roles = keys.size ? await this.d.discord.call<{ id: string; name: string; managed?: boolean }[]>("miku", "GET", `/guilds/${this.d.guildId}/roles`) : [];
    const ids = roles.filter((r) => !r.managed && keys.has(channelKey(r.name))).map((r) => r.id);
    const prefix = ids.map((id) => `<@&${id}>`).join(" ");
    return { mention: (text) => (prefix ? `${prefix}\n${text}` : text), allowed_mentions: { parse: [], roles: ids } };
  }

  /** ¿Tiene el Papu ese nivel o uno superior? (los niveles son acumulativos; Ko-fi da solo el rol del nivel). */
  private async hasTier(memberRoles: string[], minTier: string): Promise<boolean> {
    const roles = await this.d.discord.call<{ id: string; name: string }[]>("miku", "GET", `/guilds/${this.d.guildId}/roles`);
    const idx = TIERS.indexOf(minTier);
    const allowed = new Set(TIERS.slice(idx));
    return roles.some((r) => allowed.has(channelKey(r.name)) && memberRoles.includes(r.id));
  }

  /** Frase fija del mazo (sin repetir; estado en la base). */
  async pick(bot: BotKey, group: string, vars: Record<string, string | number> = {}): Promise<string> {
    const list = PHRASES[bot][group];
    if (!list?.length) throw new Error(`No hay frases para ${bot}.${group}`);
    const key = `${bot}.${group}`;
    const row = await this.d.sql.get<{ order_json: string; pos: number; size: number }>("SELECT order_json, pos, size FROM decks WHERE deck_key = ?", key);
    const state: DeckState | null = row ? { order: JSON.parse(row.order_json) as number[], pos: row.pos, size: row.size } : null;
    const { index, next } = advanceDeck(state, list.length, this.rng);
    await this.d.sql.run(
      `INSERT INTO decks (deck_key, order_json, pos, size) VALUES (?, ?, ?, ?)
       ON CONFLICT(deck_key) DO UPDATE SET order_json = excluded.order_json, pos = excluded.pos, size = excluded.size`,
      key,
      JSON.stringify(next.order),
      next.pos,
      next.size,
    );
    return fill(list[index]!, vars);
  }

  private async kvGet(key: string): Promise<string | null> {
    return (await this.d.sql.get<{ value: string }>("SELECT value FROM kv WHERE key = ?", key))?.value ?? null;
  }

  private async kvSet(key: string, value: string): Promise<void> {
    await this.d.sql.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  private summary(o: Order, full: boolean, detailMax = 1000): string {
    const names = Object.fromEntries(this.d.cast.map((c) => [c.id, c.name]));
    const voc = o.vocaloids.map((v) => names[v] ?? v).join(", ");
    const lines = [`${PRODUCTS[o.producto].label} · ${OCCASIONS[o.ocasion]} · 🎤 ${voc}`];
    if (!full) return [...lines, `Para **${o.para}**`].join("\n");
    lines[0] += ` · ${STATE_LABEL[o.estado]} · plazo <t:${unix(o.plazoAt)}:D>`;
    lines.push(
      `👤 ${o.origen === "tienda" ? `Tienda${o.comprador ? ` (${o.comprador})` : ""}${o.papuId ? ` · <@${o.papuId}>` : ""}` : `<@${o.papuId}>`} → para **${o.para}**${o.pronunciacion ? ` (se pronuncia: ${o.pronunciacion})` : ""}`,
    );
    if (o.detalles) lines.push(`📝 ${o.detalles.slice(0, detailMax)}`);
    if (o.fechaLimite) lines.push(`📅 Fecha límite pedida: ${o.fechaLimite}`);
    lines.push(o.publicar ? "📣 Se puede publicar en el canal" : "🔒 No publicar");
    if (o.revisar) lines.push(`⚠️ Revisar: ${o.revisar}`);
    if (o.motivo) lines.push(`💬 ${o.motivo}`);
    return lines.join("\n");
  }
}

export interface PollData {
  answers: { answer_id: number; poll_media: { text?: string } }[];
  results?: { is_finalized: boolean; answer_counts: { id: number; count: number }[] };
}

const PALETTE = (layout as { coloresPapu?: { colores: { rol: string; color: string }[] } }).coloresPapu?.colores ?? [];

const CANDIDATE_LABEL: Record<string, string> = { en_votacion: "🗳️ en votación", sigue: "🔁 sigue (2.º lugar)", espera: "⏳ en espera", ganador: "🏆 ganó" };

/** Votos por texto de opcion. */
export function pollCounts(poll: PollData): Record<string, number> {
  const byId = new Map((poll.results?.answer_counts ?? []).map((c) => [c.id, c.count]));
  return Object.fromEntries(poll.answers.map((a) => [a.poll_media.text ?? "?", byId.get(a.answer_id) ?? 0]));
}

/** Opcion(es) con mas votos (varias si hay empate; ninguna si nadie voto). */
export function pollWinner(poll: PollData): string[] {
  const counts = poll.results?.answer_counts ?? [];
  const max = Math.max(0, ...counts.map((c) => c.count));
  if (max === 0) return [];
  const ids = new Set(counts.filter((c) => c.count === max).map((c) => c.id));
  return poll.answers.filter((a) => ids.has(a.answer_id)).map((a) => a.poll_media.text ?? "?");
}

/** "Lun 20: Teto | Jue 23: Miku" -> una linea por fecha. */
export function splitLines(text: string): string {
  return text
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `• ${s}`)
    .join("\n");
}

class Options {
  private readonly list: Option[];
  private readonly subName: string | null;

  constructor(options: Option[]) {
    const sub = options.find((x) => x.type === 1);
    this.subName = sub?.name ?? null;
    this.list = sub ? (sub.options ?? []) : options;
  }

  sub(): string {
    return this.subName ?? "";
  }

  str(name: string, required: true): string;
  str(name: string, required?: false): string | null;
  str(name: string, required = false): string | null {
    const v = this.list.find((x) => x.name === name)?.value;
    if (v === undefined || v === null || v === "") {
      if (required) throw new UserError(`Falta la opción "${name}".`);
      return null;
    }
    return String(v);
  }

  int(name: string, required: true): number;
  int(name: string, required?: false): number | null;
  int(name: string, required = false): number | null {
    const v = this.str(name, required as false);
    return v === null ? null : Number(v);
  }

  bool(name: string): boolean | null {
    const v = this.list.find((x) => x.name === name)?.value;
    return typeof v === "boolean" ? v : null;
  }
}
