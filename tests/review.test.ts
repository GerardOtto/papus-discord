import { describe, expect, it } from "vitest";
import { buildExchanges, fixedPhraseMatcher, renderReview, type RawMessage } from "../src/review/conversations";

const bots = new Map([
  ["901", "Miku"],
  ["902", "IA"],
]);
const msg = (id: string, authorId: string, content: string, min: number, replyToId: string | null = null, channel = "habla"): RawMessage => ({
  id,
  channel,
  authorId,
  content,
  createdAt: Date.UTC(2026, 9, 17, 20, min),
  replyToId,
});

describe("revisión de conversaciones", () => {
  const isFixed = fixedPhraseMatcher(["{papu}, ya usaste tus mensajes de hoy. Mañana seguimos."]);

  it("junta las respuestas de varios bots con el mensaje del Papu, con contexto y seudónimos", () => {
    const ex = buildExchanges({
      messages: [
        msg("1", "11", "hola a todos", 0),
        msg("2", "12", "<@901> <@902> ¿qué canción me recomiendan? <@11>", 1),
        msg("3", "901", "¡Tell Your World!", 2, "2"),
        msg("4", "902", "Mmm… Kagerou Days.", 3, "2"),
        msg("5", "901", "<@12>, ya usaste tus mensajes de hoy. Mañana seguimos.", 4, "6"),
        msg("6", "77", "<@901> hola", 3),
        msg("7", "901", "anuncio sin respuesta a nadie", 5),
      ],
      bots,
      owners: new Set(["77"]),
      isFixedPhrase: isFixed,
    });
    expect(ex).toHaveLength(2);
    expect(ex[0]!.papu).toBe("Papu 2");
    expect(ex[0]!.question).toBe("@Miku @IA ¿qué canción me recomiendan? @Papu 1");
    expect(ex[0]!.context).toEqual([{ author: "Papu 1", text: "hola a todos" }]);
    expect(ex[0]!.answers.map((a) => [a.bot, a.fixed])).toEqual([
      ["Miku", false],
      ["IA", false],
    ]);
    expect(ex[1]!.papu).toBe("GyroP");
    expect(ex[1]!.answers[0]!.fixed).toBe(true);
  });

  it("el informe cuenta respuestas del LLM y frases fijas, sin ids de Discord", () => {
    const ex = buildExchanges({
      messages: [msg("1", "123456789", "<@902> hola", 0), msg("2", "902", "Mmm… hola.", 1, "1")],
      bots,
      owners: new Set(),
      isFixedPhrase: isFixed,
    });
    const md = renderReview(ex, "Prueba", "America/Santiago");
    expect(md).toContain("- IA: 1 / 0");
    expect(md).toContain("**Papu 1:** @IA hola");
    expect(md).not.toContain("123456789");
    expect(renderReview([], "Vacío", "America/Santiago")).toContain("No hubo conversaciones");
  });
});
