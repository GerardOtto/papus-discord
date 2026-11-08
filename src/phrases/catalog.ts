// Catalogo de frases fijas por bot y grupo (content/frases/<bot>.json). Nunca gastan cuota (regla 4).
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, type BotId } from "../config";
import { fill, type DeckStore } from "./deck";

/** Grupos de todos los bots: preguntas sobre el proceso privado de GyroP (src/services/privacy.ts). */
const PRIVATE_GROUPS = ["pregunta_ia", "secreto_estudio"];
/** Grupos de las 4 chicas: saludo al conectarse, despedida al apagar y charla en #general (src/discord/app.ts). */
const PRESENCE_GROUPS = ["saludo_conexion", "despedida", "charla_general"];
/** Los Vocaloids de conversacion: frases de la conversacion, de privacidad y de la charla en #general (src/services/charla.ts). */
const CHAT_GROUPS = ["cuota_agotada", "cola_llena", "sin_api", "charla_general", ...PRIVATE_GROUPS];
/** Los Vocaloids de las bodas (config/bodas.json, src/discord/bodas.ts; los chicos desde el 25 oct. 2026): anuncio de la adivinanza, aceptacion, "nadie acerto" y divorcio. */
export const WEDDING_BOTS: readonly BotId[] = ["teto", "miku", "luka", "neru", "gakupo", "kaito", "flower", "ia", "haku", "gumi", "rin", "len", "meiko", "adachirei", "ruko"];
const WEDDING_GROUPS = ["boda_adivinanza", "boda_acierto", "boda_desierta", "boda_divorcio"];

/** Grupos obligatorios por bot (PLAN §6 + los que usa el codigo). */
const BASE_GROUPS: Record<BotId, string[]> = {
  teto: ["bienvenida", "bienvenida_grupal", "cumpleanos", "ya_volvi", "vitrina_nuevo", "sube_rango", "papu_de_honor", "nivel_maximo", "prestigio", "ranking", "ruleta_premio", "ruleta_mision", "sorteo_ganador", "pelea_anuncio", "pelea_ganador", "monedas_llegaron", "sobre_legendario", "sobre_abierto", "trivia_racha", "trivia_racha_libre", "trivia_cero", "cuota_agotada", "cola_llena", "sin_api", ...PRIVATE_GROUPS, ...PRESENCE_GROUPS],
  miku: [
    "votacion_abierta",
    "vitrina_nueva",
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
    "evento_xp",
    "cuota_agotada",
    "cola_llena",
    "sin_api",
    ...PRIVATE_GROUPS, ...PRESENCE_GROUPS,
  ],
  luka: ["tip_recibido", "falta_fuente", "tip_usado", "cuota_agotada", "cola_llena", "sin_api", ...PRIVATE_GROUPS, ...PRESENCE_GROUPS],
  neru: [
    "advertencia",
    "aviso",
    "silencio_10",
    "silencio_60",
    "silencio_1440",
    "invitacion",
    "perdon",
    "estafa",
    "mayusculas",
    "enlace_cuenta_nueva",
    "flood",
    "resumen_despertar",
    "apoyo",
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
  rin: CHAT_GROUPS,
  len: CHAT_GROUPS,
  meiko: CHAT_GROUPS,
  adachirei: CHAT_GROUPS,
  ruko: CHAT_GROUPS,
};

/** Campos que debe llevar cada frase de un grupo (PLAN §6: espacios para datos). */
export const REQUIRED_GROUPS = Object.fromEntries(
  Object.entries(BASE_GROUPS).map(([bot, groups]) => [bot, WEDDING_BOTS.includes(bot as BotId) ? [...groups, ...WEDDING_GROUPS] : groups]),
) as Record<BotId, string[]>;

export const REQUIRED_FIELDS: Record<string, string[]> = {
  ...Object.fromEntries(WEDDING_BOTS.flatMap((b) => [[`${b}.boda_adivinanza`, ["texto"]], [`${b}.boda_acierto`, ["papu"]], [`${b}.boda_divorcio`, ["papu"]]])),
  "teto.bienvenida": ["papu"],
  "teto.bienvenida_grupal": ["papus"],
  "teto.cumpleanos": ["papu"],
  "teto.ruleta_premio": ["papu", "premio"],
  "teto.ruleta_mision": ["papu", "mision"],
  "teto.sorteo_ganador": ["papu", "premio"],
  "teto.pelea_anuncio": ["texto"],
  "teto.pelea_ganador": ["ganador"],
  "teto.monedas_llegaron": ["papu", "monedas"],
  "teto.sobre_legendario": ["papu", "objeto", "rareza"],
  "teto.sobre_abierto": ["papu", "n"],
  "miku.vitrina_nueva": ["proxima"],
  "teto.trivia_racha": ["papu", "racha", "xp"],
  "teto.trivia_racha_libre": ["papu", "racha"],
  "teto.trivia_cero": ["papu"],
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
  "neru.aviso": ["papu"],
  "neru.silencio_10": ["papu"],
  "neru.silencio_60": ["papu"],
  "neru.silencio_1440": ["papu"],
  "neru.resumen_despertar": ["n"],
  "neru.apoyo": ["papu"],
  "teto.sube_rango": ["papu", "nivel", "rango"],
  "teto.papu_de_honor": ["papu"],
  "teto.nivel_maximo": ["papu"],
  "teto.prestigio": ["papu", "n"],
  "miku.evento_xp": ["n", "fecha"],
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
