// Menu de colores de #tu-color: lo publica Miku (npm run guias) y lo atiende el worker de Cloudflare.
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
