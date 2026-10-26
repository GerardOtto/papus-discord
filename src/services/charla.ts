// Charla espontanea en #general (decisiones de GyroP, 19 oct. 2026): cada 20 min un Vocaloid conectado escribe por su
// cuenta con el LLM. O comenta los ultimos 12 mensajes del canal, o le pregunta algo a otro Vocaloid con @, que le
// contesta UNA vez (excepcion acotada a la regla 2: esa respuesta nunca dispara otra). No gasta la cuota de ningun
// Papu. Si el ultimo mensaje del canal ya es de un bot que hablo solo, o si un Papu escribio hace menos de 10 min (ya
// hay gente hablando), esta vez no se escribe nada (el comando /charla de GyroP escribe igual). Si el LLM falla, va una
// frase fija del grupo "charla_general" (regla 4). Quien habla rota sin repetir (mazo persistido).
import type { BotId } from "../config";
import type { CharacterInfo } from "../engine/reader";
import type { LLMChain } from "../llm/chain";
import { buildRequest, buildSpontaneousRequest, parseReplies, type HistoryLine, type PersonaLibrary } from "../llm/prompt";
import type { ChatRequest } from "../llm/provider";
import type { RequestQueue } from "../llm/queue";
import type { Phrases } from "../phrases/catalog";
import type { DeckStore } from "../phrases/deck";
import { withoutBotMentions } from "./conversation";
import type { PrivacyGuard } from "./privacy";

export const GENERAL_CHAT_MS = 20 * 60_000;
/** Mensajes de #general que lee el bot antes de escribir. */
export const GENERAL_HISTORY = 12;
/** Si el ultimo mensaje de un Papu es mas viejo que esto, no hay plática que comentar: se le pregunta a otro Vocaloid. */
export const FRESH_MS = 3 * 3_600_000;
/** Si un Papu escribio hace menos que esto, ya hay gente hablando: el mensaje automatico no interrumpe. */
export const ACTIVE_MS = 10 * 60_000;
/** La charla pasa por la misma cola que las menciones (una peticion a la vez), sin prioridad sobre los Papus. */
const QUEUE_KEY = "charla:general";

export interface ChannelMessage {
  id: string;
  /** Nombre para el LLM (el del Vocaloid, o el del Papu como en las menciones). */
  author: string;
  /** Vocaloid nuestro que lo escribio (null = un Papu). */
  bot: BotId | null;
  /** Es la respuesta de un bot a un Papu (asi contestan las menciones). Solo se calcula para el mensaje mas nuevo. */
  repliesToHuman: boolean;
  text: string;
  at: number;
}

/** Lo que la charla necesita de Discord (en las pruebas, un doble). */
export interface CharlaPort {
  /** Ultimos mensajes de #general, del mas viejo al mas nuevo (null = no hay #general). */
  recent(limit: number): Promise<ChannelMessage[] | null>;
  /** Publica en #general; con `mention`, el mensaje empieza con el @ de ese Vocaloid. Devuelve el id del mensaje. */
  post(bot: BotId, content: string, mention?: BotId): Promise<string>;
  /** Responde a un mensaje de #general, sin ping. */
  reply(bot: BotId, replyTo: string, content: string): Promise<void>;
  /** Muestra "escribiendo…" en #general; devuelve la funcion para detenerlo. */
  typing(bot: BotId): () => void;
  /** Nombres de los emojis del servidor (para que el LLM los use). */
  emojis?(): string[];
}

export interface CharlaDeps {
  decks: DeckStore;
  phrases: Phrases;
  chain: LLMChain;
  queue: RequestQueue;
  personas: PersonaLibrary;
  characters: Record<BotId, CharacterInfo>;
  port: CharlaPort;
  /** Vocaloids conectados (con token). */
  active: () => readonly BotId[];
  llm: { maxTokens: number; temperature: number };
  culture?: string[];
  /** Respuestas que filtren el proceso de GyroP: se descartan. */
  privacy?: PrivacyGuard;
  today?: () => string;
  log?: (msg: string) => void;
  now?: () => number;
  rng?: () => number;
}

export type CharlaOutcome = "skipped" | "commented" | "asked" | "fallback";

/** Pedido del comando /charla de GyroP (el temporizador no pasa nada). */
export interface CharlaRequest {
  /** Escribe aunque el ultimo mensaje ya sea de un bot que hablo solo. */
  force?: boolean;
  /** Quien habla (si no esta conectado, le toca al siguiente del mazo). */
  bot?: BotId;
  /** A quien le pregunta con @ (si no esta conectado o es el mismo, se decide como siempre). */
  target?: BotId;
  /** De que habla, en palabras de GyroP. */
  topic?: string;
}

/** Siguiente Vocaloid que habla en #general entre los conectados (null = ninguno). */
export function nextChatterBot(decks: DeckStore, active: readonly BotId[]): BotId | null {
  if (!active.length) return null;
  return active[decks.next("charla.bot", active.length)]!;
}

