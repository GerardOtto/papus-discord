// Escenas animadas para los fondos con renders de la temporada 2 (pedido de GyroP, 13 nov. 2026): nieve, truenos,
// fuego de colores, etc. Cada escena tiene una capa que va detrás de los personajes (`atras`) y, si quiere, otra delante
// (`delante`: copos o chispas que pasan por encima), para que se vea con profundidad. Los personajes son un PNG
// transparente (assets/coleccion/fondos/t2/<id>.png) que se dibuja entre las dos capas (src/coins/equip.ts).
// t va de 0 a 1 y la animación cierra en bucle (todo lo que se mueve da vueltas enteras en ese tiempo).
import type { SKRSContext2D } from "@napi-rs/canvas";
import { CARD_H, CARD_W, FONT } from "../levels/card";

const TAU = Math.PI * 2;
const W = CARD_W, H = CARD_H;

export type EfectoPaint = (ctx: SKRSContext2D, t: number, colores: string[]) => void;
export interface Efecto {
  nombre: string;
  /** Escena dibujada entera (cielo, paisaje y lo que se mueve) cuando el fondo no trae foto. */
  atras: EfectoPaint;
  /**
   * Sobre una foto real (oscurecida y difuminada, pedido de GyroP, 13 nov. 2026): solo lo que se mueve y la luz
   * (destellos, brillo del fuego, copos lejanos). Sin esto, la foto va sola detrás.
   */
  sobreFoto?: EfectoPaint;
  delante?: EfectoPaint;
}

/** Números pseudoaleatorios fijos (la misma escena en cada cuadro y en cada tarjeta). */
function semillas(n: number, seed: number): number[][] {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, () => [r(), r(), r(), r(), r()]);
}

/** Posición que recorre `largo` `vueltas` veces en el bucle (sale por un lado y entra por el otro sin salto). */
const ciclo = (base: number, t: number, vueltas: number, largo: number, margen = 0) =>
  (((base + t * vueltas) % 1) + 1) % 1 * (largo + margen * 2) - margen;

/** Avance (0 a 1) de una partícula en su recorrido. */
const frac = (v: number) => ((v % 1) + 1) % 1;

/**
 * Movimiento lento en un bucle corto (la tarjeta dura 1,44 s): `k` copias de cada partícula, desfasadas 1/k en su
 * recorrido, que avanzan solo 1/k por bucle. Al cerrar el bucle cada copia queda donde estaba la siguiente, así que
 * no se nota el corte. Todo lo que dependa del tiempo debe salir del avance de la partícula, no de t.
 */
function repetir(lista: number[][], k: number): number[][] {
  return lista.flatMap((v) => Array.from({ length: k }, (_, j) => [v[0]!, v[1]! + j / k, v[2]!, v[3]!, v[4]!]));
}

