// Temporada 2 de las Shaulitas (pedido de GyroP, 13 nov. 2026): fondos de tarjeta animados con renders. Cada fondo
// = una escena animada de src/coins/efectos.ts (nieve, truenos, fuego de colores…) + una capa transparente con los
// personajes, que arma este script en assets/coleccion/fondos/t2/<id>.png. Los renders salen de:
//   navidad:<bot>/<reaccion>  -> assets/bots/navidad/renders/<bot>_<reaccion>.png (Diva-a-Render, make_avatars --navidad)
//   motor:<look>/<reaccion>   -> $ENGINE_DIR/assets/characters/<look>/<reaccion>.png (solo lectura; los de los episodios)
// Uso: npm run temporada2                       -> capas de todos los fondos
//      npm run temporada2 -- --muestras <dir>   -> además, una tarjeta GIF de muestra por fondo y una hoja con todos
//      npm run temporada2 -- <id>…              -> solo esos
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { escena } from "../src/coins/equip";
import { CARD_H, CARD_W, renderCardAny } from "../src/levels/card";
import { loadConfig, loadDotEnv } from "../src/config";

loadDotEnv();
const ROOT = path.resolve(import.meta.dirname, "..");
const ENGINE = loadConfig().engineDir;
const OUT = path.join(ROOT, "assets/coleccion/fondos/t2");

import { AROS, BARRAS, BORDES, NOMBRES } from "../src/coins/arte";
import type { CardEquip } from "../src/levels/card";
import { INSIGNIAS_T2 } from "../src/coins/arte-t2-extra";
import { spawnSync } from "node:child_process";
import { ARTE_T2, FONDOS_PV, FONDOS_T2, INSIGNIAS_DIBUJADAS_T2, PVS, TEXTOS_T2, type ArteT2, type FondoPV, type FondoT2 } from "./temporada2-catalogo";

function fuente(ref: string): string {
  const [origen, resto] = ref.split(":") as [string, string];
  const [quien, reaccion] = resto.split("/") as [string, string];
  if (origen === "navidad") return path.join(ROOT, "assets/bots/navidad/renders", `${quien}_${reaccion}.png`);
  if (origen === "modelo") return path.join(ROOT, "assets/coleccion/renders", `${quien}_${reaccion}.png`);
  if (origen === "motor") return path.join(ENGINE, "assets/characters", quien, `${reaccion}.png`);
  throw new Error(`Origen desconocido: ${ref}`);
}

interface Pj {
  img: Image;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Render recortado a su contorno real (los PNG traen mucho aire transparente). */
async function cargar(ref: string): Promise<Pj> {
  const file = fuente(ref);
  if (!existsSync(file)) throw new Error(`Falta el render ${ref} (${file})`);
  const img = await loadImage(readFileSync(file));
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
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return { img, sx: x0 / s, sy: y0 / s, sw: (x1 - x0 + 1) / s, sh: (y1 - y0 + 1) / s };
}

function dibujar(ctx: SKRSContext2D, p: Pj, cx: number, top: number, h: number) {
  const w = (p.sw * h) / p.sh;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18;
  ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, cx - w / 2, top, w, h);
  ctx.restore();
}

/** Capa de personajes (1000×340, transparente): a la derecha, porque la izquierda la tapan el avatar y el texto. */
async function capa(f: FondoT2): Promise<Buffer> {
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext("2d");
  const pjs = await Promise.all(f.pjs.map(cargar));
  const n = pjs.length;
  const zone0 = n >= 3 ? 520 : 580, zone1 = CARD_W - 10;
  const mid = Math.floor((n - 1) / 2);
  const slotOf = (i: number) => (i === 0 ? mid : i % 2 ? mid + Math.ceil(i / 2) : mid - i / 2);
  for (const { p, i } of pjs.map((p, i) => ({ p, i })).reverse()) {
    // Ajuste a mano por personaje (pedidos de GyroP: correr a uno que se corta, igualar el tamaño de otro modelo…).
    const aj = f.ajustes?.[i] ?? {};
    const zona = (f.zona ?? [zone0, zone1]) as [number, number];
    const cx = (n === 1 ? zona[0] + (zona[1] - zona[0]) * 0.55 : zona[0] + ((slotOf(i) + 0.5) * (zona[1] - zona[0])) / n) + (aj.dx ?? 0);
    const h = (n === 1 ? 430 : n === 2 ? 400 : 340) * (i === 0 ? 1 : 0.92) * (aj.escala ?? 1);
    dibujar(ctx, p, cx, (n === 1 ? 24 : 34) + (i === 0 ? 0 : 10) + (aj.dy ?? 0), h);
  }
  // Los cuerpos cortados abajo se desvanecen en vez de terminar en una línea recta.
  ctx.globalCompositeOperation = "destination-out";
  const fade = ctx.createLinearGradient(0, CARD_H - 60, 0, CARD_H);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, CARD_H - 60, CARD_W, 60);
  return c.toBuffer("image/png");
}

