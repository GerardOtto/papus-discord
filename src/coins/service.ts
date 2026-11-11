// Shaula-coins (PLAN §3.6): monedero, lo ganado participando, sobres, tienda, fabricar con Ecos, objetos equipados,
// pedidos de monedas (PayPal.me y transferencia, que GyroP confirma), regalo de membresía y paquete de fundadores.
// Todo el estado vive en SQLite (migración 10). Sin Discord: src/discord/tienda.ts es el menú del canal.
import { transaction, type Db } from "../db/database";
import type { LevelChange } from "../levels/service";
import { reinicioDe } from "../mercado/reinicios";
import { dayKey } from "../time";
import {
  activityCoins,
  addDays,
  dayEarnings,
  ecosFor,
  levelBonus,
  missionSobre,
  membershipBadges,
  membershipGift,
  orderCode,
  paySplit,
  priceOf,
  rollSobre,
  seasonSchedule,
  sobreKind,
  sobrePool,
  vitrinaOn,
  weekStart,
  type CoinSettings,
  type DayActivity,
  type Objeto,
  type Tipo,
  type TipoSobre,
  type Vitrina,
} from "./rules";

export interface Wallet {
  ganadas: number;
  compradas: number;
  ecos: number;
  /** Sobres comunes gratis por abrir (misiones de la ruleta, cada lunes, casilla de la ruleta). */
  gratis: number;
  /** Sobres raros y legendarios gratis por abrir (premios de la trivia; también se compran con ganadas). */
  gratisRaro: number;
  gratisLeg: number;
  sobres: number;
  sinEpica: number;
  sinLegendaria: number;
  /** Ganadas hoy por participar (sin bonos de nivel) y el tope de actividad. */
  hoy: number;
}

export type Bolsillo = "ganadas" | "compradas" | "ecos";
export type Metodo = "paypal" | "transferencia";
export type EstadoPedido = "pendiente" | "avisado" | "pagado" | "rechazado" | "vencido";

export interface Pedido {
  codigo: string;
  userId: string;
  paquete: string;
  metodo: Metodo;
  usd: number;
  clp: number;
  monedas: number;
  estado: EstadoPedido;
  creadoAt: number;
  avisadoAt: number | null;
  registroId: string | null;
}

export interface SobreResult {
  objetos: { objeto: Objeto; nuevo: boolean; ecos: number }[];
  ecos: number;
  gratis: boolean;
  tipo: TipoSobre;
  /** Objetos de más por el Helado de Kaito (0 sin él). */
  helado: number;
  wallet: Wallet;
}

export type Fail = { ok: false; motivo: string };

export interface CoinServiceDeps {
  db: Db;
  settings: CoinSettings;
  catalog: Objeto[];
  timeZone: string;
  /** Misiones de la ruleta de ese día: cumplidas y en total (src/ruleta/rules.ts: missions); sin ruleta, 0 y 0. */
  missions?: (stats: { vozMin: number; mensajes: number; subio: boolean; castigo: boolean }, userId: string, day: string) => { done: number; total: number };
  /** Helado de Kaito del mercado negro: el próximo sobre trae `extra` objetos más (se gasta un uso al abrirlo). */
  helado?: { extra: number; usos(userId: string): number; consume(userId: string): boolean };
  now?: () => number;
  rnd?: () => number;
}

const FUNDADOR_OBJETOS = ["noche-de-estreno", "estrella-fundadora", "insignia-fundador", "titulo-fundador"];
const GRATIS_COL = { comun: "gratis", raro: "gratis_raro", legendario: "gratis_leg" } as const satisfies Record<TipoSobre, keyof WalletRow>;
const DAY_MS = 86_400_000;

interface WalletRow {
  ganadas: number;
  compradas: number;
  ecos: number;
  sobres: number;
  gratis: number;
  gratis_raro: number;
  gratis_leg: number;
  sin_epica: number;
  sin_leg: number;
  semana: string | null;
  membresia_at: number | null;
}

