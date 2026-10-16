// Lista de pedidos para GyroP: lee la base D1 del worker (Cloudflare) y abre una pagina en el navegador con la cola
// (en orden de llegada) y lo entregado. Incluye los datos completos (para quien es, detalles): el archivo queda solo en
// data/pedidos.html (no se sube al repo). Uso: npm run pedidos (o desde el icono de la bandeja).
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDotEnv } from "../src/config";
import { OCCASIONS, PRODUCTS, STATE_LABEL, type OccasionId, type OrderState, type ProductId } from "../src/orders/queue";

loadDotEnv();
const ROOT = path.resolve(import.meta.dirname, "..");
const TOKEN = process.env.CLOUDFLARE_DEPLOY_TOKEN?.trim();
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const dbId = /database_id = "([^"]+)"/.exec(readFileSync(path.join(ROOT, "worker/wrangler.toml"), "utf8"))?.[1];
if (!TOKEN || !ACCOUNT || !dbId || dbId === "POR_CREAR") throw new Error("Falta desplegar el worker (npm run worker:deploy) o el token en .env");

interface Row {
  id: number;
  origen: string;
  papu_id: string | null;
  comprador: string | null;
  producto: ProductId;
  ocasion: OccasionId;
  para: string;
  pronunciacion: string | null;
  vocaloids: string;
  detalles: string | null;
  fecha_limite: string | null;
  publicar: number;
  estado: OrderState;
  motivo: string | null;
  revisar: string | null;
  creado_at: number;
  plazo_at: number;
  entregado_at: number | null;
}

async function query<T>(sql: string): Promise<T[]> {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${dbId}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const j = (await r.json()) as { success: boolean; result: { results: T[] }[]; errors: { message: string }[] };
  if (!j.success) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.result[0]?.results ?? [];
}

const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const date = (ms: number) => new Date(ms).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" });
const cast = Object.fromEntries((JSON.parse(readFileSync(path.join(ROOT, "worker/src/cast.json"), "utf8")) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

const active = await query<Row>("SELECT * FROM pedidos WHERE estado IN ('en_cola','en_produccion') ORDER BY creado_at, id");
const done = await query<Row>("SELECT * FROM pedidos WHERE estado NOT IN ('en_cola','en_produccion') ORDER BY creado_at DESC LIMIT 30");
const now = Date.now();

function card(o: Row, pos?: number): string {
  const late = o.plazo_at < now && (o.estado === "en_cola" || o.estado === "en_produccion");
  const soon = !late && o.plazo_at - now < 2 * 86_400_000 && (o.estado === "en_cola" || o.estado === "en_produccion");
  const who = o.origen === "tienda" ? `🛍️ Tienda${o.comprador ? ` · ${esc(o.comprador)}` : ""}` : "💥 Triple Baka";
  const voc = (JSON.parse(o.vocaloids) as string[]).map((v) => cast[v] ?? v).join(", ");
  return `<article class="card ${late ? "late" : soon ? "soon" : ""}">
  <header><span class="num">${pos ? `${pos}.` : ""} #${o.id}</span><span class="state ${o.estado}">${STATE_LABEL[o.estado]}</span></header>
  <h2>${esc(OCCASIONS[o.ocasion])} · para <b>${esc(o.para)}</b>${o.pronunciacion ? ` <small>(se pronuncia: ${esc(o.pronunciacion)})</small>` : ""}</h2>
  <p class="meta">${who} · ${esc(PRODUCTS[o.producto].label)} · 🎤 ${esc(voc)}</p>
  ${o.detalles ? `<p class="det">📝 ${esc(o.detalles)}</p>` : ""}
  <p class="meta">📥 ${date(o.creado_at)} · ⏰ a más tardar <b>${date(o.plazo_at)}</b>${late ? " · <b>¡atrasado!</b>" : soon ? " · vence pronto" : ""}${o.fecha_limite ? ` · 📅 pidió para ${esc(o.fecha_limite)}` : ""} · ${o.publicar ? "📣 se puede publicar" : "🔒 no publicar"}</p>
  ${o.revisar ? `<p class="warn">⚠️ Revisar: ${esc(o.revisar)}</p>` : ""}
  ${o.motivo ? `<p class="meta">💬 ${esc(o.motivo)}</p>` : ""}
</article>`;
}

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pedidos de los Papus</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#0f1b1d;--card:#16282b;--ink:#e8f6f4;--muted:#9cc3bf;--miku:#39c5bb;--warn:#f2b544;--late:#e8404a}
body{margin:0;font-family:system-ui,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:860px;margin:0 auto;padding:28px 16px 60px}
h1{margin:0 0 4px;font-size:28px}h1 span{color:var(--miku)}
.sub{color:var(--muted);margin:0 0 24px}
h3{margin:32px 0 12px;color:var(--miku);font-size:16px;letter-spacing:.04em;text-transform:uppercase}
.card{background:var(--card);border:1px solid #23413f;border-left:5px solid var(--miku);border-radius:12px;padding:14px 16px;margin:0 0 12px}
.card.soon{border-left-color:var(--warn)}.card.late{border-left-color:var(--late)}
.card header{display:flex;justify-content:space-between;color:var(--muted);font-size:13px}
.num{font-weight:700;color:var(--miku)}
.card h2{font-size:18px;margin:6px 0}
.meta{color:var(--muted);font-size:13px;margin:6px 0}
.det{margin:8px 0;line-height:1.45}
.warn{color:var(--warn);font-weight:600;margin:6px 0}
.empty{color:var(--muted);font-style:italic}
</style></head><body><main>
<h1>🎁 Pedidos de <span>videos personalizados</span></h1>
<p class="sub">Actualizado el ${new Date().toLocaleString("es-CL")} · ${active.length} en la cola · por orden de llegada. Cambia el estado con <code>/cola estado</code> en Discord.</p>
<h3>En la cola</h3>
${active.length ? active.map((o, i) => card(o, i + 1)).join("\n") : '<p class="empty">La cola está vacía ✨</p>'}
<h3>Últimos entregados, rechazados o cancelados</h3>
${done.length ? done.map((o) => card(o)).join("\n") : '<p class="empty">Todavía no hay.</p>'}
</main></body></html>`;

const out = path.join(ROOT, "data", "pedidos.html");
writeFileSync(out, html);
console.log(`Lista de pedidos: ${out}`);
execFile("cmd", ["/c", "start", "", out], { windowsHide: true });
