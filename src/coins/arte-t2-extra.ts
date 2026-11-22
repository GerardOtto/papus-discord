// Segunda tanda de arte propio de la temporada 2 (pedido de GyroP, 13 nov. 2026: «muchos más recursos, no solo
// fondos»): un juego completo por cada pecado capital (aro, borde, barra e insignia con su símbolo y su color), más
// bordes, aros, barras, nombres e insignias de Navidad. Todo dibujado con código, sin renders ni imágenes ajenas.
// Las insignias se dibujan en 128×128 (scripts/temporada2.ts las guarda en assets/coleccion/insignias/t2/).
import type { SKRSContext2D } from "@napi-rs/canvas";
import { CARD_H, CARD_W, gradient } from "../levels/card";
import { cardPath, copo, perimetro, rgba, type BarPaint, type NameStyle, type Paint } from "./arte-t2";

const TAU = Math.PI * 2;
const W = CARD_W, H = CARD_H;
const AX = 40, AY = 60, AS = 210;
const ACX = AX + AS / 2, ACY = AY + AS / 2, AR = AS / 2;

export type Simbolo = "corazon" | "caliz" | "tijeras" | "moneda" | "luna" | "rayo" | "corona" | "estrella";

/**
 * Los siete pecados: id, nombre, color, color claro y símbolo. El color es el de la Vocaloid que protagoniza el pecado en
 * la saga (pedido de GyroP, 13 nov. 2026), tomado de la paleta del motor ($ENGINE_DIR/config/characters.json:
 * subtitleColor y el tono claro de `palette`): lujuria Gakupo (Venomania), gula Meiko (Conchita), envidia Luka (Kayo),
 * avaricia Kaito (Gallerian), pereza Miku (Margarita), ira Gumi (Nemesis) y orgullo Rin (Riliane).
 */
export const SIETE: { id: string; nombre: string; color: string; claro: string; simbolo: Simbolo; vocaloid: string }[] = [
  { id: "lujuria", nombre: "Lujuria", color: "#A77BFF", claro: "#DCCBFF", simbolo: "corazon", vocaloid: "gakupo" },
  { id: "gula", nombre: "Gula", color: "#E0383E", claro: "#FFC9C9", simbolo: "caliz", vocaloid: "meiko" },
  { id: "envidia", nombre: "Envidia", color: "#E285B2", claro: "#FFD6EA", simbolo: "tijeras", vocaloid: "luka" },
  { id: "avaricia", nombre: "Avaricia", color: "#3D6BFF", claro: "#BFD0FF", simbolo: "moneda", vocaloid: "kaito" },
  { id: "pereza", nombre: "Pereza", color: "#39C5BB", claro: "#B8F5EE", simbolo: "luna", vocaloid: "miku" },
  { id: "ira", nombre: "Ira", color: "#7FCB4B", claro: "#D9F5B8", simbolo: "rayo", vocaloid: "gumi" },
  { id: "orgullo", nombre: "Orgullo", color: "#F6C744", claro: "#FFF2B8", simbolo: "corona", vocaloid: "rin" },
];

