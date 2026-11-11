// Numeros del dia que da Mango9374 (pedido de GyroP, 31 oct. 2026): a un Papu, lo suyo (cuota gastada, XP, mensajes,
// con quien no se puede casar ahora y, desde el 2 nov. 2026, minutos en voz y su trivia); a GyroP, los totales del
// servidor; desde el 10 nov. 2026, también las Shaula-coins. Todo sale de SQLite (quota_usage, xp_dia, ruleta, bodas, trivia_partidas) y de mensajes_dia, que cuenta los
// mensajes enviados de Papus y Vocaloids. Sin LLM (regla 4).
import type { WeddingService } from "../bodas/service";
import type { CoinService } from "../coins/service";
import type { BotId } from "../config";
import type { Db } from "../db/database";
import type { LevelService } from "../levels/service";
import type { Quota } from "../quota/quota";
import type { RouletteService } from "../ruleta/service";
import { DIFICULTADES } from "../trivia/rules";
import type { TriviaService } from "../trivia/service";
import { missions } from "../ruleta/rules";
import { dayKey } from "../time";

export interface PapuDay {
  /** Mensajes enviados hoy (todos, den XP o no). */
  messages: number;
  xp: number;
  /** Cuota gastada con los Vocaloids (sin lo donado), lo donado, lo que queda y su limite del dia (con extra). */
  spent: number;
  donated: number;
  left: number;
  limit: number;
  /** Casado ahora (con quien y hasta cuando). */
  married: { bot: BotId; until: number } | null;
  /** Con quien no se puede casar ahora y por que. */
  blocked: { bot: BotId; why: "casada" | "repite" }[];
  /** Minutos conectado en voz hoy (den XP o no; fuera del canal AFK). */
  voiceMin: number;
  /** Su trivia (sin trivia en el bot, null). */
  trivia: TriviaDay | null;
  /** Sus Shaula-coins (pedido de GyroP, 10 nov. 2026; sin tienda, null): monedero y lo ganado hoy participando. */
  coins: { ganadas: number; compradas: number; ecos: number; hoy: number } | null;
  /** Apuestas del 1vs1: lo ganado y perdido en las peleas que terminaron hoy y lo que sigue en juego. */
  bets: BetsDay;
}

export interface BetsDay {
  /** Peleas de hoy en las que apostó (ya terminadas). */
  peleas: number;
  /** Ganancia (lo cobrado menos lo apostado) en las que acertó y lo que perdió en las que falló (el seguro devuelve). */
  ganado: number;
  perdido: number;
  /** Apostado en peleas que aún no terminan. */
  enJuego: number;
}

export interface TriviaDay {
  /** Partidas de hoy, las que aun no cuestan XP (null = sin castigo, ninguna cuesta) y las que aun dan XP. */
  runs: number;
  freeLeft: number | null;
  withXpLeft: number;
  correct: number;
  xp: number;
  /** XP que le costaron hoy las partidas de mas. */
  cost: number;
  best: number;
  /** Superadas de cada dificultad (con su emoji). */
  levels: { emoji: string; nombre: string; done: number; total: number; prize: boolean }[];
}

export interface ServerDay {
  spent: number;
  donated: number;
  papuMessages: number;
  botMessages: number;
  /** Papus que ya giraron todas las tiradas posibles de la ruleta hoy. */
  fullRoulette: number;
  /** Papus que gastaron toda su cuota de hoy. */
  noQuota: number;
  /** Quien mas XP gano hoy (sin GyroP). */
  topXp: { userId: string; xp: number } | null;
  /** Minutos en voz de todos los Papus sumados y cuantos Papus entraron. */
  voiceMinutes: number;
  voicePapus: number;
  /** Trivia de hoy: partidas, Papus que jugaron y XP cobrada por partidas de mas (sin trivia, null). */
  trivia: { runs: number; players: number; cost: number; best: { userId: string; streak: number } | null } | null;
  /** Shaula-coins (sin tienda, null): ganadas hoy participando por todos y las que hay en los monederos. */
  coins: { hoy: number; ganadas: number; compradas: number; ecos: number } | null;
  /** Apuestas de hoy de todos los Papus (sin peleas, todo en 0). */
  bets: BetsDay & { papus: number };
}

