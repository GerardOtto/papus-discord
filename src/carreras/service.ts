// Carreras de los Vocaloids (PLAN §3.14): abre la carrera con la cuota de la mañana y la bolsa base de Teto, vende
// boletos (solo Shaulitas, que se ganan jugando), sortea la carrera al cerrar las apuestas (semilla guardada: la
// animacion solo la muestra) y paga con apuestas mutuas. Si el bot se reinicia antes del final, todo lo apostado se
// devuelve (recover). Sin Discord: src/discord/carreras.ts es el canal.
import { randomBytes, randomInt } from "node:crypto";
import { kvGet, kvSet, transaction, type Db } from "../db/database";
import { dayKey } from "../time";
import type { CoinService } from "../coins/service";
import {
  bolsaBase,
  checkBoleto,
  cuotasBolsa,
  cuotasEnVivo,
  pagoBoleto,
  planCarreras,
  probabilidades,
  seeded,
  simularCarrera,
  TIPOS,
  type CarreraSettings,
  type FrasesCarrera,
  type Probabilidades,
  type ResultadoCarrera,
  type Tipo,
} from "./rules";

export type EstadoCarrera = "abierta" | "corriendo" | "terminada" | "devuelta";

export interface Carrera {
  id: string;
  corredores: string[];
  probs: Probabilidades;
  /** Bolsa base de Teto (por tipo, en el orden de `corredores`). */
  base: Record<Tipo, number[]>;
  canal: string | null;
  mensaje: string | null;
  lanzadaPor: string | null;
  estado: EstadoCarrera;
  semilla: number | null;
  /** Orden de llegada (ids), al terminar. */
  llegada: string[] | null;
  /** Lo que pagó cada bolsa a cada corredor acertado (id → cuota), al terminar. */
  cuotas: Record<Tipo, Record<string, number>> | null;
  creadaAt: number;
  cierraAt: number;
}

export interface Boleto {
  id: number;
  userId: string;
  corredor: string;
  tipo: Tipo;
  cantidad: number;
  pago: number;
}

export type ResultadoBoleto = { ok: true; boleto: Boleto; total: number; monedas: number } | { ok: false; motivo: string };

export interface Liquidacion {
  carrera: Carrera;
  resultado: ResultadoCarrera;
  /** Todos los boletos con su pago (0 = no acertó). */
  boletos: Boleto[];
  /** Lo que cobró cada Papu en total (solo los que cobraron algo), de mayor a menor. */
  cobros: { userId: string; cobro: number; apostado: number }[];
  /** Shaulitas repartidas a los boletos de cada corredor. */
  repartido: Record<string, number>;
}

export interface CarreraServiceDeps {
  db: Db;
  settings: CarreraSettings;
  frases: FrasesCarrera;
  coins: CoinService;
  now?: () => number;
  /** Azar de la cuota de la mañana y de la elección (la carrera usa su semilla). */
  rnd?: () => number;
  /** Semilla de la carrera (por defecto, criptográfica). */
  semilla?: () => number;
  /** Horarios de las peleas automáticas (para no chocar con ellas) y su zona. */
  peleas?: { horarios: string[]; zona: string };
}

/** Una hora del día que se pasó (bots apagados) ya no se usa: la carrera se pierde. */
const LATE_MS = 15 * 60_000;

interface Row {
  id: string;
  corredores: string;
  probs: string;
  base: string;
  canal: string | null;
  mensaje: string | null;
  lanzada_por: string | null;
  estado: EstadoCarrera;
  semilla: number | null;
  llegada: string | null;
  cuotas: string | null;
  creada_at: number;
  cierra_at: number;
}

const toCarrera = (r: Row): Carrera => ({
  id: r.id,
  corredores: JSON.parse(r.corredores) as string[],
  probs: JSON.parse(r.probs) as Probabilidades,
  base: JSON.parse(r.base) as Record<Tipo, number[]>,
  canal: r.canal,
  mensaje: r.mensaje,
  lanzadaPor: r.lanzada_por,
  estado: r.estado,
  semilla: r.semilla,
  llegada: r.llegada ? (JSON.parse(r.llegada) as string[]) : null,
  cuotas: r.cuotas ? (JSON.parse(r.cuotas) as Record<Tipo, Record<string, number>>) : null,
  creadaAt: r.creada_at,
  cierraAt: r.cierra_at,
});

export class CarreraService {
  private readonly now: () => number;
  private readonly rnd: () => number;
  private readonly semilla: () => number;

