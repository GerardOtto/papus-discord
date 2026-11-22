// Propuesta de fondos de la temporada 2 de las Shaulitas (pedido de GyroP, 13 nov. 2026): Navidad, los 7 pecados
// capitales y los modelos nuevos, todos animados (src/coins/efectos.ts). Es una PROPUESTA: las rarezas, los nombres y
// qué entra los decide GyroP; nada de esto está en config/objetos.json todavía. Lo dibuja scripts/temporada2.ts.
//
// Personajes (de adelante hacia atrás):
//   navidad:<bot>/<reaccion>  -> assets/bots/navidad/renders/ (trajes Santa, Diva-a-Render)
//   modelo:<bot>/<reaccion>   -> assets/coleccion/renders/ (modelos nuevos con su traje: IA, flower, Adachi Rei, Ruko)
//   motor:<look>/<reaccion>   -> $ENGINE_DIR/assets/characters/ (renders propios usados en los episodios; solo lectura)
// Fotos: solo fondos del motor con licencia libre documentada (CC0, dominio público o CC BY/BY-SA con su crédito).

export type RarezaT2 = "comun" | "rara" | "epica" | "legendaria" | "mitica";

export interface FondoT2 {
  id: string;
  nombre: string;
  rareza: RarezaT2;
  efecto: string;
  colores: string[];
  /** Personajes, de adelante hacia atrás. */
  pjs: string[];
  descripcion: string;
  /** Colección a la que pertenece (para la hoja de muestras). */
  grupo: string;
  /**
   * Foto real detrás de la escena: un fondo del motor (assets/backgrounds/<fuente>.jpg, verticales de 1080×1920)
   * recortado a la banda centrada en `y` (0 arriba, 1 abajo), difuminado y oscurecido. Los fotogramas de PV de
   * terceros no se usan en objetos de la tienda.
   */
  foto?: { fuente: string; y: number; oscurecer?: number; credito: string };
  /** Ajuste por personaje (mismo orden que `pjs`): px a la derecha, px hacia abajo y factor de tamaño. */
  ajustes?: ({ dx?: number; dy?: number; escala?: number } | undefined)[];
  /** Franja horizontal (px) donde se reparten los personajes; por defecto la derecha de la tarjeta. */
  zona?: [number, number];
}

const FOTO = {
  calle: { fuente: "bg_enbi_calle_noche", y: 0.2, oscurecer: 0.35, credito: "Gion, Kioto de noche: Wikimedia Commons, CC BY-SA 4.0" },
  puente: { fuente: "bg_enbi_puente", y: 0.62, oscurecer: 0.3, credito: "Puente Shinkyo, Nikko: Wikimedia Commons, CC0" },
  casa: { fuente: "bg_enbi_casa_noche", y: 0.5, oscurecer: 0.3, credito: "Casa tradicional de Hida: Wikimedia Commons, CC0" },
  cuarto: { fuente: "bg_enbi_cuarto_noche", y: 0.55, oscurecer: 0.25, credito: "Habitación japonesa de noche: Wikimedia Commons, CC BY-SA 2.0" },
  incendio: { fuente: "bg_judg_real_incendio", y: 0.5, oscurecer: 0.2, credito: "The Burning of the Houses of Parliament (c. 1834): Wikimedia Commons, CC0" },
  tormenta: { fuente: "bg_judg_real_tormenta", y: 0.6, oscurecer: 0.3, credito: "J. C. Dahl, Morning after a Stormy Night: Wikimedia Commons, dominio público" },
  galeria: { fuente: "bg_judg_real_galeria", y: 0.45, oscurecer: 0.45, credito: "Galería de palacio: Wikimedia Commons (DPLA), dominio público" },
  comedor: { fuente: "bg_ben_comedor", y: 0.62, oscurecer: 0.4, credito: "Comedor victoriano: Wikimedia Commons, dominio público" },
  salon: { fuente: "bg_ben_salon_victoriano", y: 0.5, oscurecer: 0.45, credito: "Salón de una mansión: Wikimedia Commons, CC0" },
  cabana: { fuente: "bg_wrath_real_bosque", y: 0.62, oscurecer: 0.3, credito: "Cabaña en un bosque nevado: Wikimedia Commons, CC0" },
  bosque: { fuente: "bg_wrath_real_nieve", y: 0.45, oscurecer: 0.15, credito: "Bosque de noche bajo las estrellas: Wikimedia Commons, CC BY-SA 3.0" },
  cerezos: { fuente: "bg_wrath_real_cerezo", y: 0.35, oscurecer: 0.45, credito: "Avenida de cerezos en flor: Wikimedia Commons, CC BY-SA 4.0 (AndyScott)" },
} as const;

/** Color oscurecido (0 = negro, 1 = igual), para los cielos teñidos del color de cada Vocaloid. */
function tono(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f).toString(16).padStart(2, "0"));
  return `#${c.join("")}`;
}

// ───────────────────────── Navidad ─────────────────────────

const BOTS: [id: string, nombre: string, color: string, pose: string, efecto: "nieve" | "luces-navidad"][] = [
  ["teto", "Teto", "#E0457B", "saludando", "luces-navidad"],
  ["miku", "Miku", "#39C5BB", "saludando", "nieve"],
  ["luka", "Luka", "#F2A2C0", "feliz", "nieve"],
  ["neru", "Neru", "#E8C547", "presumido", "luces-navidad"],
  ["gakupo", "Gakupo", "#8E5BD8", "saludando", "nieve"],
  ["kaito", "Kaito", "#3D6FD9", "emocionado", "nieve"],
  ["flower", "flower", "#9A6BE0", "broma", "luces-navidad"],
  ["ia", "IA", "#F4A7C0", "timido", "nieve"],
  ["haku", "Haku", "#B8B8D0", "timido", "nieve"],
  ["gumi", "Gumi", "#7FCB4B", "broma", "luces-navidad"],
  ["rin", "Rin", "#F5C542", "riendo", "luces-navidad"],
  ["len", "Len", "#F2D25C", "presumido", "nieve"],
  ["meiko", "Meiko", "#D9473D", "riendo", "luces-navidad"],
  ["adachirei", "Adachi Rei", "#FF7A2F", "saludando", "nieve"],
  ["ruko", "Ruko", "#5B8CFF", "emocionado", "luces-navidad"],
];

