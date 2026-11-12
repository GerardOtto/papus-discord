// Datos de la tarjeta de /nivel sin Discord: los usan /nivel (src/discord/levels.ts) y el puente aislado de tarjetas
// de la Plaza preview (src/mundo/tarjetas-preview.ts), para que las dos dibujen exactamente lo mismo.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CardData } from "./card";
import { stripNickTag } from "./rules";
import type { LevelService } from "./service";

const ASSETS = path.resolve(import.meta.dirname, "../../assets/bots");

/** Fondo de la tarjeta: el propio del Papu (data/tarjetas/<id>.png) o el banner de un Vocaloid ("bot:teto"). */
export function cardBackground(dataDir: string, userId: string, fondo: string | null): Buffer | null {
  const file =
    fondo === "propia"
      ? path.join(dataDir, "tarjetas", `${userId}.png`)
      : fondo?.startsWith("bot:")
        ? path.join(ASSETS, `${fondo.slice(4)}_banner.png`)
        : null;
  return file && existsSync(file) ? readFileSync(file) : null;
}

export async function fetchAvatar(url: string, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  return fetchFn(url, { signal: AbortSignal.timeout(10_000) })
    .then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null))
    .catch(() => null);
}

export type LevelSnapshot = ReturnType<LevelService["snapshot"]>;

/** Arma la tarjeta a partir del nivel guardado; lo que viene de Discord (nombre, avatar, puesto) llega ya resuelto. */
export function cardDataFrom(
  snap: LevelSnapshot,
  x: {
    displayName: string;
    avatar: Buffer | null;
    position: number;
    quota: CardData["quota"];
    defaultAccent: string;
    background: Buffer | null;
    multiplier: number;
  },
): CardData {
  return {
    name: stripNickTag(x.displayName),
    avatar: x.avatar,
    level: snap.level,
    max: snap.max,
    prestige: snap.prestige,
    into: snap.into,
    needed: snap.needed,
    tier: snap.rank.estilo,
    rankName: snap.rank.nombre,
    position: x.position,
    quota: x.quota,
    frase: snap.card.frase,
    accent: snap.card.color ?? x.defaultAccent,
    background: x.background,
    multiplier: x.multiplier,
  };
}