  constructor(private readonly d: CarreraServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
    this.semilla = d.semilla ?? (() => randomInt(0, 2 ** 31));
  }

  get settings(): CarreraSettings {
    return this.d.settings;
  }

  /** Ids de los corredores de la config. */
  get ids(): string[] {
    return Object.keys(this.d.settings.corredores);
  }

  // ───────────────────────── horario ─────────────────────────

  private day(t: number): string {
    return dayKey(new Date(t), this.d.settings.horario.zona);
  }

  /** Horas de las carreras automáticas del día de `t` (se sortean una vez por día y se guardan). */
  slots(t = this.now()): number[] {
    const key = `carreras:plan:${this.day(t)}`;
    const saved = kvGet(this.d.db, key);
    if (saved) return JSON.parse(saved) as number[];
    const plan = planCarreras(this.d.settings, this.day(t), this.d.peleas?.horarios ?? [], this.d.peleas?.zona ?? this.d.settings.horario.zona, this.rnd);
    kvSet(this.d.db, key, JSON.stringify(plan));
    return plan;
  }

  /** Hora que toca ahora y nadie usó (o null). Las que pasaron hace más de 15 min se pierden. Con una carrera en curso, nada. */
  dueSlot(t = this.now()): number | null {
    if (this.active()) return null;
    const used = new Set(JSON.parse(kvGet(this.d.db, `carreras:usadas:${this.day(t)}`) ?? "[]") as number[]);
    return this.slots(t).find((x) => !used.has(x) && x <= t && t - x <= LATE_MS) ?? null;
  }

  /** Marca una hora como usada (se haya corrido o se haya perdido por falta de Papus). */
  useSlot(slot: number): void {
    const key = `carreras:usadas:${this.day(slot)}`;
    const used = JSON.parse(kvGet(this.d.db, key) ?? "[]") as number[];
    kvSet(this.d.db, key, JSON.stringify([...used, slot]));
  }

  /** La próxima carrera automática después de `t` (hoy o mañana), o null. */
  nextSlot(t = this.now()): number | null {
    const used = new Set(JSON.parse(kvGet(this.d.db, `carreras:usadas:${this.day(t)}`) ?? "[]") as number[]);
    const hoy = this.slots(t).find((x) => x > t && !used.has(x));
    if (hoy) return hoy;
    return this.slots(t + 24 * 3_600_000).find((x) => x > t) ?? null;
  }

  // ───────────────────────── abrir ─────────────────────────

  private row(id: string): Row | undefined {
    return this.d.db.prepare("SELECT * FROM carreras WHERE id = ?").get(id) as unknown as Row | undefined;
  }

  get(id: string): Carrera | null {
    const r = this.row(id);
    return r ? toCarrera(r) : null;
  }

  /** La carrera en curso (abierta o corriendo), si hay. Solo hay una a la vez. */
  active(): Carrera | null {
    const r = this.d.db.prepare("SELECT * FROM carreras WHERE estado IN ('abierta', 'corriendo') ORDER BY creada_at DESC LIMIT 1").get() as unknown as Row | undefined;
    return r ? toCarrera(r) : null;
  }

  /** Corredores de la última carrera (para no repetir el mismo grupo). */
  lastGroup(): string[] | null {
    const r = this.d.db.prepare("SELECT corredores FROM carreras ORDER BY creada_at DESC LIMIT 1").get() as { corredores: string } | undefined;
    return r ? (JSON.parse(r.corredores) as string[]) : null;
  }

