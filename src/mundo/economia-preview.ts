// Economia aislada de la Plaza preview. Replica el ciclo de compra/recompensa sobre un ledger D1 propio:
// lee el estado inicial desde papus.sqlite en SOLO LECTURA y persiste los cambios exclusivamente en papus-plaza-preview.
// Ningun saldo, inventario, XP, tirada ni consumible de produccion se modifica.
import type { Db } from "../db/database";
import type { D1Query } from "../cloud/d1";
import type { Atender } from "./puente";
import type { LevelService } from "../levels/service";
import type { CoinService } from "../coins/service";
import { paySplit, priceOf } from "../coins/rules";
import type { MercadoService } from "../mercado/service";
import { CONSUMIBLES, PERMANENTES } from "../mercado/rules";
import { abierta, aperturaHoy, proximaApertura } from "../mercado/rules";
import type { Quota } from "../quota/quota";
import type { RouletteService } from "../ruleta/service";
import { pickPrize, prizeXp } from "../ruleta/rules";
import { progress } from "../levels/rules";
import { recompensaPesca, textoRecompensaPesca, type TamanoPez } from "../pesca/reglas";
import { ruletaEstado } from "./ruleta";
import type { Accion, Resultado } from "../../worker/src/mundo/acciones";

interface WalletSandbox {
  ganadas: number; compradas: number; ecos: number;
  gratis: number; gratisRaro: number; gratisLeg: number;
  sobres: number; sinEpica: number; sinLegendaria: number; hoy: number;
}
interface EstadoSandbox {
  version: 1;
  xp: number;
  wallet: WalletSandbox;
  inventario: string[];
  consumibles: Record<string, number>;
  comprasMercado: string[];
  ruletaDia: string;
  ruletaUsadas: number;
  pescaAt: number;
  cuotaExtraDia: string;
  cuotaExtra: number;
  cuotaUsada: number;
}
interface FilaSandbox { papu_id: string; estado: string; revision: number }
const ceroWallet = (): WalletSandbox => ({ ganadas: 0, compradas: 0, ecos: 0, gratis: 0, gratisRaro: 0, gratisLeg: 0, sobres: 0, sinEpica: 0, sinLegendaria: 0, hoy: 0 });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const error = (motivo: string): Resultado => ({ ok: false, motivo });
const ok = (datos: unknown): Resultado => ({ ok: true, datos });
const moneda = (n: number) => n.toLocaleString("es-CL");

export interface EconomiaPlazaPreviewDeps {
  query: D1Query;
  db: Db;
  levels: LevelService;
  coins: CoinService | null;
  mercado: MercadoService | null;
  roulette: RouletteService;
  quota: Quota;
  now?: () => number;
  rnd?: () => number;
}

/**
 * Todas las operaciones son de prueba, pero persistentes y transaccionales dentro del D1 aislado.
 * El ledger se actualiza con compare-and-swap para que dos pestañas no puedan duplicar compras ni XP.
 */
export class EconomiaPlazaPreview {
  private readonly now: () => number;
  private readonly rnd: () => number;
  private readonly cache = new Map<string, EstadoSandbox>();

  constructor(private readonly d: EconomiaPlazaPreviewDeps) {
    this.now = d.now ?? Date.now;
    this.rnd = d.rnd ?? Math.random;
  }

  /** Precarga el ledger al iniciar para que las tarjetas de perfil muestren el progreso sandbox. */
  async preload(): Promise<void> {
    const rows = await this.d.query<{ papu_id: string; estado: string }>("SELECT papu_id, estado FROM mundo_sandbox");
    for (const row of rows) {
      try {
        const state = JSON.parse(row.estado) as EstadoSandbox;
        if (state.version === 1) this.cache.set(row.papu_id, state);
      } catch { /* un registro dañado no bloquea el resto de la Plaza */ }
    }
  }

  xp(userId: string): number | null { return this.cache.get(userId)?.xp ?? null; }

  ruletasUsadas(userId: string): number {
    const state = this.cache.get(userId);
    if (!state || state.ruletaDia !== this.d.roulette.dayOf(this.now())) return 0;
    return state.ruletaUsadas;
  }

