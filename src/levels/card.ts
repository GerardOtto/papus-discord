// Tarjeta de nivel (/nivel): imagen PNG con el avatar, la insignia del rango, la barra de XP y lo que cada Papu
// personaliza con /tarjeta (frase, color y fondo). La insignia es mas llamativa cuanto mas alto el rango:
// gris, color, degradados, plata, oro, destellos, tornasol y arcoiris (PLAN §niveles). Los objetos de las
// Shaula-coins (PLAN §3.6) se dibujan encima; si alguno se mueve, la tarjeta sale como GIF.
import { createCanvas, loadImage, type CanvasGradient, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";

// gifenc es CommonJS: Node lo entrega entero en `default`; vitest usa su version ESM, con las funciones sueltas.
const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

export const CARD_W = 1000;
export const CARD_H = 340;

export interface CardData {
  name: string;
  avatar: Buffer | null;
  level: number;
  max: number;
  prestige: number;
  into: number;
  needed: number;
  /** Estilo del rango (config/niveles.json, `estilo`: 0 gris … 10 Salon de la fama): define la insignia. */
  tier: number;
  rankName: string;
  position: number;
  quota: { left: number; limit: number } | null;
  frase: string | null;
  /** "#RRGGBB" */
  accent: string;
  background: Buffer | null;
  /** Multiplicador de XP vigente (1 = sin evento). */
  multiplier: number;
}

/**
 * Objetos equipados (Shaula-coins, src/coins/): cada uno ya resuelto a su dibujo. t = fase de la animacion (0 a 1).
 * `fondo` puede ser una imagen (render) o un dibujo; el resto son dibujos. Sin objeto, se ve la tarjeta de siempre.
 */
export interface CardEquip {
  fondo?: Image | ((ctx: SKRSContext2D, t: number) => void);
  borde?: (ctx: SKRSContext2D, t: number) => void;
  aro?: (ctx: SKRSContext2D, t: number) => void;
  barra?: (ctx: SKRSContext2D, t: number, x: number, y: number, w: number, h: number) => void;
  nombre?: {
    paint: (ctx: SKRSContext2D, t: number, x: number, w: number) => void;
    back?: (ctx: SKRSContext2D, text: string, x: number, y: number, size: number, t: number) => void;
  };
  /** Hasta 3, junto al nombre: un emoji o una imagen. */
  insignias?: (string | Image)[];
  /** Reemplaza la frase. color "rainbow" = arcoiris que se mueve. */
  titulo?: { texto: string; color: string };
  /** Algo se mueve: la tarjeta sale como GIF. */
  animado?: boolean;
}

export const CARD_FRAMES = 24;
const CARD_DELAY_MS = 60;

// Primero las de Windows (PC de GyroP); despues sus equivalentes libres del servidor Linux (fonts-noto-*, que instala
// nube/servidor/preparar.sh): sin ellas el servidor no dibuja ningun texto.
export const FONT =
  '"Segoe UI", "Noto Sans", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", "Noto Sans Symbols", "Yu Gothic", "Noto Sans CJK JP", Arial, "DejaVu Sans", sans-serif';
export const RAINBOW = ["#ff3b5c", "#ff9f1c", "#ffe14d", "#3ddc84", "#36c5f0", "#8c5cff"];
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));

/** Arcoiris que se desplaza en horizontal: t de 0 a 1 da una vuelta sin saltos. */
export function rainbowAt(ctx: SKRSContext2D, x: number, w: number, t: number, colors: readonly string[] = RAINBOW): CanvasGradient {
  const s = t * w;
  const g = ctx.createLinearGradient(x - w + s, 0, x + w + s, 0);
  const stops = [...colors, ...colors, colors[0]!];
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

export function gradient(ctx: SKRSContext2D, x: number, y: number, w: number, stops: string[]): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x + w, y);
  stops.forEach((c, i) => g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
  return g;
}

