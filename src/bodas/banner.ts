// Banner de boda (PLAN §3.2): "¡Felicidades a los novios!" con la Vocaloid y el icono del Papu, los demas Vocaloids
// celebrando de fondo (difuminados), lluvia de petalos y el perfil de nivel del Papu (como la tarjeta, sin el fondo):
// la barra muestra en gris la XP que ya tenia y en color la de la boda; si sube de nivel, solo la del nivel nuevo.
// Tres estilos que se alternan al azar (decision de GyroP, 22 oct. 2026): altar, arco de flores y foto de recuerdo.
// Letras gruesas con contorno o sombra: nada de cursivas finas ni colores claros sobre fondo claro (pedido de GyroP).
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { fitText, FONT, gradient, roundRect, sparkles, tierFill } from "../levels/card";

export const BANNER_W = 1600;
export const BANNER_H = 800;
export const BANNER_STYLES = 3;

export interface BannerData {
  /** 0 altar, 1 arco de flores, 2 foto de recuerdo. */
  style: number;
  bride: { name: string; color: string; figure: Buffer | null };
  /** Figuras de los demas Vocaloids (fondo). */
  crowd: Buffer[];
  papu: { name: string; avatar: Buffer | null };
  /** "❤️ Espos@ de Teto" */
  role: string;
  before: { level: number; into: number; needed: number };
  after: { level: number; into: number; needed: number; max: number; tier: number; rankName: string };
  gained: number;
  multiplier: number;
  /** "22 oct. 2026" */
  date: string;
  /** Para los petalos: el mismo banner sale igual. */
  seed: number;
}

const W = BANNER_W;
const H = BANNER_H;
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));

// ───────────────────────── color ─────────────────────────

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mezcla con blanco (t > 0) o con negro (t < 0). */
function shade(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  const to = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const c = (v: number) => Math.round(v + (to - v) * k).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** Texto legible sobre un fondo del color dado. */
const inkOn = (hex: string) => (luminance(hex) > 0.4 ? "#1d1220" : "#ffffff");

// ───────────────────────── dibujo ─────────────────────────

function rng(seed: number) {
  let s = Math.abs(Math.floor(seed)) % 233280 || 7;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

async function load(buf: Buffer | null): Promise<Image | null> {
  if (!buf) return null;
  try {
    return await loadImage(buf);
  } catch {
    return null;
  }
}

function petals(ctx: SKRSContext2D, n: number, seed: number, colors: string[], area = { x: 0, y: 0, w: W, h: H }): void {
  const r = rng(seed);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = area.x + r() * area.w;
    const y = area.y + r() * area.h;
    const s = 7 + r() * 13;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI * 2);
    ctx.globalAlpha = 0.55 + r() * 0.45;
    ctx.fillStyle = colors[Math.floor(r() * colors.length)]!;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.9, -s * 0.6, s * 0.7, s * 0.7, 0, s);
    ctx.bezierCurveTo(-s * 0.7, s * 0.7, -s * 0.9, -s * 0.6, 0, -s);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function heart(ctx: SKRSContext2D, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.4, cy, cx - s * 0.9, cy - s * 1.1, cx, cy - s * 0.4);
  ctx.bezierCurveTo(cx + s * 0.9, cy - s * 1.1, cx + s * 1.4, cy, cx, cy + s * 0.9);
  ctx.closePath();
}

/** Vocaloids celebrando al fondo, difuminados. */
function crowd(ctx: SKRSContext2D, imgs: Image[], area: { x: number; y: number; w: number; h: number }, blur: number, alpha: number): void {
  if (!imgs.length) return;
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.globalAlpha = alpha;
  const step = area.w / imgs.length;
  imgs.forEach((img, i) => {
    const s = area.h / img.height;
    ctx.drawImage(img, area.x + step * i + step / 2 - (img.width * s) / 2, area.y + (i % 2) * 40, img.width * s, area.h);
  });
  ctx.restore();
}

