// Personalizar la tarjeta en la web (pedido de GyroP, 13 nov. 2026: «elegir los cosméticos tocando sus imágenes, no
// memorizando nombres en un menú»). El inventario vive en la base de los bots (la VM), así que el worker solo hace de
// puente:
//   bot  -> POST /tarjeta/api/sesion       (clave)  crea una sesión con lo que el Papu tiene y le da un enlace privado
//   web  -> GET  /tarjeta/api/s/<token>             lo que tiene y lleva puesto
//   web  -> POST /tarjeta/api/s/<token>/pedido      «vista previa» o «guardar» con lo elegido
//   bot  -> GET  /tarjeta/api/pendientes   (clave)  toma los pedidos (los valida: solo lo que de verdad tiene)
//   bot  -> POST /tarjeta/api/resultado    (clave)  la tarjeta dibujada (y, al guardar, lo que quedó puesto)
//   web  -> GET  /tarjeta/api/s/<token>/pedido/<id>[/imagen]  el resultado
// El enlace dura 30 minutos y no pide iniciar sesión: el token (aleatorio, 32 bytes) es la llave. Nada de lo que manda
// la página se aplica sin que el bot compruebe que el Papu tiene cada objeto.
import type { Sql } from "../../../src/cloud/sql";
import { PAGINA } from "./pagina";

export interface TarjetaDeps {
  sql: Sql;
  /** Secreto compartido con el bot (TARJETA_CLAVE). Sin él, la API del bot queda cerrada. */
  clave: string | undefined;
  now?: () => number;
}

export const SESION_MIN = 30;
/** Pedidos por sesión (vista previa + guardar): de sobra para elegir con calma, sin dejar que alguien inunde la cola. */
export const MAX_PEDIDOS = 60;
const RANURAS = ["fondo", "borde", "barra", "nombre", "aro", "titulo"] as const;

export interface Eleccion {
  fondo: string | null;
  borde: string | null;
  barra: string | null;
  nombre: string | null;
  aro: string | null;
  titulo: string | null;
  insignias: string[];
  lado: "izquierda" | "derecha";
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const ID = /^[a-z0-9-]{1,64}$/;

/** Lo que manda la página, limpio (o null si no tiene la forma esperada). */
export function leerEleccion(raw: unknown): Eleccion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out = { lado: r.lado === "derecha" ? "derecha" : "izquierda", insignias: [] as string[] } as Eleccion;
  for (const k of RANURAS) {
    const v = r[k];
    if (v === null || v === undefined || v === "") out[k] = null;
    else if (typeof v === "string" && ID.test(v)) out[k] = v;
    else return null;
  }
  if (r.insignias !== undefined) {
    if (!Array.isArray(r.insignias) || r.insignias.length > 3 || !r.insignias.every((x) => typeof x === "string" && ID.test(x))) return null;
    out.insignias = [...new Set(r.insignias as string[])];
  }
  return out;
}

