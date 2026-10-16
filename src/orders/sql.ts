// Acceso a SQL comun para la base local (node:sqlite, en el PC) y D1 (Cloudflare, donde vive la cola 24/7).
import type { Db } from "../db/database";

export interface Sql {
  get<T>(sql: string, ...args: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...args: unknown[]): Promise<T[]>;
  run(sql: string, ...args: unknown[]): Promise<{ lastRowId: number; changes: number }>;
}

type SqlArg = null | number | bigint | string;

/** Adaptador para la base local (pruebas y herramientas del PC). */
export function sqliteSql(db: Db): Sql {
  return {
    get: async <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...(args as SqlArg[])) as T | undefined,
    all: async <T>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as SqlArg[])) as unknown as T[],
    run: async (sql: string, ...args: unknown[]) => {
      const r = db.prepare(sql).run(...(args as SqlArg[]));
      return { lastRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
  };
}
