import { describe, expect, it } from "vitest";
import { loadModerationSettings, RuleSet } from "../src/moderation/rules";
import { MONTH_MS, OrderError, OrderQueue, type OrderInput } from "../src/orders/queue";
import { sqliteSql } from "../src/orders/sql";
import { memDb } from "./helpers";

const CAST = ["teto", "miku", "luka", "neru", "rin", "len", "kaito", "meiko", "gumi", "adachirei"];
const DAY = 86_400_000;

function setup(start = 1_800_000_000_000) {
  let t = start;
  const rules = new RuleSet(loadModerationSettings());
  const q = new OrderQueue(
    sqliteSql(memDb()),
    CAST,
    (text) => {
      const v = rules.check({ text, targetsSomeone: false, memberAgeHours: 1000, personalData: true });
      return v && v.kind !== "mayusculas" && v.kind !== "enlace_cuenta_nueva" ? v.detail : null;
    },
    () => t,
  );
  return { q, advance: (ms: number) => (t += ms), now: () => t };
}

const tb = (papuId: string, extra: Partial<OrderInput> = {}): OrderInput => ({
  origen: "triple_baka",
  papuId,
  producto: "triple_baka",
  ocasion: "cumpleanos",
  para: "Sofía",
  vocaloids: ["teto", "miku"],
  detalles: "le encantan los gatos",
  ...extra,
});

describe("OrderQueue: cola por orden de llegada", () => {
  it("FIFO con posiciones; la tienda entra en la misma cola", async () => {
    const { q, advance } = setup();
    const a = await q.create(tb("ana"));
    advance(1000);
    const s = await q.create({ origen: "tienda", comprador: "Carlos (Ko-fi)", producto: "especial", ocasion: "tema_libre", para: "Mi canal", vocaloids: ["luka", "kaito", "gumi"] });
    advance(1000);
    const b = await q.create(tb("beto"));
    expect([await q.position(a.id), await q.position(s.id), await q.position(b.id)]).toEqual([1, 2, 3]);
    await q.setState(a.id, "en_produccion");
    await q.setState(a.id, "entregado");
    expect(await q.position(b.id)).toBe(2);
    expect(await q.position(a.id)).toBeNull();
  });

  it("plazo: 7 días para ocasión, 14 para tema libre", async () => {
    const { q, now } = setup();
    expect((await q.create(tb("ana"))).plazoAt - now()).toBe(7 * DAY);
    const libre = await q.create({ origen: "tienda", producto: "personalizado", ocasion: "tema_libre", para: "X", vocaloids: ["miku"] });
    expect(libre.plazoAt - now()).toBe(14 * DAY);
  });
});

describe("OrderQueue: Triple Baka, uno cada 30 días y uno activo a la vez", () => {
  it("no deja pedir otro mientras haya uno activo", async () => {
    const { q } = setup();
    await q.create(tb("ana"));
    expect(await q.canOrderTripleBaka("ana")).toMatchObject({ ok: false, reason: "activo" });
    await expect(q.create(tb("ana"))).rejects.toThrow(/en curso/);
  });

  it("entregado: el siguiente recién a los 30 días del anterior (sin acumular)", async () => {
    const { q, advance } = setup();
    const a = await q.create(tb("ana"));
    await q.setState(a.id, "en_produccion");
    await q.setState(a.id, "entregado");
    advance(10 * DAY);
    expect(await q.canOrderTripleBaka("ana")).toMatchObject({ ok: false, reason: "mes", nextAt: a.creadoAt + MONTH_MS });
    advance(20 * DAY);
    expect(await q.canOrderTripleBaka("ana")).toEqual({ ok: true });
    // Meses sin pedir no se acumulan: tras 90 días sigue siendo un solo pedido.
    advance(60 * DAY);
    await q.create(tb("ana"));
    expect((await q.canOrderTripleBaka("ana")).ok).toBe(false);
  });

  it("un pedido rechazado no cuenta como el del mes", async () => {
    const { q } = setup();
    const a = await q.create(tb("ana"));
    await q.setState(a.id, "rechazado", "tema no permitido");
    expect(await q.canOrderTripleBaka("ana")).toEqual({ ok: true });
  });
});

describe("OrderQueue: validaciones", () => {
  it("respeta los Vocaloids máximos por producto y el elenco del canal", async () => {
    const { q } = setup();
    await expect(q.create({ ...tb("ana"), vocaloids: ["teto", "miku", "luka"] })).rejects.toThrow(/máximo 2/);
    await expect(q.create({ origen: "tienda", producto: "express", ocasion: "logro", para: "X", vocaloids: ["miku", "teto"] })).rejects.toThrow(/máximo 1/);
    await expect(q.create({ ...tb("ana"), vocaloids: ["hatsune_kaiju"] })).rejects.toThrow(/elenco/);
    await expect(q.create({ ...tb("ana"), vocaloids: [] })).rejects.toThrow(/al menos/);
  });

  it("Triple Baka es para una ocasión, no tema libre", async () => {
    const { q } = setup();
    await expect(q.create({ ...tb("ana"), ocasion: "tema_libre" })).rejects.toBeInstanceOf(OrderError);
  });

  it("fecha límite con formato y nombre obligatorio", async () => {
    const { q } = setup();
    await expect(q.create({ ...tb("ana"), fechaLimite: "3 de nov" })).rejects.toThrow(/AAAA-MM-DD/);
    await expect(q.create({ ...tb("ana"), para: "   " })).rejects.toThrow(/nombre/);
  });

  it("marca para revisión (sin rechazar) textos con datos personales u odio", async () => {
    const { q } = setup();
    const o = await q.create({ ...tb("ana"), detalles: "su cel es 55 1234 5678" });
    expect(o.revisar).toMatch(/teléfono/);
    expect(o.estado).toBe("en_cola");
    expect((await q.create(tb("beto"))).revisar).toBeNull();
  });
});

describe("OrderQueue: estados", () => {
  it("transiciones válidas y corrección gratis dentro de 7 días", async () => {
    const { q, advance } = setup();
    const a = await q.create(tb("ana"));
    await expect(q.setState(a.id, "entregado")).rejects.toThrow(/no puede pasar/);
    await q.setState(a.id, "en_produccion");
    const d = await q.setState(a.id, "entregado");
    expect(d.entregadoAt).not.toBeNull();
    advance(3 * DAY);
    expect((await q.setState(a.id, "en_produccion")).estado).toBe("en_produccion");
    await q.setState(a.id, "entregado");
    advance(8 * DAY);
    await expect(q.setState(a.id, "en_produccion")).rejects.toThrow(/venció/);
  });

  it("avisa los pedidos a 2 días o menos de su plazo", async () => {
    const { q, advance } = setup();
    const a = await q.create(tb("ana"));
    advance(4 * DAY);
    expect(await q.dueSoon()).toEqual([]);
    advance(1.5 * DAY);
    expect((await q.dueSoon()).map((o) => o.id)).toEqual([a.id]);
  });
});
