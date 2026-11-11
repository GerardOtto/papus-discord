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
/** Secciones de /trivia (decision de GyroP, 31 oct. 2026). */
export type Dificultad = "facil" | "medio" | "dificil";
export const DIFICULTADES: Dificultad[] = ["facil", "medio", "dificil"];
/** Sobre de la tienda que gana quien supera todas las preguntas de una dificultad. */
export type PremioSobre = "comun" | "raro" | "legendario";

/** Premio por hito: un sobre cada `cada` aciertos en una dificultad (pedido de GyroP, 7 nov. 2026). */
export interface Hito {
  cada: number;
  premio: PremioSobre;
  mensaje: string;
}

export interface TriviaSettings {
  segundos: Record<TimerKind, number>;
  xp: { porcentajeNivel: number; porcentajeDia: number; dias: number; minimo: number; topeNivel: number };
  racha: { bono: number; tope: number };
  /**
   * Por dia: partidas que dan XP y tope de XP de la trivia (fraccion de su nivel, con minimo). castigo: desde la partida
   * `desdePartida` del dia, cada una le quita XP (decision de GyroP, 2 nov. 2026, tras un Papu que supero todas las
   * preguntas a fuerza bruta en un dia): `porcentajeNivel` de lo que pide su nivel (al menos `minimo`), por `factor`
   * elevado a cuantas van despues de la primera que cuesta. `null` = sin castigo (GyroP lo quito el 2 nov. 2026).
   */
  limites: {
    partidasConXp: number;
    topeDiaNivel: number;
    topeDiaMinimo: number;
    castigo: { desdePartida: number; porcentajeNivel: number; minimo: number; factor: number } | null;
  };
  siluetas: ImageMode[];
  /**
   * nombre y emoji de cada seccion, el sobre de premio y el anuncio de Teto ({papu}, {n}). hito: cada `cada` aciertos
   * en esa dificultad, un sobre `premio` y el anuncio `mensaje` ({papu}, {n} = aciertos que lleva).
   */
  dificultades: Record<Dificultad, { nombre: string; emoji: string; premio: PremioSobre; mensaje: string; hito?: Hito }>;
  /** Hitos (pedido de GyroP, 7 nov. 2026): si solo cuentan los aciertos de las partidas que dan XP (contra la fuerza bruta). */
  hitos?: { soloPartidasConXp: boolean };
  siluetasDificultad: Record<ImageMode, Dificultad>;
  /**
   * Quien supera TODAS las preguntas: rol de adorno, sobres de premio, la cuenta regresiva de Teto, una frase fija de
   * cada Vocaloid conectado (coro, en orden) y el mensaje final con el diploma. rolesAnteriores: nombres que tuvo el rol
   * (Teto lo renombra al conectarse si el nuevo no existe).
   */
  secreto: {
    rol: string;
    rolesAnteriores?: string[];
    color: string;
    sobres: { tipo: PremioSobre; cantidad: number };
    previa: string;
    coro: Partial<Record<BotId, string>>;
    mensaje: string;
  };
}

/** Pregunta tal como se guarda en content/trivia.json o content/trivia-audio.json. */
interface RawQuestion {
  id: string;
  tipo?: "opciones" | "texto";
  tema?: string;
  dificultad?: Dificultad;
  pregunta: string;
  respuesta: string;
  otras?: string[];
  aceptadas?: string[];
  dato?: string;
}

/** Pregunta con imagen ya dibujada (content/trivia-generadas.json, imagenes): npm run trivia:imagenes la deja en assets/trivia/imagenes/. */
export interface PictureQuestion extends RawQuestion {
  archivo: string;
  /** Imagen del motor de la que sale y como se dibuja (src/trivia/images.ts). */
  fuente: string;
  modo: PictureMode;
}

/** Como se dibuja una imagen del motor (silueta, pixelada, acercamiento, a medias, en gris, en piezas revueltas, en franjas o tal cual). */
export type PictureMode = "normal" | "silueta" | "pixel" | "zoom" | "mitad" | "gris" | "piezas" | "franjas";

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
  /** Seccion de /trivia (sin dato en el archivo, media). */
  level: Dificultad;
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
  /** Imagen ya dibujada (ruta completa; preguntas generadas con imagenes del motor). */
  picture?: string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
export const AUDIO_DIR = path.join(REPO_ROOT, "assets/trivia/audio");
export const PICTURE_DIR = path.join(REPO_ROOT, "assets/trivia/imagenes");
/** Preguntas generadas por npm run trivia:generar (desde content/trivia-banco.json y los archivos del motor). */
export const GENERATED_FILE = path.join(REPO_ROOT, "content/trivia-generadas.json");

interface GeneratedFile {
  preguntas: RawQuestion[];
  clips: AudioClip[];
  imagenes: PictureQuestion[];
}

export function loadGenerated(file = GENERATED_FILE): GeneratedFile {
  if (!existsSync(file)) return { preguntas: [], clips: [], imagenes: [] };
  const g = JSON.parse(readFileSync(file, "utf8")) as Partial<GeneratedFile>;
  return { preguntas: g.preguntas ?? [], clips: g.clips ?? [], imagenes: g.imagenes ?? [] };
}
const FIGURES = path.join(REPO_ROOT, "assets/bots");

