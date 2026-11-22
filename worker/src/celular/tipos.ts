// Tipos que comparten el worker, la página del celular de Neru y el script que arma sus datos (npm run celular).
import type { CelularSettings, Color, Personaje, Pista } from "../../../src/celular/rules";

export type { Color, Pista };

/** Lo que arma `npm run celular` en worker/src/celular/datos.json (solo lo lee el worker: trae los archivos de Silueta). */
export interface DatosCelular {
  settings: CelularSettings;
  /** Todos los personajes (para elegir); en Vocaloidle solo salen los completos. */
  personajes: Personaje[];
  /** Silueta: por personaje, varias imágenes; cada una con un archivo por nivel (pixelado → clara). */
  silueta: { id: string; imagenes: string[][] }[];
}

export type Tema = "neru" | "canal" | "miku" | "luka" | "kaito" | "gumi" | "tienda";
export const TEMAS: readonly Tema[] = ["neru", "canal", "miku", "luka", "kaito", "gumi", "tienda"];

export interface Prefs {
  tema: Tema;
  /** "tema" = íconos a juego con el tema (predeterminado); "orig" = colores originales. */
  iconos: "tema" | "orig";
}

export interface Perfil {
  shaulitas: number | null;
  /** Tarjeta de nivel (data URL PNG) o null mientras Neru la dibuja. */
  tarjeta: string | null;
}

export interface EstadoVocaloidle {
  numero: number;
  pistas: Pista[];
  resuelto: boolean;
  /** Para compartir, solo al resolver. */
  compartir: string | null;
  /** Aciertos de trivia que dio (o dará) al resolverlo. */
  aciertos: number | null;
  /** Ms hasta el próximo reto. */
  siguienteEn: number;
}

export interface EstadoSilueta {
  numero: number;
  /** Nombres de los intentos fallidos, en orden. */
  fallidos: string[];
  resuelto: boolean;
  /** Nivel de la imagen que se puede pedir (0 = la más pixelada). */
  nivel: number;
  niveles: number;
  /** El personaje, solo al resolver. */
  respuesta: string | null;
  compartir: string | null;
  aciertos: number | null;
  siguienteEn: number;
}

export interface Inicio {
  papu: { id: string; nombre: string; avatar: string };
  prefs: Prefs;
  perfil: Perfil;
  vocaloidle: { numero: number; resuelto: boolean; jugado: boolean };
  silueta: { numero: number; resuelto: boolean; jugado: boolean };
  /** Nombres para elegir en cada juego (en Vocaloidle, solo los que tienen todos los datos). */
  opciones: { vocaloidle: Opcion[]; silueta: Opcion[] };
}

export interface Opcion {
  id: string;
  nombre: string;
}
