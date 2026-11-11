// Cola de videos personalizados (PLAN §2, docs/KOFI.md): una sola cola por orden de llegada para los pedidos de
// Triple Baka (incluidos en la membresia) y los de la tienda de Ko-fi. Decisiones de GyroP (16 oct. 2026):
// - Triple Baka: un pedido cada 30 dias, sin acumular, y nunca mas de uno activo a la vez;
// - la tienda se registra a mano con /cola agregar (el aviso automatico de Ko-fi, despues);
// - el tablero publico muestra la mencion del Papu, nunca para quien es el video.
// Plazos: 7 dias (saludo/ocasion) o 14 (tema libre); una correccion gratis dentro de 7 dias tras la entrega.
// Los datos de los pedidos se guardan solo en la base local y nunca se envian a un LLM.
import type { Sql } from "./sql";

export type Origin = "triple_baka" | "tienda";
export type ProductId = "triple_baka" | "express" | "personalizado" | "especial";
export type OccasionId = "cumpleanos" | "graduacion" | "logro" | "animo" | "dedicatoria" | "canal" | "tema_libre";
export type OrderState = "en_cola" | "en_produccion" | "entregado" | "rechazado" | "cancelado";

export const PRODUCTS: Record<ProductId, { label: string; maxVocaloids: number; temaLibre: boolean }> = {
  triple_baka: { label: "💥 Video Triple Baka (1 min)", maxVocaloids: 2, temaLibre: false },
  express: { label: "⚡ Saludo Express (30 s)", maxVocaloids: 1, temaLibre: true },
  personalizado: { label: "🎥 Video Personalizado (1 min)", maxVocaloids: 2, temaLibre: true },
  especial: { label: "🌟 Video Especial a tu Medida (2 min)", maxVocaloids: 3, temaLibre: true },
};

export const OCCASIONS: Record<OccasionId, string> = {
  cumpleanos: "🎂 Cumpleaños",
  graduacion: "🎓 Graduación",
  logro: "🏆 Felicitaciones por un logro",
  animo: "💪 Ánimo / Mejórate pronto",
  dedicatoria: "💌 Dedicatoria especial",
  canal: "🎙️ Saludo para tu canal o stream",
  tema_libre: "🎨 Tema libre",
};

export const STATE_LABEL: Record<OrderState, string> = {
  en_cola: "⏳ en cola",
  en_produccion: "🎬 en producción",
  entregado: "✅ entregado",
  rechazado: "🚫 rechazado",
  cancelado: "✖️ cancelado",
};

const DAY = 86_400_000;
export const MONTH_MS = 30 * DAY;
export const CORRECTION_MS = 7 * DAY;
const ACTIVE: OrderState[] = ["en_cola", "en_produccion"];

/** Transiciones validas. "entregado -> en_produccion" es la correccion gratis (dentro de 7 dias). */
const TRANSITIONS: Record<OrderState, OrderState[]> = {
  en_cola: ["en_produccion", "rechazado", "cancelado"],
  en_produccion: ["entregado", "en_cola", "rechazado", "cancelado"],
  entregado: ["en_produccion"],
  rechazado: ["en_cola"],
  cancelado: ["en_cola"],
};

export interface OrderInput {
  origen: Origin;
  papuId?: string | null;
  comprador?: string | null;
  producto: ProductId;
  ocasion: OccasionId;
  para: string;
  pronunciacion?: string | null;
  /** El primero es quien habla mas. */
  vocaloids: string[];
  detalles?: string | null;
  /** AAAA-MM-DD. */
  fechaLimite?: string | null;
  publicar?: boolean;
}

export interface Order {
  id: number;
  origen: Origin;
  papuId: string | null;
  comprador: string | null;
  producto: ProductId;
  ocasion: OccasionId;
  para: string;
  pronunciacion: string | null;
  vocaloids: string[];
  detalles: string | null;
  fechaLimite: string | null;
  publicar: boolean;
  estado: OrderState;
  motivo: string | null;
  revisar: string | null;
  creadoAt: number;
  plazoAt: number;
  entregadoAt: number | null;
}