/** Símbolo centrado en (x, y), de radio r, con el color de relleno actual. */
export function simbolo(ctx: SKRSContext2D, tipo: Simbolo, x: number, y: number, r: number, giro = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(giro);
  ctx.beginPath();
  switch (tipo) {
    case "corazon":
      ctx.moveTo(0, r * 0.85);
      ctx.bezierCurveTo(-r * 1.5, -r * 0.2, -r * 0.6, -r * 1.2, 0, -r * 0.4);
      ctx.bezierCurveTo(r * 0.6, -r * 1.2, r * 1.5, -r * 0.2, 0, r * 0.85);
      ctx.fill();
      break;
    case "caliz":
      ctx.moveTo(-r * 0.75, -r * 0.9);
      ctx.quadraticCurveTo(-r * 0.7, r * 0.25, 0, r * 0.25);
      ctx.quadraticCurveTo(r * 0.7, r * 0.25, r * 0.75, -r * 0.9);
      ctx.fill();
      ctx.fillRect(-r * 0.1, r * 0.2, r * 0.2, r * 0.55);
      ctx.fillRect(-r * 0.5, r * 0.72, r, r * 0.2);
      break;
    case "tijeras":
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(1.5, r * 0.22);
      ctx.lineCap = "round";
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.55, -r * 0.95);
        ctx.lineTo(-s * r * 0.3, r * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-s * r * 0.45, r * 0.62, r * 0.3, 0, TAU);
        ctx.stroke();
      }
      break;
    case "moneda":
      ctx.arc(0, 0, r * 0.95, 0, TAU);
      ctx.arc(0, 0, r * 0.62, 0, TAU, true);
      ctx.fill("evenodd");
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.32, 0, TAU);
      ctx.fill();
      break;
    case "luna":
      ctx.arc(0, 0, r * 0.95, 0, TAU);
      ctx.arc(r * 0.42, -r * 0.2, r * 0.8, 0, TAU, true);
      ctx.fill("evenodd");
      break;
    case "rayo":
      for (const [px, py] of [[0.25, -1], [-0.6, 0.15], [-0.05, 0.15], [-0.3, 1], [0.6, -0.2], [0.05, -0.2]] as const) ctx.lineTo(px * r, py * r);
      ctx.fill();
      break;
    case "corona":
      for (const [px, py] of [[-0.95, 0.7], [-0.95, -0.5], [-0.45, 0.05], [0, -0.85], [0.45, 0.05], [0.95, -0.5], [0.95, 0.7]] as const) ctx.lineTo(px * r, py * r);
      ctx.fill();
      break;
    case "estrella":
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.fill();
      break;
  }
  ctx.restore();
}

/** Degradado que se desplaza un período entero por bucle (para brillos que corren sin salto). */
function corrido(ctx: SKRSContext2D, x: number, w: number, t: number, colores: string[]) {
  const g = ctx.createLinearGradient(x - 2 * w + t * w, 0, x + 2 * w + t * w, 0);
  const n = colores.length;
  for (let k = 0; k <= 4 * n; k++) g.addColorStop(k / (4 * n), colores[k % n]!);
  return g;
}

// ───────────────────────── un juego por pecado ─────────────────────────

/** Rara: marco del color del pecado con su símbolo en las esquinas y en los lados. */
function bordePecado(color: string, claro: string, s: Simbolo): Paint {
  return (ctx) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.shadowBlur = 0;
    cardPath(ctx, 13, 17);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = claro;
    ctx.stroke();
    ctx.fillStyle = claro;
    for (const [x, y] of [[26, 26], [W - 26, 26], [26, H - 26], [W - 26, H - 26]] as const) simbolo(ctx, s, x, y, 11);
    ctx.fillStyle = color;
    for (let x = 170; x < W - 100; x += 165) {
      simbolo(ctx, s, x, 9, 7);
      simbolo(ctx, s, x, H - 9, 7);
    }
    ctx.restore();
  };
}

/** Épica: aro del color del pecado con cuatro símbolos que giran alrededor. */
function aroPecado(color: string, claro: string, s: Simbolo): Paint {
  return (ctx, t) => {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(ACX, ACY, AR + 9, 0, TAU);
    ctx.fillStyle = gradient(ctx, AX - 9, 0, AS + 18, [color, claro, color]);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = claro;
    for (let i = 0; i < 4; i++) {
      const a = (t / 4 + i / 4) * TAU;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      simbolo(ctx, s, ACX + Math.cos(a) * (AR + 24), ACY + Math.sin(a) * (AR + 24), 11);
      ctx.restore();
    }
  };
}

/** Rara: barra del color del pecado con su símbolo repetido. */
function barraPecado(color: string, claro: string, s: Simbolo): BarPaint {
  return (ctx, _t, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, x, 0, Math.max(w, 1), [rgba(color, 0.55), color]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = claro;
    for (let px = x + 16; px < x + w; px += 30) simbolo(ctx, s, px, y + h / 2, h * 0.32);
  };
}

/** Insignia (128×128): medallón del color del pecado con su símbolo. */
function medallon(color: string, claro: string, s: Simbolo): (ctx: SKRSContext2D) => void {
  return (ctx) => {
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, TAU);
    ctx.fillStyle = claro;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(64, 64, 50, 0, TAU);
    const g = ctx.createRadialGradient(50, 46, 6, 64, 64, 54);
    g.addColorStop(0, color);
    g.addColorStop(1, rgba("#000000", 0.55));
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = claro;
    simbolo(ctx, s, 64, 66, 30);
  };
}

