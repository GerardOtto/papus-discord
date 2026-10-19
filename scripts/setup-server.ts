// Aplica config/servidor.json al servidor: roles de los niveles, rol Vocaloids para los bots, categorias, canales,
// permisos, temas, modo lento, orden y seguridad. Nunca borra nada (lo que no esta en la config queda intacto).
//   npm run servidor             -> solo muestra lo que haria
//   npm run servidor -- --apply  -> lo ejecuta (usa la app de Teto: necesita "Administrador" mientras corre)
import { ChannelType, REST, Routes } from "discord.js";
import { loadConfig, loadDotEnv } from "../src/config";
import { blockBelow, nameKey, overwritesFor, sameOverwrites, type CategorySpec, type ChannelSpec, type Overwrite, type RoleIds } from "../src/setup/layout";
import { loadLayout } from "../src/setup/layout";

loadDotEnv();
const config = loadConfig();
const layout = loadLayout();
const APPLY = process.argv.includes("--apply");
const rest = new REST().setToken(config.tokens.teto);
const G = config.guildId;

interface ApiRole { id: string; name: string; color: number; hoist: boolean; position: number; managed: boolean; permissions: string; tags?: { bot_id?: string } }
interface ApiOverwrite { id: string; type: number; allow: string; deny: string }
interface ApiChannel { id: string; name: string; type: number; parent_id: string | null; position: number; topic?: string | null; rate_limit_per_user?: number; permission_overwrites: ApiOverwrite[] }

const hex = (c: string) => parseInt(c.replace("#", ""), 16);
const ADMIN = 1n << 3n;
/** Kick, ban, admin, gestionar canales/servidor/mensajes/apodos/roles/webhooks/expresiones/eventos/hilos, mencionar a todos, moderar. */
// 43 = crear expresiones (emojis y stickers) y 44 = crear eventos: Discord los da a todos por defecto; solo GyroP.
const MENTION_EVERYONE = 1n << 17n;
const DANGEROUS = [1, 2, 3, 4, 5, 13, 17, 27, 28, 29, 30, 33, 34, 40, 43, 44].reduce((a, b) => a | (1n << BigInt(b)), 0n);
const ops: string[] = [];
const log = (s: string) => (ops.push(s), console.log(`${APPLY ? "✔" : "•"} ${s}`));

async function api<T>(fn: () => Promise<unknown>): Promise<T> {
  return (await fn()) as T;
}

// ── Comprobacion de permisos ──────────────────────────────────────────────────────────────
const tetoUser = await api<{ id: string }>(() => rest.get(Routes.user()));
let roles = await api<ApiRole[]>(() => rest.get(Routes.guildRoles(G)));
const tetoMember = await api<{ roles: string[] }>(() => rest.get(Routes.guildMember(G, tetoUser.id)));
const tetoPerms = roles.filter((r) => r.id === G || tetoMember.roles.includes(r.id)).reduce((a, r) => a | BigInt(r.permissions), 0n);
if (!(tetoPerms & ADMIN)) {
  console.log("⚠️  Teto no tiene el permiso Administrador: se muestra el plan, pero para aplicarlo hay que dárselo un momento.");
  if (APPLY) process.exit(1);
}

