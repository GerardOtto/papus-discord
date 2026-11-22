// Foro #✨・novedades (PLAN §8, 13 nov. 2026): una publicación por novedad, con título y etiqueta. Lo usan la mudanza
// (scripts/novedades-migrar.ts) y Miku en el worker (/estreno, /noticia). Etiquetas sin moderar: solo los bots y GyroP crean
// publicaciones (los Papus solo comentan), y los Vocaloids no tienen Gestionar hilos para poner etiquetas moderadas.

export const NOVEDADES_ETIQUETAS = ["Parche", "Novedad", "Temporada", "Membresías", "Estreno", "Noticia"] as const;
export type NovedadEtiqueta = (typeof NOVEDADES_ETIQUETAS)[number];

/** Título de una publicación (Discord admite 100 caracteres): la primera línea con texto, sin formato. */
export function tituloDe(texto: string, prefijo = ""): string {
  const linea = texto
    .split("\n")
    .map((l) => l.replace(/<[@#][!&]?\d+>|https?:\/\/\S+/g, "").replace(/[#*_~`>|]/g, "").replace(/\s+/g, " ").trim())
    .find(Boolean) ?? "";
  const t = `${prefijo}${linea}`.trim() || "✨ Novedad";
  return t.length > 100 ? `${t.slice(0, 99).trimEnd()}…` : t;
}
