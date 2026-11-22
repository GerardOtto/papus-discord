// Miniaturas de los objetos de arte propio (assets/coleccion/miniaturas/<id>.png), dibujadas con los mismos dibujos
// que usa la tarjeta (src/coins/arte.ts): así la tienda y la tarjeta nunca se desfasan. Las de los fondos con renders
// se hacen en la propuesta (docs/propuestas/shaula-coins/fuente/temporada1.ts) porque necesitan Diva-a-Render.
// También dibuja las insignias «Fan de…» (corazones de colores, assets/coleccion/insignias/fan-<id>.png), las de
// antigüedad de membresía (medallas) y las de prestigio (estrellas), PLAN §2.
// Uso: npm run coleccion            -> todas
//      npm run coleccion -- <id>…   -> solo esos objetos (ej.: insignia-fan-miku)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { AROS, BARRAS, BORDES, FONDOS, GEO, NOMBRES, bordeFundador, centerText } from "../src/coins/arte";
import { COLECCION_DIR, coleccionImage, escena } from "../src/coins/equip";
import { RAREZA_COLOR, loadCatalog, type Objeto, type Rareza } from "../src/coins/rules";
import { CARD_H, CARD_W, FONT, gradient, rainbowAt, roundRect } from "../src/levels/card";

const S = 256, INNER = S - 28;
const OSCURO: Record<Rareza, string> = { comun: "#3B4250", rara: "#0C3D3A", epica: "#2E1250", legendaria: "#4A3200", mitica: "#3A0F27", fundador: "#3A2E10", membresia: "#4A1426", contrabando: "#16300C", prestigio: "#4A3A08", exclusivo: "#4A0E1A" };
const t = 0.15;

function fitWrap(ctx: SKRSContext2D, text: string, maxW: number, maxH: number): { lines: string[]; size: number } {
  for (let size = 40; size > 14; size -= 2) {
    ctx.font = `italic bold ${size}px ${FONT}`;
    const words = text.split(/\s+/), lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxW || !cur) cur = next;
      else lines.push(cur), (cur = w);
    }
    lines.push(cur);
    if (lines.length * size * 1.25 <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) return { lines, size };
  }
  return { lines: [text], size: 14 };
}

