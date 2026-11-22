// Aplica avatar, banner y biografia a los bots con token por la API de Discord. `npm run perfiles [-- teto gakupo] [--navidad]`.
// Avatares y banners: assets/bots/<id>_avatar.png y _banner.png (scripts/make_avatars.py). Biografias: content/perfiles.json.
// Discord limita los cambios de avatar (unos pocos por hora): si responde 429, esperar y reintentar.
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, loadConfig, loadDotEnv, type BotId } from "../src/config";

loadDotEnv();
const config = loadConfig();
const ROOT = path.resolve(import.meta.dirname, "..");
const bios = JSON.parse(readFileSync(path.join(ROOT, "content/perfiles.json"), "utf8")) as Record<string, string>;
// --navidad: avatar y banner de assets/bots/navidad/ (make_avatars.py --navidad); sin la opción vuelven los normales.
const imgDir = process.argv.includes("--navidad") ? "assets/bots/navidad" : "assets/bots";
// --avatar <png>: sube solo ese avatar (un bot) y deja el banner como está. Ej.: Kaito de Gallerian en la Avaricia,
// recortado con scripts/recortar_avatar.py → assets/bots/pecados/kaito_avatar.png.
const avatarIdx = process.argv.indexOf("--avatar");
const soloAvatar = avatarIdx >= 0 ? path.resolve(ROOT, process.argv[avatarIdx + 1] ?? "") : null;
const only = process.argv.slice(2).filter((a): a is BotId => (BOT_IDS as readonly string[]).includes(a));
const missing = only.filter((id) => !config.tokens[id]);
if (missing.length) throw new Error(`Sin token en .env: ${missing.join(", ")}`);
if (soloAvatar && only.length !== 1) throw new Error("--avatar <png> va con un solo bot: npm run perfiles -- kaito --avatar <png>");

const dataUri = (file: string) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

for (const id of only.length ? only : config.activeBots) {
  const headers = { Authorization: `Bot ${config.tokens[id]}`, "Content-Type": "application/json" };
  const bio = bios[id];
  if (!bio || bio.length > 400) throw new Error(`Biografia de ${id} vacia o de mas de 400 caracteres`);

  const user = await fetch("https://discord.com/api/v10/users/@me", {
    method: "PATCH",
    headers,
    body: JSON.stringify(
      soloAvatar
        ? { avatar: dataUri(soloAvatar) }
        : {
            avatar: dataUri(path.join(ROOT, `${imgDir}/${id}_avatar.png`)),
            banner: dataUri(path.join(ROOT, `${imgDir}/${id}_banner.png`)),
          },
    ),
  });
  const app = await fetch("https://discord.com/api/v10/applications/@me", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ description: bio }),
  });
  const detail = async (r: Response) => (r.ok ? "ok" : `HTTP ${r.status} ${(await r.text()).slice(0, 150)}`);
  console.log(`${id}: ${soloAvatar ? "avatar" : "avatar y banner"} ${await detail(user)} · biografía ${await detail(app)}`);
}
