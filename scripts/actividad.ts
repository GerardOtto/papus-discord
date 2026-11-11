// Arma la trivia multijugador (Actividad de Discord de Teto, PLAN §3.4):
//   npm run actividad            todas las preguntas de /trivia (desde el 8 nov. 2026, decision de GyroP), sus imagenes y audios, y la pagina
//   npm run actividad -- 50      pool de prueba de 50 (al menos una de cada tipo, dificultades parejas)
// Salidas: worker/src/actividad/pool.json (con las respuestas: solo lo lee el worker) y worker/public/actividad/ (la
// pagina, y en media/ los archivos con nombres que no delatan la respuesta). npm run worker:deploy lo sube.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { renderFigure } from "../src/trivia/images";
import { loadGenerated, loadQuestions, loadTriviaSettings, shuffle, timerFor, type Question } from "../src/trivia/rules";
import type { Dificultad, Pool, PreguntaPool } from "../worker/src/actividad/tipos";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "worker/public/actividad");
const MEDIA = path.join(OUT, "media");
const CLIENTE = path.join(ROOT, "worker/actividad/cliente");
const SIZE = process.argv[2] ? Number(process.argv[2]) : Infinity;
const LEVELS: Dificultad[] = ["facil", "medio", "dificil"];

/** Azar con semilla: el mismo pool cada vez que se arma (hasta cambiar la semilla o las preguntas). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const settings = loadTriviaSettings();
const questions = loadQuestions(settings, { rnd: seeded(7) });
const pictureMode = new Map(loadGenerated().imagenes.map((p) => [p.id, p.modo]));

/** Tipo de pregunta para cubrir de todo: audio, imagen (8 modos), figura (3 modos), verdadero o falso, y opciones/texto por tema. */
function categoria(q: Question): string {
  if (q.audio) return `audio-${q.kind}`;
  if (q.picture) return `imagen-${pictureMode.get(q.id) ?? "normal"}`;
  if (q.image) return `figura-${q.image.mode}`;
  if (q.kind === "opciones" && q.wrong.length === 1) return "verdadero-falso";
  return `${q.kind}-${q.topic}`;
}

const rnd = seeded(2026);
const shuffled = shuffle(questions, rnd);
const byCat = new Map<string, Question[]>();
for (const q of shuffled) byCat.set(categoria(q), [...(byCat.get(categoria(q)) ?? []), q]);
const cats = [...byCat.keys()].sort();
if (cats.length > SIZE) throw new Error(`Hay ${cats.length} tipos de pregunta: el pool necesita al menos ${cats.length}`);

const picked: Question[] = SIZE >= questions.length ? [...questions] : [];
const count = (l: Dificultad) => picked.filter((q) => q.level === l).length;
// 1) Una de cada tipo, repartiendo las dificultades (solo en un pool de prueba).
for (const c of picked.length ? [] : cats) {
  const list = byCat.get(c)!;
  const want = [...LEVELS].sort((a, b) => count(a) - count(b));
  const q = want.map((l) => list.find((x) => x.level === l)).find(Boolean) ?? list[0]!;
  picked.push(q);
}
// 2) El resto: la dificultad con menos y el tipo con menos, para que las tres secciones queden parejas.
const used = new Set(picked.map((q) => q.id));
while (picked.length < SIZE) {
  const level = [...LEVELS].sort((a, b) => count(a) - count(b))[0]!;
  const perCat = (c: string) => picked.filter((q) => categoria(q) === c).length;
  const q = shuffled.filter((x) => !used.has(x.id) && x.level === level).sort((a, b) => perCat(categoria(a)) - perCat(categoria(b)))[0] ?? shuffled.find((x) => !used.has(x.id));
  if (!q) break;
  picked.push(q);
  used.add(q.id);
}

// 3) Archivos: nombre por hash del id (que el nombre del archivo no diga la respuesta).
rmSync(OUT, { recursive: true, force: true });
mkdirSync(MEDIA, { recursive: true });
const hash = (id: string) => createHash("sha256").update(`papus-actividad:${id}`).digest("hex").slice(0, 16);
const pool: PreguntaPool[] = [];
for (const q of picked) {
  let media: PreguntaPool["media"];
  if (q.audio) {
    const archivo = `${hash(q.id)}${path.extname(q.audio)}`;
    copyFileSync(q.audio, path.join(MEDIA, archivo));
    media = { tipo: "audio", archivo };
  } else if (q.picture) {
    const archivo = `${hash(q.id)}${path.extname(q.picture)}`;
    copyFileSync(q.picture, path.join(MEDIA, archivo));
    media = { tipo: "imagen", archivo };
  } else if (q.image) {
    const archivo = `${hash(q.id)}.png`;
    writeFileSync(path.join(MEDIA, archivo), await renderFigure(q.image.bot, q.image.mode));
    media = { tipo: "imagen", archivo };
  }
  pool.push({
    id: q.id,
    tipo: q.kind,
    dificultad: q.level,
    categoria: categoria(q),
    texto: q.text,
    respuesta: q.answer,
    otras: q.wrong,
    aceptadas: q.accepted,
    ...(q.fact ? { dato: q.fact } : {}),
    ...(media ? { media } : {}),
    segundos: timerFor(settings, q),
  });
}
const out: Pool = {
  generado: new Date().toISOString(),
  dificultades: Object.fromEntries(LEVELS.map((l) => [l, { nombre: settings.dificultades[l].nombre, emoji: settings.dificultades[l].emoji }])) as Pool["dificultades"],
  racha: settings.racha,
  preguntas: pool,
};
// Compacto: con todas las preguntas pesa ~2 MB y va dentro del worker (limite de 3 MB comprimido en el plan gratuito).
writeFileSync(path.join(ROOT, "worker/src/actividad/pool.json"), `${JSON.stringify(out)}\n`);

// 4) La pagina: HTML, estilo y el script (con el SDK de Discord) en un solo archivo.
await build({
  entryPoints: [path.join(CLIENTE, "main.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: path.join(OUT, "app.js"),
  logLevel: "warning",
});
copyFileSync(path.join(CLIENTE, "index.html"), path.join(OUT, "index.html"));
copyFileSync(path.join(CLIENTE, "estilo.css"), path.join(OUT, "estilo.css"));
// Arte y fuentes con la estetica del canal (python scripts/actividad_arte.py, desde el motor).
const ARTE = path.join(ROOT, "assets/actividad/web");
for (const f of readdirSync(ARTE)) copyFileSync(path.join(ARTE, f), path.join(OUT, f));
// Los datos de cada dificultad (nombre y emoji) los usa la pagina sin las respuestas.
writeFileSync(path.join(OUT, "dificultades.json"), JSON.stringify(out.dificultades));

const kb = (f: string) => Math.round(readFileSync(f).length / 1024);
console.log(`✔ pool: ${pool.length} preguntas (${LEVELS.map((l) => `${settings.dificultades[l].emoji} ${pool.filter((q) => q.dificultad === l).length}`).join(" · ")})`);
console.log(`✔ tipos (${cats.length}): ${cats.map((c) => `${c} ×${pool.filter((q) => q.categoria === c).length}`).join(", ")}`);
console.log(`✔ archivos: ${pool.filter((q) => q.media).length} en worker/public/actividad/media · página: app.js ${kb(path.join(OUT, "app.js"))} KB`);
