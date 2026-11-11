// Opciones de diseño de la Shaula-coin para que GyroP elija (propuesta.html, sección «Elige la moneda»).
// Cada opción sale en 512 px, en 128 px (emoji del servidor) y girando (GIF), más una hoja que las compara.
// Uso: node --import tsx docs/propuestas/shaula-coins/fuente/monedas.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { FONT, gradient, roundRect } from "../../../../src/levels/card";

const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../imagenes/moneda/opciones");
fs.mkdirSync(out, { recursive: true });

type Draw = (ctx: SKRSContext2D, cx: number, cy: number, R: number) => void;

function disc(ctx: SKRSContext2D, cx: number, cy: number, r: number, fill: string | CanvasGradient | ReturnType<typeof gradient>) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill as string;
  ctx.fill();
}

function shadow(ctx: SKRSContext2D, R: number) {
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = R * 0.12;
  ctx.shadowOffsetY = R * 0.06;
}

/** Texto curvo sobre el canto (arriba, de izquierda a derecha). */
function arcText(ctx: SKRSContext2D, text: string, cx: number, cy: number, r: number, size: number, color: string, start = -Math.PI / 2) {
  ctx.save();
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) / r;
  let a = start - total / 2;
  chars.forEach((c, i) => {
    const w = widths[i]! / r;
    ctx.save();
    ctx.translate(cx + Math.cos(a + w / 2) * r, cy + Math.sin(a + w / 2) * r);
    ctx.rotate(a + w / 2 + Math.PI / 2);
    ctx.fillText(c, 0, 0);
    ctx.restore();
    a += w;
  });
  ctx.restore();
}

/** Centra el dibujo real de las letras (no la caja de la fuente) en (cx, cy). */
export function centerText(ctx: SKRSContext2D, text: string, cx: number, cy: number) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const x = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  const y = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.fillText(text, x, y);
}

function gloss(ctx: SKRSContext2D, cx: number, cy: number, R: number) {
  ctx.beginPath();
  ctx.ellipse(cx - R * 0.4, cy - R * 0.48, R * 0.24, R * 0.09, -0.7, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fill();
}

function hammer(ctx: SKRSContext2D, x: number, y: number, s: number, rot: number, fill: string, stroke?: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.roundRect(-s * 0.07, -s * 0.05, s * 0.14, s * 0.62, s * 0.05);
  ctx.roundRect(-s * 0.32, -s * 0.28, s * 0.64, s * 0.26, s * 0.06);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = s * 0.03;
    ctx.stroke();
  }
  ctx.restore();
}

function star(ctx: SKRSContext2D, x: number, y: number, r: number, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// A · Martillo de oro: moneda clásica con el martillo del baneo grabado y el nombre en el canto.
const martillo: Draw = (ctx, cx, cy, R) => {
  ctx.save();
  shadow(ctx, R);
  disc(ctx, cx, cy, R, gradient(ctx, cx - R, cy, R * 2, ["#9A6B00", "#FFD166", "#FFF3C4", "#FFD166", "#9A6B00"]));
  ctx.restore();
  disc(ctx, cx, cy, R * 0.74, gradient(ctx, cx - R, cy, R * 2, ["#C78F00", "#FFE08A", "#C78F00"]));
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.74, 0, Math.PI * 2);
  ctx.lineWidth = R * 0.03;
  ctx.strokeStyle = "#8A5E00";
  ctx.stroke();
  arcText(ctx, "SHAULA · COIN", cx, cy, R * 0.86, Math.round(R * 0.15), "#6B4700");
  arcText(ctx, "★ PAPUS ★", cx, cy, R * 0.86, Math.round(R * 0.13), "#6B4700", Math.PI / 2);
  hammer(ctx, cx + R * 0.03, cy + R * 0.06, R * 0.95, -Math.PI / 5, "#8A5E00");
  hammer(ctx, cx, cy + R * 0.03, R * 0.95, -Math.PI / 5, "#FFF3C4", "#8A5E00");
  gloss(ctx, cx, cy, R);
};

