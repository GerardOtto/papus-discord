// Diploma del Papu Lince (config/trivia.json secreto; decision de GyroP, 2 nov. 2026): GIF animado que Teto publica
// cuando un Papu supera TODAS las preguntas de la trivia. Su avatar con orejas de lince y un anillo dorado, el titulo,
// cuantas preguntas supero de cada dificultad, Teto y Miku a los lados, destellos y confeti cayendo. Todo el texto se
// achica hasta caber y va centrado por su contorno real (como las imagenes de la tienda).
import { readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { centerText } from "../coins/arte";
import { FONT } from "../levels/card";

// gifenc es CommonJS: Node lo entrega entero en `default`; vitest usa su version ESM, con las funciones sueltas.
const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

export const LYNX_W = 900;
export const LYNX_H = 500;
const FRAMES = 28;
const DELAY_MS = 80;
const GOLD = "#f2b33d";
const FIGURES = path.resolve(import.meta.dirname, "../../assets/bots");

export interface LynxData {
  name: string;
  avatar: Buffer | null;
  total: number;
  /** Superadas de cada dificultad: emoji no (el canvas no dibuja emojis), nombre y cuantas. */
  levels: { nombre: string; total: number; color: string }[];
  /** "2 de noviembre de 2026" */
  date: string;
}

const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);

/** Pone el mayor tamaño (de `size` a `min`) con el que `text` cabe en `maxW`. */
function fit(ctx: SKRSContext2D, text: string, maxW: number, size: number, min: number, weight = "bold"): void {
  for (let s = size; s > min; s--) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return;
  }
  ctx.font = `${weight} ${min}px ${FONT}`;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Azar fijo (el confeti cae igual en cada cuadro del ciclo). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
}

const CONFETTI = (() => {
  const r = seeded(39);
  const colors = ["#f2b33d", "#39c5bb", "#ff6fa8", "#ffffff", "#9fb4ff", "#e64a4a"];
  return Array.from({ length: 70 }, () => ({ x: r() * LYNX_W, y: r() * LYNX_H, w: 5 + r() * 7, h: 3 + r() * 5, speed: 1 + Math.floor(r() * 2), spin: r() * Math.PI * 2, color: colors[Math.floor(r() * colors.length)]! }));
})();

/** Orejas de lince (con su mechon negro) sobre un circulo de radio `r` en (cx, cy). */
function ears(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  for (const side of [-1, 1]) {
    const bx = cx + side * r * 0.62;
    const by = cy - r * 0.62;
    ctx.fillStyle = "#c98a3a";
    ctx.beginPath();
    ctx.moveTo(bx - side * r * 0.42, by + r * 0.12);
    ctx.lineTo(bx + side * r * 0.3, by - r * 0.1);
    ctx.lineTo(bx + side * r * 0.12, by - r * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f6d9b0";
    ctx.beginPath();
    ctx.moveTo(bx - side * r * 0.22, by + r * 0.02);
    ctx.lineTo(bx + side * r * 0.16, by - r * 0.1);
    ctx.lineTo(bx + side * r * 0.08, by - r * 0.55);
    ctx.closePath();
    ctx.fill();
    // El mechon de la punta.
    ctx.strokeStyle = "#1b1b1b";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bx + side * r * 0.12, by - r * 0.78);
    ctx.lineTo(bx + side * r * 0.17, by - r * 0.92);
    ctx.stroke();
  }
}

