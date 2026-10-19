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
  /** Lo que sabe cada bot de ella, solo cuando ella le escribe. */
  trato: Partial<Record<BotId, string>>;
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
    for (const bot of Object.keys(p.trato ?? {})) {
      if (!(BOT_IDS as readonly string[]).includes(bot)) throw new Error(`config/especiales.json: bot desconocido "${bot}" (${p.nombre})`);
    }
  }
  return list;
}

export class Especiales {
  private readonly byId: Map<string, PapuEspecial>;
  constructor(list: PapuEspecial[]) {
    this.byId = new Map(list.map((p) => [p.id, p]));
  }

  get(userId: string): PapuEspecial | undefined {
    return this.byId.get(userId);
  }

  unlimited(userId: string): boolean {
    return this.byId.get(userId)?.sinLimite ?? false;
  }

  /** Notas para el LLM de los bots que responden, si quien escribe tiene trato especial con alguno. */
  notesFor(userId: string, bots: BotId[]): Partial<Record<BotId, string>> {
    const trato = this.byId.get(userId)?.trato ?? {};
    return Object.fromEntries(bots.filter((b) => trato[b]).map((b) => [b, trato[b]!]));
  }

  /** Papus con rol de adorno: [id, rol]. */
  roles(): [string, string][] {
    return [...this.byId.values()].filter((p) => p.rol).map((p) => [p.id, p.rol!]);
  }

  /** ¿Este nombre imita al de un Papu especial (sin ser ella)? Devuelve el nombre imitado. */
  imitated(userId: string, displayName: string): string | null {
    const key = letters(displayName);
    if (!key) return null;
    for (const p of this.byId.values()) {
      if (p.id !== userId && key === letters(p.nombre)) return p.nombre;
    }
    return null;
  }
}

/**
 * Color del rol especial (`sobreNiveles`): el de #tu-color que tenga elegido (el mas alto, como lo mostraria Discord)
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
