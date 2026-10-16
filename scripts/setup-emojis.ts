// Sube los emojis exclusivos (assets/bots/emojis, generados por scripts/make_emojis.py), restringidos a los roles
// de pago: Puerro y superiores (beneficio de Puerro en Ko-fi). Si un emoji ya existe, solo ajusta sus roles.
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
const DIR = path.resolve(import.meta.dirname, "../assets/bots/emojis");

const roles = (await rest.get(Routes.guildRoles(G))) as { id: string; name: string }[];
const tierIds = loadLayout().niveles.map((n) => roles.find((r) => nameKey(r.name) === nameKey(n.rol))?.id).filter((x): x is string => !!x);
if (tierIds.length !== 5) throw new Error("No encuentro los 5 roles de los niveles");

const existing = (await rest.get(Routes.guildEmojis(G))) as { id: string; name: string; roles: string[] }[];
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".png")).sort()) {
  const name = file.replace(/\.png$/, "");
  const current = existing.find((e) => e.name === name);
  if (current) {
    if ([...current.roles].sort().join() !== [...tierIds].sort().join()) {
      await rest.patch(Routes.guildEmoji(G, current.id), { body: { roles: tierIds } });
      console.log(`✔ :${name}: roles actualizados`);
    }
    continue;
  }
  const image = `data:image/png;base64,${readFileSync(path.join(DIR, file)).toString("base64")}`;
  await rest.post(Routes.guildEmojis(G), { body: { name, image, roles: tierIds } });
  console.log(`✔ :${name}: subido (Puerro y superiores)`);
}
console.log("Listo.");
