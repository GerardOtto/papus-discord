// Temporada 1 «Lanzamiento» de las Shaula-coins (propuesta.html, sección 4b): fondos de tarjeta hechos con los renders
// de Diva-a-Render, con la rareza según qué tan histórica o viral es la canción del traje (pedido de GyroP, 26 oct.
// 2026), más el paquete exclusivo de los Papus fundadores. Dibuja cada fondo, su miniatura para la tienda y la tarjeta
// de nivel real con ese fondo (src/levels/card.ts), y guarda el catálogo en temporada1.json.
// Uso: node --import tsx docs/propuestas/shaula-coins/fuente/temporada1.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { CARD_H, CARD_W, FONT, RAINBOW, gradient, renderCard, roundRect, sparkles } from "../../../../src/levels/card";
import { RAREZAS, fitFont, rainbowAt, wrapLines, type Rareza } from "./maquetas";
import { centerText, ficha } from "./monedas";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const DIVA = path.resolve(root, "../Diva-a-Render/DivaRenders/output");
const out = path.resolve(here, "../imagenes/temporada1");
for (const d of ["fondos", "miniaturas", "tarjetas", "fundadores"]) fs.mkdirSync(path.join(out, d), { recursive: true });

type Tema = "palacio" | "gemelos" | "baka" | "halloween" | "escenario" | "pastel" | "rayos" | "estreno";

interface Item {
  id: string;
  nombre: string;
  rareza: Rareza | "fundador";
  /** Renders de Diva-a-Render, de adelante hacia atrás (rutas relativas a DivaRenders/output). */
  pjs: string[];
  tema: Tema;
  /** Colores del fondo (de las Vocaloids o de la canción). */
  colores: string[];
  /** Por qué tiene esa rareza (canción, historia o motivo). */
  motivo: string;
  limitado?: string;
}

const C = { mik: "#39C5BB", tet: "#E0457B", luk: "#F2A2C0", ner: "#E8C547", rin: "#F5C542", len: "#F2D25C", kai: "#3D6FD9", mei: "#D9473D", hak: "#B8B8D0" };

