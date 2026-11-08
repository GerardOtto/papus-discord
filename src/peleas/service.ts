// 1vs1 de los Vocaloids (PLAN §3.7): abre la pelea con la cuota de cada uno, cobra las apuestas (solo Shaula-coins
// ganadas), simula la pelea al cerrar las apuestas y paga a quien acerto. Si el bot se reinicia antes del final, todo
// lo apostado se devuelve (recover). Sin Discord: src/discord/peleas.ts es el canal.
import { randomBytes } from "node:crypto";
import type { FighterId } from "./rules";
import { transaction, type Db } from "../db/database";
import type { CoinService } from "../coins/service";
import { checkBet, oddsFor, payout, simulate, winChance, type Luchador, type PeleaSettings, type Resultado } from "./rules";

export type EstadoPelea = "abierta" | "peleando" | "terminada" | "devuelta";

export interface Pelea {
  id: string;
  a: FighterId;
  b: FighterId;
  cuotas: [number, number];
  canal: string | null;
  mensaje: string | null;
  estado: EstadoPelea;
  ganador: FighterId | null;
  creadaAt: number;
  cierraAt: number;
}

export interface Apuesta {
  userId: string;
  lado: FighterId;
  cantidad: number;
  pago: number;
}

export interface Bando {
  monto: number;
  papus: number;
}

export type BetResult = { ok: true; total: number; lado: FighterId; cuota: number; ganadas: number } | { ok: false; motivo: string };

export interface Liquidacion {
  pelea: Pelea;
  resultado: Resultado;
  /** Quien acerto (pago = lo que recibio, apuesta incluida), de mayor a menor pago. */
  ganadores: Apuesta[];
  perdedores: Apuesta[];
}

export interface PeleaServiceDeps {
  db: Db;
  settings: PeleaSettings;
  coins: CoinService;
  now?: () => number;
  rnd?: () => number;
}

interface Row {
  id: string;
  a: string;
  b: string;
  cuota_a: number;
  cuota_b: number;
  canal: string | null;
  mensaje: string | null;
  estado: EstadoPelea;
  ganador: string | null;
  creada_at: number;
  cierra_at: number;
}

const toPelea = (r: Row): Pelea => ({
  id: r.id,
  a: r.a as FighterId,
  b: r.b as FighterId,
  cuotas: [r.cuota_a, r.cuota_b],
  canal: r.canal,
  mensaje: r.mensaje,
  estado: r.estado,
  ganador: r.ganador as FighterId | null,
  creadaAt: r.creada_at,
  cierraAt: r.cierra_at,
});

export class PeleaService {
  private readonly now: () => number;
  private readonly rnd: () => number;
  /** Probabilidad de ganar de cada pareja (izquierda vs derecha): se simula una vez por pareja. */
  private readonly chances = new Map<string, number>();
  /** Pelea ya simulada (entre que se cierran las apuestas y se paga). */
  private readonly results = new Map<string, Resultado>();

  constructor(private readonly d: PeleaServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
  }

  get settings(): PeleaSettings {
    return this.d.settings;
  }

  /** Vocaloids que pelean (los de la config). */
  get fighters(): FighterId[] {
    return Object.keys(this.d.settings.luchadores) as FighterId[];
  }

  fighter(id: FighterId): Luchador {
    const l = this.d.settings.luchadores[id];
    if (!l) throw new Error(`${id} no pelea (no está en config/peleas.json)`);
    return l;
  }

  /** Probabilidad de que gane `a` contra `b`. */
  chance(a: FighterId, b: FighterId): number {
    const key = `${a}|${b}`;
    let p = this.chances.get(key) ?? (this.chances.has(`${b}|${a}`) ? 1 - this.chances.get(`${b}|${a}`)! : undefined);
    if (p === undefined) {
      p = winChance(this.d.settings, this.fighter(a), this.fighter(b), this.rnd);
      this.chances.set(key, p);
    }
    return p;
  }

  odds(a: FighterId, b: FighterId): [number, number] {
    const p = this.chance(a, b);
    return [oddsFor(this.d.settings, p), oddsFor(this.d.settings, 1 - p)];
  }

