import path from "node:path";
import { describe, expect, it } from "vitest";
import { commandsFor, contextMenusFor, WARN_MENU } from "../src/discord/commands";
import { EngineReader } from "../src/engine/reader";
import { renderBoard } from "../src/orders/board";
import { OrderQueue } from "../src/orders/queue";
import { sqliteSql } from "../src/orders/sql";
import { memDb } from "./helpers";

const CAST = ["teto", "miku", "luka", "neru", "kaito"];

describe("tablero de la cola", () => {
  it("muestra número, ocasión, mención y plazo, pero nunca el destinatario ni los detalles", async () => {
    const q = new OrderQueue(sqliteSql(memDb()), CAST, () => null, () => 1_800_000_000_000);
    await q.create({ origen: "triple_baka", papuId: "111", producto: "triple_baka", ocasion: "cumpleanos", para: "Sofía Pérez", vocaloids: ["teto"], detalles: "le gustan los gatos" });
    await q.create({ origen: "tienda", comprador: "Carlos", producto: "express", ocasion: "logro", para: "Mateo", vocaloids: ["miku"] });
    const b = renderBoard(await q.active(), 3);
    expect(b.description).toContain("<@111>");
    expect(b.description).toContain("🎂 Cumpleaños");
    expect(b.description).toContain("🛍️ pedido de la tienda");
    expect(b.description).toMatch(/<t:\d+:D>/);
    expect(b.description).not.toMatch(/Sofía|Mateo|gatos|Carlos/);
    expect(b.footer).toContain("3 entregados");
  });

  it("cola vacía: invita a pedir", () => {
    expect(renderBoard([], 0).description).toContain("/pedido");
  });
});

describe("elenco y comandos", () => {
  const cast = new EngineReader(path.resolve(import.meta.dirname, "../../Proyecto1")).cast();

  it("el elenco sale del motor: los 4 bots y el resto del canal", () => {
    const ids = cast.map((c) => c.id);
    for (const id of ["teto", "miku", "luka", "neru", "kaito", "meiko"]) expect(ids).toContain(id);
    expect(cast.find((c) => c.id === "adachirei")?.name).toBe("Adachi Rei");
  });

  it("los comandos de Miku se construyen con opciones válidas para Discord", () => {
    const cmds = commandsFor("miku", cast);
    expect(cmds.map((c) => c.name)).toEqual(["pedido", "mi-pedido", "cola", "votacion", "calendario", "estreno", "noticia"]);
    const pedido = cmds[0]!;
    const opts = pedido.options as { name: string; required?: boolean; choices?: unknown[] }[];
    // Discord exige las obligatorias primero.
    const firstOptional = opts.findIndex((o) => !o.required);
    expect(opts.slice(firstOptional).every((o) => !o.required)).toBe(true);
    // Triple Baka no ofrece "tema libre".
    expect(JSON.stringify(opts.find((o) => o.name === "ocasion"))).not.toContain("tema_libre");
    expect(opts.find((o) => o.name === "vocaloid")!.choices!.length).toBe(cast.length);
    // /cola solo para administradores.
    expect(cmds[2]!.default_member_permissions).toBe("8");
  });
});

describe("comandos de Neru", () => {
  it("/advertir y el clic derecho \"Advertir (Neru)\" quedan solo para administradores", () => {
    const advertir = commandsFor("neru").find((c) => c.name === "advertir")!;
    expect(advertir.default_member_permissions).toBe("8");
    expect((advertir.options as { name: string; required?: boolean }[]).map((o) => [o.name, !!o.required])).toEqual([["papu", true], ["motivo", false]]);
    const menus = contextMenusFor("neru");
    expect(menus.map((m) => [m.name, m.type, m.default_member_permissions])).toEqual([[WARN_MENU, 3, "8"]]);
    expect(contextMenusFor("teto")).toEqual([]);
  });
});