export const TEMPORADA1: Item[] = [
  // Mítica: la historia que más se contó en el canal, los dos gemelos juntos.
  { id: "gemelos-del-mal", nombre: "Gemelos del mal", rareza: "mitica", tema: "gemelos", colores: ["#F28C28", "#F2D25C"], pjs: ["eden/rin_riliane/rin/rin_presumido.png", "eden/len_allen/len/len_neutral.png"], motivo: "Daughter of Evil + Servant of Evil (mothy, 2008): la saga que más contaste en el canal, con los dos gemelos juntos." },
  // Legendarias: canciones históricas.
  { id: "la-hija-del-mal", nombre: "La hija del mal", rareza: "legendaria", tema: "palacio", colores: ["#F28C28", "#7A1F1F"], pjs: ["eden/rin_riliane/rin/rin_presumido.png"], motivo: "Rin como Riliane: Daughter of Evil (2008), clásico de la historia de Vocaloid y cap. 1 de tu serie." },
  { id: "el-sirviente-del-mal", nombre: "El sirviente del mal", rareza: "legendaria", tema: "palacio", colores: ["#F2D25C", "#3B2A12"], pjs: ["eden/len_allen/len/len_neutral.png"], motivo: "Len como Allen: Servant of Evil (2008), la otra mitad de la historia y cap. 3 de tu serie." },
  { id: "triple-baka", nombre: "Triple Baka", rareza: "legendaria", tema: "baka", colores: ["#39C5BB", "#E0457B", "#E8C547"], pjs: ["gestos/tet/tet_02_paz_ojo.png", "gestos/mik/mik_03_doble_v.png", "gestos/ner/ner_04_pulgar.png"], motivo: "Miku, Teto y Neru: el trío meme de Vocaloid y el nombre de tu nivel más alto de Ko-fi." },
  // Épicas: el resto del elenco de la saga, el intercambio, la familia Crypton y el especial de Halloween.
  { id: "principe-azul", nombre: "El príncipe azul", rareza: "epica", tema: "palacio", colores: ["#3D6FD9", "#101A3A"], pjs: ["looks_saga_final/kai/kai_presumido.png"], motivo: "Kaito como Kyle, el príncipe del país azul (saga del mal, módulo Requiem)." },
  { id: "chica-del-pais-verde", nombre: "La chica del país verde", rareza: "epica", tema: "palacio", colores: ["#39C5BB", "#123B2A"], pjs: ["looks_saga_noble/mik/mik_feliz.png"], motivo: "Miku como Michaela (saga del mal, módulo Noble)." },
  { id: "espadachina-roja", nombre: "La espadachina roja", rareza: "epica", tema: "palacio", colores: ["#D9473D", "#2A0D0D"], pjs: ["looks_saga_final/mei/mei_presumido.png"], motivo: "Meiko como Germaine (saga del mal, módulo Blazing)." },
  { id: "el-intercambio", nombre: "El intercambio", rareza: "epica", tema: "gemelos", colores: ["#F2D25C", "#F28C28"], pjs: ["eden/rin_allen/rin/rin_neutral.png", "eden/len_riliane/len/len_timido.png"], motivo: "Rin vestida de sirviente y Len de princesa: el giro final de Servant of Evil (cap. 5 y 6 de tu serie)." },
  { id: "familia-crypton", nombre: "Familia Crypton", rareza: "epica", tema: "escenario", colores: ["#2A1B4D", "#0D0A1A"], pjs: ["gestos/mik/mik_01_saludo.png", "gestos/rin/rin_03_doble_v.png", "gestos/len/len_04_pulgar.png", "gestos/luk/luk_02_paz_ojo.png", "gestos/kai/kai_07_animo.png", "gestos/mei/mei_01_saludo.png"], motivo: "Los seis de Crypton juntos en el escenario." },
  { id: "halloween-elluka", nombre: "Noche de brujas", rareza: "epica", tema: "halloween", colores: ["#3A1458", "#F28C28"], pjs: ["looks_saga_lukafix/luk/luk_pensando.png"], motivo: "Especial de Halloween: Luka como la bruja Elluka (módulo Majokko).", limitado: "Solo la semana de Halloween (del 27 oct. al 2 nov.) de cada año." },
  // Raras: poses especiales (gestos) de cada Vocaloid.
  ...([
    ["teto-saludo", "Teto saluda", "gestos/tet/tet_01_saludo.png", C.tet],
    ["miku-doble-v", "Miku doble V", "gestos/mik/mik_03_doble_v.png", C.mik],
    ["luka-guino", "Luka guiña", "gestos/luk/luk_02_paz_ojo.png", C.luk],
    ["neru-pulgar", "Neru aprueba", "gestos/ner/ner_04_pulgar.png", C.ner],
    ["rin-gato", "Rin gatita", "gestos/rin/rin_11_gato.png", C.rin],
    ["len-animo", "Len da ánimo", "gestos/len/len_07_animo.png", C.len],
    ["kaito-shh", "Kaito: ¡shh!", "gestos/kai/kai_10_shh.png", C.kai],
    ["meiko-senala", "Meiko te señala", "gestos/mei/mei_09_senalar.png", C.mei],
    ["haku-mejillas", "Haku tímida", "gestos/hak/hak_06_mejillas.png", C.hak],
  ] as const).map(([id, nombre, pj, color]): Item => ({ id, nombre, rareza: "rara", tema: "rayos", colores: [color, "#1A1426"], pjs: [pj], motivo: "Pose especial con el traje original." })),
  // Comunes: el traje original de cada Vocaloid.
  ...([
    ["teto-original", "Teto", "avatares_v3/tet/tet_01.png", C.tet],
    ["miku-original", "Miku", "avatares_v3/mik/mik_01.png", C.mik],
    ["luka-original", "Luka", "avatares_v3/luk/luk_09.png", C.luk],
    ["neru-original", "Neru", "avatares_v3/ner/ner_09.png", C.ner],
    ["rin-original", "Rin", "avatares_v3/rin/rin_07.png", C.rin],
    ["len-original", "Len", "avatares_v3/len/len_04.png", C.len],
    ["kaito-original", "Kaito", "avatares_v3/kai/kai_01.png", C.kai],
    ["meiko-original", "Meiko", "avatares_v3/mei/mei_07.png", C.mei],
    ["haku-original", "Haku", "avatares_v3/hak/hak_03.png", C.hak],
  ] as const).map(([id, nombre, pj, color]): Item => ({ id, nombre: `${nombre} clásica`.replace(/^(Len|Kaito) clásica$/, "$1 clásico"), rareza: "comun", tema: "pastel", colores: [color, "#FFFFFF"], pjs: [pj], motivo: "Traje original: el diseño con el que debutó." })),
];