export class OrderError extends Error {}

/** Revision automatica del texto del pedido (mismas reglas fijas de Neru): devuelve un aviso para GyroP o null. */
export type OrderReviewer = (text: string) => string | null;

interface Row {
  id: number;
  origen: Origin;
  papu_id: string | null;
  comprador: string | null;
  producto: ProductId;
  ocasion: OccasionId;
  para: string;
  pronunciacion: string | null;
  vocaloids: string;
  detalles: string | null;
  fecha_limite: string | null;
  publicar: number;
  estado: OrderState;
  motivo: string | null;
  revisar: string | null;
  creado_at: number;
  plazo_at: number;
  entregado_at: number | null;
}

const toOrder = (r: Row): Order => ({
  id: r.id,
  origen: r.origen,
  papuId: r.papu_id,
  comprador: r.comprador,
  producto: r.producto,
  ocasion: r.ocasion,
  para: r.para,
  pronunciacion: r.pronunciacion,
  vocaloids: JSON.parse(r.vocaloids) as string[],
  detalles: r.detalles,
  fechaLimite: r.fecha_limite,
  publicar: !!r.publicar,
  estado: r.estado,
  motivo: r.motivo,
  revisar: r.revisar,
  creadoAt: r.creado_at,
  plazoAt: r.plazo_at,
  entregadoAt: r.entregado_at,
});

