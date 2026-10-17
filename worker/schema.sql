-- Base D1 del worker (Cloudflare). Se aplica en cada despliegue: solo crea lo que falta.
CREATE TABLE IF NOT EXISTS pedidos (
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
CREATE INDEX IF NOT EXISTS pedidos_estado ON pedidos (estado, creado_at);
CREATE INDEX IF NOT EXISTS pedidos_papu ON pedidos (papu_id, origen, creado_at);

CREATE TABLE IF NOT EXISTS tips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  papu_id     TEXT NOT NULL,
  texto       TEXT NOT NULL,
  fuente      TEXT NOT NULL,
  message_id  TEXT,
  usado_video TEXT,
  usado_at    INTEGER,
  creado_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS votaciones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  canal      TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  pregunta   TEXT NOT NULL,
  opciones   TEXT NOT NULL,
  ends_at    INTEGER NOT NULL,
  recordado  INTEGER NOT NULL DEFAULT 0,
  cerrada    INTEGER NOT NULL DEFAULT 0,
  ganador    TEXT,
  creado_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  deck_key   TEXT PRIMARY KEY,
  order_json TEXT NOT NULL,
  pos        INTEGER NOT NULL,
  size       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Votacion semanal (config/votaciones.json). estado del candidato: espera | en_votacion | sigue (segundo lugar, vuelve
-- a la ronda siguiente) | ganador | descartado | quitado.
CREATE TABLE IF NOT EXISTS candidatos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  estado    TEXT NOT NULL DEFAULT 'espera',
  creado_at INTEGER NOT NULL
);

-- estado de la ronda: abierta | desempate (empate por el primer lugar: decide GyroP) | cerrada.
CREATE TABLE IF NOT EXISTS rondas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  votacion_id INTEGER NOT NULL,
  opciones    TEXT NOT NULL,
  estado      TEXT NOT NULL,
  votos       TEXT,
  empate      TEXT,
  ganador     TEXT,
  segundo     TEXT,
  abierta_at  INTEGER NOT NULL
);

-- Votacion de los Papus de honor (config/votaciones.json -> honor). Videos que GyroP tiene listos para subir:
-- estado espera | en_votacion | ganador | quitado. Las ideas de #charla-de-honor ya usadas quedan en kv (idea_usada:<id>).
CREATE TABLE IF NOT EXISTS listos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  estado    TEXT NOT NULL DEFAULT 'espera',
  creado_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rondas_honor (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  votacion_id INTEGER NOT NULL,
  opciones    TEXT NOT NULL,
  estado      TEXT NOT NULL,
  ganador     TEXT,
  abierta_at  INTEGER NOT NULL
);
