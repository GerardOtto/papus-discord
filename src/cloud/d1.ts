// Lectura de la base D1 del worker (Cloudflare) desde el PC: votaciones, candidatos y videos listos para el
// calendario. Usa CLOUDFLARE_DEPLOY_TOKEN (permiso D1) del .env; el token nunca se registra.
import { readFileSync } from "node:fs";
import path from "node:path";

export type D1Query = <T>(sql: string, ...params: unknown[]) => Promise<T[]>;

export function d1Client(opts: { accountId: string; token: string; databaseId: string; fetchFn?: typeof fetch }): D1Query {
  const fetchFn = opts.fetchFn ?? fetch;
  return async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
    const r = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/d1/database/${opts.databaseId}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json()) as { success: boolean; result?: { results: T[] }[]; errors?: { message: string }[] };
    if (!j.success) throw new Error(`D1: ${(j.errors ?? []).map((e) => e.message).join("; ") || r.status}`);
    return j.result?.[0]?.results ?? [];
  };
}

/** Id de la base desde worker/wrangler.toml (null si el worker no está desplegado). */
export function workerDatabaseId(root: string): string | null {
  try {
    const id = /database_id = "([^"]+)"/.exec(readFileSync(path.join(root, "worker/wrangler.toml"), "utf8"))?.[1];
    return id && id !== "POR_CREAR" ? id : null;
  } catch {
    return null;
  }
}
