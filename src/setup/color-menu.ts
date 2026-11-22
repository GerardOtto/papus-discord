// Menus de colores, paises y avisos de #tus-roles: los publica Miku (npm run guias) y los atiende el worker de Cloudflare.
// Sin dependencias de Node: lo importan el PC y el worker.
export const COLOR_MENU_ID = "papu_color";
export const NO_COLOR = "ninguno";

export interface PaletteColor {
  rol: string;
  color: string;
}

/** Valor de cada opcion: el nombre del rol sin emoji, acentos ni espacios ("🎨 Rin y Len" -> "rinylen"). */
export function colorKey(rol: string): string {
  return rol
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Colores por menu: el de Discord tiene 25 opciones y una es "Sin color". */
export const COLORS_PER_MENU = 24;

/** El menu de colores `custom_id` (el primero es COLOR_MENU_ID; los siguientes, "papu_color:2", "papu_color:3"…). */
export function isColorMenu(customId: string | undefined): boolean {
  return !!customId && (customId === COLOR_MENU_ID || customId.startsWith(`${COLOR_MENU_ID}:`));
}

/**
 * Menus desplegables de colores (una fila cada uno). Con mas de 24 colores la paleta se parte en menus parejos, en
 * orden (desde el 12 nov. 2026 son 26, con los colores de las 4 chicas, Ruko y los invitados del 1vs1). Cada menu
 * lleva "Sin color".
 */
export function colorMenus(palette: PaletteColor[]): Record<string, unknown>[] {
  const n = Math.max(1, Math.ceil(palette.length / COLORS_PER_MENU));
  if (n > 2) throw new Error("La paleta de colores admite hasta 48 colores (dos menús de Discord)");
  const size = Math.ceil(palette.length / n);
  return Array.from({ length: n }, (_, k) => {
    const part = palette.slice(k * size, (k + 1) * size);
    const range = n > 1 ? ` (${part[0]!.rol.replace(/^🎨\s*/, "")} … ${part.at(-1)!.rol.replace(/^🎨\s*/, "")})` : "";
    return {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: k === 0 ? COLOR_MENU_ID : `${COLOR_MENU_ID}:${k + 1}`,
          placeholder: `🎨 Elige el color de tu nombre${range}`.slice(0, 150),
          options: [
            ...part.map((c) => ({ label: c.rol.replace(/^🎨\s*/, ""), value: colorKey(c.rol), description: c.color.toUpperCase() })),
            { label: "Sin color", value: NO_COLOR, description: "Vuelve al color de siempre" },
          ],
        },
      ],
    };
  });
}

/** Un solo menu de colores (paletas de hasta 24). */
export function colorMenu(palette: PaletteColor[]): Record<string, unknown> {
  if (palette.length > COLORS_PER_MENU) throw new Error("La paleta de colores admite hasta 24 colores en un menú (usa colorMenus)");
  return colorMenus(palette)[0]!;
}

// Menu de paises, en el mismo mensaje de #tus-roles: el rol solo pone la bandera y el nombre del pais (sin color).
export const COUNTRY_MENU_ID = "papu_pais";
export const NO_COUNTRY = "ninguno";

/** Bandera (o emoji) y nombre de un rol de pais: "🇲🇽 México" -> { emoji: "🇲🇽", name: "México" }. */
export function splitCountry(rol: string): { emoji: string; name: string } {
  const i = rol.indexOf(" ");
  return { emoji: rol.slice(0, i), name: rol.slice(i + 1) };
}

/** Menu desplegable de paises (maximo 25 opciones, contando "sin país"). */
export function countryMenu(paises: string[]): Record<string, unknown> {
  if (paises.length > 24) throw new Error("La lista de países admite hasta 24 (el menú de Discord tiene 25 opciones)");
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: COUNTRY_MENU_ID,
        placeholder: "🌎 Elige tu país",
        options: [
          ...paises.map((p) => {
            const { emoji, name } = splitCountry(p);
            return { label: name, value: colorKey(p), emoji: { name: emoji } };
          }),
          { label: "Sin país", value: NO_COUNTRY, description: "Quita la bandera de tu perfil" },
        ],
      },
    ],
  };
}

// Menu de avisos, en el mismo mensaje de #tus-roles: se marcan varios a la vez; el bot etiqueta el rol al empezar su
// evento (peleas, bodas, estrenos). Lo que quede marcado al cerrar el menu es lo que tiene el Papu.
export const AVISOS_MENU_ID = "papu_avisos";

export interface AvisoOption {
  rol: string;
  nombre: string;
  descripcion: string;
}

/** Emoji y nombre del rol de un aviso: "⚔️ Ludópata" -> { emoji: "⚔️", name: "Ludópata" }. */
export const splitAviso = splitCountry;

/** Menu desplegable de avisos, de seleccion multiple (se puede dejar sin ninguno). */
export function avisosMenu(avisos: AvisoOption[]): Record<string, unknown> {
  if (!avisos.length || avisos.length > 25) throw new Error("Los avisos van de 1 a 25 (el menú de Discord tiene 25 opciones)");
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: AVISOS_MENU_ID,
        placeholder: "🔔 ¿De qué quieres que te avisemos? (varios)",
        min_values: 0,
        max_values: avisos.length,
        options: avisos.map((a) => {
          const { emoji, name } = splitAviso(a.rol);
          return { label: `${a.nombre} · ${name}`, value: colorKey(a.rol), description: a.descripcion, emoji: { name: emoji } };
        }),
      },
    ],
  };
}

/**
 * Roles que hay que dar y quitar para que el Papu quede con exactamente los avisos `values` marcados.
 * `idOf`: clave del rol (colorKey) -> id en el servidor. Devuelve tambien los nombres que quedan.
 */
export function avisosChange(
  avisos: { rol: string }[],
  values: string[],
  memberRoles: string[],
  idOf: Map<string, string>,
): { add: string[]; remove: string[]; quedan: string[]; faltan: string[] } {
  const want = new Set(values);
  const add: string[] = [];
  const remove: string[] = [];
  const quedan: string[] = [];
  const faltan: string[] = [];
  for (const a of avisos) {
    const key = colorKey(a.rol);
    const id = idOf.get(key);
    if (want.has(key)) {
      if (!id) faltan.push(a.rol);
      else {
        quedan.push(a.rol);
        if (!memberRoles.includes(id)) add.push(id);
      }
    } else if (id && memberRoles.includes(id)) remove.push(id);
  }
  return { add, remove, quedan, faltan };
}