export const FUNDADORES: Item = {
  id: "noche-de-estreno",
  nombre: "Noche de estreno",
  rareza: "fundador",
  tema: "estreno",
  colores: ["#0D0A2A", "#2A1B4D"],
  pjs: ["gestos/luk/luk_07_animo.png", "gestos/mik/mik_03_doble_v.png", "gestos/tet/tet_01_saludo.png", "gestos/ner/ner_03_doble_v.png"],
  motivo: "Teto, Miku, Luka y Neru la noche en que abrió el servidor (17 oct. 2026). Nunca se vende ni sale en sobres.",
};

const FUND_COLOR = "#F6E7B0";
const rcolor = (r: Item["rareza"]) => (r === "fundador" ? FUND_COLOR : RAREZAS[r].color);
const rname = (r: Item["rareza"]) => (r === "fundador" ? "Fundador" : RAREZAS[r].nombre);

function save(rel: string, buf: Buffer) {
  fs.writeFileSync(path.join(out, rel), buf);
  console.log(`ok imagenes/temporada1/${rel} (${Math.round(buf.length / 1024)} KB)`);
}

// ── Renders: recorte al contorno real (el PNG trae mucho aire transparente) ─────────────────────
interface Pj {
  img: Image;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

async function loadPj(rel: string): Promise<Pj> {
  const file = path.join(DIVA, rel);
  if (!fs.existsSync(file)) throw new Error(`Falta el render ${rel}`);
  const img = await loadImage(fs.readFileSync(file));
  // Caja del personaje: se mide sobre una copia chica (rápido) y se escala.
  const s = 256 / Math.max(img.width, img.height);
  const w = Math.round(img.width * s), h = Math.round(img.height * s);
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const a = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (a[(y * w + x) * 4 + 3]! > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { img, sx: x0 / s, sy: y0 / s, sw: (x1 - x0 + 1) / s, sh: (y1 - y0 + 1) / s };
}

/** Dibuja el personaje con la cabeza a `top`, centrado en `cx`, de alto `h` (lo que sobra abajo se corta). */
function drawPj(ctx: SKRSContext2D, p: Pj, cx: number, top: number, h: number, glow?: string) {
  const scale = h / p.sh;
  const w = p.sw * scale;
  ctx.save();
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 28;
  }
  ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, cx - w / 2, top, w, h);
  ctx.restore();
}

// ── Temas de fondo ──────────────────────────────────────────────────────────────────────────
function lattice(ctx: SKRSContext2D, w: number, h: number, color: string, step = 44) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let x = -h; x < w + h; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
    ctx.moveTo(x + h, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.restore();
}

function halo(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string) {
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function rays(ctx: SKRSContext2D, cx: number, cy: number, n: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 900, a, a + Math.PI / n);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function polka(ctx: SKRSContext2D, w: number, h: number, color: string, step = 34) {
  ctx.fillStyle = color;
  for (let y = 0, row = 0; y < h + step; y += step * 0.8, row++)
    for (let x = row % 2 ? step / 2 : 0; x < w + step; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
}

function bat(ctx: SKRSContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.5, x - s, y - s * 0.1);
  ctx.quadraticCurveTo(x - s * 0.7, y, x - s * 0.6, y + s * 0.25);
  ctx.quadraticCurveTo(x - s * 0.3, y + s * 0.05, x, y + s * 0.3);
  ctx.quadraticCurveTo(x + s * 0.3, y + s * 0.05, x + s * 0.6, y + s * 0.25);
  ctx.quadraticCurveTo(x + s * 0.7, y, x + s, y - s * 0.1);
  ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.5, x, y);
  ctx.fill();
}

