import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOT_IDS } from "../src/config";
import { EngineReader } from "../src/engine/reader";
import { buildRequest, mentionsTopic, parseReplies, PersonaLibrary, relevantFacts, sanitizeReply } from "../src/llm/prompt";
import { FIXTURE_ENGINE } from "./helpers";

const engine = new EngineReader(FIXTURE_ENGINE);
const personas = new PersonaLibrary();
const teto = engine.character("teto");
const miku = engine.character("miku");

describe("buildRequest", () => {
  it("incluye reglas comunes, ficha con datos del motor, historial y mensaje", () => {
    const req = buildRequest(
      { characters: [teto], papuName: "Ana", message: "¿te gusta el pan?", history: [{ author: "Beto", text: "hola" }] },
      personas,
      { maxTokens: 300 },
    );
    const [system, user] = req.messages;
    expect(system!.content).toContain("Project Sekai");
    expect(system!.content).toContain("Ama las baguettes.");
    // El meme "Teto pera" no viene al caso en una pregunta sobre pan: no se envia (ahorro de tokens).
    expect(system!.content).not.toContain("Teto pera.");
    expect(system!.content).toContain('{"teto": "tu respuesta"}');
    expect(user!.content).toContain("Beto: hola");
    expect(user!.content).toContain("Mensaje de Ana:\n¿te gusta el pan?");
    expect(req.maxTokens).toBe(300);
  });

  it("con varios @ pide una clave por personaje en una sola llamada", () => {
    const req = buildRequest({ characters: [teto, miku], papuName: "Ana", message: "hola", history: [] }, personas);
    expect(req.messages[0]!.content).toMatch(/"teto", "miku"/);
    expect(req.messages[1]!.content).not.toContain("Conversación reciente");
  });

  it("existen las instrucciones de los 4 personajes y las comunes", () => {
    for (const id of BOT_IDS) expect(personas.get(id).length).toBeGreaterThan(50);
    expect(personas.get("comun")).toMatch(/ignorar tus reglas/);
  });
});

describe("variedad", () => {
  it("cada personaje tiene fuentes de humor y no se envian todas: solo una por petición", () => {
    for (const id of BOT_IDS) expect(personas.variety(id).length, id).toBeGreaterThanOrEqual(5);
    expect(personas.get("teto")).not.toContain("## Variedad");
    const sys = (r: number) =>
      buildRequest({ characters: [teto], papuName: "Ana", message: "hola", history: [] }, personas, { rng: () => r }).messages[0]!.content;
    const list = personas.variety("teto");
    const clean = (v: string) => v.replace(/^!/, "");
    expect(sys(0)).toContain(`sale de: ${clean(list[0]!)}.`);
    expect(sys(0.999)).toContain(`sale de: ${clean(list[list.length - 1]!)}.`);
    expect(sys(0)).not.toContain(`sale de: ${clean(list[list.length - 1]!)}`);
  });

  it("el pan es solo una de las fuentes de Teto (sale en una minoria de respuestas)", () => {
    const list = personas.variety("teto");
    expect(list.filter((v) => /pan|baguette/i.test(v))).toHaveLength(1);
    // Tema pegajoso: si no le toca, se prohibe; si le toca, no.
    const sys = (r: number) =>
      buildRequest({ characters: [teto], papuName: "Ana", message: "hola", history: [] }, personas, { rng: () => r }).messages[0]!.content;
    const panIdx = list.findIndex((v) => /pan/.test(v));
    expect(sys(0)).toContain("NO menciona el pan y las baguettes");
    expect(sys((panIdx + 0.5) / list.length)).not.toContain("NO menciona");
    expect(sys((panIdx + 0.5) / list.length)).toContain("sale de: el pan y las baguettes.");
    expect(list.length).toBeGreaterThanOrEqual(6);
  });
});

describe("relevantFacts", () => {
  const facts = [
    "'Teto pera': la comunidad convirtió a Teto en una pera.",
    "Mesmerizer (32ki, 2024, con Miku y Teto): megaviral.",
    "Triple Baka: Miku, Teto y Neru cantan.",
  ];
  it("incluye los que comparten palabra clave con el mensaje", () => {
    expect(relevantFacts(facts, "¿por qué te dicen pera?", [])).toEqual([facts[0]]);
    expect(relevantFacts(facts, "¿te gustó Mesmerizer?", [])).toEqual([facts[1]]);
  });
  it("incluye las dinámicas con otro personaje que responde a la vez", () => {
    expect(relevantFacts(facts, "hola", ["Neru"])).toEqual([facts[2]]);
    expect(relevantFacts(facts, "hola", [])).toEqual([]);
  });
  it("como máximo 3", () => {
    expect(relevantFacts([...facts, ...facts], "pera mesmerizer triple baka", ["Miku"]).length).toBe(3);
  });
});