const NAVIDAD: FondoT2[] = [
  ...BOTS.map(
    ([id, nombre, color, pose, efecto]): FondoT2 => ({
      id: `navidad-${id}`,
      nombre: `${nombre} en Navidad`,
      rareza: "rara",
      efecto,
      colores: [tono(color, 0.14), tono(color, 0.42)],
      pjs: [`navidad:${id}/${pose}`],
      descripcion: `${nombre} con su traje de Santa ${efecto === "nieve" ? "bajo la nieve" : "y las luces del árbol"}.`,
      grupo: "Navidad",
    }),
  ),
  { id: "navidad-kagamine", nombre: "Navidad Kagamine", rareza: "epica", efecto: "luces-navidad", colores: ["#3A0A12", "#0E3B22"], pjs: ["navidad:rin/emocionado", "navidad:len/feliz"], descripcion: "Rin y Len de Santa (y de reno) bajo las luces del árbol.", grupo: "Navidad" },
  { id: "navidad-cabana", nombre: "Navidad en la cabaña", rareza: "epica", efecto: "nieve", colores: [], pjs: ["navidad:miku/feliz", "navidad:luka/saludando"], descripcion: "Miku y Luka de Santa frente a una cabaña nevada (foto real).", grupo: "Navidad", foto: FOTO.cabana },
  { id: "navidad-utau", nombre: "Navidad UTAU", rareza: "epica", efecto: "nieve", colores: ["#1A0A22", "#4A1E4A"], pjs: ["navidad:teto/emocionado", "navidad:ruko/saludando", "navidad:adachirei/feliz"], descripcion: "Teto, Ruko y Adachi Rei: los UTAU celebran juntos.", grupo: "Navidad" },
  { id: "navidad-coro", nombre: "Villancico del Coro", rareza: "epica", efecto: "luces-navidad", colores: ["#12203A", "#2A1440"], pjs: ["navidad:gumi/emocionado", "navidad:gakupo/feliz", "navidad:ia/saludando", "navidad:flower/feliz"], descripcion: "Gumi, Gakupo, IA y flower cantando villancicos.", grupo: "Navidad" },
  { id: "navidad-crypton", nombre: "Navidad Crypton", rareza: "legendaria", efecto: "nieve", colores: ["#0B1A3A", "#2A4A7A"], pjs: ["navidad:miku/emocionado", "navidad:luka/feliz", "navidad:kaito/emocionado", "navidad:rin/feliz", "navidad:meiko/feliz", "navidad:len/feliz"], descripcion: "Los seis de Crypton con el módulo Santa de Project DIVA.", grupo: "Navidad", zona: [370, 995] },
  { id: "navidad-triple-baka", nombre: "Triple Baka navideño", rareza: "legendaria", efecto: "luces-navidad", colores: ["#3A0A12", "#0E3B22"], pjs: ["navidad:teto/broma", "navidad:miku/broma", "navidad:neru/broma"], descripcion: "Teto, Miku y Neru: el trío baka con gorro de Santa.", grupo: "Navidad" },
  { id: "nochebuena", nombre: "Nochebuena de los Papus", rareza: "mitica", efecto: "nieve", colores: [], pjs: ["navidad:miku/riendo", "navidad:luka/broma", "navidad:teto/emocionado", "navidad:neru/saludando"], descripcion: "Teto, Miku, Luka y Neru en la primera Nochebuena del servidor (bosque real bajo las estrellas).", grupo: "Navidad", foto: FOTO.bosque },
];

// ───────────────────────── Los 7 pecados capitales ─────────────────────────

const ROJO = ["#14060A", "#3A0E14", "#FF4A4A"];
// Los fuegos de los pecados van con el color de su Vocaloid (pedido de GyroP, 13 nov. 2026: «como en los videos del
// canal»): tono oscuro, principal y claro de su paleta en el motor (config/characters.json). Lujuria Gakupo, gula Meiko,
// envidia Luka, avaricia Kaito e ira Gumi; «Los pecados capitales», los siete.
const FUEGO_MORADO = ["#7A2BD9", "#C06BFF", "#FF8AE0"];