/** Relleno de la insignia y de la barra segun el rango. */
export function tierFill(ctx: SKRSContext2D, tier: number, x: number, y: number, w: number): { fill: string | CanvasGradient; text: string; glow: string | null } {
  switch (tier) {
    case 0: return { fill: "#5b6470", text: "#ffffff", glow: null };
    case 1: return { fill: "#39C5BB", text: "#06302D", glow: null };
    case 2: return { fill: gradient(ctx, x, y, w, ["#39C5BB", "#E285B2"]), text: "#1D1220", glow: null };
    case 3: return { fill: gradient(ctx, x, y, w, ["#9AA3AE", "#E9EEF3", "#FFFFFF", "#E9EEF3", "#9AA3AE"]), text: "#232A33", glow: "#E9EEF3" };
    case 4: return { fill: gradient(ctx, x, y, w, ["#B8860B", "#FFD166", "#FFF6D5", "#FFD166", "#B8860B"]), text: "#3A2600", glow: "#FFD166" };
    case 5: return { fill: gradient(ctx, x, y, w, ["#E91E63", "#9B6CFF", "#39C5BB"]), text: "#ffffff", glow: null };
    case 6: return { fill: gradient(ctx, x, y, w, ["#E91E63", "#9B6CFF", "#39C5BB", "#E91E63"]), text: "#ffffff", glow: "#9B6CFF" };
    case 7: return { fill: gradient(ctx, x, y, w, ["#A8F0FF", "#F8B5FF", "#FFF3A8", "#B5FFD0", "#A8F0FF"]), text: "#2A2140", glow: "#F8B5FF" };
    case 8: return { fill: gradient(ctx, x, y, w, RAINBOW), text: "#ffffff", glow: "#ffffff" };
    case 9: return { fill: gradient(ctx, x, y, w, [...RAINBOW, RAINBOW[0]!]), text: "#ffffff", glow: "#ffe14d" };
    default: return { fill: "#120B1F", text: "rainbow", glow: "#ff3b5c" };
  }
}

export function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Destellos fijos (mismo dibujo siempre) dentro de un rectangulo. */
export function sparkles(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, n: number, color = "#ffffff"): void {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const cx = x + rnd() * w;
    const cy = y + rnd() * h;
    const r = 1 + rnd() * 2.2;
    ctx.globalAlpha = 0.45 + rnd() * 0.5;
    ctx.beginPath();
    // Estrella de cuatro puntas.
    ctx.moveTo(cx, cy - r * 2.2);
    ctx.quadraticCurveTo(cx, cy, cx + r * 2.2, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + r * 2.2);
    ctx.quadraticCurveTo(cx, cy, cx - r * 2.2, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - r * 2.2);
    ctx.fill();
  }
  ctx.restore();
}

export function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && ctx.measureText(`${chars.join("")}…`).width > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

function coverImage(ctx: SKRSContext2D, img: Image): void {
  const scale = Math.max(CARD_W / img.width, CARD_H / img.height);
  ctx.drawImage(img, (CARD_W - img.width * scale) / 2, (CARD_H - img.height * scale) / 2, img.width * scale, img.height * scale);
}

/** Insignia "★2 Nv 57" con el estilo de su rango. Devuelve el ancho dibujado. */
function drawBadge(ctx: SKRSContext2D, x: number, y: number, d: CardData): number {
  const stars = d.prestige > 0 ? `★${d.prestige}  ` : "";
  const label = `${stars}Nv ${d.level}`;
  ctx.font = `bold 30px ${FONT}`;
  const w = ctx.measureText(label).width + 36;
  const h = 48;
  const t = tierFill(ctx, d.tier, x, y, w);
  ctx.save();
  if (t.glow) {
    ctx.shadowColor = t.glow;
    ctx.shadowBlur = d.tier >= 9 ? 26 : 14;
  }
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = t.fill;
  ctx.fill();
  ctx.restore();
  if (d.tier === 0) {
    roundRect(ctx, x, y, w, h, 10);
    ctx.strokeStyle = "#aab2bd";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (d.tier >= 10) {
    roundRect(ctx, x, y, w, h, 10);
    ctx.strokeStyle = "#ffe14d";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (d.tier >= 6) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 10);
    ctx.clip();
    sparkles(ctx, x, y, w, h, 10);
    ctx.restore();
  }
  ctx.fillStyle = t.text === "rainbow" ? gradient(ctx, x + 18, y, w - 36, RAINBOW) : t.text;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 18, y + h / 2 + 1);
  return w;
}

export async function renderCard(d: CardData, equip: CardEquip = {}): Promise<Buffer> {
  const canvas = createCanvas(CARD_W, CARD_H);
  drawFrame(canvas.getContext("2d"), d, await loadCardImages(d), equip, 0);
  return canvas.toBuffer("image/png");
}

