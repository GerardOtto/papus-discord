// Saludo al conectarse y despedida al apagar (frases fijas, regla 4). Un reinicio rapido no deja un "adios"
// colgado: si los bots vuelven antes de 30 min, la despedida se borra y no hay saludo.
import { BOT_IDS, type BotId } from "../config";
import type { DeckStore } from "../phrases/deck";

export const QUICK_RESTART_MS = 30 * 60_000;

export interface FarewellRecord {
  bot: BotId;
  channelId: string;
  messageId: string;
  at: number;
}

export interface StartDecision {
  greet: boolean;
  /** Despedida a borrar (reinicio rapido). */
  deleteFarewell: FarewellRecord | null;
}

/**
 * Que hacer al arrancar. `lastSeen` = ultima vez que los bots estuvieron en linea (null = primera vez);
 * `farewell` = la despedida publicada al apagar, si la hubo.
 */
export function startDecision(lastSeen: number | null, farewell: FarewellRecord | null, now = Date.now()): StartDecision {
  if (lastSeen === null && !farewell) return { greet: true, deleteFarewell: null };
  const since = farewell?.at ?? lastSeen ?? 0;
  if (now - since < QUICK_RESTART_MS) return { greet: false, deleteFarewell: farewell };
  return { greet: true, deleteFarewell: null };
}

/** Bot que saluda o se despide: rota entre los 4 sin repetir (mazo persistido). */
export function nextPresenceBot(decks: DeckStore): BotId {
  return BOT_IDS[decks.next("presencia.bot", BOT_IDS.length)]!;
}

export function parseFarewell(raw: string | null): FarewellRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as FarewellRecord;
    return r && (BOT_IDS as readonly string[]).includes(r.bot) && r.channelId && r.messageId ? r : null;
  } catch {
    return null;
  }
}
