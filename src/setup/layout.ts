// Estructura del servidor (config/servidor.json): calculo de permisos por canal, sin hablar con Discord.
// Niveles acumulativos: un canal de "Atún" lo ven Atún y todos los niveles superiores (Ko-fi da solo el rol del nivel).
import { readFileSync } from "node:fs";
import path from "node:path";

export interface ChannelSpec {
  nombre: string;
  antes?: string[];
  escriben: boolean;
  tema?: string;
  /** Modo lento en segundos (respaldo anti-flood, PLAN §7). */
  lento?: number;
  /** Canal "candado": lo ven todos MENOS quien tiene este nivel o uno superior (le muestra a quien no paga lo que hay detrás). */
  ocultarDesde?: string;
}

export interface CategorySpec {
  nombre: string;
  antes?: string[];
  /** "todos", "staff" o el nombre del nivel minimo. */
  leen: string;
  canales: ChannelSpec[];
}

export interface ServerLayout {
  niveles: { rol: string; color: string }[];
  /** `todos` = Teto se lo da a cada Papu al entrar; `hasta` = fecha limite de una insignia (Fundador). */
  rolesExtra: { rol: string; color: string; separado: boolean; bots?: boolean; todos?: boolean; hasta?: string; musica?: string[] }[];
  /** Colores que cada Papu elige en un canal (menu de Miku, worker). */
  coloresPapu?: { canal: string; colores: { rol: string; color: string }[] };
  seguridad: { verificacion: number; filtroContenido: number };
  categorias: CategorySpec[];
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadLayout(file = path.join(REPO_ROOT, "config/servidor.json")): ServerLayout {
  return JSON.parse(readFileSync(file, "utf8")) as ServerLayout;
}

/** Bits de permisos de Discord usados aqui. */
export const PERM = {
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  SEND_POLLS: 1n << 49n,
  PIN_MESSAGES: 1n << 51n,
} as const;

/** Lo que se le quita a los Papus en un canal de solo lectura (siguen pudiendo reaccionar, votar y usar comandos). */
export const WRITE_BITS =
  PERM.SEND_MESSAGES | PERM.CREATE_PUBLIC_THREADS | PERM.CREATE_PRIVATE_THREADS | PERM.SEND_MESSAGES_IN_THREADS | PERM.SEND_POLLS;
const READ_BITS = PERM.VIEW_CHANNEL | PERM.READ_MESSAGE_HISTORY;
/** Los 4 bots ven y escriben en todos los canales (regla 2), con encuestas para Miku y fijar sus mensajes de guia. */
export const BOT_BITS =
  READ_BITS |
  PERM.SEND_MESSAGES |
  PERM.SEND_MESSAGES_IN_THREADS |
  PERM.EMBED_LINKS |
  PERM.ATTACH_FILES |
  PERM.ADD_REACTIONS |
  PERM.SEND_POLLS |
  PERM.USE_APPLICATION_COMMANDS |
  PERM.PIN_MESSAGES;

export interface Overwrite {
  /** Id del rol (o del servidor, para @everyone). */
  id: string;
  allow: bigint;
  deny: bigint;
}

export interface RoleIds {
  everyone: string;
  /** Niveles en orden de menor a mayor. */
  tiers: { name: string; id: string }[];
  bots: string;
  /** Rol de los bots de musica externos: no ven los canales de texto (solo voz). */
  music?: string;
}

/** Permisos de un canal segun quien lo lee y si los Papus escriben. */
export function overwritesFor(leen: string, escriben: boolean, roles: RoleIds, ocultarDesde?: string): Overwrite[] {
  const out: Overwrite[] = [];
  const everyone: Overwrite = { id: roles.everyone, allow: 0n, deny: 0n };
  out.push(everyone);
  if (!escriben) everyone.deny |= WRITE_BITS;
  if (ocultarDesde) {
    const idx = roles.tiers.findIndex((t) => t.name === ocultarDesde);
    if (idx < 0) throw new Error(`Nivel desconocido en config/servidor.json (ocultarDesde): ${ocultarDesde}`);
    // Quien ya tiene ese nivel (o uno superior) ve los canales de verdad: el candado desaparece.
    for (const t of roles.tiers.slice(idx)) out.push({ id: t.id, allow: 0n, deny: PERM.VIEW_CHANNEL });
  }

  if (leen !== "todos") {
    everyone.deny |= PERM.VIEW_CHANNEL;
    if (leen !== "staff") {
      const idx = roles.tiers.findIndex((t) => t.name === leen);
      if (idx < 0) throw new Error(`Nivel desconocido en config/servidor.json: ${leen}`);
      // Ese nivel y todos los superiores (acumulativos).
      for (const t of roles.tiers.slice(idx)) out.push({ id: t.id, allow: READ_BITS, deny: 0n });
    }
  }
  out.push({ id: roles.bots, allow: BOT_BITS, deny: 0n });
  if (roles.music) out.push({ id: roles.music, allow: 0n, deny: PERM.VIEW_CHANNEL });
  return out.filter((o) => o.allow || o.deny);
}

export function sameOverwrites(a: Overwrite[], b: Overwrite[]): boolean {
  const key = (l: Overwrite[]) =>
    l
      .filter((o) => o.allow || o.deny)
      .map((o) => `${o.id}:${o.allow}:${o.deny}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}

/** Clave para comparar nombres: sin acentos, emojis, mayusculas ni signos ("📢 Inicio" = "inicio"). */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