// ── Roles ────────────────────────────────────────────────────────────────────────────────
// Sin roles de bots: el rol propio de cada bot se llama como el personaje ("Neru", "IA") y no debe confundirse con su color.
const byName = (n: string) => roles.find((r) => !r.managed && nameKey(r.name) === nameKey(n));
const wantRoles = [
  ...layout.niveles.map((n) => ({ rol: n.rol, color: n.color, separado: true })),
  ...layout.rolesExtra.map((r) => ({ rol: r.rol, color: r.color, separado: r.separado, colorVariable: !!r.sobreNiveles })),
  ...(layout.coloresPapu?.colores ?? []).map((c) => ({ rol: c.rol, color: c.color, separado: false })),
];
for (const w of wantRoles) {
  const r = byName(w.rol);
  if (!r) {
    log(`crear rol "${w.rol}" (${w.color}${w.separado ? ", separado en la lista" : ""})`);
    // Sin permisos propios: el acceso a los canales va por los permisos de cada canal.
    if (APPLY) await rest.post(Routes.guildRoles(G), { body: { name: w.rol, color: hex(w.color), hoist: w.separado, mentionable: false, permissions: "0" } });
  } else if (r.name !== w.rol || (r.color !== hex(w.color) && !("colorVariable" in w && w.colorVariable)) || r.hoist !== w.separado) {
    // Mismo rol (se reconoce sin emojis ni acentos): se renombra en vez de duplicar. Ko-fi asigna por id, no por nombre.
    // Un rol `sobreNiveles` conserva su color: Teto lo cambia al de #tu-color que elija su dueña.
    const color = "colorVariable" in w && w.colorVariable ? r.color : hex(w.color);
    log(`ajustar rol "${r.name}"${r.name !== w.rol ? ` → "${w.rol}"` : ""}: color #${color.toString(16).padStart(6, "0")}, ${w.separado ? "separado" : "no separado"} en la lista`);
    if (APPLY) await rest.patch(Routes.guildRole(G, r.id), { body: { name: w.rol, color, hoist: w.separado } });
  }
}
if (APPLY) roles = await api<ApiRole[]>(() => rest.get(Routes.guildRoles(G)));

// Ningun rol de Papus (ni @everyone) con permisos peligrosos: mencionar a @everyone, administrar, moderar…
// (Discord los trae por defecto). Los roles de los bots no se tocan.
// Excepcion (decision de GyroP): el rol Vocaloids si puede mencionar a @everyone; aparte de el, solo GyroP (dueño).
const vocaloidsKey = nameKey(layout.rolesExtra.find((r) => r.bots)!.rol);
for (const r of roles.filter((x) => !x.managed && (x.id === G || wantRoles.some((w) => nameKey(w.rol) === nameKey(x.name))))) {
  const p = BigInt(r.permissions);
  const esVocaloids = nameKey(r.name) === vocaloidsKey;
  const quitar = esVocaloids ? DANGEROUS & ~MENTION_EVERYONE : DANGEROUS;
  const want = (p & ~quitar) | (esVocaloids ? MENTION_EVERYONE : 0n);
  if (want !== p) {
    log(esVocaloids
      ? `rol "${r.name}": puede mencionar a @everyone (y sin otros permisos peligrosos)`
      : `quitar permisos peligrosos a "${r.name}" (mencionar a @everyone, administrar, moderar o crear emojis, stickers y eventos)`);
    if (APPLY) await rest.patch(Routes.guildRole(G, r.id), { body: { permissions: String(want) } });
  }
}

const placeholder = (n: string) => byName(n)?.id ?? `(nuevo:${n})`;
const roleIds: RoleIds = {
  everyone: G,
  tiers: layout.niveles.map((n) => ({ name: n.rol, id: placeholder(n.rol) })),
  bots: placeholder("Vocaloids"),
  music: (() => {
    const m = layout.rolesExtra.find((r) => r.musica);
    return m ? placeholder(m.rol) : undefined;
  })(),
  extra: Object.fromEntries(layout.rolesExtra.map((r) => [nameKey(r.rol), placeholder(r.rol)])),
};

// Bots de musica externos (Jockie, Chip…): su rol, que los deja solo en los canales de voz.
const musicSpec = layout.rolesExtra.find((r) => r.musica);
const musicRole = musicSpec ? byName(musicSpec.rol) : undefined;
for (const botId of musicSpec?.musica ?? []) {
  const m = await api<{ roles: string[] } | null>(() => rest.get(Routes.guildMember(G, botId)).catch(() => null));
  if (!m) continue; // ya no está en el servidor
  if (!musicRole || !m.roles.includes(musicRole.id)) {
    log(`dar el rol "${musicSpec!.rol}" al bot de música ${botId}`);
    if (APPLY && musicRole) await rest.put(Routes.guildMemberRole(G, botId, musicRole.id));
  }
}

