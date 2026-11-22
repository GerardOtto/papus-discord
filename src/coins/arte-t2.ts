// Arte propio de la temporada 2 de las Shaulitas (propuesta, 13 nov. 2026): bordes, barras de XP, aros de avatar y
// efectos de nombre de Navidad y de los 7 pecados capitales. Dibujados con código, sin renders ni imágenes ajenas
// (se podrían comprar con cualquier moneda, como el arte de la temporada 1). Se suman a los registros de
// src/coins/arte.ts; mientras no estén en config/objetos.json nadie los puede tener.
// t = fase de la animación (0 a 1); todo lo que se mueve da vueltas enteras para que el bucle cierre.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Image, type SKRSContext2D } from "@napi-rs/canvas";
import { CARD_H, CARD_W, gradient, roundRect } from "../levels/card";

/** Imagen de stock de assets/coleccion/stock (cargada una vez, sin esperas: los dibujos son síncronos). */
function stock(nombre: string): Image {
  const img = new Image();
  img.src = readFileSync(path.resolve(import.meta.dirname, "../../assets/coleccion/stock", nombre));
  return img;
}
const TIJERAS = stock("tijeras.png");

const TAU = Math.PI * 2;
const W = CARD_W, H = CARD_H;
const AX = 40, AY = 60, AS = 210;
const ACX = AX + AS / 2, ACY = AY + AS / 2;

export type Paint = (ctx: SKRSContext2D, t: number) => void;
export type BarPaint = (ctx: SKRSContext2D, t: number, x: number, y: number, w: number, h: number) => void;
export interface NameStyle {
  paint: (ctx: SKRSContext2D, t: number, x: number, w: number) => void;
  back?: (ctx: SKRSContext2D, text: string, x: number, y: number, size: number, t: number) => void;
}

/** Colores de los pecados, en el mismo orden: los de su Vocaloid (ver SIETE en arte-t2-extra.ts). */
export const PECADOS = ["#A77BFF", "#E0383E", "#E285B2", "#3D6BFF", "#39C5BB", "#7FCB4B", "#F6C744"];

export function cardPath(ctx: SKRSContext2D, inset = 5, r = 24) {
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, r);
}

