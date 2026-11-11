// Traslado de los bots a un servidor en la nube (Oracle Always Free u otro Ubuntu 24.04) y vuelta al PC.
// Se usa desde el PC (nube\nube.cmd <comando>); habla con el servidor por SSH. No cambia nada del arranque actual en el
// PC salvo en `trasladar` (pausa las tareas de Windows) y `volver` (las reactiva): ver nube/LEEME.md.
//   conectar <ip> <llave> [--usuario ubuntu] [--puerto 22]   guarda la conexion (nube/conexion.json) y la prueba
//   preparar [--sin-local]   instala Node, el servicio y Ollama con papus-gemma (servicio apagado)
//   subir                    codigo (solo lo que cambio), datos del motor, carpetas de entrega y .env
//   sincronizar              solo datos del motor y carpetas de entrega (lo corre una tarea del PC cada 30 min)
//   probar [--llm]           npm run check en el servidor (no conecta los bots)
//   trasladar [--si]         PC -> servidor: detiene los bots del PC, copia data/ y los arranca alla
//   volver [--si]            servidor -> PC: los detiene alla, trae data/ (con respaldo) y los arranca en el PC
//   estado | registro [n] | reiniciar | detener | npm <script> [args] | traer <ruta-en-data>
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { deliveryPaths, diffManifest, engineSyncPaths, hashOf, rewriteEnv, safeRelative, tar, untar, type Manifest, type TarEntry } from "./lib";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONN_FILE = path.join(ROOT, "nube", "conexion.json");
const DATA = path.join(ROOT, "data");
const WIN = process.platform === "win32";
const SSH = WIN ? "C:\\Windows\\System32\\OpenSSH\\ssh.exe" : "ssh";
const MANIFEST = ".nube-manifiesto.json";
const SYNC_TASK = "Papus Nube Sincronizar";
const PC_TASKS = ["Papus Discord", "Papus Bandeja"];
/** De data/ no viajan: registros, estado del icono y archivos propios del PC. */
const DATA_SKIP = new Set(["bots.log", "bots.old.log", "detener.flag", "estado.json", "gpt.ini.bak", "respaldos", "nube", "nube-sincronizar.log"]);

interface Conn {
  host: string;
  usuario: string;
  llave: string;
  puerto: number;
}

class NubeError extends Error {}

const say = (msg: string) => console.log(msg);
const stamp = () => new Date().toLocaleString("sv-SE").replace(/[: ]/g, "-");
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function conn(): Conn {
  if (!existsSync(CONN_FILE)) throw new NubeError("Falta la conexion: nube conectar <ip> <llave>");
  return JSON.parse(readFileSync(CONN_FILE, "utf8")) as Conn;
}

function sshArgs(c: Conn): string[] {
  return [
    "-i", c.llave, "-p", String(c.puerto),
    "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30", "-o", "ConnectTimeout=20",
    `${c.usuario}@${c.host}`,
  ];
}

/** Corre un comando en el servidor. Con capture, devuelve lo que imprime en vez de mostrarlo. */
function remote(cmd: string, opts: { input?: Buffer; capture?: boolean; allowFail?: boolean } = {}): Promise<{ code: number; out: Buffer }> {
  return new Promise((resolve, reject) => {
    const p = spawn(SSH, [...sshArgs(conn()), cmd], { stdio: [opts.input ? "pipe" : "ignore", opts.capture ? "pipe" : "inherit", "inherit"] });
    const chunks: Buffer[] = [];
    p.stdout?.on("data", (d: Buffer) => chunks.push(d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0 && !opts.allowFail) reject(new NubeError(`El servidor respondio con error (${code}) en: ${cmd.slice(0, 80)}`));
      else resolve({ code: code ?? 1, out: Buffer.concat(chunks) });
    });
    if (opts.input) {
      p.stdin!.on("error", () => {});
      p.stdin!.end(opts.input);
    }
  });
}

const remoteText = async (cmd: string) => (await remote(cmd, { capture: true })).out.toString("utf8").trim();

function powershell(script: string, allowFail = false): number {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "inherit" });
  if (r.status !== 0 && !allowFail) throw new NubeError(`PowerShell fallo (${r.status})`);
  return r.status ?? 1;
}