/** Foto del motor recortada a la banda de la tarjeta, difuminada (se achica y se agranda) y oscurecida. */
async function foto(f: FondoT2): Promise<Buffer | null> {
  if (!f.foto) return null;
  const file = path.join(ENGINE, "assets/backgrounds", `${f.foto.fuente}.jpg`);
  if (!existsSync(file)) throw new Error(`Falta la foto ${f.foto.fuente}`);
  const img = await loadImage(readFileSync(file));
  const sh = (img.width * CARD_H) / CARD_W;
  const sy = Math.max(0, Math.min(img.height - sh, img.height * f.foto.y - sh / 2));
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Desenfoque suave: los personajes quedan nítidos delante y la foto no compite con el texto de la tarjeta. Se dibuja
  // un poco más grande para que el borde difuminado no deje ver transparencia.
  (ctx as unknown as { filter: string }).filter = "blur(3px)";
  ctx.drawImage(img, 0, sy, img.width, sh, -12, -12, CARD_W + 24, CARD_H + 24);
  (ctx as unknown as { filter: string }).filter = "none";
  ctx.fillStyle = `rgba(8,6,16,${f.foto.oscurecer ?? 0.4})`;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  return c.toBuffer("image/jpeg", 88);
}

async function muestra(f: FondoT2, capaPng: Buffer, fotoJpg: Buffer | null): Promise<Buffer> {
  const fondo = escena(f.efecto, await loadImage(capaPng), f.colores, fotoJpg ? await loadImage(fotoJpg) : null);
  const r = await renderCardAny(
    {
      name: "Papu de ejemplo", avatar: readFileSync(path.join(ROOT, "assets/bots/navidad/miku_avatar.png")), level: 52, max: 99, prestige: 0,
      into: 1677, needed: 2619, tier: 4, rankName: "Álbum", position: 7, quota: { daily: 9, limit: 14, donated: 2, donatedCap: 5 }, frase: f.nombre, accent: "#39C5BB",
      background: null, multiplier: 1,
    },
    { fondo, animado: true },
  );
  return r.data;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--muestras");
  const muestras = i >= 0 ? path.resolve(args[i + 1] ?? "") : null;
  const ids = args.filter((a, k) => !a.startsWith("--") && !(i >= 0 && k === i + 1));
  const lista = ids.length ? FONDOS_T2.filter((f) => ids.includes(f.id)) : FONDOS_T2;
  mkdirSync(OUT, { recursive: true });
  if (muestras) mkdirSync(muestras, { recursive: true });
  let faltan = 0;
  for (const f of lista) {
    let png: Buffer;
    try {
      png = await capa(f);
    } catch (e) {
      // Un render que todavía no existe (modelos nuevos en cola): se salta ese fondo y se sigue con los demás.
      console.log(`✘ ${f.id}: ${(e as Error).message}`);
      faltan++;
      continue;
    }
    writeFileSync(path.join(OUT, `${f.id}.png`), png);
    const jpg = await foto(f);
    if (jpg) {
      mkdirSync(path.join(OUT, "fotos"), { recursive: true });
      writeFileSync(path.join(OUT, "fotos", `${f.id}.jpg`), jpg);
    }
    if (muestras) {
      const gif = await muestra(f, png, jpg);
      writeFileSync(path.join(muestras, `${f.id}.gif`), gif);
      console.log(`ok ${f.id} (capa ${Math.round(png.length / 1024)} KB, muestra ${Math.round(gif.length / 1024)} KB)`);
    } else console.log(`ok ${f.id} (${Math.round(png.length / 1024)} KB)`);
  }
  // Arte propio (bordes, barras, aros y nombres): una tarjeta de muestra por objeto, sobre el fondo de siempre.
  if (muestras) {
    for (const a of ARTE_T2.filter((x) => !ids.length || ids.includes(x.id))) {
      const gif = await muestraArte(a);
      writeFileSync(path.join(muestras, `arte-${a.id}.${gif.gif ? "gif" : "png"}`), gif.data);
      console.log(`ok arte ${a.id} (${Math.round(gif.data.length / 1024)} KB)`);
    }
    // Insignias dibujadas: el PNG que usaría la tarjeta (128×128) y una tarjeta con tres de ellas junto al nombre.
    const dirIns = path.join(ROOT, "assets/coleccion/insignias/t2");
    mkdirSync(dirIns, { recursive: true });
    const imgs: Image[] = [];
    for (const ins of INSIGNIAS_DIBUJADAS_T2) {
      const dibujo = INSIGNIAS_T2[ins.id];
      if (!dibujo) throw new Error(`Falta el dibujo de ${ins.id}`);
      const c = createCanvas(128, 128);
      dibujo(c.getContext("2d"));
      const png = c.toBuffer("image/png");
      writeFileSync(path.join(dirIns, `${ins.id}.png`), png);
      writeFileSync(path.join(muestras, `${ins.id}.png`), png);
      imgs.push(await loadImage(png));
    }
    for (let k = 0; k < imgs.length; k += 3) {
      const r = await renderCardAny(
        {
          name: "Papu de ejemplo", avatar: readFileSync(path.join(ROOT, "assets/bots/navidad/gumi_avatar.png")), level: 52, max: 99, prestige: 0,
          into: 1677, needed: 2619, tier: 4, rankName: "Álbum", position: 7, quota: { daily: 9, limit: 14, donated: 2, donatedCap: 5 }, frase: "Insignias de la temporada 2",
          accent: "#2A6FB0", background: null, multiplier: 1,
        },
        { insignias: imgs.slice(k, k + 3) },
      );
      writeFileSync(path.join(muestras, `insignias-${k / 3 + 1}.png`), r.data);
    }
    console.log(`ok ${imgs.length} insignias dibujadas`);
    // Fondos con arte de los PV: fotograma recortado (fijo) y una tarjeta de muestra con él.
    for (const f of FONDOS_PV.filter((x) => !ids.length || ids.includes(x.id))) {
      const jpg = await fotogramaPV(f);
      const r = await renderCardAny(
        {
          name: "Papu de ejemplo", avatar: readFileSync(path.join(ROOT, "assets/bots/navidad/luka_avatar.png")), level: 52, max: 99, prestige: 0,
          into: 1677, needed: 2619, tier: 4, rankName: "Álbum", position: 7, quota: { daily: 9, limit: 14, donated: 2, donatedCap: 5 }, frase: f.nombre, accent: "#7A2B4A",
          background: null, multiplier: 1, lado: f.lado ?? "izquierda",
        },
        { fondo: await loadImage(jpg) },
      );
      writeFileSync(path.join(muestras, `${f.id}.png`), r.data);
      console.log(`ok ${f.id}`);
    }
    writeFileSync(path.join(muestras, "index.html"), galeria(muestras));
  }
  console.log(`${lista.length - faltan} de ${lista.length} fondos${faltan ? ` (${faltan} sin render todavía)` : ""}`);
}

