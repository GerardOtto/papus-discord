// Apps del celular de Neru que necesitan los datos del bot (PLAN §3.15). La página deja un pedido en D1
// (worker/src/celular/api.ts), el puente lo toma (src/celular/puente.ts) y aquí se resuelve con las mismas reglas
// que los comandos de Discord: la página nunca decide nada, solo pide.
import { toCardEquip } from "../coins/equip";
import type { CoinService } from "../coins/service";
import { aplicar, elegidos, RANURAS_SIMPLES, snapshot, type Eleccion } from "../coins/tarjeta-web";
import { NoSePuede, type PedidoCelular } from "../celular/puente";
import type { CardData } from "../levels/card";
import type { LevelStore } from "../levels/store";
import { dibujarTarjeta } from "./tarjeta-web";

/** Un Papu para elegir (Donar, regalo de Rin y Len, Comercio). */
export interface PapuElegible {
  id: string;
  nombre: string;
}

export interface AppsCelularDeps {
  coins: CoinService | null;
  /** Mercado negro y consumibles (src/discord/mercado.ts). */
  mercado?: {
    celularEstado(userId: string): unknown;
    celularComprar(userId: string, id: string, noSePuede: (msg: string) => Error): Promise<string>;
    celularUsar(userId: string, accion: string, para: string | null, noSePuede: (msg: string) => Error): Promise<string>;
  } | null;
  /** /donar: cuota de hoy y donar (con el anuncio público, como el comando). */
  donar?: {
    estado(userId: string): { quedan: number; tope: number; sinLimite: boolean };
    donar(fromId: string, toId: string, n: number): Promise<string>;
  } | null;
  /** Tienda de la semana y sobres (src/discord/tienda.ts). */
  tienda?: {
    celularEstado(userId: string): Promise<unknown>;
    celularComprar(userId: string, id: string, noSePuede: (msg: string) => Error): Promise<string>;
    celularSobre(userId: string, modo: string, arg: string, noSePuede: (msg: string) => Error): unknown;
  } | null;
  /** Ruleta de las misiones (src/discord/ruleta.ts). `girar` recibe el nombre y avatar del Papu para el GIF público. */
  ruleta?: {
    celularEstado(userId: string): unknown;
    girar(userId: string, accion: string, noSePuede: (msg: string) => Error): Promise<unknown>;
  } | null;
  /** Intercambios (src/discord/intercambios.ts). */
  comercio?: {
    celularEstado(userId: string): Promise<unknown>;
    celularInventario(userId: string): unknown;
    celularPublicar(userId: string, b: { para: string | null; da: unknown; pide: unknown; padre: number | null }, noSePuede: (msg: string) => Error): Promise<string>;
    celularResponder(userId: string, id: number, accion: string, noSePuede: (msg: string) => Error): Promise<string>;
  } | null;
  /** Busca Papus del servidor por nombre (sin bots). */
  buscarPapus?: (q: string) => Promise<PapuElegible[]>;
  store: LevelStore;
  cardData: (userId: string) => Promise<CardData>;
  founder: (userId: string) => number | null;
}

const ID = /^[a-z0-9-]{1,64}$/;

/** Lo que manda la página para la tarjeta, limpio (null si no tiene la forma esperada). */
export function leerEleccion(raw: unknown): Eleccion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out = { lado: r.lado === "derecha" ? "derecha" : "izquierda", insignias: [] as string[] } as Eleccion;
  for (const k of RANURAS_SIMPLES) {
    const v = r[k];
    if (v === null || v === undefined || v === "") out[k] = null;
    else if (typeof v === "string" && ID.test(v)) out[k] = v;
    else return null;
  }
  if (r.insignias !== undefined) {
    if (!Array.isArray(r.insignias) || r.insignias.length > 3 || !r.insignias.every((x) => typeof x === "string" && ID.test(x))) return null;
    out.insignias = [...new Set(r.insignias as string[])];
  }
  return out;
}

export class AppsCelular {
  constructor(private readonly d: AppsCelularDeps) {}

