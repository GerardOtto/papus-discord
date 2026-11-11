// Arma las preguntas generadas de la trivia (decision de GyroP, 2 nov. 2026: +5000 variadas y pocas de años) en
// content/trivia-generadas.json, desde content/trivia-banco.json y los archivos del motor (SOLO LECTURA):
//   - canciones: quien la hizo, quien canta, emojis, titulos incompletos, traducciones, la que sobra, verdadero o falso…
//   - personajes, curiosidades, verdadero o falso y el servidor (escritas en el banco);
//   - imagenes de ../Proyecto1/assets/characters (silueta, pixelada, acercamiento, a medias, en gris, piezas, franjas,
//     tal cual y la emocion que muestran); npm run trivia:imagenes las dibuja;
//   - fragmentos de ../Proyecto1/assets/music cada ~8 s (sin silencios); npm run trivia:audio los recorta.
// Todo es determinista: el mismo banco y los mismos archivos dan las mismas preguntas con los mismos id (el registro de
// preguntas vistas y superadas los usa). Necesita ffmpeg para medir los audios.
//   npm run trivia:generar
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDotEnv } from "../src/config";
import { GENERATED_FILE, type AudioClip, type Dificultad, type PictureMode, type PictureQuestion } from "../src/trivia/rules";

loadDotEnv();
const ROOT = path.resolve(import.meta.dirname, "..");
const engine = path.resolve(ROOT, process.env.ENGINE_DIR || "../Proyecto1");

interface Song { t: string; p: string; v: string[]; tr?: string; e?: string; aka?: string[] }
interface Character { n: string; pelo?: string; objeto?: string; empresa?: string; origen?: string; edad?: string; voz?: string }
interface Written { q: string; a: string; o: string[]; d: Dificultad; x?: string }
interface Statement { f: string; v: boolean; d: Dificultad; x: string }
interface Bank { canciones: Song[]; personajes: Character[]; curiosidades: Written[]; verdadero: Statement[]; servidor: Written[] }
interface Raw { id: string; tipo?: "opciones" | "texto"; tema: string; dificultad: Dificultad; pregunta: string; respuesta: string; otras?: string[]; aceptadas?: string[]; dato?: string }

const bank = JSON.parse(readFileSync(path.join(ROOT, "content/trivia-banco.json"), "utf8")) as Bank;

// ───────────────────────── ayudas ─────────────────────────

const slug = (s: string, max = 40) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max) || "x";

