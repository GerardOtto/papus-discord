// Niveles por participacion (PLAN §niveles): XP por mensaje (por largo, con espera y sin repetidos), doble con un
// Vocaloid que contesta, por minuto en voz con otros Papus y multiplicada en eventos. El nivel fija la cuota con los
// bots (regla 1: nada de pago la cambia) y en el nivel de honor da el rol 🏅 Papu de honor, que nunca se pierde.
import { kvDelete, kvGet, kvSet, type Db } from "../db/database";
import { dayKey } from "../time";
import {
  levelFor,
  messageXp,
  multiplierAt,
  passGate,
  progress,
  quotaWithTransition,
  rankFor,
  voiceXp,
  xpToReach,
  releaseWindows,
  type GateState,
  type LevelSettings,
  type Release,
  type XpWindow,
} from "./rules";
import { LevelStore } from "./store";

const EVENT_KEY = "niveles:evento";

/** Lo que cambio al sumar o quitar XP; la app lo usa para el apodo, el rol de honor y los avisos de Teto. */
export interface LevelChange {
  userId: string;
  from: number;
  to: number;
  prestige: number;
  /** Rango nuevo al subir (nombre), o null. */
  rankUp: string | null;
  /** Cruzo el nivel de honor al subir. */
  honor: boolean;
  /** Llego al nivel maximo. */
  max: boolean;
}

/** Un Papu en el ranking (/ranking): su puesto entre los que siguen en el servidor. */
export interface Standing {
  userId: string;
  position: number;
  level: number;
  prestige: number;
  into: number;
  needed: number;
  rank: { index: number; nombre: string; estilo: number };
}

export interface ManualEvent {
  multiplicador: number;
  hasta: number;
}

export interface LevelServiceDeps {
  db: Db;
  settings: LevelSettings;
  timeZone: string;
  /**
   * Fuera del ranking (GyroP). Desde el 22 oct. 2026 sube de nivel como todos, solo para ver cómo avanza (decisión de
   * GyroP): no le quita puestos a los Papus ni le da beneficios (ya los tiene todos).
   */
  unranked?: (userId: string) => boolean;
  /** Con 2 o mas machetazos de Neru no gana XP de ninguna forma (src/moderation/strikes.ts). */
  xpBlocked?: (userId: string, at: number) => boolean;
}

export class LevelService {
  readonly store: LevelStore;
  private readonly gates = new Map<string, GateState>();
  /** Videos del calendario (titulo y hora de salida): XP multiplicada en su estreno. */
  private releases: Release[] = [];
  /** Estrenos anunciados con /estreno de Miku (worker): XP multiplicada desde el anuncio. */
  private launched: { title: string; at: number }[] = [];
  /** Despues de sumar XP (src/coins/: pone al dia las Shaula-coins del dia). */
  afterAward?: (userId: string, day: string) => void;
  /** Cuantas veces vale la XP de un mensaje que contesta un Vocaloid (Luna de IA del mercado negro: 3; sin ella, 1). */
  quotaBoost?: (userId: string, at: number) => number;

  constructor(private readonly d: LevelServiceDeps) {
    this.store = new LevelStore(d.db);
  }

  get settings(): LevelSettings {
    return this.d.settings;
  }

  private unranked(userId: string): boolean {
    return this.d.unranked?.(userId) ?? false;
  }

  // ───────────────────────── eventos ─────────────────────────

  manualEvent(now = Date.now()): ManualEvent | null {
    const e = JSON.parse(kvGet(this.d.db, EVENT_KEY) ?? "null") as ManualEvent | null;
    return e && e.hasta > now ? e : null;
  }

  /** /evento de GyroP: multiplicador por unas horas (reemplaza al anterior). */
  startEvent(multiplicador: number, hours: number, now = Date.now()): ManualEvent {
    const e = { multiplicador, hasta: now + hours * 3_600_000 };
    kvSet(this.d.db, EVENT_KEY, JSON.stringify(e));
    return e;
  }

