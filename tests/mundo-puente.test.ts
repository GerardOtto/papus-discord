// Mundo de los Papus: el puente del bot (src/mundo/puente.ts) responde los @ de la plaza con el mismo servicio de
// conversacion que Discord (cuota compartida, cola, LLM) y deja nivel y cuota para la plaza. La base D1 del worker se
// simula con SQLite y worker/schema.sql.
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { D1Query } from "../src/cloud/d1";
import { BOT_IDS } from "../src/config";
import { EngineReader } from "../src/engine/reader";
import { LLMChain } from "../src/llm/chain";
import { PersonaLibrary } from "../src/llm/prompt";
import type { LLMProvider } from "../src/llm/provider";
import { RequestQueue } from "../src/llm/queue";
import { agruparLineas, aTextoPlano, lineasRegistro, MundoPuente, type LineaChat } from "../src/mundo/puente";
import { Phrases } from "../src/phrases/catalog";
import { DeckStore } from "../src/phrases/deck";
import { Quota } from "../src/quota/quota";
import { ConversationService } from "../src/services/conversation";
import { mencionados } from "../worker/src/mundo/juego";
import { FIXTURE_ENGINE, memDb, seededRng } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAPU = "123456789012345678";

function d1(): { query: D1Query; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(ROOT, "worker/schema.sql"), "utf8"));
  const query: D1Query = async <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as T[];
  return { query, db };
}

function setup(reply = '{"teto": "¡Hola, <@123456789012345678>! **Qué gusto** verte en la plaza <:baguette:111>"}', limite = 3) {
  const { query, db: base } = d1();
  const db = memDb();
  const engine = new EngineReader(FIXTURE_ENGINE);
  let llamadas = 0;
  const provider: LLMProvider = { name: "fake", chat: async () => (llamadas++, { text: reply, provider: "fake", model: "m" }) };
  const quota = new Quota(db, limite, "America/Santiago");
  const phrases = new Phrases(new DeckStore(db, seededRng(5)));
  const queue = new RequestQueue({ concurrency: 1, maxWaitMs: 5000 });
  const puente = new MundoPuente({
    query,
    makeConversation: (port) =>
      new ConversationService({
        quota,
        queue,
        chain: new LLMChain([provider]),
        phrases,
        personas: new PersonaLibrary(),
        characters: Object.fromEntries(BOT_IDS.map((id) => [id, engine.character(id)])) as never,
        port,
        llm: { maxTokens: 100, temperature: 0.5 },
      }),
    bots: ["teto", "miku", "luka", "neru"],
    owners: new Set(),
    stats: (id) => ({ nivel: 4, prestigio: 0, restante: quota.remaining(id), limite: quota.limitFor(id), ruletas: 1 }),
  });
  const mencion = (texto: string, papu = PAPU, bots = "teto", creado = Date.now()) =>
    base
      .prepare("INSERT INTO mundo_menciones (sala, papu_id, papu_nombre, texto, bots, historial, creado_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sala-1", papu, "Ana", texto, bots, JSON.stringify([{ author: "Beto", text: "holi" }]), creado);
  const respuestas = () => base.prepare("SELECT bot, tipo, texto, papu_id FROM mundo_respuestas ORDER BY id").all() as { bot: string; tipo: string; texto: string; papu_id: string }[];
  const vuelta = async () => {
    const n = await puente.sync();
    await puente.esperar();
    return n;
  };
  return { puente, base, quota, mencion, respuestas, vuelta, llamadas: () => llamadas };
}

