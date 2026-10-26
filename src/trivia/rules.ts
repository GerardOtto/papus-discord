// Reglas de la trivia de los Papus (config/trivia.json, PLAN §3.4). Funciones puras: cargar las preguntas (escritas,
// de audio y siluetas), barajar las opciones, revisar respuestas y calcular la XP de cada acierto. Las respuestas las
// revisa el codigo, nunca el LLM (regla 4).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, type BotId } from "../config";
import { isCorrect } from "../bodas/rules";
import { progress, type LevelSettings } from "../levels/rules";

export type TimerKind = "opciones" | "texto" | "audio" | "imagen";
export type ImageMode = "silueta" | "pixel" | "zoom";

export interface TriviaSettings {
  segundos: Record<TimerKind, number>;
  xp: { porcentajeNivel: number; porcentajeDia: number; dias: number; minimo: number; topeNivel: number };
  racha: { bono: number; tope: number };
  /** Por dia: partidas que dan XP y tope de XP de la trivia (fraccion de su nivel, con minimo). */
  limites: { partidasConXp: number; topeDiaNivel: number; topeDiaMinimo: number };
  siluetas: ImageMode[];
  secreto: { rol: string; color: string; mensaje: string };
}

/** Pregunta tal como se guarda en content/trivia.json o content/trivia-audio.json. */
interface RawQuestion {
  id: string;
  tipo?: "opciones" | "texto";
  tema?: string;
  pregunta: string;
  respuesta: string;
  otras?: string[];
  aceptadas?: string[];
  dato?: string;
}

export interface AudioClip extends RawQuestion {
  archivo: string;
  fuente: string;
  desde?: number;
  dura?: number;
  tempo?: number;
}

export interface Question {
  id: string;
  kind: "opciones" | "texto";
  /** Tema (canciones, personajes, historia, servidor, adivinanzas, audio, siluetas). */
  topic: string;
  text: string;
  /** La respuesta que se muestra (en opciones, la correcta). */
  answer: string;
  /** opciones: las 3 incorrectas. */
  wrong: string[];
  /** texto: respuestas que valen (incluye `answer`). */
  accepted: string[];
  fact?: string;
  /** Archivo de audio (ruta completa). */
  audio?: string;
  /** Imagen que se dibuja: figura del Vocaloid y cómo se muestra. */
  image?: { bot: BotId; mode: ImageMode };
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
export const AUDIO_DIR = path.join(REPO_ROOT, "assets/trivia/audio");
const FIGURES = path.join(REPO_ROOT, "assets/bots");

export function loadTriviaSettings(file = path.join(REPO_ROOT, "config/trivia.json")): TriviaSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as TriviaSettings;
  for (const k of ["opciones", "texto", "audio", "imagen"] as const) if (!(s.segundos[k] > 0)) throw new Error(`config/trivia.json: falta segundos.${k}`);
  return s;
}

export function loadAudioClips(file = path.join(REPO_ROOT, "content/trivia-audio.json")): AudioClip[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { clips: AudioClip[] }).clips;
}

/** Nombre de cada Vocaloid en las opciones de las siluetas. */
const FIGURE_NAMES: Record<BotId, string> = {
  teto: "Kasane Teto",
  miku: "Hatsune Miku",
  luka: "Megurine Luka",
  neru: "Akita Neru",
  gakupo: "Kamui Gakupo",
  kaito: "Kaito",
  flower: "v flower",
  ia: "IA",
  haku: "Yowane Haku",
  gumi: "Gumi",
  rin: "Kagamine Rin",
  len: "Kagamine Len",
  meiko: "Meiko",
  adachirei: "Adachi Rei",
  ruko: "Yokune Ruko",
};

const IMAGE_TEXT: Record<ImageMode, string> = {
  silueta: "🖤 ¿De quién es esta silueta?",
  pixel: "👾 ¿Quién está detrás de los píxeles?",
  zoom: "🔍 Acercamiento: ¿de quién es?",
};

function fromRaw(q: RawQuestion, topic: string): Question {
  const kind = q.tipo ?? "opciones";
  if (kind === "opciones" && q.otras?.length !== 3) throw new Error(`trivia: la pregunta ${q.id} necesita 3 opciones incorrectas`);
  return {
    id: q.id,
    kind,
    topic: q.tema ?? topic,
    text: q.pregunta,
    answer: q.respuesta,
    wrong: kind === "opciones" ? q.otras! : [],
    accepted: kind === "texto" ? [q.respuesta, ...(q.aceptadas ?? [])] : [],
    ...(q.dato ? { fact: q.dato } : {}),
  };
}

/**
 * Todas las preguntas: las escritas, las de audio cuyo archivo existe y las siluetas de los Vocaloids con figura
 * (`rnd` elige las opciones de las siluetas una sola vez). Los id no se repiten.
 */