async function confirm(question: string, yes: boolean): Promise<void> {
  if (yes) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} (s/n) `)).trim().toLowerCase();
  rl.close();
  if (a !== "s" && a !== "si" && a !== "sí") throw new NubeError("Cancelado; no se cambio nada.");
}

function localEnv(): Record<string, string> {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) throw new NubeError("No existe .env en el PC");
  return parseEnv(readFileSync(file, "utf8")) as Record<string, string>;
}

function walk(abs: string, rel: string, out: Map<string, string>): void {
  if (!existsSync(abs)) return;
  if (statSync(abs).isFile()) return void out.set(rel, abs);
  for (const e of readdirSync(abs, { withFileTypes: true })) walk(path.join(abs, e.name), `${rel}/${e.name}`, out);
}

// ---------- subir y sincronizar ----------

/** Deja en remoteDir los archivos de `files` (ruta relativa -> ruta en el PC), mandando solo lo que cambio. */
async function syncTree(remoteDir: string, files: Map<string, string>, label: string): Promise<string[]> {
  const local: Manifest = {};
  const data = new Map<string, Buffer>();
  for (const [rel, abs] of files) {
    const b = readFileSync(abs);
    local[rel] = hashOf(b);
    data.set(rel, b);
  }
  const raw = await remoteText(`mkdir -p ${remoteDir} && cat ${remoteDir}/${MANIFEST} 2>/dev/null || echo '{}'`);
  const { changed, removed } = diffManifest(local, JSON.parse(raw || "{}") as Manifest);
  if (!changed.length && !removed.length) {
    say(`✔ ${label}: sin cambios (${files.size} archivos)`);
    return [];
  }
  const entries: TarEntry[] = changed.map((f) => ({ name: f, data: data.get(f)! }));
  entries.push({ name: ".nube-borrar", data: Buffer.from(removed.map((f) => `${f}\0`).join("")) });
  entries.push({ name: MANIFEST, data: Buffer.from(JSON.stringify(local)) });
  const gz = gzipSync(tar(entries));
  say(`↑ ${label}: ${changed.length} archivos nuevos o cambiados, ${removed.length} borrados (${(gz.length / 1048576).toFixed(1)} MB)`);
  await remote(`cd ${remoteDir} && tar -xzf - && if [ -s .nube-borrar ]; then xargs -0 rm -f -- < .nube-borrar; fi; rm -f .nube-borrar`, { input: gz });
  return changed;
}

function codeFiles(): Map<string, string> {
  const r = spawnSync("git", ["-c", "core.quotepath=off", "ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new NubeError("No se pudo listar el codigo con git");
  const files = new Map<string, string>();
  for (const f of r.stdout.split("\0").filter(Boolean)) {
    const abs = path.join(ROOT, f);
    if (existsSync(abs) && statSync(abs).isFile()) files.set(f, abs);
  }
  // Fragmentos de audio de la trivia: no se versionan (copyright, como la musica del motor), pero el bot los necesita.
  const audio = path.join(ROOT, "assets/trivia/audio");
  if (existsSync(audio)) for (const f of readdirSync(audio)) files.set(`assets/trivia/audio/${f}`, path.join(audio, f));
  // Imagenes de las preguntas generadas (npm run trivia:imagenes, desde las del motor): tampoco se versionan.
  const pictures = path.join(ROOT, "assets/trivia/imagenes");
  if (existsSync(pictures)) for (const f of readdirSync(pictures)) files.set(`assets/trivia/imagenes/${f}`, path.join(pictures, f));
  return files;
}

async function sincronizar(): Promise<void> {
  const env = localEnv();
  const paths = JSON.parse(readFileSync(path.join(ROOT, "config/engine-paths.json"), "utf8"));
  const engineDir = path.resolve(ROOT, env.ENGINE_DIR || "../Proyecto1");
  const files = new Map<string, string>();
  for (const p of engineSyncPaths(paths)) walk(path.join(engineDir, p), p.replace(/\/+$/, ""), files);
  await syncTree("~/papus/motor", files, "datos del motor");

  // Carpetas de entrega: solo los NOMBRES de las carpetas (titulo y estado); ningun archivo viaja.
  const deliveryDir = env.DELIVERY_DIR;
  if (!deliveryDir || !existsSync(deliveryDir)) return say("· sin DELIVERY_DIR en el PC: carpetas de entrega omitidas");
  const entries: TarEntry[] = [];
  for (const p of deliveryPaths(paths)) {
    const dir = path.join(deliveryDir, p);
    if (!existsSync(dir)) continue;
    entries.push({ name: p });
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) entries.push({ name: `${p}/${e.name}` });
  }
  await remote(
    "rm -rf ~/papus/entrega.nueva && mkdir -p ~/papus/entrega.nueva && tar -xzf - -C ~/papus/entrega.nueva && rm -rf ~/papus/entrega && mv ~/papus/entrega.nueva ~/papus/entrega",
    { input: gzipSync(tar(entries)) },
  );
  say(`✔ carpetas de entrega: ${entries.length} nombres`);
}

async function subirEnv(): Promise<boolean> {
  const home = await remoteText("echo $HOME");
  const text = rewriteEnv(readFileSync(path.join(ROOT, ".env"), "utf8"), { ENGINE_DIR: "../motor", DELIVERY_DIR: `${home}/papus/entrega` });
  const before = await remoteText("sha1sum ~/papus/app/.env 2>/dev/null | cut -c1-40");
  if (before === hashOf(Buffer.from(text))) return say("✔ .env: sin cambios"), false;
  await remote("umask 077 && cat > ~/papus/app/.env", { input: Buffer.from(text) });
  say("✔ .env copiado (con las rutas del servidor; no se muestra)");
  return true;
}

async function subir(opts: { restart: boolean }): Promise<void> {
  const changed = await syncTree("~/papus/app", codeFiles(), "codigo");
  await sincronizar();
  const envChanged = await subirEnv();
  const hasModules = (await remote("test -d ~/papus/app/node_modules", { allowFail: true })).code === 0;
  if (!hasModules || changed.includes("package-lock.json")) {
    say("· instalando dependencias en el servidor (npm ci)…");
    await remote("cd ~/papus/app && npm ci --omit=dev --no-audit --no-fund --no-update-notifier --loglevel=error");
  }
  const active = (await remoteText("systemctl is-active papus || true")) === "active";
  if (opts.restart && active && (changed.length || envChanged)) {
    say("· reiniciando los bots del servidor (se despiden y vuelven)…");
    await remote("sudo systemctl restart papus");
  } else if (!active) say("· los bots del servidor siguen apagados (se encienden con: nube trasladar)");
}

// ---------- trasladar y volver ----------

function pcBotsRunning(): boolean {
  if (!WIN) return false;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*src/main.ts*' }).Count"], { encoding: "utf8" });
  return Number(r.stdout.trim()) > 0;
}

function dataEntries(): TarEntry[] {
  const files = new Map<string, string>();
  for (const e of readdirSync(DATA, { withFileTypes: true })) if (!DATA_SKIP.has(e.name)) walk(path.join(DATA, e.name), `data/${e.name}`, files);
  return [...files].map(([name, abs]) => ({ name, data: readFileSync(abs) }));
}

/** El servidor de prueba debe tener tokens distintos a los reales: si no, los bots se duplicarian en Discord. */
async function assertFakeTokens(): Promise<void> {
  const real = localEnv().DISCORD_TOKEN_TETO ?? "";
  const remoteHash = await remoteText("sed -n 's/^DISCORD_TOKEN_TETO=//p' ~/papus/app/.env | tr -d '\\r\\n' | sha1sum | cut -c1-40");
  if (remoteHash === hashOf(Buffer.from(real))) throw new NubeError("Simulacro cancelado: el .env del servidor tiene los tokens reales.");
}

function pcTasks(enable: boolean): void {
  const verb = enable ? "Enable" : "Disable";
  powershell(PC_TASKS.map((t) => `try { ${verb}-ScheduledTask -TaskName '${t}' -ErrorAction Stop | Out-Null; '${t}: ${enable ? "activada" : "pausada"}' } catch { '${t}: no existe' }`).join("; "));
}

function syncTask(install: boolean): void {
  if (!install) return void powershell(`Unregister-ScheduledTask -TaskName '${SYNC_TASK}' -Confirm:$false -ErrorAction SilentlyContinue; 'Tarea ${SYNC_TASK}: quitada'`, true);
  const vbs = path.join(ROOT, "nube", "sincronizar-oculto.vbs");
  powershell(
    [
      `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"${vbs}"' -WorkingDirectory '${ROOT}'`,
      `$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME`,
      `$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30)`,
      `$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)`,
      `Register-ScheduledTask -TaskName '${SYNC_TASK}' -Action $a -Trigger $t1,$t2 -Settings $s -Description 'Copia al servidor de los bots los datos del motor y los nombres de las carpetas de entrega (nube/nube.ts sincronizar).' -Force | Out-Null`,
      `'Tarea ${SYNC_TASK}: cada 30 min'`,
    ].join("; "),
  );
}

