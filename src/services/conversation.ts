// Respuestas libres a menciones (el UNICO uso del LLM, regla 4). Flujo:
// cuota (una unidad por @, en orden) -> cola (una pendiente por Papu, espera maxima) -> una sola llamada
// para todos los @ -> cada bot publica su parte. Sin respuesta = se devuelve la cuota.
import type { VideoEntry } from "../catalog/videos";
import type { PrivacyGuard } from "./privacy";
import type { BotId } from "../config";
import type { CharacterInfo } from "../engine/reader";
import type { LLMChain } from "../llm/chain";
import type { ChatResponse } from "../llm/provider";
import { buildRequest, parseReplies, type HistoryLine, type PersonaLibrary } from "../llm/prompt";
import type { RequestQueue } from "../llm/queue";
import type { Phrases } from "../phrases/catalog";
import type { Quota } from "../quota/quota";

export interface IncomingMention {
  messageId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  /** Lo escribio GyroP (por su id): los bots le hablan como a su productor. */
  fromOwner?: boolean;
  /** Texto con menciones legibles ("@Teto"). */
  text: string;
  /** Bots mencionados, en el orden en que aparecen (sin repetir). */
  bots: BotId[];
  history: () => Promise<HistoryLine[]>;
}

/** Lo que el servicio necesita de Discord (en las pruebas, un doble). */
export interface ChatPort {
  reply(bot: BotId, channelId: string, replyTo: string, content: string, pingUserId: string): Promise<void>;
  /** Muestra "escribiendo…" mientras dure la espera; devuelve la funcion para detenerlo. */
  typing(bot: BotId, channelId: string): () => void;
  react(bot: BotId, channelId: string, messageId: string, emoji: string): Promise<void>;
  /** Nombres de los emojis del servidor (para que el LLM los use). */
  emojis?(): string[];
}

export interface ConversationDeps {
  quota: Quota;
  queue: RequestQueue;
  chain: LLMChain;
  phrases: Phrases;
  personas: PersonaLibrary;
  characters: Record<BotId, CharacterInfo>;
  port: ChatPort;
  llm: { maxTokens: number; temperature: number };
  /** Videos relacionados con el mensaje (solo titulo y estado); sin catalogo, los bots no saben de videos. */
  videos?: (text: string) => VideoEntry[];
  /** Datos de cultura Vocaloid (PersonaLibrary.culture()); van al LLM solo los que vienen al caso. */
  culture?: string[];
  /** Proceso privado de GyroP: preguntas -> frase fija sin LLM; respuestas que filtren herramientas -> descartadas. */
  privacy?: PrivacyGuard;
  log?: (msg: string) => void;
  onQueueLength?: (length: number) => void;
  /** Trato especial de quien escribe con cada bot (config/especiales.json). */
  notesFor?: (authorId: string, bots: BotId[]) => Partial<Record<BotId, string>>;
  /** Fecha de hoy en palabras para el LLM. */
  today?: () => string;
}

export type ConversationOutcome = "answered" | "partial" | "busy" | "no_quota" | "timeout" | "failed" | "private";

export class ConversationService {
  /** Papus que ya recibieron hoy el aviso de cuota agotada ("dia:id"): despues solo una reaccion, sin otro mensaje. */
  private readonly warnedNoQuota = new Set<string>();

  constructor(private readonly d: ConversationDeps) {}

