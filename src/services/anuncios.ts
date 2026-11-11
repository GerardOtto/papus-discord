// Avisos de una sola vez que pide GyroP (config/anuncios.json): frases fijas (regla 4) que un bot publica la primera
// vez que se conecta con ellos, como la llegada de un Vocaloid nuevo. Quedan anotados en kv para no repetirse.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BotId } from "../config";
import { kvGet, kvSet, type Db } from "../db/database";

export interface Anuncio {
  id: string;
  bot: BotId;
  canal: string;
  /** "{@usuario}" = mencion al Papu con ese nombre de usuario. */
  texto: string;
}

export function loadAnuncios(file = path.join(path.resolve(import.meta.dirname, "../.."), "config/anuncios.json")): Anuncio[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { anuncios: Anuncio[] }).anuncios;
}

const MENTION_RE = /\{@([\w.]+)\}/g;

/** Nombres de usuario que menciona el texto. */
export function mentionedUsernames(texto: string): string[] {
  return [...texto.matchAll(MENTION_RE)].map((m) => m[1]!.toLowerCase());
}

/** Cambia cada "{@usuario}" por su mencion; null si falta alguno (el aviso queda pendiente). */
export function fillMentions(texto: string, ids: ReadonlyMap<string, string>): string | null {
  let missing = false;
  const out = texto.replace(MENTION_RE, (_, name: string) => {
    const id = ids.get(name.toLowerCase());
    if (!id) missing = true;
    return id ? `<@${id}>` : "";
  });
  return missing ? null : out;
}

const key = (id: string) => `anuncio:${id}`;

/** Avisos que faltan por publicar de los bots conectados. */
export function pendingAnuncios(db: Db, all: Anuncio[], activeBots: readonly BotId[]): Anuncio[] {
  return all.filter((a) => activeBots.includes(a.bot) && !kvGet(db, key(a.id)));
}

export function markAnuncio(db: Db, id: string, at = Date.now()): void {
  kvSet(db, key(id), String(at));
}
