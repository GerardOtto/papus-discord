// Imagenes del 1vs1 (PLAN §3.7): el banner del VS (nombre, avatar, estadisticas y cuota de cada Vocaloid) y el GIF
// del final (el ganador con Shaula-coins cayendo; el perdedor en blanco y negro, tachado con una cruz roja).
// Todo el texto va centrado de verdad (por su dibujo, no por la caja de la fuente) y recortado si no cabe.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { centerText } from "../coins/arte";
import { BOT_IDS, type BotId } from "../config";
import { fitText, FONT, roundRect } from "../levels/card";

// gifenc es CommonJS: Node lo entrega entero en `default`; vitest usa su version ESM, con las funciones sueltas.
const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

const TITLE = `"Bahnschrift", "Noto Sans Display", ${FONT}`;
const BOTS_DIR = path.resolve(import.meta.dirname, "../../assets/bots");
const COIN_FILE = path.resolve(import.meta.dirname, "../../assets/tienda/iconos/moneda.png");
const fmtOdds = (n: number) => `×${n.toFixed(2).replace(".", ",")}`;

const GUESTS_DIR = path.resolve(import.meta.dirname, "../../assets/peleas/luchadores");

/** Avatar de un luchador: el de su bot (Vocaloids del servidor) o el de invitado (npm run peleas:avatares). */
export const avatarFile = (id: string) => (BOT_IDS.includes(id as BotId) ? path.join(BOTS_DIR, `${id}_avatar.png`) : path.join(GUESTS_DIR, `${id}.png`));

export interface FighterCard {
  name: string;
  /** #RRGGBB */
  color: string;
  avatar: Buffer;
  vida: number;
  ataque: number;
  defensa: number;
  agilidad: number;
  cuota: number;
}

/** Maximos de la plantilla (para que las barras se comparen entre todos los Vocaloids). */
export interface StatMax {
  vida: number;
  ataque: number;
  defensa: number;
  agilidad: number;
}

