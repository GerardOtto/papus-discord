// Recorta los fragmentos de audio de la trivia (content/trivia-audio.json) desde las canciones y muestras del motor
// (SOLO LECTURA de ../Proyecto1/assets) a assets/trivia/audio/. Los archivos estirados del motor (x0751…) vuelven a su
// velocidad original. Necesita ffmpeg. Los clips no se versionan (como la musica del motor); nube subir los copia.
//   npm run trivia:audio            -> recorta los que faltan
//   npm run trivia:audio -- --todo  -> los vuelve a recortar todos
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadDotEnv } from "../src/config";
import { AUDIO_DIR, loadAudioClips } from "../src/trivia/rules";

loadDotEnv();
const ROOT = path.resolve(import.meta.dirname, "..");
const engine = path.resolve(ROOT, process.env.ENGINE_DIR || "../Proyecto1");
const ALL = process.argv.includes("--todo");

const ff = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
if (ff.status !== 0) throw new Error("No encuentro ffmpeg (winget install ffmpeg)");
// rubberband estira mejor la musica; atempo deja eco (CHANGELOG del motor).
const stretch = ff.stdout.includes("rubberband") ? (f: number) => `rubberband=tempo=${f}` : (f: number) => `atempo=${f}`;

mkdirSync(AUDIO_DIR, { recursive: true });
let made = 0;
let missing = 0;
for (const c of loadAudioClips()) {
  const out = path.join(AUDIO_DIR, c.archivo);
  if (!ALL && existsSync(out)) continue;
  const src = path.join(engine, c.fuente);
  if (!existsSync(src)) {
    console.log(`⚠️ falta en el motor: ${c.fuente} (${c.id})`);
    missing++;
    continue;
  }
  const tempo = c.tempo ?? 1;
  // desde/dura van en segundos de la cancion original; en el archivo estirado duran 1/tempo veces mas.
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-ss", String((c.desde ?? 0) / tempo)];
  if (c.dura) args.push("-t", String(c.dura / tempo));
  const filters = [...(tempo !== 1 ? [stretch(1 / tempo)] : []), ...(c.dura ? ["afade=t=in:d=0.3", `afade=t=out:st=${c.dura - 0.6}:d=0.6`] : []), "loudnorm=I=-16:TP=-1.5"];
  args.push("-i", src, "-af", filters.join(","), "-ac", "2", "-ar", "44100", "-b:a", "112k", out);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    console.log(`⚠️ ${c.id}: ${r.stderr.trim()}`);
    continue;
  }
  made++;
}
console.log(`✔ ${made} fragmentos recortados en ${path.relative(ROOT, AUDIO_DIR)}${missing ? ` (${missing} sin archivo en el motor)` : ""}`);
