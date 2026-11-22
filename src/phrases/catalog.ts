// Catalogo de frases fijas por bot y grupo (content/frases/<bot>.json). Nunca gastan cuota (regla 4).
import { existsSync, readFileSync } from "node:fs";
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
export const WEDDING_GROUPS = ["boda_adivinanza", "boda_acierto", "boda_desierta", "boda_divorcio"];
/**
 * Quienes, sin ser Vocaloids, tienen archivo de frases: Mango9374 (solo las de boda; se casa desde el 12 nov. 2026,
 * content/frases/mango.json) y Némesis, la crupier de la Ruleta de Némesis (no es un bot: las publica Teto;
 * content/frases/nemesis.json). Si falta el archivo, no tiene frases.
 */
export const EXTRA_PHRASE_BOTS = ["mango", "nemesis", "ofertas", "pecados"] as const;
const NEMESIS_GROUPS = ["nemesis_reto", "nemesis_click", "nemesis_bang", "nemesis_ganador"];
export type PhraseBot = BotId | (typeof EXTRA_PHRASE_BOTS)[number];

/** Grupos obligatorios por bot (PLAN §6 + los que usa el codigo). */
const BASE_GROUPS: Record<BotId, string[]> = {
  teto: ["bienvenida", "bienvenida_grupal", "se_fue", "cumpleanos", "ya_volvi", "vitrina_nuevo", "sube_rango", "papu_de_honor", "nivel_maximo", "prestigio", "ranking", "ruleta_premio", "ruleta_mision", "ruleta_regalo", "sorteo_ganador", "pelea_anuncio", "pelea_ganador", "carrera_anuncio", "carrera_ganador", "sobre_legendario", "sobre_abierto", "trivia_racha", "trivia_racha_libre", "trivia_cero", "intercambio_hecho", "fanart_nuevo", "cuota_agotada", "cola_llena", "sin_api", ...PRIVATE_GROUPS, ...PRESENCE_GROUPS],
  miku: [
    "votacion_abierta",
    "vitrina_nueva",
    "vitrina_votacion",
    "ultimo_aviso",
    "ganador",
    "estreno",
    "calendario",
    "noticia",
    "evento_xp",
    "cuota_agotada",
    "cola_llena",
    "sin_api",
    ...PRIVATE_GROUPS, ...PRESENCE_GROUPS,
  ],
  luka: ["cuota_agotada", "cola_llena", "sin_api", ...PRIVATE_GROUPS, ...PRESENCE_GROUPS],
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
    "maltrato",
    "exclusion",
    "mercado_abre",
    "machetazo_ficticio",
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
  // Ruko anuncia los cumpleaños en #general (config/cumpleanos.json; 18 nov. 2026).
  ruko: [...CHAT_GROUPS, "cumple_hoy", "cumple_vocaloid", "cumple_proximos"],
};

/** Campos que debe llevar cada frase de un grupo (PLAN §6: espacios para datos). */
export const REQUIRED_GROUPS = {
  ...Object.fromEntries(Object.entries(BASE_GROUPS).map(([bot, groups]) => [bot, WEDDING_BOTS.includes(bot as BotId) ? [...groups, ...WEDDING_GROUPS] : groups])),
  // Mango9374 solo tiene las de boda (sin LLM: no conversa).
  mango: WEDDING_GROUPS,
  nemesis: NEMESIS_GROUPS,
  // Ofertas de los Vocaloids en #centro-de-comercio (config/intercambios.json -> casa): las dice el Vocaloid que ofrece.
  ofertas: ["oferta_casa"],
  // Desafío de los 7 pecados (config/pecados.json): lo dice el anfitrión de la semana en #ranking.
  pecados: ["avaricia_progreso", "avaricia_cierre", "avaricia_ganancia", "avaricia_ganancia_varios"],
} as Record<PhraseBot, string[]>;