describe("mundo: @ a los Vocaloids de la plaza", () => {
  it("detecta @Teto (con o sin espacio, acentos y mayusculas) y nada mas", () => {
    expect(mencionados("@Teto hola")).toEqual(["teto"]);
    expect(mencionados("oye @ kasane teto, ¿cómo estás?")).toEqual(["teto"]);
    expect(mencionados("@TETO!!")).toEqual(["teto"]);
    expect(mencionados("teto sin arroba")).toEqual([]);
    expect(mencionados("@tetoxd")).toEqual([]);
    expect(mencionados("@Miku hola")).toEqual([]);
  });

  it("responde como en Discord: gasta una unidad de la cuota compartida y deja la respuesta para la plaza", async () => {
    const t = setup();
    t.mencion("@Teto hola");
    expect(await t.vuelta()).toBe(1);
    const r = t.respuestas();
    expect(r.map((x) => x.tipo)).toEqual(["escribiendo", "texto"]);
    expect(r[1]).toMatchObject({ bot: "teto", papu_id: PAPU, texto: "¡Hola, @Ana! Qué gusto verte en la plaza :baguette:" });
    expect(t.quota.remaining(PAPU)).toBe(2);
    expect(t.base.prepare("SELECT tomado FROM mundo_menciones").get()).toEqual({ tomado: 2 });
  });

  it("deja el nivel y la cuota restante despues de hablar", async () => {
    const t = setup();
    t.mencion("@Teto hola");
    await t.vuelta();
    const p = t.base.prepare("SELECT nivel, restante, limite FROM mundo_perfiles WHERE papu_id = ?").get(PAPU);
    expect(p).toEqual({ nivel: 4, restante: 2, limite: 3 });
  });

  it("con la cuota agotada responde la frase fija, sin LLM", async () => {
    const t = setup(undefined, 0);
    t.mencion("@Teto hola");
    await t.vuelta();
    expect(t.llamadas()).toBe(0);
    const r = t.respuestas();
    expect(r).toHaveLength(1);
    expect(r[0]!.tipo).toBe("texto");
  });

  it("nunca responde dos veces la misma mencion", async () => {
    const t = setup();
    t.mencion("@Teto hola");
    await t.vuelta();
    await t.vuelta();
    expect(t.llamadas()).toBe(1);
    expect(t.quota.remaining(PAPU)).toBe(2);
  });

  it("los Papus de prueba (sin Discord) reciben un aviso y no gastan nada", async () => {
    const t = setup();
    t.mencion("@Teto hola", "prueba-ana");
    await t.vuelta();
    expect(t.llamadas()).toBe(0);
    expect(t.respuestas()).toEqual([expect.objectContaining({ tipo: "aviso", papu_id: "prueba-ana" })]);
  });

  it("una mencion vieja (la plaza ya no espera) se descarta sin cobrar", async () => {
    const t = setup();
    t.mencion("@Teto hola", PAPU, "teto", Date.now() - 10 * 60_000);
    await t.vuelta();
    expect(t.llamadas()).toBe(0);
    expect(t.quota.remaining(PAPU)).toBe(3);
  });

  it("guarda los perfiles que pide la plaza al entrar", async () => {
    const t = setup();
    t.base.prepare("INSERT INTO mundo_perfiles (papu_id, pedido_at) VALUES (?, ?)").run(PAPU, Date.now());
    await t.vuelta();
    expect(t.base.prepare("SELECT nivel, restante FROM mundo_perfiles").get()).toEqual({ nivel: 4, restante: 3 });
  });

  it("pasa a texto plano lo que el bot publicaria en Discord", () => {
    expect(aTextoPlano("-# **ojo** <@999> y <@!1> <#55>", "1", "Ana")).toBe("ojo @Papu y @Ana #canal");
  });
});

describe("mundo: registro del chat en #plaza-papus", () => {
  it("publica el chat nuevo una sola vez, en orden", async () => {
    const t = setup();
    const ins = t.base.prepare("INSERT INTO mundo_chat (sala, papu_id, autor, bot, texto, creado_at) VALUES ('plaza', ?, ?, ?, ?, ?)");
    ins.run(PAPU, "Ana", null, "hola papus", 1);
    ins.run(null, "teto", "teto", "¡Hola, @Ana!", 2);
    const recibidas: LineaChat[][] = [];
    t.puente.onChat = async (l) => void recibidas.push(l);
    await t.vuelta();
    await t.vuelta();
    expect(recibidas).toHaveLength(1);
    expect(recibidas[0]!.map((l) => l.texto)).toEqual(["hola papus", "¡Hola, @Ana!"]);
  });

  it("las lineas no pueden pingear ni dar formato", () => {
    const [papu, bot, prueba] = lineasRegistro(
      [
        { id: 1, papu_id: PAPU, autor: "Ana", bot: null, texto: "@everyone **hola** https://x.com", creado_at: 0 },
        { id: 2, papu_id: null, autor: "teto", bot: "teto", texto: "hola", creado_at: 0 },
        { id: 3, papu_id: "prueba-bea", autor: "*Bea*", bot: null, texto: "ok", creado_at: 0 },
      ],
      () => "Kasane Teto",
    );
    expect(papu).toBe(`<@${PAPU}>: @\u200beveryone \\*\\*hola\\*\\* https:/\u200b/x.com`);
    expect(bot).toBe("**Kasane Teto**: hola");
    expect(prueba).toBe("**\\*Bea\\***: ok");
  });

  it("agrupa en mensajes que caben en Discord", () => {
    const partes = agruparLineas(["a".repeat(1000), "b".repeat(1000), "c"], 1900);
    expect(partes).toHaveLength(2);
    expect(partes.every((p) => p.length <= 1900)).toBe(true);
  });
});
