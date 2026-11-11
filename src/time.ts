// Fechas en la zona horaria de la cuota (medianoche de Chile por defecto).

/** Dia calendario "AAAA-MM-DD" de `date` en la zona `timeZone`. */
export function dayKey(date: Date, timeZone: string): string {
  // en-CA formatea como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Momento (ms) del proximo cambio de dia en `timeZone` despues de `date`. */
export function nextDayStart(date: Date, timeZone: string): number {
  const today = dayKey(date, timeZone);
  // Avanza por horas hasta que cambie el dia y luego afina por minutos (soporta cambios de horario).
  let t = date.getTime();
  while (dayKey(new Date(t), timeZone) === today) t += 3_600_000;
  t -= 3_600_000;
  while (dayKey(new Date(t), timeZone) === today) t += 60_000;
  return t - (t % 60_000);
}
