// Tipos de la trivia multijugador (Actividad de Discord, PLAN §3.4): los comparten el pool (scripts/actividad.ts), la
// sala (worker/src/actividad/juego.ts), su Durable Object y la pagina (worker/actividad/cliente/).

export type Dificultad = "facil" | "medio" | "dificil";
/** Que preguntas entran en la partida: una dificultad o todas mezcladas. */
export type Eleccion = Dificultad | "mezcla";
/** eliminatoria: quien falla queda fuera. cooperativo: el equipo pierde cuando todos fallaron al menos una vez. */
export type Modo = "eliminatoria" | "cooperativo";
export type Fase = "sala" | "pregunta" | "revelar" | "fin";

/** Pregunta del pool (con la respuesta: solo la ve el worker, nunca la pagina antes de revelarla). */
export interface PreguntaPool {
  id: string;
  tipo: "opciones" | "texto";
  dificultad: Dificultad;
  /** Para revisar que el pool tenga de todo (opciones-canciones, texto-adivinanzas, audio-opciones, imagen-silueta…). */
  categoria: string;
  tema?: string;
  texto: string;
  respuesta: string;
  /** opciones: las incorrectas (3, o 1 en verdadero o falso). */
  otras: string[];
  /** texto: respuestas que valen (incluye `respuesta`). */
  aceptadas: string[];
  dato?: string;
  /** Imagen o audio, servido en /actividad/media/<archivo> (nombre que no delata la respuesta). */
  media?: { tipo: "audio" | "imagen"; archivo: string };
  segundos: number;
}

export interface Pool {
  generado: string;
  dificultades: Record<Dificultad, { nombre: string; emoji: string }>;
  /** Bono de racha (config/trivia.json racha), para mostrar la XP de cada acierto como la calcula Teto. */
  racha: { bono: number; tope: number };
  preguntas: PreguntaPool[];
}

// ───────────────────────── lo que ve la pagina ─────────────────────────

export interface JugadorVista {
  id: string;
  nombre: string;
  avatar: string;
  conectado: boolean;
  /** Juega la partida en curso (false = llego tarde y mira). */
  juega: boolean;
  /** eliminatoria: sigue en pie. */
  vivo: boolean;
  /** cooperativo: ya fallo al menos una vez. */
  fallo: boolean;
  racha: number;
  aciertos: number;
  xp: number;
  /** Ya contesto la pregunta en pantalla. */
  respondio: boolean;
}

export interface ResultadoVista {
  ok: boolean;
  /** XP del acierto (null = aun no se sabe: Teto la calcula al aplicarla). */
  xp: number | null;
  opcion?: number;
  texto?: string;
}

export interface Vista {
  fase: Fase;
  modo: Modo;
  eleccion: Eleccion;
  host: string | null;
  yo: string;
  jugadores: JugadorVista[];
  /** Cuantas preguntas hay para cada eleccion (para la pantalla de la sala). */
  disponibles: Record<Eleccion, number>;
  pregunta?: {
    n: number;
    nonce: string;
    dificultad: Dificultad;
    tipo: "opciones" | "texto";
    texto: string;
    opciones: string[];
    media?: { tipo: "audio" | "imagen"; url: string };
    segundos: number;
    /** ms que le quedan (la pagina cuenta hacia atras desde que llega). */
    restante: number;
    /** Quien eligio cada opcion (ids), en vivo. */
    elecciones: string[][];
    ocultas?: number[];
    temas?: { tema: string; n: number }[];
  };
  revelar?: {
    correcta: number;
    respuesta: string;
    dato?: string;
    resultados: Record<string, ResultadoVista>;
    /** eliminatoria: quienes quedaron fuera con esta pregunta. */
    caen: string[];
    /** eliminatoria: fallaron todos los que quedaban, asi que nadie cae. */
    nadieCae: boolean;
    restante: number;
  };
  fin?: {
    motivo: "ganador" | "eliminados" | "todos-fallaron" | "sin-preguntas" | "abandonaron";
    ganador?: string;
    /** Preguntas jugadas. */
    preguntas: number;
  };
  aviso?: string;
  consumibles?: { celular: number; guitarra: number; zanahoria: number; baguette: number; guitarraActiva: boolean };
}

/** Mensajes de la pagina a la sala. */
export type Pedido =
  | { t: "hola"; token?: string; prueba?: { id: string; nombre: string } }
  | { t: "configurar"; modo?: Modo; eleccion?: Eleccion }
  | { t: "empezar" }
  | { t: "responder"; nonce: string; opcion?: number; texto?: string }
  | { t: "otra" }
  | { t: "consumible"; objeto: "celular" | "guitarra" | "zanahoria"; tema?: string };
