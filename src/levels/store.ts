// Niveles guardados en SQLite (tablas niveles y xp_dia, migraciones 3 y 6).
import { transaction, type Db } from "../db/database";

export interface LevelRecord {
  userId: string;
  /** XP del prestigio actual (vuelve a 0 al prestigiar). */
  xp: number;
  prestige: number;
  /** Ya estaba en el servidor al lanzar los niveles: piso de cuota de transicion. */
  veteran: boolean;
  /** Quiere el nivel en el apodo ("karin ✦57"). */
  nick: boolean;
  /** Su nombre sin la etiqueta de nivel (para devolverlo al quitarla). */
  nickBase: string | null;
  card: CardPrefs;
}

export interface CardPrefs {
  /** Frase propia de la tarjeta (revisada con las reglas de Neru). */
  frase: string | null;
  /** Color de acento "#RRGGBB". */
  color: string | null;
  /** "bot:<id>" (banner de un Vocaloid), "propia" (imagen aprobada por GyroP) o null (degradado). */
  fondo: string | null;
}

interface Row {
  user_id: string;
  xp: number;
  prestigio: number;
  veterano: number;
  apodo: number;
  apodo_base: string | null;
  frase: string | null;
  color: string | null;
  fondo: string | null;
}

const toRecord = (r: Row): LevelRecord => ({
  userId: r.user_id,
  xp: r.xp,
  prestige: r.prestigio,
  veteran: !!r.veterano,
  nick: !!r.apodo,
  nickBase: r.apodo_base,
  card: { frase: r.frase, color: r.color, fondo: r.fondo },
});

export class LevelStore {
  constructor(private readonly db: Db) {}

  get(userId: string): LevelRecord {
    const row = this.db.prepare("SELECT * FROM niveles WHERE user_id = ?").get(userId) as Row | undefined;
    return row ? toRecord(row) : { userId, xp: 0, prestige: 0, veteran: false, nick: false, nickBase: null, card: { frase: null, color: null, fondo: null } };
  }

  private ensure(userId: string): void {
    this.db.prepare("INSERT INTO niveles (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING").run(userId);
  }

  /** Suma XP (y la anota en el dia, para poder quitarla con un strike). Devuelve la XP antes y despues. */
  add(userId: string, amount: number, day: string): { before: number; after: number } {
    return transaction(this.db, () => {
      const before = this.get(userId).xp;
      if (amount <= 0) return { before, after: before };
      this.ensure(userId);
      this.db.prepare("UPDATE niveles SET xp = xp + ? WHERE user_id = ?").run(amount, userId);
      this.db
        .prepare("INSERT INTO xp_dia (user_id, day, xp) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET xp = xp + excluded.xp")
        .run(userId, day, amount);
      return { before, after: before + amount };
    });
  }

