// Limpieza de #bienvenida (decisión de GyroP, 22 oct. 2026): los saludos de Teto iban dejando muy arriba su guía fijada
// ("¿Por dónde empiezo?"). Al llegar el décimo Papu saludado (o uno siguiente), se borran los mensajes sin fijar, pero
// solo los que tienen más de 2 horas: cada Papu nuevo alcanza a leer su saludo y a ver dónde está la guía. Solo se
// borra; la guía y lo fijado no se tocan.

/** Papus saludados (sin contar los ya borrados) a partir de los cuales toca limpiar. */
export const WELCOME_LIMIT = 10;
/** Tiempo mínimo que se queda cada saludo. */
export const WELCOME_GRACE_MS = 2 * 3_600_000;

export interface WelcomeMessage {
  id: string;
  at: number;
  pinned: boolean;
  /** Papus que saluda este mensaje (los @ de un saludo grupal); 0 si no es un saludo. */
  papus: number;
}

export interface WelcomeCleanupPlan {
  /** Mensajes que se borran ahora. */
  remove: string[];
  /** Cuándo volver a revisar (ms), si hay saludos que todavía no cumplen las 2 horas. */
  nextAt: number | null;
}

/** Qué borrar de #bienvenida y cuándo volver a mirar. `messages` en cualquier orden. */
export function planWelcomeCleanup(messages: WelcomeMessage[], now: number, limit = WELCOME_LIMIT, graceMs = WELCOME_GRACE_MS): WelcomeCleanupPlan {
  const loose = messages.filter((m) => !m.pinned).sort((a, b) => a.at - b.at);
  let count = 0;
  const trigger = loose.find((m) => (count += m.papus) >= limit);
  if (!trigger) return { remove: [], nextAt: null };
  const due = trigger.at + graceMs;
  if (now < due) return { remove: [], nextAt: due };
  return { remove: loose.filter((m) => now - m.at >= graceMs).map((m) => m.id), nextAt: null };
}
