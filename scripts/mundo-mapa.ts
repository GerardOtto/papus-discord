// Mapa de la Plaza de los Papus para la guia de #plaza-papus: npm run mundo:mapa -> assets/mundo/mapa-plaza.png.
// Usa las mismas coordenadas que el mundo (worker/src/mundo/juego.ts): si se mueve una zona, se vuelve a generar.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { centerText } from "../src/coins/arte";
import { FONT, fitText, roundRect } from "../src/levels/card";
import { RADIO, TABLON, TIENDAS, ZONAS } from "../worker/src/mundo/juego";

const ROOT = path.resolve(import.meta.dirname, "..");
const W = 1200;
const H = 1260;
const CX = W / 2;
const CY = 640;
/** Pixeles por metro del mundo. */
const K = 500 / RADIO;
const px = (x: number, z: number): [number, number] => [CX + x * K, CY + z * K];

const COLOR: Record<string, string> = {
  arena: "#d4344a",
  comercio: "#7a4fd6",
  ruleta: "#d9a400",
  escuela: "#3b6fd9",
  estanque: "#1f9fb0",
  fogata: "#e07a2e",
  altar: "#c23a55",
  fama: "#8a5a2b",
  sorteo: "#3f8f45",
};

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

// Fondo: bosque alrededor y pasto dentro del borde de rocas.
ctx.fillStyle = "#4f8f48";
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = "#86cc6f";
ctx.beginPath();
ctx.arc(CX, CY, RADIO * K, 0, Math.PI * 2);
ctx.fill();
ctx.strokeStyle = "#8a8a82";
ctx.lineWidth = 10;
ctx.setLineDash([14, 10]);
ctx.stroke();
ctx.setLineDash([]);

// Caminos: anillo y uno de la fuente a cada zona.
ctx.strokeStyle = "#e3d3b2";
ctx.lineCap = "round";
ctx.lineWidth = 2.4 * K;
ctx.beginPath();
ctx.arc(CX, CY, 30.4 * K, 0, Math.PI * 2);
ctx.stroke();
for (const z of ZONAS) {
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(...px(z.x, z.z));
  ctx.stroke();
}

// Plaza de la fuente.
ctx.fillStyle = "#efe3c8";
ctx.beginPath();
ctx.arc(CX, CY, 13 * K, 0, Math.PI * 2);
ctx.fill();
ctx.fillStyle = "#4fb8e8";
ctx.beginPath();
ctx.arc(CX, CY, 3 * K, 0, Math.PI * 2);
ctx.fill();

function etiqueta(c: SKRSContext2D, texto: string, x: number, y: number, fondo: string, size = 30, max = 300): void {
  c.font = `bold ${size}px ${FONT}`;
  const t = fitText(c, texto, max);
  const w = c.measureText(t).width + 32;
  const h = size + 22;
  c.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(c, x - w / 2 + 3, y - h / 2 + 4, w, h, h / 2);
  c.fill();
  c.fillStyle = fondo;
  roundRect(c, x - w / 2, y - h / 2, w, h, h / 2);
  c.fill();
  c.fillStyle = "#ffffff";
  centerText(c, t, x, y);
}

// Zonas: un punto donde estan y su nombre debajo.
for (const z of ZONAS) {
  const [x, y] = px(z.x, z.z);
  ctx.fillStyle = COLOR[z.id] ?? "#555";
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.stroke();
  etiqueta(ctx, z.nombre, x, y + 58, COLOR[z.id] ?? "#555");
}
// Las dos tiendas de la calle del comercio, como segunda linea bajo su nombre.
const comercio = ZONAS.find((z) => z.id === "comercio")!;
const [tx, ty] = px(comercio.x, comercio.z);
etiqueta(ctx, `${TIENDAS[0]!.nombre} · ${TIENDAS[1]!.nombre}`, tx, ty + 106, "#5a3a8a", 22, 380);
etiqueta(ctx, "Fuente y tablón", CX, px(TABLON.x, TABLON.z)[1] + 44, "#2a1830", 28);

// Titulo y pie.
ctx.fillStyle = "#2a1830";
roundRect(ctx, 40, 36, W - 80, 92, 28);
ctx.fill();
ctx.fillStyle = "#ffffff";
ctx.font = `bold 52px ${FONT}`;
centerText(ctx, "Plaza de los Papus", CX, 82);
ctx.font = `bold 26px ${FONT}`;
ctx.fillStyle = "#ffffff";
centerText(ctx, "Norte arriba · apareces junto a la fuente", CX, H - 40);

const out = path.join(ROOT, "assets/mundo/mapa-plaza.png");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, canvas.toBuffer("image/png"));
console.log(`✔ ${path.relative(ROOT, out)} (${W}x${H})`);