  /**
   * Abre una carrera con esos corredores: calcula la cuota de la mañana (simulando) y la bolsa base de Teto. Las
   * apuestas duran `apuestas.minutos`. null si ya hay otra en curso.
   */
  open(corredores: string[], canal: string | null, lanzadaPor: string | null = null): Carrera | null {
    if (new Set(corredores).size !== corredores.length) throw new Error("un corredor repetido");
    for (const id of corredores) if (!this.d.settings.corredores[id]) throw new Error(`${id} no corre (no está en config/carreras.json)`);
    if (this.active()) return null;
    const probs = probabilidades(this.d.settings, corredores.map((id) => this.d.settings.corredores[id]!), this.d.frases, this.rnd);
    const base = bolsaBase(this.d.settings, probs);
    const t = this.now();
    const id = randomBytes(5).toString("hex");
    this.d.db
      .prepare("INSERT INTO carreras (id, corredores, probs, base, canal, lanzada_por, creada_at, cierra_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, JSON.stringify(corredores), JSON.stringify(probs), JSON.stringify(base), canal, lanzadaPor, t, t + this.d.settings.apuestas.minutos * 60_000);
    return this.get(id);
  }

  setMessage(id: string, canal: string, mensaje: string): void {
    this.d.db.prepare("UPDATE carreras SET canal = ?, mensaje = ? WHERE id = ?").run(canal, mensaje, id);
  }

  // ───────────────────────── apostar ─────────────────────────

  coinsOf(userId: string): number {
    return this.d.coins.wallet(userId).monedas;
  }

  boletos(id: string): Boleto[] {
    return (this.d.db.prepare("SELECT id, user_id, corredor, tipo, cantidad, pago FROM boletos WHERE carrera = ? ORDER BY id").all(id) as {
      id: number;
      user_id: string;
      corredor: string;
      tipo: Tipo;
      cantidad: number;
      pago: number;
    }[]).map((r) => ({ id: r.id, userId: r.user_id, corredor: r.corredor, tipo: r.tipo, cantidad: r.cantidad, pago: r.pago }));
  }

  boletosDe(id: string, userId: string): Boleto[] {
    return this.boletos(id).filter((b) => b.userId === userId);
  }

  /** Bolsas de cada tipo (lo apostado a cada corredor, con la base de Teto), en el orden de la carrera. */
  bolsas(c: Carrera): Record<Tipo, number[]> {
    const out = { ganador: [...c.base.ganador], segundo: [...c.base.segundo], tercero: [...c.base.tercero] };
    for (const b of this.boletos(c.id)) {
      const i = c.corredores.indexOf(b.corredor);
      if (i >= 0) out[b.tipo][i]! += b.cantidad;
    }
    return out;
  }

  /** Lo que apostaron los Papus (sin la base) y cuántos Papus distintos. */
  apostado(c: Carrera): { total: number; papus: number; porTipo: Record<Tipo, number> } {
    const bs = this.boletos(c.id);
    const porTipo = { ganador: 0, segundo: 0, tercero: 0 };
    for (const b of bs) porTipo[b.tipo] += b.cantidad;
    return { total: bs.reduce((a, b) => a + b.cantidad, 0), papus: new Set(bs.map((b) => b.userId)).size, porTipo };
  }

  /** Cuotas en vivo para el tablero (Ganador exacta; Segundo y Tercero aproximadas). */
  enVivo(c: Carrera): Record<Tipo, number[]> {
    return cuotasEnVivo(this.d.settings, this.bolsas(c));
  }

  /** Compra un boleto: `cantidad` Shaulitas a `corredor` en la bolsa `tipo`. */
  apostar(id: string, userId: string, corredor: string, tipo: Tipo, cantidad: number): ResultadoBoleto {
    const c = this.get(id);
    if (!c || c.estado !== "abierta" || this.now() >= c.cierraAt) return { ok: false, motivo: "Las apuestas de esta carrera ya se cerraron. 🏇" };
    if (!c.corredores.includes(corredor)) return { ok: false, motivo: "Ese Vocaloid no corre en esta carrera." };
    if (!TIPOS.includes(tipo)) return { ok: false, motivo: "Elige Ganador, Segundo o Tercero." };
    const previa = this.boletosDe(id, userId).reduce((a, b) => a + b.cantidad, 0);
    const check = checkBoleto(this.d.settings, cantidad, previa, this.coinsOf(userId));
    if (!check.ok) return check;
    return transaction(this.d.db, () => {
      const w = this.d.coins.spend(userId, cantidad, `boleto carrera ${id}`);
      if (!w) return { ok: false as const, motivo: "No te alcanzan las Shaulitas." };
      const r = this.d.db.prepare("INSERT INTO boletos (carrera, user_id, corredor, tipo, cantidad, at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, corredor, tipo, cantidad, this.now());
      const boleto: Boleto = { id: Number(r.lastInsertRowid), userId, corredor, tipo, cantidad, pago: 0 };
      return { ok: true as const, boleto, total: check.total, monedas: w.monedas };
    });
  }

  // ───────────────────────── correr y pagar ─────────────────────────

  /** La carrera ya sorteada (desde su semilla): la misma semilla da siempre la misma carrera. */
  resultado(c: Carrera, nombres: readonly string[]): ResultadoCarrera | null {
    if (c.semilla === null) return null;
    return simularCarrera(this.d.settings, c.corredores.map((id) => this.d.settings.corredores[id]!), nombres, this.d.frases, seeded(c.semilla));
  }

  /** Cierra las apuestas y sortea la carrera (guarda la semilla y la llegada). null si ya no está abierta. */
  correr(id: string, nombres: readonly string[]): ResultadoCarrera | null {
    const c = this.get(id);
    if (!c || c.estado !== "abierta") return null;
    const semilla = this.semilla();
    const r = this.resultado({ ...c, semilla }, nombres)!;
    const llegada = r.llegada.map((i) => c.corredores[i]!);
    this.d.db.prepare("UPDATE carreras SET estado = 'corriendo', semilla = ?, llegada = ? WHERE id = ?").run(semilla, JSON.stringify(llegada), id);
    return r;
  }

  /** Paga los boletos acertados (apuestas mutuas) y cierra la carrera. Se llama al terminar de mostrarla. */
  liquidar(id: string, nombres: readonly string[]): Liquidacion | null {
    const c = this.get(id);
    if (!c || c.estado !== "corriendo" || !c.llegada) return null;
    const resultado = this.resultado(c, nombres)!;
    const bolsas = this.bolsas(c);
    const cuotas = {} as Record<Tipo, Record<string, number>>;
    for (const tipo of TIPOS) {
      const m = cuotasBolsa(this.d.settings, tipo, bolsas[tipo], resultado.llegada);
      cuotas[tipo] = Object.fromEntries([...m].map(([i, q]) => [c.corredores[i]!, q]));
    }
    const boletos = this.boletos(id);
    const repartido: Record<string, number> = Object.fromEntries(c.corredores.map((x) => [x, 0]));
    const porPapu = new Map<string, { cobro: number; apostado: number }>();
    transaction(this.d.db, () => {
      for (const b of boletos) {
        const q = cuotas[b.tipo][b.corredor];
        b.pago = q ? pagoBoleto(b.cantidad, q) : 0;
        const p = porPapu.get(b.userId) ?? { cobro: 0, apostado: 0 };
        p.apostado += b.cantidad;
        p.cobro += b.pago;
        porPapu.set(b.userId, p);
        if (!b.pago) continue;
        repartido[b.corredor]! += b.pago;
        this.d.db.prepare("UPDATE boletos SET pago = ? WHERE id = ?").run(b.pago, b.id);
      }
      for (const [userId, p] of porPapu) if (p.cobro) this.d.coins.adjust(userId, "monedas", p.cobro, `carrera ${id} (boletos acertados)`);
      this.d.db.prepare("UPDATE carreras SET estado = 'terminada', cuotas = ?, terminada_at = ? WHERE id = ?").run(JSON.stringify(cuotas), this.now(), id);
    });
    const cobros = [...porPapu].filter(([, p]) => p.cobro > 0).map(([userId, p]) => ({ userId, ...p })).sort((a, b) => b.cobro - a.cobro);
    return { carrera: { ...c, estado: "terminada", cuotas }, resultado, boletos, cobros, repartido };
  }

  /**
   * Carreras que quedaron a medias (el bot se reinició): devuelve todos los boletos y las marca 'devuelta'. Se llama
   * al arrancar, antes de abrir otra.
   */
  recover(): { carrera: Carrera; devueltos: Boleto[] }[] {
    const rows = this.d.db.prepare("SELECT * FROM carreras WHERE estado IN ('abierta', 'corriendo')").all() as unknown as Row[];
    return rows.map((row) =>
      transaction(this.d.db, () => {
        const devueltos = this.boletos(row.id);
        const porPapu = new Map<string, number>();
        for (const b of devueltos) porPapu.set(b.userId, (porPapu.get(b.userId) ?? 0) + b.cantidad);
        for (const [userId, n] of porPapu) this.d.coins.adjust(userId, "monedas", n, `carrera ${row.id} cancelada (devolución)`);
        this.d.db.prepare("UPDATE carreras SET estado = 'devuelta', terminada_at = ? WHERE id = ?").run(this.now(), row.id);
        return { carrera: toCarrera({ ...row, estado: "devuelta" }), devueltos };
      }),
    );
  }

  /** GyroP o un Mod cancelan la carrera en curso (antes del final): se devuelve todo. */
  cancel(): { carrera: Carrera; devueltos: Boleto[] } | null {
    const c = this.active();
    if (!c) return null;
    return this.recover().find((x) => x.carrera.id === c.id) ?? null;
  }

  /** Carreras lanzadas hoy por un Papu (desde `desde`, ms), para el tope de su membresía. */
  lanzadasDesde(userId: string, desde: number): number {
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM carreras WHERE lanzada_por = ? AND creada_at >= ? AND estado != 'devuelta'").get(userId, desde) as { n: number }).n;
  }
}
