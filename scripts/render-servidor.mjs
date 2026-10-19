// Renderiza el cartel de invitación (assets/servidor/cartel.html -> cartel_invitacion.png, 1920x1080) y los cuadros
// del ícono animado (assets/servidor/icono.html?t=ms -> PNG de 512x512); el GIF lo arma scripts/make_icono.py.
// Usa el Chrome Headless Shell que descarga Remotion en el motor (como scripts/render-kofi.mjs).
// Uso: node scripts/render-servidor.mjs [cartel] [icono]
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
const chrome = findChrome();
const shot = (page, query, out, width, height) => {
  execFileSync(chrome, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--default-background-color=00000000", "--allow-file-access-from-files",
    `--window-size=${width},${height}`, "--virtual-time-budget=3000",
    `--screenshot=${out}`, `${pathToFileURL(path.join(root, page)).href}?${query}`,
  ], { stdio: "ignore" });
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(`No se genero ${out}`);
};

const all = !process.argv.includes("cartel") && !process.argv.includes("icono");
if (all || process.argv.includes("cartel")) {
  shot("assets/servidor/cartel.html", "", path.join(root, "assets/servidor/cartel_invitacion.png"), 1920, 1080);
  console.log("ok assets/servidor/cartel_invitacion.png");
}
if (all || process.argv.includes("icono")) {
  // Duración y cuadros por segundo: los define icono.html (window.LOOP_MS); aquí, 15 cuadros por segundo.
  const LOOP_MS = 6000, FPS = 15;
  const dir = path.join(root, "assets/servidor/icono_cuadros");
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round((LOOP_MS / 1000) * FPS);
  for (let i = 0; i < n; i++) shot("assets/servidor/icono.html", `t=${Math.round((i * 1000) / FPS)}`, path.join(dir, `${String(i).padStart(3, "0")}.png`), 512, 512);
  console.log(`ok ${n} cuadros en assets/servidor/icono_cuadros (arma el GIF: python scripts/make_icono.py)`);
}
