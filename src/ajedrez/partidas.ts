// Partidas de ajedrez entre Papus (config/ajedrez.json; 18 nov. 2026). Las guarda el worker en D1 (tabla
// ajedrez_partidas) y las valida con src/ajedrez/motor.ts; la página del celular pregunta el estado cada 1,5 s. Sin
// dependencias de Node: corre en el worker y en las pruebas.
//   reto → (sin apuesta) jugando → terminada
//   reto → (con apuesta) aceptada → Neru cobra a los dos → jugando → terminada → Neru paga (o cancelada si a uno no le
//   alcanzaba: se le devuelve al otro)
// Los relojes se descuentan al jugar y al leer: si al que le toca se le acabó el tiempo, pierde.
import { aplicar, buscarJugada, clavePosicion, escribirFen, final, INICIAL, leerFen, uci, type Color, type Final } from "./motor";

/** Lo mismo que src/cloud/sql.ts (aquí sin importarlo: la página del celular no debe arrastrar tipos de Node). */
export interface Sql {
  get<T>(sql: string, ...args: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...args: unknown[]): Promise<T[]>;
  run(sql: string, ...args: unknown[]): Promise<{ lastRowId: number; changes: number }>;
}

export interface AjedrezSettings {
  activo: boolean;
  apuesta: { minima: number; maxima: number };
  comision: number;
  relojMin: number;
  retoMin: number;
  rivales: { id: string; nivel: 1 | 2 | 3; frase: string }[];
}

export type EstadoPartida = "reto" | "aceptada" | "jugando" | "terminada" | "rechazada" | "vencida" | "cancelada";
export type Motivo = Exclude<Final, null> | "tiempo" | "abandono";

export interface Fila {
  id: string;
  retador: string;
  rival: string;
  nombre_retador: string;
  nombre_rival: string;
  /** Quién lleva las blancas (se sortea al aceptar). */
  blanco: string | null;
  apuesta: number;
  estado: EstadoPartida;
  fen: string;
  jugadas: string;
  reloj_blanco: number;
  reloj_negro: number;
  turno_desde: number | null;
  ganador: string | null;
  motivo: string | null;
  creado_at: number;
  actualizado_at: number;
  cobrada: number;
  pagada: number;
  avisada: number;
}

export interface Vista {
  id: string;
  estado: EstadoPartida;
  retador: { id: string; nombre: string };
  rival: { id: string; nombre: string };
  apuesta: number;
  /** Tu color (null si aún no se sortea o no juegas). */
  tuColor: Color | null;
  blanco: string | null;
  fen: string;
  jugadas: string[];
  /** Milisegundos que le quedan a cada uno, ya descontado lo que lleva pensando el que mueve. */
  relojes: { w: number; b: number };
  turno: Color;
  ganador: string | null;
  motivo: string | null;
  venceAt: number | null;
}

export class UserError extends Error {}

const LETRAS = "abcdefghijkmnopqrstuvwxyz23456789";
function nuevoId(): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return [...b].map((x) => LETRAS[x % LETRAS.length]).join("");
}

export class Partidas {
  private readonly now: () => number;
  private readonly rnd: () => number;