function cielo(ctx: SKRSContext2D, arriba: string, abajo: string) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, arriba);
  g.addColorStop(1, abajo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function halo(ctx: SKRSContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ───────────────────────── nieve ─────────────────────────

const COPOS_LEJOS = repetir(semillas(30, 11), 4);
const COPOS_CERCA = repetir(semillas(9, 23), 2);

function copos(ctx: SKRSContext2D, t: number, lista: number[][], tam: [number, number], vueltas: number, alfa: number) {
  ctx.fillStyle = `rgba(255,255,255,${alfa})`;
  for (const [x0, y0, r, fase, viento] of lista) {
    const p = frac(y0! + t * vueltas);
    const y = p * (H + 24) - 12;
    const x = x0! * W + Math.sin((p * 2 + fase!) * TAU) * (6 + viento! * 10);
    ctx.beginPath();
    ctx.arc(x, y, tam[0] + r! * (tam[1] - tam[0]), 0, TAU);
    ctx.fill();
  }
}

function colinas(ctx: SKRSContext2D) {
  ctx.fillStyle = "rgba(235,242,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H - 26 - Math.sin(x / 140) * 10 - Math.sin(x / 57) * 4);
  ctx.lineTo(W, H);
  ctx.fill();
}

const nieve: Efecto = {
  nombre: "Nieve",
  atras: (ctx, t, [a = "#0B1A3A", b = "#2A4A7A"]) => {
    cielo(ctx, a, b);
    halo(ctx, W * 0.82, H * 0.2, 120, "rgba(255,250,220,0.35)");
    copos(ctx, t, COPOS_LEJOS, [1, 2.4], 1 / 4, 0.75);
    colinas(ctx);
  },
  sobreFoto: (ctx, t) => {
    ctx.fillStyle = "rgba(160,190,255,0.10)";
    ctx.fillRect(0, 0, W, H);
    copos(ctx, t, COPOS_LEJOS, [1, 2.4], 1 / 4, 0.8);
  },
  delante: (ctx, t) => copos(ctx, t, COPOS_CERCA, [3, 5], 1 / 2, 0.9),
};

// ───────────────────────── luces de Navidad ─────────────────────────

const FOCOS = ["#FF4D4D", "#FFD23F", "#3DDC84", "#3FA7FF", "#FF7AD9"];

/** Dos guirnaldas colgando, con focos que se prenden por turnos. */
function guirnaldas(ctx: SKRSContext2D, t: number) {
    for (const [y0, caida, desfase] of [[18, 26, 0], [52, 22, 0.5]] as const) {
      ctx.strokeStyle = "rgba(20,40,20,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 10) ctx.lineTo(x, y0 + Math.abs(Math.sin((x / W) * Math.PI * 4)) * caida);
      ctx.stroke();
      for (let i = 0, x = 25; x < W; i++, x += 50) {
        const y = y0 + Math.abs(Math.sin((x / W) * Math.PI * 4)) * caida + 7;
        const col = FOCOS[i % FOCOS.length]!;
        const on = Math.sin((t * 2 + desfase + i * 0.37) * TAU) > -0.2;
        if (on) halo(ctx, x, y, 22, rgba(col, 0.55));
        ctx.fillStyle = on ? col : rgba(col, 0.35);
        ctx.beginPath();
        ctx.ellipse(x, y, 5, 8, 0, 0, TAU);
        ctx.fill();
      }
    }
}

const lucesNavidad: Efecto = {
  nombre: "Luces de Navidad",
  atras: (ctx, t, [a = "#3A0A12", b = "#0E3B22"]) => {
    cielo(ctx, a, b);
    copos(ctx, t, COPOS_LEJOS, [1, 2], 1 / 4, 0.5);
    guirnaldas(ctx, t);
  },
  sobreFoto: (ctx, t) => {
    copos(ctx, t, COPOS_LEJOS, [1, 2], 1 / 4, 0.6);
    guirnaldas(ctx, t);
  },
  delante: (ctx, t) => copos(ctx, t, COPOS_CERCA, [2.5, 4], 1 / 2, 0.75),
};

// ───────────────────────── truenos ─────────────────────────

const GOTAS = semillas(110, 41);
const NUBES = semillas(9, 43);

/** Rayo quebrado desde arriba (forma fija por semilla), grueso, con resplandor y una rama. */
function rayo(ctx: SKRSContext2D, x0: number, seed: number, color: string, alfa: number) {
  const pasos = semillas(9, seed);
  const puntos: [number, number][] = [[x0, -5]];
  let x = x0, y = -5;
  for (const [dx] of pasos) {
    x += (dx! - 0.5) * 80;
    y += H / 8;
    puntos.push([x, y]);
  }
  // Rama: sale del tercer quiebre hacia un costado y se apaga a media altura.
  const [bx, by] = puntos[3]!;
  const rama: [number, number][] = [[bx, by]];
  for (let k = 1; k <= 3; k++) rama.push([bx + (pasos[0]![1]! > 0.5 ? 1 : -1) * k * 26, by + k * 26 + (pasos[k]![2]! - 0.5) * 18]);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  for (const [ancho, col, blur] of [[16, rgba(color, 0.35 * alfa), 40], [8, rgba(color, alfa), 24], [3.5, `rgba(255,255,255,${alfa})`, 8]] as const) {
    ctx.shadowBlur = blur;
    ctx.strokeStyle = col;
    for (const [tramo, w] of [[puntos, ancho], [rama, ancho * 0.55]] as const) {
      ctx.lineWidth = w;
      ctx.beginPath();
      tramo.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Los cinco rayos del bucle: dónde caen (fracción del ancho, en toda la tarjeta), su forma y cuándo. */
// Empiezan justo en un cuadro del GIF (24 por bucle) y duran 3 cuadros, para que siempre se vean. Ninguno cae detrás
// del avatar (x 40-250), que los taparía.
const RAYOS: { x: number; seed: number; t: number }[] = [
  { x: 0.27, seed: 5, t: 1 / 24 },
  { x: 0.72, seed: 7, t: 6 / 24 },
  { x: 0.4, seed: 17, t: 11 / 24 },
  { x: 0.93, seed: 13, t: 15 / 24 },
  { x: 0.56, seed: 29, t: 19 / 24 },
];
const DURA = 3 / 24 - 1e-6;

/** Intensidad del relámpago en t: un destello por rayo (sube rápido y se apaga). */
function destello(t: number): number {
  return Math.max(0, ...RAYOS.map((r) => (t >= r.t && t < r.t + DURA ? 1 - (t - r.t) / DURA : 0)));
}

/** Los rayos que se ven en t (cada uno unos cuadros, más fuerte al caer). */
function rayos(ctx: SKRSContext2D, t: number, color: string) {
  for (const r of RAYOS) if (t >= r.t && t < r.t + DURA) rayo(ctx, W * r.x, r.seed, color, 1 - ((t - r.t) / DURA) * 0.6);
}

const truenos: Efecto = {
  nombre: "Truenos",
  atras: (ctx, t, [a = "#0A0C1C", b = "#2B2F4A", c = "#BFD4FF"]) => {
    cielo(ctx, a, b);
    const f = destello(t);
    if (f > 0) {
      ctx.fillStyle = rgba(c, 0.14 * f);
      ctx.fillRect(0, 0, W, H);
    }
    // Nubes que avanzan despacio.
    for (const [x0, y0, r] of NUBES) {
      const x = x0! * (W + 160) - 160 + Math.sin((t + r!) * TAU) * 14;
      ctx.fillStyle = `rgba(${f > 0 ? "70,75,110" : "28,30,50"},0.85)`;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.arc(x + k * 45, 20 + y0! * 50 + Math.sin(k) * 12, 40 + r! * 30, 0, TAU);
        ctx.fill();
      }
    }
    rayos(ctx, t, c);
  },
  sobreFoto: (ctx, t, [, , c = "#BFD4FF"]) => {
    // La foto se oscurece entre relámpagos, se ilumina con cada uno y el rayo cae sobre ella.
    const f = destello(t);
    ctx.fillStyle = `rgba(10,12,30,${0.35 * (1 - f)})`;
    ctx.fillRect(0, 0, W, H);
    if (f > 0) {
      ctx.fillStyle = rgba(c, 0.18 * f);
      ctx.fillRect(0, 0, W, H);
    }
    rayos(ctx, t, c);
  },
  delante: (ctx, t, [, , c = "#BFD4FF"]) => {
    // Lluvia en diagonal y el destello encima de todo.
    ctx.strokeStyle = "rgba(190,210,255,0.35)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const [x0, y0, l] of GOTAS) {
      const y = ciclo(y0!, t, 3, H, 30);
      const x = ((x0! * (W + 100) - y * 0.25) % (W + 100) + W + 100) % (W + 100) - 50;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y + 14 + l! * 10);
    }
    ctx.stroke();
    const f = destello(t);
    if (f > 0) {
      ctx.fillStyle = rgba(c, 0.08 * f);
      ctx.fillRect(0, 0, W, H);
    }
  },
};

// ───────────────────────── fuego de colores ─────────────────────────

const LLAMAS = semillas(26, 61);
const CHISPAS = semillas(45, 67);

function llama(ctx: SKRSContext2D, x: number, base: number, alto: number, ancho: number, color: string, mov: number) {
  const g = ctx.createLinearGradient(0, base, 0, base - alto);
  g.addColorStop(0, rgba(color, 0.95));
  g.addColorStop(0.6, rgba(color, 0.55));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - ancho, base);
  ctx.bezierCurveTo(x - ancho, base - alto * 0.5, x + mov - ancho * 0.3, base - alto * 0.7, x + mov, base - alto);
  ctx.bezierCurveTo(x + mov + ancho * 0.3, base - alto * 0.7, x + ancho, base - alto * 0.5, x + ancho, base);
  ctx.fill();
  // Núcleo más claro y angosto: la llama se ve con volumen y no como un triángulo plano.
  const a2 = alto * 0.55, w2 = ancho * 0.45;
  const n = ctx.createLinearGradient(0, base, 0, base - a2);
  n.addColorStop(0, "rgba(255,250,220,0.75)");
  n.addColorStop(1, "rgba(255,250,220,0)");
  ctx.fillStyle = n;
  ctx.beginPath();
  ctx.moveTo(x - w2, base);
  ctx.bezierCurveTo(x - w2, base - a2 * 0.5, x + mov * 0.5 - w2 * 0.3, base - a2 * 0.7, x + mov * 0.5, base - a2);
  ctx.bezierCurveTo(x + mov * 0.5 + w2 * 0.3, base - a2 * 0.7, x + w2, base - a2 * 0.5, x + w2, base);
  ctx.fill();
}

/** Sobre una foto: luz de fuego que late desde abajo y lenguas de fuego bajas en el borde. */
function brillo(ctx: SKRSContext2D, t: number, cols: string[]) {
  const late = 0.5 + 0.5 * Math.sin(t * 4 * TAU) * Math.sin(t * 6 * TAU + 1);
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, rgba(cols[0]!, 0.45 + 0.15 * late));
  g.addColorStop(0.6, rgba(cols[1] ?? cols[0]!, 0.12 + 0.06 * late));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.6;
  for (const [x0, alto, fase, ancho, c] of LLAMAS) {
    const col = cols[Math.floor(c! * cols.length) % cols.length]!;
    llama(ctx, x0! * W, H + 10, 70 + alto! * 70 + Math.sin((t * 2 + fase!) * TAU) * 18, 22 + ancho! * 22, col, Math.sin((t * 3 + fase!) * TAU) * 12);
  }
  ctx.restore();
}

