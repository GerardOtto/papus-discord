// Catálogo público de objetos de la tarjeta (pedido de GyroP, 13 nov. 2026: «que los Papus vean el arsenal completo»).
// Una página web con cada objeto puesto en una tarjeta de ejemplo (las animadas, en video corto), con filtros por
// tipo, rareza y temporada, y un buscador. Se publica junto al worker de Cloudflare en /catalogo/ (worker/public/ no
// va al repo): en Discord basta con un enlace que se abre en cualquier navegador.
//
// Uso: npm run catalogo   -> todo config/objetos.json; lo de la temporada en curso sale marcado «Nuevo». Además arma
//      catalogo.json (los datos) y una portada de cada objeto (imagen fija) para el PDF descargable (catalogo_pdf.py).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toCardEquip } from "../src/coins/equip";
import { RAREZA_COLOR, RAREZA_NOMBRE, TIPO_NOMBRE, TIPOS, loadCatalog, loadCoinSettings, type Objeto, type Rareza, type Tipo } from "../src/coins/rules";
import { renderCardAny } from "../src/levels/card";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "worker/public/catalogo");

interface Item extends Objeto {
  /** De la temporada en curso: sale marcado «Nuevo». */
  nuevo?: boolean;
}

/** Cómo se consigue, en una línea para los Papus. */
function comoSeConsigue(o: Item): string {
  if (o.rareza === "fundador") return "Solo para los Papus fundadores.";
  if (o.rareza === "membresia") return "Regalo de su nivel de Ko-fi (para siempre).";
  if (o.rareza === "prestigio") return "Premio por prestigiar (para siempre).";
  if (o.rareza === "contrabando") return "Solo en el mercado negro de Neru, con Shaulitas.";
  const partes = [o.rareza === "mitica" ? "Solo sale en sobres." : "Tienda (vitrinas) y sobres; también se fabrica con Ecos."];
  if (o.origen === "render") partes.push("Solo con Shaulitas.");
  if (o.limitado) partes.push(o.limitado.texto);
  return partes.join(" ");
}

const AVATARES = ["teto", "miku", "luka", "neru"].map((b) => readFileSync(path.join(ROOT, `assets/bots/${b}_avatar.png`)));

/** La tarjeta de ejemplo con el objeto puesto: { archivo, animado }. Las animadas pasan de GIF a MP4 (mucho más livianas). */
async function muestra(o: Item, k: number, tmp: string): Promise<{ archivo: string; video: boolean }> {
  const ranura = o.tipo === "insignia" ? "insignia1" : o.tipo;
  const equip = await toCardEquip(new Map([[ranura, o]]), 1);
  const r = await renderCardAny(
    {
      name: "Papu de ejemplo", avatar: AVATARES[k % AVATARES.length]!, level: 52, max: 99, prestige: 0, into: 1677, needed: 2619, tier: 4,
      rankName: "Álbum", position: 7, quota: { daily: 9, limit: 14, donated: 2, donatedCap: 5 }, frase: o.tipo === "titulo" ? null : o.nombre, accent: "#5A3A8A", background: null,
      multiplier: 1, lado: o.lado ?? "izquierda",
    },
    equip,
  );
  if (!r.gif) {
    const archivo = `${o.id}.png`;
    writeFileSync(path.join(OUT, "m", archivo), r.data);
    return { archivo, video: false };
  }
  const gif = path.join(tmp, `${o.id}.gif`);
  writeFileSync(gif, r.data);
  // Portada fija (un cuadro del medio) para el PDF descargable.
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", gif, "-vf", "select=eq(n\\,12)", "-frames:v", "1", path.join(OUT, "m", `${o.id}.png`)]);
  const archivo = `${o.id}.mp4`;
  // Tres vueltas del bucle (el video se repite igual con loop), ancho 800 para que pese poco en el celular.
  const v = spawnSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "2", "-i", gif, "-vf", "scale=800:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-movflags", "+faststart", "-an", path.join(OUT, "m", archivo)]);
  if (v.status !== 0) throw new Error(`ffmpeg falló con ${o.id}: ${v.stderr}`);
  return { archivo, video: true };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const ORDEN_RAREZA: Rareza[] = ["mitica", "legendaria", "epica", "rara", "comun", "fundador", "membresia", "contrabando", "prestigio", "exclusivo"];

