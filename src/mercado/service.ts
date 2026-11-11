// Mercado negro (PLAN §3.9, config/mercado.json): cuándo está abierto, inventario de consumibles, compras (solo con
// Shaula-coins GANADAS, regla 1), usos y el PC de Adachi Rei. Todo el estado vive en SQLite (migración 16) y en kv (la
// apertura manual de GyroP). Sin Discord: src/discord/mercado.ts muestra el mercado, /consumibles y el aviso de Neru.
import type { WeddingService } from "../bodas/service";
import type { CoinService, Wallet } from "../coins/service";
import { kvDelete, kvGet, kvSet, transaction, type Db } from "../db/database";
import type { Quota } from "../quota/quota";
import type { RouletteService } from "../ruleta/service";
import { dayKey } from "../time";
import type { TriviaService } from "../trivia/service";
import { guardarReinicio, reinicioDe } from "./reinicios";
import { abierta, aperturaHoy, CONSUMIBLES, proximaApertura, vitrinaDe, type Apertura, type Efecto, type MercadoSettings, type ObjetoMercado } from "./rules";

const MANUAL_KEY = "mercado:manual";

export interface MercadoServiceDeps {
  db: Db;
  settings: MercadoSettings;
  coins: CoinService;
  quota: Quota;
  roulette?: RouletteService | null;
  trivia?: TriviaService | null;
  /** Bodas (para el Sake de Haku: pista de la adivinanza abierta). */
  weddings?: WeddingService | null;
  /** Zona del día de la cuota, la ruleta y la trivia (medianoche de Chile). */
  timeZone: string;
  now?: () => number;
}

export interface Consumible {
  objeto: ObjetoMercado;
  usos: number;
}

export type CompraFail = "cerrado" | "no_existe" | "no_esta" | "ya_lo_tienes" | "no_alcanza";

export interface Compra {
  objeto: ObjetoMercado;
  /** Usos que tiene ahora (consumibles). */
  usos: number;
  /** El rol de adorno: Discord se lo pone (src/discord/mercado.ts). */
  rol: string | null;
  wallet: Wallet;
}

/** Lo que reinició el PC de Adachi Rei. */
export interface ReinicioPc {
  /** Mensajes con los Vocaloids devueltos. */
  mensajes: number;
  /** Tiradas de la ruleta, partidas de trivia y XP de la trivia que vuelven a contar desde cero. */
  tiradas: number;
  partidas: number;
  xpTrivia: number;
  /** Monedas por actividad que ya llevaba (se quedan; el tope vuelve a empezar). */
  monedas: number;
  /** Usos del PC que le quedan. */
  usos: number;
}

export class MercadoService {
  private readonly now: () => number;
  readonly byId: Map<string, ObjetoMercado>;

  constructor(private readonly d: MercadoServiceDeps) {
    this.now = d.now ?? Date.now;
    this.byId = new Map(d.settings.objetos.map((o) => [o.id, o]));
    for (const o of d.settings.objetos) if (o.efecto === "objeto" && !d.coins.byId.has(o.objeto!)) throw new Error(`config/mercado.json: ${o.id} pide el objeto ${o.objeto}, que no está en config/objetos.json`);
  }

  get settings(): MercadoSettings {
    return this.d.settings;
  }

  /** El objeto del mercado con ese efecto (atún, baguette, celular, pc). */
  byEfecto(efecto: Efecto): ObjetoMercado | null {
    return this.d.settings.objetos.find((o) => o.efecto === efecto) ?? null;
  }

  // ───────────────────────── horario ─────────────────────────

