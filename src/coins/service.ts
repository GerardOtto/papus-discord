// Shaulitas (antes Shaula-coins, PLAN §3.6): monedero, lo ganado participando, sobres, tienda, fabricar con Ecos,
// objetos equipados, insignias de membresía y paquete de fundadores. Una sola moneda desde el 13 nov. 2026 (se ganan
// jugando; ya no se venden): en la base vive en la columna `ganadas` del monedero (la de `compradas` quedó en 0 con la
// migración de la moneda única, 13 nov. 2026). Todo el estado vive en SQLite (migración 10). Sin Discord: src/discord/tienda.ts es el menú del canal.
import { transaction, type Db } from "../db/database";
import type { LevelChange } from "../levels/service";
import { reinicioDe } from "../mercado/reinicios";
import { dayKey } from "../time";
import { enTema, nombreTema, temasDe, type Tema } from "./temas";
import {
  activityCoins,
  availableOn,
  RAREZAS_REGALO,
  addDays,
  dayEarnings,
  ecosFor,
  levelBonus,
  missionSobre,
  membershipBadges,
  priceOf,
  rollSobre,
  seasonSchedule,
  sobreKind,
  sobrePool,
  temporadasActivas,
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
  /** Shaulitas (una sola moneda). */
  monedas: number;
  ecos: number;
  /** Sobres comunes gratis por abrir (misiones de la ruleta, cada lunes, casilla de la ruleta). */
  gratis: number;
  /** Sobres raros y legendarios gratis por abrir (premios de la trivia; también se compran con Shaulitas). */
  gratisRaro: number;
  gratisLeg: number;
  sobres: number;
  sinEpica: number;
  sinLegendaria: number;
  /** Ganadas hoy por participar (sin bonos de nivel) y el tope de actividad. */
  hoy: number;
}

export type Bolsillo = "monedas" | "ecos";
/** Columna del monedero de cada bolsillo (las Shaulitas viven en `ganadas`). */
const COLUMNA: Record<Bolsillo, "ganadas" | "ecos"> = { monedas: "ganadas", ecos: "ecos" };

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

