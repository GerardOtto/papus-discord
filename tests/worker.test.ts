import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { sqliteSql } from "../src/orders/sql";
import { PapusWorker, pollWinner, splitLines, type Interaction, type Option } from "../worker/src/app";
import { channelKey, DiscordError, verifySignature, type BotKey, type DiscordApi } from "../worker/src/discord";
import { parseRoundSettings, rankRound, resolveTie, type RoundSettings } from "../src/votes/rounds";
import votesConfig from "../config/votaciones.json";
import { seededRng } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "..");
const OWNER = "gyrop";
const ROLES = [
  { id: "r-puerro", name: "Puerro" },
  { id: "r-atun", name: "Atún" },
  { id: "r-baguette", name: "Baguette" },
  { id: "r-celular", name: "Celular" },
  { id: "r-tb", name: "Triple Baka" },
  { id: "r-gumi", name: "🎨 Gumi" },
  { id: "r-kaito", name: "🎨 Kaito" },
];
const CHANNELS = ["🎁・cola-de-pedidos", "📋・registro-bots", "🗳️・votaciones", "📝・propuestas-de-temas", "💡・tips-y-curiosidades", "🏆・salón-de-la-fama", "📅・calendario", "📣・anuncios", "👀・vitrina", "💎・niveles-ko-fi"].map(
  (name, i) => ({ id: `c${i}`, name, type: 0 }),
);
const ch = (key: string) => CHANNELS.find((c) => channelKey(c.name) === key)!.id;

interface Call {
  bot: BotKey;
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

class FakeDiscord implements DiscordApi {
  calls: Call[] = [];
  edits: unknown[] = [];
  dmFails = false;
  poll: unknown = null;
  private n = 0;
  async call<T>(bot: BotKey, method: string, p: string, body?: unknown): Promise<T> {
    this.calls.push({ bot, method, path: p, body: body as Record<string, unknown> });
    if (this.hang) return new Promise<T>(() => {});
    if (p.endsWith("/channels") && method === "GET") return CHANNELS as T;
    if (p.endsWith("/roles")) return ROLES as T;
    if (p === "/users/@me/channels") {
      if (this.dmFails) throw new DiscordError(403, "Cannot send messages to this user");
      return { id: "dm1" } as T;
    }
    if (method === "GET" && /\/messages\/\w+$/.test(p)) return { poll: this.poll } as T;
    if (method === "PATCH" && p.includes("/messages/")) return {} as T;
    return { id: `m${++this.n}` } as T;
  }
  editFails = false;
  followUps: unknown[] = [];
  hang = false;
  async editOriginal(_app: string, _token: string, body: unknown): Promise<void> {
    if (this.editFails) throw new DiscordError(404, "Unknown Webhook");
    this.edits.push(body);
  }
  async followUp(_app: string, _token: string, body: unknown): Promise<void> {
    this.followUps.push(body);
  }
  posts(channelKey: string) {
    return this.calls.filter((c) => c.method === "POST" && c.path === `/channels/${ch(channelKey)}/messages`);
  }
}

const T0 = 1_800_000_000_000;

// Por defecto la votacion semanal queda lejos (no se mezcla con las otras pruebas).
function setup(rounds: RoundSettings = parseRoundSettings({ ...votesConfig, primera: "2100-01-01T00:00:00Z" })) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(ROOT, "worker/schema.sql"), "utf8"));
  let t = T0;
  const discord = new FakeDiscord();
  const w = new PapusWorker({
    sql: sqliteSql(db),
    discord,
    guildId: "g",
    ownerId: OWNER,
    cast: JSON.parse(readFileSync(path.join(ROOT, "worker/src/cast.json"), "utf8")) as { id: string; name: string }[],
    colors: { miku: 0x39c5bb, luka: 0xe285b2 },
    now: () => t,
    rng: seededRng(4),
    commandTimeoutMs: 50,
    rounds,
  });
  return { w, discord, advance: (ms: number) => (t += ms) };
}

const opt = (name: string, value: string | number | boolean, type = 3): Option => ({ name, type, value });
const cmd = (name: string, user: string, roles: string[], options: Option[] = []): Interaction => ({
  type: 2,
  application_id: "app",
  token: "tok",
  data: { name, options },
  member: { user: { id: user }, roles },
});
const sub = (name: string, options: Option[]): Option[] => [{ name, type: 1, options }];
const pedidoOpts = [opt("ocasion", "cumpleanos"), opt("para", "Sofía"), opt("vocaloid", "teto"), opt("detalles", "le gustan los gatos")];
const content = (r: { content?: string }) => r.content ?? "";

