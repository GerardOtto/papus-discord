// Entrada al mundo por el navegador (fuera de Discord): "Entrar con Discord" con OAuth2. Funciones puras (sin tipos de
// Cloudflare) para el enlace de autorizacion y las cookies. El token de Discord queda en una cookie HttpOnly de /mundo:
// la pagina nunca lo ve; la sala lo lee al abrir el WebSocket y comprueba con Discord quien es (y que es del servidor).

/** Cookie con el token de Discord del Papu. */
export const COOKIE_TOKEN = "mundo_token";
/** Cookie con el `state` del OAuth (contra CSRF: el regreso debe traer el mismo). */
export const COOKIE_ESTADO = "mundo_estado";
/** Permisos: quien es y su ficha en el servidor de los Papus (los mismos que la Actividad). */
export const SCOPES = ["identify", "guilds.members.read"] as const;

/** Valor de una cookie en el encabezado Cookie, o null. */
export function leerCookie(header: string | null, nombre: string): string | null {
  if (!header) return null;
  for (const parte of header.split(";")) {
    const i = parte.indexOf("=");
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) {
      const v = parte.slice(i + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

/** Encabezado Set-Cookie de /mundo (HttpOnly, SameSite=Lax; Secure si el sitio es https). maxAge 0 = borrarla. */
export function cookie(nombre: string, valor: string, opts: { maxAge: number; https: boolean; path?: string }): string {
  return [`${nombre}=${encodeURIComponent(valor)}`, `Path=${opts.path ?? "/mundo"}`, "HttpOnly", "SameSite=Lax", `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`, ...(opts.https ? ["Secure"] : [])].join("; ");
}

/** Direccion de regreso del OAuth (hay que registrarla en el portal de Discord, en OAuth2 > Redirects). */
export function urlRegreso(origen: string): string {
  return `${origen}/mundo/api/volver`;
}

/** Pagina de Discord donde el Papu acepta entrar. */
export function urlAutorizar(clientId: string, origen: string, estado: string): string {
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: urlRegreso(origen), scope: SCOPES.join(" "), state: estado });
  return `https://discord.com/oauth2/authorize?${q}`;
}

/** El regreso es valido: trae codigo y el mismo `state` que se guardo al salir (largo razonable, sin basura). */
export function regresoValido(codigo: string | null, estado: string | null, guardado: string | null): codigo is string {
  return !!codigo && codigo.length <= 200 && !!estado && estado.length <= 100 && estado === guardado;
}