function pumpkin(ctx: SKRSContext2D, x: number, y: number, r: number) {
  ctx.save();
  for (const dx of [-0.45, 0.45, 0]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * r, y, r * 0.62, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = dx === 0 ? "#F59A2E" : "#D9751C";
    ctx.fill();
  }
  ctx.fillStyle = "#3D7A2A";
  ctx.fillRect(x - r * 0.08, y - r * 1.05, r * 0.16, r * 0.3);
  ctx.fillStyle = "#3A1A05";
  for (const dx of [-0.3, 0.3]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * r - r * 0.12, y - r * 0.1);
    ctx.lineTo(x + dx * r + r * 0.12, y - r * 0.1);
    ctx.lineTo(x + dx * r, y - r * 0.32);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.3, r * 0.4, r * 0.14, 0, 0, Math.PI);
  ctx.fill();
  ctx.restore();
}

function paintTheme(ctx: SKRSContext2D, it: Item, W: number, H: number) {
  const [a, b, c] = it.colores;
  switch (it.tema) {
    case "palacio": {
      ctx.fillStyle = gradient(ctx, 0, 0, W, [b!, a!]);
      ctx.fillRect(0, 0, W, H);
      lattice(ctx, W, H, "rgba(255,215,120,0.16)");
      halo(ctx, W * 0.78, H * 0.45, H * 0.9, "rgba(255,230,160,0.55)");
      sparkles(ctx, W * 0.45, 0, W * 0.55, H, 26, "#FFE9A8");
      break;
    }
    case "gemelos": {
      ctx.fillStyle = gradient(ctx, 0, 0, W, ["#1A0E05", a!, "#1A0E05", b!]);
      ctx.fillRect(0, 0, W, H);
      lattice(ctx, W, H, "rgba(255,215,120,0.14)");
      halo(ctx, W * 0.64, H * 0.45, H * 0.8, "rgba(255,190,120,0.5)");
      halo(ctx, W * 0.86, H * 0.45, H * 0.8, "rgba(255,240,150,0.5)");
      sparkles(ctx, W * 0.45, 0, W * 0.55, H, 34, "#FFE9A8");
      break;
    }
    case "baka": {
      const stripe = 46;
      for (let x = -H, i = 0; x < W + H; x += stripe, i++) {
        ctx.fillStyle = [a!, b!, c!][i % 3]!;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + stripe, 0);
        ctx.lineTo(x + stripe - H, H);
        ctx.lineTo(x - H, H);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.font = `900 30px ${FONT}`;
      ctx.fillStyle = "rgba(60,30,80,0.12)";
      for (let y = 30, r = 0; y < H + 30; y += 46, r++) for (let x = r % 2 ? -40 : 0; x < W; x += 130) ctx.fillText("BAKA", x, y);
      ctx.restore();
      break;
    }
    case "halloween": {
      ctx.fillStyle = gradient(ctx, 0, 0, W, ["#120624", a!, "#5A1E6E"]);
      ctx.fillRect(0, 0, W, H);
      halo(ctx, W * 0.72, H * 0.32, 150, "rgba(255,240,200,0.9)");
      ctx.beginPath();
      ctx.arc(W * 0.72, H * 0.32, 60, 0, Math.PI * 2);
      ctx.fillStyle = "#FFF3D6";
      ctx.fill();
      ctx.fillStyle = "#120624";
      for (const [x, y, s] of [[W * 0.55, 60, 22], [W * 0.62, 100, 14], [W * 0.93, 70, 18], [W * 0.88, 140, 12]] as const) bat(ctx, x, y, s);
      pumpkin(ctx, W * 0.58, H - 34, 34);
      pumpkin(ctx, W * 0.95, H - 26, 26);
      sparkles(ctx, W * 0.4, 0, W * 0.6, H * 0.6, 20, "#FFD9A8");
      break;
    }
    case "escenario": {
      ctx.fillStyle = gradient(ctx, 0, 0, W, [b!, a!, b!]);
      ctx.fillRect(0, 0, W, H);
      for (const [x, col] of [[0.5, "rgba(57,197,187,0.35)"], [0.7, "rgba(242,162,192,0.35)"], [0.9, "rgba(245,197,66,0.35)"]] as const) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(W * x - 20, 0);
        ctx.lineTo(W * x + 20, 0);
        ctx.lineTo(W * x + 160, H);
        ctx.lineTo(W * x - 160, H);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        ctx.restore();
      }
      sparkles(ctx, W * 0.4, 0, W * 0.6, H, 40);
      break;
    }
    case "pastel": {
      ctx.fillStyle = gradient(ctx, 0, 0, W, ["#2A2238", a!]);
      ctx.fillRect(0, 0, W, H);
      polka(ctx, W, H, "rgba(255,255,255,0.18)");
      halo(ctx, W * 0.8, H * 0.5, H * 0.75, "rgba(255,255,255,0.35)");
      break;
    }
    case "rayos": {
      ctx.fillStyle = gradient(ctx, 0, 0, W, [b!, a!]);
      ctx.fillRect(0, 0, W, H);
      rays(ctx, W * 0.8, H * 0.5, 22, "rgba(255,255,255,0.12)");
      halo(ctx, W * 0.8, H * 0.5, H * 0.8, "rgba(255,255,255,0.4)");
      sparkles(ctx, W * 0.5, 0, W * 0.5, H, 22);
      break;
    }
    case "estreno": {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, a!);
      g.addColorStop(1, b!);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      sparkles(ctx, 0, 0, W, H, 90, "#FFFFFF");
      sparkles(ctx, W * 0.4, 0, W * 0.6, H, 40, "#FFE14D");
      halo(ctx, W * 0.72, H * 0.55, H, "rgba(255,225,140,0.35)");
      // Fecha del estreno, dorada, arriba a la derecha.
      ctx.font = `900 30px ${FONT}`;
      ctx.fillStyle = gradient(ctx, W - 250, 0, 220, ["#B8860B", "#FFF3C4", "#B8860B"]);
      centerText(ctx, "17 · 10 · 2026", W - 170, 34);
      break;
    }
  }
}