describe("worker: interacciones", () => {
  it("PING y respuesta diferida privada que luego se edita", async () => {
    const { w, discord } = setup();
    expect(w.handle("miku", { type: 1, application_id: "a", token: "t" }).response).toEqual({ type: 1 });
    const h = w.handle("miku", cmd("mi-pedido", "ana", []));
    expect(h.response).toEqual({ type: 5, data: { flags: 64 } });
    await h.work!();
    expect(JSON.stringify(discord.edits[0])).toContain("Todavía no tienes pedidos");
  });

  it("verifica la firma Ed25519 de Discord", async () => {
    const { publicKey, privateKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as {
      publicKey: webcrypto.CryptoKey;
      privateKey: webcrypto.CryptoKey;
    };
    const pub = Buffer.from(await crypto.subtle.exportKey("raw", publicKey)).toString("hex");
    const sig = Buffer.from(await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode("123" + '{"type":1}'))).toString("hex");
    expect(await verifySignature(pub, sig, "123", '{"type":1}')).toBe(true);
    expect(await verifySignature(pub, sig, "123", '{"type":2}')).toBe(false);
    expect(await verifySignature(pub, "zz", "123", '{"type":1}')).toBe(false);
  });
});

describe("worker: pedidos (Miku)", () => {
  it("solo Triple Baka (o GyroP) puede pedir", async () => {
    const { w } = setup();
    expect(content(await w.route("miku", cmd("pedido", "ana", ["r-baguette"], pedidoOpts)))).toContain("Triple Baka");
    expect(content(await w.route("miku", cmd("pedido", "ana", ["r-tb"], pedidoOpts)))).toContain("lugar **1**");
    expect(content(await w.route("miku", cmd("pedido", OWNER, [], pedidoOpts)))).toContain("lugar **2**");
  });

  it("al pedir: tablero fijado sin el destinatario y aviso a GyroP", async () => {
    const { w, discord } = setup();
    await w.route("miku", cmd("pedido", "ana", ["r-tb"], pedidoOpts));
    const board = discord.posts("cola-de-pedidos")[0]!;
    expect(JSON.stringify(board.body)).toContain("<@ana>");
    expect(JSON.stringify(board.body)).not.toContain("Sofía");
    expect(discord.calls.some((c) => c.method === "PUT" && c.path.includes("/pins/"))).toBe(true);
    expect(JSON.stringify(discord.posts("registro-bots")[0]!.body)).toContain("Nuevo pedido #1");
    // El segundo cambio edita el mismo tablero.
    await w.route("miku", cmd("cola", OWNER, [], sub("estado", [opt("pedido", 1, 4), opt("estado", "en_produccion")])));
    expect(discord.calls.filter((c) => c.method === "PATCH" && c.path.includes("/messages/")).length).toBe(1);
  });

  it("cambio de estado: avisa al Papu por privado y, si los tiene cerrados, en el canal", async () => {
    const { w, discord } = setup();
    await w.route("miku", cmd("pedido", "ana", ["r-tb"], pedidoOpts));
    await w.route("miku", cmd("cola", OWNER, [], sub("estado", [opt("pedido", 1, 4), opt("estado", "en_produccion")])));
    expect(discord.calls.some((c) => c.path === "/channels/dm1/messages")).toBe(true);
    discord.dmFails = true;
    await w.route("miku", cmd("cola", OWNER, [], sub("estado", [opt("pedido", 1, 4), opt("estado", "entregado")])));
    expect(JSON.stringify(discord.posts("cola-de-pedidos").at(-1)!.body)).toContain("<@ana>");
  });

  it("/cola es solo de GyroP", async () => {
    const { w } = setup();
    await expect(w.route("miku", cmd("cola", "ana", ["r-tb"], sub("ver", [])))).rejects.toThrow(/GyroP/);
  });
});

