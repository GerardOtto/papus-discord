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
import type { AnswerResult, RunSummary, Shown, TriviaService } from "../trivia/service";
import { channelKey } from "./channels";
import type { LevelsDiscord } from "./levels";

const LETTERS = ["🇦", "🇧", "🇨", "🇩"];
const AGAIN_ID = "trivia:otra";
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
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);

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

  private async question(s: Shown, header: string[] = []): Promise<Payload> {
    const q = s.question;
    const files: AttachmentBuilder[] = [];
    if (q.image) files.push(new AttachmentBuilder(await renderFigure(q.image.bot, q.image.mode), { name: "trivia.png" }));
    if (q.audio) files.push(new AttachmentBuilder(q.audio, { name: "fragmento.mp3" }));
    const streak = s.number - 1;
    const content = [
      ...header,
      `🧠 **Trivia Vocaloid** · Pregunta ${s.number}${streak > 0 ? ` · 🔥 Racha: ${streak}` : ""}`,
      "",
      `**${q.text}**`,
      q.kind === "texto" ? "-# Toca el botón y escribe tu respuesta." : "",
      `⏳ Tiempo: <t:${Math.ceil(s.deadline / 1000)}:R>`,
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
      lines.push(`✅ ¡Correcto! **+${fmt(res.xp)} XP**`, "", `🌟 **¡Contestaste las ${this.t.total} preguntas sin fallar!** Mira el canal… 👀`);
    } else {
      lines.push(res.kind === "tiempo" ? `⌛ **¡Se acabó el tiempo!** Era **${q.answer}**.` : `❌ **Incorrecto.** Era **${q.answer}**.`);
      if (q.fact) lines.push(`-# ${q.fact}`);
    }
    lines.push(
      "",
      `🏁 Racha final: **${end.streak}** · **+${fmt(end.xp)} XP** en total${end.record ? " · 🏆 ¡tu mejor racha!" : ` · tu mejor racha: ${end.best}`}`,
      "-# Teto publicó tu resultado en el canal.",
    );
    const again = new ButtonBuilder().setCustomId(AGAIN_ID).setLabel("Jugar otra vez").setEmoji("🔁").setStyle(ButtonStyle.Success);
    return { content: lines.join("\n"), components: [new ActionRowBuilder<ButtonBuilder>().addComponents(again)], files: [], attachments: [] };
  }

  private correctHeader(res: Extract<AnswerResult, { kind: "acierto" }>): string[] {
    return [`✅ ¡Correcto! **+${fmt(res.xp)} XP**${res.question.fact ? ` · ${res.question.fact}` : ""}`, ""];
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

  // ───────────────────────── comandos y botones ─────────────────────────

  async trivia(i: ChatInputCommandInteraction): Promise<void> {
    const { shown, busy } = this.t.start(i.user.id, i.channelId);
    if (busy) {
      return void (await i.reply({ content: `Ya tienes una trivia en curso (pregunta ${shown.number}). Contéstala o espera a que se acabe su tiempo. ⏳`, flags: MessageFlags.Ephemeral }));
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await i.editReply(await this.question(shown));
    this.arm(i.user.id, i, shown);
  }

  /** Botones de la trivia. Devuelve false si el boton no es de aqui. */
  async button(i: ButtonInteraction): Promise<boolean> {
    const [kind, action, nonce, k] = i.customId.split(":");
    if (kind !== "trivia") return false;
    if (i.customId === AGAIN_ID) {
      const { shown, busy } = this.t.start(i.user.id, i.channelId);
      if (busy) await i.reply({ content: "Ya tienes una trivia en curso. ⏳", flags: MessageFlags.Ephemeral });
      else {
        await i.update(await this.question(shown));
        this.arm(i.user.id, i, shown);
      }
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

  private async stale(i: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
    await i.reply({ content: "Esa pregunta ya pasó. Usa /trivia para jugar otra vez. 🧠", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  private async handle(i: ButtonInteraction | ModalSubmitInteraction, res: AnswerResult): Promise<void> {
    if (res.kind === "vieja") return this.stale(i);
    const userId = i.user.id;
    const update = (p: Payload) => (i.isButton() ? i.update(p) : i.isFromMessage() ? i.update(p) : i.reply({ ...p, flags: MessageFlags.Ephemeral }));
    if (res.kind === "acierto" && res.next) {
      const payload = await this.question(res.next, this.correctHeader(res));
      await update(payload);
      this.arm(userId, i, res.next);
    } else {
      this.disarm(userId);
      await update(this.endScreen(res, res.end!));
    }
    // La XP del acierto pudo subirlo de nivel: apodo, rol de honor y, si cambia de rango, la frase de Teto.
    if (res.kind === "acierto" && res.change) await this.d.levelsDiscord.handle(res.change, { channelId: i.channelId ?? undefined }).catch((e) => logError("nivel por trivia", e));
    if (res.end) await this.publish(res.end);
  }

  // ───────────────────────── resultado ─────────────────────────

  private async publish(end: RunSummary): Promise<void> {
    if (end.reason === "perfecta") return this.secret(end);
    const ch = await this.d.sendable("teto", end.channelId).catch(() => null);
    if (!ch) return void this.d.log(`🧠 Trivia: Teto no puede escribir en el canal ${end.channelId} (racha de ${end.streak})`);
    const papu = `<@${end.userId}>`;
    const text =
      end.streak > 0
        ? this.d.phrases.pick("teto", "trivia_racha", { papu, racha: end.streak, xp: fmt(end.xp) })
        : this.d.phrases.pick("teto", "trivia_cero", { papu });
    const extra = end.record && end.streak >= 3 ? `\n🏆 ¡Nueva mejor racha de ${papu}!` : "";
    await ch.send({ content: `${text}${extra}\n-# 🧠 /trivia · ${end.reason === "tiempo" ? "se le acabó el tiempo" : "falló una"} · mejor racha: ${end.best}`, allowedMentions: { users: [end.userId] } });
    this.d.log(`🧠 Trivia: racha de ${end.streak} (+${end.xp} XP, ${end.reason}) de ${end.userId}`);
  }

  /** Acerto todas las preguntas sin fallar: el easter egg (mensaje secreto, rol de adorno y reacciones de todos). */
  private async secret(end: RunSummary): Promise<void> {
    const s = this.t.settings.secreto;
    await this.giveSecretRole(end.userId).catch((e) => logError("rol secreto de la trivia", e));
    const ch = await this.d.sendable("teto", end.channelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.send({
      content: s.mensaje.replaceAll("{papu}", `<@${end.userId}>`).replaceAll("{n}", fmt(this.t.total)).replaceAll("{rol}", s.rol),
      allowedMentions: { users: [end.userId] },
    });
    for (const bot of this.d.online) {
      const c = await this.d.sendable(bot, end.channelId).catch(() => null);
      if (c && "messages" in c) await (await c.messages.fetch(msg.id).catch(() => null))?.react(CHEER[bot]).catch(() => {});
    }
    await this.d.report(`🌟 <@${end.userId}> contestó las ${this.t.total} preguntas de la trivia sin fallar (+${fmt(end.xp)} XP). Rol secreto: ${s.rol}.`);
  }

  private async giveSecretRole(userId: string): Promise<void> {
    const s = this.t.settings.secreto;
    const guild = await this.d.clients.teto!.guilds.fetch(this.d.guild().id);
    let role = guild.roles.cache.find((r) => channelKey(r.name) === channelKey(s.rol));
    if (!role) {
      role = await guild.roles.create({ name: s.rol, colors: { primaryColor: parseInt(s.color.slice(1), 16) }, permissions: [], mentionable: false, hoist: false, reason: "Secreto de la trivia: todas las preguntas sin fallar" });
      // Lo mas arriba que Teto puede, pero bajo Neru (si no, Neru no podria moderar a quien lo tenga; ver bodas).
      const neruId = this.d.clients.neru?.user?.id;
      const neru = neruId ? await guild.members.fetch(neruId).catch(() => null) : null;
      const ceiling = Math.min(guild.members.me?.roles.highest.position ?? 0, neru?.roles.highest.position ?? Infinity);
      if (ceiling > 1) await role.setPosition(ceiling - 1).catch((e) => logError("posición del rol secreto", e));
    }
    await guild.members.addRole({ user: userId, role: role.id, reason: "Contestó toda la trivia sin fallar" });
  }
}