const PECADOS: FondoT2[] = [
  // Lujuria: La locura del duque Venomania.
  { id: "pecado-lujuria", nombre: "Venomania", rareza: "legendaria", efecto: "corazones", colores: ["#2A0620", "#6A1450", "#FF5FA2"], pjs: ["motor:gakupovenomania/presumido", "motor:gumigothic/timido"], descripcion: "Lujuria: el duque Venomania y Gumina.", grupo: "Lujuria" },
  { id: "venomania-duque", nombre: "El duque", rareza: "epica", efecto: "fuego", colores: ["#6B3FB8", "#A77BFF", "#DCCBFF"], pjs: ["motor:gakupovenomania/broma"], descripcion: "Lujuria: Sateriasis Venomania en el salón de su mansión (foto real).", grupo: "Lujuria", foto: FOTO.salon },
  { id: "venomania-damas", nombre: "Las damas de la mansión", rareza: "epica", efecto: "corazones", colores: ["#2A0620", "#6A1450", "#FF8AC0"], pjs: ["motor:lukaamour/timido", "motor:mikuinnocent/feliz", "motor:meikoveno/presumido"], descripcion: "Lujuria: Lukana, Mikulia y las demás, bajo el hechizo.", grupo: "Lujuria" },
  { id: "venomania-karchess", nombre: "El final del hechizo", rareza: "rara", efecto: "truenos", colores: ["#0A0C1C", "#2B2F4A", "#BFD4FF"], pjs: ["motor:kaitorequiem/enojado"], descripcion: "Lujuria: Karchess llega a la mansión.", grupo: "Lujuria" },
  // Gula: Evil Food Eater Conchita.
  { id: "pecado-gula", nombre: "Conchita", rareza: "legendaria", efecto: "fuego", colores: ["#A3181E", "#E0383E", "#FFC9C9"], pjs: ["motor:meikoconchita/presumido"], descripcion: "Gula: Banica Conchita y su banquete infinito (comedor real).", grupo: "Gula", foto: FOTO.comedor },
  { id: "conchita-sirvientes", nombre: "Los sirvientes", rareza: "epica", efecto: "fuego", colores: ["#A3181E", "#E0383E", "#FFC9C9"], pjs: ["motor:rinmuneca/broma", "motor:lenmuneco/presumido"], descripcion: "Gula: la sirvienta y el mayordomo de Conchita.", grupo: "Gula" },
  { id: "conchita-demonio", nombre: "El demonio de la gula", rareza: "epica", efecto: "incendio", colores: ["#A3181E", "#E0383E", "#FFC9C9"], pjs: ["motor:tetodemonio/riendo"], descripcion: "Gula: el demonio de la copa, con el rojo de Teto.", grupo: "Gula" },
  { id: "conchita-chef", nombre: "El decimoquinto cocinero", rareza: "rara", efecto: "fuego", colores: ["#A3181E", "#E0383E", "#FFC9C9"], pjs: ["motor:kaitochef/nervioso"], descripcion: "Gula: el cocinero que pidió unas vacaciones.", grupo: "Gula" },
  // Envidia: La sastre de Enbizaka (pedido de GyroP: pueblo, truenos, incendio y el traje especial).
  { id: "enbizaka-pueblo", nombre: "La sastre de Enbizaka", rareza: "rara", efecto: "pueblo", colores: ["#0C0A26", "#3A2350", "#FFB347"], pjs: ["motor:lukayukata/feliz"], descripcion: "Envidia: Kayo en su pueblo, una noche de faroles.", grupo: "Envidia" },
  { id: "enbizaka-calle", nombre: "Calle de Enbizaka", rareza: "rara", efecto: "pueblo", colores: ["#0C0A26", "#3A2350", "#FFB347"], pjs: ["motor:lukayukata/saludando"], descripcion: "Envidia: Kayo en la calle de su sastrería (foto real de Gion, Kioto).", grupo: "Envidia", foto: FOTO.calle },
  { id: "enbizaka-truenos", nombre: "Tormenta en Enbizaka", rareza: "epica", efecto: "truenos", colores: ["#0A0C1C", "#2B2F4A", "#BFD4FF"], pjs: ["motor:lukayukata/pensando"], descripcion: "Envidia: Kayo afila sus tijeras bajo la tormenta.", grupo: "Envidia", ajustes: [{ dx: -120 }] },
  { id: "enbizaka-puente", nombre: "El puente de Enbizaka", rareza: "epica", efecto: "truenos", colores: ["#0A0C1C", "#2B2F4A", "#BFD4FF"], pjs: ["motor:lukayukata/triste"], descripcion: "Envidia: Kayo espera en el puente bajo la tormenta (foto real del puente Shinkyo).", grupo: "Envidia", foto: FOTO.puente },
  { id: "enbizaka-incendio", nombre: "Enbizaka en llamas", rareza: "epica", efecto: "incendio", colores: ["#B0457E", "#E285B2", "#FFD6EA"], pjs: ["motor:lukayukata/decepcionado"], descripcion: "Envidia: el incendio que se lo llevó todo.", grupo: "Envidia" },
  { id: "kayo-pueblo", nombre: "Kayo: el kimono rojo", rareza: "epica", efecto: "pueblo", colores: ["#1A0614", "#4A1030", "#FF6B5A"], pjs: ["motor:lukakayo/presumido"], descripcion: "Envidia: Kayo con su traje especial (kimono rojo, obi verde y horquilla amarilla).", grupo: "Envidia" },
  { id: "kayo-taller", nombre: "Kayo: el taller a oscuras", rareza: "legendaria", efecto: "truenos", colores: ROJO, pjs: ["motor:lukakayo/presumido"], descripcion: "Envidia: Kayo con su traje especial, de noche en la sastrería (foto real de una casa de Hida).", grupo: "Envidia", foto: FOTO.casa },
  { id: "kayo-truenos", nombre: "Kayo: hoy también trabaja", rareza: "legendaria", efecto: "truenos", colores: ROJO, pjs: ["motor:lukakayo/enojado"], descripcion: "Envidia: Kayo con su traje especial bajo los truenos rojos.", grupo: "Envidia" },
  { id: "kayo-incendio", nombre: "Kayo: la envidia arde", rareza: "legendaria", efecto: "incendio", colores: ["#B0457E", "#E285B2", "#FFD6EA"], pjs: ["motor:lukakayo/riendo"], descripcion: "Envidia: Kayo con su traje especial y el pueblo en llamas verdes.", grupo: "Envidia" },
  { id: "kayo-incendio-real", nombre: "Kayo: todo arde", rareza: "legendaria", efecto: "incendio", colores: ["#B0457E", "#E285B2", "#FFD6EA"], pjs: ["motor:lukakayo/enojado"], descripcion: "Envidia: Kayo con su traje especial frente al incendio (pintura de 1834).", grupo: "Envidia", foto: FOTO.incendio },
  { id: "enbizaka-familia", nombre: "La familia de la calle", rareza: "epica", efecto: "pueblo", colores: ["#0C0A26", "#3A2350", "#FFB347"], pjs: ["motor:mikuyukata/saludando", "motor:kaitoyukata/feliz", "motor:meikoyukata/feliz", "motor:rinyukata/emocionado"], zona: [400, 995], descripcion: "Envidia: el hombre, la mujer del kimono rojo, la del obi verde y la niña de la horquilla.", grupo: "Envidia" },
  // Avaricia: Judgment of Corruption.
  { id: "pecado-avaricia", nombre: "Judgment of Corruption", rareza: "legendaria", efecto: "monedas", colores: ["#120C02", "#3A2A06"], pjs: ["motor:kaitogallerian/presumido"], descripcion: "Avaricia: el juez Gallerian Marlon en su galería (foto real).", grupo: "Avaricia", foto: FOTO.galeria },
  { id: "judgment-naufragio", nombre: "El naufragio del Titanis", rareza: "epica", efecto: "truenos", colores: ["#0A0C1C", "#2B2F4A", "#BFD4FF"], pjs: ["motor:kaitogallerian/triste"], descripcion: "Avaricia: la tormenta que lo cambió todo (pintura de J. C. Dahl).", grupo: "Avaricia", foto: FOTO.tormenta },
  { id: "judgment-infierno", nombre: "La ama del patio infernal", rareza: "epica", efecto: "fuego", colores: ["#2245C9", "#3D6BFF", "#BFD0FF"], pjs: ["motor:guminfierno/presumido"], descripcion: "Avaricia: «tu salvación depende de tu dinero».", grupo: "Avaricia" },
  { id: "judgment-muneca", nombre: "La muñeca", rareza: "rara", efecto: "sueno", colores: ["#0A0820", "#2A2050", "#C9B8FF"], pjs: ["motor:mikumuneca/neutral"], descripcion: "Avaricia: la «hija» del juez.", grupo: "Avaricia" },
  { id: "judgment-incendio", nombre: "La mansión en llamas", rareza: "epica", efecto: "incendio", colores: ["#2245C9", "#3D6BFF", "#BFD0FF"], pjs: ["motor:kaitogallerian/triste", "motor:mikumuneca/neutral"], descripcion: "Avaricia: el juez no abandona a su hija (pintura de 1834).", grupo: "Avaricia", foto: FOTO.incendio },
  // Pereza: Gift from the Princess who Brought Sleep.
  { id: "pecado-pereza", nombre: "Gift from the Princess", rareza: "legendaria", efecto: "sueno", colores: ["#0A0820", "#2A2050", "#C9B8FF"], pjs: ["motor:mikurosabianca/timido"], descripcion: "Pereza: Margarita y el regalo que hace dormir.", grupo: "Pereza" },
  { id: "gift-matrimonio", nombre: "Un matrimonio feliz", rareza: "epica", efecto: "sueno", colores: ["#0A0820", "#2A2050", "#C9B8FF"], pjs: ["motor:mikurosabianca/feliz", "motor:kaitorosaluno/decepcionado"], descripcion: "Pereza: Margarita y su esposo, que duerme tan bien.", grupo: "Pereza" },
  { id: "gift-cerezos", nombre: "El pueblo que duerme", rareza: "epica", efecto: "sueno", colores: ["#0A0820", "#2A2050", "#FFD0E8"], pjs: ["motor:mikurosabianca/saludando"], descripcion: "Pereza: Margarita reparte su regalo por Toragay (avenida de cerezos real).", grupo: "Pereza", foto: FOTO.cerezos },
  { id: "gift-gumi", nombre: "La amiga de la infancia", rareza: "rara", efecto: "nieve", colores: ["#0B1A3A", "#2A4A7A"], pjs: ["motor:gumisnow/feliz"], descripcion: "Pereza: Gumi con el traje de nieve.", grupo: "Pereza" },
  // Ira: The Muzzle of Nemesis.
  { id: "pecado-ira", nombre: "Nemesis", rareza: "legendaria", efecto: "truenos", colores: ROJO, pjs: ["motor:gumisudou/enojado"], descripcion: "Ira: Nemesis Sudou frente a la cabaña del bosque (foto real).", grupo: "Ira", foto: FOTO.cabana },
  { id: "nemesis-juicio", nombre: "El cañón de Nemesis", rareza: "legendaria", efecto: "incendio", colores: ["#3E8A1F", "#7FCB4B", "#D9F5B8"], pjs: ["motor:gumisudou/gritando", "motor:kaitogallerian/nervioso"], descripcion: "Ira: Nemesis y el juez, cara a cara.", grupo: "Ira" },
  { id: "nemesis-clarith", nombre: "Clarith", rareza: "epica", efecto: "nieve", colores: [], pjs: ["motor:hakuclarith/timido"], descripcion: "Ira: Clarith en el bosque nevado (foto real).", grupo: "Ira", foto: FOTO.bosque },
  { id: "nemesis-juez", nombre: "La jueza", rareza: "rara", efecto: "truenos", colores: ["#0A0C1C", "#2B2F4A", "#BFD4FF"], pjs: ["motor:tetojuez/presumido"], descripcion: "Ira: Teto, la narradora, dicta sentencia.", grupo: "Ira" },
  // Los siete (el orgullo es Riliane, de la temporada 1).
  { id: "siete-pecados", nombre: "Los pecados capitales", rareza: "mitica", efecto: "fuego", colores: ["#A77BFF", "#E0383E", "#E285B2", "#3D6BFF", "#39C5BB", "#7FCB4B", "#F6C744"], pjs: ["motor:lukakayo/presumido", "motor:gakupovenomania/presumido", "motor:meikoconchita/presumido", "motor:kaitogallerian/presumido", "motor:mikurosabianca/presumido", "motor:gumisudou/presumido"], descripcion: "Lujuria, gula, envidia, avaricia, pereza e ira, entre fuego de todos los colores.", grupo: "Los siete", ajustes: [undefined, { escala: 1.14, dy: -20 }] },
];

