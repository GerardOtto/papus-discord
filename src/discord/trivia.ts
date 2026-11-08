// Trivia en Discord (PLAN §3.4): /trivia de Teto muestra preguntas que solo ve quien juega (botones con opciones, o un
// cuadro para escribir), con tiempo limite. Cada acierto da XP al instante; al primer error (o tiempo agotado) Teto
// publica la racha en el canal donde se jugaba. Las reglas y el estado viven en src/trivia/.
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type ModalSubmitInteraction,
  type SendableChannels,
} from "discord.js";
import type { BotId } from "../config";
import { logError, type LogFn } from "../log";
import type { Phrases } from "../phrases/catalog";
import { renderFigure } from "../trivia/images";
import { renderLynx } from "../trivia/lince";
import { DIFICULTADES, type Dificultad } from "../trivia/rules";
import type { AnswerResult, Milestone, RunInfo, RunSummary, Shown, TriviaService } from "../trivia/service";
import { channelKey } from "./channels";
import type { LevelsDiscord } from "./levels";

const LETTERS = ["🇦", "🇧", "🇨", "🇩"];
/**
 * "trivia:otra:<dificultad>" (jugar otra igual), "trivia:nivel:<dificultad>" (pantalla de secciones), "trivia:menu" y
 * "trivia:pagar:<dificultad>:<xp>" (jugar una partida que cuesta XP, ya avisada).
 */
const AGAIN = "trivia:otra:";
const LEVEL = "trivia:nivel:";
const PAY = "trivia:pagar:";
const MENU_ID = "trivia:menu";
/** Margen despues del limite antes de dar la pregunta por perdida (lo que tarda Discord en entregar el clic). */
const GRACE_MS = 1500;
/** Con que reacciona cada Vocaloid al anuncio del secreto. */
const CHEER: Record<BotId, string> = {
  teto: "🥖",
  miku: "🩵",
  luka: "🐟",
  neru: "📱",
  gakupo: "🍆",
  kaito: "🍦",
  flower: "🎸",
  ia: "🌙",
  haku: "🌧️",
  gumi: "🥕",
  rin: "🍊",
  len: "🍌",
  meiko: "🎤",
  adachirei: "🤖",
  ruko: "🌓",
};
const PREMIO = { comun: "sobre común", raro: "sobre raro", legendario: "sobre legendario" } as const;
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Answerable = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
type Payload = { content: string; components: ActionRowBuilder<ButtonBuilder>[]; files: AttachmentBuilder[]; attachments: [] };

export interface TriviaDiscordDeps {
  trivia: TriviaService;
  levelsDiscord: LevelsDiscord;
  phrases: Phrases;
  online: readonly BotId[];
  clients: Partial<Record<BotId, Client>>;
  guild: () => Guild;
  sendable: (bot: BotId, channelId: string) => Promise<SendableChannels>;
  report: (text: string) => Promise<void>;
  log: LogFn;
}

export class TriviaDiscord {
  /** Por Papu: la ultima interaccion (para editar su mensaje privado cuando se acaba el tiempo) y el temporizador. */
  private readonly live = new Map<string, { i: Answerable; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly d: TriviaDiscordDeps) {}

  private get t(): TriviaService {
    return this.d.trivia;
  }

  // ───────────────────────── pantalla ─────────────────────────

  /** Linea de los limites del dia: partidas con XP y tope (decision de GyroP tras la prueba, idea de wiwi). */
  private limits(info: RunInfo): string {
    const max = this.t.settings.limites.partidasConXp;
    const castigo = this.t.settings.limites.castigo;
    const free = castigo ? castigo.desdePartida - 1 : Infinity;
    const back = `<t:${Math.ceil(info.resetsAt / 1000)}:R>`;
    if (info.cost > 0) return `-# 💸 Partida ${info.run} de hoy: te costó **${fmt(info.cost)} XP**. Las gratis vuelven ${back}.`;
    if (!info.withXp && info.run > free - 3) return `-# 🎮 Partida ${info.run} de hoy, sin XP. ⚠️ Desde la ${free + 1}, cada partida te quita XP (y el doble cada vez).`;
    if (!info.withXp) return `-# 🎮 Ya jugaste tus ${max} partidas con XP de hoy: esta va por la racha y la diversión. La XP vuelve ${back}.`;
    if (info.capLeft <= 0) return `-# ⭐ Llegaste al tope de XP de la trivia de hoy: sigue por la racha. La XP vuelve ${back}.`;
    return `-# ⭐ Partida ${info.run} de ${max} con XP hoy · puedes ganar hasta ${fmt(info.capLeft)} XP más en la trivia hoy.`;
  }

