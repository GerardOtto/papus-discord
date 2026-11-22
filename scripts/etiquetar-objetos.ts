// Etiqueta los objetos de config/objetos.json (arte propio y fondos con renders) con sus personajes y temas, para los sobres temáticos de
// las membresías (PLAN §2). Se corre una vez (y de nuevo al sumar objetos): npm run etiquetar. Solo agrega o corrige
// los campos `personajes` y `temas`; no toca nada más. La relación de cada objeto sale de su nombre o descripción
// (Teto, Miku…) y, en la saga de los siete pecados, del personaje de cada canción que la descripción ya nombra.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.resolve(import.meta.dirname, "../config/objetos.json");

/** Pecado -> personaje de su canción (Evillious Chronicles; la descripción de cada objeto nombra la canción). */
const PECADOS: Record<string, string> = {
  lujuria: "gakupo", // Venomania
  gula: "meiko", // Conchita
  envidia: "luka", // La sastre de Enbizaka (Kayo)
  avaricia: "kaito", // El juicio de la corrupción (el juez)
  pereza: "miku", // El regalo de la princesa que trajo el sueño (Toragay)
  ira: "gumi", // The Muzzle of Nemesis
  orgullo: "rin", // La hija del mal
};

const PERSONAJES: Record<string, string[]> = {
  "taladros-de-teto": ["teto"],
  "ritmo-de-teto": ["teto"],
  "insignia-baguette": ["teto"],
  "insignia-fan-teto": ["teto"],
  "titulo-taladro-oficial": ["teto"],
  "titulo-utau": ["teto", "ruko", "adachirei"],
  "puerro-trenzado": ["miku"],
  "insignia-puerro": ["miku"],
  "insignia-fan-miku": ["miku"],
  "titulo-coleccionista": ["miku"],
  "atun-plateado": ["luka"],
  "corazones-de-luka": ["luka"],
  "insignia-atun": ["luka"],
  "insignia-fan-luka": ["luka"],
  "hilo-de-kayo": ["luka"],
  "puntada-roja": ["luka"],
  carmesi: ["luka"],
  "insignia-celular-de-neru": ["neru"],
  "insignia-fan-neru": ["neru"],
  "insignia-helado-de-kaito": ["kaito"],
  "insignia-fan-kaito": ["kaito"],
  "oro-macizo": ["kaito"],
  "insignia-naranja-de-rin": ["rin"],
  "insignia-platano-de-len": ["len"],
  "titulo-reno": ["len"],
  "insignia-fan-gumi": ["gumi"],
  "insignia-fan-adachirei": ["adachirei"],
  "insignia-fan-flower": ["flower"],
  veneno: ["gakupo"],
  "veneno-dulce": ["gakupo"],
  "titulo-cliente": ["luka"],
  "titulo-sastre": ["luka"],
  "titulo-invitado": ["meiko"],
  "titulo-sirviente": ["meiko"],
  "titulo-cocinero": ["meiko"],
  "titulo-encantado": ["gakupo"],
  "titulo-juez": ["kaito"],
  "titulo-avaro": ["kaito"],
  "titulo-dormilon": ["miku"],
  "titulo-insomne": ["miku"],
  "titulo-nemesis": ["gumi"],
  "titulo-furia": ["gumi"],
  "titulo-orgullo": ["rin"],
};

/** Objetos de la Navidad (temporada 2) que no son de los siete pecados. */
const NAVIDAD = [
  "borde-de-caramelo", "guirnalda-navidena", "luces-de-navidad", "escarcha", "barra-de-caramelo", "nieve-acumulada", "barra-de-luces",
  "corona-de-adviento", "copos-en-orbita", "escarchado", "papel-de-regalo", "galleta-de-jengibre", "tejado-nevado", "noche-estrellada",
  "aurora-boreal", "esfera-del-arbol", "gorro-de-santa", "estrella-de-belen", "aurora-en-orbita", "cinta-de-regalo", "glaseado", "ventisca",
  "aurora", "navideno", "luz-del-norte", "insignia-arbolito", "insignia-regalo", "insignia-copo", "insignia-baston", "insignia-galleta",
  "insignia-muneco", "insignia-campana", "insignia-gorro", "insignia-estrella", "titulo-espiritu", "titulo-reno", "titulo-ayudante",
  "titulo-nochebuena", "titulo-ponche", "titulo-posada", "titulo-pinata", "titulo-grinch", "titulo-santa",
];

/** Objetos de música y escenario (temporada 1). */
const MUSICA = [
  "cinta-de-casete", "pentagrama", "cables-de-microfono", "luces-del-mirai", "ecualizador", "onda-de-voz", "notas-en-orbita",
  "insignia-microfono", "titulo-recien-llegado", "titulo-voz-del-mirai", "papel-pautado", "sala-de-ensayo", "mar-de-luces",
];