  /** Anota un minuto con XP de voz si le quedan del dia (tope `max`). Devuelve si lo anoto. */
  takeVoiceMinute(userId: string, day: string, max: number): boolean {
    const row = this.db.prepare("SELECT voz_min FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, day) as { voz_min: number } | undefined;
    if ((row?.voz_min ?? 0) >= max) return false;
    this.db
      .prepare("INSERT INTO xp_dia (user_id, day, voz_min) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET voz_min = voz_min + 1")
      .run(userId, day);
    return true;
  }

  /** Un mensaje que dio XP (mision de la ruleta). */
  countMessage(userId: string, day: string): void {
    this.db.prepare("INSERT INTO xp_dia (user_id, day, mensajes) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET mensajes = mensajes + 1").run(userId, day);
  }

  /** Subio de nivel ese dia (mision de la ruleta). */
  markLevelUp(userId: string, day: string): void {
    this.db.prepare("INSERT INTO xp_dia (user_id, day, subio) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET subio = 1").run(userId, day);
  }

  /** Lo que hizo un Papu ese dia (misiones de la ruleta). */
  dayStats(userId: string, day: string): { vozMin: number; mensajes: number; subio: boolean; castigo: boolean } {
    const r = this.db.prepare("SELECT voz_min, mensajes, subio, castigo FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, day) as
      | { voz_min: number; mensajes: number; subio: number; castigo: number }
      | undefined;
    return { vozMin: r?.voz_min ?? 0, mensajes: r?.mensajes ?? 0, subio: !!r?.subio, castigo: !!r?.castigo };
  }

  /** Quita la XP ganada ese dia (strike de Neru) y lo marca (bloquea la ruleta). Devuelve la XP antes y despues. */
  removeDay(userId: string, day: string): { before: number; after: number } {
    return transaction(this.db, () => {
      this.db.prepare("INSERT INTO xp_dia (user_id, day, castigo) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET castigo = 1").run(userId, day);
      const before = this.get(userId).xp;
      const row = this.db.prepare("SELECT xp FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, day) as { xp: number } | undefined;
      if (!row?.xp) return { before, after: before };
      const after = Math.max(0, before - row.xp);
      this.db.prepare("UPDATE niveles SET xp = ? WHERE user_id = ?").run(after, userId);
      this.db.prepare("UPDATE xp_dia SET xp = 0 WHERE user_id = ? AND day = ?").run(userId, day);
      return { before, after };
    });
  }

  /** Sube la XP hasta `xp` si tenia menos (Papus de honor: empiezan en su nivel). */
  raiseTo(userId: string, xp: number): { before: number; after: number } {
    const before = this.get(userId).xp;
    if (before >= xp) return { before, after: before };
    this.ensure(userId);
    this.db.prepare("UPDATE niveles SET xp = ? WHERE user_id = ?").run(xp, userId);
    return { before, after: xp };
  }

  /** Del maximo al nivel 1 con una estrella mas. Devuelve las estrellas. */
  prestige(userId: string): number {
    this.ensure(userId);
    this.db.prepare("UPDATE niveles SET xp = 0, prestigio = prestigio + 1 WHERE user_id = ?").run(userId);
    return this.get(userId).prestige;
  }

  setNick(userId: string, on: boolean, base: string | null): void {
    this.ensure(userId);
    this.db.prepare("UPDATE niveles SET apodo = ?, apodo_base = ? WHERE user_id = ?").run(on ? 1 : 0, base, userId);
  }

  setCard(userId: string, patch: Partial<CardPrefs>): void {
    this.ensure(userId);
    for (const [k, v] of Object.entries(patch) as [keyof CardPrefs, string | null][]) {
      this.db.prepare(`UPDATE niveles SET ${k} = ? WHERE user_id = ?`).run(v, userId);
    }
  }

  /** Puesto en el servidor (1 = el mas alto): primero las estrellas, despues la XP. */
  position(userId: string): number {
    const me = this.get(userId);
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM niveles WHERE prestigio > ? OR (prestigio = ? AND xp > ?)")
      .get(me.prestige, me.prestige, me.xp) as { n: number };
    return row.n + 1;
  }

  /** Todos, del puesto mas alto al mas bajo (estrellas y despues XP), para el ranking. */
  ranked(): LevelRecord[] {
    return (this.db.prepare("SELECT * FROM niveles ORDER BY prestigio DESC, xp DESC, user_id").all() as unknown as Row[]).map(toRecord);
  }

  /** Papus que quieren el nivel en el apodo. */
  withNick(): LevelRecord[] {
    return (this.db.prepare("SELECT * FROM niveles WHERE apodo = 1").all() as unknown as Row[]).map(toRecord);
  }

  /**
   * Calculo inicial con el historial (npm run niveles): fija la XP de cada Papu y marca como veteranos a todos los
   * miembros de ahora (piso de cuota de transicion). No toca prestigios, apodos ni tarjetas.
   */
  importInitial(xp: Map<string, number>, members: string[]): void {
    transaction(this.db, () => {
      for (const id of new Set([...xp.keys(), ...members])) this.ensure(id);
      for (const [id, n] of xp) this.db.prepare("UPDATE niveles SET xp = ? WHERE user_id = ?").run(n, id);
      for (const id of members) this.db.prepare("UPDATE niveles SET veterano = 1 WHERE user_id = ?").run(id);
    });
  }

  /** Borra el detalle por dia viejo (mantenimiento): solo sirve para los strikes de hoy. */
  prune(beforeDay: string): void {
    this.db.prepare("DELETE FROM xp_dia WHERE day < ?").run(beforeDay);
  }
}
