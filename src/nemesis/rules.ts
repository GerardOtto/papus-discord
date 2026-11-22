// Reglas de la Ruleta de Némesis (config/nemesis.json, PLAN §3.12). Funciones puras: la config, los límites de la
// apuesta, el reparto (el ganador se lleva las dos apuestas menos la tajada de Némesis) y de quién es cada turno.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface NemesisSettings {
  activo: boolean;
  canal: string;
  respaldo: string;
  apuesta: { minima: number; maxima: number };
  /** Parte de la apuesta del perdedor que se queda Némesis (0,2 = 20 %). */
  tajada: number;
  recamaras: number;
  aceptarMinutos: number;
  turnoSegundos: number;
  pausaMs: number;
  /** Desafíos de los Vocaloids a Papus activos (14 nov. 2026); sin la sección, no desafían. */
  bots?: NemesisBotSettings;
}

export interface NemesisBotSettings {
  activo: boolean;
  /** Máximo de desafíos de los Vocaloids por día (en promedio salen unos tantos). */
  porDia: number;
  /** Ventana del día (horas en la zona de la cuota): desde las `desde` hasta antes de las `hasta`. */
  desde: number;
  hasta: number;
  /** Minutos mínimos entre un desafío de los Vocaloids y el siguiente. */
  esperaMinutos: number;
  /** "Activo recientemente" = escribió hace como mucho esto. */
  activoMinutos: number;
  /** A un mismo Papu, un desafío de los Vocaloids cada esto como mucho. */
  esperaPapuHoras: number;
  apuestaInicial: number;
  /** Factor con que sube la apuesta cada vez que gana el Vocaloid. */
  subida: number;
  /** Segundos que tarda el Vocaloid en jalar su gatillo. */
  botSegundos: number;
  canal: string;
  respaldo: string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadNemesisSettings(file = path.join(REPO_ROOT, "config/nemesis.json")): NemesisSettings {
  const s = JSON.parse(readFileSync(file, "utf8")) as NemesisSettings;
  const { minima, maxima } = s.apuesta ?? ({} as NemesisSettings["apuesta"]);
  if (!(Number.isInteger(minima) && minima > 0 && Number.isInteger(maxima) && maxima >= minima)) throw new Error("config/nemesis.json: apuesta.minima > 0 y maxima >= minima (enteros)");
  if (!(s.tajada >= 0 && s.tajada < 1)) throw new Error("config/nemesis.json: tajada va de 0 a menos de 1");
  if (!(Number.isInteger(s.recamaras) && s.recamaras >= 2 && s.recamaras <= 8)) throw new Error("config/nemesis.json: recamaras va de 2 a 8");
  if (!(s.aceptarMinutos > 0 && s.turnoSegundos >= 5 && s.pausaMs >= 0)) throw new Error("config/nemesis.json: tiempos inválidos");
  const b = s.bots;
  if (b) {
    if (!(Number.isInteger(b.apuestaInicial) && b.apuestaInicial >= minima && b.apuestaInicial <= maxima)) throw new Error("config/nemesis.json: bots.apuestaInicial va de apuesta.minima a apuesta.maxima");
    if (!(b.subida >= 1)) throw new Error("config/nemesis.json: bots.subida >= 1");
    if (!(b.porDia >= 0 && b.desde >= 0 && b.hasta <= 24 && b.desde < b.hasta)) throw new Error("config/nemesis.json: bots.porDia >= 0 y 0 <= desde < hasta <= 24");
    if (!(b.esperaMinutos >= 0 && b.activoMinutos > 0 && b.esperaPapuHoras >= 0 && b.botSegundos >= 1)) throw new Error("config/nemesis.json: tiempos de bots inválidos");
  }
  return s;
}

/** ¿Vale esta apuesta? (entera, entre minima y maxima, y que le alcancen las ganadas). */
export function checkApuesta(s: NemesisSettings, cantidad: number, ganadas: number): { ok: true } | { ok: false; motivo: string } {
  const { minima, maxima } = s.apuesta;
  if (!Number.isInteger(cantidad) || cantidad <= 0) return { ok: false, motivo: `Escribe un número entero de Shaulitas (de ${minima} a ${maxima}).` };
  if (cantidad < minima) return { ok: false, motivo: `La apuesta mínima es de ${minima} Shaulitas.` };
  if (cantidad > maxima) return { ok: false, motivo: `La apuesta máxima es de ${maxima} Shaulitas.` };
  if (cantidad > ganadas) return { ok: false, motivo: `No te alcanza: tienes ${ganadas} Shaulitas.` };
  return { ok: true };
}

/** Reparto: Némesis se queda `tajada` de la apuesta del perdedor; el ganador recibe el resto y la suya. */
export function reparto(s: NemesisSettings, apuesta: number): { tajada: number; premio: number } {
  const tajada = Math.round(apuesta * s.tajada);
  return { tajada, premio: apuesta * 2 - tajada };
}

/** Quién jala el gatillo en el turno `turno` (0, 1, 2…): 0 = el retador, 1 = el rival. */
export function shooterAt(primero: 0 | 1, turno: number): 0 | 1 {
  return ((primero + turno) % 2) as 0 | 1;
}

/** Probabilidad de que salga la bala en el turno `turno` (las recámaras anteriores ya salieron vacías). */
export function chanceAt(s: NemesisSettings, turno: number): number {
  return 1 / (s.recamaras - turno);
}

// ───────────────────────── desafíos de los Vocaloids ─────────────────────────

/** Apuesta del próximo desafío de los Vocaloids tras `racha` victorias seguidas de la casa (sube y tiene tope). */
export function apuestaCasa(s: NemesisSettings, racha: number): number {
  const b = s.bots;
  if (!b) return s.apuesta.minima;
  return Math.min(s.apuesta.maxima, Math.round(b.apuestaInicial * b.subida ** Math.max(0, racha)));
}

/** ¿La hora `hora` (0-23, zona de la cuota) cae en la ventana de los desafíos de los Vocaloids? */
export function enVentana(b: NemesisBotSettings, hora: number): boolean {
  return hora >= b.desde && hora < b.hasta;
}

/** Probabilidad por minuto de lanzar un desafío, para que salgan en promedio `porDia` repartidos en la ventana. */
export function chancePorMinuto(b: NemesisBotSettings): number {
  return Math.min(1, b.porDia / ((b.hasta - b.desde) * 60));
}
