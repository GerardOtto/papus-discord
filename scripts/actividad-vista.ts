// Vista previa del arte de la trivia multijugador, sin desplegar nada:
//   npm run actividad:vista
// Arma en data/actividad-vista/ una pagina con datos de ejemplo (abrir index.html#sala, #pregunta, #acierto, #texto,
// #escribir o #fin en el navegador) y sus capturas (capturas/*.png, con Edge sin ventana), junto con el arte del
// Developer Portal (portada e icono). Usa lo que dejo `npm run actividad` en worker/public/actividad/.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "worker/public/actividad");
const OUT = path.join(ROOT, "data/actividad-vista");
const SHOTS = path.join(OUT, "capturas");
const ESTADOS = ["sala", "sala-invitado", "pregunta", "acierto", "escribir", "texto", "fin"];
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);

if (!existsSync(path.join(PUB, "estilo.css"))) throw new Error("Primero: npm run actividad");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(PUB)) if (f !== "media" && f !== "app.js" && f !== "index.html") copyFileSync(path.join(PUB, f), path.join(OUT, f));
for (const [id, bot] of [["teto", "teto"], ["miku", "miku"], ["luka", "luka"], ["neru", "neru"]]) copyFileSync(path.join(ROOT, `assets/bots/${bot}_avatar.png`), path.join(OUT, `av-${id}.png`));
// Una imagen de pregunta de verdad (la primera del pool).
const media = readdirSync(path.join(PUB, "media")).find((f) => f.endsWith(".webp"));
if (media) copyFileSync(path.join(PUB, "media", media), path.join(OUT, "muestra.webp"));
for (const f of ["portada.png", "fondo.png", "icono.png"]) if (existsSync(path.join(ROOT, "assets/actividad", f))) copyFileSync(path.join(ROOT, "assets/actividad", f), path.join(OUT, `portal-${f}`));
await build({ entryPoints: [path.join(ROOT, "worker/actividad/cliente/vista-previa.ts")], bundle: true, format: "iife", target: "es2022", outfile: path.join(OUT, "vista.js"), logLevel: "warning" });
writeFileSync(
  path.join(OUT, "index.html"),
  `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Vista previa · Trivia Vocaloid</title><link rel="stylesheet" href="estilo.css" /></head>
<body><main id="app"></main><script src="vista.js"></script><script>addEventListener("hashchange", () => location.reload());</script></body></html>\n`,
);
console.log(`✔ vista previa: ${path.join(OUT, "index.html")} (#${ESTADOS.join(", #")})`);

if (!EDGE) {
  console.log("⚠ No encontré Edge: sin capturas (abre la página en el navegador).");
} else {
  for (const [ancho, alto, sufijo] of [[820, 1250, ""], [520, 1100, "-celular"]] as const) {
    for (const e of ESTADOS) {
      const file = path.join(SHOTS, `${e}${sufijo}.png`);
      spawnSync(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", `--window-size=${ancho},${alto}`, `--screenshot=${file}`, `file:///${path.join(OUT, "index.html").replaceAll("\\", "/")}#${e}`], { encoding: "utf8", timeout: 60_000 });
    }
  }
  console.log(`✔ capturas: ${SHOTS} (${readdirSync(SHOTS).length})`);
}
