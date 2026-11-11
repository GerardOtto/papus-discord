// Ranking de Papus por nivel (/ranking y /publicar-ranking, PLAN §niveles): imagen PNG con un escenario donde tres
// Vocaloids presentan el podio (rotan cada dia: los 15 pasan una vez cada 5 dias) y la lista del 4.º al 10.º.
// Las figuras salen de assets/bots/<id>_figura.png (scripts/make_avatars.py --figuras).
import { existsSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { FONT, RAINBOW, fitText, gradient, roundRect, tierFill } from "./card";

export const RANKING_W = 1000;
export const RANKING_TOP = 10;
const FIGURES = path.resolve(import.meta.dirname, "../../assets/bots");
const TITLE = `"Bahnschrift", "Noto Sans Display", ${FONT}`;

export interface RankingRow {
  position: number;
  name: string;
  avatar: Buffer | null;
  level: number;
  max: number;
  prestige: number;
  into: number;
  needed: number;
  /** Estilo del rango (config/niveles.json, `estilo`): define la insignia (como en la tarjeta de /nivel). */
  tier: number;
  rankName: string;
}

export interface RankingData {
  /** Los primeros (hasta RANKING_TOP), en orden. */
  rows: RankingRow[];
  /** Quien lo pidio, si no esta entre los primeros (solo en /ranking, que ve solo el). */
  me: RankingRow | null;
  /** Vocaloids del podio de hoy: [1.º, 2.º, 3.º]. */
  bots: [string, string, string];
  /** Color de cada Vocaloid "#RRGGBB" (luz del escenario). */
  colors: Record<string, string>;
  /** Fecha visible, "21 oct. 2026". */
  date: string;
}

// ───────────────────────── rotacion del podio ─────────────────────────

/** Barajado fijo segun la semilla (mismo resultado siempre para la misma semilla). */
function shuffle<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Tres Vocaloids del podio para el dia `day` ("AAAA-MM-DD"). Cada ciclo (15 bots = 5 dias) baraja la lista y la
 * reparte de a tres, asi todos pasan una vez por ciclo sin repetir; el orden cambia de un ciclo a otro.
 */
export function podiumBots(day: string, bots: readonly string[]): [string, string, string] {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const perCycle = Math.max(1, Math.floor(bots.length / 3));
  const order = shuffle(bots, Math.floor(n / perCycle));
  const k = (n % perCycle) * 3;
  return [order[k]!, order[k + 1]!, order[k + 2]!];
}

// ───────────────────────── dibujo ─────────────────────────

const PLACES = [
  // lugar, centro x, alto del bloque, colores del bloque, alto maximo de la figura
  { place: 2, cx: 210, bh: 200, stops: ["#9AA3AE", "#F2F5F8", "#9AA3AE"], fig: 420 },
  { place: 1, cx: 500, bh: 260, stops: ["#B8860B", "#FFE08A", "#B8860B"], fig: 470 },
  { place: 3, cx: 790, bh: 170, stops: ["#8a4b22", "#e6a06a", "#8a4b22"], fig: 420 },
] as const;
const FLOOR = 860;
const ROW_H = 62;

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const levelLabel = (r: RankingRow) => `${r.prestige > 0 ? `★${r.prestige} · ` : ""}Nv ${r.level}`;

async function tryLoad(src: Buffer | string | null) {
  if (!src || (typeof src === "string" && !existsSync(src))) return null;
  try {
    return await loadImage(src);
  } catch {
    return null;
  }
}

/** Avatar redondo con aro (degradado); sin imagen, circulo liso. */
async function drawAvatar(ctx: SKRSContext2D, avatar: Buffer | null, cx: number, cy: number, r: number, ring: string[] | null, ringW: number): Promise<void> {
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + ringW, 0, Math.PI * 2);
    ctx.fillStyle = gradient(ctx, cx - r, cy, r * 2, ring);
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#2b2838";
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  const img = await tryLoad(avatar);
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

/** Insignia con el nombre del rango y el estilo de la tarjeta. Devuelve el ancho. */
function drawRankPill(ctx: SKRSContext2D, x: number, y: number, h: number, size: number, r: RankingRow, align: "left" | "center" = "left"): number {
  ctx.font = `bold ${size}px ${TITLE}`;
  const w = ctx.measureText(r.rankName).width + h;
  const left = align === "center" ? x - w / 2 : x;
  const t = tierFill(ctx, r.tier, left, y, w);
  ctx.save();
  if (t.glow) {
    ctx.shadowColor = t.glow;
    ctx.shadowBlur = 10;
  }
  roundRect(ctx, left, y, w, h, h / 2);
  ctx.fillStyle = t.fill;
  ctx.fill();
  ctx.restore();
  if (r.tier === 0) {
    roundRect(ctx, left, y, w, h, h / 2);
    ctx.strokeStyle = "#aab2bd";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = t.text === "rainbow" ? gradient(ctx, left, y, w, RAINBOW) : t.text;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(r.rankName, left + h / 2, y + h / 2 + 1);
  return w;
}

/** Corona dorada (dibujada, no emoji: se ve igual en cualquier PC). */
function drawCrown(ctx: SKRSContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.38);
  ctx.beginPath();
  ctx.moveTo(-s / 2, s * 0.35);
  ctx.lineTo(-s / 2, -s * 0.2);
  ctx.lineTo(-s / 4, s * 0.05);
  ctx.lineTo(0, -s * 0.35);
  ctx.lineTo(s / 4, s * 0.05);
  ctx.lineTo(s / 2, -s * 0.2);
  ctx.lineTo(s / 2, s * 0.35);
  ctx.closePath();
  ctx.fillStyle = gradient(ctx, -s / 2, 0, s, ["#B8860B", "#FFE08A", "#B8860B"]);
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#e0587f";
  for (const px of [-s / 2, 0, s / 2]) {
    ctx.beginPath();
    ctx.arc(px, px === 0 ? -s * 0.35 : -s * 0.2, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Barra de avance dentro del nivel con el color del rango. */
function drawBar(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: RankingRow): void {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fill();
  const frac = r.level >= r.max ? 1 : Math.max(0, Math.min(1, r.into / Math.max(1, r.needed)));
  if (frac <= 0) return;
  roundRect(ctx, x, y, Math.max(h, w * frac), h, h / 2);
  ctx.fillStyle = r.tier >= 10 ? gradient(ctx, x, y, w, RAINBOW) : tierFill(ctx, Math.max(r.tier, 1), x, y, w).fill;
  ctx.fill();
}

async function drawRow(ctx: SKRSContext2D, y: number, r: RankingRow, shade: number, highlight: string | null): Promise<void> {
  roundRect(ctx, 40, y, 920, ROW_H - 8, 14);
  ctx.fillStyle = `rgba(255,255,255,${shade})`;
  ctx.fill();
  if (highlight) {
    ctx.strokeStyle = highlight;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const mid = y + (ROW_H - 8) / 2;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#cbb6ff";
  ctx.font = `bold ${r.position >= 100 ? 24 : 32}px ${TITLE}`;
  ctx.fillText(`#${r.position}`, 60, mid + 1);
  await drawAvatar(ctx, r.avatar, 160, mid, 20, null, 0);
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 28px ${TITLE}`;
  ctx.textBaseline = "middle";
  ctx.fillText(fitText(ctx, r.name, 280), 196, mid + 1);
  drawRankPill(ctx, 490, mid - 13, 26, 16, r);
  drawBar(ctx, 660, mid - 5, 160, 10, r);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 26px ${TITLE}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(levelLabel(r), 940, mid + 1);
  ctx.textAlign = "left";
}

export async function renderRanking(d: RankingData): Promise<Buffer> {
  const rest = d.rows.slice(3);
  const listTop = FLOOR + 160;
  const listEnd = listTop + rest.length * ROW_H + (d.me ? ROW_H + 30 : 0);
  const H = listEnd + 70;
  const W = RANKING_W;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1a0b2e");
  bg.addColorStop(0.5, "#2b1150");
  bg.addColorStop(1, "#120822");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Reflectores con el color de cada Vocaloid del podio (2.º, 1.º, 3.º).
  const [first, second, third] = d.bots;
  const byPlace: Record<number, string> = { 1: first, 2: second, 3: third };
  ctx.save();
  ctx.filter = "blur(28px)";
  for (const [sx, p] of [[120, 2], [500, 1], [880, 3]] as const) {
    const tx = PLACES.find((q) => q.place === p)!.cx;
    ctx.beginPath();
    ctx.moveTo(sx - 20, -10);
    ctx.lineTo(sx + 20, -10);
    ctx.lineTo(tx + 170, 700);
    ctx.lineTo(tx - 170, 700);
    ctx.closePath();
    ctx.fillStyle = hexA(d.colors[byPlace[p]!] ?? "#ffffff", 0.27);
    ctx.fill();
  }
  ctx.restore();

  // Notas y destellos de fondo (siempre los mismos).
  let seed = 3;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  ctx.font = `26px "Segoe UI Symbol", ${FONT}`;
  ctx.textBaseline = "top";
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${(0.15 + rnd() * 0.4).toFixed(2)})`;
    ctx.fillText("♪♫✦·"[Math.floor(rnd() * 4)]!, rnd() * W, rnd() * 720);
  }

  // Titulo.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 68px ${TITLE}`;
  ctx.fillText("RANKING DE PAPUS", W / 2, 100);
  ctx.restore();
  ctx.font = `26px ${FONT}`;
  ctx.fillStyle = "#d9c8ff";
  ctx.fillText(`Los Papus con más nivel del servidor  ·  ${d.date}`, W / 2, 145);
  ctx.textAlign = "left";

  // Podio: luz, figura del Vocaloid parada en su bloque, bloque, numero y Papu sobre el borde.
  for (const p of PLACES) {
    const bot = byPlace[p.place]!;
    const top = FLOOR - p.bh;
    ctx.save();
    ctx.filter = "blur(40px)";
    ctx.beginPath();
    ctx.ellipse(p.cx, top - 210, 190, 190, 0, 0, Math.PI * 2);
    ctx.fillStyle = hexA(d.colors[bot] ?? "#ffffff", 0.35);
    ctx.fill();
    ctx.restore();
    const fig = await tryLoad(path.join(FIGURES, `${bot}_figura.png`));
    if (fig) {
      const s = Math.min(p.fig / fig.height, 330 / fig.width);
      const fw = Math.round(fig.width * s);
      const fh = Math.round(fig.height * s);
      // Se desvanece abajo: lo que sobresale a los lados del bloque no termina en un corte recto.
      const layer = createCanvas(fw, fh);
      const lc = layer.getContext("2d");
      lc.drawImage(fig, 0, 0, fw, fh);
      const fade = lc.createLinearGradient(0, fh - 130, 0, fh - 50);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(1, "rgba(0,0,0,1)");
      lc.globalCompositeOperation = "destination-out";
      lc.fillStyle = fade;
      lc.fillRect(0, fh - 130, fw, 130);
      ctx.drawImage(layer, p.cx - fw / 2, top - fh + 60);
    }
    ctx.fillStyle = gradient(ctx, p.cx - 130, top, 260, [...p.stops]);
    ctx.fillRect(p.cx - 130, top, 260, p.bh);
    ctx.fillStyle = "rgba(255,255,255,0.47)";
    ctx.fillRect(p.cx - 130, top, 260, 8);
    ctx.fillStyle = "rgba(0,0,0,0.27)";
    ctx.font = `bold 96px ${TITLE}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(p.place), p.cx, top + p.bh - 22);
    ctx.textAlign = "left";
    const r = d.rows[p.place - 1];
    if (r) {
      await drawAvatar(ctx, r.avatar, p.cx, top + 6, 55, [...p.stops], 6);
      if (p.place === 1) drawCrown(ctx, p.cx + 52, top - 50, 42);
    }
  }

  // Suelo del escenario y placas con nombre, nivel y rango de los tres primeros.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(0, FLOOR, W, 6);
  ctx.textAlign = "center";
  for (const p of PLACES) {
    const r = d.rows[p.place - 1];
    if (!r) continue;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 30px ${TITLE}`;
    ctx.fillText(fitText(ctx, r.name, 270), p.cx, FLOOR + 52);
    ctx.fillStyle = "#d9c8ff";
    ctx.font = `24px ${FONT}`;
    ctx.fillText(r.prestige > 0 ? `★${r.prestige} · Nivel ${r.level}` : `Nivel ${r.level}`, p.cx, FLOOR + 88);
    drawRankPill(ctx, p.cx, FLOOR + 104, 28, 18, r, "center");
    ctx.textAlign = "center";
  }
  ctx.textAlign = "left";

  // Del 4.º al 10.º y, si no esta entre ellos, quien lo pidio.
  let y = listTop;
  for (const [k, r] of rest.entries()) {
    await drawRow(ctx, y, r, k % 2 ? 0.055 : 0.086, null);
    y += ROW_H;
  }
  if (d.me) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold 22px ${TITLE}`;
    ctx.fillText("· · ·", W / 2, y + 12);
    ctx.textAlign = "left";
    y += 30;
    await drawRow(ctx, y, d.me, 0.12, "#ffe14d");
    y += ROW_H;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#a996d6";
  ctx.font = `20px ${FONT}`;
  ctx.fillText("Gana XP escribiendo y en voz  ·  /nivel para ver tu tarjeta", W / 2, H - 34);
  return canvas.toBuffer("image/png");
}
