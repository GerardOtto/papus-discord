-- Migración aditiva: restaura el transporte de tarjetas públicas de la Plaza.
-- Las imágenes se regeneran desde LevelsDiscord.publicCard; no se migran saldos ni progreso.
CREATE TABLE IF NOT EXISTS mundo_tarjetas (
  papu_id        TEXT PRIMARY KEY,
  mime           TEXT NOT NULL,
  actualizado_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mundo_tarjeta_partes (
  papu_id TEXT NOT NULL,
  parte   INTEGER NOT NULL,
  datos   TEXT NOT NULL,
  PRIMARY KEY (papu_id, parte)
);
CREATE TABLE IF NOT EXISTS mundo_tarjeta_pedidos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sala           TEXT NOT NULL,
  solicitante_id TEXT NOT NULL,
  papu_id        TEXT NOT NULL,
  ref            INTEGER NOT NULL,
  creado_at      INTEGER NOT NULL,
  estado         INTEGER NOT NULL DEFAULT 0,
  entregado      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mundo_tarjeta_pedidos_pendientes ON mundo_tarjeta_pedidos (estado, creado_at);
CREATE INDEX IF NOT EXISTS mundo_tarjeta_pedidos_sala ON mundo_tarjeta_pedidos (sala, entregado, estado, id);