function token(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Compara la clave sin cortar en el primer carácter distinto. */
function mismaClave(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function tarjeta(request: Request, d: TarjetaDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/tarjeta")) return null;
  const now = d.now?.() ?? Date.now();
  const p = url.pathname.replace(/\/+$/, "");
  if (request.method === "GET" && (p === "/tarjeta" || p === "/tarjeta/index.html")) {
    return new Response(PAGINA, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  }

  // ── lado del bot (con la clave) ──
  if (p === "/tarjeta/api/sesion" || p === "/tarjeta/api/pendientes" || p === "/tarjeta/api/resultado") {
    const dada = request.headers.get("x-papus-clave") ?? "";
    if (!d.clave || !mismaClave(dada, d.clave)) return json({ error: "sin permiso" }, 401);
    if (p === "/tarjeta/api/sesion" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { papu?: string; datos?: unknown } | null;
      if (!body?.papu || !/^\d{15,22}$/.test(body.papu) || !body.datos) return json({ error: "faltan datos" }, 400);
      await d.sql.run("DELETE FROM tarjeta_pedidos WHERE token IN (SELECT token FROM tarjeta_sesiones WHERE vence_at < ?)", now);
      await d.sql.run("DELETE FROM tarjeta_sesiones WHERE vence_at < ?", now);
      const t = token();
      await d.sql.run(
        "INSERT INTO tarjeta_sesiones (token, papu_id, datos, vence_at, creado_at) VALUES (?, ?, ?, ?, ?)",
        t, body.papu, JSON.stringify(body.datos), now + SESION_MIN * 60_000, now,
      );
      return json({ token: t, vence_at: now + SESION_MIN * 60_000 });
    }
    if (p === "/tarjeta/api/pendientes" && request.method === "GET") {
      const rows = await d.sql.all<{ id: number; papu_id: string; tipo: string; datos: string }>(
        "SELECT id, papu_id, tipo, datos FROM tarjeta_pedidos WHERE estado = 'pendiente' ORDER BY id LIMIT 10",
      );
      for (const r of rows) await d.sql.run("UPDATE tarjeta_pedidos SET estado = 'tomado' WHERE id = ? AND estado = 'pendiente'", r.id);
      return json(rows.map((r) => ({ id: r.id, papu: r.papu_id, tipo: r.tipo, eleccion: JSON.parse(r.datos) as Eleccion })));
    }
    if (p === "/tarjeta/api/resultado" && request.method === "POST") {
      const b = (await request.json().catch(() => null)) as { id?: number; ok?: boolean; mensaje?: string; imagen?: string; datos?: unknown } | null;
      if (!b || typeof b.id !== "number") return json({ error: "faltan datos" }, 400);
      const ped = await d.sql.get<{ token: string }>("SELECT token FROM tarjeta_pedidos WHERE id = ?", b.id);
      if (!ped) return json({ error: "no existe" }, 404);
      await d.sql.run(
        "UPDATE tarjeta_pedidos SET estado = ?, mensaje = ?, imagen = ?, hecho_at = ? WHERE id = ?",
        b.ok ? "listo" : "error", (b.mensaje ?? "").slice(0, 300), typeof b.imagen === "string" ? b.imagen : null, now, b.id,
      );
      // Al guardar, la sesión se queda con lo que quedó puesto de verdad.
      if (b.ok && b.datos) await d.sql.run("UPDATE tarjeta_sesiones SET datos = json_patch(datos, ?) WHERE token = ?", JSON.stringify(b.datos), ped.token);
      return json({ ok: true });
    }
    return json({ error: "no encontrado" }, 404);
  }

  // ── lado de la página (con el token del enlace) ──
  const m = /^\/tarjeta\/api\/s\/([A-Za-z0-9_-]{20,64})(?:\/pedido(?:\/(\d+)(\/imagen)?)?)?$/.exec(p);
  if (!m) return json({ error: "no encontrado" }, 404);
  const [, tok, pedidoId, imagen] = m;
  const ses = await d.sql.get<{ papu_id: string; datos: string; vence_at: number }>("SELECT papu_id, datos, vence_at FROM tarjeta_sesiones WHERE token = ?", tok);
  if (!ses || ses.vence_at < now) return json({ error: "El enlace venció. Pide otro con /tienda → Mi tarjeta." }, 410);

  if (!pedidoId && !p.endsWith("/pedido") && request.method === "GET") return json({ ...(JSON.parse(ses.datos) as object), vence_at: ses.vence_at });

  if (p.endsWith("/pedido") && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { tipo?: string; eleccion?: unknown } | null;
    const tipo = body?.tipo === "guardar" ? "guardar" : body?.tipo === "vista" ? "vista" : null;
    const eleccion = leerEleccion(body?.eleccion);
    if (!tipo || !eleccion) return json({ error: "Pedido inválido" }, 400);
    const n = await d.sql.get<{ n: number; abiertos: number }>(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN estado IN ('pendiente', 'tomado') THEN 1 ELSE 0 END) AS abiertos FROM tarjeta_pedidos WHERE token = ?",
      tok,
    );
    if ((n?.abiertos ?? 0) > 0) return json({ error: "Espera a que termine el pedido anterior." }, 429);
    if ((n?.n ?? 0) >= MAX_PEDIDOS) return json({ error: "Muchos pedidos en este enlace. Pide otro con /tienda → Mi tarjeta." }, 429);
    const r = await d.sql.run(
      "INSERT INTO tarjeta_pedidos (token, papu_id, tipo, datos, estado, creado_at) VALUES (?, ?, ?, ?, 'pendiente', ?)",
      tok, ses.papu_id, tipo, JSON.stringify(eleccion), now,
    );
    return json({ id: r.lastRowId });
  }

  if (pedidoId && request.method === "GET") {
    const ped = await d.sql.get<{ estado: string; mensaje: string | null; imagen: string | null }>(
      "SELECT estado, mensaje, imagen FROM tarjeta_pedidos WHERE id = ? AND token = ?",
      Number(pedidoId), tok,
    );
    if (!ped) return json({ error: "no existe" }, 404);
    if (imagen) {
      if (!ped.imagen) return json({ error: "sin imagen" }, 404);
      const bin = Uint8Array.from(atob(ped.imagen), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=600" } });
    }
    return json({ estado: ped.estado, mensaje: ped.mensaje, imagen: !!ped.imagen });
  }
  return json({ error: "no encontrado" }, 404);
}