const fuego: Efecto = {
  nombre: "Fuego de colores",
  atras: (ctx, t, colores) => {
    const cols = colores.length ? colores : ["#FF3B3B", "#FFB020", "#FFE14D"];
    cielo(ctx, "#0D0507", "#2A0A0A");
    halo(ctx, W * 0.7, H, 420, rgba(cols[0]!, 0.35));
    for (const capa of [0, 1]) {
      for (const [x0, alto, fase, ancho, c] of LLAMAS) {
        const col = cols[Math.floor(c! * cols.length) % cols.length]!;
        const sube = Math.sin((t * 2 + fase!) * TAU);
        const h = (capa ? 90 : 150) + alto! * (capa ? 70 : 120) + sube * 22;
        llama(ctx, x0! * W, H + 10, h, 26 + ancho! * 30, col, Math.sin((t * 3 + fase!) * TAU) * 14);
      }
    }
  },
  sobreFoto: (ctx, t, colores) => brillo(ctx, t, colores.length ? colores : ["#FF3B3B", "#FFB020", "#FFE14D"]),
  delante: (ctx, t, colores) => {
    const cols = colores.length ? colores : ["#FF3B3B", "#FFB020", "#FFE14D"];
    // Chispas que suben y se apagan, y una franja de llamas bajas delante de los pies.
    for (const [x0, y0, r, fase, c] of CHISPAS) {
      const p = ((y0! + t * 2) % 1 + 1) % 1;
      const x = x0! * W + Math.sin((p * 2 + fase!) * TAU) * 12;
      ctx.fillStyle = rgba(cols[Math.floor(c! * cols.length) % cols.length]!, Math.sin(p * Math.PI) * 0.9);
      ctx.beginPath();
      ctx.arc(x, H - p * H * 0.9, 1.5 + r! * 2.5, 0, TAU);
      ctx.fill();
    }
    for (const [x0, alto, fase, ancho, c] of LLAMAS.slice(0, 14)) {
      const col = cols[Math.floor(c! * cols.length) % cols.length]!;
      llama(ctx, x0! * W, H + 8, 40 + alto! * 40 + Math.sin((t * 2 + fase!) * TAU) * 10, 18 + ancho! * 16, col, Math.sin((t * 3 + fase!) * TAU) * 8);
    }
  },
};