// B · Estrella del Escorpión: Shaula es la estrella del aguijón de Escorpio (λ Sco). Plata y azul noche.
const escorpion: Draw = (ctx, cx, cy, R) => {
  ctx.save();
  shadow(ctx, R);
  disc(ctx, cx, cy, R, gradient(ctx, cx - R, cy, R * 2, ["#7C8796", "#E9EEF3", "#FFFFFF", "#E9EEF3", "#7C8796"]));
  ctx.restore();
  const g = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R * 0.84);
  g.addColorStop(0, "#2E3A8C");
  g.addColorStop(1, "#0B0F2E");
  disc(ctx, cx, cy, R * 0.84, g);
  // Cola de Escorpio: estrellas unidas que terminan en el aguijón (Shaula).
  const pts = [[-0.5, -0.45], [-0.38, -0.2], [-0.32, 0.08], [-0.2, 0.32], [0.02, 0.44], [0.24, 0.38], [0.36, 0.2], [0.3, 0.02], [0.18, -0.06]].map(([x, y]) => [cx + x! * R, cy + y! * R] as const);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = "rgba(180,200,255,0.55)";
  ctx.lineWidth = R * 0.018;
  ctx.stroke();
  for (const [x, y] of pts.slice(0, -1)) disc(ctx, x, y, R * 0.028, "#DCE6FF");
  const [sx, sy] = pts[pts.length - 1]!;
  ctx.save();
  ctx.shadowColor = "#9FD3FF";
  ctx.shadowBlur = R * 0.25;
  star(ctx, sx, sy, R * 0.2, 4, 0.28);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.restore();
  // Polvo de estrellas.
  let seed = 3;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * R * 0.78;
    disc(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.006 + rnd() * 0.01), "rgba(255,255,255,0.7)");
  }
  ctx.font = `bold ${Math.round(R * 0.2)}px ${FONT}`;
  ctx.fillStyle = "#DCE6FF";
  ctx.textAlign = "center";
  ctx.fillText("SHAULA", cx, cy - R * 0.5);
  ctx.textAlign = "left";
  gloss(ctx, cx, cy, R);
};

// C · Nota Vocaloid: aguamarina de Miku con una corchea cuyo banderín es una S.
const nota: Draw = (ctx, cx, cy, R) => {
  ctx.save();
  shadow(ctx, R);
  disc(ctx, cx, cy, R, gradient(ctx, cx - R, cy, R * 2, ["#137F78", "#39C5BB", "#B5F5EE", "#39C5BB", "#137F78"]));
  ctx.restore();
  disc(ctx, cx, cy, R * 0.8, gradient(ctx, cx - R, cy, R * 2, ["#1FA69D", "#5FDCD2", "#1FA69D"]));
  // Pentagrama en el canto.
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = R * 0.012;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.82 + i * 0.035), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // Corchea.
  const hx = cx - R * 0.16, hy = cy + R * 0.32;
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.ellipse(hx, hy, R * 0.2, R * 0.14, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(hx + R * 0.15, cy - R * 0.5, R * 0.06, R * 0.82);
  ctx.lineWidth = R * 0.08;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hx + R * 0.18, cy - R * 0.48);
  ctx.bezierCurveTo(cx + R * 0.6, cy - R * 0.5, cx - R * 0.05, cy - R * 0.12, cx + R * 0.42, cy - R * 0.02);
  ctx.strokeStyle = "#FF5FA2";
  ctx.stroke();
  ctx.restore();
  gloss(ctx, cx, cy, R);
};

