// Imagenes de las preguntas de siluetas (src/trivia/rules.ts): la figura de un Vocaloid (assets/bots/<id>_figura.png)
// como silueta negra, pixelada o en un acercamiento, centrada sobre un fondo neutro (el mismo para todos, asi el color
// no delata a nadie). Se dibujan una vez y quedan en memoria.
import { readFileSync } from "node:fs";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { BotId } from "../config";
import { figurePath, type ImageMode } from "./rules";

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

/** Pixelada: la figura reducida a ~22 pixeles de ancho y agrandada sin suavizar. */
function pixel(img: Image): Buffer {
  const r = fit(img, SIZE - PAD * 2);
  const small = 22;
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
function zoom(img: Image, bot: BotId): Buffer {
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
  let seed = [...bot].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const next = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
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

export async function renderFigure(bot: BotId, mode: ImageMode, figures?: string): Promise<Buffer> {
  const key = `${bot}:${mode}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = await loadImage(readFileSync(figurePath(bot, figures)));
  const png = mode === "silueta" ? silhouette(img) : mode === "pixel" ? pixel(img) : zoom(img, bot);
  cache.set(key, png);
  return png;
}
