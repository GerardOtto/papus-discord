import { describe, expect, it } from "vitest";
import {
  capsRatio,
  DuplicateTracker,
  findPhone,
  FloodTracker,
  loadModerationSettings,
  RuleSet,
  type MessageContext,
} from "../src/moderation/rules";
import { penaltyFor, StrikeStore } from "../src/moderation/strikes";
import { normalize, WordList } from "../src/moderation/text";
import { memDb } from "./helpers";

const rules = new RuleSet(loadModerationSettings());
const check = (text: string, ctx: Partial<MessageContext> = {}) =>
  rules.check({ text, targetsSomeone: false, memberAgeHours: 1000, ...ctx })?.kind ?? null;

describe("normalize / WordList", () => {
  it("quita acentos, mayusculas y leet sin tocar numeros puros", () => {
    expect(normalize("PÉNDEJO p3nd3j0 Puñal 1488")).toBe("pendejo pendejo punal 1488");
  });

  it("tolera letras estiradas y respeta limites de palabra", () => {
    const w = new WordList(["perra", "fag"]);
    expect(w.test(normalize("perrrrra"))).toBe(true);
    expect(w.test(normalize("teto pera"))).toBe(false);
    expect(w.test(normalize("fagot es un instrumento"))).toBe(false);
  });

  it("detecta frases muy fuertes escritas con signos en medio", () => {
    expect(new WordList(["hijo de puta"], 8).test(normalize("hijo.de.puta"))).toBe(true);
  });
});

describe("RuleSet: tolerancia media", () => {
  it.each(["ay qué pendejo soy", "no mames", "qué pedo", "jajaja me siento bien tonto", "puta madre, se me cayó el pan"])(
    "deja pasar expresiones comunes: %s",
    (t) => expect(check(t)).toBeNull(),
  );

  it.each(["eres un pendejo", "tú eres bien estúpido", "cállate idiota", "eres un pinche culero", "ERES UNA TONTAAA"])(
    "insulto en segunda persona: %s",
    (t) => expect(check(t)).toBe("insulto"),
  );

  it("insulto como respuesta a otra persona, pero no si es sobre uno mismo", () => {
    expect(check("jaja pendejo", { targetsSomeone: true })).toBe("insulto");
    expect(check("jaja pendejo")).toBeNull();
    expect(check("perdón, soy bien pendejo", { targetsSomeone: true })).toBeNull();
  });

  it("muy fuertes y odio siempre fuera, aunque no vayan dirigidos", () => {
    expect(check("ya vete a la verga")).toBe("muy_fuerte");
    expect(check("hijo de p u t a")).toBe("muy_fuerte"); // separado letra a letra
    expect(check("qué maricón")).toBe("odio");
    expect(check("eres un maricon")).toBe("odio"); // el odio gana al insulto
  });
});

describe("RuleSet: datos personales, invitaciones y estafas", () => {
  it.each(["mi cel es 55 1234 5678", "llámame al +56 9 8765 4321", "5512345678"])("teléfono: %s", (t) =>
    expect(check(t)).toBe("datos_personales"),
  );
  it.each(["Teto nació en 2008 2009 2010", "Mesmerizer tiene 200.000.000 vistas", "el 01 de Miku"])(
    "no confunde cifras con teléfonos: %s",
    (t) => expect(check(t)).toBeNull(),
  );

  it("correo e invitaciones", () => {
    expect(check("escríbeme a papu.miku@gmail.com")).toBe("datos_personales");
    expect(check("únanse discord.gg/abc123")).toBe("invitacion");
  });

  it("estafas: frase gancho con enlace o dominio imitado", () => {
    expect(check("Nitro gratis aquí https://cualquiera.xyz/x")).toBe("estafa");
    expect(check("ojalá me regalen nitro gratis algún día")).toBeNull();
    expect(check("mira https://dlscord-gift.com/abc")).toBe("estafa");
  });
});

describe("RuleSet: enlaces y mayúsculas", () => {
  it("cuenta nueva: solo enlaces de la lista permitida", () => {
    expect(check("mira https://www.youtube.com/watch?v=x", { memberAgeHours: 2 })).toBeNull();
    expect(check("mira https://open.spotify.com/track/1", { memberAgeHours: 2 })).toBeNull();
    expect(check("mira https://raro.xyz", { memberAgeHours: 2 })).toBe("enlace_cuenta_nueva");
    expect(check("mira https://raro.xyz", { memberAgeHours: 48 })).toBeNull();
  });

  it("mayúsculas: más de 70 % en mensajes de más de 15 caracteres, solo aviso", () => {
    const v = rules.check({ text: "MIKU ES LA MEJOR DE TODAS", targetsSomeone: false, memberAgeHours: 1000 });
    expect(v).toMatchObject({ kind: "mayusculas", remove: false, strike: false });
    expect(check("AAAAAAA")).toBeNull();
    expect(capsRatio("hola <:Teto:123> MIKU")).toBeCloseTo(4 / 8);
  });

  it("findPhone devuelve el numero encontrado", () => {
    expect(findPhone("cel 55-1234-5678 ok")).toBe("55-1234-5678");
  });
});

describe("Flood y repetidos", () => {
  it("más de 5 mensajes en 10 s es flood", () => {
    const f = new FloodTracker(5, 10_000);
    const res = [0, 1000, 2000, 3000, 4000, 5000].map((t) => f.hit("a", t));
    expect(res).toEqual([false, false, false, false, false, true]);
    expect(f.hit("a", 20_000)).toBe(false);
  });

  it("el mismo mensaje 3 veces en 60 s", () => {
    const d = new DuplicateTracker(3, 60_000);
    expect(d.hit("a", "HOLA", 0)).toBe(false);
    expect(d.hit("a", "hola ", 1000)).toBe(false);
    expect(d.hit("b", "hola", 1500)).toBe(false);
    expect(d.hit("a", "hola", 2000)).toBe(true);
    expect(d.hit("a", "", 2000)).toBe(false);
  });
});

describe("Strikes", () => {
  it("escalera: advertencia, 10 min, 1 h, 24 h + aviso", () => {
    expect([1, 2, 3, 4, 7].map(penaltyFor)).toEqual([
      { kind: "advertencia" },
      { kind: "silencio", minutes: 10, notifyOwner: false },
      { kind: "silencio", minutes: 60, notifyOwner: false },
      { kind: "silencio", minutes: 1440, notifyOwner: true },
      { kind: "silencio", minutes: 1440, notifyOwner: true },
    ]);
  });

  it("vencen a los 3 días y se pueden perdonar", () => {
    const s = new StrikeStore(memDb());
    const day = 86_400_000;
    expect(s.add({ userId: "a", reason: "x" }, 0).active).toBe(1);
    expect(s.add({ userId: "a", reason: "x" }, day).penalty).toEqual({ kind: "silencio", minutes: 10, notifyOwner: false });
    expect(s.active("a", 3 * day + 1)).toBe(1);
    expect(s.add({ userId: "a", reason: "x" }, 5 * day).active).toBe(1);
    expect(s.clear("a", 5 * day)).toBe(1);
    expect(s.active("a", 5 * day)).toBe(0);
  });
});