function pagina(items: (Item & { archivo: string; video: boolean })[], temporadas: Record<string, string>): string {
  const tarjeta = (o: (typeof items)[number]) => {
    const media = o.video
      ? `<video src="m/${o.archivo}" autoplay loop muted playsinline preload="none"></video>`
      : `<img src="m/${o.archivo}" loading="lazy" alt="">`;
    const chips = [
      `<span class="chip" style="--c:${RAREZA_COLOR[o.rareza]}">${RAREZA_NOMBRE[o.rareza]}</span>`,
      o.animado ? `<span class="chip suave">Animado</span>` : "",
      o.nuevo ? `<span class="chip pronto">Nuevo</span>` : "",
    ].join("");
    return `<article data-tipo="${o.tipo}" data-rareza="${o.rareza}" data-temporada="${o.temporada}" data-texto="${esc(`${o.nombre} ${o.descripcion}`.toLowerCase())}">
<div class="media">${media}</div><h3>${esc(o.nombre)}</h3><div class="chips">${chips}</div><p>${esc(o.descripcion)}</p><p class="como">${esc(comoSeConsigue(o))}</p>${o.lado ? `<p class="credito">💡 Se ve mejor con <b>/tarjeta</b> (lado: derecha).</p>` : ""}</article>`;
  };
  const tipos = TIPOS.filter((t) => items.some((o) => o.tipo === t));
  const rarezas = ORDEN_RAREZA.filter((r) => items.some((o) => o.rareza === r));
  const temps = Object.keys(temporadas).filter((t) => items.some((o) => o.temporada === t));
  const botones = (grupo: string, valores: string[], nombre: (v: string) => string) =>
    `<div class="filtro" data-grupo="${grupo}"><button class="on" data-v="">Todos</button>${valores.map((v) => `<button data-v="${v}">${esc(nombre(v))}</button>`).join("")}</div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Catálogo de los Papus</title>
<meta name="description" content="Todos los objetos para la tarjeta de nivel: fondos, bordes, barras, aros, insignias y títulos.">
<style>
:root{--bg:#16131f;--panel:#211c30;--txt:#ece9f5;--sub:#b9b2cf;--borde:#39304f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:28px 16px 8px;max-width:1280px;margin:auto}h1{margin:0 0 6px;font-size:30px}header p{margin:0;color:var(--sub)}
.barra{position:sticky;top:0;z-index:2;background:rgba(22,19,31,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--borde);padding:10px 16px}
.barra>div{max-width:1280px;margin:auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.filtro{display:flex;flex-wrap:wrap;gap:6px}button{background:var(--panel);color:var(--sub);border:1px solid var(--borde);border-radius:99px;padding:5px 12px;font:inherit;font-size:14px;cursor:pointer}
button.on{background:#39C5BB;color:#10121a;border-color:#39C5BB}input{flex:1;min-width:180px;background:var(--panel);color:var(--txt);border:1px solid var(--borde);border-radius:10px;padding:7px 12px;font:inherit}
main{max-width:1280px;margin:auto;padding:16px}.cuenta{color:var(--sub);margin:4px 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:16px}
article{background:var(--panel);border-radius:14px;padding:10px 10px 12px}article.oculto{display:none}
.media{aspect-ratio:1000/340;border-radius:10px;overflow:hidden;background:#0d0b14}.media img,.media video{width:100%;height:100%;object-fit:cover;display:block}
h3{margin:10px 2px 4px;font-size:17px}.chips{display:flex;flex-wrap:wrap;gap:5px;margin:0 2px 6px}
.chip{font-size:12px;border-radius:99px;padding:1px 9px;background:var(--c);color:#16131f;font-weight:600}.chip.suave{background:#3a3354;color:var(--sub)}.chip.pronto{background:#FF5FA2;color:#16131f}
p{margin:2px 2px;color:var(--sub);font-size:14px}.como{color:#d9d3ec}.credito{font-size:12px;color:#8f88a8}
footer{max-width:1280px;margin:auto;padding:24px 16px 40px;color:#8f88a8;font-size:13px}
</style></head><body>
<header><h1>🪙 Catálogo de los Papus</h1><p>Todo lo que puedes ponerle a tu tarjeta de nivel (<b>/nivel</b>) con Shaulitas: ${items.length} objetos. Se consiguen en <b>/tienda</b>, en sobres o fabricándolos con Ecos. Las Shaulitas solo adornan la tarjeta: no dan XP ni cuota. ¿El arte de tu fondo queda detrás de tus datos? Con <b>/tarjeta</b> (lado: derecha) tu avatar y tus datos pasan al otro lado.</p><p style="margin-top:8px"><a href="catalogo.pdf" download style="color:#39C5BB;font-weight:600">⬇️ Descargar el catálogo en PDF</a> (imágenes fijas)</p></header>
<div class="barra"><div>
${botones("tipo", tipos, (t) => TIPO_NOMBRE[t as Tipo])}
${botones("rareza", rarezas, (r) => RAREZA_NOMBRE[r as Rareza])}
${temps.length > 1 ? botones("temporada", temps, (t) => temporadas[t] ?? t) : ""}
<input type="search" placeholder="Buscar (ej.: Miku, nieve, Kayo…)" aria-label="Buscar">
</div></div>
<main><p class="cuenta"></p><div class="grid">
${items.map(tarjeta).join("\n")}
</div></main>
<footer>Renders hechos con modelos de Project DIVA Mega Mix+ (SEGA, Crypton) y mods de fans, para uso personal no comercial: por eso los objetos con renders solo se consiguen con Shaulitas. Las ilustraciones de los PV son de sus autores (créditos en cada objeto). Iconos de Twemoji (CC BY 4.0).</footer>
<script>
const f={tipo:"",rareza:"",temporada:""};let q="";const arts=[...document.querySelectorAll("article")],cuenta=document.querySelector(".cuenta");
function aplicar(){let n=0;for(const a of arts){const ok=(!f.tipo||a.dataset.tipo===f.tipo)&&(!f.rareza||a.dataset.rareza===f.rareza)&&(!f.temporada||a.dataset.temporada===f.temporada)&&(!q||a.dataset.texto.includes(q));a.classList.toggle("oculto",!ok);if(ok)n++}cuenta.textContent=n+" de "+arts.length+" objetos"}
document.querySelectorAll(".filtro").forEach(g=>g.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;g.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));f[g.dataset.grupo]=b.dataset.v;aplicar()}));
document.querySelector("input").addEventListener("input",e=>{q=e.target.value.trim().toLowerCase();aplicar()});
// Los videos solo se reproducen cuando se ven (en el celular no se cargan los ~200 a la vez).
const io=new IntersectionObserver(es=>es.forEach(e=>{const v=e.target;if(e.isIntersecting){v.preload="auto";v.play().catch(()=>{})}else v.pause()}),{rootMargin:"200px"});
document.querySelectorAll("video").forEach(v=>io.observe(v));aplicar();
</script></body></html>`;
}

