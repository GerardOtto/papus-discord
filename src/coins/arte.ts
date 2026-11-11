// Objetos de arte propio de las Shaula-coins (PLAN §3.6): se dibujan con código sobre la tarjeta de nivel, sin renders
// ni imágenes ajenas (por eso se pueden comprar con monedas de pago). Cada dibujo recibe la fase de la animación t
// (0 a 1); los estáticos la ignoran. Los diseños salen de la propuesta (docs/propuestas/shaula-coins/fuente/
// arte-propio.ts); la geometría es la de la tarjeta (src/levels/card.ts).
import type { SKRSContext2D } from "@napi-rs/canvas";
import { CARD_H, CARD_W, FONT, gradient, rainbowAt, roundRect, sparkles } from "../levels/card";

export { rainbowAt };

const TAU = Math.PI * 2;
const W = CARD_W, H = CARD_H;
/** Geometría de la tarjeta: avatar, texto y barra de XP. */
export const GEO = { ax: 40, ay: 60, as: 210, tx: 290, right: W - 40, by: 254, bh: 28 } as const;
const ACX = GEO.ax + GEO.as / 2, ACY = GEO.ay + GEO.as / 2;

export type Paint = (ctx: SKRSContext2D, t: number) => void;
/** Relleno de la barra: dibuja dentro de la parte llena (ya recortada). */
export type BarPaint = (ctx: SKRSContext2D, t: number, x: number, y: number, w: number, h: number) => void;
/** Estilo del nombre: pone fillStyle (y sombras) antes de escribirlo. `back` dibuja algo detrás (contorno, sombra). */
export interface NameStyle {
  paint: (ctx: SKRSContext2D, t: number, x: number, w: number) => void;
  back?: (ctx: SKRSContext2D, text: string, x: number, y: number, size: number, t: number) => void;
}

