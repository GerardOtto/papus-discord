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
  /** Los bots de musica externos ven y escriben aqui (en los demas canales de texto no entran). */
  musica?: boolean;
  /** Canal de voz (sin tema ni modo lento); los bots de musica pueden entrar. */
  voz?: boolean;
  /** Canal de tickets (#reportes-y-reclamos): los Papus no escriben en el canal, solo en su hilo privado (/reporte). */
  tickets?: boolean;
}

export interface CategorySpec {
  nombre: string;
  antes?: string[];
  /** "todos", "staff", el nombre del nivel minimo, o "rol:<nombre>" (solo ese rol de rolesExtra, ej. Papu de honor). */
  leen: string;
  canales: ChannelSpec[];
}

export interface ServerLayout {
  niveles: { rol: string; color: string }[];
  /**
   * `todos` = Teto se lo da a cada Papu al entrar; `hasta` = fecha limite de una insignia (Fundador);
   * `sobreNiveles` = rol de una sola persona (config/especiales.json) por encima de los niveles: su color manda, salvo
   * que elija uno de #tu-color, y entonces Teto le pone ese color al rol (npm run servidor no se lo devuelve).
   * `bots` = rol de las 4 chicas con tareas (Vocaloids); `botsCharla` = rol de los Vocaloids que solo conversan (Coro),
   * el último rol separado de la lista de miembros.
   * `mod` = Papus elegidos por GyroP que pueden dar strikes y avisos con Neru (/strike, /advertir, /strikes y el clic
   * derecho), sin permisos propios de Discord: el silencio lo aplica siempre Neru.
   */
  rolesExtra: {
    rol: string;
    color: string;
    separado: boolean;
    bots?: boolean;
    botsCharla?: boolean;
    todos?: boolean;
    hasta?: string;
    musica?: string[];
    sobreNiveles?: boolean;
    mod?: boolean;
  }[];
  /** Color del nombre de cada bot: un rol de la paleta (texto) o uno solo suyo, fuera del menu ({rol, color}). */
  coloresBots?: Record<string, string | { rol: string; color: string }>;
  /** Colores que cada Papu elige en un canal (menu de Miku, worker). */
  coloresPapu?: { canal: string; colores: { rol: string; color: string }[] };
  /** Paises que cada Papu elige en el mismo canal (rol "🇲🇽 México": sin color ni permisos, al fondo de la lista de roles). */
  paisesPapu?: { canal: string; paises: string[] };
  seguridad: { verificacion: number; filtroContenido: number };
  categorias: CategorySpec[];
  /** Las categorias hechas a mano (no estan en el archivo, p. ej. "Canales de voz") van justo despues de esta. */
  categoriasManualesDespuesDe?: string;
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
  MANAGE_THREADS: 1n << 34n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  SEND_POLLS: 1n << 49n,
  PIN_MESSAGES: 1n << 51n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
} as const;

/** Lo que se le quita a los Papus en un canal de solo lectura (siguen pudiendo reaccionar, votar y usar comandos). */
export const WRITE_BITS =
  PERM.SEND_MESSAGES | PERM.CREATE_PUBLIC_THREADS | PERM.CREATE_PRIVATE_THREADS | PERM.SEND_MESSAGES_IN_THREADS | PERM.SEND_POLLS;
const READ_BITS = PERM.VIEW_CHANNEL | PERM.READ_MESSAGE_HISTORY;
/** Las 4 chicas (rol Vocaloids) ven y escriben en todos los canales (regla 2), con encuestas para Miku y fijar sus mensajes de guia. */
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
/** Los Vocaloids de conversacion (rol Coro) tambien ven y escriben en todos los canales (regla 2), sin encuestas, fijar ni comandos. */
export const CHAT_BOT_BITS =
  READ_BITS | PERM.SEND_MESSAGES | PERM.SEND_MESSAGES_IN_THREADS | PERM.EMBED_LINKS | PERM.ATTACH_FILES | PERM.ADD_REACTIONS;

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
  /** Rol Vocaloids (las 4 chicas con tareas). */
  bots: string;
  /** Rol de los Vocaloids que solo conversan (Coro). */
  chatBots?: string;
  /** Rol de los bots de musica externos: no ven los canales de texto (solo voz). */
  music?: string;
  /** Roles especiales para "rol:<nombre>" (clave nameKey -> id). */
  extra?: Record<string, string>;
}

export interface ChannelOptions {
  ocultarDesde?: string;
  musica?: boolean;
  voz?: boolean;
  tickets?: boolean;
}

