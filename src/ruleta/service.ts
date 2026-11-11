// Ruleta de los Papus (PLAN §3.3): misiones del dia, tiradas disponibles y premios. Todo el estado vive en SQLite
// (xp_dia, quota_usage.extra, tabla ruleta y kv), asi un reinicio no olvida nada. Sin Discord: src/discord/ruleta.ts
// muestra el panel, publica el GIF y avisa las misiones cumplidas.
import { kvDelete, kvGet, kvSet, transaction, type Db } from "../db/database";
import type { LevelChange, LevelService } from "../levels/service";
import { reinicioDe } from "../mercado/reinicios";
import type { Quota } from "../quota/quota";
import { addDays } from "../coins/rules";
import { dayKey } from "../time";
import { missions, pickPrize, prizeXp, spinsLeft, type DayStats, type MissionId, type MissionStatus, type Prize, type RouletteSettings } from "./rules";

export interface RouletteStatus {
  missions: MissionStatus[];
  used: number;
  left: number;
  /** Machetazo de Neru hoy (o 2 o mas activos): sin ruleta. */
  blocked: boolean;
  /** Giro ya sorteado que espera que el Papu lo acepte (Atun de Luka). */
  pending: Pending | null;
  /** Tiradas que le regalaron hoy (Naranja y plátano de Rin y Len). */
  regaladas: number;
  /** Tiradas guardadas de dias anteriores (Disquete de Adachi Rei). */
  guardadas: number;
  /** Hoy uso el Micrófono de Meiko (la mision de voz pide menos). */
  vozReducida: boolean;
}

/**
 * Giro sorteado que aun no se aplica (Atun de Luka, mercado negro): el Papu lo ve solo el y decide si se lo queda o lo
 * descarta y gira otra vez. Vive en kv: si el bot se reinicia sigue ahi, y volver a girar no sirve para cambiarlo.
 */
export interface Pending {
  day: string;
  index: number;
  /** Giros extra ya usados en este giro. */
  giros: number;
  /** Ya gasto un uso del Atun en este giro. */
  atun: boolean;
}

/** El Atun de Luka (src/mercado/): usos que le quedan, gastar uno y cuantos giros extra da en un mismo giro. */
export interface AtunPort {
  giros: number;
  usos(userId: string): number;
  consume(userId: string): boolean;
}

export interface SpinResult {
  /** Casilla ganadora (indice en config/ruleta.json -> premios). */
  index: number;
  prize: Prize;
  /** XP ganada (premios de XP). */
  xp: number;
  /** Mensajes extra o devueltos (premios de cuota). */
  messages: number;
  /** Mensajes que no cupieron en su cuota llena y se cambiaron por XP (ya sumada en `xp`). */
  overflow: number;
  /** Sobres comunes gratis ganados (premio de sobre). */
  sobres: number;
  /** Cambio de nivel por la XP del premio. */
  change: LevelChange | null;
  levelBefore: number;
  levelAfter: number;
  /** Tiradas que le quedan hoy. */
  left: number;
}

export interface RouletteServiceDeps {
  db: Db;
  settings: RouletteSettings;
  levels: LevelService;
  quota: Quota;
  /** Da sobres comunes gratis de la tienda (src/coins/). Sin tienda, la casilla del sobre no sale. */
  giveSobres?: (userId: string, n: number) => void;
  /** Atun de Luka del mercado negro (sin mercado, no hay giros extra). Se puede poner despues de crear el servicio. */
  atun?: AtunPort;
  /** ¿Tiene el Disquete de Adachi Rei? (mercado negro: las tiradas no usadas se guardan). */
  disquete?: (userId: string) => boolean;
  timeZone: string;
  now?: () => number;
  rnd?: () => number;
}

export class RouletteService {
  private readonly now: () => number;
  private readonly rnd: () => number;

  constructor(private readonly d: RouletteServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
  }