  endEvent(): void {
    kvDelete(this.d.db, EVENT_KEY);
  }

  /** Lo llama el calendario de Miku cada vez que se arma (cada hora). */
  setReleases(list: Release[]): void {
    this.releases = list;
  }

  /** Lo llama la app cada minuto con los /estreno del último día (base D1 del worker). */
  setLaunched(list: { title: string; at: number }[]): void {
    this.launched = list;
  }

  private allReleases(): Release[] {
    return [...this.releases, ...this.launched];
  }

  /** Estreno en curso (el último que salió, para que Miku anuncie cada uno una vez), o null. */
  activeRelease(now = Date.now()): (Release & { window: XpWindow }) | null {
    let best: (Release & { window: XpWindow }) | null = null;
    for (const r of this.allReleases()) {
      const w = releaseWindows(this.d.settings, [r])[0];
      if (w && (w.desde ?? 0) <= now && now < w.hasta && (!best || r.at > best.at)) best = { ...r, window: w };
    }
    return best;
  }

  multiplier(now = new Date()): number {
    const manual = this.manualEvent(now.getTime());
    return multiplierAt(this.d.settings, now, this.d.timeZone, [...(manual ? [manual] : []), ...releaseWindows(this.d.settings, this.allReleases())]);
  }

  // ───────────────────────── XP ─────────────────────────

  /**
   * Mensaje de un Papu (ya revisado por Neru). Devuelve la XP base concedida (0 si estaba en la espera o era repetido),
   * para doblarla despues si un Vocaloid le contesta, y el cambio de nivel si lo hubo.
   */
  onMessage(userId: string, text: string, at = Date.now()): { base: number; change: LevelChange | null } {
    const gate = passGate(this.d.settings, this.gates.get(userId) ?? { lastAt: 0, recent: [] }, text, at);
    if (!gate) return { base: 0, change: null };
    this.gates.set(userId, gate);
    if (this.gates.size > 5000) this.sweepGates(at);
    this.store.countMessage(userId, dayKey(new Date(at), this.d.timeZone));
    const base = Math.round(messageXp(this.d.settings, text) * this.multiplier(new Date(at)));
    return { base, change: this.award(userId, base, at) };
  }

  /**
   * Un Vocaloid le contesto: la XP de ese mensaje vale `multiplicadorBots` veces (se suma la diferencia). Con la Luna de
   * IA (mercado negro), el total vale el triple.
   */
  onBotReply(userId: string, base: number, at = Date.now()): LevelChange | null {
    if (base <= 0) return null;
    const boost = this.quotaBoost?.(userId, at) ?? 1;
    return this.award(userId, Math.round(base * (this.d.settings.multiplicadorBots * boost - 1)), at);
  }

  /**
   * Un minuto en voz: cada canal es la lista de Papus que cuentan (sin bots, sin ensordecidos, fuera del AFK); los
   * silenciados ganan menos. Cada Papu gana XP de voz hasta `maximoMinutosDia` minutos por dia.
   */
  onVoiceMinute(channels: { id: string; muted: boolean }[][], at = Date.now()): LevelChange[] {
    const mult = this.multiplier(new Date(at));
    const day = dayKey(new Date(at), this.d.timeZone);
    const cap = this.d.settings.voz.maximoMinutosDia ?? Infinity;
    const changes: LevelChange[] = [];
    for (const people of channels) {
      for (const { id, muted } of people) {
        const xp = Math.round(voiceXp(this.d.settings, people.length - 1, muted) * mult);
        if (xp <= 0 || !this.store.takeVoiceMinute(id, day, cap)) continue;
        const c = this.award(id, xp, at);
        if (c) changes.push(c);
      }
    }
    return changes;
  }

  /** XP de regalo ya calculada (boda con una Vocaloid, src/bodas/): se suma tal cual, sin espera ni multiplicador. */
  bonus(userId: string, amount: number, at = Date.now()): LevelChange | null {
    return amount > 0 ? this.award(userId, amount, at) : null;
  }

