// Pesca de la Plaza: el bot es la unica autoridad que concede XP.
// El Worker nunca escribe en la base SQLite ni decide recompensas definitivas.
import type { Atender } from "./puente";
import type { LevelService } from "../levels/service";
import { recompensaPesca, textoRecompensaPesca, type TamanoPez } from "../pesca/reglas";

const COOLDOWN_MS = 30_000;
const PESOS: readonly [TamanoPez, number][] = [
  ["pequeno", 0.55],
  ["mediano", 0.32],
  ["grande", 0.13],
];

function elegir(rnd: () => number): TamanoPez {
  let n = Math.min(0.999999, Math.max(0, rnd()));
  for (const [tamano, peso] of PESOS) {
    n -= peso;
    if (n < 0) return tamano;
  }
  return "grande";
}

/** Crea el manejador de pesca para el puente de la Plaza. */
export function accionPesca(
  levels: LevelService,
  now: () => number = Date.now,
  rnd: () => number = Math.random,
): Atender {
  const ultimoLance = new Map<string, number>();
  return (papu) => {
    const t = now();
    const ultimo = ultimoLance.get(papu.id) ?? 0;
    if (t - ultimo < COOLDOWN_MS) {
      const segundos = Math.ceil((COOLDOWN_MS - (t - ultimo)) / 1000);
      return { ok: false, motivo: `La caña necesita descansar ${segundos} s. 🎣` };
    }
    if (!levels.canEarn(papu.id, t)) {
      return { ok: false, motivo: "Neru te bloqueó temporalmente la XP; hoy no puedes obtener recompensas. 🚫" };
    }

    const antes = levels.store.get(papu.id).xp;
    const tamano = elegir(rnd);
    const recompensa = recompensaPesca(levels.settings, antes, tamano);
    if (!recompensa) return { ok: false, motivo: "No pude calcular la captura. Inténtalo de nuevo." };

    ultimoLance.set(papu.id, t);
    const cambio = recompensa.xp > 0 ? levels.bonus(papu.id, recompensa.xp, t) : null;
    const despues = levels.store.get(papu.id).xp;
    return {
      ok: true,
      datos: {
        tamano,
        xp: recompensa.xp,
        porcentaje: Math.round(recompensa.porcentaje * 100),
        texto: textoRecompensaPesca(recompensa),
        nivelAntes: cambio?.from ?? levels.snapshot(papu.id).level,
        nivelDespues: cambio?.to ?? levels.snapshot(papu.id).level,
        xpTotal: despues,
        cooldownMs: COOLDOWN_MS,
      },
    };
  };
}
