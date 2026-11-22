// Arma el celular de Neru (PLAN §3.15): npm run celular
//   1) worker/src/celular/datos.json: ajustes, personajes de Vocaloidle (content/vocaloidle.json) y las imágenes de
//      Silueta (solo lo lee el worker: dice qué archivo es de quién).
//   2) worker/public/celular/s/: cada imagen de Silueta en todos sus niveles (muy pixelada → clara), con nombres al azar
//      que no delatan la respuesta. Imágenes del motor (assets/characters/<id>/, solo lectura) o, si faltan, la figura
//      del bot (assets/bots/<id>_figura.png).
//   3) worker/public/celular/: la página (esbuild) y sus imágenes.
// npm run worker:deploy lo sube.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import { build } from "esbuild";
import type { CelularSettings, Personaje } from "../src/celular/rules";
import type { DatosCelular } from "../worker/src/celular/tipos";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENGINE = path.resolve(ROOT, process.env.ENGINE_DIR ?? "../Proyecto1");
const OUT = path.join(ROOT, "worker/public/celular");
const SIL = path.join(OUT, "s");
const CLIENTE = path.join(ROOT, "worker/celular/cliente");

const settings = JSON.parse(readFileSync(path.join(ROOT, "config/celular.json"), "utf8")) as CelularSettings;
const { personajes } = JSON.parse(readFileSync(path.join(ROOT, "content/vocaloidle.json"), "utf8")) as { personajes: Personaje[] };

/** Imágenes de un personaje: las del motor repartidas a lo largo de la lista (variedad de poses), o su figura. */
function imagenesDe(id: string): string[] {
  const dir = path.join(ENGINE, "assets/characters", id);
  const lista = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".png") && !f.includes("busto")).sort().map((f) => path.join(dir, f))
    : [];
  if (!lista.length) {
    const fig = path.join(ROOT, "assets/bots", `${id}_figura.png`);
    return existsSync(fig) ? [fig] : [];
  }
  const n = Math.min(settings.silueta.imagenesPorPersonaje, lista.length);
  return Array.from({ length: n }, (_, i) => lista[Math.floor((i * lista.length) / n)]!);
}

/** Caja de lo que no es transparente. */
function recorte(img: Image): { x: number; y: number; w: number; h: number } {
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, img.width, img.height);
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (data[(y * img.width + x) * 4 + 3]! > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? { x: 0, y: 0, w: img.width, h: img.height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** La imagen clara: el personaje (recortado) centrado sobre un fondo neutro. Si es muy alto, se ve de la cintura arriba. */
function clara(img: Image): Canvas {
  const L = settings.silueta.lado;
  const c = createCanvas(L, L);
  const g = c.getContext("2d");
  const fondo = g.createLinearGradient(0, 0, L, L);
  fondo.addColorStop(0, "#4a4560");
  fondo.addColorStop(1, "#2f2c40");
  g.fillStyle = fondo;
  g.fillRect(0, 0, L, L);
  const r = recorte(img);
  const h = Math.min(r.h, r.w * 1.35);
  const esc = Math.min((L * 0.92) / r.w, (L * 0.92) / h);
  const w = r.w * esc;
  g.drawImage(img, r.x, r.y, r.w, h, (L - w) / 2, L * 0.06, w, h * esc);
  return c;
}

/** Pixelado con bloques de `bloque` px: promedio de cada bloque, ampliado sin suavizar. */
function pixelado(src: Canvas, bloque: number): Canvas {
  const L = settings.silueta.lado;
  const n = Math.max(2, Math.round(L / bloque));
  const chica = createCanvas(n, n);
  const gc = chica.getContext("2d");
  gc.imageSmoothingEnabled = true;
  gc.imageSmoothingQuality = "high";
  gc.drawImage(src, 0, 0, n, n);
  const c = createCanvas(L, L);
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(chica, 0, 0, L, L);
  return c;
}

async function silueta(): Promise<DatosCelular["silueta"]> {
  rmSync(SIL, { recursive: true, force: true });
  mkdirSync(SIL, { recursive: true });
  const out: DatosCelular["silueta"] = [];
  for (const p of personajes) {
    const archivos = imagenesDe(p.id);
    if (!archivos.length) {
      console.warn(`  (Silueta) sin imágenes para ${p.id}: queda fuera`);
      continue;
    }
    const imagenes: string[][] = [];
    for (const f of archivos) {
      const base = clara(await loadImage(readFileSync(f)));
      const niveles = [...settings.silueta.bloques.map((b) => pixelado(base, b)), base];
      imagenes.push(
        niveles.map((c) => {
          const nombre = `${randomBytes(12).toString("hex")}.webp`;
          writeFileSync(path.join(SIL, nombre), c.toBuffer("image/webp", 82));
          return nombre;
        }),
      );
    }
    out.push({ id: p.id, imagenes });
    console.log(`  Silueta: ${p.id} (${imagenes.length} imagen${imagenes.length === 1 ? "" : "es"})`);
  }
  return out;
}

async function pagina(): Promise<void> {
  for (const f of ["index.html", "estilo.css", "manifest.webmanifest"]) if (existsSync(path.join(CLIENTE, f))) copyFileSync(path.join(CLIENTE, f), path.join(OUT, f));
  const img = path.join(OUT, "img");
  mkdirSync(img, { recursive: true });
  for (const f of readdirSync(path.join(CLIENTE, "iconos"))) copyFileSync(path.join(CLIENTE, "iconos", f), path.join(img, f));
  const copiar: [string, string][] = [
    ["assets/tienda/iconos/moneda.png", "moneda.png"],
    ["assets/tienda/iconos/tarjeta.png", "tarjeta.png"],
    ["assets/tienda/iconos/tienda.png", "tienda.png"],
    ["assets/tienda/iconos/mochila.png", "mochila.png"],
    ["assets/bots/emojis/neru_meh.png", "neru-meh.png"],
    ["assets/bots/emojis/neru_risa.png", "neru-risa.png"],
    ["assets/bots/emojis/neru_enojo.png", "neru-enojo.png"],
  ];
  for (const [de, a] of copiar) copyFileSync(path.join(ROOT, de), path.join(img, a));
  await build({
    entryPoints: [path.join(CLIENTE, "main.ts")],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    outfile: path.join(OUT, "main.js"),
    logLevel: "warning",
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const datos: DatosCelular = { settings, personajes, silueta: await silueta() };
  writeFileSync(path.join(ROOT, "worker/src/celular/datos.json"), JSON.stringify(datos));
  await pagina();
  console.log(`Celular de Neru listo: ${datos.silueta.length} personajes en Silueta, ${personajes.length} en la lista. Sube con npm run worker:deploy.`);
}

await main();