  /** Le quita XP (partidas de trivia de mas del dia, config/trivia.json limites.castigo). Puede bajarlo de nivel. */
  penalize(userId: string, amount: number, at = Date.now()): LevelChange | null {
    if (amount <= 0) return null;
    const { before, after } = this.store.subtract(userId, amount, dayKey(new Date(at), this.d.timeZone));
    return this.change(userId, before, after);
  }

  /**
   * XP por `units` mensajes ganados que no cupieron en su cuota llena (decision de GyroP, 31 oct. 2026): cada uno vale
   * `cuotaSobrante.porcentajeNivel` de lo que pide su nivel actual (con minimo). Solo calcula; se suma con `bonus`.
   */
  overflowXp(userId: string, units: number): number {
    const c = this.d.settings.cuotaSobrante ?? { porcentajeNivel: 0.05, minimo: 15 };
    if (units <= 0) return 0;
    const { needed } = progress(this.d.settings, this.store.get(userId).xp);
    return Math.round(Math.max(c.minimo, c.porcentajeNivel * needed) * units);
  }

  /** ¿Puede ganar XP ahora? (no, con 2 o mas machetazos activos). */
  canEarn(userId: string, at = Date.now()): boolean {
    return !this.d.xpBlocked?.(userId, at);
  }

  /** Machetazo de Neru: se pierde la XP ganada ese dia (el rol de honor se queda). Devuelve cuanta fue, para devolverla al perdonar. */
  onStrike(userId: string, at = Date.now()): { day: string; xp: number; change: LevelChange | null } {
    const day = dayKey(new Date(at), this.d.timeZone);
    const { before, after } = this.store.removeDay(userId, day);
    return { day, xp: before - after, change: this.change(userId, before, after) };
  }

  /** Perdon de GyroP: devuelve la XP que quitaron los machetazos y levanta el castigo de esos dias (ruleta y monedas). */
  onForgive(userId: string, taken: { day: string; xp: number }[], at = Date.now()): LevelChange | null {
    const beforeXp = this.store.get(userId).xp;
    for (const t of taken) this.store.restoreDay(userId, t.day, t.xp);
    const change = this.change(userId, beforeXp, this.store.get(userId).xp);
    try {
      this.afterAward?.(userId, dayKey(new Date(at), this.d.timeZone));
    } catch {
      /* las monedas no deben frenar el perdon */
    }
    return change;
  }

  /**
   * Papu con el rol de honor (dado a mano o de antes de que el honor pasara al 40): empieza al menos en el piso del rol.
   * A quien ya esta mas arriba no lo toca (los Papus de honor del nivel 25 conservan su nivel, decision de GyroP).
   */
  ensureHonor(userId: string): LevelChange | null {
    const rec = this.store.get(userId);
    if (rec.prestige > 0) return null;
    const floor = this.d.settings.honor.pisoRolManual ?? this.d.settings.honor.nivel;
    const { before, after } = this.store.raiseTo(userId, xpToReach(this.d.settings, floor));
    return this.change(userId, before, after);
  }

  /** Prestigio: solo en el nivel maximo. Devuelve las estrellas nuevas, o null si no corresponde. */
  prestige(userId: string): number | null {
    const rec = this.store.get(userId);
    if (levelFor(this.d.settings, rec.xp) < this.d.settings.curva.maximo) return null;
    return this.store.prestige(userId);
  }

  private award(userId: string, amount: number, at: number): LevelChange | null {
    if (!this.canEarn(userId, at)) return null;
    const day = dayKey(new Date(at), this.d.timeZone);
    const { before, after } = this.store.add(userId, amount, day);
    const change = this.change(userId, before, after);
    if (change && change.to > change.from) this.store.markLevelUp(userId, day);
    try {
      this.afterAward?.(userId, day);
    } catch {
      /* las monedas no deben frenar la XP */
    }
    return change;
  }