  private inicial(userId: string): EstadoSandbox {
    const raw = this.d.db.prepare(
      "SELECT ganadas, compradas, ecos, gratis, gratis_raro, gratis_leg, sobres, sin_epica, sin_leg FROM monedero WHERE user_id = ?",
    ).get(userId) as Partial<{
      ganadas: number; compradas: number; ecos: number; gratis: number; gratis_raro: number;
      gratis_leg: number; sobres: number; sin_epica: number; sin_leg: number;
    }> | undefined;
    const hoy = this.d.coins?.day(this.now()) ?? "";
    const actividad = hoy
      ? this.d.db.prepare("SELECT ganadas FROM monedas_dia WHERE user_id = ? AND day = ?").get(userId, hoy) as { ganadas: number } | undefined
      : undefined;
    const wallet = ceroWallet();
    wallet.ganadas = raw?.ganadas ?? 0;
    wallet.compradas = raw?.compradas ?? 0;
    wallet.ecos = raw?.ecos ?? 0;
    wallet.gratis = raw?.gratis ?? 0;
    wallet.gratisRaro = raw?.gratis_raro ?? 0;
    wallet.gratisLeg = raw?.gratis_leg ?? 0;
    wallet.sobres = raw?.sobres ?? 0;
    wallet.sinEpica = raw?.sin_epica ?? 0;
    wallet.sinLegendaria = raw?.sin_leg ?? 0;
    wallet.hoy = actividad?.ganadas ?? 0;
    const consumibles = Object.fromEntries(
      (this.d.db.prepare("SELECT objeto, usos FROM consumibles WHERE user_id = ?").all(userId) as { objeto: string; usos: number }[])
        .map((r) => [r.objeto, r.usos]),
    );
    const comprasMercado = (this.d.db.prepare(
      "SELECT DISTINCT objeto FROM mercado_registro WHERE user_id = ? AND accion = 'compra'",
    ).all(userId) as { objeto: string }[]).map((r) => r.objeto);
    return {
      version: 1,
      xp: this.d.levels.store.get(userId).xp,
      wallet,
      inventario: this.d.coins ? [...this.d.coins.owned(userId)] : [],
      consumibles,
      comprasMercado,
      ruletaDia: this.d.roulette.dayOf(this.now()),
      ruletaUsadas: 0,
      pescaAt: 0,
      cuotaExtraDia: this.d.roulette.dayOf(this.now()),
      cuotaExtra: 0,
      cuotaUsada: 0,
    };
  }

  private async cargar(userId: string): Promise<{ state: EstadoSandbox; revision: number }> {
    for (let intento = 0; intento < 3; intento++) {
      const row = (await this.d.query<FilaSandbox>(
        "SELECT papu_id, estado, revision FROM mundo_sandbox WHERE papu_id = ?",
        userId,
      ))[0];
      if (row) {
        const state = JSON.parse(row.estado) as EstadoSandbox;
        if (state.version !== 1) throw new Error("La versión del progreso de prueba no es compatible.");
        this.cache.set(userId, state);
        return { state, revision: row.revision };
      }
      const state = this.inicial(userId);
      await this.d.query(
        "INSERT OR IGNORE INTO mundo_sandbox (papu_id, estado, revision, actualizado_at) VALUES (?, ?, 0, ?)",
        userId, JSON.stringify(state), this.now(),
      );
    }
    throw new Error("No pude inicializar tu progreso aislado. Inténtalo de nuevo.");
  }

  private async cambiar<T>(
    userId: string,
    operar: (state: EstadoSandbox) => { result: T; changed?: boolean },
  ): Promise<T> {
    for (let intento = 0; intento < 8; intento++) {
      const { state: original, revision } = await this.cargar(userId);
      const state = clone(original);
      const { result, changed = true } = operar(state);
      if (!changed) return result;
      const updated = await this.d.query<{ revision: number }>(
        "UPDATE mundo_sandbox SET estado = ?, revision = revision + 1, actualizado_at = ? WHERE papu_id = ? AND revision = ? RETURNING revision",
        JSON.stringify(state), this.now(), userId, revision,
      );
      if (updated.length) {
        this.cache.set(userId, state);
        return result;
      }
    }
    throw new Error("La Plaza está procesando otra acción tuya. Vuelve a intentarlo.");
  }

