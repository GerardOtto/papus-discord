// Cumpleaños de los Papus (ideas de wiwi y Ruko se acerca en #ideas-y-opiniones, salón de la fama; GyroP, 18 nov.
// 2026). Reglas puras, sin dependencias de Node: las usan el worker (botón y ventanita de #tus-roles) y el bot (aviso
// diario de Ruko, XP ×2 e insignia del pastel). Solo día y mes, nunca el año (hay menores). Una vez registrado, el Papu
// no lo puede cambiar: solo GyroP o un Mod con /cumple.

export const CUMPLE_BOTON_ID = "papu_cumple";
export const CUMPLE_MODAL_ID = "papu_cumple_modal";
export const CUMPLE_OK_ID = "papu_cumple_ok";
export const CUMPLE_NO_ID = "papu_cumple_no";
export const CUMPLE_CAMPOS = { dia: "dia", mes: "mes" } as const;

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface Fecha {
  dia: number;
  mes: number;
}

/** «12 de marzo». */
export const fechaTexto = (f: Fecha): string => `${f.dia} de ${MESES[f.mes - 1]}`;

/** «03-12» (MM-DD), como en config/cumpleanos.json. */
export const fechaClave = (f: Fecha): string => `${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`;

/** "MM-DD" → fecha (null si no es una fecha válida). */
export function deClave(clave: string): Fecha | null {
  const m = /^(\d{2})-(\d{2})$/.exec(clave);
  if (!m) return null;
  const f = { mes: Number(m[1]), dia: Number(m[2]) };
  return valida(f) ? f : null;
}

const valida = (f: Fecha) => Number.isInteger(f.dia) && Number.isInteger(f.mes) && f.mes >= 1 && f.mes <= 12 && f.dia >= 1 && f.dia <= DIAS_MES[f.mes - 1]!;

/** Lo que escribió el Papu en la ventanita: día (1-31) y mes (número o nombre). */
export function leerFecha(dia: string, mes: string): { ok: true; fecha: Fecha } | { ok: false; motivo: string } {
  const d = Number(dia.trim());
  const limpio = mes.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const porNombre = MESES.findIndex((n) => n.startsWith(limpio.slice(0, 3)) && limpio.length >= 3);
  const m = /^\d{1,2}$/.test(limpio) ? Number(limpio) : limpio.startsWith("set") ? 9 : porNombre + 1;
  const f = { dia: d, mes: m };
  if (!valida(f)) return { ok: false, motivo: "Esa fecha no existe. Escribe el día (1 a 31) y el mes (1 a 12 o su nombre)." };
  return { ok: true, fecha: f };
}

/** Día (AAAA-MM-DD) → fecha y año. */
const partes = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { y, m, d };
};

const bisiesto = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** ¿Es su cumpleaños el día `day` (AAAA-MM-DD)? El 29 de febrero se celebra el 28 en los años no bisiestos. */
export function esCumple(f: Fecha, day: string): boolean {
  const { y, m, d } = partes(day);
  if (f.mes === 2 && f.dia === 29 && !bisiesto(y)) return m === 2 && d === 28;
  return f.mes === m && f.dia === d;
}

/** Días que faltan desde `day` hasta el próximo cumpleaños (0 = hoy). */
export function diasHasta(f: Fecha, day: string): number {
  const { y, m, d } = partes(day);
  const hoy = Date.UTC(y, m - 1, d);
  for (let k = 0; k <= 366; k++) if (esCumple(f, new Date(hoy + k * 86_400_000).toISOString().slice(0, 10))) return k;
  return 366;
}

export interface Cumple<T> {
  quien: T;
  fecha: Fecha;
  /** Días que faltan (0 = hoy). */
  en: number;
}

/** Cumpleaños de hoy y de los próximos `dias` días, del más cercano al más lejano. */
export function proximos<T>(lista: { quien: T; fecha: Fecha }[], day: string, dias: number): Cumple<T>[] {
  return lista
    .map((x) => ({ ...x, en: diasHasta(x.fecha, day) }))
    .filter((x) => x.en <= dias)
    .sort((a, b) => a.en - b.en);
}

/** «hoy», «mañana», «en 3 días». */
export const cuando = (en: number): string => (en === 0 ? "hoy" : en === 1 ? "mañana" : `en ${en} días`);

// ───────────────────────── #tus-roles (worker) ─────────────────────────

/** Fila con el botón de #tus-roles. */
export function cumpleBoton(): Record<string, unknown> {
  return { type: 1, components: [{ type: 2, style: 1, custom_id: CUMPLE_BOTON_ID, label: "Registrar mi cumpleaños", emoji: { name: "🎂" } }] };
}

/** Ventanita: día y mes (sin año). */
export function cumpleModal(): Record<string, unknown> {
  const campo = (custom_id: string, label: string, placeholder: string, max: number) => ({
    type: 1,
    components: [{ type: 4, custom_id, style: 1, label, placeholder, min_length: 1, max_length: max, required: true }],
  });
  return {
    custom_id: CUMPLE_MODAL_ID,
    title: "🎂 Tu cumpleaños (sin el año)",
    components: [campo(CUMPLE_CAMPOS.dia, "Día", "Ej.: 12", 2), campo(CUMPLE_CAMPOS.mes, "Mes", "Ej.: 3 o marzo", 10)],
  };
}

/** Botones para confirmar (no se puede cambiar después). */
export function cumpleConfirmar(f: Fecha): Record<string, unknown>[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: `${CUMPLE_OK_ID}:${fechaClave(f)}`, label: `Sí, el ${fechaTexto(f)}`, emoji: { name: "🎂" } },
        { type: 2, style: 2, custom_id: CUMPLE_NO_ID, label: "Me equivoqué" },
      ],
    },
  ];
}
