// Genera el PDF "Guía para replicar el servidor" (docs/guia-replicar.html) y lo deja en el escritorio.
// Usa el Chrome Headless Shell que descarga Remotion en el motor (como scripts/render-kofi.mjs).
// Uso: node scripts/render-guia.mjs [carpeta de salida]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

const outDir = process.argv[2] ?? path.join(os.homedir(), "Desktop");
const out = path.join(outDir, "Guia para replicar el servidor de Discord.pdf");
execFileSync(
  findChrome(),
  [
    "--headless",
    "--disable-gpu",
    "--allow-file-access-from-files",
    "--no-pdf-header-footer",
    "--virtual-time-budget=4000",
    `--print-to-pdf=${out}`,
    pathToFileURL(path.join(root, "docs/guia-replicar.html")).href,
  ],
  { stdio: "ignore" },
);
if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(`No se genero ${out}`);
console.log(`ok ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