/** Tarjeta con objetos: GIF si alguno se mueve (24 cuadros, se repite), si no PNG. */
export async function renderCardAny(d: CardData, equip: CardEquip = {}): Promise<{ data: Buffer; gif: boolean }> {
  if (!equip.animado) return { data: await renderCard(d, equip), gif: false };
  const images = await loadCardImages(d);
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < CARD_FRAMES; i++) {
    ctx.save();
    // El GIF no tiene transparencia parcial: las esquinas redondeadas van sobre el gris oscuro de Discord.
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    drawFrame(ctx, d, images, equip, i / CARD_FRAMES);
    ctx.restore();
    frames.push(ctx.getImageData(0, 0, CARD_W, CARD_H).data);
  }
  // Paleta comun: un pixel de cada 8 de cuatro cuadros repartidos.
  const sample: number[] = [];
  for (let f = 0; f < CARD_FRAMES; f += CARD_FRAMES / 4) {
    const px = frames[f]!;
    for (let p = 0; p < px.length; p += 32) sample.push(px[p]!, px[p + 1]!, px[p + 2]!, px[p + 3]!);
  }
  const palette = quantize(new Uint8ClampedArray(sample), 256);
  const gif = GIFEncoder();
  frames.forEach((px, i) =>
    gif.writeFrame(applyPalette(px, palette), CARD_W, CARD_H, { palette: i === 0 ? palette : undefined, delay: CARD_DELAY_MS, repeat: i === 0 ? 0 : undefined }),
  );
  gif.finish();
  return { data: Buffer.from(gif.bytes()), gif: true };
}

interface CardImages {
  avatar: Image | null;
  background: Image | null;
}

async function loadCardImages(d: CardData): Promise<CardImages> {
  const load = async (b: Buffer | null) => (b ? await loadImage(b).catch(() => null) : null);
  return { avatar: await load(d.avatar), background: await load(d.background) };
}

/** Un cuadro de la tarjeta (t = fase de la animacion de los objetos). */
function drawFrame(ctx: SKRSContext2D, d: CardData, img: CardImages, e: CardEquip, t: number): void {
  ctx.save();
  // Fondo: el objeto equipado, la imagen (banner de un Vocaloid o la aprobada por GyroP) o el degradado del color
  // elegido; velo para leer.
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 28);
  ctx.clip();
  if (e.fondo) {
    if (typeof e.fondo === "function") e.fondo(ctx, t);
    else coverImage(ctx, e.fondo);
  } else if (img.background) coverImage(ctx, img.background);
  else {
    ctx.fillStyle = gradient(ctx, 0, 0, CARD_W, [d.accent, "#16131f"]);
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  const veil = ctx.createLinearGradient(0, 0, CARD_W, 0);
  veil.addColorStop(0, "rgba(10,8,18,0.82)");
  veil.addColorStop(0.65, "rgba(10,8,18,0.62)");
  veil.addColorStop(1, "rgba(10,8,18,0.30)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (d.tier >= 8) sparkles(ctx, 0, 0, CARD_W, CARD_H, 40, d.tier >= 10 ? "#ffe14d" : "#ffffff");

  // Avatar con aro del rango (o el aro equipado).
  const ax = 40, ay = 60, as = 210;
  ctx.save();
  if (e.aro) e.aro(ctx, t);
  else {
    const ring = tierFill(ctx, Math.max(d.tier, 1), ax, ay, as);
    if (ring.glow) {
      ctx.shadowColor = ring.glow;
      ctx.shadowBlur = 24;
    }
    ctx.beginPath();
    ctx.arc(ax + as / 2, ay + as / 2, as / 2 + 7, 0, Math.PI * 2);
    ctx.fillStyle = d.tier === 0 ? d.accent : ring.fill;
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + as / 2, ay + as / 2, as / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#2b2838";
  ctx.fillRect(ax, ay, as, as);
  if (img.avatar) ctx.drawImage(img.avatar, ax, ay, as, as);
  ctx.restore();

  const x = 290;
  const right = CARD_W - 40;
  const insignias = (e.insignias ?? []).slice(0, 3);
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 46px ${FONT}`;
  const name = fitText(ctx, d.name, right - x - (insignias.length ? 18 + insignias.length * 58 : 0));
  ctx.save();
  if (e.nombre) {
    e.nombre.back?.(ctx, name, x, 98, 46, t);
    e.nombre.paint(ctx, t, x, ctx.measureText(name).width);
  } else ctx.fillStyle = "#ffffff";
  ctx.fillText(name, x, 98);
  ctx.restore();

  // Insignias: hasta 3, a la derecha del nombre (centradas por el dibujo real del emoji).
  insignias.forEach((ins, i) => {
    const bx = right - 50 - i * 58, by = 52;
    roundRect(ctx, bx, by, 50, 50, 14);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (typeof ins === "string") {
      ctx.font = `30px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "alphabetic";
      const m = ctx.measureText(ins);
      ctx.fillText(ins, bx + 25 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, by + 25 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
    } else ctx.drawImage(ins, bx + 5, by + 5, 40, 40);
  });

  const bw = drawBadge(ctx, x, 120, d);
  ctx.textBaseline = "middle";
  ctx.font = `600 24px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fitText(ctx, `${d.rankName} · #${d.position} del servidor`, right - x - bw - 18), x + bw + 18, 145);

  // Titulo equipado (reemplaza la frase) o la frase de /tarjeta.
  ctx.textBaseline = "alphabetic";
  if (e.titulo) {
    ctx.font = `italic bold 24px ${FONT}`;
    const text = fitText(ctx, `« ${e.titulo.texto} »`, right - x);
    ctx.fillStyle = e.titulo.color === "rainbow" ? rainbowAt(ctx, x, ctx.measureText(text).width, t) : e.titulo.color;
    ctx.fillText(text, x, 204);
  } else if (d.frase) {
    ctx.font = `italic 24px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillText(fitText(ctx, `“${d.frase}”`, right - x), x, 204);
  }

  // Barra de XP (la equipada se dibuja dentro de la parte llena).
  const by = 254, bh = 28, bwid = right - x;
  roundRect(ctx, x, by, bwid, bh, bh / 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();
  const frac = d.level >= d.max ? 1 : Math.max(0, Math.min(1, d.into / d.needed));
  if (frac > 0) {
    const fw = Math.max(bh, bwid * frac);
    if (e.barra) {
      ctx.save();
      roundRect(ctx, x, by, fw, bh, bh / 2);
      ctx.clip();
      e.barra(ctx, t, x, by, fw, bh);
      ctx.restore();
    } else {
      const bar = tierFill(ctx, Math.max(d.tier, 1), x, by, bwid);
      roundRect(ctx, x, by, fw, bh, bh / 2);
      ctx.fillStyle = d.tier <= 1 ? d.accent : d.tier >= 10 ? gradient(ctx, x, by, bwid, RAINBOW) : bar.fill;
      ctx.fill();
    }
  }
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  const xpText = d.level >= d.max ? "¡Nivel máximo! Ya puedes prestigiar ★" : `${fmt(d.into)} / ${fmt(d.needed)} XP para el nivel ${d.level + 1}`;
  ctx.fillText(xpText, x, by - 10);

  const foot = [d.quota ? `Cuota hoy: ${d.quota.left} de ${d.quota.limit}` : "", d.multiplier > 1 ? `Evento ×${String(d.multiplier).replace(".", ",")} activo` : ""]
    .filter(Boolean)
    .join("   ·   ");
  if (foot) {
    ctx.font = `20px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(foot, x, by + bh + 28);
  }
  ctx.restore();
  // Borde equipado, encima de todo.
  if (e.borde) {
    ctx.save();
    e.borde(ctx, t);
    ctx.restore();
  }
}