export interface DayStatsDeps {
  db: Db;
  quota: Quota;
  levels: LevelService;
  timeZone: string;
  roulette?: RouletteService | null;
  weddings?: WeddingService | null;
  trivia?: TriviaService | null;
  coins?: CoinService | null;
  /** Quienes no cuentan en el top de XP (GyroP). */
  owners: Pick<ReadonlySet<string>, "has">;
}

export class DayStats {
  constructor(private readonly d: DayStatsDeps) {}

  private day(now: Date): string {
    return dayKey(now, this.d.timeZone);
  }

  /** Cuenta un mensaje enviado (de un Papu o de un Vocaloid). */
  countMessage(userId: string, bot: boolean, now = new Date()): void {
    this.d.db
      .prepare("INSERT INTO mensajes_dia (user_id, day, n, bot) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1")
      .run(userId, this.day(now), bot ? 1 : 0);
  }

  /** Un minuto en voz de estos Papus (cada latido; den XP o no). */
  countVoiceMinute(userIds: readonly string[], now = new Date()): void {
    const day = this.day(now);
    const st = this.d.db.prepare("INSERT INTO xp_dia (user_id, day, voz_total) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET voz_total = voz_total + 1");
    for (const id of new Set(userIds)) st.run(id, day);
  }

  private triviaOf(userId: string, now: Date): TriviaDay | null {
    const t = this.d.trivia;
    if (!t) return null;
    const at = now.getTime();
    const runs = t.runsToday(userId, at);
    // Las que cuentan para los limites (desde el PC de Adachi Rei del mercado negro, si lo uso hoy).
    const counted = t.runsCounted(userId, at);
    const lim = t.settings.limites;
    const row = this.d.db.prepare("SELECT trivia_castigo AS c FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, this.day(now)) as { c: number } | undefined;
    const progress = t.progress(userId);
    return {
      runs,
      freeLeft: lim.castigo ? Math.max(0, lim.castigo.desdePartida - 1 - counted) : null,
      withXpLeft: Math.max(0, lim.partidasConXp - counted),
      correct: t.correctToday(userId, at),
      xp: t.xpToday(userId, at),
      cost: row?.c ?? 0,
      best: t.best(userId),
      levels: DIFICULTADES.map((l) => ({ emoji: t.settings.dificultades[l].emoji, nombre: t.settings.dificultades[l].nombre, ...progress[l] })),
    };
  }

  private coinsOf(userId: string): PapuDay["coins"] {
    const c = this.d.coins;
    if (!c) return null;
    // Primero se le paga lo que ya ganó hoy participando (como al abrir la tienda).
    c.sync(userId, 2);
    const w = c.wallet(userId);
    return { ganadas: w.ganadas, compradas: w.compradas, ecos: w.ecos, hoy: w.hoy };
  }

  /** Apuestas de las peleas terminadas hoy (y lo que sigue en juego), de un Papu o de todos. */
  private betsOf(now: Date, userId: string | null): BetsDay & { papus: number } {
    const day = this.day(now);
    const who = userId ? " AND a.user_id = ?" : "";
    const args = userId ? [userId] : [];
    // Dos días hacia atrás alcanza para cubrir el día de hoy en cualquier zona; se filtra por día abajo.
    const rows = this.d.db
      .prepare(`SELECT a.pelea, a.user_id, a.cantidad, a.pago, p.terminada_at FROM apuestas a JOIN peleas p ON p.id = a.pelea WHERE p.estado = 'terminada' AND p.terminada_at >= ?${who}`)
      .all(now.getTime() - 2 * 86_400_000, ...args) as { pelea: string; user_id: string; cantidad: number; pago: number; terminada_at: number }[];
    const hoy = rows.filter((r) => dayKey(new Date(r.terminada_at), this.d.timeZone) === day);
    const enJuego = (this.d.db.prepare(`SELECT COALESCE(SUM(a.cantidad), 0) AS n FROM apuestas a JOIN peleas p ON p.id = a.pelea WHERE p.estado IN ('abierta', 'peleando')${who}`).get(...args) as { n: number }).n;
    return {
      peleas: new Set(hoy.map((r) => r.pelea)).size,
      ganado: hoy.reduce((a, r) => a + Math.max(0, r.pago - r.cantidad), 0),
      perdido: hoy.reduce((a, r) => a + Math.max(0, r.cantidad - r.pago), 0),
      enJuego,
      papus: new Set(hoy.map((r) => r.user_id)).size,
    };
  }

  papu(userId: string, now = new Date()): PapuDay {
    const day = this.day(now);
    const sent = this.d.db.prepare("SELECT n FROM mensajes_dia WHERE user_id = ? AND day = ?").get(userId, day) as { n: number } | undefined;
    const xp = this.d.db.prepare("SELECT xp, voz_total FROM xp_dia WHERE user_id = ? AND day = ?").get(userId, day) as { xp: number; voz_total: number } | undefined;
    const q = this.d.quota;
    const donated = q.donated(userId, now);
    const w = this.d.weddings;
    const t = now.getTime();
    const mine = w?.weddingOf(userId, t) ?? null;
    const blocked: PapuDay["blocked"] = [];
    if (w) {
      const taken = new Map(w.weddings(t).filter((x) => x.userId !== userId).map((x) => [x.bot, x]));
      for (const bot of Object.keys(w.settings.chicas) as BotId[]) {
        if (taken.has(bot)) blocked.push({ bot, why: "casada" });
        else if (w.repeats(userId, bot, t)) blocked.push({ bot, why: "repite" });
      }
    }
    return {
      messages: sent?.n ?? 0,
      xp: xp?.xp ?? 0,
      spent: q.used(userId, now) - donated,
      donated,
      left: q.remaining(userId, now),
      limit: q.limitFor(userId, now) + q.extra(userId, now),
      married: mine ? { bot: mine.bot, until: mine.endsAt } : null,
      blocked,
      voiceMin: xp?.voz_total ?? 0,
      trivia: this.triviaOf(userId, now),
      coins: this.coinsOf(userId),
      bets: (({ papus: _, ...b }) => b)(this.betsOf(now, userId)),
    };
  }

  server(now = new Date()): ServerDay {
    const day = this.day(now);
    const db = this.d.db;
    const quota = db.prepare("SELECT COALESCE(SUM(used - donadas), 0) AS spent, COALESCE(SUM(donadas), 0) AS donated FROM quota_usage WHERE day = ?").get(day) as { spent: number; donated: number };
    const msgs = db.prepare("SELECT COALESCE(SUM(CASE WHEN bot = 0 THEN n END), 0) AS papus, COALESCE(SUM(CASE WHEN bot = 1 THEN n END), 0) AS bots FROM mensajes_dia WHERE day = ?").get(day) as { papus: number; bots: number };
    let fullRoulette = 0;
    if (this.d.roulette) {
      const spins = missions(this.d.roulette.settings, { vozMin: 0, mensajes: 0, subio: false, castigo: false }).length;
      fullRoulette = (db.prepare("SELECT COUNT(*) AS n FROM (SELECT user_id FROM ruleta WHERE day = ? GROUP BY user_id HAVING COUNT(*) >= ?)").get(day, spins) as { n: number }).n;
    }
    const users = db.prepare("SELECT user_id FROM quota_usage WHERE day = ? AND used > 0").all(day) as { user_id: string }[];
    const noQuota = users.filter((u) => this.d.quota.remaining(u.user_id, now) <= 0).length;
    const voice = db.prepare("SELECT COALESCE(SUM(voz_total), 0) AS min, COUNT(CASE WHEN voz_total > 0 THEN 1 END) AS papus FROM xp_dia WHERE day = ?").get(day) as { min: number; papus: number };
    let trivia: ServerDay["trivia"] = null;
    if (this.d.trivia) {
      const r = db.prepare("SELECT COUNT(*) AS runs, COUNT(DISTINCT user_id) AS players FROM trivia_partidas WHERE day = ?").get(day) as { runs: number; players: number };
      const cost = (db.prepare("SELECT COALESCE(SUM(trivia_castigo), 0) AS c FROM xp_dia WHERE day = ?").get(day) as { c: number }).c;
      const best = db.prepare("SELECT user_id, racha FROM trivia_partidas WHERE day = ? AND racha > 0 ORDER BY racha DESC, at LIMIT 1").get(day) as { user_id: string; racha: number } | undefined;
      trivia = { runs: r.runs, players: r.players, cost, best: best ? { userId: best.user_id, streak: best.racha } : null };
    }
    const top = (db.prepare("SELECT user_id, xp FROM xp_dia WHERE day = ? AND xp > 0 ORDER BY xp DESC").all(day) as { user_id: string; xp: number }[]).find((r) => !this.d.owners.has(r.user_id));
    return {
      spent: quota.spent,
      donated: quota.donated,
      papuMessages: msgs.papus,
      botMessages: msgs.bots,
      fullRoulette,
      noQuota,
      topXp: top ? { userId: top.user_id, xp: top.xp } : null,
      voiceMinutes: voice.min,
      voicePapus: voice.papus,
      trivia,
      bets: this.betsOf(now, null),
      coins: this.d.coins
        ? {
            hoy: (db.prepare("SELECT COALESCE(SUM(ganadas), 0) AS n FROM monedas_dia WHERE day = ?").get(day) as { n: number }).n,
            ...(db.prepare("SELECT COALESCE(SUM(ganadas), 0) AS ganadas, COALESCE(SUM(compradas), 0) AS compradas, COALESCE(SUM(ecos), 0) AS ecos FROM monedero").get() as { ganadas: number; compradas: number; ecos: number }),
          }
        : null,
    };
  }
}

const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);

