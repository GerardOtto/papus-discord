// Entrega de un video para el nivel Baguette (scripts/baguette.ts): la carpeta "Discord (Baguette)" que deja el motor
// trae las notas de produccion (ya divididas en mensajes) y el adelanto de 24 h. Luka los publica en sus canales.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const BAGUETTE_DIR = "Discord (Baguette)";
export const NOTES_FILE = "Notas de producción.txt";
/** Texto opcional que acompaña al adelanto (si no esta, se usa --mensaje). */
export const TEASER_TEXT_FILE = "Adelanto.txt";
const MAX_MESSAGE = 2000;
const SEPARATOR = /^=+\s*Mensaje\s+\d+\s+de\s+\d+.*=+\s*$/im;

/** Mensajes de las notas: cada bloque entre separadores "===== Mensaje N de M (...) =====", sin el separador. */
export function splitNotes(text: string): string[] {
  const parts = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split(new RegExp(SEPARATOR.source, "gim"));
  const messages = parts.map((p) => p.trim()).filter(Boolean);
  for (const [i, m] of messages.entries()) {
    if (m.length > MAX_MESSAGE) throw new Error(`El mensaje ${i + 1} de las notas tiene ${m.length} caracteres (máximo ${MAX_MESSAGE})`);
  }
  return messages;
}

/** Limite de subida de un bot segun el nivel de mejoras del servidor (Discord, 2026). */
export function uploadLimitBytes(premiumTier: number): number {
  return (premiumTier >= 3 ? 100 : premiumTier === 2 ? 50 : 10) * 1024 * 1024;
}

export interface BaguetteDelivery {
  notes: string[];
  teaser: { file: string; bytes: number } | null;
  teaserText: string | null;
}

/** Lee "<carpeta>/Discord (Baguette)/" (o la carpeta misma si ya es esa). */
export function readDelivery(folder: string): BaguetteDelivery {
  const dir = path.basename(folder) === BAGUETTE_DIR ? folder : path.join(folder, BAGUETTE_DIR);
  const files = readdirSync(dir);
  const notesFile = files.find((f) => f.normalize("NFC") === NOTES_FILE.normalize("NFC"));
  const notes = notesFile ? splitNotes(readFileSync(path.join(dir, notesFile), "utf8")) : [];
  const mp4 = files.filter((f) => /^adelanto.*\.mp4$/i.test(f)).sort()[0];
  const teaser = mp4 ? { file: path.join(dir, mp4), bytes: statSync(path.join(dir, mp4)).size } : null;
  const textFile = files.find((f) => f === TEASER_TEXT_FILE);
  const teaserText = textFile ? readFileSync(path.join(dir, textFile), "utf8").trim() || null : null;
  return { notes, teaser, teaserText };
}
