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
export function nextRoundAt(s: Pick<RoundSettings, "primera" | "cadaDias">, lastOpenedAt: number | null): number {
  return lastOpenedAt === null ? s.primera : Math.max(s.primera, lastOpenedAt + s.cadaDias * 86_400_000);
}

// ───────────── Votación de los Papus de honor ─────────────
// Cada ronda: hasta `listos` videos que GyroP tiene listos para subir + las `ideas` propuestas en #charla-de-honor con
// más reacciones `emoji` desde la ronda anterior (sin contar la del autor ni la de bots).

export interface HonorSettings {
  canal: string;
  charla: string;
  pregunta: string;
  primera: number;
  cadaDias: number;
  duraDias: number;
  listos: number;
  ideas: number;
  emoji: string;
}

export function parseHonorSettings(raw: Omit<HonorSettings, "primera"> & { primera: string }): HonorSettings {
  const primera = Date.parse(raw.primera);
  if (Number.isNaN(primera)) throw new Error(`Fecha inválida en config/votaciones.json (honor): ${raw.primera}`);
  if (raw.listos + raw.ideas < 2 || raw.listos + raw.ideas > 10) throw new Error("config/votaciones.json (honor): listos + ideas va de 2 a 10");
  return { ...raw, primera };
}

export interface IdeaMessage {
  id: string;
  authorId: string;
  text: string;
  createdAt: number;
  /** Reacciones que cuentan (sin la del autor ni bots). */
  likes: number;
}

/** Texto de la idea para la encuesta (máx. 55): primera línea, sin menciones, enlaces ni formato. */
export function ideaText(content: string): string {
  const line =
    content
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const clean = line
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/<[@#&!]+\d+>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 55 ? `${clean.slice(0, 54).trimEnd()}…` : clean;
}

/** Las ideas más apoyadas (al menos 1 like; a igual apoyo, la más antigua), sin repetir el mismo texto. */
export function pickIdeas(ideas: IdeaMessage[], n: number): IdeaMessage[] {
  const seen = new Set<string>();
  return ideas
    .filter((i) => i.likes > 0 && i.text)
    .sort((a, b) => b.likes - a.likes || a.createdAt - b.createdAt)
    .filter((i) => {
      const k = i.text.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, n);
}
