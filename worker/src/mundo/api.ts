// Rutas del mundo de los Papus (Actividad 3D) en el worker. La pagina la sirve Cloudflare desde worker/public/mundo/
// (npm run mundo la arma); aqui:
//   GET /mundo/api/sala?instancia=…   WebSocket a la plaza (Durable Object SalaMundo)
//   GET /mundo/api/entrar             navegador: va a Discord a iniciar sesion ("Entrar con Discord")
//   GET /mundo/api/volver             navegador: regreso de Discord; guarda el token en una cookie HttpOnly
//   GET /mundo/api/sesion             navegador: si ya inicio sesion ({ conectado })
//   GET /mundo/api/salir              navegador: borra la sesion
//   /mundo/api/config, /mundo/api/token, /mundo/api/avatar/…   los mismos de la trivia (misma app de Teto)
// El secreto de la app nunca llega a la pagina ni a los registros.
import { actividad, type ActividadEnv } from "../actividad/api";
import type { EstadoMundo } from "../../../src/mundo/estado";
import { validarAspecto } from "./juego";
import type { Aspecto } from "./tipos";
import { COOKIE_ESTADO, COOKIE_TOKEN, cookie, leerCookie, regresoValido, urlAutorizar, urlRegreso } from "./web";

export interface MundoApiEnv extends ActividadEnv {
  MUNDOS: DurableObjectNamespace;
  DB: D1Database;
}

const PREFIX = "/mundo/api/";

export async function mundo(request: Request, env: MundoApiEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/mundo") return Response.redirect(`${url.origin}/mundo/${url.search}`, 301);
  if (!url.pathname.startsWith(PREFIX)) return null;
  const ruta = url.pathname.slice(PREFIX.length);
  const https = url.protocol === "https:";
  const volverAlMundo = (cookies: string[]) => {
    const h = new Headers({ Location: `${url.origin}/mundo/` });
    for (const c of cookies) h.append("Set-Cookie", c);
    return new Response(null, { status: 302, headers: h });
  };

  if (ruta === "sala") {
    const instancia = url.searchParams.get("instancia") ?? "";
    if (!/^[\w.-]{1,120}$/.test(instancia)) return new Response("Instancia inválida", { status: 400 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Se espera un WebSocket", { status: 426 });
    return env.MUNDOS.get(env.MUNDOS.idFromName(instancia)).fetch(request);
  }

  if (ruta === "entrar" && request.method === "GET") {
    if (!env.TETO_CLIENT_ID || !env.TETO_CLIENT_SECRET) return new Response("El mundo aún no está configurado (falta la app de Teto).", { status: 503 });
    const estado = crypto.randomUUID();
    const h = new Headers({ Location: urlAutorizar(env.TETO_CLIENT_ID, url.origin, estado) });
    h.append("Set-Cookie", cookie(COOKIE_ESTADO, estado, { maxAge: 600, https }));
    return new Response(null, { status: 302, headers: h });
  }

  if (ruta === "volver" && request.method === "GET") {
    const borrarEstado = cookie(COOKIE_ESTADO, "", { maxAge: 0, https });
    const codigo = url.searchParams.get("code");
    if (!env.TETO_CLIENT_ID || !env.TETO_CLIENT_SECRET || !regresoValido(codigo, url.searchParams.get("state"), leerCookie(request.headers.get("Cookie"), COOKIE_ESTADO))) {
      return volverAlMundo([borrarEstado]);
    }
    const r = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.TETO_CLIENT_ID, client_secret: env.TETO_CLIENT_SECRET, grant_type: "authorization_code", code: codigo, redirect_uri: urlRegreso(url.origin) }),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) return volverAlMundo([borrarEstado]);
    return volverAlMundo([borrarEstado, cookie(COOKIE_TOKEN, j.access_token, { maxAge: j.expires_in ?? 604_800, https, path: "/" }), cookie(COOKIE_TOKEN, "", { maxAge: 0, https })]);
  }

  if (ruta === "sesion" && request.method === "GET") {
    return Response.json({ conectado: !!leerCookie(request.headers.get("Cookie"), COOKIE_TOKEN), entrar: !!(env.TETO_CLIENT_ID && env.TETO_CLIENT_SECRET) });
  }

  if (ruta === "salir" && request.method === "GET") return volverAlMundo([cookie(COOKIE_TOKEN, "", { maxAge: 0, https, path: "/" }), cookie(COOKIE_TOKEN, "", { maxAge: 0, https })]);

  // Foto del servidor para las zonas (la deja el bot) y el aspecto de los Papus que salen en ella (altar y podios).
  if (ruta === "estado" && request.method === "GET") {
    const fila = await env.DB.prepare("SELECT valor FROM mundo_estado WHERE clave = 'servidor'").first<{ valor: string }>();
    let estado: EstadoMundo | null = null;
    try {
      estado = fila ? (JSON.parse(fila.valor) as EstadoMundo) : null;
    } catch {
      estado = null; // una foto ilegible no rompe la plaza: las zonas quedan como decorado
    }
    const ids = estado ? [...new Set([estado.boda?.papuId, ...estado.fama.map((f) => f.papuId)].filter((x): x is string => !!x))] : [];
    const aspectos: Record<string, Aspecto> = {};
    if (ids.length) {
      const { results } = await env.DB.prepare(`SELECT papu_id, aspecto FROM mundo_aspectos WHERE papu_id IN (${ids.map(() => "?").join(",")})`)
        .bind(...ids)
        .all<{ papu_id: string; aspecto: string }>();
      for (const r of results) {
        const a = validarAspecto(JSON.parse(r.aspecto));
        if (a) aspectos[r.papu_id] = a;
      }
    }
    return Response.json({ estado, aspectos }, { headers: { "Cache-Control": "no-store" } });
  }

  // Lo demas lo atiende la trivia, con la misma ruta bajo /actividad/api/.
  const otra = new URL(`/actividad/api/${ruta}${url.search}`, url.origin);
  return actividad(new Request(otra, request), env);
}
