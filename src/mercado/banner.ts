// Banner del mercado negro (PLAN §3.9): los objetos de la vitrina del día sobre podios, con su nombre y precio debajo.
// Cinco columnas iguales para que cada botón de compra (en una sola fila, en el mismo orden) quede debajo de su objeto.
// Texto centrado por su dibujo real y achicado hasta caber en su columna (nunca se sale).
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { centerText } from "../coins/arte";
import { FONT } from "../levels/card";

/** Ancho y alto del banner: Discord lo muestra a la mitad (550 × 280), como la fila de 5 botones de debajo. */
export const BANNER_W = 1100;
export const BANNER_H = 560;
/** Ancho de cada columna (un objeto sobre cada botón). */
export const COL_W = 214;
const VERDE = "#8FE36B";
const DORADO = "#FFC83D";
const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));

export interface PodioItem {
  emoji: string;
  nombre: string;
  precio: number;
  /** Línea chica bajo el precio ("3 usos", "para siempre"). */
  detalle: string;
}

/** Parte el texto en hasta `maxLines` líneas que quepan en `maxW`, achicando la letra desde `size` hasta `min`. */
export function fitLines(ctx: SKRSContext2D, text: string, maxW: number, size: number, min: number, maxLines: number, weight = "700"): { lines: string[]; size: number } {
  for (let s = size; s >= min; s--) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxW) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { lines, size: s };
  }
  // No cupo ni en la letra más chica: se corta con «…» (nunca se sale de la columna).
  ctx.font = `${weight} ${min}px ${FONT}`;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return { lines: [`${t}…`], size: min };
}

/** Shaula-coin dibujada: círculo dorado con borde y «S». */
function moneda(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
  g.addColorStop(0, "#FFE58A");
  g.addColorStop(1, "#D99A00");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.strokeStyle = "#8A5A00";
  ctx.stroke();
  ctx.fillStyle = "#8A5A00";
  ctx.font = `900 ${Math.round(r * 1.2)}px ${FONT}`;
  centerText(ctx, "S", cx, cy);
}

function podio(ctx: SKRSContext2D, cx: number, top: number, w: number, h: number): void {
  // Cuerpo con un leve trapecio y la cara de arriba como elipse, con borde verde neón.
  const body = ctx.createLinearGradient(0, top, 0, top + h);
  body.addColorStop(0, "#3a2457");
  body.addColorStop(1, "#160d24");
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top);
  ctx.lineTo(cx + w / 2, top);
  ctx.lineTo(cx + w / 2 + 10, top + h);
  ctx.lineTo(cx - w / 2 - 10, top + h);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "rgba(143,227,107,0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, top, w / 2, 14, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#4b3170";
  ctx.fill();
  ctx.shadowColor = VERDE;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = VERDE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** El banner de la vitrina del día (hasta 5 objetos, de izquierda a derecha como los botones). */
export async function mercadoBanner(items: PodioItem[]): Promise<Buffer> {
  const c = createCanvas(BANNER_W, BANNER_H);
  const ctx = c.getContext("2d");
  // Fondo: noche violeta con una cuadrícula verde apenas visible.
  const bg = ctx.createLinearGradient(0, 0, 0, BANNER_H);
  bg.addColorStop(0, "#0b0812");
  bg.addColorStop(1, "#1d1030");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, BANNER_W, BANNER_H);
  ctx.strokeStyle = "rgba(143,227,107,0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= BANNER_W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, BANNER_H);
    ctx.stroke();
  }
  for (let y = 0; y <= BANNER_H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(BANNER_W, y);
    ctx.stroke();
  }
  // Título.
  ctx.fillStyle = VERDE;
  ctx.shadowColor = VERDE;
  ctx.shadowBlur = 18;
  ctx.font = `900 40px ${FONT}`;
  centerText(ctx, "MERCADO NEGRO", (5 * COL_W) / 2, 42);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `600 17px ${FONT}`;
  centerText(ctx, "solo Shaula-coins ganadas · cambia cada día", (5 * COL_W) / 2, 80);

  // Columnas al paso de los botones de Discord: «¡Lo quiero!» mide ~99 px + 8 de separación = ~107 px de los 550 en que
  // se muestra el banner (214 aquí), empezando por la izquierda como la fila de botones.
  const colW = COL_W;
  const x0 = 0;
  // Cada columna es un bloque (objeto, podio, nombre, precio y detalle) centrado en el eje de su columna; todos los
  // bloques, centrados en vertical en el espacio bajo el título. Medidas relativas a la cara de arriba del podio.
  const podH = 70, podW = 150;
  const EMOJI = 110, ARRIBA = 62 + EMOJI / 2, NOMBRE = podH + 34, PRECIO = 186, DETALLE = 224, ABAJO = DETALLE + 8;
  const zonaTop = 100, zonaH = BANNER_H - zonaTop;
  const podTop = Math.round(zonaTop + (zonaH - (ARRIBA + ABAJO)) / 2 + ARRIBA);
  items.slice(0, 5).forEach((it, i) => {
    const cx = x0 + colW * i + colW / 2;
    // Foco de luz desde arriba.
    const spot = ctx.createRadialGradient(cx, podTop - 60, 10, cx, podTop - 60, 120);
    spot.addColorStop(0, "rgba(143,227,107,0.22)");
    spot.addColorStop(1, "rgba(143,227,107,0)");
    ctx.fillStyle = spot;
    // Fuera del radio el foco es transparente: se pinta todo el lienzo y se apaga solo, sin bordes.
    ctx.fillRect(0, 0, BANNER_W, BANNER_H);
    podio(ctx, cx, podTop, podW, podH);
    // El objeto (su emoji), apoyado en el podio.
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.font = `${EMOJI}px ${FONT}`;
    centerText(ctx, it.emoji, cx, podTop - 62);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    // Nombre (hasta 2 líneas, achicado para caber), precio y detalle.
    const maxW = colW - 22;
    const name = fitLines(ctx, it.nombre, maxW, 24, 15, 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${name.size}px ${FONT}`;
    const lh = name.size * 1.2;
    const nameTop = podTop + NOMBRE;
    name.lines.forEach((l, k) => centerText(ctx, l, cx, nameTop + k * lh + (name.lines.length === 1 ? lh / 2 : 0)));
    // Precio: moneda dibujada (un emoji dentro del texto descuadra la medida) y la cifra, centradas juntas.
    const price = fitLines(ctx, fmt(it.precio), maxW - 40, 28, 16, 1, "800");
    ctx.font = `800 ${price.size}px ${FONT}`;
    const m = ctx.measureText(price.lines[0]!);
    const textW = m.actualBoundingBoxRight + m.actualBoundingBoxLeft;
    const r = price.size * 0.5, gap = 8;
    const left = cx - (2 * r + gap + textW) / 2;
    moneda(ctx, left + r, podTop + PRECIO, r);
    ctx.font = `800 ${price.size}px ${FONT}`;
    ctx.fillStyle = DORADO;
    centerText(ctx, price.lines[0]!, left + 2 * r + gap + textW / 2, podTop + PRECIO);
    const det = fitLines(ctx, it.detalle, maxW, 16, 12, 1, "600");
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `600 ${det.size}px ${FONT}`;
    centerText(ctx, det.lines[0]!, cx, podTop + DETALLE);
  });
  return c.encode("png");
}
