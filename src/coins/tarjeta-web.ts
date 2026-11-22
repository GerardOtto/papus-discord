// Personalizar la tarjeta en la web (worker/src/tarjeta/api.ts): lo que el bot le cuenta a la página (lo que el Papu
// tiene y lleva puesto) y cómo aplica lo que la página pide. La página nunca decide: aquí solo pasa lo que el Papu de
// verdad tiene (regla: los objetos se consiguen en la tienda, sobres o fabricando, nunca desde la web).
import type { CoinService } from "./service";
import type { Objeto, Tipo } from "./rules";

export const RANURAS_SIMPLES = ["fondo", "borde", "barra", "nombre", "aro", "titulo"] as const satisfies readonly Tipo[];
type Ranura = (typeof RANURAS_SIMPLES)[number];

export interface Eleccion extends Record<Ranura, string | null> {
  insignias: string[];
  lado: "izquierda" | "derecha";
}

export interface Snapshot {
  nombre: string;
  objetos: { id: string; nombre: string; tipo: Tipo; rareza: string; animado: boolean }[];
  equipado: Eleccion;
  /** La tarjeta actual (JPEG en base64), para que la página no empiece vacía. */
  tarjeta?: string;
}

/** Lo que lleva puesto ahora, con la forma que usa la página. */
export function equipadoActual(coins: Pick<CoinService, "equipped">, userId: string, lado: string | null): Eleccion {
  const eq = coins.equipped(userId);
  const e = Object.fromEntries(RANURAS_SIMPLES.map((r) => [r, eq.get(r)?.id ?? null])) as Record<Ranura, string | null>;
  const insignias = [...eq.entries()].filter(([k]) => k.startsWith("insignia")).sort(([a], [b]) => a.localeCompare(b)).map(([, o]) => o.id);
  return { ...e, insignias, lado: lado === "derecha" ? "derecha" : "izquierda" };
}

/** Su colección (en el orden del catálogo) y lo puesto. */
export function snapshot(coins: Pick<CoinService, "equipped" | "owned" | "catalog">, userId: string, nombre: string, lado: string | null): Snapshot {
  const own = coins.owned(userId);
  return {
    nombre,
    objetos: coins.catalog
      .filter((o) => own.has(o.id))
      .map((o) => ({ id: o.id, nombre: o.nombre, tipo: o.tipo, rareza: o.rareza, animado: !!o.animado })),
    equipado: equipadoActual(coins, userId, lado),
  };
}

/**
 * Lo elegido, solo con lo que el Papu tiene y del tipo correcto (lo demás se descarta). Devuelve las ranuras como las
 * usa la tarjeta (insignia1..3) y lo descartado.
 */
export function elegidos(coins: Pick<CoinService, "owned" | "byId">, userId: string, e: Eleccion): { equipo: Map<string, Objeto>; descartados: string[] } {
  const own = coins.owned(userId);
  const equipo = new Map<string, Objeto>();
  const descartados: string[] = [];
  const valido = (id: string, tipo: Tipo) => {
    const o = coins.byId.get(id);
    if (o && o.tipo === tipo && own.has(id)) return o;
    descartados.push(id);
    return null;
  };
  for (const r of RANURAS_SIMPLES) {
    const id = e[r];
    const o = id ? valido(id, r) : null;
    if (o) equipo.set(r, o);
  }
  [...new Set(e.insignias)].slice(0, 3).forEach((id) => {
    const o = valido(id, "insignia");
    if (o) equipo.set(`insignia${[...equipo.keys()].filter((k) => k.startsWith("insignia")).length + 1}`, o);
  });
  return { equipo, descartados };
}

/** Guarda lo elegido (solo lo que tiene). */
export function aplicar(coins: Pick<CoinService, "owned" | "byId" | "equip">, userId: string, e: Eleccion): { descartados: string[] } {
  const { equipo, descartados } = elegidos(coins, userId, e);
  for (const r of RANURAS_SIMPLES) coins.equip(userId, r, equipo.get(r) ? [equipo.get(r)!.id] : null);
  coins.equip(userId, "insignia", [...equipo.entries()].filter(([k]) => k.startsWith("insignia")).map(([, o]) => o.id));
  return { descartados };
}
