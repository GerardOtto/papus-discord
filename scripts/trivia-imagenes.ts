// Dibuja las imagenes de las preguntas generadas de la trivia (content/trivia-generadas.json, imagenes) desde
// ../Proyecto1/assets/characters (SOLO LECTURA) a assets/trivia/imagenes/, en WebP de 512 px (unos 30 KB cada una:
// la VM de la nube no tiene que leer las PNG de 1 MB del motor). No se versionan; nube subir las copia.
//   npm run trivia:imagenes            -> dibuja las que faltan
//   npm run trivia:imagenes -- --todo  -> las vuelve a dibujar todas
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { loadDotEnv } from "../src/config";
import { renderPicture } from "../src/trivia/images";
import { loadGenerated, PICTURE_DIR } from "../src/trivia/rules";

loadDotEnv();
const ROOT = path.resolve(import.meta.dirname, "..");
const engine = path.resolve(ROOT, process.env.ENGINE_DIR || "../Proyecto1");
const ALL = process.argv.includes("--todo");

mkdirSync(PICTURE_DIR, { recursive: true });
let made = 0;
let missing = 0;
for (const p of loadGenerated().imagenes) {
  const out = path.join(PICTURE_DIR, p.archivo);
  if (!ALL && existsSync(out)) continue;
  const src = path.join(engine, p.fuente);
  if (!existsSync(src)) {
    missing++;
    continue;
  }
  const png = await loadImage(await renderPicture(src, p.modo, p.id));
  const c = createCanvas(png.width, png.height);
  c.getContext("2d").drawImage(png, 0, 0);
  writeFileSync(out, c.toBuffer("image/webp", 82));
  if (++made % 200 === 0) console.log(`  ${made}…`);
}
console.log(`✔ ${made} imágenes dibujadas en ${path.relative(ROOT, PICTURE_DIR)}${missing ? ` (${missing} sin archivo en el motor)` : ""}`);
