import { ChannelType, type Guild } from "discord.js";
import { describe, expect, it } from "vitest";
import { StoredImages, urlExpiry } from "../src/discord/imagenes-fijas";
import { memDb } from "./helpers";

const exHex = (ms: number) => Math.floor(ms / 1000).toString(16);

/** Un Discord mínimo: #registro-bots con un hilo donde cada envío deja una imagen con dirección firmada. */
function fakeGuild(now: () => number) {
  const sent: string[] = [];
  const deleted: string[] = [];
  let n = 0;
  const messages = new Map<string, { id: string; attachments: { first: () => { url: string } } }>();
  const mkMsg = (id: string) => {
    const msg = { id, attachments: { first: () => ({ url: `https://cdn.discordapp.com/x/${id}.png?ex=${exHex(now() + 24 * 3_600_000)}` }) } };
    messages.set(id, msg);
    return msg;
  };
  const thread = {
    id: "hilo",
    archived: false,
    isThread: () => true,
    send: async ({ content }: { content: string }) => (sent.push(content), mkMsg(`m${++n}`)),
    messages: { fetch: async (id: string) => mkMsg(id), delete: async (id: string) => void deleted.push(id) },
  };
  const parent = { type: ChannelType.GuildText, name: "📋・registro-bots", threads: { create: async () => thread } };
  const guild = { channels: { cache: { find: (fn: (c: unknown) => boolean) => [parent].find(fn) }, fetch: async (id: string) => (id === "hilo" ? thread : null) } } as unknown as Guild;
  return { guild, sent, deleted };
}

describe("imágenes fijas de la tienda", () => {
  it("lee el vencimiento de una dirección firmada", () => {
    expect(urlExpiry("https://cdn.discordapp.com/a.png?ex=6720a1b0&is=1&hm=2")).toBe(0x6720a1b0 * 1000);
    expect(urlExpiry("https://cdn.discordapp.com/a.png")).toBeNull();
  });

  it("sube una vez por versión, borra la vieja al cambiar y renueva la dirección antes de que venza", async () => {
    let now = Date.parse("2026-10-27T12:00:00Z");
    const { guild, sent, deleted } = fakeGuild(() => now);
    const imgs = new StoredImages({ db: memDb(), guild: () => guild, now: () => now });
    let made = 0;
    const make = async () => (made++, Buffer.from("png"));

    const a = await imgs.url("menu", "v1", make, "menu.png");
    const b = await imgs.url("menu", "v1", make, "menu.png");
    expect(a).toBe(b);
    expect(made).toBe(1);
    expect(sent).toEqual(["menu · v1"]);

    now += 23 * 3_600_000; // queda 1 h: se renueva sin volver a dibujar ni subir
    const c = await imgs.url("menu", "v1", make, "menu.png");
    expect(c).not.toBe(a);
    expect(made).toBe(1);

    await imgs.url("menu", "v2", make, "menu.png");
    expect(made).toBe(2);
    expect(deleted).toEqual(["m1"]);
  });
});