// D · Sello «BANEADA»: moneda de cobre con un timbre rojo cruzado, en broma.
const sello: Draw = (ctx, cx, cy, R) => {
  ctx.save();
  shadow(ctx, R);
  disc(ctx, cx, cy, R, gradient(ctx, cx - R, cy, R * 2, ["#7A3A12", "#D9824A", "#F6C49C", "#D9824A", "#7A3A12"]));
  ctx.restore();
  disc(ctx, cx, cy, R * 0.8, gradient(ctx, cx - R, cy, R * 2, ["#A4521F", "#E39A63", "#A4521F"]));
  ctx.font = `900 ${Math.round(R * 0.85)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(90,40,10,0.55)";
  ctx.fillText("S", cx + R * 0.02, cy + R * 0.04);
  ctx.fillStyle = "#F6C49C";
  ctx.fillText("S", cx, cy);
  ctx.save();
  ctx.translate(cx, cy + R * 0.05);
  ctx.rotate(-0.32);
  roundRect(ctx, -R * 0.66, -R * 0.17, R * 1.32, R * 0.34, R * 0.05);
  ctx.lineWidth = R * 0.05;
  ctx.strokeStyle = "#D7263D";
  ctx.stroke();
  ctx.fillStyle = "rgba(215,38,61,0.12)";
  ctx.fill();
  ctx.font = `900 ${Math.round(R * 0.22)}px ${FONT}`;
  ctx.fillStyle = "#D7263D";
  ctx.fillText("BANEADA", 0, R * 0.01);
  ctx.restore();
  ctx.textAlign = "left";
  gloss(ctx, cx, cy, R);
};

// E · Ficha arcade holográfica: octágono tornasol con «SC», como las fichas de las maquinitas. Elegida por GyroP
// (25 oct. 2026): es la Shaula-coin.
export const ficha: Draw =(ctx, cx, cy, R) => {
  const oct = (r: number) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  };
  ctx.save();
  shadow(ctx, R);
  oct(R);
  const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  ["#A8F0FF", "#F8B5FF", "#FFF3A8", "#B5FFD0", "#A8F0FF", "#C9B5FF"].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  // Muescas del canto.
  ctx.save();
  ctx.fillStyle = "rgba(60,40,110,0.35)";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86);
    ctx.rotate(a);
    ctx.fillRect(-R * 0.06, -R * 0.03, R * 0.12, R * 0.06);
    ctx.restore();
  }
  ctx.restore();
  disc(ctx, cx, cy, R * 0.66, "#2A1B4D");
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.66, 0, Math.PI * 2);
  ctx.lineWidth = R * 0.04;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();
  ctx.font = `900 ${Math.round(R * 0.52)}px ${FONT}`;
  ctx.textAlign = "center";
  const tg = ctx.createLinearGradient(cx - R * 0.4, 0, cx + R * 0.4, 0);
  ["#A8F0FF", "#F8B5FF", "#FFF3A8"].forEach((c, i) => tg.addColorStop(i / 2, c));
  ctx.fillStyle = tg;
  centerText(ctx, "SC", cx, cy);
  ctx.textAlign = "left";
  // Destellos en diagonal, simétricos respecto del centro.
  for (const [x, y] of [[-0.4, -0.38], [0.4, 0.38]]) {
    star(ctx, cx + x! * R, cy + y! * R, R * 0.07, 4, 0.3);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
  }
};

// F · Moneda de píxeles: estilo videojuego de 8 bits, nítida incluso a 22 px.
const PIX = [
  "....######....",
  "..##YYYYYY##..",
  ".#YYWWYYYYYY#.",
  ".#YWYYRRRRYY#.",
  "#YYYYRYYYYYYO#",
  "#YYYYRYYYYYYO#",
  "#YYYYYRRRYYYO#",
  "#YYYYYYYYRYYO#",
  "#YYYYYYYYRYYO#",
  "#YYYYRRRRYYYO#",
  ".#YYYYYYYYOO#.",
  ".#OYYYYYYOOO#.",
  "..##OOOOOO##..",
  "....######....",
];
const pixel: Draw = (ctx, cx, cy, R) => {
  const n = PIX.length, s = (R * 2) / n;
  const col: Record<string, string> = { "#": "#5A3A00", Y: "#FFD166", W: "#FFF6D5", O: "#D49A1A", R: "#E91E63" };
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  PIX.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === ".") return;
    ctx.fillStyle = col[ch]!;
    ctx.fillRect(Math.round(cx - R + x * s), Math.round(cy - R + y * s), Math.ceil(s), Math.ceil(s));
  }));
  ctx.restore();
};

export const OPCIONES: { id: string; nombre: string; draw: Draw }[] = [
  { id: "a-martillo", nombre: "Martillo de oro", draw: martillo },
  { id: "b-escorpion", nombre: "Estrella del Escorpión", draw: escorpion },
  { id: "c-nota", nombre: "Nota Vocaloid", draw: nota },
  { id: "d-sello", nombre: "Sello «Baneada»", draw: sello },
  { id: "e-ficha", nombre: "Ficha arcade", draw: ficha },
  { id: "f-pixel", nombre: "Moneda de píxeles", draw: pixel },
];

function gif(size: number, frames: number, draw: (ctx: SKRSContext2D, t: number) => void): Buffer {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  const datas: Uint8ClampedArray[] = [];
  for (let i = 0; i < frames; i++) {
    ctx.fillStyle = "#14111c";
    ctx.fillRect(0, 0, size, size);
    draw(ctx, i / frames);
    datas.push(ctx.getImageData(0, 0, size, size).data);
  }
  const all = new Uint8ClampedArray(datas.reduce((a, d) => a + d.length / 4, 0));
  let k = 0;
  for (const d of datas) for (let p = 0; p < d.length && k < all.length; p += 16) all.set(d.subarray(p, p + 4), k), (k += 4);
  const palette = quantize(all.subarray(0, k), 256);
  const enc = GIFEncoder();
  datas.forEach((d, i) => enc.writeFrame(applyPalette(d, palette), size, size, { palette: i === 0 ? palette : undefined, delay: 50, repeat: i === 0 ? 0 : undefined }));
  enc.finish();
  return Buffer.from(enc.bytes());
}

function save(name: string, buf: Buffer) {
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`ok imagenes/moneda/opciones/${name} (${Math.round(buf.length / 1024)} KB)`);
}

async function main() {
  const emojis: Buffer[] = [];
  for (const o of OPCIONES) {
    for (const [suf, size] of [["", 512], ["-emoji", 128]] as const) {
      const c = createCanvas(size, size);
      o.draw(c.getContext("2d"), size / 2, size / 2 - size * 0.02, size * 0.44);
      const buf = c.toBuffer("image/png");
      if (suf) emojis.push(buf);
      save(`${o.id}${suf}.png`, buf);
    }
    save(`${o.id}-gira.gif`, gif(256, 24, (ctx, t) => {
      ctx.save();
      ctx.translate(128, 124);
      ctx.scale(Math.max(0.06, Math.abs(Math.cos(t * Math.PI * 2))), 1);
      o.draw(ctx, 0, 0, 104);
      ctx.restore();
    }));
  }

  // Hoja comparativa: cada opción grande, como emoji y al tamaño real del chat de Discord.
  const W = 1500, H = 560, colW = W / OPCIONES.length;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#14111c";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  for (let i = 0; i < OPCIONES.length; i++) {
    const o = OPCIONES[i]!, x = colW * i + colW / 2;
    ctx.save();
    o.draw(ctx, x, 150, 100);
    ctx.restore();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillStyle = "#FFC83D";
    ctx.fillText(o.id[0]!.toUpperCase(), x, 300);
    ctx.font = `600 20px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(o.nombre, x, 332);
    const em = await loadImage(emojis[i]!);
    ctx.drawImage(em, x - 24, 370, 48, 48);
    // Así se ve en un mensaje: emoji de 22 px junto al texto.
    roundRect(ctx, x - 100, 448, 200, 64, 10);
    ctx.fillStyle = "#313338";
    ctx.fill();
    ctx.drawImage(em, x - 70, 469, 22, 22);
    ctx.font = `600 18px ${FONT}`;
    ctx.fillStyle = "#dbdee1";
    ctx.textAlign = "left";
    ctx.fillText("340 monedas", x - 42, 486);
    ctx.textAlign = "center";
  }
  ctx.font = `15px ${FONT}`;
  ctx.fillStyle = "#b9adcf";
  ctx.fillText("Fila de abajo: tamaño real de un emoji en el chat de Discord", W / 2, 545);
  save("comparacion.png", c.toBuffer("image/png"));
}

// Solo dibuja al ejecutarlo directamente (tienda.ts importa la ficha).
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
