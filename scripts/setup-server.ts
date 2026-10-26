// Aplica config/servidor.json al servidor: roles de los niveles, roles Vocaloids y Coro para los bots, categorias, canales,
// permisos, temas, modo lento, orden y seguridad. Nunca borra nada (lo que no esta en la config queda intacto).
//   npm run servidor             -> solo muestra lo que haria
//   npm run servidor -- --apply  -> lo ejecuta (usa la app de Teto: necesita "Administrador" mientras corre)
import { ChannelType, REST, Routes } from "discord.js";
import { isCoreBot, loadConfig, loadDotEnv } from "../src/config";
import { blockAtBottom, blockAtTop, blockBelow, botColorRoles, nameKey, overwritesFor, sameOverwrites, type CategorySpec, type ChannelSpec, type Overwrite, type RoleIds } from "../src/setup/layout";
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
  // Colores solo de bots (las 4 chicas y Ruko): como los de #tu-color, pero fuera del menu.
  ...botColorRoles(layout).botOnly.map((c) => ({ rol: c.rol, color: c.color, separado: false })),
  // Paises: solo la bandera y el nombre en el perfil (sin color).
  ...(layout.paisesPapu?.paises ?? []).map((p) => ({ rol: p, color: "#000000", separado: false })),
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
  chatBots: (() => {
    const c = layout.rolesExtra.find((r) => r.botsCharla);
    return c ? placeholder(c.rol) : undefined;
  })(),
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