/** Azar fijo por clave (el mismo id elige siempre las mismas opciones). */
function rng(key: string): () => number {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: readonly T[], r: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** `n` distintos de `pool` (sin repetir texto ni la respuesta). null si no alcanzan. */
function pick(pool: readonly string[], n: number, r: () => number, avoid: readonly string[]): string[] | null {
  const out: string[] = [];
  const seen = new Set(avoid.map((a) => a.toLowerCase()));
  for (const x of shuffle([...new Set(pool)], r)) {
    if (seen.has(x.toLowerCase())) continue;
    seen.add(x.toLowerCase());
    out.push(x);
    if (out.length === n) return out;
  }
  return null;
}

/** Una de las formas de preguntar (varian para que no se lean todas igual). */
const variant = (forms: readonly string[], r: () => number) => forms[Math.floor(r() * forms.length)]!;

const questions: Raw[] = [];
const ids = new Set<string>();
function add(q: Raw): void {
  if (ids.has(q.id)) throw new Error(`id repetido: ${q.id}`);
  if ((q.tipo ?? "opciones") === "opciones") {
    const all = [q.respuesta, ...(q.otras ?? [])];
    if (new Set(all.map((x) => x.toLowerCase())).size !== all.length) throw new Error(`opciones repetidas en ${q.id}`);
    if (all.some((x) => x.length > 80)) throw new Error(`opción de más de 80 letras en ${q.id}`);
  }
  ids.add(q.id);
  questions.push(q);
}

const VF = { si: "Verdadero", no: "Falso" };
function trueFalse(id: string, tema: string, d: Dificultad, statement: string, isTrue: boolean, dato: string): void {
  add({ id, tema, dificultad: d, pregunta: `✅❌ ¿Verdadero o falso? ${statement}`, respuesta: isTrue ? VF.si : VF.no, otras: [isTrue ? VF.no : VF.si], dato });
}

const joinNames = (v: readonly string[]) => (v.length <= 1 ? (v[0] ?? "") : `${v.slice(0, -1).join(", ")} y ${v.at(-1)}`);
/** Personas de un productor ("Hachioji-P y Giga" -> dos), para no dar como incorrecta a una de ellas. */
const people = (p: string) => p.split(/ y /).map((x) => x.trim().toLowerCase());
const overlaps = (a: string, b: string) => people(a).some((x) => people(b).includes(x));

// ───────────────────────── canciones ─────────────────────────

const songs = bank.canciones;
const producers = [...new Set(songs.map((s) => s.p))];
const voiceSets = [...new Set(songs.filter((s) => s.v.length).map((s) => joinNames(s.v)))];
const singles = [...new Set(songs.flatMap((s) => s.v))];
const fact = (s: Song) => `«${s.t}» es de ${s.p}${s.v.length ? ` con ${joinNames(s.v)}` : ""}.`;
const byProducer = new Map<string, Song[]>();
for (const s of songs) byProducer.set(s.p, [...(byProducer.get(s.p) ?? []), s]);

for (const s of songs) {
  const k = slug(s.t);
  const id = (t: string) => `g-cancion-${t}-${k}`;
  const otherProducers = producers.filter((p) => !overlaps(p, s.p));
  const notMine = songs.filter((o) => !overlaps(o.p, s.p)).map((o) => o.t);

  // Quien la hizo.
  {
    const r = rng(id("productor"));
    add({
      id: id("productor"), tema: "canciones", dificultad: "medio",
      pregunta: variant([`¿Quién hizo la canción «${s.t}»?`, `«${s.t}» es obra de…`, `¿Qué productor está detrás de «${s.t}»?`, `🎹 ¿De quién es «${s.t}»?`], r),
      respuesta: s.p, otras: pick(otherProducers, 3, r, [s.p])!, dato: fact(s),
    });
  }
  // Cual es de ese productor.
  {
    const r = rng(id("de-productor"));
    add({
      id: id("de-productor"), tema: "canciones", dificultad: "medio",
      pregunta: variant([`¿Cuál de estas canciones es de ${s.p}?`, `${s.p} hizo una de estas. ¿Cuál?`, `Solo una es de ${s.p}. ¿Cuál?`], r),
      respuesta: s.t, otras: pick(notMine, 3, r, [s.t])!, dato: fact(s),
    });
  }
  // Verdadero o falso del productor.
  {
    const r = rng(id("vf-productor"));
    const isTrue = r() < 0.5;
    trueFalse(id("vf-productor"), "canciones", "medio", `«${s.t}» es de ${isTrue ? s.p : pick(otherProducers, 1, r, [s.p])![0]}.`, isTrue, fact(s));
  }
  if (s.v.length) {
    const disjoint = (set: string) => !s.v.some((x) => set.split(/, | y /).includes(x));
    // Quien canta.
    {
      const r = rng(id("voz"));
      const pool = [...singles, ...voiceSets].filter(disjoint);
      add({
        id: id("voz"), tema: "canciones", dificultad: "facil",
        pregunta: variant([`¿Quién canta «${s.t}»?`, `🎤 «${s.t}»: ¿qué voz la canta?`, `En «${s.t}», ¿quién pone la voz?`], r),
        respuesta: joinNames(s.v), otras: pick(pool, 3, r, [joinNames(s.v)])!, dato: fact(s),
      });
    }
    // Cual canta esa voz.
    {
      const r = rng(id("de-voz"));
      const pool = songs.filter((o) => o.v.length && !o.v.some((x) => s.v.includes(x))).map((o) => o.t);
      add({
        id: id("de-voz"), tema: "canciones", dificultad: "facil",
        pregunta: s.v.length > 1 ? `¿En cuál de estas cantan juntos ${joinNames(s.v)}?` : variant([`¿Cuál de estas canciones canta ${s.v[0]}?`, `${s.v[0]} canta una de estas. ¿Cuál?`], r),
        respuesta: s.t, otras: pick(pool, 3, r, [s.t])!, dato: fact(s),
      });
    }
    // Verdadero o falso de la voz.
    {
      const r = rng(id("vf-voz"));
      const isTrue = r() < 0.5;
      const who = isTrue ? joinNames(s.v) : pick(singles.filter(disjoint), 1, r, [])![0]!;
      trueFalse(id("vf-voz"), "canciones", "facil", `«${s.t}» la canta ${who}.`, isTrue, fact(s));
    }
  }
  // Adivinar por pistas: quien la hizo y quien la canta.
  if (s.v.length) {
    const r = rng(id("pistas"));
    const pool = songs.filter((o) => !(o.p === s.p && o.v.join() === s.v.join())).map((o) => o.t);
    add({
      id: id("pistas"), tema: "canciones", dificultad: "facil",
      pregunta: variant([`🕵️ Pistas: la hizo ${s.p} y la canta ${joinNames(s.v)}. ¿Qué canción es?`, `🕵️ Es de ${s.p}, con ${joinNames(s.v)}. ¿Cuál es?`], r),
      respuesta: s.t, otras: pick(pool, 3, r, [s.t, ...(byProducer.get(s.p) ?? []).filter((o) => o.v.join() === s.v.join()).map((o) => o.t)])!, dato: fact(s),
    });
  }
  // Otra del mismo autor.
  const mates = (byProducer.get(s.p) ?? []).filter((o) => o.t !== s.t);
  if (mates.length) {
    const r = rng(id("otra-del-autor"));
    const mate = mates[Math.floor(r() * mates.length)]!;
    add({
      id: id("otra-del-autor"), tema: "canciones", dificultad: "medio",
      pregunta: variant([`¿Qué otra canción hizo quien hizo «${s.t}»?`, `Si te gusta «${s.t}», ¿cuál de estas es del mismo productor?`], r),
      respuesta: mate.t, otras: pick(notMine, 3, r, [mate.t])!, dato: `«${s.t}» y «${mate.t}» son de ${s.p}.`,
    });
  }
  // Emojis.
  if (s.e) {
    const r = rng(id("emoji"));
    add({
      id: id("emoji"), tema: "emojis", dificultad: "facil",
      pregunta: variant([`🔤 Adivina la canción con emojis: ${s.e}`, `${s.e} ¿Qué canción es?`, `Estos emojis esconden una canción Vocaloid: ${s.e}`], r),
      respuesta: s.t, otras: pick(songs.map((o) => o.t), 3, r, [s.t, ...(s.aka ?? [])])!, dato: fact(s),
    });
  }
  // Traduccion (de ida y de vuelta).
  if (s.tr) {
    const trs = songs.filter((o) => o.tr && o.t !== s.t).map((o) => o.tr!);
    const r = rng(id("traduccion"));
    add({ id: id("traduccion"), tema: "titulos", dificultad: "medio", pregunta: variant([`¿Qué significa el título «${s.t}»?`, `«${s.t}» en español sería…`], r), respuesta: s.tr, otras: pick(trs, 3, r, [s.tr])!, dato: `«${s.t}» = «${s.tr}». ${fact(s)}` });
    const r2 = rng(id("traduccion-inversa"));
    add({
      id: id("traduccion-inversa"), tema: "titulos", dificultad: "medio",
      pregunta: variant([`¿Qué canción se llama, en español, «${s.tr}»?`, `Si tradujeras el título, quedaría «${s.tr}». ¿Qué canción es?`], r2),
      respuesta: s.t, otras: pick(songs.filter((o) => o.tr).map((o) => o.t), 3, r2, [s.t])!, dato: `«${s.t}» = «${s.tr}».`,
    });
  }
  // Titulo incompleto: falta la palabra mas larga (de opciones; una de cada cuatro se escribe).
  const words = s.t.split(/\s+/);
  if (words.length >= 2) {
    const clean = (w: string) => w.replace(/[^\p{L}\p{N}'-]/gu, "");
    const target = [...words].sort((a, b) => clean(b).length - clean(a).length)[0]!;
    const word = clean(target);
    if (word.length >= 3) {
      const shown = s.t.replace(target, target.replace(word, "＿＿＿"));
      const r = rng(id("completa"));
      const pool = songs.flatMap((o) => o.t.split(/\s+/).map(clean)).filter((w) => w.length >= 3 && w.toLowerCase() !== word.toLowerCase());
      if (r() < 0.25) {
        add({ id: id("completa"), tipo: "texto", tema: "titulos", dificultad: "dificil", pregunta: `✍️ Escribe la palabra que falta: «${shown}»`, respuesta: word, dato: fact(s) });
      } else {
        add({ id: id("completa"), tema: "titulos", dificultad: "facil", pregunta: variant([`Completa el título: «${shown}»`, `¿Qué palabra falta? «${shown}»`], r), respuesta: word, otras: pick(pool, 3, r, [word])!, dato: fact(s) });
      }
    }
  }
}

// La que sobra y las del mismo productor.
for (const [p, list] of byProducer) {
  if (list.length >= 3) {
    const outsiders = songs.filter((o) => !overlaps(o.p, p)).map((o) => o.t);
    const combos = Math.min(6, list.length);
    for (let c = 0; c < combos; c++) {
      const id = `g-cancion-sobra-${slug(p)}-${c + 1}`;
      const r = rng(id);
      const three = pick(list.map((s) => s.t), 3, r, [])!;
      const odd = pick(outsiders, 1, r, three)![0]!;
      add({ id, tema: "canciones", dificultad: "medio", pregunta: variant([`¿Cuál de estas NO es de ${p}?`, `Tres son de ${p} y una no. ¿Cuál sobra?`], r), respuesta: odd, otras: three, dato: `${three.map((t) => `«${t}»`).join(", ")} son de ${p}; «${odd}» no.` });
    }
  }
  if (list.length >= 2) {
    const pairs = Math.min(3, Math.floor(list.length / 2) + 1);
    for (let c = 0; c < pairs; c++) {
      const id = `g-cancion-mismo-${slug(p)}-${c + 1}`;
      const r = rng(id);
      const [a, b] = pick(list.map((s) => s.t), 2, r, [])!;
      add({
        id, tema: "canciones", dificultad: "medio",
        pregunta: variant([`«${a}» y «${b}» son del mismo productor. ¿De quién?`, `Pista: hizo «${a}» y también «${b}». ¿Quién es?`], r),
        respuesta: p, otras: pick(producers.filter((x) => !overlaps(x, p)), 3, r, [p])!, dato: `«${a}» y «${b}» son de ${p}.`,
      });
    }
  }
}
// ¿Mismo productor? (verdadero o falso) y que tienen en comun dos canciones de la misma voz.
for (const s of songs) {
  const id = `g-cancion-vf-mismo-${slug(s.t)}`;
  const r = rng(id);
  const mates = (byProducer.get(s.p) ?? []).filter((o) => o.t !== s.t);
  const isTrue = mates.length > 0 && r() < 0.5;
  const other = isTrue ? mates[Math.floor(r() * mates.length)]! : songs.filter((o) => !overlaps(o.p, s.p))[Math.floor(r() * songs.filter((o) => !overlaps(o.p, s.p)).length)]!;
  trueFalse(id, "canciones", "medio", `«${s.t}» y «${other.t}» son del mismo productor.`, isTrue, `«${s.t}» es de ${s.p}; «${other.t}», de ${other.p}.`);
}
for (const voice of singles) {
  const mine = songs.filter((s) => s.v.length === 1 && s.v[0] === voice);
  for (let c = 0; c + 1 < mine.length && c < 12; c += 2) {
    const [a, b] = [mine[c]!, mine[c + 1]!];
    if (a.p === b.p) continue;
    const id = `g-cancion-comun-${slug(a.t)}-${slug(b.t)}`;
    const r = rng(id);
    const others = singles.filter((x) => x !== voice).map((x) => `Las canta ${x}`);
    add({ id, tema: "canciones", dificultad: "medio", pregunta: `¿Qué tienen en común «${a.t}» y «${b.t}»?`, respuesta: `Las canta ${voice}`, otras: pick(others, 3, r, [])!, dato: `${voice} canta las dos (una de ${a.p} y otra de ${b.p}).` });
  }
}
// La que no canta tal voz.
for (const voice of singles) {
  const mine = songs.filter((s) => s.v.includes(voice));
  if (mine.length < 3) continue;
  const others = songs.filter((s) => s.v.length && !s.v.includes(voice)).map((s) => s.t);
  const combos = Math.min(voice === "Miku" ? 12 : 5, mine.length - 2);
  for (let c = 0; c < combos; c++) {
    const id = `g-cancion-no-canta-${slug(voice)}-${c + 1}`;
    const r = rng(id);
    const three = pick(mine.map((s) => s.t), 3, r, [])!;
    const odd = pick(others, 1, r, three)![0]!;
    add({ id, tema: "canciones", dificultad: "facil", pregunta: `¿Cuál de estas canciones NO canta ${voice}?`, respuesta: odd, otras: three, dato: `${voice} canta ${three.map((t) => `«${t}»`).join(", ")}; «${odd}» no.` });
  }
}

// ───────────────────────── personajes ─────────────────────────

const chars = bank.personajes;
const ORIGINS = ["Vocaloid oficial", "UTAU (hecha por fans)", "Derivada hecha por fans", "Personaje de un anime"];
for (const c of chars) {
  const k = slug(c.n);
  const id = (t: string) => `g-personaje-${t}-${k}`;
  const others = chars.filter((o) => o.n !== c.n);
  if (c.pelo) {
    const r = rng(id("pelo-inverso"));
    const pool = others.filter((o) => o.pelo && o.pelo !== c.pelo).map((o) => o.n);
    add({ id: id("pelo-inverso"), tema: "personajes", dificultad: "facil", pregunta: variant([`¿Quién de estos tiene el pelo ${c.pelo.toLowerCase()}?`, `Pelo ${c.pelo.toLowerCase()}: ¿de quién es?`], r), respuesta: c.n, otras: pick(pool, 3, r, [c.n])!, dato: `${c.n}: pelo ${c.pelo.toLowerCase()}.` });
    const r2 = rng(id("pelo-dibujo"));
    const colors = [...new Set(chars.map((o) => o.pelo).filter((x): x is string => !!x && x !== c.pelo)), "Negro", "Naranja"];
    add({ id: id("pelo-dibujo"), tema: "personajes", dificultad: "facil", pregunta: `🎨 Vas a dibujar a ${c.n}. ¿Con qué color le pintas el pelo?`, respuesta: c.pelo, otras: pick(colors, 3, r2, [c.pelo])!, dato: `${c.n}: pelo ${c.pelo.toLowerCase()}.` });
  }
  if (c.objeto) {
    const r = rng(id("objeto-regalo"));
    const pool = others.filter((o) => o.objeto).map((o) => o.n);
    add({ id: id("objeto-regalo"), tema: "personajes", dificultad: "facil", pregunta: variant([`🎁 Tienes ${c.objeto.toLowerCase()} para regalar. ¿A quién se lo das?`, `¿A quién le encantaría recibir ${c.objeto.toLowerCase()}?`], r), respuesta: c.n, otras: pick(pool, 3, r, [c.n])!, dato: `A ${c.n} se le asocia: ${c.objeto.toLowerCase()}.` });
    const r2 = rng(id("vf-objeto"));
    const isTrue = r2() < 0.5;
    const thing = isTrue ? c.objeto : pick(others.filter((o) => o.objeto).map((o) => o.objeto!), 1, r2, [c.objeto])![0]!;
    trueFalse(id("vf-objeto"), "personajes", "facil", `A ${c.n} se le asocia: ${thing.toLowerCase()}.`, isTrue, `A ${c.n} se le asocia: ${c.objeto.toLowerCase()}.`);
  }
  if (c.empresa) {
    const r = rng(id("empresa-cual"));
    const pool = others.filter((o) => o.empresa !== c.empresa).map((o) => o.n);
    add({ id: id("empresa-cual"), tema: "personajes", dificultad: "medio", pregunta: `¿Cuál de estos personajes es de ${c.empresa}?`, respuesta: c.n, otras: pick(pool, 3, r, [c.n])!, dato: `${c.n} es de ${c.empresa}.` });
    const r2 = rng(id("vf-empresa"));
    const companies = [...new Set(chars.map((o) => o.empresa).filter((x): x is string => !!x && x !== c.empresa))];
    const isTrue = r2() < 0.5;
    trueFalse(id("vf-empresa"), "personajes", "medio", `${c.n} es de ${isTrue ? c.empresa : pick(companies, 1, r2, [])![0]}.`, isTrue, `${c.n} es de ${c.empresa}.`);
  }
  if (c.origen) {
    const r = rng(id("origen"));
    add({ id: id("origen"), tema: "personajes", dificultad: "medio", pregunta: variant([`¿Qué es ${c.n}?`, `${c.n} es…`], r), respuesta: c.origen, otras: ORIGINS.filter((o) => o !== c.origen).slice(0, 3), dato: `${c.n}: ${c.origen.toLowerCase()}.` });
  }
  if (c.edad) {
    const r = rng(id("edad-inversa"));
    const pool = others.filter((o) => o.edad && o.edad !== c.edad).map((o) => o.n);
    add({ id: id("edad-inversa"), tema: "personajes", dificultad: "medio", pregunta: `¿Quién de estos tiene ${c.edad} años?`, respuesta: c.n, otras: pick(pool, 3, r, [c.n])!, dato: `${c.n} tiene ${c.edad} años.` });
  }
  if (c.voz) {
    const r = rng(id("vf-voz"));
    const voices = [...new Set(chars.map((o) => o.voz).filter((x): x is string => !!x && x !== c.voz))];
    const isTrue = r() < 0.5;
    trueFalse(id("vf-voz"), "personajes", "medio", `${isTrue ? c.voz : pick(voices, 1, r, [])![0]} le puso la voz a ${c.n}.`, isTrue, `La voz de ${c.n} es de ${c.voz}.`);
  }
}

// ───────────────────────── escritas en el banco ─────────────────────────

for (const w of bank.curiosidades) add({ id: `g-curiosidad-${slug(w.q, 90)}`, tema: "curiosidades", dificultad: w.d, pregunta: w.q, respuesta: w.a, otras: w.o, ...(w.x ? { dato: w.x } : {}) });
for (const s of bank.verdadero) trueFalse(`g-vf-${slug(s.f, 90)}`, "curiosidades", s.d, s.f, s.v, s.x);
for (const w of bank.servidor) add({ id: `g-servidor-${slug(w.q, 90)}`, tema: "servidor", dificultad: w.d, pregunta: w.q, respuesta: w.a, otras: w.o, ...(w.x ? { dato: w.x } : {}) });

// ───────────────────────── imagenes del motor ─────────────────────────

/** Carpeta del motor -> quien es (las de trajes, al Vocaloid que lo lleva). Las demas no salen. */
const FOLDERS: Record<string, string> = {
  teto: "Kasane Teto", tetosv: "Kasane Teto", tetosv2: "Kasane Teto", tetovp: "Kasane Teto",
  miku: "Hatsune Miku", mikunoble: "Hatsune Miku", mikuonepiece: "Hatsune Miku", mikuvintage: "Hatsune Miku", mikuzukin: "Hatsune Miku", mikuappend: "Hatsune Miku", mikuen: "Hatsune Miku", mikunt: "Hatsune Miku", mikuv6: "Hatsune Miku",
  luka: "Megurine Luka", lukabruja: "Megurine Luka", lukafraulein: "Megurine Luka", lukasuccessor: "Megurine Luka",
  rin: "Kagamine Rin", rinfairy: "Kagamine Rin", rinmuneca: "Kagamine Rin",
  len: "Kagamine Len", lenmuneco: "Kagamine Len", lentricker: "Kagamine Len",
  kaito: "Kaito", kaitoclassic: "Kaito", kaitodiamond: "Kaito", kaitoguilty: "Kaito", kaitorequiem: "Kaito",
  meiko: "Meiko", meikoblazing: "Meiko", meikolorelei: "Meiko", meikomomiji: "Meiko", meikoscarlet: "Meiko",
  gumi: "Gumi", gumicriada: "Gumi", gumillia: "Gumi",
  gakupo: "Kamui Gakupo", gakupomayordomo: "Kamui Gakupo",
  haku: "Yowane Haku", hakuclarith: "Yowane Haku",
  neru: "Akita Neru", ia: "IA", flower: "v flower", adachirei: "Adachi Rei", ruko: "Yokune Ruko",
  defoko: "Defoko", kafu: "KAFU", lily: "Lily", mikuo: "Hatsune Mikuo", nero: "Akita Nero", luki: "Megurine Luki", meito: "Sakine Meito", ted: "Kasane Ted", momo: "Momone Momo",
};
const BASE = new Set(["teto", "miku", "luka", "rin", "len", "kaito", "meiko", "gumi", "gakupo", "haku", "neru", "ia", "flower", "adachirei", "ruko", "defoko", "kafu", "lily"]);
/** Parecidos (las opciones incorrectas salen primero de aqui: que no sea solo por el color). */
const LOOKALIKE: Record<string, string[]> = {
  "Hatsune Miku": ["Hatsune Mikuo", "Gumi", "Akita Neru", "Yowane Haku"],
  "Hatsune Mikuo": ["Hatsune Miku", "Kaito", "Kagamine Len"],
  "Kasane Teto": ["Kasane Ted", "Meiko", "Momone Momo"],
  "Kasane Ted": ["Kasane Teto", "Sakine Meito", "Kaito"],
  "Megurine Luka": ["Megurine Luki", "IA", "Momone Momo"],
  "Megurine Luki": ["Megurine Luka", "Kamui Gakupo", "Kaito"],
  "Kagamine Rin": ["Kagamine Len", "Akita Neru", "Lily"],
  "Kagamine Len": ["Kagamine Rin", "Akita Nero", "Akita Neru"],
  "Akita Neru": ["Akita Nero", "Kagamine Rin", "Lily"],
  "Akita Nero": ["Akita Neru", "Kagamine Len", "Kagamine Rin"],
  "Meiko": ["Sakine Meito", "Kasane Teto", "Kaito"],
  "Sakine Meito": ["Meiko", "Kaito", "Kasane Ted"],
  "Yowane Haku": ["Yokune Ruko", "IA", "Defoko"],
  "Yokune Ruko": ["Yowane Haku", "Defoko", "Adachi Rei"],
  "Defoko": ["Yokune Ruko", "Kamui Gakupo", "Yowane Haku"],
  "Kamui Gakupo": ["Defoko", "Kaito", "Megurine Luki"],
  "Lily": ["Kagamine Rin", "Akita Neru", "IA"],
  "IA": ["Yowane Haku", "Megurine Luka", "KAFU"],
  "KAFU": ["IA", "Adachi Rei", "Yowane Haku"],
  "Adachi Rei": ["KAFU", "Yokune Ruko", "IA"],
};
const NAMES = [...new Set(Object.values(FOLDERS))];

const MODE_WEIGHTS: [PictureMode, number][] = [["normal", 8], ["silueta", 18], ["pixel", 16], ["zoom", 13], ["mitad", 13], ["gris", 12], ["piezas", 12], ["franjas", 8]];
const MODE_LEVEL: Record<PictureMode, Dificultad> = { normal: "facil", silueta: "facil", pixel: "medio", mitad: "medio", franjas: "medio", piezas: "medio", gris: "dificil", zoom: "dificil" };
const MODE_TEXT: Record<PictureMode, string[]> = {
  normal: ["🖼️ ¿Quién es?", "🖼️ ¿Reconoces a este personaje?", "🖼️ ¿Quién posa en esta imagen?"],
  silueta: ["🖤 ¿De quién es esta silueta?", "🖤 Solo la sombra: ¿quién es?", "🖤 ¿Quién se esconde en la silueta?"],
  pixel: ["👾 ¿Quién está detrás de los píxeles?", "👾 Modo 8 bits: ¿quién es?", "👾 Pixelado a propósito. ¿Quién es?"],
  zoom: ["🔍 Acercamiento extremo: ¿de quién es?", "🔍 Muy de cerca. ¿Quién es?", "🔍 Un pedacito nada más: ¿quién es?"],
  mitad: ["🌗 Solo la mitad: ¿quién es?", "🌗 La otra mitad se fue por pan. ¿Quién es?", "🌗 Media imagen: ¿la reconoces?"],
  gris: ["🩶 Sin colores: ¿quién es?", "🩶 Le robaron el color. ¿Quién es?", "🩶 En blanco y negro, ¿quién es?"],
  piezas: ["🧩 Rompecabezas revuelto: ¿quién es?", "🧩 Las piezas están desordenadas. ¿Quién es?", "🧩 Arma la imagen en tu cabeza: ¿quién es?"],
  franjas: ["🪟 A través de la persiana: ¿quién es?", "🪟 Solo se ven unas franjas. ¿Quién es?"],
};
const EMOTIONS: Record<string, string> = { feliz: "Alegría", triste: "Tristeza", enojado: "Enojo", sorprendido: "Sorpresa", shocked: "Sorpresa", timido: "Timidez", pensando: "Duda" };
/** Opciones incorrectas de cada emocion: solo las que no se confunden con ella (alegria y timidez se parecen en caras con los ojos cerrados). */
const EMOTION_WRONG: Record<string, string[]> = {
  Alegría: ["Tristeza", "Enojo", "Duda"],
  Tristeza: ["Alegría", "Enojo", "Sorpresa"],
  Enojo: ["Alegría", "Tristeza", "Timidez"],
  Sorpresa: ["Tristeza", "Timidez", "Duda"],
  Timidez: ["Enojo", "Sorpresa", "Duda"],
  Duda: ["Enojo", "Alegría", "Sorpresa"],
};

function weighted(r: () => number): PictureMode {
  const total = MODE_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [m, w] of MODE_WEIGHTS) if ((x -= w) < 0) return m;
  return "normal";
}

function wrongNames(answer: string, r: () => number): string[] {
  const near = pick(LOOKALIKE[answer] ?? [], 2, r, [answer]) ?? pick(LOOKALIKE[answer] ?? [], 1, r, [answer]) ?? [];
  return [...near, ...pick(NAMES, 3 - near.length, r, [answer, ...near])!];
}

const pictures: PictureQuestion[] = [];
const charDir = path.join(engine, "assets/characters");
const emotionCount = new Map<string, number>();
if (!existsSync(charDir)) console.log(`⚠️ No encuentro ${charDir}: sin preguntas de imágenes`);
else {
  for (const folder of readdirSync(charDir).sort()) {
    const who = FOLDERS[folder];
    if (!who) continue;
    const files = readdirSync(path.join(charDir, folder)).filter((f) => f.endsWith(".png") && !f.includes("espejo")).sort();
    for (const file of files) {
      const stem = file.replace(/\.png$/, "");
      const fuente = `assets/characters/${folder}/${file}`;
      const id = `g-imagen-${slug(folder)}-${slug(stem)}`;
      const costume = !BASE.has(folder) && who !== "Hatsune Mikuo" && !["Akita Nero", "Megurine Luki", "Sakine Meito", "Kasane Ted", "Momone Momo"].includes(who);
      // Dos preguntas por imagen, cada una con otro efecto (la segunda, con id terminado en -v2).
      let first: PictureMode | null = null;
      for (const qid of [id, `${id}-v2`]) {
        const r = rng(qid);
        let modo = weighted(r);
        while (modo === first) modo = weighted(r);
        first = modo;
        const text = costume && (modo === "normal" || modo === "gris") ? `👗 Con otro traje, pero es alguien que conoces. ${variant(MODE_TEXT[modo], r).replace(/^\S+ /, "")}` : variant(MODE_TEXT[modo], r);
        pictures.push({ id: qid, tema: "imagenes", dificultad: MODE_LEVEL[modo], pregunta: text, respuesta: who, otras: wrongNames(who, r), dato: `Era ${who}.`, archivo: `${qid}.webp`, fuente, modo });
      }
      // Que emocion muestra (solo las claras; hasta 10 por personaje y emocion, de la carpeta principal).
      const emo = EMOTIONS[stem.replace(/^r3d_/, "").replace(/_\d+$/, "")];
      const key = `${who}:${emo}`;
      if (emo && BASE.has(folder) && (emotionCount.get(key) ?? 0) < 10) {
        emotionCount.set(key, (emotionCount.get(key) ?? 0) + 1);
        const eid = `g-emocion-${slug(folder)}-${slug(stem)}`;
        const er = rng(eid);
        pictures.push({
          id: eid, tema: "imagenes", dificultad: "facil",
          pregunta: variant([`🎭 ¿Qué emoción muestra ${who} aquí?`, `🎭 ¿Cómo se siente ${who} en esta imagen?`, `🎭 Mira la cara de ${who}: ¿qué siente?`], er),
          respuesta: emo, otras: shuffle(EMOTION_WRONG[emo]!, er), dato: `${who}: ${emo.toLowerCase()}.`, archivo: `${eid}.webp`, fuente, modo: "normal",
        });
      }
    }
  }
  // Parejas: quienes salen juntos.
  const pairsDir = path.join(charDir, "pares");
  const short: Record<string, string> = { miku: "Miku", luka: "Luka", rin: "Rin", len: "Len", kaito: "Kaito", meiko: "Meiko", gumi: "Gumi", teto: "Teto", neru: "Neru" };
  const pairFiles = existsSync(pairsDir) ? readdirSync(pairsDir).filter((f) => f.endsWith(".png")).sort() : [];
  const pairOf = (f: string) => {
    const [a, b] = f.split("_");
    return short[a!] && short[b!] ? [short[a!]!, short[b!]!].sort() : null;
  };
  const allPairs = [...new Set(pairFiles.map(pairOf).filter((p): p is string[] => !!p).map((p) => p.join(" y ")))];
  for (const f of pairFiles) {
    const pair = pairOf(f);
    if (!pair) continue;
    const answer = pair.join(" y ");
    const id = `g-pareja-${slug(f.replace(/\.png$/, ""))}`;
    const r = rng(id);
    const modo: PictureMode = r() < 0.5 ? "silueta" : "normal";
    const pool = [...allPairs, ...["Miku y Teto", "Kaito y Len", "Gumi y Rin", "Luka y Teto", "Meiko y Neru", "Len y Neru"]].filter((p) => !p.split(" y ").every((x) => pair.includes(x)));
    pictures.push({
      id, tema: "imagenes", dificultad: modo === "normal" ? "facil" : "dificil",
      pregunta: modo === "normal" ? variant(["👯 ¿Quiénes salen en esta imagen?", "👯 ¿Qué dúo es este?"], r) : variant(["🖤 Dos siluetas: ¿quiénes son?", "🖤 ¿Qué dúo se esconde en las sombras?"], r),
      respuesta: answer, otras: pick(pool, 3, r, [answer])!, dato: `Eran ${answer}.`, archivo: `${id}.webp`, fuente: `assets/characters/pares/${f}`, modo,
    });
  }
}

// ───────────────────────── fragmentos de audio ─────────────────────────

interface Track { fuente: string; tempo?: number; t: string; p?: string; v?: string; cover?: string; tipo?: "caja" | "orquesta" | "instrumental" | "gackt" }
/** Canciones del motor (creditos de config/assets.local.json del motor). v = quien canta; cover = quien canta el cover. */
const TRACKS: Track[] = [
  { fuente: "assets/music/lukaluka_night_fever.mp3", t: "Luka Luka★Night Fever", p: "samfree", v: "Megurine Luka" },
  { fuente: "assets/music/magnet.mp3", t: "Magnet", p: "minato", v: "Miku y Luka" },
  { fuente: "assets/music/odds_ends.mp3", t: "Odds & Ends", p: "ryo (supercell)", v: "Hatsune Miku" },
  { fuente: "assets/music/rolling_girl.mp3", t: "Rolling Girl", p: "wowaka", v: "Hatsune Miku" },
  { fuente: "assets/music/servant_of_evil.mp3", t: "Aku no Meshitsukai", p: "mothy (Akuno-P)", v: "Kagamine Len" },
  { fuente: "assets/music/teto_territory.mp3", t: "Teto Territory", v: "Kasane Teto" },
  { fuente: "assets/music/electric_angel.mp3", t: "Electric Angel", p: "Yasuo-P", v: "Hatsune Miku" },
  { fuente: "assets/music/hoshi_no_kakera.mp3", t: "Hoshi no Kakera", p: "Eiji Hirasawa", v: "Hatsune Miku" },
  { fuente: "assets/music/adachi_rei.mp3", t: "Adachi Rei", p: "Sato Chinamini", v: "Adachi Rei y Teto" },
  { fuente: "assets/music/mukuro_attack_instrumental.mp3", t: "Mukuro Attack!!", p: "Utsu-P", tipo: "instrumental" },
  { fuente: "assets/music/cantarella_kaito_x0769.mp3", tempo: 0.769, t: "Cantarella", p: "Kurousa-P", v: "Kaito" },
  { fuente: "assets/music/dancing_samurai_x0751.mp3", tempo: 0.751, t: "Dancing Samurai", p: "mathru (Kanipan-P)", v: "Kamui Gakupo" },
  { fuente: "assets/music/ghost_rule_defoko_x0751.mp3", tempo: 0.751, t: "Ghost Rule", p: "DECO*27", cover: "Defoko" },
  { fuente: "assets/music/matryoshka_mirai_x0870.mp3", tempo: 0.87, t: "Matryoshka", p: "Hachi", v: "Miku y Gumi" },
  { fuente: "assets/music/meltdown_haku_x0870.mp3", tempo: 0.87, t: "Meltdown (Roshin Yuukai)", p: "iroha", cover: "Yowane Haku" },
  { fuente: "assets/music/mikumiku_x0870.mp3", tempo: 0.87, t: "Miku Miku ni Shite Ageru", p: "ika", v: "Hatsune Miku" },
  { fuente: "assets/music/nettoge_haijin_x0833.mp3", tempo: 0.833, t: "Nettoge Haijin Sprechchor", p: "Satsuki ga Tenkomori", v: "Hatsune Miku" },
  { fuente: "assets/music/phony_teto_x0870.mp3", tempo: 0.87, t: "Phony", p: "Tsumiki", cover: "Kasane Teto" },
  { fuente: "assets/music/rokuchounen_x0751.mp3", tempo: 0.751, t: "Rokuchounen to Ichiya Monogatari", p: "kemu", v: "IA" },
  { fuente: "assets/music/triple_baka_x0751.mp3", tempo: 0.751, t: "Triple Baka", p: "LamazeP", v: "Miku, Teto y Neru" },
  { fuente: "assets/music/zako_neru_x0751.mp3", tempo: 0.751, t: "Zako", p: "Hiiragi Magnetite" },
  { fuente: "assets/music/saga_doe_original_x0791.mp3", tempo: 0.791, t: "Aku no Musume", p: "mothy (Akuno-P)", v: "Kagamine Rin" },
  { fuente: "assets/music/goodbye_sengen_sync.mp3", t: "Goodbye Sengen", p: "Chinozo", v: "v flower" },
  { fuente: "assets/music/saga_regret_original_x0791.mp3", tempo: 0.791, t: "Regret Message", p: "mothy (Akuno-P)", v: "Kagamine Rin" },
  { fuente: "assets/music/ben_original_x0791.mp3", tempo: 0.791, t: "Bad∞End∞Night", p: "Hitoshizuku-P" },
  { fuente: "assets/music/ben_crazy_x0791.mp3", tempo: 0.791, t: "Crazy∞nighT", p: "Hitoshizuku-P" },
  { fuente: "assets/music/birdbrain_x0791.mp3", tempo: 0.791, t: "BIRDBRAIN", p: "Jamie Paige", v: "Kasane Teto" },
  { fuente: "assets/music/ruko_ultra_rupture_x0870.mp3", tempo: 0.87, t: "Ultra rupture", cover: "Yokune Ruko" },
  { fuente: "assets/music/nyancat_x0870.mp3", tempo: 0.87, t: "Nyanyanyanyanyanyanya!", p: "daniwell", cover: "Momone Momo" },
  { fuente: "assets/music/saga_doe_orquesta_x0791.mp3", tempo: 0.791, t: "Aku no Musume", p: "mothy (Akuno-P)", tipo: "orquesta" },
  { fuente: "assets/music/saga_soe_orquesta_x0791.mp3", tempo: 0.791, t: "Aku no Meshitsukai", p: "mothy (Akuno-P)", tipo: "orquesta" },
  { fuente: "assets/music/saga_regret_cajamusical_x0791.mp3", tempo: 0.791, t: "Regret Message", p: "mothy (Akuno-P)", tipo: "caja" },
  { fuente: "assets/music/saga_doe_cajamusical_x0791.mp3", tempo: 0.791, t: "Aku no Musume", p: "mothy (Akuno-P)", tipo: "caja" },
  { fuente: "assets/music/saga_soe_cajamusical_x0791.mp3", tempo: 0.791, t: "Aku no Meshitsukai", p: "mothy (Akuno-P)", tipo: "caja" },
  { fuente: "assets/music/gackt_vanilla_x0751.mp3", tempo: 0.751, t: "Vanilla", tipo: "gackt" },
];
const STEP = 8;
const DURA = 7;
const VOICES = ["Hatsune Miku", "Kasane Teto", "Megurine Luka", "Kagamine Rin", "Kagamine Len", "Kaito", "Gumi", "IA", "v flower", "Kamui Gakupo", "Yowane Haku", "Defoko", "Yokune Ruko", "Momone Momo", "Akita Neru", "Adachi Rei", "Miku y Luka", "Miku y Gumi"];
const TITLES = [...new Set([...TRACKS.map((t) => t.t), ...songs.map((s) => s.t)])];
const handClips = (JSON.parse(readFileSync(path.join(ROOT, "content/trivia-audio.json"), "utf8")) as { clips: AudioClip[] }).clips;

function seconds(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(r.stdout.trim()) || 0;
}
/** Volumen medio (dB) de un tramo del archivo, para no preguntar por un silencio. */
function loudness(file: string, from: number, dur: number): number {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", String(dur), "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : -99;
}

const clips: AudioClip[] = [];
for (const tr of TRACKS) {
  const file = path.join(engine, tr.fuente);
  if (!existsSync(file)) {
    console.log(`⚠️ falta en el motor: ${tr.fuente}`);
    continue;
  }
  const tempo = tr.tempo ?? 1;
  const total = seconds(file) * tempo; // segundos de la cancion original
  const taken = handClips.filter((c) => c.respuesta.startsWith(tr.t.split(" (")[0]!)).map((c) => c.desde ?? 0);
  let n = 0;
  for (let at = 8; at + DURA + 4 < total; at += STEP) {
    if (taken.some((t) => Math.abs(t - at) < 7)) continue;
    if (loudness(file, at / tempo, DURA / tempo) < -30) continue;
    n++;
    const id = `g-audio-${slug(tr.fuente.replace(/^.*\//, "").replace(/\.mp3$/, ""))}-${Math.round(at)}`;
    const r = rng(id);
    const base = { id, archivo: `${id}.mp3`, fuente: tr.fuente, desde: Math.round(at * 10) / 10, dura: DURA, ...(tempo !== 1 ? { tempo } : {}) };
    const credit = `«${tr.t}»${tr.p ? `, de ${tr.p}` : ""}${tr.v ? `, con ${tr.v}` : ""}${tr.cover ? ` (cover de ${tr.cover})` : ""}`;
    const titleQ = (pregunta: string, dificultad: Dificultad) =>
      clips.push({ ...base, tema: "audio", dificultad, pregunta, respuesta: tr.t, otras: pick(TITLES, 3, r, [tr.t, "Aku no Musume (Daughter of Evil)", "Aku no Meshitsukai (Servant of Evil)"])!, dato: `Era ${credit}.` });
    if (tr.tipo === "gackt") {
      clips.push({ ...base, tema: "audio", dificultad: "medio", pregunta: "🎤 Este cantante le prestó su voz a un Vocaloid. ¿A cuál?", respuesta: "Kamui Gakupo", otras: pick(["Kaito", "Kagamine Len", "Megurine Luki", "Hatsune Mikuo", "Sakine Meito"], 3, r, [])!, dato: "Era Gackt («Vanilla»): su voz es la de Kamui Gakupo." });
      continue;
    }
    if (tr.tipo === "caja" || tr.tipo === "orquesta") {
      titleQ(tr.tipo === "caja" ? variant(["🎧 Versión en caja musical: ¿qué canción es?", "🎶 Suena en cajita de música. ¿La reconoces?"], r) : variant(["🎻 Versión orquestal: ¿qué canción es?", "🎻 Con orquesta suena distinta. ¿Cuál es?"], r), "dificil");
      continue;
    }
    const kinds: string[] = ["titulo", "titulo"];
    if (tr.v || tr.cover) kinds.push("voz");
    if (tr.p) kinds.push("productor");
    const kind = kinds[n % kinds.length]!;
    if (kind === "voz") {
      const who = tr.cover ?? tr.v!;
      clips.push({
        ...base, tema: "audio", dificultad: tr.cover ? "medio" : "facil",
        pregunta: tr.cover ? variant(["🎤 Es un cover. ¿Quién lo canta?", "🎤 Otra voz canta esta canción. ¿Quién es?"], r) : variant(["🎤 ¿Quién canta este fragmento?", "🎤 ¿De quién es esta voz?", "🎤 Escucha la voz: ¿quién es?"], r),
        respuesta: who, otras: pick(VOICES.filter((x) => !who.split(/, | y /).some((w) => x.includes(w.split(" ").at(-1)!))), 3, r, [who])!, dato: `Era ${credit}.`,
      });
    } else if (kind === "productor") {
      clips.push({ ...base, tema: "audio", dificultad: "medio", pregunta: variant(["🎹 ¿Quién hizo la canción de este fragmento?", "🎹 Escucha y adivina el productor:"], r), respuesta: tr.p!, otras: pick(producers.filter((p) => !overlaps(p, tr.p!)), 3, r, [tr.p!])!, dato: `Era ${credit}.` });
    } else if (tr.tipo === "instrumental") {
      titleQ(variant(["🎧 ¿De qué canción es este instrumental?", "🎸 Sin voz: ¿qué canción es?"], r), "medio");
    } else if (r() < 0.12) {
      const song = songs.find((s) => s.t === tr.t);
      clips.push({ ...base, tipo: "texto", tema: "audio", dificultad: "dificil", pregunta: "✍️🎧 Escribe el nombre de esta canción.", respuesta: tr.t, aceptadas: song?.aka ?? [], dato: `Era ${credit}.` });
    } else {
      titleQ(tr.cover ? "🎧 Es un cover. ¿Qué canción es?" : variant(["🎧 ¿Qué canción es este fragmento?", "🎧 ¿La reconoces? ¿Qué canción suena?", "🎧 Adivina la canción:"], r), "medio");
    }
  }
}

// ───────────────────────── salida ─────────────────────────

for (const x of [...pictures, ...clips]) {
  if (ids.has(x.id)) throw new Error(`id repetido: ${x.id}`);
  ids.add(x.id);
}
const line = (o: object) => `    ${JSON.stringify(o)}`;
const out = [
  "{",
  `  "$comment": "GENERADO por npm run trivia:generar (scripts/trivia-generar.ts) desde content/trivia-banco.json y los archivos del motor. No editar a mano: cambia el banco y vuelve a generar. imagenes: npm run trivia:imagenes las dibuja en assets/trivia/imagenes/; clips: npm run trivia:audio los recorta en assets/trivia/audio/ (no se versionan; nube subir los copia). Una pregunta cuyo archivo falta no sale.",`,
  `  "preguntas": [\n${questions.map(line).join(",\n")}\n  ],`,
  `  "imagenes": [\n${pictures.map(line).join(",\n")}\n  ],`,
  `  "clips": [\n${clips.map(line).join(",\n")}\n  ]`,
  "}",
  "",
].join("\n");
writeFileSync(GENERATED_FILE, out);
const all = [...questions, ...pictures, ...clips];
const by = (f: (q: { dificultad?: Dificultad; tema?: string }) => string) => Object.entries(all.reduce<Record<string, number>>((a, q) => ((a[f(q)] = (a[f(q)] ?? 0) + 1), a), {}));
console.log(`✔ ${all.length} preguntas generadas (${questions.length} escritas, ${pictures.length} de imágenes, ${clips.length} de audio) en ${path.relative(ROOT, GENERATED_FILE)}`);
console.log(`  por dificultad: ${by((q) => q.dificultad ?? "medio").map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`  por tema: ${by((q) => q.tema ?? "-").map(([k, v]) => `${k} ${v}`).join(" · ")}`);