/** Centra el dibujo real de las letras (no la caja de la fuente) en (cx, cy). */
export function centerText(ctx: SKRSContext2D, text: string, cx: number, cy: number): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  ctx.fillText(text, cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

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

function star(ctx: SKRSContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

export const BORDES: Record<string, Paint> = {
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
    // Cable ondulado que da la vuelta a la tarjeta, con un conector XLR en la esquina.
    const pts: [number, number][] = [];
    const top = W - 20, side = H - 20, per = 2 * (top + side);
    for (let d = 0; d < per; d += 6) {
      let x: number, y: number, nx: number, ny: number;
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
    ctx.clip();
    ctx.strokeStyle = "rgba(70,80,100,0.45)";
    ctx.lineWidth = 1.2;
    for (let x = 0; x < W; x += 12)
      for (const y of [6, H - 6]) {
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI);
        ctx.stroke();
      }
    ctx.restore();
    ctx.save();
    cardPath(ctx, 6);
    ctx.lineWidth = 11;
    const sx = -200 + (W + 400) * t;
    const g = ctx.createLinearGradient(sx - 90, 0, sx + 90, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
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
  // Mítica: arcoíris que corre por el borde, con el martillo del baneo en la esquina.
  "baneo-de-shaula": (ctx, t) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.shadowColor = "#FF5FA2";
    ctx.shadowBlur = 26;
    ctx.strokeStyle = rainbowAt(ctx, 0, W, t);
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.translate(W - 34, 34);
    ctx.rotate(-Math.PI / 4 + Math.sin(t * TAU) * 0.25);
    ctx.fillStyle = "#FFF3C4";
    roundRect(ctx, -4, -2, 8, 30, 3);
    ctx.fill();
    roundRect(ctx, -15, -12, 30, 13, 3);
    ctx.fill();
    ctx.restore();
  },
};

/** Borde de los fundadores: dorado con estrellas en las esquinas y su número abajo a la derecha. */
export function bordeFundador(numero: number): Paint {
  return (ctx) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.shadowColor = "#FFE14D";
    ctx.shadowBlur = 22;
    ctx.lineWidth = 8;
    ctx.strokeStyle = gradient(ctx, 0, 0, W, ["#B8860B", "#FFF3C4", "#FFD166", "#FFF3C4", "#B8860B"]);
    ctx.stroke();
    ctx.restore();
    for (const [x, y] of [[24, 26], [W - 24, 26], [24, H - 24], [W - 24, H - 24]] as const) {
      star(ctx, x, y, 13);
      ctx.fillStyle = "#FFD166";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#7A5A00";
      ctx.stroke();
    }
    const label = `FUNDADOR N.º ${String(numero).padStart(3, "0")}`;
    ctx.font = `bold 17px ${FONT}`;
    const lw = ctx.measureText(label).width + 30;
    roundRect(ctx, W - lw - 46, H - 47, lw, 30, 15);
    ctx.fillStyle = gradient(ctx, W - lw - 46, 0, lw, ["#B8860B", "#FFE08A", "#B8860B"]);
    ctx.fill();
    ctx.fillStyle = "#3A2600";
    centerText(ctx, label, W - 46 - lw / 2, H - 32);
  };
}

export const BARRAS: Record<string, BarPaint> = {
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

/** Sombra rosa desplazada y contorno blanco grueso (el relleno amarillo va encima): se ve sobre fondo oscuro. */
function comicBack(ctx: SKRSContext2D, text: string, x: number, y: number, size: number) {
  const off = size * 0.09;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = "#E0457B";
  ctx.fillStyle = "#E0457B";
  ctx.strokeText(text, x + off, y + off);
  ctx.fillText(text, x + off, y + off);
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(text, x, y);
  ctx.restore();
}

export const NOMBRES: Record<string, NameStyle> = {
  "tiza-blanca": {
    paint: (ctx) => {
      ctx.fillStyle = "#F4F1E8";
      ctx.shadowColor = "rgba(255,255,255,0.35)";
      ctx.shadowBlur = 3;
    },
  },
  "dos-tonos": { paint: (ctx, _t, x, w) => void (ctx.fillStyle = gradient(ctx, x, 0, w, ["#39C5BB", "#E285B2"])) },
  "contorno-de-comic": { paint: (ctx) => void (ctx.fillStyle = "#FFE14D"), back: comicBack },
  neon: {
    paint: (ctx, t) => {
      ctx.shadowColor = "#FF4FD8";
      ctx.shadowBlur = 10 + 16 * (0.5 + 0.5 * Math.sin(t * TAU));
      ctx.fillStyle = "#FFE6FA";
    },
  },
  "arcoiris-en-marcha": {
    paint: (ctx, t, x, w) => {
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = rainbowAt(ctx, x, w, t);
    },
  },
  // Mítica: arcoíris con un tirón glitch (copia cian y magenta corridas) en una parte del ciclo.
  "shaula-exe": {
    paint: (ctx, t, x, w) => {
      ctx.shadowColor = "#FF5FA2";
      ctx.shadowBlur = 14;
      ctx.fillStyle = rainbowAt(ctx, x, w, t);
    },
    back: (ctx, text, x, y, size, t) => {
      // Dos tirones por vuelta; el resto del tiempo, una sombra apenas corrida.
      const glitch = t % 0.5 < 0.08 ? size * 0.12 : size * 0.04;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#36E0F0";
      ctx.fillText(text, x - glitch, y);
      ctx.fillStyle = "#FF4FD8";
      ctx.fillText(text, x + glitch, y);
      ctx.restore();
    },
  },
};

export const AROS: Record<string, Paint> = {
  "aro-simple": (ctx) => {
    ctx.beginPath();
    ctx.arc(ACX, ACY, GEO.as / 2 + 6, 0, TAU);
    ctx.fillStyle = "#F4F1F8";
    ctx.fill();
  },
  "puerro-trenzado": (ctx) => {
    const n = 28;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(ACX, ACY, GEO.as / 2 + 7, (i / n) * TAU, ((i + 1) / n) * TAU);
      ctx.lineWidth = 14;
      ctx.strokeStyle = i % 2 ? "#4CAF50" : "#C5F27A";
      ctx.stroke();
    }
  },
  "corazones-de-luka": (ctx, t) => {
    ctx.beginPath();
    ctx.arc(ACX, ACY, GEO.as / 2 + 7, 0, TAU);
    ctx.fillStyle = gradient(ctx, GEO.ax, 0, GEO.as, ["#F2A2C0", "#FFD1E2", "#F2A2C0"]);
    ctx.fill();
    ctx.fillStyle = "#FF5FA2";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6 + t / 6) * TAU;
      heart(ctx, ACX + Math.cos(a) * (GEO.as / 2 + 18), ACY + Math.sin(a) * (GEO.as / 2 + 18), 11);
    }
  },
  "notas-en-orbita": (ctx, t) => {
    ctx.save();
    ctx.shadowColor = "#FFC83D";
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(ACX, ACY, GEO.as / 2 + 9, 0, TAU);
    ctx.fillStyle = rainbowAt(ctx, GEO.ax - 10, GEO.as + 20, t, ["#B8860B", "#FFD166", "#FFF6D5", "#FFD166"]);
    ctx.fill();
    ctx.restore();
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillStyle = "#FFF6D5";
    for (let i = 0; i < 3; i++) {
      const a = (t + i / 3) * TAU;
      centerText(ctx, i === 1 ? "♫" : "♪", ACX + Math.cos(a) * (GEO.as / 2 + 26), ACY + Math.sin(a) * (GEO.as / 2 + 26));
    }
  },
};

