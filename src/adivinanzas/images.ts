// Imágenes de «¡Adivina, Papu!» (PLAN §3.17; diseño aprobado por GyroP el 20 nov. 2026, docs/propuestas/adivinanzas):
//   - banner de la adivinanza (se redibuja mientras corre: pozo, tiempo, pistas), normal o dorada;
//   - el que acertó, con lluvia de Shaulitas;
//   - se acabó el tiempo, con la respuesta.
// Todo el texto va centrado por su dibujo y se achica (o pasa a varias líneas) si no cabe.
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { centerText } from "../coins/arte";
import { fitText, FONT, roundRect } from "../levels/card";

const TITLE = `"Bahnschrift", "Noto Sans Display", ${FONT}`;
const TAU = Math.PI * 2;

const fijo = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function fitCenter(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, size: number, min = 14, weight = "bold", family = TITLE) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--s}px ${family}`;
  centerText(ctx, fitText(ctx, text, maxW), cx, cy);
}

function wrap(ctx: SKRSContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** Párrafo centrado que se achica hasta caber en el recuadro (y, si aun así no cabe, recorta la última línea). */
function parrafo(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, maxH: number, size: number, color: string, weight = "bold", family = TITLE) {
  let s = size;
  let lines: string[] = [];
  for (; s >= 16; s--) {
    ctx.font = `${weight} ${s}px ${family}`;
    lines = wrap(ctx, text, maxW);
    if (lines.length * s * 1.28 <= maxH) break;
  }
  const maxLines = Math.max(1, Math.floor(maxH / (s * 1.28)));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = fitText(ctx, `${lines[maxLines - 1]}…`, maxW);
  }
  ctx.fillStyle = color;
  const lh = s * 1.28;
  const top = cy - (lines.length * lh) / 2 + lh / 2;
  lines.forEach((l, i) => centerLine(ctx, fitText(ctx, l, maxW), cx, top + i * lh));
}

/**
 * Centra una línea por su ancho de avance (los emojis de color no traen un contorno fiable y la corrían a un lado) y en
 * vertical por el dibujo de las letras.
 */
function centerLine(ctx: SKRSContext2D, text: string, cx: number, cy: number) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  ctx.fillText(text, cx - m.width / 2, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

function pill(ctx: SKRSContext2D, text: string, cx: number, cy: number, color: string, size = 20, ink = "#ffffff", maxW = 400) {
  let s = size;
  ctx.font = `900 ${s}px ${TITLE}`;
  while (s > 12 && ctx.measureText(text).width + s * 1.6 > maxW) ctx.font = `900 ${--s}px ${TITLE}`;
  const w = ctx.measureText(text).width + s * 1.6;
  const h = size * 1.75;
  ctx.fillStyle = color;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = ink;
  centerText(ctx, text, cx, cy);
  return w;
}

function coin(ctx: SKRSContext2D, x: number, y: number, r: number, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(0.25, Math.abs(Math.cos(rot))), 1);
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, "#FFF2B0");
  g.addColorStop(0.5, "#FFC93C");
  g.addColorStop(1, "#C98A00");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#8A5A00";
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.stroke();
  ctx.fillStyle = "#8A5A00";
  ctx.font = `900 ${r * 1.1}px ${TITLE}`;
  centerText(ctx, "S", 0, 0);
  ctx.restore();
}

function avatar(ctx: SKRSContext2D, img: Image, cx: number, cy: number, r: number, ring: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7, 0, TAU);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function fondo(ctx: SKRSContext2D, w: number, h: number, a: string, b: string, dots = "rgba(255,255,255,0.06)") {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dots;
  ctx.font = `900 46px ${TITLE}`;
  for (let i = 0; i < 40; i++) centerText(ctx, "?", fijo(i) * w, fijo(i + 99) * h);
}

async function cargar(buf: Buffer | null): Promise<Image | null> {
  return buf ? loadImage(buf).catch(() => null) : null;
}

export interface BannerAdivinanza {
  avatar: Buffer | null;
  nombre: string;
  /** #RRGGBB del Vocaloid. */
  color: string;
  categoria: { nombre: string; color: string };
  texto: string;
  /** Shaulitas que se llevaría quien acierte ahora (con bote y dorada). */
  pozo: number;
  pozoMax: number;
  bote: number;
  /** Tiempo corrido y total (ms). */
  ms: number;
  totalMs: number;
  /** Segundos de cada marca de la barra: pista en palabras, tope del pozo, letras. */
  marcas: { palabras: number; tope: number; letras: number };
  /** Pista visible (null = todavía ninguna). */
  pista: string | null;
  dorada: boolean;
}

/** Banner de la adivinanza mientras corre (1200×640). */
export async function bannerAdivinanza(o: BannerAdivinanza): Promise<Buffer> {
  const W = 1200, H = 640;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  if (o.dorada) fondo(ctx, W, H, "#3A2600", "#8A5A00", "rgba(255,230,140,0.10)");
  else fondo(ctx, W, H, "#141026", "#2A1B4A");
  ctx.fillStyle = o.color;
  ctx.fillRect(0, 0, W, 10);
  const img = await cargar(o.avatar);
  if (img) avatar(ctx, img, 130, 130, 80, o.color);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 54px ${TITLE}`;
  ctx.fillText(fitText(ctx, o.dorada ? "¡ADIVINANZA DORADA!" : "¡ADIVINA, PAPU!", 640), 250, 118);
  ctx.font = `bold 24px ${TITLE}`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(fitText(ctx, `${o.nombre} deja una adivinanza al aire`, 600), 252, 160);
  pill(ctx, o.categoria.nombre.toUpperCase(), 1040, 72, o.categoria.color, 22, "#ffffff", 280);
  if (o.dorada) pill(ctx, "POZO ×2", 1040, 130, "#FFC93C", 22, "#3A2600");
  else if (o.bote > 0) pill(ctx, `BOTE +${o.bote}`, 1040, 130, "#D23246", 22);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  roundRect(ctx, 50, 240, W - 100, 190, 26);
  ctx.fill();
  parrafo(ctx, o.texto, W / 2, 335, W - 180, 160, 38, "#1A1330");

  if (o.pista) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, 50, 446, 540, 54, 27);
    ctx.fill();
    ctx.fillStyle = "#FFE38A";
    fitCenter(ctx, o.pista.includes("_") ? o.pista.replace(/(?<=\S) (?=\S)/g, "  ") : o.pista, 320, 473, 500, 26);
  }
  coin(ctx, 640, 473, 26, 0.3);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = `900 38px ${TITLE}`;
  ctx.fillText(fitText(ctx, `${o.pozo} Shaulitas`, 300), 680, 487);
  const quedan = Math.max(0, o.totalMs - o.ms);
  const s = Math.ceil(quedan / 1000);
  pill(ctx, `QUEDAN ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, 1060, 473, "#D23246", 22);

  // Barra del tiempo con las marcas.
  const bx = 70, by = 540, bw = W - 140, bh = 26;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();
  const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, "#FFE38A");
  g.addColorStop(0.5, "#FFC93C");
  g.addColorStop(1, o.dorada ? "#FF6B00" : "#FF8A3D");
  ctx.save();
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(bx, by, bw * Math.min(1, o.ms / o.totalMs), bh);
  ctx.restore();
  const xDe = (sec: number) => bx + (bw * sec * 1000) / o.totalMs;
  ctx.font = `bold 15px ${TITLE}`;
  for (const sec of [o.marcas.palabras, o.marcas.tope, o.marcas.letras]) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(xDe(sec) - 1.5, by - 6, 3, bh + 12);
  }
  // Rótulos; si las dos pistas quedan muy juntas (salen a los pocos segundos), uno solo entre ambas.
  const p1 = xDe(o.marcas.palabras), p2 = xDe(o.marcas.letras);
  const rotulos: [number, string][] = p2 - p1 < 110 ? [[Math.max(bx + 40, (p1 + p2) / 2), "PISTAS"]] : [[p1, "PISTA 1"], [p2, "PISTA 2"]];
  rotulos.push([xDe(o.marcas.tope), "MÁXIMO"]);
  for (const [x, t] of rotulos) centerText(ctx, t, x, by + bh + 20);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  fitCenter(ctx, `Responde aquí en el canal · el pozo sube hasta ${o.pozoMax} mientras nadie acierta`, W / 2, 616, W - 80, 18, 12, "bold", FONT);
  return c.toBuffer("image/png");
}

export interface BannerGanador {
  avatar: Buffer | null;
  color: string;
  papu: string;
  respuesta: string;
  /** "0:48" */
  tiempo: string;
  premio: number;
  /** Adivinanzas que lleva hoy (con esta). */
  hoy: number;
  dorada: boolean;
}

/** El Papu que acertó (1200×520). */
export async function bannerGanador(o: BannerGanador): Promise<Buffer> {
  const W = 1200, H = 520;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  if (o.dorada) fondo(ctx, W, H, "#3A2600", "#8A5A00");
  else fondo(ctx, W, H, "#0E2A22", "#1F5A47");
  for (let i = 0; i < 46; i++) coin(ctx, fijo(i) * W, fijo(i + 7) * H, 10 + fijo(i + 3) * 16, fijo(i + 11) * 6);
  ctx.fillStyle = "rgba(10,20,16,0.82)";
  roundRect(ctx, 80, 50, W - 160, H - 100, 34);
  ctx.fill();
  const img = await cargar(o.avatar);
  if (img) avatar(ctx, img, 200, 200, 80, o.color);
  ctx.fillStyle = o.dorada ? "#FFE38A" : "#7CF2C6";
  fitCenter(ctx, "¡ADIVINADA!", 680, 110, 700, 60, 20, "900");
  ctx.fillStyle = "#ffffff";
  fitCenter(ctx, `${o.papu} la sacó a los ${o.tiempo}`, 680, 180, 700, 36);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  fitCenter(ctx, `Respuesta: ${o.respuesta}`, 680, 232, 700, 28, 14, "bold", FONT);
  // Moneda y premio centrados juntos.
  ctx.font = `900 64px ${TITLE}`;
  const txt = `+${o.premio}`;
  const tw = ctx.measureText(txt).width;
  const total = 80 + 16 + tw;
  const x0 = 680 - total / 2;
  coin(ctx, x0 + 40, 330, 40, 0.2);
  ctx.fillStyle = "#FFE38A";
  ctx.textAlign = "left";
  ctx.fillText(txt, x0 + 96, 352);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 26px ${TITLE}`;
  ctx.fillText("Shaulitas", x0 + 99, 390);
  pill(ctx, `HOY: ${o.hoy} ADIVINADA${o.hoy === 1 ? "" : "S"}`, 200, 350, "#39C5BB", 18, "#06302D", 230);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  fitCenter(ctx, "Esperar pagaba más… pero cualquiera te la podía ganar", W / 2, 440, W - 220, 18, 12, "bold", FONT);
  return c.toBuffer("image/png");
}