// ───────────────────────── corazones (lujuria) ─────────────────────────

const CORAZONES_LEJOS = repetir(semillas(7, 83), 3);
const CORAZONES_CERCA = repetir(semillas(6, 89), 2);

function corazon(ctx: SKRSContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s, y - s * 0.4, x, y + s * 0.35);
  ctx.fill();
}

function corazonesSuben(ctx: SKRSContext2D, t: number, lista: number[][], vueltas: number, color: string, tam: number) {
  ctx.fillStyle = color;
  for (const [x0, y0, s, fase] of lista) {
    const p = frac(y0! + t * vueltas);
    corazon(ctx, x0! * W + Math.sin((p * 2 + fase!) * TAU) * 16, H + 24 - p * (H + 48), tam + s! * 10);
  }
}

const corazones: Efecto = {
  nombre: "Corazones",
  atras: (ctx, t, [a = "#2A0620", b = "#6A1450", c = "#FF5FA2"]) => {
    cielo(ctx, a, b);
    halo(ctx, W * 0.72, H * 0.5, 300, rgba(c, 0.3));
    corazonesSuben(ctx, t, CORAZONES_LEJOS, 1 / 3, rgba(c, 0.35), 8);
  },
  sobreFoto: (ctx, t, [, , c = "#FF5FA2"]) => {
    ctx.fillStyle = rgba(c, 0.12);
    ctx.fillRect(0, 0, W, H);
    corazonesSuben(ctx, t, CORAZONES_LEJOS, 1 / 3, rgba(c, 0.45), 8);
  },
  delante: (ctx, t, [, , c = "#FF5FA2"]) => {
    corazonesSuben(ctx, t, CORAZONES_CERCA, 1 / 2, rgba(c, 0.7), 12);
  },
};