// Rol Vocaloids a todos los bots con token (las 4 chicas y los de conversacion), y por encima de los niveles (para que salgan juntos arriba en la lista).
const botRole = layout.rolesExtra.find((r) => r.bots)!;
for (const id of config.activeBots) {
  const r2 = new REST().setToken(config.tokens[id]!);
  const u = await api<{ id: string }>(() => r2.get(Routes.user()));
  const m = await api<{ roles: string[] }>(() => rest.get(Routes.guildMember(G, u.id)));
  const vid = byName(botRole.rol)?.id;
  if (!vid || !m.roles.includes(vid)) {
    log(`dar el rol "${botRole.rol}" a ${id}`);
    if (APPLY && vid) await rest.put(Routes.guildMemberRole(G, u.id, vid));
  }
}
const top = byName(layout.niveles.at(-1)!.rol);
const voc = byName(botRole.rol);
if (top && (!voc || voc.position <= top.position)) {
  log(`subir "${botRole.rol}" por encima de "${top.name}" en la lista de roles`);
  if (APPLY && voc) await rest.patch(Routes.guildRoles(G), { body: [{ id: voc.id, position: top.position + 1 }] });
}
// Roles `sobreNiveles` (💙 Esposa de Kaito): justo encima del nivel más alto, para que su color mande sobre todos.
if (APPLY) roles = await api<ApiRole[]>(() => rest.get(Routes.guildRoles(G)));
for (const spec of layout.rolesExtra.filter((r) => r.sobreNiveles)) {
  const top2 = byName(layout.niveles.at(-1)!.rol);
  const own = byName(spec.rol);
  if (top2 && (!own || own.position <= top2.position)) {
    log(`subir "${spec.rol}" por encima de "${top2.name}" (su color manda sobre los niveles)`);
    if (APPLY && own) {
      await rest.patch(Routes.guildRoles(G), { body: [{ id: own.id, position: top2.position + 1 }] });
      roles = await api<ApiRole[]>(() => rest.get(Routes.guildRoles(G)));
    }
  }
}

// Colores de #tu-color por encima de las insignias (Papu de honor, Fundador) y de Papu: el color que elige cada uno
// se ve aunque tenga una insignia. Debajo de los niveles: quien paga sigue viéndose con el color de su nivel.
{
  const colorRoles = (layout.coloresPapu?.colores ?? []).map((c) => byName(c.rol)).filter((r): r is ApiRole => !!r);
  // Insignias: primero las que van separadas en la lista (Papu de honor), luego el resto (Fundador, Papu).
  const badges = layout.rolesExtra
    .filter((r) => !r.bots && !r.musica && !r.sobreNiveles)
    .sort((a, b) => Number(b.separado) - Number(a.separado))
    .map((r) => byName(r.rol))
    .filter((r): r is ApiRole => !!r);
  const anchor = byName(layout.niveles[0]!.rol);
  const teto = await api<{ id: string }>(() => new REST().setToken(config.tokens.teto).get(Routes.user()));
  const ceiling = roles.find((r) => r.managed && r.tags?.bot_id === teto.id)?.position ?? 0;
  const changes = anchor ? blockBelow(roles, anchor.id, [...colorRoles, ...badges].map((r) => r.id), ceiling) : [];
  if (changes.length) {
    log(`ordenar roles: colores de #tu-color sobre ${badges.map((b) => `"${b.name}"`).join(", ")}`);
    if (APPLY) await rest.patch(Routes.guildRoles(G), { body: changes });
  }
}

// Teto (Papu y Fundador) y Miku (colores, desde el worker) dan roles: necesitan "Gestionar roles" en su rol de bot,
// aunque Teto deje de ser Administrador.
const MANAGE_ROLES = 1n << 28n;
for (const id of ["teto", "miku"] as const) {
  const u = await api<{ id: string }>(() => new REST().setToken(config.tokens[id]).get(Routes.user()));
  const own = roles.find((r) => r.managed && r.tags?.bot_id === u.id);
  if (own && !(BigInt(own.permissions) & MANAGE_ROLES)) {
    log(`dar "Gestionar roles" al rol de ${id} (para asignar roles a los Papus)`);
    if (APPLY) await rest.patch(Routes.guildRole(G, own.id), { body: { permissions: String(BigInt(own.permissions) | MANAGE_ROLES) } });
  }
}

