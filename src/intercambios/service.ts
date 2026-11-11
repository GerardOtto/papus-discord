// Intercambios entre Papus (PLAN §3.11, config/intercambios.json). Como las ofertas de Steam: quien ofrece arma lo
// que entrega y lo que pide; la oferta es abierta (cualquiera la acepta) o dirigida a un Papu (acepta, rechaza o
// contesta con una contraoferta). Nada se aparta al ofrecer: al aceptar se revisa que los dos tengan lo suyo y todo
// se cambia de una vez, en una sola transacción (o nada). Sin Discord: src/discord/intercambios.ts.
import type { CoinService } from "../coins/service";
import { transaction, type Db } from "../db/database";
import type { LevelChange, LevelService } from "../levels/service";
import type { MercadoService } from "../mercado/service";
import { CONSUMIBLES } from "../mercado/rules";
import type { Quota } from "../quota/quota";
import { nextDayStart } from "../time";
import { estaVacio, llevaCuota, normalizar, objetoCambiable, TIPOS_SOBRE, type IntercambioSettings, type Paquete } from "./rules";

export type Estado = "abierta" | "hecha" | "rechazada" | "cancelada" | "vencida" | "contraofertada";

export interface Oferta {
  id: number;
  de: string;
  /** null = abierta (cualquiera la acepta). */
  para: string | null;
  /** Lo que entrega quien la hace. */
  da: Paquete;
  /** Lo que pide a cambio. */
  pide: Paquete;
  estado: Estado;
  /** La oferta a la que contesta (contraoferta). */
  padre: number | null;
  /** Quien la aceptó. */
  con: string | null;
  creadoAt: number;
  venceAt: number;
  cerradoAt: number | null;
  canal: string | null;
  mensaje: string | null;
}

/** Por qué un Papu no tiene lo de su lado (o el otro no puede recibirlo). */
export type Falta =
  | { que: "ganadas" | "compradas" | "xp" | "cuota"; tiene: number; pide: number }
  | { que: "niveles"; tiene: number; pide: number }
  | { que: "sobre"; tipo: string; tiene: number; pide: number }
  | { que: "objeto"; id: string }
  | { que: "objeto_no_se_cambia"; id: string }
  | { que: "consumible"; id: string; tiene: number; pide: number }
  | { que: "ya_tiene_objeto"; id: string }
  | { que: "cuota_llena"; cabe: number; pide: number }
  | { que: "sin_limite" }
  | { que: "xp_maxima"; cabe: number; pide: number };

export type CrearFail = "vacia" | "a_ti" | "demasiadas" | "padre" | { falta: Falta[] };
export type AceptarFail = "no_existe" | "cerrada" | "vencida" | "no_es_para_ti" | "propia" | { faltaDe: Falta[] } | { faltaTuyo: Falta[] };

export interface Hecho {
  oferta: Oferta;
  /** Cambios de nivel de cada uno (para el apodo y el rol de honor; sin bono de monedas). */
  cambios: LevelChange[];
}

export interface IntercambioServiceDeps {
  db: Db;
  settings: IntercambioSettings;
  coins: CoinService;
  levels: LevelService;
  quota: Quota;
  mercado: MercadoService | null;
  timeZone: string;
  now?: () => number;
}

interface Row {
  id: number;
  de: string;
  para: string | null;
  da: string;
  pide: string;
  estado: Estado;
  padre: number | null;
  con: string | null;
  creado_at: number;
  vence_at: number;
  cerrado_at: number | null;
  canal: string | null;
  mensaje: string | null;
}

const toOferta = (r: Row): Oferta => ({
  id: r.id,
  de: r.de,
  para: r.para,
  da: normalizar(JSON.parse(r.da) as Paquete),
  pide: normalizar(JSON.parse(r.pide) as Paquete),
  estado: r.estado,
  padre: r.padre,
  con: r.con,
  creadoAt: r.creado_at,
  venceAt: r.vence_at,
  cerradoAt: r.cerrado_at,
  canal: r.canal,
  mensaje: r.mensaje,
});