  private datosTienda(state: EstadoSandbox): Resultado {
    if (!this.d.coins) return error("La tienda no está habilitada.");
    const vitrina = this.d.coins.vitrina(this.now());
    const objetos = (vitrina?.objetos ?? []).flatMap((id) => {
      const o = this.d.coins!.byId.get(id);
      if (!o) return [];
      return [{
        id: o.id, nombre: o.nombre, descripcion: o.descripcion, rareza: o.rareza,
        precio: priceOf(this.d.coins!.settings, o), owned: state.inventario.includes(o.id),
      }];
    });
    return ok({ abierta: !!vitrina, sandbox: true, wallet: state.wallet, objetos });
  }

  private datosMercado(state: EstadoSandbox): Resultado {
    if (!this.d.mercado) return error("El mercado negro no está habilitado.");
    const now = this.now();
    const settings = this.d.mercado.settings;
    const hoy = aperturaHoy(settings, now);
    const proxima = proximaApertura(settings, now);
    const abierto = settings.activo && abierta(hoy, now);
    const disponibles = this.d.mercado.vitrina(now);
    const objetos = disponibles.map((o) => {
      const permanente = PERMANENTES.includes(o.efecto);
      const owned = o.efecto === "objeto"
        ? state.inventario.includes(o.objeto!)
        : permanente && state.comprasMercado.includes(o.id);
      return {
        id: o.id, nombre: o.nombre, emoji: o.emoji, descripcion: o.descripcion,
        rareza: permanente ? "contrabando" : "raro", precio: o.precio,
        usos: state.consumibles[o.id] ?? 0, owned,
      };
    });
    return ok({
      abierto, sandbox: true, wallet: state.wallet, objetos,
      apertura: { abre: hoy.abre, cierra: hoy.cierra },
      proximaApertura: { abre: proxima.abre, cierra: proxima.cierra },
    });
  }

  private async comprarTienda(userId: string, datos: unknown): Promise<Resultado> {
    if (!this.d.coins) return error("La tienda no está habilitada.");
    const id = datos && typeof datos === "object" ? (datos as { id?: unknown }).id : null;
    if (typeof id !== "string" || id.length > 100) return error("Artículo inválido.");
    return this.cambiar(userId, (s) => {
      const o = this.d.coins!.byId.get(id);
      const precio = o ? priceOf(this.d.coins!.settings, o) : null;
      if (!o || precio === null) return { result: error("Ese objeto no se vende."), changed: false };
      const vitrina = this.d.coins!.vitrina(this.now());
      if (!vitrina?.objetos.includes(id)) return { result: error("Ese objeto ya no está en la vitrina."), changed: false };
      if (s.inventario.includes(id)) return { result: error("Ya tienes ese objeto en tu colección."), changed: false };
      const pago = paySplit(precio, s.wallet, o.origen === "render");
      if (!pago) return { result: error(o.origen === "render" ? "No tienes suficientes Shaula-coins ganadas para este render." : "No tienes suficientes Shaula-coins."), changed: false };
      s.wallet.compradas -= pago.compradas;
      s.wallet.ganadas -= pago.ganadas;
      s.inventario.push(id);
      return {
        result: ok({ mensaje: `¡Compraste ${o.nombre}! Se guardó en tu colección de prueba.`, wallet: s.wallet, pago, sandbox: true }),
      };
    });
  }

  private async comprarMercado(userId: string, datos: unknown): Promise<Resultado> {
    if (!this.d.mercado || !this.d.coins) return error("El mercado negro no está habilitado.");
    const id = datos && typeof datos === "object" ? (datos as { id?: unknown }).id : null;
    if (typeof id !== "string" || id.length > 100) return error("Artículo inválido.");
    return this.cambiar(userId, (s) => {
      const now = this.now();
      const settings = this.d.mercado!.settings;
      const apertura = aperturaHoy(settings, now);
      if (!settings.activo || !abierta(apertura, now)) {
        return { result: error(`Neru tiene cerrado el mercado. Próxima apertura: ${new Date(proximaApertura(settings, now).abre).toLocaleString("es-CL", { timeZone: settings.zona })}.`), changed: false };
      }
      const o = this.d.mercado!.byId.get(id);
      if (!o) return { result: error("Ese artículo no existe."), changed: false };
      if (!this.d.mercado!.vitrina(now).some((x) => x.id === id)) return { result: error("Ese artículo no está en la selección de hoy."), changed: false };
      if (o.efecto === "objeto" && s.inventario.includes(o.objeto!)) return { result: error("Ya tienes ese objeto."), changed: false };
      if ((o.efecto === "rol" || o.efecto === "disquete" || o.efecto === "machete") && s.comprasMercado.includes(id)) {
        return { result: error("Ya tienes ese artículo permanente."), changed: false };
      }
      if (s.wallet.ganadas < o.precio) return { result: error("El mercado negro solo acepta Shaula-coins ganadas y no tienes suficientes."), changed: false };
      s.wallet.ganadas -= o.precio;
      if (CONSUMIBLES.includes(o.efecto)) s.consumibles[id] = (s.consumibles[id] ?? 0) + (o.usos ?? 0);
      if (o.efecto === "objeto" && o.objeto && !s.inventario.includes(o.objeto)) s.inventario.push(o.objeto);
      if (o.efecto === "rol" || o.efecto === "disquete" || o.efecto === "machete") s.comprasMercado.push(id);
      return {
        result: ok({
          mensaje: `¡Compraste ${o.nombre}! ${o.usos ? `Se añadieron ${o.usos} usos.` : "El artículo quedó registrado en tu colección de prueba."}`,
          wallet: s.wallet, usos: s.consumibles[id] ?? 0, sandbox: true,
        }),
      };
    });
  }

