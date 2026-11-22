// Neru y el ajedrez (config/ajedrez.json; 18 nov. 2026). Las partidas viven en D1 (el worker valida las jugadas); las
// Shaulitas, en la VM. Cada pocos segundos Neru: cobra las apuestas de los retos aceptados (y los empieza, o los cancela
// si a uno no le alcanza), paga al ganador al terminar (o devuelve en tablas) y avisa en #general los retos nuevos y
// los resultados. Cada cobro queda anotado en la base local antes de tocar D1: nunca se cobra ni se paga dos veces.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { D1Query } from "../cloud/d1";
import type { CoinService } from "../coins/service";
import { kvGet, kvSet, type Db } from "../db/database";
import { MOTIVO_TEXTO, premioAjedrez, type AjedrezSettings, type Fila } from "./partidas";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadAjedrezSettings(file = path.join(REPO_ROOT, "config/ajedrez.json")): AjedrezSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as AjedrezSettings;
  if (!(s.apuesta.minima > 0 && s.apuesta.maxima >= s.apuesta.minima)) throw new Error("config/ajedrez.json: apuesta.minima > 0 y maxima >= minima");
  if (!(s.comision >= 0 && s.comision < 0.5) || !(s.relojMin >= 1) || !(s.retoMin >= 1)) throw new Error("config/ajedrez.json: revisa comision (0 a 0,5), relojMin y retoMin");
  for (const r of s.rivales) if (![1, 2, 3].includes(r.nivel) || !r.frase) throw new Error(`config/ajedrez.json: rival ${r.id} necesita nivel 1, 2 o 3 y frase`);
  return s;
}

export interface AvisoAjedrez {
  tipo: "reto" | "resultado" | "cancelada";
  texto: string;
  /** A quién se etiqueta (el retado, en un reto). */
  menciones: string[];
}

export interface AjedrezPuenteDeps {
  db: Db;
  query: D1Query;
  coins: CoinService;
  settings: AjedrezSettings;
  now?: () => number;
}

export class AjedrezPuente {
  private readonly now: () => number;

  constructor(private readonly d: AjedrezPuenteDeps) {
    this.now = d.now ?? Date.now;
  }

  /** A quiénes ya se les cobró la apuesta de una partida (base local). */
  private cobrados(id: string): string[] {
    return (kvGet(this.d.db, `ajedrez:cobro:${id}`) ?? "").split(",").filter(Boolean);
  }

  private anotarCobro(id: string, papus: string[]): void {
    kvSet(this.d.db, `ajedrez:cobro:${id}`, papus.join(","));
  }

  /** Una vuelta: cobra, paga y arma los avisos. Devuelve los avisos para #general. */
  async tick(): Promise<AvisoAjedrez[]> {
    const avisos: AvisoAjedrez[] = [];
    const q = this.d.query;
    const filas = await q<Fila>("SELECT * FROM ajedrez_partidas WHERE (estado = 'aceptada' AND cobrada = 0) OR (estado IN ('terminada', 'cancelada') AND cobrada = 1 AND pagada = 0) OR avisada < 2 LIMIT 50");
    for (const f of filas) {
      if (f.estado === "aceptada" && !f.cobrada) avisos.push(...(await this.cobrar(f)));
      else if ((f.estado === "terminada" || f.estado === "cancelada") && f.cobrada && !f.pagada) await this.pagar(f);
      const nueva = (await q<Fila>("SELECT * FROM ajedrez_partidas WHERE id = ?", f.id))[0] ?? f;
      avisos.push(...(await this.avisar(nueva)));
    }
    return avisos;
  }

