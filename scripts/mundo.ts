// Arma el prototipo del mundo 3D de los Papus (Actividad de Discord): npm run mundo
// Salida: worker/public/mundo/ (pagina, estilo y app.js con three.js y el SDK de Discord). npm run worker:deploy lo sube.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "worker/public/mundo");
const CLIENTE = path.join(ROOT, "worker/mundo/cliente");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [path.join(CLIENTE, "main.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: path.join(OUT, "app.js"),
  logLevel: "warning",
});
for (const f of ["index.html", "estilo.css"]) copyFileSync(path.join(CLIENTE, f), path.join(OUT, f));
// Hojas de sprites de los Vocaloids (npm run mundo:sprites -- tet): solo renders, nunca los modelos.
const SPRITES = path.join(ROOT, "assets/mundo");
const hojas = existsSync(SPRITES) ? readdirSync(SPRITES).filter((f) => /\.(webp|json)$/.test(f)) : [];
for (const f of hojas) copyFileSync(path.join(SPRITES, f), path.join(OUT, f));
// Fuentes de la estetica del canal para las ventanas (las mismas de la trivia; OFL, con su licencia).
const ARTE = path.join(ROOT, "assets/actividad/web");
for (const f of readdirSync(ARTE).filter((x) => /\.woff2$|^OFL-/.test(x))) copyFileSync(path.join(ARTE, f), path.join(OUT, f));
const kb = Math.round(readFileSync(path.join(OUT, "app.js")).length / 1024);
console.log(`✔ mundo: worker/public/mundo/ (app.js ${kb} KB, sprites: ${hojas.filter((f) => f.endsWith(".webp")).join(", ") || "ninguno"})`);