/** Figura de la novia dentro de una caja (alineada abajo), sin pasarse del ancho. */
function figure(ctx: SKRSContext2D, img: Image | null, box: { x: number; bottom: number; maxW: number; maxH: number; align: "left" | "right" }, glow: string): void {
  if (!img) return;
  const s = Math.min(box.maxH / img.height, box.maxW / img.width);
  const w = img.width * s;
  const h = img.height * s;
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 36;
  ctx.drawImage(img, box.align === "left" ? box.x : box.x - w, box.bottom - h, w, h);
  ctx.restore();
}

function avatar(ctx: SKRSContext2D, img: Image | null, cx: number, cy: number, r: number, ring: string | CanvasGradientLike, glow: string): void {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 9, 0, Math.PI * 2);
  ctx.fillStyle = ring as string;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#2b2838";
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}
type CanvasGradientLike = ReturnType<SKRSContext2D["createLinearGradient"]>;

/** Texto grueso con contorno (se lee sobre cualquier fondo). */
function strokedText(ctx: SKRSContext2D, text: string, x: number, y: number, o: { size: number; weight?: number; fill: string | CanvasGradientLike; stroke: string; line?: number; align?: "left" | "center"; maxW?: number }): void {
  ctx.save();
  ctx.font = `${o.weight ?? 800} ${o.size}px ${FONT}`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const t = o.maxW ? fitText(ctx, text, o.maxW) : text;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = o.stroke;
  ctx.lineWidth = o.line ?? Math.max(4, o.size / 7);
  ctx.strokeText(t, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = o.fill;
  ctx.fillText(t, x, y);
  ctx.restore();
}

/** Pastilla de color con texto legible. Devuelve el ancho. */
function pill(ctx: SKRSContext2D, text: string, x: number, y: number, h: number, size: number, bg: string): number {
  ctx.save();
  ctx.font = `800 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + h;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 10;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = inkOn(bg);
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + h / 2, y + h / 2 + 1);
  ctx.restore();
  return w;
}

/** Perfil de nivel (como la tarjeta, sin fondo). `light` = sobre fondo claro (texto oscuro). */
function profile(ctx: SKRSContext2D, d: BannerData, x: number, y: number, w: number, light: boolean): void {
  const ink = light ? "#1d1220" : "#ffffff";
  const edge = light ? "rgba(255,255,255,0.9)" : "rgba(10,6,18,0.85)";
  const leveled = d.after.level > d.before.level;
  const a = d.after;

  strokedText(ctx, d.papu.name, x, y + 40, { size: 42, fill: ink, stroke: edge, line: 6, maxW: w });

  // Insignia del nivel con el estilo del rango, y el rango al lado.
  const label = `Nv ${a.level}`;
  ctx.font = `800 28px ${FONT}`;
  const bw = ctx.measureText(label).width + 32;
  const by = y + 58;
  const t = tierFill(ctx, a.tier, x, by, bw);
  ctx.save();
  if (t.glow) {
    ctx.shadowColor = t.glow;
    ctx.shadowBlur = 14;
  }
  roundRect(ctx, x, by, bw, 44, 10);
  ctx.fillStyle = t.fill;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = t.text === "rainbow" ? "#ffffff" : t.text;
  ctx.textBaseline = "middle";
  ctx.font = `800 28px ${FONT}`;
  ctx.fillText(label, x + 16, by + 23);
  strokedText(ctx, a.rankName, x + bw + 16, by + 32, { size: 26, fill: ink, stroke: edge, line: 5, maxW: w - bw - 16 });

  // Barra: gris = lo que ya tenia; color = la boda. Si subio, solo la del nivel nuevo.
  const barY = y + 166;
  const barH = 28;
  const atMax = a.level >= a.max;
  const label2 = atMax
    ? "¡Nivel máximo! Ya puede prestigiar ★"
    : `${leveled ? `¡Subió al nivel ${a.level}! · ` : ""}${fmt(a.into)} / ${fmt(a.needed)} XP para el ${a.level + 1}`;
  strokedText(ctx, label2, x, barY - 12, { size: 22, weight: 700, fill: ink, stroke: edge, line: 5, maxW: w });
  roundRect(ctx, x, barY, w, barH, barH / 2);
  ctx.fillStyle = light ? "rgba(40,20,50,0.18)" : "rgba(255,255,255,0.22)";
  ctx.fill();
  const total = atMax ? 1 : Math.max(0, Math.min(1, a.into / Math.max(1, a.needed)));
  const prev = leveled || atMax ? 0 : Math.max(0, Math.min(total, d.before.into / Math.max(1, a.needed)));
  ctx.save();
  roundRect(ctx, x, barY, w, barH, barH / 2);
  ctx.clip();
  if (total > 0) {
    // Un color claro (Neru, IA) se oscurece para que la XP ganada se distinga del fondo de la barra.
    const base = luminance(d.bride.color) > 0.45 ? shade(d.bride.color, -0.3) : d.bride.color;
    ctx.fillStyle = gradient(ctx, x, barY, w, [base, shade(base, 0.4)]);
    ctx.fillRect(x, barY, Math.max(barH, w * total), barH);
    sparkles(ctx, x + w * prev, barY, Math.max(10, w * (total - prev)), barH, 6);
  }
  if (prev > 0) {
    ctx.fillStyle = "#7d838c";
    ctx.fillRect(x, barY, w * prev, barH);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + w * prev - 1.5, barY, 3, barH);
  }
  ctx.restore();
  roundRect(ctx, x, barY, w, barH, barH / 2);
  ctx.strokeStyle = light ? "rgba(40,20,50,0.35)" : "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Lo que gano y la cuota reiniciada, en la misma fila.
  const mult = d.multiplier > 1 ? `  ·  evento ×${String(d.multiplier).replace(".", ",")}` : "";
  const py = barY + barH + 16;
  const pw = pill(ctx, `+${fmt(d.gained)} XP de la boda${mult}`, x, py, 44, 24, shade(d.bride.color, luminance(d.bride.color) > 0.5 ? -0.15 : 0));
  const quota = "💌 Cuota reiniciada";
  ctx.font = `700 22px ${FONT}`;
  const fits = pw + 18 + ctx.measureText(quota).width <= w;
  strokedText(ctx, quota, fits ? x + pw + 18 : x, fits ? py + 31 : py + 80, { size: 22, weight: 700, fill: ink, stroke: edge, line: 5, maxW: w });
}

function title(ctx: SKRSContext2D, text: string, cx: number, y: number, size: number, fill: string | CanvasGradientLike, stroke: string): void {
  strokedText(ctx, text, cx, y, { size, weight: 900, fill, stroke, line: 12, align: "center" });
}

// ───────────────────────── estilos ─────────────────────────

interface Loaded {
  bride: Image | null;
  crowd: Image[];
  papu: Image | null;
}

/** 1. Altar: luz blanca, la novia a la izquierda y el Papu separado de ella; el perfil a la derecha. */
function altar(ctx: SKRSContext2D, d: BannerData, img: Loaded): void {
  const c = d.bride.color;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, shade(c, -0.7));
  sky.addColorStop(0.55, shade(c, -0.15));
  sky.addColorStop(1, shade(c, 0.75));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const light = ctx.createRadialGradient(560, 440, 40, 560, 440, 600);
  light.addColorStop(0, "rgba(255,255,255,0.7)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  crowd(ctx, img.crowd.slice(0, 8), { x: 0, y: 170, w: W, h: 520 }, 7, 0.55);
  ctx.fillStyle = "rgba(10,20,30,0.28)";
  ctx.fillRect(0, 0, W, H);
  figure(ctx, img.bride, { x: 30, bottom: H, maxW: 600, maxH: 590, align: "left" }, "#ffffff");
  // El Papu, con espacio entre los dos; el corazon va en su aro (nunca sobre la cara de la novia).
  const ax = 790;
  const ay = 480;
  const ar = 112;
  avatar(ctx, img.papu, ax, ay, ar, gradient(ctx, ax - ar, 0, ar * 2, [c, "#ffffff", c]), "#ffffff");
  ctx.save();
  ctx.fillStyle = "#FF5C93";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  heart(ctx, ax + ar * 0.78, ay - ar * 0.8, 30);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  petals(ctx, 130, d.seed, ["#ffd1e3", "#ffffff", "#ffb3cf", shade(c, 0.6)]);
  const px = 960;
  const veil = ctx.createLinearGradient(px - 60, 0, W, 0);
  veil.addColorStop(0, "rgba(8,10,20,0)");
  veil.addColorStop(0.2, "rgba(8,10,20,0.62)");
  veil.addColorStop(1, "rgba(8,10,20,0.75)");
  ctx.fillStyle = veil;
  ctx.fillRect(px - 60, 290, W - px + 60, 360);
  profile(ctx, d, px, 310, 590, false);
  title(ctx, "¡Felicidades a los novios!", W / 2, 118, 92, "#ffffff", shade(c, -0.55));
  strokedText(ctx, `${d.bride.name} 💍 ${d.papu.name}  ·  ${d.role}`, W / 2, 178, { size: 32, fill: "#ffffff", stroke: shade(c, -0.6), align: "center", maxW: W - 120 });
}

/** 2. Arco de flores: la novia a la izquierda bajo el arco, el Papu a la derecha y el perfil en la franja de abajo. */
function arch(ctx: SKRSContext2D, d: BannerData, img: Loaded): void {
  const c = d.bride.color;
  ctx.fillStyle = gradient(ctx, 0, 0, W, [shade(c, -0.8), shade(c, -0.55), shade(c, -0.8)]);
  ctx.fillRect(0, 0, W, H);
  crowd(ctx, img.crowd.slice(0, 8), { x: 0, y: 230, w: W, h: 460 }, 9, 0.5);
  const vg = ctx.createRadialGradient(W / 2, 430, 100, W / 2, 430, 900);
  vg.addColorStop(0, "rgba(255,230,240,0.3)");
  vg.addColorStop(1, "rgba(20,5,15,0.7)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  const r = rng(d.seed + 5);
  const flowers = ["#ffffff", "#ffc1d9", shade(c, 0.2), "#ff8fb8", "#9fd89a"];
  for (let a = Math.PI; a <= Math.PI * 2 + 0.001; a += 0.035) {
    const cx = W / 2 + Math.cos(a) * 520;
    const cy = 620 + Math.sin(a) * 420;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(cx + (r() - 0.5) * 34, cy + (r() - 0.5) * 34, 8 + r() * 12, 0, Math.PI * 2);
      ctx.fillStyle = flowers[Math.floor(r() * flowers.length)]!;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  figure(ctx, img.bride, { x: W / 2 - 60, bottom: H - 40, maxW: 560, maxH: 560, align: "right" }, shade(c, 0.5));
  const ax = W / 2 + 200;
  const ay = 350;
  const ar = 110;
  avatar(ctx, img.papu, ax, ay, ar, gradient(ctx, ax - ar, 0, ar * 2, [c, "#ffffff", c]), shade(c, 0.5));
  // Anillos al lado del Papu.
  ctx.save();
  ctx.strokeStyle = "#FFD166";
  ctx.lineWidth = 7;
  ctx.shadowColor = "#FFD166";
  ctx.shadowBlur = 14;
  for (const dx of [-16, 16]) {
    ctx.beginPath();
    ctx.arc(ax + ar + 80 + dx, ay - 40, 26, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  petals(ctx, 160, d.seed + 23, ["#ffd1e3", "#ffffff", shade(c, 0.3), "#ffb3cf"]);
  const fy = H - 300;
  const band = ctx.createLinearGradient(0, fy, 0, H);
  band.addColorStop(0, "rgba(20,4,12,0)");
  band.addColorStop(0.3, "rgba(20,4,12,0.8)");
  band.addColorStop(1, "rgba(20,4,12,0.92)");
  ctx.fillStyle = band;
  ctx.fillRect(W / 2 - 40, fy, W / 2 + 40, 300);
  profile(ctx, d, 870, fy + 10, 680, false);
  title(ctx, "¡Felicidades a los novios!", W / 2, 110, 88, gradient(ctx, 300, 0, 1000, ["#FFD166", "#FFF6D5", "#FFD166"]), shade(c, -0.7));
  strokedText(ctx, `${d.bride.name} 💍 ${d.papu.name}  ·  ${d.role}`, W / 2, 168, { size: 32, fill: "#ffffff", stroke: shade(c, -0.75), align: "center", maxW: W - 120 });
}

/** 3. Foto de recuerdo: polaroid inclinada con la pareja y la fecha; titulo y perfil a la derecha. */
function photo(ctx: SKRSContext2D, d: BannerData, img: Loaded): void {
  const c = d.bride.color;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, shade(c, 0.88));
  bg.addColorStop(1, shade(c, 0.7));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const fw = 760;
  const fh = 620;
  ctx.save();
  ctx.translate(470, 420);
  ctx.rotate(-0.06);
  ctx.shadowColor = "rgba(40,10,30,0.4)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
  ctx.shadowColor = "transparent";
  ctx.save();
  ctx.beginPath();
  ctx.rect(-fw / 2 + 24, -fh / 2 + 24, fw - 48, fh - 130);
  ctx.clip();
  ctx.translate(-fw / 2 + 24, -fh / 2 + 24);
  const pw = fw - 48;
  const ph = fh - 130;
  ctx.fillStyle = gradient(ctx, 0, 0, pw, [shade(c, 0.1), shade(c, 0.6), shade(c, 0.1)]);
  ctx.fillRect(0, 0, pw, ph);
  crowd(ctx, img.crowd.slice(0, 6), { x: 0, y: 40, w: pw, h: 300 }, 6, 0.55);
  figure(ctx, img.bride, { x: 20, bottom: ph, maxW: 380, maxH: 470, align: "left" }, "#ffffff");
  ctx.restore();
  avatar(ctx, img.papu, 190, 10, 108, gradient(ctx, 80, 0, 220, [c, "#ffffff", c]), "#ffffff");
  ctx.textAlign = "center";
  // El pie se achica hasta caber (nombres largos) antes de recortarse.
  const caption = `${d.bride.name} & ${d.papu.name} · ${d.date}`;
  let size = 32;
  do ctx.font = `800 ${size}px ${FONT}`;
  while (ctx.measureText(caption).width > fw - 60 && --size > 22);
  ctx.fillStyle = shade(c, -0.65);
  ctx.fillText(fitText(ctx, caption, fw - 60), 0, fh / 2 - 40);
  ctx.restore();
  petals(ctx, 110, d.seed + 37, ["#ffb3cf", shade(c, 0.2), "#ffffff", "#ffd9ea"]);
  const ink = shade(c, -0.6);
  title(ctx, "¡Felicidades", 1225, 130, 84, ink, "#ffffff");
  title(ctx, "a los novios!", 1225, 218, 84, ink, "#ffffff");
  strokedText(ctx, d.role, 1225, 272, { size: 30, fill: ink, stroke: "#ffffff", align: "center", maxW: 620 });
  profile(ctx, d, 940, 320, 600, true);
}

export async function renderWeddingBanner(d: BannerData): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const [bride, papu, ...others] = await Promise.all([load(d.bride.figure), load(d.papu.avatar), ...d.crowd.map(load)]);
  const img: Loaded = { bride: bride ?? null, papu: papu ?? null, crowd: others.filter((x): x is Image => !!x) };
  const style = ((d.style % BANNER_STYLES) + BANNER_STYLES) % BANNER_STYLES;
  [altar, arch, photo][style]!(ctx, d, img);
  return canvas.toBuffer("image/png");
}
