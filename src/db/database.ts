// Base de datos del bot: un archivo SQLite (node:sqlite, sin dependencias nativas).
// Guarda cuotas, strikes, estado de los mazos de frases y registros de uso. Nunca guarda tokens.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Cada migracion se aplica una sola vez, en orden. Para cambiar el esquema se AGREGA una nueva; nunca se edita una vieja.
const MIGRATIONS: string[] = [
  `CREATE TABLE quota_usage (
     user_id TEXT NOT NULL,
     day     TEXT NOT NULL,
     used    INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );
   CREATE TABLE decks (
     deck_key TEXT PRIMARY KEY,
     order_json TEXT NOT NULL,
     pos      INTEGER NOT NULL,
     size     INTEGER NOT NULL
   );
   CREATE TABLE strikes (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id    TEXT NOT NULL,
     reason     TEXT NOT NULL,
     excerpt    TEXT,
     channel_id TEXT,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX strikes_user ON strikes (user_id, expires_at);
   CREATE TABLE llm_usage (
     provider TEXT NOT NULL,
     day      TEXT NOT NULL,
     ok       INTEGER NOT NULL DEFAULT 0,
     failed   INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (provider, day)
   );
   CREATE TABLE kv (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  // 2: cola de videos personalizados (Triple Baka y tienda de Ko-fi). Los datos del pedido nunca van a un LLM.
  `CREATE TABLE pedidos (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     origen        TEXT NOT NULL,
     papu_id       TEXT,
     comprador     TEXT,
     producto      TEXT NOT NULL,
     ocasion       TEXT NOT NULL,
     para          TEXT NOT NULL,
     pronunciacion TEXT,
     vocaloids     TEXT NOT NULL,
     detalles      TEXT,
     fecha_limite  TEXT,
     publicar      INTEGER NOT NULL DEFAULT 0,
     estado        TEXT NOT NULL,
     motivo        TEXT,
     revisar       TEXT,
     creado_at     INTEGER NOT NULL,
     plazo_at      INTEGER NOT NULL,
     entregado_at  INTEGER
   );
   CREATE INDEX pedidos_estado ON pedidos (estado, creado_at);
   CREATE INDEX pedidos_papu ON pedidos (papu_id, origen, creado_at);`,
];

export type Db = DatabaseSync;

/** Abre (o crea) la base y aplica las migraciones pendientes. `file` = ":memory:" para tests. */
export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function kvGet(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

export function kvDelete(db: Db, key: string): void {
  db.prepare("DELETE FROM kv WHERE key = ?").run(key);
}
