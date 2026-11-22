// Logica del worker de Cloudflare (24/7, aunque el PC de GyroP este apagado):
// - Miku: votaciones con encuesta (/votacion), calendario, estrenos y noticias (la cola de videos personalizados se
//   quitó el 13 nov. 2026: GyroP los coordina por chat);
// - Luka: sin comandos desde el 13 nov. 2026 (los tips se quitaron; el salon de la fama lo lleva Teto con ⭐);
// - votacion semanal (config/votaciones.json): Miku la abre sola; el segundo lugar pasa a la ronda siguiente;
// - tareas programadas: recordar y cerrar votaciones (ganador).
// Todo con frases fijas (regla 4, sin LLM ni cuota).
import lukaPhrases from "../../content/frases/luka.json";
import mikuPhrases from "../../content/frases/miku.json";
import moderation from "../../config/moderacion.json";
import layout from "../../config/servidor.json";
import votesConfig from "../../config/votaciones.json";
import { RuleSet, type ModerationSettings } from "../../src/moderation/rules";
import type { Sql } from "../../src/cloud/sql";
import { advanceDeck, fill, type DeckState } from "../../src/phrases/deck-core";
import { AVISOS_MENU_ID, avisosChange, colorKey, COUNTRY_MENU_ID, isColorMenu, NO_COLOR, NO_COUNTRY } from "../../src/setup/color-menu";
import {
  claveIdentidad,
  ESCRIBIR,
  IDENTIDAD_CAMPO_ID,
  identidadModal,
  opcionesDe,
  queIdentidad,
  QUITAR,
  rolIdentidad,
  tipoDeMenu,
  tipoDeModal,
  validarIdentidad,
  type IdentidadConfig,
  type IdentidadTipo,
} from "../../src/setup/identidad";
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
import { tituloDe, type NovedadEtiqueta } from "../../src/setup/novedades";
import {
  CUMPLE_BOTON_ID,
  CUMPLE_CAMPOS,
  CUMPLE_MODAL_ID,
  CUMPLE_NO_ID,
  CUMPLE_OK_ID,
  cumpleConfirmar,
  cumpleModal,
  deClave,
  fechaTexto,
  leerFecha,
  type Fecha,
} from "../../src/setup/cumple";
import { channelKey, type BotKey, type DiscordApi } from "./discord";

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
  /** Comando (type 2): name/options. Menu (type 3): custom_id/values. Ventanita (type 5): custom_id/components. */
  data?: {
    name?: string;
    options?: Option[];
    custom_id?: string;
    values?: string[];
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
  member?: { user: { id: string }; roles: string[] };
  user?: { id: string };
}

export interface Reply {
  content?: string;
  embeds?: Record<string, unknown>[];
  /** Botones (p. ej. confirmar el cumpleaños); [] los quita al editar. */
  components?: Record<string, unknown>[];
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
  for (const cat of (layout as { categorias: { leen: string; canales: { nombre: string; voz?: boolean; leen?: string }[] }[] }).categorias) {
    const ch = cat.canales.find((c) => !c.voz && channelKey(c.nombre) === canal);
    if (!ch) continue;
    // Acceso del canal (PLAN §8: en 💎 Membresías cada canal tiene el suyo) o, si no, el de su categoría.
    const leen = ch.leen ?? cat.leen;
    if (leen.startsWith("rol:")) return [channelKey(leen.slice(4))];
    const idx = TIERS.indexOf(channelKey(leen));
    return idx < 0 ? [] : TIERS.slice(idx);
  }
  return [];
}
const COMMAND_TIMEOUT_MS = 10_000;
const SLOW_REPLY =
  "Esto está tardando más de lo normal 🙈 Puede que se haya registrado igual: revísalo en un momento antes de intentarlo de nuevo.";
const POLL_QUESTIONS: Record<string, string> = {
  votaciones: "¿Qué tema quieren para el próximo video?",
  "propuestas-de-temas": "¿Cuál eligen, Papus?",
  "preguntas-a-gyrop": "¿Qué tema quieren para el especial?",
  "votacion-de-honor": "¿Qué video quieren que salga esta semana, Papus de honor?",
};