  get settings(): RouletteSettings {
    return this.d.settings;
  }

  private day(t = this.now()): string {
    return dayKey(new Date(t), this.d.timeZone);
  }

  /** Tiradas usadas ese dia (desde el ultimo PC de Adachi Rei, si lo uso). */
  private used(userId: string, day: string): number {
    return this.spinsOn(userId, day) - reinicioDe(this.d.db, userId, day).ruleta;
  }

  /** Todas las tiradas de ese dia (para el PC de Adachi Rei). */
  spinsOn(userId: string, day: string): number {
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM ruleta WHERE user_id = ? AND day = ?").get(userId, day) as { n: number }).n;
  }

  get atun(): AtunPort | null {
    return this.d.atun ?? null;
  }

  /** Conecta el Atun de Luka (el mercado negro se crea despues de la ruleta: necesita contar sus tiradas). */
  /** Conecta el Disquete de Adachi Rei. */
  useDisquete(has: (userId: string) => boolean): void {
    this.d.disquete = has;
  }

  /** Tiradas ganadas ese dia: una por mision cumplida mas las regaladas (0 con la ruleta bloqueada por un machetazo). */
  private earnedOn(userId: string, day: string): number {
    const st = this.d.levels.store.dayStats(userId, day);
    if (this.d.settings.bloqueoPorStrike && st.castigo) return 0;
    return missions(this.settingsFor(userId, day), st).filter((m) => m.done).length + this.gifted(userId, day);
  }

  /**
   * Disquete de Adachi Rei: tiradas guardadas al empezar el dia `day` (las que no uso los dias anteriores, desde que lo
   * tiene). Se calcula dia por dia: guardadas de mañana = ganadas hoy + guardadas de hoy - usadas hoy.
   */
  saved(userId: string, day: string): number {
    if (!this.d.disquete?.(userId)) return 0;
    const key = `ruleta:guardadas:${userId}`;
    const st = JSON.parse(kvGet(this.d.db, key) ?? "null") as { day: string; n: number } | null;
    if (!st || st.day > day) {
      if (!st) kvSet(this.d.db, key, JSON.stringify({ day, n: 0 }));
      return st?.n ?? 0;
    }
    let { day: d, n } = st;
    for (let i = 0; d < day && i < 400; i++, d = addDays(d, 1)) n = Math.max(0, this.earnedOn(userId, d) + n - this.used(userId, d));
    if (d !== st.day) kvSet(this.d.db, key, JSON.stringify({ day: d, n }));
    return n;
  }

  useAtun(port: AtunPort): void {
    this.d.atun = port;
  }

  private pendingKey(userId: string): string {
    return `ruleta:pendiente:${userId}`;
  }

  pending(userId: string): Pending | null {
    const raw = kvGet(this.d.db, this.pendingKey(userId));
    return raw ? (JSON.parse(raw) as Pending) : null;
  }

  // ───────────────────────── mercado negro: Micrófono de Meiko y regalos de Rin y Len ─────────────────────────

  /** Minutos en voz que pide la mision ese dia: menos si uso el Micrófono de Meiko (null = los de la config). */
  vozMinutos(userId: string, day: string): number | null {
    const v = kvGet(this.d.db, `ruleta:voz:${day}:${userId}`);
    return v ? Number(v) : null;
  }

  /** Micrófono de Meiko: ese dia la mision de voz pide `minutos`. False si ya lo tenia activado ese dia. */
  setVozMinutos(userId: string, day: string, minutos: number): boolean {
    if (this.vozMinutos(userId, day) !== null) return false;
    kvSet(this.d.db, `ruleta:voz:${day}:${userId}`, String(minutos));
    return true;
  }

  /** La config de la ruleta para ese Papu ese dia (con el Micrófono de Meiko, si lo activo). */
  private settingsFor(userId: string, day: string): RouletteSettings {
    const voz = this.vozMinutos(userId, day);
    const s = this.d.settings;
    return voz !== null && voz < s.misiones.vozMinutos ? { ...s, misiones: { ...s.misiones, vozMinutos: voz } } : s;
  }