/** Fondo de tarjeta (1000×340): tema + personajes a la derecha (la izquierda la tapan el avatar y el texto). */
async function fondo(it: Item): Promise<Buffer> {
  const W = CARD_W, H = CARD_H;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  paintTheme(ctx, it, W, H);
  const pjs = await Promise.all(it.pjs.map(loadPj));
  const n = pjs.length;
  // Posiciones: uno al centro de la zona libre; varios repartidos, el primero adelante y más grande.
  const zone0 = n >= 5 ? 400 : n >= 3 ? 540 : 580, zone1 = W - 10;
  if (it.tema === "estreno") {
    // Fila pareja, de izquierda a derecha como vienen en `pjs`, todos del mismo alto. Teto (la del saludo) se dibuja
    // primero para quedar atrás: así su mano no tapa la cara de nadie (pedido de GyroP, 26 oct. 2026).
    const xs = pjs.map((_, i) => 560 + ((i + 0.5) * (W - 10 - 560)) / n);
    const back = it.pjs.findIndex((x) => x.includes("/tet/"));
    const order = [back, ...pjs.map((_, i) => i).filter((i) => i !== back)];
    for (const i of order) drawPj(ctx, pjs[i]!, xs[i]!, 92, 240, "rgba(255,230,150,0.8)");
  } else {
  // Casillas parejas en la zona libre: el primero va al centro y los demás se alternan hacia los lados.
  const mid = Math.floor((n - 1) / 2);
  const slotOf = (i: number) => (i === 0 ? mid : i % 2 ? mid + Math.ceil(i / 2) : mid - i / 2);
  const order = pjs.map((p, i) => ({ p, i })).reverse();
  for (const { p, i } of order) {
    const cx = n === 1 ? zone0 + (zone1 - zone0) * 0.55 : zone0 + ((slotOf(i) + 0.5) * (zone1 - zone0)) / n;
    const h = (n === 1 ? 430 : n === 2 ? 400 : n <= 4 ? 340 : 300) * (i === 0 ? 1 : 0.92);
    drawPj(ctx, p, cx, (n === 1 ? 24 : 34) + (i === 0 ? 0 : 10), h, it.rareza === "mitica" ? "rgba(255,230,150,0.8)" : undefined);
  }
  }
  // Suelo con desvanecido, para que los cuerpos cortados no se vean como recorte.
  const fade = ctx.createLinearGradient(0, H - 70, 0, H);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(10,8,18,0.55)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, H - 70, W, 70);
  return c.toBuffer("image/png");
}