/** Fondos dibujados: pintan toda la tarjeta (debajo del velo). */
export const FONDOS: Record<string, Paint> = {
  "papel-pautado": (ctx) => {
    ctx.fillStyle = gradient(ctx, 0, 0, W, ["#3A3326", "#B8A57E", "#F2E8D0"]);
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(60,45,25,0.35)";
    ctx.lineWidth = 1.5;
    for (let s = 0; s < 4; s++)
      for (let i = 0; i < 5; i++) {
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
    const s = 40;
    for (let y = 0; y < H; y += s)
      for (let x = 0; x < W; x += s) {
        const v = (x / s + y / s) % 2 === 0;
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
  // Fondo animado: un concierto desde el público, con focos que barren, barras de luz que se mecen y notas que suben.
  "mar-de-luces": (ctx, t) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#07051A");
    g.addColorStop(0.6, "#1A0F3D");
    g.addColorStop(1, "#2A1450");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#3A2470";
    ctx.fillRect(420, 150, W - 420, 26);
    for (const [col, ph] of [["rgba(57,197,187,0.32)", 0], ["rgba(255,95,162,0.32)", 0.33], ["rgba(255,200,61,0.3)", 0.66]] as const) {
      ctx.save();
      ctx.translate(520 + ph * 400, 0);
      ctx.rotate(Math.sin((t + ph) * TAU) * 0.5);
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
    const cols = ["#39C5BB", "#FF5FA2", "#FFE14D", "#36C5F0", "#B36BFF"];
    for (let row = 0; row < 3; row++) {
      const y0 = H - 70 + row * 26;
      for (let i = 0, x = (row % 2) * 22; x < W + 20; i++, x += 44) {
        const col = cols[(i + row) % cols.length]!;
        ctx.save();
        ctx.translate(x + 6, y0 - 4);
        ctx.rotate(Math.sin(t * TAU * 2 + i * 0.6 + row) * 0.35);
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
    ctx.font = `bold 22px ${FONT}`;
    for (let i = 0; i < 8; i++) {
      const ph = (t + i / 8) % 1;
      ctx.fillStyle = `rgba(255,255,255,${0.8 * Math.sin(ph * Math.PI)})`;
      centerText(ctx, i % 2 ? "♪" : "♫", 470 + ((i * 67) % 500), 200 - ph * 170);
    }
  },
};
