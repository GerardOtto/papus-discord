// Dibujos del canal #🪙・tienda-shaula (propuesta.html, sección 6): banner, menú ilustrado, kawaiimojis para los
// botones, paquetes de monedas, miniaturas de objetos, monedero, boleta de transferencia, ayuda y el GIF de abrir un
// sobre. En el bot real, los que llevan datos del Papu (monedero, boleta) se dibujan al momento.
// Uso: node --import tsx docs/propuestas/shaula-coins/fuente/tienda.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { FONT, fitText, gradient, roundRect, sparkles } from "../../../../src/levels/card";
import { RAREZAS, drawCartaObjeto, drawObjetoArte, drawSobre, type Objeto } from "./maquetas";
import { centerText, ficha } from "./monedas";

const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const out = path.resolve(here, "../imagenes/canal-tienda");
for (const d of ["iconos", "menu", "paquetes", "objetos", "pantallas", "emojis-servidor"]) fs.mkdirSync(path.join(out, d), { recursive: true });

const INK = "#3B2346";
const BLUSH = "rgba(255,120,160,0.55)";
const PASTEL = { rosa: "#FFC6DD", menta: "#BFF3E8", lila: "#DCCBFF", crema: "#FFF1C2", cielo: "#C7E6FF", melon: "#FFD3B8" };

function save(rel: string, buf: Buffer) {
  fs.writeFileSync(path.join(out, rel), buf);
  console.log(`ok imagenes/canal-tienda/${rel} (${Math.round(buf.length / 1024)} KB)`);
}

/** Carita kawaii: ojos de punto con brillo, boca de gato y mejillas. s = ancho de la cara. */
function face(ctx: SKRSContext2D, cx: number, cy: number, s: number) {
  ctx.save();
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * s * 0.22, cy, s * 0.07, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + dx * s * 0.22 + s * 0.025, cy - s * 0.035, s * 0.025, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + dx * s * 0.36, cy + s * 0.12, s * 0.09, s * 0.05, 0, 0, Math.PI * 2);
    ctx.fillStyle = BLUSH;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.09, cy + s * 0.1);
  ctx.quadraticCurveTo(cx - s * 0.045, cy + s * 0.17, cx, cy + s * 0.1);
  ctx.quadraticCurveTo(cx + s * 0.045, cy + s * 0.17, cx + s * 0.09, cy + s * 0.1);
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.035;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

