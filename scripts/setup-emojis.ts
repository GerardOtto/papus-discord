// Sube los emojis del servidor y ajusta quién puede usarlos:
//   - pago (Puerro y superiores, beneficio de Ko-fi): assets/bots/emojis (scripts/make_emojis.py) y
//     assets/emojis/pago;
//   - gratis (todos los Papus): assets/emojis/gratis.
// Los de assets/emojis salen de scripts/make_emoji_samples.py, y solo se sube lo que lista assets/emojis/packs.json
// (así un archivo sobrante de una versión anterior nunca se cuela). Los GIF quedan como emojis animados.
// Si un emoji ya existe, solo ajusta sus roles. Nunca borra.
//   npm run emojis   (usa la app de Teto: necesita Administrador o "Gestionar expresiones")
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { loadConfig, loadDotEnv } from "../src/config";
import { loadLayout, nameKey } from "../src/setup/layout";

loadDotEnv();
const config = loadConfig();
const rest = new REST().setToken(config.tokens.teto);
const G = config.guildId;
const ROOT = path.resolve(import.meta.dirname, "..");

const roles = (await rest.get(Routes.guildRoles(G))) as { id: string; name: string }[];
const tierIds = loadLayout().niveles.map((n) => roles.find((r) => nameKey(r.name) === nameKey(n.rol))?.id).filter((x): x is string => !!x);
if (tierIds.length !== 5) throw new Error("No encuentro los 5 roles de los niveles");

interface Item {
  file: string;
  name: string;
  roles: string[];
}
const manifest = JSON.parse(readFileSync(path.join(ROOT, "assets/emojis/packs.json"), "utf8")) as { gratis: string[]; pago: string[] };
const item = (dir: string, file: string, r: string[]): Item => ({ file: path.join(ROOT, dir, file), name: file.replace(/\.(png|gif)$/, ""), roles: r });
const items: Item[] = [
  ...readdirSync(path.join(ROOT, "assets/bots/emojis")).filter((f) => f.endsWith(".png")).sort().map((f) => item("assets/bots/emojis", f, tierIds)),
  ...manifest.pago.map((f) => item("assets/emojis/pago", f, tierIds)),
  ...manifest.gratis.map((f) => item("assets/emojis/gratis", f, [])),
];
const dupes = items.map((i) => i.name).filter((n, i, all) => all.indexOf(n) !== i);
if (dupes.length) throw new Error(`Nombres repetidos entre packs: ${dupes.join(", ")}`);

const sameRoles = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
const existing = (await rest.get(Routes.guildEmojis(G))) as { id: string; name: string; roles: string[] }[];
let created = 0;
let updated = 0;
for (const it of items) {
  const who = it.roles.length ? "Puerro y superiores" : "todos";
  const current = existing.find((e) => e.name === it.name);
  if (current) {
    if (!sameRoles(current.roles, it.roles)) {
      await rest.patch(Routes.guildEmoji(G, current.id), { body: { roles: it.roles } });
      console.log(`✔ :${it.name}: ahora para ${who}`);
      updated++;
    }
    continue;
  }
  const mime = it.file.endsWith(".gif") ? "image/gif" : "image/png";
  const image = `data:${mime};base64,${readFileSync(it.file).toString("base64")}`;
  try {
    await rest.post(Routes.guildEmojis(G), { body: { name: it.name, image, roles: it.roles } });
    console.log(`✔ :${it.name}: subido (${who})`);
    created++;
  } catch (e) {
    console.log(`✘ :${it.name}: ${(e as Error).message}`);
  }
}
console.log(`Listo: ${created} subidos, ${updated} con roles ajustados.`);
