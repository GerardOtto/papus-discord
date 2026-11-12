-- Esquema mínimo de la plaza preview. No incluye tablas de economía ni de bots.\n-- Tablas de la trivia multijugador. Se mantienen en el D1 de preview y sus aciertos
-- se aplican exclusivamente al ledger mundo_sandbox por el puente aislado.
CREATE TABLE IF NOT EXISTS actividad_perfiles (
  papu_id TEXT PRIMARY KEY, xp_base INTEGER NOT NULL DEFAULT 0,
  tope INTEGER NOT NULL DEFAULT 0, pedido_at INTEGER NOT NULL DEFAULT 0,
  actualizado_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS actividad_aciertos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, partida TEXT NOT NULL, papu_id TEXT NOT NULL,
  pregunta TEXT NOT NULL, dificultad TEXT NOT NULL, racha INTEGER NOT NULL,
  xp_mostrada INTEGER, canal TEXT, creado_at INTEGER NOT NULL,
  aplicado INTEGER NOT NULL DEFAULT 0, xp INTEGER
);
CREATE INDEX IF NOT EXISTS preview_actividad_aciertos_pendientes ON actividad_aciertos (aplicado, id);
CREATE TABLE IF NOT EXISTS mundo_menciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sala TEXT NOT NULL, papu_id TEXT NOT NULL,
  papu_nombre TEXT NOT NULL, texto TEXT NOT NULL, bots TEXT NOT NULL,
  historial TEXT NOT NULL DEFAULT '[]', creado_at INTEGER NOT NULL, tomado INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS preview_mundo_menciones_pendientes ON mundo_menciones (tomado, id);

CREATE TABLE IF NOT EXISTS mundo_respuestas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sala TEXT NOT NULL, mencion_id INTEGER NOT NULL,
  papu_id TEXT NOT NULL, bot TEXT NOT NULL, tipo TEXT NOT NULL, texto TEXT NOT NULL,
  creado_at INTEGER NOT NULL, entregado INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS preview_mundo_respuestas_sala ON mundo_respuestas (sala, entregado, id);

CREATE TABLE IF NOT EXISTS mundo_perfiles (
  papu_id TEXT PRIMARY KEY, nivel INTEGER NOT NULL DEFAULT 1, prestigio INTEGER NOT NULL DEFAULT 0,
  restante INTEGER, limite INTEGER, ruletas INTEGER NOT NULL DEFAULT 0,
  pedido_at INTEGER NOT NULL DEFAULT 0, actualizado_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mundo_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sala TEXT NOT NULL, papu_id TEXT,
  autor TEXT NOT NULL, bot TEXT, texto TEXT NOT NULL, creado_at INTEGER NOT NULL,
  publicado INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS preview_mundo_chat_pendientes ON mundo_chat (publicado, id);

CREATE TABLE IF NOT EXISTS mundo_estado (
  clave TEXT PRIMARY KEY, valor TEXT NOT NULL, actualizado_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mundo_aspectos (
  papu_id TEXT PRIMARY KEY, aspecto TEXT NOT NULL, actualizado_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mundo_acciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sala TEXT NOT NULL, papu_id TEXT NOT NULL,
  papu_nombre TEXT NOT NULL, accion TEXT NOT NULL, datos TEXT NOT NULL DEFAULT 'null',
  ref INTEGER NOT NULL DEFAULT 0, creado_at INTEGER NOT NULL,
  tomado INTEGER NOT NULL DEFAULT 0, resultado TEXT, entregado INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS preview_mundo_acciones_pendientes ON mundo_acciones (tomado, id);
CREATE INDEX IF NOT EXISTS preview_mundo_acciones_listas ON mundo_acciones (sala, tomado, entregado);

CREATE TABLE IF NOT EXISTS mundo_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, papu_id TEXT, tipo TEXT NOT NULL,
  datos TEXT NOT NULL, creado_at INTEGER NOT NULL
);


-- Tarjetas públicas de nivel: imágenes cacheadas en partes pequeñas para transportarlas por D1.
CREATE TABLE IF NOT EXISTS mundo_tarjetas (
  papu_id TEXT PRIMARY KEY, mime TEXT NOT NULL, actualizado_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mundo_tarjeta_partes (
  papu_id TEXT NOT NULL, parte INTEGER NOT NULL, datos TEXT NOT NULL,
  PRIMARY KEY (papu_id, parte)
);
CREATE TABLE IF NOT EXISTS mundo_tarjeta_pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sala TEXT NOT NULL, solicitante_id TEXT NOT NULL,
  papu_id TEXT NOT NULL, ref INTEGER NOT NULL, creado_at INTEGER NOT NULL,
  estado INTEGER NOT NULL DEFAULT 0, entregado INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS preview_mundo_tarjeta_pedidos ON mundo_tarjeta_pedidos (sala, estado, entregado, id);

-- Progreso económico de prueba de cada Papu. No contiene ni escribe datos de producción.
-- Un único documento por usuario permite confirmar cada compra/recompensa con compare-and-swap.
CREATE TABLE IF NOT EXISTS mundo_sandbox (
  papu_id TEXT PRIMARY KEY,
  estado TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  actualizado_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS preview_mundo_sandbox_actualizado ON mundo_sandbox (actualizado_at);