export class CoinService {
  private readonly now: () => number;
  private readonly rnd: () => number;
  readonly byId: Map<string, Objeto>;
  /** Calendario de vitrinas de la temporada (se arma una vez: es determinista). */
  readonly schedule: Vitrina[];

  constructor(private readonly d: CoinServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
    this.byId = new Map(d.catalog.map((o) => [o.id, o]));
    this.schedule = seasonSchedule(d.settings, d.catalog);
  }

  get settings(): CoinSettings {
    return this.d.settings;
  }

  get catalog(): Objeto[] {
    return this.d.catalog;
  }

  day(t = this.now()): string {
    return dayKey(new Date(t), this.d.timeZone);
  }

  // ───────────────────────── monedero ─────────────────────────

  private row(userId: string): WalletRow {
    this.d.db.prepare("INSERT OR IGNORE INTO monedero (user_id) VALUES (?)").run(userId);
    return this.d.db.prepare("SELECT * FROM monedero WHERE user_id = ?").get(userId) as unknown as WalletRow;
  }

  private add(userId: string, bolsillo: Bolsillo, cantidad: number, motivo: string): void {
    if (!cantidad) return;
    this.row(userId);
    this.d.db.prepare(`UPDATE monedero SET ${bolsillo} = MAX(0, ${bolsillo} + ?) WHERE user_id = ?`).run(cantidad, userId);
    this.d.db.prepare("INSERT INTO movimientos (user_id, bolsillo, cantidad, motivo, at) VALUES (?, ?, ?, ?, ?)").run(userId, bolsillo, cantidad, motivo, this.now());
  }

  wallet(userId: string): Wallet {
    const r = this.row(userId);
    const hoy = (this.d.db.prepare("SELECT ganadas FROM monedas_dia WHERE user_id = ? AND day = ?").get(userId, this.day()) as { ganadas: number } | undefined)?.ganadas ?? 0;
    return { ganadas: r.ganadas, compradas: r.compradas, ecos: r.ecos, gratis: r.gratis, gratisRaro: r.gratis_raro, gratisLeg: r.gratis_leg, sobres: r.sobres, sinEpica: r.sin_epica, sinLegendaria: r.sin_leg, hoy };
  }

  // ───────────────────────── ganar ─────────────────────────

