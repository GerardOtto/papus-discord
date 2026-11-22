// Despliega el worker de Cloudflare (Miku y Luka 24/7) y conecta sus comandos de Discord a el.
//   npm run worker:deploy                (sin el mundo 3D: /mundo/ apagado y sus archivos fuera)
//   npm run worker:deploy -- --con-mundo (cuando GyroP abra la beta del mundo)
//   npm run worker:deploy -- --sin-catalogo (deja /catalogo/ fuera; por defecto siempre se publica)
// Necesita en .env: CLOUDFLARE_DEPLOY_TOKEN (permisos: Workers Scripts Edit, D1 Edit, Workers subdominio) y
// CLOUDFLARE_ACCOUNT_ID. Los tokens de Discord van como secretos del worker (nunca en el repo ni en registros).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { REST, Routes } from "discord.js";
import { loadConfig, loadDotEnv } from "../src/config";
import { commandsFor } from "../src/discord/commands";
import { EngineReader } from "../src/engine/reader";

loadDotEnv();
const config = loadConfig();
const ROOT = path.resolve(import.meta.dirname, "..");
const WORKER = path.join(ROOT, "worker");
const TOKEN = process.env.CLOUDFLARE_DEPLOY_TOKEN?.trim();
// El mundo 3D no se publica hasta que GyroP abra la beta (9 nov. 2026): por defecto no se arma ni se sube, y el worker
// no atiende /mundo/ (MUNDO_ABIERTO). El codigo y su Durable Object siguen en el worker, sin rutas.
const CON_MUNDO = process.argv.includes("--con-mundo");
// Catálogo público de objetos (npm run catalogo, worker/public/catalogo/): se sube SIEMPRE, para que su enlace no quede en
// 404 tras un despliegue (pedido de GyroP, 13 nov. 2026). --sin-catalogo lo deja fuera (p. ej. con una propuesta sin aprobar).
const CON_CATALOGO = !process.argv.includes("--sin-catalogo");
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
if (!TOKEN || !ACCOUNT) throw new Error("Faltan CLOUDFLARE_DEPLOY_TOKEN o CLOUDFLARE_ACCOUNT_ID en .env");
const OWNER = config.ownerId;
if (!OWNER) throw new Error("Falta OWNER_USER_ID en .env");

const cf = async <T>(method: string, p: string, body?: unknown): Promise<T> => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${p}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json()) as { success: boolean; result: T; errors: { code: number; message: string }[] };
  if (!j.success) throw new Error(`Cloudflare ${p}: ${j.errors.map((e) => `${e.code} ${e.message}`).join("; ")}`);
  return j.result;
};

const wrangler = (args: string[], input?: string): string => {
  const r = spawnSync("npx", ["wrangler", ...args], {
    cwd: WORKER,
    shell: true,
    encoding: "utf8",
    input,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, WRANGLER_SEND_METRICS: "false" },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) throw new Error(`wrangler ${args[0]} falló:\n${out.slice(-1500)}`);
  return out;
};

// 1) Elenco (el worker no puede leer el motor).
const engine = new EngineReader(config.engineDir);
const cast = engine.cast();
writeFileSync(path.join(WORKER, "src/cast.json"), `${JSON.stringify(cast, null, 2)}\n`);
console.log(`✔ elenco: ${cast.length} Vocaloids`);

// 2) Subdominio workers.dev de la cuenta.
const sub = await cf<{ subdomain: string | null }>("GET", "/workers/subdomain").catch(() => ({ subdomain: null }));
let subdomain = sub.subdomain;
if (!subdomain) {
  subdomain = (await cf<{ subdomain: string }>("PUT", "/workers/subdomain", { subdomain: "tetociencia" })).subdomain;
  console.log(`✔ subdominio creado: ${subdomain}.workers.dev`);
}

