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
  // 3: niveles por participacion (src/levels/). xp = la del prestigio actual; xp_dia sirve para quitar la de un dia
  // con strike. La tarjeta (frase, color, fondo) la elegía cada Papu con /tarjeta (hoy, en la web).
  `CREATE TABLE niveles (
     user_id    TEXT PRIMARY KEY,
     xp         INTEGER NOT NULL DEFAULT 0,
     prestigio  INTEGER NOT NULL DEFAULT 0,
     veterano   INTEGER NOT NULL DEFAULT 0,
     apodo      INTEGER NOT NULL DEFAULT 0,
     apodo_base TEXT,
     frase      TEXT,
     color      TEXT,
     fondo      TEXT
   );
   CREATE TABLE xp_dia (
     user_id TEXT NOT NULL,
     day     TEXT NOT NULL,
     xp      INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );`,
  // 4: bodas con las Vocaloids (src/bodas/). Una fila por boda; rol_quitado = Teto ya borro el rol al vencer.
  `CREATE TABLE bodas (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     bot         TEXT NOT NULL,
     user_id     TEXT NOT NULL,
     nombre      TEXT NOT NULL,
     inicio      INTEGER NOT NULL,
     fin         INTEGER NOT NULL,
     xp          INTEGER NOT NULL DEFAULT 0,
     rol_quitado INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX bodas_fin ON bodas (fin);
   CREATE INDEX bodas_papu ON bodas (user_id, bot, inicio);`,
  // 5: divorcio (src/bodas/): cuando el Papu deja a la Vocaloid antes de las 24 h (fin pasa a ese momento).
  `ALTER TABLE bodas ADD COLUMN divorcio INTEGER;`,
  // 6: minutos con XP de voz del dia (tope diario, config/niveles.json voz.maximoMinutosDia).
  `ALTER TABLE xp_dia ADD COLUMN voz_min INTEGER NOT NULL DEFAULT 0;`,
  // 7: ruleta (src/ruleta/). Misiones del dia en xp_dia (mensajes con XP, si subio de nivel, si tuvo strike), mensajes
  // extra de la cuota ganados en la ruleta (solo ese dia) y una fila por tirada.
  `ALTER TABLE xp_dia ADD COLUMN mensajes INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE xp_dia ADD COLUMN subio INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE xp_dia ADD COLUMN castigo INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE quota_usage ADD COLUMN extra INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE ruleta (
     id      INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL,
     day     TEXT NOT NULL,
     premio  INTEGER NOT NULL,
     detalle TEXT NOT NULL,
     at      INTEGER NOT NULL
   );
   CREATE INDEX ruleta_papu ON ruleta (user_id, day);`,
  // 8: trivia (src/trivia/). XP y aciertos de la trivia por dia (la XP de la trivia no cuenta para medir cuanto crece
  // un Papu), preguntas que ya vio cada Papu (primero salen las nuevas) y una fila por partida (racha y XP).
  `ALTER TABLE xp_dia ADD COLUMN trivia INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE xp_dia ADD COLUMN trivia_aciertos INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE trivia_vistas (
     user_id  TEXT NOT NULL,
     pregunta TEXT NOT NULL,
     PRIMARY KEY (user_id, pregunta)
   );
   CREATE TABLE trivia_partidas (
     id      INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL,
     day     TEXT NOT NULL,
     racha   INTEGER NOT NULL,
     xp      INTEGER NOT NULL,
     fin     TEXT NOT NULL,
     at      INTEGER NOT NULL
   );
   CREATE INDEX trivia_partidas_papu ON trivia_partidas (user_id);`,
  // 9: sorteo (src/sorteo/). Una fila por premio entregado (ganador final, premio, giros y descartados).
  `CREATE TABLE sorteos (
     id      INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL,
     detalle TEXT NOT NULL,
     at      INTEGER NOT NULL
   );`,
  // 10: Shaulitas (src/coins/, PLAN §3.6). Monedero (dos bolsillos, Ecos, sobres gratis y garantías), lo ganado
  // por día (para no pagar dos veces), objetos y lo equipado, movimientos, pedidos de monedas y límites de compra.
  `CREATE TABLE monedero (
     user_id      TEXT PRIMARY KEY,
     ganadas      INTEGER NOT NULL DEFAULT 0,
     compradas    INTEGER NOT NULL DEFAULT 0,
     ecos         INTEGER NOT NULL DEFAULT 0,
     sobres       INTEGER NOT NULL DEFAULT 0,
     gratis       INTEGER NOT NULL DEFAULT 0,
     sin_epica    INTEGER NOT NULL DEFAULT 0,
     sin_leg      INTEGER NOT NULL DEFAULT 0,
     semana       TEXT,
     membresia_at INTEGER
   );
   CREATE TABLE monedas_dia (
     user_id TEXT NOT NULL,
     day     TEXT NOT NULL,
     ganadas INTEGER NOT NULL DEFAULT 0,
     sobre   INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );
   CREATE TABLE inventario (
     user_id   TEXT NOT NULL,
     objeto_id TEXT NOT NULL,
     origen    TEXT NOT NULL,
     at        INTEGER NOT NULL,
     PRIMARY KEY (user_id, objeto_id)
   );
   CREATE TABLE equipado (
     user_id   TEXT NOT NULL,
     ranura    TEXT NOT NULL,
     objeto_id TEXT NOT NULL,
     PRIMARY KEY (user_id, ranura)
   );
   CREATE TABLE movimientos (
     id       INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id  TEXT NOT NULL,
     bolsillo TEXT NOT NULL,
     cantidad INTEGER NOT NULL,
     motivo   TEXT NOT NULL,
     at       INTEGER NOT NULL
   );
   CREATE INDEX movimientos_papu ON movimientos (user_id, at);
   CREATE TABLE pedidos_monedas (
     codigo      TEXT PRIMARY KEY,
     user_id     TEXT NOT NULL,
     paquete     TEXT NOT NULL,
     metodo      TEXT NOT NULL,
     usd         REAL NOT NULL,
     clp         INTEGER NOT NULL,
     monedas     INTEGER NOT NULL,
     estado      TEXT NOT NULL,
     creado_at   INTEGER NOT NULL,
     avisado_at  INTEGER,
     resuelto_at INTEGER,
     registro_id TEXT
   );
   CREATE INDEX pedidos_monedas_papu ON pedidos_monedas (user_id, creado_at);
   CREATE TABLE compras_control (
     user_id    TEXT PRIMARY KEY,
     limite_usd REAL,
     bloqueado  INTEGER NOT NULL DEFAULT 0
   );`,
  // 11: machetazos (src/moderation/strikes.ts, decision de GyroP, 28 oct. 2026). Cada fila es un machetazo o una
  // advertencia, con la XP que le quito a un dia (para devolverla al perdonar). Los strikes de antes quedan como
  // 'antiguo' y no cuentan: la escalera nueva empieza de cero.
  `ALTER TABLE strikes ADD COLUMN tipo TEXT NOT NULL DEFAULT 'machetazo';
   ALTER TABLE strikes ADD COLUMN xp_quitada INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE strikes ADD COLUMN dia TEXT;
   UPDATE strikes SET tipo = 'antiguo';
   CREATE INDEX strikes_tipo ON strikes (user_id, tipo, expires_at);`,
  // 12: actualizacion del 31 oct. 2026. Mensajes cedidos con /donar (cuentan como gastados), sobres gratis raros y
  // legendarios (premios de la trivia), preguntas superadas por Papu (una vez cada una) y premios de cada dificultad,
  // y mensajes enviados por dia (Papus y Vocaloids; para las estadisticas de Mango9374).
  `ALTER TABLE quota_usage ADD COLUMN donadas INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE monedero ADD COLUMN gratis_raro INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE monedero ADD COLUMN gratis_leg INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE trivia_superadas (
     user_id  TEXT NOT NULL,
     pregunta TEXT NOT NULL,
     PRIMARY KEY (user_id, pregunta)
   );
   CREATE TABLE trivia_premios (
     user_id    TEXT NOT NULL,
     dificultad TEXT NOT NULL,
     at         INTEGER NOT NULL,
     PRIMARY KEY (user_id, dificultad)
   );
   CREATE TABLE mensajes_dia (
     user_id TEXT NOT NULL,
     day     TEXT NOT NULL,
     n       INTEGER NOT NULL DEFAULT 0,
     bot     INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );`,
  // 13: actualizacion del 2 nov. 2026. XP que le costaron al Papu las partidas de trivia pasadas de la 15 del dia
  // (config/trivia.json limites.castigo) y minutos conectado en voz en el dia, den XP o no (estadisticas de Mango9374;
  // voz_min solo cuenta los que dieron XP, hasta el tope).
  `ALTER TABLE xp_dia ADD COLUMN trivia_castigo INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE xp_dia ADD COLUMN voz_total INTEGER NOT NULL DEFAULT 0;`,
  // 14: 1vs1 de los Vocaloids (src/peleas/, pedido de GyroP, 4 nov. 2026). Una fila por pelea (los dos Vocaloids, la
  // cuota de cada uno y como termino) y una por apuesta (Shaulitas; pago = lo que recibio al acertar).
  // Estados: abierta (se apuesta), peleando, terminada y devuelta (el bot se reinicio antes del final: se devolvio todo).
  `CREATE TABLE peleas (
     id           TEXT PRIMARY KEY,
     a            TEXT NOT NULL,
     b            TEXT NOT NULL,
     cuota_a      REAL NOT NULL,
     cuota_b      REAL NOT NULL,
     canal        TEXT,
     mensaje      TEXT,
     estado       TEXT NOT NULL DEFAULT 'abierta',
     ganador      TEXT,
     turnos       INTEGER,
     creada_at    INTEGER NOT NULL,
     cierra_at    INTEGER NOT NULL,
     terminada_at INTEGER
   );
   CREATE TABLE apuestas (
     pelea    TEXT NOT NULL,
     user_id  TEXT NOT NULL,
     lado     TEXT NOT NULL,
     cantidad INTEGER NOT NULL,
     pago     INTEGER NOT NULL DEFAULT 0,
     at       INTEGER NOT NULL,
     PRIMARY KEY (pelea, user_id)
   );`,
  // 15: hitos de la trivia (pedido de GyroP, 7 nov. 2026). Aciertos por Papu y dificultad que cuentan para el sobre de
  // cada hito (config/trivia.json dificultades.<d>.hito) y cuantos sobres de hito lleva. Empieza en 0 el 7 nov. 2026.
  `CREATE TABLE trivia_hitos (
     user_id    TEXT NOT NULL,
     dificultad TEXT NOT NULL,
     aciertos   INTEGER NOT NULL DEFAULT 0,
     premios    INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, dificultad)
   );`,
  // 16: mercado negro (src/mercado/, pedido de GyroP, 9 nov. 2026). consumibles = usos que le quedan a cada Papu de
  // cada objeto (config/mercado.json); mercado_registro = cada compra y cada uso (accion 'compra' o 'uso'); reinicios =
  // lo que llevaba en el dia cuando uso el PC de Adachi Rei, para contar desde ahi: tiradas de la ruleta y partidas y XP
  // de la trivia ya usadas, y la XP del dia y las monedas por actividad ya ganadas (el tope de actividad vuelve a empezar).
  // apuestas.seguro = la aseguro con el Seguro de Gakupo (si pierde, se le devuelve completa).
  `CREATE TABLE consumibles (
     user_id TEXT NOT NULL,
     objeto  TEXT NOT NULL,
     usos    INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, objeto)
   );
   CREATE TABLE mercado_registro (
     id      INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL,
     objeto  TEXT NOT NULL,
     accion  TEXT NOT NULL,
     precio  INTEGER NOT NULL DEFAULT 0,
     detalle TEXT,
     at      INTEGER NOT NULL
   );
   CREATE TABLE reinicios (
     user_id         TEXT NOT NULL,
     day             TEXT NOT NULL,
     veces           INTEGER NOT NULL DEFAULT 0,
     ruleta          INTEGER NOT NULL DEFAULT 0,
     trivia_partidas INTEGER NOT NULL DEFAULT 0,
     trivia_xp       INTEGER NOT NULL DEFAULT 0,
     monedas_xp      INTEGER NOT NULL DEFAULT 0,
     monedas_previa  INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );
   ALTER TABLE apuestas ADD COLUMN seguro INTEGER NOT NULL DEFAULT 0;`,
  // 17: intercambios entre Papus (src/intercambios/, pedido de GyroP, 10 nov. 2026). Una fila por oferta: quien la
  // hace (de), a quien (para; null = abierta), lo que entrega y lo que pide (JSON), su estado (abierta, hecha,
  // rechazada, cancelada, vencida, contraofertada), la oferta a la que contesta (padre), quien la aceptó (con) y el
  // anuncio en #centro-de-comercio.
  `CREATE TABLE intercambios (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     de         TEXT NOT NULL,
     para       TEXT,
     da         TEXT NOT NULL,
     pide       TEXT NOT NULL,
     estado     TEXT NOT NULL DEFAULT 'abierta',
     padre      INTEGER,
     con        TEXT,
     creado_at  INTEGER NOT NULL,
     vence_at   INTEGER NOT NULL,
     cerrado_at INTEGER,
     canal      TEXT,
     mensaje    TEXT
   );
   CREATE INDEX intercambios_estado ON intercambios (estado, vence_at);`,
  // 18: Ruleta de Némesis (src/nemesis/, pedido de GyroP, 12 nov. 2026). Una fila por desafío: retador y rival, la
  // apuesta de cada uno (Shaulitas), la recámara con la bala y quién empezó (0 = retador, 1 = rival), el
  // turno en curso, el ganador, la tajada de Némesis y el premio, y los mensajes del desafío y de la mesa. Estados:
  // pendiente (esperando que acepte), jugando, terminada, rechazada, vencida y devuelta (reinicio o cancelada).
  `CREATE TABLE nemesis (
     id           TEXT PRIMARY KEY,
     retador      TEXT NOT NULL,
     rival        TEXT NOT NULL,
     apuesta      INTEGER NOT NULL,
     estado       TEXT NOT NULL DEFAULT 'pendiente',
     bala         INTEGER,
     primero      INTEGER,
     turno        INTEGER NOT NULL DEFAULT 0,
     ganador      TEXT,
     tajada       INTEGER,
     premio       INTEGER,
     canal        TEXT,
     mensaje      TEXT,
     mesa         TEXT,
     creada_at    INTEGER NOT NULL,
     vence_at     INTEGER NOT NULL,
     terminada_at INTEGER
   );
   CREATE INDEX nemesis_estado ON nemesis (estado);`,
  // Lado de los datos en la tarjeta de nivel (/tarjeta lado; pedido de GyroP, 13 nov. 2026): NULL = izquierda (como
  // siempre), "derecha" = avatar a la derecha y datos a la izquierda, para que no tapen el arte del fondo.
  `ALTER TABLE niveles ADD COLUMN lado TEXT;`,
  // Una sola moneda, las Shaulitas (decisión de GyroP, 13 nov. 2026, PLAN §3.6): lo comprado se suma una vez al saldo
  // (columna `ganadas`, que desde ahora es la única) y queda anotado en movimientos. `compradas` ya no se usa.
  `INSERT INTO movimientos (user_id, bolsillo, cantidad, motivo, at)
     SELECT user_id, 'ganadas', compradas, 'una sola moneda: compradas sumadas', CAST(strftime('%s','now') AS INTEGER) * 1000 FROM monedero WHERE compradas > 0;
   UPDATE monedero SET ganadas = ganadas + compradas, compradas = 0 WHERE compradas > 0;`,
  // Membresías (src/membresias/, PLAN §2; decisiones de GyroP del 13 nov. 2026). membresia_estado: el último regalo
  // (cada 30 días), los meses con membresía (insignias de antigüedad) y el título que escribió (Baguette y más).
  // membresia_sobres: sobres temáticos de regalo (y míticos y de prestigio): el tema elegido y los objetos que ve
  // (opciones, JSON) hasta que elige. lanzamientos: peleas y bodas lanzadas por día. recuperados: objetos de vitrinas
  // pasadas comprados con el beneficio.
  `CREATE TABLE membresia_estado (
     user_id   TEXT PRIMARY KEY,
     nivel     TEXT,
     meses     INTEGER NOT NULL DEFAULT 0,
     regalo_at INTEGER,
     titulo    TEXT
   );
   CREATE TABLE membresia_sobres (
     id        INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id   TEXT NOT NULL,
     clase     TEXT NOT NULL,
     ve        INTEGER NOT NULL,
     elige     INTEGER NOT NULL,
     origen    TEXT NOT NULL,
     tema      TEXT,
     opciones  TEXT,
     creado_at INTEGER NOT NULL,
     abierto_at INTEGER
   );
   CREATE INDEX membresia_sobres_user ON membresia_sobres (user_id, abierto_at);
   CREATE TABLE lanzamientos (
     user_id TEXT NOT NULL,
     day     TEXT NOT NULL,
     que     TEXT NOT NULL,
     n       INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day, que)
   );
   CREATE TABLE recuperados (
     user_id   TEXT NOT NULL,
     objeto_id TEXT NOT NULL,
     precio    INTEGER NOT NULL,
     at        INTEGER NOT NULL
   );
   CREATE INDEX recuperados_user ON recuperados (user_id, at);`,
  // Taller de los Papus (src/taller/, PLAN §2): lo que escriben con /aportar (preguntas, adivinanzas, frases del
  // especial, luchadores y consumibles propuestos). GyroP o un Mod lo aprueba; lo aprobado se usa con crédito.
  `CREATE TABLE aportes (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id     TEXT NOT NULL,
     nombre      TEXT NOT NULL,
     tipo        TEXT NOT NULL,
     datos       TEXT NOT NULL,
     estado      TEXT NOT NULL DEFAULT 'pendiente',
     creado_at   INTEGER NOT NULL,
     resuelto_at INTEGER,
     resuelto_por TEXT
   );
   CREATE INDEX aportes_estado ON aportes (estado, tipo);`,
  // Sobres temáticos ganados (PLAN §3.6, 13 nov. 2026: el de la Vocaloid con que se casó; se abren al azar dentro del
  // tema) y redes de los Papus (/redes, PLAN §8): su usuario de Instagram y de X, opcionales, para que Teto los muestre
  // en cada fanart suyo en #🎨・fanart. Solo el usuario (nunca un enlace cualquiera).
  `CREATE TABLE sobres_tematicos (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id    TEXT NOT NULL,
     tema       TEXT NOT NULL,
     origen     TEXT NOT NULL,
     creado_at  INTEGER NOT NULL,
     abierto_at INTEGER
   );
   CREATE INDEX sobres_tematicos_user ON sobres_tematicos (user_id, abierto_at);
   CREATE TABLE redes (
     user_id   TEXT PRIMARY KEY,
     instagram TEXT,
     x         TEXT,
     at        INTEGER NOT NULL
   );`,
  // Ambiente casual de los Vocaloids (PLAN §3.13, 14 nov. 2026): topes del dia (reacciones, metiches, comentarios,
  // dramas, momentos) y las preguntas al aire de #general, para comentar su resultado aunque el bot se reinicie.
  `CREATE TABLE ambiente_dia (
     day   TEXT NOT NULL,
     clave TEXT NOT NULL,
     n     INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, clave)
   );
   CREATE TABLE ambiente_encuestas (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     indice      INTEGER NOT NULL,
     bot         TEXT NOT NULL,
     channel_id  TEXT NOT NULL,
     message_id  TEXT NOT NULL,
     creada_at   INTEGER NOT NULL,
     cerrada_at  INTEGER
   );`,
  // Imagenes que vio cada Papu con los Vocaloids hoy (PLAN §5.1, 14 nov. 2026): tope diario (config/llm.json, vision).
  `CREATE TABLE imagenes_dia (
     user_id TEXT NOT NULL,
     day     TEXT NOT NULL,
     n       INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );`,
  // Espacio de donados (pedido de GyroP, 14 nov. 2026): lo que regalan otros Papus con /donar ya no rellena la cuota
  // diaria, va a su propio espacio con tope (config/niveles.json, donadosMax). recibidas = lo que entro hoy a ese
  // espacio; gastadas_rec = lo que se uso de el. `used` sigue siendo lo gastado del espacio diario.
  `ALTER TABLE quota_usage ADD COLUMN recibidas INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE quota_usage ADD COLUMN gastadas_rec INTEGER NOT NULL DEFAULT 0;`,
  // Desafíos de los Vocaloids en la Ruleta de Némesis (pedido de GyroP, 14 nov. 2026, PLAN §3.12): casa = 1 cuando el
  // retador es un bot. La casa no paga apuesta: si gana, la del Papu sale de circulación; si pierde, le paga el premio.
  `ALTER TABLE nemesis ADD COLUMN casa INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX nemesis_casa ON nemesis (casa, creada_at);`,
  // Carreras de los Vocaloids (pedido de GyroP, 16 nov. 2026, PLAN §3.14): apuestas mutuas. corredores, probabilidades
  // y base (la bolsa de Teto) en JSON; semilla y llegada al cerrar las apuestas; cuotas = lo que pagó cada bolsa.
  // Un boleto = un Vocaloid, un tipo (ganador, segundo o tercero) y un monto; un Papu puede tener varios.
  `CREATE TABLE carreras (
     id           TEXT PRIMARY KEY,
     corredores   TEXT NOT NULL,
     probs        TEXT NOT NULL,
     base         TEXT NOT NULL,
     canal        TEXT,
     mensaje      TEXT,
     lanzada_por  TEXT,
     estado       TEXT NOT NULL DEFAULT 'abierta',
     semilla      INTEGER,
     llegada      TEXT,
     cuotas       TEXT,
     creada_at    INTEGER NOT NULL,
     cierra_at    INTEGER NOT NULL,
     terminada_at INTEGER
   );
   CREATE INDEX carreras_estado ON carreras (estado, creada_at);
   CREATE TABLE boletos (
     id       INTEGER PRIMARY KEY AUTOINCREMENT,
     carrera  TEXT NOT NULL,
     user_id  TEXT NOT NULL,
     corredor TEXT NOT NULL,
     tipo     TEXT NOT NULL,
     cantidad INTEGER NOT NULL,
     pago     INTEGER NOT NULL DEFAULT 0,
     at       INTEGER NOT NULL
   );
   CREATE INDEX boletos_carrera ON boletos (carrera, user_id);`,
  // Ofertas de los Vocaloids en #centro-de-comercio (idea de Piña, salón de la fama; GyroP, 18 nov. 2026): casa = id
  // del Vocaloid que ofrece un objeto suyo por Shaulitas (`de` es el id de Discord de su bot). Sin contraofertas.
  `ALTER TABLE intercambios ADD COLUMN casa TEXT;`,
  // Relato completo de cada pelea (GyroP, 18 nov. 2026): en vivo se ve un marcador de texto; el relato largo de siempre
  // queda aquí para el botón «📜 Ver relato».
  `ALTER TABLE peleas ADD COLUMN relato TEXT;`,
  // «¡Adivina, Papu!» (GyroP, 20 nov. 2026, PLAN §3.17): adivinanzas al aire con pozo de Shaulitas. dia y semana en la
  // zona de config/adivinanzas.json (México); semana = su lunes, para el 🧠 Sabelotodo. ganador NULL = nadie acertó.
  `CREATE TABLE adivinanzas (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     indice      INTEGER NOT NULL,
     bot         TEXT NOT NULL,
     channel_id  TEXT NOT NULL,
     message_id  TEXT,
     dorada      INTEGER NOT NULL DEFAULT 0,
     bote        INTEGER NOT NULL DEFAULT 0,
     dia         TEXT NOT NULL,
     semana      TEXT NOT NULL,
     creada_at   INTEGER NOT NULL,
     cerrada_at  INTEGER,
     ganador     TEXT,
     nombre      TEXT,
     premio      INTEGER NOT NULL DEFAULT 0,
     ms          INTEGER
   );
   CREATE INDEX adivinanzas_abiertas ON adivinanzas (cerrada_at);
   CREATE INDEX adivinanzas_ganador ON adivinanzas (ganador, dia);
   CREATE INDEX adivinanzas_semana ON adivinanzas (semana);
   CREATE TABLE adivinanzas_intentos (
     adivinanza INTEGER NOT NULL,
     user_id    TEXT NOT NULL,
     n          INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (adivinanza, user_id)
   );`,
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
  // Dentro de otra transaccion (la tirada de la ruleta suma XP con el store de niveles): va en la de afuera.
  if (db.isTransaction) return fn();
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