export function loadQuestions(
  s: TriviaSettings,
  opts: { file?: string; audioFile?: string; audioDir?: string; figures?: string; rnd?: () => number } = {},
): Question[] {
  const rnd = opts.rnd ?? Math.random;
  const raw = JSON.parse(readFileSync(opts.file ?? path.join(REPO_ROOT, "content/trivia.json"), "utf8")) as { preguntas: RawQuestion[] };
  const out = raw.preguntas.map((q) => fromRaw(q, "general"));
  const audioDir = opts.audioDir ?? AUDIO_DIR;
  for (const c of loadAudioClips(opts.audioFile)) {
    const file = path.join(audioDir, c.archivo);
    if (existsSync(file)) out.push({ ...fromRaw(c, "audio"), audio: file });
  }
  const figures = opts.figures ?? FIGURES;
  const withFigure = BOT_IDS.filter((b) => existsSync(path.join(figures, `${b}_figura.png`)));
  for (const bot of withFigure) {
    for (const mode of s.siluetas) {
      const others = shuffle(withFigure.filter((b) => b !== bot), rnd).slice(0, 3).map((b) => FIGURE_NAMES[b]);
      out.push({ id: `silueta-${bot}-${mode}`, kind: "opciones", topic: "siluetas", text: IMAGE_TEXT[mode], answer: FIGURE_NAMES[bot], wrong: others, accepted: [], image: { bot, mode } });
    }
  }
  const seen = new Set<string>();
  for (const q of out) {
    if (seen.has(q.id)) throw new Error(`trivia: id repetido "${q.id}"`);
    seen.add(q.id);
  }
  return out;
}

export function figurePath(bot: BotId, figures = FIGURES): string {
  return path.join(figures, `${bot}_figura.png`);
}

/** Cuanto tiempo hay para responder (segun el tipo de pregunta). */
export function timerFor(s: TriviaSettings, q: Question): number {
  if (q.audio) return s.segundos.audio;
  if (q.image) return s.segundos.imagen;
  return s.segundos[q.kind];
}

export function shuffle<T>(list: readonly T[], rnd: () => number = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Opciones barajadas y el indice de la correcta. */
export function shuffledOptions(q: Question, rnd: () => number = Math.random): { options: string[]; correct: number } {
  const options = shuffle([q.answer, ...q.wrong], rnd);
  return { options, correct: options.indexOf(q.answer) };
}

/** ¿El texto escrito es una respuesta valida? (sin acentos, mayusculas, signos ni articulos, como las bodas) */
export function textCorrect(q: Question, text: string): boolean {
  return isCorrect(text, q.accepted);
}

/**
 * Orden de una partida: primero las que el Papu nunca vio, despues las demas (cada grupo barajado). Asi recorre todo
 * antes de repetir, y una racha perfecta pasa por todas las preguntas.
 */
export function playOrder(questions: readonly Question[], seen: ReadonlySet<string>, rnd: () => number = Math.random): string[] {
  const fresh = questions.filter((q) => !seen.has(q.id)).map((q) => q.id);
  const old = questions.filter((q) => seen.has(q.id)).map((q) => q.id);
  return [...shuffle(fresh, rnd), ...shuffle(old, rnd)];
}

// ───────────────────────── XP ─────────────────────────

/**
 * XP de un acierto (decision de GyroP: acorde al nivel y a lo que el Papu ha crecido los ultimos dias).
 * - base: lo mayor entre `porcentajeNivel` de lo que pide su nivel actual y `porcentajeDia` de su XP promedio por dia
 *   activo reciente (sin la de la trivia), entre `minimo` y `topeNivel` de su nivel.
 * - racha: `streak` = numero de este acierto en la racha (1 = el primero); cada uno anterior suma `bono`, hasta `tope`.
 * - por el multiplicador del evento de XP.
 * El tope del dia (`dailyCap`) lo aplica el servicio.
 */
export function answerXp(
  s: TriviaSettings,
  ls: LevelSettings,
  p: { xp: number; dailyAvg: number; streak: number; multiplier: number },
): number {
  const need = progress(ls, p.xp).needed;
  const byLevel = s.xp.porcentajeNivel * need;
  const byDay = s.xp.porcentajeDia * Math.max(0, p.dailyAvg);
  const base = Math.max(s.xp.minimo, Math.min(s.xp.topeNivel * need, Math.max(byLevel, byDay)));
  const streak = 1 + s.racha.bono * Math.min(Math.max(0, p.streak - 1), s.racha.tope);
  return Math.max(1, Math.round(base * streak * Math.max(1, p.multiplier)));
}

/**
 * XP maxima que da la trivia en un dia (decision de GyroP tras la prueba del 26 oct. 2026): `topeDiaNivel` de lo que
 * pide su nivel actual, al menos `topeDiaMinimo`. El evento de XP la multiplica tambien.
 */
export function dailyCap(s: TriviaSettings, ls: LevelSettings, xp: number, multiplier = 1): number {
  return Math.round(Math.max(s.limites.topeDiaMinimo, s.limites.topeDiaNivel * progress(ls, xp).needed) * Math.max(1, multiplier));
}
