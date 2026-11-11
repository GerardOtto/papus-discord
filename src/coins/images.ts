// Imágenes de la tienda de las Shaula-coins (PLAN §3.6) que se dibujan al momento: monedero, boleta de transferencia,
// vitrina, colección, paquetes y el GIF de abrir un sobre con lo que salió. Los dibujos fijos (banner, menú, íconos,
// paquetes) están en assets/tienda. El texto nunca se sale de su recuadro y va centrado por el dibujo real de las
// letras (centerText).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import * as gifencModule from "gifenc";
import { FONT, fitText, gradient, rainbowAt, roundRect, sparkles } from "../levels/card";
import { centerText } from "./arte";
import { coleccionImage } from "./equip";
import { RAREZA_COLOR, RAREZA_NOMBRE, TIPO_NOMBRE, type Objeto, type Rareza } from "./rules";
import type { Wallet } from "./service";

const { applyPalette, GIFEncoder, quantize } = "quantize" in gifencModule && typeof gifencModule.quantize === "function" ? gifencModule : gifencModule.default;

export const TIENDA_DIR = path.resolve(import.meta.dirname, "../../assets/tienda");
const BOTS_DIR = path.resolve(import.meta.dirname, "../../assets/bots");
const INK = "#3B2346";
const OSCURO: Record<Rareza, string> = { comun: "#3B4250", rara: "#0C3D3A", epica: "#2E1250", legendaria: "#4A3200", mitica: "#3A0F27", fundador: "#3A2E10", membresia: "#4A1426", contrabando: "#16300C" };
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
const cache = new Map<string, Promise<Image | null>>();

function tiendaImage(rel: string): Promise<Image | null> {
  let p = cache.get(rel);
  if (!p) {
    const file = path.join(TIENDA_DIR, rel);
    p = existsSync(file) ? loadImage(readFileSync(file)).catch(() => null) : Promise.resolve(null);
    cache.set(rel, p);
  }
  return p;
}

/** Pone en ctx.font el mayor tamaño (de `size` a `min`) con el que `text` cabe en `maxW`. */
function fitFont(ctx: SKRSContext2D, text: string, maxW: number, size: number, min: number, weight = "bold"): number {
  for (let s = size; s > min; s--) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return s;
  }
  ctx.font = `${weight} ${min}px ${FONT}`;
  return min;
}

