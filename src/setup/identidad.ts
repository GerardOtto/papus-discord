// Pronombres y género de #tus-roles (pedido de GyroP, 13 nov. 2026): dos menús de Miku con las opciones comunes,
// "✏️ Escribir" (abre un campo de texto) y "Quitar". El rol se llama "Pronombres: …" o "Género: …" y es solo
// decorativo: sin permisos, sin color, no separado en la lista, no mencionable y al fondo de la lista de roles
// (Discord pone ahí los roles nuevos). Lo atiende el worker de Cloudflare (24/7). Sin dependencias de Node.
import { normalize } from "../moderation/text";

export type IdentidadTipo = "pronombres" | "genero";
export const IDENTIDAD_TIPOS: IdentidadTipo[] = ["pronombres", "genero"];

export interface IdentidadConfig {
  canal: string;
  pronombres: string[];
  generos: string[];
  /** Largo máximo de lo que escribe el Papu (sin el prefijo). */
  maxLargo: number;
  /** Tope de roles de pronombres y género escritos a mano (Discord admite 250 roles en total). */
  maxEscritos: number;
  /** Palabras o frases de burla que no se aceptan aunque no sean groserías (se buscan sin acentos ni mayúsculas). */
  bloqueadas: string[];
}

export const IDENTIDAD_MENU_ID: Record<IdentidadTipo, string> = { pronombres: "papu_pronombres", genero: "papu_genero" };
export const IDENTIDAD_MODAL_ID = "papu_identidad_modal";
export const IDENTIDAD_CAMPO_ID = "texto";
export const ESCRIBIR = "escribir";
export const QUITAR = "quitar";

const PREFIJO: Record<IdentidadTipo, string> = { pronombres: "Pronombres", genero: "Género" };
const QUE: Record<IdentidadTipo, string> = { pronombres: "tus pronombres", genero: "tu género" };

export function tipoDeMenu(customId: string | undefined): IdentidadTipo | null {
  return IDENTIDAD_TIPOS.find((t) => IDENTIDAD_MENU_ID[t] === customId) ?? null;
}

export function tipoDeModal(customId: string | undefined): IdentidadTipo | null {
  const t = customId?.startsWith(`${IDENTIDAD_MODAL_ID}:`) ? customId.slice(IDENTIDAD_MODAL_ID.length + 1) : "";
  return IDENTIDAD_TIPOS.includes(t as IdentidadTipo) ? (t as IdentidadTipo) : null;
}

export function opcionesDe(cfg: IdentidadConfig, tipo: IdentidadTipo): string[] {
  return tipo === "pronombres" ? cfg.pronombres : cfg.generos;
}

/** Clave para comparar textos: sin acentos, mayúsculas ni espacios de más ("Él / Elle" = "el/elle"). */
export function claveIdentidad(texto: string): string {
  return normalize(texto).replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

/** Nombre del rol: "Pronombres: él/elle", "Género: No binario". */
export function rolIdentidad(tipo: IdentidadTipo, texto: string): string {
  return `${PREFIJO[tipo]}: ${texto}`;
}

/** Letras (con acentos), números, espacios y / - . ' · ; nada de @, enlaces, emojis ni símbolos. */
const PERMITIDO = /^[\p{L}\p{M}0-9 /\-.'·]+$/u;

/**
 * Limpia lo que escribió el Papu o explica por qué no se puede usar. `ofensivo` es el filtro fijo de Neru
 * (groserías, odio, datos personales): nunca el LLM (regla 3).
 */
export function validarIdentidad(
  cfg: IdentidadConfig,
  texto: string,
  ofensivo: (texto: string) => boolean,
): { ok: true; texto: string } | { ok: false; motivo: string } {
  const limpio = texto.replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
  if (!limpio) return { ok: false, motivo: "Escribiste un texto vacío." };
  if ([...limpio].length > cfg.maxLargo) return { ok: false, motivo: `Puede tener hasta ${cfg.maxLargo} caracteres.` };
  if (!PERMITIDO.test(limpio)) return { ok: false, motivo: "Solo puede llevar letras, números, espacios y / - . (sin emojis, enlaces ni @)." };
  const clave = ` ${claveIdentidad(limpio).replace(/[^a-z0-9]+/g, " ")} `;
  const burla = cfg.bloqueadas.some((b) => clave.includes(` ${claveIdentidad(b).replace(/[^a-z0-9]+/g, " ")} `));
  if (burla || ofensivo(limpio)) return { ok: false, motivo: "No puedo usar ese texto." };
  return { ok: true, texto: limpio };
}

/** Menú de pronombres o de género (una fila): opciones comunes + escribir + quitar. */
export function identidadMenu(cfg: IdentidadConfig, tipo: IdentidadTipo): Record<string, unknown> {
  const opciones = opcionesDe(cfg, tipo);
  if (opciones.length > 23) throw new Error(`El menú de ${QUE[tipo]} admite hasta 23 opciones (más escribir y quitar)`);
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: IDENTIDAD_MENU_ID[tipo],
        placeholder: tipo === "pronombres" ? "💬 Elige tus pronombres" : "🌈 Elige tu género",
        options: [
          ...opciones.map((o) => ({ label: o, value: claveIdentidad(o) })),
          { label: "Escribir los míos", value: ESCRIBIR, description: "Si no está en la lista, escríbelo tú", emoji: { name: "✏️" } },
          { label: "Quitar", value: QUITAR, description: `Quita ${QUE[tipo]} de tu perfil` },
        ],
      },
    ],
  };
}

/** Ventanita (modal) con el campo de texto para escribir pronombres o género. */
export function identidadModal(cfg: IdentidadConfig, tipo: IdentidadTipo): Record<string, unknown> {
  return {
    custom_id: `${IDENTIDAD_MODAL_ID}:${tipo}`,
    title: tipo === "pronombres" ? "Tus pronombres" : "Tu género",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: IDENTIDAD_CAMPO_ID,
            style: 1,
            label: tipo === "pronombres" ? "Pronombres (ej.: elle/ella)" : "Género (ej.: demigénero)",
            min_length: 1,
            max_length: cfg.maxLargo,
            required: true,
          },
        ],
      },
    ],
  };
}

export function queIdentidad(tipo: IdentidadTipo): string {
  return QUE[tipo];
}