const clean = (s: string | null | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

export class OrderQueue {
  constructor(
    private readonly db: Sql,
    /** Ids validos de Vocaloids (elenco del motor). */
    private readonly cast: readonly string[],
    private readonly reviewer: OrderReviewer = () => null,
    private readonly now: () => number = Date.now,
  ) {}

  /** ¿Puede este Papu Triple Baka pedir ahora? Un pedido cada 30 dias, sin acumular, y nunca dos activos. */
  async canOrderTripleBaka(
    papuId: string,
  ): Promise<{ ok: true } | { ok: false; reason: "activo"; order: Order } | { ok: false; reason: "mes"; nextAt: number }> {
    const active = await this.activeOf(papuId);
    if (active) return { ok: false, reason: "activo", order: active };
    const last = await this.db.get<{ t: number | null }>(
      "SELECT MAX(creado_at) AS t FROM pedidos WHERE papu_id = ? AND origen = 'triple_baka' AND estado NOT IN ('rechazado', 'cancelado')",
      papuId,
    );
    const t = last?.t ?? null;
    if (t !== null && this.now() - t < MONTH_MS) return { ok: false, reason: "mes", nextAt: t + MONTH_MS };
    return { ok: true };
  }

  async create(input: OrderInput): Promise<Order> {
    const product = PRODUCTS[input.producto];
    if (!product) throw new OrderError("Producto desconocido.");
    if (!(input.ocasion in OCCASIONS)) throw new OrderError("Ocasión desconocida.");
    if (input.ocasion === "tema_libre" && !product.temaLibre) throw new OrderError("Este video es para una ocasión (saludo, cumpleaños o dedicatoria), no de tema libre.");
    const vocaloids = [...new Set(input.vocaloids.map((v) => v.toLowerCase()))];
    if (!vocaloids.length) throw new OrderError("Elige al menos un Vocaloid.");
    if (vocaloids.length > product.maxVocaloids) throw new OrderError(`Este video lleva como máximo ${product.maxVocaloids} Vocaloid${product.maxVocaloids > 1 ? "s" : ""}.`);
    const unknown = vocaloids.filter((v) => !this.cast.includes(v));
    if (unknown.length) throw new OrderError(`No están en el elenco del canal: ${unknown.join(", ")}.`);
    const para = clean(input.para, 80);
    if (!para) throw new OrderError("Falta el nombre de la persona que recibe el video.");
    if (input.fechaLimite && !/^\d{4}-\d{2}-\d{2}$/.test(input.fechaLimite)) throw new OrderError("La fecha límite va como AAAA-MM-DD (ej.: 2026-11-03).");
    if (input.origen === "triple_baka") {
      if (!input.papuId) throw new OrderError("Falta el Papu.");
      const can = await this.canOrderTripleBaka(input.papuId);
      if (!can.ok) throw new OrderError(can.reason === "activo" ? `Ya tienes el pedido #${can.order.id} en curso.` : "Ya pediste tu video de este mes.");
    }
    const detalles = clean(input.detalles, 1000);
    const pron = clean(input.pronunciacion, 80);
    const revisar = this.reviewer([para, pron, detalles].filter(Boolean).join("\n"));
    const t = this.now();
    const plazo = t + (input.ocasion === "tema_libre" ? 14 : 7) * DAY;
    const r = await this.db.run(
      `INSERT INTO pedidos (origen, papu_id, comprador, producto, ocasion, para, pronunciacion, vocaloids, detalles, fecha_limite,
         publicar, estado, revisar, creado_at, plazo_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_cola', ?, ?, ?)`,
      input.origen,
        input.papuId ?? null,
        clean(input.comprador, 80),
        input.producto,
        input.ocasion,
        para,
        pron,
        JSON.stringify(vocaloids),
        detalles,
        input.fechaLimite ?? null,
        input.publicar ? 1 : 0,
        revisar,
      t,
      plazo,
    );
    return (await this.get(r.lastRowId))!;
  }

  async get(id: number): Promise<Order | null> {
    const r = await this.db.get<Row>("SELECT * FROM pedidos WHERE id = ?", id);
    return r ? toOrder(r) : null;
  }

  /** Pedidos activos en orden de llegada (FIFO, sin saltarse a nadie). */
  async active(): Promise<Order[]> {
    const rows = await this.db.all<Row>(`SELECT * FROM pedidos WHERE estado IN (${ACTIVE.map(() => "?").join(",")}) ORDER BY creado_at, id`, ...ACTIVE);
    return rows.map(toOrder);
  }

  async activeOf(papuId: string): Promise<Order | null> {
    return (await this.active()).find((o) => o.papuId === papuId) ?? null;
  }

  /** Ultimo pedido del Papu (activo o no). */
  async latestOf(papuId: string): Promise<Order | null> {
    const r = await this.db.get<Row>("SELECT * FROM pedidos WHERE papu_id = ? ORDER BY creado_at DESC, id DESC LIMIT 1", papuId);
    return r ? toOrder(r) : null;
  }

  /** Posicion en la cola (1 = el siguiente), o null si no esta activo. */
  async position(id: number): Promise<number | null> {
    const i = (await this.active()).findIndex((o) => o.id === id);
    return i < 0 ? null : i + 1;
  }

  async setState(id: number, estado: OrderState, motivo?: string | null): Promise<Order> {
    const o = await this.get(id);
    if (!o) throw new OrderError(`No existe el pedido #${id}.`);
    if (!TRANSITIONS[o.estado].includes(estado)) throw new OrderError(`El pedido #${id} está ${STATE_LABEL[o.estado]}: no puede pasar a ${STATE_LABEL[estado]}.`);
    if (o.estado === "entregado" && estado === "en_produccion" && this.now() - (o.entregadoAt ?? 0) > CORRECTION_MS) {
      throw new OrderError(`Pasaron más de 7 días desde la entrega del pedido #${id}: la corrección gratis ya venció.`);
    }
    await this.db.run(
      "UPDATE pedidos SET estado = ?, motivo = ?, entregado_at = ? WHERE id = ?",
      estado,
      clean(motivo, 300),
      estado === "entregado" ? this.now() : o.entregadoAt,
      id,
    );
    return (await this.get(id))!;
  }

  /** Pedidos activos a los que les quedan menos de `withinMs` para su plazo (o ya vencidos). */
  async dueSoon(withinMs = 2 * DAY): Promise<Order[]> {
    const t = this.now();
    return (await this.active()).filter((o) => o.plazoAt - t <= withinMs);
  }

  /** Entregados en los ultimos `ms` (para el tablero). */
  async deliveredSince(ms: number): Promise<number> {
    const r = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM pedidos WHERE estado = 'entregado' AND entregado_at >= ?", this.now() - ms);
    return r?.n ?? 0;
  }
}