const porPecado = <T>(prefijo: string, hacer: (color: string, claro: string, s: Simbolo) => T): Record<string, T> =>
  Object.fromEntries(SIETE.map((p) => [`${prefijo}-${p.id}`, hacer(p.color, p.claro, p.simbolo)]));

// ───────────────────────── bordes ─────────────────────────

const AURORA = ["#3DDC84", "#3FD6FF", "#B36BFF", "#3FD6FF"];

export const BORDES_T2_EXTRA: Record<string, Paint> = {
  ...porPecado("borde", bordePecado),
  // Común: papel de regalo rojo con rayas doradas y un moño arriba.
  "papel-de-regalo": (ctx) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#C81E32";
    ctx.stroke();
    ctx.setLineDash([3, 13]);
    ctx.strokeStyle = "#FFD23F";
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#FFD23F";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(W / 2 + s * 17, 9, 16, 9, s * 0.35, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#E0A800";
    ctx.beginPath();
    ctx.arc(W / 2, 10, 7, 0, TAU);
    ctx.fill();
  },
  // Común: galleta de jengibre con glaseado en zigzag.
  "galleta-de-jengibre": (ctx) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#9A5B2E";
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    perimetro(10, 6).forEach((p, i) => ctx.lineTo(p.x + p.nx * (i % 2 ? 4 : -3), p.y + p.ny * (i % 2 ? 4 : -3)));
    ctx.closePath();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#FFF6E8";
    ctx.stroke();
  },
  // Rara: nieve acumulada arriba, con carámbanos, y un filo de hielo en el resto.
  "tejado-nevado": (ctx) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#9FD8F5";
    ctx.stroke();
    ctx.clip();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, 15 + Math.sin(x / 31) * 5 + Math.sin(x / 11) * 2.5);
    ctx.lineTo(W, 0);
    ctx.fill();
    ctx.fillStyle = "#DDF3FF";
    for (let x = 60; x < W - 40; x += 97) {
      const largo = 14 + ((x * 7) % 16);
      ctx.beginPath();
      ctx.moveTo(x - 5, 15);
      ctx.lineTo(x, 17 + largo);
      ctx.lineTo(x + 5, 15);
      ctx.fill();
    }
    ctx.restore();
  },
  // Épica: cielo de noche con estrellas que titilan alrededor.
  "noche-estrellada": (ctx, t) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#16224A";
    ctx.stroke();
    ctx.restore();
    perimetro(46, 6).forEach((p, i) => {
      const b = 0.5 + 0.5 * Math.sin((t * 2 + i * 0.31) * TAU);
      ctx.save();
      ctx.shadowColor = "#FFF6B0";
      ctx.shadowBlur = 10 * b;
      ctx.fillStyle = `rgba(255,246,190,${0.35 + 0.65 * b})`;
      simbolo(ctx, "estrella", p.x, p.y, 4 + 4 * b);
      ctx.restore();
    });
  },
  // Legendaria: aurora boreal que recorre el borde.
  "aurora-boreal": (ctx, t) => {
    ctx.save();
    cardPath(ctx, 5);
    ctx.shadowColor = "#3FD6FF";
    ctx.shadowBlur = 24;
    ctx.lineWidth = 9;
    ctx.strokeStyle = corrido(ctx, 0, W, t, AURORA);
    ctx.stroke();
    ctx.shadowBlur = 0;
    cardPath(ctx, 5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.stroke();
    ctx.restore();
  },
  // Mítica: los siete pecados rodean la tarjeta, un tramo de color con su símbolo cada uno, y se encienden por turno
  // (pedido de GyroP: más calma que un giro completo en cada bucle de 1,4 s).
  "rueda-de-los-siete": (ctx, t) => {
    const pts = perimetro(6, 8), n = pts.length;
    SIETE.forEach((pec, i) => {
      const turno = Math.max(0, Math.cos((t - i / SIETE.length) * TAU));
      const tramo = pts.slice(Math.floor((i * n) / SIETE.length), Math.floor(((i + 1) * n) / SIETE.length) + 1);
      ctx.save();
      ctx.shadowColor = pec.color;
      ctx.shadowBlur = 8 + 18 * turno;
      ctx.lineWidth = 9;
      ctx.lineJoin = "round";
      ctx.strokeStyle = pec.color;
      ctx.beginPath();
      tramo.forEach((p, k) => (k ? ctx.lineTo(p.x - p.nx * 3, p.y - p.ny * 3) : ctx.moveTo(p.x - p.nx * 3, p.y - p.ny * 3)));
      ctx.stroke();
      ctx.restore();
      // El símbolo va en el medio del tramo, un poco hacia adentro (en las esquinas se cortaba).
      const m = tramo[Math.floor(tramo.length / 2)]!;
      const c = { x: Math.min(W - 24, Math.max(24, m.x + m.nx * 8)), y: Math.min(H - 24, Math.max(24, m.y + m.ny * 8)) };
      ctx.save();
      ctx.shadowColor = pec.color;
      ctx.shadowBlur = 6 + 22 * turno;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 13 + 3 * turno, 0, TAU);
      ctx.fillStyle = "#16131f";
      ctx.fill();
      ctx.fillStyle = turno > 0.5 ? "#FFFFFF" : pec.claro;
      simbolo(ctx, pec.simbolo, c.x, c.y, 8 + 2 * turno);
      ctx.restore();
    });
  },
};

