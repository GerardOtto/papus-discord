// Imagenes de las preguntas de siluetas (src/trivia/rules.ts): la figura de un Vocaloid (assets/bots/<id>_figura.png)
// como silueta negra, pixelada o en un acercamiento, centrada sobre un fondo neutro (el mismo para todos, asi el color
// no delata a nadie). Se dibujan una vez y quedan en memoria. Las preguntas generadas con imagenes del motor
// (renderPicture) se dibujan una sola vez con npm run trivia:imagenes y el bot solo adjunta el archivo.
import { readFileSync } from "node:fs";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { BotId } from "../config";
import { figurePath, type ImageMode, type PictureMode } from "./rules";

const SIZE = 512;
const PAD = 28;
const cache = new Map<string, Buffer>();

function background(ctx: SKRSContext2D): void {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, "#2a2f45");
  g.addColorStop(1, "#151826");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/** Rectangulo donde la figura cabe entera y centrada (contain). */
function fit(img: Image, box: number): { x: number; y: number; w: number; h: number } {
  const k = Math.min(box / img.width, box / img.height);
  const w = img.width * k;
  const h = img.height * k;
  return { x: (SIZE - w) / 2, y: (SIZE - h) / 2, w, h };
}

/** Silueta: la figura rellena de un solo color oscuro, con un borde claro para que se lea sobre el fondo. */
function silhouette(img: Image): Buffer {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d");
  background(ctx);
  const r = fit(img, SIZE - PAD * 2);
  const shape = createCanvas(SIZE, SIZE);
  const sctx = shape.getContext("2d");
  sctx.drawImage(img, r.x, r.y, r.w, r.h);
  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = "#05060a";
  sctx.fillRect(0, 0, SIZE, SIZE);
  // Halo: la misma forma en claro, corrida unos pixeles alrededor.
  const halo = createCanvas(SIZE, SIZE);
  const hctx = halo.getContext("2d");
  hctx.drawImage(img, r.x, r.y, r.w, r.h);
  hctx.globalCompositeOperation = "source-in";
  hctx.fillStyle = "#9fb4ff";
  hctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 0.55;
  for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]] as const) ctx.drawImage(halo, dx, dy);
  ctx.globalAlpha = 1;
  ctx.drawImage(shape, 0, 0);
  return c.toBuffer("image/png");
}

/** Pixelada: la figura reducida a ~`small` pixeles de ancho y agrandada sin suavizar. */
function pixel(img: Image, small = 22): Buffer {
  const r = fit(img, SIZE - PAD * 2);
  const k = small / r.w;
  const tiny = createCanvas(Math.max(1, Math.round(SIZE * k)), Math.max(1, Math.round(SIZE * k)));
  const tctx = tiny.getContext("2d");
  tctx.drawImage(img, r.x * k, r.y * k, r.w * k, r.h * k);
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d");
  background(ctx);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, SIZE, SIZE);
  return c.toBuffer("image/png");
}

/**
 * Acercamiento: un cuadro de un cuarto del ancho de la figura, en un punto que siempre cae sobre ella (se busca el que
 * tiene mas figura entre varios candidatos de la mitad superior, sin la cara justo al centro).
 */
function zoom(img: Image, key: string): Buffer {
  const probe = createCanvas(img.width, img.height);
  const pctx = probe.getContext("2d");
  pctx.drawImage(img, 0, 0);
  const alpha = pctx.getImageData(0, 0, img.width, img.height).data;
  const side = Math.round(Math.min(img.width, img.height) / 4);
  const cover = (x: number, y: number) => {
    let n = 0;
    let all = 0;
    for (let yy = y; yy < y + side; yy += 6) for (let xx = x; xx < x + side; xx += 6, all++) if (alpha[(yy * img.width + xx) * 4 + 3]! > 40) n++;
    return n / all;
  };
  // Candidatos fijos por Vocaloid (siempre el mismo recorte para la misma pregunta).
  const next = seeded(key);
  let best = { x: 0, y: 0, c: -1 };
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(next() * (img.width - side));
    const y = Math.floor(next() * (img.height - side) * 0.7);
    const cx = x + side / 2 - img.width / 2;
    const cy = y + side / 2 - img.height * 0.3;
    // Se evita el centro de la cara (seria demasiado facil).
    const c = cover(x, y) - (Math.hypot(cx, cy) < side * 0.9 ? 0.5 : 0);
    if (c > best.c) best = { x, y, c };
  }
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d");
  background(ctx);
  ctx.drawImage(img, best.x, best.y, side, side, 0, 0, SIZE, SIZE);
  return c.toBuffer("image/png");
}