  private activity(userId: string, day: string): DayActivity {
    const x = this.d.db.prepare("SELECT xp, mensajes, voz_min, castigo, subio FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, day) as
      | { xp: number; mensajes: number; voz_min: number; castigo: number; subio: number }
      | undefined;
    if (!x) return { xp: 0, mensajes: 0, vozMin: 0, castigo: false, misiones: 0, misionesTotal: 0, bodas: 0, racha: false };
    const stats = { vozMin: x.voz_min, mensajes: x.mensajes, subio: !!x.subio, castigo: !!x.castigo };
    // Bodas ganadas ese día (hora de Chile).
    const from = Date.parse(`${day}T00:00:00Z`) - DAY_MS, to = from + 3 * DAY_MS;
    const bodas = (this.d.db.prepare("SELECT inicio FROM bodas WHERE user_id = ? AND inicio BETWEEN ? AND ?").all(userId, from, to) as { inicio: number }[]).filter(
      (b) => this.day(b.inicio) === day,
    ).length;
    // Racha: días seguidos escribiendo hasta este; cada 7 hay bono.
    let run = 0;
    for (let d = day; run < 70; d = addDays(d, -1)) {
      const m = (this.d.db.prepare("SELECT mensajes FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, d) as { mensajes: number } | undefined)?.mensajes ?? 0;
      if (!m) break;
      run++;
    }
    const m = this.d.missions?.(stats, userId, day) ?? { done: 0, total: 0 };
    // PC de Adachi Rei (mercado negro): el tope de actividad vuelve a empezar desde que lo usó.
    const r = reinicioDe(this.d.db, userId, day);
    return {
      xp: x.xp,
      mensajes: x.mensajes,
      vozMin: x.voz_min,
      castigo: !!x.castigo,
      misiones: m.done,
      misionesTotal: m.total,
      bodas,
      racha: run > 0 && run % 7 === 0,
      ...(r.veces ? { reinicio: { xp: r.monedasXp, previa: r.monedasPrevia } } : {}),
    };
  }

  /**
   * Pone al día lo ganado: los últimos `days` días (lo que falte por pagar de cada uno; con machetazo, se quita lo de ese
   * día) y el sobre gratis de la semana. Se llama cada vez que gana XP y al abrir la tienda.
   */
  sync(userId: string, days = 2, t = this.now()): void {
    if (!this.d.settings.activo) return;
    transaction(this.d.db, () => {
      const today = this.day(t);
      for (let i = days - 1; i >= 0; i--) {
        const day = addDays(today, -i);
        const act = this.activity(userId, day);
        // Todas las misiones de la ruleta del día: 1 sobre gratis (una vez por día).
        if (missionSobre(this.d.settings, act)) {
          this.d.db.prepare("INSERT OR IGNORE INTO monedas_dia (user_id, day, ganadas) VALUES (?, ?, 0)").run(userId, day);
          if (this.d.db.prepare("UPDATE monedas_dia SET sobre = 1 WHERE user_id = ? AND day = ? AND sobre = 0").run(userId, day).changes > 0) {
            this.row(userId);
            this.d.db.prepare("UPDATE monedero SET gratis = gratis + 1 WHERE user_id = ?").run(userId);
          }
        }
        const target = dayEarnings(this.d.settings, act);
        const prev = (this.d.db.prepare("SELECT ganadas FROM monedas_dia WHERE user_id = ? AND day = ?").get(userId, day) as { ganadas: number } | undefined)?.ganadas;
        if (prev === undefined && target === 0) continue;
        const delta = target - (prev ?? 0);
        if (!delta) continue;
        this.add(userId, "ganadas", delta, delta > 0 ? `participación ${day}` : `machetazo ${day}`);
        this.d.db.prepare("INSERT INTO monedas_dia (user_id, day, ganadas) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET ganadas = excluded.ganadas").run(userId, day, target);
      }
      this.weeklySobre(userId, today);
    });
  }

  /** El lunes: 1 sobre gratis si la semana pasada participó al menos `diasMinimos` días. */
  private weeklySobre(userId: string, today: string): void {
    const ws = weekStart(today);
    const r = this.row(userId);
    if (r.semana === ws) return;
    const prev = addDays(ws, -7);
    const active = (this.d.db.prepare("SELECT COUNT(*) AS n FROM xp_dia WHERE user_id = ? AND day >= ? AND day < ? AND (mensajes > 0 OR voz_min > 0)").get(userId, prev, ws) as { n: number }).n;
    this.d.db.prepare("UPDATE monedero SET semana = ? WHERE user_id = ?").run(ws, userId);
    if (active >= this.d.settings.sobre.semanal.diasMinimos) this.d.db.prepare("UPDATE monedero SET gratis = gratis + 1 WHERE user_id = ?").run(userId);
  }

  /** Bono por subir de nivel (y por rango nuevo). Devuelve lo que se sumó. */
  onLevelChange(change: LevelChange): number {
    if (!this.d.settings.activo) return 0;
    const bonus = levelBonus(this.d.settings, change.from, change.to, !!change.rankUp);
    if (bonus > 0) this.add(change.userId, "ganadas", bonus, `nivel ${change.to}`);
    return bonus;
  }

  // ───────────────────────── objetos ─────────────────────────

  owned(userId: string): Set<string> {
    return new Set((this.d.db.prepare("SELECT objeto_id FROM inventario WHERE user_id = ?").all(userId) as { objeto_id: string }[]).map((r) => r.objeto_id));
  }

  private give(userId: string, objetoId: string, origen: string): boolean {
    return this.d.db.prepare("INSERT OR IGNORE INTO inventario (user_id, objeto_id, origen, at) VALUES (?, ?, ?, ?)").run(userId, objetoId, origen, this.now()).changes > 0;
  }

  /** Vitrina abierta hoy (null fuera de la temporada). */
  vitrina(t = this.now()): Vitrina | null {
    return vitrinaOn(this.schedule, this.day(t));
  }

  /** Compra en la vitrina de hoy: primero con compradas; los renders, solo con ganadas. */
  buy(userId: string, objetoId: string): { ok: true; pago: { compradas: number; ganadas: number }; wallet: Wallet } | Fail {
    const o = this.byId.get(objetoId);
    const precio = o ? priceOf(this.d.settings, o) : null;
    if (!o || precio === null) return { ok: false, motivo: "Ese objeto no se vende." };
    if (!this.vitrina()?.objetos.includes(o.id)) return { ok: false, motivo: "Ese objeto ya no está en la vitrina." };
    return transaction(this.d.db, () => {
      if (this.owned(userId).has(o.id)) return { ok: false as const, motivo: "Ya lo tienes." };
      const w = this.wallet(userId);
      const pago = paySplit(precio, w, o.origen === "render");
      if (!pago) return { ok: false as const, motivo: o.origen === "render" ? "no_alcanza_ganadas" : "no_alcanza" };
      this.add(userId, "compradas", -pago.compradas, `compra ${o.id}`);
      this.add(userId, "ganadas", -pago.ganadas, `compra ${o.id}`);
      this.give(userId, o.id, "tienda");
      return { ok: true as const, pago, wallet: this.wallet(userId) };
    });
  }

  /** Conecta el Helado de Kaito (el mercado negro se crea despues de la tienda). */
  useHelado(port: NonNullable<CoinServiceDeps["helado"]>): void {
    this.d.helado = port;
  }

  /** Usos del Helado de Kaito que le quedan (0 sin mercado). */
  heladoUsos(userId: string): number {
    return this.d.helado?.usos(userId) ?? 0;
  }

  /** Monedas por actividad que lleva hoy (sin bonos) y la XP del día: lo que guarda el PC de Adachi Rei al reiniciar. */
  activityToday(userId: string, t = this.now()): { xp: number; actividad: number } {
    const day = this.day(t);
    const a = this.activity(userId, day);
    return { xp: a.xp, actividad: activityCoins(this.d.settings, a) };
  }

  /** Da un objeto (adornos del mercado negro). Devuelve false si ya lo tenía. */
  grant(userId: string, objetoId: string, origen: string): boolean {
    if (!this.byId.has(objetoId)) throw new Error(`objeto desconocido: ${objetoId}`);
    return this.give(userId, objetoId, origen);
  }

  /** Doble helado de Kaito (mercado negro): un sobre común regalado pasa a ser raro. False si no tiene comunes. */
  upgradeSobre(userId: string): boolean {
    this.row(userId);
    return this.d.db.prepare("UPDATE monedero SET gratis = gratis - 1, gratis_raro = gratis_raro + 1 WHERE user_id = ? AND gratis > 0").run(userId).changes > 0;
  }

  /** Regala sobres gratis de una clase (casilla de la ruleta: comunes; premios de la trivia: raros y legendarios). */
  giveSobres(userId: string, tipo: TipoSobre, n = 1): void {
    if (n <= 0) return;
    this.row(userId);
    this.d.db.prepare(`UPDATE monedero SET ${GRATIS_COL[tipo]} = ${GRATIS_COL[tipo]} + ? WHERE user_id = ?`).run(n, userId);
  }

  /**
   * Abre un sobre: gratis (si tiene) o con ganadas, al precio de su clase (config/monedas.json -> sobre.tipos; una
   * clase sin precio solo se regala). Las compradas nunca abren sobres. Los repetidos se vuelven Ecos.
   */
  openSobre(userId: string, gratis: boolean, tipo: TipoSobre = "comun"): SobreResult | Fail {
    if (!this.d.settings.activo) return { ok: false, motivo: "La tienda está cerrada." };
    const precio = sobreKind(this.d.settings, tipo).precio;
    if (!gratis && precio === null) return { ok: false, motivo: "Ese sobre no se vende." };
    return transaction(this.d.db, () => {
      const r = this.row(userId);
      const col = GRATIS_COL[tipo];
      if (gratis ? r[col] < 1 : r.ganadas < precio!) return { ok: false as const, motivo: gratis ? "No tienes sobres gratis." : "no_alcanza" };
      const pool = sobrePool(this.d.catalog, this.d.settings.temporada.id, this.day());
      // Helado de Kaito: si le queda uno, este sobre trae objetos de más (y se gasta).
      const helado = this.d.helado && this.d.helado.usos(userId) > 0 && this.d.helado.consume(userId) ? this.d.helado.extra : 0;
      const rolled = rollSobre(this.d.settings, pool, { sinEpica: r.sin_epica, sinLegendaria: r.sin_leg }, this.rnd, tipo, helado);
      if (gratis) this.d.db.prepare(`UPDATE monedero SET ${col} = ${col} - 1 WHERE user_id = ?`).run(userId);
      else this.add(userId, "ganadas", -precio!, tipo === "comun" ? "sobre" : `sobre ${tipo}`);
      this.d.db.prepare("UPDATE monedero SET sobres = sobres + 1, sin_epica = ?, sin_leg = ? WHERE user_id = ?").run(rolled.pity.sinEpica, rolled.pity.sinLegendaria, userId);
      let ecos = 0;
      const objetos = rolled.objetos.map((objeto) => {
        const nuevo = this.give(userId, objeto.id, "sobre");
        const e = nuevo ? 0 : ecosFor(this.d.settings, objeto.rareza);
        ecos += e;
        return { objeto, nuevo, ecos: e };
      });
      this.add(userId, "ecos", ecos, "repetidos");
      return { objetos, ecos, gratis, tipo, helado, wallet: this.wallet(userId) };
    });
  }

  /** Fabrica con Ecos un objeto que falta (cuesta su precio de tienda). Míticas y fundadores, no. */
  craft(userId: string, objetoId: string): { ok: true; wallet: Wallet } | Fail {
    const o = this.byId.get(objetoId);
    const costo = o ? priceOf(this.d.settings, o) : null;
    if (!o || costo === null) return { ok: false, motivo: "Ese objeto no se puede fabricar." };
    return transaction(this.d.db, () => {
      if (this.owned(userId).has(o.id)) return { ok: false as const, motivo: "Ya lo tienes." };
      if (this.row(userId).ecos < costo) return { ok: false as const, motivo: "no_alcanza_ecos" };
      this.add(userId, "ecos", -costo, `fabricar ${o.id}`);
      this.give(userId, o.id, "fabricado");
      return { ok: true as const, wallet: this.wallet(userId) };
    });
  }

  // ───────────────────────── equipar ─────────────────────────

  /** Lo equipado: una ranura por tipo, y hasta tres insignias (insignia1..3). */
  equipped(userId: string): Map<string, Objeto> {
    const rows = this.d.db.prepare("SELECT ranura, objeto_id FROM equipado WHERE user_id = ?").all(userId) as { ranura: string; objeto_id: string }[];
    const out = new Map<string, Objeto>();
    for (const r of rows) {
      const o = this.byId.get(r.objeto_id);
      if (o) out.set(r.ranura, o);
    }
    return out;
  }

  /** Equipa (o quita, con null) el objeto de un tipo. Para insignias, la lista completa (hasta 3). */
  equip(userId: string, tipo: Tipo, ids: string[] | null): Fail | { ok: true } {
    const own = this.owned(userId);
    const list = (ids ?? []).filter((id) => own.has(id) && this.byId.get(id)?.tipo === tipo);
    if (ids && ids.length && !list.length) return { ok: false, motivo: "No tienes ese objeto." };
    transaction(this.d.db, () => {
      if (tipo === "insignia") {
        this.d.db.prepare("DELETE FROM equipado WHERE user_id = ? AND ranura LIKE 'insignia%'").run(userId);
        list.slice(0, 3).forEach((id, i) => this.d.db.prepare("INSERT INTO equipado (user_id, ranura, objeto_id) VALUES (?, ?, ?)").run(userId, `insignia${i + 1}`, id));
      } else {
        this.d.db.prepare("DELETE FROM equipado WHERE user_id = ? AND ranura = ?").run(userId, tipo);
        if (list[0]) this.d.db.prepare("INSERT INTO equipado (user_id, ranura, objeto_id) VALUES (?, ?, ?)").run(userId, tipo, list[0]);
      }
    });
    return { ok: true };
  }

  // ───────────────────────── pedidos de monedas ─────────────────────────

  /** ¿Puede comprar ese monto? (bloqueado por GyroP o pasaría su límite del mes). */
  canPurchase(userId: string, usd: number): Fail | { ok: true } {
    const c = this.d.db.prepare("SELECT limite_usd, bloqueado FROM compras_control WHERE user_id = ?").get(userId) as { limite_usd: number | null; bloqueado: number } | undefined;
    if (c?.bloqueado) return { ok: false, motivo: "bloqueado" };
    if (c?.limite_usd != null && this.spentThisMonth(userId) + usd > c.limite_usd) return { ok: false, motivo: "limite" };
    return { ok: true };
  }

  /** USD pagados (confirmados) desde el día 1 del mes. */
  spentThisMonth(userId: string): number {
    const from = Date.parse(`${this.day().slice(0, 7)}-01T00:00:00Z`) - DAY_MS;
    return (this.d.db.prepare("SELECT COALESCE(SUM(usd), 0) AS s FROM pedidos_monedas WHERE user_id = ? AND estado = 'pagado' AND resuelto_at >= ?").get(userId, from) as { s: number }).s;
  }

  createOrder(userId: string, paqueteId: string, metodo: Metodo): Pedido | Fail {
    const p = this.d.settings.paquetes.find((x) => x.id === paqueteId);
    if (!p) return { ok: false, motivo: "Ese paquete no existe." };
    const can = this.canPurchase(userId, p.usd);
    if (!can.ok) return can;
    let codigo = orderCode(this.rnd);
    while (this.order(codigo)) codigo = orderCode(this.rnd);
    this.d.db
      .prepare("INSERT INTO pedidos_monedas (codigo, user_id, paquete, metodo, usd, clp, monedas, estado, creado_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)")
      .run(codigo, userId, p.id, metodo, p.usd, p.clp, p.monedas, this.now());
    return this.order(codigo)!;
  }

  order(codigo: string): Pedido | null {
    const r = this.d.db.prepare("SELECT * FROM pedidos_monedas WHERE codigo = ?").get(codigo) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      codigo: r.codigo as string,
      userId: r.user_id as string,
      paquete: r.paquete as string,
      metodo: r.metodo as Metodo,
      usd: r.usd as number,
      clp: r.clp as number,
      monedas: r.monedas as number,
      estado: r.estado as EstadoPedido,
      creadoAt: r.creado_at as number,
      avisadoAt: (r.avisado_at as number | null) ?? null,
      registroId: (r.registro_id as string | null) ?? null,
    };
  }

  /** El Papu tocó «Ya pagué»: queda esperando que GyroP confirme. */
  markNotified(codigo: string, registroId: string | null): Pedido | null {
    this.d.db.prepare("UPDATE pedidos_monedas SET estado = 'avisado', avisado_at = ?, registro_id = COALESCE(?, registro_id) WHERE codigo = ? AND estado IN ('pendiente', 'avisado')").run(this.now(), registroId, codigo);
    return this.order(codigo);
  }

  /** GyroP confirma que llegó: las monedas van al bolsillo de compradas (una sola vez). */
  confirmOrder(codigo: string): Pedido | null {
    return transaction(this.d.db, () => {
      const p = this.order(codigo);
      if (!p || p.estado === "pagado" || p.estado === "rechazado") return p;
      this.d.db.prepare("UPDATE pedidos_monedas SET estado = 'pagado', resuelto_at = ? WHERE codigo = ?").run(this.now(), codigo);
      this.add(p.userId, "compradas", p.monedas, `pedido ${codigo}`);
      return this.order(codigo);
    });
  }

  rejectOrder(codigo: string): Pedido | null {
    this.d.db.prepare("UPDATE pedidos_monedas SET estado = 'rechazado', resuelto_at = ? WHERE codigo = ? AND estado IN ('pendiente', 'avisado')").run(this.now(), codigo);
    return this.order(codigo);
  }

  /** Devuelve un pedido pagado: quita esas monedas (o las que queden). La devolución del dinero la hace GyroP en PayPal o su banco. */
  refundOrder(codigo: string): Pedido | null {
    return transaction(this.d.db, () => {
      const p = this.order(codigo);
      if (!p || p.estado !== "pagado") return p;
      this.d.db.prepare("UPDATE pedidos_monedas SET estado = 'rechazado', resuelto_at = ? WHERE codigo = ?").run(this.now(), codigo);
      this.add(p.userId, "compradas", -p.monedas, `devolución ${codigo}`);
      return this.order(codigo);
    });
  }

  /** Pedidos sin confirmar más viejos que `venceDias`: vencen. Devuelve los vencidos. */
  expireOrders(): Pedido[] {
    const limit = this.now() - this.d.settings.pagos.venceDias * DAY_MS;
    const rows = this.d.db.prepare("SELECT codigo FROM pedidos_monedas WHERE estado IN ('pendiente', 'avisado') AND creado_at < ?").all(limit) as { codigo: string }[];
    this.d.db.prepare("UPDATE pedidos_monedas SET estado = 'vencido', resuelto_at = ? WHERE estado IN ('pendiente', 'avisado') AND creado_at < ?").run(this.now(), limit);
    return rows.map((r) => this.order(r.codigo)!);
  }

  /** Compras pagadas del mes por Papu (para /monedas panel), de más a menos. */
  monthBuyers(): { userId: string; usd: number; compras: number; limite: number | null; bloqueado: boolean }[] {
    const from = Date.parse(`${this.day().slice(0, 7)}-01T00:00:00Z`) - DAY_MS;
    const rows = this.d.db
      .prepare(
        `SELECT p.user_id AS u, SUM(p.usd) AS usd, COUNT(*) AS n, c.limite_usd AS lim, COALESCE(c.bloqueado, 0) AS b FROM pedidos_monedas p
         LEFT JOIN compras_control c ON c.user_id = p.user_id WHERE p.estado = 'pagado' AND p.resuelto_at >= ? GROUP BY p.user_id ORDER BY usd DESC`,
      )
      .all(from) as { u: string; usd: number; n: number; lim: number | null; b: number }[];
    return rows.map((r) => ({ userId: r.u, usd: r.usd, compras: r.n, limite: r.lim, bloqueado: !!r.b }));
  }

  setLimit(userId: string, usd: number | null): void {
    this.d.db.prepare("INSERT INTO compras_control (user_id, limite_usd) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET limite_usd = excluded.limite_usd").run(userId, usd);
  }

  setBlocked(userId: string, on: boolean): void {
    this.d.db.prepare("INSERT INTO compras_control (user_id, bloqueado) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET bloqueado = excluded.bloqueado").run(userId, on ? 1 : 0);
  }

  /**
   * Cobra `cantidad` de las monedas GANADAS (las apuestas del 1vs1: nunca las compradas, PLAN §3.7). Devuelve null si no
   * le alcanza (y entonces no cobra nada).
   */
  spendGanadas(userId: string, cantidad: number, motivo: string): Wallet | null {
    return transaction(this.d.db, () => {
      if (this.row(userId).ganadas < cantidad) return null;
      this.add(userId, "ganadas", -cantidad, motivo);
      return this.wallet(userId);
    });
  }

  // ───────────────────────── intercambios (src/intercambios/) ─────────────────────────

  /** Pasa monedas de un bolsillo de un Papu al mismo bolsillo de otro. False si no le alcanzan (y no mueve nada). */
  transfer(fromId: string, toId: string, bolsillo: "ganadas" | "compradas", cantidad: number, motivo: string): boolean {
    if (cantidad <= 0) return true;
    return transaction(this.d.db, () => {
      if (this.row(fromId)[bolsillo] < cantidad) return false;
      this.add(fromId, bolsillo, -cantidad, motivo);
      this.add(toId, bolsillo, cantidad, motivo);
      return true;
    });
  }

  /** Sobres regalados por abrir de una clase. */
  sobresGratis(userId: string, tipo: TipoSobre): number {
    return this.row(userId)[GRATIS_COL[tipo]];
  }

  /** Pasa sobres regalados de un Papu a otro. False si no tiene tantos. */
  transferSobres(fromId: string, toId: string, tipo: TipoSobre, n: number): boolean {
    if (n <= 0) return true;
    const col = GRATIS_COL[tipo];
    return transaction(this.d.db, () => {
      this.row(fromId);
      if (!this.d.db.prepare(`UPDATE monedero SET ${col} = ${col} - ? WHERE user_id = ? AND ${col} >= ?`).run(n, fromId, n).changes) return false;
      this.giveSobres(toId, tipo, n);
      return true;
    });
  }

  /** Pasa un objeto de la colección (se le desequipa al que lo entrega). False si no lo tiene o el otro ya lo tiene. */
  transferObjeto(fromId: string, toId: string, objetoId: string, origen: string): boolean {
    return transaction(this.d.db, () => {
      if (!this.owned(fromId).has(objetoId) || this.owned(toId).has(objetoId)) return false;
      this.d.db.prepare("DELETE FROM inventario WHERE user_id = ? AND objeto_id = ?").run(fromId, objetoId);
      this.d.db.prepare("DELETE FROM equipado WHERE user_id = ? AND objeto_id = ?").run(fromId, objetoId);
      return this.give(toId, objetoId, origen);
    });
  }

  /** /monedas dar o quitar (GyroP). */
  adjust(userId: string, bolsillo: Bolsillo, cantidad: number, motivo: string): Wallet {
    this.add(userId, bolsillo, cantidad, motivo);
    return this.wallet(userId);
  }

  // ───────────────────────── regalos ─────────────────────────

  /** Regalo de membresía (en compradas): al tener el rol y luego cada 30 días. Devuelve lo regalado (0 si nada). */
  membership(userId: string, roleNames: string[], t = this.now()): { rol: string; monedas: number } | null {
    const gift = membershipGift(this.d.settings, roleNames);
    if (!gift) return null;
    const r = this.row(userId);
    if (r.membresia_at != null && t - r.membresia_at < 30 * DAY_MS) return null;
    this.d.db.prepare("UPDATE monedero SET membresia_at = ? WHERE user_id = ?").run(t, userId);
    this.add(userId, "compradas", gift.monedas, `membresía ${gift.rol}`);
    return gift;
  }

  /**
   * Insignias de membresía (pedido de GyroP, 31 oct. 2026): la de cada rol de Ko-fi que tenga, para siempre (aunque
   * después deje la membresía). Si tiene un lugar libre, se la pone. Devuelve las que recibió ahora.
   */
  membershipBadges(userId: string, roleNames: string[]): Objeto[] {
    const nuevas = membershipBadges(this.d.settings, roleNames)
      .filter((id) => this.byId.has(id))
      .filter((id) => this.give(userId, id, "membresía"));
    if (!nuevas.length) return [];
    const puestas = [...this.equipped(userId).entries()].filter(([k]) => k.startsWith("insignia")).map(([, o]) => o.id);
    if (puestas.length < 3) this.equip(userId, "insignia", [...puestas, ...nuevas].slice(0, 3));
    return nuevas.map((id) => this.byId.get(id)!);
  }

  /** Número de fundador (null si no es fundador). */
  founderNumber(userId: string): number | null {
    return this.d.settings.fundadores.find((f) => f.id === userId)?.numero ?? null;
  }

  /** Entrega el paquete de fundadores a quien le falte. Devuelve a quiénes se les entregó algo. */
  grantFounders(): string[] {
    const out: string[] = [];
    for (const f of this.d.settings.fundadores) {
      let any = false;
      for (const id of FUNDADOR_OBJETOS) if (this.byId.has(id) && this.give(f.id, id, "fundador")) any = true;
      if (any) out.push(f.id);
    }
    return out;
  }
}