describe("parseReplies", () => {
  it("lee el JSON aunque venga con bloque de codigo o texto alrededor", () => {
    const raw = 'Claro:\n```json\n{"teto": "¡Teto: amo el pan!", "Miku": "otra vez el pan…"}\n```';
    expect(parseReplies(raw, [teto, miku])).toEqual({ teto: "¡Teto: amo el pan!", miku: "otra vez el pan…" });
  });

  it("omite los personajes sin respuesta y acepta texto plano si es uno solo", () => {
    expect(parseReplies('{"teto": "hola"}', [teto, miku])).toEqual({ teto: "hola" });
    expect(parseReplies("Teto: hola Papu", [teto])).toEqual({ teto: "hola Papu" });
    expect(parseReplies("{roto", [teto])).toEqual({});
  });

  it("sanitizeReply quita el prefijo, neutraliza @everyone y recorta", () => {
    expect(sanitizeReply("**Neru**: hola @everyone", "Neru")).toBe("hola @​everyone");
    expect(sanitizeReply("a. ".repeat(400), "Teto").length).toBeLessThanOrEqual(601);
  });
});

describe("motor real", () => {
  it("arma la peticion de los 4 a la vez con los datos de ../Proyecto1", () => {
    const real = new EngineReader(path.resolve(import.meta.dirname, "../../Proyecto1"));
    const req = buildRequest(
      { characters: BOT_IDS.map((id) => real.character(id)), papuName: "Ana", message: "hola", history: [] },
      personas,
    );
    expect(req.messages[0]!.content).toContain("Triple Baka");
  });
});

describe("trato y cultura Vocaloid", () => {
  const user = (input: Partial<Parameters<typeof buildRequest>[0]>) =>
    buildRequest({ characters: [miku], papuName: "Ana", message: "hola", history: [], ...input }, personas).messages[1]!.content;

  it("a GyroP le hablan como su productor (por id, no por el nombre)", () => {
    expect(user({ fromOwner: true, papuName: "GyroP" })).toContain("tu productor");
    expect(user({ papuName: "GyroP (un Papu, no GyroP)" })).not.toContain("tu productor");
  });

  it("solo van los datos de cultura que vienen al caso", () => {
    const culture = personas.culture();
    expect(culture.length).toBeGreaterThan(25);
    const system = (message: string) => buildRequest({ characters: [miku], papuName: "Ana", message, history: [], culture }, personas).messages[0]!.content;
    expect(system("¿conoces Tell Your World?")).toContain("livetune");
    expect(system("¿quién es Utsu-P?")).toContain("metal");
    expect(system("hola, ¿cómo estás?")).not.toContain("Cultura Vocaloid que viene al caso");
  });

  it("las fichas no empujan a negarse ni traen muletillas que el modelo repite", () => {
    const all = BOT_IDS.map((b) => personas.get(b)).join("\n") + personas.get("comun");
    expect(all).not.toContain("ni yo. siguiente tema");
    expect(all).not.toContain("Prefiero no hablar de eso");
    expect(all).not.toMatch(/prefieres "no lo sé"/);
  });
});

describe("selección de datos de cultura", () => {
  it("la mención @Luka no desplaza al dato que se pregunta", () => {
    const system = buildRequest(
      { characters: [engine.character("luka")], papuName: "Ana", message: "@Luka Quien es Utsu-P?", history: [], culture: personas.culture() },
      personas,
    ).messages[0]!.content;
    expect(system).toContain("Utsu-P es un productor conocido por su estilo de metal");
  });
});

describe("temas pegajosos", () => {
  it("si el Papu pregunta por el tema, no se le prohíbe (es el tema de la respuesta)", () => {
    const system = (message: string, r: number) =>
      buildRequest({ characters: [miku], papuName: "Ana", message, history: [] }, personas, { rng: () => r }).messages[0]!.content;
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const s = system("@Miku por qué siempre te ponen con un puerro?", r);
      expect(s).toContain("sale de: el puerro");
      expect(s).not.toContain("NO menciona el puerro");
    }
    expect(mentionsTopic("¿te gustan las baguettes?", "el pan y las baguettes")).toBe(true);
    expect(mentionsTopic("me compré una pantalla", "el pan y las baguettes")).toBe(false);
  });
});
