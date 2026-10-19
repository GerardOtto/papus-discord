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

  it("los suaves ('feo', 'tonto') son opinión salvo en segunda persona (caso real: 'que feoo' respondiendo)", () => {
    expect(check("que feoo", { targetsSomeone: true })).toBeNull();
    expect(check("ay qué tonto, se me olvidó", { targetsSomeone: true })).toBeNull();
    expect(check("eres bien fea", { targetsSomeone: true })).toBe("insulto");
  });

  it("a los bots tampoco se les falta el respeto, pero platicar con groserías no es insultarlos", () => {
    expect(check("CHUPALO", { targetsBot: true })).toBe("insulto");
    expect(check("<@123> idiota", { targetsBot: true })).toBe("insulto");
    expect(check("<@123> eres una basura", { targetsBot: true })).toBe("insulto");
    expect(check("<@123> el examen de hoy estuvo de la mierda, ayuda", { targetsBot: true })).toBeNull();
    expect(check("<@123> ay qué pendejo soy", { targetsBot: true })).toBeNull();
    expect(check("CHUPALO")).toBeNull(); // sin destinatario
  });

  it("tapa las groserías para citarlas en el aviso público", () => {
    expect(rules.mask("eres un pendejo")).toEqual({ text: "eres un p\\*\\*\\*\\*\\*\\*", masked: 1 });
    // "hijo de puta" (muy fuerte) contiene "puta" (insulto): un solo tramo.
    const m = rules.mask("ya cállate hijo de puta");
    expect(m.masked).toBe(1);
    expect(m.text).not.toMatch(/puta/);
    expect(m.text.startsWith("ya cállate h")).toBe(true);
    expect(rules.mask("hola, qué tal").masked).toBe(0);
  });

  it("muy fuertes y odio siempre fuera, aunque no vayan dirigidos", () => {
    expect(check("ya vete a la verga")).toBe("muy_fuerte");
    expect(check("hijo de p u t a")).toBe("muy_fuerte"); // separado letra a letra
    expect(check("qué maricón")).toBe("odio");
    expect(check("eres un maricon")).toBe("odio"); // el odio gana al insulto
  });

  it("canal libre (#general): pasan insultos y groserías fuertes; odio, graves, invitaciones y estafas no", () => {
    const free = { freeLanguage: true };
    expect(check("eres un pendejo", { ...free, targetsSomeone: true })).toBeNull();
    expect(check("CHUPALO", { ...free, targetsBot: true })).toBeNull();
    expect(check("ya vete a la verga", free)).toBeNull();
    expect(check("hijo de puta", free)).toBeNull();
    expect(check("qué maricón", free)).toBe("odio");
    expect(check("te voy a violar", free)).toBe("muy_fuerte");
    expect(check("matate", free)).toBe("muy_fuerte");
    expect(check("únete discord.gg/abc123", free)).toBe("invitacion");
    // Fuera de #general nada cambia.
    expect(check("eres un pendejo")).toBe("insulto");
    expect(check("matate")).toBe("muy_fuerte");
  });
});

describe("RuleSet: datos personales, invitaciones y estafas", () => {
  it.each(["mi cel es 55 1234 5678", "llámame al +56 9 8765 4321", "5512345678", "escríbeme a papu.miku@gmail.com"])(
    "en el chat, teléfonos y correos pasan (decisión de GyroP): %s",
    (t) => expect(check(t)).toBeNull(),
  );
  it.each(["mi cel es 55 1234 5678", "llámame al +56 9 8765 4321", "5512345678"])("en lo que publica un bot, teléfono: %s", (t) =>
    expect(check(t, { personalData: true })).toBe("datos_personales"),
  );
  it.each(["Teto nació en 2008 2009 2010", "Mesmerizer tiene 200.000.000 vistas", "el 01 de Miku"])(
    "no confunde cifras con teléfonos: %s",
    (t) => expect(check(t, { personalData: true })).toBeNull(),
  );

  it("correo (en lo que publica un bot) e invitaciones (siempre)", () => {
    expect(check("escríbeme a papu.miku@gmail.com", { personalData: true })).toBe("datos_personales");
    expect(check("únanse discord.gg/abc123")).toBe("invitacion");
  });

  it("estafas: frase gancho con enlace o dominio imitado", () => {
    expect(check("Nitro gratis aquí https://cualquiera.xyz/x")).toBe("estafa");
    expect(check("ojalá me regalen nitro gratis algún día")).toBeNull();
    expect(check("mira https://dlscord-gift.com/abc")).toBe("estafa");
  });
});