/** Corta en líneas de hasta `maxW` (fuente actual); si no cabe en `maxLines`, la última lleva «…». */
function wrapLines(ctx: SKRSContext2D, text: string, maxW: number, maxLines: number): string[] {
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

/** Píldora centrada con el texto centrado de verdad; la letra se achica si no cabe. */
function pill(ctx: SKRSContext2D, text: string, cx: number, cy: number, o: { size: number; min: number; maxW: number; h: number; bg: string | ReturnType<typeof gradient>; fg: string }) {
  fitFont(ctx, text, o.maxW - o.h, o.size, o.min);
  const w = Math.min(o.maxW, ctx.measureText(text).width + o.h);
  roundRect(ctx, cx - w / 2, cy - o.h / 2, w, o.h, o.h / 2);
  ctx.fillStyle = o.bg as string;
  ctx.fill();
  ctx.fillStyle = o.fg;
  centerText(ctx, text, cx, cy);
}

async function coin(ctx: SKRSContext2D, cx: number, cy: number, r: number) {
  const img = await tiendaImage("iconos/moneda.png");
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
}

// ───────────────────────── carta de objeto (vitrina, sobre, colección) ─────────────────────────

export interface CartaOpts {
  /** Píldora de abajo: precio (con moneda), o un texto (¡NUEVO!, REPETIDO…). */
  precio?: number;
  estado?: string;
  /** Aviso arriba de la píldora (Solo ganadas, Ya lo tienes). */
  aviso?: { texto: string; color: string };
  bloqueado?: boolean;
}

async function carta(ctx: SKRSContext2D, o: Objeto, x: number, y: number, w: number, h: number, opts: CartaOpts = {}) {
  const color = RAREZA_COLOR[o.rareza];
  ctx.save();
  ctx.shadowColor = o.rareza === "comun" ? "rgba(0,0,0,0.4)" : color;
  ctx.shadowBlur = o.rareza === "comun" ? 12 : 26;
  roundRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = "#1d1928";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, 20);
  ctx.lineWidth = 5;
  ctx.strokeStyle = o.rareza === "mitica" ? rainbowAt(ctx, x, w, 0) : color;
  ctx.stroke();
  const pad = 14, inner = w - pad * 2, cx = x + w / 2;
  const artH = Math.min(inner, Math.round(h * 0.46));
  const mini = await coleccionImage(`miniaturas/${o.id}.png`);
  ctx.save();
  roundRect(ctx, cx - artH / 2, y + pad, artH, artH, 16);
  ctx.clip();
  if (mini) ctx.drawImage(mini, cx - artH / 2, y + pad, artH, artH);
  else {
    ctx.fillStyle = OSCURO[o.rareza];
    ctx.fillRect(cx - artH / 2, y + pad, artH, artH);
  }
  if (opts.bloqueado) {
    ctx.fillStyle = "rgba(10,8,18,0.7)";
    ctx.fillRect(cx - artH / 2, y + pad, artH, artH);
  }
  ctx.restore();

  const footH = opts.precio !== undefined || opts.estado ? 32 : 0;
  const footY = y + h - pad - footH / 2 - 2;
  const avisoH = opts.aviso ? 22 : 0;
  const top = y + pad + artH + 8, bottom = (footH ? footY - footH / 2 : y + h - pad) - (avisoH ? avisoH + 6 : 0) - 6;
  const chipH = 22, gap = 6;
  const typeSize = fitFont(ctx, TIPO_NOMBRE[o.tipo], inner, 14, 10, "600");
  let nameSize = 22, lines: string[] = [];
  for (; nameSize >= 14; nameSize--) {
    ctx.font = `bold ${nameSize}px ${FONT}`;
    lines = wrapLines(ctx, o.nombre, inner, 2);
    if (!lines.some((l) => l.endsWith("…"))) break;
  }
  nameSize = Math.max(nameSize, 14);
  const lineH = Math.round(nameSize * 1.18);
  const total = chipH + gap + typeSize + gap + lines.length * lineH;
  let cy = top + Math.max(0, (bottom - top - total) / 2);
  pill(ctx, RAREZA_NOMBRE[o.rareza].toUpperCase(), cx, cy + chipH / 2, {
    size: 13, min: 9, maxW: inner, h: chipH,
    bg: o.rareza === "mitica" ? rainbowAt(ctx, x, w, 0) : color,
    fg: o.rareza === "comun" || o.rareza === "legendaria" || o.rareza === "fundador" || o.rareza === "membresia" || o.rareza === "contrabando" ? OSCURO[o.rareza] : "#ffffff",
  });
  cy += chipH + gap;
  ctx.font = `600 ${typeSize}px ${FONT}`;
  ctx.fillStyle = "rgba(230,224,240,0.75)";
  centerText(ctx, TIPO_NOMBRE[o.tipo], cx, cy + typeSize / 2);
  cy += typeSize + gap;
  ctx.font = `bold ${nameSize}px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  for (const l of lines) {
    centerText(ctx, l, cx, cy + lineH / 2);
    cy += lineH;
  }
  if (opts.aviso) pill(ctx, opts.aviso.texto, cx, (footH ? footY - footH / 2 : y + h - pad) - 6 - avisoH / 2, { size: 13, min: 9, maxW: inner, h: avisoH, bg: opts.aviso.color, fg: "#0E2A1A" });
  if (opts.estado) {
    const nuevo = opts.estado.startsWith("¡");
    pill(ctx, opts.estado, cx, footY, { size: 16, min: 10, maxW: inner, h: footH, bg: nuevo ? "#3DDC84" : "rgba(255,255,255,0.14)", fg: nuevo ? "#06301A" : "#E6E0F0" });
  } else if (opts.precio !== undefined) {
    const label = fmt(opts.precio);
    fitFont(ctx, label, inner - 60, 20, 12);
    const r = 12, tw = ctx.measureText(label).width, group = r * 2 + 6 + tw, pw = Math.min(inner, group + 28);
    roundRect(ctx, cx - pw / 2, footY - footH / 2, pw, footH, footH / 2);
    ctx.fillStyle = "#2b2140";
    ctx.fill();
    await coin(ctx, cx - group / 2 + r, footY, r);
    ctx.fillStyle = "#FFE9A8";
    centerText(ctx, label, cx - group / 2 + r * 2 + 6 + tw / 2, footY);
  }
}

function darkBg(ctx: SKRSContext2D, W: number, H: number) {
  const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, "#3a1d4f");
  g.addColorStop(1, "#120d1a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  sparkles(ctx, 0, 0, W, H, 50);
}

// ───────────────────────── monedero ─────────────────────────

export async function monederoImage(nombre: string, w: Wallet, garantiaEpica: number, topeHoy: number): Promise<Buffer> {
  const W = 1000, H = 400;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  roundRect(ctx, 6, 6, W - 12, H - 12, 36);
  ctx.fillStyle = "#FFF7FB";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  const icon = await tiendaImage("iconos/monedero.png");
  if (icon) ctx.drawImage(icon, 30, 22, 110, 110);
  ctx.fillStyle = INK;
  fitFont(ctx, `Monedero de ${nombre}`, W - 200, 40, 22, "900");
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(fitText(ctx, `Monedero de ${nombre}`, W - 200), 160, 92);
  const pockets: [string, number, string, string][] = [
    ["Ganadas", w.ganadas, "sobres y toda la tienda", "#BFF3E8"],
    ["Compradas", w.compradas, "solo arte propio", "#FFF1C2"],
    ["Ecos", w.ecos, "para fabricar", "#DCCBFF"],
  ];
  for (let i = 0; i < pockets.length; i++) {
    const [label, value, sub, bg] = pockets[i]!;
    const x = 40 + i * 315, y = 140;
    roundRect(ctx, x, y, 290, 120, 24);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (i < 2) await coin(ctx, x + 50, y + 60, 30);
    else {
      const s = await tiendaImage("iconos/sobre.png");
      if (s) ctx.drawImage(s, x + 18, y + 28, 64, 64);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillStyle = "rgba(59,35,70,0.75)";
    ctx.fillText(label, x + 96, y + 40);
    fitFont(ctx, fmt(value), 180, 44, 22, "900");
    ctx.fillStyle = INK;
    ctx.fillText(fmt(value), x + 96, y + 86);
    ctx.font = `600 16px ${FONT}`;
    ctx.fillStyle = "rgba(59,35,70,0.6)";
    ctx.fillText(fitText(ctx, sub, 185), x + 96, y + 108);
  }
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText(`Hoy ganaste ${w.hoy} participando (tope por chat y voz: ${topeHoy})`, 40, 300);
  ctx.fillText(`Sobres gratis: ${w.gratis}`, 40, 340);
  ctx.fillText(`Garantía Épica: ${w.sinEpica % garantiaEpica} de ${garantiaEpica}`, 400, 340);
  for (let i = 0; i < garantiaEpica; i++) {
    roundRect(ctx, 690 + i * 27, 322, 22, 24, 6);
    ctx.fillStyle = i < w.sinEpica % garantiaEpica ? "#B36BFF" : "#EDE3FA";
    ctx.fill();
  }
  return c.toBuffer("image/png");
}

// ───────────────────────── boleta de transferencia ─────────────────────────

export interface DatosBanco {
  banco: string;
  tipo: string;
  numero: string;
  rut: string;
  nombre: string;
  correo: string;
}

export async function boletaImage(codigo: string, paquete: string, monedas: number, clp: number, banco: DatosBanco): Promise<Buffer> {
  const W = 760, H = 700;
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
  const icon = await tiendaImage("iconos/banco.png");
  if (icon) ctx.drawImage(icon, 46, 40, 100, 100);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 36px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText("Transferencia en Chile", 160, 86);
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = "rgba(59,35,70,0.65)";
  ctx.fillText(fitText(ctx, `${paquete} · ${fmt(monedas)} Shaula-coins`, W - 220), 160, 118);
  const rows: [string, string][] = [
    ["Monto", `$${fmt(clp)} CLP`],
    ["Nombre", banco.nombre],
    ["RUT", banco.rut],
    ["Banco", banco.banco],
    ["Tipo de cuenta", banco.tipo],
    ["N.º de cuenta", banco.numero],
    ["Correo", banco.correo],
  ];
  rows.forEach(([k, v], i) => {
    const y = 180 + i * 46;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = "rgba(59,35,70,0.6)";
    ctx.fillText(k, 60, y);
    ctx.font = `bold 24px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(fitText(ctx, v, W - 330), 270, y);
    ctx.strokeStyle = "rgba(59,35,70,0.15)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(60, y + 16);
    ctx.lineTo(W - 60, y + 16);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  roundRect(ctx, 60, 520, W - 120, 96, 20);
  ctx.fillStyle = "#FFF1C2";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText("Escribe esto en el comentario de la transferencia:", 84, 556);
  ctx.font = `900 40px ${FONT}`;
  ctx.fillStyle = "#E91E63";
  ctx.fillText(codigo, 84, 600);
  return c.toBuffer("image/png");
}

