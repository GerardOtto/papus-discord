// Funciones puras de la sala de la trivia multijugador (XP que se muestra y avatares), sin tipos de Cloudflare.
import type { Pool } from "./tipos";

/** XP base por acierto y tope del dia que le queda al Papu (los calcula Teto, src/trivia/actividad.ts). */
export interface Perfil {
  base: number;
  tope: number;
  at: number;
}

/** XP de un acierto como la calcula Teto (answerXp: base del Papu por el bono de racha), recortada a su tope del dia. */
export function xpDeAcierto(p: Perfil, racha: number, r: Pool["racha"]): number {
  const factor = 1 + r.bono * Math.min(Math.max(0, racha - 1), r.tope);
  return Math.max(0, Math.min(Math.round(p.base * factor), p.tope));
}

/** Avatar del Papu servido por el worker (dentro de Discord la pagina solo puede pedir a su propio dominio). */
export function avatarUrl(userId: string, member: { avatar?: string | null } | null, user: { avatar?: string | null }): string {
  if (member?.avatar) return `api/avatar/${userId}/${member.avatar}?g=1`;
  if (user.avatar) return `api/avatar/${userId}/${user.avatar}`;
  return `api/avatar/default/${Number((BigInt(userId) >> 22n) % 6n)}`;
}