  /** Apertura manual de GyroP (/consumibles abrir_mercado), si sigue vigente. */
  private manual(now: number): Apertura | null {
    const raw = kvGet(this.d.db, MANUAL_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Apertura;
    if (now >= a.cierra) {
      kvDelete(this.d.db, MANUAL_KEY);
      return null;
    }
    return a;
  }

  /** ¿Está abierto ahora? `apertura` = la de ahora si está abierto; si no, la próxima. */
  estado(now = this.now()): { abierto: boolean; apertura: Apertura } {
    if (!this.d.settings.activo) return { abierto: false, apertura: aperturaHoy(this.d.settings, now) };
    const m = this.manual(now);
    if (m && abierta(m, now)) return { abierto: true, apertura: m };
    const hoy = aperturaHoy(this.d.settings, now);
    if (abierta(hoy, now)) return { abierto: true, apertura: hoy };
    return { abierto: false, apertura: proximaApertura(this.d.settings, now) };
  }

  /** Lo que está a la venta hoy (en la zona del mercado), en el orden del banner. Rota cada día. */
  vitrina(now = this.now()): ObjetoMercado[] {
    return vitrinaDe(this.d.settings, dayKey(new Date(now), this.d.settings.zona)).map((id) => this.byId.get(id)!);
  }

  /** GyroP abre el mercado ahora, por `minutos` (para probarlo o de regalo). */
  abrirAhora(minutos = this.d.settings.horario.minutos, now = this.now()): Apertura {
    const a: Apertura = { day: `manual-${now}`, abre: now, cierra: now + minutos * 60_000 };
    kvSet(this.d.db, MANUAL_KEY, JSON.stringify(a));
    return a;
  }

  // ───────────────────────── inventario ─────────────────────────

  usos(userId: string, objetoId: string): number {
    const r = this.d.db.prepare("SELECT usos FROM consumibles WHERE user_id = ? AND objeto = ?").get(userId, objetoId) as { usos: number } | undefined;
    return r?.usos ?? 0;
  }

  /** Usos del consumible con ese efecto (0 si no lo tiene o no se vende). */
  usosDe(userId: string, efecto: Efecto): number {
    const o = this.byEfecto(efecto);
    return o ? this.usos(userId, o.id) : 0;
  }

  /** Consumibles que tiene (con usos), en el orden de la config. */
  inventario(userId: string): Consumible[] {
    return this.d.settings.objetos.filter((o) => CONSUMIBLES.includes(o.efecto)).map((objeto) => ({ objeto, usos: this.usos(userId, objeto.id) })).filter((c) => c.usos > 0);
  }

  /** Adornos y roles del mercado que ya tiene (no se compran dos veces). */
  tiene(userId: string, o: ObjetoMercado): boolean {
    if (o.efecto === "objeto") return this.d.coins.owned(userId).has(o.objeto!);
    // Rol, Disquete y Machete: los compró alguna vez (son para siempre).
    if (o.efecto === "rol" || o.efecto === "disquete" || o.efecto === "machete")
      return !!this.d.db.prepare("SELECT 1 FROM mercado_registro WHERE user_id = ? AND objeto = ? AND accion = 'compra' LIMIT 1").get(userId, o.id);
    return false;
  }

  /** ¿Tiene el objeto permanente con ese efecto (Disquete, Machete)? */
  tieneEfecto(userId: string, efecto: Efecto): boolean {
    const o = this.byEfecto(efecto);
    return !!o && this.tiene(userId, o);
  }

  private log(userId: string, objeto: string, accion: "compra" | "uso" | "devolucion" | "intercambio", precio = 0, detalle: unknown = null): void {
    this.d.db
      .prepare("INSERT INTO mercado_registro (user_id, objeto, accion, precio, detalle, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, objeto, accion, precio, detalle === null ? null : JSON.stringify(detalle), this.now());
  }

  /** Gasta un uso del consumible con ese efecto. False si no le quedan. */
  consume(userId: string, efecto: Efecto, detalle: unknown = null): boolean {
    const o = this.byEfecto(efecto);
    if (!o) return false;
    return transaction(this.d.db, () => {
      if (!this.d.db.prepare("UPDATE consumibles SET usos = usos - 1 WHERE user_id = ? AND objeto = ? AND usos > 0").run(userId, o.id).changes) return false;
      this.log(userId, o.id, "uso", 0, detalle);
      return true;
    });
  }

  /** Intercambio (src/intercambios/): pasa usos de un consumible de un Papu a otro. False si no tiene tantos. */
  transferUsos(fromId: string, toId: string, objetoId: string, n: number): boolean {
    const o = this.byId.get(objetoId);
    if (!o || !CONSUMIBLES.includes(o.efecto)) return false;
    if (n <= 0) return true;
    return transaction(this.d.db, () => {
      if (!this.d.db.prepare("UPDATE consumibles SET usos = usos - ? WHERE user_id = ? AND objeto = ? AND usos >= ?").run(n, fromId, o.id, n).changes) return false;
      this.d.db.prepare("INSERT INTO consumibles (user_id, objeto, usos) VALUES (?, ?, ?) ON CONFLICT(user_id, objeto) DO UPDATE SET usos = usos + excluded.usos").run(toId, o.id, n);
      this.log(fromId, o.id, "intercambio", 0, { a: toId, usos: -n });
      this.log(toId, o.id, "intercambio", 0, { de: fromId, usos: n });
      return true;
    });
  }

  /** Devuelve un uso (el Seguro de Gakupo de una pelea que se canceló). */
  devolver(userId: string, efecto: Efecto, detalle: unknown = null): void {
    const o = this.byEfecto(efecto);
    if (!o) return;
    transaction(this.d.db, () => {
      this.d.db.prepare("INSERT INTO consumibles (user_id, objeto, usos) VALUES (?, ?, 1) ON CONFLICT(user_id, objeto) DO UPDATE SET usos = usos + 1").run(userId, o.id);
      this.log(userId, o.id, "devolucion", 0, detalle);
    });
  }

  /** Para la ruleta y la trivia: usos que le quedan y gastar uno. */
  port(efecto: Efecto): { usos: (userId: string) => number; consume: (userId: string) => boolean } {
    return { usos: (userId) => this.usosDe(userId, efecto), consume: (userId) => this.consume(userId, efecto) };
  }

  // ───────────────────────── comprar ─────────────────────────

  /**
   * Compra en el mercado (solo abierto): se paga con Shaula-coins GANADAS (las compradas no entran: nada pagado da cuota
   * ni XP, regla 1). Consumibles: suma sus usos; adornos: van a la colección; rol: se lo pone Discord.
   */
  comprar(userId: string, objetoId: string, now = this.now()): ({ ok: true } & Compra) | { ok: false; motivo: CompraFail } {
    const o = this.byId.get(objetoId);
    if (!o) return { ok: false, motivo: "no_existe" };
    if (!this.estado(now).abierto) return { ok: false, motivo: "cerrado" };
    // Solo lo de la vitrina de hoy (rota cada día).
    if (!this.vitrina(now).some((x) => x.id === o.id)) return { ok: false, motivo: "no_esta" };
    return transaction(this.d.db, () => {
      if (this.tiene(userId, o)) return { ok: false as const, motivo: "ya_lo_tienes" as const };
      const wallet = this.d.coins.spendGanadas(userId, o.precio, `mercado ${o.id}`);
      if (!wallet) return { ok: false as const, motivo: "no_alcanza" as const };
      if (CONSUMIBLES.includes(o.efecto))
        this.d.db
          .prepare("INSERT INTO consumibles (user_id, objeto, usos) VALUES (?, ?, ?) ON CONFLICT(user_id, objeto) DO UPDATE SET usos = usos + excluded.usos")
          .run(userId, o.id, o.usos!);
      if (o.efecto === "objeto") this.d.coins.grant(userId, o.objeto!, "mercado");
      this.log(userId, o.id, "compra", o.precio);
      return { ok: true as const, objeto: o, usos: this.usos(userId, o.id), rol: o.efecto === "rol" ? o.rol! : null, wallet };
    });
  }

  // ───────────────────────── Micrófono de Meiko y regalos de Rin y Len ─────────────────────────

  /** ¿Ya activó hoy el Micrófono de Meiko? */
  microfonoHoy(userId: string, t = this.now()): boolean {
    const r = this.d.roulette;
    return !!r && r.vozMinutos(userId, r.dayOf(t)) !== null;
  }

  /** Micrófono de Meiko: hoy la misión de voz de la ruleta pide menos (gasta un uso; una vez por día). */
  activarMicrofono(userId: string, t = this.now()): { ok: true; minutos: number; usos: number } | { ok: false; motivo: "sin_usos" | "ya_activo" | "sin_ruleta" } {
    const o = this.byEfecto("microfono");
    const r = this.d.roulette;
    if (!o || !r) return { ok: false, motivo: "sin_ruleta" };
    return transaction(this.d.db, () => {
      if (this.microfonoHoy(userId, t)) return { ok: false as const, motivo: "ya_activo" as const };
      if (!this.consume(userId, "microfono")) return { ok: false as const, motivo: "sin_usos" as const };
      r.setVozMinutos(userId, r.dayOf(t), o.vozMinutos!);
      return { ok: true as const, minutos: o.vozMinutos!, usos: this.usosDe(userId, "microfono") };
    });
  }

  /**
   * Naranja y plátano de Rin y Len: le regala una tirada de la ruleta de hoy a otro Papu (gasta un uso). No a sí mismo
   * ni a quien tiene la ruleta bloqueada por un machetazo (la perdería).
   */
  regalarTirada(fromId: string, toId: string, t = this.now()): { ok: true; usos: number } | { ok: false; motivo: "sin_usos" | "a_ti" | "bloqueado" | "sin_ruleta" } {
    const r = this.d.roulette;
    if (!r || !this.byEfecto("regalo")) return { ok: false, motivo: "sin_ruleta" };
    if (fromId === toId) return { ok: false, motivo: "a_ti" };
    return transaction(this.d.db, () => {
      if (r.status(toId, t).blocked) return { ok: false as const, motivo: "bloqueado" as const };
      if (!this.consume(fromId, "regalo", { a: toId })) return { ok: false as const, motivo: "sin_usos" as const };
      r.giftSpin(toId, t);
      return { ok: true as const, usos: this.usosDe(fromId, "regalo") };
    });
  }

  // ───────────────────────── Luna de IA, Sake de Haku, Doble helado y Machete ─────────────────────────

  /** Hasta cuándo dura la Luna de IA (0 si no está activa). */
  lunaHasta(userId: string, now = this.now()): number {
    const until = Number(kvGet(this.d.db, `mercado:luna:${userId}`) ?? 0);
    return until > now ? until : 0;
  }

  /** Cuántas veces vale la XP de un mensaje que contesta un Vocaloid: 3 con la Luna de IA activa. */
  quotaBoost(userId: string, now = this.now()): number {
    return this.lunaHasta(userId, now) ? 3 : 1;
  }

  /** Luna de IA: por `dias` días, la XP de los mensajes que contesta un Vocaloid vale el triple (gasta un uso). */
  activarLuna(userId: string, now = this.now()): { ok: true; hasta: number; usos: number } | { ok: false; motivo: "sin_usos" | "ya_activa" } {
    const o = this.byEfecto("luna");
    if (!o) return { ok: false, motivo: "sin_usos" };
    return transaction(this.d.db, () => {
      if (this.lunaHasta(userId, now)) return { ok: false as const, motivo: "ya_activa" as const };
      if (!this.consume(userId, "luna")) return { ok: false as const, motivo: "sin_usos" as const };
      const hasta = now + o.dias! * 86_400_000;
      kvSet(this.d.db, `mercado:luna:${userId}`, String(hasta));
      return { ok: true as const, hasta, usos: this.usosDe(userId, "luna") };
    });
  }

  /**
   * Sake de Haku: la forma de la respuesta de la adivinanza de boda abierta («▢▢▢▢ ▢▢▢»: palabras y letras). Gasta un uso
   * la primera vez por adivinanza; volver a verla en la misma no gasta.
   */
  sake(userId: string): { ok: true; pista: string; palabras: number; letras: number; usos: number; gasto: boolean } | { ok: false; motivo: "sin_usos" | "sin_adivinanza" } {
    const w = this.d.weddings;
    const r = w?.active();
    if (!w || !r) return { ok: false, motivo: "sin_adivinanza" };
    return transaction(this.d.db, () => {
      const key = `mercado:sake:${r.messageId}:${userId}`;
      const visto = !!kvGet(this.d.db, key);
      if (!visto && !this.consume(userId, "sake", { adivinanza: r.messageId })) return { ok: false as const, motivo: "sin_usos" as const };
      kvSet(this.d.db, key, "1");
      const palabras = (w.riddleOf(r).respuestas[0] ?? "").trim().split(/\s+/).filter(Boolean);
      const letras = palabras.reduce((a, p) => a + [...p].length, 0);
      return { ok: true as const, pista: palabras.map((p) => "▢".repeat([...p].length)).join("   "), palabras: palabras.length, letras, usos: this.usosDe(userId, "sake"), gasto: !visto };
    });
  }

  /** Doble helado de Kaito: un sobre común regalado pasa a ser raro (gasta un uso). */
  mejorarSobre(userId: string): { ok: true; usos: number } | { ok: false; motivo: "sin_usos" | "sin_sobre" } {
    return transaction(this.d.db, () => {
      if (this.usosDe(userId, "doblehelado") <= 0) return { ok: false as const, motivo: "sin_usos" as const };
      if (!this.d.coins.upgradeSobre(userId)) return { ok: false as const, motivo: "sin_sobre" as const };
      this.consume(userId, "doblehelado");
      return { ok: true as const, usos: this.usosDe(userId, "doblehelado") };
    });
  }

  /**
   * Machete de Neru: ¿puede dar un machetazo de mentira ahora? Lo anota (y empieza la espera). Devuelve cuándo podrá el
   * próximo si aún no puede.
   */
  machetazo(userId: string, now = this.now()): { ok: true } | { ok: false; motivo: "sin_machete" } | { ok: false; motivo: "espera"; desde: number } {
    const o = this.byEfecto("machete");
    if (!o || !this.tiene(userId, o)) return { ok: false, motivo: "sin_machete" };
    const key = `mercado:machete:${userId}`;
    const last = Number(kvGet(this.d.db, key) ?? 0);
    const next = last + o.espera! * 1000;
    if (now < next) return { ok: false, motivo: "espera", desde: next };
    kvSet(this.d.db, key, String(now));
    return { ok: true };
  }

  // ───────────────────────── PC de Adachi Rei ─────────────────────────

  /**
   * Reinicia el día del Papu sin quitarle nada: le devuelve la cuota con los Vocaloids (lo donado no vuelve) y, desde
   * ahora, la ruleta, las partidas con XP y el tope de la trivia, y el tope de monedas por actividad cuentan de cero.
   * Las misiones ya cumplidas siguen cumplidas (vuelven sus tiradas). Gasta un uso.
   */
  usarPc(userId: string, t = this.now()): ReinicioPc | null {
    return transaction(this.d.db, () => {
      if (this.usosDe(userId, "pc") <= 0) return null;
      const now = new Date(t);
      const day = dayKey(now, this.d.timeZone);
      const prev = reinicioDe(this.d.db, userId, day);
      const mensajes = Math.max(0, this.d.quota.used(userId, now) - this.d.quota.donated(userId, now));
      this.d.quota.reset(userId, now);
      const ruleta = this.d.roulette?.spinsOn(userId, day) ?? 0;
      const partidas = this.d.trivia?.runsToday(userId, t) ?? 0;
      const xpTrivia = this.d.trivia?.xpToday(userId, t) ?? 0;
      const act = this.d.coins.activityToday(userId, t);
      guardarReinicio(this.d.db, userId, day, { veces: prev.veces + 1, ruleta, triviaPartidas: partidas, triviaXp: xpTrivia, monedasXp: act.xp, monedasPrevia: act.actividad });
      const out = { mensajes, tiradas: ruleta - prev.ruleta, partidas: partidas - prev.triviaPartidas, xpTrivia: xpTrivia - prev.triviaXp, monedas: act.actividad };
      this.consume(userId, "pc", out);
      this.d.coins.sync(userId, 1, t);
      return { ...out, usos: this.usosDe(userId, "pc") };
    });
  }
}