export const REQUIRED_FIELDS: Record<string, string[]> = {
  "nemesis.nemesis_reto": ["de", "papu", "monedas"],
  "ofertas.oferta_casa": ["objeto", "precio", "canal"],
  "nemesis.nemesis_click": ["papu"],
  "nemesis.nemesis_bang": ["papu"],
  "nemesis.nemesis_ganador": ["papu", "monedas"],
  ...Object.fromEntries([...WEDDING_BOTS, "mango"].flatMap((b) => [[`${b}.boda_adivinanza`, ["texto"]], [`${b}.boda_acierto`, ["papu"]], [`${b}.boda_divorcio`, ["papu"]]])),
  "pecados.avaricia_cierre": ["papu", "monedas"],
  "pecados.avaricia_ganancia": ["papu", "monedas"],
  "pecados.avaricia_ganancia_varios": ["papus"],
  "teto.bienvenida": ["papu"],
  "teto.bienvenida_grupal": ["papus"],
  "teto.se_fue": ["papu"],
  "ruko.cumple_hoy": ["papus"],
  "ruko.cumple_vocaloid": ["vocaloid"],
  "teto.cumpleanos": ["papu"],
  "teto.ruleta_premio": ["papu", "premio"],
  "teto.ruleta_mision": ["papu", "mision"],
  "teto.ruleta_regalo": ["papu", "de"],
  "teto.sorteo_ganador": ["papu", "premio"],
  "teto.pelea_anuncio": ["texto"],
  "teto.pelea_ganador": ["ganador"],
  "teto.carrera_anuncio": ["texto"],
  "teto.carrera_ganador": ["ganador"],
  "teto.sobre_legendario": ["papu", "objeto", "rareza"],
  "teto.sobre_abierto": ["papu", "n"],
  "miku.vitrina_nueva": ["proxima"],
  "teto.trivia_racha": ["papu", "racha", "xp"],
  "teto.trivia_racha_libre": ["papu", "racha"],
  "teto.trivia_cero": ["papu"],
  "teto.fanart_nuevo": ["papu", "redes"],
  "teto.intercambio_hecho": ["de", "papu"],
  "miku.votacion_abierta": ["tema"],
  "miku.vitrina_votacion": ["tema"],
  "teto.vitrina_nuevo": ["canal", "nivel"],
  "miku.ganador": ["ganador"],
  "miku.estreno": ["video"],
  "neru.advertencia": ["papu"],
  "neru.aviso": ["papu"],
  "neru.silencio_10": ["papu"],
  "neru.silencio_60": ["papu"],
  "neru.silencio_1440": ["papu"],
  "neru.resumen_despertar": ["n"],
  "neru.apoyo": ["papu"],
  "neru.maltrato": ["papu"],
  "neru.exclusion": ["papu"],
  "neru.mercado_abre": ["cierra"],
  "neru.machetazo_ficticio": ["papu", "de"],
  "teto.sube_rango": ["papu", "nivel", "rango"],
  "teto.papu_de_honor": ["papu"],
  "teto.nivel_maximo": ["papu"],
  "teto.prestigio": ["papu", "n"],
  "miku.evento_xp": ["n", "fecha"],
};

export type PhraseGroups = Record<string, string[]>;

const CONTENT_DIR = path.resolve(import.meta.dirname, "../../content/frases");

export function loadPhraseFile(bot: PhraseBot, dir = CONTENT_DIR): PhraseGroups {
  const raw = JSON.parse(readFileSync(path.join(dir, `${bot}.json`), "utf8")) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$"))) as PhraseGroups;
}

export class Phrases {
  private readonly groups: Partial<Record<PhraseBot, PhraseGroups>>;

  constructor(
    private readonly decks: DeckStore,
    groups?: Partial<Record<PhraseBot, PhraseGroups>>,
  ) {
    this.groups =
      groups ??
      Object.fromEntries([
        ...BOT_IDS.map((b) => [b, loadPhraseFile(b)]),
        ...EXTRA_PHRASE_BOTS.filter((b) => existsSync(path.join(CONTENT_DIR, `${b}.json`))).map((b) => [b, loadPhraseFile(b)]),
      ]);
  }

  has(bot: PhraseBot, group: string): boolean {
    return (this.groups[bot]?.[group]?.length ?? 0) > 0;
  }

  /** Siguiente frase del mazo (sin repetir) con los campos reemplazados. */
  pick(bot: PhraseBot, group: string, vars: Record<string, string | number> = {}): string {
    const list = this.groups[bot]?.[group];
    if (!list?.length) throw new Error(`No hay frases para ${bot}.${group}`);
    return fill(list[this.decks.next(`${bot}.${group}`, list.length)]!, vars);
  }
}
