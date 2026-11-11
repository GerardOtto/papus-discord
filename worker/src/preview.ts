// Worker exclusivo de preview de la plaza. No importa el worker de produccion,
// no expone /interactions de Miku/Luka y no ejecuta tareas programadas.
import { mundo, type MundoApiEnv } from "./mundo/api";

export { SalaMundo } from "./mundo/sala";
export { SalaTrivia } from "./actividad/sala";

export interface PreviewEnv extends MundoApiEnv {}

export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Papus Plaza Preview · entorno aislado", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const response = await mundo(request, env);
    return response ?? new Response("No encontrado", { status: 404 });
  },
};
