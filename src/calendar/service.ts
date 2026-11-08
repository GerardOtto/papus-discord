// Arma el calendario de 2 semanas (la actual y la próxima) para #calendario: ganadores de las votaciones (base D1 del
// worker), videos de GyroP de "1. Videos finales" y lo que ya se asignó (base local, para que no cambie solo).
// Solo títulos y fechas. Lo publica Miku desde el PC (src/discord/app.ts), fijado y editado cuando cambia algo.
import type { D1Query } from "../cloud/d1";
import { kvGet, kvSet, type Db } from "../db/database";
import type { Release } from "../levels/rules";
import { dayKey } from "../time";
import type { HonorSettings, RoundSettings } from "../votes/rounds";
import { addDays, choices, isHonorWeek, planWeek, SLOT_LABEL, weekdayOf, weekToShow, zonedTime, type Slot, type VoteOutcome, type WeekInput } from "./plan";

export interface CalendarSettings {
  canal: string;
  /** Hora de publicación "HH:MM" en `zona`. */
  hora: string;
  zona: string;
  semanas: number;
  /**
   * Videos fijados a mano por GyroP: día "AAAA-MM-DD" -> título (o título con hora propia). Mandan sobre todo lo automático.
   * Pueden ir en cualquier día de la semana: los que no son lunes, miércoles ni viernes se suman a esa semana.
   */
  fijos?: Record<string, string | FixedVideo>;
  /** Desde el lunes `desde`, los ganadores de las votaciones salen `semanas` semanas después de lo normal (se vota igual). */
  retraso?: { desde: string; semanas: number };
  /** Lunes de semanas que llevan solo los videos fijados (sin votaciones ni videos automáticos de GyroP). */
  soloFijos?: string[];
}

/** Video fijado con una hora distinta a la del calendario ("hora" en "zona"; sin "zona", la del calendario). */
export interface FixedVideo {
  titulo: string;
  hora?: string;
  zona?: string;
  /** XP de su estreno distinta a la de config/niveles.json (ej.: ×2 por 12 h). */
  estreno?: { multiplicador?: number; horas?: number };
}

const fixedEntries = (s: CalendarSettings): [string, FixedVideo][] =>
  Object.entries(s.fijos ?? {})
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => [k, typeof v === "string" ? { titulo: v } : v]);

export interface FinalVideo {
  title: string;
  /** Número de episodio (se programan del más antiguo al más nuevo). */
  order: number;
}

export interface CalendarDeps {
  db: Db;
  query: D1Query;
  /** Videos de "1. Videos finales" (titulo con sus signos, del calendario del motor si existe). */
  finales: () => FinalVideo[];
  rounds: Pick<RoundSettings, "primera" | "cadaDias" | "opciones" | "semilla">;
  honor: Pick<HonorSettings, "primera" | "cadaDias">;
  settings: CalendarSettings;
  now?: () => number;
}

export interface CalendarWeek {
  monday: string;
  /** Es la semana en curso (lunes a domingo de hoy). */
  current: boolean;
  slots: Slot[];
}

const DAY = 86_400_000;
const OWN_KEY = "calendario:propios";
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

interface RoundRow {
  opciones: string;
  estado: string;
  ganador: string | null;
  abierta_at: number;
}

export class CalendarService {
  constructor(private readonly d: CalendarDeps) {}

