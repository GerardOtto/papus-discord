// Premio por prestigiar (PLAN §2; decisión de GyroP, 13 nov. 2026). Se gana jugando: llegar al 99 y volver al 1.
// Entrega las Shaulitas, el sobre de prestigio (elegible; puede traer renders y míticas), la insignia del prestigio
// que tiene (sube con cada uno y reemplaza a la anterior si la tenía puesta), y el marco y el aro (una sola vez). La
// pelea semanal la cuentan las membresías (src/membresias/service.ts, viaLanzamiento). También dibuja el banner que
// Teto publica en #general.
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { Objeto } from "../coins/rules";
import type { CoinService } from "../coins/service";
import { decorarMembresia, type MarcoMembresia } from "../membresias/marco";
import type { MembresiaService } from "../membresias/service";
import { FONT, fitText } from "./card";
import { prestigeMark, type LevelSettings } from "./rules";

export interface PremioPrestigio {
  monedas: number;
  /** Objetos nuevos (insignia del prestigio, marco y aro la primera vez). */
  objetos: Objeto[];
  sobre: { ve: number; elige: number };
}

/** Entrega el premio de `stars` prestigios. Devuelve lo que recibió (null sin premio configurado). */
export function premiarPrestigio(s: LevelSettings, coins: CoinService, membresias: MembresiaService | null, userId: string, stars: number): PremioPrestigio | null {
  const p = s.premioPrestigio;
  if (!p || stars <= 0) return null;
  coins.adjust(userId, "monedas", p.monedas, `prestigio ${stars}`);
  const objetos: Objeto[] = [];
  const insignia = p.insignias[Math.min(stars, p.insignias.length) - 1];
  for (const id of [...(insignia ? [insignia] : []), ...p.objetos]) {
    if (coins.byId.has(id) && coins.grant(userId, id, "prestigio")) objetos.push(coins.byId.get(id)!);
  }
  // La insignia nueva toma el lugar de la del prestigio anterior si la tenía puesta.
  if (insignia && coins.byId.has(insignia)) {
    const puestas = [...coins.equipped(userId).entries()].filter(([k]) => k.startsWith("insignia")).map(([, o]) => o.id);
    const vieja = puestas.findIndex((id) => p.insignias.includes(id) && id !== insignia);
    if (vieja >= 0) coins.equip(userId, "insignia", puestas.map((id, k) => (k === vieja ? insignia : id)));
  }
  membresias?.darSobrePrestigio(userId, p.sobre.ve, p.sobre.elige, `prestigio ${prestigeMark(stars)}${stars}`);
  return { monedas: p.monedas, objetos, sobre: p.sobre };
}

// ───────────────────────── banner ─────────────────────────

export const PRESTIGIO_W = 1000;
export const PRESTIGIO_H = 420;

export interface PrestigioBannerData {
  name: string;
  avatar: Buffer | null;
  stars: number;
  /** Lo que ganó ("Sobre de prestigio · insignia nueva · 5.000 Shaulitas"). */
  detalle: string;
  membresia?: MarcoMembresia;
}

const METALES: string[][] = [
  ["#F4C79A", "#C97B3E", "#8A4B1F"],
  ["#FFFFFF", "#C9D2DC", "#8C97A6"],
  ["#FFF3B0", "#FFC83D", "#B98510"],
  ["#B5FFFC", "#C9A7FF", "#FFB3E6"],
  ["#FF5F6D", "#FFC371", "#7CF29A", "#5EC8FF", "#B36BFF"],
];

function estrella(ctx: SKRSContext2D, cx: number, cy: number, r: number, puntas = 5, interior = 0.45): void {
  ctx.beginPath();
  for (let k = 0; k < puntas * 2; k++) {
    const rr = k % 2 ? r * interior : r, a = -Math.PI / 2 + (k * Math.PI) / puntas;
    ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  ctx.closePath();
}

/** Texto centrado por su dibujo real, achicado si no cabe. */
function centrado(ctx: SKRSContext2D, text: string, cx: number, cy: number, size: number, maxW: number, weight = "900"): void {
  let s = size;
  do ctx.font = `${weight} ${s}px "Bahnschrift", ${FONT}`;
  while (ctx.measureText(text).width > maxW && --s > 12);
  const t = fitText(ctx, text, maxW);
  const m = ctx.measureText(t);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(t, cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

/** Banner de #general: el avatar dentro de una estrella del metal de su prestigio, con rayos de luz. */
export async function renderPrestigioBanner(d: PrestigioBannerData): Promise<Buffer> {
  const W = PRESTIGIO_W, H = PRESTIGIO_H;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  const bg = ctx.createRadialGradient(W * 0.3, H / 2, 20, W * 0.3, H / 2, W * 0.8);
  bg.addColorStop(0, "#3A2A5E");
  bg.addColorStop(1, "#0E0B1C");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Rayos de luz desde la estrella.
  const cx = 250, cy = H / 2;
  ctx.save();
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - 0.05) * 900, cy + Math.sin(a - 0.05) * 900);
    ctx.lineTo(cx + Math.cos(a + 0.05) * 900, cy + Math.sin(a + 0.05) * 900);
    ctx.closePath();
    ctx.fillStyle = k % 2 ? "rgba(255,216,107,0.07)" : "rgba(255,255,255,0.04)";
    ctx.fill();
  }
  ctx.restore();
  // Estrella del metal de su prestigio.
  const metal = METALES[Math.min(d.stars, METALES.length) - 1]!;
  const g = ctx.createLinearGradient(cx - 170, cy - 170, cx + 170, cy + 170);
  metal.forEach((col, i) => g.addColorStop(i / (metal.length - 1), col));
  ctx.save();
  ctx.shadowColor = "rgba(255,216,107,0.8)";
  ctx.shadowBlur = 40;
  estrella(ctx, cx, cy + 8, 180, 5, 0.52);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  estrella(ctx, cx, cy + 8, 180, 5, 0.52);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  // Avatar en el centro.
  const r = 78;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy + 14, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const av = d.avatar ? await loadImage(d.avatar).catch(() => null) : null;
  if (av) ctx.drawImage(av, cx - r, cy + 14 - r, r * 2, r * 2);
  else {
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(cx - r, cy + 14 - r, r * 2, r * 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy + 14, r, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#FFF6D5";
  ctx.stroke();
  // Textos a la derecha.
  const tx = 640, maxW = 470;
  ctx.fillStyle = "#FFD86B";
  ctx.shadowColor = "rgba(255,180,60,0.7)";
  ctx.shadowBlur = 18;
  centrado(ctx, `PRESTIGIO ${d.stars}`, tx, 125, 64, maxW);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#FFFFFF";
  centrado(ctx, d.name, tx, 205, 52, maxW, "800");
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  centrado(ctx, "llegó al nivel 99 y volvió al 1 con una estrella nueva", tx, 268, 24, maxW, "600");
  ctx.fillStyle = "#FFF3B0";
  centrado(ctx, d.detalle, tx, 325, 22, maxW + 60, "700");
  if (d.membresia) decorarMembresia(ctx, W, H, d.membresia);
  return c.toBuffer("image/png");
}