export class IntercambioService {
  private readonly now: () => number;

  constructor(private readonly d: IntercambioServiceDeps) {
    this.now = d.now ?? Date.now;
  }

  get settings(): IntercambioSettings {
    return this.d.settings;
  }

  // ───────────────────────── consultas ─────────────────────────

  get(id: number): Oferta | null {
    const r = this.d.db.prepare("SELECT * FROM intercambios WHERE id = ?").get(id) as Row | undefined;
    return r ? toOferta(r) : null;
  }

  /** Ofertas abiertas que hizo un Papu. */
  abiertasDe(userId: string): Oferta[] {
    return (this.d.db.prepare("SELECT * FROM intercambios WHERE de = ? AND estado = 'abierta' ORDER BY id").all(userId) as unknown as Row[]).map(toOferta);
  }

  /** Ofertas abiertas dirigidas a un Papu. */
  abiertasPara(userId: string): Oferta[] {
    return (this.d.db.prepare("SELECT * FROM intercambios WHERE para = ? AND estado = 'abierta' ORDER BY id").all(userId) as unknown as Row[]).map(toOferta);
  }

  /** Guarda dónde quedó el anuncio de la oferta. */
  setMensaje(id: number, canal: string, mensaje: string): void {
    this.d.db.prepare("UPDATE intercambios SET canal = ?, mensaje = ? WHERE id = ?").run(canal, mensaje, id);
  }

  // ───────────────────────── qué tiene cada uno ─────────────────────────

  /** Lo que le falta a `userId` para entregar `p` (vacío = lo tiene todo). */
  faltaParaDar(userId: string, p: Paquete): Falta[] {
    const out: Falta[] = [];
    const w = this.d.coins.wallet(userId);
    if (w.ganadas < p.ganadas) out.push({ que: "ganadas", tiene: w.ganadas, pide: p.ganadas });
    if (w.compradas < p.compradas) out.push({ que: "compradas", tiene: w.compradas, pide: p.compradas });
    const xp = this.d.levels.store.get(userId).xp;
    const xpNiveles = this.d.levels.xpOfLevels(userId, p.niveles);
    if (xpNiveles === null) out.push({ que: "niveles", tiene: this.d.levels.level(userId).level - 1, pide: p.niveles });
    // XP y niveles salen de la misma XP: tiene que alcanzar para los dos.
    else if (xp < p.xp + xpNiveles) out.push({ que: "xp", tiene: Math.max(0, xp - xpNiveles), pide: p.xp });
    if (p.cuota > 0) {
      const left = this.d.quota.remaining(userId, new Date(this.now()));
      if (!Number.isFinite(left)) out.push({ que: "sin_limite" });
      else if (left < p.cuota) out.push({ que: "cuota", tiene: left, pide: p.cuota });
    }
    for (const t of TIPOS_SOBRE) {
      const n = this.d.coins.sobresGratis(userId, t);
      if (n < p.sobres[t]) out.push({ que: "sobre", tipo: t, tiene: n, pide: p.sobres[t] });
    }
    const owned = this.d.coins.owned(userId);
    for (const id of p.objetos) {
      const o = this.d.coins.byId.get(id);
      if (!o || !objetoCambiable(o)) out.push({ que: "objeto_no_se_cambia", id });
      else if (!owned.has(id)) out.push({ que: "objeto", id });
    }
    for (const [id, n] of Object.entries(p.consumibles)) {
      const o = this.d.mercado?.byId.get(id);
      const tiene = o && CONSUMIBLES.includes(o.efecto) ? this.d.mercado!.usos(userId, id) : 0;
      if (tiene < n) out.push({ que: "consumible", id, tiene, pide: n });
    }
    return out;
  }