describe("worker: votaciones (Miku)", () => {
  it("abre una encuesta nativa, recuerda 12 h antes y anuncia el ganador al cerrar", async () => {
    const { w, discord, advance } = setup();
    await w.route("miku", cmd("votacion", OWNER, [], sub("abrir", [opt("opcion1", "Ievan Polkka"), opt("opcion2", "Rolling Girl"), opt("dias", 3, 4)])));
    const post = discord.posts("votaciones")[0]!;
    const poll = post.body!.poll as { duration: number; answers: unknown[]; allow_multiselect: boolean };
    expect(poll.duration).toBe(72);
    expect(poll.answers).toHaveLength(2);
    expect(poll.allow_multiselect).toBe(false);

    advance(61 * 3_600_000);
    await w.cron();
    expect(discord.posts("votaciones")).toHaveLength(2); // recordatorio
    await w.cron();
    expect(discord.posts("votaciones")).toHaveLength(2); // solo una vez

    advance(12 * 3_600_000);
    discord.poll = {
      answers: [
        { answer_id: 1, poll_media: { text: "Ievan Polkka" } },
        { answer_id: 2, poll_media: { text: "Rolling Girl" } },
      ],
      results: { is_finalized: true, answer_counts: [{ id: 1, count: 3 }, { id: 2, count: 7 }] },
    };
    await w.cron();
    const last = discord.posts("votaciones").at(-1)!;
    expect(JSON.stringify(last.body)).toContain("Rolling Girl");
    await w.cron();
    expect(discord.posts("votaciones")).toHaveLength(3); // no se anuncia dos veces
  });

  it("cerrar antes de tiempo expira la encuesta", async () => {
    const { w, discord } = setup();
    await w.route("miku", cmd("votacion", OWNER, [], sub("abrir", [opt("opcion1", "A"), opt("opcion2", "B"), opt("canal", "propuestas-de-temas")])));
    await w.route("miku", cmd("votacion", OWNER, [], sub("cerrar", [opt("canal", "propuestas-de-temas")])));
    expect(discord.calls.some((c) => c.path.endsWith("/expire"))).toBe(true);
  });

  it("pollWinner: ganador, empate y sin votos", () => {
    const answers = [
      { answer_id: 1, poll_media: { text: "A" } },
      { answer_id: 2, poll_media: { text: "B" } },
    ];
    expect(pollWinner({ answers, results: { is_finalized: true, answer_counts: [{ id: 1, count: 2 }] } })).toEqual(["A"]);
    expect(pollWinner({ answers, results: { is_finalized: true, answer_counts: [{ id: 1, count: 2 }, { id: 2, count: 2 }] } })).toEqual(["A", "B"]);
    expect(pollWinner({ answers, results: { is_finalized: true, answer_counts: [] } })).toEqual([]);
  });
});