  private async pescar(userId: string): Promise<Resultado> {
    const now = this.now();
    if (!this.d.levels.canEarn(userId, now)) return error("Neru te bloqueó temporalmente la XP; hoy no puedes obtener recompensas. 🚫");
    return this.cambiar(userId, (s) => {
      if (now - s.pescaAt < 30_000) {
        return { result: error(`La caña necesita descansar ${Math.ceil((30_000 - (now - s.pescaAt)) / 1000)} s. 🎣`), changed: false };
      }
      const xpAntes = s.xp;
      const nivelAntes = progress(this.d.levels.settings, xpAntes).level;
      const n = Math.max(0, Math.min(0.999999, this.rnd()));
      const tamano: TamanoPez = n < 0.55 ? "pequeno" : n < 0.87 ? "mediano" : "grande";
      const recompensa = recompensaPesca(this.d.levels.settings, xpAntes, tamano);
      if (!recompensa) return { result: error("No pude calcular la captura."), changed: false };
      s.xp += recompensa.xp;
      s.pescaAt = now;
      const xpDespues = s.xp;
      return {
        result: ok({
          tamano, xp: recompensa.xp, porcentaje: Math.round(recompensa.porcentaje * 100),
          texto: textoRecompensaPesca(recompensa),
          nivelAntes, nivelDespues: progress(this.d.levels.settings, xpDespues).level,
          soloLectura: false, sandbox: true, xpTotalSandbox: xpDespues,
        }),
      };
    });
  }

  private async estadoRuleta(userId: string): Promise<Resultado> {
    const loaded = await this.cargar(userId);
    const state = loaded.state;
    const now = this.now();
    const day = this.d.roulette.dayOf(now);
    const used = state.ruletaDia === day ? state.ruletaUsadas : 0;
    const real = this.d.roulette.status(userId, now);
    const estado = ruletaEstado(this.d.roulette, userId, real);
    return ok({
      ...estado,
      tiradas: Math.max(0, real.left - used),
      usadas: real.used + used,
      sandbox: true,
      soloLectura: false,
      simulacion: false,
      extras: [...estado.extras, "🧪 Las tiradas y premios se guardan en el progreso aislado de la Plaza; no afectan Discord."],
    });
  }

