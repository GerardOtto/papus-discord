import { describe, expect, it } from "vitest";
import { buildAutoModRules, packRegex, RULE_PREFIX } from "../src/moderation/automod";
import { loadModerationSettings } from "../src/moderation/rules";

const rules = buildAutoModRules(loadModerationSettings());
const keywordRules = rules.filter((r) => r.trigger.type === "keyword");

describe("buildAutoModRules", () => {
  it("respeta los limites de Discord", () => {
    expect(keywordRules.length).toBeLessThanOrEqual(6);
    expect(rules.filter((r) => r.trigger.type === "mention_spam")).toHaveLength(1);
    expect(rules.filter((r) => r.trigger.type === "spam")).toHaveLength(1);
    for (const r of keywordRules) {
      if (r.trigger.type !== "keyword") continue;
      expect(r.trigger.keywords.length).toBeLessThanOrEqual(1000);
      expect(r.trigger.regex.length).toBeLessThanOrEqual(10);
      for (const k of r.trigger.keywords) expect(k.length).toBeLessThanOrEqual(60);
      for (const re of r.trigger.regex) expect(re.length).toBeLessThanOrEqual(260);
    }
    for (const r of rules) {
      expect(r.name.startsWith(RULE_PREFIX)).toBe(true);
      expect(r.blockMessage.length).toBeLessThanOrEqual(150);
      expect(r.blockMessage).toContain("— Neru");
    }
  });

  it("en los canales libres no aplican insultos ni muy fuertes; odio, graves y datos sí", () => {
    const exempt = rules.filter((r) => r.exemptFreeChannels).map((r) => r.name);
    expect(exempt.sort()).toEqual([`${RULE_PREFIX}insultos dirigidos`, `${RULE_PREFIX}muy fuertes`]);
    const graves = rules.find((r) => r.name === `${RULE_PREFIX}graves`)!;
    expect(graves.trigger.type === "keyword" && graves.trigger.keywords).toContain("te voy a violar");
  });

  it("la regla de insultos dirigidos atrapa la segunda persona y deja pasar lo dicho sobre uno mismo", () => {
    const r = rules.find((x) => x.name.endsWith("insultos dirigidos"))!;
    if (r.trigger.type !== "keyword") throw new Error();
    // JS no acepta (?i) en linea como Rust: se quita y se usa la bandera i.
    const res = r.trigger.regex.map((s) => new RegExp(s.replace("(?i)", ""), "i"));
    const hits = (t: string) => res.some((re) => re.test(t));
    expect(hits("eres un pendejo")).toBe(true);
    expect(hits("tú eres bien estúpido")).toBe(true);
    expect(hits("cállate idiota")).toBe(true);
    expect(hits("ay qué pendejo soy")).toBe(false);
    expect(hits("eres la mejor")).toBe(false);
    // Todos los insultos de una palabra quedaron incluidos (ninguno descartado por largo).
    expect(r.trigger.regex.join("|")).toContain("c[uúü]l[eé3]r[oó0]");
  });

  it("la regla de datos y estafas atrapa invitaciones, no teléfonos ni correos (se pueden compartir)", () => {
    const r = rules.find((x) => x.name.endsWith("datos y estafas"))!;
    if (r.trigger.type !== "keyword") throw new Error();
    const res = r.trigger.regex.map((s) => new RegExp(s.replace("(?i)", ""), "i"));
    const hits = (t: string) => res.some((re) => re.test(t));
    expect(hits("55 1234 5678")).toBe(false);
    expect(hits("+56 9 8765 4321")).toBe(false);
    expect(hits("yo@correo.com")).toBe(false);
    expect(hits("discord.gg/abc")).toBe(true);
    expect(hits("Mesmerizer tiene 200.000.000 vistas")).toBe(false);
    expect(hits("Teto 2008 2009 2010")).toBe(false);
  });
});

describe("packRegex", () => {
  it("reparte en varias regex sin pasar de 260", () => {
    const alts = Array.from({ length: 80 }, (_, i) => `palabra${i}`);
    const out = packRegex("(?i)\\b", alts, "\\b");
    expect(out.length).toBeGreaterThan(1);
    for (const r of out) expect(r.length).toBeLessThanOrEqual(260);
    expect(out.join("").match(/palabra\d+/g)).toHaveLength(80);
  });
});