describe("worker: votación semanal (Miku)", () => {
  const DAY = 86_400_000;
  const results = (counts: Record<string, number>) => {
    const answers = Object.keys(counts).map((text, i) => ({ answer_id: i + 1, poll_media: { text } }));
    return { answers, results: { is_finalized: true, answer_counts: answers.map((a) => ({ id: a.answer_id, count: counts[a.poll_media.text]! })) } };
  };
  const lastPoll = (discord: FakeDiscord) =>
    (discord.posts("votaciones").filter((c) => c.body?.poll).at(-1)!.body!.poll as { answers: { poll_media: { text: string } }[] }).answers.map((a) => a.poll_media.text);
  const weekly = () => setup(parseRoundSettings({ ...votesConfig, primera: new Date(T0 + DAY).toISOString() }));

  it("se abre sola con la semilla; el 2.º lugar vuelve con 2 nuevos", async () => {
    const { w, discord, advance } = weekly();
    await w.cron();
    expect(discord.posts("votaciones")).toHaveLength(0); // aún no toca
    advance(DAY);
    await w.cron();
    expect(lastPoll(discord)).toEqual(["Video de Kafu", "Video de Ruko", "Video de Momo"]);
    expect(JSON.stringify(discord.posts("vitrina")[0]!.body)).toContain("Video de Ruko"); // aviso en la vitrina
    await w.route("miku", cmd("votacion", OWNER, [], sub("candidato", [opt("nombre", "Video de Teto | Video de Neru")])));

    advance(3 * DAY);
    discord.poll = results({ "Video de Kafu": 2, "Video de Ruko": 9, "Video de Momo": 4 });
    await w.cron();
    const announce = JSON.stringify(discord.posts("votaciones").at(-1)!.body);
    expect(announce).toContain("Video de Ruko");
    expect(announce).toContain("Video de Momo** quedó en segundo lugar");
    expect(JSON.stringify(discord.posts("vitrina").at(-1)!.body)).toContain("votar la próxima");

    advance(3 * DAY); // 6 días: todavía no
    await w.cron();
    expect(discord.posts("votaciones").filter((c) => c.body?.poll)).toHaveLength(1);
    advance(DAY);
    await w.cron();
    expect(lastPoll(discord)).toEqual(["Video de Momo", "Video de Teto", "Video de Neru"]);
    const list = JSON.stringify(await w.route("miku", cmd("votacion", OWNER, [], sub("candidatos", []))));
    expect(list).toContain("Video de Ruko");
    expect(list).toContain("faltan **2** candidatos"); // la ronda abierta usó a los dos en espera
  });

  it("empate por el primer lugar: GyroP decide y el otro empatado sigue", async () => {
    const { w, discord, advance } = weekly();
    advance(DAY);
    await w.cron();
    advance(3 * DAY);
    discord.poll = results({ "Video de Kafu": 5, "Video de Ruko": 5, "Video de Momo": 1 });
    await w.cron();
    expect(JSON.stringify(discord.posts("votaciones").at(-1)!.body)).toContain("empate");
    expect(JSON.stringify(discord.posts("registro-bots").at(-1)!.body)).toContain("/votacion desempate");
    await expect(w.route("miku", cmd("votacion", OWNER, [], sub("semanal", [])))).rejects.toThrow(/desempate/);
    await expect(w.route("miku", cmd("votacion", OWNER, [], sub("desempate", [opt("opcion", "Video de Momo")])))).rejects.toThrow(/Elige una de/);
    await w.route("miku", cmd("votacion", OWNER, [], sub("desempate", [opt("opcion", "video de ruko")])));
    expect(JSON.stringify(discord.posts("votaciones").at(-1)!.body)).toContain("Video de Kafu** quedó en segundo lugar");
  });

  it("si faltan candidatos no abre y avisa a GyroP una vez al día", async () => {
    const { w, discord, advance } = weekly();
    await w.route("miku", cmd("votacion", OWNER, [], sub("quitar", [opt("nombre", "Video de Momo")])));
    advance(DAY);
    await w.cron();
    await w.cron();
    expect(discord.posts("votaciones")).toHaveLength(0);
    expect(discord.posts("registro-bots")).toHaveLength(1);
    expect(JSON.stringify(discord.posts("registro-bots")[0]!.body)).toContain("Faltan 1 candidatos");
  });

  it("rankRound: el segundo lugar empatado lo gana el más antiguo", () => {
    expect(rankRound(["A", "B", "C"], { A: 1, B: 4, C: 1 })).toEqual({ winner: "B", tied: [], second: "A" });
    expect(rankRound(["A", "B", "C"], { A: 0, B: 0, C: 0 })).toEqual({ winner: null, tied: ["A", "B", "C"], second: null });
    expect(resolveTie(["A", "B", "C"], { A: 3, B: 3, C: 1 }, "B")).toEqual({ winner: "B", tied: [], second: "A" });
  });
});