/** Miniatura cuadrada para la tienda: recorte de la zona de los personajes con marco y gema de rareza. */
async function miniatura(it: Item, bg: Buffer): Promise<Buffer> {
  const S = 256;
  const c = createCanvas(S, S);
  const ctx = c.getContext("2d");
  const img = await loadImage(bg);
  const col = rcolor(it.rareza);
  roundRect(ctx, 4, 4, S - 8, S - 8, 30);
  ctx.fillStyle = it.rareza === "mitica" ? rainbowAt(ctx, 0, S, 0) : col;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 14, 14, S - 28, S - 28, 22);
  ctx.clip();
  // Zona de personajes: el tercio derecho (o más, si son varios).
  const n = it.pjs.length;
  const sw = n >= 5 ? 640 : n >= 3 ? 520 : n === 2 ? 420 : CARD_H;
  const sx = CARD_W - sw - (n === 1 ? 70 : 0);
  ctx.drawImage(img, sx, 0, sw, CARD_H, 14 - (sw * ((S - 28) / CARD_H) - (S - 28)) / 2, 14, sw * ((S - 28) / CARD_H), S - 28);
  ctx.restore();
  roundRect(ctx, 4, 4, S - 8, S - 8, 30);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#3B2346";
  ctx.stroke();
  ctx.save();
  ctx.translate(S - 34, 34);
  ctx.rotate(Math.PI / 4);
  roundRect(ctx, -16, -16, 32, 32, 6);
  ctx.fillStyle = it.rareza === "mitica" ? rainbowAt(ctx, -16, 32, 0) : col;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
  if (it.rareza === "fundador") {
    ctx.font = `28px ${FONT}`;
    centerText(ctx, "⭐", S - 34, 34);
  }
  return c.toBuffer("image/png");
}

const AVATAR = path.join(root, "assets/bots/miku_avatar.png");

async function tarjeta(it: Item, bg: Buffer, extra: Partial<Parameters<typeof renderCard>[0]> = {}): Promise<Buffer> {
  return renderCard({
    name: "Papu de ejemplo", avatar: fs.readFileSync(AVATAR), level: 52, max: 99, prestige: 0, into: 1677, needed: 2619,
    tier: 4, rankName: "Álbum", position: 7, quota: { left: 9, limit: 14 }, frase: it.nombre, accent: "#39C5BB", background: bg, multiplier: 1, ...extra,
  });
}

/** Tarjeta de un fundador: borde de estrellas doradas y cinta con su número (único por Papu). */
async function tarjetaFundador(bg: Buffer, numero: number): Promise<Buffer> {
  const base = await loadImage(await tarjeta(FUNDADORES, bg, { frase: "Fundador del servidor" }));
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext("2d");
  ctx.drawImage(base, 0, 0);
  ctx.save();
  roundRect(ctx, 5, 5, CARD_W - 10, CARD_H - 10, 24);
  ctx.shadowColor = "#FFE14D";
  ctx.shadowBlur = 22;
  ctx.lineWidth = 8;
  ctx.strokeStyle = gradient(ctx, 0, 0, CARD_W, ["#B8860B", "#FFF3C4", "#FFD166", "#FFF3C4", "#B8860B"]);
  ctx.stroke();
  ctx.restore();
  // Estrellas en las esquinas.
  ctx.font = `26px ${FONT}`;
  for (const [x, y] of [[24, 26], [CARD_W - 24, 26], [24, CARD_H - 24], [CARD_W - 24, CARD_H - 24]] as const) centerText(ctx, "⭐", x, y);
  // Cinta con el número de fundador.
  const label = `FUNDADOR N.º ${String(numero).padStart(3, "0")}`;
  fitFont(ctx, label, 260, 17, 12);
  const lw = Math.min(280, ctx.measureText(label).width + 30);
  roundRect(ctx, CARD_W - lw - 34, CARD_H - 47, lw, 30, 15);
  ctx.fillStyle = gradient(ctx, CARD_W - lw - 34, 0, lw, ["#B8860B", "#FFE08A", "#B8860B"]);
  ctx.fill();
  ctx.fillStyle = "#3A2600";
  centerText(ctx, label, CARD_W - 34 - lw / 2, CARD_H - 32);
  return c.toBuffer("image/png");
}