async function main() {
  const doc = JSON.parse(readFileSync(path.join(ROOT, "config/objetos.json"), "utf8")) as { temporadas: { id: string; nombre: string }[] };
  const temporadas: Record<string, string> = Object.fromEntries(doc.temporadas.map((t) => [t.id, t.nombre]));
  temporadas.mercado ??= "Mercado negro";
  const actual = loadCoinSettings().temporada.id;
  const lista: Item[] = loadCatalog().filter((o) => o.rareza !== "exclusivo").map((o) => ({ ...o, nuevo: o.temporada === actual }));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.join(OUT, "m"), { recursive: true });
  const tmp = path.join(os.tmpdir(), `catalogo-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  // Orden: temporada más nueva primero; dentro, por tipo y rareza.
  const tOrden = (t: string) => (t === "mercado" ? 99 : -Number(t.replace(/\D/g, "") || 0));
  lista.sort((a, b) => tOrden(a.temporada) - tOrden(b.temporada) || TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo) || ORDEN_RAREZA.indexOf(a.rareza) - ORDEN_RAREZA.indexOf(b.rareza));
  const hechos: (Item & { archivo: string; video: boolean })[] = [];
  for (const [k, o] of lista.entries()) {
    if (o.imagen && !existsSync(path.join(ROOT, "assets/coleccion", o.imagen))) {
      console.log(`✘ ${o.id}: falta assets/coleccion/${o.imagen}`);
      continue;
    }
    hechos.push({ ...o, ...(await muestra(o, k, tmp)) });
    if (hechos.length % 25 === 0) console.log(`… ${hechos.length} de ${lista.length}`);
  }
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(path.join(OUT, "index.html"), pagina(hechos, temporadas));
  // Datos para el PDF descargable (scripts/catalogo_pdf.py).
  writeFileSync(
    path.join(OUT, "catalogo.json"),
    JSON.stringify(
      hechos.map((o) => ({
        id: o.id, nombre: o.nombre, tipo: TIPO_NOMBRE[o.tipo], rareza: RAREZA_NOMBRE[o.rareza], color: RAREZA_COLOR[o.rareza], temporada: temporadas[o.temporada] ?? o.temporada,
        nuevo: !!o.nuevo, animado: !!o.animado, descripcion: o.descripcion, como: comoSeConsigue(o), imagen: `m/${o.id}.png`,
      })),
      null,
      1,
    ),
  );
  console.log(`Listo: ${hechos.length} objetos en worker/public/catalogo/ (se publica con npm run worker:deploy)`);
}

await main();
