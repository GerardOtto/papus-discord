// Piezas puras del traslado a la nube (nube/nube.ts): empaquetado tar, .env del servidor, manifiesto de archivos y
// lista de datos del motor. Sin red ni procesos, para poder probarlas (tests/nube.test.ts).
import { createHash } from "node:crypto";

// ---------- tar (POSIX/pax, nombres en UTF-8) ----------
// El tar.exe de Windows guarda mal los nombres con tildes o "¿" (carpetas del escritorio); este los guarda bien y el
// tar de Linux los lee sin opciones extra.

export interface TarEntry {
  /** Ruta con "/" (sin "/" inicial). */
  name: string;
  /** Contenido; sin contenido es una carpeta. */
  data?: Buffer;
  mtime?: number;
}

const BLOCK = 512;

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, "0") + "\0";
}

function header(name: string, size: number, type: "0" | "5" | "x", mtime: number): Buffer {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, "utf8");
  h.write(octal(type === "5" ? 0o755 : 0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(Math.floor(mtime / 1000), 12), 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write(type, 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + " ", 148, "ascii");
  return h;
}

function pad(len: number): Buffer {
  return Buffer.alloc((BLOCK - (len % BLOCK)) % BLOCK);
}

/** Registro pax "len path=valor\n" (len cuenta su propio largo). */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (Buffer.byteLength(`${len}${body}`) !== len) len++;
  return Buffer.from(`${len}${body}`, "utf8");
}

export function tar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const isDir = e.data === undefined;
    const name = isDir && !e.name.endsWith("/") ? `${e.name}/` : e.name;
    const mtime = e.mtime ?? Date.now();
    // Nombre largo o no ASCII: va completo en un encabezado pax; el ustar lleva una version recortada.
    if (Buffer.byteLength(name) > 99 || /[^\x20-\x7e]/.test(name)) {
      const rec = paxRecord("path", name);
      parts.push(header("PaxHeader", rec.length, "x", mtime), rec, pad(rec.length));
    }
    const short = name.replace(/[^\x20-\x7e]/g, "_").slice(-99);
    const size = e.data?.length ?? 0;
    parts.push(header(short, size, isDir ? "5" : "0", mtime));
    if (e.data) parts.push(e.data, pad(e.data.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

/** Lee un tar (ustar, pax o GNU de Linux): archivos y carpetas con su ruta completa. */
export function untar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let off = 0;
  let nextName: string | null = null;
  const str = (b: Buffer) => b.toString("utf8").replace(/\0.*$/s, "");
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || "0", 8);
    const type = String.fromCharCode(h[156]!) || "0";
    const prefix = h.subarray(257, 262).toString("ascii") === "ustar" ? str(h.subarray(345, 500)) : "";
    const raw = str(h.subarray(0, 100));
    const data = buf.subarray(off + BLOCK, off + BLOCK + size);
    off += BLOCK + size + ((BLOCK - (size % BLOCK)) % BLOCK);
    if (type === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      if (m) nextName = m[1]!;
      continue;
    }
    if (type === "L") {
      nextName = str(data);
      continue;
    }
    if (type === "g") continue;
    const name = (nextName ?? (prefix ? `${prefix}/${raw}` : raw)).replace(/^\.\//, "");
    nextName = null;
    if (!name || name === ".") continue;
    if (type === "5") out.push({ name: name.replace(/\/$/, "") });
    else if (type === "0" || type === "\0") out.push({ name, data: Buffer.from(data) });
  }
  return out;
}

/** Ruta segura para extraer: sin "..", sin raiz absoluta. */
export function safeRelative(name: string): string | null {
  const parts = name.split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts.some((p) => p === ".." || /[:\\]/.test(p))) return null;
  return parts.join("/");
}

// ---------- .env del servidor ----------

/** Copia el .env cambiando (o agregando) algunas variables; el resto queda igual, comentarios incluidos. */
export function rewriteEnv(text: string, overrides: Record<string, string>): string {
  const pending = new Map(Object.entries(overrides));
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m || !pending.has(m[1]!)) return line;
    const v = pending.get(m[1]!)!;
    pending.delete(m[1]!);
    return `${m[1]}=${v}`;
  });
  while (lines.length && lines.at(-1) === "") lines.pop();
  for (const [k, v] of pending) lines.push(`${k}=${v}`);
  return `${lines.join("\n")}\n`;
}

// ---------- manifiesto (subir solo lo que cambio) ----------

export type Manifest = Record<string, string>;

export function hashOf(data: Buffer): string {
  return createHash("sha1").update(data).digest("hex");
}

export function diffManifest(local: Manifest, remote: Manifest): { changed: string[]; removed: string[] } {
  return {
    changed: Object.keys(local).filter((f) => remote[f] !== local[f]).sort(),
    removed: Object.keys(remote).filter((f) => !(f in local)).sort(),
  };
}

// ---------- datos del motor ----------

/**
 * Rutas del motor que se copian al servidor: las de config/engine-paths.json sin plantilla ({id}, {episodeId}).
 * Las de plantilla (avatares por emocion, carpetas de episodios) pesan mas de 2 GB y el bot no las usa al correr.
 */
export function engineSyncPaths(enginePaths: { engine: Record<string, { path: string }> }): string[] {
  return [...new Set(Object.values(enginePaths.engine).map((e) => e.path).filter((p) => !p.includes("{")))].sort();
}

/** Carpetas de entrega del escritorio (config/engine-paths.json -> delivery), relativas a DELIVERY_DIR. */
export function deliveryPaths(enginePaths: { delivery: Record<string, unknown> }): string[] {
  return Object.entries(enginePaths.delivery)
    .filter(([k, v]) => !k.startsWith("$") && typeof v === "object" && v && "path" in v)
    .map(([, v]) => (v as { path: string }).path.replace(/\/+$/, ""));
}