/** Puntos repartidos por el borde de la tarjeta (a `inset` del canto), con la normal hacia adentro. */
export function perimetro(paso: number, inset = 10): { x: number; y: number; nx: number; ny: number; d: number }[] {
  const top = W - inset * 2, side = H - inset * 2, per = 2 * (top + side);
  const n = Math.round(per / paso);
  return Array.from({ length: n }, (_, i) => {
    const d = (i / n) * per;
    if (d < top) return { x: inset + d, y: inset, nx: 0, ny: 1, d };
    if (d < top + side) return { x: W - inset, y: inset + d - top, nx: -1, ny: 0, d };
    if (d < 2 * top + side) return { x: W - inset - (d - top - side), y: H - inset, nx: 0, ny: -1, d };
    return { x: inset, y: H - inset - (d - 2 * top - side), nx: 1, ny: 0, d };
  });
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Copo de nieve de seis brazos. */
export function copo(ctx: SKRSContext2D, x: number, y: number, r: number, giro = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(giro);
  ctx.lineWidth = Math.max(1.2, r / 5);
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    ctx.rotate(TAU / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(r * 0.28, -r * 0.8);
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(-r * 0.28, -r * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

/** Llama pequeña apuntando hacia (nx, ny). */
export function llamita(ctx: SKRSContext2D, x: number, y: number, nx: number, ny: number, alto: number, ancho: number, color: string) {
  const px = -ny, py = nx;
  ctx.beginPath();
  ctx.moveTo(x - px * ancho, y - py * ancho);
  ctx.quadraticCurveTo(x - px * ancho * 0.5 + nx * alto * 0.6, y - py * ancho * 0.5 + ny * alto * 0.6, x + nx * alto, y + ny * alto);
  ctx.quadraticCurveTo(x + px * ancho * 0.5 + nx * alto * 0.6, y + py * ancho * 0.5 + ny * alto * 0.6, x + px * ancho, y + py * ancho);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// ───────────────────────── bordes ─────────────────────────

export const BORDES_T2: Record<string, Paint> = {
  // Común: bastón de caramelo, franjas rojas y blancas en diagonal.
  "borde-de-caramelo": (ctx) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke();
    ctx.setLineDash([16, 16]);
    ctx.strokeStyle = "#E0283C";
    ctx.stroke();
    ctx.restore();
  },
  // Rara: guirnalda de pino con esferas rojas y doradas.
  "guirnalda-navidena": (ctx) => {
    for (const p of perimetro(9)) {
      const s = Math.sin(p.d / 7) * 3;
      ctx.beginPath();
      ctx.arc(p.x + p.nx * s, p.y + p.ny * s, 7, 0, TAU);
      ctx.fillStyle = Math.round(p.d / 9) % 2 ? "#1E7A3C" : "#2FA052";
      ctx.fill();
    }
    perimetro(74).forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x + p.nx * 3, p.y + p.ny * 3, 7, 0, TAU);
      ctx.fillStyle = i % 2 ? "#E0283C" : "#FFC83D";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x + p.nx * 3 - 2, p.y + p.ny * 3 - 2, 2, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fill();
    });
  },
  // Rara: hilo rojo cosido alrededor, con las tijeras de la sastre en la esquina (envidia).
  "hilo-de-kayo": (ctx) => {
    ctx.save();
    cardPath(ctx, 8, 21);
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#3A0E14";
    ctx.stroke();
    ctx.setLineDash([14, 9]);
    ctx.lineCap = "round";
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#E0283C";
    ctx.stroke();
    ctx.restore();
    // Tijeras (Twemoji ✂️, CC BY 4.0: assets/coleccion/stock/CREDITOS.md) cortando el hilo en la esquina, con sombra.
    ctx.save();
    ctx.translate(W - 50, 46);
    ctx.rotate(-0.45);
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    ctx.drawImage(TIJERAS, -34, -34, 68, 68);
    ctx.restore();
  },
  // Épica: luces de Navidad que se prenden por turnos alrededor de la tarjeta.
  "luces-de-navidad": (ctx, t) => {
    ctx.save();
    cardPath(ctx, 8, 21);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#143A1E";
    ctx.stroke();
    ctx.restore();
    const cols = ["#FF4D4D", "#FFD23F", "#3DDC84", "#3FA7FF", "#FF7AD9"];
    perimetro(42, 8).forEach((p, i) => {
      const col = cols[i % cols.length]!;
      const on = Math.sin((t * 2 + i * 0.37) * TAU) > -0.2;
      ctx.save();
      if (on) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 16;
      }
      ctx.beginPath();
      ctx.ellipse(p.x + p.nx * 5, p.y + p.ny * 5, p.nx ? 7 : 5, p.nx ? 5 : 7, 0, 0, TAU);
      ctx.fillStyle = on ? col : rgba(col, 0.35);
      ctx.fill();
      ctx.restore();
    });
  },
  // Legendaria: borde de hielo con un brillo que lo recorre y copos en las esquinas.
  escarcha: (ctx, t) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.shadowColor = "#9FE4FF";
    ctx.shadowBlur = 22;
    ctx.lineWidth = 9;
    ctx.strokeStyle = gradient(ctx, 0, 0, W, ["#BFEFFF", "#FFFFFF", "#7FC8F0", "#FFFFFF", "#BFEFFF"]);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([60, 2600]);
    ctx.lineDashOffset = -t * 2660;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "#FFFFFF";
    for (const [x, y, r, s] of [[30, 30, 15, 1], [W - 30, 30, 12, -1], [30, H - 30, 12, -1], [W - 30, H - 30, 15, 1]] as const) {
      copo(ctx, x, y, r, s * t * (TAU / 6));
    }
  },
  // Legendaria: llamas alrededor de la tarjeta que van pasando por los colores de los siete pecados.
  "llamas-del-pecado": (ctx, t) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#1A0606";
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    perimetro(13, 4).forEach((p, i) => {
      // El medio punto evita caer justo en el cambio de color (el redondeo haría saltar el bucle).
      const col = PECADOS[Math.floor((((i + 0.5) / 28 + t) % 1) * PECADOS.length) % PECADOS.length]!;
      const alto = 18 + 12 * Math.abs(Math.sin((t * 3 + i * 0.23) * TAU));
      llamita(ctx, p.x, p.y, p.nx, p.ny, alto, 10, rgba(col, 0.7));
      llamita(ctx, p.x, p.y, p.nx, p.ny, alto * 0.5, 5, "rgba(255,250,220,0.6)");
    });
    ctx.restore();
  },
};