/** Rellena un camino con borde de sticker: contorno blanco grueso, relleno y línea de tinta. */
function sticker(ctx: SKRSContext2D, draw: () => void, fill: string | CanvasGradient | ReturnType<typeof gradient>, s: number) {
  ctx.save();
  draw();
  ctx.lineJoin = "round";
  ctx.lineWidth = s * 0.1;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = fill as string;
  ctx.fill();
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

type Icon = (ctx: SKRSContext2D, cx: number, cy: number, s: number) => void;

const ICONOS: Record<string, Icon> = {
  moneda: (ctx, cx, cy, s) => {
    ficha(ctx, cx, cy, s * 0.42);
  },
  tienda: (ctx, cx, cy, s) => {
    sticker(ctx, () => roundRect(ctx, cx - s * 0.36, cy - s * 0.12, s * 0.72, s * 0.5, s * 0.06), PASTEL.crema, s);
    // Toldo de rayas con ondas.
    const top = cy - s * 0.4, h = s * 0.3, n = 5, w = (s * 0.84) / n, x0 = cx - s * 0.42;
    for (let i = 0; i < n; i++) {
      sticker(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(x0 + i * w, top);
        ctx.lineTo(x0 + (i + 1) * w, top);
        ctx.lineTo(x0 + (i + 1) * w, top + h);
        ctx.arc(x0 + i * w + w / 2, top + h, w / 2, 0, Math.PI);
        ctx.closePath();
      }, i % 2 ? "#ffffff" : "#FF7FB0", s * 0.6);
    }
    face(ctx, cx, cy + s * 0.12, s * 0.5);
  },
  sobre: (ctx, cx, cy, s) => {
    const g = ctx.createLinearGradient(cx - s * 0.3, cy - s * 0.4, cx + s * 0.3, cy + s * 0.4);
    g.addColorStop(0, "#7FE3DB");
    g.addColorStop(0.5, "#C9A2FF");
    g.addColorStop(1, "#FF8AC0");
    sticker(ctx, () => {
      const x = cx - s * 0.3, y = cy - s * 0.42, w = s * 0.6, h = s * 0.84, t = 6, tw = w / t;
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.05);
      for (let i = 0; i < t; i++) ctx.lineTo(x + tw * (i + 0.5), y), ctx.lineTo(x + tw * (i + 1), y + s * 0.05);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    }, g, s);
    ctx.font = `bold ${Math.round(s * 0.22)}px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    centerText(ctx, "★", cx, cy - s * 0.2);
    face(ctx, cx, cy + s * 0.08, s * 0.45);
  },
  mochila: (ctx, cx, cy, s) => {
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.38, s * 0.12, Math.PI, 0);
      ctx.lineWidth = s * 0.05;
    }, "rgba(0,0,0,0)", s * 0.5);
    sticker(ctx, () => roundRect(ctx, cx - s * 0.32, cy - s * 0.36, s * 0.64, s * 0.76, s * 0.22), "#B5A2FF", s);
    sticker(ctx, () => roundRect(ctx, cx - s * 0.32, cy - s * 0.36, s * 0.64, s * 0.3, s * 0.2), "#9C85FF", s * 0.6);
    sticker(ctx, () => roundRect(ctx, cx - s * 0.2, cy + s * 0.14, s * 0.4, s * 0.2, s * 0.06), "#D9CFFF", s * 0.5);
    face(ctx, cx, cy - s * 0.04, s * 0.4);
  },
  tarjeta: (ctx, cx, cy, s) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.12);
    sticker(ctx, () => roundRect(ctx, -s * 0.42, -s * 0.28, s * 0.84, s * 0.56, s * 0.08), gradient(ctx, -s * 0.42, 0, s * 0.84, ["#7FE3DB", "#FFB3D1"]), s);
    ctx.beginPath();
    ctx.arc(-s * 0.22, -s * 0.04, s * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = s * 0.03;
    ctx.strokeStyle = INK;
    ctx.stroke();
    roundRect(ctx, -s * 0.02, -s * 0.12, s * 0.34, s * 0.06, s * 0.03);
    ctx.fillStyle = INK;
    ctx.fill();
    roundRect(ctx, -s * 0.02, s * 0.12, s * 0.36, s * 0.07, s * 0.035);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    roundRect(ctx, -s * 0.02, s * 0.12, s * 0.22, s * 0.07, s * 0.035);
    ctx.fillStyle = "#FFC83D";
    ctx.fill();
    ctx.restore();
    face(ctx, cx - s * 0.23, cy - s * 0.02, s * 0.2);
  },
  monedero: (ctx, cx, cy, s) => {
    ficha(ctx, cx + s * 0.16, cy - s * 0.26, s * 0.16);
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy - s * 0.1);
      ctx.lineTo(cx + s * 0.4, cy - s * 0.1);
      ctx.quadraticCurveTo(cx + s * 0.44, cy + s * 0.4, cx, cy + s * 0.4);
      ctx.quadraticCurveTo(cx - s * 0.44, cy + s * 0.4, cx - s * 0.4, cy - s * 0.1);
      ctx.closePath();
    }, "#FF9EC4", s);
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + dx * s * 0.06, cy - s * 0.13, s * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = "#FFC83D";
      ctx.fill();
      ctx.lineWidth = s * 0.03;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    face(ctx, cx, cy + s * 0.12, s * 0.45);
  },
  ayuda: (ctx, cx, cy, s) => {
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.ellipse(cx, cy - s * 0.05, s * 0.4, s * 0.32, 0, 0, Math.PI * 2);
      ctx.moveTo(cx - s * 0.18, cy + s * 0.22);
      ctx.lineTo(cx - s * 0.3, cy + s * 0.42);
      ctx.lineTo(cx, cy + s * 0.25);
    }, PASTEL.cielo, s);
    ctx.font = `900 ${Math.round(s * 0.4)}px ${FONT}`;
    ctx.fillStyle = "#4C7BFF";
    centerText(ctx, "?", cx, cy - s * 0.08);
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.24, cy + s * 0.02, s * 0.06, s * 0.035, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + s * 0.24, cy + s * 0.02, s * 0.06, s * 0.035, 0, 0, Math.PI * 2);
    ctx.fillStyle = BLUSH;
    ctx.fill();
  },
  banco: (ctx, cx, cy, s) => {
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.44, cy - s * 0.14);
      ctx.lineTo(cx, cy - s * 0.42);
      ctx.lineTo(cx + s * 0.44, cy - s * 0.14);
      ctx.closePath();
    }, "#FF8A8A", s);
    sticker(ctx, () => roundRect(ctx, cx - s * 0.38, cy - s * 0.12, s * 0.76, s * 0.5, s * 0.05), "#E9F1FF", s);
    // Estrella de Chile en el techo.
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.035 : s * 0.08, a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(cx + Math.cos(a) * r, cy - s * 0.24 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
    face(ctx, cx, cy + s * 0.1, s * 0.48);
  },
  mundo: (ctx, cx, cy, s) => {
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
    }, "#8FD3FF", s);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.38, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#7EE08A";
    for (const [x, y, rx, ry] of [[-0.22, -0.2, 0.16, 0.1], [0.24, 0.24, 0.18, 0.1], [-0.3, 0.26, 0.12, 0.08], [0.28, -0.26, 0.1, 0.06]]) {
      ctx.beginPath();
      ctx.ellipse(cx + x! * s, cy + y! * s, rx! * s, ry! * s, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    face(ctx, cx, cy + s * 0.02, s * 0.5);
  },
  volver: (ctx, cx, cy, s) => {
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy);
      ctx.lineTo(cx - s * 0.05, cy - s * 0.32);
      ctx.lineTo(cx - s * 0.05, cy - s * 0.14);
      ctx.lineTo(cx + s * 0.38, cy - s * 0.14);
      ctx.lineTo(cx + s * 0.38, cy + s * 0.14);
      ctx.lineTo(cx - s * 0.05, cy + s * 0.14);
      ctx.lineTo(cx - s * 0.05, cy + s * 0.32);
      ctx.closePath();
    }, PASTEL.menta, s);
    face(ctx, cx + s * 0.14, cy - s * 0.02, s * 0.32);
  },
  probar: (ctx, cx, cy, s) => {
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.ellipse(cx, cy - s * 0.06, s * 0.3, s * 0.36, 0, 0, Math.PI * 2);
    }, "#FFF6D5", s);
    sticker(ctx, () => roundRect(ctx, cx - s * 0.06, cy + s * 0.28, s * 0.12, s * 0.16, s * 0.04), "#FFC83D", s * 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy - s * 0.06, s * 0.24, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = gradient(ctx, cx - s * 0.24, 0, s * 0.48, ["#C7E6FF", "#FFE4F1"]);
    ctx.fill();
    ctx.restore();
    face(ctx, cx, cy - s * 0.06, s * 0.36);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(s * 0.18)}px ${FONT}`;
    centerText(ctx, "✦", cx + s * 0.32, cy - s * 0.36);
  },
  ok: (ctx, cx, cy, s) => {
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
    }, "#8EF0B4", s);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.18, cy);
    ctx.lineTo(cx - s * 0.04, cy + s * 0.15);
    ctx.lineTo(cx + s * 0.2, cy - s * 0.14);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = s * 0.09;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.lineWidth = s * 0.04;
    ctx.strokeStyle = INK;
    ctx.stroke();
  },
};