  /** Misiones de ese Papu ese dia (para las monedas por mision y el sobre de las misiones). */
  missionsFor(userId: string, day: string, stats: DayStats): MissionStatus[] {
    return missions(this.settingsFor(userId, day), stats);
  }

  /** Tiradas que le regalaron ese dia (Naranja y plátano de Rin y Len). */
  gifted(userId: string, day: string): number {
    return Number(kvGet(this.d.db, `ruleta:regalo:${day}:${userId}`) ?? 0);
  }

  /** Le regalan una tirada para hoy. */
  giftSpin(userId: string, t = this.now()): void {
    const day = this.day(t);
    kvSet(this.d.db, `ruleta:regalo:${day}:${userId}`, String(this.gifted(userId, day) + 1));
  }

  dayOf(t = this.now()): string {
    return this.day(t);
  }

  status(userId: string, t = this.now()): RouletteStatus {
    const day = this.day(t);
    const day0 = this.d.levels.store.dayStats(userId, day);
    // Machetazo hoy, o 2 o mas activos (sin ganar XP): sin ruleta.
    const stats = { ...day0, castigo: day0.castigo || !this.d.levels.canEarn(userId, t) };
    const used = this.used(userId, day);
    const s = this.settingsFor(userId, day);
    const regaladas = this.gifted(userId, day);
    const guardadas = this.saved(userId, day);
    return {
      missions: missions(s, stats),
      used,
      left: spinsLeft(s, stats, used, regaladas + guardadas),
      blocked: s.bloqueoPorStrike && stats.castigo,
      pending: this.pending(userId),
      regaladas,
      guardadas,
      vozReducida: s !== this.d.settings,
    };
  }

  /**
   * Misiones que se acaban de cumplir y todavia no se avisaron (cada una se avisa una sola vez al dia). Con la ruleta
   * bloqueada por un strike no se avisa nada.
   */
  newlyCompleted(userId: string, t = this.now()): MissionStatus[] {
    const st = this.status(userId, t);
    if (st.blocked) return [];
    const key = `ruleta:avisadas:${this.day(t)}:${userId}`;
    const told = JSON.parse(kvGet(this.d.db, key) ?? "[]") as MissionId[];
    const fresh = st.missions.filter((m) => m.done && !told.includes(m.id));
    if (fresh.length) kvSet(this.d.db, key, JSON.stringify([...told, ...fresh.map((m) => m.id)]));
    return fresh;
  }

  /** Casilla al azar (sin tienda, la del sobre no sale: peso 0). */
  private pick(): number {
    return pickPrize({ premios: this.d.settings.premios.map((p) => (p.tipo === "sobre" && !this.d.giveSobres ? { peso: 0 } : p)) }, this.rnd);
  }

  /**
   * Sortea un giro sin aplicarlo (para quien tiene el Atun de Luka): queda pendiente hasta que lo acepte. Si ya habia uno
   * pendiente, devuelve ese. Null si no le quedan tiradas.
   */
  draw(userId: string, t = this.now()): Pending | null {
    return transaction(this.d.db, () => {
      const prev = this.pending(userId);
      if (prev) return prev;
      if (this.status(userId, t).left <= 0) return null;
      const p: Pending = { day: this.day(t), index: this.pick(), giros: 0, atun: false };
      kvSet(this.d.db, this.pendingKey(userId), JSON.stringify(p));
      return p;
    });
  }