// ── Seguridad ────────────────────────────────────────────────────────────────────────────
const guild = await api<{ verification_level: number; explicit_content_filter: number }>(() => rest.get(Routes.guild(G)));
if (guild.verification_level !== layout.seguridad.verificacion || guild.explicit_content_filter !== layout.seguridad.filtroContenido) {
  log(`seguridad: verificación ${guild.verification_level} → ${layout.seguridad.verificacion}, filtro de imágenes ${guild.explicit_content_filter} → ${layout.seguridad.filtroContenido}`);
  if (APPLY) await rest.patch(Routes.guild(G), { body: { verification_level: layout.seguridad.verificacion, explicit_content_filter: layout.seguridad.filtroContenido } });
}

// ── Categorias y canales ─────────────────────────────────────────────────────────────────
let channels = await api<ApiChannel[]>(() => rest.get(Routes.guildChannels(G)));
const toApi = (o: Overwrite[]) => o.map((x) => ({ id: x.id, type: 0, allow: String(x.allow), deny: String(x.deny) }));
const fromApi = (o: ApiOverwrite[]): Overwrite[] => o.filter((x) => x.type === 0).map((x) => ({ id: x.id, allow: BigInt(x.allow), deny: BigInt(x.deny) }));
const find = (type: number, spec: { nombre: string; antes?: string[] }) => {
  const keys = [spec.nombre, ...(spec.antes ?? [])].map(nameKey);
  return channels.find((c) => c.type === type && keys.includes(nameKey(c.name)));
};
const managedIds = new Set<string>();

for (const cat of layout.categorias as CategorySpec[]) {
  const catOw = overwritesFor(cat.leen, true, roleIds);
  let c = find(ChannelType.GuildCategory, cat);
  if (!c) {
    log(`crear categoría "${cat.nombre}" (la ven: ${cat.leen === "todos" ? "todos" : cat.leen === "staff" ? "solo GyroP y los bots" : cat.leen.startsWith("rol:") ? `solo ${cat.leen.slice(4)}` : `${cat.leen} y superiores`})`);
    if (APPLY) c = await api<ApiChannel>(() => rest.post(Routes.guildChannels(G), { body: { name: cat.nombre, type: ChannelType.GuildCategory, permission_overwrites: toApi(catOw) } }));
  } else {
    const changes: Record<string, unknown> = {};
    if (c.name !== cat.nombre) changes.name = cat.nombre;
    if (!sameOverwrites(fromApi(c.permission_overwrites), catOw)) changes.permission_overwrites = toApi(catOw);
    if (Object.keys(changes).length) {
      log(`categoría "${c.name}"${changes.name ? ` → "${cat.nombre}"` : ""}${changes.permission_overwrites ? " (permisos)" : ""}`);
      if (APPLY) await rest.patch(Routes.channel(c.id), { body: changes });
    }
  }
  if (c) managedIds.add(c.id);

  for (const ch of cat.canales as ChannelSpec[]) {
    const ow = overwritesFor(cat.leen, ch.escriben, roleIds, ch);
    const type = ch.voz ? ChannelType.GuildVoice : ChannelType.GuildText;
    const body: { name: string; topic?: string; rate_limit_per_user?: number; permission_overwrites: ReturnType<typeof toApi> } = ch.voz
      ? { name: ch.nombre, permission_overwrites: toApi(ow) }
      : { name: ch.nombre, topic: ch.tema ?? "", rate_limit_per_user: ch.lento ?? 0, permission_overwrites: toApi(ow) };
    const existing = find(type, ch);
    const who = ch.escriben ? "escriben los que leen" : "solo leen (escriben los bots y GyroP)";
    if (!existing) {
      log(ch.voz ? `  crear voz "${ch.nombre}" en "${cat.nombre}"` : `  crear #${ch.nombre} en "${cat.nombre}" (${who}${ch.lento ? `, modo lento ${ch.lento} s` : ""})`);
      if (APPLY) {
        const created = await api<ApiChannel>(() => rest.post(Routes.guildChannels(G), { body: { ...body, type, parent_id: c?.id } }));
        managedIds.add(created.id);
      }
      continue;
    }
    managedIds.add(existing.id);
    const changes: Record<string, unknown> = {};
    // Discord guarda los nombres de canales de texto en minusculas y con guiones en vez de espacios.
    // (los de voz conservan mayusculas y espacios).
    if (existing.name !== (ch.voz ? ch.nombre : ch.nombre.toLowerCase().replace(/\s+/g, "-"))) changes.name = ch.nombre;
    if (c && existing.parent_id !== c.id) changes.parent_id = c.id;
    if (!ch.voz && (existing.topic ?? "") !== body.topic) changes.topic = body.topic;
    if (!ch.voz && (existing.rate_limit_per_user ?? 0) !== body.rate_limit_per_user) changes.rate_limit_per_user = body.rate_limit_per_user;
    if (!sameOverwrites(fromApi(existing.permission_overwrites), ow)) changes.permission_overwrites = body.permission_overwrites;
    if (Object.keys(changes).length) {
      const what = [changes.name && `renombrar a #${ch.nombre}`, changes.parent_id && `mover a "${cat.nombre}"`, changes.topic !== undefined && "tema", changes.rate_limit_per_user !== undefined && "modo lento", changes.permission_overwrites && `permisos (${who})`].filter(Boolean);
      log(`  #${existing.name}: ${what.join(", ")}`);
      if (APPLY) await rest.patch(Routes.channel(existing.id), { body: changes });
    }
  }
}