export interface BannerNadie {
  avatar: Buffer | null;
  color: string;
  respuesta: string;
  frase: string;
  /** Bote con que saldrá la siguiente (0 = ninguno). */
  bote: number;
}

/** Nadie acertó (1200×420). */
export async function bannerNadie(o: BannerNadie): Promise<Buffer> {
  const W = 1200, H = 420;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  fondo(ctx, W, H, "#2A0F18", "#4A1626");
  const img = await cargar(o.avatar);
  if (img) avatar(ctx, img, 170, 210, 90, o.color);
  ctx.fillStyle = "#FF9AAE";
  fitCenter(ctx, "¡SE ACABÓ EL TIEMPO!", 700, 90, 760, 56, 20, "900");
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  roundRect(ctx, 320, 140, 760, 90, 22);
  ctx.fill();
  ctx.fillStyle = "#4A1626";
  fitCenter(ctx, `Era: ${o.respuesta}`, 700, 185, 700, 44, 18, "900");
  parrafo(ctx, `«${o.frase}»`, 700, 290, 740, 70, 26, "#ffffff", "italic bold", FONT);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  fitCenter(ctx, o.bote > 0 ? `Bote: la siguiente adivinanza sale con +${o.bote} Shaulitas extra` : "La siguiente sale en un rato: ¡atentos!", 700, 370, 740, 18, 12, "bold", FONT);
  return c.toBuffer("image/png");
}