  async manejar(p: PedidoCelular): Promise<unknown> {
    if (p.accion === "buscar-papus") return this.buscar(p);
    if (p.app === "tarjeta") return this.tarjeta(p);
    if (p.app === "mercado" || p.app === "mochila") return this.mercado(p);
    if (p.app === "donar") return this.donarApp(p);
    if (p.app === "tienda") return this.tiendaApp(p);
    if (p.app === "ruleta") return this.ruletaApp(p);
    if (p.app === "comercio") return this.comercioApp(p);
    throw new NoSePuede("Esa app todavía no está lista. Muy pronto.");
  }

  private async buscar(p: PedidoCelular): Promise<unknown> {
    const q = String((p.datos as { q?: unknown } | null)?.q ?? "").trim().slice(0, 32);
    if (q.length < 2 || !this.d.buscarPapus) return { papus: [] };
    return { papus: (await this.d.buscarPapus(q)).filter((x) => x.id !== p.papu).slice(0, 12) };
  }

  // ───────────────────────── Mercado y Mochila ─────────────────────────

  private async mercado(p: PedidoCelular): Promise<unknown> {
    const m = this.d.mercado;
    if (!m) throw new NoSePuede("El mercado negro está cerrado por ahora.");
    const d = (p.datos ?? {}) as { id?: unknown; accion?: unknown; para?: unknown };
    if (p.accion === "estado") return m.celularEstado(p.papu);
    const fail = (msg: string) => new NoSePuede(msg);
    if (p.accion === "comprar") {
      const mensaje = await m.celularComprar(p.papu, String(d.id ?? "").slice(0, 64), fail);
      return { mensaje, estado: m.celularEstado(p.papu) };
    }
    if (p.accion === "usar") {
      const para = typeof d.para === "string" && /^\d{15,22}$/.test(d.para) ? d.para : null;
      const mensaje = await m.celularUsar(p.papu, String(d.accion ?? "").slice(0, 24), para, fail);
      return { mensaje, estado: m.celularEstado(p.papu) };
    }
    throw new NoSePuede("No sé hacer eso.");
  }

  // ───────────────────────── Tienda ─────────────────────────

  private async tiendaApp(p: PedidoCelular): Promise<unknown> {
    const t = this.d.tienda;
    if (!t) throw new NoSePuede("La tienda está cerrada por ahora.");
    const d = (p.datos ?? {}) as { id?: unknown; modo?: unknown; arg?: unknown };
    const fail = (msg: string) => new NoSePuede(msg);
    if (p.accion === "estado") return t.celularEstado(p.papu);
    if (p.accion === "comprar") return { mensaje: await t.celularComprar(p.papu, String(d.id ?? "").slice(0, 64), fail), estado: await t.celularEstado(p.papu) };
    if (p.accion === "sobre") return { abierto: t.celularSobre(p.papu, String(d.modo ?? ""), String(d.arg ?? "").slice(0, 64), fail), estado: await t.celularEstado(p.papu) };
    throw new NoSePuede("No sé hacer eso.");
  }

  // ───────────────────────── Ruleta ─────────────────────────

  private async ruletaApp(p: PedidoCelular): Promise<unknown> {
    const r = this.d.ruleta;
    if (!r) throw new NoSePuede("La ruleta está apagada por ahora.");
    if (p.accion === "estado") return r.celularEstado(p.papu);
    if (p.accion === "girar") {
      const accion = String((p.datos as { accion?: unknown } | null)?.accion ?? "girar");
      if (!["girar", "quedar", "otra"].includes(accion)) throw new NoSePuede("No sé hacer eso.");
      return { ...((await r.girar(p.papu, accion, (msg) => new NoSePuede(msg))) as object), estado: r.celularEstado(p.papu) };
    }
    throw new NoSePuede("No sé hacer eso.");
  }

  // ───────────────────────── Comercio ─────────────────────────

