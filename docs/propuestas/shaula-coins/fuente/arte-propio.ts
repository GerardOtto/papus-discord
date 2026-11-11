// Objetos de arte propio de las Shaula-coins (propuesta.html, sección 4c): los únicos que se compran con monedas de
// pago, porque no usan renders ni imágenes ajenas (pedido de GyroP, 26 oct. 2026). Todo se dibuja con código: bordes,
// barras de XP, efectos de nombre, aros, insignias, títulos y fondos, más un fondo animado. Por cada objeto sale su
// miniatura de la tienda y la tarjeta de nivel con el objeto puesto (GIF si es animado), y el catálogo en
// arte-propio.json.
// Uso: node --import tsx docs/propuestas/shaula-coins/fuente/arte-propio.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { CARD_H, CARD_W, FONT, fitText, gradient, roundRect, sparkles } from "../../../../src/levels/card";
import { RAREZAS, fitFont, rainbowAt, wrapLines, type Rareza } from "./maquetas";
import { centerText, ficha } from "./monedas";

const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const out = path.resolve(here, "../imagenes/arte-propio");
for (const d of ["miniaturas", "tarjetas"]) fs.mkdirSync(path.join(out, d), { recursive: true });

type Slot = "borde" | "barra" | "nombre" | "aro" | "insignia" | "titulo" | "fondo";
const SLOT_NOMBRE: Record<Slot, string> = { borde: "Borde", barra: "Barra de XP", nombre: "Efecto de nombre", aro: "Aro de avatar", insignia: "Insignia", titulo: "Título", fondo: "Fondo" };
const PRECIO: Record<Exclude<Rareza, "mitica">, number> = { comun: 60, rara: 150, epica: 350, legendaria: 700 };

const TAU = Math.PI * 2;
const W = CARD_W, H = CARD_H;
// Geometría de la tarjeta (la misma de src/levels/card.ts).
const AX = 40, AY = 60, AS = 210, ACX = AX + AS / 2, ACY = AY + AS / 2;
const TX = 290, RIGHT = W - 40;
const BY = 254, BH = 28, BW = RIGHT - TX, FRAC = 0.64;

// ── Dibujos de cada tipo ─────────────────────────────────────────────────────────────────────
/** t = fase de la animación (0 a 1); los estáticos la ignoran. */
type Paint = (ctx: SKRSContext2D, t: number) => void;
/** Relleno de la barra: dibuja dentro del recorte de la parte llena (x, y, w, h). */
type BarPaint = (ctx: SKRSContext2D, t: number, x: number, y: number, w: number, h: number) => void;
/** Relleno del nombre: devuelve el estilo para fillText (y puede poner sombras). */
type NamePaint = (ctx: SKRSContext2D, t: number, x: number, w: number) => void;

function cardPath(ctx: SKRSContext2D, inset = 5, r = 24) {
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, r);
}

function heart(ctx: SKRSContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s, y - s * 0.4, x, y + s * 0.35);
  ctx.fill();
}

