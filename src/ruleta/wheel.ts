// GIF animado de la ruleta (PLAN §3.3): gira, frena en el premio, la casilla ganadora se ilumina y cae confeti con el
// recuadro del resultado. Se reproduce una vez y queda en el ultimo cuadro (la ruleta apuntando al premio).
// Fondo, rueda y anfitriona se dibujan una sola vez; cada cuadro solo los gira y los compone.
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { fitText, FONT, roundRect } from "../levels/card";

// gifenc es CommonJS: Node lo entrega entero en `default`; vitest usa su version ESM, con las funciones sueltas.
const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

export const WHEEL_W = 640;
export const WHEEL_H = 400;

const TITLE = `"Bahnschrift", "Noto Sans Display", ${FONT}`;
const CX = 205;
const CY = 215;
const R = 160;
const BULBS = 20;
const SPIN_FRAMES = 38;
const END_FRAMES = 18;
const FRAME_MS = 60;
/** El ultimo cuadro se queda: si algun cliente repite el GIF, tarda en volver a empezar. */
const HOLD_MS = 60_000;
const CONFETTI = ["#ff3b5c", "#ff9f1c", "#ffe14d", "#3ddc84", "#36c5f0", "#8c5cff", "#ffffff", "#ff7ad9"];

export interface WheelData {
  /** Casillas en orden (en el sentido del reloj desde arriba). */
  prizes: { icono: string; etiqueta: string; color: string }[];
  winner: number;
  papu: { name: string; avatar: Buffer | null };
  /** Vocaloid que presenta la ruleta. */
  host: { name: string; color: string; figure: Buffer | null };
  /** "¡+312 XP!" */
  title: string;
  /** "Nivel 13 → 14" */
  subtitle: string;
  /** Mismo seed = mismo giro y mismo confeti. */
  seed: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

function canvas(w: number, h: number): [Canvas, SKRSContext2D] {
  const c = createCanvas(w, h);
  return [c, c.getContext("2d")];
}

/** Fondo de escenario (como el ranking): degradado, luz detras de la rueda, destellos y notas. */
function background(d: WheelData, rand: () => number): Canvas {
  const [c, ctx] = canvas(WHEEL_W, WHEEL_H);
  const g = ctx.createLinearGradient(0, 0, 0, WHEEL_H);
  g.addColorStop(0, "#1d1033");
  g.addColorStop(1, "#2c1248");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WHEEL_W, WHEEL_H);
  const spot = ctx.createRadialGradient(CX, CY, R * 0.6, CX, CY, R * 1.7);
  spot.addColorStop(0, shade(d.host.color, -0.35));
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, WHEEL_W, WHEEL_H);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.arc(rand() * WHEEL_W, rand() * WHEEL_H, rand() * 1.6 + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `22px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  for (let i = 0; i < 7; i++) ctx.fillText(i % 2 ? "♪" : "♫", 400 + rand() * 230, 120 + rand() * 260);
  return c;
}

/** La rueda sin girar (casilla 0 centrada arriba). */
function wheel(d: WheelData): Canvas {
  const size = R * 2 + 4;
  const [c, ctx] = canvas(size, size);
  const m = size / 2;
  const n = d.prizes.length;
  const seg = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 - seg / 2 + i * seg;
    const p = d.prizes[i]!;
    // Colores planos (sin degradado): el GIF pesa mucho menos al girar.
    ctx.beginPath();
    ctx.moveTo(m, m);
    ctx.arc(m, m, R, a0, a0 + seg);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(m, m);
    ctx.arc(m, m, R * 0.45, a0, a0 + seg);
    ctx.closePath();
    ctx.fillStyle = shade(p.color, 0.25);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(m, m);
    ctx.arc(m, m, R, a0, a0 + seg);
    ctx.closePath();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
    // Icono cerca del borde y texto debajo, derechos cuando la casilla esta arriba (asi se lee el premio al final).
    ctx.save();
    ctx.translate(m, m);
    ctx.rotate(a0 + seg / 2 + Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `20px ${FONT}`;
    ctx.fillText(fitText(ctx, p.icono, R * 0.62), 0, -R * 0.78);
    ctx.font = `bold 21px ${TITLE}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    const label = fitText(ctx, p.etiqueta, R * 0.5);
    ctx.strokeText(label, 0, -R * 0.58);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, 0, -R * 0.58);
    ctx.restore();
  }
  return c;
}

