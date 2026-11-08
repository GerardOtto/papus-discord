// Reglas fijas de Neru (PLAN §7). Funciones puras sobre el texto + rastreadores con memoria corta
// (flood). Nada de LLM: instantaneo, sin cuota e imposible de enganar con instrucciones.
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalize, WordList } from "./text";

export interface ModerationSettings {
  insultos: string[];
  /** Solo cuentan con marca de segunda persona ("eres fea"); respondiendo a alguien, "qué feo" es una opinión. */
  insultosSuaves?: string[];
  segundaPersona: string[];
  primeraPersona: string[];
  muyFuertes: string[];
  /** Amenazas sexuales e incitación al suicidio: fuera en todos los canales, también en los libres. */
  graves?: string[];
  odio: string[];
  /** Canales (clave sin emoji ni acentos) donde pasan insultos y groserías muy fuertes; odio, graves, datos y spam no. */
  canalesLibres?: string[];
  /**
   * Frases de quien habla de hacerse daño a sí mismo ("terminar con todo", "quitarme la vida"). No es infracción:
   * Neru responde con una frase fija de apoyo + `lineasDeAyuda` y avisa a GyroP (src/services/moderation.ts).
   */
  autolesion?: string[];
  /** Línea que acompaña la frase de apoyo: teléfonos de ayuda por país. */
  lineasDeAyuda?: string;
  estafas: string[];
  dominiosSospechosos: string[];
  enlacesPermitidos: string[];
  limites: {
    floodMensajes: number;
    floodSegundos: number;
    mayusculasPorcentaje: number;
    mayusculasMinCaracteres: number;
    cuentaNuevaHoras: number;
    /** Dias que duran los machetazos y las advertencias. */
    strikeDias: number;
  };
}

export type ViolationKind =
  | "odio"
  | "muy_fuerte"
  | "estafa"
  | "datos_personales"
  | "invitacion"
  | "insulto"
  | "flood"
  | "enlace_cuenta_nueva"
  | "mayusculas";

export interface Violation {
  kind: ViolationKind;
  /** Borrar el mensaje. */
  remove: boolean;
  /** Machetazo (las mayusculas y los enlaces de cuentas nuevas no). */
  strike: boolean;
  detail: string;
}

export interface MessageContext {
  text: string;
  /** El mensaje responde a otra persona o la menciona (no a un bot). */
  targetsSomeone: boolean;
  /** El mensaje responde a un bot o lo menciona: a los Vocaloids tampoco se les falta el respeto. */
  targetsBot?: boolean;
  /** Horas desde que el autor entro al servidor. */
  memberAgeHours: number;
  /** Canal libre (`canalesLibres`): no se revisan insultos ni groserías muy fuertes. */
  freeLanguage?: boolean;
  /**
   * Tambien revisa telefonos y correos. Solo en lo que publica o usa un bot (tips, ideas para votar, pedidos de video):
   * en el chat los Papus pueden compartirlos (decision de GyroP, 18 oct. 2026).
   */
  personalData?: boolean;
}

// La ruta se calcula al llamar (no al cargar el modulo): este archivo tambien corre en Cloudflare (worker/).
export function loadModerationSettings(file = path.join(path.resolve(import.meta.dirname, "../.."), "config/moderacion.json")): ModerationSettings {
  return JSON.parse(readFileSync(file, "utf8")) as ModerationSettings;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>]+/gi;
export const INVITE_RE = /\b(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[a-z0-9-]+/i;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const PHONE_CANDIDATE_RE = /\+?\d[\d\s.\-()]{6,}\d/g;

/** Telefono: 9+ digitos (MX 10, CL 9), sin confundirlo con anos ("2008 2009") ni cifras con miles ("200.000.000"). */
export function findPhone(text: string): string | null {
  for (const m of text.matchAll(PHONE_CANDIDATE_RE)) {
    const s = m[0].trim();
    const digits = s.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) continue;
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) continue;
    const groups = s.split(/[\s.\-()]+/).filter(Boolean);
    if (groups.length > 1 && groups.every((g) => /^(19|20)\d\d$/.test(g))) continue;
    return s;
  }
  return null;
}

export function withoutUrls(text: string): string {
  return text.replace(URL_RE, " ");
}

