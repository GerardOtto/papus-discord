// Privacidad del proceso de GyroP (se ofrece en un nivel de Ko-fi): herramientas, programas, IA y como se hacen
// los videos nunca se comentan. Capa 1: preguntas sobre eso -> frase fija (sin LLM, sin cuota). Capa 3: una
// respuesta del LLM que mencione herramientas se descarta. (Capa 2: instruccion en content/personajes/comun.md.)
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalize, WordList } from "../moderation/text";

export interface PrivacySettings {
  sujetos: string[];
  preguntaIA: string[];
  preguntaProceso: string[];
  terminosProhibidos: string[];
}

export type PrivateTopic = "pregunta_ia" | "secreto_estudio";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadPrivacySettings(file = path.join(REPO_ROOT, "config/privacidad.json")): PrivacySettings {
  return JSON.parse(readFileSync(file, "utf8")) as PrivacySettings;
}

export class PrivacyGuard {
  private readonly subjects: WordList;
  private readonly ai: WordList;
  private readonly process: WordList;
  /** Un buscador por termino prohibido, para saber cual aparece en la respuesta y cual escribio el Papu. */
  private readonly forbidden: WordList[];

  constructor(settings: PrivacySettings) {
    this.subjects = new WordList(settings.sujetos);
    this.ai = new WordList(settings.preguntaIA);
    this.process = new WordList(settings.preguntaProceso);
    this.forbidden = settings.terminosProhibidos.map((t) => new WordList([t]));
  }

  /**
   * Tema privado del mensaje, o null. Requiere que hable de GyroP o de sus videos/canal: "¿Miku es una IA?"
   * (la naturaleza de Vocaloid) no es privado; "¿GyroP usa IA?" si.
   */
  classify(message: string): PrivateTopic | null {
    const t = normalize(message);
    if (!this.subjects.test(t)) return null;
    if (this.ai.test(t)) return "pregunta_ia";
    if (this.process.test(t)) return "secreto_estudio";
    return null;
  }

  /**
   * La respuesta del LLM menciona herramientas o el proceso: no se publica. Los terminos que el Papu escribio
   * en su mensaje se permiten ("¿te gusta ChatGPT?" -> el bot puede nombrarlo); las preguntas sobre GyroP ya
   * las frena classify() antes de llegar al LLM.
   */
  leaks(reply: string, message = ""): boolean {
    const r = normalize(reply);
    const m = normalize(message);
    return this.forbidden.some((term) => term.test(r) && !term.test(m));
  }
}