function canvas(w: number, h: number): [Canvas, SKRSContext2D] {
  const c = createCanvas(w, h);
  return [c, c.getContext("2d")];
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, f: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  const [r, g, b] = rgb(hex);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

/** Texto centrado en (cx, cy) que se achica hasta caber en `maxW` (y, si aun asi no cabe, se recorta). */
function fitCenter(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, size: number, min: number, family = TITLE, weight = "bold"): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--s}px ${family}`;
  centerText(ctx, fitText(ctx, text, maxW), cx, cy);
}

/** Avatar en circulo con aro de color y brillo. */
function circleAvatar(ctx: SKRSContext2D, img: Image | Canvas, cx: number, cy: number, r: number, ring: string, glow = 22): void {
  ctx.save();
  ctx.shadowColor = ring;
  ctx.shadowBlur = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#111";
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function stars(ctx: SKRSContext2D, w: number, h: number, n: number, seed: number): void {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.save();
  for (let k = 0; k < n; k++) {
    ctx.globalAlpha = 0.15 + r() * 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 0.6 + r() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ───────────────────────── banner del VS ─────────────────────────

export const BANNER_W = 1000;
export const BANNER_H = 560;

export async function bannerImage(a: FighterCard, b: FighterCard, max: StatMax): Promise<Buffer> {
  const [c, ctx] = canvas(BANNER_W, BANNER_H);
  // Fondo: cada mitad con el color de su Vocaloid, cortadas en diagonal.
  const half = (x0: number, x1: number, color: string, top: number, bottom: number) => {
    const g = ctx.createLinearGradient(x0, 0, x1, BANNER_H);
    g.addColorStop(0, shade(color, -0.55));
    g.addColorStop(1, shade(color, -0.82));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(top, 0);
    ctx.lineTo(bottom, BANNER_H);
    ctx.lineTo(x0, BANNER_H);
    ctx.closePath();
    ctx.fill();
  };
  half(0, BANNER_W / 2, a.color, 560, 440);
  ctx.save();
  ctx.translate(BANNER_W, 0);
  ctx.scale(-1, 1);
  half(0, BANNER_W / 2, b.color, BANNER_W - 560, BANNER_W - 440);
  ctx.restore();
  stars(ctx, BANNER_W, BANNER_H, 70, 7);
  // Rayo de la diagonal.
  ctx.save();
  ctx.strokeStyle = "#fff6c2";
  ctx.shadowColor = "#ffd23d";
  ctx.shadowBlur = 24;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(560, 0);
  ctx.lineTo(440, BANNER_H);
  ctx.stroke();
  ctx.restore();

  const cols: [FighterCard, number][] = [
    [a, 250],
    [b, 750],
  ];
  for (const [f, cx] of cols) {
    ctx.fillStyle = "#ffffff";
    ctx.save();
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 18;
    fitCenter(ctx, f.name.toUpperCase(), cx, 62, 400, 56, 30);
    ctx.restore();
    const img = await loadImage(f.avatar);
    circleAvatar(ctx, img, cx, 225, 118, f.color, 30);
    statBars(ctx, f, max, cx - 160, 376);
    // Cuota.
    const text = `Paga ${fmtOdds(f.cuota)}`;
    ctx.font = `bold 26px ${TITLE}`;
    const w = ctx.measureText(text).width + 44;
    roundRect(ctx, cx - w / 2, 498, w, 44, 22);
    ctx.fillStyle = "rgba(10, 6, 20, 0.75)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffd23d";
    ctx.stroke();
    ctx.fillStyle = "#ffe98a";
    centerText(ctx, text, cx, 520);
  }

  // VS al centro.
  ctx.save();
  ctx.font = `bold 110px ${TITLE}`;
  const g = ctx.createLinearGradient(0, 170, 0, 280);
  g.addColorStop(0, "#fff7b0");
  g.addColorStop(0.5, "#ffc21a");
  g.addColorStop(1, "#ff6a00");
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#1a0a00";
  ctx.lineJoin = "round";
  const m = ctx.measureText("VS");
  const vx = 500 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  const vy = 225 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.textAlign = "left";
  ctx.strokeText("VS", vx, vy);
  ctx.shadowColor = "#ff8a00";
  ctx.shadowBlur = 30;
  ctx.fillStyle = g;
  ctx.fillText("VS", vx, vy);
  ctx.restore();
  return c.toBuffer("image/png");
}

type Icon = "vida" | "ataque" | "defensa" | "agilidad";

/** Iconos dibujados (no emojis: asi se ven igual en el PC y en el servidor). Centrados en (cx, cy), de unos 2s px. */
function statIcon(ctx: SKRSContext2D, icon: Icon, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (icon === "vida") {
    // Corazon.
    ctx.moveTo(0, s * 0.85);
    ctx.bezierCurveTo(-s * 1.25, -s * 0.05, -s * 0.75, -s * 1.1, 0, -s * 0.45);
    ctx.bezierCurveTo(s * 0.75, -s * 1.1, s * 1.25, -s * 0.05, 0, s * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (icon === "ataque") {
    // Espada en diagonal: hoja, guarda y empuñadura.
    ctx.rotate(Math.PI / 4);
    ctx.scale(1.3, 1.3);
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.26, -s * 0.7);
    ctx.lineTo(s * 0.26, s * 0.3);
    ctx.lineTo(-s * 0.26, s * 0.3);
    ctx.lineTo(-s * 0.26, -s * 0.7);
    ctx.closePath();
    ctx.fillStyle = "#eef2fa";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(-s * 0.6, s * 0.3, s * 1.2, s * 0.24);
    ctx.rect(-s * 0.14, s * 0.54, s * 0.28, s * 0.42);
    ctx.fill();
    ctx.stroke();
  } else if (icon === "defensa") {
    // Escudo.
    ctx.moveTo(0, -s * 0.95);
    ctx.lineTo(s * 0.8, -s * 0.65);
    ctx.quadraticCurveTo(s * 0.8, s * 0.45, 0, s * 0.95);
    ctx.quadraticCurveTo(-s * 0.8, s * 0.45, -s * 0.8, -s * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.6);
    ctx.lineTo(0, s * 0.6);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    // Bota: cana ancha, punta redonda y suela oscura, con una alita de velocidad.
    ctx.moveTo(-s * 0.55, -s * 0.95);
    ctx.lineTo(s * 0.2, -s * 0.95);
    ctx.lineTo(s * 0.2, s * 0.05);
    ctx.quadraticCurveTo(s * 1.05, s * 0.05, s * 1.05, s * 0.55);
    ctx.lineTo(s * 1.05, s * 0.75);
    ctx.lineTo(-s * 0.55, s * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1d3b2a";
    ctx.fillRect(-s * 0.55, s * 0.72, s * 1.6, s * 0.25);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-s * 0.55, -s * 0.95, s * 0.75, s * 0.22);
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.45);
    ctx.lineTo(-s * 1.15, -s * 0.8);
    ctx.lineTo(-s * 0.9, -s * 0.35);
    ctx.lineTo(-s * 1.2, -s * 0.3);
    ctx.lineTo(-s * 0.55, s * 0.0);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  ctx.restore();
}

/** Cuatro barras (VIDA, ATAQUE, DEFENSA, AGILIDAD) con su icono, de 320 px desde (x, y). */
function statBars(ctx: SKRSContext2D, f: FighterCard, max: StatMax, x: number, y: number): void {
  const rows: [Icon, string, number, number, string][] = [
    ["vida", "VIDA", f.vida, max.vida, "#ff5c7a"],
    ["ataque", "ATAQUE", f.ataque, max.ataque, "#ff9f1c"],
    ["defensa", "DEFENSA", f.defensa, max.defensa, "#36c5f0"],
    ["agilidad", "AGILIDAD", f.agilidad, max.agilidad, "#3ddc84"],
  ];
  const iconW = 26, labelW = iconW + 92, barW = 320 - labelW - 44, h = 14;
  rows.forEach(([icon, label, v, m, color], k) => {
    const cy = y + k * 28;
    statIcon(ctx, icon, x + 9, cy, 9, color);
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = "#e8e2f5";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + iconW, cy);
    roundRect(ctx, x + labelW, cy - h / 2, barW, h, h / 2);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fill();
    const w = Math.max(h, (Math.max(0, v) / Math.max(1, m)) * barW);
    roundRect(ctx, x + labelW, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "right";
    ctx.fillText(label === "AGILIDAD" ? `${v}%` : String(v), x + 320, cy);
    ctx.textBaseline = "alphabetic";
  });
}

// ───────────────────────── final (GIF) ─────────────────────────

export const RESULT_W = 800;
export const RESULT_H = 450;
const FRAMES = 30;
const FRAME_MS = 70;

export interface ResultData {
  winner: { name: string; color: string; avatar: Buffer };
  loser: { name: string; color: string; avatar: Buffer };
  /** "por KO" o "por puntos". */
  subtitle: string;
  seed: number;
}

/** Avatar en blanco y negro (y un poco oscurecido). */
function grayscale(img: Image, size: number): Canvas {
  const [c, ctx] = canvas(size, size);
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  const p = data.data;
  for (let k = 0; k < p.length; k += 4) {
    const l = Math.round((0.299 * p[k]! + 0.587 * p[k + 1]! + 0.114 * p[k + 2]!) * 0.8);
    p[k] = p[k + 1] = p[k + 2] = l;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

function redCross(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  for (const [w, color] of [
    [24, "#2a0000"],
    [15, "#e8102a"],
  ] as const) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    if (color !== "#2a0000") {
      ctx.shadowColor = "#ff2a3c";
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
    ctx.restore();
  }
}

interface Coin {
  x: number;
  y0: number;
  size: number;
  /** Vueltas completas de caida en todo el GIF (entero: el GIF se repite sin saltos). */
  laps: number;
  spin: number;
  phase: number;
  sway: number;
}

export async function resultGif(d: ResultData): Promise<Buffer> {
  let s = d.seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const WX = 270, WY = 250, WR = 120, LX = 620, LY = 245, LR = 82;
  const [winImg, loseImg] = await Promise.all([loadImage(d.winner.avatar), loadImage(d.loser.avatar)]);
  let coinImg: Image | null = null;
  try {
    coinImg = await loadImage(readFileSync(COIN_FILE));
  } catch {
    coinImg = null;
  }

  // Fondo fijo: degradado, luz detras del ganador, estrellas, perdedor tachado y nombres.
  const [base, b] = canvas(RESULT_W, RESULT_H);
  const g = b.createLinearGradient(0, 0, 0, RESULT_H);
  g.addColorStop(0, "#1d1033");
  g.addColorStop(1, "#2c1248");
  b.fillStyle = g;
  b.fillRect(0, 0, RESULT_W, RESULT_H);
  const spot = b.createRadialGradient(WX, WY, 20, WX, WY, 260);
  spot.addColorStop(0, shade(d.winner.color, 0.1));
  spot.addColorStop(1, "rgba(0,0,0,0)");
  b.globalAlpha = 0.55;
  b.fillStyle = spot;
  b.fillRect(0, 0, RESULT_W, RESULT_H);
  b.globalAlpha = 1;
  stars(b, RESULT_W, RESULT_H, 60, 11);
  // Textos encima de las monedas (capa aparte, transparente).
  const [top, o] = canvas(RESULT_W, RESULT_H);
  o.fillStyle = "#ffffff";
  o.save();
  o.shadowColor = d.winner.color;
  o.shadowBlur = 20;
  fitCenter(o, `¡${d.winner.name.toUpperCase()} GANA!`, RESULT_W / 2, 52, RESULT_W - 60, 50, 28);
  o.restore();
  o.save();
  o.shadowColor = "#000000";
  o.shadowBlur = 8;
  o.fillStyle = "#e6dcff";
  fitCenter(o, d.subtitle, RESULT_W / 2, 92, RESULT_W - 80, 20, 14, FONT, "600");
  o.fillStyle = "#ffffff";
  fitCenter(o, d.winner.name, WX, WY + WR + 40, 320, 30, 18);
  o.restore();
  // Perdedor: blanco y negro, tachado.
  circleAvatar(b, grayscale(loseImg, LR * 2), LX, LY, LR, "#5a5a66", 0);
  redCross(b, LX, LY, LR * 0.78);
  b.fillStyle = "#9a96a8";
  fitCenter(b, d.loser.name, LX, LY + LR + 34, 260, 26, 16);
  b.fillStyle = "#ff5c6e";
  fitCenter(b, "K.O.", LX, LY + LR + 64, 200, 20, 14);

  const coins: Coin[] = Array.from({ length: 38 }, () => ({
    x: WX + (rand() - 0.5) * 2 * (WR + 110),
    y0: rand() * (RESULT_H + 60),
    size: 28 + rand() * 22,
    laps: 1 + Math.floor(rand() * 2),
    spin: 1 + Math.floor(rand() * 3),
    phase: rand() * Math.PI * 2,
    sway: rand() * Math.PI * 2,
  }));
  const [, ctx] = canvas(RESULT_W, RESULT_H);
  const drawCoins = (f: number, front: boolean) => {
    for (const [k, c] of coins.entries()) {
      // La mitad cae detras del avatar y la otra mitad por delante.
      if ((k % 2 === 0) !== front) continue;
      const t = f / FRAMES;
      const y = ((c.y0 + t * c.laps * (RESULT_H + 60)) % (RESULT_H + 60)) - 30;
      const x = c.x + Math.sin(c.sway + t * Math.PI * 2) * 10;
      // Las de adelante no tapan la cara del ganador.
      if (front && Math.hypot(x - WX, y - WY) < WR + c.size / 2) continue;
      const squash = Math.abs(Math.cos(c.phase + t * c.spin * Math.PI * 2)) * 0.85 + 0.15;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(squash, 1);
      if (coinImg) ctx.drawImage(coinImg, -c.size / 2, -c.size / 2, c.size, c.size);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, c.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = "#ffc83d";
        ctx.fill();
      }
      ctx.restore();
    }
  };
  const frames: Uint8ClampedArray[] = [];
  for (let f = 0; f < FRAMES; f++) {
    ctx.drawImage(base, 0, 0);
    drawCoins(f, false);
    const pulse = 18 + Math.sin((f / FRAMES) * Math.PI * 2) * 10;
    circleAvatar(ctx, winImg, WX, WY, WR, "#ffd23d", pulse);
    drawCoins(f, true);
    ctx.drawImage(top, 0, 0);
    frames.push(ctx.getImageData(0, 0, RESULT_W, RESULT_H).data);
  }
  // Una paleta para todo el GIF (con dos cuadros de muestra).
  const sample = new Uint8Array(frames[0]!.length * 2);
  sample.set(frames[0]!, 0);
  sample.set(frames[Math.floor(FRAMES / 2)]!, frames[0]!.length);
  const palette = quantize(sample, 256);
  const gif = GIFEncoder();
  frames.forEach((data, i) => gif.writeFrame(applyPalette(data, palette), RESULT_W, RESULT_H, { palette: i === 0 ? palette : undefined, delay: FRAME_MS, repeat: i === 0 ? 0 : undefined }));
  gif.finish();
  return Buffer.from(gif.bytes());
}
