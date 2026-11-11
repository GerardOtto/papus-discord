// Avisos de #tus-roles (config/servidor.json -> avisosPapu): cada Papu elige de que quiere que lo etiqueten (peleas,
// bodas, estrenos) y el bot etiqueta ese rol al empezar el evento. Los roles no se pueden mencionar: solo los bots con el
// rol Vocaloids (pueden mencionar a todos); si el que publica no puede, el aviso lo da Neru.
import { PermissionFlagsBits, type Guild, type GuildBasedChannel } from "discord.js";
import { colorKey } from "../setup/color-menu";
import { loadLayout, type AvisoId, type AvisoSpec } from "../setup/layout";

let cached: AvisoSpec[] | null = null;
function avisos(): AvisoSpec[] {
  cached ??= loadLayout().avisosPapu?.avisos ?? [];
  return cached;
}

/** Id del rol del aviso en el servidor (se busca sin emojis ni acentos), o null si no existe todavia. */
export function findAvisoRole(roles: { id: string; name: string; managed?: boolean }[], list: AvisoSpec[], id: AvisoId): string | null {
  const spec = list.find((a) => a.id === id);
  if (!spec) return null;
  const key = colorKey(spec.rol);
  return roles.find((r) => !r.managed && colorKey(r.name) === key)?.id ?? null;
}

export interface AvisoPing {
  /** "<@&id>" para poner en el mensaje. */
  mention: string;
  roleId: string;
}

/** Mencion del rol del aviso `id` (null si no hay avisos o el rol no existe: entonces el evento sale sin etiquetar). */
export function avisoPing(guild: Guild, id: AvisoId): AvisoPing | null {
  const roleId = findAvisoRole([...guild.roles.cache.values()].map((r) => ({ id: r.id, name: r.name, managed: r.managed })), avisos(), id);
  return roleId ? { mention: `<@&${roleId}>`, roleId } : null;
}

/** ¿Puede el bot `userId` etiquetar un rol que no se puede mencionar en `channel`? (permiso Mencionar a todos). */
export function canPingRoles(channel: GuildBasedChannel, userId: string): boolean {
  return !!channel.permissionsFor(userId)?.has(PermissionFlagsBits.MentionEveryone);
}
