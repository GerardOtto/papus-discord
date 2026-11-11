// Worker de Cloudflare: recibe las interacciones de Miku y Luka (comandos de barra), corre tareas cada 15 min y aloja
// la trivia multijugador (Actividad de Discord de Teto, /actividad/) y el prototipo del mundo 3D de los Papus (/mundo/).
// Funciona 24/7, aunque el PC de GyroP este apagado. Despliegue: npm run worker:deploy.
import cast from "./cast.json";
import { actividad } from "./actividad/api";
import { mundo } from "./mundo/api";
import { PapusWorker } from "./app";
import { restApi, verifySignature, type BotKey } from "./discord";
import type { Sql } from "../../src/orders/sql";

// Durable Object de la trivia multijugador (Actividad de Discord): una sala por instancia.
export { SalaTrivia } from "./actividad/sala";
// Prototipo del mundo 3D de los Papus: una plaza por instancia.
export { SalaMundo } from "./mundo/sala";

export interface Env {
  DB: D1Database;
  GUILD_ID: string;
  OWNER_ID: string;
  MIKU_TOKEN: string;
  LUKA_TOKEN: string;
  MIKU_PUBLIC_KEY: string;
  LUKA_PUBLIC_KEY: string;
  MIKU_COLOR: string;
  LUKA_COLOR: string;
  /** Trivia multijugador (Actividad de Discord de Teto): salas, id y secreto de la app de Teto. */
  SALAS: DurableObjectNamespace;
  /** Prototipo del mundo 3D: una plaza por instancia. */
  MUNDOS: DurableObjectNamespace;
  TETO_CLIENT_ID?: string;
  TETO_CLIENT_SECRET?: string;
  /** "1" solo en `wrangler dev`: deja entrar Papus de prueba sin Discord. */
  ACTIVIDAD_PRUEBA?: string;
}

function d1Sql(db: D1Database): Sql {
  return {
    get: async <T>(sql: string, ...args: unknown[]) => ((await db.prepare(sql).bind(...args).first<T>()) ?? undefined) as T | undefined,
    all: async <T>(sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<T>()).results,
    run: async (sql: string, ...args: unknown[]) => {
      const r = await db.prepare(sql).bind(...args).run();
      return { lastRowId: Number(r.meta.last_row_id ?? 0), changes: Number(r.meta.changes ?? 0) };
    },
  };
}

function worker(env: Env): PapusWorker {
  return new PapusWorker({
    sql: d1Sql(env.DB),
    discord: restApi({ miku: env.MIKU_TOKEN, luka: env.LUKA_TOKEN }),
    guildId: env.GUILD_ID,
    ownerId: env.OWNER_ID,
    cast,
    colors: { miku: Number(env.MIKU_COLOR), luka: Number(env.LUKA_COLOR) },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("Papus bots: en línea ✨");
    const act = (await mundo(request, env)) ?? (await actividad(request, env));
    if (act) return act;
    const m = /^\/interactions\/(miku|luka)$/.exec(url.pathname);
    if (request.method !== "POST" || !m) return new Response("No encontrado", { status: 404 });
    const bot = m[1] as BotKey;
    const body = await request.text();
    const ok = await verifySignature(
      bot === "miku" ? env.MIKU_PUBLIC_KEY : env.LUKA_PUBLIC_KEY,
      request.headers.get("x-signature-ed25519") ?? "",
      request.headers.get("x-signature-timestamp") ?? "",
      body,
    );
    if (!ok) return new Response("Firma inválida", { status: 401 });
    const { response, work } = worker(env).handle(bot, JSON.parse(body));
    if (work) ctx.waitUntil(work());
    return Response.json(response);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(worker(env).cron());
  },
};