describe("RuleSet: enlaces y mayúsculas", () => {
  it("cuenta recién llegada (primera hora): solo enlaces de la lista permitida", () => {
    expect(check("mira https://www.youtube.com/watch?v=x", { memberAgeHours: 0.2 })).toBeNull();
    expect(check("mira https://open.spotify.com/track/1", { memberAgeHours: 0.2 })).toBeNull();
    expect(check("mira https://raro.xyz", { memberAgeHours: 0.2 })).toBe("enlace_cuenta_nueva");
    expect(check("mira https://raro.xyz", { memberAgeHours: 2 })).toBeNull(); // pasada la primera hora, libre
  });

  it("los GIFs del buscador de Discord (Klipy, Tenor, Giphy) pasan siempre", () => {
    for (const gif of ["https://klipy.com/gifs/hatsune-miku-deco-27-1", "https://tenor.com/view/teto-123", "https://media.giphy.com/media/x/giphy.gif", "https://i.imgur.com/abc.gif"]) {
      expect(check(gif, { memberAgeHours: 0 }), gif).toBeNull();
    }
    // Las estafas y las invitaciones se siguen borrando para todos.
    expect(check("nitro gratis https://discord-gift.xyz", { memberAgeHours: 1000 })).toBe("estafa");
  });

  it("el nombre de un GIF no es lo que dijo el Papu (caso real: strike por 'p***' dentro de un enlace de Klipy)", () => {
    const gif = "https://klipy.com/gifs/cat-angry-bravo-gato-puto-maltratando-pikachu-it-boy-da-paraiba";
    expect(check(gif, { targetsSomeone: true })).toBeNull();
    expect(check("https://tenor.com/view/hijo-de-puta-123")).toBeNull();
    // Lo que sí escribe, se sigue revisando.
    expect(check(`eres un puto ${gif}`, { targetsSomeone: true })).toBe("insulto");
  });
});

describe("RuleSet: autolesión (no es infracción)", () => {
  it.each([
    "@Neru te quiero mucho me puedas dar algunas palabras de motivación para no terminar con todo?", // caso real 18 oct.
    "ya no quiero vivir",
    "a veces pienso en quitarme la vida",
    "me quiero suicidar",
    "no quiero seguir viviendo así",
  ])("la detecta: %s", (t) => {
    expect(rules.selfHarmPhrase(t)).not.toBeNull();
    expect(check(t)).toBeNull();
  });

  it.each(["me quiero morir del cringe", "kms jajaja", "mi mamá me va a matar si no llego", "matate", "https://klipy.com/gifs/ya-no-quiero-vivir-1"])(
    "no da falsa alarma con la exageración de siempre ni con incitar a otro: %s",
    (t) => expect(rules.selfHarmPhrase(t)).toBeNull(),
  );
});

describe("RuleSet: mayúsculas y teléfonos", () => {

  it("mayúsculas: solo en mensajes largos (más de 100 caracteres) con más de 70 %, y solo aviso", () => {
    expect(check("MIKU ES LA MEJOR DE TODAS, AAAAAAA, TETO TERRITORY")).toBeNull(); // gritos cortos pasan
    const long = "AAAAA ".repeat(25);
    const v = rules.check({ text: long, targetsSomeone: false, memberAgeHours: 1000 });
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
