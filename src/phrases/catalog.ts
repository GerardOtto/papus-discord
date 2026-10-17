// Catalogo de frases fijas por bot y grupo (content/frases/<bot>.json). Nunca gastan cuota (regla 4).
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, type BotId } from "../config";
import { fill, type DeckStore } from "./deck";

/** Grupos de todos los bots: preguntas sobre el proceso privado de GyroP (src/services/privacy.ts). */
const PRIVATE_GROUPS = ["pregunta_ia", "secreto_estudio"];
/** Grupos de las 4 chicas: saludo al conectarse y despedida al apagar (src/discord/app.ts). */
const PRESENCE_GROUPS = ["saludo_conexion", "despedida"];
/** Los Vocaloids de conversacion solo necesitan las frases de la conversacion y de privacidad. */
const CHAT_GROUPS = ["cuota_agotada", "cola_llena", "sin_api", ...PRIVATE_GROUPS];

/** Grupos obligatorios por bot (PLAN §6 + los que usa el codigo). */
export const REQUIRED_GROUPS: Record<BotId, string[]> = {
  teto: ["bienvenida", "bienvenida_grupal", "cumpleanos", "ya_volvi", "vitrina_nuevo", "cuota_agotada", "cola_llena", "sin_api", ...PRIVATE_GROUPS, ...PRESENCE_GROUPS],
  miku: [
    "votacion_abierta",
    "vitrina_votacion",
    "ultimo_aviso",
    "ganador",
    "estreno",
    "calendario",
    "noticia",
    "pedido_recibido",
    "pedido_en_produccion",
    "pedido_entregado",
    "pedido_rechazado",
    "cuota_agotada",
    "cola_llena",
    "sin_api",
    ...PRIVATE_GROUPS, ...PRESENCE_GROUPS,
  ],
  luka: ["tip_recibido", "falta_fuente", "tip_usado", "cuota_agotada", "cola_llena", "sin_api", ...PRIVATE_GROUPS, ...PRESENCE_GROUPS],
  neru: [
    "advertencia",
    "silencio_10",
    "silencio_60",
    "silencio_1440",
    "datos_personales",
    "estafa",
    "mayusculas",
    "enlace_cuenta_nueva",
    "flood",
    "resumen_despertar",
    "cuota_agotada",
    "cola_llena",
    "sin_api",
    ...PRIVATE_GROUPS, ...PRESENCE_GROUPS,
  ],
  gakupo: CHAT_GROUPS,
  kaito: CHAT_GROUPS,
  flower: CHAT_GROUPS,
  ia: CHAT_GROUPS,
  haku: CHAT_GROUPS,
  gumi: CHAT_GROUPS,
};

/** Campos que debe llevar cada frase de un grupo (PLAN §6: espacios para datos). */
export const REQUIRED_FIELDS: Record<string, string[]> = {
  "teto.bienvenida": ["papu"],
  "teto.bienvenida_grupal": ["papus"],
  "teto.cumpleanos": ["papu"],
  "miku.votacion_abierta": ["tema"],
  "miku.vitrina_votacion": ["tema"],
  "teto.vitrina_nuevo": ["canal", "nivel"],
  "miku.ganador": ["ganador"],
  "miku.estreno": ["video"],
  "miku.pedido_recibido": ["papu", "n"],
  "miku.pedido_en_produccion": ["papu"],
  "miku.pedido_entregado": ["papu"],
  "miku.pedido_rechazado": ["papu", "motivo"],
  "luka.tip_recibido": ["papu"],
  "luka.tip_usado": ["papu", "video"],
  "neru.advertencia": ["papu"],
  "neru.silencio_10": ["papu"],
  "neru.silencio_60": ["papu"],
  "neru.silencio_1440": ["papu"],
  "neru.resumen_despertar": ["n"],
};

export type PhraseGroups = Record<string, string[]>;

const CONTENT_DIR = path.resolve(import.meta.dirname, "../../content/frases");

export function loadPhraseFile(bot: BotId, dir = CONTENT_DIR): PhraseGroups {
  const raw = JSON.parse(readFileSync(path.join(dir, `${bot}.json`), "utf8")) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$"))) as PhraseGroups;
}

export class Phrases {
  private readonly groups: Record<BotId, PhraseGroups>;

  constructor(
    private readonly decks: DeckStore,
    groups?: Record<BotId, PhraseGroups>,
  ) {
    this.groups = groups ?? (Object.fromEntries(BOT_IDS.map((b) => [b, loadPhraseFile(b)])) as Record<BotId, PhraseGroups>);
  }

  has(bot: BotId, group: string): boolean {
    return (this.groups[bot][group]?.length ?? 0) > 0;
  }

  /** Siguiente frase del mazo (sin repetir) con los campos reemplazados. */
  pick(bot: BotId, group: string, vars: Record<string, string | number> = {}): string {
    const list = this.groups[bot][group];
    if (!list?.length) throw new Error(`No hay frases para ${bot}.${group}`);
    return fill(list[this.decks.next(`${bot}.${group}`, list.length)]!, vars);
  }
}