  /** "🟢 Fácil · 45/249 superadas" (con ✅ si ya la completó). */
  private counter(userId: string, level: Dificultad): string {
    const d = this.t.settings.dificultades[level];
    const p = this.t.progress(userId)[level];
    return `${d.emoji} **${d.nombre}** · ${fmt(p.done)}/${fmt(p.total)} superadas${p.prize ? " ✅" : ""}`;
  }

  /** "🎁 Hito: 137/200 aciertos para un sobre común" (vacío si esa dificultad no tiene hito). */
  private milestoneLine(userId: string, level: Dificultad): string {
    const m = this.t.milestones(userId, level);
    if (!m) return "";
    return `🎁 Hito: ${fmt(m.cada - m.left)}/${fmt(m.cada)} aciertos para un ${PREMIO[m.premio]}`;
  }

  /** Pantalla de secciones (decision de GyroP, 31 oct. 2026): fácil, media y difícil, con su contador y su premio. */
  private menu(userId: string, header: string[] = []): Payload {
    const s = this.t.settings;
    const progress = this.t.progress(userId);
    const solo = s.hitos?.soloPartidasConXp ? " (en las partidas con XP del día)" : "";
    const content = [
      ...header,
      "🧠 **Trivia Vocaloid** · elige la dificultad",
      "",
      ...DIFICULTADES.flatMap((l) => {
        const hito = this.milestoneLine(userId, l);
        return [`${this.counter(userId, l)} · premio: ${PREMIO[s.dificultades[l].premio]}${progress[l].prize ? " (¡ganado!)" : ""}`, ...(hito ? [`-# ${hito}`] : [])];
      }),
      "",
      `-# Una pregunta acertada queda superada para siempre. Supera todas las de una dificultad y Teto te regala su sobre para la tienda de Shaula-coins (/tienda). Además, cada tantos aciertos${solo} ganas el sobre de su hito, una y otra vez. Las partidas con XP del día son las mismas para las tres.`,
    ].join("\n");
    const buttons = DIFICULTADES.map((l) =>
      new ButtonBuilder().setCustomId(`${LEVEL}${l}`).setLabel(s.dificultades[l].nombre).setEmoji(s.dificultades[l].emoji).setStyle(l === "facil" ? ButtonStyle.Success : l === "medio" ? ButtonStyle.Primary : ButtonStyle.Danger),
    );
    return { content, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)], files: [], attachments: [] };
  }

  private async question(s: Shown, info: RunInfo, header: string[] = []): Promise<Payload> {
    const q = s.question;
    const d = this.t.settings.dificultades[q.level];
    const files: AttachmentBuilder[] = [];
    if (q.image) files.push(new AttachmentBuilder(await renderFigure(q.image.bot, q.image.mode), { name: "trivia.png" }));
    if (q.picture) files.push(new AttachmentBuilder(q.picture, { name: "trivia.webp" }));
    if (q.audio) files.push(new AttachmentBuilder(q.audio, { name: "fragmento.mp3" }));
    const streak = s.number - 1;
    const content = [
      ...header,
      `🧠 **Trivia Vocaloid** · ${d.emoji} ${d.nombre} · Pregunta ${s.number}${streak > 0 ? ` · 🔥 Racha: ${streak}` : ""}`,
      "",
      `**${q.text}**`,
      q.kind === "texto" ? "-# Toca el botón y escribe tu respuesta." : "",
      `⏳ Tiempo: <t:${Math.ceil(s.deadline / 1000)}:R>`,
      this.limits(info),
    ]
      .filter((l, k, a) => l !== "" || (k > 0 && a[k - 1] !== ""))
      .join("\n");
    const rows =
      q.kind === "opciones"
        ? s.options.map((o, k) =>
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(`trivia:o:${s.nonce}:${k}`).setLabel(o.slice(0, 80)).setEmoji(LETTERS[k]!).setStyle(ButtonStyle.Secondary),
            ),
          )
        : [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`trivia:t:${s.nonce}`).setLabel("Escribir respuesta").setEmoji("✍️").setStyle(ButtonStyle.Primary))];
    return { content, components: rows, files, attachments: [] };
  }

  private endScreen(res: Extract<AnswerResult, { end: RunSummary | null }>, end: RunSummary): Payload {
    const q = res.question;
    const lines: string[] = [];
    if (res.kind === "acierto") {
      const d = this.t.settings.dificultades[end.level];
      lines.push(`✅ ¡Correcto!${res.xp > 0 ? ` **+${fmt(res.xp)} XP**` : ""}`, "", `🌟 **¡Contestaste todas las preguntas ${d.emoji} ${d.nombre} sin fallar!**`);
      if (res.milestone) lines.push(`🎁 **¡Hito de ${fmt(res.milestone.n)} aciertos!** Ganaste un ${PREMIO[res.milestone.premio]} (/tienda → Sobres).`);
    } else {
      lines.push(res.kind === "tiempo" ? `⌛ **¡Se acabó el tiempo!** Era **${q.answer}**.` : `❌ **Incorrecto.** Era **${q.answer}**.`);
      if (q.fact) lines.push(`-# ${q.fact}`);
    }
    lines.push(
      "",
      `🏁 Racha final: **${end.streak}**${end.xp > 0 ? ` · **+${fmt(end.xp)} XP** en total` : ""}${end.record ? " · 🏆 ¡tu mejor racha!" : ` · tu mejor racha: ${end.best}`}`,
      this.counter(end.userId, end.level),
      ...[this.milestoneLine(end.userId, end.level)].filter(Boolean),
      "-# Teto publicó tu resultado en el canal.",
    );
    const again = new ButtonBuilder().setCustomId(`${AGAIN}${end.level}`).setLabel("Jugar otra vez").setEmoji("🔁").setStyle(ButtonStyle.Success);
    const menu = new ButtonBuilder().setCustomId(MENU_ID).setLabel("Cambiar dificultad").setEmoji("🧠").setStyle(ButtonStyle.Secondary);
    return { content: lines.join("\n"), components: [new ActionRowBuilder<ButtonBuilder>().addComponents(again, menu)], files: [], attachments: [] };
  }

  private correctHeader(res: Extract<AnswerResult, { kind: "acierto" }>): string[] {
    const hito = res.milestone ? [`🎁 **¡Hito de ${fmt(res.milestone.n)} aciertos!** Ganaste un ${PREMIO[res.milestone.premio]} (/tienda → Sobres).`] : [];
    return [`✅ ¡Correcto!${res.xp > 0 ? ` **+${fmt(res.xp)} XP**` : ""}${res.question.fact ? ` · ${res.question.fact}` : ""}`, ...hito, ""];
  }

  // ───────────────────────── temporizador ─────────────────────────

  private arm(userId: string, i: Answerable, s: Shown): void {
    this.disarm(userId);
    const timer = setTimeout(() => void this.expire(userId, s.nonce).catch((e) => logError("trivia (tiempo)", e)), Math.max(0, s.deadline - Date.now()) + GRACE_MS);
    timer.unref?.();
    this.live.set(userId, { i, timer });
  }

  private disarm(userId: string): void {
    const l = this.live.get(userId);
    if (l) clearTimeout(l.timer);
    this.live.delete(userId);
  }

  private async expire(userId: string, nonce: string): Promise<void> {
    const res = this.t.timeout(userId, nonce);
    if (!res || res.kind === "vieja") return;
    const l = this.live.get(userId);
    this.disarm(userId);
    if (l) await l.i.editReply(this.endScreen(res, res.end!)).catch(() => {});
    await this.publish(res.end!);
  }

  /**
   * Partida que cuesta XP (despues de la 15 del dia, decision de GyroP del 2 nov. 2026): antes de cobrar, Teto avisa
   * cuanto cuesta esta y la siguiente, y pide confirmacion.
   */
  private payScreen(level: Dificultad, cost: number, userId: string): Payload {
    const c = this.t.settings.limites.castigo!;
    const back = `<t:${Math.ceil(this.t.resetsAt() / 1000)}:R>`;
    const content = [
      `⚠️ **Ya jugaste ${c.desdePartida - 1} partidas de trivia hoy.**`,
      "",
      `Desde la ${c.desdePartida}, cada partida **te quita XP**, y la siguiente el doble: esta te cuesta **${fmt(cost)} XP** (la que sigue, ${fmt(Math.round(cost * c.factor))}). Puede bajarte de nivel.`,
      `Las partidas gratis vuelven ${back}. ¿Juegas igual?`,
      "",
      this.counter(userId, level),
    ].join("\n");
    const pay = new ButtonBuilder().setCustomId(`${PAY}${level}:${cost}`).setLabel(`Jugar igual (−${fmt(cost)} XP)`).setEmoji("💸").setStyle(ButtonStyle.Danger);
    const no = new ButtonBuilder().setCustomId(MENU_ID).setLabel("Mejor no").setEmoji("🧠").setStyle(ButtonStyle.Secondary);
    return { content, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(pay, no)], files: [], attachments: [] };
  }

  /** Empieza la partida (cobrando si corresponde) y muestra la primera pregunta. */
  private async begin(i: ChatInputCommandInteraction | ButtonInteraction, level: Dificultad, show: (p: Payload) => Promise<unknown>): Promise<void> {
    const { shown, busy, info, change } = this.t.start(i.user.id, i.channelId!, level);
    if (busy) {
      const text = `Ya tienes una trivia en curso (pregunta ${shown.number}). Contéstala o espera a que se acabe su tiempo. ⏳`;
      if (i.deferred || i.replied) return void (await i.followUp({ content: text, flags: MessageFlags.Ephemeral }));
      return void (await i.reply({ content: text, flags: MessageFlags.Ephemeral }));
    }
    // El temporizador va antes de mostrarla: si mostrarla falla, la pregunta igual vence y la partida se cierra.
    this.arm(i.user.id, i, shown);
    await show(await this.question(shown, info));
    if (info.cost > 0) this.d.log(`🧠 Trivia: partida ${info.run} de ${i.user.id}, −${info.cost} XP`);
    // El cobro pudo bajarlo de nivel: apodo y rol de honor.
    if (change) await this.d.levelsDiscord.handle(change, { channelId: i.channelId ?? undefined }).catch((e) => logError("nivel por trivia", e));
  }

  // ───────────────────────── comandos y botones ─────────────────────────

  /** /trivia [dificultad]: sin dificultad, la pantalla de secciones con los contadores. */
  async trivia(i: ChatInputCommandInteraction): Promise<void> {
    await this.reap(i.user.id);
    const level = i.options.getString("dificultad") as Dificultad | null;
    if (!level) return void (await i.reply({ ...this.menu(i.user.id), flags: MessageFlags.Ephemeral }));
    const cost = this.t.active(i.user.id) ? 0 : this.t.nextCost(i.user.id);
    if (cost > 0) return void (await i.reply({ ...this.payScreen(level, cost, i.user.id), flags: MessageFlags.Ephemeral }));
    if (this.t.active(i.user.id)) return this.begin(i, level, (p) => i.reply({ ...p, flags: MessageFlags.Ephemeral }));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await this.begin(i, level, (p) => i.editReply(p));
  }

  /** Botones de la trivia. Devuelve false si el boton no es de aqui. */
  async button(i: ButtonInteraction): Promise<boolean> {
    const [kind, action, nonce, k] = i.customId.split(":");
    if (kind !== "trivia") return false;
    if (i.customId === MENU_ID) return void (await i.update(this.menu(i.user.id))), true;
    if (i.customId.startsWith(AGAIN) || i.customId.startsWith(LEVEL) || i.customId.startsWith(PAY)) {
      const level = nonce as Dificultad;
      if (!DIFICULTADES.includes(level)) return false;
      await this.reap(i.user.id);
      // Si ya acepto pagar `k` XP y el costo no subio (no jugo otra mientras), se cobra; si no, se avisa de nuevo.
      const cost = this.t.active(i.user.id) ? 0 : this.t.nextCost(i.user.id);
      const agreed = action === "pagar" ? Number(k) : 0;
      if (cost > agreed) return void (await i.update(this.payScreen(level, cost, i.user.id))), true;
      // Responder a Discord antes de dibujar la pregunta (imágenes y audio tardan: pasado 3 s la interacción vence).
      await i.deferUpdate();
      await this.begin(i, level, (p) => i.editReply(p));
      return true;
    }
    if (action === "t") {
      const active = this.t.active(i.user.id);
      if (!active || active.nonce !== nonce) return void (await this.stale(i)), true;
      const modal = new ModalBuilder()
        .setCustomId(`trivia:m:${nonce}`)
        .setTitle(`Pregunta ${active.number}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId("respuesta").setLabel("Tu respuesta").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true),
          ),
        );
      await i.showModal(modal);
      return true;
    }
    if (action === "o") {
      await this.handle(i, this.t.answerOption(i.user.id, nonce!, Number(k)));
      return true;
    }
    return false;
  }

  /** Respuesta escrita (cuadro de las preguntas de texto). Devuelve false si no es de aqui. */
  async modal(i: ModalSubmitInteraction): Promise<boolean> {
    const [kind, action, nonce] = i.customId.split(":");
    if (kind !== "trivia" || action !== "m") return false;
    await this.handle(i, this.t.answerText(i.user.id, nonce!, i.fields.getTextInputValue("respuesta")));
    return true;
  }

  /** Si la partida del Papu quedó colgada (no se armó su temporizador), la cierra por tiempo y publica la racha. */
  private async reap(userId: string): Promise<void> {
    const end = this.t.reap(userId);
    if (!end) return;
    this.disarm(userId);
    this.d.log(`🧠 Trivia: partida colgada de ${userId} cerrada por tiempo (racha de ${end.streak})`);
    await this.publish(end).catch((e) => logError("trivia (partida colgada)", e));
  }

  private async stale(i: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
    await i.reply({ content: "Esa pregunta ya pasó. Usa /trivia para jugar otra vez. 🧠", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  private async handle(i: ButtonInteraction | ModalSubmitInteraction, res: AnswerResult): Promise<void> {
    if (res.kind === "vieja") return this.stale(i);
    const userId = i.user.id;
    // Responder a Discord antes de dibujar la siguiente pregunta: con imágenes o audio, en la nube puede pasar de los 3 s
    // y la interacción vence (así se colgó la trivia de Wicho el Bicho el 5 nov. 2026).
    if (i.isButton() || i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply({ flags: MessageFlags.Ephemeral });
    const update = (p: Payload) => i.editReply(p);
    if (res.kind === "acierto" && res.next) {
      // El temporizador va antes de mostrarla: si mostrarla falla, la pregunta igual vence y la partida se cierra.
      this.arm(userId, i, res.next);
      await update(await this.question(res.next, res.info, this.correctHeader(res)));
    } else {
      this.disarm(userId);
      await update(this.endScreen(res, res.end!));
    }
    // La XP del acierto pudo subirlo de nivel: apodo, rol de honor y, si cambia de rango, la frase de Teto.
    if (res.kind === "acierto" && res.change) await this.d.levelsDiscord.handle(res.change, { channelId: i.channelId ?? undefined }).catch((e) => logError("nivel por trivia", e));
    // Supero toda una dificultad: su sobre (ya entregado) y, si eran las tres, el secreto.
    if (res.kind === "acierto" && res.completed && i.channelId) await this.completed(userId, res.completed, i.channelId).catch((e) => logError("premio de la trivia", e));
    // Supero TODAS las preguntas (puede pasar sin completar una dificultad: quien ya tenia los tres sobres y supera las nuevas).
    // Hito de aciertos: su sobre (ya entregado) y el anuncio de Teto.
    if (res.kind === "acierto" && res.milestone && i.channelId) await this.milestone(userId, res.milestone, i.channelId).catch((e) => logError("hito de la trivia", e));
    if (res.kind === "acierto" && res.secret && i.channelId) await this.secret(userId, i.channelId).catch((e) => logError("secreto de la trivia", e));
    if (res.end) await this.publish(res.end);
  }

  /** Teto anuncia que el Papu supero todas las preguntas de una dificultad (y se lleva su sobre). */
  private async completed(userId: string, level: Dificultad, channelId: string): Promise<void> {
    const d = this.t.settings.dificultades[level];
    const ch = await this.d.sendable("teto", channelId).catch(() => null);
    if (ch) await ch.send({ content: d.mensaje.replaceAll("{papu}", `<@${userId}>`).replaceAll("{n}", fmt(this.t.totalOf(level))), allowedMentions: { users: [userId] } });
    await this.d.report(`🧠 <@${userId}> superó toda la trivia ${d.emoji} ${d.nombre} y ganó un sobre ${d.premio}.`);
  }

  /** Teto anuncia el hito de aciertos (pedido de GyroP, 7 nov. 2026) en el canal donde se jugaba. */
  private async milestone(userId: string, m: Milestone, channelId: string): Promise<void> {
    const d = this.t.settings.dificultades[m.level];
    const ch = await this.d.sendable("teto", channelId).catch(() => null);
    if (ch && d.hito) await ch.send({ content: d.hito.mensaje.replaceAll("{papu}", `<@${userId}>`).replaceAll("{n}", fmt(m.n)), allowedMentions: { users: [userId] } });
    await this.d.report(`🎁 <@${userId}> llegó a ${fmt(m.n)} aciertos en la trivia ${d.emoji} ${d.nombre} y ganó un ${PREMIO[m.premio]}.`);
  }

  // ───────────────────────── resultado ─────────────────────────

  private async publish(end: RunSummary): Promise<void> {
    const ch = await this.d.sendable("teto", end.channelId).catch(() => null);
    if (!ch) return void this.d.log(`🧠 Trivia: Teto no puede escribir en el canal ${end.channelId} (racha de ${end.streak})`);
    const papu = `<@${end.userId}>`;
    const text =
      end.streak === 0
        ? this.d.phrases.pick("teto", "trivia_cero", { papu })
        : end.xp > 0
          ? this.d.phrases.pick("teto", "trivia_racha", { papu, racha: end.streak, xp: fmt(end.xp) })
          : this.d.phrases.pick("teto", "trivia_racha_libre", { papu, racha: end.streak });
    const extra = end.record && end.streak >= 3 ? `\n🏆 ¡Nueva mejor racha de ${papu}!` : "";
    const d = this.t.settings.dificultades[end.level];
    const how = end.reason === "tiempo" ? "se le acabó el tiempo" : end.reason === "error" ? "falló una" : "¡no le quedaban preguntas!";
    await ch.send({ content: `${text}${extra}\n-# 🧠 /trivia ${d.emoji} ${d.nombre} · ${how} · mejor racha: ${end.best}`, allowedMentions: { users: [end.userId] } });
    this.d.log(`🧠 Trivia: racha de ${end.streak} (+${end.xp} XP, ${end.reason}) de ${end.userId}`);
  }

  /**
   * Supero TODAS las preguntas: el easter egg del Papu Lince (decision de GyroP, 2 nov. 2026). Rol de adorno; Teto avisa
   * y hace una cuenta regresiva; cada Vocaloid conectado dice su frase fija (secreto.coro, en orden; no se responden
   * entre ellos: es un anuncio armado); y Teto cierra con el mensaje, el diploma animado y la reaccion de todos.
   */
  private async secret(userId: string, channelId: string): Promise<void> {
    const s = this.t.settings.secreto;
    const papu = `<@${userId}>`;
    const fill = (text: string) => text.replaceAll("{papu}", papu).replaceAll("{n}", fmt(this.t.total)).replaceAll("{rol}", s.rol);
    await this.giveSecretRole(userId).catch((e) => logError("rol secreto de la trivia", e));
    const ch = await this.d.sendable("teto", channelId).catch(() => null);
    if (!ch) return;
    // El diploma se dibuja mientras corre la previa.
    const diploma = this.diploma(userId).catch((e) => (logError("diploma del Papu Lince", e), null));
    const intro = await ch.send({ content: fill(s.previa), allowedMentions: { parse: [] } });
    for (const n of ["3️⃣", "2️⃣", "1️⃣"]) {
      await wait(1300);
      await intro.edit({ content: `${fill(s.previa)}\n# ${n}`, allowedMentions: { parse: [] } }).catch(() => {});
    }
    for (const [bot, line] of Object.entries(s.coro) as [BotId, string][]) {
      if (!this.d.online.includes(bot)) continue;
      const c = await this.d.sendable(bot, channelId).catch(() => null);
      if (!c) continue;
      await wait(2200);
      await c.send({ content: fill(line), allowedMentions: { parse: [] } }).catch((e) => logError(`coro del Papu Lince (${bot})`, e));
    }
    await wait(2000);
    const gif = await diploma;
    const msg = await ch.send({ content: fill(s.mensaje), files: gif ? [new AttachmentBuilder(gif, { name: "papu-lince.gif" })] : [], allowedMentions: { users: [userId] } });
    for (const bot of this.d.online) {
      const c = await this.d.sendable(bot, channelId).catch(() => null);
      if (c && "messages" in c) await (await c.messages.fetch(msg.id).catch(() => null))?.react(CHEER[bot]).catch(() => {});
    }
    await this.d.report(`🐾 <@${userId}> superó las ${fmt(this.t.total)} preguntas de la trivia: ${s.rol} y ${s.sobres.cantidad} sobres ${s.sobres.tipo}.`);
  }

  /** Diploma animado (src/trivia/lince.ts) con el apodo y el avatar del Papu. */
  private async diploma(userId: string): Promise<Buffer> {
    const guild = await this.d.clients.teto!.guilds.fetch(this.d.guild().id);
    const member = await guild.members.fetch(userId).catch(() => null);
    const user = member?.user ?? (await this.d.clients.teto!.users.fetch(userId));
    const avatar = await fetch(member?.displayAvatarURL({ extension: "png", size: 256 }) ?? user.displayAvatarURL({ extension: "png", size: 256 }))
      .then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null))
      .catch(() => null);
    const colors: Record<Dificultad, string> = { facil: "#57d38c", medio: "#f2c94c", dificil: "#ff6b6b" };
    const date = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago" }).format(new Date());
    return renderLynx({
      name: member?.displayName ?? user.displayName,
      avatar,
      total: this.t.total,
      levels: DIFICULTADES.map((l) => ({ nombre: this.t.settings.dificultades[l].nombre, total: this.t.totalOf(l), color: colors[l] })),
      date,
    });
  }

  /**
   * Al conectarse: si el rol secreto existe con un nombre anterior (config/trivia.json secreto.rolesAnteriores; hasta el
   * 2 nov. 2026, 🧠 Enciclopedia Vocaloid), Teto le pone el nombre nuevo. Quien ya lo tenia se lo queda.
   */
  async syncSecretRole(): Promise<void> {
    const s = this.t.settings.secreto;
    const guild = await this.d.clients.teto!.guilds.fetch(this.d.guild().id);
    const roles = await guild.roles.fetch();
    if (roles.some((r) => channelKey(r.name) === channelKey(s.rol))) return;
    const old = roles.find((r) => (s.rolesAnteriores ?? []).some((n) => channelKey(n) === channelKey(r.name)));
    if (!old) return;
    const before = old.name;
    await old.edit({ name: s.rol, reason: "Rol secreto de la trivia renombrado (config/trivia.json)" });
    this.d.log(`🧠 Trivia: rol secreto «${before}» → «${s.rol}»`);
    await this.d.report(`🎭 Teto renombró el rol secreto de la trivia: «${before}» → «${s.rol}».`);
  }

  private async giveSecretRole(userId: string): Promise<void> {
    const s = this.t.settings.secreto;
    const guild = await this.d.clients.teto!.guilds.fetch(this.d.guild().id);
    let role = guild.roles.cache.find((r) => channelKey(r.name) === channelKey(s.rol));
    if (!role) {
      role = await guild.roles.create({ name: s.rol, colors: { primaryColor: parseInt(s.color.slice(1), 16) }, permissions: [], mentionable: false, hoist: false, reason: "Secreto de la trivia: todas las preguntas superadas" });
      // Lo mas arriba que Teto puede, pero bajo Neru (si no, Neru no podria moderar a quien lo tenga; ver bodas).
      const neruId = this.d.clients.neru?.user?.id;
      const neru = neruId ? await guild.members.fetch(neruId).catch(() => null) : null;
      const ceiling = Math.min(guild.members.me?.roles.highest.position ?? 0, neru?.roles.highest.position ?? Infinity);
      if (ceiling > 1) await role.setPosition(ceiling - 1).catch((e) => logError("posición del rol secreto", e));
    }
    await guild.members.addRole({ user: userId, role: role.id, reason: "Superó todas las preguntas de la trivia (Papu Lince)" });
  }
}
