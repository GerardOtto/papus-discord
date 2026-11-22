// Imagenes de las carreras (PLAN §3.14):
//   - banner «¡Se abren las apuestas!» con Teto, Miku, Luka y Neru haciendo un gesto (una version al azar por carrera:
//     euforia, saludo o corazones; figuras en assets/carreras/figuras, scripts/carreras_figuras.py) y los 6 corredores;
//   - podio con los 3 primeros: medalla, cuotas que pago cada uno y Shaulitas repartidas, laureles (y guirnalda el 1.º)
//     y **todos los que le apostaron** con su icono de Discord (con membresia primero, con el estilo de su nivel). Las
//     vallas sobre la tribuna: Papus con membresia que apostaron fuera del podio y, si faltan, Papus de honor al azar.
//     Solo adorno.
// Todo el texto va centrado de verdad (por su dibujo) y se achica o recorta si no cabe.
import path from "node:path";
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { centerText } from "../coins/arte";
import { fitText, FONT, roundRect } from "../levels/card";
import { decorarMembresia, type MarcoMembresia } from "../membresias/marco";

const TITLE = `"Bahnschrift", "Noto Sans Display", ${FONT}`;
const FIGURAS = path.resolve(import.meta.dirname, "../../assets/carreras/figuras");
const TAU = Math.PI * 2;
type Gradiente = ReturnType<SKRSContext2D["createLinearGradient"]>;

export const VERSIONES_APUESTAS = ["euforia", "saludo", "corazones"] as const;
export type VersionApuestas = (typeof VERSIONES_APUESTAS)[number];
/** Las cuatro del banner, de izquierda a derecha. */
const CHICAS = ["teto", "miku", "luka", "neru"] as const;
const COLOR_CHICA: Record<(typeof CHICAS)[number], string> = { teto: "#D23246", miku: "#39C5BB", luka: "#E285B2", neru: "#E8C21A" };

export interface Corredor {
  nombre: string;
  /** #RRGGBB */
  color: string;
  avatar: Buffer;
}

// ───────────────────────── utilidades ─────────────────────────

function canvas(w: number, h: number): [Canvas, SKRSContext2D] {
  const c = createCanvas(w, h);
  return [c, c.getContext("2d")];
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgba = (hex: string, a: number) => `rgba(${rgb(hex).join(",")},${a})`;

function shade(hex: string, f: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${rgb(hex).map(c).join(",")})`;
}

/** Numero pseudoaleatorio fijo por indice (confeti, estrellas: la misma imagen cada vez). */
const fijo = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Texto centrado en (cx, cy) que se achica hasta caber en `maxW` (y, si aun asi no cabe, se recorta). */
function fitCenter(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, size: number, min: number, family = TITLE, weight = "bold"): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--s}px ${family}`;
  centerText(ctx, fitText(ctx, text, maxW), cx, cy);
}

/** Texto grande con contorno y sombra (titulos). */
function titulo(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, size: number, fill: string | Gradiente, stroke: string): void {
  let s = size;
  ctx.font = `900 ${s}px ${TITLE}`;
  while (s > 20 && ctx.measureText(text).width > maxW) ctx.font = `900 ${--s}px ${TITLE}`;
  const t = fitText(ctx, text, maxW);
  const m = ctx.measureText(t);
  const x = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft;
  const y = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.lineWidth = s * 0.22;
  ctx.strokeStyle = stroke;
  ctx.strokeText(t, x, y);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = fill;
  ctx.fillText(t, x, y);
  ctx.restore();
}

/** Avatar en circulo con aro de color y brillo. */
function circleAvatar(ctx: SKRSContext2D, img: Image, cx: number, cy: number, r: number, ring: string | Gradiente, glow: string, ringW = 5): void {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, r + ringW, 0, TAU);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = "#111";
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

/** Cielo de atardecer, tribuna, focos del estadio y la pista con sus barandas. */
/** Altura del techo de la tribuna en `x` (sube en los extremos y es plano en el medio). */
function techoTribuna(w: number, horizonte: number, x: number): number {
  const borde = w * 0.08;
  if (x < borde) return horizonte - 70 - (22 * x) / borde;
  if (x > w - borde) return horizonte - 70 - (22 * (w - x)) / borde;
  return horizonte - 92;
}