async function trasladar(yes: boolean, simulacro: boolean): Promise<void> {
  if ((await remote("test -f /etc/systemd/system/papus.service && test -d ~/papus/app/node_modules", { allowFail: true })).code !== 0)
    throw new NubeError("El servidor no esta listo: primero nube preparar y nube subir.");
  if (simulacro) await assertFakeTokens();
  await confirm(
    simulacro
      ? "SIMULACRO: copia data/ al servidor y arranca alla (sin tocar el PC). ¿Seguir?"
      : "Los bots del PC se despiden y se apagan, y vuelven desde el servidor en ~1 min. ¿Trasladar?",
    yes,
  );
  if (!simulacro) {
    await subir({ restart: false });
    say("· PC: pausando el arranque automatico y el icono de la bandeja…");
    powershell("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*tray.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }", true);
    pcTasks(false);
    say("· PC: deteniendo los bots (se despiden)…");
    powershell(`& '${path.join(ROOT, "scripts", "stop-bots.ps1")}'`);
    if (pcBotsRunning()) throw new NubeError("Los bots del PC siguen corriendo; no se traslado nada. Revisa y vuelve a intentar.");
  }
  const gz = gzipSync(tar(dataEntries()));
  say(`↑ data/ del PC (${(gz.length / 1048576).toFixed(1)} MB; en el PC queda igual)`);
  const s = stamp();
  await remote(
    `cd ~/papus/app && if [ -e data/papus.sqlite ]; then mv data ~/papus/respaldos/data-${s} && echo "· data/ anterior del servidor: ~/papus/respaldos/data-${s}"; fi; mkdir -p data && tar -xzf -`,
    { input: gz },
  );
  await remote("sudo systemctl enable --now papus");
  if (!simulacro) syncTask(true);
  say("· esperando el arranque…");
  await new Promise((r) => setTimeout(r, 20_000));
  await estado();
  say(simulacro ? "\n✔ Simulacro de traslado listo." : "\n✔ Bots en el servidor. Para volver al PC: nube volver");
}