/** Brillo que barre de izquierda a derecha (para lo metálico). */
function sweep(ctx: SKRSContext2D, t: number, x: number, w: number, y: number, h: number, alpha = 0.85, band = 70) {
  const sx = x - band * 2 + (w + band * 4) * t;
  const g = ctx.createLinearGradient(sx - band, 0, sx + band, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

const BORDES: Record<string, Paint> = {
  "cinta-de-casete": (ctx) => {
    cardPath(ctx, 6);
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#5A3E2B";
    ctx.stroke();
    cardPath(ctx, 6);
    ctx.setLineDash([26, 14]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#E8D5B5";
    ctx.stroke();
    ctx.setLineDash([]);
    for (const x of [W / 2 - 60, W / 2 + 60]) {
      ctx.beginPath();
      ctx.arc(x, H - 6, 14, 0, TAU);
      ctx.fillStyle = "#5A3E2B";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, H - 6, 6, 0, TAU);
      ctx.fillStyle = "#E8D5B5";
      ctx.fill();
    }
  },
  pentagrama: (ctx) => {
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      for (const y of [8 + i * 4, H - 8 - i * 4]) {
        ctx.beginPath();
        ctx.moveTo(28, y);
        ctx.lineTo(W - 28, y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 34px ${FONT}`;
    centerText(ctx, "𝄞", 18, 18);
    centerText(ctx, "♫", W - 18, H - 18);
  },
  "hoja-de-cuaderno": (ctx) => {
    cardPath(ctx, 5);
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#F7F4EA";
    ctx.stroke();
    cardPath(ctx, 14, 16);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(100,150,230,0.85)";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(26, 14);
    ctx.lineTo(26, H - 14);
    ctx.strokeStyle = "rgba(230,80,90,0.9)";
    ctx.stroke();
    for (let x = 70; x < W - 40; x += 60) {
      ctx.beginPath();
      ctx.arc(x, 5, 5, 0, TAU);
      ctx.fillStyle = "#14111c";
      ctx.fill();
    }
  },
  "neon-de-akihabara": (ctx) => {
    for (const [inset, color] of [[6, "#FF4FD8"], [16, "#36E0F0"]] as const) {
      ctx.save();
      cardPath(ctx, inset, 24 - (inset - 6));
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();
    }
  },
  "cables-de-microfono": (ctx) => {
    // Cable ondulado que da la vuelta a la tarjeta, con un conector en la esquina.
    const pts: [number, number][] = [];
    const per = 2 * (W + H - 40), step = 6;
    for (let d = 0; d < per; d += step) {
      let x: number, y: number, nx: number, ny: number;
      const top = W - 20, side = H - 20;
      if (d < top) (x = 10 + d), (y = 10), (nx = 0), (ny = 1);
      else if (d < top + side) (x = W - 10), (y = 10 + d - top), (nx = -1), (ny = 0);
      else if (d < 2 * top + side) (x = W - 10 - (d - top - side)), (y = H - 10), (nx = 0), (ny = -1);
      else (x = 10), (y = H - 10 - (d - 2 * top - side)), (nx = 1), (ny = 0);
      const wv = Math.sin(d / 22) * 4;
      pts.push([x + nx * wv, y + ny * wv]);
    }
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#6E7390";
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.stroke();
    // Conector XLR en la esquina: cuerpo plateado y punta dorada.
    roundRect(ctx, W - 70, H - 26, 44, 18, 6);
    ctx.fillStyle = gradient(ctx, W - 70, 0, 44, ["#8A8FA8", "#E9EEF3", "#8A8FA8"]);
    ctx.fill();
    roundRect(ctx, W - 28, H - 22, 14, 10, 3);
    ctx.fillStyle = "#FFD166";
    ctx.fill();
  },
  "taladros-de-teto": (ctx, t) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.shadowColor = "#FF5FA2";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 8;
    ctx.strokeStyle = gradient(ctx, 0, 0, W, ["#E0457B", "#FF8AB8", "#E0457B"]);
    ctx.stroke();
    ctx.restore();
    for (const [cx, cy] of [[28, 28], [W - 28, 28], [28, H - 28], [W - 28, H - 28]] as const) {
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 5; a += 0.2) {
        const rr = 2 + a * 1.4;
        const px = cx + Math.cos(a + t * TAU) * rr, py = cy + Math.sin(a + t * TAU) * rr;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#FFB3CF";
      ctx.stroke();
    }
  },
  "atun-plateado": (ctx, t) => {
    ctx.save();
    cardPath(ctx, 6);
    ctx.lineWidth = 11;
    ctx.strokeStyle = gradient(ctx, 0, 0, W, ["#7C8796", "#E9EEF3", "#AEB8C4", "#FFFFFF", "#7C8796"]);
    ctx.stroke();
    // Escamas: arcos pequeños sobre el borde.
    ctx.clip();
    ctx.strokeStyle = "rgba(70,80,100,0.45)";
    ctx.lineWidth = 1.2;
    for (let x = 0; x < W; x += 12) for (const y of [6, H - 6]) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    cardPath(ctx, 6);
    ctx.lineWidth = 11;
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = (() => {
      const sx = -200 + (W + 400) * t;
      const g = ctx.createLinearGradient(sx - 90, 0, sx + 90, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.95)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      return g;
    })();
    ctx.stroke();
    ctx.restore();
  },
  "luces-del-mirai": (ctx, t) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.shadowColor = "#FFC83D";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#B8860B";
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([22, 34]);
    ctx.lineDashOffset = -t * 56 * 4;
    ctx.strokeStyle = "#FFF6D5";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();
  },
};

const BARRAS: Record<string, BarPaint> = {
  "lisa-de-color": (ctx, _t, x, y, w, h) => {
    ctx.fillStyle = "#E0457B";
    ctx.fillRect(x, y, w, h);
  },
  punteada: (ctx, _t, x, y, w, h) => {
    ctx.fillStyle = "rgba(57,197,187,0.35)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#39C5BB";
    for (let px = x + 10; px < x + w; px += 16) {
      ctx.beginPath();
      ctx.arc(px, y + h / 2, 6, 0, TAU);
      ctx.fill();
    }
  },
  "ritmo-de-teto": (ctx, t, x, y, w, h) => {
    ctx.fillStyle = "#E0457B";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    for (let sx = x - 40 + t * 40; sx < x + w + 40; sx += 40) {
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + 18, y + h);
      ctx.lineTo(sx + 18 + h, y);
      ctx.lineTo(sx + h, y);
      ctx.fill();
    }
  },
  ecualizador: (ctx, t, x, y, w, h) => {
    ctx.fillStyle = "rgba(179,107,255,0.3)";
    ctx.fillRect(x, y, w, h);
    const n = Math.floor(w / 14);
    for (let i = 0; i < n; i++) {
      const bh = h * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.7 + t * TAU)));
      ctx.fillStyle = gradient(ctx, x, 0, w, ["#E91E63", "#B36BFF"]);
      ctx.fillRect(x + i * 14 + 2, y + h - bh, 10, bh);
    }
  },
  "onda-de-voz": (ctx, t, x, y, w, h) => {
    ctx.fillStyle = "#0E3B39";
    ctx.fillRect(x, y, w, h);
    for (const [amp, col, ph] of [[0.42, "#39C5BB", 0], [0.28, "#B5F5EE", 1.3]] as const) {
      ctx.beginPath();
      for (let px = 0; px <= w; px += 3) {
        const yy = y + h / 2 + Math.sin(px / 18 + t * TAU + ph) * h * amp * Math.sin((px / w) * Math.PI);
        if (px === 0) ctx.moveTo(x + px, yy);
        else ctx.lineTo(x + px, yy);
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = col;
      ctx.stroke();
    }
  },
  "oro-liquido": (ctx, t, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, x, 0, w, ["#8A6200", "#FFD166", "#B8860B", "#FFE08A"]);
    ctx.fillRect(x, y, w, h);
    // Burbujas que suben.
    for (let i = 0; i < 18; i++) {
      const bx = x + ((i * 53) % Math.max(1, w)), ph = (t + i * 0.13) % 1;
      ctx.beginPath();
      ctx.arc(bx, y + h - ph * h, 2 + (i % 3), 0, TAU);
      ctx.fillStyle = `rgba(255,250,220,${0.8 * (1 - ph)})`;
      ctx.fill();
    }
    sweep(ctx, t, x, w, y, h, 0.8);
  },
};

const NOMBRES: Record<string, NamePaint> = {
  "tiza-blanca": (ctx) => {
    ctx.fillStyle = "#F4F1E8";
    ctx.shadowColor = "rgba(255,255,255,0.35)";
    ctx.shadowBlur = 3;
  },
  "dos-tonos": (ctx, _t, x, w) => {
    ctx.fillStyle = gradient(ctx, x, 0, w, ["#39C5BB", "#E285B2"]);
  },
  "contorno-de-comic": (ctx) => {
    ctx.fillStyle = "#FFE14D";
  },
  neon: (ctx, t) => {
    ctx.shadowColor = "#FF4FD8";
    ctx.shadowBlur = 10 + 16 * (0.5 + 0.5 * Math.sin(t * TAU));
    ctx.fillStyle = "#FFE6FA";
  },
  "arcoiris-en-marcha": (ctx, t, x, w) => {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = rainbowAt(ctx, x, w, t);
  },
};

const AROS: Record<string, Paint> = {
  "aro-simple": (ctx) => {
    ctx.beginPath();
    ctx.arc(ACX, ACY, AS / 2 + 6, 0, TAU);
    ctx.fillStyle = "#F4F1F8";
    ctx.fill();
  },
  "puerro-trenzado": (ctx) => {
    const n = 28;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(ACX, ACY, AS / 2 + 7, (i / n) * TAU, ((i + 1) / n) * TAU);
      ctx.lineWidth = 14;
      ctx.strokeStyle = i % 2 ? "#4CAF50" : "#C5F27A";
      ctx.stroke();
    }
  },
  "corazones-de-luka": (ctx, t) => {
    ctx.beginPath();
    ctx.arc(ACX, ACY, AS / 2 + 7, 0, TAU);
    ctx.fillStyle = gradient(ctx, AX, 0, AS, ["#F2A2C0", "#FFD1E2", "#F2A2C0"]);
    ctx.fill();
    ctx.fillStyle = "#FF5FA2";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6 + t / 6) * TAU;
      heart(ctx, ACX + Math.cos(a) * (AS / 2 + 18), ACY + Math.sin(a) * (AS / 2 + 18), 11);
    }
  },
  "notas-en-orbita": (ctx, t) => {
    ctx.save();
    ctx.shadowColor = "#FFC83D";
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(ACX, ACY, AS / 2 + 9, 0, TAU);
    ctx.fillStyle = rainbowAt(ctx, AX - 10, AS + 20, t, ["#B8860B", "#FFD166", "#FFF6D5", "#FFD166"]);
    ctx.fill();
    ctx.restore();
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillStyle = "#FFF6D5";
    for (let i = 0; i < 3; i++) {
      const a = (t + i / 3) * TAU;
      centerText(ctx, i === 1 ? "♫" : "♪", ACX + Math.cos(a) * (AS / 2 + 26), ACY + Math.sin(a) * (AS / 2 + 26));
    }
  },
};

/** Fondos: pintan toda la tarjeta (debajo del velo). */
const FONDOS: Record<string, Paint> = {
  "papel-pautado": (ctx) => {
    ctx.fillStyle = gradient(ctx, 0, 0, W, ["#3A3326", "#B8A57E", "#F2E8D0"]);
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(60,45,25,0.35)";
    ctx.lineWidth = 1.5;
    for (let s = 0; s < 4; s++) for (let i = 0; i < 5; i++) {
      const y = 50 + s * 75 + i * 8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(60,45,25,0.4)";
    ctx.font = `bold 30px ${FONT}`;
    for (const [x, y, g] of [[620, 70, "♪"], [700, 140, "♫"], [820, 95, "♩"], [900, 225, "♬"], [760, 280, "♪"]] as const) centerText(ctx, g, x, y);
  },
  "cielo-de-tokio": (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1B1A4A");
    g.addColorStop(0.55, "#7A3D7A");
    g.addColorStop(1, "#F29A6B");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    sparkles(ctx, 0, 0, W, H * 0.45, 40);
    // Siluetas de edificios con ventanas y una torre.
    let seed = 5;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let x = 0; x < W; ) {
      const bw = 30 + rnd() * 50, bh = 50 + rnd() * 110;
      ctx.fillStyle = "#1A1230";
      ctx.fillRect(x, H - bh, bw, bh);
      ctx.fillStyle = "rgba(255,220,140,0.7)";
      for (let wy = H - bh + 8; wy < H - 8; wy += 14) for (let wx = x + 5; wx < x + bw - 6; wx += 10) if (rnd() > 0.6) ctx.fillRect(wx, wy, 4, 6);
      x += bw + 2;
    }
    ctx.fillStyle = "#1A1230";
    ctx.beginPath();
    ctx.moveTo(840, H);
    ctx.lineTo(862, 60);
    ctx.lineTo(884, H);
    ctx.fill();
    ctx.fillStyle = "#E8473D";
    ctx.beginPath();
    ctx.arc(862, 58, 4, 0, TAU);
    ctx.fill();
  },
  "sala-de-ensayo": (ctx) => {
    ctx.fillStyle = "#2A1F3D";
    ctx.fillRect(0, 0, W, H);
    // Paneles de espuma acústica (cuñas alternadas).
    const s = 40;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      const v = ((x / s + y / s) % 2) === 0;
      const g = v ? ctx.createLinearGradient(x, y, x + s, y) : ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, "#3B2C57");
      g.addColorStop(0.5, "#21182F");
      g.addColorStop(1, "#3B2C57");
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    }
    const lamp = ctx.createRadialGradient(800, 0, 10, 800, 0, 300);
    lamp.addColorStop(0, "rgba(255,200,120,0.45)");
    lamp.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, W, H);
    // Pedestal de micrófono.
    ctx.strokeStyle = "#0E0A16";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(840, H);
    ctx.lineTo(840, 150);
    ctx.lineTo(800, 110);
    ctx.stroke();
    ctx.fillStyle = "#0E0A16";
    roundRect(ctx, 778, 84, 30, 40, 14);
    ctx.fill();
  },
  // Fondo animado de la tanda (pedido de GyroP): un concierto visto desde el público, con focos que barren el
  // escenario, un mar de barras de luz que se mecen al ritmo y notas que suben.
  "mar-de-luces": (ctx, t) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#07051A");
    g.addColorStop(0.6, "#1A0F3D");
    g.addColorStop(1, "#2A1450");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Escenario al fondo y focos que barren.
    ctx.fillStyle = "#3A2470";
    ctx.fillRect(420, 150, W - 420, 26);
    const beams = [["rgba(57,197,187,0.32)", 0], ["rgba(255,95,162,0.32)", 0.33], ["rgba(255,200,61,0.3)", 0.66]] as const;
    for (const [col, ph] of beams) {
      const a = Math.sin((t + ph) * TAU) * 0.5;
      const ox = 520 + ph * 400;
      ctx.save();
      ctx.translate(ox, 0);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.lineTo(110, H + 40);
      ctx.lineTo(-110, H + 40);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    }
    sparkles(ctx, 0, 0, W, 140, 50);
    // Público: siluetas y barras de luz que se mecen.
    const cols = ["#39C5BB", "#FF5FA2", "#FFE14D", "#36C5F0", "#B36BFF"];
    for (let row = 0; row < 3; row++) {
      const y0 = H - 70 + row * 26;
      for (let i = 0, x = (row % 2) * 22; x < W + 20; i++, x += 44) {
        const sway = Math.sin(t * TAU * 2 + i * 0.6 + row) * 0.35;
        const col = cols[(i + row) % cols.length]!;
        ctx.save();
        ctx.translate(x + 6, y0 - 4);
        ctx.rotate(sway);
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        roundRect(ctx, -3, -46, 6, 40, 3);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y0, 13, 0, TAU);
        ctx.fillStyle = "#0B0718";
        ctx.fill();
        ctx.fillRect(x - 16, y0 + 8, 32, 30);
      }
    }
    // Notas que suben.
    ctx.font = `bold 22px ${FONT}`;
    for (let i = 0; i < 8; i++) {
      const ph = (t + i / 8) % 1;
      ctx.fillStyle = `rgba(255,255,255,${0.8 * Math.sin(ph * Math.PI)})`;
      centerText(ctx, i % 2 ? "♪" : "♫", 470 + ((i * 67) % 500), 200 - ph * 170);
    }
  },
};

// ── Catálogo ──────────────────────────────────────────────────────────────────────────────────
interface Obj {
  id: string;
  nombre: string;
  slot: Slot;
  rareza: Exclude<Rareza, "mitica">;
  anim?: boolean;
  /** Insignia: el emoji. Título: el texto. */
  valor?: string;
  descripcion: string;
}

export const ARTE: Obj[] = [
  { id: "cinta-de-casete", nombre: "Cinta de casete", slot: "borde", rareza: "comun", descripcion: "Cinta café con carretes abajo." },
  { id: "pentagrama", nombre: "Pentagrama", slot: "borde", rareza: "comun", descripcion: "Cinco líneas arriba y abajo, con clave de sol." },
  { id: "hoja-de-cuaderno", nombre: "Hoja de cuaderno", slot: "borde", rareza: "comun", descripcion: "Renglones azules, margen rojo y perforaciones." },
  { id: "neon-de-akihabara", nombre: "Neón de Akihabara", slot: "borde", rareza: "rara", descripcion: "Doble tubo de neón rosa y celeste." },
  { id: "cables-de-microfono", nombre: "Cables de micrófono", slot: "borde", rareza: "rara", descripcion: "Un cable ondulado que da la vuelta, con su conector." },
  { id: "taladros-de-teto", nombre: "Taladros de Teto", slot: "borde", rareza: "epica", anim: true, descripcion: "Rosa, con espirales que giran en las esquinas." },
  { id: "atun-plateado", nombre: "Atún plateado", slot: "borde", rareza: "epica", anim: true, descripcion: "Plateado con escamas y un brillo que lo recorre." },
  { id: "luces-del-mirai", nombre: "Luces del Mirai", slot: "borde", rareza: "legendaria", anim: true, descripcion: "Dorado, con luces de escenario que corren." },
  { id: "lisa-de-color", nombre: "Lisa de color", slot: "barra", rareza: "comun", descripcion: "Un color parejo." },
  { id: "punteada", nombre: "Punteada", slot: "barra", rareza: "comun", descripcion: "Bolitas en fila." },
  { id: "ritmo-de-teto", nombre: "Ritmo de Teto", slot: "barra", rareza: "rara", anim: true, descripcion: "Rayas que avanzan." },
  { id: "ecualizador", nombre: "Ecualizador", slot: "barra", rareza: "epica", anim: true, descripcion: "Bloques que suben y bajan al ritmo." },
  { id: "onda-de-voz", nombre: "Onda de voz", slot: "barra", rareza: "epica", anim: true, descripcion: "Dos ondas de sonido que se mueven." },
  { id: "oro-liquido", nombre: "Oro líquido", slot: "barra", rareza: "legendaria", anim: true, descripcion: "Oro con burbujas y un brillo que pasa." },
  { id: "tiza-blanca", nombre: "Tiza blanca", slot: "nombre", rareza: "comun", descripcion: "Blanco suave, como escrito con tiza." },
  { id: "dos-tonos", nombre: "Dos tonos", slot: "nombre", rareza: "rara", descripcion: "Degradado de aguamarina a rosa." },
  { id: "contorno-de-comic", nombre: "Contorno de cómic", slot: "nombre", rareza: "rara", descripcion: "Amarillo con contorno negro grueso y sombra." },
  { id: "neon", nombre: "Neón", slot: "nombre", rareza: "epica", anim: true, descripcion: "Brillo rosa que late." },
  { id: "arcoiris-en-marcha", nombre: "Arcoíris en marcha", slot: "nombre", rareza: "legendaria", anim: true, descripcion: "Arcoíris que se desplaza de lado a lado." },
  { id: "aro-simple", nombre: "Aro simple", slot: "aro", rareza: "comun", descripcion: "Un aro blanco y limpio." },
  { id: "puerro-trenzado", nombre: "Puerro trenzado", slot: "aro", rareza: "rara", descripcion: "Trenzado en dos verdes." },
  { id: "corazones-de-luka", nombre: "Corazones de Luka", slot: "aro", rareza: "epica", anim: true, descripcion: "Rosa, con corazones que giran." },
  { id: "notas-en-orbita", nombre: "Notas en órbita", slot: "aro", rareza: "legendaria", anim: true, descripcion: "Dorado, con notas que orbitan." },
  ...([
    ["puerro", "Puerro", "🥬", "comun"], ["baguette", "Baguette", "🥖", "comun"], ["atun", "Atún", "🐟", "comun"],
    ["microfono", "Micrófono", "🎤", "comun"], ["naranja-de-rin", "Naranja de Rin", "🍊", "comun"], ["platano-de-len", "Plátano de Len", "🍌", "comun"],
    ["celular-de-neru", "Celular de Neru", "📱", "rara"], ["helado-de-kaito", "Helado de Kaito", "🍨", "rara"], ["corona", "Corona", "👑", "epica"],
  ] as const).map(([id, nombre, valor, rareza]): Obj => ({ id: `insignia-${id}`, nombre, slot: "insignia", rareza, valor, descripcion: "Va junto a tu nombre (hasta 3)." })),
  ...([
    ["recien-llegado", "Recién llegado al karaoke", "comun"], ["coleccionista", "Coleccionista de puerros", "rara"],
    ["taladro-oficial", "Taladro oficial de Teto", "epica"], ["voz-del-mirai", "Voz del Mirai", "legendaria"],
  ] as const).map(([id, valor, rareza]): Obj => ({ id: `titulo-${id}`, nombre: valor, slot: "titulo", rareza, valor, descripcion: "Frase bajo tu nombre." })),
  { id: "papel-pautado", nombre: "Papel pautado", slot: "fondo", rareza: "comun", descripcion: "Papel crema con pentagramas y notas." },
  { id: "cielo-de-tokio", nombre: "Cielo de Tokio", slot: "fondo", rareza: "comun", descripcion: "Atardecer con edificios y una torre." },
  { id: "sala-de-ensayo", nombre: "Sala de ensayo", slot: "fondo", rareza: "comun", descripcion: "Espuma acústica, lámpara y micrófono." },
  { id: "mar-de-luces", nombre: "Mar de luces", slot: "fondo", rareza: "legendaria", anim: true, descripcion: "Fondo animado: focos que barren el escenario y un público con barras de luz que se mecen." },
];

/** Fondo del efecto cómic: sombra rosa desplazada y contorno blanco grueso (el relleno amarillo va encima). */
function comicBack(ctx: SKRSContext2D, text: string, x: number, y: number, size: number) {
  const off = size * 0.09, lw = size * 0.2;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = lw;
  ctx.strokeStyle = "#E0457B";
  ctx.fillStyle = "#E0457B";
  ctx.strokeText(text, x + off, y + off);
  ctx.fillText(text, x + off, y + off);
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(text, x, y);
  ctx.restore();
}

// ── Tarjeta con objetos ───────────────────────────────────────────────────────────────────────
interface Equipo {
  borde?: Paint;
  barra?: BarPaint;
  nombre?: { paint: NamePaint; comic?: boolean };
  aro?: Paint;
  insignias?: string[];
  titulo?: { texto: string; color: string };
  fondo?: Paint;
}

function drawCard(ctx: SKRSContext2D, e: Equipo, avatar: Image, t: number) {
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.clip();
  if (e.fondo) e.fondo(ctx, t);
  else {
    ctx.fillStyle = gradient(ctx, 0, 0, W, ["#1E4F4B", "#16131f"]);
    ctx.fillRect(0, 0, W, H);
  }
  const veil = ctx.createLinearGradient(0, 0, W, 0);
  veil.addColorStop(0, "rgba(10,8,18,0.82)");
  veil.addColorStop(0.65, "rgba(10,8,18,0.55)");
  veil.addColorStop(1, "rgba(10,8,18,0.15)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);

  // Aro y avatar.
  ctx.save();
  if (e.aro) e.aro(ctx, t);
  else {
    ctx.beginPath();
    ctx.arc(ACX, ACY, AS / 2 + 7, 0, TAU);
    ctx.fillStyle = "#39C5BB";
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(ACX, ACY, AS / 2, 0, TAU);
  ctx.clip();
  ctx.drawImage(avatar, AX, AY, AS, AS);
  ctx.restore();

  // Nombre.
  ctx.font = `bold 46px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const name = fitText(ctx, "Papu de ejemplo", RIGHT - TX - 180);
  const nw = ctx.measureText(name).width;
  ctx.save();
  if (e.nombre?.comic) comicBack(ctx, name, TX, 98, 46);
  if (e.nombre) e.nombre.paint(ctx, t, TX, nw);
  else ctx.fillStyle = "#ffffff";
  ctx.fillText(name, TX, 98);
  ctx.restore();

  // Insignias (hasta 3).
  (e.insignias ?? []).slice(0, 3).forEach((em, i) => {
    const bx = RIGHT - 52 - i * 58, by = 52;
    roundRect(ctx, bx, by, 50, 50, 14);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `30px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    centerText(ctx, em, bx + 25, by + 25);
  });

  // Nivel y rango.
  roundRect(ctx, TX, 120, 128, 48, 10);
  ctx.fillStyle = gradient(ctx, TX, 120, 128, ["#B8860B", "#FFD166", "#FFF6D5", "#FFD166", "#B8860B"]);
  ctx.fill();
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillStyle = "#3A2600";
  centerText(ctx, "Nv 52", TX + 64, 144);
  ctx.font = `600 24px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(fitText(ctx, "Álbum · #7 del servidor", RIGHT - TX - 146), TX + 146, 145);
  ctx.textBaseline = "alphabetic";

  // Título (o la frase de siempre).
  ctx.font = `italic 24px ${FONT}`;
  ctx.fillStyle = e.titulo ? e.titulo.color : "rgba(255,255,255,0.85)";
  ctx.fillText(fitText(ctx, e.titulo ? `« ${e.titulo.texto} »` : "“La que empezó como broma”", RIGHT - TX), TX, 204);

  // Barra de XP.
  roundRect(ctx, TX, BY, BW, BH, BH / 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();
  const fw = BW * FRAC;
  ctx.save();
  roundRect(ctx, TX, BY, fw, BH, BH / 2);
  ctx.clip();
  if (e.barra) e.barra(ctx, t, TX, BY, fw, BH);
  else {
    ctx.fillStyle = "#39C5BB";
    ctx.fillRect(TX, BY, fw, BH);
  }
  ctx.restore();
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("1.677 / 2.619 XP para el nivel 53", TX, BY - 10);
  ctx.font = `20px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText("Cuota hoy: 9 de 14", TX, BY + BH + 28);
  ctx.restore();

  // Borde (encima de todo).
  ctx.save();
  if (e.borde) e.borde(ctx, t);
  ctx.restore();
}

function equipoDe(o: Obj): Equipo {
  switch (o.slot) {
    case "borde": return { borde: BORDES[o.id] };
    case "barra": return { barra: BARRAS[o.id] };
    case "nombre": return { nombre: { paint: NOMBRES[o.id]!, comic: o.id === "contorno-de-comic" } };
    case "aro": return { aro: AROS[o.id] };
    case "insignia": return { insignias: [o.valor!] };
    case "titulo": return { titulo: { texto: o.valor!, color: RAREZAS[o.rareza].color } };
    case "fondo": return { fondo: FONDOS[o.id] };
  }
}

function encodeGif(w: number, h: number, frames: number, delay: number, draw: (ctx: SKRSContext2D, t: number) => void): Buffer {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  const datas: Uint8ClampedArray[] = [];
  for (let i = 0; i < frames; i++) {
    ctx.save();
    ctx.fillStyle = "#14111c";
    ctx.fillRect(0, 0, w, h);
    draw(ctx, i / frames);
    ctx.restore();
    datas.push(ctx.getImageData(0, 0, w, h).data);
  }
  const parts: number[] = [];
  for (let f = 0; f < frames; f += Math.max(1, Math.floor(frames / 4))) {
    const d = datas[f]!;
    for (let p = 0; p < d.length; p += 32) parts.push(d[p]!, d[p + 1]!, d[p + 2]!, d[p + 3]!);
  }
  const palette = quantize(new Uint8ClampedArray(parts), 256);
  const gif = GIFEncoder();
  datas.forEach((d, i) => gif.writeFrame(applyPalette(d, palette), w, h, { palette: i === 0 ? palette : undefined, delay, repeat: i === 0 ? 0 : undefined }));
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** Miniatura de tienda: el objeto solo, sobre fondo de su rareza. */
function miniatura(o: Obj, t = 0.15): Buffer {
  const S = 256;
  const c = createCanvas(S, S);
  const ctx = c.getContext("2d");
  const col = RAREZAS[o.rareza];
  roundRect(ctx, 4, 4, S - 8, S - 8, 30);
  ctx.fillStyle = col.color;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 14, 14, S - 28, S - 28, 22);
  ctx.clip();
  ctx.fillStyle = gradient(ctx, 0, 0, S, [col.oscuro, "#15121d"]);
  ctx.fillRect(0, 0, S, S);
  const inner = S - 28;
  if (o.slot === "fondo" || o.slot === "borde" || o.slot === "barra" || o.slot === "nombre" || o.slot === "aro") {
    // Se dibuja una tarjeta con el objeto y se recorta la zona que lo muestra.
    const card = createCanvas(W, H);
    const cctx = card.getContext("2d");
    const e = equipoDe(o);
    if (o.slot === "fondo") e.fondo!(cctx, t);
    else if (o.slot === "borde") {
      cctx.fillStyle = "#1E1830";
      cctx.fillRect(0, 0, W, H);
      e.borde!(cctx, t);
    } else if (o.slot === "barra") {
      cctx.fillStyle = "#1E1830";
      cctx.fillRect(0, 0, W, H);
      roundRect(cctx, TX, BY, BW, BH, BH / 2);
      cctx.fillStyle = "rgba(255,255,255,0.18)";
      cctx.fill();
      cctx.save();
      roundRect(cctx, TX, BY, BW * FRAC, BH, BH / 2);
      cctx.clip();
      e.barra!(cctx, t, TX, BY, BW * FRAC, BH);
      cctx.restore();
    } else if (o.slot === "aro") {
      cctx.fillStyle = "#1E1830";
      cctx.fillRect(0, 0, W, H);
      e.aro!(cctx, t);
      cctx.beginPath();
      cctx.arc(ACX, ACY, AS / 2, 0, TAU);
      cctx.fillStyle = "#2B2440";
      cctx.fill();
      cctx.font = `90px ${FONT}`;
      centerText(cctx, "🙂", ACX, ACY);
    }
    if (o.slot === "nombre") {
      ctx.font = `bold 64px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const m = ctx.measureText("Papu");
      const x = 14 + (inner - m.width) / 2;
      const y = 14 + inner / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      ctx.save();
      if (o.id === "contorno-de-comic") comicBack(ctx, "Papu", x, y, 64);
      NOMBRES[o.id]!(ctx, t, x, m.width);
      ctx.fillText("Papu", x, y);
      ctx.restore();
    } else {
      // Zona de recorte según el tipo.
      const [sx, sy, sw, sh] = o.slot === "fondo" ? [W - H, 0, H, H] : o.slot === "borde" ? [0, 0, H, H] : o.slot === "barra" ? [TX - 10, BY - 120, 270, 270] : [AX - 40, AY - 40, AS + 80, AS + 80];
      ctx.drawImage(card, sx, sy, sw, sh, 14, 14, inner, inner);
    }
  } else if (o.slot === "insignia") {
    ctx.font = `120px ${FONT}`;
    centerText(ctx, o.valor!, S / 2, S / 2);
  } else {
    ctx.fillStyle = col.color;
    let size = 40, lines: string[] = [];
    for (; size > 16; size -= 2) {
      ctx.font = `italic bold ${size}px ${FONT}`;
      // Las comillas van pegadas a la primera y la última palabra (nunca solas en una línea).
      lines = wrapLines(ctx, o.valor!, inner - 30 - ctx.measureText("« ").width, 3);
      lines[0] = `« ${lines[0]}`;
      lines[lines.length - 1] = `${lines[lines.length - 1]} »`;
      if (!lines.some((l) => l.endsWith("…")) && lines.length * size * 1.25 <= inner - 30) break;
    }
    const lh = size * 1.25;
    lines.forEach((l, i) => centerText(ctx, l, S / 2, S / 2 + (i - (lines.length - 1) / 2) * lh));
  }
  ctx.restore();
  roundRect(ctx, 4, 4, S - 8, S - 8, 30);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#3B2346";
  ctx.stroke();
  // Gema de rareza y, si se mueve, un ▶.
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
  if (o.anim) {
    roundRect(ctx, 20, S - 52, 74, 30, 15);
    ctx.fillStyle = "rgba(10,8,18,0.75)";
    ctx.fill();
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    centerText(ctx, "▶ Animado", 57, S - 37);
  }
  return c.toBuffer("image/png");
}

function save(rel: string, buf: Buffer) {
  fs.writeFileSync(path.join(out, rel), buf);
  console.log(`ok imagenes/arte-propio/${rel} (${Math.round(buf.length / 1024)} KB)`);
}

async function hoja(minis: Map<string, Buffer>): Promise<Buffer> {
  const slots: Slot[] = ["fondo", "borde", "barra", "nombre", "aro", "insignia", "titulo"];
  const cell = 150, cols = 9, pad = 24;
  const groups = slots.map((s) => ARTE.filter((o) => o.slot === s));
  const Wd = pad * 2 + cols * cell;
  const Hd = 100 + groups.reduce((a, g) => a + 56 + Math.ceil(g.length / cols) * (cell + 52), 0);
  const c = createCanvas(Wd, Hd);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#14111c";
  ctx.fillRect(0, 0, Wd, Hd);
  ficha(ctx, pad + 26, 46, 24);
  ctx.font = `900 34px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Arte propio · se compra con cualquier moneda", pad + 62, 58);
  let y = 96;
  for (let gi = 0; gi < slots.length; gi++) {
    const g = groups[gi]!;
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillStyle = "#E6E0F0";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${SLOT_NOMBRE[slots[gi]!]} · ${g.length}`, pad, y + 30);
    y += 46;
    for (let k = 0; k < g.length; k++) {
      const o = g[k]!, x = pad + (k % cols) * cell, yy = y + Math.floor(k / cols) * (cell + 52);
      ctx.drawImage(await loadImage(minis.get(o.id)!), x + 6, yy, cell - 12, cell - 12);
      ctx.fillStyle = "#E6E0F0";
      const size = fitFont(ctx, o.nombre, cell - 12, 14, 10, "600");
      wrapLines(ctx, o.nombre, cell - 12, 2).forEach((l, li) => centerText(ctx, l, x + cell / 2, yy + cell - 2 + li * (size + 3)));
      // Precio debajo del nombre.
      const p = PRECIO[o.rareza].toLocaleString("es-CL");
      ctx.font = `bold 13px ${FONT}`;
      const tw = ctx.measureText(p).width + 26;
      const px = x + cell / 2 - tw / 2, py = yy + cell + 30;
      ctx.save();
      ficha(ctx, px + 8, py, 8);
      ctx.restore();
      ctx.font = `bold 13px ${FONT}`;
      ctx.fillStyle = "#FFE9A8";
      centerText(ctx, p, px + 20 + (tw - 20) / 2, py);
    }
    y += Math.ceil(g.length / cols) * (cell + 52) + 10;
  }
  return c.toBuffer("image/png");
}

async function main() {
  const avatar = await loadImage(fs.readFileSync(path.join(root, "assets/bots/miku_avatar.png")));
  const minis = new Map<string, Buffer>();
  for (const o of ARTE) {
    const mini = miniatura(o);
    minis.set(o.id, mini);
    save(`miniaturas/${o.id}.png`, mini);
    const e = equipoDe(o);
    if (o.anim) save(`tarjetas/${o.id}.gif`, encodeGif(W, H, 24, 60, (ctx, t) => drawCard(ctx, e, avatar, t)));
    else {
      const c = createCanvas(W, H);
      drawCard(c.getContext("2d"), e, avatar, 0);
      save(`tarjetas/${o.id}.png`, c.toBuffer("image/png"));
    }
  }
  // Combinación de muestra: lo mejor de la tanda puesto a la vez.
  const combo: Equipo = {
    fondo: FONDOS["mar-de-luces"], borde: BORDES["luces-del-mirai"], barra: BARRAS["oro-liquido"],
    nombre: { paint: NOMBRES["arcoiris-en-marcha"]! }, aro: AROS["notas-en-orbita"], insignias: ["👑", "🎤", "🥬"],
    titulo: { texto: "Voz del Mirai", color: RAREZAS.legendaria.color },
  };
  save("tarjetas/combinacion-legendaria.gif", encodeGif(W, H, 24, 60, (ctx, t) => drawCard(ctx, combo, avatar, t)));
  save("catalogo.png", await hoja(minis));
  const json = {
    $comment: "Objetos de arte propio de las Shaula-coins (propuesta, 26 oct. 2026): dibujados con código, sin renders ni imágenes ajenas; los únicos que se compran con monedas de pago. Lo genera fuente/arte-propio.ts.",
    precios: PRECIO,
    objetos: ARTE.map((o) => ({ ...o, tipo: SLOT_NOMBRE[o.slot], precio: PRECIO[o.rareza] })),
  };
  fs.writeFileSync(path.resolve(here, "../arte-propio.json"), JSON.stringify(json, null, 2));
  console.log("ok arte-propio.json");
}

await main();