/** Insignia de fundador (128 px, va junto al nombre en la tarjeta). */
function insigniaFundador(): Buffer {
  const S = 128;
  const c = createCanvas(S, S);
  const ctx = c.getContext("2d");
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 26 : 58, a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(S / 2 + Math.cos(a) * r, S / 2 + 4 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = gradient(ctx, 10, 0, S - 20, ["#B8860B", "#FFE08A", "#FFF6D5", "#FFE08A", "#B8860B"]);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#7A5A00";
  ctx.stroke();
  ctx.font = `900 26px ${FONT}`;
  ctx.fillStyle = "#5A3E00";
  centerText(ctx, "17", S / 2, S / 2 + 8);
  return c.toBuffer("image/png");
}

/** Hoja con todo el catálogo por rareza (para revisarlo de un vistazo). */
async function hoja(items: Item[], minis: Map<string, Buffer>): Promise<Buffer> {
  const order: Item["rareza"][] = ["mitica", "legendaria", "epica", "rara", "comun"];
  const cell = 150, cols = 9, pad = 24;
  const rows = order.map((r) => items.filter((i) => i.rareza === r));
  const W = pad * 2 + cols * cell;
  const H = 90 + rows.reduce((a, row) => a + 60 + Math.ceil(row.length / cols) * (cell + 34), 0);
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#14111c";
  ctx.fillRect(0, 0, W, H);
  ficha(ctx, pad + 26, 44, 24);
  ctx.font = `900 34px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Temporada 1 · Lanzamiento", pad + 62, 56);
  let y = 90;
  for (let ri = 0; ri < order.length; ri++) {
    const r = order[ri]!, row = rows[ri]!;
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillStyle = r === "mitica" ? rainbowAt(ctx, pad, 300, 0) : rcolor(r);
    ctx.fillText(`${rname(r)} · ${row.length}`, pad, y + 34);
    y += 50;
    for (let k = 0; k < row.length; k++) {
      const it = row[k]!, x = pad + (k % cols) * cell, yy = y + Math.floor(k / cols) * (cell + 34);
      ctx.drawImage(await loadImage(minis.get(it.id)!), x + 6, yy, cell - 12, cell - 12);
      ctx.fillStyle = "#E6E0F0";
      const size = fitFont(ctx, it.nombre, cell - 12, 15, 10, "600");
      const lines = wrapLines(ctx, it.nombre, cell - 12, 2);
      lines.forEach((l, li) => centerText(ctx, l, x + cell / 2, yy + cell - 2 + li * (size + 3)));
    }
    y += Math.ceil(row.length / cols) * (cell + 34) + 10;
  }
  return c.toBuffer("image/png");
}

async function main() {
  const minis = new Map<string, Buffer>();
  for (const it of [...TEMPORADA1, FUNDADORES]) {
    const bg = await fondo(it);
    save(`${it.rareza === "fundador" ? "fundadores" : "fondos"}/${it.id}.png`, bg);
    const mini = await miniatura(it, bg);
    minis.set(it.id, mini);
    save(`miniaturas/${it.id}.png`, mini);
    if (it.rareza !== "fundador") save(`tarjetas/${it.id}.png`, await tarjeta(it, bg));
    else {
      save("fundadores/tarjeta-fundador.png", await tarjetaFundador(bg, 7));
      save("fundadores/insignia-fundador.png", insigniaFundador());
    }
  }
  save("catalogo.png", await hoja(TEMPORADA1, minis));
  const json = {
    $comment: "Temporada 1 «Lanzamiento» de las Shaula-coins (propuesta, 26 oct. 2026). Fondos de tarjeta hechos con renders de Diva-a-Render; la rareza sigue qué tan histórica o viral es la canción del traje. 'pjs' = renders usados (DivaRenders/output). Lo genera fuente/temporada1.ts.",
    objetos: TEMPORADA1.map(({ tema, colores, ...rest }) => ({ tipo: "Fondo", ...rest })),
    fundadores: { ...FUNDADORES, tipo: "Fondo", extras: ["Borde «Estrella fundadora»", "Insignia ⭐ 17", "Título «Fundador/a del servidor»", "Número de fundador en la tarjeta"] },
  };
  fs.writeFileSync(path.resolve(here, "../temporada1.json"), JSON.stringify(json, null, 2));
  console.log("ok temporada1.json");
}

await main();
