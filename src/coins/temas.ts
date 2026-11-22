// Temas de los sobres temáticos (PLAN §2 y §3.6): un personaje, una temporada o un tema (Navidad, los siete pecados,
// música). Los objetos dicen sus personajes y temas en config/objetos.json (npm run etiquetar). Los usan los sobres de
// membresía (se eligen los objetos; sin renders) y los temáticos que se ganan jugando o se compran con Shaulitas (al
// azar dentro del tema; con renders).
import type { Objeto } from "./rules";

export interface Tema {
  /** "p:teto", "t:t2", "x:navidad" o "todo". */
  id: string;
  nombre: string;
  emoji: string;
  /** Objetos del tema en el pozo que se le pasó. */
  faltan: number;
}

/** Nombre y emoji de cada personaje con objetos. */
export const PERSONAJES: Record<string, [string, string]> = {
  teto: ["Teto", "❤️"],
  miku: ["Miku", "🩵"],
  luka: ["Luka", "🩷"],
  neru: ["Neru", "💛"],
  gakupo: ["Gakupo", "🍆"],
  kaito: ["Kaito", "💙"],
  flower: ["flower", "💜"],
  ia: ["IA", "🤍"],
  haku: ["Haku", "🩶"],
  gumi: ["Gumi", "💚"],
  rin: ["Rin", "🍊"],
  len: ["Len", "🍌"],
  meiko: ["Meiko", "❤️‍🔥"],
  adachirei: ["Adachi Rei", "🧡"],
  ruko: ["Ruko", "🖤"],
};

export const TEMAS_FIJOS: Record<string, [string, string]> = {
  navidad: ["Navidad", "🎄"],
  "siete-pecados": ["Los siete pecados", "🍎"],
  musica: ["Música y escenario", "🎤"],
};

const NOMBRES_TEMPORADA: Record<string, string> = { t1: "Lanzamiento", t2: "Navidad y los 7 pecados" };

/** ¿El objeto es de ese tema? */
export function enTema(o: Objeto, tema: string): boolean {
  if (tema === "todo") return true;
  const [k, v] = [tema.slice(0, 2), tema.slice(2)];
  if (k === "p:") return o.personajes?.includes(v) ?? false;
  if (k === "t:") return o.temporada === v;
  if (k === "x:") return o.temas?.includes(v) ?? false;
  return false;
}

/** «Sobre de Gumi», «Temporada 2 «Navidad y los 7 pecados»»… */
export function nombreTema(tema: string): { nombre: string; emoji: string } {
  const [k, v] = [tema.slice(0, 2), tema.slice(2)];
  if (k === "p:" && PERSONAJES[v]) return { nombre: PERSONAJES[v][0], emoji: PERSONAJES[v][1] };
  if (k === "x:" && TEMAS_FIJOS[v]) return { nombre: TEMAS_FIJOS[v][0], emoji: TEMAS_FIJOS[v][1] };
  if (k === "t:") return { nombre: `Temporada ${v.replace(/^t/, "")} «${NOMBRES_TEMPORADA[v] ?? v}»`, emoji: "📅" };
  return { nombre: "Todo", emoji: "🎁" };
}

/** Temas con al menos `minimo` objetos en `pool` (personajes, temporadas y temas fijos), más «Todo» si se pide. */
export function temasDe(pool: readonly Objeto[], minimo: number, conTodo = true): Tema[] {
  const out: Tema[] = [];
  const push = (id: string) => {
    const faltan = pool.filter((o) => enTema(o, id)).length;
    if (faltan >= minimo) out.push({ id, ...nombreTema(id), faltan });
  };
  for (const id of Object.keys(PERSONAJES)) push(`p:${id}`);
  for (const t of [...new Set(pool.map((o) => o.temporada).filter((t) => /^t\d+$/.test(t)))].sort()) push(`t:${t}`);
  for (const id of Object.keys(TEMAS_FIJOS)) push(`x:${id}`);
  if (conTodo) out.push({ id: "todo", nombre: "Todo (cualquier tema)", emoji: "🎁", faltan: pool.length });
  return out;
}