/**
 * Fondos con renders (para los sobres temáticos que se ganan jugando o se compran con Shaulitas; los de membresía no
 * los traen). El nombre dice quién sale («Teto saluda», «Gumi en Navidad»); los de grupo, sus integrantes según su
 * descripción; los de la saga, el personaje de la canción (como en PECADOS).
 */
const RENDERS_GRUPO: Record<string, string[]> = {
  "gemelos-del-mal": ["rin", "len"],
  "la-hija-del-mal": ["rin"],
  "el-sirviente-del-mal": ["len"],
  "el-intercambio": ["rin", "len"],
  "triple-baka": ["miku", "teto", "neru"],
  "principe-azul": ["kaito"],
  "chica-del-pais-verde": ["miku"],
  "espadachina-roja": ["meiko"],
  "familia-crypton": ["miku", "rin", "len", "luka", "kaito", "meiko"],
  "halloween-elluka": ["luka"],
  "navidad-kagamine": ["rin", "len"],
  "navidad-cabana": ["miku", "luka"],
  "navidad-utau": ["teto", "ruko", "adachirei"],
  "navidad-coro": ["gumi", "gakupo", "ia", "flower"],
  "navidad-crypton": ["miku", "rin", "len", "luka", "kaito", "meiko"],
  "navidad-triple-baka": ["miku", "teto", "neru"],
  nochebuena: ["teto", "miku", "luka", "neru"],
  "gumi-gakupo": ["gumi", "gakupo"],
  "utau-trio": ["ruko", "adachirei"],
  "gift-gumi": ["gumi", "miku"],
  "nemesis-juez": ["gumi", "teto"],
};
/** Prefijo del id de los renders de la saga -> pecado (su personaje sale de PECADOS). */
const RENDERS_SAGA: [RegExp, string][] = [
  [/^(pecado-lujuria|venomania-|pv-venomania-)/, "lujuria"],
  [/^(pecado-gula|conchita-|pv-conchita-)/, "gula"],
  [/^(enbizaka-|kayo-|pv-enbizaka-)/, "envidia"],
  [/^(pecado-avaricia|judgment-|pv-judgment-)/, "avaricia"],
  [/^(pecado-pereza|gift-|pv-gift-)/, "pereza"],
  [/^(pecado-ira|nemesis-|pv-nemesis-)/, "ira"],
];
const NOMBRES_RENDER = ["teto", "miku", "luka", "neru", "rin", "len", "kaito", "meiko", "haku", "gakupo", "flower", "ia", "gumi", "adachirei", "ruko"];

function personajesRender(id: string): string[] {
  if (RENDERS_GRUPO[id]) return RENDERS_GRUPO[id];
  const saga = RENDERS_SAGA.find(([re]) => re.test(id));
  if (saga) return [PECADOS[saga[1]]!];
  if (id === "siete-pecados") return [...new Set(Object.values(PECADOS))];
  // «teto-saludo», «navidad-gumi», «ruko-original», «adachirei-saludo»…
  return NOMBRES_RENDER.filter((p) => id.split("-").includes(p));
}

interface Obj {
  id: string;
  personajes?: string[];
  temas?: string[];
  [k: string]: unknown;
}

const doc = JSON.parse(readFileSync(FILE, "utf8")) as { objetos: Obj[] };
let n = 0;
for (const o of doc.objetos) {
  const pecado = Object.keys(PECADOS).find((p) => o.id === `borde-${p}` || o.id === `aro-${p}` || o.id === `barra-${p}` || o.id === `insignia-${p}`);
  const render = o.origen === "render" && o.tipo === "fondo" && o.rareza !== "fundador";
  const personajes = [...new Set([...(PERSONAJES[o.id] ?? []), ...(pecado ? [PECADOS[pecado]!] : []), ...(render ? personajesRender(o.id) : [])])];
  const temas: string[] = [];
  if (pecado || /pecado|siete|venomania|conchita|kayo|enbizaka|nemesis|toragay|juez/i.test(`${o.id} ${String(o.descripcion ?? "")}`)) temas.push("siete-pecados");
  if (NAVIDAD.includes(o.id) || (render && (o.id.startsWith("navidad-") || o.id === "nochebuena"))) temas.push("navidad");
  if (MUSICA.includes(o.id)) temas.push("musica");
  const antes = JSON.stringify([o.personajes ?? [], o.temas ?? []]);
  if (personajes.length) o.personajes = personajes;
  else delete o.personajes;
  if (temas.length) o.temas = temas;
  else delete o.temas;
  if (JSON.stringify([o.personajes ?? [], o.temas ?? []]) !== antes) n++;
}

writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`${n} objetos etiquetados en config/objetos.json`);
