// Rol Fundador (config/servidor.json): quien tenga un nivel de Ko-fi durante la primera semana se lo queda para
// siempre. Teto lo da al ver llegar el rol del nivel (Ko-fi lo asigna) y, al volver de estar apagada, revisa a todos:
// si estuvo apagada cuando terminaba la semana, aun alcanzan los que compraron mientras tanto.
import { nameKey } from "../setup/layout";

export interface FounderSettings {
  /** Nombre del rol de insignia. */
  role: string;
  /** Hasta cuando se entrega (ms). */
  until: number;
  /** Roles de los niveles de Ko-fi. */
  tiers: string[];
}

interface LayoutRoles {
  niveles: { rol: string }[];
  rolesExtra: { rol: string; hasta?: string }[];
}

export function founderSettings(layout: LayoutRoles): FounderSettings | null {
  const f = layout.rolesExtra.find((r) => nameKey(r.rol) === "fundador");
  if (!f?.hasta) return null;
  const until = Date.parse(f.hasta);
  if (Number.isNaN(until)) throw new Error(`Fecha inválida en config/servidor.json (Fundador.hasta): ${f.hasta}`);
  return { role: f.rol, until, tiers: layout.niveles.map((n) => n.rol) };
}

/**
 * ¿Se pueden dar insignias ahora? Durante la semana, si. Despues, solo en la revision al volver cuando los bots se
 * apagaron antes del cierre (`lastSeen`): pudo haber compras en ese rato que no alcanzaron a ver.
 */
export function founderWindowOpen(s: FounderSettings, now: number, lastSeen: number | null = null): boolean {
  return now < s.until || (lastSeen !== null && lastSeen < s.until);
}

/** ¿A este miembro le falta la insignia? (tiene algun nivel y no el rol Fundador). */
export function needsFounder(s: FounderSettings, roleNames: string[]): boolean {
  const keys = new Set(roleNames.map(nameKey));
  return !keys.has(nameKey(s.role)) && s.tiers.some((t) => keys.has(nameKey(t)));
}