  // ───────────────────────── abrir ─────────────────────────

  private row(id: string): Row | undefined {
    return this.d.db.prepare("SELECT * FROM peleas WHERE id = ?").get(id) as unknown as Row | undefined;
  }

  get(id: string): Pelea | null {
    const r = this.row(id);
    return r ? toPelea(r) : null;
  }

  /** La pelea en curso (abierta o peleando), si hay. Solo hay una a la vez. */
  active(): Pelea | null {
    const r = this.d.db.prepare("SELECT * FROM peleas WHERE estado IN ('abierta', 'peleando') ORDER BY creada_at DESC LIMIT 1").get() as unknown as Row | undefined;
    return r ? toPelea(r) : null;
  }

  /** La pareja de la ultima pelea (para no repetirla en la siguiente automatica). */
  lastPair(): [FighterId, FighterId] | null {
    const r = this.d.db.prepare("SELECT a, b FROM peleas ORDER BY creada_at DESC LIMIT 1").get() as { a: string; b: string } | undefined;
    return r ? [r.a as FighterId, r.b as FighterId] : null;
  }

  /** Abre una pelea (apuestas abiertas por `apuestas.minutos`). null si ya hay otra en curso. */
  open(a: FighterId, b: FighterId, canal: string | null): Pelea | null {
    if (a === b) throw new Error("un Vocaloid no pelea contra sí mismo");
    this.fighter(a);
    this.fighter(b);
    if (this.active()) return null;
    const [ca, cb] = this.odds(a, b);
    const t = this.now();
    const id = randomBytes(5).toString("hex");
    this.d.db
      .prepare("INSERT INTO peleas (id, a, b, cuota_a, cuota_b, canal, creada_at, cierra_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, a, b, ca, cb, canal, t, t + this.d.settings.apuestas.minutos * 60_000);
    return this.get(id);
  }

  setMessage(id: string, canal: string, mensaje: string): void {
    this.d.db.prepare("UPDATE peleas SET canal = ?, mensaje = ? WHERE id = ?").run(canal, mensaje, id);
  }

  // ───────────────────────── apostar ─────────────────────────

  /** Shaula-coins ganadas de un Papu (lo unico que se apuesta). */
  coinsOf(userId: string): number {
    return this.d.coins.wallet(userId).ganadas;
  }

  bets(id: string): Apuesta[] {
    return (this.d.db.prepare("SELECT user_id, lado, cantidad, pago FROM apuestas WHERE pelea = ? ORDER BY at").all(id) as { user_id: string; lado: string; cantidad: number; pago: number }[]).map((r) => ({
      userId: r.user_id,
      lado: r.lado as FighterId,
      cantidad: r.cantidad,
      pago: r.pago,
    }));
  }

  betOf(id: string, userId: string): Apuesta | null {
    return this.bets(id).find((x) => x.userId === userId) ?? null;
  }

  /** Lo apostado a cada lado. */
  totals(p: Pelea): [Bando, Bando] {
    const out: [Bando, Bando] = [
      { monto: 0, papus: 0 },
      { monto: 0, papus: 0 },
    ];
    for (const x of this.bets(p.id)) {
      const k = x.lado === p.a ? 0 : 1;
      out[k].monto += x.cantidad;
      out[k].papus++;
    }
    return out;
  }

  /** Apuesta (o suma a su apuesta) `cantidad` Shaula-coins ganadas a `lado`. */
  bet(id: string, userId: string, lado: FighterId, cantidad: number): BetResult {
    const p = this.get(id);
    if (!p || p.estado !== "abierta" || this.now() >= p.cierraAt) return { ok: false, motivo: "Las apuestas de esta pelea ya se cerraron. ⚔️" };
    if (lado !== p.a && lado !== p.b) return { ok: false, motivo: "Ese Vocaloid no está en esta pelea." };
    const prev = this.betOf(id, userId);
    if (prev && prev.lado !== lado) return { ok: false, motivo: "Ya apostaste por el otro Vocaloid: en cada pelea se apuesta a uno solo." };
    const ganadas = this.d.coins.wallet(userId).ganadas;
    const check = checkBet(this.d.settings, cantidad, prev?.cantidad ?? 0, ganadas);
    if (!check.ok) return check;
    return transaction(this.d.db, () => {
      const w = this.d.coins.spendGanadas(userId, cantidad, `apuesta pelea ${id}`);
      if (!w) return { ok: false as const, motivo: "No te alcanzan las Shaula-coins ganadas." };
      this.d.db
        .prepare("INSERT INTO apuestas (pelea, user_id, lado, cantidad, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(pelea, user_id) DO UPDATE SET cantidad = cantidad + excluded.cantidad")
        .run(id, userId, lado, cantidad, this.now());
      return { ok: true as const, total: check.total, lado, cuota: lado === p.a ? p.cuotas[0] : p.cuotas[1], ganadas: w.ganadas };
    });
  }

  // ───────────────────────── pelear y pagar ─────────────────────────

  /** Cierra las apuestas y simula la pelea (el resultado se guarda hasta pagar). null si ya no esta abierta. */
  fight(id: string): Resultado | null {
    const p = this.get(id);
    if (!p || p.estado !== "abierta") return null;
    const r = simulate(this.d.settings, this.fighter(p.a), this.fighter(p.b), this.rnd);
    this.d.db.prepare("UPDATE peleas SET estado = 'peleando', ganador = ?, turnos = ? WHERE id = ?").run(r.ganador === 0 ? p.a : p.b, r.turnos.length, id);
    this.results.set(id, r);
    return r;
  }

  /** Paga a quien acerto (apuesta × cuota, en ganadas) y cierra la pelea. Se llama al terminar de mostrarla. */
  settle(id: string): Liquidacion | null {
    const p = this.get(id);
    const r = this.results.get(id);
    if (!p || p.estado !== "peleando" || !r || !p.ganador) return null;
    const cuota = p.ganador === p.a ? p.cuotas[0] : p.cuotas[1];
    const ganadores: Apuesta[] = [];
    const perdedores: Apuesta[] = [];
    transaction(this.d.db, () => {
      for (const x of this.bets(id)) {
        if (x.lado !== p.ganador) {
          perdedores.push(x);
          continue;
        }
        const pago = payout(x.cantidad, cuota);
        this.d.coins.adjust(x.userId, "ganadas", pago, `pelea ${id} ganada`);
        this.d.db.prepare("UPDATE apuestas SET pago = ? WHERE pelea = ? AND user_id = ?").run(pago, id, x.userId);
        ganadores.push({ ...x, pago });
      }
      this.d.db.prepare("UPDATE peleas SET estado = 'terminada', terminada_at = ? WHERE id = ?").run(this.now(), id);
    });
    this.results.delete(id);
    ganadores.sort((x, y) => y.pago - x.pago);
    perdedores.sort((x, y) => y.cantidad - x.cantidad);
    return { pelea: { ...p, estado: "terminada" }, resultado: r, ganadores, perdedores };
  }

  /**
   * Peleas que quedaron a medias (el bot se reinicio): devuelve lo apostado a cada Papu y las marca 'devuelta'.
   * Se llama al arrancar, antes de abrir otra.
   */
  recover(): { pelea: Pelea; devueltas: Apuesta[] }[] {
    const rows = this.d.db.prepare("SELECT * FROM peleas WHERE estado IN ('abierta', 'peleando')").all() as unknown as Row[];
    return rows.map((row) =>
      transaction(this.d.db, () => {
        const devueltas = this.bets(row.id);
        for (const x of devueltas) this.d.coins.adjust(x.userId, "ganadas", x.cantidad, `pelea ${row.id} cancelada (devolución)`);
        this.d.db.prepare("UPDATE peleas SET estado = 'devuelta', terminada_at = ? WHERE id = ?").run(this.now(), row.id);
        this.results.delete(row.id);
        return { pelea: toPelea({ ...row, estado: "devuelta" }), devueltas };
      }),
    );
  }

  /** GyroP cancela la pelea en curso (antes del final): se devuelve todo. */
  cancel(): { pelea: Pelea; devueltas: Apuesta[] } | null {
    const p = this.active();
    if (!p) return null;
    return this.recover().find((x) => x.pelea.id === p.id) ?? null;
  }
}
