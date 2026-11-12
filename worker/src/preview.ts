// Worker exclusivo de preview de la plaza. No importa el worker de produccion,
 // no expone /interactions de Miku/Luka y no ejecuta tareas programadas.
import { actividad } from "./actividad/api";
import { mundo, type MundoApiEnv } from "./mundo/api";

export { SalaMundo } from "./mundo/sala";
export { SalaTrivia } from "./actividad/sala";

export interface PreviewEnv extends MundoApiEnv {}

export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const url = new URL(request.url);
    // La interfaz 3D se publica como asset estático en /mundo/.
    // No responder aquí con texto: eso interceptaba "/" antes de llegar a los assets.
    if (request.method === "GET" && url.pathname === "/") {
      return Response.redirect(new URL("/mundo/", url.origin), 302);
    }
    if (url.pathname.startsWith("/actividad/api/")) {
      const response = await actividad(request, env);
      return response ?? new Response("No encontrado", { status: 404 });
    }
    const response = await mundo(request, env);
    return response ?? new Response("No encontrado", { status: 404 });
  },
};