describe("worker: color del nombre (menú de Miku)", () => {
  const menu = (user: string, roles: string[], value: string): Interaction => ({
    type: 3,
    application_id: "app",
    token: "tok",
    data: { custom_id: "papu_color", values: [value] },
    member: { user: { id: user }, roles },
  });

  it("el menú responde en privado y deja un solo color", async () => {
    const { w, discord } = setup();
    const h = w.handle("miku", menu("ana", ["r-kaito"], "gumi"));
    expect(h.response).toEqual({ type: 5, data: { flags: 64 } });
    await h.work!();
    expect(JSON.stringify(discord.edits[0])).toContain("**Gumi**");
    expect(discord.calls.some((c) => c.method === "DELETE" && c.path === "/guilds/g/members/ana/roles/r-kaito")).toBe(true);
    expect(discord.calls.some((c) => c.method === "PUT" && c.path === "/guilds/g/members/ana/roles/r-gumi")).toBe(true);
  });

  it("sin color quita el color; con nivel avisa que se ve el del nivel", async () => {
    const { w, discord } = setup();
    expect(content(await w.route("miku", menu("ana", ["r-gumi"], "ninguno")))).toContain("color de siempre");
    expect(discord.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/roles/r-gumi"))).toBe(true);
    expect(content(await w.route("miku", menu("ana", ["r-puerro"], "kaito")))).toContain("color de tu nivel");
  });
});

describe("worker: calendario y anuncios (Miku)", () => {
  it("calendario con una línea por fecha, estreno con enlace", async () => {
    const { w, discord } = setup();
    await w.route("miku", cmd("calendario", OWNER, [], [opt("texto", "Lun 20: Teto | Jue 23: Miku")]));
    expect(JSON.stringify(discord.posts("calendario")[0]!.body)).toContain("• Lun 20: Teto\\n• Jue 23: Miku");
    await w.route("miku", cmd("estreno", OWNER, [], [opt("titulo", "Triple Baka"), opt("enlace", "https://youtu.be/x")]));
    expect(JSON.stringify(discord.posts("anuncios")[0]!.body)).toContain("https://youtu.be/x");
    await expect(w.route("miku", cmd("estreno", OWNER, [], [opt("titulo", "X"), opt("enlace", "no-es-enlace")]))).rejects.toThrow(/http/);
    expect(splitLines("a | b")).toBe("• a\n• b");
  });
});

describe("worker: tips (Luka)", () => {
  it("Atún o superior, siempre con fuente, y al Salón de la Fama", async () => {
    const { w, discord } = setup();
    const tip = (user: string, roles: string[], fuente: string) => w.route("luka", cmd("tip", user, roles, [opt("texto", "Miku nació en 2007"), opt("fuente", fuente)]));
    expect(content(await tip("ana", ["r-puerro"], "https://vocadb.net"))).toContain("Atún");
    await expect(tip("ana", ["r-atun"], "lo leí por ahí")).rejects.toThrow(/fuente/);
    expect(content(await tip("ana", ["r-baguette"], "https://vocadb.net/S/1"))).toContain("#1");
    const posted = discord.posts("tips-y-curiosidades")[0]!;
    expect(posted.bot).toBe("luka");
    expect(JSON.stringify(posted.body)).toContain("Tip #1");
    await w.route("luka", cmd("tip-usado", OWNER, [], [opt("tip", 1, 4), opt("video", "Triple Baka: la canción que nunca muere")]));
    expect(JSON.stringify(discord.posts("salon-de-la-fama")[0]!.body)).toContain("<@ana>");
    await expect(w.route("luka", cmd("tip-usado", OWNER, [], [opt("tip", 1, 4), opt("video", "X")]))).rejects.toThrow(/ya está/);
  });

  it("no publica tips con datos personales u odio", async () => {
    const { w } = setup();
    await expect(w.route("luka", cmd("tip", "ana", ["r-atun"], [opt("texto", "llámame al 55 1234 5678"), opt("fuente", "https://x.com/a")]))).rejects.toThrow(/No puedo publicar/);
  });
});

describe("worker: tope de tiempo de los comandos", () => {
  it("si el comando se demora, responde igual con un aviso (nunca queda pensando)", async () => {
    const { w, discord } = setup();
    discord.hang = true; // Discord no responde la consulta de roles
    await w.handle("luka", cmd("tip", "ana", ["r-atun"], [opt("texto", "dato"), opt("fuente", "https://x.com")])).work!();
    expect(JSON.stringify(discord.edits[0])).toContain("tardando más de lo normal");
  });

  it("si no se puede editar la respuesta, manda un mensaje privado aparte", async () => {
    const { w, discord } = setup();
    discord.editFails = true;
    await w.handle("miku", cmd("mi-pedido", "ana", [])).work!();
    expect(JSON.stringify(discord.followUps[0])).toContain("Todavía no tienes pedidos");
    expect(JSON.stringify(discord.followUps[0])).toContain('"flags":64');
  });
});

describe("worker: editar la respuesta diferida", () => {
  it("reintenta si Discord aún no registró la respuesta (Unknown Webhook)", async () => {
    const { restApi } = await import("../worker/src/discord");
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return calls < 3 ? new Response('{"message":"Unknown Webhook","code":10015}', { status: 404 }) : new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await restApi({ miku: "a", luka: "b" }, fetchFn).editOriginal("app", "tok", { content: "hola" });
    expect(calls).toBe(3);
  });
});
