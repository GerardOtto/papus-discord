// Reglas de AutoMod de Discord (PLAN §7, primera capa): viven en Discord y funcionan con el PC apagado.
// Se construyen desde config/moderacion.json (misma fuente que Neru) y se sincronizan al arrancar.
// Limites de Discord: 6 reglas de palabras, 1000 palabras de hasta 60 caracteres, 10 regex de hasta 260.
import type { ModerationSettings } from "./rules";

export const RULE_PREFIX = "Neru · ";

export type AutoModTrigger =
  | { type: "keyword"; keywords: string[]; regex: string[]; allow: string[] }
  | { type: "mention_spam"; limit: number }
  | { type: "spam" };

export interface AutoModRuleSpec {
  name: string;
  trigger: AutoModTrigger;
  /** Texto que ve quien intenta enviar el mensaje (max. 150), con la voz de Neru. */
  blockMessage: string;
  timeoutSeconds: number | null;
}

const MAX_KEYWORD = 60;
const MAX_REGEX = 260;
const MAX_REGEX_COUNT = 10;

/** Variante con y sin acento de cada vocal (AutoMod compara el texto tal cual). */
function accentClass(word: string): string {
  const map: Record<string, string> = { a: "[aá4]", e: "[eé3]", i: "[ií1]", o: "[oó0]", u: "[uúü]", n: "[nñ]" };
  return [...word].map((c) => map[c] ?? c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
}

/** Reparte alternativas en regex de hasta 260 caracteres: prefijo(alt1|alt2|...)sufijo. */
export function packRegex(prefix: string, alternatives: string[], suffix: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const build = (alts: string[]) => `${prefix}(?:${alts.join("|")})${suffix}`;
  for (const alt of alternatives) {
    if (build([alt]).length > MAX_REGEX) continue;
    if (build([...cur, alt]).length > MAX_REGEX) {
      out.push(build(cur));
      cur = [];
    }
    cur.push(alt);
  }
  if (cur.length) out.push(build(cur));
  return out;
}

const keywords = (list: string[]) => [...new Set(list.map((w) => w.toLowerCase().trim()))].filter((w) => w && w.length <= MAX_KEYWORD);

export function buildAutoModRules(s: ModerationSettings): AutoModRuleSpec[] {
  // Insultos dirigidos en segunda persona ("eres un…", "tu eres bien…", "callate…").
  const second = "(?i)\\b(?:eres|sos|t[uú] eres|est[aá]s bien|c[aá]llate|pedazo de)\\s+(?:(?:un|una|bien|muy|pinche|tan)\\s+)?";
  const insults = [...new Set(s.insultos.filter((w) => !w.includes(" ")))].map(accentClass);
  const directed = packRegex(second, insults, "\\b").slice(0, MAX_REGEX_COUNT);

  // Datos personales: telefono (MX/CL con o sin lada), correo e invitaciones a otros servidores.
  const personal = [
    "(?:\\+\\d{1,3}[\\s.-]?)?\\b\\d{1,3}[\\s.-]?\\d{4}[\\s.-]?\\d{4}\\b",
    "(?i)\\b[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}\\b",
    "(?i)(?:discord(?:app)?\\.com/invite|discord\\.gg|dsc\\.gg)/[a-z0-9-]+",
  ];

  return [
    {
      name: `${RULE_PREFIX}odio`,
      trigger: { type: "keyword", keywords: keywords(s.odio), regex: [], allow: [] },
      blockMessage: "no. eso es odio y aquí no entra. — Neru 📱",
      timeoutSeconds: 3600,
    },
    {
      name: `${RULE_PREFIX}muy fuertes`,
      trigger: { type: "keyword", keywords: keywords(s.muyFuertes), regex: [], allow: [] },
      blockMessage: "oye. eso no se dice aquí. — Neru 📱",
      timeoutSeconds: 600,
    },
    {
      name: `${RULE_PREFIX}insultos dirigidos`,
      trigger: { type: "keyword", keywords: [], regex: directed, allow: [] },
      blockMessage: "oye. aquí no se insulta a nadie. — Neru 📱",
      timeoutSeconds: null,
    },
    {
      name: `${RULE_PREFIX}datos y estafas`,
      trigger: {
        type: "keyword",
        keywords: keywords([...s.estafas, ...s.dominiosSospechosos.map((d) => `*${d}*`)]),
        regex: personal,
        allow: [],
      },
      blockMessage: "nada de datos personales, invitaciones ni enlaces raros. es por tu seguridad. — Neru 📱",
      timeoutSeconds: null,
    },
    {
      name: `${RULE_PREFIX}menciones`,
      trigger: { type: "mention_spam", limit: 5 },
      blockMessage: "demasiadas menciones. calma. — Neru 📱",
      timeoutSeconds: 600,
    },
    {
      name: `${RULE_PREFIX}spam`,
      trigger: { type: "spam" },
      blockMessage: "eso parece spam. — Neru 📱",
      timeoutSeconds: null,
    },
  ];
}