// ───────────────────────── Modelos nuevos ─────────────────────────

const NUEVOS: FondoT2[] = [
  { id: "ruko-original", nombre: "Ruko", rareza: "comun", efecto: "nieve", colores: ["#0A1230", "#27407A"], pjs: ["modelo:ruko/feliz"], descripcion: "Yokune Ruko con su traje original.", grupo: "Modelos nuevos" },
  { id: "ruko-saludo", nombre: "Ruko saluda", rareza: "rara", efecto: "truenos", colores: ["#0A0C1C", "#22305A", "#9FB8FF"], pjs: ["modelo:ruko/saludando"], descripcion: "Yokune Ruko: 196 cm de saludo.", grupo: "Modelos nuevos" },
  { id: "adachirei-original", nombre: "Adachi Rei", rareza: "comun", efecto: "fuego", colores: ["#FF7A2F", "#FFB020", "#FFE14D"], pjs: ["modelo:adachirei/feliz"], descripcion: "Adachi Rei con su bata de laboratorio.", grupo: "Modelos nuevos" },
  { id: "adachirei-saludo", nombre: "Rei saluda", rareza: "rara", efecto: "luces-navidad", colores: ["#2A1206", "#5A2A0E"], pjs: ["modelo:adachirei/saludando"], descripcion: "Adachi Rei, la robot que quiere cantar.", grupo: "Modelos nuevos" },
  { id: "ia-original", nombre: "IA", rareza: "comun", efecto: "sueno", colores: ["#1A0A1C", "#4A2440", "#FFD0E8"], pjs: ["modelo:ia/feliz"], descripcion: "IA con su traje :[R].", grupo: "Modelos nuevos" },
  { id: "ia-timida", nombre: "IA tímida", rareza: "rara", efecto: "corazones", colores: ["#2A0A20", "#5A2248", "#FFB0D0"], pjs: ["modelo:ia/timido"], descripcion: "IA: Aria on the Planetes.", grupo: "Modelos nuevos" },
  { id: "flower-original", nombre: "flower", rareza: "comun", efecto: "truenos", colores: ["#0E0A1C", "#2E2050", "#C9A8FF"], pjs: ["modelo:flower/feliz"], descripcion: "flower con su traje original.", grupo: "Modelos nuevos" },
  { id: "flower-rock", nombre: "flower rockea", rareza: "rara", efecto: "fuego", colores: FUEGO_MORADO, pjs: ["modelo:flower/presumido"], descripcion: "flower: la voz del rock.", grupo: "Modelos nuevos" },
  { id: "gakupo-original", nombre: "Gakupo", rareza: "comun", efecto: "pueblo", colores: ["#0C0A26", "#2E1E50", "#C9A8FF"], pjs: ["motor:gakupoenbi/feliz"], descripcion: "Gakupo con su traje original de samurái.", grupo: "Modelos nuevos" },
  { id: "gumi-nieve", nombre: "Gumi de nieve", rareza: "rara", efecto: "nieve", colores: ["#0A2A1A", "#2A5A3A"], pjs: ["motor:gumisnow/saludando"], descripcion: "Gumi con el traje de nieve.", grupo: "Modelos nuevos" },
  { id: "gumi-gakupo", nombre: "Gumi y Gakupo", rareza: "epica", efecto: "pueblo", colores: ["#0C0A26", "#2E1E50", "#B8FF9A"], pjs: ["motor:gumisnow/emocionado", "motor:gakupoenbi/presumido"], descripcion: "Los dos de INTERNET Co., juntos.", grupo: "Modelos nuevos" },
  { id: "utau-trio", nombre: "Los UTAU", rareza: "epica", efecto: "luces-navidad", colores: ["#1A0A22", "#12203A"], pjs: ["modelo:ruko/presumido", "modelo:adachirei/emocionado"], descripcion: "Ruko y Adachi Rei: voces hechas por fans.", grupo: "Modelos nuevos" },
];

