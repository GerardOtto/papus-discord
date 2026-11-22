import { describe, expect, it } from "vitest";
import { SalonDeLaFama } from "../src/discord/salon";
import { memDb } from "./helpers";

function setup(staff: string[] = []) {
  const sent: { content: string }[] = [];
  const reports: string[] = [];
  const salon = { id: "salon", name: "🏆・salón-de-la-fama", isTextBased: () => true, type: 0 };
  const guild = { channels: { cache: { find: (f: (c: typeof salon) => boolean) => (f(salon) ? salon : undefined) } } };
  const s = new SalonDeLaFama({
    db: memDb(),
    owners: new Set(["gyrop"]),
    isStaff: async (id) => staff.includes(id),
    guild: () => guild as never,
    sendable: async () => ({ send: async (m: { content: string }) => void sent.push(m) }) as never,
    report: async (t) => void reports.push(t),
  });
  const msg = (id: string, bot = false) => ({
    id,
    partial: false,
    author: { id: "papu", bot, displayName: "Papu", displayAvatarURL: () => "https://x/a.png" },
    member: { displayName: "Papu" },
    content: "¿Y si hacemos un video de la saga del mal?",
    channelId: "general",
    url: `https://discord.com/channels/1/general/${id}`,
    createdAt: new Date(),
    attachments: { find: () => undefined },
    inGuild: () => true,
  });
  const react = (emoji: string, by: string, m = msg("m1")) => s.onReaction({ emoji: { name: emoji }, message: m } as never, { id: by, bot: false } as never);
  return { s, sent, reports, react, msg };
}

describe("salón de la fama", () => {
  it("⭐ de GyroP o un Mod lo lleva al salón una sola vez; de un Papu, no", async () => {
    const t = setup(["mod"]);
    await t.react("⭐", "papu2");
    expect(t.sent).toHaveLength(0);
    await t.react("👍", "gyrop");
    expect(t.sent).toHaveLength(0);
    await t.react("⭐", "mod");
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.content).toContain("<@papu>");
    await t.react("⭐", "gyrop");
    expect(t.sent).toHaveLength(1);
    // Mensajes de bots, no.
    await t.react("⭐", "gyrop", t.msg("m2", true));
    expect(t.sent).toHaveLength(1);
  });
});
