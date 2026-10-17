// Calendario de la semana en #calendario (decisión de GyroP, 17 oct. 2026; docs/PLAN.md): 3 videos por semana.
//   lunes     = ganador de la votación Ko-fi (Puerro y superiores) de la semana anterior
//   miércoles = de GyroP (un video de "1. Videos finales")
//   viernes   = en semana de honor, el ganador de los Papus de honor si es un video listo; si ganó una idea, sale el
//               viernes siguiente (y ese viernes va uno de GyroP); en las demás semanas, de GyroP.
// Solo títulos: nada del proceso. Lógica pura (sin Discord ni archivos) para poder probarla.

export type SlotKind = "kofi" | "honor" | "propio";

export interface Slot {
  /** Día "AAAA-MM-DD" (zona del calendario). */
  day: string;
  weekday: "lunes" | "miércoles" | "viernes";
  kind: SlotKind;
  /** Título (o las opciones de la votación si aún no hay ganador); null si todavía no se sabe. */
  title: string | null;
  /** Aviso mientras no está decidido ("se vota hasta el martes"). */
  pending?: string;
}

/** Votación Ko-fi para un lunes: ganador, o sus opciones mientras no se decide (null = no hay: va uno de GyroP). */
export type VoteOutcome = { title: string } | { options: string; note: string } | null;

export interface WeekInput {
  monday: string;
  /** Ganador Ko-fi para este lunes (null = no hubo votación: va uno de GyroP). */
  kofi: VoteOutcome;
  /** ¿Esta semana se vota en la Sala de honor? */
  honorWeek: boolean;
  /** Votación de honor de esta semana: abierta, o cerrada con su ganador (y si es un video listo o una idea). */
  honor: { state: "proxima" } | { state: "abierta" } | { state: "cerrada"; winner: string | null; ready: boolean } | null;
  /** Idea ganadora de la votación de honor anterior, para este viernes. */
  honorCarry: string | null;
  /** Título de GyroP asignado a ese día (siempre el mismo para el mismo día). */
  own: (day: string) => string | null;
}

const DAY = 86_400_000;

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

/** Lunes de la semana que se muestra: la actual de lunes a viernes; el sábado y el domingo, la que viene. */
export function weekToShow(today: string): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  if (dow === 6) return addDays(today, 2);
  if (dow === 0) return addDays(today, 1);
  return addDays(today, 1 - dow);
}

/** ¿El lunes `monday` abre votación de honor? (cada `everyDays` desde el lunes `first`). */
export function isHonorWeek(monday: string, first: string, everyDays: number): boolean {
  const diff = Math.round((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY);
  return diff >= 0 && diff % everyDays === 0;
}

export function planWeek(i: WeekInput): Slot[] {
  const mon = i.monday;
  const wed = addDays(mon, 2);
  const fri = addDays(mon, 4);
  const own = (day: string, weekday: Slot["weekday"]): Slot => ({ day, weekday, kind: "propio", title: i.own(day) });

  const monday: Slot =
    i.kofi && "title" in i.kofi
      ? { day: mon, weekday: "lunes", kind: "kofi", title: i.kofi.title }
      : i.kofi
        ? { day: mon, weekday: "lunes", kind: "kofi", title: i.kofi.options, pending: i.kofi.note }
        : own(mon, "lunes");

  // En orden de día: los videos de GyroP se asignan del más antiguo al más nuevo (lunes, miércoles, viernes).
  const wednesday = own(wed, "miércoles");
  let friday: Slot;
  if (i.honorWeek) {
    if (i.honor?.state === "proxima") friday = { day: fri, weekday: "viernes", kind: "honor", title: null, pending: "se vota del lunes al jueves" };
    else if (i.honor?.state === "abierta") friday = { day: fri, weekday: "viernes", kind: "honor", title: null, pending: "se vota hasta el jueves" };
    else if (i.honor?.state === "cerrada" && i.honor.winner && i.honor.ready) friday = { day: fri, weekday: "viernes", kind: "honor", title: i.honor.winner };
    else friday = own(fri, "viernes"); // ganó una idea (sale el viernes siguiente), empate o no hubo votación
  } else {
    friday = i.honorCarry ? { day: fri, weekday: "viernes", kind: "honor", title: i.honorCarry } : own(fri, "viernes");
  }
  return [monday, wednesday, friday];
}

/** "Video de Kafu" + "Video de Ruko" -> "Video de Kafu / Ruko" (las opciones de una votación, en corto). */
export function choices(names: string[]): string {
  const prefix = "Video de ";
  if (names.length > 1 && names.every((n) => n.startsWith(prefix))) return prefix + names.map((n) => n.slice(prefix.length)).join(" / ");
  return names.join(" / ");
}

/** Momento (ms) de "AAAA-MM-DD HH:MM" en la zona `timeZone`. */
export function zonedTime(day: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asZone = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return guess - (asZone - guess);
}

export const SLOT_LABEL: Record<SlotKind, string> = {
  kofi: "🗳️ Elegido por los Puerros",
  honor: "🏅 Elegido por los Papus de honor",
  propio: "🎬 Elegido por GyroP",
};