// ───────────────────────── lluvia de monedas (avaricia) ─────────────────────────

const MONEDAS_LEJOS = repetir(semillas(8, 97), 3);
const MONEDAS_CERCA = repetir(semillas(6, 99), 2);

function moneda(ctx: SKRSContext2D, x: number, y: number, r: number, giro: number) {
  const ancho = Math.max(0.15, Math.abs(Math.cos(giro * TAU)));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(ancho, 1);
  ctx.fillStyle = "#B8860B";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#FFD54A";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function monedasCaen(ctx: SKRSContext2D, t: number, lista: number[][], vueltas: number, tam: number, extra: number) {
  for (const [x0, y0, r, fase] of lista) {
    const p = frac(y0! + t * vueltas);
    moneda(ctx, x0! * W, p * (H + 60) - 30, tam + r! * extra, p * 4 + fase!);
  }
}

const monedas: Efecto = {
  nombre: "Lluvia de oro",
  atras: (ctx, t, [a = "#120C02", b = "#3A2A06"]) => {
    cielo(ctx, a, b);
    halo(ctx, W * 0.72, H * 0.45, 320, "rgba(255,200,60,0.3)");
    monedasCaen(ctx, t, MONEDAS_LEJOS, 1 / 3, 6, 5);
  },
  sobreFoto: (ctx, t) => {
    halo(ctx, W * 0.72, H * 0.45, 320, "rgba(255,200,60,0.25)");
    monedasCaen(ctx, t, MONEDAS_LEJOS, 1 / 3, 6, 5);
  },
  delante: (ctx, t) => {
    monedasCaen(ctx, t, MONEDAS_CERCA, 1 / 2, 11, 6);
  },
};

