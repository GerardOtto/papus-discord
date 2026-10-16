// Interfaz unica de LLM (regla 5): el bot no depende de un proveedor concreto.
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  text: string;
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    /** Si es por limite de cuota/velocidad: cuanto esperar antes de volver a usar este proveedor. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
  get isRateLimit(): boolean {
    return this.retryAfterMs !== null;
  }
}
