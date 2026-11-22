// Imágenes de la Ruleta de Némesis (PLAN §3.12). Arte de los B-rolls de «The Muzzle of Nemesis» del motor
// (assets/nemesis/, npm run nemesis:arte): Némesis con la máscara apuntando de frente, sobre las cortinas rojas del PV.
//  - bannerImage: el desafío, Papu 1 vs Papu 2 con Némesis al centro, la apuesta y el premio.
//  - turnImage: la mesa mientras espera el disparo (de quién es el turno, el tambor con las recámaras ya disparadas).
//  - shotGif: el disparo (gira el tambor, suspenso y *click* o ¡BANG!). Se reproduce una vez y se queda en el final.
// Todo el texto va centrado por su dibujo real y se achica si no cabe.
import path from "node:path";
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { centerText } from "../coins/arte";
import { fitText, FONT, roundRect } from "../levels/card";
import { decorarMembresia, type MarcoMembresia } from "../membresias/marco";

// gifenc es CommonJS: Node lo entrega entero en `default`; vitest usa su versión ESM, con las funciones sueltas.
const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

const TITLE = `"Bahnschrift", "Noto Sans Display", ${FONT}`;
const ART_DIR = path.resolve(import.meta.dirname, "../../assets/nemesis");
const COIN_FILE = path.resolve(import.meta.dirname, "../../assets/tienda/iconos/moneda.png");
/** Verde de la ira de Némesis (el fuego verde de Gumi en los videos del canal). */
const IRA = "#4dff7a";
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);

export interface Jugador {
  name: string;
  /** PNG o JPG del avatar (null = un círculo con su inicial). */
  avatar: Buffer | null;
}

interface Art {
  mascara: Image;
  cortinas: Image;
  coin: Image | null;
}

let art: Promise<Art> | null = null;
function loadArt(): Promise<Art> {
  art ??= (async () => ({
    mascara: await loadImage(path.join(ART_DIR, "mascara.png")),
    cortinas: await loadImage(path.join(ART_DIR, "cortinas.png")),
    coin: await loadImage(COIN_FILE).catch(() => null),
  }))();
  return art;
}

function canvas(w: number, h: number): [Canvas, SKRSContext2D] {
  const c = createCanvas(w, h);
  return [c, c.getContext("2d")];
}

