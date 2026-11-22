// Premio por ideas incorporadas (config/premios-ideas.json; pedido de GyroP, 18 nov. 2026): Shaulitas por cada idea
// de un Papu que llegó al servidor. Se paga una sola vez por ronda y por Papu (queda anotado en kv).
import { readFileSync } from "node:fs";
import path from "node:path";
import { kvGet, kvSet, type Db } from "../db/database";
import type { CoinService } from "./service";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export interface PremiosIdeas {
  porIdea: number;
  rondas: Record<string, { id: string; nombre: string; ideas: string[] }[]>;
}

export function loadPremiosIdeas(file = path.join(REPO_ROOT, "config/premios-ideas.json")): PremiosIdeas {
  const p = JSON.parse(readFileSync(file, "utf8")) as PremiosIdeas;
  if (!(Number.isInteger(p.porIdea) && p.porIdea > 0)) throw new Error("config/premios-ideas.json: porIdea es un entero mayor que 0");
  for (const [r, lista] of Object.entries(p.rondas))
    for (const x of lista) if (!/^\d+$/.test(x.id) || !x.ideas.length) throw new Error(`config/premios-ideas.json: ronda ${r}: ${x.nombre} necesita id de Discord e ideas`);
  return p;
}

/** Paga lo que falte. Devuelve lo pagado ahora (para el registro). */
export function pagarPremiosIdeas(db: Db, coins: CoinService, p: PremiosIdeas): { ronda: string; id: string; nombre: string; ideas: number; monto: number }[] {
  const out: { ronda: string; id: string; nombre: string; ideas: number; monto: number }[] = [];
  for (const [ronda, lista] of Object.entries(p.rondas)) {
    for (const x of lista) {
      const key = `premio-ideas:${ronda}:${x.id}`;
      if (kvGet(db, key)) continue;
      const monto = p.porIdea * x.ideas.length;
      kvSet(db, key, String(monto));
      coins.adjust(x.id, "monedas", monto, `premio por ${x.ideas.length} ${x.ideas.length === 1 ? "idea" : "ideas"} (${ronda})`);
      out.push({ ronda, id: x.id, nombre: x.nombre, ideas: x.ideas.length, monto });
    }
  }
  return out;
}