/** Numeros al azar fijos para una clave (la misma pregunta se dibuja siempre igual). */
function seeded(key: string): () => number {
  let seed = [...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  return () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
}

/** La imagen entera, centrada sobre el fondo. */
function plain(img: Image): Buffer {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d");
  background(ctx);
  const r = fit(img, SIZE - PAD * 2);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  return c.toBuffer("image/png");
}

/** Solo una mitad (izquierda o derecha); la otra queda tapada con un signo de pregunta. */
function half(img: Image, key: string): Buffer {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d");
  background(ctx);
  const r = fit(img, SIZE - PAD * 2);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  const left = seeded(key)() < 0.5;
  ctx.fillStyle = "#151826";
  ctx.fillRect(left ? SIZE / 2 : 0, 0, SIZE / 2, SIZE);
  ctx.fillStyle = "#9fb4ff";
  ctx.font = "bold 120px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", left ? (SIZE * 3) / 4 : SIZE / 4, SIZE / 2);
  return c.toBuffer("image/png");
}

/** En gris: sin el color del pelo, que delata a casi todos. */
function gray(img: Image): Buffer {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d");
  background(ctx);
  const r = fit(img, SIZE - PAD * 2);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  const data = ctx.getImageData(0, 0, SIZE, SIZE);
  const px = data.data;
  for (let k = 0; k < px.length; k += 4) {
    const y = Math.round(0.299 * px[k]! + 0.587 * px[k + 1]! + 0.114 * px[k + 2]!);
    px[k] = px[k + 1] = px[k + 2] = y;
  }
  ctx.putImageData(data, 0, 0);
  return c.toBuffer("image/png");
}

/** Piezas revueltas: la imagen en 3x3 cuadros cambiados de lugar (nunca queda armada). */
function tiles(img: Image, key: string): Buffer {
  const whole = createCanvas(SIZE, SIZE);
  const wctx = whole.getContext("2d");
  background(wctx);
  const r = fit(img, SIZE - PAD * 2);
  wctx.drawImage(img, r.x, r.y, r.w, r.h);
  const n = 3;
  const side = SIZE / n;
  const next = seeded(key);
  const order = Array.from({ length: n * n }, (_, k) => k);
  do {
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(next() * (k + 1));
      [order[k], order[j]] = [order[j]!, order[k]!];
    }
  } while (order.some((v, k) => v === k));
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b0d16";
  ctx.fillRect(0, 0, SIZE, SIZE);
  order.forEach((from, to) => {
    const g = 3;
    ctx.drawImage(whole, (from % n) * side, Math.floor(from / n) * side, side, side, (to % n) * side + g, Math.floor(to / n) * side + g, side - g * 2, side - g * 2);
  });
  return c.toBuffer("image/png");
}

/** En franjas: solo se ve una de cada dos franjas horizontales. */
function strips(img: Image): Buffer {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d");
  background(ctx);
  const r = fit(img, SIZE - PAD * 2);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  const band = SIZE / 12;
  ctx.fillStyle = "#151826";
  for (let k = 1; k < 12; k += 2) ctx.fillRect(0, k * band, SIZE, band);
  return c.toBuffer("image/png");
}

/** Dibuja una imagen del motor para una pregunta generada (PNG; `key` fija el azar de la pregunta). */
export async function renderPicture(src: string, mode: PictureMode, key: string): Promise<Buffer> {
  const img = await loadImage(readFileSync(src));
  switch (mode) {
    case "normal":
      return plain(img);
    case "silueta":
      return silhouette(img);
    case "pixel":
      return pixel(img, 30);
    case "zoom":
      return zoom(img, key);
    case "mitad":
      return half(img, key);
    case "gris":
      return gray(img);
    case "piezas":
      return tiles(img, key);
    case "franjas":
      return strips(img);
  }
}

export async function renderFigure(bot: BotId, mode: ImageMode, figures?: string): Promise<Buffer> {
  const key = `${bot}:${mode}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = await loadImage(readFileSync(figurePath(bot, figures)));
  const png = mode === "silueta" ? silhouette(img) : mode === "pixel" ? pixel(img) : zoom(img, bot);
  cache.set(key, png);
  return png;
}