  private async comercioApp(p: PedidoCelular): Promise<unknown> {
    const c = this.d.comercio;
    if (!c) throw new NoSePuede("Los intercambios están apagados por ahora.");
    const d = (p.datos ?? {}) as { de?: unknown; para?: unknown; da?: unknown; pide?: unknown; padre?: unknown; id?: unknown; accion?: unknown };
    const idPapu = (x: unknown) => (typeof x === "string" && /^\d{15,22}$/.test(x) ? x : null);
    const fail = (msg: string) => new NoSePuede(msg);
    if (p.accion === "estado") return c.celularEstado(p.papu);
    if (p.accion === "inventario") {
      const de = idPapu(d.de);
      if (!de) throw new NoSePuede("Elige a un Papu.");
      return c.celularInventario(de);
    }
    if (p.accion === "publicar") {
      const padre = Number.isInteger(d.padre) ? (d.padre as number) : null;
      const mensaje = await c.celularPublicar(p.papu, { para: idPapu(d.para), da: d.da, pide: d.pide, padre }, fail);
      return { mensaje, estado: await c.celularEstado(p.papu) };
    }
    if (p.accion === "responder") {
      const id = Number(d.id);
      if (!Number.isInteger(id)) throw new NoSePuede("No encontré esa oferta.");
      const mensaje = await c.celularResponder(p.papu, id, String(d.accion ?? ""), fail);
      return { mensaje, estado: await c.celularEstado(p.papu) };
    }
    throw new NoSePuede("No sé hacer eso.");
  }

  // ───────────────────────── Donar ─────────────────────────

  private async donarApp(p: PedidoCelular): Promise<unknown> {
    const d = this.d.donar;
    if (!d) throw new NoSePuede("Donar está apagado por ahora.");
    if (p.accion === "estado") return d.estado(p.papu);
    if (p.accion === "donar") {
      const x = (p.datos ?? {}) as { para?: unknown; cantidad?: unknown };
      const para = typeof x.para === "string" && /^\d{15,22}$/.test(x.para) ? x.para : null;
      const n = Math.floor(Number(x.cantidad));
      if (!para) throw new NoSePuede("Elige a quién le regalas.");
      if (para === p.papu) throw new NoSePuede("No puedes donarte a ti mismo.");
      if (!(n >= 1 && n <= 50)) throw new NoSePuede("Elige cuántos mensajes regalas.");
      return { mensaje: await d.donar(p.papu, para, n), estado: d.estado(p.papu) };
    }
    throw new NoSePuede("No sé hacer eso.");
  }

  // ───────────────────────── Mi tarjeta ─────────────────────────

  private get coins(): CoinService {
    if (!this.d.coins) throw new NoSePuede("La tienda está cerrada por ahora.");
    return this.d.coins;
  }

  private dibujar(userId: string, e: Eleccion): Promise<string> {
    const { equipo } = elegidos(this.coins, userId, e);
    return toCardEquip(equipo, this.d.founder(userId)).then((eq) => dibujarTarjeta(this.d.cardData, userId, eq, e.lado));
  }

  private async tarjeta(p: PedidoCelular): Promise<unknown> {
    const coins = this.coins;
    if (p.accion === "estado") {
      const datos = snapshot(coins, p.papu, p.nombre, this.d.store.get(p.papu).card.lado);
      return { ...datos, imagen: await this.dibujar(p.papu, datos.equipado) };
    }
    const e = leerEleccion((p.datos as { eleccion?: unknown } | null)?.eleccion);
    if (!e) throw new NoSePuede("No entendí qué elegiste. Prueba otra vez.");
    const nota = (descartados: string[]) => (descartados.length ? ` (${descartados.length} que ya no tienes no se pusieron)` : "");
    if (p.accion === "vista") {
      const { equipo, descartados } = elegidos(coins, p.papu, e);
      const animado = [...equipo.values()].some((o) => o.animado || o.rareza === "mitica");
      return { imagen: await this.dibujar(p.papu, e), mensaje: `Así se vería${animado ? " (en Discord se mueve)" : ""}.${nota(descartados)}` };
    }
    if (p.accion === "guardar") {
      const { descartados } = aplicar(coins, p.papu, e);
      this.d.store.setCard(p.papu, { lado: e.lado === "derecha" ? "derecha" : null });
      const datos = snapshot(coins, p.papu, p.nombre, this.d.store.get(p.papu).card.lado);
      return { ...datos, imagen: await this.dibujar(p.papu, datos.equipado), mensaje: `¡Guardado! Así sale en /nivel.${nota(descartados)}` };
    }
    throw new NoSePuede("No sé hacer eso.");
  }
}