/** Lo que Mango le contesta a un Papu. `names` = nombre de cada Vocaloid. */
export function papuText(s: PapuDay, names: Partial<Record<BotId, string>>): string {
  const name = (b: BotId) => names[b] ?? b;
  const cuota = Number.isFinite(s.left)
    ? `💌 Cuota: gastaste **${s.spent}**${s.donated ? ` y donaste **${s.donated}**` : ""} · te ${s.left === 1 ? "queda **1**" : `quedan **${s.left}**`} de ${s.limit}`
    : `💌 Cuota: gastaste **${s.spent}** (sin límite)`;
  let bodas: string;
  if (s.married) bodas = `💍 Estás casado con **${name(s.married.bot)}** hasta <t:${Math.floor(s.married.until / 1000)}:t>: hasta entonces no te puedes casar con nadie más`;
  else if (!s.blocked.length) bodas = "💍 Te puedes casar con cualquier Vocaloid ahora mismo";
  else {
    const casadas = s.blocked.filter((b) => b.why === "casada").map((b) => name(b.bot));
    const repite = s.blocked.filter((b) => b.why === "repite").map((b) => name(b.bot));
    bodas = [
      "💍 No te puedes casar con:",
      casadas.length ? `${casadas.join(", ")} (ya se casaron con otro Papu)` : "",
      repite.length ? `${repite.join(", ")} (te casaste hace poco)` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "Ya ve, tus números de hoy:",
    `💬 Mensajes enviados: **${fmt(s.messages)}**`,
    `⭐ XP ganada: **${fmt(s.xp)}**`,
    `🎙️ En voz: **${minutes(s.voiceMin)}**`,
    cuota,
    ...(s.coins
      ? [`🪙 Shaula-coins: **${fmt(s.coins.ganadas)}** ganadas${s.coins.compradas ? ` · **${fmt(s.coins.compradas)}** compradas` : ""}${s.coins.ecos ? ` · **${fmt(s.coins.ecos)}** Ecos` : ""} · hoy ganaste **${fmt(s.coins.hoy)}** participando`]
      : []),
    ...betsLines(s.bets, "tu"),
    bodas,
    ...(s.trivia ? triviaLines(s.trivia) : []),
  ].join("\n");
}

/** Las apuestas del 1vs1 de hoy (nada si no apostó). */
function betsLines(b: BetsDay & { papus?: number }, quien: "tu" | "todos"): string[] {
  if (!b.peleas && !b.enJuego) return [];
  const neto = b.ganado - b.perdido;
  const parts = [
    quien === "tu" ? `⚔️ Apuestas hoy: **${b.peleas}** ${b.peleas === 1 ? "pelea" : "peleas"}` : `⚔️ Apuestas hoy: **${b.peleas}** ${b.peleas === 1 ? "pelea" : "peleas"} · ${b.papus} ${b.papus === 1 ? "Papu" : "Papus"}`,
    `ganado **+${fmt(b.ganado)}**`,
    `perdido **−${fmt(b.perdido)}**`,
    `${quien === "tu" ? "vas" : "los Papus van"} **${neto >= 0 ? "+" : "−"}${fmt(Math.abs(neto))}**`,
  ];
  if (b.enJuego) parts.push(`en juego: **${fmt(b.enJuego)}**`);
  return [parts.join(" · ")];
}

/** "45 min" o "2 h 5 min". */
function minutes(n: number): string {
  return n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ""}`;
}

function triviaLines(t: TriviaDay): string[] {
  const today = t.runs
    ? `🧠 Trivia hoy: **${t.runs}** ${t.runs === 1 ? "partida" : "partidas"} · **${fmt(t.correct)}** aciertos · +${fmt(t.xp)} XP${t.cost ? ` · −${fmt(t.cost)} XP por jugar de más` : ""}`
    : "🧠 Trivia hoy: no has jugado";
  const left = t.freeLeft === null
    ? t.withXpLeft > 0 ? `te ${t.withXpLeft === 1 ? "queda **1** partida" : `quedan **${t.withXpLeft}** partidas`} con XP` : "ya no te quedan partidas con XP: las que sigas jugando van por la racha"
    : t.freeLeft > 0 ? `te ${t.freeLeft === 1 ? "queda **1** partida gratis" : `quedan **${t.freeLeft}** partidas gratis`}${t.withXpLeft ? ` (${t.withXpLeft} con XP)` : ""}` : "ya no te quedan partidas gratis: las que sigas jugando te quitan XP";
  const levels = t.levels.map((l) => `${l.emoji} ${fmt(l.done)}/${fmt(l.total)}${l.prize ? " ✅" : ""}`).join(" · ");
  return [`${today} · ${left}`, `📚 Superadas: ${levels} · mejor racha: **${t.best}**`];
}

/** Lo que Mango le contesta a GyroP. */
export function serverText(s: ServerDay): string {
  return [
    "Totales de hoy, patrón (hora de Chile):",
    `💌 Cuotas gastadas: **${fmt(s.spent)}**${s.donated ? ` (+${fmt(s.donated)} donadas)` : ""}`,
    `💬 Mensajes de Papus: **${fmt(s.papuMessages)}** · de Vocaloids: **${fmt(s.botMessages)}**`,
    `🎰 Papus que ya giraron toda su ruleta: **${s.fullRoulette}**`,
    `🪫 Papus sin cuota: **${s.noQuota}**`,
    `🏆 Más XP hoy: ${s.topXp ? `<@${s.topXp.userId}> (**${fmt(s.topXp.xp)}** XP)` : "nadie todavía"}`,
    `🎙️ Minutos en voz: **${fmt(s.voiceMinutes)}** (${s.voicePapus} ${s.voicePapus === 1 ? "Papu" : "Papus"})`,
    ...betsLines(s.bets, "todos"),
    ...(s.coins
      ? [`🪙 Shaula-coins ganadas hoy participando: **${fmt(s.coins.hoy)}** · en los monederos: **${fmt(s.coins.ganadas)}** ganadas, **${fmt(s.coins.compradas)}** compradas y **${fmt(s.coins.ecos)}** Ecos`]
      : []),
    ...(s.trivia
      ? [`🧠 Trivia: **${fmt(s.trivia.runs)}** partidas de ${s.trivia.players} ${s.trivia.players === 1 ? "Papu" : "Papus"}${s.trivia.cost ? ` · −${fmt(s.trivia.cost)} XP cobrada por jugar de más` : ""}${s.trivia.best ? ` · mejor racha: <@${s.trivia.best.userId}> (${s.trivia.best.streak})` : ""}`]
      : []),
  ].join("\n");
}