export function urlHosts(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => {
    const raw = m[0].startsWith("www.") ? `https://${m[0]}` : m[0];
    try {
      return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }).filter(Boolean);
}

export function capsRatio(text: string): number {
  const letters = text.replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, "").match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  return letters.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length / letters.length;
}

export class RuleSet {
  private readonly insults: WordList;
  private readonly mildInsults: WordList;
  private readonly strong: WordList;
  private readonly grave: WordList;
  private readonly hate: WordList;
  private readonly scams: WordList;
  private readonly selfHarm: WordList;
  private readonly secondPerson: string[];
  private readonly firstPerson: WordList;

  constructor(readonly settings: ModerationSettings) {
    this.insults = new WordList(settings.insultos);
    this.mildInsults = new WordList(settings.insultosSuaves ?? []);
    this.strong = new WordList(settings.muyFuertes, 8);
    this.grave = new WordList(settings.graves ?? [], 8);
    this.hate = new WordList(settings.odio, 7);
    this.scams = new WordList(settings.estafas);
    this.selfHarm = new WordList(settings.autolesion ?? []);
    this.secondPerson = settings.segundaPersona.map((s) => normalize(s));
    this.firstPerson = new WordList(settings.primeraPersona);
  }

  /** Infraccion mas grave del texto (la que define la respuesta de Neru), o null. */
  check(ctx: MessageContext): Violation | null {
    // Las palabras se buscan sin los enlaces: el nombre de un GIF ("klipy.com/gifs/gato-p…-maltratando") no lo
    // escribió el Papu (caso real del 18 oct. 2026). Los enlaces se revisan aparte (estafas, cuentas nuevas).
    const t = normalize(withoutUrls(ctx.text));
    const hosts = urlHosts(ctx.text);

    if (this.hate.test(t)) return { kind: "odio", remove: true, strike: true, detail: "discurso de odio" };
    if (this.grave.test(t)) return { kind: "muy_fuerte", remove: true, strike: true, detail: "amenaza o incitación grave" };
    if (!ctx.freeLanguage && this.strong.test(t)) return { kind: "muy_fuerte", remove: true, strike: true, detail: "grosería muy fuerte" };

    const suspicious = hosts.find((h) => this.settings.dominiosSospechosos.some((d) => h.includes(d)));
    if (suspicious) return { kind: "estafa", remove: true, strike: true, detail: `enlace sospechoso (${suspicious})` };
    if (this.scams.test(normalize(ctx.text)) && (hosts.length > 0 || /@everyone|@here/.test(ctx.text))) {
      return { kind: "estafa", remove: true, strike: true, detail: "posible estafa" };
    }

    if (INVITE_RE.test(ctx.text)) return { kind: "invitacion", remove: true, strike: true, detail: "invitación a otro servidor" };
    if (ctx.personalData && EMAIL_RE.test(ctx.text)) return { kind: "datos_personales", remove: true, strike: true, detail: "correo" };
    if (ctx.personalData && findPhone(ctx.text)) return { kind: "datos_personales", remove: true, strike: true, detail: "teléfono" };

    const insult = ctx.freeLanguage ? null : this.directedInsult(t, ctx.targetsSomeone, !!ctx.targetsBot);
    if (insult) return { kind: "insulto", remove: true, strike: true, detail: `insulto dirigido ("${insult}")` };

    if (ctx.memberAgeHours < this.settings.limites.cuentaNuevaHoras) {
      const blocked = hosts.find((h) => !this.isAllowedHost(h));
      if (blocked) return { kind: "enlace_cuenta_nueva", remove: true, strike: false, detail: blocked };
    }

    const { mayusculasMinCaracteres: min, mayusculasPorcentaje: pct } = this.settings.limites;
    const plain = ctx.text.replace(/\s/g, "");
    if (plain.length > min && capsRatio(ctx.text) > pct) {
      return { kind: "mayusculas", remove: false, strike: false, detail: "mayúsculas" };
    }
    return null;
  }

