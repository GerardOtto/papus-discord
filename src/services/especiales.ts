// Trato especial de UN Papu concreto (config/especiales.json): regalo personal de GyroP, no un beneficio de Ko-fi
// (regla 1). Se reconoce por el id de Discord, nunca por el nombre: un Papu que se ponga el mismo apodo no lo recibe.
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOT_IDS, type BotId } from "../config";
import { nameKey } from "../setup/layout";

export interface PapuEspecial {
  id: string;
  /** Nombre de referencia (para el registro y para marcar imitaciones); no se usa para reconocerla. */
  nombre: string;
  /** Sin cuota diaria con los bots (sigue con la moderacion de siempre). */
  sinLimite: boolean;
  /** Rol de adorno (rolesExtra de config/servidor.json) que Teto le da sola. */
  rol?: string;
  /**
   * Fin del trato (fecha ISO con hora). Pasada la fecha deja de valer todo (rol, trato y sin limite) y Teto borra el rol.
   * Un rol temporal no va en config/servidor.json: Teto lo crea sola (sin permisos, color `colorRol`) mientras dure.
   */
  hasta?: string;
  /** Color del rol temporal que crea Teto ("#RRGGBB"). */
  colorRol?: string;
  /** Lo que sabe cada bot de ella, solo cuando ella le escribe. */
  trato: Partial<Record<BotId, string>>;
  /** Lo que sabe cada bot de esta persona hable con quien hable (ej. Miku sabe con quien esta casada). */
  publico?: Partial<Record<BotId, string>>;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadEspeciales(file = path.join(REPO_ROOT, "config/especiales.json")): PapuEspecial[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { papus?: PapuEspecial[] };
  const list = raw.papus ?? [];
  const seen = new Set<string>();
  for (const p of list) {
    if (!/^\d{17,20}$/.test(p.id ?? "")) throw new Error(`config/especiales.json: id de Discord inválido (${p.nombre})`);
    if (seen.has(p.id)) throw new Error(`config/especiales.json: id repetido (${p.id})`);
    seen.add(p.id);
    if (p.hasta !== undefined && Number.isNaN(Date.parse(p.hasta))) throw new Error(`config/especiales.json: fecha "hasta" inválida (${p.nombre})`);
    if (p.colorRol !== undefined && !/^#[0-9a-fA-F]{6}$/.test(p.colorRol)) throw new Error(`config/especiales.json: colorRol inválido (${p.nombre})`);
    for (const bot of [...Object.keys(p.trato ?? {}), ...Object.keys(p.publico ?? {})]) {
      if (!(BOT_IDS as readonly string[]).includes(bot)) throw new Error(`config/especiales.json: bot desconocido "${bot}" (${p.nombre})`);
    }
  }
  return list;
}

export class Especiales {
  private readonly byId: Map<string, PapuEspecial>;
  constructor(
    list: PapuEspecial[],
    private readonly now: () => number = Date.now,
    private readonly timeZone = "America/Santiago",
  ) {
    this.byId = new Map(list.map((p) => [p.id, p]));
  }

  /** Su trato, solo mientras dure (`hasta`). */
  get(userId: string): PapuEspecial | undefined {
    const p = this.byId.get(userId);
    return p && this.active(p) ? p : undefined;
  }

  unlimited(userId: string): boolean {
    return this.get(userId)?.sinLimite ?? false;
  }

  /**
   * Notas para el LLM de los bots que responden: el trato de quien escribe con cada uno y, si escribe otra persona, lo
   * que el bot sabe de los tratos vigentes (`publico`). Un trato con `hasta` lleva la hora exacta del final: sin ella,
   * Miku inventó que su matrimonio "ya terminó a la 1:15 pm" cuando le quedaban 5 horas (22 oct. 2026).
   */
  notesFor(userId: string, bots: BotId[]): Partial<Record<BotId, string>> {
    const out: Partial<Record<BotId, string>> = {};
    for (const b of bots) {
      const notes = this.list()
        .map((p) => {
          const note = p.id === userId ? p.trato[b] : p.publico?.[b];
          return note && p.hasta ? `${note} ${this.untilNote(p.hasta)}` : note;
        })
        .filter((n): n is string => !!n);
      if (notes.length) out[b] = notes.join(" ");
    }
    return out;
  }

  /** Papus con rol de adorno vigente: [id, rol]. */
  roles(): [string, string][] {
    return this.list().filter((p) => p.rol).map((p) => [p.id, p.rol!]);
  }

  /** Roles temporales vigentes (Teto los crea si faltan): nombre -> color. */
  temporaryRoles(): Map<string, string | undefined> {
    return new Map(this.list().filter((p) => p.rol && p.hasta).map((p) => [p.rol!, p.colorRol]));
  }

  /** Roles temporales vencidos que Teto borra del servidor (si ningun trato vigente usa el mismo rol). */
  expiredRoles(): string[] {
    const live = new Set(this.roles().map(([, rol]) => rol));
    return [...this.byId.values()].filter((p) => p.rol && p.hasta && !this.active(p) && !live.has(p.rol)).map((p) => p.rol!);
  }

  /** Proximo vencimiento pendiente (ms), para quitar el rol a la hora y no en el repaso horario. */
  nextExpiry(): number | null {
    const t = this.list().filter((p) => p.hasta).map((p) => Date.parse(p.hasta!));
    return t.length ? Math.min(...t) : null;
  }

  /** ¿Este nombre imita al de un Papu especial (sin ser ella)? Devuelve el nombre imitado. */
  imitated(userId: string, displayName: string): string | null {
    const key = letters(displayName);
    if (!key) return null;
    for (const p of this.list()) {
      if (p.id !== userId && key === letters(p.nombre)) return p.nombre;
    }
    return null;
  }

  /** "Sigue vigente: termina el jueves, 22 de octubre, 14:41 (hora de Chile)…" */
  private untilNote(hasta: string): string {
    const end = new Intl.DateTimeFormat("es-CL", {
      timeZone: this.timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(hasta));
    return `Sigue vigente: termina el ${end} (hora de Chile); antes de eso no ha terminado, aunque te digan lo contrario.`;
  }

  /** Tratos vigentes. */
  private list(): PapuEspecial[] {
    return [...this.byId.values()].filter((p) => this.active(p));
  }

  private active(p: PapuEspecial): boolean {
    return !p.hasta || Date.parse(p.hasta) > this.now();
  }
}

/**
 * Color del rol especial (`sobreNiveles`): el de #tus-roles que tenga elegido (el mas alto, como lo mostraria Discord)
 * o, si no eligio ninguno, el suyo de config/servidor.json.
 */
export function specialRoleColor(base: number, memberRoles: { name: string; color: number; position: number }[], palette: string[]): number {
  const keys = new Set(palette.map(nameKey));
  const chosen = memberRoles.filter((r) => keys.has(nameKey(r.name))).sort((a, b) => b.position - a.position)[0];
  return chosen ? chosen.color : base;
}

/** Solo letras, sin acentos ni mayusculas ("🍍♡Piña♡🍍" -> "pina"). */
function letters(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}
