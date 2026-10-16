// Resultado de una ronda semanal (PLAN §2): gana el mas votado; el segundo pasa a la ronda siguiente.
// Las opciones van en orden de antiguedad (primero el que viene de la ronda anterior): en un empate por el segundo
// lugar pasa el que lleva mas tiempo esperando. Un empate por el primero (o sin votos) lo decide GyroP.

export interface RoundSettings {
  canal: string;
  pregunta: string;
  /** Primera apertura (ms). */
  primera: number;
  cadaDias: number;
  duraDias: number;
  opciones: number;
  semilla: string[];
}

export function parseRoundSettings(raw: { canal: string; pregunta: string; primera: string; cadaDias: number; duraDias: number; opciones: number; semilla?: string[] }): RoundSettings {
  const primera = Date.parse(raw.primera);
  if (Number.isNaN(primera)) throw new Error(`Fecha inválida en config/votaciones.json: ${raw.primera}`);
  if (raw.opciones < 2 || raw.opciones > 10) throw new Error("config/votaciones.json: 'opciones' va de 2 a 10");
  return { ...raw, primera, semilla: raw.semilla ?? [] };
}

export interface RoundResult {
  /** null = empate por el primer lugar o nadie voto (decide GyroP). */
  winner: string | null;
  /** Empatados por el primer lugar (todas si nadie voto). */
  tied: string[];
  /** Pasa a la ronda siguiente. */
  second: string | null;
}

/** `options` en orden de antiguedad; `counts` = votos por opcion (las que faltan tienen 0). */
export function rankRound(options: string[], counts: Record<string, number>): RoundResult {
  const sorted = [...options].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0)); // estable: desempata por antiguedad
  const max = counts[sorted[0]!] ?? 0;
  if (max === 0) return { winner: null, tied: [...options], second: null };
  const top = sorted.filter((o) => (counts[o] ?? 0) === max);
  if (top.length > 1) return { winner: null, tied: top, second: null };
  return { winner: sorted[0]!, tied: [], second: sorted[1] ?? null };
}

/** Despues de que GyroP elige entre los empatados: el segundo es el mejor de los demas. */
export function resolveTie(options: string[], counts: Record<string, number>, winner: string): RoundResult {
  const rest = [...options].filter((o) => o !== winner).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
  return { winner, tied: [], second: rest[0] ?? null };
}

/** Cuando toca abrir la ronda siguiente. */
export function nextRoundAt(s: RoundSettings, lastOpenedAt: number | null): number {
  return lastOpenedAt === null ? s.primera : Math.max(s.primera, lastOpenedAt + s.cadaDias * 86_400_000);
}