  private change(userId: string, beforeXp: number, afterXp: number): LevelChange | null {
    const s = this.d.settings;
    const from = levelFor(s, beforeXp);
    const to = levelFor(s, afterXp);
    if (from === to) return null;
    const up = to > from;
    const rank = rankFor(s, to);
    const prestige = this.store.get(userId).prestige;
    return {
      userId,
      from,
      to,
      prestige,
      rankUp: up && rank.index !== rankFor(s, from).index ? rank.nombre : null,
      // Con estrellas ya es de honor: volver a pasar por el nivel no se anuncia otra vez.
      honor: up && prestige === 0 && from < s.honor.nivel && to >= s.honor.nivel,
      max: up && to >= s.curva.maximo,
    };
  }

  private sweepGates(now: number): void {
    for (const [id, g] of this.gates) if (now - g.lastAt > 60_000) this.gates.delete(id);
  }

  // ───────────────────────── consultas ─────────────────────────

  /** Cuota diaria con los Vocaloids segun el nivel (con el piso de transicion de los veteranos). */
  limitFor(userId: string, now = new Date()): number {
    const rec = this.store.get(userId);
    return quotaWithTransition(this.d.settings, levelFor(this.d.settings, rec.xp), rec.prestige, rec.veteran, now);
  }

  /** Todo lo que muestra la tarjeta de nivel. */
  snapshot(userId: string) {
    const rec = this.store.get(userId);
    const p = progress(this.d.settings, rec.xp);
    return { ...rec, ...p, rank: rankFor(this.d.settings, p.level), position: this.store.position(userId), max: this.d.settings.curva.maximo };
  }

  /**
   * Ranking por nivel (estrellas, despues XP): solo quienes siguen en el servidor y sin GyroP. Los empates en XP
   * comparten puesto.
   */
  standings(isMember: (userId: string) => boolean): Standing[] {
    const out: Standing[] = [];
    let prev: { xp: number; prestige: number } | null = null;
    for (const rec of this.store.ranked()) {
      if (this.unranked(rec.userId) || !isMember(rec.userId)) continue;
      const p = progress(this.d.settings, rec.xp);
      const tied = prev && prev.xp === rec.xp && prev.prestige === rec.prestige;
      out.push({
        userId: rec.userId,
        position: tied ? out[out.length - 1]!.position : out.length + 1,
        level: p.level,
        prestige: rec.prestige,
        into: p.into,
        needed: p.needed,
        rank: rankFor(this.d.settings, p.level),
      });
      prev = rec;
    }
    return out;
  }

  level(userId: string): { level: number; prestige: number } {
    const rec = this.store.get(userId);
    return { level: levelFor(this.d.settings, rec.xp), prestige: rec.prestige };
  }

  // ───────────────────────── intercambios (src/intercambios/) ─────────────────────────

  /**
   * XP que cuestan `n` niveles de un Papu desde donde está: la de sus `n` niveles de abajo (conserva lo que lleva del
   * nivel actual). Null si bajaría del nivel 1.
   */
  xpOfLevels(userId: string, n: number): number | null {
    if (n <= 0) return 0;
    const { level } = this.level(userId);
    if (level - n < 1) return null;
    return xpToReach(this.d.settings, level) - xpToReach(this.d.settings, level - n);
  }

  /** XP que le cabe hasta el nivel máximo (lo que pase de ahí se perdería al prestigiar). */
  xpRoom(userId: string): number {
    return Math.max(0, xpToReach(this.d.settings, this.d.settings.curva.maximo) - this.store.get(userId).xp);
  }

  /** Intercambio: pasa XP sin contarla como actividad del día. Null si no le alcanza. */
  transferXp(fromId: string, toId: string, amount: number): { from: LevelChange | null; to: LevelChange | null } | null {
    const r = this.store.moveXp(fromId, toId, amount);
    if (!r) return null;
    return { from: this.change(fromId, r.from.before, r.from.after), to: this.change(toId, r.to.before, r.to.after) };
  }
}
