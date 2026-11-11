// Normalizacion y busqueda de palabras para la moderacion por reglas.

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Minusculas, sin acentos (ñ -> n) y sin leet en palabras que tienen letras (1488 queda igual). */
export function normalize(text: string): string {
  const base = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return base.replace(/\S+/g, (tok) => (/[a-z]/.test(tok) ? tok.replace(/[0134578@$]/g, (c) => LEET[c] ?? c) : tok));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Patron tolerante a letras estiradas ("pendejooo") y a espacios multiples, con limites de palabra. */
export function wordPattern(entry: string): string {
  const words = normalize(entry).trim().split(/\s+/);
  const body = words.map((w) => [...w].map((c) => (/[a-z]/.test(c) ? `${escape(c)}+` : escape(c))).join("")).join("\\s+");
  return `(?<![a-z0-9])${body}(?![a-z0-9])`;
}

export class WordList {
  private readonly regex: RegExp | null;
  private readonly compact: string[];

  /** `compactMin`: largo minimo para buscar tambien sin espacios ni signos ("hijo.de.puta"); 0 = no. */
  constructor(
    readonly entries: string[],
    compactMin = 0,
  ) {
    this.regex = entries.length ? new RegExp(entries.map(wordPattern).join("|"), "g") : null;
    this.compact = compactMin
      ? entries.map((e) => normalize(e).replace(/[^a-z0-9]/g, "")).filter((e) => e.length >= compactMin)
      : [];
  }

  /** Coincidencias en el texto ya normalizado, con su posicion. */
  matches(normalized: string): { word: string; index: number }[] {
    if (!this.regex) return [];
    return [...normalized.matchAll(this.regex)].map((m) => ({ word: m[0], index: m.index }));
  }

  test(normalized: string): boolean {
    if (this.matches(normalized).length) return true;
    if (!this.compact.length) return false;
    const squashed = normalized.replace(/[^a-z0-9]/g, "").replace(/([a-z])\1+/g, "$1");
    return this.compact.some((e) => squashed.includes(e.replace(/([a-z])\1+/g, "$1")));
  }
}
