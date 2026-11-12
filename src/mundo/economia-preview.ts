// Economia aislada de la Plaza preview. Replica el ciclo de compra/recompensa sobre un ledger D1 propio:
// lee el estado inicial desde papus.sqlite en SOLO LECTURA y persiste los cambios exclusivamente en papus-plaza-preview.
// Ningun saldo, inventario, XP, tirada ni consumible de produccion se modifica.
import type { Db } from "../db/database";
import type { D1Query } from "../cloud/d1";
import type { Atender } from "./puente";
import type { LevelService } from "../levels/service";
import type { CoinService } from "../coins/service";
import { activityCoins, levelBonus, paySplit, priceOf } from "../coins/rules";
import type { MercadoService } from "../mercado/service";
import { CONSUMIBLES, PERMANENTES } from "../mercado/rules";
import { abierta, aperturaHoy, proximaApertura } from "../mercado/rules";
import type { Quota } from "../quota/quota";
import type { RouletteService } from "../ruleta/service";
import { pickPrize, prizeXp } from "../ruleta/rules";
import { progress, quotaWithTransition, rankFor } from "../levels/rules";
import { answerXp, dailyCap, type Dificultad, type TriviaSettings } from "../trivia/rules";
import { dayKey } from "../time";
import { reinicioDe } from "../mercado/reinicios";
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
  subioDia?: string;
  microfonoDia?: string;
  microfonoMinutos?: number;
  disqueteProcesadoDia?: string;
  ruletaGuardadas?: number;
  ruletaResetDia?: string;
  ruletaResetUsadas?: number;
  cuotaResetDia?: string;
  cuotaResetBase?: number;
  ruletaRegaloDia?: string;
  ruletaRegalos?: number;
  regalosSecuencia?: number;
  regalosPendientes?: Record<string, { para: string; day: string }>;
  regalosRecibidos?: string[];
  atunPendiente?: { day: string; index: number; giros: number; gastoUso: boolean; aplicado?: boolean; xp?: number; mensajes?: number; sobres?: number; subioAntes?: string; nivelAntes?: number; bonoNivel?: number };
  monedasDia?: string;
  xpSandboxDia?: number;
  monedasActividadDia?: number;
  monedasXpBase?: number;
  monedasResetBaseDia?: string;
  monedasResetBaseXp?: number;
  monedasResetBasePrevia?: number;
  monedasResetDia?: string;
  monedasResetXp?: number;
  monedasResetPrevia?: number;
  triviaDia?: string; triviaXpDia?: number; triviaPartidasDia?: string[]; triviaSuperadas?: string[]; triviaPremios?: string[]; triviaHitos?: Partial<Record<Dificultad, { aciertos: number; premios: number }>>; triviaAciertosAplicados?: number[]; triviaAciertosResultados?: Record<string, number>; triviaRuns?: Record<string, { day: string; withXp: boolean }>;
}
interface FilaSandbox { papu_id: string; estado: string; revision: number }
const ceroWallet = (): WalletSandbox => ({ ganadas: 0, compradas: 0, ecos: 0, gratis: 0, gratisRaro: 0, gratisLeg: 0, sobres: 0, sinEpica: 0, sinLegendaria: 0, hoy: 0 });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const error = (motivo: string): Resultado => ({ ok: false, motivo });
const ok = (datos: unknown): Resultado => ({ ok: true, datos });