export class UserError extends Error {}

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
  private readonly rules: RuleSet;
  private readonly now: () => number;
  private readonly rng: () => number;
  /** Canales de texto (0) y foros (15) por nombre sin emoji; los foros con sus etiquetas. */
  private channelCache: Map<string, { id: string; foro: boolean; tags: { id: string; name: string }[] }> | null = null;
  private readonly rounds: RoundSettings;
  private readonly honor: HonorSettings;

  constructor(private readonly d: WorkerDeps) {
    this.now = d.now ?? Date.now;
    this.rng = d.rng ?? Math.random;
    this.rounds = d.rounds ?? parseRoundSettings(votesConfig);
    this.honor = d.honor ?? parseHonorSettings(votesConfig.honor);
    this.rules = new RuleSet(moderation as ModerationSettings);
  }

  // ───────────────────────── interacciones ─────────────────────────

  /** Respuesta inmediata a Discord (en menos de 3 s) y el trabajo que se hace despues. */
  handle(bot: BotKey, i: Interaction): { response: Record<string, unknown>; work?: () => Promise<void> } {
    if (i.type === 1) return { response: { type: 1 } };
    // Pronombres o genero con "Escribir los mios": se abre la ventanita al tiro (no se puede diferir).
    const identidad = i.type === 3 ? tipoDeMenu(i.data?.custom_id) : null;
    if (identidad && i.data?.values?.[0] === ESCRIBIR) return { response: { type: 9, data: identidadModal(IDENTIDAD, identidad) } };
    // Cumpleaños (#tus-roles, 18 nov. 2026): el botón abre la ventanita al tiro; confirmar edita el mismo mensaje.
    const cid = i.data?.custom_id ?? "";
    if (i.type === 3 && cid === CUMPLE_BOTON_ID) return { response: { type: 9, data: cumpleModal() } };
    const confirma = i.type === 3 && (cid.startsWith(`${CUMPLE_OK_ID}:`) || cid === CUMPLE_NO_ID);
    const isMenu =
      (i.type === 3 && (isColorMenu(i.data?.custom_id) || !!identidad || [COUNTRY_MENU_ID, AVISOS_MENU_ID].includes(i.data?.custom_id ?? ""))) ||
      (i.type === 5 && (!!tipoDeModal(i.data?.custom_id) || cid === CUMPLE_MODAL_ID)) ||
      confirma;
    if ((i.type !== 2 && !isMenu) || !i.data) return { response: { type: 4, data: { content: "No sé qué hacer con eso 🙈", flags: EPHEMERAL } } };
    return {
      // Respuesta diferida y privada: el resultado se escribe despues, cuando termina el trabajo. Un botón de
      // confirmar edita su propio mensaje (type 6).
      response: confirma ? { type: 6 } : { type: 5, data: { flags: EPHEMERAL } },
      work: async () => {
        let reply: Reply;
        // Tope de tiempo: si el comando se demora (Discord lento, base ocupada…), se responde igual con un aviso.
        // El comando puede terminar despues (ej.: la votacion queda creada); por eso el aviso pide revisar antes de repetir.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), this.d.commandTimeoutMs ?? COMMAND_TIMEOUT_MS)));
        try {
          const r = await Promise.race([this.route(bot, i), timeout]);
          reply = r === "timeout" ? { content: SLOW_REPLY } : r;
          if (r === "timeout") console.error(`/${i.data?.name}: superó el tope de tiempo`);
        } catch (e) {
          reply = { content: e instanceof UserError ? e.message : "Algo falló de mi lado. Inténtalo de nuevo en un rato 🙏" };
          if (!(e instanceof UserError)) console.error(`/${i.data?.name}`, e);
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
    if (i.type === 3 && isColorMenu(i.data!.custom_id)) return this.pickColor(user, i.member?.roles ?? [], i.data!.values?.[0] ?? NO_COLOR);
    if (i.type === 3 && i.data!.custom_id === COUNTRY_MENU_ID) return this.pickCountry(user, i.member?.roles ?? [], i.data!.values?.[0] ?? NO_COUNTRY);
    if (i.type === 3 && i.data!.custom_id === AVISOS_MENU_ID) return this.pickAvisos(user, i.member?.roles ?? [], i.data!.values ?? []);
    const cid = i.data!.custom_id ?? "";
    if (i.type === 5 && cid === CUMPLE_MODAL_ID) {
      const campo = (k: string) => (i.data!.components ?? []).flatMap((r) => r.components ?? []).find((c) => c.custom_id === k)?.value ?? "";
      return this.cumplePedir(user, campo(CUMPLE_CAMPOS.dia), campo(CUMPLE_CAMPOS.mes));
    }
    if (i.type === 3 && cid === CUMPLE_NO_ID) return { content: "Listo, no guardé nada. Cuando quieras, vuelve a tocar **🎂 Registrar mi cumpleaños**.", components: [] };
    if (i.type === 3 && cid.startsWith(`${CUMPLE_OK_ID}:`)) return this.cumpleGuardar(user, cid.slice(CUMPLE_OK_ID.length + 1));
    const menuTipo = i.type === 3 ? tipoDeMenu(i.data!.custom_id) : null;
    if (menuTipo) return this.pickIdentidad(user, i.member?.roles ?? [], menuTipo, i.data!.values?.[0] ?? QUITAR);
    const modalTipo = i.type === 5 ? tipoDeModal(i.data!.custom_id) : null;
    if (modalTipo) {
      const campo = (i.data!.components ?? []).flatMap((r) => r.components ?? []).find((c) => c.custom_id === IDENTIDAD_CAMPO_ID);
      return this.writeIdentidad(user, i.member?.roles ?? [], modalTipo, campo?.value ?? "");
    }
    const o = new Options(i.data!.options ?? []);
    if (bot === "miku") {
      this.ownerOnly(user);
      if (name === "votacion") return this.votacion(o);
      if (name === "estreno") return this.estreno(o);
      // #anuncios se juntó con #novedades (PLAN §8, 13 nov. 2026).
      // #novedades es un foro desde el 13 nov. 2026: cada noticia es una publicación con su título.
      if (name === "noticia") {
        const texto = o.str("texto", true);
        return this.postContent("miku", "novedades", await this.pick("miku", "noticia", { texto }), { titulo: tituloDe(texto, "📰 "), etiqueta: "Noticia" });
      }
    }
    throw new UserError("Ese comando no existe (¿quedó viejo?).");
  }

  private ownerOnly(user: string): void {
    if (user !== this.d.ownerId) throw new UserError("Eso solo lo usa GyroP 🎤");
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
    const titulo = o.str("titulo", true);
    const content = `${await this.pick("miku", "estreno", { video: titulo })}\n${enlace}`;
    const reply = await this.postContent("miku", "novedades", content, { titulo: tituloDe(titulo, "🎬 Estreno: "), etiqueta: "Estreno" });
    // Hora feliz de XP (config/niveles.json -> estrenos): la abre el bot del PC al leer esta fila.
    await this.d.sql.run("INSERT INTO estrenos (titulo, at) VALUES (?, ?)", titulo, this.now());
    return { content: `${reply.content} La XP multiplicada empieza en cuanto el bot del PC lo lea (menos de un minuto si está encendido).` };
  }


  /** Publica en un canal; si es un foro, abre una publicación con `foro.titulo` y su etiqueta. */
  private async postContent(bot: BotKey, canal: string, content: string, foro?: { titulo: string; etiqueta: NovedadEtiqueta }): Promise<Reply> {
    await this.channel(canal);
    const ch = this.channelCache?.get(canal);
    if (!ch) throw new UserError(`No encuentro el canal #${canal}.`);
    const aviso = await this.audience(canal);
    const message = { content: aviso.mention(content), allowed_mentions: aviso.allowed_mentions };
    if (!ch.foro) {
      await this.d.discord.call(bot, "POST", `/channels/${ch.id}/messages`, message);
      return { content: `Publicado en <#${ch.id}> ✨` };
    }
    const tag = ch.tags.find((t) => t.name === foro?.etiqueta)?.id;
    const hilo = await this.d.discord.call<{ id: string }>(bot, "POST", `/channels/${ch.id}/threads`, {
      name: foro?.titulo ?? tituloDe(content),
      applied_tags: tag ? [tag] : [],
      message,
    });
    return { content: `Publicado en <#${hilo.id}> ✨` };
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

  // ───────────────────────── #tus-roles desde el celular de Neru (app Roles, PLAN §3.15) ─────────────────────────

  private async rolesDelPapu(user: string): Promise<{ memberRoles: string[]; nombreDe: Map<string, string> }> {
    const member = await this.d.discord.call<{ roles: string[] }>("miku", "GET", `/guilds/${this.d.guildId}/members/${user}`);
    const roles = await this.d.discord.call<{ id: string; name: string; managed?: boolean }[]>("miku", "GET", `/guilds/${this.d.guildId}/roles`);
    return { memberRoles: member.roles, nombreDe: new Map(roles.filter((r) => !r.managed).map((r) => [r.id, r.name])) };
  }

  /** Lo que tiene elegido en #tus-roles y las opciones (las mismas de los menús de Miku). */
  async celularRoles(user: string): Promise<unknown> {
    const { memberRoles, nombreDe } = await this.rolesDelPapu(user);
    const tiene = new Set(memberRoles.map((id) => colorKey(nombreDe.get(id) ?? "")));
    const identidad = await this.d.sql.all<{ tipo: string; nombre: string }>(
      "SELECT p.tipo, r.nombre FROM identidad_papus p JOIN identidad_roles r ON r.role_id = p.role_id WHERE p.papu_id = ?",
      user,
    );
    return {
      colores: PALETTE.map((c) => ({ clave: colorKey(c.rol), nombre: c.rol.replace(/^🎨\s*/, ""), color: c.color, puesto: tiene.has(colorKey(c.rol)) })),
      paises: COUNTRIES.map((p) => ({ clave: colorKey(p), nombre: p, puesto: tiene.has(colorKey(p)) })),
      avisos: AVISOS.map((a) => ({ clave: colorKey(a.rol), nombre: a.rol, descripcion: a.descripcion, puesto: tiene.has(colorKey(a.rol)) })),
      pronombres: { opciones: opcionesDe(IDENTIDAD, "pronombres").map((o) => ({ clave: claveIdentidad(o), nombre: o })), actual: identidad.find((x) => x.tipo === "pronombres")?.nombre ?? null },
      genero: { opciones: opcionesDe(IDENTIDAD, "genero").map((o) => ({ clave: claveIdentidad(o), nombre: o })), actual: identidad.find((x) => x.tipo === "genero")?.nombre ?? null },
    };
  }

  /** Cambia algo de #tus-roles con las mismas reglas que los menús. Devuelve el mensaje para el Papu (o UserError). */
  async celularRolesElegir(user: string, d: { tipo?: string; valor?: string; valores?: string[]; texto?: string }): Promise<string> {
    const { memberRoles } = await this.rolesDelPapu(user);
    const texto = (r: Reply) => String(r.content ?? "").replace(/\*\*/g, "").split("\n")[0]!;
    if (d.tipo === "color") return texto(await this.pickColor(user, memberRoles, String(d.valor ?? NO_COLOR)));
    if (d.tipo === "pais") return texto(await this.pickCountry(user, memberRoles, String(d.valor ?? NO_COUNTRY)));
    if (d.tipo === "avisos") return texto(await this.pickAvisos(user, memberRoles, Array.isArray(d.valores) ? d.valores.map(String).slice(0, 25) : []));
    if (d.tipo === "pronombres" || d.tipo === "genero") {
      if (typeof d.texto === "string" && d.texto.trim()) return texto(await this.writeIdentidad(user, memberRoles, d.tipo, d.texto.slice(0, 60)));
      return texto(await this.pickIdentidad(user, memberRoles, d.tipo, String(d.valor ?? QUITAR)));
    }
    throw new UserError("No sé cambiar eso 🙈");
  }

  // ───────────────────────── cumpleaños (#tus-roles; 18 nov. 2026) ─────────────────────────

  private async cumpleDe(user: string): Promise<Fecha | null> {
    const r = await this.d.sql.get<{ dia: number; mes: number }>("SELECT dia, mes FROM cumpleanos WHERE papu_id = ?", user);
    return r ? { dia: r.dia, mes: r.mes } : null;
  }

  private yaRegistrado(f: Fecha): Reply {
    return { content: `🎂 Ya registraste tu cumpleaños: **${fechaTexto(f)}**. No se puede cambiar por tu cuenta; si te equivocaste, pídeselo a un Mod o a GyroP.`, components: [] };
  }

  /** La ventanita: revisa la fecha y pide confirmar (después ya no se cambia). */
  private async cumplePedir(user: string, dia: string, mes: string): Promise<Reply> {
    const ya = await this.cumpleDe(user);
    if (ya) return this.yaRegistrado(ya);
    const r = leerFecha(dia, mes);
    if (!r.ok) throw new UserError(`❌ ${r.motivo}`);
    return {
      content: `🎂 ¿Tu cumpleaños es el **${fechaTexto(r.fecha)}**?
> ⚠️ **Después no lo puedes cambiar** (solo un Mod o GyroP). Ese día Ruko te saluda en #general, ganas **XP ×2** todo el día y te llega la insignia del pastel 🎂.`,
      components: cumpleConfirmar(r.fecha),
    };
  }

  private async cumpleGuardar(user: string, clave: string): Promise<Reply> {
    const f = deClave(clave);
    if (!f) throw new UserError("Esa fecha no sirve. Vuelve a tocar **🎂 Registrar mi cumpleaños**.");
    const ya = await this.cumpleDe(user);
    if (ya) return this.yaRegistrado(ya);
    await this.d.sql.run("INSERT OR IGNORE INTO cumpleanos (papu_id, dia, mes, creado_at, por) VALUES (?, ?, ?, ?, ?)", user, f.dia, f.mes, this.now(), user);
    return { content: `🎂 ¡Listo! Tu cumpleaños quedó el **${fechaTexto(f)}**. Ruko lo avisará en #general unos días antes. ✨`, components: [] };
  }

  // ───────────────────────── color del nombre (menu de Miku en #tus-roles) ─────────────────────────

  /** Deja al Papu con un solo color de la paleta (o ninguno). Los colores van sobre todos los roles: se ve aunque tenga nivel. */
  private async pickColor(user: string, memberRoles: string[], value: string): Promise<Reply> {
    const choice = await this.pickOne(user, memberRoles, PALETTE.map((c) => c.rol), value, NO_COLOR, "color");
    if (!choice) return { content: "Listo: tu nombre vuelve al color de siempre ♡" };
    return { content: `¡Listo! Ahora eres color **${choice.replace(/^🎨\s*/, "")}** ✨` };
  }

  /** Deja al Papu con un solo pais (o ninguno): el rol solo pone la bandera y el nombre en su perfil. */
  private async pickCountry(user: string, memberRoles: string[], value: string): Promise<Reply> {
    const choice = await this.pickOne(user, memberRoles, COUNTRIES, value, NO_COUNTRY, "país");
    return { content: choice ? `¡Listo! Ahora tu perfil dice **${choice}** ✨` : "Listo: quité el país de tu perfil ♡" };
  }

  /** Avisos (varios a la vez): el Papu queda con exactamente los que dejo marcados en el menu. */
  private async pickAvisos(user: string, memberRoles: string[], values: string[]): Promise<Reply> {
    const roles = await this.d.discord.call<{ id: string; name: string; managed?: boolean }[]>("miku", "GET", `/guilds/${this.d.guildId}/roles`);
    const idOf = new Map(roles.filter((r) => !r.managed).map((r) => [colorKey(r.name), r.id]));
    const ch = avisosChange(AVISOS, values, memberRoles, idOf);
    for (const id of ch.remove) await this.d.discord.call("miku", "DELETE", `/guilds/${this.d.guildId}/members/${user}/roles/${id}`);
    for (const id of ch.add) await this.d.discord.call("miku", "PUT", `/guilds/${this.d.guildId}/members/${user}/roles/${id}`);
    if (ch.faltan.length) throw new UserError(`${ch.faltan.join(" y ")} todavía no existe en el servidor. Avísale a GyroP 🙈`);
    if (!ch.quedan.length) return { content: "Listo: ya no te etiqueto en ningún aviso ♡ (puedes volver a elegirlos cuando quieras)" };
    const lista = AVISOS.filter((a) => ch.quedan.includes(a.rol)).map((a) => `> ${a.rol}: ${a.descripcion.toLowerCase()}`);
    const pie = "-# Lo que no marcaste se quitó. Para cambiarlos, vuelve a marcar todos los que quieras.";
    return { content: ["¡Listo! Ahora te aviso de esto ✨", ...lista, pie].join("\n") };
  }

  // ───────────────────────── pronombres y genero (menus de Miku en #tus-roles) ─────────────────────────

  /** Opcion de la lista o "Quitar" (escribir abre la ventanita en handle). */
  private async pickIdentidad(user: string, memberRoles: string[], tipo: IdentidadTipo, value: string): Promise<Reply> {
    if (value === QUITAR) return this.setIdentidad(user, memberRoles, tipo, null, false);
    const texto = opcionesDe(IDENTIDAD, tipo).find((o) => claveIdentidad(o) === value);
    if (!texto) throw new UserError("Esa opción ya no está en el menú 🙈");
    return this.setIdentidad(user, memberRoles, tipo, texto, false);
  }

  /** Lo que escribio el Papu: pasa por el filtro fijo de Neru y la lista de burlas; si no pasa, se rechaza en privado. */
  private async writeIdentidad(user: string, memberRoles: string[], tipo: IdentidadTipo, texto: string): Promise<Reply> {
    const ofensivo = (t: string) => !!this.rules.check({ text: t, targetsSomeone: false, memberAgeHours: 1000, personalData: true })?.remove;
    const v = validarIdentidad(IDENTIDAD, texto, ofensivo);
    if (!v.ok) throw new UserError(`${v.motivo} Prueba con otro texto o elige una opción del menú ♡`);
    // Si escribio algo que ya esta en la lista, usa ese rol (no cuenta como escrito).
    const deLista = opcionesDe(IDENTIDAD, tipo).find((o) => claveIdentidad(o) === claveIdentidad(v.texto));
    return this.setIdentidad(user, memberRoles, tipo, deLista ?? v.texto, !deLista);
  }

  /**
   * Deja al Papu con un solo rol de ese tipo (o ninguno). Reutiliza el rol si otro ya lo tiene; si no, lo crea solo
   * decorativo (sin permisos, sin color, no separado, no mencionable; Discord lo pone al fondo de la lista). Solo toca
   * roles de identidad_roles: nunca otros roles del servidor.
   */
  private async setIdentidad(user: string, memberRoles: string[], tipo: IdentidadTipo, texto: string | null, escrito: boolean): Promise<Reply> {
    const g = this.d.guildId;
    const prev = await this.d.sql.get<{ role_id: string }>("SELECT role_id FROM identidad_papus WHERE papu_id = ? AND tipo = ?", user, tipo);
    let target: string | null = null;
    if (texto) {
      const clave = claveIdentidad(texto);
      const nombre = rolIdentidad(tipo, texto);
      const roles = await this.d.discord.call<{ id: string }[]>("miku", "GET", `/guilds/${g}/roles`);
      const known = await this.d.sql.get<{ role_id: string }>("SELECT role_id FROM identidad_roles WHERE tipo = ? AND clave = ?", tipo, clave);
      if (known && roles.some((r) => r.id === known.role_id)) target = known.role_id;
      else {
        if (known) await this.d.sql.run("DELETE FROM identidad_roles WHERE role_id = ?", known.role_id); // lo borraron a mano
        if (escrito) {
          const n = await this.d.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM identidad_roles WHERE escrito = 1");
          if ((n?.n ?? 0) >= IDENTIDAD.maxEscritos) {
            throw new UserError("Ya hay muchos roles escritos a mano. Elige una opción del menú o pídele a GyroP que agregue la tuya 🙏");
          }
        }
        const role = await this.d.discord.call<{ id: string }>("miku", "POST", `/guilds/${g}/roles`, {
          name: nombre,
          permissions: "0",
          color: 0,
          hoist: false,
          mentionable: false,
        });
        target = role.id;
        await this.d.sql.run(
          "INSERT INTO identidad_roles (role_id, tipo, clave, nombre, escrito, creado_at) VALUES (?, ?, ?, ?, ?, ?)",
          target,
          tipo,
          clave,
          nombre,
          escrito ? 1 : 0,
          this.now(),
        );
      }
      if (!memberRoles.includes(target)) await this.d.discord.call("miku", "PUT", `/guilds/${g}/members/${user}/roles/${target}`);
      await this.d.sql.run("INSERT OR REPLACE INTO identidad_papus (papu_id, tipo, role_id) VALUES (?, ?, ?)", user, tipo, target);
    } else {
      await this.d.sql.run("DELETE FROM identidad_papus WHERE papu_id = ? AND tipo = ?", user, tipo);
    }
    if (prev && prev.role_id !== target) {
      if (memberRoles.includes(prev.role_id)) await this.d.discord.call("miku", "DELETE", `/guilds/${g}/members/${user}/roles/${prev.role_id}`);
      await this.dropIdentidadRole(prev.role_id);
    }
    if (!texto) return { content: `Listo: quité ${queIdentidad(tipo)} de tu perfil ♡` };
    return { content: `¡Listo! Ahora tu perfil dice **${rolIdentidad(tipo, texto)}** ✨` };
  }

  /** Borra un rol escrito a mano cuando ya nadie lo tiene (los de la lista del menu se quedan). */
  private async dropIdentidadRole(roleId: string): Promise<void> {
    const row = await this.d.sql.get<{ escrito: number }>("SELECT escrito FROM identidad_roles WHERE role_id = ?", roleId);
    if (!row?.escrito) return;
    const usado = await this.d.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM identidad_papus WHERE role_id = ?", roleId);
    if (usado?.n) return;
    await this.d.discord.call("miku", "DELETE", `/guilds/${this.d.guildId}/roles/${roleId}`).catch((e) => console.error("borrar rol de identidad", e));
    await this.d.sql.run("DELETE FROM identidad_roles WHERE role_id = ?", roleId);
  }

  /** Le da al Papu un solo rol de `options` (o ninguno, con `none`) y le quita los demas. Devuelve el elegido. */
  private async pickOne(user: string, memberRoles: string[], options: string[], value: string, none: string, what: string): Promise<string | null> {
    const keyed = options.map((rol) => ({ rol, key: colorKey(rol) }));
    const choice = keyed.find((c) => c.key === value) ?? null;
    if (!choice && value !== none) throw new UserError(`Ese ${what} ya no está en el menú 🙈`);
    const roles = await this.d.discord.call<{ id: string; name: string; managed?: boolean }[]>("miku", "GET", `/guilds/${this.d.guildId}/roles`);
    // Sin los roles propios de los bots: el de Gumi, Kaito o Haku se llama igual que su color y no se puede asignar.
    const idOf = new Map(roles.filter((r) => !r.managed).map((r) => [colorKey(r.name), r.id]));
    const target = choice ? idOf.get(choice.key) : undefined;
    if (choice && !target) throw new UserError(`Ese ${what} todavía no existe en el servidor. Avísale a GyroP 🙈`);
    for (const c of keyed) {
      const id = idOf.get(c.key);
      if (id && id !== target && memberRoles.includes(id)) await this.d.discord.call("miku", "DELETE", `/guilds/${this.d.guildId}/members/${user}/roles/${id}`);
    }
    if (target && !memberRoles.includes(target)) await this.d.discord.call("miku", "PUT", `/guilds/${this.d.guildId}/members/${user}/roles/${target}`);
    return choice?.rol ?? null;
  }

  /**
   * Aviso en #vitrina (lo que pasa en los canales de los niveles, sin regalar el contenido). Desde el 13 nov. 2026
   * #vitrina está en el Archivo (PLAN §8): ya no se publica nada.
   */
  private async toVitrina(_content: string): Promise<void> {}

  /** Enlaces a canales para las frases de la vitrina. */
  private async links(): Promise<Record<string, string>> {
    const [niveles, votaciones] = await Promise.all([this.channel("membresias").then((c) => c ?? this.channel("niveles-ko-fi")), this.channel(this.rounds.canal)]);
    return { niveles: niveles ? `<#${niveles}>` : "ko-fi.com/tetociencia/tiers", votaciones: votaciones ? `<#${votaciones}>` : "#votaciones" };
  }

  // ───────────────────────── tareas programadas ─────────────────────────

  /** Cada 15 minutos: recordar y cerrar votaciones. */
  async cron(): Promise<void> {
    await this.pollTasks();
    await this.roundTasks().catch((e) => console.error("votación semanal", e));
    await this.honorTasks().catch((e) => console.error("votación de honor", e));
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
      const list = await this.d.discord.call<{ id: string; name: string; type: number; available_tags?: { id: string; name: string }[] }[]>(
        "miku",
        "GET",
        `/guilds/${this.d.guildId}/channels`,
      );
      // Foros primero: si un texto y un foro se llaman igual, gana el texto (lo de siempre).
      const usables = [...list.filter((c) => c.type === 15), ...list.filter((c) => c.type === 0)];
      this.channelCache = new Map(usables.map((c) => [channelKey(c.name), { id: c.id, foro: c.type === 15, tags: c.available_tags ?? [] }]));
    }
    return this.channelCache.get(key)?.id ?? null;
  }

  /** Mencion a los roles que ven el canal (audienceOf), solo esos: nunca @everyone ni @here. */
  private async audience(canal: string): Promise<{ mention: (text: string) => string; allowed_mentions: { parse: string[]; roles: string[] } }> {
    const keys = new Set(audienceOf(canal));
    const roles = keys.size ? await this.d.discord.call<{ id: string; name: string; managed?: boolean }[]>("miku", "GET", `/guilds/${this.d.guildId}/roles`) : [];
    const ids = roles.filter((r) => !r.managed && keys.has(channelKey(r.name))).map((r) => r.id);
    const prefix = ids.map((id) => `<@&${id}>`).join(" ");
    return { mention: (text) => (prefix ? `${prefix}\n${text}` : text), allowed_mentions: { parse: [], roles: ids } };
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

}

export interface PollData {
  answers: { answer_id: number; poll_media: { text?: string } }[];
  results?: { is_finalized: boolean; answer_counts: { id: number; count: number }[] };
}

const PALETTE = (layout as { coloresPapu?: { colores: { rol: string; color: string }[] } }).coloresPapu?.colores ?? [];
const COUNTRIES = (layout as { paisesPapu?: { paises: string[] } }).paisesPapu?.paises ?? [];
const IDENTIDAD = (layout as unknown as { identidadPapu: IdentidadConfig }).identidadPapu;
const AVISOS = (layout as { avisosPapu?: { avisos: { rol: string; descripcion: string }[] } }).avisosPapu?.avisos ?? [];

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