async function mini(o: Objeto): Promise<Buffer> {
  const c = createCanvas(S, S);
  const ctx = c.getContext("2d");
  const color = RAREZA_COLOR[o.rareza];
  roundRect(ctx, 4, 4, S - 8, S - 8, 30);
  ctx.fillStyle = o.rareza === "mitica" ? rainbowAt(ctx, 0, S, 0) : color;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 14, 14, INNER, INNER, 22);
  ctx.clip();
  ctx.fillStyle = gradient(ctx, 0, 0, S, [OSCURO[o.rareza], "#15121d"]);
  ctx.fillRect(0, 0, S, S);
  const card = createCanvas(CARD_W, CARD_H);
  const cc = card.getContext("2d");
  cc.fillStyle = "#1E1830";
  cc.fillRect(0, 0, CARD_W, CARD_H);
  const crop = (sx: number, sy: number, sw: number, sh: number) => ctx.drawImage(card, sx, sy, sw, sh, 14, 14, INNER, INNER);
  if (o.tipo === "fondo" && FONDOS[o.id]) {
    FONDOS[o.id]!(cc, t);
    crop(CARD_W - CARD_H, 0, CARD_H, CARD_H);
  } else if (o.tipo === "fondo" && o.origen === "render" && o.imagen) {
    // Fondos con renders de la temporada 2: la escena (o la foto/el fotograma) con los personajes, recortada donde están
    // (a la derecha; los del PV con el personaje a la izquierda, a la izquierda; los demás del PV, al centro).
    const img = await coleccionImage(o.imagen);
    if (!img) throw new Error(`Falta assets/coleccion/${o.imagen}`);
    if (o.efecto) escena(o.efecto, img, o.colores ?? [], o.foto ? await coleccionImage(o.foto) : null)(cc, t);
    else cc.drawImage(img, 0, 0, CARD_W, CARD_H);
    crop(o.efecto ? CARD_W - CARD_H - 20 : o.lado ? 40 : o.rareza === "exclusivo" ? CARD_W - CARD_H : (CARD_W - CARD_H) / 2, 0, CARD_H, CARD_H);
  } else if (o.tipo === "borde") {
    (o.id === "estrella-fundadora" ? bordeFundador(0) : BORDES[o.id]!)(cc, t);
    // Lo distintivo de estos dos está a la derecha (el martillo, la cinta con el número).
    const right = o.id === "baneo-de-shaula" || o.id === "estrella-fundadora";
    crop(right ? CARD_W - CARD_H : 0, 0, CARD_H, CARD_H);
  } else if (o.tipo === "barra") {
    roundRect(cc, GEO.tx, GEO.by, 400, GEO.bh, GEO.bh / 2);
    cc.fillStyle = "rgba(255,255,255,0.18)";
    cc.fill();
    cc.save();
    roundRect(cc, GEO.tx, GEO.by, 260, GEO.bh, GEO.bh / 2);
    cc.clip();
    BARRAS[o.id]!(cc, t, GEO.tx, GEO.by, 260, GEO.bh);
    cc.restore();
    crop(GEO.tx - 10, GEO.by - 120, 270, 270);
  } else if (o.tipo === "aro") {
    AROS[o.id]!(cc, t);
    cc.beginPath();
    cc.arc(GEO.ax + GEO.as / 2, GEO.ay + GEO.as / 2, GEO.as / 2, 0, Math.PI * 2);
    cc.fillStyle = "#2B2440";
    cc.fill();
    cc.font = `90px ${FONT}`;
    centerText(cc, "🙂", GEO.ax + GEO.as / 2, GEO.ay + GEO.as / 2);
    crop(GEO.ax - 40, GEO.ay - 40, GEO.as + 80, GEO.as + 80);
  } else if (o.tipo === "nombre") {
    const style = NOMBRES[o.id]!;
    ctx.font = `bold 64px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText("Papu");
    const x = 14 + (INNER - m.width) / 2, y = 14 + INNER / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.save();
    style.back?.(ctx, "Papu", x, y, 64, t);
    style.paint(ctx, t, x, m.width);
    ctx.fillText("Papu", x, y);
    ctx.restore();
  } else if (o.tipo === "insignia") {
    const img = o.imagen ? await coleccionImage(o.imagen) : null;
    if (img) ctx.drawImage(img, S / 2 - 70, S / 2 - 70, 140, 140);
    else {
      ctx.font = `120px ${FONT}`;
      centerText(ctx, o.valor!, S / 2, S / 2);
    }
  } else if (o.tipo === "titulo") {
    ctx.fillStyle = o.rareza === "mitica" ? rainbowAt(ctx, 30, S - 60, 0) : color;
    const { lines, size } = fitWrap(ctx, o.valor!, INNER - 34, INNER - 30);
    lines[0] = `« ${lines[0]}`;
    lines[lines.length - 1] = `${lines[lines.length - 1]} »`;
    ctx.font = `italic bold ${size}px ${FONT}`;
    lines.forEach((l, i) => centerText(ctx, l, S / 2, S / 2 + (i - (lines.length - 1) / 2) * size * 1.25));
  }
  ctx.restore();
  roundRect(ctx, 4, 4, S - 8, S - 8, 30);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#3B2346";
  ctx.stroke();
  // Gema de rareza y, si se mueve, «▶ Animado».
  ctx.save();
  ctx.translate(S - 34, 34);
  ctx.rotate(Math.PI / 4);
  roundRect(ctx, -16, -16, 32, 32, 6);
  ctx.fillStyle = o.rareza === "mitica" ? rainbowAt(ctx, -16, 32, 0) : color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
  if (o.animado) {
    roundRect(ctx, 20, S - 52, 90, 30, 15);
    ctx.fillStyle = "rgba(10,8,18,0.75)";
    ctx.fill();
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    centerText(ctx, "▶ Animado", 65, S - 37);
  }
  return c.toBuffer("image/png");
}

/** Color de cada corazón de las insignias «Fan de…» (el emoji de su 'valor'). */
const CORAZON: Record<string, string> = { "❤️": "#E8334A", "🧡": "#FF8A2B", "💛": "#FFCF33", "💚": "#3DBE5C", "💙": "#3478F6", "💜": "#9B5DE5", "🩷": "#FF8FC7", "🩵": "#5ED3F3" };

function heartPath(ctx: SKRSContext2D, cx: number, cy: number, w: number): void {
  // Corazón de dos lóbulos (curvas de Bézier), de ancho w, centrado en (cx, cy).
  const h = w * 0.9, top = cy - h / 2, x0 = cx - w / 2;
  ctx.beginPath();
  ctx.moveTo(cx, top + h * 0.27);
  ctx.bezierCurveTo(cx, top + h * 0.02, x0, top - h * 0.02, x0, top + h * 0.3);
  ctx.bezierCurveTo(x0, top + h * 0.58, cx - w * 0.2, top + h * 0.78, cx, top + h);
  ctx.bezierCurveTo(cx + w * 0.2, top + h * 0.78, cx + w / 2, top + h * 0.58, cx + w / 2, top + h * 0.3);
  ctx.bezierCurveTo(cx + w / 2, top - h * 0.02, cx, top + h * 0.02, cx, top + h * 0.27);
  ctx.closePath();
}

/** Insignia «Fan de…»: corazón brillante del color de su emoji con «FAN» (128 px, fondo transparente). */
function corazonFan(color: string): Buffer {
  const N = 128, c = createCanvas(N, N), ctx = c.getContext("2d");
  const cx = N / 2, cy = N / 2 + 4, w = 112;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  heartPath(ctx, cx, cy, w);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  // Volumen: más claro arriba, más oscuro abajo.
  ctx.save();
  heartPath(ctx, cx, cy, w);
  ctx.clip();
  const g = ctx.createLinearGradient(0, cy - 50, 0, cy + 52);
  g.addColorStop(0, "rgba(255,255,255,0.35)");
  g.addColorStop(0.55, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  // Brillo del lóbulo izquierdo.
  ctx.beginPath();
  ctx.ellipse(cx - 27, cy - 26, 15, 9, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();
  ctx.restore();
  heartPath(ctx, cx, cy, w);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  // «FAN» en blanco con borde oscuro, centrado por su dibujo real.
  ctx.font = `900 30px "Bahnschrift", "Segoe UI", ${FONT}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(20,10,30,0.75)";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText("FAN");
  const tx = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft - 0;
  const ty = cy + 6 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.strokeText("FAN", tx, ty);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("FAN", tx, ty);
  return c.toBuffer("image/png");
}