/** `focos`: los dos focos del estadio (el podio los lleva arriba de su estructura, delante de las vallas). */
function hipodromo(ctx: SKRSContext2D, w: number, h: number, horizonte: number, cielo: [string, string, string], focos = true): void {
  const g = ctx.createLinearGradient(0, 0, 0, horizonte);
  g.addColorStop(0, cielo[0]);
  g.addColorStop(0.6, cielo[1]);
  g.addColorStop(1, cielo[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizonte);
  // Estrellas tenues arriba.
  ctx.save();
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = 0.15 + fijo(i) * 0.45;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(fijo(i + 100) * w, fijo(i + 200) * horizonte * 0.55, 0.6 + fijo(i + 300) * 1.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  // Tribuna: silueta escalonada con techo.
  ctx.fillStyle = "rgba(20,14,40,0.92)";
  ctx.beginPath();
  ctx.moveTo(0, horizonte);
  ctx.lineTo(0, horizonte - 70);
  ctx.lineTo(w * 0.08, horizonte - 92);
  ctx.lineTo(w * 0.92, horizonte - 92);
  ctx.lineTo(w, horizonte - 70);
  ctx.lineTo(w, horizonte);
  ctx.closePath();
  ctx.fill();
  // Publico: puntitos de colores en la tribuna.
  ctx.save();
  for (let i = 0; i < 260; i++) {
    const x = fijo(i + 400) * w;
    const y = horizonte - 8 - fijo(i + 500) * 60;
    ctx.globalAlpha = 0.35 + fijo(i + 600) * 0.4;
    ctx.fillStyle = ["#ffd86b", "#ff8fb1", "#7fe3ff", "#ffffff", "#b49cff"][i % 5]!;
    ctx.beginPath();
    ctx.arc(x, y, 1.6 + fijo(i + 700) * 1.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  // Focos del estadio.
  for (const fx of focos ? [w * 0.12, w * 0.88] : []) {
    ctx.save();
    const luz = ctx.createRadialGradient(fx, horizonte - 120, 4, fx, horizonte - 120, 150);
    luz.addColorStop(0, "rgba(255,250,220,0.85)");
    luz.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = luz;
    ctx.fillRect(fx - 150, horizonte - 270, 300, 300);
    ctx.fillStyle = "#fffbe6";
    roundRect(ctx, fx - 26, horizonte - 130, 52, 18, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(20,14,40,0.95)";
    ctx.fillRect(fx - 3, horizonte - 112, 6, 30);
    ctx.restore();
  }
  // Pista: cesped, la tierra y las barandas blancas en perspectiva.
  const pasto = ctx.createLinearGradient(0, horizonte, 0, h);
  pasto.addColorStop(0, "#2f7d3b");
  pasto.addColorStop(1, "#1d5227");
  ctx.fillStyle = pasto;
  ctx.fillRect(0, horizonte, w, h - horizonte);
  ctx.save();
  for (let k = 0; k < 9; k++) {
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = k % 2 ? "#ffffff" : "#000000";
    ctx.fillRect((k * w) / 9, horizonte, w / 9, h - horizonte);
  }
  ctx.restore();
  const tierra = ctx.createLinearGradient(0, horizonte + 22, 0, h);
  tierra.addColorStop(0, "#a8754a");
  tierra.addColorStop(1, "#7a4e2c");
  ctx.fillStyle = tierra;
  ctx.beginPath();
  ctx.moveTo(0, horizonte + 26);
  ctx.lineTo(w, horizonte + 26);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#f5f2ea";
  ctx.lineWidth = 4;
  for (const y of [horizonte + 14, horizonte + 24]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let x = 10; x < w; x += 48) {
    ctx.fillStyle = "#f5f2ea";
    ctx.fillRect(x, horizonte + 10, 4, 16);
  }
}

/** Banderines triangulares colgando de un cordel (colores de las chicas). */
function banderines(ctx: SKRSContext2D, w: number, y: number, colores: readonly string[]): void {
  const n = 22;
  const step = w / n;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) ctx.lineTo(i * step, y + Math.sin((i / n) * Math.PI) * 18);
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const x0 = i * step, y0 = y + Math.sin((i / n) * Math.PI) * 18, y1 = y + Math.sin(((i + 1) / n) * Math.PI) * 18;
    ctx.fillStyle = colores[i % colores.length]!;
    ctx.beginPath();
    ctx.moveTo(x0 + 3, y0);
    ctx.lineTo(x0 + step - 3, y1);
    ctx.lineTo(x0 + step / 2, (y0 + y1) / 2 + 26);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Bandera a cuadros (meta). */
function cuadros(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, lado: number): void {
  for (let i = 0; i * lado < w; i++)
    for (let j = 0; j * lado < h; j++) {
      ctx.fillStyle = (i + j) % 2 ? "#111" : "#fafafa";
      ctx.fillRect(x + i * lado, y + j * lado, Math.min(lado, w - i * lado), Math.min(lado, h - j * lado));
    }
}

function corazon(ctx: SKRSContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  ctx.closePath();
}

/** Adorno de cada version: confeti (euforia), destellos (saludo) o corazones (corazones). */
function adorno(ctx: SKRSContext2D, w: number, h: number, v: VersionApuestas): void {
  ctx.save();
  const colores = Object.values(COLOR_CHICA);
  for (let i = 0; i < 70; i++) {
    const x = fijo(i + 900) * w, y = 110 + fijo(i + 1000) * (h - 200), c = colores[i % colores.length]!;
    ctx.globalAlpha = 0.55 + fijo(i + 1100) * 0.4;
    ctx.fillStyle = v === "saludo" ? "#fff6c2" : c;
    if (v === "euforia") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(fijo(i + 1200) * TAU);
      ctx.fillRect(-5, -2.5, 10, 5);
      ctx.restore();
    } else if (v === "corazones") {
      if (i % 2) continue;
      corazon(ctx, x, y, 10 + fijo(i + 1300) * 12);
      ctx.fill();
    } else {
      if (i % 2) continue;
      const r = 3 + fijo(i + 1300) * 6;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const rr = k % 2 ? r * 0.3 : r, a = (k * Math.PI) / 4;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

// ───────────────────────── «¡Se abren las apuestas!» ─────────────────────────

export const APUESTAS_W = 1000;
export const APUESTAS_H = 560;

const CIELOS: Record<VersionApuestas, [string, string, string]> = {
  euforia: ["#1b1446", "#5b2a86", "#f08a5d"],
  saludo: ["#0f2747", "#2f5f9e", "#f7c873"],
  corazones: ["#2a1036", "#8a2a6b", "#ff9eb5"],
};

export interface BannerApuestas {
  version: VersionApuestas;
  corredores: Corredor[];
  /** «17:40» (hora de Mexico). */
  hora: string;
  minutos: number;
  /** El estilo del nivel de quien la lanzo (PLAN §2); sin el, el banner de siempre. */
  membresia?: MarcoMembresia;
}

export async function bannerApuestas(b: BannerApuestas): Promise<Buffer> {
  const W = APUESTAS_W, H = APUESTAS_H;
  const [c, ctx] = canvas(W, H);
  hipodromo(ctx, W, H, 400, CIELOS[b.version]);
  banderines(ctx, W, 4, Object.values(COLOR_CHICA));
  adorno(ctx, W, H, b.version);

  // Las cuatro chicas: dos a cada lado, paradas sobre la pista (las de afuera, un poco atras y mas chicas).
  const lugares: [number, number, number][] = [
    [95, 330, 0.8], // teto (afuera, izquierda)
    [245, 370, 1], // miku
    [755, 370, 1], // luka
    [905, 330, 0.8], // neru (afuera, derecha)
  ];
  const orden = [0, 3, 1, 2]; // primero las de atras
  for (const i of orden) {
    const bot = CHICAS[i]!;
    const img = await loadImage(path.join(FIGURAS, `${b.version}_${bot}.png`));
    const [cx, alto, k] = lugares[i]!;
    const hh = alto * k + 40;
    const ww = (img.width / img.height) * hh;
    const maxW = 270 * k;
    const scale = Math.min(1, maxW / ww);
    const fw = ww * scale, fh = hh * scale;
    ctx.save();
    ctx.shadowColor = rgba(COLOR_CHICA[bot], 0.9);
    ctx.shadowBlur = 24;
    ctx.drawImage(img, cx - fw / 2, H - fh, fw, fh);
    ctx.restore();
  }

  // Titulo.
  const oro = ctx.createLinearGradient(0, 40, 0, 120);
  oro.addColorStop(0, "#fff7c9");
  oro.addColorStop(0.5, "#ffd23d");
  oro.addColorStop(1, "#e89a1c");
  titulo(ctx, "¡SE ABREN LAS APUESTAS!", W / 2, 82, W - 80, 66, oro, "#3a1660");

  // Cartel central con los corredores.
  const px = 340, py = 150, pw = 320, ph = 330;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 20;
  roundRect(ctx, px, py, pw, ph, 22);
  ctx.fillStyle = "rgba(18,12,36,0.82)";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, px, py, pw, ph, 22);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,210,61,0.85)";
  ctx.stroke();
  cuadros(ctx, px + 22, py + 18, pw - 44, 12, 6);
  ctx.fillStyle = "#ffffff";
  fitCenter(ctx, "CORREN HOY", px + pw / 2, py + 52, pw - 40, 26, 16);
  const cols = 3, r = 34;
  for (let i = 0; i < Math.min(6, b.corredores.length); i++) {
    const f = b.corredores[i]!;
    const cx = px + pw / 2 + ((i % cols) - 1) * 96;
    const cy = py + 112 + Math.floor(i / cols) * 98;
    circleAvatar(ctx, await loadImage(f.avatar), cx, cy, r, f.color, f.color, 4);
    ctx.fillStyle = "#ffffff";
    fitCenter(ctx, f.nombre, cx, cy + r + 18, 92, 16, 10, FONT, "600");
  }
  // Pastilla con la hora.
  const tx = `Carrera de las ${b.hora} · ${b.minutos} min para apostar`;
  ctx.font = `bold 15px ${FONT}`;
  roundRect(ctx, px + 16, py + ph - 50, pw - 32, 34, 17);
  ctx.fillStyle = "#ffd23d";
  ctx.fill();
  ctx.fillStyle = "#2a1450";
  fitCenter(ctx, tx, px + pw / 2, py + ph - 33, pw - 52, 15, 10, FONT, "bold");

  if (b.membresia) decorarMembresia(ctx, W, H, b.membresia);
  return c.toBuffer("image/png");
}

// ───────────────────────── podio ─────────────────────────

export const PODIO_W = 1000;
const MONEDA = path.resolve(import.meta.dirname, "../../assets/tienda/iconos/moneda.png");

/** Un Papu que aparece en el podio (apostó) o en una valla. */
export interface Apostador {
  /** Id de Discord (para no repetirlo); si falta, se usa el nombre. */
  id?: string;
  nombre: string;
  /** Icono de Discord (PNG/JPG); sin él, un círculo con su inicial. */
  avatar?: Buffer | null;
  /** Estilo de su nivel de membresía; sin membresía, undefined. */
  marco?: MarcoMembresia;
  /** Índice del nivel (0 = Puerro … 4 = Triple Baka); -1 sin membresía. */
  nivel: number;
}

/** Valla del fondo: un Papu con membresía que apostó fuera del podio, o un Papu de honor (rol 🏅, nivel 40) al azar. */
export interface Valla {
  tipo: "patrocina" | "honor";
  papu: Apostador;
}

export interface PodioCorredor extends Corredor {
  /** Cuotas que pagó: ganador (solo el 1.º), segundo (1.º y 2.º) y tercero (los 3). */
  pagos: { ganador?: number; segundo?: number; tercero?: number };
  /** Shaulitas que se llevaron los boletos de este corredor. */
  repartido: number;
  /** Los que le apostaron (repartirApostadores): con membresía primero. */
  apostadores: Apostador[];
}

export interface BannerPodio {
  /** 1.º, 2.º y 3.º */
  podio: [PodioCorredor, PodioCorredor, PodioCorredor];
  vallas: Valla[];
  /** Los que apostaron sin membresía y no le pegaron a nadie del podio (fila de abajo, solo iconos). */
  tambien: Apostador[];
  hora: string;
  membresia?: MarcoMembresia;
}

const LUGARES = [
  // lugar, centro x, alto del bloque, colores del bloque y del metal (como el podio del #ranking)
  { lugar: 2, cx: 170, bh: 145, stops: ["#8E97A3", "#F2F5F8", "#8E97A3"], metal: "#D9DEE5" },
  { lugar: 1, cx: 500, bh: 175, stops: ["#B07D0B", "#FFE08A", "#B07D0B"], metal: "#FFD23D" },
  { lugar: 3, cx: 830, bh: 125, stops: ["#7f4420", "#e6a06a", "#7f4420"], metal: "#E6A06A" },
] as const;
const HORIZONTE = 330;
const PISO = 560;
const COL_W = 270;
const MAX_MIEMBROS = 4;
const MAX_OTROS = 6;
const MAX_VALLAS = 5;
const MAX_TAMBIEN = 22;
const COLORES_DISCORD = ["#5865F2", "#757E8A", "#3BA55C", "#FAA61A", "#ED4245", "#EB459E"];
const fmt = (n: number) => n.toLocaleString("es-MX");
const fmtCuota = (n: number) => `×${n.toFixed(2).replace(".", ",")}`;

/** Icono redondo de un Papu (el de Discord o, si no hay, su inicial sobre un color fijo según el nombre). */
async function iconoPapu(ctx: SKRSContext2D, p: Apostador, cx: number, cy: number, r: number, aro?: string | Gradiente): Promise<void> {
  const img = p.avatar ? await loadImage(p.avatar).catch(() => null) : null;
  if (aro) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + Math.max(2, r * 0.12), 0, TAU);
    ctx.fillStyle = aro;
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else {
    let h = 0;
    for (const ch of p.nombre) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    ctx.fillStyle = COLORES_DISCORD[h % COLORES_DISCORD.length]!;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#ffffff";
    fitCenter(ctx, [...p.nombre][0]?.toUpperCase() ?? "?", cx, cy, r * 1.4, Math.round(r * 1.1), 6, FONT, "bold");
  }
  ctx.restore();
}

/** Texto alineado a la izquierda, centrado en vertical en `cy`, achicado o recortado a `maxW`. */
function leftText(ctx: SKRSContext2D, text: string, x: number, cy: number, maxW: number, size: number, min: number, family = FONT, weight = "bold"): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--s}px ${family}`;
  const t = fitText(ctx, text, maxW);
  const m = ctx.measureText(t);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(t, x + m.actualBoundingBoxLeft, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

/** Borde según el estilo del nivel (arcoíris en Triple Baka). */
function bordeNivel(ctx: SKRSContext2D, m: MarcoMembresia, x: number, y: number, w: number, h: number): string | Gradiente {
  if (m.estilo === "animado") {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    [m.color, "#FFD86B", "#B5FFFC", "#FFB3E6", m.color].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    return g;
  }
  return m.estilo === "basico" ? m.color : shade(m.color, 0.35);
}

/** Etiqueta grande de un Papu con membresía: icono, nombre y nivel, con el color y el estilo de su nivel. */
async function chipMiembro(ctx: SKRSContext2D, p: Apostador, cx: number, cy: number, w: number, h: number): Promise<void> {
  const m = p.marco!;
  const x = cx - w / 2, y = cy - h / 2;
  ctx.save();
  if (m.estilo !== "basico") {
    ctx.shadowColor = rgba(m.color, 0.9);
    ctx.shadowBlur = m.estilo === "brillo" ? 8 : 14;
  }
  roundRect(ctx, x, y, w, h, h / 2);
  const fondo = ctx.createLinearGradient(x, y, x + w, y);
  fondo.addColorStop(0, shade(m.color, -0.72));
  fondo.addColorStop(1, shade(m.color, -0.5));
  ctx.fillStyle = fondo;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = bordeNivel(ctx, m, x, y, w, h);
  ctx.stroke();
  if (m.estilo === "particulas" || m.estilo === "animado") {
    ctx.fillStyle = "#fffbe0";
    for (const [dx, dy] of [
      [w - 14, -h / 2 + 3],
      [w - 30, h / 2 - 3],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + dx, cy + dy, 2.2, 0, TAU);
      ctx.fill();
    }
  }
  const r = h / 2 - 5;
  await iconoPapu(ctx, p, x + h / 2, cy, r, bordeNivel(ctx, m, x, y, h, h));
  ctx.fillStyle = "#ffffff";
  leftText(ctx, p.nombre, x + h + 4, cy - 6, w - h - 18, 15, 10);
  ctx.fillStyle = shade(m.color, 0.55);
  leftText(ctx, m.nombre.toUpperCase(), x + h + 4, cy + 10, w - h - 18, 10, 7, TITLE);
}

/** Etiqueta chica de un Papu sin membresía: icono y nombre. */
async function chipPapu(ctx: SKRSContext2D, p: Apostador, x: number, cy: number, w: number, h: number): Promise<void> {
  roundRect(ctx, x, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = "rgba(18,12,36,0.78)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.stroke();
  await iconoPapu(ctx, p, x + h / 2, cy, h / 2 - 4);
  ctx.fillStyle = "#e9e6f5";
  leftText(ctx, p.nombre, x + h + 1, cy, w - h - 9, 13, 9, FONT, "600");
}

/** Torre de celosía (dos largueros con diagonales en X) de `y0` a `y1`. */
function torre(ctx: SKRSContext2D, cx: number, y0: number, y1: number, ancho: number): void {
  const x0 = cx - ancho / 2, x1 = cx + ancho / 2;
  ctx.strokeStyle = "#2a2640";
  ctx.lineWidth = 5;
  for (const x of [x0, x1]) {
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3a3552";
  for (let y = y0; y < y1 - 2; y += ancho) {
    const y2 = Math.min(y + ancho, y1);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y2);
    ctx.moveTo(x1, y);
    ctx.lineTo(x0, y2);
    ctx.stroke();
  }
}

/**
 * Estructura de acero sobre la tribuna: una torre en cada extremo (de la cabeza de los focos al techo), la viga doble
 * con celosía de torre a torre y patas en V bajo cada valla que terminan en el techo. Guirnaldas colgando de la viga.
 */
function estructura(ctx: SKRSContext2D, w: number, horizonte: number, vigaY: number, torres: [number, number], patas: number[]): void {
  ctx.save();
  for (const x of patas) {
    const techo = techoTribuna(w, horizonte, x);
    ctx.strokeStyle = "#2a2640";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x - 16, techo);
    ctx.lineTo(x, vigaY + 22);
    ctx.lineTo(x + 16, techo);
    ctx.stroke();
    ctx.fillStyle = "#2a2640";
    ctx.fillRect(x - 22, techo - 3, 12, 4);
    ctx.fillRect(x + 10, techo - 3, 12, 4);
  }
  for (const x of torres) torre(ctx, x, vigaY - 100, techoTribuna(w, horizonte, x), 20);
  // Viga doble con celosía, de torre a torre.
  const [a, b] = torres;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3a3552";
  for (let x = a; x < b - 1; x += 36) {
    const x2 = Math.min(x + 36, b);
    ctx.beginPath();
    ctx.moveTo(x, vigaY + 12);
    ctx.lineTo((x + x2) / 2, vigaY + 20);
    ctx.lineTo(x2, vigaY + 12);
    ctx.stroke();
  }
  const acero = ctx.createLinearGradient(0, vigaY, 0, vigaY + 12);
  acero.addColorStop(0, "#4a4560");
  acero.addColorStop(1, "#1d1a2b");
  ctx.fillStyle = acero;
  ctx.fillRect(a - 13, vigaY, b - a + 26, 12);
  ctx.fillRect(a - 13, vigaY + 20, b - a + 26, 4);
  // Soportes de los focos chicos bajo la viga (la luz va despues, delante de todo).
  ctx.fillStyle = "#1d1a2b";
  for (const x of focosChicos(a, b)) {
    ctx.fillRect(x - 2, vigaY + 24, 4, 6);
    roundRect(ctx, x - 7, vigaY + 29, 14, 7, 2);
    ctx.fill();
  }
  // Guirnaldas colgando de la viga, entre patas.
  const puntos = [a, ...patas, b].sort((p, q) => p - q);
  for (let k = 0; k < puntos.length - 1; k++) guirnalda(ctx, puntos[k]! + 6, puntos[k + 1]! - 6, vigaY + 26, 14, 0.75);
  ctx.restore();
}

const focosChicos = (a: number, b: number) => Array.from({ length: 8 }, (_, i) => a + ((b - a) * (i + 0.5)) / 8);

/**
 * Luces de la estructura, dibujadas al final para que queden delante de las vallas: los focos grandes arriba de las
 * torres (cabeza con 4 lámparas) y los chicos bajo la viga, con su resplandor.
 */
function lucesEstructura(ctx: SKRSContext2D, vigaY: number, torres: [number, number]): void {
  ctx.save();
  for (const x of focosChicos(...torres)) {
    ctx.globalCompositeOperation = "screen";
    const luz = ctx.createRadialGradient(x, vigaY + 36, 1, x, vigaY + 36, 30);
    luz.addColorStop(0, "rgba(255,246,200,0.95)");
    luz.addColorStop(1, "rgba(255,246,200,0)");
    ctx.fillStyle = luz;
    ctx.fillRect(x - 30, vigaY + 6, 60, 60);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fffbe6";
    ctx.fillRect(x - 5, vigaY + 34, 10, 2);
  }
  for (const x of torres) {
    const y = vigaY - 118;
    // Carcasa y lámparas primero; la luz va encima (no detrás).
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#1d1a2b";
    roundRect(ctx, x - 17, y - 3, 34, 24, 4);
    ctx.fill();
    const lamparas = [
      [-12, 3],
      [2, 3],
      [-12, 11],
      [2, 11],
    ] as const;
    ctx.fillStyle = "#fffbe6";
    for (const [dx, dy] of lamparas) {
      ctx.beginPath();
      roundRect(ctx, x + dx, y + dy, 8, 6, 1.5);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "screen";
    for (const [dx, dy] of lamparas) {
      const brillo = ctx.createRadialGradient(x + dx + 4, y + dy + 3, 1, x + dx + 4, y + dy + 3, 12);
      brillo.addColorStop(0, "rgba(255,255,240,0.95)");
      brillo.addColorStop(1, "rgba(255,255,240,0)");
      ctx.fillStyle = brillo;
      ctx.fillRect(x + dx - 8, y + dy - 9, 24, 24);
    }
    const luz = ctx.createRadialGradient(x, y + 9, 4, x, y + 9, 150);
    luz.addColorStop(0, "rgba(255,250,220,0.75)");
    luz.addColorStop(0.3, "rgba(255,250,220,0.3)");
    luz.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = luz;
    ctx.fillRect(x - 150, y - 141, 300, 300);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

/** Valla: icono y nombre del Papu (patrocinador o Papu de honor), o un anuncio del hipódromo si no hay nadie. */
async function valla(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, v: Valla | null, i: number, vigaY: number): Promise<void> {
  const honor = v?.tipo === "honor";
  const marco = v?.tipo === "patrocina" ? v.papu.marco : undefined;
  const color = marco?.color ?? (honor ? "#C9A227" : ["#ffd23d", "#39C5BB", "#E285B2", "#D23246", "#E8C21A"][i % 5]!);
  // Postes cortos hasta la viga.
  ctx.fillStyle = "#2a2640";
  ctx.fillRect(x + w * 0.22 - 3, y + h, 6, vigaY - y - h);
  ctx.fillRect(x + w * 0.78 - 3, y + h, 6, vigaY - y - h);
  ctx.save();
  if (v && (honor || marco?.estilo !== "basico")) {
    ctx.shadowColor = rgba(color, 0.9);
    ctx.shadowBlur = 16;
  }
  roundRect(ctx, x, y, w, h, 6);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(color, -0.45));
  g.addColorStop(1, shade(color, -0.78));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, 6);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = marco ? bordeNivel(ctx, marco, x, y, w, h) : shade(color, 0.25);
  ctx.stroke();
  // Lamparitas encima.
  for (const lx of [x + 14, x + w - 14]) {
    ctx.fillStyle = "#2a2640";
    ctx.fillRect(lx - 1, y - 8, 2, 8);
    ctx.fillStyle = "#fff6c8";
    ctx.beginPath();
    ctx.arc(lx, y - 9, 3.5, 0, TAU);
    ctx.fill();
  }
  if (!v) {
    const anuncios = ["HIPÓDROMO PAPU", "APUESTA CON SHAULITAS", "¡ARRE, ARRE!", "BURREROS DE CORAZÓN", "GRAN PREMIO VOCALOID"];
    ctx.fillStyle = "#ffffff";
    fitCenter(ctx, anuncios[i % anuncios.length]!, x + w / 2, y + h / 2, w - 18, 16, 9, TITLE, "bold");
    return;
  }
  const r = h / 2 - 10;
  await iconoPapu(ctx, v.papu, x + 12 + r, y + h / 2, r, honor ? "#FFD23D" : marco ? bordeNivel(ctx, marco, x, y, 40, 40) : "#ffffff");
  const tx = x + 22 + r * 2, tw = w - (tx - x) - 8;
  ctx.fillStyle = shade(color, 0.6);
  leftText(ctx, honor ? "PAPU DE HONOR" : "PATROCINA", tx, y + 17, tw, 10, 7, TITLE);
  ctx.fillStyle = "#ffffff";
  leftText(ctx, v.papu.nombre, tx, y + h / 2 + 1, tw, 17, 10);
  ctx.fillStyle = shade(color, 0.5);
  leftText(ctx, honor ? "NIVEL 40 O MÁS" : (marco?.nombre ?? "").toUpperCase(), tx, y + h - 15, tw, 9, 7, TITLE);
}

/** Laureles alrededor del icono del corredor (dos ramas que suben por los lados). */
function laureles(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  for (const lado of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const a = Math.PI / 2 + lado * (0.4 + k * 0.29);
      const x = cx + Math.cos(a) * (r + 14), y = cy + Math.sin(a) * (r + 14);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + (lado > 0 ? -0.9 : 0.9) + Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 12, 0, 0, TAU);
      const g = ctx.createLinearGradient(-6, 0, 6, 0);
      g.addColorStop(0, shade(color, -0.35));
      g.addColorStop(1, shade(color, 0.35));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Guirnalda de flores colgando entre x0 y x1 (como la manta de flores del caballo ganador). `caida`: cuánto cuelga. */
function guirnalda(ctx: SKRSContext2D, x0: number, x1: number, y: number, caida = 26, escala = 1): void {
  const n = Math.max(4, Math.round((x1 - x0) / (10 * escala)));
  const flores = ["#ff5d8f", "#ffd23d", "#ffffff", "#ff9a3c", "#c77dff"];
  ctx.save();
  ctx.strokeStyle = "#2f7d3b";
  ctx.lineWidth = 5 * escala;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) ctx.lineTo(x0 + ((x1 - x0) * i) / n, y + Math.sin((i / n) * Math.PI) * caida);
  ctx.stroke();
  const e = escala;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, yy = y + Math.sin((i / n) * Math.PI) * caida;
    ctx.fillStyle = "#3f9e4c";
    ctx.beginPath();
    ctx.ellipse(x + 5 * e, yy + 4 * e, 6 * e, 3 * e, 0.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = flores[i % flores.length]!;
    for (let p = 0; p < 5; p++) {
      ctx.beginPath();
      ctx.arc(x + Math.cos((p * TAU) / 5) * 4 * e, yy + Math.sin((p * TAU) / 5) * 4 * e, 3.4 * e, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#ffe066";
    ctx.beginPath();
    ctx.arc(x, yy, 2.4 * e, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Medalla con cinta y el número del lugar. */
function medalla(ctx: SKRSContext2D, cx: number, cy: number, r: number, metal: string, lugar: number): void {
  ctx.save();
  ctx.fillStyle = "#B3261E";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.9, cy - r * 1.6);
  ctx.lineTo(cx - r * 0.2, cy - r * 1.6);
  ctx.lineTo(cx + r * 0.25, cy - r * 0.4);
  ctx.lineTo(cx - r * 0.35, cy - r * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1E5BB3";
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.9, cy - r * 1.6);
  ctx.lineTo(cx + r * 0.2, cy - r * 1.6);
  ctx.lineTo(cx - r * 0.25, cy - r * 0.4);
  ctx.lineTo(cx + r * 0.35, cy - r * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 6;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 2, cx, cy, r);
  g.addColorStop(0, shade(metal, 0.6));
  g.addColorStop(1, shade(metal, -0.25));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 2;
  ctx.strokeStyle = shade(metal, -0.45);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = shade(metal, -0.6);
  fitCenter(ctx, String(lugar), cx, cy, r * 1.3, Math.round(r * 1.15), 10, TITLE, "900");
  ctx.restore();
}

/** Los que se ven de cada corredor (con membresía y sin ella) y cuántos quedan fuera. */
function cortar(apostadores: Apostador[]) {
  const miembros = apostadores.filter((p) => p.marco).slice(0, MAX_MIEMBROS);
  const otros = apostadores.filter((p) => !p.marco).slice(0, MAX_OTROS);
  return { miembros, otros, resto: apostadores.length - miembros.length - otros.length };
}

const altoLista = (l: ReturnType<typeof cortar>) => 30 + l.miembros.length * 46 + Math.ceil(l.otros.length / 2) * 36 + (l.resto > 0 ? 22 : 0);

export async function bannerPodio(b: BannerPodio): Promise<Buffer> {
  const W = PODIO_W;
  const listas = b.podio.map((f) => cortar(f.apostadores));
  const tambien = b.tambien.length ? 74 : 0;
  const H = PISO + 18 + Math.max(...listas.map(altoLista)) + tambien + 16;
  const [c, ctx] = canvas(W, H);
  hipodromo(ctx, W, H, HORIZONTE, ["#140f33", "#3b2470", "#c9608a"], false);

  // Título.
  const oro = ctx.createLinearGradient(0, 18, 0, 70);
  oro.addColorStop(0, "#fff7c9");
  oro.addColorStop(0.5, "#ffd23d");
  oro.addColorStop(1, "#e89a1c");
  titulo(ctx, `PODIO · CARRERA DE LAS ${b.hora}`, W / 2, 42, W - 120, 40, oro, "#3a1660");

  // Vallas sobre la estructura del techo de la tribuna (no flotan: postes → viga → patas → techo).
  const vw = 160, vh = 70, vy = 84, vigaY = 170;
  const gap = (W - MAX_VALLAS * vw) / (MAX_VALLAS + 1);
  const xs = Array.from({ length: MAX_VALLAS }, (_, i) => gap + i * (vw + gap));
  const torres: [number, number] = [20, W - 20];
  estructura(ctx, W, HORIZONTE, vigaY, torres, xs.map((x) => x + vw / 2));
  const sobran = b.vallas.length - MAX_VALLAS;
  for (let i = 0; i < MAX_VALLAS; i++) {
    if (i === MAX_VALLAS - 1 && sobran > 0) {
      await valla(ctx, xs[i]!, vy, vw, vh, null, i, vigaY);
      roundRect(ctx, xs[i]! + 5, vy + 5, vw - 10, vh - 10, 4);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.fillStyle = "#1b1446";
      fitCenter(ctx, `y ${sobran + 1} Papus más`, xs[i]! + vw / 2, vy + vh / 2, vw - 24, 17, 9, TITLE, "bold");
    } else await valla(ctx, xs[i]!, vy, vw, vh, b.vallas[i] ?? null, i, vigaY);
  }
  lucesEstructura(ctx, vigaY, torres);

  const moneda = await loadImage(MONEDA).catch(() => null);
  for (const L of LUGARES) {
    const f = b.podio[L.lugar - 1]!;
    const top = PISO - L.bh;
    const x0 = L.cx - COL_W / 2 + 5, bw = COL_W - 10;
    const r = L.lugar === 1 ? 64 : 54;
    const acy = top - r - 46;
    // Luz sobre el lugar.
    const luz = ctx.createRadialGradient(L.cx, acy, 10, L.cx, acy, 190);
    luz.addColorStop(0, rgba(f.color, 0.5));
    luz.addColorStop(1, rgba(f.color, 0));
    ctx.fillStyle = luz;
    ctx.fillRect(L.cx - 190, acy - 190, 380, 380);
    // Bloque: metal con bisel arriba y un panel oscuro al frente para los datos.
    const g = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
    L.stops.forEach((s, i) => g.addColorStop(i / (L.stops.length - 1), s));
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = g;
    roundRect(ctx, x0, top, bw, L.bh + 12, 12);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x0 + 10, top + 4, bw - 20, 4);
    roundRect(ctx, x0 + 12, top + 62, bw - 24, L.bh - 72, 10);
    ctx.fillStyle = "rgba(20,12,30,0.66)";
    ctx.fill();
    guirnalda(ctx, x0 + 8, x0 + bw - 8, top + 8, 16, 0.85);
    medalla(ctx, L.cx, top + 36, 22, L.metal, L.lugar);
    // Cuotas que pagó y lo que repartió.
    const pagos: [string, number | undefined, string][] = [
      ["Ganador", f.pagos.ganador, "#FFD23D"],
      ["Segundo", f.pagos.segundo, "#D9DEE5"],
      ["Tercero", f.pagos.tercero, "#E6A06A"],
    ];
    let ly = top + 80;
    for (const [nombre, cuota, color] of pagos) {
      if (cuota === undefined) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x0 + 30, ly, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      leftText(ctx, `${nombre} pagó`, x0 + 42, ly, 120, 14, 10, FONT, "600");
      ctx.fillStyle = color;
      ctx.font = `bold 16px ${TITLE}`;
      const t = fmtCuota(cuota);
      const tw = ctx.measureText(t).width;
      leftText(ctx, t, x0 + bw - 28 - tw, ly, tw + 2, 16, 10, TITLE);
      ly += 21;
    }
    ly += 4;
    const texto = `${fmt(f.repartido)} repartidas`;
    ctx.font = `bold 14px ${FONT}`;
    const tw = ctx.measureText(texto).width + (moneda ? 24 : 0);
    if (moneda) ctx.drawImage(moneda, L.cx - tw / 2, ly - 10, 20, 20);
    ctx.fillStyle = "#fff3c4";
    leftText(ctx, texto, L.cx - tw / 2 + (moneda ? 24 : 0), ly, bw - 40, 14, 9);
    // Corredor: laureles, icono, guirnalda (1.º) y su nombre en una cinta.
    laureles(ctx, L.cx, acy, r, L.metal);
    const aro = ctx.createLinearGradient(L.cx - r, 0, L.cx + r, 0);
    L.stops.forEach((s, i) => aro.addColorStop(i / (L.stops.length - 1), s));
    circleAvatar(ctx, await loadImage(f.avatar), L.cx, acy, r, aro, f.color, 7);
    guirnalda(ctx, L.cx - r - 10, L.cx + r + 10, acy + r - 18, L.lugar === 1 ? 26 : 20, L.lugar === 1 ? 1 : 0.85);
    roundRect(ctx, L.cx - 88, acy + r + 12, 176, 30, 15);
    ctx.fillStyle = shade(f.color, -0.35);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = L.metal;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    fitCenter(ctx, f.nombre.toUpperCase(), L.cx, acy + r + 27, 160, 20, 12);

    // Los que le apostaron: con membresía (grandes, con su estilo) y después los demás.
    const l = listas[L.lugar - 1]!;
    let y = PISO + 28;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    fitCenter(ctx, f.apostadores.length ? `LE APOSTARON (${f.apostadores.length})` : "NADIE LE APOSTÓ", L.cx, y, COL_W, 12, 9, TITLE, "bold");
    y += 30;
    for (const p of l.miembros) {
      await chipMiembro(ctx, p, L.cx, y, COL_W - 14, 40);
      y += 46;
    }
    const half = (COL_W - 14) / 2;
    for (let k = 0; k < l.otros.length; k++) {
      const col = k % 2;
      const solo = col === 0 && k === l.otros.length - 1;
      await chipPapu(ctx, l.otros[k]!, solo ? L.cx - (half - 3) / 2 : L.cx - half + col * (half + 3), y, half - 3, 30);
      if (col === 1 || k === l.otros.length - 1) y += 36;
    }
    if (l.resto > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      fitCenter(ctx, `y ${l.resto} más`, L.cx, y - 4, COL_W, 13, 9, FONT, "600");
    }
  }

  // Los que apostaron a otros corredores sin membresía: una fila de iconos.
  if (b.tambien.length) {
    const y = H - 16 - tambien + 14;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    fitCenter(ctx, "TAMBIÉN APOSTARON", W / 2, y, 400, 12, 9, TITLE, "bold");
    const vis = b.tambien.slice(0, MAX_TAMBIEN);
    const extra = b.tambien.length > vis.length ? 1 : 0;
    const paso = 38, x0 = W / 2 - ((vis.length + extra) * paso) / 2 + paso / 2;
    for (let i = 0; i < vis.length; i++) await iconoPapu(ctx, vis[i]!, x0 + i * paso, y + 32, 15, "rgba(255,255,255,0.6)");
    if (extra) {
      ctx.fillStyle = "#ffffff";
      fitCenter(ctx, `+${b.tambien.length - vis.length}`, x0 + vis.length * paso, y + 32, paso, 15, 9, FONT, "bold");
    }
  }

  if (b.membresia) decorarMembresia(ctx, W, H, b.membresia);
  return c.toBuffer("image/png");
}

/**
 * Ordena a los que apostaron para el podio. Cada Papu sale una sola vez, en el corredor del podio al que más le
 * apostó (con membresía primero: nivel más alto y más apostado; después los demás por monto). Los que no le
 * apostaron a nadie del podio: con membresía, a las vallas; sin membresía, a la fila de abajo. Las vallas libres se
 * llenan con Papus de honor al azar que no salgan ya en la imagen.
 */
export function repartirApostadores<T extends Apostador>(
  podio: readonly string[],
  apuestas: readonly { papu: T; corredor: string; monto: number }[],
  honor: readonly T[] = [],
  rnd: () => number = Math.random,
): { porCorredor: Map<string, T[]>; vallas: Valla[]; tambien: T[] } {
  const clave = (p: Apostador) => p.id ?? p.nombre;
  const total = new Map<string, { papu: T; montos: Map<string, number> }>();
  for (const a of apuestas) {
    const e = total.get(clave(a.papu)) ?? { papu: a.papu, montos: new Map<string, number>() };
    e.montos.set(a.corredor, (e.montos.get(a.corredor) ?? 0) + a.monto);
    total.set(clave(a.papu), e);
  }
  type Fila = { p: T; monto: number };
  const orden = (a: Fila, b: Fila) => b.p.nivel - a.p.nivel || b.monto - a.monto;
  const porCorredor = new Map<string, Fila[]>(podio.map((id) => [id, []]));
  const fuera: Fila[] = [];
  for (const { papu, montos } of total.values()) {
    let mejor: [string, number] | null = null;
    for (const [id, monto] of montos) if (podio.includes(id) && (!mejor || monto > mejor[1])) mejor = [id, monto];
    if (mejor) porCorredor.get(mejor[0])!.push({ p: papu, monto: mejor[1] });
    else fuera.push({ p: papu, monto: [...montos.values()].reduce((s, v) => s + v, 0) });
  }
  fuera.sort(orden);
  const vallas: Valla[] = fuera.filter((f) => f.p.marco).map((f) => ({ tipo: "patrocina", papu: f.p }));
  const libres = honor.filter((h) => !total.has(clave(h)));
  for (let i = libres.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [libres[i], libres[j]] = [libres[j]!, libres[i]!];
  }
  for (const h of libres) {
    if (vallas.length >= MAX_VALLAS) break;
    vallas.push({ tipo: "honor", papu: h });
  }
  return {
    porCorredor: new Map([...porCorredor].map(([id, l]) => [id, l.sort(orden).map((x) => x.p)])),
    vallas,
    tambien: fuera.filter((f) => !f.p.marco).map((f) => f.p),
  };
}
