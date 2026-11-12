// Tipos del mundo de los Papus (prototipo de Actividad 3D): los comparten la sala (worker/src/mundo/) y la pagina
// (worker/mundo/cliente/). Sin tipos de Cloudflare ni del DOM.
import type { Accion, Giro, Resultado } from "./acciones";

/** Como se ve el personaje: indices de las listas de `ASPECTOS` (juego.ts). */
export interface Aspecto {
  ropa: number;
  piel: number;
  sombrero: number;
}

/** 0 quieto, 1 camina, 2 corre. */
export type Andar = 0 | 1 | 2;

/** Donde esta y que hace: x/z en el suelo, r = hacia donde mira (radianes), m = 1 si va en montura. */
export interface Pose {
  x: number;
  z: number;
  r: number;
  a: Andar;
  m: 0 | 1;
}

export interface PapuPublico extends Pose {
  id: string;
  nombre: string;
  aspecto: Aspecto;
}

/** Lo que manda la pagina. */
export type Pedido =
  | { t: "hola"; token?: string; prueba?: { id: string; nombre: string }; aspecto?: Aspecto }
  | ({ t: "mov" } & Pose)
  | { t: "chat"; texto: string }
  | { t: "aspecto"; aspecto: Aspecto }
  /** Se sienta o se levanta junto a la fogata. */
  | { t: "sentarse"; sentado: boolean }
  /** Le pide al bot algo de un comando (ruleta…); `ref` vuelve con el resultado. */
  | { t: "accion"; accion: Accion; datos?: unknown; ref: number }
  /** Solicita la tarjeta pública de un Papu conectado. */
  | { t: "tarjeta"; papu: string; ref: number; compartir?: boolean }
  /** Salto a una zona (/ruleta lleva a la ruleta grande). */
  | { t: "ir"; lugar: string };

/** Giro en la ruleta grande, con lo que le falta para terminar (sin depender del reloj de cada pagina). */
export type GiroEnCurso = Giro & { restanteMs: number };

/** Lo que manda la sala. */
export type Aviso =
  | { t: "bienvenida"; yo: string; papus: PapuPublico[] }
  | { t: "entra"; papu: PapuPublico }
  | { t: "sale"; id: string }
  /** `s`: salto (comando /ruleta…): los demas lo ponen ahi sin deslizarlo. */
  | ({ t: "mov"; id: string; s?: 1 } & Pose)
  | { t: "chat"; id: string; texto: string }
  | { t: "aspecto"; id: string; aspecto: Aspecto }
  /** Estado social de cada Papu en la fogata. */
  | { t: "fogata"; id: string; sentado: boolean }
  /** Movimiento rechazado (muy rapido o fuera del mapa): la pagina vuelve a esta pose. */
  | ({ t: "corrige" } & Pose)
  | { t: "aviso"; texto: string }
  | { t: "error"; texto: string }
  /** Lo que dice un Vocaloid de la plaza al @ de un Papu (como en Discord: respuesta, escribiendo o reaccion). */
  | ({ t: "vocaloid"; bot: string; papu: string } & Respuesta)
  /** Nivel y cuota del dia del Papu (null = sin limite). */
  | { t: "stats"; nivel: number; prestigio: number; restante: number | null; limite: number | null; ruletas: number }
  /** Datos publicos de perfil (nunca incluye cuota, monedas ni tiradas). */
  | { t: "perfil"; id: string; nivel: number; prestigio: number }
  /** Tarjeta pública generada por el bot; nunca incluye cuota ni tiradas. */
  | { t: "tarjeta"; ref: number; papu: string; estado: "lista" | "error"; mime?: string; datos?: string; motivo?: string }
  /** Tarjeta propia anunciada a todos los miembros conectados de esta misma sala. */
  | { t: "tarjeta-compartida"; ref: number; papu: string; mime: string; datos: string }
  /** Resultado de una accion pedida por este Papu. */
  | { t: "accion"; ref: number; accion: Accion; resultado: Resultado }
  /** La ruleta grande: el giro de ahora y la fila (de la plaza y de Discord). */
  | { t: "ruleta"; actual: GiroEnCurso | null; cola: Pick<Giro, "papu" | "nombre" | "origen">[] };

/** Respuesta de un Vocaloid: texto, "escribiendo…", una reaccion (⏳ espera, 🌙 sin cuota) o un aviso solo para el Papu. */
export interface Respuesta {
  tipo: "texto" | "escribiendo" | "reaccion" | "aviso";
  texto: string;
}
