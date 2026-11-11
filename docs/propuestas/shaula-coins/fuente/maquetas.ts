// Maquetas de la propuesta de Shaula-coins (docs/propuestas/shaula-coins/propuesta.html): tarjetas con objetos de
// cada rareza, la moneda, el sobre, un sobre abierto y la tienda de la semana. Es un prototipo para mostrar el
// aspecto; no lo usan los bots. Dibuja con el mismo motor que la tarjeta real (src/levels/card.ts).
// Uso: node --import tsx docs/propuestas/shaula-coins/fuente/maquetas.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { CARD_H, CARD_W, FONT, RAINBOW, fitText, gradient, renderCard, roundRect, sparkles } from "../../../../src/levels/card";
import { centerText, ficha } from "./monedas";

const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const out = path.resolve(here, "../imagenes");
const asset = (p: string) => path.join(root, "assets/bots", p);
fs.mkdirSync(path.join(out, "tarjetas"), { recursive: true });

export const RAREZAS = {
  comun: { nombre: "Común", color: "#C9CED6", oscuro: "#3B4250" },
  rara: { nombre: "Rara", color: "#39C5BB", oscuro: "#0C3D3A" },
  epica: { nombre: "Épica", color: "#B36BFF", oscuro: "#2E1250" },
  legendaria: { nombre: "Legendaria", color: "#FFC83D", oscuro: "#4A3200" },
  mitica: { nombre: "Mítica", color: "#FF5FA2", oscuro: "#3A0F27" },
} as const;
export type Rareza = keyof typeof RAREZAS;

