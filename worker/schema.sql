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

-- Estrenos anunciados con /estreno: el bot del PC los lee y abre la XP multiplicada desde "at" (config/niveles.json).
CREATE TABLE IF NOT EXISTS estrenos (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rondas_honor (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  votacion_id INTEGER NOT NULL,
  opciones    TEXT NOT NULL,
  estado      TEXT NOT NULL,
  ganador     TEXT,
  abierta_at  INTEGER NOT NULL
);

-- Trivia multijugador (Actividad de Discord de Teto, PLAN §3.4). La sala pide el perfil del Papu al entrar (pedido_at);
-- Teto (src/trivia/actividad.ts) calcula su XP base por acierto y lo que le queda del tope del dia de la trivia, y lo
-- deja aqui (actualizado_at). Cada acierto de una partida queda en actividad_aciertos hasta que Teto le da su XP
-- (aplicado = 1, xp = la que dio de verdad; xp_mostrada = la que vio el Papu en la Actividad).
CREATE TABLE IF NOT EXISTS actividad_perfiles (
  papu_id        TEXT PRIMARY KEY,
  xp_base        INTEGER NOT NULL DEFAULT 0,
  tope           INTEGER NOT NULL DEFAULT 0,
  pedido_at      INTEGER NOT NULL DEFAULT 0,
  actualizado_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actividad_aciertos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  partida     TEXT NOT NULL,
  papu_id     TEXT NOT NULL,
  pregunta    TEXT NOT NULL,
  dificultad  TEXT NOT NULL,
  racha       INTEGER NOT NULL,
  xp_mostrada INTEGER,
  canal       TEXT,
  creado_at   INTEGER NOT NULL,
  aplicado    INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER
);
CREATE INDEX IF NOT EXISTS actividad_aciertos_pendientes ON actividad_aciertos (aplicado, id);

-- Mundo de los Papus (prototipo de Actividad 3D, /mundo/). Un @ a un Vocaloid de la plaza queda en mundo_menciones
-- (con las ultimas lineas del chat de esa plaza como historial); el bot (src/mundo/puente.ts) lo toma (tomado = 1), lo
-- responde con la misma cuota, cola y LLM que en Discord y deja en mundo_respuestas lo que dice cada Vocaloid
-- (texto, "escribiendo" o una reaccion); al terminar marca tomado = 2. La sala entrega las respuestas (entregado = 1).
-- mundo_perfiles: nivel y cuota del dia de cada Papu para mostrarlos en la plaza (la sala los pide al entrar).
CREATE TABLE IF NOT EXISTS mundo_menciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sala        TEXT NOT NULL,
  papu_id     TEXT NOT NULL,
  papu_nombre TEXT NOT NULL,
  texto       TEXT NOT NULL,
  bots        TEXT NOT NULL,
  historial   TEXT NOT NULL DEFAULT '[]',
  creado_at   INTEGER NOT NULL,
  tomado      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mundo_menciones_pendientes ON mundo_menciones (tomado, id);

CREATE TABLE IF NOT EXISTS mundo_respuestas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sala       TEXT NOT NULL,
  mencion_id INTEGER NOT NULL,
  papu_id    TEXT NOT NULL,
  bot        TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  texto      TEXT NOT NULL,
  creado_at  INTEGER NOT NULL,
  entregado  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mundo_respuestas_sala ON mundo_respuestas (sala, entregado, id);

CREATE TABLE IF NOT EXISTS mundo_perfiles (
  papu_id        TEXT PRIMARY KEY,
  nivel          INTEGER NOT NULL DEFAULT 1,
  prestigio      INTEGER NOT NULL DEFAULT 0,
  restante       INTEGER,
  limite         INTEGER,
  ruletas        INTEGER NOT NULL DEFAULT 0,
  pedido_at      INTEGER NOT NULL DEFAULT 0,
  actualizado_at INTEGER NOT NULL DEFAULT 0
);

-- Registro del chat de la plaza en Discord (#plaza-papus, solo lectura: decision de GyroP, 9 nov. 2026). La sala deja
-- cada mensaje publicado (de un Papu o la respuesta de un Vocaloid) y el bot los publica en grupos (publicado = 1).
CREATE TABLE IF NOT EXISTS mundo_chat (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sala       TEXT NOT NULL,
  papu_id    TEXT,
  autor      TEXT NOT NULL,
  bot        TEXT,
  texto      TEXT NOT NULL,
  creado_at  INTEGER NOT NULL,
  publicado  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mundo_chat_pendientes ON mundo_chat (publicado, id);

-- Foto del servidor para las zonas de la plaza (boda, pelea, mercado, fama, sorteo): la deja el bot cada minuto si
-- cambio (src/mundo/estado.ts). mundo_aspectos: como se ve el Papu de cada uno en la plaza (para el altar y los podios).
CREATE TABLE IF NOT EXISTS mundo_estado (
  clave          TEXT PRIMARY KEY,
  valor          TEXT NOT NULL,
  actualizado_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mundo_aspectos (
  papu_id        TEXT PRIMARY KEY,
  aspecto        TEXT NOT NULL,
  actualizado_at INTEGER NOT NULL
);

-- Acciones de la plaza que ejecuta el bot con las reglas de Discord (/ruleta…; worker/src/mundo/acciones.ts): la sala
-- las deja (tomado 0), el bot las toma (1) y deja el resultado (2, JSON {ok, datos | motivo}); la sala lo entrega al
-- Papu (entregado 1). `ref` = numero que puso la pagina para reconocer el resultado.
CREATE TABLE IF NOT EXISTS mundo_acciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sala        TEXT NOT NULL,
  papu_id     TEXT NOT NULL,
  papu_nombre TEXT NOT NULL,
  accion      TEXT NOT NULL,
  datos       TEXT NOT NULL DEFAULT 'null',
  ref         INTEGER NOT NULL DEFAULT 0,
  creado_at   INTEGER NOT NULL,
  tomado      INTEGER NOT NULL DEFAULT 0,
  resultado   TEXT,
  entregado   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mundo_acciones_pendientes ON mundo_acciones (tomado, id);
CREATE INDEX IF NOT EXISTS mundo_acciones_listas ON mundo_acciones (sala, tomado, entregado);

-- Lo que pasa en Discord y la plaza muestra (decision de GyroP, 9 nov. 2026): giros de la ruleta (todas las plazas lo
-- ven) y avisos para un Papu ("ya tienes una tirada"; papu_id). Lo deja el bot; cada plaza lee los nuevos por id y
-- deja pasar los viejos. El bot borra los de mas de un dia.
CREATE TABLE IF NOT EXISTS mundo_eventos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  papu_id    TEXT,
  tipo       TEXT NOT NULL,
  datos      TEXT NOT NULL,
  creado_at  INTEGER NOT NULL
);