export const FONDOS_T2: FondoT2[] = [...NAVIDAD, ...PECADOS, ...NUEVOS];

// ───────────────────────── Arte propio (bordes, barras, aros y nombres) ─────────────────────────

export interface ArteT2 {
  id: string;
  nombre: string;
  tipo: "borde" | "barra" | "aro" | "nombre";
  rareza: RarezaT2;
  animado?: boolean;
  descripcion: string;
}

/** Dibujos de src/coins/arte-t2.ts. Sin renders: se podrían comprar con cualquier moneda, como el arte de la temporada 1. */
export const ARTE_T2: ArteT2[] = [
  { id: "borde-de-caramelo", nombre: "Bastón de caramelo", tipo: "borde", rareza: "comun", descripcion: "Franjas rojas y blancas, como un bastón de caramelo." },
  { id: "guirnalda-navidena", nombre: "Guirnalda navideña", tipo: "borde", rareza: "rara", descripcion: "Guirnalda de pino con esferas rojas y doradas." },
  { id: "hilo-de-kayo", nombre: "Hilo de Kayo", tipo: "borde", rareza: "rara", descripcion: "Hilo rojo cosido alrededor, con las tijeras de la sastre de Enbizaka." },
  { id: "luces-de-navidad", nombre: "Luces de Navidad", tipo: "borde", rareza: "epica", animado: true, descripcion: "Luces de colores que se prenden por turnos." },
  { id: "escarcha", nombre: "Escarcha", tipo: "borde", rareza: "legendaria", animado: true, descripcion: "Borde de hielo con un brillo que lo recorre y copos que giran." },
  { id: "llamas-del-pecado", nombre: "Llamas del pecado", tipo: "borde", rareza: "legendaria", animado: true, descripcion: "Llamas que pasan por los colores de los siete pecados." },
  { id: "barra-de-caramelo", nombre: "Caramelo", tipo: "barra", rareza: "comun", descripcion: "Barra de bastón de caramelo." },
  { id: "nieve-acumulada", nombre: "Nieve acumulada", tipo: "barra", rareza: "rara", descripcion: "Hielo con nieve encima." },
  { id: "puntada-roja", nombre: "Puntada roja", tipo: "barra", rareza: "rara", descripcion: "Tela cosida con hilo rojo (La sastre de Enbizaka)." },
  { id: "lava", nombre: "Lava", tipo: "barra", rareza: "epica", animado: true, descripcion: "Lava que avanza con chispas." },
  { id: "barra-de-luces", nombre: "Luces en fila", tipo: "barra", rareza: "epica", animado: true, descripcion: "Luces de Navidad que corren por la barra." },
  { id: "barra-siete-pecados", nombre: "Los siete pecados", tipo: "barra", rareza: "legendaria", animado: true, descripcion: "Los colores de los siete pecados: se descubren al subir de XP." },
  { id: "corona-de-adviento", nombre: "Corona de adviento", tipo: "aro", rareza: "rara", descripcion: "Corona de pino con bayas rojas." },
  { id: "copos-en-orbita", nombre: "Copos en órbita", tipo: "aro", rareza: "epica", animado: true, descripcion: "Aro de hielo con copos que giran." },
  { id: "aro-de-fuego", nombre: "Aro de fuego", tipo: "aro", rareza: "legendaria", animado: true, descripcion: "Un aro en llamas." },
  { id: "escarchado", nombre: "Escarchado", tipo: "nombre", rareza: "rara", descripcion: "Tu nombre con letras de hielo." },
  { id: "brasas", nombre: "Brasas", tipo: "nombre", rareza: "epica", animado: true, descripcion: "Tu nombre al rojo vivo." },
  { id: "borde-lujuria", nombre: "Marco de la lujuria", tipo: "borde", rareza: "rara", descripcion: "Lujuria: marco de su color con el corazón de Venomania." },
  { id: "aro-lujuria", nombre: "Aro de la lujuria", tipo: "aro", rareza: "epica", animado: true, descripcion: "Lujuria: el corazón de Venomania gira alrededor de tu avatar." },
  { id: "barra-lujuria", nombre: "Barra de la lujuria", tipo: "barra", rareza: "rara", descripcion: "Lujuria: barra de su color con el corazón de Venomania." },
  { id: "borde-gula", nombre: "Marco de la gula", tipo: "borde", rareza: "rara", descripcion: "Gula: marco de su color con el cáliz de Conchita." },
  { id: "aro-gula", nombre: "Aro de la gula", tipo: "aro", rareza: "epica", animado: true, descripcion: "Gula: el cáliz de Conchita gira alrededor de tu avatar." },
  { id: "barra-gula", nombre: "Barra de la gula", tipo: "barra", rareza: "rara", descripcion: "Gula: barra de su color con el cáliz de Conchita." },
  { id: "borde-envidia", nombre: "Marco de la envidia", tipo: "borde", rareza: "rara", descripcion: "Envidia: marco de su color con las tijeras de Kayo." },
  { id: "aro-envidia", nombre: "Aro de la envidia", tipo: "aro", rareza: "epica", animado: true, descripcion: "Envidia: las tijeras de Kayo gira alrededor de tu avatar." },
  { id: "barra-envidia", nombre: "Barra de la envidia", tipo: "barra", rareza: "rara", descripcion: "Envidia: barra de su color con las tijeras de Kayo." },
  { id: "borde-avaricia", nombre: "Marco de la avaricia", tipo: "borde", rareza: "rara", descripcion: "Avaricia: marco de su color con la moneda del juez." },
  { id: "aro-avaricia", nombre: "Aro de la avaricia", tipo: "aro", rareza: "epica", animado: true, descripcion: "Avaricia: la moneda del juez gira alrededor de tu avatar." },
  { id: "barra-avaricia", nombre: "Barra de la avaricia", tipo: "barra", rareza: "rara", descripcion: "Avaricia: barra de su color con la moneda del juez." },
  { id: "borde-pereza", nombre: "Marco de la pereza", tipo: "borde", rareza: "rara", descripcion: "Pereza: marco de su color con la luna del sueño." },
  { id: "aro-pereza", nombre: "Aro de la pereza", tipo: "aro", rareza: "epica", animado: true, descripcion: "Pereza: la luna del sueño gira alrededor de tu avatar." },
  { id: "barra-pereza", nombre: "Barra de la pereza", tipo: "barra", rareza: "rara", descripcion: "Pereza: barra de su color con la luna del sueño." },
  { id: "borde-ira", nombre: "Marco de la ira", tipo: "borde", rareza: "rara", descripcion: "Ira: marco de su color con el rayo de Nemesis." },
  { id: "aro-ira", nombre: "Aro de la ira", tipo: "aro", rareza: "epica", animado: true, descripcion: "Ira: el rayo de Nemesis gira alrededor de tu avatar." },
  { id: "barra-ira", nombre: "Barra de la ira", tipo: "barra", rareza: "rara", descripcion: "Ira: barra de su color con el rayo de Nemesis." },
  { id: "borde-orgullo", nombre: "Marco de la orgullo", tipo: "borde", rareza: "rara", descripcion: "Orgullo: marco de su color con la corona de la hija del mal." },
  { id: "aro-orgullo", nombre: "Aro de la orgullo", tipo: "aro", rareza: "epica", animado: true, descripcion: "Orgullo: la corona de la hija del mal gira alrededor de tu avatar." },
  { id: "barra-orgullo", nombre: "Barra de la orgullo", tipo: "barra", rareza: "rara", descripcion: "Orgullo: barra de su color con la corona de la hija del mal." },
  { id: "papel-de-regalo", nombre: "Papel de regalo", tipo: "borde", rareza: "comun", descripcion: "Papel rojo con rayas doradas y un moño." },
  { id: "galleta-de-jengibre", nombre: "Galleta de jengibre", tipo: "borde", rareza: "comun", descripcion: "Borde de galleta con glaseado en zigzag." },
  { id: "tejado-nevado", nombre: "Tejado nevado", tipo: "borde", rareza: "rara", descripcion: "Nieve acumulada arriba, con carámbanos." },
  { id: "noche-estrellada", nombre: "Noche estrellada", tipo: "borde", rareza: "epica", animado: true, descripcion: "Estrellas que titilan alrededor de la tarjeta." },
  { id: "aurora-boreal", nombre: "Aurora boreal", tipo: "borde", rareza: "legendaria", animado: true, descripcion: "Una aurora que recorre el borde." },
  { id: "rueda-de-los-siete", nombre: "Rueda de los siete", tipo: "borde", rareza: "mitica", animado: true, descripcion: "Los siete pecados dan la vuelta a tu tarjeta, cada uno con su símbolo." },
  { id: "esfera-del-arbol", nombre: "Esfera del árbol", tipo: "aro", rareza: "comun", descripcion: "Tu avatar dentro de una esfera dorada." },
  { id: "gorro-de-santa", nombre: "Gorro de Santa", tipo: "aro", rareza: "rara", descripcion: "Aro rojo con peluche blanco y pompón." },
  { id: "estrella-de-belen", nombre: "Estrella de Belén", tipo: "aro", rareza: "epica", animado: true, descripcion: "Rayos dorados que laten." },
  { id: "aurora-en-orbita", nombre: "Aurora en órbita", tipo: "aro", rareza: "legendaria", animado: true, descripcion: "Una aurora que gira alrededor de tu avatar." },
  { id: "corona-de-los-siete", nombre: "Corona de los siete", tipo: "aro", rareza: "mitica", animado: true, descripcion: "Los siete pecados giran alrededor de tu avatar." },
  { id: "cinta-de-regalo", nombre: "Cinta de regalo", tipo: "barra", rareza: "comun", descripcion: "Cinta roja con filos dorados." },
  { id: "glaseado", nombre: "Glaseado", tipo: "barra", rareza: "comun", descripcion: "Galleta con glaseado en zigzag." },
  { id: "ventisca", nombre: "Ventisca", tipo: "barra", rareza: "epica", animado: true, descripcion: "Copos que cruzan la noche." },
  { id: "veneno", nombre: "Veneno", tipo: "barra", rareza: "epica", animado: true, descripcion: "Veneno morado que burbujea (Venomania)." },
  { id: "aurora", nombre: "Aurora", tipo: "barra", rareza: "legendaria", animado: true, descripcion: "Una aurora boreal en tu barra de XP." },
  { id: "navideno", nombre: "Navideño", tipo: "nombre", rareza: "comun", descripcion: "Tu nombre en rojo, blanco y verde." },
  { id: "oro-macizo", nombre: "Oro macizo", tipo: "nombre", rareza: "rara", descripcion: "Tu nombre en oro (avaricia)." },
  { id: "carmesi", nombre: "Carmesí", tipo: "nombre", rareza: "rara", descripcion: "El rojo del kimono de Kayo." },
  { id: "veneno-dulce", nombre: "Veneno dulce", tipo: "nombre", rareza: "epica", animado: true, descripcion: "Morado y rosa que se mueven (Venomania)." },
  { id: "luz-del-norte", nombre: "Luz del norte", tipo: "nombre", rareza: "legendaria", animado: true, descripcion: "Tu nombre con los colores de la aurora." },
  { id: "siete-colores", nombre: "Siete colores", tipo: "nombre", rareza: "mitica", animado: true, descripcion: "Tu nombre con los colores de los siete pecados." },
];

