// Membresías de Ko-fi (PLAN §2; config/membresias.json): el regalo de cada 30 días (sobres temáticos elegibles y,
// en Triple Baka, uno mítico), las insignias de antigüedad, los objetos de vitrinas pasadas que se recuperan, las
// peleas y bodas lanzadas por día y el título propio. Nada pagado es azar: un sobre de membresía muestra los objetos
// del tema que el Papu elige, en un orden fijo (de mayor a menor rareza), y él escoge cuáles se lleva. Nunca traen
// fondos con renders (se entregarían por pago: licencias de SEGA y Eden Project). Los sobres de prestigio (se ganan
// jugando, §2) sí pueden traer renders y míticas. Sin Discord: src/discord/membresias.ts.
import { transaction, type Db } from "../db/database";
import { ORDEN, RAREZAS_REGALO, priceOf, temporadasActivas, type Objeto } from "../coins/rules";
import type { CoinService } from "../coins/service";
import { conDescuento } from "../coins/service";
import { enTema, temasDe, type Tema } from "../coins/temas";
import { antiguedadPara, lanzamientos, nivelDe, type MembresiaSettings, type NivelMembresia, type QueLanza } from "./rules";

const DAY_MS = 86_400_000;

export type ClaseSobre = "tematico" | "mitico" | "prestigio";

export interface SobreMembresia {
  id: number;
  userId: string;
  clase: ClaseSobre;
  ve: number;
  elige: number;
  /** De dónde salió: "🥖 Baguette", "prestigio ★2"… */
  origen: string;
  tema: string | null;
  opciones: string[] | null;
  creadoAt: number;
  abiertoAt: number | null;
}

export interface MembresiaServiceDeps {
  db: Db;
  settings: MembresiaSettings;
  coins: CoinService;
  now?: () => number;
  rnd?: () => number;
}

export type Fail = { ok: false; motivo: string };

/**
 * Lo que necesitan /pelea y /boda para que las membresías las lancen (PLAN §2): el nivel del Papu (según sus roles),
 * sus prestigios (la pelea semanal del premio de prestigio) y el registro de lanzamientos.
 */
export interface LanzarPort {
  membresias: MembresiaService;
  nivel(userId: string): Promise<NivelMembresia | null>;
  prestigio(userId: string): number;
}

/** De dónde sale un lanzamiento: su membresía (del día) o el premio de prestigio (1 pelea por semana). */
export type ViaLanzamiento = { via: "membresia"; elige: boolean; key: QueLanza; day: string } | { via: "prestigio"; elige: true; key: "pelea-prestigio"; day: string };

/**
 * ¿Puede lanzar hoy? Primero gasta los de su membresía; si no le quedan, las peleas usan la semanal del prestigio
 * (eligiendo a los luchadores). null = no puede. `day` es el día (hora de Chile) y `weekStart` el lunes de esa semana.
 */
export function viaLanzamiento(port: Pick<LanzarPort, "membresias">, n: NivelMembresia | null, prestigios: number, userId: string, que: QueLanza, day: string, weekStart: string): ViaLanzamiento | null {
  const l = lanzamientos(n, que);
  if (l.dia > port.membresias.lanzadosHoy(userId, que, day)) return { via: "membresia", elige: l.elige, key: que, day };
  if (que === "pelea" && prestigios > 0 && port.membresias.lanzadosHoy(userId, "pelea-prestigio", weekStart) < 1) return { via: "prestigio", elige: true, key: "pelea-prestigio", day: weekStart };
  return null;
}

export class MembresiaService {
  private readonly now: () => number;
  private readonly rnd: () => number;

  constructor(private readonly d: MembresiaServiceDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
  }

  get settings(): MembresiaSettings {
    return this.d.settings;
  }

  nivel(roleNames: readonly string[]): NivelMembresia | null {
    return nivelDe(this.d.settings, roleNames);
  }

  private estado(userId: string): { nivel: string | null; meses: number; regalo_at: number | null; titulo: string | null } {
    this.d.db.prepare("INSERT OR IGNORE INTO membresia_estado (user_id) VALUES (?)").run(userId);
    return this.d.db.prepare("SELECT nivel, meses, regalo_at, titulo FROM membresia_estado WHERE user_id = ?").get(userId) as never;
  }

  /** Meses con membresía (cuenta cada regalo). */
  meses(userId: string): number {
    return this.estado(userId).meses;
  }

  // ───────────────────────── regalo de cada 30 días ─────────────────────────