  async handle(m: IncomingMention): Promise<ConversationOutcome> {
    const { quota, queue, port, phrases } = this.d;
    if (m.bots.length === 0) throw new Error("handle() sin bots mencionados");
    const papu = `<@${m.authorId}>`;

    // Preguntas sobre el proceso de GyroP (IA, herramientas, como se hacen los videos): frase fija de cada bot
    // mencionado. El LLM nunca ve la pregunta y no se gasta cuota (regla 4).
    // Sin las menciones a los bots: "@IA ¿viste el video?" le habla a IA (la Vocaloid), no pregunta si GyroP usa IA.
    const topic = this.d.privacy?.classify(withoutBotMentions(m.text, Object.values(this.d.characters).map((c) => c.displayName)));
    if (topic) {
      for (const bot of m.bots) await this.send(bot, m, phrases.pick(bot, topic, { papu }));
      return "private";
    }

    // Ya tiene una peticion en la cola: no se cobra ni se responde, solo un reloj de arena.
    if (queue.hasPending(m.authorId)) {
      await port.react(m.bots[0]!, m.channelId, m.messageId, "⏳").catch(() => {});
      return "busy";
    }

    const reservation = quota.reserve(m.authorId, m.bots.length);
    const granted = m.bots.slice(0, reservation.units);
    const denied = m.bots.slice(reservation.units);
    // Los @ que no alcanzan responden su frase de cuota agotada (sin LLM, sin costo). Una vez al dia por Papu: si
    // insiste, solo una luna (asi el canal no se llena de "se acabo").
    const warnKey = `${reservation.day}:${m.authorId}`;
    if (granted.length === 0 && this.warnedNoQuota.has(warnKey)) {
      await port.react(m.bots[0]!, m.channelId, m.messageId, "🌙").catch(() => {});
      return "no_quota";
    }
    if (denied.length) {
      if (this.warnedNoQuota.size > 5000) this.warnedNoQuota.clear();
      this.warnedNoQuota.add(warnKey);
    }
    for (const bot of denied) await this.send(bot, m, phrases.pick(bot, "cuota_agotada", { papu }));
    if (granted.length === 0) return "no_quota";

    const stopTyping = granted.map((b) => port.typing(b, m.channelId));
    const characters = granted.map((b) => this.d.characters[b]);
    const result = await queue.enqueue(m.authorId, async (signal) => {
      const history = await m.history();
      const req = buildRequest(
        { characters, papuName: m.authorName, fromOwner: m.fromOwner, notes: this.d.notesFor?.(m.authorId, granted), message: m.text, history, videos: this.d.videos?.(m.text) ?? [], culture: this.d.culture, today: this.d.today?.(), serverEmojis: port.emojis?.() },
        this.d.personas,
        this.d.llm,
      );
      // Una respuesta cortada o sin el JSON de cada personaje se descarta y responde la siguiente API. Si ninguna
      // responde completo, se usa la mejor parcial (los que faltan se devuelven a la cuota más abajo).
      let partial: ChatResponse | null = null;
      try {
        return await this.d.chain.chat(req, signal, (res) => {
          const parsed = parseReplies(res.text, characters);
          const got = characters.filter((c) => parsed[c.id]).length;
          if (got === characters.length) return true;
          if (got > 0 && !partial) partial = res;
          this.d.log?.(`Respuesta incompleta de ${res.provider} (${got} de ${characters.length}, ${res.text.length} car.); pruebo con otra API`);
          return false;
        });
      } catch (e) {
        if (partial) return partial;
        throw e;
      }
    });
    this.d.onQueueLength?.(queue.length);
    stopTyping.forEach((stop) => stop());

    if (result.status === "busy") {
      // Carrera entre hasPending y enqueue: se devuelve todo.
      quota.refund(reservation);
      return "busy";
    }
    if (result.status === "timeout") {
      quota.refund(reservation);
      await this.send(granted[0]!, m, phrases.pick(granted[0]!, "cola_llena", { papu }));
      return "timeout";
    }
    if (result.status === "error") {
      quota.refund(reservation);
      this.d.log?.(`LLM sin respuesta: ${(result.error as Error)?.message ?? result.error}`);
      await this.send(granted[0]!, m, phrases.pick(granted[0]!, "sin_api", { papu }));
      return "failed";
    }

    const replies = parseReplies(result.value.text, characters);
    let answered = 0;
    let replaced = 0;
    for (const bot of granted) {
      const text = replies[bot];
      if (!text) continue;
      if (this.d.privacy?.leaks(text, m.text)) {
        // La respuesta menciona herramientas o el proceso: se descarta y va la frase fija (sin cobro).
        this.d.log?.(`Respuesta de ${bot} descartada por privacidad`);
        await this.send(bot, m, phrases.pick(bot, "secreto_estudio", { papu }));
        replaced++;
        continue;
      }
      // Si Discord no deja publicar a uno, los demas siguen y su unidad se devuelve (cuenta como sin respuesta).
      if (await this.send(bot, m, text)) answered++;
    }
    if (replaced > 0) quota.refund(reservation, replaced);
    if (answered === 0 && replaced > 0) return "private";
    const missing = granted.length - answered - replaced;
    if (missing > 0) {
      // El modelo no respondio por alguno: esas unidades se devuelven.
      quota.refund(reservation, missing);
      if (answered === 0) {
        this.d.log?.(`Sin respuesta para ${granted.join(", ")} (${result.value.provider}, ${result.value.text.length} car.): ${result.value.text.slice(0, 120).replace(/\s+/g, " ")}`);
        await this.send(granted[0]!, m, phrases.pick(granted[0]!, "sin_api", { papu }));
        return "failed";
      }
      return "partial";
    }
    return "answered";
  }

  /** Publica la respuesta de un bot; si Discord falla, lo anota y sigue (un envio caido no frena a los demas @). */
  private async send(bot: BotId, m: IncomingMention, content: string): Promise<boolean> {
    try {
      await this.d.port.reply(bot, m.channelId, m.messageId, content, m.authorId);
      return true;
    } catch (e) {
      this.d.log?.(`✘ ${bot} no pudo publicar su respuesta: ${(e as Error)?.message ?? e}`);
      return false;
    }
  }
}

/** Quita las menciones legibles a los bots ("@IA", "@Teto") de un texto. */
export function withoutBotMentions(text: string, names: string[]): string {
  if (!names.length) return text;
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`@(?:${alt})(?![\\p{L}\\p{N}])`, "giu"), " ");
}

/**
 * Respuesta a un bot que no dice nada ("XD", "jajaja", un emoji, "AEA"): si no trae un @ explicito, no cuenta como
 * mencion (no gasta cuota ni recibe respuesta).
 */
export function isTrivialReply(text: string): boolean {
  const words = text
    .replace(/<a?:\w+:\d+>/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(?:x+d+|(?:ja|je|ji|js|ks|ha)+[jas]*|a+e+a+|o+k+|u+w+u+|o+w+o+|lol|lmao|xd+)$/.test(w));
  return words.join("").length < 3;
}

/** Bots mencionados en orden de aparicion: <@id> en el texto y, al final, el autor del mensaje respondido. */
export function mentionedBots(content: string, botByUserId: ReadonlyMap<string, BotId>, repliedToUserId?: string | null): BotId[] {
  const out: BotId[] = [];
  for (const [, id] of content.matchAll(/<@!?(\d+)>/g)) {
    const bot = botByUserId.get(id!);
    if (bot && !out.includes(bot)) out.push(bot);
  }
  // Responder a un bot cuenta como mencionarlo solo si no hay @ a otro: "@Miku qué piensas de esto?" respondiendo a
  // Teto es para Miku (caso real del 22 oct. 2026: contestaban las dos).
  const replied = repliedToUserId ? botByUserId.get(repliedToUserId) : undefined;
  if (replied && out.length === 0) out.push(replied);
  return out;
}