/** Insignia del cumpleaños (config/cumpleanos.json; 18 nov. 2026): pastel de dos pisos con velas encendidas (128 px). */
function pastelCumple(): Buffer {
  const N = 128, c = createCanvas(N, N), ctx = c.getContext("2d");
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  const piso = (x: number, y: number, w: number, h: number, base: string, crema: string) => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    round(x, y, w, h, 10);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, base);
    g.addColorStop(1, "#b0476e");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    // Crema que chorrea por arriba.
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 6);
    const gotas = 6;
    for (let k = 0; k <= gotas; k++) {
      const gx = x + 4 + ((w - 8) * k) / gotas;
      ctx.quadraticCurveTo(gx - (w - 8) / gotas / 2, y + (k % 2 ? 18 : 12), gx, y + 6);
    }
    ctx.lineTo(x + w - 4, y);
    ctx.lineTo(x + 4, y);
    ctx.closePath();
    ctx.fillStyle = crema;
    ctx.fill();
    round(x, y, w, h, 10);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
  };
  // Plato.
  ctx.beginPath();
  ctx.ellipse(64, 112, 54, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#e8e4f2";
  ctx.fill();
  piso(16, 74, 96, 36, "#ff8fc7", "#fff4fa");
  piso(30, 46, 68, 30, "#ffb3d9", "#fffaf0");
  // Chispas de colores en el piso de abajo.
  const chispas = ["#39C5BB", "#FFCF33", "#9B5DE5", "#3478F6", "#3DBE5C"];
  for (let k = 0; k < 9; k++) {
    ctx.fillStyle = chispas[k % chispas.length]!;
    ctx.fillRect(24 + k * 10, 92 + (k % 2) * 7, 5, 3);
  }
  // Tres velas con su llama.
  for (const k of [0, 1, 2]) {
    const vx = 42 + k * 22;
    ctx.fillStyle = ["#39C5BB", "#E91E63", "#FFCF33"][k]!;
    ctx.fillRect(vx - 3, 24, 6, 24);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(vx - 3, 30, 6, 3);
    ctx.fillRect(vx - 3, 39, 6, 3);
    ctx.save();
    ctx.shadowColor = "#ffb020";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(vx, 15, 5, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffcc33";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(vx, 17, 2.5, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#fff6c2";
    ctx.fill();
    ctx.restore();
  }
  return c.toBuffer("image/png");
}

/** Texto blanco con borde oscuro, centrado por su dibujo real. */
function textoCentrado(ctx: SKRSContext2D, text: string, cx: number, cy: number, size: number, maxW: number): void {
  let s = size;
  do ctx.font = `900 ${s}px "Bahnschrift", "Segoe UI", ${FONT}`;
  while (ctx.measureText(text).width > maxW && --s > 10);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, s / 5);
  ctx.strokeStyle = "rgba(20,10,30,0.8)";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const tx = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft;
  const ty = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.strokeText(text, tx, ty);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, tx, ty);
}