  async build(): Promise<CalendarWeek[]> {
    const { settings: s, rounds, honor } = this.d;
    const now = (this.d.now ?? Date.now)();
    const [kofiRounds, candidates, honorRounds, ready] = await Promise.all([
      this.d.query<RoundRow>("SELECT opciones, estado, ganador, abierta_at FROM rondas ORDER BY id DESC LIMIT 12"),
      this.d.query<{ nombre: string; estado: string }>("SELECT nombre, estado FROM candidatos WHERE estado IN ('sigue', 'espera') ORDER BY creado_at, id"),
      this.d.query<RoundRow>("SELECT opciones, estado, ganador, abierta_at FROM rondas_honor ORDER BY id DESC LIMIT 12"),
      this.d.query<{ nombre: string; estado: string }>("SELECT nombre, estado FROM listos WHERE estado != 'quitado'"),
    ]);
    const readyNames = new Set(ready.map((r) => norm(r.nombre)));
    const single = (g: string | null) => (g && !g.includes(" | ") ? g : null);
    const mondayMs = (m: string) => zonedTime(m, "00:00", s.zona);

    const kofiFor = (m: string): VoteOutcome => {
      const t = mondayMs(m);
      const r = kofiRounds.find((x) => x.abierta_at >= t - 11 * DAY && x.abierta_at < t - 4 * DAY);
      if (r) {
        const opts = choices(JSON.parse(r.opciones) as string[]);
        const winner = single(r.ganador);
        if (r.estado === "cerrada" && winner) return { title: winner };
        if (r.estado === "abierta") return { options: opts, note: "se vota hasta el martes" };
        return { options: opts, note: "empate: decide GyroP" };
      }
      // Ronda que todavía no abre (se abre el sábado anterior a ese lunes): sus candidatos probables.
      if (t - 9 * DAY < rounds.primera - DAY) return null;
      const open = kofiRounds.some((x) => x.estado === "abierta");
      const carried = candidates.filter((c) => c.estado === "sigue").map((c) => c.nombre);
      const waiting = candidates.filter((c) => c.estado === "espera").map((c) => c.nombre);
      const pool = waiting.length || carried.length || kofiRounds.length ? waiting : rounds.semilla;
      const fresh = pool.slice(0, Math.max(0, rounds.opciones - (open ? 1 : carried.length)));
      const names = [...fresh, ...(open ? [] : carried)];
      const options = names.length ? choices(names) + (open ? " / 2.º lugar de esta semana" : "") : "candidatos por definir";
      return { options, note: "se vota del sábado al martes" };
    };

    const honorFor = (m: string): Pick<WeekInput, "honorWeek" | "honor" | "honorCarry"> => {
      const t = mondayMs(m);
      const honorWeek = isHonorWeek(m, dayKey(new Date(honor.primera), s.zona), honor.cadaDias);
      const thisRound = honorRounds.find((x) => x.abierta_at >= t && x.abierta_at < t + 3 * DAY);
      let state: WeekInput["honor"] = null;
      if (honorWeek) {
        if (thisRound?.estado === "abierta") state = { state: "abierta" };
        else if (thisRound) {
          const winner = single(thisRound.ganador);
          state = { state: "cerrada", winner, ready: !!winner && readyNames.has(norm(winner)) };
        } else if (t + 18 * 3_600_000 > now) state = { state: "proxima" };
      }
      const prev = honorRounds.find((x) => x.abierta_at >= t - 7 * DAY && x.abierta_at < t - 4 * DAY);
      const prevWinner = prev?.estado === "cerrada" ? single(prev.ganador) : null;
      const honorCarry = prevWinner && !readyNames.has(norm(prevWinner)) ? prevWinner : null;
      return { honorWeek, honor: state, honorCarry };
    };

    // Videos de GyroP: cada día conserva el que se le asignó; los nuevos salen de los finales, del más antiguo.
    const own = JSON.parse(kvGet(this.d.db, OWN_KEY) ?? "{}") as Record<string, string>;
    // Los días fijados a mano sueltan el video que tenían asignado: vuelve a la fila para el próximo día libre.
    const fixed = Object.fromEntries(fixedEntries(s).map(([k, v]) => [k, v.titulo]));
    for (const day of Object.keys(fixed)) delete own[day];
    const taken = () => new Set([...Object.values(own), ...Object.values(fixed), ...ready.map((r) => r.nombre)].map(norm));
    const finales = [...this.d.finales()].sort((a, b) => a.order - b.order);
    const pickOwn = (day: string): string | null => {
      if (own[day]) return own[day]!;
      const used = taken();
      const next = finales.find((f) => !used.has(norm(f.title)));
      if (next) own[day] = next.title;
      return next?.title ?? null;
    };

    const weeks: CalendarWeek[] = [];
    const today = dayKey(new Date(now), s.zona);
    let monday = weekToShow(today);
    for (let w = 0; w < s.semanas; w++, monday = addDays(monday, 7)) {
      const sunday = addDays(monday, 6);
      let slots: Slot[];
      if (s.soloFijos?.includes(monday)) {
        slots = [];
        // Los videos de GyroP que tenían esos días vuelven a la fila.
        for (let d = monday; d <= sunday; d = addDays(d, 1)) if (!fixed[d]) delete own[d];
      } else {
        // Con retraso, cada lunes lleva lo que se votó para el de `semanas` semanas antes.
        const votes = s.retraso && monday >= s.retraso.desde ? addDays(monday, -7 * s.retraso.semanas) : monday;
        slots = planWeek({ monday, kofi: kofiFor(votes), ...honorFor(votes), own: (day) => fixed[day] ?? pickOwn(day) }).map((sl) =>
          fixed[sl.day] ? { day: sl.day, weekday: sl.weekday, kind: "propio" as const, title: fixed[sl.day]! } : sl,
        );
      }
      // Fijados en otros días (martes, jueves, fin de semana): se suman a la semana, en orden. En la primera semana
      // también los que faltan antes de su lunes (ej.: el domingo de mañana, si hoy es sábado).
      const from = w === 0 && today < monday ? today : monday;
      for (const [day, title] of Object.entries(fixed))
        if (day >= from && day <= sunday && !slots.some((sl) => sl.day === day)) slots.push({ day, weekday: weekdayOf(day), kind: "propio", title });
      slots.sort((a, b) => a.day.localeCompare(b.day));
      // Un día que dejó de ser de GyroP (ej.: llegó la idea ganadora de honor) libera su video para otro día.
      for (const sl of slots) if (sl.kind !== "propio") delete own[sl.day];
      weeks.push({ monday, current: monday <= today, slots });
    }
    kvSet(this.d.db, OWN_KEY, JSON.stringify(own));
    return weeks;
  }

