// Rutas de la Actividad de Discord (trivia multijugador) en el worker. La pagina y sus archivos (imagenes, audio) los
// sirve Cloudflare desde worker/public/actividad/ (npm run actividad los arma); aqui solo:
//   GET  /actividad/api/config        id de la app de Teto (para el SDK) y si se aceptan Papus de prueba
//   POST /actividad/api/token         cambia el codigo de autorizacion de Discord por un token (con el secreto de Teto)
//   GET  /actividad/api/sala?instancia=…&canal=…   WebSocket a la sala de esa instancia (Durable Object SalaTrivia)
//   GET  /actividad/api/avatar/<id>/<hash>[?g=1] | /actividad/api/avatar/default/<n>   avatar del Papu
// El secreto de la app nunca llega a la pagina ni a los registros.

export interface ActividadEnv {
  SALAS: DurableObjectNamespace;
  GUILD_ID: string;
  TETO_CLIENT_ID?: string;
  TETO_CLIENT_SECRET?: string;
  ACTIVIDAD_PRUEBA?: string;
}

const PREFIX = "/actividad/api/";

export async function actividad(request: Request, env: ActividadEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/actividad") return Response.redirect(`${url.origin}/actividad/${url.search}`, 301);
  if (!url.pathname.startsWith(PREFIX)) return null;
  const ruta = url.pathname.slice(PREFIX.length);

  if (ruta === "config" && request.method === "GET") {
    return Response.json({ clientId: env.TETO_CLIENT_ID ?? null, prueba: env.ACTIVIDAD_PRUEBA === "1" });
  }

  if (ruta === "token" && request.method === "POST") {
    if (!env.TETO_CLIENT_ID || !env.TETO_CLIENT_SECRET) return Response.json({ error: "La Actividad aún no está configurada (falta el secreto de Teto)." }, { status: 503 });
    const { code } = (await request.json().catch(() => ({}))) as { code?: string };
    if (!code || code.length > 200) return Response.json({ error: "Falta el código" }, { status: 400 });
    const r = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.TETO_CLIENT_ID, client_secret: env.TETO_CLIENT_SECRET, grant_type: "authorization_code", code }),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string };
    if (!r.ok || !j.access_token) return Response.json({ error: "Discord no aceptó el código" }, { status: 401 });
    return Response.json({ access_token: j.access_token });
  }

  if (ruta === "sala") {
    const instancia = url.searchParams.get("instancia") ?? "";
    if (!/^[\w.-]{1,120}$/.test(instancia)) return new Response("Instancia inválida", { status: 400 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Se espera un WebSocket", { status: 426 });
    return env.SALAS.get(env.SALAS.idFromName(instancia)).fetch(request);
  }

  const av = /^avatar\/(?:default\/([0-5])|(\d{5,25})\/(a_)?([0-9a-f]{32}))$/.exec(ruta);
  if (av && request.method === "GET") {
    const [, def, user, , hash] = av;
    const g = url.searchParams.get("g") === "1";
    const src = def
      ? `https://cdn.discordapp.com/embed/avatars/${def}.png`
      : g
        ? `https://cdn.discordapp.com/guilds/${env.GUILD_ID}/users/${user}/avatars/${av[3] ?? ""}${hash}.png?size=64`
        : `https://cdn.discordapp.com/avatars/${user}/${av[3] ?? ""}${hash}.png?size=64`;
    const r = await fetch(src, { cf: { cacheTtl: 86_400, cacheEverything: true } } as RequestInit);
    if (!r.ok) return fetch("https://cdn.discordapp.com/embed/avatars/0.png");
    return new Response(r.body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
  }

  return new Response("No encontrado", { status: 404 });
}