// ───────────────────────── barras de XP ─────────────────────────

export const BARRAS_T2: Record<string, BarPaint> = {
  // Común: bastón de caramelo.
  "barra-de-caramelo": (ctx, _t, x, y, w, h) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#E0283C";
    for (let sx = x - h; sx < x + w + h; sx += 28) {
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + 14, y + h);
      ctx.lineTo(sx + 14 + h, y);
      ctx.lineTo(sx + h, y);
      ctx.fill();
    }
  },
  // Rara: hielo con nieve acumulada encima.
  "nieve-acumulada": (ctx, _t, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, x, 0, w, ["#2A6FB0", "#7FC8F0", "#BFEFFF"]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let px = 0; px <= w; px += 6) ctx.lineTo(x + px, y + h * (0.3 + 0.16 * Math.sin(px / 13) + 0.08 * Math.sin(px / 5)));
    ctx.lineTo(x + w, y);
    ctx.fill();
  },
  // Rara: tela cosida con hilo rojo (envidia).
  "puntada-roja": (ctx, _t, x, y, w, h) => {
    ctx.fillStyle = "#5A1420";
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.strokeStyle = "#FF6B6B";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let px = x + 8; px < x + w - 4; px += 18) {
      ctx.beginPath();
      ctx.moveTo(px, y + h * 0.3);
      ctx.lineTo(px + 9, y + h * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  },
  // Épica: lava que avanza.
  lava: (ctx, t, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, x, 0, w, ["#7A0C0C", "#FF3B1F", "#FF9F1C", "#FFE14D"]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(60,8,8,0.55)";
    for (let i = 0; i < 12; i++) {
      const px = x + ((((i * 0.137 + t) % 1) + 1) % 1) * (w + 60) - 30;
      ctx.beginPath();
      ctx.ellipse(px, y + h * (0.3 + 0.4 * ((i * 0.618) % 1)), 16 + (i % 3) * 6, 4 + (i % 2) * 2, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,240,180,0.5)";
    for (let i = 0; i < 9; i++) {
      const p = (((i * 0.21 + t * 2) % 1) + 1) % 1;
      ctx.beginPath();
      ctx.arc(x + ((i * 0.377) % 1) * w, y + h - p * h, 2 + (i % 2), 0, TAU);
      ctx.fill();
    }
  },
  // Épica: luces de Navidad que corren por la barra.
  "barra-de-luces": (ctx, t, x, y, w, h) => {
    ctx.fillStyle = "#0E3B22";
    ctx.fillRect(x, y, w, h);
    const cols = ["#FF4D4D", "#FFD23F", "#3DDC84", "#3FA7FF", "#FF7AD9"];
    for (let i = 0, px = x + 12; px < x + w; i++, px += 22) {
      const col = cols[i % cols.length]!;
      const on = Math.sin((t * 2 - i * 0.2 + 0.03) * TAU) > 0;
      ctx.save();
      if (on) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
      }
      ctx.beginPath();
      ctx.arc(px, y + h / 2, 6, 0, TAU);
      ctx.fillStyle = on ? col : rgba(col, 0.35);
      ctx.fill();
      ctx.restore();
    }
  },
  // Legendaria: los siete pecados, con un brillo que los recorre.
  "barra-siete-pecados": (ctx, t, x, y, w, h) => {
    // Los siete colores ocupan el ancho de la barra completa (no solo lo lleno): se van descubriendo al subir de XP.
    const total = W - 40 - 290;
    PECADOS.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(x + (i * total) / PECADOS.length, y, total / PECADOS.length + 1, h);
    });
    const sx = x - 80 + (w + 160) * t;
    const g = ctx.createLinearGradient(sx - 50, 0, sx + 50, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  },
};