  /**
   * Videos con titulo y su hora de salida (ms): los estrenos que dan XP multiplicada (src/levels/). Los fijados del día
   * anterior y de hoy entran aunque su semana ya no se muestre (el sábado se muestra la que viene).
   */
  releases(weeks: CalendarWeek[]): Release[] {
    const { zona, hora } = this.d.settings;
    const fixed = Object.fromEntries(fixedEntries(this.d.settings));
    const release = (day: string, title: string, f?: FixedVideo): Release => ({
      title,
      at: zonedTime(day, f?.hora ?? hora, f?.zona ?? zona),
      ...(f?.estreno?.multiplicador ? { multiplicador: f.estreno.multiplicador } : {}),
      ...(f?.estreno?.horas ? { horas: f.estreno.horas } : {}),
    });
    const shown = weeks.flatMap((w) =>
      w.slots.filter((sl) => sl.title && !sl.pending).map((sl) => ({ day: sl.day, r: release(sl.day, sl.title!, sl.kind === "propio" ? fixed[sl.day] : undefined) })),
    );
    const today = dayKey(new Date((this.d.now ?? Date.now)()), zona);
    const recent = Object.entries(fixed)
      .filter(([day]) => day >= addDays(today, -1) && day <= today && !shown.some((x) => x.day === day))
      .map(([day, f]) => ({ day, r: release(day, f.titulo, f) }));
    return [...recent, ...shown].map((x) => x.r);
  }

  /** Estrenos anunciados con /estreno (worker) en el último día: su XP multiplicada empieza al anunciarlos. */
  async launched(): Promise<{ title: string; at: number }[]> {
    const since = (this.d.now ?? Date.now)() - DAY;
    const rows = await this.d.query<{ titulo: string; at: number }>("SELECT titulo, at FROM estrenos WHERE at > ? ORDER BY at", since);
    return rows.map((r) => ({ title: r.titulo, at: r.at }));
  }

  /** Texto del calendario (va dentro de la frase de Miku). */
  render(weeks: CalendarWeek[]): string {
    const { zona, hora } = this.d.settings;
    const fixed = Object.fromEntries(fixedEntries(this.d.settings));
    const fmt = (day: string, o: Intl.DateTimeFormatOptions) => new Date(zonedTime(day, "12:00", zona)).toLocaleDateString("es-MX", { timeZone: zona, ...o });
    return weeks
      .map((w, i) => {
        const last = w.slots.at(-1)?.day ?? addDays(w.monday, 4);
        const first = w.slots.reduce((d, sl) => (sl.day < d ? sl.day : d), w.monday);
        const range = `${fmt(first, { day: "numeric" })} al ${fmt(last, { day: "numeric", month: "long" })}`;
        const lines = w.slots.map((sl) => {
          const f = sl.kind === "propio" ? fixed[sl.day] : undefined;
          const when = `<t:${Math.floor(zonedTime(sl.day, f?.hora ?? hora, f?.zona ?? zona) / 1000)}:t>`;
          const day = fmt(sl.day, { weekday: "long", day: "numeric" });
          const title = sl.title ?? "Por votar";
          const note = sl.pending ? ` · ${sl.pending}` : "";
          return `> **${day[0]!.toUpperCase()}${day.slice(1)}** · ${when}\n> ${sl.pending ? title : `**${title}**`}\n> ${SLOT_LABEL[sl.kind]}${note}`;
        });
        const label = w.current ? "📅 Esta semana" : i === 0 || weeks[0]!.current ? "🔜 La próxima semana" : "🗓️ En dos semanas";
        return `**${label}** (${range})\n${lines.join("\n\n")}`;
      })
      .join("\n\n");
  }
}
