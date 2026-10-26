// Menus de colores y paises de #tu-color: los publica Miku (npm run guias) y los atiende el worker de Cloudflare.
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

/** Menu desplegable de Discord (maximo 25 opciones, contando "sin color"). */
export function colorMenu(palette: PaletteColor[]): Record<string, unknown> {
  if (palette.length > 24) throw new Error("La paleta de colores admite hasta 24 colores (el menú de Discord tiene 25 opciones)");
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: COLOR_MENU_ID,
        placeholder: "🎨 Elige el color de tu nombre",
        options: [
          ...palette.map((c) => ({ label: c.rol.replace(/^🎨\s*/, ""), value: colorKey(c.rol), description: c.color.toUpperCase() })),
          { label: "Sin color", value: NO_COLOR, description: "Vuelve al color de siempre" },
        ],
      },
    ],
  };
}

// Menu de paises, en el mismo mensaje de #tu-color: el rol solo pone la bandera y el nombre del pais (sin color).
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