/**
 * Ajuste de una imagen propia en la tarjeta (/tarjeta ajuste; pedido de GyroP, 21 oct. 2026: a un Papu "no se veía
 * todo"). La tarjeta es muy ancha: "centro", "arriba" y "abajo" la llenan recortando lo que sobra; "completa" la
 * muestra entera sobre una copia borrosa de sí misma.
 */
export const BACKGROUND_FITS = ["centro", "arriba", "abajo", "completa"] as const;
export type BackgroundFit = (typeof BACKGROUND_FITS)[number];

/** Recorta una imagen subida al formato de la tarjeta (PNG); null si no es una imagen valida. */
export async function normalizeBackground(buf: Buffer, fit: BackgroundFit = "centro"): Promise<Buffer | null> {
  try {
    const img = await loadImage(buf);
    if (img.width < 100 || img.height < 50) return null;
    const canvas = createCanvas(CARD_W, CARD_H);
    const ctx = canvas.getContext("2d");
    const scale = Math.max(CARD_W / img.width, CARD_H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const y = fit === "arriba" ? 0 : fit === "abajo" ? CARD_H - h : (CARD_H - h) / 2;
    if (fit === "completa") ctx.filter = "blur(16px) brightness(0.6)";
    ctx.drawImage(img, (CARD_W - w) / 2, fit === "completa" ? (CARD_H - h) / 2 : y, w, h);
    if (fit === "completa") {
      ctx.filter = "none";
      const s = Math.min(CARD_W / img.width, CARD_H / img.height);
      ctx.drawImage(img, (CARD_W - img.width * s) / 2, (CARD_H - img.height * s) / 2, img.width * s, img.height * s);
    }
    return canvas.toBuffer("image/png");
  } catch {
    return null;
  }
}
