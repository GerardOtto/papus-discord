// Puente aislado de tarjetas de la Plaza preview (src/mundo/tarjetas-preview.ts, scripts/plaza-tarjetas.ts):
// nunca el D1 de producción, base de los bots en solo lectura y tarjeta pública sin cuota.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardData } from "../src/levels/card";

const renderCard = vi.fn(async (_d: CardData) => Buffer.from("png"));
vi.mock("../src/levels/card", async (orig) => ({ ...(await orig<typeof import("../src/levels/card")>()), renderCard: (d: CardData) => renderCard(d) }));

const { abrirSoloLectura, crearPuentePreview, crearTarjetaPublica, DiscordLectura, idPreview, miembroDesdeApi } = await import(
  "../src/mundo/tarjetas-preview"
);
const { workerDatabaseId } = await import("../src/cloud/d1");

const ROOT = path.resolve(import.meta.dirname, "..");
const PREVIEW = "84202c17-1f8d-4bb7-ace1-79105eb24714";
const PAPU = "123456789012345678";
const GUILD = "999999999999999999";

const respuesta = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("plaza preview: D1", () => {
  it("no arranca sin el ID del preview", () => {
    expect(() => idPreview({}, ROOT)).toThrow(/PLAZA_PREVIEW_D1_DATABASE_ID/);
    expect(() => idPreview({ PLAZA_PREVIEW_D1_DATABASE_ID: "  " }, ROOT)).toThrow(/PLAZA_PREVIEW_D1_DATABASE_ID/);
  });

  it("rechaza el D1 de producción y lo que no es un UUID", () => {
    const prod = workerDatabaseId(ROOT);
    expect(prod).toBeTruthy();
    expect(() => idPreview({ PLAZA_PREVIEW_D1_DATABASE_ID: prod! }, ROOT)).toThrow(/producción/);
    expect(() => idPreview({ PLAZA_PREVIEW_D1_DATABASE_ID: "papus" }, ROOT)).toThrow(/UUID/);
    expect(idPreview({ PLAZA_PREVIEW_D1_DATABASE_ID: ` ${PREVIEW} ` }, ROOT)).toBe(PREVIEW);
  });

  it("el puente solo consulta el D1 del preview", async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return respuesta(200, { success: true, result: [{ results: [{ menciones: 0, acciones: 0, perfiles: 0, chat: 0, total: 0 }] }] });
    }) as unknown as typeof fetch;
    const { puente, databaseId } = crearPuentePreview({
      env: { PLAZA_PREVIEW_D1_DATABASE_ID: PREVIEW, CLOUDFLARE_DEPLOY_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" },
      root: ROOT,
      stats: () => ({ nivel: 1, prestigio: 0, restante: 3, limite: 3, ruletas: 0 }),
      tarjetaPublica: async () => null,
      fetchFn,
    });
    expect(databaseId).toBe(PREVIEW);
    await puente.sync();
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain(`/d1/database/${PREVIEW}/query`);
    expect(urls.some((u) => u.includes(workerDatabaseId(ROOT)!))).toBe(false);
  });

  it("sin token de Cloudflare no arranca", () => {
    expect(() =>
      crearPuentePreview({
        env: { PLAZA_PREVIEW_D1_DATABASE_ID: PREVIEW },
        root: ROOT,
        stats: () => ({ nivel: 1, prestigio: 0, restante: 0, limite: 0, ruletas: 0 }),
        tarjetaPublica: async () => null,
      }),
    ).toThrow(/CLOUDFLARE/);
  });
});

describe("plaza preview: base de los bots en solo lectura", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("lee, pero cualquier escritura falla", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "plaza-ro-"));
    const file = path.join(dir, "papus.sqlite");
    const rw = new DatabaseSync(file);
    rw.exec("PRAGMA journal_mode = WAL; CREATE TABLE niveles (user_id TEXT PRIMARY KEY, xp INTEGER); INSERT INTO niveles VALUES ('1', 50);");
    const ro = abrirSoloLectura(file);
    expect(ro.prepare("SELECT xp FROM niveles WHERE user_id = '1'").get()).toEqual({ xp: 50 });
    expect(() => ro.exec("INSERT INTO niveles VALUES ('2', 1)")).toThrow();
    expect(() => ro.exec("PRAGMA user_version = 9")).toThrow();
    ro.close();
    expect(rw.prepare("SELECT COUNT(*) AS n FROM niveles").get()).toEqual({ n: 1 });
    rw.close();
  });
});

