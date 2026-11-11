// "Foto" del servidor para la Plaza de los Papus (PLAN §3.10): lo que muestran sus zonas sin que nadie haga nada. El
// bot la arma cada minuto y la deja en la base D1 del worker (src/mundo/puente.ts); la plaza la lee al entrar y cada
// pocos minutos. Solo datos publicos del servidor (lo mismo que ya se ve en Discord), nunca nada privado.

import type { Casilla } from "../../worker/src/mundo/acciones";

export interface EstadoMundo {
  /** La boda mas reciente (vigente o ya terminada): la Vocaloid y el Papu, juntos en el altar. */
  boda: { bot: string; papuId: string; nombre: string; desde: number; hasta: number; vigente: boolean } | null;
  /** La pelea abierta o la ultima, en la arena. */
  pelea: { a: Luchador; b: Luchador; estado: string; cierraAt: number; ganador: string | null } | null;
  /** Mercado negro: abierto ahora, o cuando abre el proximo. */
  mercado: { abierto: boolean; abre: number; cierra: number };
  /** Los tres primeros del ranking de niveles, para los podios. */
  fama: { papuId: string; nombre: string; nivel: number; prestigio: number; rango: string }[];
  /** El ultimo sorteo de GyroP. */
  sorteo: { premio: string; papuId: string; nombre: string; at: number } | null;
  /** Casillas de la ruleta grande (config/ruleta.json -> premios), para dibujarla igual que en Discord. */
  ruleta: Casilla[];
  at: number;
}

export interface Luchador {
  id: string;
  nombre: string;
  cuota: number;
}

export interface EstadoDeps {
  ultimaBoda: () => { bot: string; userId: string; name: string; startedAt: number; endsAt: number; divorcedAt: number | null } | null;
  pelea: () => { a: string; b: string; cuotas: [number, number]; estado: string; cierraAt: number; ganador: string | null } | null;
  mercado: () => { abierto: boolean; apertura: { abre: number; cierra: number } };
  ranking: () => { userId: string; level: number; prestige: number; rank: { nombre: string } }[];
  ultimoSorteo: () => { userId: string; detalle: string; at: number } | null;
  /** Nombre que se ve de un Papu (su apodo en el servidor). */
  nombre: (userId: string) => string;
  /** Nombre de un luchador del 1vs1 (Vocaloid o invitado). */
  luchador: (id: string) => string;
  /** Casillas de la ruleta (vacio sin ruleta). */
  casillas?: () => Casilla[];
  now?: () => number;
}

export function armarEstado(d: EstadoDeps): EstadoMundo {
  const at = (d.now ?? Date.now)();
  const b = d.ultimaBoda();
  const fin = b ? Math.min(b.endsAt, b.divorcedAt ?? Number.POSITIVE_INFINITY) : 0;
  const p = d.pelea();
  const m = d.mercado();
  const s = d.ultimoSorteo();
  let premio = "";
  if (s) {
    try {
      premio = String((JSON.parse(s.detalle) as { premio?: unknown }).premio ?? "");
    } catch {
      premio = "";
    }
  }
  return {
    boda: b ? { bot: b.bot, papuId: b.userId, nombre: b.name, desde: b.startedAt, hasta: fin, vigente: fin > at } : null,
    pelea: p
      ? {
          a: { id: p.a, nombre: d.luchador(p.a), cuota: p.cuotas[0] },
          b: { id: p.b, nombre: d.luchador(p.b), cuota: p.cuotas[1] },
          estado: p.estado,
          cierraAt: p.cierraAt,
          ganador: p.ganador,
        }
      : null,
    mercado: { abierto: m.abierto, abre: m.apertura.abre, cierra: m.apertura.cierra },
    ruleta: d.casillas?.() ?? [],
    fama: d
      .ranking()
      .slice(0, 3)
      .map((r) => ({ papuId: r.userId, nombre: d.nombre(r.userId), nivel: r.level, prestigio: r.prestige, rango: r.rank.nombre })),
    sorteo: s ? { premio: premio.slice(0, 80), papuId: s.userId, nombre: d.nombre(s.userId), at: s.at } : null,
    at,
  };
}

/** Lo mismo sin la hora: para publicar solo cuando algo cambio. */
export function huella(e: EstadoMundo): string {
  const { at: _at, ...resto } = e;
  return JSON.stringify(resto);
}