/** Insignias dibujadas (src/coins/arte-t2-extra.ts -> assets/coleccion/insignias/t2/<id>.png, 128×128). */
export const INSIGNIAS_DIBUJADAS_T2: { id: string; nombre: string; rareza: RarezaT2; descripcion: string }[] = [
  { id: "insignia-arbolito", nombre: "Arbolito", rareza: "comun", descripcion: "Un árbol de Navidad con su estrella." },
  { id: "insignia-regalo", nombre: "Regalo", rareza: "comun", descripcion: "Un regalo por abrir." },
  { id: "insignia-copo", nombre: "Copo de nieve", rareza: "comun", descripcion: "Un copo de nieve." },
  { id: "insignia-baston", nombre: "Bastón de caramelo", rareza: "comun", descripcion: "Un bastón de caramelo." },
  { id: "insignia-galleta", nombre: "Galleta de jengibre", rareza: "comun", descripcion: "Un muñequito de jengibre." },
  { id: "insignia-muneco", nombre: "Muñeco de nieve", rareza: "rara", descripcion: "Un muñeco de nieve con bufanda." },
  { id: "insignia-campana", nombre: "Campana", rareza: "rara", descripcion: "Una campana con su moño." },
  { id: "insignia-gorro", nombre: "Gorro de Santa", rareza: "rara", descripcion: "El gorro que usan todos los Vocaloids." },
  { id: "insignia-estrella", nombre: "Estrella de Belén", rareza: "epica", descripcion: "La estrella de la punta del árbol." },
  { id: "insignia-lujuria", nombre: "Lujuria", rareza: "rara", descripcion: "Lujuria: el corazón de Venomania." },
  { id: "insignia-gula", nombre: "Gula", rareza: "rara", descripcion: "Gula: el cáliz de Conchita." },
  { id: "insignia-envidia", nombre: "Envidia", rareza: "rara", descripcion: "Envidia: las tijeras de Kayo." },
  { id: "insignia-avaricia", nombre: "Avaricia", rareza: "rara", descripcion: "Avaricia: la moneda del juez." },
  { id: "insignia-pereza", nombre: "Pereza", rareza: "rara", descripcion: "Pereza: la luna del sueño." },
  { id: "insignia-ira", nombre: "Ira", rareza: "rara", descripcion: "Ira: el rayo de Nemesis." },
  { id: "insignia-orgullo", nombre: "Orgullo", rareza: "rara", descripcion: "Orgullo: la corona de la hija del mal." },
  { id: "insignia-siete", nombre: "Los siete", rareza: "epica", descripcion: "La rueda de los siete pecados capitales." },
];