// Rol Vocaloids a las 4 chicas, por encima de los niveles (salen juntas arriba en la lista), y rol Coro a los Vocaloids
// de conversacion con token (salen al final). Los de conversacion pierden el rol Vocaloids si lo tenian (antes del
// 20 oct. 2026 todos los bots lo llevaban; ademas puede mencionar a @everyone).
const botRole = layout.rolesExtra.find((r) => r.bots)!;
const chatRole = layout.rolesExtra.find((r) => r.botsCharla);
for (const id of config.activeBots) {
  const r2 = new REST().setToken(config.tokens[id]!);
  const u = await api<{ id: string }>(() => r2.get(Routes.user()));
  const m = await api<{ roles: string[] } | null>(() => rest.get(Routes.guildMember(G, u.id)).catch(() => null));
  if (!m) {
    log(`⚠️  ${id} tiene token pero no está en el servidor: invitarlo (README) y volver a correr npm run servidor`);
    continue;
  }
  const vid = byName(botRole.rol)?.id;
  const own = isCoreBot(id) || !chatRole ? botRole : chatRole;
  const oid = byName(own.rol)?.id;
  if (!oid || !m.roles.includes(oid)) {
    log(`dar el rol "${own.rol}" a ${id}`);
    if (APPLY && oid) await rest.put(Routes.guildMemberRole(G, u.id, oid));
  }
  if (own !== botRole && vid && m.roles.includes(vid)) {
    log(`quitar el rol "${botRole.rol}" a ${id} (va en "${own.rol}")`);
    if (APPLY) await rest.delete(Routes.guildMemberRole(G, u.id, vid));
  }
  // Su color (coloresBots): el rol de #tu-color que le corresponde o uno solo suyo.
  const colorName = botColorRoles(layout).byBot.get(id);
  const cid = colorName ? byName(colorName)?.id : undefined;
  if (colorName && (!cid || !m.roles.includes(cid))) {
    log(`dar el color "${colorName}" a ${id}`);
    if (APPLY && cid) await rest.put(Routes.guildMemberRole(G, u.id, cid));
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
// 🛡️ Mod justo debajo de Vocaloids: su grupo sale sobre los niveles (y sobre 💙 Esposa de Kaito). Neru queda arriba.
// (Un PATCH suelto con la posicion a veces no lo mueve; blockBelow manda el orden completo.)
const modSpec = layout.rolesExtra.find((r) => r.mod);
{
  const mod = modSpec ? byName(modSpec.rol) : undefined;
  const voc2 = byName(botRole.rol);
  if (modSpec && voc2 && (!mod || mod.position !== voc2.position - 1)) {
    log(`poner "${modSpec.rol}" justo debajo de "${voc2.name}" (su grupo sale sobre los niveles)`);
    const tetoUserId = tetoUser.id;
    const tetoTop = roles.find((r) => r.managed && r.tags?.bot_id === tetoUserId)?.position ?? 0;
    if (APPLY && mod) {
      await rest.patch(Routes.guildRoles(G), { body: blockBelow(roles, voc2.id, [mod.id], tetoTop) });
      roles = await api<ApiRole[]>(() => rest.get(Routes.guildRoles(G)));
    }
  }
}

// Orden de los roles de los Papus (solo los que están debajo de Teto, que es quien los mueve):
//   1. colores de #tu-color arriba de todo (decisión de GyroP, 19 oct. 2026): el color que elige cada uno se ve sobre
//      el de su nivel y sus insignias. No son separados, así que la lista de miembros sigue agrupada por nivel.
//   2. insignias (Papu de honor, Fundador, Papu) juntas debajo del nivel más bajo.
//   3. países al fondo, debajo de Papu: no cambian el color ni el grupo de nadie.
{
  const ids = (names: string[]) => names.map((n) => byName(n)).filter((r): r is ApiRole => !!r).map((r) => r.id);
  const botRolePos = async (id: "teto" | "miku" | "neru") => {
    const u = await api<{ id: string }>(() => new REST().setToken(config.tokens[id]).get(Routes.user()));
    return roles.find((r) => r.managed && r.tags?.bot_id === u.id)?.position ?? 0;
  };
  const tetoPos = await botRolePos("teto");
  // Miku da los colores y países desde el worker: deben quedar debajo de su rol de bot, o Discord no la deja asignarlos.
  const mikuPos = await botRolePos("miku");
  // Y debajo de Neru: si quedaran encima, ella no podria silenciar a quien tenga un color (caso real del 21 oct. 2026).
  const neruPos = await botRolePos("neru");
  const ceiling = Math.min(tetoPos, mikuPos || tetoPos, neruPos || tetoPos);
  const refresh = async (changed: boolean) => {
    if (APPLY && changed) roles = await api<ApiRole[]>(() => rest.get(Routes.guildRoles(G)));
  };

  const top = blockAtTop(roles, ids([...(layout.coloresPapu?.colores ?? []).map((c) => c.rol), ...botColorRoles(layout).botOnly.map((c) => c.rol)]), ceiling);
  if (top.length) {
    log(`ordenar roles: colores de #tu-color arriba de todos (su color se ve sobre el de los niveles)`);
    if (APPLY) await rest.patch(Routes.guildRoles(G), { body: top });
  }
  await refresh(top.length > 0);

  // Insignias: primero las que van separadas en la lista (Papu de honor), luego el resto (Fundador, Papu).
  const badges = layout.rolesExtra
    .filter((r) => !r.bots && !r.botsCharla && !r.musica && !r.sobreNiveles && !r.mod)
    .sort((a, b) => Number(b.separado) - Number(a.separado))
    .map((r) => r.rol);
  const anchor = byName(layout.niveles[0]!.rol);
  const below = anchor ? blockBelow(roles, anchor.id, ids(badges), tetoPos) : [];
  if (below.length) {
    log(`ordenar roles: ${badges.map((b) => `"${b}"`).join(", ")} debajo de "${anchor!.name}"`);
    if (APPLY) await rest.patch(Routes.guildRoles(G), { body: below });
  }
  await refresh(below.length > 0);

  // Coro (sin color) al fondo de todo, debajo de los países: así es el último rol separado y el grupo de los Vocaloids
  // de conversación sale al final de la lista de miembros, justo encima de "En línea" (decisión de GyroP, 20 oct. 2026).
  const bottom = blockAtBottom(roles, ids([...(layout.paisesPapu?.paises ?? []), ...(chatRole ? [chatRole.rol] : [])]), tetoPos);
  if (bottom.length) {
    log(`ordenar roles: países al fondo de la lista (debajo de "Papu")${chatRole ? ` y "${chatRole.rol}" el último (su grupo sale al final)` : ""}`);
    if (APPLY) await rest.patch(Routes.guildRoles(G), { body: bottom });
  }
  await refresh(bottom.length > 0);

  // Neru, la que modera, con su rol de bot sobre TODOS los roles de los Papus (colores de #tu-color, Mod, niveles…):
  // Discord solo deja silenciar a quien tiene el rol más alto por debajo del suyo (caso real del 21 oct. 2026: estaba
  // debajo de los 🎨 colores y sus strikes no silenciaban a nadie). Teto la deja justo debajo de su propio rol, lo más
  // alto que puede mover; si GyroP la sube a mano por encima de Teto, aquí no se la baja.
  // Desde el 22 oct. 2026 (decisión de GyroP) Neru va en el rol más alto del servidor, solo bajo GyroP: ningún bot puede
  // subir un rol sobre el suyo, así que el último paso (sobre Teto y los demás bots) lo hace GyroP a mano.
  const neruUser = await api<{ id: string }>(() => new REST().setToken(config.tokens.neru).get(Routes.user()));
  const neruRole = roles.find((r) => r.managed && r.tags?.bot_id === neruUser.id);
  const highestPapuRole = Math.max(0, ...roles.filter((r) => !r.managed).map((r) => r.position));
  if (neruRole && neruRole.position <= highestPapuRole) {
    log(`subir el rol de Neru sobre todos los roles de los Papus (justo debajo de Teto), para que sus silencios funcionen`);
    if (APPLY) await rest.patch(Routes.guildRoles(G), { body: [{ id: neruRole.id, position: tetoPos - 1 }] });
  }
  const aboveNeru = roles.filter((r) => neruRole && r.id !== neruRole.id && r.position > neruRole.position).map((r) => r.name);
  if (neruRole && aboveNeru.length)
    console.log(`⚠️  Neru debe ser el rol más alto (solo bajo GyroP). Arrastra "${neruRole.name}" arriba de todo en Ajustes del servidor → Roles (hoy tiene encima: ${aboveNeru.join(", ")}).`);
}

// Teto (Papu, Fundador y honor) y Miku (colores, desde el worker) dan roles: necesitan "Gestionar roles" en su rol de
// bot, aunque Teto deje de ser Administrador. Teto ademas pone el nivel en el apodo de quien lo active: "Gestionar apodos".
// Neru es Administradora (decisión de GyroP, 22 oct. 2026): borra y silencia en todos los canales e hilos, también los
// privados y cerrados, sin depender de los permisos de cada canal. Expulsar y banear sigue siendo solo de GyroP (el
// código de Neru no lo hace nunca, regla 3).
const MANAGE_ROLES = 1n << 28n;
const MANAGE_NICKNAMES = 1n << 27n;
for (const [id, need, what] of [
  ["teto", MANAGE_ROLES | MANAGE_NICKNAMES, "Gestionar roles\" y \"Gestionar apodos"],
  ["miku", MANAGE_ROLES, "Gestionar roles"],
  ["neru", ADMIN, "Administrador"],
] as const) {
  const u = await api<{ id: string }>(() => new REST().setToken(config.tokens[id]).get(Routes.user()));
  const own = roles.find((r) => r.managed && r.tags?.bot_id === u.id);
  if (own && (BigInt(own.permissions) & need) !== need) {
    log(`dar "${what}" al rol de ${id} (${id === "neru" ? "borrar y silenciar en todos los canales e hilos" : `roles de los Papus${id === "teto" ? " y nivel en el apodo" : ""}`})`);
    // Un bot no puede cambiar su propio rol (Discord responde 50013): entonces lo hace GyroP a mano.
    if (APPLY) {
      await rest.patch(Routes.guildRole(G, own.id), { body: { permissions: String(BigInt(own.permissions) | need) } }).catch(() =>
        console.log(`⚠️  No pude darle "${what}" al rol "${own.name}": actívalo a mano en Ajustes del servidor → Roles → ${own.name}.`),
      );
    }
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

// ── Orden: categorias del archivo (las que no estan en el, despues de categoriasManualesDespuesDe); canales en el orden del archivo ──
if (APPLY) {
  channels = await api<ApiChannel[]>(() => rest.get(Routes.guildChannels(G)));
  const cats = channels.filter((c) => c.type === ChannelType.GuildCategory);
  const managedCats = (layout.categorias as CategorySpec[]).map((s) => cats.find((c) => nameKey(c.name) === nameKey(s.nombre))!).filter(Boolean);
  const others = cats.filter((c) => !managedCats.includes(c)).sort((a, b) => a.position - b.position);
  const split = managedCats.findIndex((c) => nameKey(c.name) === nameKey(layout.categoriasManualesDespuesDe ?? "")) + 1 || 2;
  const order = [...managedCats.slice(0, split), ...others, ...managedCats.slice(split)];
  const positions: { id: string; position: number }[] = order.map((c, i) => ({ id: c.id, position: i }));
  for (const s of layout.categorias as CategorySpec[]) {
    const cat = managedCats.find((c) => nameKey(c.name) === nameKey(s.nombre));
    if (!cat) continue;
    const kids = channels.filter((c) => c.parent_id === cat.id && c.type !== ChannelType.GuildCategory);
    const listed = s.canales.map((ch) => kids.find((k) => nameKey(k.name) === nameKey(ch.nombre))).filter((k): k is ApiChannel => !!k);
    // Los canales que GyroP agrega a mano (no estan en el archivo) se quedan junto al canal que tienen antes hoy
    // (p. ej. #mascotas despues de #charla-vocaloid), no al final de la categoria.
    const current = [...kids].sort((a, b) => a.position - b.position);
    const after = new Map<string | null, ApiChannel[]>();
    let prev: string | null = null;
    for (const k of current) {
      if (listed.includes(k)) prev = k.id;
      else after.set(prev, [...(after.get(prev) ?? []), k]);
    }
    const ordered = [...(after.get(null) ?? []), ...listed.flatMap((k) => [k, ...(after.get(k.id) ?? [])])];
    ordered.forEach((k, i) => positions.push({ id: k.id, position: i }));
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
