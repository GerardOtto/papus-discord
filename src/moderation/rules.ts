// Reglas fijas de Neru (PLAN §7). Funciones puras sobre el texto + rastreadores con memoria corta
// (flood y repetidos). Nada de LLM: instantaneo, sin cuota e imposible de enganar con instrucciones.
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalize, WordList } from "./text";

export interface ModerationSettings {
  insultos: string[];
  segundaPersona: string[];
  primeraPersona: string[];
  muyFuertes: string[];
  odio: string[];
  estafas: string[];
  dominiosSospechosos: string[];
  enlacesPermitidos: string[];
  limites: {
    floodMensajes: number;
    floodSegundos: number;
    repetidoVeces: number;
    repetidoSegundos: number;
    mayusculasPorcentaje: number;
    mayusculasMinCaracteres: number;
    cuentaNuevaHoras: number;
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
  | "repetido"
  | "enlace_cuenta_nueva"
  | "mayusculas";

export interface Violation {
  kind: ViolationKind;
  /** Borrar el mensaje. */
  remove: boolean;
  /** Suma strike (las mayusculas y los enlaces de cuentas nuevas no). */
  strike: boolean;
  detail: string;
}

export interface MessageContext {
  text: string;
  /** El mensaje responde a otra persona o la menciona (no a un bot). */
  targetsSomeone: boolean;
  /** Horas desde que el autor entro al servidor. */
  memberAgeHours: number;
}

// La ruta se calcula al llamar (no al cargar el modulo): este archivo tambien corre en Cloudflare (worker/).
export function loadModerationSettings(file = path.join(path.resolve(import.meta.dirname, "../.."), "config/moderacion.json")): ModerationSettings {
  return JSON.parse(readFileSync(file, "utf8")) as ModerationSettings;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>]+/gi;
const INVITE_RE = /\b(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[a-z0-9-]+/i;
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
  private readonly strong: WordList;
  private readonly hate: WordList;
  private readonly scams: WordList;
  private readonly secondPerson: string[];
  private readonly firstPerson: WordList;

  constructor(readonly settings: ModerationSettings) {
    this.insults = new WordList(settings.insultos);
    this.strong = new WordList(settings.muyFuertes, 8);
    this.hate = new WordList(settings.odio, 7);
    this.scams = new WordList(settings.estafas);
    this.secondPerson = settings.segundaPersona.map((s) => normalize(s));
    this.firstPerson = new WordList(settings.primeraPersona);
  }

  /** Infraccion mas grave del texto (la que define la respuesta de Neru), o null. */
  check(ctx: MessageContext): Violation | null {
    const t = normalize(ctx.text);
    const hosts = urlHosts(ctx.text);

    if (this.hate.test(t)) return { kind: "odio", remove: true, strike: true, detail: "discurso de odio" };
    if (this.strong.test(t)) return { kind: "muy_fuerte", remove: true, strike: true, detail: "grosería muy fuerte" };

    const suspicious = hosts.find((h) => this.settings.dominiosSospechosos.some((d) => h.includes(d)));
    if (suspicious) return { kind: "estafa", remove: true, strike: true, detail: `enlace sospechoso (${suspicious})` };
    if (this.scams.test(t) && (hosts.length > 0 || /@everyone|@here/.test(ctx.text))) {
      return { kind: "estafa", remove: true, strike: true, detail: "posible estafa" };
    }

    if (INVITE_RE.test(ctx.text)) return { kind: "invitacion", remove: true, strike: true, detail: "invitación a otro servidor" };
    if (EMAIL_RE.test(ctx.text)) return { kind: "datos_personales", remove: true, strike: true, detail: "correo" };
    if (findPhone(ctx.text)) return { kind: "datos_personales", remove: true, strike: true, detail: "teléfono" };

    const insult = this.directedInsult(t, ctx.targetsSomeone);
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

  isAllowedHost(host: string): boolean {
    return this.settings.enlacesPermitidos.some((d) => host === d || host.endsWith(`.${d}`));
  }

  /**
   * Insulto dirigido a otra persona (tolerancia media):
   * - con marca de segunda persona justo antes ("eres un pendejo", "callate idiota"), o
   * - en un mensaje que responde o menciona a alguien, si no es sobre uno mismo ("ay que pendejo soy").
   */
  private directedInsult(t: string, targetsSomeone: boolean): string | null {
    for (const { word, index } of this.insults.matches(t)) {
      const before = t.slice(Math.max(0, index - 30), index).trim();
      const lastWords = before.split(/\s+/).slice(-4).join(" ");
      const marked = this.secondPerson.some((m) => new RegExp(`(?:^|\\s)${m.replace(/\s+/g, "\\s+")}(?:\\s+\\S+)?$`).test(lastWords));
      if (marked) return word;
      if (targetsSomeone) {
        const around = t.slice(Math.max(0, index - 25), index + word.length + 25);
        if (!this.firstPerson.test(around)) return word;
      }
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

/** Mismo mensaje N veces en S segundos. */
export class DuplicateTracker {
  private readonly seen = new Map<string, number[]>();
  constructor(
    private readonly times: number,
    private readonly windowMs: number,
  ) {}

  hit(userId: string, text: string, now = Date.now()): boolean {
    const key = `${userId}\u0000${normalize(text).replace(/\s+/g, " ").trim()}`;
    if (key.endsWith("\u0000")) return false; // solo adjuntos o stickers
    const list = (this.seen.get(key) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.seen.set(key, list);
    return list.length >= this.times;
  }

  sweep(now = Date.now()): void {
    for (const [k, v] of this.seen) if (v.every((t) => now - t >= this.windowMs)) this.seen.delete(k);
  }
}