  private async girarRuleta(userId: string, nombre: string): Promise<Resultado> {
    const now = this.now();
    if (!this.d.levels.canEarn(userId, now)) return error("Neru te bloqueó la ruleta: no puedes obtener recompensas. 🚫");
    const day = this.d.roulette.dayOf(now);
    const real = this.d.roulette.status(userId, now);
    if (real.blocked) return error("🚫 Neru te dio un machetazo: sin ruleta por ahora.");
    return this.cambiar(userId, (s) => {
      if (s.ruletaDia !== day) { s.ruletaDia = day; s.ruletaUsadas = 0; }
      if (s.ruletaUsadas >= real.left) return { result: error("No te quedan tiradas disponibles. Cumple una misión y vuelve a intentarlo."), changed: false };
      const premios = this.d.roulette.settings.premios.map((p) => p.tipo === "sobre" && !this.d.coins ? { ...p, peso: 0 } : p);
      const index = pickPrize({ premios }, this.rnd);
      const premio = this.d.roulette.settings.premios[index];
      if (!premio) return { result: error("La ruleta no tiene premios configurados."), changed: false };
      const levelBefore = progress(this.d.levels.settings, s.xp).level;
      let xp = 0, mensajes = 0, sobres = 0, overflow = 0;
      if (premio.tipo === "xp") {
        xp = prizeXp(this.d.roulette.settings, this.d.levels.settings, premio, s.xp, this.d.levels.multiplier(new Date(now)));
        s.xp += xp;
      } else if (premio.tipo === "cuota" || premio.tipo === "cuota_llena") {
        const limit = this.d.quota.limitFor(userId, new Date(now));
        const extraBase = this.d.quota.extra(userId, new Date(now));
        const usedBase = this.d.quota.used(userId, new Date(now));
        const donated = this.d.quota.donated(userId, new Date(now));
        const extraSandbox = s.cuotaExtraDia === day ? s.cuotaExtra : 0;
        const roomActual = Number.isFinite(limit)
          ? Math.max(0, limit - Math.max(0, limit + extraBase + extraSandbox - usedBase - s.cuotaUsada))
          : 0;
        if (premio.tipo === "cuota_llena") {
          // En preview no se ejecutan mensajes a Vocaloids; se aplica la recompensa de respaldo de un mensaje.
          mensajes = Math.min(1, roomActual);
          overflow = 1 - mensajes;
        } else {
          const unidades = premio.valor ?? 0;
          mensajes = Math.min(unidades, roomActual);
          overflow = unidades - mensajes;
        }
        s.cuotaExtra = extraSandbox + mensajes;
        s.cuotaExtraDia = day;
        if (overflow > 0) {
          const c = this.d.levels.settings.cuotaSobrante ?? { porcentajeNivel: 0.05, minimo: 15 };
          const needed = progress(this.d.levels.settings, s.xp).needed;
          xp = Math.round(Math.max(c.minimo, c.porcentajeNivel * needed) * overflow);
          s.xp += xp;
        }
      } else if (premio.tipo === "sobre") {
        sobres = premio.valor ?? 1;
        s.wallet.gratis += sobres;
      }
      s.ruletaUsadas++;
      const levelAfter = progress(this.d.levels.settings, s.xp).level;
      const titulo = premio.tipo === "xp" ? `¡+${xp} XP!`
        : premio.tipo === "cuota" ? `¡+${mensajes} mensajes!`
        : premio.tipo === "cuota_llena" ? (mensajes ? `¡Recuperaste ${mensajes} mensajes!` : "¡Mensaje extra!")
        : `¡${sobres} sobre(s) gratis!`;
      const subtitulo = levelAfter > levelBefore ? `Nivel ${levelAfter} · ¡a seguir!`
        : premio.tipo === "xp" ? `Nivel ${levelAfter} · progreso de prueba`
        : "Recompensa aplicada al entorno de prueba";
      const texto = premio.tipo === "xp" ? `+${xp} XP en tu progreso de prueba.`
        : premio.tipo === "cuota" || premio.tipo === "cuota_llena" ? `+${mensajes} mensajes de cuota de prueba.`
        : `${sobres} sobre(s) añadidos al monedero de prueba.`;
      return {
        result: ok({
          giro: { papu: userId, nombre, index, titulo: `🧪 ${premio.etiqueta}`, subtitulo, origen: "plaza" },
          texto, tiradas: Math.max(0, real.left - s.ruletaUsadas), sandbox: true,
        }),
      };
    });
  }

  acciones(): Partial<Record<Accion, Atender>> {
    return {
      "ruleta.estado": (papu) => this.estadoRuleta(papu.id),
      "ruleta.girar": (papu) => this.girarRuleta(papu.id, papu.nombre),
      "pesca.capturar": (papu) => this.pescar(papu.id),
      "tienda.estado": async (papu) => {
        const { state } = await this.cargar(papu.id);
        return this.datosTienda(state);
      },
      "tienda.comprar": (papu, datos) => this.comprarTienda(papu.id, datos),
      "mercado.estado": async (papu) => {
        const { state } = await this.cargar(papu.id);
        return this.datosMercado(state);
      },
      "mercado.comprar": (papu, datos) => this.comprarMercado(papu.id, datos),
    };
  }
}