// ───────────────────────── Insignias y títulos ─────────────────────────

export interface TextoT2 {
  id: string;
  tipo: "insignia" | "titulo";
  rareza: RarezaT2;
  /** Insignia: el emoji. Título: el texto. */
  valor: string;
  nombre: string;
  descripcion: string;
}

/** Como en la temporada 1: la insignia es un emoji junto al nombre y el título reemplaza la frase de la tarjeta. */
export const TEXTOS_T2: TextoT2[] = [
  { id: "titulo-espiritu", tipo: "titulo", rareza: "comun", valor: "Espíritu navideño", nombre: "Espíritu navideño", descripcion: "Para quien ya puso el árbol." },
  { id: "titulo-reno", tipo: "titulo", rareza: "comun", valor: "Reno suplente", nombre: "Reno suplente", descripcion: "Por si Len se cansa." },
  { id: "titulo-ayudante", tipo: "titulo", rareza: "rara", valor: "Ayudante de Santa", nombre: "Ayudante de Santa", descripcion: "Reparte regalos con los Vocaloids." },
  { id: "titulo-cliente", tipo: "titulo", rareza: "rara", valor: "Cliente de la sastrería", nombre: "Cliente de la sastrería", descripcion: "Envidia: mejor no llegar tarde." },
  { id: "titulo-invitado", tipo: "titulo", rareza: "rara", valor: "Invitado al banquete", nombre: "Invitado al banquete", descripcion: "Gula: come todo lo que hay en el plato." },
  { id: "titulo-encantado", tipo: "titulo", rareza: "epica", valor: "Bajo el hechizo de Venomania", nombre: "Bajo el hechizo de Venomania", descripcion: "Lujuria: nadie se resiste al duque." },
  { id: "titulo-juez", tipo: "titulo", rareza: "epica", valor: "Juez de la corrupción", nombre: "Juez de la corrupción", descripcion: "Avaricia: la sentencia se compra." },
  { id: "titulo-dormilon", tipo: "titulo", rareza: "epica", valor: "Durmiente de Toragay", nombre: "Durmiente de Toragay", descripcion: "Pereza: recibió el regalo de la princesa." },
  { id: "titulo-sastre", tipo: "titulo", rareza: "legendaria", valor: "Sastre de Enbizaka", nombre: "Sastre de Enbizaka", descripcion: "Envidia: hoy también trabaja duro." },
  { id: "titulo-nemesis", tipo: "titulo", rareza: "legendaria", valor: "Mano de Nemesis", nombre: "Mano de Nemesis", descripcion: "Ira: el final del juez." },
  { id: "titulo-nochebuena", tipo: "titulo", rareza: "comun", valor: "Esperando la Nochebuena", nombre: "Esperando la Nochebuena", descripcion: "Cuenta los días." },
  { id: "titulo-ponche", tipo: "titulo", rareza: "comun", valor: "Catador de ponche", nombre: "Catador de ponche", descripcion: "Con piquete o sin piquete." },
  { id: "titulo-posada", tipo: "titulo", rareza: "rara", valor: "Rey de las posadas", nombre: "Rey de las posadas", descripcion: "No se pierde ninguna." },
  { id: "titulo-pinata", tipo: "titulo", rareza: "rara", valor: "Rompepiñatas", nombre: "Rompepiñatas", descripcion: "Dale, dale, dale." },
  { id: "titulo-grinch", tipo: "titulo", rareza: "epica", valor: "El que odia la Navidad", nombre: "El que odia la Navidad", descripcion: "Alguien tenía que serlo." },
  { id: "titulo-santa", tipo: "titulo", rareza: "legendaria", valor: "Santa de los Papus", nombre: "Santa de los Papus", descripcion: "Reparte regalos a todo el servidor." },
  { id: "titulo-sirviente", tipo: "titulo", rareza: "rara", valor: "Sirviente de Conchita", nombre: "Sirviente de Conchita", descripcion: "Gula: ojalá no falte comida." },
  { id: "titulo-cocinero", tipo: "titulo", rareza: "epica", valor: "Decimoquinto cocinero", nombre: "Decimoquinto cocinero", descripcion: "Gula: pidió vacaciones." },
  { id: "titulo-avaro", tipo: "titulo", rareza: "rara", valor: "Todo tiene un precio", nombre: "Todo tiene un precio", descripcion: "Avaricia: la frase del juez." },
  { id: "titulo-insomne", tipo: "titulo", rareza: "rara", valor: "Sin sueño en Toragay", nombre: "Sin sueño en Toragay", descripcion: "Pereza: el único que no se durmió." },
  { id: "titulo-furia", tipo: "titulo", rareza: "epica", valor: "La ira de Nemesis", nombre: "La ira de Nemesis", descripcion: "Ira: mejor no hacerla enojar." },
  { id: "titulo-orgullo", tipo: "titulo", rareza: "epica", valor: "¡Arrodíllense ante mí!", nombre: "¡Arrodíllense ante mí!", descripcion: "Orgullo: la frase de la hija del mal." },
  { id: "titulo-utau", tipo: "titulo", rareza: "rara", valor: "Fan de los UTAU", nombre: "Fan de los UTAU", descripcion: "Teto, Ruko, Adachi Rei y compañía." },
  { id: "titulo-siete", tipo: "titulo", rareza: "mitica", valor: "Los siete pecados capitales", nombre: "Los siete pecados capitales", descripcion: "Para quien completó la saga (arcoíris, como los títulos míticos)." },
];

// ───────────────────────── Fondos con arte de los PV oficiales ─────────────────────────

/**
 * Fondos comunes y fijos con fotogramas de los PV oficiales de la saga (pedido de GyroP, 13 nov. 2026: «piezas de arte
 * horizontales, sin modelos de Project DIVA»). Se sacan de los PV que el motor ya tiene en $ENGINE_DIR/.cache (solo
 * lectura), en `t` segundos, recortando la franja de 435 px de alto que empieza en `y` (de 720): desde la cabeza de los
 * personajes hacia abajo (pedido de GyroP: que se les vean las caras) y sin la letra que los PV muestran abajo. Arte de terceros con su crédito: como los renders, solo con Shaulitas.
 */