function iconPng(name: string, size: number): Buffer {
  const c = createCanvas(size, size);
  ICONOS[name]!(c.getContext("2d"), size / 2, size / 2, size * 0.86);
  return c.toBuffer("image/png");
}

function polka(ctx: SKRSContext2D, w: number, h: number, color: string, step = 46) {
  ctx.fillStyle = color;
  for (let y = 0, row = 0; y < h + step; y += step * 0.8, row++)
    for (let x = row % 2 ? step / 2 : 0; x < w + step; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
}

function bubbleText(ctx: SKRSContext2D, text: string, cx: number, cy: number, size: number, fill: string, stroke = "#ffffff", ink = INK) {
  ctx.save();
  ctx.font = `900 ${size}px ${FONT}`;
  // Centro real de las letras: misma cuenta que centerText, pero con contorno.
  const m = ctx.measureText(text);
  const tx = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  const ty = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.32;
  ctx.strokeStyle = ink;
  ctx.strokeText(text, tx, ty + size * 0.06);
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, tx, ty);
  ctx.fillStyle = fill;
  ctx.fillText(text, tx, ty);
  ctx.restore();
}

function pill(ctx: SKRSContext2D, text: string, cx: number, cy: number, size: number, bg: string, fg = INK) {
  ctx.save();
  ctx.font = `bold ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 1.4, h = size * 1.8;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = fg;
  centerText(ctx, text, cx, cy);
  ctx.restore();
}

function encodeGif(w: number, h: number, frames: number, delayOf: (i: number) => number, draw: (ctx: SKRSContext2D, i: number) => void): Buffer {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const datas: Uint8ClampedArray[] = [];
  for (let i = 0; i < frames; i++) {
    ctx.save();
    draw(ctx, i);
    ctx.restore();
    datas.push(ctx.getImageData(0, 0, w, h).data);
  }
  const step = Math.max(1, Math.floor(frames / 4));
  const parts: number[] = [];
  for (let f = 0; f < frames; f += step) {
    const d = datas[f]!;
    for (let p = 0; p < d.length; p += 32) parts.push(d[p]!, d[p + 1]!, d[p + 2]!, d[p + 3]!);
  }
  const palette = quantize(new Uint8ClampedArray(parts), 256);
  const gif = GIFEncoder();
  datas.forEach((d, i) => gif.writeFrame(applyPalette(d, palette), w, h, { palette: i === 0 ? palette : undefined, delay: delayOf(i), repeat: i === 0 ? -1 : undefined }));
  gif.finish();
  return Buffer.from(gif.bytes());
}

async function main() {
  const img = (p: string) => loadImage(fs.readFileSync(path.join(root, p)));
  const [figTeto, figMiku, bannerLuka, bannerNeru] = await Promise.all([
    img("assets/bots/teto_figura.png"), img("assets/bots/miku_figura.png"), img("assets/bots/luka_banner.png"), img("assets/bots/neru_banner.png"),
  ]);

  // Kawaiimojis para los botones (128 px, se suben como emojis del servidor) y una hoja con todos.
  const names = Object.keys(ICONOS);
  for (const n of names) save(`iconos/${n}.png`, iconPng(n, 128));
  {
    const cell = 170, W = cell * names.length, H = 210;
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(0, 0, W, H);
    names.forEach((n, i) => {
      ICONOS[n]!(ctx, cell * i + cell / 2, 86, 120);
      ctx.font = `600 18px ${FONT}`;
      ctx.fillStyle = "#dbdee1";
      centerText(ctx, `:${n}:`, cell * i + cell / 2, 180);
    });
    save("iconos/hoja.png", c.toBuffer("image/png"));
  }

  // Banner del mensaje fijado.
  {
    const W = 1200, H = 420;
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#FFC6DD");
    g.addColorStop(0.5, "#DCCBFF");
    g.addColorStop(1, "#BFF3E8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    polka(ctx, W, H, "rgba(255,255,255,0.45)");
    sparkles(ctx, 0, 0, W, H, 40);
    // Vocaloids a los lados.
    const fh = 400;
    ctx.drawImage(figTeto, -30, H - fh + 20, (figTeto.width / figTeto.height) * fh, fh);
    const mw = (figMiku.width / figMiku.height) * fh;
    ctx.drawImage(figMiku, W - mw + 30, H - fh + 20, mw, fh);
    // Monedas flotando.
    for (const [x, y, r] of [[300, 90, 34], [880, 300, 28], [940, 80, 22], [250, 320, 22]] as const) ficha(ctx, x, y, r);
    bubbleText(ctx, "Tienda Shaula", W / 2, 165, 96, "#FF5FA2");
    pill(ctx, "Monedas · Sobres · Objetos para tu tarjeta", W / 2, 268, 26, "#FFF6D5");
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillStyle = INK;
    centerText(ctx, "Toca un botón de abajo · solo tú ves lo que abres", W / 2, 336);
    save("menu/banner.png", c.toBuffer("image/png"));
  }

  // Menú ilustrado: 6 baldosas con el mismo dibujo que cada botón.
  const MENU = [
    ["moneda", "Comprar monedas", "PayPal o transferencia", PASTEL.crema],
    ["tienda", "Tienda de la semana", "Precio fijo, cambia el lunes", PASTEL.rosa],
    ["sobre", "Sobres", "3 a 5 objetos sorpresa", PASTEL.lila],
    ["mochila", "Mi colección", "Todo lo que tienes", PASTEL.cielo],
    ["tarjeta", "Mi tarjeta", "Prueba y equipa", PASTEL.menta],
    ["ayuda", "Ayuda", "Cómo funciona", PASTEL.melon],
  ] as const;
  {
    const W = 1200, H = 560, cols = 3, tw = 360, th = 236, gx = 30, gy = 28;
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFF7FB";
    ctx.fillRect(0, 0, W, H);
    polka(ctx, W, H, "rgba(255,180,210,0.35)", 52);
    const x0 = (W - (tw * cols + gx * 2)) / 2, y0 = (H - (th * 2 + gy)) / 2;
    MENU.forEach(([icon, label, sub, bg], i) => {
      const x = x0 + (i % cols) * (tw + gx), y = y0 + Math.floor(i / cols) * (th + gy);
      ctx.save();
      ctx.shadowColor = "rgba(59,35,70,0.25)";
      ctx.shadowOffsetY = 8;
      roundRect(ctx, x, y, tw, th, 32);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.restore();
      roundRect(ctx, x, y, tw, th, 32);
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ICONOS[icon]!(ctx, x + tw / 2, y + 86, 120);
      ctx.font = `900 30px ${FONT}`;
      ctx.fillStyle = INK;
      centerText(ctx, label, x + tw / 2, y + 172);
      ctx.font = `600 19px ${FONT}`;
      ctx.fillStyle = "rgba(59,35,70,0.7)";
      centerText(ctx, sub, x + tw / 2, y + 206);
    });
    save("menu/menu.png", c.toBuffer("image/png"));
  }

  // Paquetes de monedas. En pesos (transferencia en Chile) salen más baratos: GyroP no paga la comisión de PayPal y el
  // ahorro pasa al Papu (decisión de GyroP, 25 oct. 2026).
  const PAQ = [
    ["punado", "Puñado", 1200, "2 USD", "$1.500", 3, PASTEL.menta],
    ["bolsa", "Bolsa", 3100, "5 USD", "$4.000", 7, PASTEL.rosa],
    ["cofre", "Cofre", 6300, "10 USD", "$8.000", 10, PASTEL.lila],
    // Alcanza para todo el arte propio de la temporada (9.370 monedas; decisión de GyroP, 27 oct. 2026).
    ["tesoro", "Tesoro", 9500, "15 USD", "$12.000", 15, PASTEL.crema],
  ] as const;
  for (const [id, name, sc, usd, clp, n, bg] of PAQ) {
    const S = 420;
    const c = createCanvas(S, S);
    const ctx = c.getContext("2d");
    roundRect(ctx, 6, 6, S - 12, S - 12, 40);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.save();
    roundRect(ctx, 6, 6, S - 12, S - 12, 40);
    ctx.clip();
    polka(ctx, S, S, "rgba(255,255,255,0.55)", 40);
    sparkles(ctx, 0, 0, S, S, 18);
    ctx.restore();
    // Montón de fichas: de abajo hacia arriba, en pirámide.
    const r = 40;
    const rows: number[] = [];
    for (let left = n, w = Math.min(5, Math.ceil(Math.sqrt(n * 2))); left > 0; w--) rows.push(Math.min(w, left)), (left -= Math.min(w, left));
    rows.forEach((count, ri) => {
      for (let k = 0; k < count; k++) ficha(ctx, S / 2 + (k - (count - 1) / 2) * r * 1.5, 240 - ri * r * 1.05, r);
    });
    if (id === "cofre") {
      ctx.font = `64px ${FONT}`;
      centerText(ctx, "👑", S / 2, 240 - rows.length * r * 1.05 - 20);
    }
    bubbleText(ctx, name, S / 2, 56, 46, "#ffffff", "#FF5FA2");
    pill(ctx, `${sc.toLocaleString("es-CL")} monedas`, S / 2, 312, 24, "#FFF6D5");
    pill(ctx, `PayPal ${usd}`, S / 2 - 92, 368, 18, "#ffffff");
    pill(ctx, `Chile ${clp}`, S / 2 + 92, 368, 18, "#8EF0B4");
    save(`paquetes/${id}.png`, c.toBuffer("image/png"));
  }

  // Miniaturas de los objetos de la tienda (las muestra la tienda junto a cada uno).
  const OBJ: (Objeto & { id: string })[] = [
    { id: "papel-pautado", nombre: "Papel pautado", tipo: "Fondo", rareza: "comun", fondo: bannerNeru },
    { id: "baguette-dorada", nombre: "Baguette dorada", tipo: "Insignia", rareza: "comun", icono: "🥖" },
    { id: "puerro-trenzado", nombre: "Puerro trenzado", tipo: "Aro de avatar", rareza: "rara" },
    { id: "ritmo-de-teto", nombre: "Ritmo de Teto", tipo: "Barra de XP", rareza: "rara" },
    { id: "taladros-de-teto", nombre: "Taladros de Teto", tipo: "Borde", rareza: "epica" },
    { id: "luces-del-mirai", nombre: "Luces del Mirai", tipo: "Borde", rareza: "legendaria" },
    { id: "atardecer-de-luka", nombre: "Atardecer de Luka", tipo: "Fondo", rareza: "rara", fondo: bannerLuka },
    { id: "arcoiris-en-marcha", nombre: "Arcoíris en marcha", tipo: "Efecto de nombre", rareza: "legendaria" },
  ];
  for (const o of OBJ) {
    const S = 256;
    const c = createCanvas(S, S);
    const ctx = c.getContext("2d");
    const col = RAREZAS[o.rareza];
    roundRect(ctx, 4, 4, S - 8, S - 8, 30);
    ctx.fillStyle = col.color;
    ctx.fill();
    drawObjetoArte(ctx, o, 16, 16, S - 32, S - 32);
    roundRect(ctx, 4, 4, S - 8, S - 8, 30);
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // Gema de rareza en la esquina.
    ctx.save();
    ctx.translate(S - 34, 34);
    ctx.rotate(Math.PI / 4);
    roundRect(ctx, -16, -16, 32, 32, 6);
    ctx.fillStyle = col.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();
    save(`objetos/${o.id}.png`, c.toBuffer("image/png"));
  }

  // Monedero (se dibuja al momento con los datos del Papu).
  {
    const W = 1000, H = 360;
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d");
    roundRect(ctx, 6, 6, W - 12, H - 12, 36);
    ctx.fillStyle = "#FFF7FB";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ICONOS.monedero!(ctx, 86, 82, 110);
    ctx.font = `900 40px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText("Monedero de Papu de ejemplo", 160, 96);
    const pockets = [["Ganadas", "300", "sobres y tienda", PASTEL.menta], ["Compradas", "600", "solo tienda", PASTEL.crema], ["Ecos", "20", "para fabricar", PASTEL.lila]] as const;
    pockets.forEach(([l, v, sub, bg], i) => {
      const x = 40 + i * 315, y = 140;
      roundRect(ctx, x, y, 290, 120, 24);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      if (i < 2) ficha(ctx, x + 50, y + 62, 30);
      else ICONOS.sobre!(ctx, x + 50, y + 62, 64);
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = "rgba(59,35,70,0.75)";
      ctx.fillText(l, x + 96, y + 40);
      ctx.font = `900 44px ${FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(v, x + 96, y + 86);
      ctx.font = `600 17px ${FONT}`;
      ctx.fillStyle = "rgba(59,35,70,0.6)";
      ctx.fillText(sub, x + 96, y + 108);
    });
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText("Garantía Épica: 6 de 10 sobres", 40, 304);
    for (let i = 0; i < 10; i++) {
      roundRect(ctx, 380 + i * 56, 284, 46, 28, 8);
      ctx.fillStyle = i < 6 ? "#B36BFF" : "#EDE3FA";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    save("pantallas/monedero.png", c.toBuffer("image/png"));
  }

  // Boleta de transferencia (Chile). Datos de la cuenta de ejemplo: los reales van en .env y nunca en el repo.
  {
    const W = 760, H = 640;
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(30, 20);
    ctx.lineTo(W - 30, 20);
    ctx.lineTo(W - 30, H - 40);
    for (let x = W - 30, i = 0; x > 30; x -= 30, i++) ctx.lineTo(x - 15, H - 40 + (i % 2 ? 0 : 18)), ctx.lineTo(x - 30, H - 40);
    ctx.closePath();
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#FFFDF6";
    ctx.fill();
    ctx.restore();
    ICONOS.banco!(ctx, 96, 92, 100);
    ctx.font = `900 36px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText("Transferencia en Chile", 160, 86);
    ctx.font = `600 20px ${FONT}`;
    ctx.fillStyle = "rgba(59,35,70,0.65)";
    ctx.fillText("Pedido de Papu de ejemplo · Bolsa (3.100 monedas)", 160, 118);
    const rows = [["Monto", "$4.000 CLP"], ["Banco", "Banco de ejemplo"], ["Tipo de cuenta", "Cuenta vista"], ["N.º de cuenta", "•••• •••• 1234"], ["RUT", "••.•••.•••-•"], ["Correo", "gyrop@ejemplo.cl"]];
    rows.forEach(([k, v], i) => {
      const y = 180 + i * 46;
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = "rgba(59,35,70,0.6)";
      ctx.fillText(k, 60, y);
      ctx.font = `bold 24px ${FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(v, 300, y);
      ctx.strokeStyle = "rgba(59,35,70,0.15)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(60, y + 16);
      ctx.lineTo(W - 60, y + 16);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    roundRect(ctx, 60, 468, W - 120, 90, 20);
    ctx.fillStyle = PASTEL.crema;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.font = `600 20px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText("Escribe esto en el comentario:", 84, 504);
    ctx.font = `900 40px ${FONT}`;
    ctx.fillStyle = "#E91E63";
    ctx.fillText("SC-7KQ2", 84, 544);
    // Timbre de pendiente.
    ctx.save();
    ctx.translate(W - 170, 520);
    ctx.rotate(-0.2);
    roundRect(ctx, -100, -30, 200, 60, 10);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(76,123,255,0.8)";
    ctx.stroke();
    ctx.font = `900 28px ${FONT}`;
    ctx.fillStyle = "rgba(76,123,255,0.8)";
    centerText(ctx, "PENDIENTE", 0, 0);
    ctx.restore();
    save("pantallas/boleta-transferencia.png", c.toBuffer("image/png"));
  }

  // Ayuda: tres pasos con dibujos.
  {
    const W = 1200, H = 380;
    const c = createCanvas(W, H);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFF7FB";
    ctx.fillRect(0, 0, W, H);
    polka(ctx, W, H, "rgba(255,180,210,0.3)", 52);
    const steps = [["mundo", "1. Participa", "Chatea, entra a voz y cumple misiones: ganas monedas"], ["sobre", "2. Abre o compra", "Sobres con las ganadas, tienda con cualquiera"], ["tarjeta", "3. Luce tu tarjeta", "Equipa bordes, fondos, barras y efectos"]] as const;
    steps.forEach(([icon, t, d], i) => {
      const cx = 200 + i * 400;
      ctx.beginPath();
      ctx.arc(cx, 130, 92, 0, Math.PI * 2);
      ctx.fillStyle = [PASTEL.cielo, PASTEL.lila, PASTEL.menta][i]!;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ICONOS[icon]!(ctx, cx, 130, 130);
      ctx.font = `900 32px ${FONT}`;
      ctx.fillStyle = INK;
      centerText(ctx, t, cx, 268);
      ctx.font = `600 19px ${FONT}`;
      ctx.fillStyle = "rgba(59,35,70,0.75)";
      centerText(ctx, fitText(ctx, d, 360), cx, 306);
      if (i < 2) {
        ctx.font = `900 54px ${FONT}`;
        ctx.fillStyle = "#FF5FA2";
        centerText(ctx, "→", cx + 200, 130);
      }
    });
    ctx.font = `600 18px ${FONT}`;
    ctx.fillStyle = "rgba(59,35,70,0.6)";
    centerText(ctx, "Nada de esto da XP, cuota ni mensajes extra con los Vocaloids", W / 2, 352);
    save("pantallas/ayuda.png", c.toBuffer("image/png"));
  }

  // Abrir un sobre: el sobre tiembla, destello y aparecen los objetos uno por uno (se reproduce una vez).
  {
    const W = 1000, H = 520;
    const objs: Objeto[] = [
      { nombre: "Cinta de casete", tipo: "Borde", rareza: "comun", estado: "REPETIDO · +5 Ecos" },
      { nombre: "Atardecer de Luka", tipo: "Fondo", rareza: "rara", fondo: bannerLuka, estado: "¡NUEVO!" },
      { nombre: "Ecualizador", tipo: "Barra de XP", rareza: "epica", estado: "¡NUEVO!" },
      { nombre: "Arcoíris en marcha", tipo: "Efecto de nombre", rareza: "legendaria", estado: "¡NUEVO!" },
    ];
    const SHAKE = 12, FLASH = 4, PER = 6, frames = SHAKE + FLASH + objs.length * PER + 1;
    const bg = (ctx: SKRSContext2D) => {
      const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 640);
      g.addColorStop(0, "#3a1d4f");
      g.addColorStop(1, "#120d1a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      sparkles(ctx, 0, 0, W, H, 50);
    };
    save("pantallas/abrir-sobre.gif", encodeGif(W, H, frames, (i) => (i === frames - 1 ? 4000 : i < SHAKE ? 60 : 70), (ctx, i) => {
      bg(ctx);
      if (i < SHAKE + FLASH / 2) {
        const amp = i < SHAKE ? 3 + i * 1.2 : 0;
        ctx.translate(W / 2 + Math.sin(i * 2.4) * amp, H / 2);
        ctx.rotate(Math.sin(i * 1.7) * amp * 0.004);
        ctx.scale(0.62, 0.62);
        drawSobre(ctx, -220, -350, 440, 700, figTeto);
      }
      if (i >= SHAKE && i < SHAKE + FLASH) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(255,255,255,${1 - (i - SHAKE) / FLASH})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (i >= SHAKE + FLASH / 2) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const cw = 210, ch = 380, gap = 26, x0 = (W - (cw * 4 + gap * 3)) / 2;
        const k = i - SHAKE - FLASH / 2;
        objs.forEach((o, j) => {
          const local = (k - j * PER) / PER;
          if (local < 0) return;
          const p = Math.min(1, local);
          const ease = 1 - (1 - p) ** 3;
          ctx.save();
          ctx.globalAlpha = Math.min(1, p * 1.5);
          ctx.translate(0, (1 - ease) * 60);
          drawCartaObjeto(ctx, o, x0 + j * (cw + gap), 90, cw, ch);
          ctx.restore();
        });
        ctx.font = `900 34px ${FONT}`;
        ctx.fillStyle = "#ffffff";
        centerText(ctx, "¡Sobre abierto!", W / 2, 50);
      }
    }));
  }

  // Emojis del servidor que usa el canal (copias, para que la propuesta funcione sola).
  for (const f of ["teto_feliz.gif", "miku_porrista.gif", "gato_pulgar.png", "luka_hola.png", "neru_jeje.png", "teto_hola.png"]) {
    fs.copyFileSync(path.join(root, "assets/emojis/gratis", f), path.join(out, "emojis-servidor", f));
    console.log(`ok imagenes/canal-tienda/emojis-servidor/${f}`);
  }
}

await main();
