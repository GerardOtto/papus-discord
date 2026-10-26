// Ruleta de los Papus (PLAN §3.3): misiones del dia, tiradas disponibles y premios. Todo el estado vive en SQLite
// (xp_dia, quota_usage.extra, tabla ruleta y kv), asi un reinicio no olvida nada. Sin Discord: src/discord/ruleta.ts
// muestra el panel, publica el GIF y avisa las misiones cumplidas.
import { kvGet, kvSet, transaction, type Db } from "../db/database";
import type { LevelChange, LevelService } from "../levels/service";
import type { Quota } from "../quota/quota";
import { dayKey } from "../time";
import { missions, pickPrize, prizeXp, spinsLeft, type MissionId, type MissionStatus, type Prize, type RouletteSettings } from "./rules";

export interface RouletteStatus {
  missions: MissionStatus[];
  used: number;
  left: number;
  /** Strike de Neru hoy: sin ruleta hasta manana. */
  blocked: boolean;
}

export interface SpinResult {
  /** Casilla ganadora (indice en config/ruleta.json -> premios). */
  index: number;
  prize: Prize;
  /** XP ganada (premios de XP). */
  xp: number;
  /** Mensajes extra o devueltos (premios de cuota). */
  messages: number;
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

  private used(userId: string, day: string): number {
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM ruleta WHERE user_id = ? AND day = ?").get(userId, day) as { n: number }).n;
  }

  status(userId: string, t = this.now()): RouletteStatus {
    const day = this.day(t);
    const stats = this.d.levels.store.dayStats(userId, day);
    const used = this.used(userId, day);
    return {
      missions: missions(this.d.settings, stats),
      used,
      left: spinsLeft(this.d.settings, stats, used),
      blocked: this.d.settings.bloqueoPorStrike && stats.castigo,
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

  /** Gira: gasta una tirada y aplica el premio. Null si no le quedan. */
  spin(userId: string, t = this.now()): SpinResult | null {
    const day = this.day(t);
    return transaction(this.d.db, () => {
      if (this.status(userId, t).left <= 0) return null;
      const s = this.d.settings;
      const index = pickPrize(s, this.rnd);
      const prize = s.premios[index]!;
      const levelBefore = this.d.levels.snapshot(userId).level;
      let xp = 0;
      let messages = 0;
      let change: LevelChange | null = null;
      if (prize.tipo === "xp") {
        xp = prizeXp(s, this.d.levels.settings, prize, this.d.levels.store.get(userId).xp, this.d.levels.multiplier(new Date(t)));
        change = this.d.levels.bonus(userId, xp, t);
      } else if (prize.tipo === "cuota") {
        messages = prize.valor!;
        this.d.quota.addExtra(userId, messages, new Date(t));
      } else {
        // Cuota llena: devuelve lo gastado hoy; si no habia gastado nada, un mensaje extra (para que nunca salga vacio).
        messages = this.d.quota.used(userId, new Date(t));
        if (messages > 0) this.d.quota.reset(userId, new Date(t));
        else this.d.quota.addExtra(userId, (messages = 1), new Date(t));
      }
      const detalle = JSON.stringify({ tipo: prize.tipo, etiqueta: prize.etiqueta, xp, mensajes: messages });
      this.d.db.prepare("INSERT INTO ruleta (user_id, day, premio, detalle, at) VALUES (?, ?, ?, ?, ?)").run(userId, day, index, detalle, t);
      return { index, prize, xp, messages, change, levelBefore, levelAfter: this.d.levels.snapshot(userId).level, left: this.status(userId, t).left };
    });
  }
}
