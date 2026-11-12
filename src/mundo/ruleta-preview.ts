// Ruleta de demostración para Plaza preview. No llama a RouletteService.spin()
// ni consume tiradas, XP, monedas, sobres o inventario.
import type { Accion } from "../../worker/src/mundo/acciones";
import type { RouletteService } from "../ruleta/service";
import type { Atender } from "./puente";
import { ruletaEstado } from "./ruleta";

const COOLDOWN_MS = 5_000;

export function accionesRuletaPreview(
  roulette: RouletteService,
  now: () => number = Date.now,
  rnd: () => number = Math.random,
): Pick<Record<Accion, Atender>, "ruleta.estado" | "ruleta.girar"> {
  const ultimoGiro = new Map<string, number>();
  return {
    "ruleta.estado": (papu) => {
      const estado = ruletaEstado(roulette, papu.id);
      return {
        ok: true,
        datos: {
          ...estado,
          tiradas: 0,
          usadas: 0,
          extras: [],
          soloLectura: true,
          simulacion: true,
        },
      };
    },
    "ruleta.girar": (papu) => {
      const estado = roulette.status(papu.id);
      if (estado.blocked) return { ok: false, motivo: "🚫 Neru te bloqueó la ruleta: tampoco se permiten giros de prueba." };
      const t = now();
      const ultimo = ultimoGiro.get(papu.id);
      if (ultimo !== undefined && t - ultimo < COOLDOWN_MS) {
        return { ok: false, motivo: `Espera ${Math.ceil((COOLDOWN_MS - (t - ultimo)) / 1000)} s para probar otro giro.` };
      }
      const premios = roulette.settings.premios;
      if (!premios.length) return { ok: false, motivo: "La ruleta no tiene casillas configuradas." };
      const index = Math.min(premios.length - 1, Math.floor(Math.max(0, Math.min(0.999999, rnd())) * premios.length));
      const premio = premios[index]!;
      ultimoGiro.set(papu.id, t);
      return {
        ok: true,
        datos: {
          giro: {
            papu: papu.id,
            nombre: papu.nombre,
            index,
            titulo: `🧪 DEMO · ${premio.etiqueta}`,
            subtitulo: "Resultado simulado · sin premio real",
            origen: "plaza",
          },
          texto: `Simulación: ${premio.nombre}. No se consumió una tirada ni se entregó una recompensa.`,
          tiradas: 0,
          simulado: true,
        },
      };
    },
  };
}