function star(ctx: SKRSContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const rr = k % 2 ? s * 0.3 : s;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function frame(ctx: SKRSContext2D, d: LynxData, img: { avatar: Image | null; left: Image | null; right: Image | null }, t: number): void {
  const W = LYNX_W;
  const H = LYNX_H;
  // Fondo: noche azul con un brillo dorado detras del avatar.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#141a33");
  bg.addColorStop(1, "#0b0f1f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 150, 10, W / 2, 150, 260);
  glow.addColorStop(0, `rgba(242,179,61,${0.28 + 0.08 * Math.sin(t * Math.PI * 2)})`);
  glow.addColorStop(1, "rgba(242,179,61,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Rayos que giran despacio.
  ctx.save();
  ctx.translate(W / 2, 150);
  ctx.rotate(t * (Math.PI / 6));
  ctx.fillStyle = "rgba(242,179,61,0.07)";
  for (let k = 0; k < 12; k++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-30, -420);
    ctx.lineTo(30, -420);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Marco dorado doble.
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 6;
  roundRect(ctx, 12, 12, W - 24, H - 24, 22);
  ctx.stroke();
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, W - 48, H - 48, 16);
  ctx.stroke();
  // Teto y Miku a los lados.
  const side = (im: Image | null, x: number, flip: boolean) => {
    if (!im) return;
    const h = 250;
    const w = (im.width / im.height) * h;
    const bob = Math.sin((t + (flip ? 0.5 : 0)) * Math.PI * 2) * 6;
    ctx.save();
    ctx.translate(x, H - 30 - h + bob);
    if (flip) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(im, 0, 0, w, h);
    ctx.restore();
  };
  side(img.left, 34, false);
  side(img.right, W - 34 - (img.right ? (img.right.width / img.right.height) * 250 : 0), true);
  // Panel oscuro detras del texto, para que se lea sobre las figuras y el confeti.
  ctx.fillStyle = "rgba(9,12,28,0.78)";
  roundRect(ctx, W / 2 - 255, 214, 510, 238, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(242,179,61,0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Avatar con anillo dorado y orejas de lince.
  const cx = W / 2;
  const cy = 132;
  const r = 66;
  ears(ctx, cx, cy, r);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img.avatar) ctx.drawImage(img.avatar, cx - r, cy - r, r * 2, r * 2);
  else {
    ctx.fillStyle = "#39c5bb";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.stroke();
  // Textos (ancho util: entre Teto y Miku).
  const maxW = 470;
  ctx.fillStyle = GOLD;
  fit(ctx, "PAPU LINCE", maxW, 64, 30, "900");
  ctx.shadowColor = "rgba(242,179,61,0.8)";
  ctx.shadowBlur = 12 + 8 * Math.sin(t * Math.PI * 2);
  centerText(ctx, "PAPU LINCE", cx, 252);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffffff";
  fit(ctx, d.name, maxW, 34, 16);
  centerText(ctx, d.name, cx, 302);
  ctx.fillStyle = "#c9d3ff";
  const line = `Superó las ${fmt(d.total)} preguntas de la Trivia Vocaloid`;
  fit(ctx, line, maxW, 22, 12, "600");
  centerText(ctx, line, cx, 340);
  // Pildoras de cada dificultad.
  const pills = d.levels.map((l) => ({ text: `${l.nombre} ${fmt(l.total)}`, color: l.color }));
  ctx.font = `bold 18px ${FONT}`;
  const gap = 12;
  const widths = pills.map((p) => ctx.measureText(p.text).width + 30);
  let scale = 1;
  const sum = widths.reduce((a, b) => a + b, 0) + gap * (pills.length - 1);
  if (sum > maxW) scale = maxW / sum;
  let x = cx - (sum * scale) / 2;
  for (const [k, p] of pills.entries()) {
    const w = widths[k]! * scale;
    ctx.fillStyle = p.color;
    roundRect(ctx, x, 366, w, 34, 17);
    ctx.fill();
    ctx.fillStyle = "#10131f";
    fit(ctx, p.text, w - 20, 18, 10);
    centerText(ctx, p.text, x + w / 2, 383);
    x += w + gap * scale;
  }
  ctx.fillStyle = "#8f9bc7";
  fit(ctx, d.date, maxW, 16, 10, "600");
  centerText(ctx, d.date, cx, 432);
  // Destellos alrededor del titulo.
  ctx.fillStyle = "#fff6d6";
  for (const [k, [sx, sy]] of ([[250, 230], [650, 240], [300, 190], [600, 185]] as const).entries()) {
    const s = 6 + 6 * Math.max(0, Math.sin((t + k / 4) * Math.PI * 2));
    star(ctx, sx, sy, s);
  }
  // Confeti: cae y da la vuelta justo al terminar el ciclo.
  for (const c of CONFETTI) {
    const y = (c.y + t * H * c.speed) % H;
    if (c.x > W / 2 - 262 && c.x < W / 2 + 262 && y > 208 && y < 458) continue;
    ctx.save();
    ctx.translate(c.x, y);
    ctx.rotate(c.spin + t * Math.PI * 2 * c.speed);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }
}

export async function renderLynx(d: LynxData): Promise<Buffer> {
  const load = async (b: Buffer | null) => (b ? await loadImage(b).catch(() => null) : null);
  const fig = (bot: string) => load((() => {
    try {
      return readFileSync(path.join(FIGURES, `${bot}_figura.png`));
    } catch {
      return null;
    }
  })());
  const img = { avatar: await load(d.avatar), left: await fig("teto"), right: await fig("miku") };
  const canvas = createCanvas(LYNX_W, LYNX_H);
  const ctx = canvas.getContext("2d");
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < FRAMES; i++) {
    frame(ctx, d, img, i / FRAMES);
    frames.push(ctx.getImageData(0, 0, LYNX_W, LYNX_H).data);
  }
  const sample: number[] = [];
  for (let f = 0; f < FRAMES; f += FRAMES / 4) {
    const px = frames[f]!;
    for (let p = 0; p < px.length; p += 32) sample.push(px[p]!, px[p + 1]!, px[p + 2]!, px[p + 3]!);
  }
  const palette = quantize(new Uint8ClampedArray(sample), 256);
  const gif = GIFEncoder();
  frames.forEach((px, i) => gif.writeFrame(applyPalette(px, palette), LYNX_W, LYNX_H, { palette: i === 0 ? palette : undefined, delay: DELAY_MS, repeat: i === 0 ? 0 : undefined }));
  gif.finish();
  return Buffer.from(gif.bytes());
}
