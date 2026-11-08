// Sorteo de los Papus (PLAN §3.5): GyroP pone a todos los Papus en la ruleta con un premio al azar; el giro cae en uno
// y GyroP decide si se lo queda, si se gira otra vez sin el (para no premiar a un AFK) o si se lo da a otro. Los sorteos
// abiertos viven en memoria (duran lo que GyroP tarda en decidir); al confirmar se aplica el premio y queda una fila en
// la tabla `sorteos`. Sin Discord: src/discord/sorteo.ts dibuja el GIF, muestra los botones y lo publica.
import type { Db } from "../db/database";
import { xpToReach } from "../levels/rules";
import type { LevelChange, LevelService } from "../levels/service";
import type { Quota } from "../quota/quota";
import { pickPrize, prizeXp } from "../ruleta/rules";
import { fixedName, pickWinner, type SorteoPrize, type SorteoSettings } from "./rules";

export interface Candidate {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface Draw {
  id: string;
  prize: SorteoPrize;
  /** Todos los Papus de la ruleta, en el orden de las casillas. */
  candidates: Candidate[];
  /** Los que GyroP descarto en este sorteo (no vuelven a salir). */
  excluded: Set<string>;
  winner: Candidate;
  /** Canal donde se publica el resultado (donde GyroP uso /sorteo). */
  channelId: string;
  /** Cuantas veces se giro (para el registro). */
  spins: number;
}

/** Premio que GyroP escribe en /sorteo: texto, y/o XP, niveles y mensajes exactos. */
export interface CustomPrize {
  texto?: string | null;
  xp?: number | null;
  niveles?: number | null;
  mensajes?: number | null;
}

export interface SorteoResult {
  draw: Draw;
  /** XP entregada (la del premio de XP, o la fija mas la de los niveles; 0 en los manuales). */
  xp: number;
  /** Mensajes extra con los Vocaloids, solo hoy (los que caben en su cuota). */
  messages: number;
  /** Mensajes que no cupieron (cuota llena) y se cambiaron por XP (ya sumada en `xp`). */
  overflow: number;
  change: LevelChange | null;
  levelBefore: number;
  levelAfter: number;
}

export interface SorteoServiceDeps {
  db: Db;
  settings: SorteoSettings;
  levels: LevelService;
  quota: Quota;
  now?: () => number;
  rnd?: () => number;
}

/** Sorteos abiertos a la vez como maximo (si GyroP abre mas sin cerrarlos, se olvidan los mas viejos). */
const MAX_OPEN = 10;

export class SorteoService {
  private readonly now: () => number;
  private readonly rnd: () => number;
  private readonly open = new Map<string, Draw>();
  private seq = 0;

  constructor(private readonly d: SorteoServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
  }

  get settings(): SorteoSettings {
    return this.d.settings;
  }

  get(drawId: string): Draw | null {
    return this.open.get(drawId) ?? null;
  }

  /**
   * Abre un sorteo y da el primer giro. Premio: el que escribio GyroP (con XP, niveles o mensajes se entrega solo y el
   * texto es su nombre; solo con texto, lo entrega el a mano) o uno al azar de la config. Null si no hay Papus.
   */
  start(candidates: Candidate[], channelId: string, custom: CustomPrize = {}): Draw | null {
    const winner = pickWinner(candidates, new Set(), this.rnd);
    if (!winner) return null;
    const texto = custom.texto?.trim();
    const fixed = { xp: custom.xp || undefined, niveles: custom.niveles || undefined, mensajes: custom.mensajes || undefined };
    const prize: SorteoPrize =
      fixed.xp || fixed.niveles || fixed.mensajes
        ? { tipo: "fijo", ...fixed, peso: 1, icono: "🎁", nombre: texto || fixedName(fixed) }
        : texto
          ? { tipo: "manual", peso: 1, icono: "🎁", nombre: texto }
          : this.d.settings.premios[pickPrize(this.d.settings, this.rnd)]!;
    const draw: Draw = { id: `${this.now().toString(36)}${(this.seq++).toString(36)}`, prize, candidates, excluded: new Set(), winner, channelId, spins: 1 };
    this.open.set(draw.id, draw);
    for (const id of this.open.keys()) if (this.open.size > MAX_OPEN) this.open.delete(id);
    return draw;
  }

  /** Otro giro sin el que salio (ni los descartados antes). Null si el sorteo no existe o ya no queda nadie. */
  reroll(drawId: string): Draw | null {
    const draw = this.open.get(drawId);
    if (!draw) return null;
    const excluded = new Set([...draw.excluded, draw.winner.id]);
    const winner = pickWinner(draw.candidates, excluded, this.rnd);
    if (!winner) return null;
    draw.excluded = excluded;
    draw.winner = winner;
    draw.spins++;
    return draw;
  }

  /** GyroP se lo da a otro Papu (si no estaba en la ruleta, se agrega para que el GIF caiga en el). */
  assign(drawId: string, who: Candidate): Draw | null {
    const draw = this.open.get(drawId);
    if (!draw) return null;
    if (!draw.candidates.some((c) => c.id === who.id)) draw.candidates.push(who);
    draw.excluded.delete(who.id);
    draw.winner = draw.candidates.find((c) => c.id === who.id)!;
    return draw;
  }

  cancel(drawId: string): boolean {
    return this.open.delete(drawId);
  }

  /** XP para subir `n` niveles completos desde el nivel actual (sin pasar del maximo; el avance dentro del nivel se queda). */
  private levelsXp(userId: string, n: number): number {
    const s = this.d.levels.settings;
    const { level } = this.d.levels.snapshot(userId);
    return xpToReach(s, Math.min(s.curva.maximo, level + n)) - xpToReach(s, level);
  }

  /** El ganador se queda el premio: se entrega la XP y los mensajes (los manuales los entrega GyroP) y se cierra el sorteo. */
  confirm(drawId: string): SorteoResult | null {
    const draw = this.open.get(drawId);
    if (!draw) return null;
    this.open.delete(drawId);
    const t = this.now();
    const userId = draw.winner.id;
    const levelBefore = this.d.levels.snapshot(userId).level;
    const p = draw.prize;
    let xp = 0;
    let messages = 0;
    if (p.tipo === "xp") xp = prizeXp(this.d.settings, this.d.levels.settings, p, this.d.levels.store.get(userId).xp, 1);
    if (p.tipo === "fijo") {
      xp = this.levelsXp(userId, p.niveles ?? 0) + (p.xp ?? 0);
      messages = p.mensajes ?? 0;
    }
    // Mensajes con la cuota llena: lo que no cabe se cambia por XP (decision de GyroP, 31 oct. 2026).
    let overflow = 0;
    if (messages > 0) {
      const g = this.d.quota.grant(userId, messages, new Date(t));
      messages = g.added;
      overflow = g.overflow;
      xp += this.d.levels.overflowXp(userId, overflow);
    }
    // Con 2 o mas machetazos de Neru no gana XP (los mensajes extra si).
    if (!this.d.levels.canEarn(userId, t)) xp = 0;
    const change: LevelChange | null = this.d.levels.bonus(userId, xp, t);
    const detalle = JSON.stringify({ tipo: p.tipo, premio: p.nombre, xp, mensajes: messages, sobrante: overflow, giros: draw.spins, descartados: [...draw.excluded], papus: draw.candidates.length });
    this.d.db.prepare("INSERT INTO sorteos (user_id, detalle, at) VALUES (?, ?, ?)").run(userId, detalle, t);
    return { draw, xp, messages, overflow, change, levelBefore, levelAfter: this.d.levels.snapshot(userId).level };
  }
}