// ───────────────────────── aros de avatar ─────────────────────────

export const AROS_T2_EXTRA: Record<string, Paint> = {
  ...porPecado("aro", aroPecado),
  // Común: esfera del árbol, dorada, con su tapa.
  "esfera-del-arbol": (ctx) => {
    ctx.beginPath();
    ctx.arc(ACX, ACY, AR + 8, 0, TAU);
    ctx.fillStyle = gradient(ctx, AX - 8, 0, AS + 16, ["#B8860B", "#FFE08A", "#B8860B"]);
    ctx.fill();
    ctx.fillStyle = "#8A8FA8";
    ctx.fillRect(ACX - 11, ACY - AR - 20, 22, 12);
    ctx.beginPath();
    ctx.arc(ACX, ACY - AR - 22, 6, Math.PI, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#8A8FA8";
    ctx.stroke();
  },
  // Rara: gorro de Santa, aro rojo con borde de peluche y un pompón.
  "gorro-de-santa": (ctx) => {
    ctx.beginPath();
    ctx.arc(ACX, ACY, AR + 9, 0, TAU);
    ctx.fillStyle = "#D01F35";
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * 0.08 + (i / 25) * Math.PI * 0.84;
      ctx.beginPath();
      ctx.arc(ACX + Math.cos(a) * (AR + 9), ACY + Math.sin(a) * (AR + 9), 10, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(ACX + AR * 0.78, ACY - AR * 0.78, 17, 0, TAU);
    ctx.fill();
  },
  // Épica: la estrella de Belén, con rayos que laten.
  "estrella-de-belen": (ctx, t) => {
    ctx.save();
    ctx.shadowColor = "#FFE08A";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#FFE9A8";
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, largo = (i % 2 ? 20 : 34) + 8 * Math.sin((t * 2 + i * 0.125) * TAU);
      ctx.beginPath();
      ctx.moveTo(ACX + Math.cos(a - 0.09) * AR, ACY + Math.sin(a - 0.09) * AR);
      ctx.lineTo(ACX + Math.cos(a) * (AR + largo), ACY + Math.sin(a) * (AR + largo));
      ctx.lineTo(ACX + Math.cos(a + 0.09) * AR, ACY + Math.sin(a + 0.09) * AR);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(ACX, ACY, AR + 7, 0, TAU);
    ctx.fillStyle = gradient(ctx, AX - 7, 0, AS + 14, ["#B8860B", "#FFF6D5", "#B8860B"]);
    ctx.fill();
    ctx.restore();
  },
  // Legendaria: aurora que gira alrededor del avatar.
  "aurora-en-orbita": (ctx, t) => {
    const n = 72;
    ctx.save();
    ctx.shadowColor = "#3FD6FF";
    ctx.shadowBlur = 18;
    ctx.lineWidth = 16;
    for (let i = 0; i < n; i++) {
      const f = (((i + 0.5) / n + t) % 1) * AURORA.length;
      ctx.beginPath();
      ctx.arc(ACX, ACY, AR + 4, (i / n) * TAU, ((i + 1.4) / n) * TAU);
      ctx.strokeStyle = AURORA[Math.floor(f) % AURORA.length]!;
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin((f % 1) * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  },
  // Mítica: corona de los siete pecados, siete tramos de color con sus símbolos; un destello da la vuelta completa
  // (los tramos quedan fijos: si giraran un séptimo por bucle, los colores saltarían al cerrarlo).
  "corona-de-los-siete": (ctx, t) => {
    ctx.save();
    ctx.shadowColor = "#FFFFFF";
    ctx.shadowBlur = 20;
    ctx.lineWidth = 16;
    SIETE.forEach((p, i) => {
      const a = (i / 7) * TAU - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(ACX, ACY, AR + 4, a, a + TAU / 7 + 0.02);
      ctx.strokeStyle = p.color;
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
    const d = t * TAU - Math.PI / 2;
    for (let k = 0; k < 10; k++) {
      ctx.beginPath();
      ctx.arc(ACX, ACY, AR + 4, d - (k + 1) * 0.06, d - k * 0.06);
      ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - k / 10)})`;
      ctx.stroke();
    }
    SIETE.forEach((p, i) => {
      const a = ((i + 0.5) / 7) * TAU - Math.PI / 2;
      ctx.fillStyle = "#16131f";
      ctx.beginPath();
      ctx.arc(ACX + Math.cos(a) * (AR + 22), ACY + Math.sin(a) * (AR + 22), 12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.claro;
      simbolo(ctx, p.simbolo, ACX + Math.cos(a) * (AR + 22), ACY + Math.sin(a) * (AR + 22), 7.5);
    });
    ctx.restore();
  },
};

// ───────────────────────── barras de XP ─────────────────────────

export const BARRAS_T2_EXTRA: Record<string, BarPaint> = {
  ...porPecado("barra", barraPecado),
  // Común: cinta de regalo roja con filos dorados.
  "cinta-de-regalo": (ctx, _t, x, y, w, h) => {
    ctx.fillStyle = "#C81E32";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#FFD23F";
    ctx.fillRect(x, y + 3, w, 3);
    ctx.fillRect(x, y + h - 6, w, 3);
  },
  // Común: galleta con glaseado.
  "glaseado": (ctx, _t, x, y, w, h) => {
    ctx.fillStyle = "#9A5B2E";
    ctx.fillRect(x, y, w, h);
    ctx.beginPath();
    for (let px = 0; px <= w; px += 9) ctx.lineTo(x + px, y + h / 2 + ((px / 9) % 2 ? 5 : -5));
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#FFF6E8";
    ctx.stroke();
  },
  // Épica: copos que cruzan una noche azul.
  "ventisca": (ctx, t, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, x, 0, Math.max(w, 1), ["#16224A", "#2A6FB0"]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#FFFFFF";
    for (let i = 0; i < 26; i++) {
      const p = (((i * 0.137 + t) % 1) + 1) % 1;
      ctx.beginPath();
      ctx.arc(x + p * 700 - 20, y + ((i * 0.618) % 1) * h, 1.5 + (i % 3), 0, TAU);
      ctx.fill();
    }
  },
  // Épica: veneno morado que burbujea.
  "veneno": (ctx, t, x, y, w, h) => {
    ctx.fillStyle = gradient(ctx, x, 0, Math.max(w, 1), ["#3A0E5A", "#B04BFF"]);
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 16; i++) {
      const p = (((i * 0.21 + t * (1 + (i % 2))) % 1) + 1) % 1;
      ctx.beginPath();
      ctx.arc(x + ((i * 0.377) % 1) * 660 + 8, y + h + 4 - p * (h + 8), 2.5 + (i % 3) * 1.5, 0, TAU);
      ctx.fillStyle = `rgba(240,200,255,${0.75 * (1 - p)})`;
      ctx.fill();
    }
  },
  // Legendaria: aurora boreal.
  "aurora": (ctx, t, x, y, w, h) => {
    ctx.fillStyle = corrido(ctx, x, 330, t, AURORA);
    ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "rgba(255,255,255,0.45)");
    g.addColorStop(0.5, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(10,10,40,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  },
};

// ───────────────────────── efectos de nombre ─────────────────────────

export const NOMBRES_T2_EXTRA: Record<string, NameStyle> = {
  // Común: rojo y verde de Navidad.
  navideno: { paint: (ctx, _t, x, w) => void (ctx.fillStyle = gradient(ctx, x, 0, w, ["#FF5A5A", "#FFFFFF", "#4CD98A"])) },
  // Rara: oro macizo (avaricia).
  "oro-macizo": {
    paint: (ctx, _t, x, w) => {
      ctx.fillStyle = gradient(ctx, x, 0, w, ["#B8860B", "#FFE08A", "#FFF6D5", "#E0A800"]);
      ctx.shadowColor = "#B8860B";
      ctx.shadowBlur = 8;
    },
  },
  // Rara: carmesí, el rojo del kimono de Kayo.
  carmesi: {
    paint: (ctx, _t, x, w) => {
      ctx.fillStyle = gradient(ctx, x, 0, w, ["#FF6B6B", "#E0283C", "#FF9A9A"]);
      ctx.shadowColor = "#5A0A14";
      ctx.shadowBlur = 12;
    },
  },
  // Épica: veneno, morado y rosa que se mueven.
  "veneno-dulce": {
    paint: (ctx, t, x, w) => {
      ctx.fillStyle = corrido(ctx, x, w, t, ["#B04BFF", "#FF8AE0"]);
      ctx.shadowColor = "#B04BFF";
      ctx.shadowBlur = 14;
    },
  },
  // Legendaria: aurora boreal.
  "luz-del-norte": {
    paint: (ctx, t, x, w) => {
      ctx.fillStyle = corrido(ctx, x, w, t, AURORA);
      ctx.shadowColor = "#3FD6FF";
      ctx.shadowBlur = 16;
    },
  },
  // Mítica: los siete pecados.
  "siete-colores": {
    paint: (ctx, t, x, w) => {
      ctx.fillStyle = corrido(ctx, x, w, t, SIETE.map((p) => p.color));
      ctx.shadowColor = "#FFFFFF";
      ctx.shadowBlur = 16;
    },
  },
};

// ───────────────────────── insignias dibujadas (128×128) ─────────────────────────

function disco(ctx: SKRSContext2D, a: string, b: string) {
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, TAU);
  ctx.fillStyle = gradient(ctx, 6, 0, 116, [a, b]);
  ctx.fill();
}

export const INSIGNIAS_T2: Record<string, (ctx: SKRSContext2D) => void> = {
  ...porPecado("insignia", medallon),
  "insignia-arbolito": (ctx) => {
    disco(ctx, "#12305A", "#2A6FB0");
    ctx.fillStyle = "#7A4A22";
    ctx.fillRect(58, 92, 12, 16);
    ctx.fillStyle = "#2FA052";
    for (const [y, r] of [[30, 22], [50, 30], [72, 38]] as const) {
      ctx.beginPath();
      ctx.moveTo(64, y - 16);
      ctx.lineTo(64 + r, y + 24);
      ctx.lineTo(64 - r, y + 24);
      ctx.fill();
    }
    ctx.fillStyle = "#FFD23F";
    simbolo(ctx, "estrella", 64, 16, 10);
    for (const [x, y, c] of [[52, 58, "#FF4D4D"], [76, 64, "#FFD23F"], [60, 84, "#3FA7FF"], [82, 88, "#FF7AD9"], [44, 86, "#FFD23F"]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, TAU);
      ctx.fillStyle = c;
      ctx.fill();
    }
  },
  "insignia-regalo": (ctx) => {
    disco(ctx, "#0E3B22", "#2FA052");
    ctx.fillStyle = "#E0283C";
    ctx.fillRect(28, 54, 72, 50);
    ctx.fillStyle = "#C81E32";
    ctx.fillRect(22, 42, 84, 16);
    ctx.fillStyle = "#FFD23F";
    ctx.fillRect(57, 42, 14, 62);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(64 + s * 15, 32, 15, 9, s * 0.5, 0, TAU);
      ctx.fill();
    }
  },
  "insignia-copo": (ctx) => {
    disco(ctx, "#16224A", "#3F8CFF");
    ctx.strokeStyle = "#FFFFFF";
    copo(ctx, 64, 64, 42);
  },
  "insignia-gorro": (ctx) => {
    disco(ctx, "#0E3B22", "#1E7A3C");
    ctx.fillStyle = "#E0283C";
    ctx.beginPath();
    ctx.moveTo(26, 86);
    ctx.quadraticCurveTo(40, 18, 92, 34);
    ctx.quadraticCurveTo(78, 52, 100, 86);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.roundRect(20, 80, 88, 20, 10);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(95, 36, 12, 0, TAU);
    ctx.fill();
  },
  "insignia-baston": (ctx) => {
    disco(ctx, "#12305A", "#3FA7FF");
    ctx.lineCap = "round";
    const trazo = () => {
      ctx.beginPath();
      ctx.moveTo(52, 106);
      ctx.lineTo(52, 50);
      ctx.arc(70, 50, 18, Math.PI, TAU);
      ctx.lineTo(88, 62);
    };
    trazo();
    ctx.lineWidth = 17;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke();
    trazo();
    ctx.setLineDash([9, 11]);
    ctx.lineCap = "butt";
    ctx.strokeStyle = "#E0283C";
    ctx.stroke();
  },
  "insignia-campana": (ctx) => {
    disco(ctx, "#5A0A14", "#C81E32");
    ctx.fillStyle = "#FFD23F";
    ctx.beginPath();
    ctx.moveTo(30, 88);
    ctx.quadraticCurveTo(40, 74, 40, 54);
    ctx.quadraticCurveTo(40, 26, 64, 26);
    ctx.quadraticCurveTo(88, 26, 88, 54);
    ctx.quadraticCurveTo(88, 74, 98, 88);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(64, 96, 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#2FA052";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(64 + s * 13, 22, 13, 7, s * 0.4, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#E0283C";
    ctx.beginPath();
    ctx.arc(64, 22, 6, 0, TAU);
    ctx.fill();
  },
  "insignia-galleta": (ctx) => {
    disco(ctx, "#2A1206", "#7A4A22");
    ctx.fillStyle = "#C98A4B";
    ctx.beginPath();
    ctx.arc(64, 34, 17, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(48, 46, 32, 36, 10);
    ctx.fill();
    ctx.lineCap = "round";
    ctx.lineWidth = 13;
    ctx.strokeStyle = "#C98A4B";
    for (const [x1, y1, x2, y2] of [[50, 56, 28, 66], [78, 56, 100, 66], [56, 80, 48, 106], [72, 80, 80, 106]] as const) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.fillStyle = "#FFF6E8";
    for (const [x, y] of [[57, 31], [71, 31], [64, 56], [64, 68]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(64, 36, 8, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#FFF6E8";
    ctx.stroke();
  },
  "insignia-estrella": (ctx) => {
    disco(ctx, "#16224A", "#4A2E8A");
    ctx.shadowColor = "#FFE08A";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#FFD23F";
    simbolo(ctx, "estrella", 64, 66, 40);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#FFF6D5";
    simbolo(ctx, "estrella", 64, 66, 20);
  },
  "insignia-muneco": (ctx) => {
    disco(ctx, "#12305A", "#3FA7FF");
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(64, 82, 28, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(64, 44, 20, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#16131f";
    for (const [x, y] of [[57, 40], [71, 40], [64, 74], [64, 88]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#FF7A2F";
    ctx.beginPath();
    ctx.moveTo(64, 45);
    ctx.lineTo(84, 50);
    ctx.lineTo(64, 53);
    ctx.fill();
    ctx.fillStyle = "#E0283C";
    ctx.fillRect(46, 58, 36, 8);
  },
  // Épica: la rueda de los siete pecados.
  "insignia-siete": (ctx) => {
    SIETE.forEach((p, i) => {
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.arc(64, 64, 58, (i / 7) * TAU - Math.PI / 2, ((i + 1) / 7) * TAU - Math.PI / 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    ctx.beginPath();
    ctx.arc(64, 64, 26, 0, TAU);
    ctx.fillStyle = "#16131f";
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    // Centrado por el dibujo real del número (no por la caja de la fuente).
    ctx.font = "900 34px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText("7");
    ctx.fillText("7", 64 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, 64 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  },
};
