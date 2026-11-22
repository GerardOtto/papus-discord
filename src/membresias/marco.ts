// Estilo de membresía en las imágenes con el nombre del Papu (PLAN §2; pedido de GyroP, 13 nov. 2026): banner de su
// boda, su tarjeta de nivel (y los avisos de subida y rango), el GIF de su ruleta, el banner de la Ruleta de Némesis
// que lanza y el de la pelea que lanza. Un marco del color de su nivel y una cinta en la esquina con su nivel; desde
// Baguette, un brillo que cruza; desde Celular, partículas; en Triple Baka, todo se mueve en los GIF. Solo adorno.
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { EstiloBanner, NivelMembresia } from "./rules";

const TAU = Math.PI * 2;

export interface MarcoMembresia {
  estilo: EstiloBanner;
  /** Color del rol (#RRGGBB). */
  color: string;
  /** "🥖 Baguette" (va en la cinta, sin el emoji: el canvas no dibuja emojis de color). */
  nombre: string;
}

/** El marco de un nivel de membresía (o undefined sin membresía). */
export function marcoDe(n: NivelMembresia | null | undefined): MarcoMembresia | undefined {
  return n ? { estilo: n.banner, color: n.color, nombre: n.nombre } : undefined;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Un poco más claro (para degradados). */
function claro(hex: string, k = 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `rgb(${c.join(",")})`;
}

function estrella(ctx: SKRSContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.35 : r, a = -Math.PI / 2 + (i * Math.PI) / 4;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** Número pseudoaleatorio fijo (las partículas no saltan de un cuadro a otro). */
const fijo = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Dibuja el marco de membresía sobre una imagen de w×h. `t` (0 a 1) es la fase de la animación: en las imágenes fijas,
 * 0; en los GIF, el cuadro actual (solo el estilo «animado» se mueve).
 */
export function decorarMembresia(ctx: SKRSContext2D, w: number, h: number, m: MarcoMembresia, t = 0, opts: { soloCinta?: boolean } = {}): void {
  if (opts.soloCinta) return cinta(ctx, w, m);
  const grosor = Math.max(6, Math.round(Math.min(w, h) * 0.012));
  const mueve = m.estilo === "animado" ? t : 0;
  ctx.save();
  // Marco: color del nivel (degradado desde Baguette; tornasol que corre en Triple Baka).
  const g = ctx.createLinearGradient(0, 0, w, h);
  if (m.estilo === "animado") {
    const cols = [m.color, "#FFD86B", "#B5FFFC", "#FFB3E6", m.color];
    cols.forEach((c, i) => g.addColorStop((i / (cols.length - 1) + mueve) % 1, c));
  } else if (m.estilo === "basico") {
    g.addColorStop(0, m.color);
    g.addColorStop(1, m.color);
  } else {
    g.addColorStop(0, m.color);
    g.addColorStop(0.5, claro(m.color));
    g.addColorStop(1, m.color);
  }
  ctx.shadowColor = rgba(m.color, 0.8);
  ctx.shadowBlur = m.estilo === "basico" ? 0 : grosor * 2;
  ctx.lineWidth = grosor;
  ctx.strokeStyle = g;
  ctx.strokeRect(grosor / 2, grosor / 2, w - grosor, h - grosor);
  ctx.restore();

  // Brillo que cruza el marco (Baguette y más; en Triple Baka se desplaza).
  if (m.estilo !== "basico") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(grosor * 1.6, grosor * 1.6, w - grosor * 3.2, h - grosor * 3.2);
    ctx.clip("evenodd");
    const x = (0.15 + mueve) % 1 * (w + h) - h;
    const s = ctx.createLinearGradient(x, 0, x + h * 0.6, h);
    s.addColorStop(0, "rgba(255,255,255,0)");
    s.addColorStop(0.5, "rgba(255,255,255,0.75)");
    s.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Partículas a lo largo del marco (Celular y más; titilan en Triple Baka).
  if (m.estilo === "particulas" || m.estilo === "animado") {
    ctx.save();
    const n = 18;
    for (let i = 0; i < n; i++) {
      const p = fijo(i) * 2 * (w + h);
      const [x, y] = p < w ? [p, grosor] : p < w + h ? [w - grosor, p - w] : p < 2 * w + h ? [2 * w + h - p, h - grosor] : [grosor, 2 * (w + h) - p];
      const brillo = m.estilo === "animado" ? 0.4 + 0.6 * Math.abs(Math.sin((mueve + fijo(i + 50)) * TAU)) : 0.9;
      estrella(ctx, x, y, grosor * (0.9 + fijo(i + 7) * 0.8));
      ctx.fillStyle = `rgba(255,255,240,${brillo})`;
      ctx.shadowColor = rgba(m.color, 1);
      ctx.shadowBlur = grosor;
      ctx.fill();
    }
    ctx.restore();
  }

  cinta(ctx, w, m);
}

/**
 * Placa con el nombre del nivel bajo el avatar de la tarjeta de nivel (pedido de GyroP, 18 nov. 2026: la cinta de la
 * esquina tapaba una insignia). Centrada en `cx`, con su parte de arriba en `y`; del color del nivel, con brillo desde
 * Baguette, estrellitas desde Celular y el brillo que corre en Triple Baka (`t`, 0 a 1).
 */
export function placaMembresia(ctx: SKRSContext2D, cx: number, y: number, m: MarcoMembresia, t = 0): void {
  ctx.save();
  const size = 17;
  ctx.font = `900 ${size}px "Bahnschrift", "Segoe UI", sans-serif`;
  const texto = m.nombre.toUpperCase();
  const mm = ctx.measureText(texto);
  const tw = mm.actualBoundingBoxRight + mm.actualBoundingBoxLeft;
  const w = Math.min(200, Math.max(110, tw + 34)), h = 32, x = cx - w / 2;
  const caja = () => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
  };
  const fondo = ctx.createLinearGradient(x, 0, x + w, 0);
  fondo.addColorStop(0, m.color);
  fondo.addColorStop(0.5, m.estilo === "basico" ? m.color : claro(m.color, 0.3));
  fondo.addColorStop(1, m.color);
  ctx.shadowColor = m.estilo === "basico" ? "rgba(0,0,0,0.5)" : rgba(m.color, 0.9);
  ctx.shadowBlur = m.estilo === "basico" ? 6 : 14;
  caja();
  ctx.fillStyle = fondo;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
  // Brillo que cruza la placa (Baguette y más; se mueve en Triple Baka).
  if (m.estilo !== "basico") {
    ctx.save();
    caja();
    ctx.clip();
    const bx = x - w * 0.6 + (((m.estilo === "animado" ? t : 0) + 0.35) % 1) * w * 1.8;
    const s = ctx.createLinearGradient(bx, y, bx + w * 0.35, y + h);
    s.addColorStop(0, "rgba(255,255,255,0)");
    s.addColorStop(0.5, "rgba(255,255,255,0.6)");
    s.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  // Estrellitas en las puntas (Celular y más; titilan en Triple Baka).
  if (m.estilo === "particulas" || m.estilo === "animado") {
    for (const [i, px, py] of [[0, x + 4, y + 2], [1, x + w - 4, y + h - 2], [2, x + w - 10, y + 1]] as const) {
      const brillo = m.estilo === "animado" ? 0.45 + 0.55 * Math.abs(Math.sin((t + fijo(i + 50)) * TAU)) : 0.95;
      estrella(ctx, px, py, 7);
      ctx.fillStyle = `rgba(255,255,240,${brillo})`;
      ctx.shadowColor = rgba(m.color, 1);
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const tx = cx - (mm.actualBoundingBoxRight - mm.actualBoundingBoxLeft) / 2 + mm.actualBoundingBoxLeft;
  const ty = y + h / 2 + (mm.actualBoundingBoxAscent - mm.actualBoundingBoxDescent) / 2;
  ctx.lineWidth = Math.max(2, size / 6);
  ctx.strokeStyle = "rgba(20,10,30,0.6)";
  ctx.strokeText(texto, tx, ty);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(texto, tx, ty);
  ctx.restore();
}

/** Cinta en la esquina superior derecha con el nombre del nivel. */
function cinta(ctx: SKRSContext2D, w: number, m: MarcoMembresia): void {
  ctx.save();
  const size = Math.max(16, Math.round(w * 0.018));
  ctx.font = `900 ${size}px "Bahnschrift", "Segoe UI", sans-serif`;
  const texto = m.nombre.toUpperCase();
  const tw = ctx.measureText(texto).width;
  const L = tw + size * 3.2;
  ctx.translate(w, 0);
  ctx.rotate(Math.PI / 4);
  const y0 = L / 2;
  const fondo = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
  fondo.addColorStop(0, m.color);
  fondo.addColorStop(0.5, m.estilo === "basico" ? m.color : claro(m.color, 0.3));
  fondo.addColorStop(1, m.color);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = fondo;
  ctx.fillRect(-L / 2, y0 - size * 0.85, L, size * 1.7);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const mm = ctx.measureText(texto);
  const tx = -(mm.actualBoundingBoxRight - mm.actualBoundingBoxLeft) / 2 + mm.actualBoundingBoxLeft;
  const ty = y0 + (mm.actualBoundingBoxAscent - mm.actualBoundingBoxDescent) / 2;
  ctx.lineWidth = Math.max(2, size / 6);
  ctx.strokeStyle = "rgba(20,10,30,0.6)";
  ctx.strokeText(texto, tx, ty);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(texto, tx, ty);
  ctx.restore();
}