// ───────────────────────── vitrina ─────────────────────────

export interface VitrinaCarta {
  objeto: Objeto;
  precio: number;
  propio: boolean;
}

export async function vitrinaImage(cartas: VitrinaCarta[], titulo: string, subtitulo: string): Promise<Buffer> {
  const cols = 5, cw = 220, ch = 380, gap = 18, W = cols * cw + (cols - 1) * gap + 60;
  const rows = Math.ceil(cartas.length / cols);
  const H = 130 + rows * (ch + gap) + 20;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = gradient(ctx, 0, 0, W, ["#0f2a2a", "#1b1328", "#2a0f1f"]);
  ctx.fillRect(0, 0, W, H);
  sparkles(ctx, 0, 0, W, 120, 30);
  await coin(ctx, 70, 64, 40);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, titulo, W - 160, 42, 24, "900");
  ctx.fillText(titulo, 128, 64);
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = "#CFC4E3";
  ctx.fillText(fitText(ctx, subtitulo, W - 160), 130, 98);
  for (let i = 0; i < cartas.length; i++) {
    const v = cartas[i]!;
    const x = 30 + (i % cols) * (cw + gap), y = 130 + Math.floor(i / cols) * (ch + gap);
    await carta(ctx, v.objeto, x, y, cw, ch, {
      precio: v.propio ? undefined : v.precio,
      estado: v.propio ? "Ya lo tienes" : undefined,
      aviso: v.objeto.origen === "render" ? { texto: "Solo ganadas", color: "#3DDC84" } : undefined,
    });
  }
  return c.toBuffer("image/png");
}

