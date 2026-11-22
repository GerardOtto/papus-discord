// Respuestas libres a menciones (el UNICO uso del LLM, regla 4). Flujo:
// cuota (una unidad por @, en orden) -> cola (una pendiente por Papu, espera maxima) -> una sola llamada
// para todos los @ -> cada bot publica su parte. Sin respuesta = se devuelve la cuota.
import type { VideoEntry } from "../catalog/videos";
import type { PrivacyGuard } from "./privacy";
import type { BotId } from "../config";
import type { CharacterInfo } from "../engine/reader";
import type { LLMChain } from "../llm/chain";
import type { ChatRequest, ChatResponse } from "../llm/provider";
import { buildRequest, parseReplies, type HistoryLine, type PersonaLibrary } from "../llm/prompt";
import type { RequestQueue } from "../llm/queue";
import type { Phrases } from "../phrases/catalog";
import type { ImageAttachment } from "../llm/image";
import type { ImageAllowance } from "../quota/imagenes";
import type { Quota, Reservation } from "../quota/quota";

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
  /** Imagen adjunta (la del mensaje o, si no trae, la del mensaje al que responde): PLAN §5.1. */
  image?: ImageAttachment | null;
}

/** Ver imagenes (PLAN §5.1): cadena con modelos que las leen, tope diario por Papu y lo que cuesta en cuota. */
export interface VisionDeps {
  chain: LLMChain;
  allowance: ImageAllowance;
  /** Mensajes de cuota que cuesta la imagen (una vez por mensaje, aunque haya varios @). */
  extraUnits: number;
  /** Baja y achica la imagen (data URL); null si no se pudo. */
  load: (image: ImageAttachment, signal: AbortSignal) => Promise<string | null>;
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
  /** Sin esto, los bots no ven imagenes: responden sin inventar lo que tienen. */
  vision?: VisionDeps;
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

    // Imagen (PLAN §5.1): cuesta `extraUnits` mensajes mas, una vez por mensaje, y hay un tope diario por Papu. Si no
    // alcanza, responde igual sin verla (y sin inventar lo que tiene), con una nota al pie.
    const img = this.reserveImage(m);
    const stopTyping = granted.map((b) => port.typing(b, m.channelId));
    const characters = granted.map((b) => this.d.characters[b]);
    const result = await queue.enqueue(m.authorId, async (signal) => {
      const history = await m.history();
      const request = (image: string | undefined) =>
        buildRequest(
          { characters, papuName: m.authorName, fromOwner: m.fromOwner, notes: this.d.notesFor?.(m.authorId, granted), message: m.text, history, videos: this.d.videos?.(m.text) ?? [], culture: this.d.culture, today: this.d.today?.(), serverEmojis: port.emojis?.(), image },
          this.d.personas,
          this.d.llm,
        );
      const vision = this.d.vision;
      if (img.see && vision) {
        const dataUrl = await vision.load(m.image!, signal);
        if (dataUrl) {
          try {
            return await this.ask(vision.chain, request(dataUrl), characters, signal);
          } catch (e) {
            if (signal.aborted) throw e;
            this.d.log?.(`Visión sin respuesta (${(e as Error)?.message ?? e}); respondo sin la imagen`);
          }
        }
        img.giveBack();
        img.note = "fallo";
      }
      return await this.ask(this.d.chain, request(m.image ? "oculta" : undefined), characters, signal);
    });
    this.d.onQueueLength?.(queue.length);
    stopTyping.forEach((stop) => stop());