export interface FondoPV {
  id: string;
  nombre: string;
  pv: keyof typeof PVS;
  t: number;
  y: number;
  descripcion: string;
  grupo: string;
  /** El personaje del arte queda a la izquierda: se ve mejor con /tarjeta lado: derecha (la muestra se dibuja así). */
  lado?: "derecha";
  /**
   * Encuadre (18 nov. 2026): [x, y, ancho, alto] del personaje en el fotograma de 1280×720. Va a la izquierda, a todo el
   * alto de la tarjeta, sobre el fotograma difuminado (para los que quedaban al centro o cortados). Con esto, `y` no
   * se usa y conviene `lado: "derecha"`.
   */
  ventana?: [number, number, number, number];
}

export const PVS = {
  veno: { video: "veno_pv/zz4b7bBZ1N8.mp4", credito: "PV oficial de La locura del duque Venomania (mothy, ilustración 鈴ノ助, 2010)" },
  conch: { video: "conch_pv/8QMWmr2mFKk.mp4", credito: "PV oficial de Evil Food Eater Conchita (mothy, ilustración 壱加, 2009)" },
  enbi: { video: "enbi_pv/etn41n6wtAQ.mp4", credito: "PV oficial de La sastre de Enbizaka (mothy, ilustraciones de varios artistas, 2009)" },
  judg: { video: "judg_pv/xC_lHFBen5k.mp4", credito: "PV oficial de Judgment of Corruption (mothy, ilustración ゆーりん@北乃友利, 2011)" },
  sleep: { video: "sleep_pv/hmDK_uJu7kQ.mp4", credito: "PV oficial de Gift from the Princess who Brought Sleep (mothy, ilustración 壱加)" },
  wrath: { video: "wrath_pv/AHjxLoeYIoI.mp4", credito: "PV oficial de The Muzzle of Nemesis (mothy, ilustración 壱加)" },
} as const;

export const FONDOS_PV: FondoPV[] = [
  { id: "pv-venomania-mansion", nombre: "La mansión del duque", pv: "veno", t: 7, y: 40, descripcion: "Lujuria: la mansión Venomania de noche.", grupo: "Lujuria" },
  { id: "pv-venomania-harem", nombre: "El harén", pv: "veno", t: 160, y: 0, descripcion: "Lujuria: el salón del duque y sus damas.", grupo: "Lujuria", ventana: [320, 0, 580, 580] },
  { id: "pv-venomania-abrazo", nombre: "El abrazo", pv: "veno", t: 200, y: 0, descripcion: "Lujuria: el duque y Lukana.", grupo: "Lujuria", ventana: [40, 0, 660, 580] },
  { id: "pv-venomania-gumina", nombre: "Gumina", pv: "veno", t: 140, y: 0, descripcion: "Lujuria: Gumina Glassred.", grupo: "Lujuria", ventana: [200, 0, 580, 580] },
  { id: "pv-venomania-pasillo", nombre: "El pasillo de las velas", pv: "veno", t: 190, y: 0, descripcion: "Lujuria: el duque le tiende la mano.", grupo: "Lujuria", ventana: [400, 0, 600, 640] },
  { id: "pv-conchita-trono", nombre: "El banquete de Banica", pv: "conch", t: 45, y: 30, descripcion: "Gula: Banica Conchita en su trono, con los gemelos.", grupo: "Gula", ventana: [380, 20, 560, 620] },
  { id: "pv-conchita-vestido", nombre: "El vestido rojo", pv: "conch", t: 80, y: 0, descripcion: "Gula: Banica y su vestido rojo.", grupo: "Gula" },
  { id: "pv-conchita-rostro", nombre: "Banica Conchita", pv: "conch", t: 130, y: 40, descripcion: "Gula: el rostro de Banica.", grupo: "Gula", lado: "derecha" },
  { id: "pv-conchita-jaula", nombre: "El trono vacío", pv: "conch", t: 200, y: 0, descripcion: "Gula: ya no queda nadie.", grupo: "Gula" },
  { id: "pv-enbizaka-luna", nombre: "Luna sobre Enbizaka", pv: "enbi", t: 82, y: 0, descripcion: "Envidia: Kayo bajo la luna.", grupo: "Envidia", lado: "derecha" },
  { id: "pv-enbizaka-obi", nombre: "El obi verde", pv: "enbi", t: 290, y: 0, descripcion: "Envidia: el obi verde.", grupo: "Envidia", ventana: [330, 0, 620, 640] },
  { id: "pv-judgment-familia", nombre: "Padre e hija", pv: "judg", t: 140, y: 0, descripcion: "Avaricia: el juez y su hija.", grupo: "Avaricia", lado: "derecha" },
  { id: "pv-judgment-llamas", nombre: "La mansión arde", pv: "judg", t: 175, y: 0, descripcion: "Avaricia: el incendio de la mansión.", grupo: "Avaricia" },
  { id: "pv-judgment-galaxia", nombre: "El juez sonríe", pv: "judg", t: 240, y: 40, descripcion: "Avaricia: Gallerian en el cielo estrellado.", grupo: "Avaricia", ventana: [0, 120, 720, 600] },
  { id: "pv-judgment-infierno", nombre: "Llamas azules", pv: "judg", t: 281, y: 0, descripcion: "Avaricia: el fuego azul del Infierno.", grupo: "Avaricia" },
  { id: "pv-gift-fantasma", nombre: "Margarita", pv: "sleep", t: 210, y: 0, descripcion: "Pereza: Margarita de blanco.", grupo: "Pereza", lado: "derecha" },
  { id: "pv-gift-ciudad", nombre: "La ciudad dormida", pv: "sleep", t: 240, y: 0, descripcion: "Pereza: Toragay ya no despierta.", grupo: "Pereza" },
  { id: "pv-gift-boda", nombre: "La boda", pv: "sleep", t: 70, y: 0, descripcion: "Pereza: Margarita y su esposo.", grupo: "Pereza" },
  { id: "pv-nemesis-mar", nombre: "El mar de Nemesis", pv: "wrath", t: 200, y: 0, descripcion: "Ira: Nemesis frente al mar.", grupo: "Ira" },
  { id: "pv-nemesis-noche", nombre: "Noche de nieve", pv: "wrath", t: 69, y: 40, descripcion: "Ira: el bosque nevado.", grupo: "Ira", ventana: [600, 130, 640, 440] },
  { id: "pv-nemesis-estudio", nombre: "El estudio del juez", pv: "wrath", t: 48, y: 0, descripcion: "Ira: el estudio, antes de todo.", grupo: "Ira" },
];