  /**
   * Texto para citarlo en el aviso público de Neru, con cada grosería tapada ("chupalo" -> "c******"), para que todos
   * vean qué no se dice sin repetirlo. `masked` = cuántas tapó (0 si la grosería venía disfrazada, ej. letra a letra).
   */
  mask(text: string): { text: string; masked: number } {
    const nfc = text.normalize("NFC");
    const t = normalize(nfc);
    // Solo si normalizar no cambió el largo (los índices de las coincidencias valen para el texto original).
    if (t.length !== nfc.length) return { text: nfc, masked: 0 };
    const spans: [number, number][] = [];
    for (const list of [this.hate, this.grave, this.strong, this.insults, this.mildInsults])
      for (const { word, index } of list.matches(t)) spans.push([index, index + word.length]);
    // Tramos solapados ("hijo de puta" y "puta") se unen; luego se tapan de derecha a izquierda.
    const merged: [number, number][] = [];
    for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) {
      const last = merged.at(-1);
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    let out = nfc;
    for (const [a, b] of merged.reverse()) out = out.slice(0, a + 1) + "\\*".repeat(Math.max(1, b - a - 1)) + out.slice(b);
    return { text: out, masked: merged.length };
  }

  /** El Papu habla de hacerse daño ("ya no quiero vivir"): la frase encontrada, o null. Nunca es infracción. */
  selfHarmPhrase(text: string): string | null {
    return this.selfHarm.matches(normalize(withoutUrls(text)))[0]?.word ?? null;
  }

  isAllowedHost(host: string): boolean {
    return this.settings.enlacesPermitidos.some((d) => host === d || host.endsWith(`.${d}`));
  }

  /**
   * Insulto dirigido a otra persona o a un bot (tolerancia media):
   * - con marca de segunda persona justo antes ("eres un pendejo", "callate idiota"), o
   * - en un mensaje que responde o menciona a alguien, si no es sobre uno mismo ("ay que pendejo soy"), o
   * - a un bot, si el mensaje es casi solo el insulto ("CHUPALO", "@Teto idiota"): con los bots se platica de todo y
   *   "@Miku el examen estuvo de la mierda" no va contra Miku.
   * Los suaves ("feo", "tonto") solo cuentan con la marca de segunda persona: "qué feo" es una opinión.
   */
  private directedInsult(t: string, targetsSomeone: boolean, targetsBot: boolean): string | null {
    const marked = (index: number) => {
      const before = t.slice(Math.max(0, index - 30), index).trim();
      const lastWords = before.split(/\s+/).slice(-4).join(" ");
      return this.secondPerson.some((m) => new RegExp(`(?:^|\\s)${m.replace(/\s+/g, "\\s+")}(?:\\s+\\S+)?$`).test(lastWords));
    };
    for (const { word, index } of this.mildInsults.matches(t)) if (marked(index)) return word;
    const words = t.replace(/<@[!&]?\d+>/g, " ").split(/\s+/).filter((w) => /[a-z]/.test(w)).length;
    for (const { word, index } of this.insults.matches(t)) {
      if (marked(index)) return word;
      const around = t.slice(Math.max(0, index - 25), index + word.length + 25);
      if (this.firstPerson.test(around)) continue;
      if (targetsSomeone || (targetsBot && words <= 4)) return word;
    }
    return null;
  }
}

/** Flood: mas de N mensajes en S segundos por Papu. */
export class FloodTracker {
  private readonly times = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Registra un mensaje; true si con este se supera el limite. */
  hit(userId: string, now = Date.now()): boolean {
    const list = (this.times.get(userId) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.times.set(userId, list);
    return list.length > this.max;
  }

  sweep(now = Date.now()): void {
    for (const [k, v] of this.times) if (v.every((t) => now - t >= this.windowMs)) this.times.delete(k);
  }
}

/** GIF de los sitios de GIF de Discord: un enlace solo, sin texto alrededor. */
const GIF_LINK_RE = /^https?:\/\/(?:www\.)?(?:tenor\.com|klipy\.com|giphy\.com|media\.discordapp\.net|cdn\.discordapp\.com)\/\S+$/i;

/**
 * Mensaje que solo expresa algo: emojis (del servidor o normales), un GIF, o nada de texto (sticker o imagen). No cuenta
 * para el flood: en los Papus, una ráfaga de emojis es ánimo, no spam (decisión de GyroP, 22 oct. 2026).
 */
export function isExpressive(text: string): boolean {
  const t = text.trim();
  if (!t || GIF_LINK_RE.test(t)) return true;
  return !t.replace(/<a?:\w+:\d+>/g, "").replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\p{Join_Control}\p{Variation_Selector}\u{20E3}\s]/gu, "");
}
