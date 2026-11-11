// Revision de respuestas escritas (bodas y trivia): funciones puras, sin archivos ni Discord, para que tambien las use
// el worker de Cloudflare (trivia multijugador de la Actividad). Las respuestas las revisa el codigo, nunca el LLM (regla 4).

const ARTICLES = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "lo"]);

/** Minusculas, sin acentos, sin menciones, emojis ni signos, sin articulos: "¡Es LA Luna! 🌙" -> ["es", "luna"]. */
export function answerWords(text: string): string[] {
  return text
    .replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w));
}

/** Palabras de mas que se toleran alrededor de la respuesta ("creo que es la luna"); asi no se vale mandar una lista. */
const EXTRA_WORDS = 4;

/** ¿El mensaje contiene una respuesta aceptada (palabras seguidas), sin ser una lista de intentos? */
export function isCorrect(text: string, answers: string[]): boolean {
  const words = answerWords(text);
  return answers.some((a) => {
    const target = answerWords(a);
    if (!target.length || words.length > target.length + EXTRA_WORDS) return false;
    for (let i = 0; i + target.length <= words.length; i++) if (target.every((w, k) => words[i + k] === w)) return true;
    return false;
  });
}