async function volver(yes: boolean, simulacro: boolean): Promise<void> {
  await confirm(
    simulacro
      ? "SIMULACRO: detiene los bots del servidor y trae data/ a data/nube/simulacro (sin tocar el PC). ¿Seguir?"
      : "Los bots del servidor se despiden y se apagan, y vuelven desde el PC. ¿Volver?",
    yes,
  );
  await remote("sudo systemctl disable --now papus");
  const gz = (await remote("cd ~/papus/app && tar -czf - --exclude=data/bots.log --exclude=data/bots.log.* data", { capture: true })).out;
  const entries = untar(gunzipSync(gz));
  const target = simulacro ? path.join(DATA, "nube", "simulacro") : DATA;
  if (!simulacro) {
    // Respaldo de data/ del PC antes de reemplazarla (data/respaldos/pc-<fecha>).
    const backup = path.join(DATA, "respaldos", `pc-${stamp()}`);
    mkdirSync(backup, { recursive: true });
    for (const e of readdirSync(DATA)) if (!DATA_SKIP.has(e)) cpSync(path.join(DATA, e), path.join(backup, e), { recursive: true });
    say(`· respaldo de data/ del PC: ${path.relative(ROOT, backup)}`);
    // Se borra lo que vino del servidor antes de escribirlo (un -wal viejo del PC junto a otra base la daña).
    for (const e of readdirSync(DATA)) if (!DATA_SKIP.has(e)) rmSync(path.join(DATA, e), { recursive: true, force: true });
  }
  let n = 0;
  for (const e of entries) {
    const rel = safeRelative(e.name);
    if (!rel || !rel.startsWith("data/") || !e.data) continue;
    const out = path.join(target, rel.slice("data/".length));
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, e.data);
    n++;
  }
  say(`↓ data/ del servidor: ${n} archivos en ${path.relative(ROOT, target)}`);
  if (simulacro) return say("\n✔ Simulacro de vuelta listo (el PC no se toco).");
  syncTask(false);
  pcTasks(true);
  powershell("Start-ScheduledTask -TaskName 'Papus Discord'; Start-ScheduledTask -TaskName 'Papus Bandeja' -ErrorAction SilentlyContinue", true);
  say("\n✔ Bots de vuelta en el PC (arrancan en unos segundos). Los datos del servidor quedan alla como respaldo.");
}

// ---------- consultas ----------