// ───────────────────────── colección ─────────────────────────

export async function coleccionSheet(objetos: Objeto[], owned: Set<string>, titulo: string): Promise<Buffer> {
  const cols = 6, cell = 150, pad = 24, nameH = 44;
  const rows = Math.max(1, Math.ceil(objetos.length / cols));
  const W = pad * 2 + cols * cell, H = 90 + rows * (cell + nameH);
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#14111c";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, titulo, W - 2 * pad, 30, 18, "900");
  ctx.fillText(titulo, pad, 52);
  for (let i = 0; i < objetos.length; i++) {
    const o = objetos[i]!;
    const x = pad + (i % cols) * cell, y = 80 + Math.floor(i / cols) * (cell + nameH);
    const mini = await coleccionImage(`miniaturas/${o.id}.png`);
    ctx.save();
    roundRect(ctx, x + 8, y, cell - 16, cell - 16, 16);
    ctx.clip();
    if (mini) ctx.drawImage(mini, x + 8, y, cell - 16, cell - 16);
    if (!owned.has(o.id)) {
      ctx.fillStyle = "rgba(10,8,18,0.72)";
      ctx.fillRect(x + 8, y, cell - 16, cell - 16);
      ctx.font = `40px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      centerText(ctx, "?", x + cell / 2, y + (cell - 16) / 2);
    }
    ctx.restore();
    ctx.fillStyle = owned.has(o.id) ? "#E6E0F0" : "#7d7196";
    const size = fitFont(ctx, o.nombre, cell - 12, 14, 10, "600");
    wrapLines(ctx, o.nombre, cell - 12, 2).forEach((l, li) => centerText(ctx, l, x + cell / 2, y + cell - 4 + li * (size + 3)));
  }
  return c.toBuffer("image/png");
}

// ───────────────────────── paquetes ─────────────────────────

/**
 * Varias imágenes una debajo de la otra, al mismo ancho, en una sola: Discord muestra en galería (recortadas, lado a
 * lado) las imágenes de un mismo mensaje (lo notó GyroP en «Mi colección», 27 oct. 2026).
 */
export async function stackImages(bufs: Buffer[], width = 1000): Promise<Buffer> {
  const imgs = await Promise.all(bufs.map((b) => loadImage(b)));
  const heights = imgs.map((im) => Math.round((im.height * width) / im.width));
  const c = createCanvas(width, heights.reduce((a, h) => a + h, 0));
  const ctx = c.getContext("2d");
  let y = 0;
  imgs.forEach((im, i) => {
    ctx.drawImage(im, 0, y, width, heights[i]!);
    y += heights[i]!;
  });
  return c.toBuffer("image/png");
}

let menuCache: Promise<Buffer> | null = null;

/**
 * Banner y menú ilustrado en una sola imagen vertical (el mensaje fijado de la tienda): con dos imágenes en el mismo
 * mensaje, Discord las junta en una galería lado a lado y dejan de verse como banner (lo notó GyroP, 27 oct. 2026).
 */
export function menuTiendaImage(): Promise<Buffer> {
  menuCache ??= (async () => {
    const [banner, menu] = await Promise.all([tiendaImage("banner.png"), tiendaImage("menu.png")]);
    const W = 1200;
    const bh = banner ? Math.round((banner.height * W) / banner.width) : 0;
    const mh = menu ? Math.round((menu.height * W) / menu.width) : 0;
    const c = createCanvas(W, bh + mh);
    const ctx = c.getContext("2d");
    if (banner) ctx.drawImage(banner, 0, 0, W, bh);
    if (menu) ctx.drawImage(menu, 0, bh, W, mh);
    return c.toBuffer("image/png");
  })();
  return menuCache;
}

let paquetesCache: Promise<Buffer> | null = null;

/** Los paquetes lado a lado (una imagen fija, se arma una vez). */
export function paquetesImage(ids: string[]): Promise<Buffer> {
  paquetesCache ??= (async () => {
    const S = 420, gap = 16;
    const c = createCanvas(ids.length * S + (ids.length - 1) * gap, S);
    const ctx = c.getContext("2d");
    for (let i = 0; i < ids.length; i++) {
      const img = await tiendaImage(`paquetes/${ids[i]}.png`);
      if (img) ctx.drawImage(img, i * (S + gap), 0, S, S);
    }
    return c.toBuffer("image/png");
  })();
  return paquetesCache;
}

// ───────────────────────── abrir un sobre (GIF) ─────────────────────────

function drawSobre(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, fig: Image | null) {
  ctx.save();
  ctx.shadowColor = "rgba(255,95,162,0.5)";
  ctx.shadowBlur = 40;
  ctx.beginPath();
  const teeth = 18, tw = w / teeth;
  ctx.moveTo(x, y + 14);
  for (let i = 0; i < teeth; i++) ctx.lineTo(x + tw * (i + 0.5), y), ctx.lineTo(x + tw * (i + 1), y + 14);
  ctx.lineTo(x + w, y + h - 14);
  for (let i = teeth; i > 0; i--) ctx.lineTo(x + tw * (i - 0.5), y + h), ctx.lineTo(x + tw * (i - 1), y + h - 14);
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
  sparkles(ctx, x, y, w, h, 30);
  if (fig) {
    const fh = h * 0.62, fw = (fig.width / fig.height) * fh;
    ctx.drawImage(fig, x + (w - fw) / 2, y + h - fh - 70, fw, fh);
  }
  ctx.restore();
  ctx.fillStyle = "rgba(20,10,30,0.55)";
  ctx.fillRect(x, y + 40, w, 96);
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, "SOBRE PAPU", w - 40, 46, 20, "900");
  centerText(ctx, "SOBRE PAPU", x + w / 2, y + 74);
  ctx.fillStyle = "#FFE9A8";
  fitFont(ctx, "Temporada 1 · Lanzamiento", w - 40, 20, 12);
  centerText(ctx, "Temporada 1 · Lanzamiento", x + w / 2, y + 114);
}

/** El sobre tiembla, destella y aparecen los objetos uno por uno; queda quieto en el último cuadro. */
export async function sobreGif(objetos: { objeto: Objeto; nuevo: boolean; ecos: number }[], titulo = "¡Sobre abierto!"): Promise<Buffer> {
  const n = objetos.length, cw = 190, ch = 340, gap = 18;
  const W = Math.max(760, n * cw + (n - 1) * gap + 60), H = 470;
  const fig = await loadImage(readFileSync(path.join(BOTS_DIR, "teto_figura.png"))).catch(() => null);
  // Las cartas se dibujan una vez (con sus imágenes) y cada cuadro solo las mueve.
  const cards = await Promise.all(
    objetos.map(async (r) => {
      const cc = createCanvas(cw + 40, ch + 40);
      await carta(cc.getContext("2d"), r.objeto, 20, 20, cw, ch, { estado: r.nuevo ? "¡NUEVO!" : `REPETIDO · +${r.ecos} Ecos` });
      return cc;
    }),
  );
  const SHAKE = 10, FLASH = 4, PER = 5, frames = SHAKE + FLASH + n * PER + 1;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  const datas: Uint8ClampedArray[] = [];
  for (let i = 0; i < frames; i++) {
    ctx.save();
    darkBg(ctx, W, H);
    if (i < SHAKE + FLASH / 2) {
      const amp = i < SHAKE ? 3 + i * 1.2 : 0;
      ctx.translate(W / 2 + Math.sin(i * 2.4) * amp, H / 2);
      ctx.rotate(Math.sin(i * 1.7) * amp * 0.004);
      ctx.scale(0.58, 0.58);
      drawSobre(ctx, -220, -350, 440, 700, fig);
    }
    ctx.restore();
    if (i >= SHAKE && i < SHAKE + FLASH) {
      ctx.fillStyle = `rgba(255,255,255,${1 - (i - SHAKE) / FLASH})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (i >= SHAKE + FLASH / 2) {
      const x0 = (W - (n * cw + (n - 1) * gap)) / 2;
      const k = i - SHAKE - FLASH / 2;
      cards.forEach((card, j) => {
        const p = Math.min(1, (k - j * PER) / PER);
        if (p < 0) return;
        ctx.save();
        ctx.globalAlpha = Math.min(1, p * 1.5);
        ctx.drawImage(card, x0 + j * (cw + gap) - 20, 80 - 20 + (1 - (1 - (1 - p) ** 3)) * 60);
        ctx.restore();
      });
      ctx.fillStyle = "#ffffff";
      fitFont(ctx, titulo, W - 40, 32, 18, "900");
      centerText(ctx, titulo, W / 2, 44);
    }
    datas.push(ctx.getImageData(0, 0, W, H).data);
  }
  const sample: number[] = [];
  for (let f = 0; f < frames; f += Math.max(1, Math.floor(frames / 4))) {
    const d = datas[f]!;
    for (let p = 0; p < d.length; p += 32) sample.push(d[p]!, d[p + 1]!, d[p + 2]!, d[p + 3]!);
  }
  const last = datas[frames - 1]!;
  for (let p = 0; p < last.length; p += 16) sample.push(last[p]!, last[p + 1]!, last[p + 2]!, last[p + 3]!);
  const palette = quantize(new Uint8ClampedArray(sample), 256);
  const gif = GIFEncoder();
  datas.forEach((d, i) => gif.writeFrame(applyPalette(d, palette), W, H, { palette: i === 0 ? palette : undefined, delay: i === frames - 1 ? 4000 : i < SHAKE ? 60 : 70, repeat: i === 0 ? -1 : undefined }));
  gif.finish();
  return Buffer.from(gif.bytes());
}