  /**
   * Regalo de membresía: al tener el rol y luego cada `periodoDias`. Deja los sobres temáticos (y míticos) por abrir,
   * suma un mes y entrega las insignias de antigüedad que correspondan. null si todavía no toca.
   */
  regalo(userId: string, n: NivelMembresia, t = this.now()): { sobres: number; miticos: number; meses: number; insignias: Objeto[] } | null {
    return transaction(this.d.db, () => {
      const e = this.estado(userId);
      if (e.regalo_at !== null && t - e.regalo_at < this.d.settings.periodoDias * DAY_MS) {
        if (e.nivel !== n.id) this.d.db.prepare("UPDATE membresia_estado SET nivel = ? WHERE user_id = ?").run(n.id, userId);
        return null;
      }
      // Primera vez: los meses que ya llevaba (desde su primera insignia de membresía).
      let meses = e.meses;
      if (e.regalo_at === null && meses === 0) {
        const desde = (this.d.db.prepare("SELECT MIN(at) AS at FROM inventario WHERE user_id = ? AND objeto_id LIKE 'insignia-membresia-%'").get(userId) as { at: number | null }).at;
        meses = desde !== null ? Math.floor((t - desde) / (this.d.settings.periodoDias * DAY_MS)) : 0;
      }
      meses++;
      this.d.db.prepare("UPDATE membresia_estado SET nivel = ?, meses = ?, regalo_at = ? WHERE user_id = ?").run(n.id, meses, t, userId);
      const add = this.d.db.prepare("INSERT INTO membresia_sobres (user_id, clase, ve, elige, origen, creado_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (let k = 0; k < n.sobres.cantidad; k++) add.run(userId, "tematico", n.sobres.ve, n.sobres.elige, n.rol, t);
      for (let k = 0; k < n.sobres.mitico; k++) add.run(userId, "mitico", 0, 1, n.rol, t);
      return { sobres: n.sobres.cantidad, miticos: n.sobres.mitico, meses, insignias: this.antiguedad(userId, meses) };
    });
  }

  /** Entrega las insignias de antigüedad que le faltan (son para siempre). */
  antiguedad(userId: string, meses = this.meses(userId)): Objeto[] {
    const out: Objeto[] = [];
    for (const id of antiguedadPara(this.d.settings, meses)) {
      if (this.d.coins.byId.has(id) && this.d.coins.grant(userId, id, "antigüedad")) out.push(this.d.coins.byId.get(id)!);
    }
    return out;
  }

  /** Fondo de membresía de la temporada (Baguette y más): se entrega una vez y es para siempre. null si no le toca o ya lo tenía. */
  fondoTemporada(userId: string, n: NivelMembresia): Objeto | null {
    const id = this.d.settings.fondoTemporada;
    if (!n.fondo || !id || !this.d.coins.byId.has(id)) return null;
    return this.d.coins.grant(userId, id, "membresía") ? this.d.coins.byId.get(id)! : null;
  }

  /** Un sobre de prestigio (se gana jugando: puede traer renders y míticas). */
  darSobrePrestigio(userId: string, ve: number, elige: number, origen: string): void {
    this.d.db.prepare("INSERT INTO membresia_sobres (user_id, clase, ve, elige, origen, creado_at) VALUES (?, 'prestigio', ?, ?, ?, ?)").run(userId, ve, elige, origen, this.now());
  }

  // ───────────────────────── sobres elegibles ─────────────────────────

  private toSobre(r: Record<string, unknown>): SobreMembresia {
    return {
      id: r.id as number,
      userId: r.user_id as string,
      clase: r.clase as ClaseSobre,
      ve: r.ve as number,
      elige: r.elige as number,
      origen: r.origen as string,
      tema: (r.tema as string | null) ?? null,
      opciones: r.opciones ? (JSON.parse(r.opciones as string) as string[]) : null,
      creadoAt: r.creado_at as number,
      abiertoAt: (r.abierto_at as number | null) ?? null,
    };
  }

  /** Sobres de membresía (y de prestigio) por abrir. */
  pendientes(userId: string): SobreMembresia[] {
    return (this.d.db.prepare("SELECT * FROM membresia_sobres WHERE user_id = ? AND abierto_at IS NULL ORDER BY id").all(userId) as Record<string, unknown>[]).map((r) => this.toSobre(r));
  }

  sobre(id: number): SobreMembresia | null {
    const r = this.d.db.prepare("SELECT * FROM membresia_sobres WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? this.toSobre(r) : null;
  }

  /** Objetos que puede traer un sobre de esa clase (sin los que ya tiene). */
  private elegibles(userId: string, clase: ClaseSobre): Objeto[] {
    const own = this.d.coins.owned(userId);
    return this.d.coins.catalog.filter((o) => {
      if (own.has(o.id) || RAREZAS_REGALO.includes(o.rareza)) return false;
      if (clase === "prestigio") return o.rareza === "mitica" || priceOf(this.d.coins.settings, o) !== null;
      // Pagado: nunca renders (licencias) ni azar.
      if (o.origen === "render") return false;
      return clase === "mitico" ? o.rareza === "mitica" : o.rareza !== "mitica" && priceOf(this.d.coins.settings, o) !== null;
    });
  }

  /**
   * Temas que puede elegir para ese sobre: personajes, temporadas y temas con al menos `elige` objetos que le falten
   * (así siempre puede llevarse todos), más «Todo». Los míticos no tienen tema.
   */
  temas(userId: string, s: SobreMembresia): Tema[] {
    const pool = this.elegibles(userId, s.clase);
    if (s.clase === "mitico") return [{ id: "todo", nombre: "Míticos", emoji: "🌈", faltan: pool.length }];
    return temasDe(pool, s.elige);
  }

  /**
   * Elige el tema: fija los objetos que verá (los de mayor rareza primero; en los de prestigio, al azar). Se guardan,
   * así volver a abrirlo muestra lo mismo.
   */
  elegirTema(userId: string, sobreId: number, tema: string): SobreMembresia | Fail {
    return transaction(this.d.db, () => {
      const s = this.sobre(sobreId);
      if (!s || s.userId !== userId) return { ok: false as const, motivo: "Ese sobre no es tuyo." };
      if (s.opciones) return s;
      if (!this.temas(userId, s).some((t) => t.id === tema)) return { ok: false as const, motivo: "Ese tema no está disponible." };
      let lista = this.elegibles(userId, s.clase).filter((o) => enTema(o, tema));
      if (s.clase === "prestigio") lista = shuffle(lista, this.rnd);
      else lista = [...lista].sort((a, b) => ORDEN[b.rareza] - ORDEN[a.rareza] || a.nombre.localeCompare(b.nombre, "es"));
      const ve = s.clase === "mitico" ? lista.length : s.ve;
      const opciones = lista.slice(0, ve).map((o) => o.id);
      if (!opciones.length) return { ok: false as const, motivo: "No te falta nada de ese tema. ¡Elige otro!" };
      this.d.db.prepare("UPDATE membresia_sobres SET tema = ?, opciones = ? WHERE id = ?").run(tema, JSON.stringify(opciones), sobreId);
      return this.sobre(sobreId)!;
    });
  }

  /** Vuelve a elegir tema (antes de llevarse nada). */
  cambiarTema(userId: string, sobreId: number): boolean {
    return this.d.db.prepare("UPDATE membresia_sobres SET tema = NULL, opciones = NULL WHERE id = ? AND user_id = ? AND abierto_at IS NULL").run(sobreId, userId).changes > 0;
  }

  /** Se lleva los objetos elegidos (exactamente los que permite, o todos si hay menos). */
  elegir(userId: string, sobreId: number, ids: string[]): { ok: true; objetos: Objeto[] } | Fail {
    return transaction(this.d.db, () => {
      const s = this.sobre(sobreId);
      if (!s || s.userId !== userId || !s.opciones) return { ok: false as const, motivo: "Primero elige el tema del sobre." };
      if (s.abiertoAt !== null) return { ok: false as const, motivo: "Ese sobre ya está abierto." };
      const own = this.d.coins.owned(userId);
      const validas = s.opciones.filter((id) => !own.has(id));
      const pide = Math.min(s.elige, validas.length);
      const unicos = [...new Set(ids)];
      if (unicos.length !== pide || unicos.some((id) => !validas.includes(id))) return { ok: false as const, motivo: `Elige ${pide} ${pide === 1 ? "objeto" : "objetos"} de la lista.` };
      for (const id of unicos) this.d.coins.grant(userId, id, s.clase === "prestigio" ? "sobre de prestigio" : "sobre de membresía");
      this.d.db.prepare("UPDATE membresia_sobres SET abierto_at = ? WHERE id = ?").run(this.now(), sobreId);
      return { ok: true as const, objetos: unicos.map((id) => this.d.coins.byId.get(id)!) };
    });
  }

  // ───────────────────────── recuperar de vitrinas pasadas ─────────────────────────

  /**
   * Objetos que se pueden recuperar: los que ya salieron en una vitrina terminada de esta temporada y los de temporadas
   * que ya no están en el pozo (que se vendían). Sin los que tiene ni los de la vitrina de hoy.
   */
  recuperables(userId: string, t = this.now()): Objeto[] {
    const c = this.d.coins;
    const day = c.day(t);
    const own = c.owned(userId);
    const hoy = new Set(c.vitrina(t)?.objetos ?? []);
    const pasados = new Set(c.schedule.filter((v) => v.hasta <= day).flatMap((v) => v.objetos));
    const activas = temporadasActivas(c.settings, day);
    return c.catalog
      .filter((o) => priceOf(c.settings, o) !== null && !own.has(o.id) && !hoy.has(o.id))
      .filter((o) => pasados.has(o.id) || (/^t\d+$/.test(o.temporada) && !activas.includes(o.temporada) && o.temporada < c.settings.temporada.id))
      .sort((a, b) => ORDEN[b.rareza] - ORDEN[a.rareza] || a.nombre.localeCompare(b.nombre, "es"));
  }

  /** Recuperados en los últimos `periodoDias` días. */
  recuperadosPeriodo(userId: string, t = this.now()): number {
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM recuperados WHERE user_id = ? AND at > ?").get(userId, t - this.d.settings.periodoDias * DAY_MS) as { n: number }).n;
  }

  /** Compra un objeto de una vitrina pasada (a precio de tienda con su descuento). */
  recuperar(userId: string, n: NivelMembresia | null, objetoId: string, t = this.now()): { ok: true; objeto: Objeto; precio: number } | Fail {
    if (!n || n.recuperar <= 0) return { ok: false, motivo: "Recuperar objetos de vitrinas pasadas es un beneficio de las membresías." };
    return transaction(this.d.db, () => {
      if (this.recuperadosPeriodo(userId, t) >= n.recuperar) return { ok: false as const, motivo: `Ya recuperaste ${n.recuperar} ${n.recuperar === 1 ? "objeto" : "objetos"} en estos ${this.d.settings.periodoDias} días.` };
      const o = this.recuperables(userId, t).find((x) => x.id === objetoId);
      if (!o) return { ok: false as const, motivo: "Ese objeto no se puede recuperar." };
      const precio = conDescuento(priceOf(this.d.coins.settings, o)!, n.descuento);
      if (!this.d.coins.spend(userId, precio, `recuperar ${o.id}`)) return { ok: false as const, motivo: "no_alcanza" };
      this.d.coins.grant(userId, o.id, "recuperado");
      this.d.db.prepare("INSERT INTO recuperados (user_id, objeto_id, precio, at) VALUES (?, ?, ?, ?)").run(userId, o.id, precio, t);
      return { ok: true as const, objeto: o, precio };
    });
  }

  // ───────────────────────── peleas y bodas lanzadas ─────────────────────────

  lanzadosHoy(userId: string, que: QueLanza | "pelea-prestigio", day: string): number {
    return (this.d.db.prepare("SELECT n FROM lanzamientos WHERE user_id = ? AND day = ? AND que = ?").get(userId, day, que) as { n: number } | undefined)?.n ?? 0;
  }

  /** Anota un lanzamiento (para el tope del día; la pelea semanal de prestigio usa el lunes de la semana como día). */
  anotarLanzamiento(userId: string, que: QueLanza | "pelea-prestigio", day: string): void {
    this.d.db.prepare("INSERT INTO lanzamientos (user_id, day, que, n) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, day, que) DO UPDATE SET n = n + 1").run(userId, day, que);
  }

  /** Devuelve un lanzamiento (la pelea o boda no se pudo lanzar). */
  devolverLanzamiento(userId: string, que: QueLanza | "pelea-prestigio", day: string): void {
    this.d.db.prepare("UPDATE lanzamientos SET n = MAX(0, n - 1) WHERE user_id = ? AND day = ? AND que = ?").run(userId, day, que);
  }

  // ───────────────────────── título propio ─────────────────────────

  titulo(userId: string): string | null {
    return this.estado(userId).titulo;
  }

  setTitulo(userId: string, titulo: string | null): void {
    this.estado(userId);
    this.d.db.prepare("UPDATE membresia_estado SET titulo = ? WHERE user_id = ?").run(titulo, userId);
  }
}

function shuffle<T>(list: T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