/** El ultimo mensaje es de uno de nuestros bots y no contesta a un Papu: ya hablo solo, no se agrega otro. */
export function botSpokeAlone(last: ChannelMessage | undefined): boolean {
  return !!last && last.bot !== null && !last.repliesToHuman;
}

/** Algun Papu escribio en los ultimos 10 min: la conversacion esta viva y no hace falta animarla. */
export function papusTalking(recent: readonly ChannelMessage[], now: number): boolean {
  return recent.some((m) => m.bot === null && now - m.at < ACTIVE_MS);
}

export class GeneralChat {
  private running = false;

  constructor(private readonly d: CharlaDeps) {}

  async tick(opts: CharlaRequest = {}): Promise<CharlaOutcome> {
    if (this.running) return "skipped";
    this.running = true;
    try {
      return await this.run(opts);
    } finally {
      this.running = false;
    }
  }

  private async run(opts: CharlaRequest): Promise<CharlaOutcome> {
    const { port, decks, characters } = this.d;
    const recent = await port.recent(GENERAL_HISTORY);
    if (!recent) return "skipped";
    const now = (this.d.now ?? Date.now)();
    if (!opts.force && (botSpokeAlone(recent.at(-1)) || papusTalking(recent, now))) return "skipped";
    const active = this.d.active();
    const chosen = opts.bot && active.includes(opts.bot) ? opts.bot : null;
    const bot = chosen ?? nextChatterBot(decks, active);
    if (!bot) return "skipped";

    // Comentar la plática solo tiene sentido si hubo una reciente; si no, se le pregunta a otro Vocaloid.
    // Con un tema de GyroP y sin a quién preguntarle, comenta ese tema.
    const fresh = recent.some((m) => m.bot === null && m.text.trim() && now - m.at < FRESH_MS);
    const others = active.filter((b) => b !== bot);
    const topic = opts.topic?.trim() || undefined;
    let target: BotId | null = null;
    if (opts.target && opts.target !== bot && active.includes(opts.target)) target = opts.target;
    else if (!topic && others.length > 0 && (!fresh || decks.next("charla.modo", 2) === 1)) target = others[decks.next(`charla.a.${bot}`, others.length)]!;
    const history: HistoryLine[] = recent.filter((m) => m.text.trim()).map((m) => ({ author: m.author, text: m.text }));
    const speaker = characters[bot];
    const shared = { culture: this.d.culture, today: this.d.today?.(), serverEmojis: port.emojis?.() };

    const stop = port.typing(bot);
    let opener = await this.call(
      bot,
      buildSpontaneousRequest({ speaker, target: target ? characters[target] : null, history, topic, ...shared }, this.d.personas, { ...this.d.llm, rng: this.d.rng }),
    ).finally(stop);
    if (!opener) {
      await port.post(bot, this.d.phrases.pick(bot, "charla_general"));
      return "fallback";
    }
    if (target) opener = withoutBotMentions(opener, [characters[target].displayName]).replace(/\s{2,}/g, " ").trim();
    const openerId = await port.post(bot, opener, target ?? undefined);
    if (!target) return "commented";

    // El mencionado contesta una sola vez (su respuesta no se vuelve a responder).
    const asked = characters[target];
    const stopAnswer = port.typing(target);
    const answer = await this.call(
      target,
      buildRequest(
        {
          characters: [asked],
          papuName: speaker.displayName,
          notes: {
            [target]: `Quien te escribe es ${speaker.displayName}, otro Vocaloid del servidor (no un Papu): contéstale a ${speaker.displayName} por su nombre y nunca le digas Papu. Es tu única respuesta: no le devuelvas otra pregunta.`,
          },
          message: opener,
          history,
          ...shared,
        },
        this.d.personas,
        { ...this.d.llm, rng: this.d.rng },
      ),
    ).finally(stopAnswer);
    if (answer) await port.reply(target, openerId, answer);
    return "asked";
  }

  /** Una llamada al LLM por la cola; null si no hubo respuesta util o si filtra el proceso de GyroP. */
  private async call(bot: BotId, req: ChatRequest): Promise<string | null> {
    const who = [this.d.characters[bot]];
    const result = await this.d.queue.enqueue(QUEUE_KEY, (signal) => this.d.chain.chat(req, signal, (res) => !!parseReplies(res.text, who)[bot]));
    if (result.status !== "ok") {
      this.d.log?.(`Charla en #general: ${bot} sin respuesta del LLM (${result.status === "error" ? ((result.error as Error)?.message ?? result.error) : result.status})`);
      return null;
    }
    const text = parseReplies(result.value.text, who)[bot];
    if (text && this.d.privacy?.leaks(text)) {
      this.d.log?.(`Charla en #general: respuesta de ${bot} descartada por privacidad`);
      return null;
    }
    return text ?? null;
  }
}
