// Catalogo de videos para las respuestas libres: SOLO nombre y estado (decision de GyroP, por seguridad).
// Fuentes: unicamente las carpetas 2 (en revision -> "en produccion") y 5 (subidos -> "publicado") del escritorio.
// Lee solo NOMBRES DE CARPETAS: nunca abre archivos, y al LLM no le llegan rutas, fechas, numeros ni archivos.
import { readdirSync } from "node:fs";
import path from "node:path";

export type VideoState = "publicado" | "en_produccion";

export interface VideoEntry {
  title: string;
  state: VideoState;
}

interface InternalEntry extends VideoEntry {
  /** Orden interno (numero de episodio o fecha) para saber cuales son los mas recientes. Nunca sale al LLM. */
  order: number;
  key: string;
}

export const STATE_LABEL: Record<VideoState, string> = {
  publicado: "publicado",
  en_produccion: "en producción",
};

/** Carpeta de entrega (clave de config/engine-paths.json -> delivery) -> estado, en orden de prioridad. */
export const STATE_FOLDERS: { key: string; state: VideoState }[] = [
  { key: "subidos", state: "publicado" },
  { key: "revision", state: "en_produccion" },
];

const MAX_TITLE = 90;
const MAX_IN_PROMPT = 8;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Titulo y orden desde el nombre de la carpeta: "29. Triple Baka…", "2026-10-15 Recomendación…",
 * "Neru - Las voces… (revision)", "Tomas Gakupo - El samurai…". Devuelve null si no queda un titulo util.
 */
export function parseFolderName(name: string): { title: string; order: number } | null {
  let t = name.trim();
  let order = 0;
  const num = /^(\d{1,4})\.\s+/.exec(t);
  const date = /^(\d{4})-(\d{2})-(\d{2})\s+/.exec(t);
  if (num) {
    order = Number(num[1]);
    t = t.slice(num[0].length);
  } else if (date) {
    order = Number(`${date[1]}${date[2]}${date[3]}`);
    t = t.slice(date[0].length);
  }
  t = t.replace(/\s*\((revision|revisión|borrador|wip)\)\s*$/i, "");
  // "Tomas Gakupo - El samurai…" / "Neru - Las voces…": prefijo interno de una palabra antes del guion.
  const dash = /^(?:tomas\s+)?[^\s-]+\s+-\s+(.+)$/i.exec(t);
  if (dash) t = dash[1]!;
  // Solo caracteres de titulo; nada de rutas ni signos raros.
  t = t
    .replace(/[^\p{L}\p{N}\s¿?¡!.,'’★&+-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);
  return norm(t).length >= 3 ? { title: t, order } : null;
}

/** Palabras del mensaje que sirven para buscar un titulo (3+ letras, sin palabras comunes). */
function searchWords(normalized: string): string[] {
  return normalized.split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export class VideoCatalog {
  private cache: { at: number; list: InternalEntry[] } | null = null;

  constructor(
    /** Carpeta de cada estado (clave de STATE_FOLDERS -> ruta absoluta); las que falten se omiten. */
    private readonly folders: Partial<Record<string, string>>,
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  list(): VideoEntry[] {
    return this.entries().map(({ title, state }) => ({ title, state }));
  }

  private entries(): InternalEntry[] {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.list;
    const out: InternalEntry[] = [];
    for (const { key, state } of STATE_FOLDERS) {
      const dir = this.folders[key];
      if (!dir) continue;
      let names: string[];
      try {
        // Solo carpetas: los archivos (LEEME.txt, Resumen.txt, videos sueltos) se ignoran.
        names = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        continue;
      }
      for (const name of names) {
        const p = parseFolderName(name);
        if (!p) continue;
        const k = norm(p.title);
        // Si ya esta publicado, no se repite como "en produccion".
        if (out.some((e) => e.key.includes(k) || k.includes(e.key))) continue;
        out.push({ ...p, state, key: k });
      }
    }
    this.cache = { at: this.now(), list: out };
    return out;
  }

  /**
   * Videos para el mensaje (max. 8), o [] si no trata de videos (asi el contexto solo se paga cuando hace falta):
   * - los titulos que comparten palabras con el mensaje;
   * - si pregunta por videos ("¿cuándo sale…?"), ademas lo que esta en produccion y lo ultimo publicado, para que
   *   el bot pueda responder con sentido aunque lo que pide no este en la lista.
   */
  relevantTo(message: string): VideoEntry[] {
    const m = norm(message);
    const all = this.entries();
    const words = searchWords(m);
    const scored = all
      .map((e) => ({ e, score: words.filter((w) => e.key.split(" ").includes(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.e.order - a.e.order);
    const asksVideos = VIDEO_QUESTION.test(m);
    if (!asksVideos) return scored.slice(0, 3).map(({ e }) => ({ title: e.title, state: e.state }));

    const picked: InternalEntry[] = scored.slice(0, 4).map((x) => x.e);
    const add = (list: InternalEntry[]) => {
      for (const e of list) if (picked.length < MAX_IN_PROMPT && !picked.includes(e)) picked.push(e);
    };
    const byState = (s: VideoState) => all.filter((e) => e.state === s).sort((a, b) => b.order - a.order);
    add(byState("en_produccion"));
    add(byState("publicado").slice(0, 3));
    return picked.map(({ title, state }) => ({ title, state }));
  }
}

/** Preguntas sobre videos, aunque no digan "video": "¿cuándo sale…?", "¿vas a sacar…?", "lo próximo"… */
const VIDEO_QUESTION =
  /\b(video|videos|episodio|episodios|reel|reels|capitulo|estreno|estrenos|publicad\w*|proxim\w*|cuando sale\w*|cuando subes|cuando saca\w*|vas a (sacar|subir|hacer)|van a (sacar|subir|hacer)|saldra|subiras|haras un|haran un|harias un)\b/;

const STOPWORDS = new Set([
  "que", "quien", "como", "cuando", "donde", "para", "porque", "pero", "este", "esta", "esto", "eso", "esos", "esas",
  "todo", "todos", "todas", "tiene", "tienen", "sobre", "video", "videos", "hola", "papu", "papus", "sabes", "dime",
  "cual", "cuales", "algo", "mucho", "muy", "hay", "van", "vas", "sera", "fue", "son", "los", "las", "del", "con",
  "una", "uno", "unos", "unas", "mas", "the", "teto", "miku", "luka", "neru", "vocaloid", "sale", "saldra", "por",
  "sus", "ese", "esa", "ver", "era", "les", "nos", "mis", "tus", "hace", "hacer", "haras", "sacar", "subir", "proximo",
  "episodio", "algun", "alguno", "alguna", "otro", "otra", "gyrop", "canal", "nuevo", "nueva",
]);

/** Bloque para las instrucciones del LLM: solo titulo y estado. */
export function formatVideosForPrompt(videos: VideoEntry[]): string {
  return videos.map((v) => `- "${v.title}" — ${STATE_LABEL[v.state]}`).join("\n");
}

/** Rutas de las carpetas (estado -> ruta) a partir de la carpeta de entrega del escritorio. */
export function deliveryFolders(deliveryDir: string | null, relative: Record<string, string>): Partial<Record<string, string>> {
  if (!deliveryDir) return {};
  return Object.fromEntries(Object.entries(relative).map(([k, rel]) => [k, path.join(deliveryDir, rel)]));
}