async function muestraArte(a: ArteT2): Promise<{ data: Buffer; gif: boolean }> {
  const equip: CardEquip = { animado: !!a.animado };
  if (a.tipo === "borde") equip.borde = BORDES[a.id];
  if (a.tipo === "barra") equip.barra = BARRAS[a.id];
  if (a.tipo === "aro") equip.aro = AROS[a.id];
  if (a.tipo === "nombre") equip.nombre = NOMBRES[a.id];
  if (!equip.borde && !equip.barra && !equip.aro && !equip.nombre) throw new Error(`Falta el dibujo de ${a.id}`);
  return renderCardAny(
    {
      name: "Papu de ejemplo", avatar: readFileSync(path.join(ROOT, "assets/bots/navidad/teto_avatar.png")), level: 52, max: 99, prestige: 0,
      into: 1677, needed: 2619, tier: 4, rankName: "Álbum", position: 7, quota: { daily: 9, limit: 14, donated: 2, donatedCap: 5 }, frase: a.nombre, accent: "#7A2B4A",
      background: null, multiplier: 1,
    },
    equip,
  );
}

/** Fotograma del PV (caché del motor, solo lectura) recortado a la franja de la tarjeta: assets/coleccion/fondos/t2/pv/<id>.jpg. */
async function fotogramaPV(f: FondoPV): Promise<Buffer> {
  const video = path.join(ENGINE, ".cache", PVS[f.pv].video);
  if (!existsSync(video)) throw new Error(`Falta el PV ${video}`);
  const out = path.join(ROOT, "assets/coleccion/fondos/t2/pv", `${f.id}.jpg`);
  mkdirSync(path.dirname(out), { recursive: true });
  if (f.ventana) {
    // Encuadre (GyroP, 18 nov. 2026: el personaje quedaba al centro, bajo los datos): la ventana del personaje a la
    // izquierda, a todo el alto, sobre el mismo fotograma difuminado y oscurecido, con un borde que se funde.
    const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(f.t), "-i", video, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`ffmpeg falló con ${f.id}: ${r.stderr}`);
    const img = await loadImage(r.stdout);
    const [vx, vy, vw, vh] = f.ventana;
    const c = createCanvas(CARD_W, CARD_H), ctx = c.getContext("2d");
    // Fondo: la parte de arriba del fotograma (sin la letra del PV) cubriendo la tarjeta, difuminada.
    const fh = Math.min(img.height, 560), escala = Math.max(CARD_W / img.width, CARD_H / fh);
    ctx.filter = "blur(16px)";
    ctx.drawImage(img, 0, 0, img.width, fh, (CARD_W - img.width * escala) / 2, (CARD_H - fh * escala) / 2, img.width * escala, fh * escala);
    ctx.filter = "none";
    ctx.fillStyle = "rgba(10,8,18,0.45)";
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    // La ventana a la derecha (GyroP, 18 nov. 2026), con el borde izquierdo que se funde en el fondo.
    const dw = Math.round((CARD_H * vw) / vh);
    const capa = createCanvas(dw, CARD_H), g = capa.getContext("2d");
    g.drawImage(img, vx, vy, vw, vh, 0, 0, dw, CARD_H);
    const fade = g.createLinearGradient(0, 0, 110, 0);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = fade;
    g.fillRect(0, 0, 110, CARD_H);
    ctx.drawImage(capa, CARD_W - dw, 0);
    const jpg = c.toBuffer("image/jpeg", 90);
    writeFileSync(out, jpg);
    return jpg;
  }
  // 1280×720 -> franja 1280×435 desde y -> 1000×340.
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(f.t), "-i", video, "-frames:v", "1", "-vf", `crop=1280:435:0:${f.y},scale=1000:340`, "-q:v", "3", out]);
  if (r.status !== 0) throw new Error(`ffmpeg falló con ${f.id}: ${r.stderr}`);
  return readFileSync(out);
}

