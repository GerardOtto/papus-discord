// Propuesta visual de «¡Adivina, Papu!» (adivinanzas al aire con Shaulitas). Solo vista previa con datos de ejemplo.
//   node --disable-warning=ExperimentalWarning --import tsx docs/propuestas/adivinanzas/fuente/propuesta.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type SKRSContext2D, type Image } from "@napi-rs/canvas";
import { centerText } from "../../../../src/coins/arte";
import { fitText, FONT, roundRect } from "../../../../src/levels/card";

const OUT = path.resolve(import.meta.dirname, "../imagenes");
mkdirSync(OUT, { recursive: true });
const BOTS = path.resolve(import.meta.dirname, "../../../../assets/bots");
const TITLE = `"Bahnschrift", "Noto Sans Display", ${FONT}`;
const TAU = Math.PI * 2;

const CATEGORIAS = [
  { id: "general", nombre: "CULTURA GENERAL", color: "#4C8DFF" },
  { id: "vocaloid", nombre: "VOCALOID", color: "#39C5BB" },
  { id: "utau", nombre: "UTAU", color: "#D23246" },
  { id: "utaite", nombre: "UTAITES", color: "#9B6CFF" },
  { id: "tetociencia", nombre: "TETOCIENCIA", color: "#FF8A3D" },
  { id: "server", nombre: "EL SERVER", color: "#E8C21A" },
] as const;