async function estado(): Promise<void> {
  await remote(
    [
      `echo "bots: $(systemctl is-active papus); al reiniciar el servidor: $(systemctl is-enabled -q papus 2>/dev/null && echo arrancan solos || echo quedan apagados)"`,
      `echo "memoria: $(free -m | awk '/Mem:/ {printf "%d de %d MB (%d %%)", $3, $2, $3*100/$2}')"`,
      `(command -v ollama >/dev/null && ollama ps | tail -n +2 | awk '{print "modelo cargado: " $1}') || true`,
      `echo "--- registro ---"; tail -n 15 ~/papus/app/data/bots.log 2>/dev/null || echo "(sin registro)"`,
    ].join("; "),
  );
}

async function traer(rel: string): Promise<void> {
  const safe = safeRelative(rel);
  if (!safe) throw new NubeError("Ruta invalida");
  const gz = (await remote(`cd ~/papus/app/data && tar -czf - ${q(safe)}`, { capture: true })).out;
  let n = 0;
  for (const e of untar(gunzipSync(gz))) {
    const r = safeRelative(e.name);
    if (!r || !e.data) continue;
    const out = path.join(DATA, "nube", r);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, e.data);
    n++;
  }
  say(`↓ ${n} archivos en data/nube/${safe}`);
}

async function conectar(args: string[]): Promise<void> {
  const [host, llave] = args;
  if (!host || !llave) throw new NubeError("Uso: nube conectar <ip> <ruta-de-la-llave-privada> [--usuario ubuntu] [--puerto 22]");
  const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d);
  const key = path.resolve(llave);
  if (!existsSync(key)) throw new NubeError(`No existe la llave ${key}`);
  // OpenSSH de Windows rechaza llaves que otros usuarios del PC pueden leer.
  if (WIN) spawnSync("icacls", [key, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:R`], { stdio: "ignore" });
  const c: Conn = { host, usuario: opt("--usuario", "ubuntu"), llave: key, puerto: Number(opt("--puerto", "22")) };
  writeFileSync(CONN_FILE, `${JSON.stringify(c, null, 2)}\n`);
  say(`· probando ${c.usuario}@${c.host}…`);
  say(`✔ conectado: ${await remoteText("echo \"$(uname -m), $(. /etc/os-release && echo $PRETTY_NAME), $(nproc) nucleos, $(free -m | awk '/Mem:/ {print $2}') MB de RAM\"")}`);
}

async function preparar(sinLocal: boolean): Promise<void> {
  const lf = (f: string) => Buffer.from(readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n"));
  const gz = gzipSync(tar([
    { name: "preparar.sh", data: lf("nube/servidor/preparar.sh") },
    { name: "papus-gemma.Modelfile", data: lf("config/ollama/papus-gemma.Modelfile") },
  ]));
  await remote("rm -rf ~/papus/preparar && mkdir -p ~/papus/preparar && tar -xzf - -C ~/papus/preparar", { input: gz });
  await remote(`bash ~/papus/preparar/preparar.sh ${process.versions.node}${sinLocal ? " --sin-local" : ""}`);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const flag = (f: string) => args.includes(f);
  switch (cmd) {
    case "conectar": return conectar(args);
    case "preparar": return preparar(flag("--sin-local"));
    case "subir": return subir({ restart: true });
    case "sincronizar": return sincronizar();
    case "probar": return void (await remote(`cd ~/papus/app && node --disable-warning=ExperimentalWarning --import tsx scripts/check.ts${flag("--llm") ? " --llm" : ""}`));
    case "trasladar": return trasladar(flag("--si"), flag("--simulacro"));
    case "volver": return volver(flag("--si"), flag("--simulacro"));
    case "estado": return estado();
    case "registro": return void (await remote(`tail -n ${Number(args[0]) || 50} ~/papus/app/data/bots.log`));
    case "reiniciar": return void (await remote("sudo systemctl restart papus && echo '✔ reiniciados'"));
    case "detener": return void (await remote("sudo systemctl stop papus && echo '✔ detenidos (vuelven si el servidor se reinicia; para apagarlos del todo: nube volver)'"));
    case "npm":
      if (!args[0]) throw new NubeError("Uso: nube npm <script> [argumentos]");
      return void (await remote(`cd ~/papus/app && npm run -s ${q(args[0])}${args.length > 1 ? ` -- ${args.slice(1).map(q).join(" ")}` : ""}`));
    case "traer": return traer(args[0] ?? "");
    default:
      say(readFileSync(import.meta.filename, "utf8").split("\n").filter((l) => l.startsWith("//   ")).map((l) => l.slice(5)).join("\n"));
  }
}

main().catch((e) => {
  console.error(e instanceof NubeError ? `✘ ${e.message}` : e);
  process.exit(1);
});
