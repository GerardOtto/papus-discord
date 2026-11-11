// Miniaturas de los objetos de arte propio (assets/coleccion/miniaturas/<id>.png), dibujadas con los mismos dibujos
// que usa la tarjeta (src/coins/arte.ts): así la tienda y la tarjeta nunca se desfasan. Las de los fondos con renders
// se hacen en la propuesta (docs/propuestas/shaula-coins/fuente/temporada1.ts) porque necesitan Diva-a-Render.
// Uso: npm run coleccion
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { AROS, BARRAS, BORDES, FONDOS, GEO, NOMBRES, bordeFundador, centerText } from "../src/coins/arte";
import { COLECCION_DIR, coleccionImage } from "../src/coins/equip";
import { RAREZA_COLOR, loadCatalog, type Objeto, type Rareza } from "../src/coins/rules";
import { CARD_H, CARD_W, FONT, gradient, rainbowAt, roundRect } from "../src/levels/card";

const S = 256, INNER = S - 28;
const OSCURO: Record<Rareza, string> = { comun: "#3B4250", rara: "#0C3D3A", epica: "#2E1250", legendaria: "#4A3200", mitica: "#3A0F27", fundador: "#3A2E10", membresia: "#4A1426", contrabando: "#16300C" };
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

const dir = path.join(COLECCION_DIR, "miniaturas");
mkdirSync(dir, { recursive: true });
let n = 0;
for (const o of loadCatalog()) {
  if (o.origen !== "arte") continue;
  writeFileSync(path.join(dir, `${o.id}.png`), await mini(o));
  n++;
}
console.log(`${n} miniaturas en assets/coleccion/miniaturas`);
