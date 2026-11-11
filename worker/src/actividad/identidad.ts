// Quien es el Papu que abre una Actividad (trivia multijugador, mundo de los Papus): su token de Discord (OAuth de la
// Actividad) y su ficha en el servidor. Con ACTIVIDAD_PRUEBA=1 (solo `wrangler dev`) acepta Papus de prueba sin Discord.
import { avatarUrl } from "./perfil";

const DISCORD = "https://discord.com/api/v10";

export interface Identidad {
  id: string;
  nombre: string;
  avatar: string;
}

export interface Saludo {
  token?: string;
  prueba?: { id: string; nombre: string };
}

/** La identidad del Papu, `{ motivo }` si no es del servidor, o null si Discord no lo reconoce. */
export async function identificar(m: Saludo, env: { GUILD_ID: string; ACTIVIDAD_PRUEBA?: string }, fueraDelServidor: string): Promise<Identidad | { motivo: string } | null> {
  if (env.ACTIVIDAD_PRUEBA === "1" && m.prueba && /^prueba-\w{1,20}$/.test(m.prueba.id)) {
    return { id: m.prueba.id, nombre: String(m.prueba.nombre).slice(0, 32) || m.prueba.id, avatar: `api/avatar/default/${m.prueba.id.length % 6}` };
  }
  if (!m.token || m.token.length > 200) return null;
  const auth = { Authorization: `Bearer ${m.token}` };
  const user = await fetch(`${DISCORD}/users/@me`, { headers: auth }).then((r) => (r.ok ? (r.json() as Promise<{ id: string; username: string; global_name?: string | null; avatar?: string | null }>) : null));
  if (!user) return null;
  const member = await fetch(`${DISCORD}/users/@me/guilds/${env.GUILD_ID}/member`, { headers: auth }).then((r) => (r.ok ? (r.json() as Promise<{ nick?: string | null; avatar?: string | null }>) : null));
  if (!member) return { motivo: fueraDelServidor };
  return { id: user.id, nombre: member.nick ?? user.global_name ?? user.username, avatar: avatarUrl(user.id, member, user) };
}