const fijo = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function fitCenter(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, size: number, min = 14, weight = "bold", family = TITLE) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--s}px ${family}`;
  centerText(ctx, fitText(ctx, text, maxW), cx, cy);
}

function wrap(ctx: SKRSContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** Párrafo centrado que se achica hasta caber en el recuadro. */
function parrafo(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxW: number, maxH: number, size: number, color: string, weight = "bold", family = TITLE) {
  let s = size, lines: string[] = [];
  for (; s >= 14; s--) {
    ctx.font = `${weight} ${s}px ${family}`;
    lines = wrap(ctx, text, maxW);
    if (lines.length * s * 1.28 <= maxH) break;
  }
  ctx.fillStyle = color;
  const lh = s * 1.28, top = cy - (lines.length * lh) / 2 + lh / 2;
  lines.forEach((l, i) => centerText(ctx, l, cx, top + i * lh));
}

function pill(ctx: SKRSContext2D, text: string, cx: number, cy: number, color: string, size = 20, ink = "#ffffff") {
  ctx.font = `900 ${size}px ${TITLE}`;
  const w = ctx.measureText(text).width + size * 1.6, h = size * 1.75;
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
  g.addColorStop(0, "#FFF2B0"); g.addColorStop(0.5, "#FFC93C"); g.addColorStop(1, "#C98A00");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#8A5A00"; ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.stroke();
  ctx.fillStyle = "#8A5A00";
  ctx.font = `900 ${r * 1.1}px ${TITLE}`;
  centerText(ctx, "S", 0, 0);
  ctx.restore();
}

function avatar(ctx: SKRSContext2D, img: Image, cx: number, cy: number, r: number, ring: string) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r + 7, 0, TAU); ctx.fillStyle = ring; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function fondo(ctx: SKRSContext2D, w: number, h: number, a: string, b: string, dots = "rgba(255,255,255,0.06)") {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dots;
  ctx.font = `900 46px ${TITLE}`;
  for (let i = 0; i < 40; i++) centerText(ctx, "?", fijo(i) * w, fijo(i + 99) * h);
}

/** Pozo: 50 al salir, sube lineal hasta 150 a los 5:00 y se queda ahí hasta las 10:00. */
const pozo = (min: number, dorada = false) => Math.round((50 + 100 * Math.min(1, min / 5)) * (dorada ? 2 : 1));

/** Barra del pozo con marcas de pistas. */
function barraPozo(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, min: number, dorada = false) {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  const lleno = Math.min(1, min / 10);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, "#FFE38A"); g.addColorStop(0.5, "#FFC93C"); g.addColorStop(1, dorada ? "#FF6B00" : "#FF8A3D");
  ctx.save(); roundRect(ctx, x, y, w, h, h / 2); ctx.clip();
  ctx.fillStyle = g; ctx.fillRect(x, y, w * lleno, h);
  ctx.restore();
  for (const [m, t] of [[3, "PISTA 1"], [5, "MÁXIMO"], [7, "PISTA 2"]] as const) {
    const mx = x + (w * m) / 10;
    ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fillRect(mx - 1.5, y - 6, 3, h + 12);
    ctx.font = `bold 15px ${TITLE}`; centerText(ctx, t, mx, y + h + 20);
  }
}

// ───────────── 2. La adivinanza como sale en el canal ─────────────
async function bannerAdivinanza(o: { bot: string; nombre: string; color: string; cat: (typeof CATEGORIAS)[number]; texto: string; min: number; pista?: string; dorada?: boolean }) {
  const W = 1200, H = 640;
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  if (o.dorada) fondo(ctx, W, H, "#3A2600", "#8A5A00", "rgba(255,230,140,0.10)");
  else fondo(ctx, W, H, "#141026", "#2A1B4A");
  ctx.fillStyle = o.color; ctx.fillRect(0, 0, W, 10);
  const img = await loadImage(path.join(BOTS, `${o.bot}_avatar.png`));
  avatar(ctx, img, 130, 130, 80, o.color);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = `900 54px ${TITLE}`;
  ctx.fillText(o.dorada ? "¡ADIVINANZA DORADA!" : "¡ADIVINA, PAPU!", 250, 118);
  ctx.font = `bold 24px ${TITLE}`; ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(`${o.nombre} deja una adivinanza al aire`, 252, 160);
  pill(ctx, o.cat.nombre, 1040, 72, o.cat.color, 22);
  if (o.dorada) pill(ctx, "POZO ×2", 1040, 130, "#FFC93C", 22, "#3A2600");
  // tarjeta del texto
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  roundRect(ctx, 50, 240, W - 100, 190, 26); ctx.fill();
  parrafo(ctx, o.texto, W / 2, 335, W - 180, 160, 38, "#1A1330");
  // pista
  if (o.pista) {
    ctx.fillStyle = "rgba(0,0,0,0.35)"; roundRect(ctx, 50, 446, 520, 54, 27); ctx.fill();
    ctx.fillStyle = "#FFE38A"; fitCenter(ctx, o.pista, 310, 473, 480, 26);
  }
  // pozo y tiempo
  const p = pozo(o.min, o.dorada);
  coin(ctx, 640, 473, 26, 0.3);
  ctx.fillStyle = "#ffffff"; ctx.textAlign = "left"; ctx.font = `900 38px ${TITLE}`;
  ctx.fillText(`${p} Shaulitas`, 680, 487);
  const quedan = 10 - o.min, mm = Math.floor(quedan), ss = Math.round((quedan - mm) * 60);
  pill(ctx, `QUEDAN ${mm}:${String(ss).padStart(2, "0")}`, 1060, 473, "#D23246", 22);
  barraPozo(ctx, 70, 540, W - 140, 26, o.min, o.dorada);
  ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = `bold 18px ${FONT}`;
  centerText(ctx, "Responde en este canal · 3 intentos por Papu · mientras más esperas, más vale (si nadie te gana)", W / 2, 616);
  return c.toBuffer("image/png");
}

// ───────────── 3. Ganador ─────────────
async function bannerGanador(o: { bot: string; color: string; papu: string; respuesta: string; min: number; premio: number; racha: number }) {
  const W = 1200, H = 520;
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  fondo(ctx, W, H, "#0E2A22", "#1F5A47");
  for (let i = 0; i < 46; i++) coin(ctx, fijo(i) * W, fijo(i + 7) * H, 10 + fijo(i + 3) * 16, fijo(i + 11) * 6);
  ctx.fillStyle = "rgba(10,20,16,0.82)"; roundRect(ctx, 80, 50, W - 160, H - 100, 34); ctx.fill();
  const img = await loadImage(path.join(BOTS, `${o.bot}_avatar.png`));
  avatar(ctx, img, 200, 200, 80, o.color);
  ctx.fillStyle = "#7CF2C6"; fitCenter(ctx, "¡ADIVINADA!", 680, 110, 700, 60, 20, "900");
  ctx.fillStyle = "#ffffff"; fitCenter(ctx, `${o.papu} lo sacó a los ${o.min}`, 680, 180, 700, 36);
  ctx.fillStyle = "rgba(255,255,255,0.7)"; fitCenter(ctx, `Respuesta: ${o.respuesta}`, 680, 232, 700, 28, 14, "bold", FONT);
  coin(ctx, 560, 320, 40, 0.2);
  ctx.fillStyle = "#FFE38A"; ctx.textAlign = "left"; ctx.font = `900 64px ${TITLE}`; ctx.fillText(`+${o.premio}`, 615, 342);
  ctx.fillStyle = "#ffffff"; ctx.font = `bold 26px ${TITLE}`; ctx.fillText("Shaulitas", 618, 380);
  pill(ctx, `RACHA DE HOY: ${o.racha}`, 200, 350, "#39C5BB", 20, "#06302D");
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `bold 18px ${FONT}`;
  centerText(ctx, "Esperar más pagaba más… pero cualquiera te la podía ganar", W / 2, 440);
  return c.toBuffer("image/png");
}

// ───────────── 4. Nadie la sacó ─────────────
async function bannerNadie(o: { bot: string; color: string; respuesta: string; frase: string }) {
  const W = 1200, H = 420;
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  fondo(ctx, W, H, "#2A0F18", "#4A1626");
  const img = await loadImage(path.join(BOTS, `${o.bot}_avatar.png`));
  avatar(ctx, img, 170, 210, 90, o.color);
  ctx.fillStyle = "#FF9AAE"; fitCenter(ctx, "¡SE ACABÓ EL TIEMPO!", 700, 90, 760, 56, 20, "900");
  ctx.fillStyle = "rgba(255,255,255,0.95)"; roundRect(ctx, 320, 140, 760, 90, 22); ctx.fill();
  ctx.fillStyle = "#4A1626"; fitCenter(ctx, `Era: ${o.respuesta}`, 700, 185, 700, 44, 20, "900");
  parrafo(ctx, `«${o.frase}»`, 700, 290, 740, 70, 26, "#ffffff", "italic bold", FONT);
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `bold 18px ${FONT}`;
  centerText(ctx, "Bote: la siguiente adivinanza sale con +50 Shaulitas extra", 700, 370);
  return c.toBuffer("image/png");
}

// ───────────── 1. Cómo funciona ─────────────
async function comoFunciona() {
  const W = 1200, H = 1700;
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  fondo(ctx, W, H, "#120D24", "#25174A");
  ctx.fillStyle = "#ffffff"; fitCenter(ctx, "¡ADIVINA, PAPU!", W / 2, 80, 1000, 78, 30, "900");
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  fitCenter(ctx, "Los Vocaloids sueltan adivinanzas al aire. El primero en acertar se lleva Shaulitas.", W / 2, 140, 1080, 28, 16, "bold", FONT);

  // categorías
  ctx.fillStyle = "#FFE38A"; fitCenter(ctx, "DE CUALQUIER COSA", W / 2, 215, 600, 30);
  CATEGORIAS.forEach((k, i) => pill(ctx, k.nombre, 200 + (i % 3) * 400, 275 + Math.floor(i / 3) * 62, k.color, 22));

  // curva del pozo
  const gx = 120, gy = 440, gw = 960, gh = 330;
  ctx.fillStyle = "rgba(0,0,0,0.3)"; roundRect(ctx, gx - 50, gy - 60, gw + 100, gh + 140, 28); ctx.fill();
  ctx.fillStyle = "#ffffff"; fitCenter(ctx, "EL POZO SUBE MIENTRAS NADIE ACIERTA", W / 2, gy - 22, 900, 30);
  const X = (m: number) => gx + (gw * m) / 10, Y = (v: number) => gy + gh - ((v - 0) / 170) * (gh - 20);
  ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1;
  for (const v of [50, 100, 150]) { ctx.beginPath(); ctx.moveTo(gx, Y(v)); ctx.lineTo(gx + gw, Y(v)); ctx.stroke(); ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = `bold 18px ${FONT}`; ctx.textAlign = "right"; ctx.fillText(String(v), gx - 26, Y(v) + 6); }
  const area = ctx.createLinearGradient(0, Y(150), 0, Y(0));
  area.addColorStop(0, "rgba(255,201,60,0.55)"); area.addColorStop(1, "rgba(255,201,60,0.05)");
  ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0), Y(50)); ctx.lineTo(X(5), Y(150)); ctx.lineTo(X(10), Y(150)); ctx.lineTo(X(10), Y(0)); ctx.closePath();
  ctx.fillStyle = area; ctx.fill();
  ctx.beginPath(); ctx.moveTo(X(0), Y(50)); ctx.lineTo(X(5), Y(150)); ctx.lineTo(X(10), Y(150));
  ctx.strokeStyle = "#FFC93C"; ctx.lineWidth = 6; ctx.stroke();
  for (let m = 0; m <= 10; m++) { ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = `bold 18px ${FONT}`; centerText(ctx, `${m}:00`, X(m), gy + gh + 22); }
  const marca = (m: number, v: number, t: string, col: string, dy = -40) => {
    coin(ctx, X(m), Y(v), 16);
    pill(ctx, t, Math.min(Math.max(X(m), gx + 90), gx + gw - 90), Y(v) + dy, col, 17);
  };
  marca(0, 50, "SALE · 50", "#39C5BB");
  marca(3, 110, "PISTA 1 · 110", "#4C8DFF");
  marca(5, 150, "TOPE · 150", "#FF8A3D");
  marca(7, 150, "PISTA 2 (LETRAS)", "#9B6CFF", 40);
  marca(10, 150, "SE REVELA", "#D23246");
  ctx.fillStyle = "#FFE38A"; fitCenter(ctx, "¿Contestas ya y aseguras 50… o esperas la pista y te arriesgas a que otro te la gane?", W / 2, gy + gh + 62, 1000, 24, 14, "bold", FONT);

  // reglas
  const reglas: [string, string, string][] = [
    ["CUÁNDO", "4 a 6 al día al azar (10-23 h, México), solo si hubo charla en los últimos 15 min. Nunca dos seguidas del mismo Vocaloid.", "#39C5BB"],
    ["DÓNDE", "#general y los canales de charla con movimiento; se responde ahí mismo, sin hilos ni comandos.", "#4C8DFF"],
    ["INTENTOS", "3 por Papu y por adivinanza (los fallos reciben reacción ❌). Lo revisa el código, nunca el LLM.", "#9B6CFF"],
    ["PISTAS", "Min 3: pista en palabras. Min 7: letras destapadas (B _ _ U _ _ T E). El pozo no baja.", "#FF8A3D"],
    ["DORADA", "1 de cada 15: pozo ×2 (100 → 300) y banner dorado. Se avisa con @Adivinador (rol opcional en #tus-roles).", "#FFC93C"],
    ["BOTE", "Si nadie acierta, la siguiente parte con +50 extra (se acumula hasta +150).", "#D23246"],
    ["TOPE", "Hasta 4 premios al día por Papu, para que ganen todos. Sin XP ni cuota: solo Shaulitas ganadas (regla 1).", "#7CF2C6"],
    ["SEMANA", "Rol decorativo 🧠 Sabelotodo para quien más adivine en la semana, y ranking los lunes en #ranking.", "#E285B2"],
  ];
  let y = gy + gh + 120;
  for (const [t, d, col] of reglas) {
    ctx.fillStyle = "rgba(255,255,255,0.07)"; roundRect(ctx, 70, y, W - 140, 88, 20); ctx.fill();
    ctx.fillStyle = col; roundRect(ctx, 70, y, 190, 88, 20); ctx.fill();
    ctx.fillStyle = "#120D24"; fitCenter(ctx, t, 165, y + 44, 170, 26, 14, "900");
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `bold 21px ${FONT}`; ctx.fillStyle = "#ffffff";
    const ls = wrap(ctx, d, W - 140 - 230);
    const lh = 27, top = y + 44 - ((ls.length - 1) * lh) / 2;
    ls.forEach((l, i) => { const m = ctx.measureText(l); ctx.fillText(l, 285, top + i * lh + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2); });
    y += 100;
  }
  return c.toBuffer("image/png");
}

writeFileSync(path.join(OUT, "1-como-funciona.png"), await comoFunciona());
writeFileSync(path.join(OUT, "2-adivinanza.png"), await bannerAdivinanza({ bot: "miku", nombre: "Miku", color: "#39C5BB", cat: CATEGORIAS[1], texto: "Soy la voz de Crypton que llegó antes que Miku, vestida de rojo y con una botella en la mano. ¿Quién soy?", min: 1.33 }));
writeFileSync(path.join(OUT, "3-adivinanza-pista.png"), await bannerAdivinanza({ bot: "teto", nombre: "Teto", color: "#D23246", cat: CATEGORIAS[0], texto: "Tengo agujas y no coso, tengo números y no soy teléfono. ¿Qué soy?", min: 7.2, pista: "PISTA 2:  R _ _ O _" }));
writeFileSync(path.join(OUT, "4-adivinanza-dorada.png"), await bannerAdivinanza({ bot: "neru", nombre: "Neru", color: "#E8C21A", cat: CATEGORIAS[5], texto: "¿Cómo se llama el objeto permanente del mercado negro con el que corto cualquier conversación?", min: 2.5, dorada: true }));
writeFileSync(path.join(OUT, "5-ganador.png"), await bannerGanador({ bot: "teto", color: "#D23246", papu: "TetoTerritory", respuesta: "reloj", min: "7:24" as unknown as number, premio: 150, racha: 2 }));
writeFileSync(path.join(OUT, "6-nadie.png"), await bannerNadie({ bot: "luka", color: "#E285B2", respuesta: "Meiko", frase: "Diez minutos y nadie se acordó de Meiko… se lo voy a contar." }));
console.log("ok", OUT);