// ───────────────────────── sueño (pereza) ─────────────────────────

const ESTRELLAS = semillas(60, 101);
const ZETAS = repetir(semillas(4, 103), 2);

const sueno: Efecto = {
  nombre: "Sueño",
  atras: (ctx, t, [a = "#0A0820", b = "#2A2050", c = "#C9B8FF"]) => {
    cielo(ctx, a, b);
    for (const [x, y, r, fase] of ESTRELLAS) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * (0.5 + 0.5 * Math.sin((t * 2 + fase!) * TAU))})`;
      ctx.beginPath();
      ctx.arc(x! * W, y! * H * 0.8, 0.8 + r! * 1.4, 0, TAU);
      ctx.fill();
    }
    // Luna creciente.
    halo(ctx, W * 0.86, H * 0.26, 110, rgba(c, 0.35));
    ctx.fillStyle = "#FFF6D8";
    ctx.beginPath();
    ctx.arc(W * 0.86, H * 0.26, 38, 0, TAU);
    ctx.arc(W * 0.86 + 16, H * 0.26 - 10, 34, 0, TAU, true);
    ctx.fill("evenodd");
  },
  sobreFoto: (ctx, t, [, , c = "#C9B8FF"]) => {
    ctx.fillStyle = rgba(c, 0.08);
    ctx.fillRect(0, 0, W, H);
    for (const [x, y, r, fase] of ESTRELLAS.slice(0, 30)) {
      ctx.fillStyle = `rgba(255,255,255,${0.6 * Math.max(0, Math.sin((t * 2 + fase!) * TAU))})`;
      ctx.beginPath();
      ctx.arc(x! * W, y! * H * 0.7, 0.8 + r! * 1.6, 0, TAU);
      ctx.fill();
    }
  },
  delante: (ctx, t, [, , c = "#C9B8FF"]) => {
    ctx.font = `900 28px ${FONT}`;
    for (const [x0, y0, s, fase] of ZETAS) {
      const p = frac(y0! + t / 2);
      ctx.save();
      ctx.globalAlpha = Math.sin(p * Math.PI) * 0.85;
      ctx.fillStyle = c;
      ctx.translate(W * (0.45 + x0! * 0.5) + Math.sin((p + fase!) * TAU) * 16, H - p * H * 0.85);
      ctx.scale(0.6 + s! * 0.8, 0.6 + s! * 0.8);
      ctx.fillText("z", 0, 0);
      ctx.restore();
    }
  },
};

// ───────────────────────── pueblo de Enbizaka (noche de faroles) e incendio ─────────────────────────

const CASAS = semillas(16, 131);
const PETALOS = repetir(semillas(9, 137), 3);
const HUMO = repetir(semillas(5, 139), 3);

/** Fila de casas japonesas en silueta (techos de teja con las puntas levantadas). `luz` = color de las ventanas. */
function pueblo(ctx: SKRSContext2D, base: number, escala: number, color: string, luz: string | null, t: number) {
  let x = -30;
  for (const [ancho, alto, pisos, fase] of CASAS) {
    const w = (70 + ancho! * 60) * escala, h = (46 + alto! * 44) * escala;
    const y = base - h;
    ctx.fillStyle = color;
    ctx.fillRect(x + w * 0.08, y, w * 0.84, h);
    for (let p = 0; p < (pisos! > 0.6 ? 2 : 1); p++) {
      const ty = y - p * h * 0.42, tw = w * (1 - p * 0.22), tx = x + (w - tw) / 2;
      ctx.beginPath();
      ctx.moveTo(tx - 10 * escala, ty + 4 * escala);
      ctx.quadraticCurveTo(tx + tw * 0.2, ty - 2 * escala, tx + tw * 0.5, ty - 20 * escala);
      ctx.quadraticCurveTo(tx + tw * 0.8, ty - 2 * escala, tx + tw + 10 * escala, ty + 4 * escala);
      ctx.lineTo(tx + tw + 10 * escala, ty + 10 * escala);
      ctx.lineTo(tx - 10 * escala, ty + 10 * escala);
      ctx.fill();
      if (p) ctx.fillRect(tx + tw * 0.12, ty, tw * 0.76, h * 0.42);
    }
    if (luz) {
      const brillo = 0.55 + 0.25 * Math.sin((t * 2 + fase!) * TAU);
      ctx.fillStyle = rgba(luz, brillo);
      for (let k = 0; k < 2; k++) ctx.fillRect(x + w * (0.24 + k * 0.34), y + h * 0.38, w * 0.18, h * 0.34);
      ctx.fillStyle = color;
    }
    x += w * 0.92;
    if (x > W + 40) break;
  }
}

function petalos(ctx: SKRSContext2D, t: number, lista: number[][], color: string, vueltas: number) {
  for (const [x0, y0, s, fase, giro] of lista) {
    const p = frac(y0! + t * vueltas);
    ctx.save();
    ctx.translate(x0! * W + p * 70 + Math.sin((p * 2 + fase!) * TAU) * 20, p * (H + 28) - 14);
    ctx.rotate((p * 3 + giro!) * TAU);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 3 + s! * 4, 1.5 + s! * 2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

const puebloNoche: Efecto = {
  nombre: "Pueblo de Enbizaka",
  atras: (ctx, t, [a = "#0C0A26", b = "#3A2350", c = "#FFB347"]) => {
    cielo(ctx, a, b);
    for (const [x, y, r, fase] of ESTRELLAS.slice(0, 40)) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.5 * (0.5 + 0.5 * Math.sin((t * 2 + fase!) * TAU))})`;
      ctx.beginPath();
      ctx.arc(x! * W, y! * H * 0.5, 0.7 + r! * 1.2, 0, TAU);
      ctx.fill();
    }
    halo(ctx, W * 0.2, H * 0.24, 130, "rgba(255,245,210,0.35)");
    ctx.fillStyle = "#FFF3D0";
    ctx.beginPath();
    ctx.arc(W * 0.2, H * 0.24, 34, 0, TAU);
    ctx.fill();
    pueblo(ctx, H - 40, 0.7, "#1B1436", null, t);
    pueblo(ctx, H + 4, 1.15, "#0D0A1C", c, t);
    faroles(ctx, t, c);
  },
  sobreFoto: (ctx, t, [, , c = "#FFB347"]) => faroles(ctx, t, c),
  delante: (ctx, t) => petalos(ctx, t, PETALOS, "rgba(255,190,215,0.8)", 1 / 3),
};