  constructor(
    private readonly sql: Sql,
    private readonly s: AjedrezSettings,
    opts: { now?: () => number; rnd?: () => number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.rnd = opts.rnd ?? Math.random;
  }

  private async fila(id: string): Promise<Fila | null> {
    return (await this.sql.get<Fila>("SELECT * FROM ajedrez_partidas WHERE id = ?", id)) ?? null;
  }

  private colorDe(f: Fila, papu: string): Color | null {
    if (!f.blanco || (papu !== f.retador && papu !== f.rival)) return null;
    return papu === f.blanco ? "w" : "b";
  }

  private negro(f: Fila): string | null {
    return f.blanco ? (f.blanco === f.retador ? f.rival : f.retador) : null;
  }

  /** Relojes al momento (descontando lo que lleva pensando el que mueve). */
  private relojes(f: Fila, at = this.now()): { w: number; b: number } {
    const r = { w: f.reloj_blanco, b: f.reloj_negro };
    if (f.estado === "jugando" && f.turno_desde !== null) r[leerFen(f.fen).turno] -= at - f.turno_desde;
    return { w: Math.max(0, r.w), b: Math.max(0, r.b) };
  }

  vista(f: Fila, papu: string): Vista {
    return {
      id: f.id,
      estado: f.estado,
      retador: { id: f.retador, nombre: f.nombre_retador },
      rival: { id: f.rival, nombre: f.nombre_rival },
      apuesta: f.apuesta,
      tuColor: this.colorDe(f, papu),
      blanco: f.blanco,
      fen: f.fen,
      jugadas: f.jugadas ? f.jugadas.split(" ") : [],
      relojes: this.relojes(f),
      turno: leerFen(f.fen).turno,
      ganador: f.ganador,
      motivo: f.motivo,
      venceAt: f.estado === "reto" ? f.creado_at + this.s.retoMin * 60_000 : null,
    };
  }

  /** Revisa los tiempos: retos vencidos y relojes en cero. Devuelve la fila al día (o null). */
  private async alDia(f: Fila): Promise<Fila> {
    const now = this.now();
    if (f.estado === "reto" && now >= f.creado_at + this.s.retoMin * 60_000) {
      await this.sql.run("UPDATE ajedrez_partidas SET estado = 'vencida', actualizado_at = ? WHERE id = ? AND estado = 'reto'", now, f.id);
      return (await this.fila(f.id))!;
    }
    if (f.estado === "jugando") {
      const turno = leerFen(f.fen).turno;
      if (this.relojes(f, now)[turno] <= 0) {
        const ganador = turno === "w" ? this.negro(f)! : f.blanco!;
        await this.terminar(f, ganador, "tiempo", f.fen, f.jugadas);
        return (await this.fila(f.id))!;
      }
    }
    return f;
  }

  private async terminar(f: Fila, ganador: string | null, motivo: Motivo, fen: string, jugadas: string): Promise<void> {
    await this.sql.run(
      "UPDATE ajedrez_partidas SET estado = 'terminada', ganador = ?, motivo = ?, fen = ?, jugadas = ?, turno_desde = NULL, actualizado_at = ? WHERE id = ? AND estado = 'jugando'",
      ganador ?? "tablas",
      motivo,
      fen,
      jugadas,
      this.now(),
      f.id,
    );
  }

  // ───────────────────────── consultas ─────────────────────────

  async ver(id: string, papu: string): Promise<Vista> {
    const f = await this.fila(id);
    if (!f || (f.retador !== papu && f.rival !== papu)) throw new UserError("Esa partida no existe o no es tuya.");
    return this.vista(await this.alDia(f), papu);
  }

  /** Lo tuyo: retos que hiciste o te hicieron, partidas en curso y las últimas terminadas. */
  async mias(papu: string): Promise<Vista[]> {
    const filas = await this.sql.all<Fila>(
      "SELECT * FROM ajedrez_partidas WHERE (retador = ? OR rival = ?) AND (estado IN ('reto', 'aceptada', 'jugando') OR actualizado_at > ?) ORDER BY creado_at DESC LIMIT 20",
      papu,
      papu,
      this.now() - 86_400_000,
    );
    const out: Vista[] = [];
    for (const f of filas) out.push(this.vista(await this.alDia(f), papu));
    return out;
  }

  // ───────────────────────── retos ─────────────────────────

  async retar(de: { id: string; nombre: string }, a: { id: string; nombre: string }, apuesta: number): Promise<Vista> {
    if (!this.s.activo) throw new UserError("El ajedrez está cerrado por ahora.");
    if (de.id === a.id) throw new UserError("No puedes retarte a ti mismo.");
    const { minima, maxima } = this.s.apuesta;
    if (!Number.isInteger(apuesta) || (apuesta !== 0 && (apuesta < minima || apuesta > maxima))) throw new UserError(`La apuesta va de ${minima} a ${maxima} Shaulitas (o 0, sin apuesta).`);
    for (const quien of [de.id, a.id]) {
      const activas = await this.sql.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM ajedrez_partidas WHERE (retador = ? OR rival = ?) AND estado IN ('reto', 'aceptada', 'jugando') AND creado_at > ?",
        quien,
        quien,
        this.now() - this.s.retoMin * 60_000 - 2 * this.s.relojMin * 60_000 - 60_000,
      );
      if ((activas?.n ?? 0) > 0) throw new UserError(quien === de.id ? "Ya tienes un reto o una partida en curso: termínala antes." : `${a.nombre} ya tiene un reto o una partida en curso.`);
    }
    const id = nuevoId();
    const now = this.now();
    const ms = this.s.relojMin * 60_000;
    await this.sql.run(
      `INSERT INTO ajedrez_partidas (id, retador, rival, nombre_retador, nombre_rival, apuesta, estado, fen, jugadas, reloj_blanco, reloj_negro, creado_at, actualizado_at)
       VALUES (?, ?, ?, ?, ?, ?, 'reto', ?, '', ?, ?, ?, ?)`,
      id,
      de.id,
      a.id,
      de.nombre,
      a.nombre,
      apuesta,
      INICIAL,
      ms,
      ms,
      now,
      now,
    );
    return this.ver(id, de.id);
  }

