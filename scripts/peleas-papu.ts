// Luchador Papu del 1vs1 (PLAN §2: beneficio de 💥 Triple Baka). Agrega a un Papu como luchador invitado: baja su
// avatar de Discord a assets/peleas/luchadores/<id>.png y lo suma a config/peleas.json con estadísticas en el promedio
// de todos (así queda equilibrado: las pruebas del 1vs1 lo comprueban) y movimientos genéricos. Su frase del especial
// la puede escribir él con /aportar frase. Después: npm test (equilibrio), npm run peleas:wiki -- --apply (su ficha)
// y reiniciar los bots.
// Uso: npm run peleas:papu -- <id de Discord> <id corto> "<Nombre>" [#RRGGBB]
//      ej.: npm run peleas:papu -- 1249192248881451153 yamato "Yamato" "#7FD1FF"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { loadConfig, loadDotEnv } from "../src/config";

const [discordId, id, nombre, color = "#FFD86B"] = process.argv.slice(2);
if (!discordId || !id || !nombre || !/^[a-z0-9-]+$/.test(id) || !/^#[0-9a-fA-F]{6}$/.test(color)) {
  console.error('Uso: npm run peleas:papu -- <id de Discord> <id corto en minúsculas> "<Nombre>" [#RRGGBB]');
  process.exit(1);
}
const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.join(ROOT, "config/peleas.json");
const raw = readFileSync(FILE, "utf8");
const crlf = raw.includes("\r\n");
const doc = JSON.parse(raw) as { luchadores: Record<string, Record<string, unknown> & { vida: number; ataque: number; defensa: number; agilidad: number }> };
if (doc.luchadores[id]) {
  console.error(`Ya existe el luchador «${id}» en config/peleas.json.`);
  process.exit(1);
}

// Avatar de Discord (512 px).
loadDotEnv();
const config = loadConfig();
const user = (await new REST().setToken(config.tokens.teto).get(Routes.user(discordId))) as { id: string; avatar: string | null };
const url = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=512` : `https://cdn.discordapp.com/embed/avatars/0.png`;
const res = await fetch(url);
if (!res.ok) throw new Error(`No pude bajar el avatar (${res.status})`);
const dir = path.join(ROOT, "assets/peleas/luchadores");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `${id}.png`), Buffer.from(await res.arrayBuffer()));

// Estadísticas en el promedio de todos los luchadores (redondeadas).
const todos = Object.values(doc.luchadores);
const prom = (k: "vida" | "ataque" | "defensa" | "agilidad") => Math.round(todos.reduce((a, l) => a + l[k], 0) / todos.length);
doc.luchadores[id] = {
  nombre,
  color: color.toUpperCase(),
  grupo: "especial",
  papu: discordId,
  por: `Luchador Papu (💥 Triple Baka): ${nombre} pelea por su cuenta. Estadísticas en el promedio de todos.`,
  vida: prom("vida"),
  ataque: prom("ataque"),
  defensa: prom("defensa"),
  agilidad: prom("agilidad"),
  movimientos: {
    ataque: ["le tira un mensaje en mayúsculas", "le manda un sticker con fuerza", "le lanza su nivel en la cara"],
    bloqueo: ["se cubre con su tarjeta de nivel", "pone de escudo su colección de sobres"],
    esquiva: ["se va a otro canal", "se esconde en un canal de voz"],
    especial: { nombre: "Poder Papu", texto: "junta la energía de todo el servidor y la suelta de golpe", dano: 8 },
  },
};
let out = `${JSON.stringify(doc, null, 2)}\n`;
if (crlf) out = out.replace(/\n/g, "\r\n");
writeFileSync(FILE, out);
console.log(`✔ ${nombre} (${id}) agregado a config/peleas.json con su avatar en assets/peleas/luchadores/${id}.png.`);
console.log(existsSync(path.join(dir, `${id}.png`)) ? "Ahora: npm test, npm run peleas:wiki -- --apply y reinicia los bots." : "⚠️ Falta el avatar.");