// 3) Base D1.
const dbs = await cf<{ uuid: string; name: string }[]>("GET", "/d1/database?name=papus");
let dbId = dbs.find((d) => d.name === "papus")?.uuid;
if (!dbId) {
  dbId = (await cf<{ uuid: string }>("POST", "/d1/database", { name: "papus" })).uuid;
  console.log("✔ base D1 creada");
}
const tomlPath = path.join(WORKER, "wrangler.toml");
writeFileSync(tomlPath, readFileSync(tomlPath, "utf8").replace(/database_id = "[^"]*"/, `database_id = "${dbId}"`));
wrangler(["d1", "execute", "papus", "--remote", "--file=schema.sql", "--yes"]);
console.log("✔ esquema de la base aplicado");

// 4) Trivia multijugador (Actividad de Discord de Teto): pool de preguntas, sus archivos y la pagina (worker/public/).
const act = spawnSync("npm", ["run", "-s", "actividad"], { cwd: ROOT, shell: true, encoding: "utf8" });
if (act.status !== 0) throw new Error(`npm run actividad falló:
${`${act.stdout ?? ""}${act.stderr ?? ""}`.slice(-1500)}`);
console.log(act.stdout.trim());
// Celular de Neru (PLAN §3.15): datos de Vocaloidle y Silueta, imagenes pixeladas y la pagina (worker/public/celular/).
const cel = spawnSync("npm", ["run", "-s", "celular"], { cwd: ROOT, shell: true, encoding: "utf8" });
if (cel.status !== 0) throw new Error(`npm run celular falló:
${`${cel.stdout ?? ""}${cel.stderr ?? ""}`.slice(-1500)}`);
console.log(cel.stdout.trim());
// Prototipo del mundo 3D de los Papus (worker/public/mundo/): solo con --con-mundo. Sin la opcion, .assetsignore deja
// sus archivos fuera de la subida aunque esten armados de antes.
writeFileSync(path.join(WORKER, "public", ".assetsignore"), (CON_MUNDO ? "" : "mundo/\n") + (CON_CATALOGO ? "" : "catalogo/\n"));
// Miniaturas de la tienda para la página de personalizar la tarjeta (/tarjeta/mini/<id>.png).
const mini = path.join(WORKER, "public", "tarjeta", "mini");
rmSync(mini, { recursive: true, force: true });
mkdirSync(mini, { recursive: true });
cpSync(path.join(ROOT, "assets/coleccion/miniaturas"), mini, { recursive: true });
console.log("✔ miniaturas de la tienda para /tarjeta/");
if (CON_MUNDO) {
  const mun = spawnSync("npm", ["run", "-s", "mundo"], { cwd: ROOT, shell: true, encoding: "utf8" });
  if (mun.status !== 0) throw new Error(`npm run mundo falló:
${`${mun.stdout ?? ""}${mun.stderr ?? ""}`.slice(-1500)}`);
  console.log(mun.stdout.trim());
} else console.log("· mundo 3D sin publicar (para incluirlo: npm run worker:deploy -- --con-mundo)");
if (!CON_CATALOGO) console.log("· catálogo sin publicar: /catalogo/ dará 404 hasta el próximo despliegue sin --sin-catalogo");

// 5) Claves publicas de las apps (para verificar las firmas) y despliegue.
const app = async (token: string) =>
  (await new REST().setToken(token).get(Routes.currentApplication())) as { id: string; verify_key: string };
const miku = await app(config.tokens.miku);
const luka = await app(config.tokens.luka);
const teto = await app(config.tokens.teto);
const neru = await app(config.tokens.neru);
const vars: Record<string, string> = {
  TETO_CLIENT_ID: teto.id,
  NERU_CLIENT_ID: neru.id,
  GUILD_ID: config.guildId,
  OWNER_ID: OWNER,
  MIKU_PUBLIC_KEY: miku.verify_key,
  LUKA_PUBLIC_KEY: luka.verify_key,
  MIKU_COLOR: String(engine.character("miku").color),
  LUKA_COLOR: String(engine.character("luka").color),
  MUNDO_ABIERTO: CON_MUNDO ? "1" : "0",
};
const deployOut = wrangler(["deploy", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])]);
const url = /https:\/\/[^\s]+\.workers\.dev/.exec(deployOut)?.[0] ?? `https://papus-bots.${subdomain}.workers.dev`;
console.log(`✔ worker desplegado: ${url}`);

// 6) Secretos (tokens de Discord y el secreto OAuth de Teto para la Actividad), via archivo temporal que se borra al instante.
const tmp = mkdtempSync(path.join(os.tmpdir(), "papus-secrets-"));
try {
  const f = path.join(tmp, "s.json");
  const tetoSecret = process.env.TETO_CLIENT_SECRET?.trim();
  const tarjetaClave = process.env.TARJETA_CLAVE?.trim();
  const neruSecret = process.env.NERU_CLIENT_SECRET?.trim();
  writeFileSync(
    f,
    JSON.stringify({
      MIKU_TOKEN: config.tokens.miku,
      LUKA_TOKEN: config.tokens.luka,
      ...(tetoSecret ? { TETO_CLIENT_SECRET: tetoSecret } : {}),
      ...(tarjetaClave ? { TARJETA_CLAVE: tarjetaClave } : {}),
      ...(neruSecret ? { NERU_CLIENT_SECRET: neruSecret } : {}),
    }),
  );
  if (!neruSecret) console.log("⚠ falta NERU_CLIENT_SECRET en .env: el celular de Neru no podrá identificar a los Papus (PLAN §3.15).");
  if (!tetoSecret) console.log("⚠ falta TETO_CLIENT_SECRET en .env: la trivia multijugador no podrá identificar a los Papus (ver README).");
  wrangler(["secret", "bulk", f]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log("✔ tokens guardados como secretos del worker");

// 7) Comprobacion de que responde.
const health = await fetch(url).then((r) => r.text()).catch((e: Error) => e.message);
console.log(`✔ el worker responde: "${health}"`);

// 8) Comandos de Miku y Luka, y sus apps conectadas al worker (Discord manda un PING para verificarlo).
for (const [bot, token, id] of [["miku", config.tokens.miku, miku.id], ["luka", config.tokens.luka, luka.id]] as const) {
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationGuildCommands(id, config.guildId), { body: commandsFor(bot, cast) });
  await rest.patch(Routes.currentApplication(), { body: { interactions_endpoint_url: `${url}/interactions/${bot}` } });
  console.log(`✔ ${bot}: comandos registrados y conectados al worker`);
}

console.log("\nListo: Miku y Luka responden sus comandos 24/7 desde Cloudflare.");