/** Arcoíris que se desplaza en horizontal: t de 0 a 1 da una vuelta completa sin saltos. */
export function rainbowAt(ctx: SKRSContext2D, x: number, w: number, t: number, colors: readonly string[] = RAINBOW) {
  const s = t * w;
  const g = ctx.createLinearGradient(x - w + s, 0, x + w + s, 0);
  const stops = [...colors, ...colors, colors[0]!];
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

interface Tarjeta {
  rareza: Rareza;
  nombre: string;
  titulo: string;
  avatar: Image;
  fondo: Image | null;
  accent: string;
  insignias: string[];
}

export function cover(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
}

/** Tarjeta de nivel con borde, aro, efecto de nombre, barra e insignias de una rareza. t = fase de la animación. */
function drawTarjeta(ctx: SKRSContext2D, d: Tarjeta, t: number) {
  const r = d.rareza;
  ctx.save();
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 28);
  ctx.clip();
  if (d.fondo) cover(ctx, d.fondo, 0, 0, CARD_W, CARD_H);
  else {
    ctx.fillStyle = gradient(ctx, 0, 0, CARD_W, [d.accent, "#16131f"]);
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  const veil = ctx.createLinearGradient(0, 0, CARD_W, 0);
  veil.addColorStop(0, "rgba(10,8,18,0.84)");
  veil.addColorStop(0.65, "rgba(10,8,18,0.64)");
  veil.addColorStop(1, "rgba(10,8,18,0.34)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Destellos que titilan (épica en adelante).
  if (r === "legendaria" || r === "mitica") {
    let seed = 11;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 46; i++) {
      const cx = rnd() * CARD_W, cy = rnd() * CARD_H, ph = rnd();
      const a = 0.5 + 0.5 * Math.sin((t + ph) * Math.PI * 2);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = r === "mitica" ? RAINBOW[i % RAINBOW.length]! : "#FFE9A8";
      const s = 1.4 + rnd() * 2.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 2.2);
      ctx.quadraticCurveTo(cx, cy, cx + s * 2.2, cy);
      ctx.quadraticCurveTo(cx, cy, cx, cy + s * 2.2);
      ctx.quadraticCurveTo(cx, cy, cx - s * 2.2, cy);
      ctx.quadraticCurveTo(cx, cy, cx, cy - s * 2.2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Aro del avatar.
  const ax = 40, ay = 60, as = 210, acx = ax + as / 2, acy = ay + as / 2;
  ctx.save();
  if (r === "comun") ctx.fillStyle = "#C9CED6";
  else if (r === "rara") ctx.fillStyle = gradient(ctx, ax, ay, as, ["#39C5BB", "#B5F5A0", "#39C5BB"]);
  else if (r === "epica") {
    ctx.shadowColor = "#B36BFF";
    ctx.shadowBlur = 18 + 10 * Math.sin(t * Math.PI * 2);
    ctx.fillStyle = gradient(ctx, ax, ay, as, ["#E91E63", "#B36BFF", "#E91E63"]);
  } else if (r === "legendaria") {
    ctx.shadowColor = "#FFC83D";
    ctx.shadowBlur = 26;
    ctx.fillStyle = rainbowAt(ctx, ax - 10, as + 20, t, ["#B8860B", "#FFD166", "#FFF6D5", "#FFD166"]);
  } else {
    ctx.shadowColor = "#FF5FA2";
    ctx.shadowBlur = 30;
    ctx.fillStyle = rainbowAt(ctx, ax - 10, as + 20, t);
  }
  ctx.beginPath();
  ctx.arc(acx, acy, as / 2 + (r === "comun" ? 6 : 10), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Adornos del aro: notas que orbitan (legendaria y mítica).
  if (r === "legendaria" || r === "mitica") {
    ctx.font = `bold 30px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 3; i++) {
      const ang = (t + i / 3) * Math.PI * 2;
      ctx.fillStyle = r === "mitica" ? RAINBOW[(i * 2) % RAINBOW.length]! : "#FFF6D5";
      ctx.fillText(i === 1 ? "♫" : "♪", acx + Math.cos(ang) * (as / 2 + 24), acy + Math.sin(ang) * (as / 2 + 24));
    }
    ctx.textAlign = "left";
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(acx, acy, as / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(d.avatar, ax, ay, as, as);
  ctx.restore();

  // Nombre con su efecto.
  const x = 290, right = CARD_W - 40;
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 46px ${FONT}`;
  const name = fitText(ctx, d.nombre, right - x - 170);
  const nw = ctx.measureText(name).width;
  ctx.save();
  if (r === "comun") ctx.fillStyle = "#ffffff";
  else if (r === "rara") ctx.fillStyle = gradient(ctx, x, 0, nw, ["#39C5BB", "#E285B2"]);
  else if (r === "epica") {
    ctx.shadowColor = "#D59BFF";
    ctx.shadowBlur = 14 + 12 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
    ctx.fillStyle = "#F4E6FF";
  } else if (r === "legendaria") {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = rainbowAt(ctx, x, nw, t);
  } else {
    ctx.shadowColor = "#FF5FA2";
    ctx.shadowBlur = 16;
    ctx.fillStyle = rainbowAt(ctx, x, nw, t);
  }
  ctx.fillText(name, x, 98);
  ctx.restore();
  if (r === "mitica") {
    // Brillo que barre el nombre.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 50, nw, 60);
    ctx.clip();
    const sx = lerp(x - 120, x + nw + 120, t);
    const g = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = g;
    ctx.font = `bold 46px ${FONT}`;
    ctx.fillText(name, x, 98);
    ctx.restore();
  }

  // Insignias (hasta 3) junto al nombre.
  ctx.font = `30px ${FONT}`;
  ctx.textBaseline = "middle";
  d.insignias.slice(0, 3).forEach((e, i) => {
    const bx = right - 52 - i * 58, by = 52;
    roundRect(ctx, bx, by, 50, 50, 14);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fill();
    ctx.strokeStyle = RAREZAS[r].color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `30px ${FONT}`;
    centerText(ctx, e, bx + 25, by + 25);
  });

  // Insignia de nivel y título.
  roundRect(ctx, x, 120, 128, 48, 10);
  ctx.fillStyle = gradient(ctx, x, 120, 128, ["#B8860B", "#FFD166", "#FFF6D5", "#FFD166", "#B8860B"]);
  ctx.fill();
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillStyle = "#3A2600";
  centerText(ctx, "Nv 52", x + 64, 144);
  ctx.font = `600 24px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(fitText(ctx, "Álbum · #7 del servidor", right - x - 146), x + 146, 145);
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic 24px ${FONT}`;
  ctx.fillStyle = RAREZAS[r].color;
  ctx.fillText(`« ${d.titulo} »`, x, 204);

  // Barra de XP.
  const by = 254, bh = 28, bwid = right - x, frac = 0.64;
  roundRect(ctx, x, by, bwid, bh, bh / 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();
  const fw = bwid * frac;
  ctx.save();
  roundRect(ctx, x, by, fw, bh, bh / 2);
  ctx.clip();
  if (r === "comun") {
    ctx.fillStyle = d.accent;
    ctx.fillRect(x, by, fw, bh);
  } else if (r === "rara") {
    ctx.fillStyle = "#39C5BB";
    ctx.fillRect(x, by, fw, bh);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    const off = t * 40;
    for (let sx = x - 40 + off; sx < x + fw + 40; sx += 40) {
      ctx.beginPath();
      ctx.moveTo(sx, by + bh);
      ctx.lineTo(sx + 18, by + bh);
      ctx.lineTo(sx + 18 + bh, by);
      ctx.lineTo(sx + bh, by);
      ctx.fill();
    }
  } else if (r === "epica") {
    // Ecualizador: bloques que suben y bajan.
    ctx.fillStyle = "rgba(179,107,255,0.35)";
    ctx.fillRect(x, by, fw, bh);
    const n = Math.floor(fw / 14);
    for (let i = 0; i < n; i++) {
      const h = bh * (0.45 + 0.55 * Math.abs(Math.sin(i * 0.7 + t * Math.PI * 2)));
      ctx.fillStyle = gradient(ctx, x, 0, fw, ["#E91E63", "#B36BFF"]);
      ctx.fillRect(x + i * 14 + 2, by + bh - h, 10, h);
    }
  } else if (r === "legendaria") {
    ctx.fillStyle = gradient(ctx, x, 0, fw, ["#B8860B", "#FFD166", "#B8860B"]);
    ctx.fillRect(x, by, fw, bh);
    const sx = lerp(x - 80, x + fw + 80, t);
    const g = ctx.createLinearGradient(sx - 70, 0, sx + 70, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, by, fw, bh);
  } else {
    ctx.fillStyle = rainbowAt(ctx, x, fw / 2, t);
    ctx.fillRect(x, by, fw, bh);
    sparkles(ctx, x, by, fw, bh, 14);
  }
  ctx.restore();
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("1.677 / 2.619 XP para el nivel 53", x, by - 10);
  ctx.font = `20px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  const pre = "Cuota hoy: 9 de 14   ·   ";
  ctx.fillText(pre, x, by + bh + 28);
  const px = x + ctx.measureText(pre).width;
  ctx.save();
  ficha(ctx, px + 12, by + bh + 21, 12);
  ctx.restore();
  ctx.font = `20px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("340 Shaula-coins", px + 30, by + bh + 28);
  ctx.restore();

  // Borde de la tarjeta.
  ctx.save();
  const inset = 5;
  roundRect(ctx, inset, inset, CARD_W - inset * 2, CARD_H - inset * 2, 24);
  if (r === "comun") {
    ctx.strokeStyle = "#C9CED6";
    ctx.lineWidth = 4;
    ctx.stroke();
  } else if (r === "rara") {
    ctx.strokeStyle = "#39C5BB";
    ctx.lineWidth = 6;
    ctx.stroke();
    roundRect(ctx, 16, 16, CARD_W - 32, CARD_H - 32, 16);
    ctx.strokeStyle = "rgba(181,245,160,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (r === "epica") {
    ctx.shadowColor = "#B36BFF";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = gradient(ctx, 0, 0, CARD_W, ["#E91E63", "#B36BFF", "#E91E63"]);
    ctx.lineWidth = 8;
    ctx.stroke();
    // Taladros de Teto en las esquinas.
    for (const [cx, cy] of [[26, 26], [CARD_W - 26, 26], [26, CARD_H - 26], [CARD_W - 26, CARD_H - 26]] as const) {
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 5; a += 0.2) {
        const rr = 2 + a * 1.4;
        const px = cx + Math.cos(a + t * Math.PI * 2) * rr, py = cy + Math.sin(a + t * Math.PI * 2) * rr;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "#FF8AB8";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  } else if (r === "legendaria") {
    ctx.shadowColor = "#FFC83D";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#B8860B";
    ctx.lineWidth = 9;
    ctx.stroke();
    // Luces de escenario que corren por el borde.
    ctx.shadowBlur = 0;
    ctx.setLineDash([22, 34]);
    ctx.lineDashOffset = -t * 56 * 4;
    ctx.strokeStyle = "#FFF6D5";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.shadowColor = "#FF5FA2";
    ctx.shadowBlur = 26;
    ctx.strokeStyle = rainbowAt(ctx, 0, CARD_W, t);
    ctx.lineWidth = 10;
    ctx.stroke();
  }
  ctx.restore();

  // Sello de rareza.
  ctx.save();
  ctx.font = `bold 16px ${FONT}`;
  const label = RAREZAS[r].nombre.toUpperCase();
  const lw = ctx.measureText(label).width + 24;
  roundRect(ctx, CARD_W - lw - 34, CARD_H - 46, lw, 28, 14);
  ctx.fillStyle = r === "mitica" ? rainbowAt(ctx, CARD_W - lw - 34, lw, t) : RAREZAS[r].color;
  ctx.fill();
  ctx.fillStyle = r === "comun" || r === "legendaria" ? RAREZAS[r].oscuro : "#ffffff";
  centerText(ctx, label, CARD_W - 34 - lw / 2, CARD_H - 32);
  ctx.restore();
}

function encodeGif(w: number, h: number, frames: number, delay: number, draw: (ctx: SKRSContext2D, t: number) => void): Buffer {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const datas: Uint8ClampedArray[] = [];
  for (let i = 0; i < frames; i++) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#14111c";
    ctx.fillRect(0, 0, w, h);
    draw(ctx, i / frames);
    datas.push(ctx.getImageData(0, 0, w, h).data);
  }
  // Paleta común a todos los cuadros: muestra un píxel de cada 4 de varios cuadros.
  const pick = [0, Math.floor(frames / 3), Math.floor((2 * frames) / 3)];
  const sample = new Uint8ClampedArray((w * h * 4 * pick.length) / 4);
  let k = 0;
  for (const f of pick) {
    const d = datas[f]!;
    for (let p = 0; p < d.length; p += 16) {
      sample[k++] = d[p]!;
      sample[k++] = d[p + 1]!;
      sample[k++] = d[p + 2]!;
      sample[k++] = d[p + 3]!;
    }
  }
  const palette = quantize(sample.subarray(0, k), 256);
  const gif = GIFEncoder();
  datas.forEach((d, i) => gif.writeFrame(applyPalette(d, palette), w, h, { palette: i === 0 ? palette : undefined, delay, repeat: i === 0 ? 0 : undefined }));
  gif.finish();
  return Buffer.from(gif.bytes());
}

function save(rel: string, buf: Buffer) {
  fs.writeFileSync(path.join(out, rel), buf);
  console.log(`ok imagenes/${rel} (${Math.round(buf.length / 1024)} KB)`);
}

// ── Mini-vista de un objeto (para el sobre abierto y la tienda) ────────────────────────────────
export interface Objeto {
  nombre: string;
  tipo: "Borde" | "Fondo" | "Barra de XP" | "Efecto de nombre" | "Aro de avatar" | "Insignia" | "Título";
  rareza: Rareza;
  icono?: string;
  fondo?: Image;
  estado?: string;
  precio?: number;
}

export function drawObjetoArte(ctx: SKRSContext2D, o: Objeto, x: number, y: number, w: number, h: number) {
  const c = RAREZAS[o.rareza];
  ctx.save();
  roundRect(ctx, x, y, w, h, 14);
  ctx.clip();
  ctx.fillStyle = gradient(ctx, x, y, w, [c.oscuro, "#15121d"]);
  ctx.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2;
  if (o.tipo === "Fondo" && o.fondo) cover(ctx, o.fondo, x, y, w, h);
  else if (o.tipo === "Borde") {
    roundRect(ctx, x + w * 0.16, y + h * 0.28, w * 0.68, h * 0.44, 10);
    ctx.lineWidth = 7;
    ctx.strokeStyle = o.rareza === "mitica" ? rainbowAt(ctx, x, w, 0) : o.rareza === "epica" ? gradient(ctx, x, 0, w, ["#E91E63", "#B36BFF", "#E91E63"]) : c.color;
    ctx.shadowColor = c.color;
    ctx.shadowBlur = o.rareza === "comun" ? 0 : 14;
    ctx.stroke();
  } else if (o.tipo === "Barra de XP") {
    roundRect(ctx, x + w * 0.12, cy - 12, w * 0.76, 24, 12);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fill();
    roundRect(ctx, x + w * 0.12, cy - 12, w * 0.52, 24, 12);
    ctx.fillStyle = o.rareza === "legendaria" ? gradient(ctx, x, 0, w, ["#B8860B", "#FFF3C4", "#B8860B"]) : o.rareza === "mitica" ? rainbowAt(ctx, x, w, 0) : c.color;
    ctx.fill();
  } else if (o.tipo === "Efecto de nombre") {
    fitFont(ctx, "Papu", w * 0.8, Math.round(h * 0.3), 12);
    ctx.shadowColor = c.color;
    ctx.shadowBlur = o.rareza === "comun" ? 0 : 16;
    ctx.fillStyle = o.rareza === "legendaria" || o.rareza === "mitica" ? rainbowAt(ctx, x + w * 0.2, w * 0.6, 0) : c.color;
    centerText(ctx, "Papu", cx, cy);
  } else if (o.tipo === "Aro de avatar") {
    ctx.beginPath();
    ctx.arc(cx, cy, h * 0.28, 0, Math.PI * 2);
    ctx.lineWidth = 10;
    ctx.strokeStyle = o.rareza === "mitica" ? rainbowAt(ctx, x, w, 0) : c.color;
    ctx.shadowColor = c.color;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.font = `${Math.round(h * 0.26)}px ${FONT}`;
    ctx.shadowBlur = 0;
    centerText(ctx, "🙂", cx, cy);
  } else {
    const text = o.icono ?? "★";
    fitFont(ctx, text, w * 0.84, Math.round(h * (o.tipo === "Título" ? 0.16 : 0.42)), 10, "normal");
    ctx.fillStyle = c.color;
    centerText(ctx, text, cx, cy);
  }
  ctx.restore();
}

/** Pone en ctx.font el mayor tamaño (de `size` a `min`) con el que `text` cabe en `maxW`. Devuelve el tamaño. */
export function fitFont(ctx: SKRSContext2D, text: string, maxW: number, size: number, min: number, weight = "bold"): number {
  let s = size;
  for (; s > min; s--) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return s;
  }
  ctx.font = `${weight} ${min}px ${FONT}`;
  return min;
}

/** Corta `text` en líneas de hasta `maxW` con la fuente actual; si no cabe en `maxLines`, la última lleva «…». */
export function wrapLines(ctx: SKRSContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else lines.push(cur), (cur = word);
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.map((l) => fitText(ctx, l, maxW));
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fitText(ctx, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxW);
  return kept;
}

/** Píldora centrada en (cx, cy) con el texto centrado de verdad; la letra se achica si no cabe en maxW. */
function pillLabel(ctx: SKRSContext2D, text: string, cx: number, cy: number, o: { size: number; min: number; maxW: number; h: number; bg: string | ReturnType<typeof gradient>; fg: string }) {
  fitFont(ctx, text, o.maxW - o.h, o.size, o.min);
  const w = Math.min(o.maxW, ctx.measureText(text).width + o.h);
  roundRect(ctx, cx - w / 2, cy - o.h / 2, w, o.h, o.h / 2);
  ctx.fillStyle = o.bg;
  ctx.fill();
  ctx.fillStyle = o.fg;
  centerText(ctx, text, cx, cy);
}

export function drawCartaObjeto(ctx: SKRSContext2D, o: Objeto, x: number, y: number, w: number, h: number) {
  const c = RAREZAS[o.rareza];
  ctx.save();
  ctx.shadowColor = o.rareza === "comun" ? "rgba(0,0,0,0.4)" : c.color;
  ctx.shadowBlur = o.rareza === "comun" ? 12 : 30;
  roundRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = "#1d1928";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, 20);
  ctx.lineWidth = 5;
  ctx.strokeStyle = o.rareza === "mitica" ? rainbowAt(ctx, x, w, 0) : c.color;
  ctx.stroke();
  const pad = 16, inner = w - pad * 2, cx = x + w / 2;
  const artH = Math.round(h * 0.46);
  drawObjetoArte(ctx, o, x + pad, y + pad, inner, artH);

  // Píldora de abajo (estado o precio) y, entre el arte y ella, el texto centrado en vertical.
  const footH = o.estado || o.precio !== undefined ? 34 : 0;
  const footY = y + h - pad - footH / 2 - 4;
  const top = y + pad + artH + 10, bottom = footH ? footY - footH / 2 - 10 : y + h - pad;

  ctx.save();
  const chipH = 24, gap = 8;
  const typeSize = fitFont(ctx, o.tipo, inner, 15, 11, "600");
  let nameSize = 24, lines: string[] = [];
  for (; nameSize >= 16; nameSize--) {
    ctx.font = `bold ${nameSize}px ${FONT}`;
    lines = wrapLines(ctx, o.nombre, inner, 2);
    if (!lines.some((l) => l.endsWith("…"))) break;
  }
  nameSize = Math.max(nameSize, 16);
  const lineH = Math.round(nameSize * 1.18);
  const total = chipH + gap + typeSize + gap + lines.length * lineH;
  let cy = top + Math.max(0, (bottom - top - total) / 2);

  pillLabel(ctx, c.nombre.toUpperCase(), cx, cy + chipH / 2, { size: 14, min: 10, maxW: inner, h: chipH, bg: o.rareza === "mitica" ? rainbowAt(ctx, x, w, 0) : c.color, fg: o.rareza === "comun" || o.rareza === "legendaria" ? c.oscuro : "#ffffff" });
  cy += chipH + gap;
  ctx.font = `600 ${typeSize}px ${FONT}`;
  ctx.fillStyle = "rgba(230,224,240,0.75)";
  centerText(ctx, o.tipo, cx, cy + typeSize / 2);
  cy += typeSize + gap;
  ctx.font = `bold ${nameSize}px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  for (const l of lines) {
    centerText(ctx, l, cx, cy + lineH / 2);
    cy += lineH;
  }
  ctx.restore();

  if (o.estado) {
    const nuevo = o.estado === "¡NUEVO!";
    pillLabel(ctx, o.estado, cx, footY, { size: 17, min: 11, maxW: inner, h: footH, bg: nuevo ? "#3DDC84" : "rgba(255,255,255,0.14)", fg: nuevo ? "#06301A" : "#E6E0F0" });
  }
  if (o.precio !== undefined) {
    // Moneda y número como un solo grupo centrado en la píldora.
    const label = o.precio.toLocaleString("es-CL");
    fitFont(ctx, label, inner - 70, 22, 14);
    const coinR = 13, gapC = 8, tw = ctx.measureText(label).width;
    const group = coinR * 2 + gapC + tw, pw = Math.min(inner, group + 32);
    roundRect(ctx, cx - pw / 2, footY - footH / 2, pw, footH, footH / 2);
    ctx.fillStyle = "#2b2140";
    ctx.fill();
    const gx = cx - group / 2;
    ctx.save();
    ficha(ctx, gx + coinR, footY, coinR);
    ctx.restore();
    ctx.fillStyle = "#FFE9A8";
    centerText(ctx, label, gx + coinR * 2 + gapC + tw / 2, footY);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export function drawSobre(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, fig: Image) {
  ctx.save();
  ctx.shadowColor = "rgba(255,95,162,0.5)";
  ctx.shadowBlur = 40;
  ctx.beginPath();
  // Bordes dentados arriba y abajo, como un sobre de cartas.
  const teeth = 18, tw = w / teeth;
  ctx.moveTo(x, y + 14);
  for (let i = 0; i < teeth; i++) {
    ctx.lineTo(x + tw * (i + 0.5), y);
    ctx.lineTo(x + tw * (i + 1), y + 14);
  }
  ctx.lineTo(x + w, y + h - 14);
  for (let i = teeth; i > 0; i--) {
    ctx.lineTo(x + tw * (i - 0.5), y + h);
    ctx.lineTo(x + tw * (i - 1), y + h - 14);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "#39C5BB");
  g.addColorStop(0.45, "#B36BFF");
  g.addColorStop(1, "#FF5FA2");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y + 14, w, h - 28);
  ctx.clip();
  // Reflejo de lámina metálica.
  const sh = ctx.createLinearGradient(x, y, x + w, y + h);
  sh.addColorStop(0.25, "rgba(255,255,255,0)");
  sh.addColorStop(0.4, "rgba(255,255,255,0.35)");
  sh.addColorStop(0.55, "rgba(255,255,255,0)");
  ctx.fillStyle = sh;
  ctx.fillRect(x, y, w, h);
  sparkles(ctx, x, y, w, h, 30);
  const fh = h * 0.62, fw = (fig.width / fig.height) * fh;
  ctx.drawImage(fig, x + (w - fw) / 2, y + h - fh - 70, fw, fh);
  ctx.restore();
  // Franjas superior e inferior.
  ctx.fillStyle = "rgba(20,10,30,0.55)";
  ctx.fillRect(x, y + 40, w, 96);
  // Textos del sobre, centrados de verdad en sus franjas y sin salirse del ancho.
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, "SOBRE PAPU", w - 40, 46, 20, "900");
  centerText(ctx, "SOBRE PAPU", x + w / 2, y + 74);
  ctx.fillStyle = "#FFE9A8";
  fitFont(ctx, "3 a 5 objetos · Temporada 1", w - 40, 20, 12);
  centerText(ctx, "3 a 5 objetos · Temporada 1", x + w / 2, y + 114);
  ctx.fillStyle = "rgba(20,10,30,0.6)";
  ctx.fillRect(x, y + h - 74, w, 46);
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, "Se abre con Shaula-coins ganadas", w - 32, 22, 12);
  centerText(ctx, "Se abre con Shaula-coins ganadas", x + w / 2, y + h - 51);
  ctx.textAlign = "left";
}

async function main() {
  const img = async (p: string) => loadImage(fs.readFileSync(asset(p)));
  const [miku, teto, luka, neru, rin, banner] = await Promise.all([
    img("miku_avatar.png"), img("teto_avatar.png"), img("luka_avatar.png"), img("neru_avatar.png"), img("rin_avatar.png"), img("miku_banner.png"),
  ]);
  const bannerTeto = await img("teto_banner.png");
  const bannerLuka = await img("luka_banner.png");
  const bannerNeru = await img("neru_banner.png");
  const figTeto = await img("teto_figura.png");

  // Tarjeta de hoy (la real, sin objetos), para comparar.
  save("tarjetas/0-hoy.png", await renderCard({
    name: "Papu de ejemplo", avatar: fs.readFileSync(asset("miku_avatar.png")), level: 52, max: 99, prestige: 0, into: 1677, needed: 2619,
    tier: 4, rankName: "Álbum", position: 7, quota: { left: 9, limit: 14 }, frase: "La que empezó como broma", accent: "#39C5BB", background: null, multiplier: 1,
  }));

  const base = { nombre: "Papu de ejemplo", accent: "#39C5BB" };
  const tarjetas: { file: string; d: Tarjeta; anim: boolean }[] = [
    { file: "1-comun.png", anim: false, d: { ...base, rareza: "comun", titulo: "Recién llegado al karaoke", avatar: miku, fondo: null, insignias: ["🥬"] } },
    { file: "2-rara.gif", anim: true, d: { ...base, rareza: "rara", titulo: "Coleccionista de puerros", avatar: miku, fondo: banner, insignias: ["🥬", "🎤"] } },
    { file: "3-epica.gif", anim: true, d: { ...base, rareza: "epica", titulo: "Taladro oficial de Teto", avatar: teto, fondo: bannerTeto, insignias: ["🥖", "🎀", "🎤"] } },
    { file: "4-legendaria.gif", anim: true, d: { ...base, rareza: "legendaria", titulo: "Voz del Mirai", avatar: luka, fondo: bannerLuka, insignias: ["🐟", "👑", "🎶"] } },
    { file: "5-mitica.gif", anim: true, d: { ...base, rareza: "mitica", titulo: "Sobreviviente de Shaula", avatar: neru, fondo: bannerNeru, insignias: ["🪙", "🔨", "🌈"] } },
  ];
  for (const t of tarjetas) {
    if (!t.anim) {
      const c = createCanvas(CARD_W, CARD_H);
      drawTarjeta(c.getContext("2d"), t.d, 0);
      save(`tarjetas/${t.file}`, c.toBuffer("image/png"));
    } else save(`tarjetas/${t.file}`, encodeGif(CARD_W, CARD_H, 30, 50, (ctx, ph) => drawTarjeta(ctx, t.d, ph)));
  }

  // Moneda oficial (ficha arcade) grande y versión emoji (128 px, para subirla al servidor).
  for (const [file, size] of [["moneda/shaula-coin.png", 512], ["moneda/shaula-coin-emoji.png", 128]] as const) {
    fs.mkdirSync(path.join(out, "moneda"), { recursive: true });
    const c = createCanvas(size, size);
    ficha(c.getContext("2d"), size / 2, size / 2 - size * 0.02, size * 0.44);
    save(file, c.toBuffer("image/png"));
  }
  {
    const c = createCanvas(256, 256);
    save("moneda/shaula-coin-gira.gif", encodeGif(256, 256, 24, 50, (ctx, ph) => {
      ctx.clearRect(0, 0, 256, 256);
      ctx.fillStyle = "#14111c";
      ctx.fillRect(0, 0, 256, 256);
      ctx.save();
      ctx.translate(128, 124);
      ctx.scale(Math.max(0.06, Math.abs(Math.cos(ph * Math.PI * 2))), 1);
      ficha(ctx, 0, 0, 104);
      ctx.restore();
    }));
    void c;
  }

  // Sobre cerrado.
  fs.mkdirSync(path.join(out, "sobre"), { recursive: true });
  {
    const c = createCanvas(520, 760);
    const ctx = c.getContext("2d");
    drawSobre(ctx, 40, 30, 440, 700, figTeto);
    save("sobre/sobre-cerrado.png", c.toBuffer("image/png"));
  }

  // Sobre abierto: lo que publicaría Teto en el canal.
  {
    const W = 1500, H = 760;
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d");
    const bg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 900);
    bg.addColorStop(0, "#3a1d4f");
    bg.addColorStop(1, "#120d1a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    sparkles(ctx, 0, 0, W, H, 70);
    ctx.textAlign = "center";
    ctx.font = `900 46px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("¡Papu de ejemplo abrió un Sobre Papu!", W / 2, 76);
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = "#CFC4E3";
    ctx.fillText("4 objetos · faltan 6 sobres para una Épica segura", W / 2, 114);
    ctx.textAlign = "left";
    const objs: Objeto[] = [
      { nombre: "Cinta de casete", tipo: "Borde", rareza: "comun", estado: "REPETIDO · +5 Ecos" },
      { nombre: "Atardecer de Luka", tipo: "Fondo", rareza: "rara", fondo: bannerLuka, estado: "¡NUEVO!" },
      { nombre: "Ecualizador", tipo: "Barra de XP", rareza: "epica", estado: "¡NUEVO!" },
      { nombre: "Arcoíris en marcha", tipo: "Efecto de nombre", rareza: "legendaria", estado: "¡NUEVO!" },
    ];
    const cw = 300, ch = 520, gap = 40, x0 = (W - (cw * 4 + gap * 3)) / 2;
    objs.forEach((o, i) => drawCartaObjeto(ctx, o, x0 + i * (cw + gap), 170, cw, ch));
    save("sobre/sobre-abierto.png", c.toBuffer("image/png"));
  }

  // Tienda de la semana.
  fs.mkdirSync(path.join(out, "tienda"), { recursive: true });
  {
    const W = 1500, H = 900;
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d");
    ctx.fillStyle = gradient(ctx, 0, 0, W, ["#0f2a2a", "#1b1328", "#2a0f1f"]);
    ctx.fillRect(0, 0, W, H);
    sparkles(ctx, 0, 0, W, 140, 30);
    ficha(ctx, 92, 84, 44);
    ctx.font = `900 46px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Vitrina del lunes", 156, 80);
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = "#CFC4E3";
    ctx.fillText("Precio fijo, sin azar · 9 objetos · Vocaloid invitada: Kasane Teto", 158, 116);
    ctx.textAlign = "right";
    roundRect(ctx, W - 340, 52, 290, 56, 28);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fill();
    ctx.font = `bold 24px ${FONT}`;
    ctx.fillStyle = "#FFE9A8";
    centerText(ctx, "Cambia el jueves", W - 195, 80);
    ctx.textAlign = "left";
    const objs: Objeto[] = [
      { nombre: "Micrófono", tipo: "Insignia", rareza: "comun", icono: "🎤", precio: 60 },
      { nombre: "Baguette dorada", tipo: "Insignia", rareza: "comun", icono: "🥖", precio: 60 },
      { nombre: "Puerro trenzado", tipo: "Aro de avatar", rareza: "rara", precio: 150 },
      { nombre: "Ritmo de Teto", tipo: "Barra de XP", rareza: "rara", precio: 150 },
      { nombre: "Taladros de Teto", tipo: "Borde", rareza: "epica", precio: 350 },
      { nombre: "Luces del Mirai", tipo: "Borde", rareza: "legendaria", precio: 700 },
    ];
    const cw = 222, ch = 440, gap = 22, x0 = (W - (cw * 6 + gap * 5)) / 2;
    objs.forEach((o, i) => drawCartaObjeto(ctx, o, x0 + i * (cw + gap), 190, cw, ch));
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = "#CFC4E3";
    ctx.textAlign = "center";
    ctx.fillText("Se compra desde el menú del canal #tienda-shaula · Paga primero con tus Shaula-coins compradas y después con las ganadas", W / 2, 700);
    ctx.font = `bold 26px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Rincón de Teto (vitrina del lunes)", W / 2, 770);
    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = "#FFB3CF";
    ctx.fillText("Fondo «Teto saluda» · Rara · 150 · solo con monedas ganadas  —  ningún objeto se queda fuera de la temporada", W / 2, 810);
    ctx.textAlign = "left";
    save("tienda/tienda-semana.png", c.toBuffer("image/png"));
  }
  void rin;
  void teto;
}

// Solo dibuja al ejecutarlo directamente (tienda.ts importa sus piezas).
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