/** Precio con un descuento en % (redondeado hacia abajo, nunca menos de 1). */
export function conDescuento(precio: number, descuento: number): number {
  return descuento > 0 ? Math.max(1, Math.floor((precio * (100 - descuento)) / 100)) : precio;
}

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
    const col = COLUMNA[bolsillo];
    this.d.db.prepare(`UPDATE monedero SET ${col} = MAX(0, ${col} + ?) WHERE user_id = ?`).run(cantidad, userId);
    this.d.db.prepare("INSERT INTO movimientos (user_id, bolsillo, cantidad, motivo, at) VALUES (?, ?, ?, ?, ?)").run(userId, col, cantidad, motivo, this.now());
    if (bolsillo === "monedas" && cantidad > 0) this.onGain?.(userId, cantidad, motivo);
  }

  /** Entraron Shaulitas (el anfitrión de los 7 pecados las comenta, src/pecados/comentarista.ts). No debe lanzar. */
  onGain?: (userId: string, cantidad: number, motivo: string) => void;

  wallet(userId: string): Wallet {
    const r = this.row(userId);
    const hoy = (this.d.db.prepare("SELECT ganadas FROM monedas_dia WHERE user_id = ? AND day = ?").get(userId, this.day()) as { ganadas: number } | undefined)?.ganadas ?? 0;
    return { monedas: r.ganadas, ecos: r.ecos, gratis: r.gratis, gratisRaro: r.gratis_raro, gratisLeg: r.gratis_leg, sobres: r.sobres, sinEpica: r.sin_epica, sinLegendaria: r.sin_leg, hoy };
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
        this.add(userId, "monedas", delta, delta > 0 ? `participación ${day}` : `machetazo ${day}`);
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
    if (bonus > 0) this.add(change.userId, "monedas", bonus, `nivel ${change.to}`);
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

  /** Compra en la vitrina de hoy (a precio de tienda, con el descuento de su membresía: `descuento` en %). */
  buy(userId: string, objetoId: string, descuento = 0): { ok: true; pago: number; wallet: Wallet } | Fail {
    const o = this.byId.get(objetoId);
    const precio = o ? priceOf(this.d.settings, o) : null;
    if (!o || precio === null) return { ok: false, motivo: "Ese objeto no se vende." };
    if (!this.vitrina()?.objetos.includes(o.id)) return { ok: false, motivo: "Ese objeto ya no está en la vitrina." };
    return transaction(this.d.db, () => {
      if (this.owned(userId).has(o.id)) return { ok: false as const, motivo: "Ya lo tienes." };
      const pago = conDescuento(precio, descuento);
      if (this.row(userId).ganadas < pago) return { ok: false as const, motivo: "no_alcanza" };
      this.add(userId, "monedas", -pago, `compra ${o.id}`);
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
   * Abre un sobre: gratis (si tiene) o con Shaulitas, al precio de su clase (config/monedas.json -> sobre.tipos; una
   * clase sin precio solo se regala). Los repetidos se vuelven Ecos.
   */
  openSobre(userId: string, gratis: boolean, tipo: TipoSobre = "comun"): SobreResult | Fail {
    if (!this.d.settings.activo) return { ok: false, motivo: "La tienda está cerrada." };
    const precio = sobreKind(this.d.settings, tipo).precio;
    if (!gratis && precio === null) return { ok: false, motivo: "Ese sobre no se vende." };
    return transaction(this.d.db, () => {
      const r = this.row(userId);
      const col = GRATIS_COL[tipo];
      if (gratis ? r[col] < 1 : r.ganadas < precio!) return { ok: false as const, motivo: gratis ? "No tienes sobres gratis." : "no_alcanza" };
      const pool = sobrePool(this.d.catalog, temporadasActivas(this.d.settings, this.day()), this.day());
      // Helado de Kaito: si le queda uno, este sobre trae objetos de más (y se gasta).
      const helado = this.d.helado && this.d.helado.usos(userId) > 0 && this.d.helado.consume(userId) ? this.d.helado.extra : 0;
      const rolled = rollSobre(this.d.settings, pool, { sinEpica: r.sin_epica, sinLegendaria: r.sin_leg }, this.rnd, tipo, helado);
      if (gratis) this.d.db.prepare(`UPDATE monedero SET ${col} = ${col} - 1 WHERE user_id = ?`).run(userId);
      else this.add(userId, "monedas", -precio!, tipo === "comun" ? "sobre" : `sobre ${tipo}`);
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

  // ───────────────────────── sobres temáticos (al azar dentro de un tema) ─────────────────────────

  /**
   * Objetos que puede traer un sobre temático ese día: los de ese tema de todas las temporadas (renders incluidos; se
   * ganan jugando o con Shaulitas), sin regalos, contrabando ni limitados fuera de su fecha.
   */
  poolTematico(tema: string, day = this.day()): Objeto[] {
    return this.d.catalog.filter((o) => /^t\d+$/.test(o.temporada) && !RAREZAS_REGALO.includes(o.rareza) && availableOn(o, day) && enTema(o, tema));
  }

  /** Temas que se ofrecen para un sobre temático (con al menos `tematico.minimo` objetos). */
  temasTematicos(day = this.day()): Tema[] {
    return temasDe(this.poolTematico("todo", day), this.d.settings.sobre.tematico?.minimo ?? 5, false);
  }

  /** Regala un sobre temático (ganar una boda: el de esa Vocaloid). */
  darTematico(userId: string, tema: string, origen: string): void {
    this.d.db.prepare("INSERT INTO sobres_tematicos (user_id, tema, origen, creado_at) VALUES (?, ?, ?, ?)").run(userId, tema, origen, this.now());
  }

  /** Ganar una boda: un sobre temático de esa Vocaloid (si tiene objetos). Devuelve «Sobre de Teto» o null. */
  regalarTematicoDe(userId: string, personaje: string): string | null {
    const tema = `p:${personaje}`;
    if (!this.d.settings.sobre.tematico || !this.poolTematico(tema).length) return null;
    this.darTematico(userId, tema, "boda");
    return `Sobre de ${nombreTema(tema).nombre}`;
  }

  /** Sobres temáticos regalados por abrir. */
  tematicosPendientes(userId: string): { id: number; tema: string; origen: string }[] {
    return this.d.db.prepare("SELECT id, tema, origen FROM sobres_tematicos WHERE user_id = ? AND abierto_at IS NULL ORDER BY id").all(userId) as { id: number; tema: string; origen: string }[];
  }

  /**
   * Abre un sobre temático (como el común, pero solo con objetos del tema): `pago` = se compra a `tematico.precio`;
   * `regalado` = uno común regalado + `tematico.ecos` Ecos; un número = el temático regalado con ese id (su tema manda).
   */
  openTematico(userId: string, tema: string, modo: "pago" | "regalado" | number): (SobreResult & { tema: string }) | Fail {
    const t = this.d.settings.sobre.tematico;
    if (!this.d.settings.activo || !t) return { ok: false, motivo: "La tienda está cerrada." };
    return transaction(this.d.db, () => {
      const r = this.row(userId);
      let elTema = tema;
      if (typeof modo === "number") {
        const s = this.d.db.prepare("SELECT tema FROM sobres_tematicos WHERE id = ? AND user_id = ? AND abierto_at IS NULL").get(modo, userId) as { tema: string } | undefined;
        if (!s) return { ok: false as const, motivo: "Ese sobre ya no está." };
        elTema = s.tema;
      } else if (modo === "pago" && r.ganadas < t.precio) return { ok: false as const, motivo: "no_alcanza" };
      else if (modo === "regalado" && (r.gratis < 1 || r.ecos < t.ecos)) return { ok: false as const, motivo: r.gratis < 1 ? "No tienes sobres comunes regalados." : "no_alcanza_ecos" };
      const pool = this.poolTematico(elTema);
      if (!pool.length) return { ok: false as const, motivo: "Ese tema no tiene objetos ahora." };
      const helado = this.d.helado && this.d.helado.usos(userId) > 0 && this.d.helado.consume(userId) ? this.d.helado.extra : 0;
      const rolled = rollSobre(this.d.settings, pool, { sinEpica: r.sin_epica, sinLegendaria: r.sin_leg }, this.rnd, "comun", helado);
      if (typeof modo === "number") this.d.db.prepare("UPDATE sobres_tematicos SET abierto_at = ? WHERE id = ?").run(this.now(), modo);
      else if (modo === "pago") this.add(userId, "monedas", -t.precio, `sobre temático ${elTema}`);
      else {
        this.d.db.prepare("UPDATE monedero SET gratis = gratis - 1 WHERE user_id = ?").run(userId);
        this.add(userId, "ecos", -t.ecos, `sobre temático ${elTema}`);
      }
      this.d.db.prepare("UPDATE monedero SET sobres = sobres + 1, sin_epica = ?, sin_leg = ? WHERE user_id = ?").run(rolled.pity.sinEpica, rolled.pity.sinLegendaria, userId);
      let ecos = 0;
      const objetos = rolled.objetos.map((objeto) => {
        const nuevo = this.give(userId, objeto.id, "sobre temático");
        const e = nuevo ? 0 : ecosFor(this.d.settings, objeto.rareza);
        ecos += e;
        return { objeto, nuevo, ecos: e };
      });
      this.add(userId, "ecos", ecos, "repetidos");
      return { objetos, ecos, gratis: modo !== "pago", tipo: "comun" as const, helado, tema: elTema, wallet: this.wallet(userId) };
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

  /** Lo equipado: una ranura por tipo, y hasta tres insignias (insignia1..3; cuatro con membresía Baguette o más). */
  equipped(userId: string): Map<string, Objeto> {
    const rows = this.d.db.prepare("SELECT ranura, objeto_id FROM equipado WHERE user_id = ?").all(userId) as { ranura: string; objeto_id: string }[];
    const out = new Map<string, Objeto>();
    for (const r of rows) {
      const o = this.byId.get(r.objeto_id);
      if (o) out.set(r.ranura, o);
    }
    return out;
  }

  /** Equipa (o quita, con null) el objeto de un tipo. Para insignias, la lista completa (hasta `maxInsignias`). */
  equip(userId: string, tipo: Tipo, ids: string[] | null, maxInsignias = 3): Fail | { ok: true } {
    const own = this.owned(userId);
    const list = (ids ?? []).filter((id) => own.has(id) && this.byId.get(id)?.tipo === tipo);
    if (ids && ids.length && !list.length) return { ok: false, motivo: "No tienes ese objeto." };
    transaction(this.d.db, () => {
      if (tipo === "insignia") {
        this.d.db.prepare("DELETE FROM equipado WHERE user_id = ? AND ranura LIKE 'insignia%'").run(userId);
        list.slice(0, maxInsignias).forEach((id, i) => this.d.db.prepare("INSERT INTO equipado (user_id, ranura, objeto_id) VALUES (?, ?, ?)").run(userId, `insignia${i + 1}`, id));
      } else {
        this.d.db.prepare("DELETE FROM equipado WHERE user_id = ? AND ranura = ?").run(userId, tipo);
        if (list[0]) this.d.db.prepare("INSERT INTO equipado (user_id, ranura, objeto_id) VALUES (?, ?, ?)").run(userId, tipo, list[0]);
      }
    });
    return { ok: true };
  }

  /** Cobra `cantidad` Shaulitas (apuestas, mercado negro). Devuelve null si no le alcanza (y entonces no cobra nada). */
  spend(userId: string, cantidad: number, motivo: string): Wallet | null {
    return transaction(this.d.db, () => {
      if (this.row(userId).ganadas < cantidad) return null;
      this.add(userId, "monedas", -cantidad, motivo);
      return this.wallet(userId);
    });
  }

  // ───────────────────────── intercambios (src/intercambios/) ─────────────────────────

  /** Pasa Shaulitas de un Papu a otro. False si no le alcanzan (y no mueve nada). */
  transfer(fromId: string, toId: string, cantidad: number, motivo: string): boolean {
    if (cantidad <= 0) return true;
    return transaction(this.d.db, () => {
      if (this.row(fromId).ganadas < cantidad) return false;
      this.add(fromId, "monedas", -cantidad, motivo);
      this.add(toId, "monedas", cantidad, motivo);
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

  /**
   * Insignia de regalo (la del pastel de cumpleaños, 18 nov. 2026): para siempre; si tiene un lugar libre, se la pone.
   * Devuelve el objeto si la recibió ahora (null si ya la tenía o no existe).
   */
  giftBadge(userId: string, objetoId: string, origen: string): Objeto | null {
    const o = this.byId.get(objetoId);
    if (!o || o.tipo !== "insignia" || !this.give(userId, objetoId, origen)) return null;
    const puestas = [...this.equipped(userId).entries()].filter(([k]) => k.startsWith("insignia")).map(([, x]) => x.id);
    if (puestas.length < 3) this.equip(userId, "insignia", [...puestas, objetoId]);
    return o;
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

  /** Entrega los regalos exclusivos de GyroP (config/monedas.json "exclusivos") a quien le falten. */
  grantExclusivos(): { userId: string; objeto: Objeto }[] {
    const out: { userId: string; objeto: Objeto }[] = [];
    for (const e of this.d.settings.exclusivos ?? []) {
      const o = this.byId.get(e.objeto);
      if (o && this.give(e.id, o.id, "exclusivo")) out.push({ userId: e.id, objeto: o });
    }
    return out;
  }
}
