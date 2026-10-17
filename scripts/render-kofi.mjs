// Renderiza las 5 imagenes de nivel de Ko-fi (assets/kofi/tier.html?tier=N) a PNG de 1600x800 (2:1)
// con el Chrome Headless Shell que descarga Remotion en el motor (ENGINE_DIR, por defecto ../Proyecto1).
// Uso: node scripts/render-kofi.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = path.resolve(root, process.env.ENGINE_DIR ?? "../Proyecto1");

const findChrome = () => {
  const env = process.env.REMOTION_BROWSER_EXECUTABLE;
  if (env && fs.existsSync(env)) return env;
  const stack = [path.join(engine, "node_modules/.remotion/chrome-headless-shell")];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === "chrome-headless-shell.exe" || e.name === "chrome-headless-shell") return p;
    }
  }
  throw new Error("No se encontro chrome-headless-shell en el motor (define REMOTION_BROWSER_EXECUTABLE)");
};

const TIERS = ["puerro", "atun", "baguette", "celular", "triple_baka"];
const chrome = findChrome();
const shot = (page, query, out, width, height, scale = 1) => {
  execFileSync(chrome, [
    "--headless", "--disable-gpu", "--hide-scrollbars", `--force-device-scale-factor=${scale}`,
    "--default-background-color=00000000", "--allow-file-access-from-files",
    `--window-size=${width},${height}`, "--virtual-time-budget=3000",
    `--screenshot=${out}`, `${pathToFileURL(path.join(root, page)).href}?${query}`,
  ], { stdio: "ignore" });
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(`No se genero ${out}`);
  console.log(`ok ${path.relative(root, out)}`);
};
// Portadas de historias destacadas de Instagram (1080x1920, icono centrado). Solo esto: node scripts/render-kofi.mjs destacadas
const destacadas = () => {
  for (const s of ["discord", "kofi"]) shot("assets/historias/destacada.html", `s=${s}`, path.join(root, `assets/historias/destacada_${s}.png`), 1080, 1920);
};
if (process.argv.includes("destacadas")) {
  destacadas();
  process.exit(0);
}
// Primero las insignias (512x512, transparentes): las imagenes de los niveles las usan.
for (const [i, slug] of TIERS.entries()) shot("assets/kofi/badges.html", `badge=${i + 1}`, path.join(root, `assets/kofi/badge_${i + 1}_${slug}.png`), 512, 512);
for (const [i, slug] of TIERS.entries()) shot("assets/kofi/tier.html", `tier=${i + 1}`, path.join(root, `assets/kofi/tier_${i + 1}_${slug}.png`), 1600, 800);
// Portadas de los productos de la tienda (1200x1200) y PDF "Guia de tu pedido" (Assets de los productos).
const PRODUCTS = ["saludo_express", "video_personalizado", "video_especial", "entrada_gratis_discord"];
for (const [i, slug] of PRODUCTS.entries()) shot("assets/kofi/product.html", `p=${i + 1}`, path.join(root, `assets/kofi/producto_${i + 1}_${slug}.png`), 1200, 1200);
// Portadas del perfil (3:1): 1200x400 renderizadas a 2x (2400x800) para pantallas grandes.
for (let v = 1; v <= 6; v++) shot("assets/kofi/cover.html", `v=${v}`, path.join(root, `assets/kofi/cover_${v}.png`), 1200, 400, 2);
const pdf = path.join(root, "assets/kofi/Guia_de_tu_pedido.pdf");
execFileSync(chrome, ["--headless", "--disable-gpu", "--allow-file-access-from-files", "--no-pdf-header-footer", "--virtual-time-budget=3000",
  `--print-to-pdf=${pdf}`, pathToFileURL(path.join(root, "assets/kofi/guia-pedido.html")).href], { stdio: "ignore" });
if (!fs.existsSync(pdf) || fs.statSync(pdf).size === 0) throw new Error(`No se genero ${pdf}`);
console.log(`ok ${path.relative(root, pdf)}`);
// Historias destacadas del perfil con boton (1080x1920): Discord y Ko-fi.
for (const s of ["discord", "kofi"]) shot("assets/historias/historia.html", `s=${s}`, path.join(root, `assets/historias/historia_${s}.png`), 1080, 1920);
destacadas();
