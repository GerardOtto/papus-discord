import { describe, expect, it } from "vitest";
import { loadModerationSettings, RuleSet } from "../src/moderation/rules";
import { flagGeneral, renderGeneral, type GeneralMessage } from "../src/review/general";

const bots = new Map([["901", "Teto"]]);
const owners = new Set(["1"]);
const rules = new RuleSet(loadModerationSettings());
const msg = (id: string, authorId: string, content: string, min: number, extra: Partial<GeneralMessage> = {}): GeneralMessage => ({
  id,
  channel: "general",
  authorId,
  authorName: `Papu${authorId} (@papu${authorId})`,
  content,
  createdAt: Date.UTC(2026, 9, 18, 23, min),
  replyToId: null,
  attachments: [],
  ...extra,
});

const messages = [
  msg("a", "11", "qué pedo banda, ya vieron el video", 0),
  msg("b", "12", "eres un pendejo <@11>", 1),
  msg("c", "11", "jaja vete a la verga", 2, { replyToId: "b" }),
  msg("d", "1", "tranquilos", 3),
  msg("e", "901", "¡teto-teetoo!", 4),
  msg("f", "13", "miren mi dibujo", 5, { channel: "fanarts del día", attachments: ["teto.png"] }),
];

describe("registro de #general", () => {
  it("marca lo que fuera de #general habría sido sanción, sin marcar a GyroP ni a los bots", () => {
    const flagged = flagGeneral({ messages, bots, owners, rules });
    expect(flagged.map((f) => [f.message.id, f.detail])).toEqual([
      ["b", 'insulto dirigido ("pendejo")'],
      ["c", "grosería muy fuerte"],
    ]);
  });

  it("incluye todos los mensajes, con nombres reales, menciones legibles, respuestas, hilos y adjuntos", () => {
    const md = renderGeneral({ messages, bots, owners, rules, title: "#general completo", timeZone: "America/Santiago" });
    expect(md).toContain("6 mensajes de 4 personas");
    expect(md).toContain("## ⚠️ Para revisar primero");
    expect(md).toContain("**Papu12 (@papu12)**: eres un pendejo @Papu11");
    expect(md).toContain("⚠️ 20:02 **Papu11 (@papu11)** ↪ Papu12: jaja vete a la verga");
    expect(md).toContain("**GyroP**: tranquilos");
    expect(md).toContain("**Teto (bot)**: ¡teto-teetoo!");
    expect(md).toContain('## #general › hilo "fanarts del día"');
    expect(md).toContain("miren mi dibujo [adjunto: teto.png]");
    expect(md.indexOf("## #general\n")).toBeLessThan(md.indexOf("## #general › hilo"));
  });

  it("sin mensajes lo dice", () => {
    expect(renderGeneral({ messages: [], bots, owners, rules, title: "x", timeZone: "America/Santiago" })).toContain("No hubo mensajes en #general");
  });
});