/** Relleno metálico (bronce, plata, oro), tornasol (holograma) o arcoíris. */
function metal(ctx: SKRSContext2D, tipo: string, x0: number, y0: number, x1: number, y1: number): ReturnType<SKRSContext2D["createLinearGradient"]> {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const stops: Record<string, string[]> = {
    bronce: ["#F4C79A", "#C97B3E", "#8A4B1F", "#E2A06A"],
    plata: ["#FFFFFF", "#C9D2DC", "#8C97A6", "#E6ECF2"],
    oro: ["#FFF3B0", "#FFC83D", "#B98510", "#FFE07A"],
    holograma: ["#B5FFFC", "#C9A7FF", "#FFB3E6", "#A7F3FF"],
    arcoiris: ["#FF5F6D", "#FFC371", "#7CF29A", "#5EC8FF", "#B36BFF"],
  };
  const list = stops[tipo] ?? stops.oro!;
  list.forEach((c, i) => g.addColorStop(i / (list.length - 1), c));
  return g;
}

/** Insignia de antigüedad de membresía: medalla con cinta y el número de meses (128 px, fondo transparente). */
function medallaAntiguedad(meses: number): Buffer {
  const N = 128, c = createCanvas(N, N), ctx = c.getContext("2d");
  const tipo = meses >= 12 ? "arcoiris" : meses >= 6 ? "oro" : meses >= 3 ? "plata" : "bronce";
  // Cinta en V detrás.
  for (const [dx, color] of [[-1, "#FF5FA2"], [1, "#9B6CFF"]] as const) {
    ctx.beginPath();
    ctx.moveTo(N / 2 + dx * 8, 60);
    ctx.lineTo(N / 2 + dx * 34, 124);
    ctx.lineTo(N / 2 + dx * 20, 114);
    ctx.lineTo(N / 2 + dx * 10, 126);
    ctx.lineTo(N / 2 - dx * 4, 66);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(20,10,30,0.7)";
    ctx.stroke();
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.arc(N / 2, 52, 44, 0, Math.PI * 2);
  ctx.fillStyle = metal(ctx, tipo, 10, 10, 118, 96);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(N / 2, 52, 44, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(N / 2, 52, 35, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(20,10,30,0.35)";
  ctx.stroke();
  textoCentrado(ctx, String(meses), N / 2, 46, 40, 60);
  textoCentrado(ctx, meses === 1 ? "MES" : "MESES", N / 2, 76, 15, 62);
  return c.toBuffer("image/png");
}

/** Insignia de prestigio: estrella del metal de su nivel con el número de prestigios (128 px, fondo transparente). */
function estrellaPrestigio(n: number): Buffer {
  const N = 128, c = createCanvas(N, N), ctx = c.getContext("2d");
  const tipo = ["bronce", "plata", "oro", "holograma", "arcoiris"][Math.min(n, 5) - 1]!;
  const star = () => {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 26 : 58, a = -Math.PI / 2 + (k * Math.PI) / 5;
      ctx.lineTo(N / 2 + r * Math.cos(a), N / 2 + 4 + r * Math.sin(a));
    }
    ctx.closePath();
  };
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  star();
  ctx.fillStyle = metal(ctx, tipo, 6, 6, 122, 122);
  ctx.fill();
  ctx.restore();
  star();
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  textoCentrado(ctx, n >= 5 ? "5+" : String(n), N / 2, N / 2 + 8, 34, 50);
  return c.toBuffer("image/png");
}

const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));
const dir = path.join(COLECCION_DIR, "miniaturas");
mkdirSync(dir, { recursive: true });
let n = 0;
for (const o of loadCatalog()) {
  // Los fondos con renders de la temporada 1 se hicieron en su propuesta (temporada1.ts); los de la 2 se dibujan aquí.
  const renderT2 = o.origen === "render" && o.tipo === "fondo" && (o.temporada === "t2" || o.rareza === "exclusivo");
  if ((o.origen !== "arte" && !renderT2) || (only.size && !only.has(o.id))) continue;
  // Las insignias «Fan de…»: primero su dibujo (lo usan la tarjeta y la miniatura).
  if (o.id.startsWith("insignia-fan-") && o.imagen) {
    // El color del personaje si lo trae (las del 18 nov. 2026: Gakupo, IA, Ruko, los invitados…); si no, el del emoji.
    const color = o.colores?.[0] ?? CORAZON[o.valor ?? ""];
    if (!color) throw new Error(`${o.id}: no hay color para el corazón ${o.valor}`);
    mkdirSync(path.dirname(path.join(COLECCION_DIR, o.imagen)), { recursive: true });
    writeFileSync(path.join(COLECCION_DIR, o.imagen), corazonFan(color));
  }
  if (o.id === "insignia-cumpleanos" && o.imagen) {
    mkdirSync(path.dirname(path.join(COLECCION_DIR, o.imagen)), { recursive: true });
    writeFileSync(path.join(COLECCION_DIR, o.imagen), pastelCumple());
  }
  // Antigüedad de membresía y prestigio (PLAN §2): medallas y estrellas.
  const ant = /^insignia-antiguedad-(\d+)$/.exec(o.id);
  const pre = /^insignia-prestigio-(\d+)$/.exec(o.id);
  if ((ant || pre) && o.imagen) {
    mkdirSync(path.dirname(path.join(COLECCION_DIR, o.imagen)), { recursive: true });
    writeFileSync(path.join(COLECCION_DIR, o.imagen), ant ? medallaAntiguedad(Number(ant[1])) : estrellaPrestigio(Number(pre![1])));
  }
  writeFileSync(path.join(dir, `${o.id}.png`), await mini(o));
  n++;
}
console.log(`${n} miniaturas en assets/coleccion/miniaturas`);