/** Faroles de papel colgados de una cuerda, que se mecen y titilan. */
function faroles(ctx: SKRSContext2D, t: number, c: string) {
    ctx.strokeStyle = "rgba(10,8,20,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 10) ctx.lineTo(x, 22 + Math.abs(Math.sin((x / W) * Math.PI * 3)) * 30);
    ctx.stroke();
    for (let i = 0, x = 45; x < W; i++, x += 90) {
      const y = 22 + Math.abs(Math.sin((x / W) * Math.PI * 3)) * 30;
      const ang = Math.sin((t + i * 0.21) * TAU) * 0.18;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      halo(ctx, 0, 22, 46, rgba(c, 0.35 + 0.15 * Math.sin((t * 3 + i * 0.4) * TAU)));
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, 22, 11, 15, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#3A1408";
      ctx.fillRect(-7, 5, 14, 4);
      ctx.fillRect(-7, 35, 14, 4);
      ctx.restore();
    }
}

const incendio: Efecto = {
  nombre: "Incendio",
  atras: (ctx, t, colores) => {
    const cols = colores.length ? colores : ["#FF3B1F", "#FF9F1C", "#FFE14D"];
    cielo(ctx, "#120406", "#5A1408");
    halo(ctx, W * 0.5, H, 560, rgba(cols[1] ?? cols[0]!, 0.45 + 0.08 * Math.sin(t * 4 * TAU)));
    // Humo que sube y se va con el viento.
    for (const [x0, y0, r, fase] of HUMO) {
      const p = frac(y0! + t / 3);
      halo(ctx, x0! * W + p * 90 + Math.sin((p + fase!) * TAU) * 20, H * 0.75 - p * H * 0.85, 70 + r! * 60 + p * 50, `rgba(30,22,26,${0.55 * Math.sin(p * Math.PI)})`);
    }
    // Llamas detrás de las casas y saliendo de los techos; las casas quedan en silueta negra.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [x0, alto, fase, ancho, c] of LLAMAS) {
      const col = cols[Math.floor(c! * cols.length) % cols.length]!;
      llama(ctx, x0! * W, H - 30, 150 + alto! * 130 + Math.sin((t * 2 + fase!) * TAU) * 26, 30 + ancho! * 34, col, Math.sin((t * 3 + fase!) * TAU) * 18);
    }
    ctx.restore();
    pueblo(ctx, H - 34, 0.75, "#1A0705", null, t);
    pueblo(ctx, H + 6, 1.15, "#090303", cols[1] ?? cols[0]!, t);
  },
  sobreFoto: (ctx, t, colores) => {
    const cols = colores.length ? colores : ["#FF3B1F", "#FF9F1C", "#FFE14D"];
    for (const [x0, y0, r, fase] of HUMO) {
      const p = frac(y0! + t / 3);
      halo(ctx, x0! * W + p * 90 + Math.sin((p + fase!) * TAU) * 20, H * 0.8 - p * H * 0.9, 70 + r! * 60 + p * 50, `rgba(20,14,16,${0.5 * Math.sin(p * Math.PI)})`);
    }
    brillo(ctx, t, cols);
  },
  delante: (ctx, t, colores) => {
    const cols = colores.length ? colores : ["#FF3B1F", "#FF9F1C", "#FFE14D"];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [x0, alto, fase, ancho, c] of LLAMAS.slice(0, 12)) {
      const col = cols[Math.floor(c! * cols.length) % cols.length]!;
      llama(ctx, x0! * W, H + 10, 46 + alto! * 46 + Math.sin((t * 2 + fase!) * TAU) * 12, 20 + ancho! * 18, col, Math.sin((t * 3 + fase!) * TAU) * 9);
    }
    ctx.restore();
    for (const [x0, y0, r, fase, c] of CHISPAS) {
      const p = ((y0! + t * 2) % 1 + 1) % 1;
      ctx.fillStyle = rgba(cols[Math.floor(c! * cols.length) % cols.length]!, Math.sin(p * Math.PI) * 0.95);
      ctx.beginPath();
      ctx.arc(x0! * W + p * 60 + Math.sin((p * 2 + fase!) * TAU) * 12, H - p * H, 1.5 + r! * 2.5, 0, TAU);
      ctx.fill();
    }
  },
};

export const EFECTOS: Record<string, Efecto> = {
  pueblo: puebloNoche,
  incendio,
  nieve,
  "luces-navidad": lucesNavidad,
  truenos,
  fuego,
  corazones,
  monedas,
  sueno,
};