/** Aro dorado con bombillas (no gira): `phase` alterna las encendidas. */
function rim(ctx: SKRSContext2D, phase: number, allOn: boolean): void {
  ctx.beginPath();
  ctx.arc(CX, CY, R + 12, 0, Math.PI * 2);
  ctx.lineWidth = 18;
  const g = ctx.createLinearGradient(CX - R, CY - R, CX + R, CY + R);
  g.addColorStop(0, "#f7d774");
  g.addColorStop(0.5, "#b8860b");
  g.addColorStop(1, "#ffe9a8");
  ctx.strokeStyle = g;
  ctx.stroke();
  for (let i = 0; i < BULBS; i++) {
    const a = (i / BULBS) * Math.PI * 2;
    const on = allOn || (i + phase) % 2 === 0;
    ctx.beginPath();
    ctx.arc(CX + Math.cos(a) * (R + 12), CY + Math.sin(a) * (R + 12), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#fffbe0" : "#7a5a12";
    ctx.shadowColor = on ? "#fff3a0" : "transparent";
    ctx.shadowBlur = on ? 10 : 0;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function pointer(ctx: SKRSContext2D): void {
  const y = CY - R - 8;
  ctx.beginPath();
  ctx.moveTo(CX - 17, y - 22);
  ctx.lineTo(CX + 17, y - 22);
  ctx.lineTo(CX, y + 14);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#b8860b";
  ctx.stroke();
}

function hub(ctx: SKRSContext2D, color: string): void {
  const g = ctx.createRadialGradient(CX - 8, CY - 8, 4, CX, CY, 30);
  g.addColorStop(0, "#fff6cf");
  g.addColorStop(1, "#c9961a");
  ctx.beginPath();
  ctx.arc(CX, CY, 28, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.font = `bold 26px ${TITLE}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText("★", CX, CY + 1);
}

/** Oscurece todas las casillas menos la ganadora (girada `angle`, bajo la flecha) y la contornea con brillo. */
function spotlightWinner(ctx: SKRSContext2D, d: WheelData, angle: number, glow: number): void {
  const n = d.prizes.length;
  const seg = (Math.PI * 2) / n;
  const a0 = -Math.PI / 2 - seg / 2 + d.winner * seg + angle;
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.arc(CX, CY, R, a0 + seg, a0 + Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(10,4,20,0.55)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.arc(CX, CY, R, a0, a0 + seg);
  ctx.closePath();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#fffbe0";
  ctx.shadowColor = d.prizes[d.winner]!.color;
  ctx.shadowBlur = 12 + glow * 14;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function circleImage(ctx: SKRSContext2D, img: Image | null, x: number, y: number, r: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  else {
    ctx.fillStyle = "#2a2a3a";
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Titulo, quien gira y la anfitriona (estatico). */
async function panel(d: WheelData, base: Canvas): Promise<Canvas> {
  const [c, ctx] = canvas(WHEEL_W, WHEEL_H);
  ctx.drawImage(base, 0, 0);
  if (d.host.figure) {
    const fig = await loadImage(d.host.figure).catch(() => null);
    if (fig) {
      // Se asoma desde abajo del escenario: la cara queda bajo el recuadro del premio.
      const h = 300;
      const w = (fig.width / fig.height) * h;
      ctx.drawImage(fig, WHEEL_W - w * 0.5 - 120, 222, w, h);
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 46px ${TITLE}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.strokeText("RULETA", 405, 62);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("RULETA", 405, 62);
  ctx.font = `600 18px ${FONT}`;
  ctx.fillStyle = "#e8dcff";
  ctx.fillText(fitText(ctx, `de los Papus · con ${d.host.name}`, 225), 407, 86);
  const avatar = d.papu.avatar ? await loadImage(d.papu.avatar).catch(() => null) : null;
  circleImage(ctx, avatar, 422, 120, 16, d.host.color);
  ctx.font = `bold 17px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fitText(ctx, d.papu.name, 192), 444, 126);
  return c;
}

function resultBox(ctx: SKRSContext2D, d: WheelData, t: number): void {
  const color = d.prizes[d.winner]!.color;
  const x = 398;
  const w = 232;
  const h = 112;
  const y = 142 + (1 - t) * 30;
  ctx.globalAlpha = t;
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = "rgba(20,8,36,0.88)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = "center";
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillStyle = "#ffe14d";
  ctx.fillText("✨ ¡PREMIO! ✨", x + w / 2, y + 26);
  ctx.font = `bold 32px ${TITLE}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fitText(ctx, d.title, w - 20), x + w / 2, y + 66);
  ctx.font = `600 16px ${FONT}`;
  ctx.fillStyle = "#e8dcff";
  ctx.fillText(fitText(ctx, d.subtitle, w - 20), x + w / 2, y + 94);
  ctx.globalAlpha = 1;
}

interface Piece {
  x: number;
  y: number;
  vy: number;
  sway: number;
  spin: number;
  w: number;
  h: number;
  color: string;
}

function confetti(rand: () => number): Piece[] {
  return Array.from({ length: 90 }, () => ({
    x: rand() * WHEEL_W,
    y: -rand() * 260 - 10,
    vy: 9 + rand() * 9,
    sway: rand() * Math.PI * 2,
    spin: rand() * Math.PI,
    w: 5 + rand() * 6,
    h: 8 + rand() * 8,
    color: CONFETTI[Math.floor(rand() * CONFETTI.length)]!,
  }));
}

function drawConfetti(ctx: SKRSContext2D, pieces: Piece[], f: number): void {
  for (const p of pieces) {
    const y = p.y + p.vy * f;
    if (y < -20 || y > WHEEL_H + 20) continue;
    ctx.save();
    ctx.translate(p.x + Math.sin(p.sway + f * 0.35) * 12, y);
    ctx.rotate(p.spin + f * 0.3);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, Math.abs(Math.cos(p.sway + f * 0.4)) * p.h + 2);
    ctx.restore();
  }
}

/** Angulo final: la casilla ganadora bajo la flecha, despues de varias vueltas, con un leve desvio al azar. */
export function finalAngle(n: number, winner: number, rand: () => number): number {
  const seg = (Math.PI * 2) / n;
  const turns = 4 + Math.floor(rand() * 2);
  const jitter = (rand() - 0.5) * seg * 0.6;
  return turns * Math.PI * 2 - winner * seg + jitter;
}

export async function renderWheelGif(d: WheelData): Promise<Buffer> {
  const rand = rng(d.seed);
  const base = await panel(d, background(d, rand));
  const wheelImg = wheel(d);
  const target = finalAngle(d.prizes.length, d.winner, rand);
  const pieces = confetti(rand);
  const [, ctx] = canvas(WHEEL_W, WHEEL_H);

  const draw = (angle: number, phase: number, end: number | null): Uint8ClampedArray => {
    ctx.drawImage(base, 0, 0);
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(angle);
    ctx.drawImage(wheelImg, -wheelImg.width / 2, -wheelImg.height / 2);
    ctx.restore();
    if (end !== null) spotlightWinner(ctx, d, angle, Math.abs(Math.sin(end * 0.5)));
    rim(ctx, phase, end !== null && end % 4 < 2);
    hub(ctx, d.host.color);
    pointer(ctx);
    if (end !== null) {
      drawConfetti(ctx, pieces, end);
      resultBox(ctx, d, Math.min(1, (end + 1) / 5));
    }
    return ctx.getImageData(0, 0, WHEEL_W, WHEEL_H).data;
  };

  const frames: { data: Uint8ClampedArray; delay: number }[] = [];
  for (let f = 0; f < SPIN_FRAMES; f++) {
    const t = f / (SPIN_FRAMES - 1);
    const eased = 1 - Math.pow(1 - t, 3.2);
    frames.push({ data: draw(target * eased, Math.floor(f / 2), null), delay: FRAME_MS });
  }
  for (let f = 0; f < END_FRAMES; f++) frames.push({ data: draw(target, f, f), delay: f === END_FRAMES - 1 ? HOLD_MS : FRAME_MS + 10 });

  // Una paleta para todo el GIF, con los colores del giro (primer cuadro) y del final (luz, recuadro y confeti).
  const first = frames[0]!.data;
  const last = frames[Math.floor(SPIN_FRAMES + END_FRAMES / 2)]!.data;
  const sample = new Uint8Array(first.length + last.length);
  sample.set(first, 0);
  sample.set(last, first.length);
  const palette = quantize(sample, 256);
  const gif = GIFEncoder();
  frames.forEach(({ data, delay }, i) => {
    gif.writeFrame(applyPalette(data, palette), WHEEL_W, WHEEL_H, { palette: i === 0 ? palette : undefined, delay, repeat: i === 0 ? -1 : undefined });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}