  /** Lo que impide que `userId` reciba `p` de `fromId` (cuota llena, objeto que ya tiene, XP sobre el máximo). */
  faltaParaRecibir(userId: string, fromId: string, p: Paquete): Falta[] {
    const out: Falta[] = [];
    if (p.cuota > 0) {
      const room = this.d.quota.room(userId, new Date(this.now()));
      if (!Number.isFinite(this.d.quota.remaining(userId, new Date(this.now())))) out.push({ que: "sin_limite" });
      else if (room < p.cuota) out.push({ que: "cuota_llena", cabe: room, pide: p.cuota });
    }
    const xp = p.xp + (this.d.levels.xpOfLevels(fromId, p.niveles) ?? 0);
    const cabe = this.d.levels.xpRoom(userId);
    if (xp > 0 && xp > cabe) out.push({ que: "xp_maxima", cabe, pide: xp });
    const owned = this.d.coins.owned(userId);
    for (const id of p.objetos) if (owned.has(id)) out.push({ que: "ya_tiene_objeto", id });
    return out;
  }

  // ───────────────────────── ofrecer ─────────────────────────

  private venceAt(da: Paquete, pide: Paquete): number {
    const now = this.now();
    const horas = now + this.d.settings.venceHoras * 3_600_000;
    // La cuota es de hoy: la oferta vence al terminar el día.
    return llevaCuota(da, pide) ? Math.min(horas, nextDayStart(new Date(now), this.d.timeZone)) : horas;
  }

