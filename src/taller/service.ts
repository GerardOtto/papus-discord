// Taller de los Papus (PLAN §2; decisiones de GyroP del 13 nov. 2026): lo que las membresías escriben con /aportar.
// Atún y más: preguntas de trivia y adivinanzas de boda. Baguette y más: la frase del especial de un luchador del 1vs1.
// Celular y más: proponer un luchador invitado (1 por temporada). Triple Baka: proponer un consumible del mercado
// negro. Todo queda pendiente hasta que GyroP o un Mod lo aprueba; lo aprobado se usa solo y con crédito (las
// preguntas y adivinanzas, también para su autor: el autor sí las juega). Los luchadores y consumibles los agrega
// GyroP a mano. Sin Discord: src/discord/taller.ts.
import type { Db } from "../db/database";
import type { NivelMembresia } from "../membresias/rules";

export type TipoAporte = "pregunta" | "adivinanza" | "frase" | "luchador" | "consumible";

export interface DatosPregunta {
  texto: string;
  correcta: string;
  incorrectas: [string, string, string];
  dificultad: "facil" | "medio" | "dificil";
}
export interface DatosAdivinanza {
  vocaloid: string;
  adivinanza: string;
  respuestas: string[];
}
export interface DatosFrase {
  luchador: string;
  texto: string;
}
export interface DatosPropuesta {
  nombre: string;
  detalle: string;
}

export type DatosAporte = DatosPregunta | DatosAdivinanza | DatosFrase | DatosPropuesta;

export interface Aporte {
  id: number;
  userId: string;
  /** Nombre del Papu al escribirlo (para el crédito). */
  nombre: string;
  tipo: TipoAporte;
  datos: DatosAporte;
  estado: "pendiente" | "aprobado" | "rechazado";
  creadoAt: number;
}

/** Desde qué nivel de membresía se puede aportar cada cosa (id de config/membresias.json). */
export const DESDE: Record<TipoAporte, string> = { pregunta: "atun", adivinanza: "atun", frase: "baguette", luchador: "celular", consumible: "triple-baka" };

export const NOMBRE_APORTE: Record<TipoAporte, string> = {
  pregunta: "pregunta de trivia",
  adivinanza: "adivinanza de boda",
  frase: "frase del especial",
  luchador: "luchador invitado",
  consumible: "consumible del mercado negro",
};

/** ¿Su nivel alcanza para este aporte? (los niveles son acumulativos: vale el orden de config/membresias.json). */
export function puedeAportar(niveles: readonly NivelMembresia[], n: NivelMembresia | null, tipo: TipoAporte): boolean {
  if (!n) return false;
  return niveles.findIndex((x) => x.id === n.id) >= niveles.findIndex((x) => x.id === DESDE[tipo]);
}

export class TallerService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  private toAporte(r: Record<string, unknown>): Aporte {
    return {
      id: r.id as number,
      userId: r.user_id as string,
      nombre: r.nombre as string,
      tipo: r.tipo as TipoAporte,
      datos: JSON.parse(r.datos as string) as DatosAporte,
      estado: r.estado as Aporte["estado"],
      creadoAt: r.creado_at as number,
    };
  }

  crear(userId: string, nombre: string, tipo: TipoAporte, datos: DatosAporte): Aporte {
    const r = this.db.prepare("INSERT INTO aportes (user_id, nombre, tipo, datos, creado_at) VALUES (?, ?, ?, ?, ?)").run(userId, nombre, tipo, JSON.stringify(datos), this.now());
    return this.get(Number(r.lastInsertRowid))!;
  }

  get(id: number): Aporte | null {
    const r = this.db.prepare("SELECT * FROM aportes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? this.toAporte(r) : null;
  }

  /** Aprueba o rechaza (una sola vez). Devuelve el aporte si cambió, o null si ya estaba resuelto. */
  resolver(id: number, aprobado: boolean, por: string): Aporte | null {
    const ch = this.db.prepare("UPDATE aportes SET estado = ?, resuelto_at = ?, resuelto_por = ? WHERE id = ? AND estado = 'pendiente'").run(aprobado ? "aprobado" : "rechazado", this.now(), por, id);
    return ch.changes ? this.get(id) : null;
  }

  aprobados(tipo?: TipoAporte): Aporte[] {
    const rows = (tipo
      ? this.db.prepare("SELECT * FROM aportes WHERE estado = 'aprobado' AND tipo = ? ORDER BY id").all(tipo)
      : this.db.prepare("SELECT * FROM aportes WHERE estado = 'aprobado' ORDER BY id").all()) as Record<string, unknown>[];
    return rows.map((r) => this.toAporte(r));
  }

  /** Aportes de un tipo que hizo un Papu desde un momento (para el tope de 1 luchador por temporada). */
  contar(userId: string, tipo: TipoAporte, desde: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM aportes WHERE user_id = ? AND tipo = ? AND creado_at >= ? AND estado != 'rechazado'").get(userId, tipo, desde) as { n: number }).n;
  }

  /** Pendientes de un Papu (tope para que no llene la revisión). */
  pendientes(userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM aportes WHERE user_id = ? AND estado = 'pendiente'").get(userId) as { n: number }).n;
  }
}
