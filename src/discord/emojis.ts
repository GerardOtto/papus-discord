// Emojis del servidor en lo que escribe el LLM. El modelo pone ":teto_hola:" (lo imita del historial), pero Discord
// solo muestra el emoji del servidor con su id ("<:teto_hola:123>"); sin esto sale como texto.

/** Emoji del servidor tal como se escribe en un mensaje. */
export function emojiMarkup(e: { name: string; id: string; animated?: boolean | null }): string {
  return `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
}

/**
 * Cambia cada ":nombre:" por el emoji del servidor con ese nombre (sin distinguir mayusculas). Los que ya vienen con
 * su id y los nombres que el servidor no tiene quedan igual.
 */
export function linkEmojis(text: string, emojis: ReadonlyMap<string, string>): string {
  if (!emojis.size) return text;
  return text.replace(/(?<!<a?):([A-Za-z0-9_]{2,32}):(?!\d+>)/g, (whole, name: string) => emojis.get(name.toLowerCase()) ?? whole);
}