// ───────────────────────── aros de avatar ─────────────────────────

export const AROS_T2: Record<string, Paint> = {
  // Rara: corona de adviento, pino con bayas rojas.
  "corona-de-adviento": (ctx) => {
    const n = 44, r = AS / 2 + 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.beginPath();
      ctx.ellipse(ACX + Math.cos(a) * r, ACY + Math.sin(a) * r, 11, 6, a + 0.9, 0, TAU);
      ctx.fillStyle = i % 2 ? "#1E7A3C" : "#2FA052";
      ctx.fill();
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      ctx.beginPath();
      ctx.arc(ACX + Math.cos(a) * r, ACY + Math.sin(a) * r, 5.5, 0, TAU);
      ctx.fillStyle = "#E0283C";
      ctx.fill();
    }
  },
  // Épica: aro de hielo con copos que giran alrededor.
  "copos-en-orbita": (ctx, t) => {
    ctx.save();
    ctx.shadowColor = "#9FE4FF";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(ACX, ACY, AS / 2 + 8, 0, TAU);
    ctx.fillStyle = gradient(ctx, AX - 10, 0, AS + 20, ["#7FC8F0", "#FFFFFF", "#BFEFFF"]);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#FFFFFF";
    for (let i = 0; i < 5; i++) {
      const a = (t / 5 + i / 5) * TAU;
      copo(ctx, ACX + Math.cos(a) * (AS / 2 + 24), ACY + Math.sin(a) * (AS / 2 + 24), 10, a);
    }
  },
  // Legendaria: aro de fuego.
  "aro-de-fuego": (ctx, t) => {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const n = 40, r = AS / 2 + 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const alto = 16 + 10 * Math.abs(Math.sin((t * 3 + i * 0.29) * TAU));
      const x = ACX + Math.cos(a) * r, y = ACY + Math.sin(a) * r;
      llamita(ctx, x, y, Math.cos(a), Math.sin(a), alto, 9, i % 2 ? "rgba(255,59,31,0.85)" : "rgba(255,159,28,0.85)");
      llamita(ctx, x, y, Math.cos(a), Math.sin(a), alto * 0.5, 4.5, "rgba(255,240,180,0.8)");
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(ACX, ACY, AS / 2 + 6, 0, TAU);
    ctx.fillStyle = gradient(ctx, AX - 6, 0, AS + 12, ["#7A0C0C", "#FF9F1C", "#7A0C0C"]);
    ctx.fill();
  },
};

// ───────────────────────── efectos de nombre ─────────────────────────

export const NOMBRES_T2: Record<string, NameStyle> = {
  // Rara: letras de hielo.
  escarchado: {
    paint: (ctx, _t, x, w) => {
      ctx.fillStyle = gradient(ctx, x, 0, w, ["#BFEFFF", "#FFFFFF", "#7FC8F0", "#FFFFFF"]);
      ctx.shadowColor = "#3FA7FF";
      ctx.shadowBlur = 10;
    },
  },
  // Épica: brasas, un degradado de fuego que se desplaza.
  brasas: {
    paint: (ctx, t, x, w) => {
      // Cuatro repeticiones del degradado (una por ancho del nombre) que avanzan una entera por bucle: el nombre
      // siempre queda dentro y el último cuadro empalma con el primero.
      const g = ctx.createLinearGradient(x - 2 * w + t * w, 0, x + 2 * w + t * w, 0);
      for (let k = 0; k <= 8; k++) g.addColorStop(k / 8, k % 2 ? "#FFE14D" : "#FF3B1F");
      ctx.fillStyle = g;
      ctx.shadowColor = "#FF3B1F";
      ctx.shadowBlur = 14;
    },
  },
};