// Efectos con traducción funcional y aislada en la Plaza. Los demás dependen de sobres, bodas, arena o Discord.
const EFECTOS_MERCADO_PREVIEW = new Set(["atun", "baguette", "celular", "microfono", "regalo", "zanahoria", "guitarra", "pc", "disquete"]);

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
  trivia: TriviaSettings;
  questionLevels: Record<string, Dificultad>;
  questionTotals: Record<Dificultad, number>;
  timeZone: string;
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
        if (state.version === 1) { state.subioDia ??= ""; this.cache.set(row.papu_id, state); }
      } catch { /* un registro dañado no bloquea el resto de la Plaza */ }
    }
  }

  xp(userId: string): number | null { return this.cache.get(userId)?.xp ?? null; }

  /** Acredita o revierte en el ledger la parte de monedas ganadas por XP de actividad sandbox. */
  private recalcularMonedasActividad(state: EstadoSandbox, userId: string, day: string, deltaXp = 0): number {
    if (!this.d.coins) return 0;
    const now = this.now();
    const real = this.d.coins.activityToday(userId, now);
    if (state.monedasDia !== day) {
      state.monedasDia = day;
      state.xpSandboxDia = 0;
      state.monedasActividadDia = real.actividad;
      state.monedasXpBase = real.xp;
      const reinicioBase = reinicioDe(this.d.db, userId, day);
      state.monedasResetBaseDia = reinicioBase.veces ? day : undefined;
      state.monedasResetBaseXp = reinicioBase.monedasXp;
      state.monedasResetBasePrevia = reinicioBase.monedasPrevia;
      state.monedasResetDia = undefined;
      state.monedasResetXp = undefined;
      state.monedasResetPrevia = undefined;
      const earned = this.d.db.prepare("SELECT ganadas FROM monedas_dia WHERE user_id = ? AND day = ?").get(userId, day) as { ganadas: number } | undefined;
      state.wallet.hoy = earned?.ganadas ?? 0;
    }
    state.xpSandboxDia = Math.max(0, (state.xpSandboxDia ?? 0) + deltaXp);
    const reset = state.monedasResetDia === day
      ? { xp: state.monedasResetXp ?? state.monedasXpBase ?? real.xp, previa: state.monedasResetPrevia ?? state.monedasActividadDia ?? real.actividad }
      : state.monedasResetBaseDia === day ? { xp: state.monedasResetBaseXp ?? 0, previa: state.monedasResetBasePrevia ?? 0 } : undefined;
    const objetivo = activityCoins(this.d.coins.settings, {
      xp: (state.monedasXpBase ?? real.xp) + state.xpSandboxDia,
      ...(reset ? { reinicio: reset } : {}),
    });
    const anterior = state.monedasActividadDia ?? real.actividad;
    const delta = objetivo - anterior;
    if (delta) {
      state.wallet.ganadas = Math.max(0, state.wallet.ganadas + delta);
      state.wallet.hoy = Math.max(0, state.wallet.hoy + delta);
    }
    state.monedasActividadDia = objetivo;
    return delta;
  }

  /** Mismo bono por subir de nivel/rango que CoinService.onLevelChange, aplicado al monedero sandbox. */
  private registrarXpSandbox(state: EstadoSandbox, userId: string, day: string, xp: number, nivelAntes: number, nivelDespues: number): number {
    this.recalcularMonedasActividad(state, userId, day, xp);
    if (!this.d.coins || nivelDespues <= nivelAntes) return 0;
    const rangoAntes = rankFor(this.d.levels.settings, nivelAntes);
    const rangoDespues = rankFor(this.d.levels.settings, nivelDespues);
    const bonus = levelBonus(this.d.coins.settings, nivelAntes, nivelDespues, rangoDespues.index > rangoAntes.index);
    state.wallet.ganadas += bonus;
    return bonus;
  }
  /** Sincroniza aciertos al ledger preview. El resultado por ID se conserva indefinidamente para recuperar
   * el caso en que el CAS del ledger se confirme pero falle la escritura de aplicado en la tabla de actividad. */
  async syncTrivia(): Promise<number> {
    const rows = await this.d.query<{ id: number; partida: string; papu_id: string; pregunta: string; racha: number; multiplicador?: number; xp?: number | null }>(
      "SELECT id, partida, papu_id, pregunta, racha, multiplicador, xp FROM actividad_aciertos_preview WHERE aplicado = 0 ORDER BY id LIMIT 200",
    );
    let applied = 0;
    for (const row of rows) {
      const gained = await this.cambiar(row.papu_id, (s) => {
        s.triviaAciertosAplicados ??= [];
        s.triviaAciertosResultados ??= {};
        const key = String(row.id);
        if (Object.prototype.hasOwnProperty.call(s.triviaAciertosResultados, key)) {
          return { result: s.triviaAciertosResultados[key]!, changed: false };
        }
        // Compatibilidad con ledgers creados por la versión anterior, que guardaba solo los IDs.
        if (s.triviaAciertosAplicados.includes(row.id)) {
          return { result: Math.max(0, Number(row.xp ?? 0)), changed: false };
        }

        const now = this.now();
        const day = dayKey(new Date(now), this.d.timeZone);
        if (s.triviaDia !== day) {
          s.triviaDia = day;
          s.triviaXpDia = 0;
          s.triviaPartidasDia = [];
        }
        s.triviaPartidasDia ??= [];
        s.triviaSuperadas ??= [];
        s.triviaPremios ??= [];
        s.triviaHitos ??= {};
        s.triviaRuns ??= {};

        // Una partida multijugador cuenta una sola vez, aunque tenga muchos aciertos o cruce medianoche.
        const runKey = `${row.partida}:${row.papu_id}`;
        let run = s.triviaRuns[runKey];
        if (!run) {
          const withXp = s.triviaPartidasDia.length < this.d.trivia.limites.partidasConXp;
          if (!s.triviaPartidasDia.includes(runKey)) s.triviaPartidasDia.push(runKey);
          run = { day, withXp };
          s.triviaRuns[runKey] = run;
        }

        let earned = 0;
        const eligible = this.d.levels.canEarn(row.papu_id, now);
        if (run.withXp && eligible) {
          const from = dayKey(new Date(now - this.d.trivia.xp.dias * 86_400_000), this.d.timeZone);
          const avg = (this.d.db.prepare(
            "SELECT AVG(xp - trivia) AS avg FROM xp_dia WHERE user_id = ? AND day >= ? AND day < ? AND xp - trivia > 0",
          ).get(row.papu_id, from, day) as { avg: number | null } | undefined)?.avg ?? 0;
          const multiplier = this.d.levels.multiplier(new Date(now));
          const factor = Math.max(1, Math.min(2, Math.floor(row.multiplicador ?? 1)));
          const full = answerXp(this.d.trivia, this.d.levels.settings, {
            xp: s.xp,
            dailyAvg: avg,
            streak: Math.max(1, row.racha),
            multiplier,
          }) * factor;
          const cap = dailyCap(this.d.trivia, this.d.levels.settings, s.xp, multiplier);
          earned = Math.max(0, Math.min(full, cap - (s.triviaXpDia ?? 0)));
          const before = progress(this.d.levels.settings, s.xp).level;
          s.xp += earned;
          s.triviaXpDia = (s.triviaXpDia ?? 0) + earned;
          const after = progress(this.d.levels.settings, s.xp).level;
          if (after > before) s.subioDia = day;
          this.registrarXpSandbox(s, row.papu_id, day, earned, before, after);
        }

        const level = this.d.questionLevels[row.pregunta];
        if (level) {
          // Preguntas superadas son únicas; los aciertos repetidos sí cuentan para hitos, igual que TriviaService.pass/hit.
          if (!s.triviaSuperadas.includes(row.pregunta)) s.triviaSuperadas.push(row.pregunta);
          const count = (d: Dificultad) => s.triviaSuperadas!.filter((id) => this.d.questionLevels[id] === d).length;
          if (count(level) >= this.d.questionTotals[level] && !s.triviaPremios.includes(level)) {
            s.triviaPremios.push(level);
            const prize = this.d.trivia.dificultades[level].premio;
            if (prize === "comun") s.wallet.gratis++;
            else if (prize === "raro") s.wallet.gratisRaro++;
            else s.wallet.gratisLeg++;
          }
          const all = (["facil", "medio", "dificil"] as Dificultad[]).every(
            (d) => this.d.questionTotals[d] > 0 && count(d) >= this.d.questionTotals[d],
          );
          if (all && !s.triviaPremios.includes("todas")) {
            s.triviaPremios.push("todas");
            const prize = this.d.trivia.secreto.sobres;
            if (prize.tipo === "comun") s.wallet.gratis += prize.cantidad;
            else if (prize.tipo === "raro") s.wallet.gratisRaro += prize.cantidad;
            else s.wallet.gratisLeg += prize.cantidad;
          }

          // TriviaService.hit solo suma hitos si el Papu puede ganar XP y, cuando se configura,
          // si la partida pertenece a las partidas elegibles para XP.
          if (eligible && (!this.d.trivia.hitos?.soloPartidasConXp || run.withXp)) {
            const h = s.triviaHitos[level] ?? { aciertos: 0, premios: 0 };
            h.aciertos++;
            const milestone = this.d.trivia.dificultades[level].hito;
            const due = milestone ? Math.floor(h.aciertos / milestone.cada) : 0;
            if (milestone && due > h.premios) {
              const n = due - h.premios;
              h.premios = due;
              if (milestone.premio === "comun") s.wallet.gratis += n;
              else if (milestone.premio === "raro") s.wallet.gratisRaro += n;
              else s.wallet.gratisLeg += n;
            }
            s.triviaHitos[level] = h;
          }
        }

        s.triviaAciertosAplicados.push(row.id);
        s.triviaAciertosResultados[key] = earned;
        return { result: earned };
      });
      // Si el proceso se cae después del CAS, el resultado guardado permite reintentar sin duplicar XP ni sobres.
      await this.d.query("UPDATE actividad_aciertos_preview SET aplicado = 1, xp = ? WHERE id = ? AND aplicado = 0", Number(gained ?? 0), row.id);
      applied++;
    }
    await this.entregarRegalos();
    await this.syncTriviaProfiles();
    return applied;
  }

  /** Entrega regalos pendientes con una clave idempotente en el ledger del destinatario. */
  private async entregarRegalos(remitente?: string): Promise<number> {
    const rows = remitente
      ? await this.d.query<{ papu_id: string; estado: string }>("SELECT papu_id, estado FROM mundo_sandbox WHERE papu_id = ?", remitente)
      : await this.d.query<{ papu_id: string; estado: string }>("SELECT papu_id, estado FROM mundo_sandbox WHERE estado LIKE ? LIMIT 100", '%"regalosPendientes"%');
    let entregados = 0;
    for (const row of rows) {
      let pendientes: Record<string, { para: string; day: string }> = {};
      try { pendientes = (JSON.parse(row.estado) as EstadoSandbox).regalosPendientes ?? {}; } catch { continue; }
      for (const [id, regalo] of Object.entries(pendientes)) {
        if (!/^\d{5,25}$/.test(regalo.para) || regalo.para === row.papu_id) continue;
        if (regalo.day !== this.d.roulette.dayOf(this.now())) {
          // Si no se entregó antes de medianoche, caduca como en Discord y se devuelve el uso al remitente.
          await this.cambiar(row.papu_id, (origen) => {
            if (!origen.regalosPendientes?.[id]) return { result: undefined, changed: false };
            delete origen.regalosPendientes[id];
            if (!Object.keys(origen.regalosPendientes).length) delete origen.regalosPendientes;
            origen.consumibles["regalo-rin-len"] = (origen.consumibles["regalo-rin-len"] ?? 0) + 1;
            return { result: undefined };
          });
          continue;
        }
        await this.cambiar(regalo.para, (destino) => {
          destino.regalosRecibidos ??= [];
          if (destino.regalosRecibidos.includes(id)) return { result: undefined, changed: false };
          if (destino.ruletaRegaloDia !== regalo.day) { destino.ruletaRegaloDia = regalo.day; destino.ruletaRegalos = 0; }
          destino.ruletaRegalos = (destino.ruletaRegalos ?? 0) + 1;
          destino.regalosRecibidos.push(id);
          return { result: undefined };
        });
        await this.d.query("UPDATE mundo_perfiles SET pedido_at = ? WHERE papu_id = ?", this.now() + 2, regalo.para);
        await this.cambiar(row.papu_id, (origen) => {
          if (!origen.regalosPendientes?.[id]) return { result: undefined, changed: false };
          delete origen.regalosPendientes[id];
          if (!Object.keys(origen.regalosPendientes).length) delete origen.regalosPendientes;
          return { result: undefined };
        });
        entregados++;
      }
    }
    return entregados;
  }

  private async syncTriviaProfiles(): Promise<void> {
    const rows = await this.d.query<{ papu_id: string }>(
      "SELECT papu_id FROM actividad_perfiles WHERE pedido_at >= actualizado_at LIMIT 50",
    );
    for (const { papu_id } of rows) {
      const { state } = await this.cargar(papu_id);
      const now = this.now();
      const day = dayKey(new Date(now), this.d.timeZone);
      if (state.triviaDia !== day) {
        state.triviaDia = day;
        state.triviaXpDia = 0;
        state.triviaPartidasDia = [];
      }
      state.triviaPartidasDia ??= [];
      const runs = state.triviaPartidasDia.length;
      const withXp = runs < this.d.trivia.limites.partidasConXp;
      const from = dayKey(new Date(now - this.d.trivia.xp.dias * 86_400_000), this.d.timeZone);
      const avg = (this.d.db.prepare(
        "SELECT AVG(xp - trivia) AS avg FROM xp_dia WHERE user_id = ? AND day >= ? AND day < ? AND xp - trivia > 0",
      ).get(papu_id, from, day) as { avg: number | null } | undefined)?.avg ?? 0;
      const multiplier = this.d.levels.multiplier(new Date(now));
      const eligible = this.d.levels.canEarn(papu_id, now);
      const base = eligible ? answerXp(this.d.trivia, this.d.levels.settings, {
        xp: state.xp, dailyAvg: avg, streak: 1, multiplier,
      }) : 0;
      const tope = withXp && eligible
        ? Math.max(0, dailyCap(this.d.trivia, this.d.levels.settings, state.xp, multiplier) - (state.triviaXpDia ?? 0))
        : 0;
      await this.d.query(
        "UPDATE actividad_perfiles SET xp_base = ?, tope = ?, pedido_at = 0, actualizado_at = ? WHERE papu_id = ? AND pedido_at >= actualizado_at",
        base, tope, now + 1, papu_id,
      );
    }
  }

  /** Límite calculado con el nivel sandbox, conservando las excepciones de transición del perfil real. */
  cuotaLimite(userId: string): number | null | undefined {
    const state = this.cache.get(userId);
    if (!state) return undefined;
    const date = new Date(this.now());
    const record = this.d.levels.store.get(userId);
    const level = progress(this.d.levels.settings, state.xp).level;
    const limit = quotaWithTransition(this.d.levels.settings, level, record.prestige, record.veteran, date);
    return Number.isFinite(limit) ? limit : null;
  }

  /** Cuota visible del preview, incluyendo reinicios y extras del ledger sin modificar quota_usage real. */
  cuotaRestante(userId: string): number | null | undefined {
    const state = this.cache.get(userId);
    if (!state) return undefined;
    const now = this.now();
    const date = new Date(now);
    const day = dayKey(date, this.d.timeZone);
    const limit = this.cuotaLimite(userId);
    if (limit === null || limit === undefined) return limit;
    const extraBase = this.d.quota.extra(userId, date);
    const usedBase = this.d.quota.used(userId, date);
    const resetBase = state.cuotaResetDia === day ? state.cuotaResetBase ?? 0 : 0;
    const usedEffective = Math.max(0, usedBase - resetBase);
    const extraSandbox = state.cuotaExtraDia === day ? state.cuotaExtra : 0;
    return Math.max(0, limit + extraBase + extraSandbox - usedEffective - state.cuotaUsada);
  }
  ruletasUsadas(userId: string): number {
    const state = this.cache.get(userId);
    if (!state || state.ruletaDia !== this.d.roulette.dayOf(this.now())) return 0;
    return state.ruletaUsadas;
  }

  ruletasDisponibles(userId: string): number {
    const now = this.now();
    const day = this.d.roulette.dayOf(now);
    const state = this.cache.get(userId);
    const used = state?.ruletaDia === day ? state.ruletaUsadas : 0;
    const real = this.d.roulette.status(userId, now);
    const nivelYaContado = real.missions.some((m) => m.id === "nivel" && m.done);
    const extraNivel = state?.subioDia === day && !nivelYaContado ? 1 : 0;
    const voz = real.missions.find((m) => m.id === "voz");
    const vozActual = this.d.levels.store.dayStats(userId, day).vozMin;
    const extraMicrofono = state?.microfonoDia === day && !!state.microfonoMinutos && !!voz && !voz.done && vozActual >= state.microfonoMinutos ? 1 : 0;
    const reset = state?.ruletaResetDia === day ? state.ruletaResetUsadas ?? 0 : 0;
    const regalo = state?.ruletaRegaloDia === day ? state.ruletaRegalos ?? 0 : 0;
    return Math.max(0, real.left + reset + regalo + extraNivel + extraMicrofono - used);
  }

  private inicial(userId: string): EstadoSandbox {
    const triviaDay = dayKey(new Date(this.now()), this.d.timeZone);
    const reinicio = reinicioDe(this.d.db, userId, triviaDay);
    const triviaXpReal = (this.d.db.prepare("SELECT trivia FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, triviaDay) as { trivia: number } | undefined)?.trivia ?? 0;
    const partidasTrivia = this.d.db.prepare("SELECT id FROM trivia_partidas WHERE user_id = ? AND day = ? ORDER BY id").all(userId, triviaDay) as { id: number }[];
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
      subioDia: "",
      disqueteProcesadoDia: "",
      ruletaGuardadas: 0,
      // Foto inicial de la progresión de trivia, siempre leída desde SQLite en solo lectura.
      triviaDia: triviaDay,
      triviaXpDia: Math.max(0, triviaXpReal - reinicio.triviaXp),
      triviaPartidasDia: partidasTrivia.slice(reinicio.triviaPartidas).map((x) => `legacy:${x.id}`),
      triviaSuperadas: (this.d.db.prepare("SELECT pregunta FROM trivia_superadas WHERE user_id = ?").all(userId) as { pregunta: string }[]).map((x) => x.pregunta),
      triviaPremios: (this.d.db.prepare("SELECT dificultad FROM trivia_premios WHERE user_id = ?").all(userId) as { dificultad: string }[]).map((x) => x.dificultad),
      triviaHitos: Object.fromEntries((this.d.db.prepare("SELECT dificultad, aciertos, premios FROM trivia_hitos WHERE user_id = ?").all(userId) as { dificultad: Dificultad; aciertos: number; premios: number }[]).map((x) => [x.dificultad, { aciertos: x.aciertos, premios: x.premios }])),
      triviaAciertosAplicados: [],
      monedasDia: hoy,
      xpSandboxDia: 0,
      monedasActividadDia: this.d.coins?.activityToday(userId, this.now()).actividad ?? 0,
      monedasXpBase: this.d.coins?.activityToday(userId, this.now()).xp ?? 0,
      monedasResetBaseDia: reinicio.veces && hoy ? hoy : undefined,
      monedasResetBaseXp: reinicio.monedasXp,
      monedasResetBasePrevia: reinicio.monedasPrevia,
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
        state.subioDia ??= "";
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
    return ok({ abierta: !!vitrina, sandbox: true, premioPendiente: !!state.atunPendiente, wallet: state.wallet, objetos });
  }

  private datosMercado(state: EstadoSandbox): Resultado {
    if (!this.d.mercado) return error("El mercado negro no está habilitado.");
    const now = this.now();
    const settings = this.d.mercado.settings;
    const hoy = aperturaHoy(settings, now);
    const proxima = proximaApertura(settings, now);
    const abierto = settings.activo && abierta(hoy, now);
    const disponibles = this.d.mercado.vitrina(now).filter((o) => EFECTOS_MERCADO_PREVIEW.has(o.efecto));
    const idsVitrina = new Set(disponibles.map((o) => o.id));
    const inventarioVisible = settings.objetos.filter((o) =>
      EFECTOS_MERCADO_PREVIEW.has(o.efecto) && !idsVitrina.has(o.id) && ((CONSUMIBLES.includes(o.efecto) && (state.consumibles[o.id] ?? 0) > 0) ||
        (PERMANENTES.includes(o.efecto) && state.comprasMercado.includes(o.id))));
    const objetos = [...disponibles, ...inventarioVisible].map((o) => {
      const permanente = PERMANENTES.includes(o.efecto);
      const usos = state.consumibles[o.id] ?? 0;
      const owned = o.efecto === "objeto"
        ? state.inventario.includes(o.objeto!)
        : CONSUMIBLES.includes(o.efecto)
          ? usos > 0
          : permanente && state.comprasMercado.includes(o.id);
      const microfonoActivo = o.efecto === "microfono" && state.microfonoDia === this.d.roulette.dayOf(now);
      return {
        id: o.id, nombre: o.nombre, emoji: o.emoji, descripcion: o.descripcion,
        rareza: permanente ? "contrabando" : "raro", precio: o.precio,
        usos, owned, activable: (o.efecto === "microfono" && usos > 0 && !microfonoActivo) || ((o.id === "pc-adachi-rei" || o.id === "regalo-rin-len") && usos > 0), activo: microfonoActivo,
      };
    });
    return ok({
      abierto, sandbox: true, premioPendiente: !!state.atunPendiente, wallet: state.wallet, objetos,
      apertura: { abre: hoy.abre, cierra: hoy.cierra },
      proximaApertura: { abre: proxima.abre, cierra: proxima.cierra },
    });
  }

  private async comprarTienda(userId: string, datos: unknown): Promise<Resultado> {
    if (!this.d.coins) return error("La tienda no está habilitada.");
    const id = datos && typeof datos === "object" ? (datos as { id?: unknown }).id : null;
    if (typeof id !== "string" || id.length > 100) return error("Artículo inválido.");
    return this.cambiar(userId, (s) => {
      if (s.atunPendiente) return { result: error("Acepta o descarta primero el premio pendiente del Atún de Luka antes de gastar monedas."), changed: false };
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
      if (s.atunPendiente) return { result: error("Acepta o descarta primero el premio pendiente del Atún de Luka antes de gastar monedas."), changed: false };
      const settings = this.d.mercado!.settings;
      const apertura = aperturaHoy(settings, now);
      if (!settings.activo || !abierta(apertura, now)) {
        return { result: error(`Neru tiene cerrado el mercado. Próxima apertura: ${new Date(proximaApertura(settings, now).abre).toLocaleString("es-CL", { timeZone: settings.zona })}.`), changed: false };
      }
      const o = this.d.mercado!.byId.get(id);
      if (!o) return { result: error("Ese artículo no existe."), changed: false };
      if (!EFECTOS_MERCADO_PREVIEW.has(o.efecto)) return { result: error("Ese artículo depende de una actividad externa aún no habilitada en la Plaza; no se puede comprar en el sandbox."), changed: false };
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
      if (o.efecto === "disquete") {
        s.disqueteProcesadoDia = this.d.roulette.dayOf(now);
        s.ruletaGuardadas = 0;
      }
      return {
        result: ok({
          mensaje: `¡Compraste ${o.nombre}! ${o.usos ? `Se añadieron ${o.usos} usos.` : "El artículo quedó registrado en tu colección de prueba."}`,
          wallet: s.wallet, usos: s.consumibles[id] ?? 0, sandbox: true,
        }),
      };
    });
  }

  /** Activa un consumible localmente. En preview solo se implementan efectos que no requieren Discord. */
  private async usarConsumible(userId: string, datos: unknown): Promise<Resultado> {
    if (!this.d.mercado) return error("El inventario de consumibles no está habilitado.");
    const id = datos && typeof datos === "object" ? (datos as { id?: unknown }).id : null;
    const actual = await this.cargar(userId);
    if (actual.state.atunPendiente) return error("Acepta o descarta primero el premio pendiente del Atún de Luka antes de usar otros consumibles.");
    if (id === "pc-adachi-rei") {
      const now=this.now(), day=dayKey(new Date(now),this.d.timeZone);
      const spins=this.d.roulette.status(userId,now).used;
      const quotaUsed=Math.max(0,this.d.quota.used(userId,new Date(now))-this.d.quota.donated(userId,new Date(now)));
      const result=await this.cambiar(userId,(s)=>{
        if(s.atunPendiente?.day===this.d.roulette.dayOf(now))return {result:error("Acepta o descarta primero el premio pendiente del Atún de Luka."),changed:false};
        const usos=s.consumibles[id]??0;
        if(usos<=0)return {result:error("No te quedan usos del PC de Adachi Rei."),changed:false};
        s.consumibles[id]=usos-1;
        // El PC reinicia también el tramo de monedas por actividad, sin borrar las ya ganadas.
        this.recalcularMonedasActividad(s,userId,day,0);
        const monedas = this.d.coins?.activityToday(userId,now);
        s.monedasResetDia=day;
        s.monedasResetXp=(s.monedasXpBase??monedas?.xp??0)+(s.xpSandboxDia??0);
        s.monedasResetPrevia=s.monedasActividadDia??monedas?.actividad??0;
        s.triviaDia=day;s.triviaXpDia=0;s.triviaPartidasDia=[];
        s.ruletaDia=day;s.ruletaUsadas=0;s.ruletaResetDia=day;s.ruletaResetUsadas=spins;
        s.cuotaResetDia=day;s.cuotaResetBase=quotaUsed;s.cuotaUsada=0;
        return {result:ok({mensaje:"💻 Día reiniciado en tu progreso de prueba: partidas, topes de XP, monedas por actividad, tiradas y cuota sandbox vuelven a contar desde cero. Lo que ya ganaste se conserva.",usos:s.consumibles[id],sandbox:true})};
      });
      if(result.ok) await this.d.query("UPDATE actividad_perfiles SET pedido_at = ? WHERE papu_id = ?",now+2,userId);
      return result;
    }
    if (id === "regalo-rin-len") {
      const para = datos && typeof datos === "object" ? (datos as { para?: unknown }).para : null;
      if (typeof para !== "string" || !/^[0-9]{5,25}$/.test(para)) return error("Indica el ID de Discord válido del Papu que recibirá la tirada.");
      if (para === userId) return error("Rin y Len no te dejan regalarte una tirada a ti mismo. 🍊🍌");
      const miembro = await this.d.query<{ papu_id: string }>("SELECT papu_id FROM mundo_perfiles WHERE papu_id = ?", para);
      if (!miembro.length) return error("Ese Papu debe haber entrado a la Plaza al menos una vez para recibir una tirada de prueba.");
      if (this.d.roulette.status(para, this.now()).blocked) return error("Ese Papu tiene la ruleta bloqueada y perdería el regalo.");
      const reserva = await this.cambiar(userId, (s) => {
        if (s.atunPendiente?.day === this.d.roulette.dayOf(this.now())) return { result: error("Acepta o descarta primero el premio pendiente del Atún de Luka."), changed: false };
        const usos = s.consumibles[id] ?? 0;
        if (usos <= 0) return { result: error("No te quedan regalos de Rin y Len."), changed: false };
        s.regalosSecuencia = (s.regalosSecuencia ?? 0) + 1;
        const regaloId = String(userId) + ":" + String(this.now()) + ":" + String(s.regalosSecuencia);
        s.consumibles[id] = usos - 1;
        s.regalosPendientes ??= {};
        s.regalosPendientes[regaloId] = { para, day: this.d.roulette.dayOf(this.now()) };
        return { result: ok({ regaloId, usos: s.consumibles[id] }) };
      });
      if (!reserva.ok) return reserva;
      // El pendiente permanece en el ledger del remitente si falla la entrega y se reintenta en el siguiente ciclo.
      await this.entregarRegalos(userId);
      const pendientes = await this.cargar(userId);
      const quedan = Object.keys(pendientes.state.regalosPendientes ?? {}).length;
      return ok({ mensaje: quedan ? "🍊🍌 El regalo quedó registrado y se entregará al completar la sincronización." : "🍊🍌 ¡Regalo enviado! Se añadió una tirada sandbox a " + para + ".", usos: (reserva.datos as { usos: number }).usos, sandbox: true });
    }
    if (id !== "microfono-meiko") return error("Ese consumible todavía no tiene una acción disponible en la Plaza.");
    const objeto = this.d.mercado.byId.get(id);
    if (!objeto || objeto.efecto !== "microfono" || !objeto.vozMinutos) return error("El Micrófono de Meiko no está configurado.");
    return this.cambiar(userId, (s) => {
      const day = this.d.roulette.dayOf(this.now());
      if (s.atunPendiente?.day === day) return { result: error("Acepta o descarta primero el premio pendiente del Atún de Luka."), changed: false };
      if (s.microfonoDia === day) return { result: error("El Micrófono de Meiko ya está activo por hoy."), changed: false };
      const usos = s.consumibles[id] ?? 0;
      if (usos <= 0) return { result: error("No te quedan usos del Micrófono de Meiko."), changed: false };
      s.consumibles[id] = usos - 1;
      s.microfonoDia = day;
      s.microfonoMinutos = objeto.vozMinutos;
      return { result: ok({ mensaje: `🎤 Micrófono activado: la misión de voz pide ${objeto.vozMinutos} minutos hoy.`, usos: s.consumibles[id], sandbox: true }) };
    });
  }

  private async pescar(userId: string): Promise<Resultado> {
    const now = this.now();
    if (!this.d.levels.canEarn(userId, now)) return error("Neru te bloqueó temporalmente la XP; hoy no puedes obtener recompensas. 🚫");
    return this.cambiar(userId, (s) => {
      if (s.atunPendiente) return { result: error("Acepta o descarta primero el premio pendiente del Atún de Luka."), changed: false };
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
      const nivelDespues = progress(this.d.levels.settings, xpDespues).level;
      if (nivelDespues > nivelAntes) s.subioDia = this.d.roulette.dayOf(now);
      this.registrarXpSandbox(s, userId, this.d.roulette.dayOf(now), recompensa.xp, nivelAntes, nivelDespues);
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

  /** Cierra los días transcurridos y acumula tiradas no usadas solo desde que el Disquete está en el ledger sandbox. */
  private async actualizarDisquete(userId: string): Promise<void> {
    const day = this.d.roulette.dayOf(this.now());
    await this.cambiar(userId, (s) => {
      if (!s.comprasMercado.includes("disquete-adachi-rei")) return { result: undefined, changed: false };
      let cursor = s.disqueteProcesadoDia || s.ruletaDia;
      if (!cursor || cursor >= day) return { result: undefined, changed: false };
      let guardadas = s.ruletaGuardadas ?? 0;
      for (let i = 0; cursor < day && i < 400; i++) {
        const fin = this.finDia(cursor);
        const real = this.d.roulette.status(userId, fin);
        const nivel = s.subioDia === cursor && !real.missions.some((m) => m.id === "nivel" && m.done) ? 1 : 0;
        const voz = real.missions.find((m) => m.id === "voz");
        const vozActual = this.d.levels.store.dayStats(userId, cursor).vozMin;
        const microfono = s.microfonoDia === cursor && !!s.microfonoMinutos && !!voz && !voz.done && vozActual >= s.microfonoMinutos ? 1 : 0;
        const usadas = (s.ruletaDia === cursor ? s.ruletaUsadas : 0) + (s.atunPendiente?.day === cursor && s.atunPendiente.aplicado === false ? 1 : 0);
        const reset = s.ruletaResetDia === cursor ? s.ruletaResetUsadas ?? 0 : 0;
        const regalos = s.ruletaRegaloDia === cursor ? s.ruletaRegalos ?? 0 : 0;
        guardadas = Math.max(0, guardadas + real.left + reset + regalos + nivel + microfono - usadas);
        cursor = this.siguienteDia(cursor);
      }
      s.ruletaGuardadas = guardadas;
      s.disqueteProcesadoDia = day;
      return { result: undefined };
    });
  }

  /** Último milisegundo del día según la zona horaria de la ruleta. */
  private finDia(day: string): number {
    let lo = Date.parse(`${day}T12:00:00.000Z`);
    let hi = lo + 3_600_000;
    while (this.d.roulette.dayOf(hi) === day) { lo = hi; hi += 3_600_000; }
    while (hi - lo > 1) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (this.d.roulette.dayOf(mid) === day) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  private siguienteDia(day: string): string {
    const t = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,"0")}-${String(t.getUTCDate()).padStart(2,"0")}`;
  }

  private async estadoRuleta(userId: string): Promise<Resultado> {
    await this.actualizarDisquete(userId);
    const loaded = await this.cargar(userId);
    const state = loaded.state;
    const now = this.now();
    const day = this.d.roulette.dayOf(now);
    const used = state.ruletaDia === day ? state.ruletaUsadas : 0;
    const real = this.d.roulette.status(userId, now);
    const estado = ruletaEstado(this.d.roulette, userId, real);
    const nivelYaContado = real.missions.some((m) => m.id === "nivel" && m.done);
    const misionNivelSandbox = state.subioDia === day && !nivelYaContado;
    const vozActual = this.d.levels.store.dayStats(userId, day).vozMin;
    const microfonoActivo = state.microfonoDia === day && !!state.microfonoMinutos;
    const misiones = estado.misiones.map((m) => {
      if (m.id === "nivel" && misionNivelSandbox) return { ...m, hecha: true, actual: m.meta };
      if (m.id === "voz" && microfonoActivo) {
        const meta = state.microfonoMinutos!;
        return { ...m, nombre: `${meta} min en voz`, meta, actual: Math.min(vozActual, meta), hecha: vozActual >= meta };
      }
      return m;
    });
    const voz = real.missions.find((m) => m.id === "voz");
    const misionVozSandbox = microfonoActivo && !!voz && !voz.done && vozActual >= state.microfonoMinutos!;
    return ok({
      ...estado,
      misiones,
      tiradas: Math.max(0, real.left + (state.ruletaResetDia === day ? state.ruletaResetUsadas ?? 0 : 0) + (state.ruletaRegaloDia === day ? state.ruletaRegalos ?? 0 : 0) + (misionNivelSandbox ? 1 : 0) + (misionVozSandbox ? 1 : 0) + (state.ruletaGuardadas ?? 0) - used),
      usadas: Math.max(0, real.used - (state.ruletaResetDia === day ? state.ruletaResetUsadas ?? 0 : 0)) + used,
      sandbox: true,
      atunPendiente: state.atunPendiente ? { girosRestantes: state.atunPendiente.day === day && state.atunPendiente.aplicado === false ? Math.max(0, (this.d.mercado?.byId.get("atun-luka")?.giros ?? 0) - state.atunPendiente.giros) : 0, premio: this.d.roulette.settings.premios[state.atunPendiente.index]?.etiqueta ?? "Premio reservado", aplicado: state.atunPendiente.aplicado !== false } : undefined,
      soloLectura: false,
      simulacion: false,
      extras: [...estado.extras, ...(microfonoActivo ? [`🎤 Micrófono de Meiko activo: hoy la misión pide ${state.microfonoMinutos} min (progreso consultado en modo lectura).`] : []), ...(state.comprasMercado.includes("disquete-adachi-rei") ? [`💾 Disquete de Adachi Rei: ${state.ruletaGuardadas ?? 0} tiradas guardadas para hoy.`] : []), "🧪 Las tiradas y premios se guardan en el progreso aislado de la Plaza; no afectan Discord."],
    });
  }

  private aplicarPremio(state: EstadoSandbox, userId: string, day: string, now: number, index: number): {
    xp: number; mensajes: number; sobres: number; titulo: string; subtitulo: string; texto: string; subioAntes?: string; nivelAntes: number; bonoNivel: number;
  } | null {
    const premio = this.d.roulette.settings.premios[index];
    if (!premio || (premio.tipo === "sobre" && !this.d.coins)) return null;
    const levelBefore = progress(this.d.levels.settings, state.xp).level;
    const subioAntes = state.subioDia;
    let xp = 0, mensajes = 0, sobres = 0, overflow = 0;
    if (premio.tipo === "xp") {
      xp = prizeXp(this.d.roulette.settings, this.d.levels.settings, premio, state.xp, this.d.levels.multiplier(new Date(now)));
      state.xp += xp;
    } else if (premio.tipo === "cuota" || premio.tipo === "cuota_llena") {
      const sandboxLimit = this.cuotaLimite(userId);
      const limit = sandboxLimit === undefined ? this.d.quota.limitFor(userId, new Date(now)) : sandboxLimit;
      const extraBase = this.d.quota.extra(userId, new Date(now));
      const usedBase = this.d.quota.used(userId, new Date(now));
      const usedEffective = Math.max(0, usedBase - (state.cuotaResetDia === day ? state.cuotaResetBase ?? 0 : 0));
      const extraSandbox = state.cuotaExtraDia === day ? state.cuotaExtra : 0;
      const roomActual = limit !== null && Number.isFinite(limit)
        ? Math.max(0, limit - Math.max(0, limit + extraBase + extraSandbox - usedEffective - state.cuotaUsada))
        : 0;
      if (premio.tipo === "cuota_llena") {
        mensajes = Math.min(1, roomActual);
        overflow = 1 - mensajes;
      } else {
        const unidades = premio.valor ?? 0;
        mensajes = Math.min(unidades, roomActual);
        overflow = unidades - mensajes;
      }
      state.cuotaExtra = extraSandbox + mensajes;
      state.cuotaExtraDia = day;
      if (overflow > 0) {
        const c = this.d.levels.settings.cuotaSobrante ?? { porcentajeNivel: 0.05, minimo: 15 };
        const needed = progress(this.d.levels.settings, state.xp).needed;
        xp = Math.round(Math.max(c.minimo, c.porcentajeNivel * needed) * overflow);
        state.xp += xp;
      }
    } else if (premio.tipo === "sobre") {
      sobres = premio.valor ?? 1;
      state.wallet.gratis += sobres;
    }
    const levelAfter = progress(this.d.levels.settings, state.xp).level;
    if (levelAfter > levelBefore) state.subioDia = day;
    const bonoNivel = this.registrarXpSandbox(state, userId, day, xp, levelBefore, levelAfter);
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
    return { xp, mensajes, sobres, titulo, subtitulo, texto, subioAntes, nivelAntes: levelBefore, bonoNivel };
  }

  private tiradasDisponibles(state: EstadoSandbox, userId: string, day: string, real: ReturnType<RouletteService["status"]>): number {
    const nivelYaContado = real.missions.some((m) => m.id === "nivel" && m.done);
    const extraNivel = state.subioDia === day && !nivelYaContado ? 1 : 0;
    const voz = real.missions.find((m) => m.id === "voz");
    const vozActual = this.d.levels.store.dayStats(userId, day).vozMin;
    const extraMicrofono = state.microfonoDia === day && !!state.microfonoMinutos && !!voz && !voz.done && vozActual >= state.microfonoMinutos ? 1 : 0;
    const disponibles = real.left
      + (state.ruletaResetDia === day ? state.ruletaResetUsadas ?? 0 : 0)
      + (state.ruletaRegaloDia === day ? state.ruletaRegalos ?? 0 : 0)
      + extraNivel + extraMicrofono + (state.ruletaGuardadas ?? 0);
    const usadas = state.ruletaDia === day ? state.ruletaUsadas : 0;
    return Math.max(0, disponibles - usadas);
  }

  private giroPendiente(userId: string, nombre: string, index: number, girosRestantes: number, usos: number, tiradas: number): {
    giro: { papu: string; nombre: string; index: number; titulo: string; subtitulo: string; origen: string };
    texto: string; tiradas: number; sandbox: true; atun: { girosRestantes: number; usos: number };
  } {
    const premio = this.d.roulette.settings.premios[index];
    const etiqueta = premio?.etiqueta ?? "Premio de la ruleta";
    return {
      giro: { papu: userId, nombre, index, titulo: `🐟 ${etiqueta}`, subtitulo: "Premio pendiente · todavía no aplicado", origen: "plaza" },
      texto: `${etiqueta}: premio reservado. Acéptalo o descártalo con el Atún de Luka.`,
      tiradas, sandbox: true, atun: { girosRestantes, usos },
    };
  }

  private async girarRuleta(userId: string, nombre: string): Promise<Resultado> {
    const now = this.now();
    await this.actualizarDisquete(userId);
    const day = this.d.roulette.dayOf(now);
    const real = this.d.roulette.status(userId, now);
    return this.cambiar(userId, (s) => {
      const pending = s.atunPendiente;
      if (pending?.aplicado === false) {
        const aplicado = this.aplicarPremio(s, userId, day, now, pending.index);
        if (!aplicado) return { result: error("El premio pendiente ya no está configurado."), changed: false };
        if (s.ruletaDia === pending.day) s.ruletaUsadas++;
        else if (pending.day === day) { s.ruletaDia = day; s.ruletaUsadas = 1; }
        s.atunPendiente = undefined;
        return { result: ok({ giro: { papu: userId, nombre, index: pending.index, titulo: `🧪 ${aplicado.titulo}`, subtitulo: aplicado.subtitulo, origen: "plaza" }, texto: aplicado.texto, tiradas: this.tiradasDisponibles(s, userId, day, real), sandbox: true }) };
      }
      // Compatibilidad con ledgers anteriores: el premio antiguo ya se había acreditado al sortear.
      if (pending) s.atunPendiente = undefined;
      if (!this.d.levels.canEarn(userId, now)) return { result: error("Neru te bloqueó la ruleta: no puedes obtener recompensas. 🚫"), changed: false };
      if (real.blocked) return { result: error("🚫 Neru te dio un machetazo: sin ruleta por ahora."), changed: false };
      if (s.ruletaDia !== day) { s.ruletaDia = day; s.ruletaUsadas = 0; }
      const disponibles = this.tiradasDisponibles(s, userId, day, real);
      if (disponibles <= 0) return { result: error("No te quedan tiradas disponibles. Cumple una misión y vuelve a intentarlo."), changed: false };
      const index = pickPrize({ premios: this.d.roulette.settings.premios.map((p) => p.tipo === "sobre" && !this.d.coins ? { ...p, peso: 0 } : p) }, this.rnd);
      const atun = this.d.mercado?.byId.get("atun-luka");
      const usosAtun = s.consumibles["atun-luka"] ?? 0;
      if (atun?.efecto === "atun" && usosAtun > 0 && (atun.giros ?? 0) > 0) {
        s.atunPendiente = { day, index, giros: 0, gastoUso: false, aplicado: false };
        return { result: ok(this.giroPendiente(userId, nombre, index, atun.giros ?? 0, usosAtun, disponibles)) };
      }
      const aplicado = this.aplicarPremio(s, userId, day, now, index);
      if (!aplicado) return { result: error("La ruleta no tiene premios configurados."), changed: false };
      s.ruletaUsadas++;
      return { result: ok({ giro: { papu: userId, nombre, index, titulo: `🧪 ${aplicado.titulo}`, subtitulo: aplicado.subtitulo, origen: "plaza" }, texto: aplicado.texto, tiradas: this.tiradasDisponibles(s, userId, day, real), sandbox: true }) };
    });
  }

  private async aceptarAtun(userId: string): Promise<Resultado> {
    const now = this.now();
    const day = this.d.roulette.dayOf(now);
    await this.actualizarDisquete(userId);
    return this.cambiar(userId, (s) => {
      const pending = s.atunPendiente;
      if (!pending) return { result: error("No tienes un premio pendiente que aceptar."), changed: false };
      if (pending.aplicado === false) {
        const aplicado = this.aplicarPremio(s, userId, day, now, pending.index);
        if (!aplicado) return { result: error("El premio pendiente ya no está configurado."), changed: false };
        if (s.ruletaDia === pending.day) s.ruletaUsadas++;
        else if (pending.day === day) { s.ruletaDia = day; s.ruletaUsadas = 1; }
        s.atunPendiente = undefined;
        return { result: ok({ mensaje: `🐟 Premio aceptado: ${aplicado.titulo}. ${aplicado.texto}`, wallet: s.wallet, sandbox: true }) };
      }
      s.atunPendiente = undefined;
      return { result: ok({ mensaje: "🐟 Premio anterior confirmado; ya estaba aplicado en tu progreso de prueba.", wallet: s.wallet, sandbox: true }) };
    });
  }

  private async descartarAtun(userId: string, nombre: string): Promise<Resultado> {
    const now = this.now();
    const day = this.d.roulette.dayOf(now);
    const real = this.d.roulette.status(userId, now);
    return this.cambiar(userId, (s) => {
      const pending = s.atunPendiente;
      const objeto = this.d.mercado?.byId.get("atun-luka");
      if (!pending || pending.day !== day || objeto?.efecto !== "atun") return { result: error("No tienes un giro pendiente que puedas descartar hoy."), changed: false };
      const maxGiros = objeto.giros ?? 0;
      if (pending.giros >= maxGiros) return { result: error("Ya usaste todos los descartes de este giro."), changed: false };
      if (pending.aplicado !== false) {
        s.xp = Math.max(0, s.xp - (pending.xp ?? 0));
        this.recalcularMonedasActividad(s, userId, day, -(pending.xp ?? 0));
        if (pending.bonoNivel) s.wallet.ganadas = Math.max(0, s.wallet.ganadas - pending.bonoNivel);
        if (s.cuotaExtraDia === day) s.cuotaExtra = Math.max(0, s.cuotaExtra - (pending.mensajes ?? 0));
        s.wallet.gratis = Math.max(0, s.wallet.gratis - (pending.sobres ?? 0));
        if (pending.nivelAntes !== undefined && progress(this.d.levels.settings, s.xp).level > pending.nivelAntes) s.subioDia = day;
        else if (pending.subioAntes !== undefined) s.subioDia = pending.subioAntes;
        else if (s.subioDia === day) s.subioDia = "";
      }
      let usos = s.consumibles["atun-luka"] ?? 0;
      if (!pending.gastoUso) {
        if (usos <= 0) return { result: error("No te quedan usos del Atún de Luka."), changed: false };
        s.consumibles["atun-luka"] = --usos;
      }
      const index = pickPrize({ premios: this.d.roulette.settings.premios.map((p) => p.tipo === "sobre" && !this.d.coins ? { ...p, peso: 0 } : p) }, this.rnd);
      const giros = pending.giros + 1;
      s.atunPendiente = { day, index, giros, gastoUso: true, aplicado: false };
      return { result: ok({
        ...this.giroPendiente(userId, nombre, index, Math.max(0, maxGiros - giros), usos, this.tiradasDisponibles(s, userId, day, real)),
        texto: `🐟 Premio descartado. ${this.d.roulette.settings.premios[index]?.etiqueta ?? "Nuevo premio"} reservado para aceptar.`,
      }) };
    });
  }

  acciones(): Partial<Record<Accion, Atender>> {
    return {
      "ruleta.estado": (papu) => this.estadoRuleta(papu.id),
      "ruleta.girar": (papu) => this.girarRuleta(papu.id, papu.nombre),
      "ruleta.descartar": (papu) => this.descartarAtun(papu.id, papu.nombre),
      "ruleta.aceptar": (papu) => this.aceptarAtun(papu.id),
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
      "mercado.usar": (papu, datos) => this.usarConsumible(papu.id, datos),
    };
  }
}