  /**
   * Atun de Luka: descarta el giro pendiente y gira otra vez. El primer giro extra gasta un uso del Atun; en ese mismo
   * giro puede girar hasta `giros` veces. Devuelve el giro nuevo, o el motivo si no se puede.
   */
  reroll(userId: string): { ok: true; pending: Pending } | { ok: false; motivo: "sin_giro" | "sin_atun" | "sin_giros" } {
    return transaction(this.d.db, () => {
      const p = this.pending(userId);
      const atun = this.d.atun;
      if (!p) return { ok: false as const, motivo: "sin_giro" as const };
      if (!atun) return { ok: false as const, motivo: "sin_atun" as const };
      if (p.giros >= atun.giros) return { ok: false as const, motivo: "sin_giros" as const };
      if (!p.atun && !atun.consume(userId)) return { ok: false as const, motivo: "sin_atun" as const };
      const next: Pending = { ...p, index: this.pick(), giros: p.giros + 1, atun: true };
      kvSet(this.d.db, this.pendingKey(userId), JSON.stringify(next));
      return { ok: true as const, pending: next };
    });
  }

  /** Acepta el giro pendiente: se aplica el premio. Null si no habia ninguno. */
  claim(userId: string, t = this.now()): SpinResult | null {
    return transaction(this.d.db, () => {
      const p = this.pending(userId);
      if (!p) return null;
      kvDelete(this.d.db, this.pendingKey(userId));
      return this.apply(userId, p.index, p.day, t, p.giros);
    });
  }

  /** Gira: gasta una tirada y aplica el premio (si habia un giro pendiente, se aplica ese). Null si no le quedan. */
  spin(userId: string, t = this.now()): SpinResult | null {
    return transaction(this.d.db, () => {
      if (this.pending(userId)) return this.claim(userId, t);
      if (this.status(userId, t).left <= 0) return null;
      return this.apply(userId, this.pick(), this.day(t), t, 0);
    });
  }

  /** Aplica el premio de la casilla `index` y anota la tirada en el dia `day` (giros = giros extra del Atun de Luka). */
  private apply(userId: string, index: number, day: string, t: number, giros: number): SpinResult {
    const s = this.d.settings;
    const prize = s.premios[index]!;
    const levelBefore = this.d.levels.snapshot(userId).level;
    const now = new Date(t);
    let xp = 0;
    let messages = 0;
    let overflow = 0;
    let sobres = 0;
    if (prize.tipo === "xp") {
      xp = prizeXp(s, this.d.levels.settings, prize, this.d.levels.store.get(userId).xp, this.d.levels.multiplier(now));
    } else if (prize.tipo === "cuota") {
      ({ added: messages, overflow } = this.d.quota.grant(userId, prize.valor!, now));
    } else if (prize.tipo === "cuota_llena") {
      // Cuota llena: devuelve lo gastado hoy con los Vocaloids (lo donado no vuelve); si no habia gastado nada, un
      // mensaje extra (para que nunca salga vacio), que con la cuota llena se vuelve XP.
      messages = this.d.quota.used(userId, now) - this.d.quota.donated(userId, now);
      if (messages > 0) this.d.quota.reset(userId, now);
      else ({ added: messages, overflow } = this.d.quota.grant(userId, 1, now));
    } else {
      sobres = prize.valor ?? 1;
      this.d.giveSobres?.(userId, sobres);
    }
    // Mensajes que no cupieron (cuota llena): XP en su lugar (decision de GyroP, 31 oct. 2026).
    xp += this.d.levels.overflowXp(userId, overflow);
    const change: LevelChange | null = this.d.levels.bonus(userId, xp, t);
    const detalle = JSON.stringify({ tipo: prize.tipo, etiqueta: prize.etiqueta, xp, mensajes: messages, sobrante: overflow, sobres, ...(giros ? { atun: giros } : {}) });
    this.d.db.prepare("INSERT INTO ruleta (user_id, day, premio, detalle, at) VALUES (?, ?, ?, ?, ?)").run(userId, day, index, detalle, t);
    return { index, prize, xp, messages, overflow, sobres, change, levelBefore, levelAfter: this.d.levels.snapshot(userId).level, left: this.status(userId, t).left };
  }
}