  /** El retado acepta (se sortean los colores) o rechaza; el retador lo puede cancelar. */
  async responder(id: string, papu: string, accion: "aceptar" | "rechazar" | "cancelar"): Promise<Vista> {
    const f0 = await this.fila(id);
    if (!f0) throw new UserError("Ese reto no existe.");
    const f = await this.alDia(f0);
    if (f.estado !== "reto") throw new UserError("Ese reto ya no está abierto.");
    const now = this.now();
    if (accion === "cancelar") {
      if (f.retador !== papu) throw new UserError("Solo quien retó puede cancelarlo.");
      await this.sql.run("UPDATE ajedrez_partidas SET estado = 'cancelada', motivo = 'retirado', actualizado_at = ? WHERE id = ? AND estado = 'reto'", now, id);
      return this.ver(id, papu);
    }
    if (f.rival !== papu) throw new UserError("Ese reto es para otro Papu.");
    if (accion === "rechazar") {
      await this.sql.run("UPDATE ajedrez_partidas SET estado = 'rechazada', actualizado_at = ? WHERE id = ? AND estado = 'reto'", now, id);
      return this.ver(id, papu);
    }
    const blanco = this.rnd() < 0.5 ? f.retador : f.rival;
    // Con apuesta, Neru primero cobra a los dos (estado 'aceptada'); sin apuesta, empieza ya.
    if (f.apuesta > 0) await this.sql.run("UPDATE ajedrez_partidas SET estado = 'aceptada', blanco = ?, actualizado_at = ? WHERE id = ? AND estado = 'reto'", blanco, now, id);
    else await this.sql.run("UPDATE ajedrez_partidas SET estado = 'jugando', blanco = ?, turno_desde = ?, actualizado_at = ? WHERE id = ? AND estado = 'reto'", blanco, now, now, id);
    return this.ver(id, papu);
  }

  // ───────────────────────── jugar ─────────────────────────

  async jugar(id: string, papu: string, texto: string): Promise<Vista> {
    const f0 = await this.fila(id);
    if (!f0) throw new UserError("Esa partida no existe.");
    const f = await this.alDia(f0);
    if (f.estado !== "jugando") throw new UserError(f.estado === "terminada" ? "La partida ya terminó." : "La partida todavía no empieza.");
    const p = leerFen(f.fen);
    const mio = this.colorDe(f, papu);
    if (!mio) throw new UserError("No juegas en esta partida.");
    if (mio !== p.turno) throw new UserError("No es tu turno.");
    const j = buscarJugada(p, texto);
    if (!j) throw new UserError("Esa jugada no se puede.");
    const now = this.now();
    const usado = now - (f.turno_desde ?? now);
    const reloj = mio === "w" ? { reloj_blanco: f.reloj_blanco - usado, reloj_negro: f.reloj_negro } : { reloj_blanco: f.reloj_blanco, reloj_negro: f.reloj_negro - usado };
    const nueva = aplicar(p, j);
    const jugadas = f.jugadas ? `${f.jugadas} ${uci(j)}` : uci(j);
    // Triple repetición: se repasan las jugadas desde el principio.
    let q = leerFen(INICIAL);
    const vistas = new Map<string, number>([[clavePosicion(q), 1]]);
    for (const x of jugadas.split(" ")) {
      q = aplicar(q, buscarJugada(q, x)!);
      vistas.set(clavePosicion(q), (vistas.get(clavePosicion(q)) ?? 0) + 1);
    }
    const fen = escribirFen(nueva);
    // Solo se guarda si nadie jugó entre medio (la misma lista de jugadas).
    const r = await this.sql.run(
      "UPDATE ajedrez_partidas SET fen = ?, jugadas = ?, reloj_blanco = ?, reloj_negro = ?, turno_desde = ?, actualizado_at = ? WHERE id = ? AND estado = 'jugando' AND jugadas = ?",
      fen,
      jugadas,
      reloj.reloj_blanco,
      reloj.reloj_negro,
      now,
      now,
      id,
      f.jugadas,
    );
    if (!r.changes) throw new UserError("La partida cambió mientras jugabas: vuelve a intentarlo.");
    const fin = final(nueva, vistas.get(clavePosicion(nueva)) ?? 1);
    if (fin) await this.terminar({ ...f, estado: "jugando" }, fin === "jaque_mate" ? papu : null, fin, fen, jugadas);
    return this.ver(id, papu);
  }

  async rendirse(id: string, papu: string): Promise<Vista> {
    const f0 = await this.fila(id);
    if (!f0) throw new UserError("Esa partida no existe.");
    const f = await this.alDia(f0);
    const mio = this.colorDe(f, papu);
    if (f.estado !== "jugando" || !mio) throw new UserError("No hay partida tuya en curso.");
    await this.terminar(f, mio === "w" ? this.negro(f) : f.blanco, "abandono", f.fen, f.jugadas);
    return this.ver(id, papu);
  }
}

/** Lo que cobra el ganador de una partida con apuesta: las dos apuestas menos la comisión (redondeado hacia abajo). */
export const premioAjedrez = (apuesta: number, comision: number): number => Math.floor(2 * apuesta * (1 - comision));

export const MOTIVO_TEXTO: Record<string, string> = {
  jaque_mate: "jaque mate",
  ahogado: "rey ahogado (tablas)",
  material: "sin material para dar mate (tablas)",
  cincuenta: "50 jugadas sin capturas (tablas)",
  repeticion: "triple repetición (tablas)",
  tiempo: "se le acabó el tiempo",
  abandono: "abandono",
};