export function loadTriviaSettings(file = path.join(REPO_ROOT, "config/trivia.json")): TriviaSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as TriviaSettings;
  for (const k of ["opciones", "texto", "audio", "imagen"] as const) if (!(s.segundos[k] > 0)) throw new Error(`config/trivia.json: falta segundos.${k}`);
  for (const d of DIFICULTADES) if (!s.dificultades?.[d]?.premio) throw new Error(`config/trivia.json: falta dificultades.${d}`);
  for (const d of DIFICULTADES) {
    const h = s.dificultades[d].hito;
    if (h && !(Number.isInteger(h.cada) && h.cada >= 1 && ["comun", "raro", "legendario"].includes(h.premio) && h.mensaje)) throw new Error(`config/trivia.json: dificultades.${d}.hito mal escrito`);
  }
  for (const m of s.siluetas) if (!DIFICULTADES.includes(s.siluetasDificultad?.[m])) throw new Error(`config/trivia.json: falta siluetasDificultad.${m}`);
  if (!(s.secreto?.sobres?.cantidad >= 1) || !s.secreto.coro) throw new Error("config/trivia.json: faltan secreto.sobres o secreto.coro");
  const c = s.limites?.castigo;
  if (c && !(c.desdePartida >= 1 && c.factor >= 1 && c.minimo >= 0 && c.porcentajeNivel >= 0)) throw new Error("config/trivia.json: falta limites.castigo");
  return s;
}

/** Los fragmentos escritos a mano (content/trivia-audio.json) y los generados. */
export function loadAudioClips(file = path.join(REPO_ROOT, "content/trivia-audio.json"), generated = GENERATED_FILE): AudioClip[] {
  return [...(JSON.parse(readFileSync(file, "utf8")) as { clips: AudioClip[] }).clips, ...loadGenerated(generated).clips];
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
  // 3 incorrectas, o 1 en las de verdadero o falso.
  if (kind === "opciones" && q.otras?.length !== 3 && q.otras?.length !== 1) throw new Error(`trivia: la pregunta ${q.id} necesita 3 opciones incorrectas (o 1)`);
  if (q.dificultad && !DIFICULTADES.includes(q.dificultad)) throw new Error(`trivia: dificultad desconocida en ${q.id}`);
  return {
    id: q.id,
    kind,
    topic: q.tema ?? topic,
    level: q.dificultad ?? "medio",
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
  opts: { file?: string; audioFile?: string; audioDir?: string; figures?: string; generated?: string; pictureDir?: string; rnd?: () => number } = {},
): Question[] {
  const rnd = opts.rnd ?? Math.random;
  const raw = JSON.parse(readFileSync(opts.file ?? path.join(REPO_ROOT, "content/trivia.json"), "utf8")) as { preguntas: RawQuestion[] };
  const generated = opts.generated ?? GENERATED_FILE;
  const gen = loadGenerated(generated);
  const out = [...raw.preguntas, ...gen.preguntas].map((q) => fromRaw(q, "general"));
  const pictureDir = opts.pictureDir ?? PICTURE_DIR;
  for (const p of gen.imagenes) {
    const file = path.join(pictureDir, p.archivo);
    if (existsSync(file)) out.push({ ...fromRaw(p, "imagenes"), picture: file });
  }
  const audioDir = opts.audioDir ?? AUDIO_DIR;
  for (const c of loadAudioClips(opts.audioFile, generated)) {
    const file = path.join(audioDir, c.archivo);
    if (existsSync(file)) out.push({ ...fromRaw(c, "audio"), audio: file });
  }
  const figures = opts.figures ?? FIGURES;
  const withFigure = BOT_IDS.filter((b) => existsSync(path.join(figures, `${b}_figura.png`)));
  for (const bot of withFigure) {
    for (const mode of s.siluetas) {
      const others = shuffle(withFigure.filter((b) => b !== bot), rnd).slice(0, 3).map((b) => FIGURE_NAMES[b]);
      out.push({ id: `silueta-${bot}-${mode}`, kind: "opciones", topic: "siluetas", level: s.siluetasDificultad[mode], text: IMAGE_TEXT[mode], answer: FIGURE_NAMES[bot], wrong: others, accepted: [], image: { bot, mode } });
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
  if (q.image || q.picture) return s.segundos.imagen;
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
 * Orden de una partida: primero las que el Papu nunca vio, despues las que vio y aun no supera, al final las ya
 * superadas (cada grupo barajado). Asi recorre todo antes de repetir y avanza hacia completar la dificultad.
 */
export function playOrder(questions: readonly Question[], seen: ReadonlySet<string>, rnd: () => number = Math.random, passed: ReadonlySet<string> = new Set()): string[] {
  const ids = (f: (q: Question) => boolean) => questions.filter(f).map((q) => q.id);
  const fresh = ids((q) => !seen.has(q.id) && !passed.has(q.id));
  const pending = ids((q) => seen.has(q.id) && !passed.has(q.id));
  const done = ids((q) => passed.has(q.id));
  return [...shuffle(fresh, rnd), ...shuffle(pending, rnd), ...shuffle(done, rnd)];
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

/**
 * XP que cuesta empezar la partida `run` del dia (1 = la primera): 0 hasta antes de `desdePartida`; despues, lo mayor
 * entre `minimo` y `porcentajeNivel` de lo que pide su nivel, multiplicado por `factor` en cada partida siguiente
 * (con 16, 0,05 y 2: la 16 cuesta el 5 % del nivel, la 17 el 10 %, la 18 el 20 %…). Sin castigo, siempre 0. No lo toca
 * el evento de XP.
 */
export function runCost(s: TriviaSettings, ls: LevelSettings, xp: number, run: number): number {
  const c = s.limites.castigo;
  if (!c || run < c.desdePartida) return 0;
  const base = Math.max(c.minimo, c.porcentajeNivel * progress(ls, xp).needed);
  return Math.round(base * c.factor ** (run - c.desdePartida));
}