describe("plaza preview: Discord solo por REST", () => {
  it("nombre y avatar como discord.js: apodo y avatar del servidor primero", () => {
    const u = { id: PAPU, username: "papu", global_name: "Papu Global", avatar: "abc" };
    expect(miembroDesdeApi(GUILD, { nick: "Apodo", avatar: "srv", user: u })).toEqual({
      nombre: "Apodo",
      avatarUrl: `https://cdn.discordapp.com/guilds/${GUILD}/users/${PAPU}/avatars/srv.png?size=256`,
    });
    expect(miembroDesdeApi(GUILD, { user: u })).toEqual({ nombre: "Papu Global", avatarUrl: `https://cdn.discordapp.com/avatars/${PAPU}/abc.png?size=256` });
    expect(miembroDesdeApi(GUILD, { user: { id: PAPU, username: "papu" } }).avatarUrl).toMatch(/embed\/avatars\/[0-5]\.png$/);
  });

  it("si ya no está en el servidor, usa su usuario; solo hace GET", async () => {
    const pedidos: { url: string; method?: string }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      pedidos.push({ url: String(url), method: init?.method });
      return String(url).includes("/members/") ? respuesta(404, null) : respuesta(200, { id: PAPU, username: "ido" });
    }) as unknown as typeof fetch;
    const d = new DiscordLectura("tok", GUILD, fetchFn);
    expect((await d.miembro(PAPU))?.nombre).toBe("ido");
    expect(pedidos.every((p) => !p.method || p.method === "GET")).toBe(true);
  });

  it("lista los miembros por páginas, sin bots, y la guarda una hora", async () => {
    let t = 0;
    const pagina1 = Array.from({ length: 1000 }, (_, i) => ({ user: { id: String(100000 + i), username: "p" } }));
    const pagina2 = [{ user: { id: "200001", username: "bot", bot: true } }, { user: { id: "200002", username: "p" } }];
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      respuesta(200, String(url).includes("after=0") ? pagina1 : pagina2),
    ) as unknown as typeof fetch;
    const d = new DiscordLectura("tok", GUILD, fetchFn, () => t);
    const ids = await d.idsMiembros();
    expect(ids?.size).toBe(1001);
    expect(ids?.has("200001")).toBe(false);
    await d.idsMiembros();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    t = 3_600_001;
    await d.idsMiembros();
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});

describe("plaza preview: tarjeta pública", () => {
  const snap = {
    level: 12, max: 99, prestige: 0, into: 10, needed: 100, position: 40,
    rank: { estilo: 2, nombre: "Puerro" },
    card: { frase: "hola", color: null, fondo: null },
  };
  const deps = (over: Partial<Parameters<typeof crearTarjetaPublica>[0]> = {}) =>
    crearTarjetaPublica({
      levels: {
        snapshot: () => snap as never,
        standings: (isMember) => (isMember(PAPU) ? [{ userId: PAPU, position: 7 } as never] : []),
        multiplier: () => 1,
      },
      discord: { miembro: async () => ({ nombre: "Papu [12]", avatarUrl: "https://x/a.png" }), idsMiembros: async () => new Set([PAPU]) },
      dataDir: "/no/existe",
      defaultAccent: "#d43c4c",
      fetchFn: (async () => respuesta(404, null)) as unknown as typeof fetch,
      ...over,
    });

  it("sin cuota diaria, PNG, con el puesto entre los miembros", async () => {
    renderCard.mockClear();
    const card = await deps()(PAPU);
    expect(card).toEqual({ data: Buffer.from("png"), gif: false });
    const d = renderCard.mock.calls[0]![0];
    expect(d.quota).toBeNull();
    expect(d.position).toBe(7);
    expect(d.level).toBe(12);
    expect(d.accent).toBe("#d43c4c");
  });

  it("si no puede listar miembros usa el puesto guardado", async () => {
    renderCard.mockClear();
    await deps({ discord: { miembro: async () => ({ nombre: "P", avatarUrl: "u" }), idsMiembros: async () => null } })(PAPU);
    expect(renderCard.mock.calls[0]![0].position).toBe(40);
  });

  it("no dibuja IDs inválidos ni Papus que Discord no conoce", async () => {
    expect(await deps()("../../etc")).toBeNull();
    expect(await deps({ discord: { miembro: async () => null, idsMiembros: async () => null } })(PAPU)).toBeNull();
  });
});