/** Permisos de un canal segun quien lo lee y si los Papus escriben. */
export function overwritesFor(leen: string, escriben: boolean, roles: RoleIds, opts: ChannelOptions = {}): Overwrite[] {
  const { ocultarDesde, musica = false, voz = false, tickets = false } = opts;
  const out: Overwrite[] = [];
  const everyone: Overwrite = { id: roles.everyone, allow: 0n, deny: 0n };
  out.push(everyone);
  if (!escriben) everyone.deny |= WRITE_BITS;
  // Tickets: nadie escribe en el canal ni abre hilos; dentro de su hilo privado (lo crea Neru con /reporte) sí.
  if (tickets) everyone.deny |= WRITE_BITS & ~PERM.SEND_MESSAGES_IN_THREADS;
  if (ocultarDesde) {
    const idx = roles.tiers.findIndex((t) => nameKey(t.name) === nameKey(ocultarDesde));
    if (idx < 0) throw new Error(`Nivel desconocido en config/servidor.json (ocultarDesde): ${ocultarDesde}`);
    // Quien ya tiene ese nivel (o uno superior) ve los canales de verdad: el candado desaparece.
    for (const t of roles.tiers.slice(idx)) out.push({ id: t.id, allow: 0n, deny: PERM.VIEW_CHANNEL });
  }

  if (leen.startsWith("rol:")) {
    everyone.deny |= PERM.VIEW_CHANNEL;
    const name = leen.slice(4).trim();
    const id = roles.extra?.[nameKey(name)];
    if (!id) throw new Error(`Rol desconocido en config/servidor.json (leen): ${name}`);
    out.push({ id, allow: READ_BITS, deny: 0n });
  } else if (leen !== "todos") {
    everyone.deny |= PERM.VIEW_CHANNEL;
    if (leen !== "staff") {
      const idx = roles.tiers.findIndex((t) => nameKey(t.name) === nameKey(leen));
      if (idx < 0) throw new Error(`Nivel desconocido en config/servidor.json: ${leen}`);
      // Ese nivel y todos los superiores (acumulativos).
      for (const t of roles.tiers.slice(idx)) out.push({ id: t.id, allow: READ_BITS, deny: 0n });
    }
  }
  out.push({ id: roles.bots, allow: tickets ? BOT_BITS | PERM.CREATE_PRIVATE_THREADS | PERM.MANAGE_THREADS : BOT_BITS, deny: 0n });
  if (roles.chatBots) out.push({ id: roles.chatBots, allow: CHAT_BOT_BITS, deny: 0n });
  if (roles.music) {
    out.push(
      voz
        ? { id: roles.music, allow: PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.SPEAK, deny: 0n }
        : musica
        ? { id: roles.music, allow: READ_BITS | PERM.SEND_MESSAGES | PERM.EMBED_LINKS | PERM.ATTACH_FILES | PERM.ADD_REACTIONS, deny: 0n }
        : { id: roles.music, allow: 0n, deny: PERM.VIEW_CHANNEL },
    );
  }
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

/**
 * Orden de roles con `block` (ids, de arriba abajo) justo debajo de `anchor`; el resto conserva su orden relativo.
 * Solo se reordenan los roles por debajo de `ceiling` (el rol más alto del bot que mueve; los de arriba no se tocan).
 * Devuelve solo los cambios. Así las insignias (Papu de honor, Fundador, Papu) quedan juntas debajo de los niveles.
 */
export function blockBelow(
  roles: { id: string; position: number }[],
  anchor: string,
  block: string[],
  ceiling: number,
): { id: string; position: number }[] {
  const movable = roles.filter((r) => r.position > 0 && r.position < ceiling).sort((a, b) => b.position - a.position);
  const inBlock = new Set(block);
  const order: string[] = [];
  for (const r of movable) {
    if (inBlock.has(r.id)) continue;
    order.push(r.id);
    if (r.id === anchor) order.push(...block.filter((id) => movable.some((m) => m.id === id)));
  }
  return positionsFor(roles, order, ceiling);
}

/** Orden de roles con `block` (ids, de arriba abajo) al fondo de la lista, justo sobre @everyone (los paises). */
export function blockAtBottom(roles: { id: string; position: number }[], block: string[], ceiling: number): { id: string; position: number }[] {
  return blockAt(roles, block, ceiling, "bottom");
}

/**
 * Orden de roles con `block` (ids, de arriba abajo) arriba de todos los que se pueden mover, justo debajo de `ceiling`.
 * Discord muestra el color del rol más alto: así el color de #tu-color se ve sobre niveles e insignias.
 */
/** Rol de color de cada bot (`coloresBots`) y los roles que son solo de bots (no estan en la paleta de #tu-color). */
export function botColorRoles(layout: ServerLayout): { byBot: Map<string, string>; botOnly: { rol: string; color: string }[] } {
  const byBot = new Map<string, string>();
  const botOnly = new Map<string, { rol: string; color: string }>();
  for (const [bot, v] of Object.entries(layout.coloresBots ?? {})) {
    if (bot.startsWith("$")) continue;
    if (typeof v === "string") byBot.set(bot, v);
    else {
      byBot.set(bot, v.rol);
      botOnly.set(nameKey(v.rol), v);
    }
  }
  return { byBot, botOnly: [...botOnly.values()] };
}

export function blockAtTop(roles: { id: string; position: number }[], block: string[], ceiling: number): { id: string; position: number }[] {
  return blockAt(roles, block, ceiling, "top");
}

function blockAt(roles: { id: string; position: number }[], block: string[], ceiling: number, where: "top" | "bottom"): { id: string; position: number }[] {
  const movable = roles.filter((r) => r.position > 0 && r.position < ceiling).sort((a, b) => b.position - a.position);
  const inBlock = new Set(block);
  const rest = movable.filter((r) => !inBlock.has(r.id)).map((r) => r.id);
  const own = block.filter((id) => movable.some((m) => m.id === id));
  const order = where === "top" ? [...own, ...rest] : [...rest, ...own];
  return positionsFor(roles, order, ceiling);
}

/**
 * Posiciones (de arriba abajo) para `order`, desde justo debajo de `ceiling`: Discord no deja poner un rol a la altura
 * del bot o más arriba. Discord a veces deja varios roles en la misma posición (los recién creados quedan todos en 1);
 * si no caben, los últimos comparten la 1. Devuelve solo los cambios.
 */
function positionsFor(roles: { id: string; position: number }[], order: string[], ceiling: number): { id: string; position: number }[] {
  const now = new Map(roles.map((r) => [r.id, r.position]));
  return order.map((id, i) => ({ id, position: Math.max(1, ceiling - 1 - i) })).filter((r) => now.get(r.id) !== r.position);
}