  /**
   * Publica una oferta. Quien la hace tiene que tener ya lo que entrega (se revisa otra vez al aceptar). Con `padre`
   * es una contraoferta: la oferta dirigida original queda cerrada como "contraofertada" (una abierta sigue abierta).
   */
  crear(de: string, para: string | null, daRaw: Paquete, pideRaw: Paquete, padre: number | null = null): { ok: true; oferta: Oferta; cerrada: Oferta | null } | { ok: false; motivo: CrearFail } {
    const da = normalizar(daRaw);
    const pide = normalizar(pideRaw);
    if (estaVacio(da) || estaVacio(pide)) return { ok: false, motivo: "vacia" };
    if (para === de) return { ok: false, motivo: "a_ti" };
    return transaction(this.d.db, () => {
      const p = padre !== null ? this.get(padre) : null;
      if (padre !== null && (!p || p.estado !== "abierta" || p.venceAt <= this.now() || p.de === de || (p.para !== null && p.para !== de) || p.de !== para)) return { ok: false as const, motivo: "padre" as const };
      if (this.abiertasDe(de).length >= this.d.settings.maxAbiertas) return { ok: false as const, motivo: "demasiadas" as const };
      const falta = this.faltaParaDar(de, da);
      if (falta.length) return { ok: false as const, motivo: { falta } };
      let cerrada: Oferta | null = null;
      if (p && p.para !== null) {
        this.cerrar(p.id, "contraofertada", de);
        cerrada = this.get(p.id);
      }
      const now = this.now();
      const r = this.d.db
        .prepare("INSERT INTO intercambios (de, para, da, pide, padre, creado_at, vence_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(de, para, JSON.stringify(da), JSON.stringify(pide), padre, now, this.venceAt(da, pide));
      return { ok: true as const, oferta: this.get(Number(r.lastInsertRowid))!, cerrada };
    });
  }

  private cerrar(id: number, estado: Exclude<Estado, "abierta">, con: string | null = null): void {
    this.d.db.prepare("UPDATE intercambios SET estado = ?, con = COALESCE(?, con), cerrado_at = ? WHERE id = ? AND estado = 'abierta'").run(estado, con, this.now(), id);
  }

  /** Quien la hizo la retira (o GyroP). */
  retirar(id: number, by: string, staff = false): Oferta | null {
    const o = this.get(id);
    if (!o || o.estado !== "abierta" || (o.de !== by && !staff)) return null;
    this.cerrar(id, "cancelada", by);
    return this.get(id);
  }

  /** El Papu al que iba dirigida la rechaza. */
  rechazar(id: number, by: string): Oferta | null {
    const o = this.get(id);
    if (!o || o.estado !== "abierta" || o.para !== by) return null;
    this.cerrar(id, "rechazada", by);
    return this.get(id);
  }

  /** Vence las ofertas pasadas de su hora. Devuelve las que venció (para editar sus anuncios). */
  vencer(): Oferta[] {
    const rows = this.d.db.prepare("SELECT * FROM intercambios WHERE estado = 'abierta' AND vence_at <= ?").all(this.now()) as unknown as Row[];
    for (const r of rows) this.cerrar(r.id, "vencida");
    return rows.map((r) => this.get(r.id)!);
  }

  // ───────────────────────── aceptar ─────────────────────────

  /** ¿Puede `by` aceptar ahora? (sin cambiar nada; para la pantalla de confirmar). */
  revisar(id: number, by: string): { ok: true; oferta: Oferta } | { ok: false; motivo: AceptarFail } {
    const o = this.get(id);
    if (!o) return { ok: false, motivo: "no_existe" };
    if (o.estado !== "abierta") return { ok: false, motivo: "cerrada" };
    if (o.venceAt <= this.now()) return { ok: false, motivo: "vencida" };
    if (o.de === by) return { ok: false, motivo: "propia" };
    if (o.para !== null && o.para !== by) return { ok: false, motivo: "no_es_para_ti" };
    const faltaTuyo = [...this.faltaParaDar(by, o.pide), ...this.faltaParaRecibir(by, o.de, o.da)];
    if (faltaTuyo.length) return { ok: false, motivo: { faltaTuyo } };
    const faltaDe = [...this.faltaParaDar(o.de, o.da), ...this.faltaParaRecibir(o.de, by, o.pide)];
    if (faltaDe.length) return { ok: false, motivo: { faltaDe } };
    return { ok: true, oferta: o };
  }

  /** Acepta y hace el cambio completo (todo o nada). */
  aceptar(id: number, by: string): ({ ok: true } & Hecho) | { ok: false; motivo: AceptarFail } {
    return transaction(this.d.db, () => {
      const r = this.revisar(id, by);
      if (!r.ok) return r;
      const o = r.oferta;
      const cambios = [...this.entregar(o.de, by, o.da, o.id), ...this.entregar(by, o.de, o.pide, o.id)];
      this.cerrar(o.id, "hecha", by);
      return { ok: true as const, oferta: this.get(o.id)!, cambios };
    });
  }

  /** Mueve un paquete de un Papu a otro (ya revisado). Si algo falla, lanza: la transacción vuelve todo atrás. */
  private entregar(fromId: string, toId: string, p: Paquete, id: number): LevelChange[] {
    const motivo = `intercambio #${id}`;
    const ok = (v: boolean, que: string) => {
      if (!v) throw new Error(`Intercambio #${id}: no se pudo mover ${que}`);
    };
    ok(this.d.coins.transfer(fromId, toId, "ganadas", p.ganadas, motivo), "ganadas");
    ok(this.d.coins.transfer(fromId, toId, "compradas", p.compradas, motivo), "compradas");
    for (const t of TIPOS_SOBRE) ok(this.d.coins.transferSobres(fromId, toId, t, p.sobres[t]), `sobres ${t}`);
    for (const objeto of p.objetos) ok(this.d.coins.transferObjeto(fromId, toId, objeto, motivo), objeto);
    for (const [objeto, n] of Object.entries(p.consumibles)) ok(!!this.d.mercado?.transferUsos(fromId, toId, objeto, n), objeto);
    if (p.cuota > 0) ok(this.d.quota.donate(fromId, toId, p.cuota, new Date(this.now())).ok, "cuota");
    const cambios: LevelChange[] = [];
    // Niveles: se cuentan con el nivel de antes de entregar XP suelta.
    const xp = p.xp + (this.d.levels.xpOfLevels(fromId, p.niveles) ?? 0);
    if (xp > 0) {
      const r = this.d.levels.transferXp(fromId, toId, xp);
      ok(!!r, "XP");
      if (r!.from) cambios.push(r!.from);
      if (r!.to) cambios.push(r!.to);
    }
    return cambios;
  }
}