// ── Orden: categorias del archivo (las que no estan en el, despues de Comunidad); canales en el orden del archivo ──
if (APPLY) {
  channels = await api<ApiChannel[]>(() => rest.get(Routes.guildChannels(G)));
  const cats = channels.filter((c) => c.type === ChannelType.GuildCategory);
  const managedCats = (layout.categorias as CategorySpec[]).map((s) => cats.find((c) => nameKey(c.name) === nameKey(s.nombre))!).filter(Boolean);
  const others = cats.filter((c) => !managedCats.includes(c)).sort((a, b) => a.position - b.position);
  const order = [...managedCats.slice(0, 2), ...others, ...managedCats.slice(2)];
  const positions: { id: string; position: number }[] = order.map((c, i) => ({ id: c.id, position: i }));
  for (const s of layout.categorias as CategorySpec[]) {
    const cat = managedCats.find((c) => nameKey(c.name) === nameKey(s.nombre));
    if (!cat) continue;
    const kids = channels.filter((c) => c.parent_id === cat.id && c.type !== ChannelType.GuildCategory);
    const listed = s.canales.map((ch) => kids.find((k) => nameKey(k.name) === nameKey(ch.nombre))).filter((k): k is ApiChannel => !!k);
    const rest2 = kids.filter((k) => !listed.includes(k)).sort((a, b) => a.position - b.position);
    [...listed, ...rest2].forEach((k, i) => positions.push({ id: k.id, position: i }));
  }
  await rest.patch(Routes.guildChannels(G), { body: positions });
  console.log("✔ orden de categorías y canales");
} else {
  console.log("• ordenar categorías y canales como en config/servidor.json");
}

const extra = channels
  .filter((c) => !managedIds.has(c.id))
  .map((c) => (c.type === ChannelType.GuildCategory ? `categoría "${c.name}"` : c.type === ChannelType.GuildVoice ? `voz "${c.name}"` : `#${c.name}`));
console.log(`\n${ops.length} cambios ${APPLY ? "aplicados" : "pendientes"}. Quedan sin tocar (no están en la config): ${extra.join(", ") || "nada"}.`);
if (!APPLY) console.log("Para aplicarlo: npm run servidor -- --apply");