  /** Cobra a los dos y empieza; si a uno no le alcanza, devuelve lo cobrado y cancela. */
  private async cobrar(f: Fila): Promise<AvisoAjedrez[]> {
    const ya = this.cobrados(f.id);
    const cobrados = [...ya];
    let falta: string | null = null;
    for (const p of [f.retador, f.rival]) {
      if (cobrados.includes(p)) continue;
      if (!this.d.coins.spend(p, f.apuesta, `apuesta de ajedrez ${f.id}`)) {
        falta = p;
        break;
      }
      cobrados.push(p);
      this.anotarCobro(f.id, cobrados);
    }
    const now = this.now();
    if (!falta) {
      await this.d.query("UPDATE ajedrez_partidas SET estado = 'jugando', cobrada = 1, turno_desde = ?, actualizado_at = ? WHERE id = ? AND estado = 'aceptada'", now, now, f.id);
      return [];
    }
    for (const p of cobrados) this.d.coins.adjust(p, "monedas", f.apuesta, `ajedrez ${f.id} cancelado (devolución)`);
    this.anotarCobro(f.id, []);
    await this.d.query("UPDATE ajedrez_partidas SET estado = 'cancelada', motivo = 'sin_shaulitas', cobrada = 0, avisada = 2, actualizado_at = ? WHERE id = ? AND estado = 'aceptada'", now, f.id);
    const quien = falta === f.retador ? f.nombre_retador : f.nombre_rival;
    return [{ tipo: "cancelada", texto: `♟️ Se canceló la partida de **${f.nombre_retador}** contra **${f.nombre_rival}**: a ${quien} no le alcanzaban las ${f.apuesta} Shaulitas de la apuesta. Nadie perdió nada.`, menciones: [] }];
  }

  /** Paga al ganador (las dos apuestas menos la comisión) o devuelve en tablas y si se canceló. */
  private async pagar(f: Fila): Promise<void> {
    const key = `ajedrez:pago:${f.id}`;
    if (!kvGet(this.d.db, key)) {
      kvSet(this.d.db, key, "1");
      const cobrados = this.cobrados(f.id);
      if (f.estado === "terminada" && f.ganador && f.ganador !== "tablas") this.d.coins.adjust(f.ganador, "monedas", premioAjedrez(f.apuesta, this.d.settings.comision), `ajedrez ${f.id} ganado`);
      else for (const p of cobrados) this.d.coins.adjust(p, "monedas", f.apuesta, `ajedrez ${f.id} ${f.estado === "terminada" ? "en tablas" : "cancelado"} (devolución)`);
    }
    await this.d.query("UPDATE ajedrez_partidas SET pagada = 1 WHERE id = ?", f.id);
  }

  /** Avisos de #general: el reto (con @ al retado) y el resultado. */
  private async avisar(f: Fila): Promise<AvisoAjedrez[]> {
    const out: AvisoAjedrez[] = [];
    const apuesta = f.apuesta ? ` por **${f.apuesta}** Shaulitas` : "";
    if (f.avisada < 1 && f.estado === "reto") {
      out.push({ tipo: "reto", texto: `♟️ <@${f.retador}> retó a <@${f.rival}> a una partida de ajedrez${apuesta}. Acéptala en 📱 el celular de Neru → ♟️ Ajedrez (vence en ${this.d.settings.retoMin} min).`, menciones: [f.rival] });
      await this.d.query("UPDATE ajedrez_partidas SET avisada = 1 WHERE id = ? AND avisada < 1", f.id);
    }
    if (f.avisada < 2 && f.estado === "terminada" && (!f.apuesta || f.pagada)) {
      const motivo = MOTIVO_TEXTO[f.motivo ?? ""] ?? f.motivo ?? "";
      const jugadas = Math.ceil((f.jugadas ? f.jugadas.split(" ").length : 0) / 2);
      const texto =
        f.ganador === "tablas"
          ? `♟️ Tablas entre **${f.nombre_retador}** y **${f.nombre_rival}** (${motivo}, ${jugadas} jugadas).${f.apuesta ? " Cada uno recuperó su apuesta." : ""}`
          : (() => {
              const gana = f.ganador === f.retador ? f.nombre_retador : f.nombre_rival;
              const pierde = f.ganador === f.retador ? f.nombre_rival : f.nombre_retador;
              return `♟️ **${gana}** le ganó a **${pierde}** al ajedrez (${motivo}, ${jugadas} jugadas).${f.apuesta ? ` Se lleva **${premioAjedrez(f.apuesta, this.d.settings.comision)}** Shaulitas.` : ""}`;
            })();
      out.push({ tipo: "resultado", texto, menciones: [] });
      await this.d.query("UPDATE ajedrez_partidas SET avisada = 2 WHERE id = ?", f.id);
    } else if (f.avisada < 2 && ["rechazada", "vencida", "cancelada"].includes(f.estado) && (!f.cobrada || f.pagada)) {
      await this.d.query("UPDATE ajedrez_partidas SET avisada = 2 WHERE id = ?", f.id);
    }
    return out;
  }
}