    if (result.status !== "ok") img.giveBack();
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
    // La nota de la imagen (frase fija, sin LLM) va al pie de la primera respuesta que se publica.
    let footer = this.imageFooter(m.authorId, img.note);
    for (const bot of granted) {
      const raw = replies[bot];
      if (!raw) continue;
      if (this.d.privacy?.leaks(raw, m.text)) {
        // La respuesta menciona herramientas o el proceso: se descarta y va la frase fija (sin cobro).
        this.d.log?.(`Respuesta de ${bot} descartada por privacidad`);
        await this.send(bot, m, phrases.pick(bot, "secreto_estudio", { papu }));
        replaced++;
        continue;
      }
      const text = footer ? `${raw}\n-# 🖼️ ${footer}` : raw;
      // Si Discord no deja publicar a uno, los demas siguen y su unidad se devuelve (cuenta como sin respuesta).
      if (await this.send(bot, m, text)) {
        answered++;
        footer = null;
      }
    }
    if (replaced > 0) quota.refund(reservation, replaced);
    // Nadie publico una respuesta que viera la imagen: se devuelve.
    if (answered === 0) img.giveBack();
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

  /** Pide la respuesta a una cadena; una cortada o sin el JSON de cada personaje se descarta y responde la siguiente API. */
  private async ask(chain: LLMChain, req: ChatRequest, characters: CharacterInfo[], signal: AbortSignal): Promise<ChatResponse> {
    // Si ninguna responde completo, se usa la mejor parcial (los que faltan se devuelven a la cuota en handle()).
    let partial: ChatResponse | null = null;
    try {
      return await chain.chat(req, signal, (res) => {
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
  }

  /**
   * Reserva lo que cuesta ver la imagen: una del tope del dia y `extraUnits` de cuota. `giveBack` lo devuelve todo (una
   * sola vez) si el Vocaloid no la llega a ver o nadie publica la respuesta.
   */
  private reserveImage(m: IncomingMention): ImageReservation {
    const vision = this.d.vision;
    const none: ImageReservation = { see: false, note: null, giveBack: () => {} };
    if (!m.image || !vision) return none;
    if (vision.allowance.remaining(m.authorId) <= 0) return { ...none, note: "limite" };
    const units = this.d.quota.reserve(m.authorId, vision.extraUnits);
    if (units.units < vision.extraUnits) {
      this.d.quota.refund(units);
      return { ...none, note: "cuota" };
    }
    const day = vision.allowance.take(m.authorId);
    if (!day) {
      this.d.quota.refund(units);
      return { ...none, note: "limite" };
    }
    let held: { units: Reservation; day: string } | null = { units, day };
    return {
      see: true,
      note: "vista",
      giveBack: () => {
        if (!held) return;
        this.d.quota.refund(held.units);
        vision.allowance.refund(m.authorId, held.day);
        held = null;
      },
    };
  }

  /** Nota fija al pie sobre la imagen (sin LLM): cuantas le quedan, o por que no la vio. */
  private imageFooter(authorId: string, note: ImageReservation["note"]): string | null {
    const vision = this.d.vision;
    if (!vision || !note) return null;
    const cost = vision.extraUnits === 1 ? "1 mensaje" : `${vision.extraUnits} mensajes`;
    const per = vision.allowance.perDay;
    switch (note) {
      case "vista": {
        const left = vision.allowance.remaining(authorId);
        if (!Number.isFinite(left)) return null;
        return left === 0 ? "Era tu última imagen de hoy; mañana puedes mostrarnos más." : `Hoy ${left === 1 ? "te queda 1 imagen" : `te quedan ${left} imágenes`} para mostrarnos.`;
      }
      case "limite":
        return `Hoy ya nos mostraste ${per === 1 ? "1 imagen" : `${per} imágenes`}, el máximo del día; mañana podemos ver más.`;
      case "cuota":
        return `No vi la imagen: verla cuesta ${cost} más de tu cuota y hoy no te alcanza. /cuota`;
      case "fallo":
        return "Esta vez no pude ver la imagen, así que no se te cobró.";
    }
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

interface ImageReservation {
  /** Se le cobro y la cadena de vision la va a mirar. */
  see: boolean;
  /** Que decir al pie: vista (cuantas le quedan), limite del dia, sin cuota, o fallo al verla. */
  note: "vista" | "limite" | "cuota" | "fallo" | null;
  giveBack: () => void;
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