/** Texto centrado en (cx, cy) que se achica hasta caber en `maxW` (y, si aun así no cabe, se recorta). */
function fitCenter(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, size: number, min: number, family = TITLE, weight = "bold"): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--s}px ${family}`;
  centerText(ctx, fitText(ctx, text, maxW), cx, cy);
}

/** Texto con borde oscuro y brillo (títulos). */
function glowText(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, size: number, min: number, fill: string, glow: string): void {
  ctx.save();
  ctx.lineJoin = "round";
  let s = size;
  ctx.font = `bold ${s}px ${TITLE}`;
  while (s > min && ctx.measureText(text).width > maxW) ctx.font = `bold ${--s}px ${TITLE}`;
  const shown = fitText(ctx, text, maxW);
  const m = ctx.measureText(shown);
  const x = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft;
  const y = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = Math.max(4, s / 7);
  ctx.strokeStyle = "rgba(8, 2, 6, 0.9)";
  ctx.strokeText(shown, x, y);
  ctx.shadowColor = glow;
  ctx.shadowBlur = s / 2.5;
  ctx.fillStyle = fill;
  ctx.fillText(shown, x, y);
  ctx.restore();
}

/** Avatar (o su inicial) en un lienzo cuadrado, para recortarlo en círculo. */
async function avatarCanvas(p: Jugador, size: number): Promise<Canvas> {
  const [c, ctx] = canvas(size, size);
  const img = p.avatar ? await loadImage(p.avatar).catch(() => null) : null;
  if (img) ctx.drawImage(img, 0, 0, size, size);
  else {
    ctx.fillStyle = "#3a2a44";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#ffffff";
    fitCenter(ctx, ([...p.name.trim()][0] ?? "?").toUpperCase(), size / 2, size / 2, size * 0.7, size * 0.55, 10);
  }
  return c;
}

/** El avatar como PNG cuadrado (o su inicial, si no tiene): para el GIF del ganador del 1vs1. */
export async function avatarPng(p: Jugador, size = 256): Promise<Buffer> {
  return (await avatarCanvas(p, size)).toBuffer("image/png");
}

/** Copia en blanco y negro (y un poco oscurecida). */
function grayscale(src: Canvas): Canvas {
  const [c, ctx] = canvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let k = 0; k < p.length; k += 4) {
    const l = Math.round((0.299 * p[k]! + 0.587 * p[k + 1]! + 0.114 * p[k + 2]!) * 0.75);
    p[k] = p[k + 1] = p[k + 2] = l;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

function circle(ctx: SKRSContext2D, img: Canvas, cx: number, cy: number, r: number, ring: string, glow: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = ring;
  ctx.shadowBlur = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function redCross(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  for (const [w, color] of [
    [22, "#2a0000"],
    [13, "#e8102a"],
  ] as const) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
    ctx.restore();
  }
}

/** Mira sobre el avatar del que le toca. */
function crosshair(ctx: SKRSContext2D, cx: number, cy: number, r: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#ff3045";
  ctx.shadowColor = "#ff3045";
  ctx.shadowBlur = 10;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    ctx.moveTo(cx + dx * r * 0.3, cy + dy * r * 0.3);
    ctx.lineTo(cx + dx * r * 0.95, cy + dy * r * 0.95);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Fondo: las cortinas rojas del PV (difuminadas y oscurecidas) y Némesis con la máscara al centro, fundida a los lados.
 * Devuelve también dónde quedó la boca del revólver (para el fogonazo).
 */
function scene(ctx: SKRSContext2D, a: Art, W: number, H: number, nemesisW: number): { muzzle: [number, number] } {
  // Cortinas: a lo alto, sin Némesis de perfil (su lado derecho queda fuera).
  ctx.save();
  ctx.filter = "blur(5px)";
  ctx.drawImage(a.cortinas, 0, 0, a.cortinas.width * 0.62, a.cortinas.height, -W * 0.02, -H * 0.02, W * 1.04, H * 1.04);
  ctx.restore();
  ctx.fillStyle = "rgba(18, 0, 6, 0.55)";
  ctx.fillRect(0, 0, W, H);
  // Némesis: la franja de la cara y el revólver (x 230-650 del cuadro), a todo lo alto, con los bordes fundidos.
  const sx = 230, sw = 420;
  const scale = H / a.mascara.height;
  const dw = Math.min(nemesisW, sw * scale);
  const srcW = dw / scale;
  const srcX = sx + (sw - srcW) / 2;
  const [n, nc] = canvas(Math.round(dw), H);
  nc.drawImage(a.mascara, srcX, 0, srcW, a.mascara.height, 0, 0, dw, H);
  nc.globalCompositeOperation = "destination-in";
  const fade = nc.createLinearGradient(0, 0, dw, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.2, "rgba(0,0,0,1)");
  fade.addColorStop(0.8, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  nc.fillStyle = fade;
  nc.fillRect(0, 0, dw, H);
  const nx = (W - dw) / 2;
  ctx.drawImage(n, nx, 0);
  // Viñeta: arriba y abajo más oscuro (ahí va el texto).
  const v = ctx.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, "rgba(6, 0, 4, 0.75)");
  v.addColorStop(0.22, "rgba(6, 0, 4, 0)");
  v.addColorStop(0.7, "rgba(6, 0, 4, 0)");
  v.addColorStop(1, "rgba(6, 0, 4, 0.85)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  // La boca del cañón está en (312, 205) del cuadro.
  return { muzzle: [nx + (312 - srcX) * scale, 205 * scale] };
}

// ───────────────────────── banner del desafío ─────────────────────────

export const BANNER_W = 1000;
export const BANNER_H = 560;

export interface BannerData {
  retador: Jugador;
  rival: Jugador;
  apuesta: number;
  premio: number;
  tajada: number;
  recamaras: number;
  /** Estilo de la membresía de Ko-fi del retador (marco y cinta, PLAN §2); sin membresía, nada. */
  membresia?: MarcoMembresia;
}

export async function bannerImage(d: BannerData): Promise<Buffer> {
  const a = await loadArt();
  const [c, ctx] = canvas(BANNER_W, BANNER_H);
  scene(ctx, a, BANNER_W, BANNER_H, 600);
  glowText(ctx, "RULETA DE NÉMESIS", BANNER_W / 2, 46, BANNER_W - 80, 58, 30, "#f4fff6", IRA);
  ctx.save();
  ctx.shadowColor = "#000000";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffd6dc";
  fitCenter(ctx, `Una bala · ${d.recamaras} recámaras · el que sobreviva se lleva todo`, BANNER_W / 2, 104, BANNER_W - 120, 22, 14, FONT, "600");
  ctx.restore();
  const cols: [Jugador, number][] = [
    [d.retador, 150],
    [d.rival, BANNER_W - 150],
  ];
  for (const [p, cx] of cols) {
    circle(ctx, await avatarCanvas(p, 256), cx, 268, 104, "#f2f2f2", 26);
    glowText(ctx, p.name, cx, 408, 270, 34, 16, "#ffffff", "#ff3045");
  }
  glowText(ctx, "VS", BANNER_W / 2, 420, 200, 76, 40, "#ffe0e4", "#ff2a3c");
  // Franja de abajo: apuesta, premio y la tajada de Némesis.
  roundRect(ctx, 60, 470, BANNER_W - 120, 62, 31);
  ctx.fillStyle = "rgba(8, 2, 6, 0.82)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = IRA;
  ctx.stroke();
  const text = `${fmt(d.apuesta)} cada uno  ·  el que sobreviva se lleva ${fmt(d.premio)}  ·  Némesis cobra ${fmt(d.tajada)}`;
  if (a.coin) ctx.drawImage(a.coin, 84, 482, 38, 38);
  ctx.fillStyle = "#fff3c4";
  fitCenter(ctx, text, BANNER_W / 2 + 22, 501, BANNER_W - 220, 26, 14);
  if (d.membresia) decorarMembresia(ctx, BANNER_W, BANNER_H, d.membresia);
  return c.toBuffer("image/png");
}

// ───────────────────────── la mesa ─────────────────────────

export const MESA_W = 800;
export const MESA_H = 450;
const AV = { r: 74, y: 212, x: [118, MESA_W - 118] as const };
const CYL = { x: MESA_W / 2, y: 372, r: 54 };

export interface MesaData {
  retador: Jugador;
  rival: Jugador;
  /** Quién jala: 0 = el retador, 1 = el rival. */
  shooter: 0 | 1;
  /** Turno (0, 1, 2…) = recámaras ya disparadas. */
  turno: number;
  recamaras: number;
}

/** Lo fijo de una partida (fondo, Némesis y los dos avatares en color y en gris): se arma una vez por imagen. */
async function mesaBase(d: MesaData): Promise<{ bg: Canvas; muzzle: [number, number]; av: [Canvas, Canvas]; gray: [Canvas, Canvas] }> {
  const a = await loadArt();
  const [bg, ctx] = canvas(MESA_W, MESA_H);
  const { muzzle } = scene(ctx, a, MESA_W, MESA_H, 470);
  const av = [await avatarCanvas(d.retador, 200), await avatarCanvas(d.rival, 200)] as [Canvas, Canvas];
  return { bg, muzzle, av, gray: [grayscale(av[0]), grayscale(av[1])] };
}

/** Tambor del revólver: la recámara de arriba es la que se dispara; las ya disparadas, vacías. `rot` = giro extra (rad). */
function cylinder(ctx: SKRSContext2D, turno: number, recamaras: number, rot: number, current: "espera" | "click" | "bang" = "espera"): void {
  const { x, y, r } = CYL;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 14;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 4, x, y, r);
  g.addColorStop(0, "#9aa0ad");
  g.addColorStop(0.6, "#4a4f5c");
  g.addColorStop(1, "#22252d");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#15171c";
  ctx.stroke();
  const step = (Math.PI * 2) / recamaras;
  for (let i = 0; i < recamaras; i++) {
    // La recámara `turno` queda arriba (-90°).
    const ang = -Math.PI / 2 + (i - turno) * step + rot;
    const cx = x + Math.cos(ang) * r * 0.6, cy = y + Math.sin(ang) * r * 0.6, cr = r * 0.2;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    const disparada = i < turno || (i === turno && current !== "espera");
    ctx.fillStyle = i === turno && current === "bang" ? "#ffcf3a" : disparada ? "#0b0c10" : "#2c2f38";
    ctx.fill();
    ctx.lineWidth = i === turno && rot === 0 ? 3 : 2;
    ctx.strokeStyle = i === turno && rot === 0 ? (current === "bang" ? "#ff3045" : IRA) : "#6b7080";
    ctx.stroke();
  }
  // Eje del tambor.
  ctx.beginPath();
  ctx.arc(x, y, r * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1c22";
  ctx.fill();
  // Martillo (arriba): marca de la recámara que se dispara.
  ctx.beginPath();
  ctx.moveTo(x - 9, y - r - 16);
  ctx.lineTo(x + 9, y - r - 16);
  ctx.lineTo(x, y - r - 3);
  ctx.closePath();
  ctx.fillStyle = current === "bang" ? "#ff3045" : IRA;
  ctx.fill();
}

type Fase = "espera" | "giro" | "click" | "bang" | "fogonazo";

/** Un cuadro de la mesa. `t` = avance de la fase (0 a 1). */
function mesaFrame(ctx: SKRSContext2D, base: Awaited<ReturnType<typeof mesaBase>>, d: MesaData, fase: Fase, t: number): void {
  ctx.drawImage(base.bg, 0, 0);
  const names = [d.retador.name, d.rival.name];
  const dead = fase === "bang";
  for (const k of [0, 1] as const) {
    const cx = AV.x[k];
    const turn = k === d.shooter;
    if (turn && dead) {
      circle(ctx, base.gray[k], cx, AV.y, AV.r, "#5a5a66", 0);
      redCross(ctx, cx, AV.y, AV.r * 0.72);
    } else if (dead) circle(ctx, base.av[k], cx, AV.y, AV.r, "#ffd23d", 30);
    else circle(ctx, base.av[k], cx, AV.y, AV.r, turn ? (fase === "click" ? IRA : "#ff3045") : "#d8d8d8", turn ? 30 : 8, turn ? 1 : 0.45);
    if (turn && (fase === "espera" || fase === "giro")) crosshair(ctx, cx, AV.y, AV.r, 0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 2)));
    const lit = turn || dead;
    glowText(ctx, names[k]!, cx, AV.y + AV.r + 30, 220, 26, 13, lit ? "#ffffff" : "#c9c2cc", lit ? (turn ? "#ff3045" : "#ffb020") : "#000000");
    const label = !turn ? (dead ? "¡GANA!" : "") : fase === "bang" ? "FUERA" : fase === "click" ? "¡SOBREVIVE!" : "LE TOCA";
    const color = !turn ? "#fff1b8" : fase === "bang" ? "#ff5c6e" : fase === "click" ? "#cfffdc" : "#ffe0e4";
    if (label) glowText(ctx, label, cx, AV.y - AV.r - 26, 220, 24, 12, color, !turn ? "#ffb020" : fase === "click" ? IRA : "#ff3045");
  }
  glowText(ctx, `TURNO ${d.turno + 1}`, MESA_W / 2, 34, 360, 40, 20, "#f4fff6", IRA);
  const left = d.recamaras - d.turno;
  ctx.fillStyle = "#ffd6dc";
  fitCenter(ctx, `Recámara ${d.turno + 1} de ${d.recamaras} · bala: 1 de ${left}`, MESA_W / 2, 70, 420, 19, 12, FONT, "600");
  // Tambor: en el giro avanza una recámara (de -60° a 0) con freno al final.
  const step = (Math.PI * 2) / d.recamaras;
  const rot = fase === "giro" ? step * (1 - t) ** 2 : 0;
  cylinder(ctx, d.turno, d.recamaras, rot, fase === "bang" || fase === "fogonazo" ? "bang" : fase === "click" ? "click" : "espera");
  if (fase === "click") glowText(ctx, "*click*", MESA_W / 2, 262, 300, 54, 24, "#e8ffe9", IRA);
  if (fase === "fogonazo" || fase === "bang") {
    // Fogonazo en la boca del revólver de Némesis.
    const [mx, my] = base.muzzle;
    ctx.save();
    const rays = 12, R = fase === "fogonazo" ? 90 : 46;
    ctx.beginPath();
    for (let i = 0; i < rays * 2; i++) {
      const ang = (i / (rays * 2)) * Math.PI * 2;
      const rr = i % 2 ? R * 0.45 : R;
      ctx.lineTo(mx + Math.cos(ang) * rr, my + Math.sin(ang) * rr);
    }
    ctx.closePath();
    const fg = ctx.createRadialGradient(mx, my, 2, mx, my, R);
    fg.addColorStop(0, "#ffffff");
    fg.addColorStop(0.4, "#fff3a0");
    fg.addColorStop(1, "rgba(255, 120, 0, 0)");
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.restore();
  }
  if (fase === "bang") glowText(ctx, "¡BANG!", MESA_W / 2, 262, 420, 92, 40, "#fff0f0", "#ff2a3c");
}

/** La mesa esperando el disparo (PNG). */
export async function turnImage(d: MesaData): Promise<Buffer> {
  const base = await mesaBase(d);
  const [c, ctx] = canvas(MESA_W, MESA_H);
  mesaFrame(ctx, base, d, "espera", 0.25);
  return c.toBuffer("image/png");
}

/** Cuánto dura el GIF del disparo (ms), para esperar a que se vea antes del turno siguiente. */
export function shotGifMs(bang: boolean): number {
  return GIRO_FRAMES * GIRO_MS + SUSPENSO_MS + (bang ? 70 + 2 * 90 : 0);
}
const GIRO_FRAMES = 8;
const GIRO_MS = 70;
const SUSPENSO_MS = 900;

/** El disparo (GIF de una sola pasada): gira el tambor, suspenso y *click* o ¡BANG! (se queda en el último cuadro). */
export async function shotGif(d: MesaData, bang: boolean): Promise<Buffer> {
  const base = await mesaBase(d);
  const [, ctx] = canvas(MESA_W, MESA_H);
  const frames: { data: Uint8ClampedArray; delay: number }[] = [];
  const push = (delay: number) => frames.push({ data: ctx.getImageData(0, 0, MESA_W, MESA_H).data, delay });
  for (let f = 0; f < GIRO_FRAMES; f++) {
    mesaFrame(ctx, base, d, "giro", f / (GIRO_FRAMES - 1));
    push(GIRO_MS);
  }
  mesaFrame(ctx, base, d, "espera", 0);
  push(SUSPENSO_MS);
  if (bang) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, MESA_W, MESA_H);
    push(70);
    for (const alpha of [0.55, 0.3]) {
      mesaFrame(ctx, base, d, "fogonazo", 0);
      ctx.fillStyle = `rgba(255, 30, 50, ${alpha})`;
      ctx.fillRect(0, 0, MESA_W, MESA_H);
      push(90);
    }
    mesaFrame(ctx, base, d, "bang", 0);
    push(10_000);
  } else {
    mesaFrame(ctx, base, d, "click", 0);
    push(10_000);
  }
  // Una paleta para todo el GIF (con el primer cuadro y el último de muestra).
  const first = frames[0]!.data, last = frames[frames.length - 1]!.data;
  const sample = new Uint8Array(first.length * 2);
  sample.set(first, 0);
  sample.set(last, first.length);
  const palette = quantize(sample, 256);
  const gif = GIFEncoder();
  // repeat -1 = sin bucle: se ve una vez y queda el resultado.
  frames.forEach((fr, i) => gif.writeFrame(applyPalette(fr.data, palette), MESA_W, MESA_H, { palette: i === 0 ? palette : undefined, delay: fr.delay, repeat: i === 0 ? -1 : undefined }));
  gif.finish();
  return Buffer.from(gif.bytes());
}