const TIPO: Record<ArteT2["tipo"], string> = { borde: "Bordes", barra: "Barras de XP", aro: "Aros de avatar", nombre: "Efectos de nombre" };

const RAREZA: Record<FondoT2["rareza"], [string, string]> = {
  comun: ["Común", "#C9CED6"], rara: ["Rara", "#39C5BB"], epica: ["Épica", "#B36BFF"], legendaria: ["Legendaria", "#FFC83D"], mitica: ["Mítica", "#FF5FA2"],
};

/** Página con todas las muestras (las que ya tienen GIF), por colección, para que GyroP las revise de una vez. */
function galeria(dir: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const grupos = [...new Set(FONDOS_T2.map((f) => f.grupo))];
  const cuenta = (r: FondoT2["rareza"]) => FONDOS_T2.filter((f) => f.rareza === r).length;
  const tarjeta = (f: FondoT2) => {
    const [nombre, color] = RAREZA[f.rareza];
    const img = existsSync(path.join(dir, `${f.id}.gif`)) ? `<img loading="lazy" src="${f.id}.gif" alt="${esc(f.nombre)}">` : `<div class="falta">Render en cola</div>`;
    const foto = f.foto ? `<p class="credito">📷 ${esc(f.foto.credito)}</p>` : "";
    return `<article>${img}<h3>${esc(f.nombre)} <span style="background:${color}">${nombre}</span></h3><p>${esc(f.descripcion)}</p><p class="meta">${esc(f.id)} · escena: ${esc(f.efecto)}</p>${foto}</article>`;
  };
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Temporada 2: fondos animados</title>
<style>body{margin:0;padding:24px;background:#16131f;color:#ece9f5;font:16px/1.45 system-ui,sans-serif}h1{margin:0 0 4px}h2{margin:36px 0 12px;border-bottom:2px solid #39304f;padding-bottom:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px}article{background:#211c30;border-radius:14px;padding:12px}img,.falta{width:100%;aspect-ratio:1000/340;border-radius:10px;display:block}
.falta{display:grid;place-items:center;background:#2b2540;color:#9b93b5}h3{margin:10px 0 4px;font-size:17px}h3 span{font-size:12px;color:#16131f;border-radius:99px;padding:2px 9px;vertical-align:middle;margin-left:6px}
p{margin:2px 0;color:#c9c3dc;font-size:14px}.ins{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:18px}figure{margin:0;width:118px;text-align:center;font-size:13px}figure img{width:96px;height:96px}figcaption span{font-size:11px;color:#16131f;border-radius:99px;padding:1px 7px}.meta,.credito{color:#8f88a8;font-size:12px}.resumen{color:#c9c3dc}</style>
<h1>Temporada 2: fondos animados (propuesta)</h1>
<p class="resumen">${FONDOS_T2.length} fondos: ${(Object.keys(RAREZA) as FondoT2["rareza"][]).map((r) => `${cuenta(r)} ${RAREZA[r][0].toLowerCase()}`).join(" · ")}. Rarezas y nombres son una propuesta: se cambian en scripts/temporada2-catalogo.ts.</p>
${grupos.map((g) => `<h2>${esc(g)}</h2><div class="grid">${FONDOS_T2.filter((f) => f.grupo === g).map(tarjeta).join("")}</div>`).join("\n")}
<h1 style="margin-top:48px">Fondos con arte de los PV (propuesta)</h1>
<p class="resumen">${FONDOS_PV.length} fondos comunes y fijos con ilustraciones de los PV oficiales de la saga (sin modelos de Project DIVA). Solo con Shaulitas.</p>
${[...new Set(FONDOS_PV.map((f) => f.grupo))].map((g) => `<h2>${esc(g)}</h2><div class="grid">${FONDOS_PV.filter((f) => f.grupo === g).map((f) => `<article><img loading="lazy" src="${f.id}.png" alt="${esc(f.nombre)}"><h3>${esc(f.nombre)} <span style="background:${RAREZA.comun[1]}">${RAREZA.comun[0]}</span></h3><p>${esc(f.descripcion)}</p>${f.lado ? `<p class="meta">Se ve mejor con los datos a la derecha (/tarjeta lado)</p>` : ""}<p class="credito">🎬 ${esc(PVS[f.pv].credito)}</p></article>`).join("")}</div>`).join("\n")}
<h1 style="margin-top:48px">Arte propio (propuesta)</h1>
<p class="resumen">${ARTE_T2.length} objetos dibujados con código, sin renders (se podrían comprar con cualquier moneda).</p>
${(Object.keys(TIPO) as ArteT2["tipo"][]).map((tp) => `<h2>${TIPO[tp]}</h2><div class="grid">${ARTE_T2.filter((a) => a.tipo === tp).map((a) => {
    const [nombre, color] = RAREZA[a.rareza];
    const file = ["gif", "png"].map((e) => `arte-${a.id}.${e}`).find((f) => existsSync(path.join(dir, f)));
    const img = file ? `<img loading="lazy" src="${file}" alt="${esc(a.nombre)}">` : `<div class="falta">Sin muestra</div>`;
    return `<article>${img}<h3>${esc(a.nombre)} <span style="background:${color}">${nombre}</span></h3><p>${esc(a.descripcion)}</p><p class="meta">${esc(a.id)}${a.animado ? " · animado" : ""}</p></article>`;
  }).join("")}</div>`).join("\n")}
<h1 style="margin-top:48px">Insignias dibujadas (propuesta)</h1>
<p class="resumen">${INSIGNIAS_DIBUJADAS_T2.length} insignias de 128×128 dibujadas con código (van junto al nombre, hasta 3). Abajo, cómo se ven en la tarjeta.</p>
<div class="ins">${INSIGNIAS_DIBUJADAS_T2.map((x) => `<figure><img src="${x.id}.png" alt=""><figcaption>${esc(x.nombre)}<br><span style="background:${RAREZA[x.rareza][1]}">${RAREZA[x.rareza][0]}</span></figcaption></figure>`).join("")}</div>
<div class="grid">${Array.from({ length: Math.ceil(INSIGNIAS_DIBUJADAS_T2.length / 3) }, (_, k) => `<article><img loading="lazy" src="insignias-${k + 1}.png" alt=""></article>`).join("")}</div>
<h1 style="margin-top:48px">Títulos (propuesta)</h1>
<p class="resumen">El título reemplaza la frase de la tarjeta; los míticos van en arcoíris.</p>
<div class="grid">${TEXTOS_T2.map((x) => `<article><h3>${x.tipo === "insignia" ? `${x.valor} ` : "«"}${esc(x.tipo === "insignia" ? x.nombre : x.valor)}${x.tipo === "titulo" ? "»" : ""} <span style="background:${RAREZA[x.rareza][1]}">${RAREZA[x.rareza][0]}</span></h3><p>${esc(x.descripcion)}</p><p class="meta">${esc(x.id)} · ${x.tipo === "insignia" ? "insignia" : "título"}</p></article>`).join("")}</div>
</html>`;
}

await main();
