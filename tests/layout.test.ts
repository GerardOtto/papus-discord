import { describe, expect, it } from "vitest";
import { BOT_BITS, loadLayout, nameKey, overwritesFor, PERM, reorderWithin, WRITE_BITS, type Overwrite } from "../src/setup/layout";

const roles = {
  everyone: "E",
  tiers: ["Puerro", "Atún", "Baguette", "Celular", "Triple Baka"].map((name, i) => ({ name, id: `T${i}` })),
  bots: "B",
};
const get = (o: Overwrite[], id: string) => o.find((x) => x.id === id);
const can = (o: Overwrite[], id: string, bit: bigint) => !!(get(o, id)?.allow ?? 0n) && ((get(o, id)!.allow & bit) === bit);

describe("overwritesFor", () => {
  it("canal de un nivel: lo ven ese nivel y todos los superiores (acumulativo), no los inferiores ni @everyone", () => {
    const o = overwritesFor("Baguette", true, roles);
    expect(get(o, "E")!.deny & PERM.VIEW_CHANNEL).toBe(PERM.VIEW_CHANNEL);
    expect(get(o, "T0")).toBeUndefined(); // Puerro
    expect(get(o, "T1")).toBeUndefined(); // Atún
    for (const t of ["T2", "T3", "T4"]) expect(can(o, t, PERM.VIEW_CHANNEL), t).toBe(true);
  });

  it("solo lectura: los Papus no escriben pero los bots sí (y Miku puede crear encuestas)", () => {
    const o = overwritesFor("Puerro", false, roles);
    expect(get(o, "E")!.deny & WRITE_BITS).toBe(WRITE_BITS);
    expect(can(o, "T0", PERM.SEND_MESSAGES)).toBe(false);
    expect(can(o, "B", PERM.SEND_MESSAGES)).toBe(true);
    expect(can(o, "B", PERM.SEND_POLLS)).toBe(true);
  });

  it("staff: nadie más que los bots (GyroP ve todo por ser dueño)", () => {
    const o = overwritesFor("staff", false, roles);
    expect(o.map((x) => x.id).sort()).toEqual(["B", "E"]);
    expect(get(o, "E")!.deny & PERM.VIEW_CHANNEL).toBe(PERM.VIEW_CHANNEL);
  });

  it("público con escritura: no toca @everyone y los bots siempre entran (regla 2)", () => {
    const o = overwritesFor("todos", true, roles);
    expect(get(o, "E")).toBeUndefined();
    expect(get(o, "B")!.allow).toBe(BOT_BITS);
  });

  it("bots de música externos: no ven ningún canal de texto (solo voz)", () => {
    for (const leen of ["todos", "Puerro", "staff"]) {
      const o = overwritesFor(leen, true, { ...roles, music: "M" });
      expect(get(o, "M")!.deny & PERM.VIEW_CHANNEL, leen).toBe(PERM.VIEW_CHANNEL);
    }
    expect(get(overwritesFor("todos", true, roles), "M")).toBeUndefined();
    // Excepción: el canal de comandos.
    expect(can(overwritesFor("todos", true, { ...roles, music: "M" }, { musica: true }), "M", PERM.SEND_MESSAGES)).toBe(true);
  });

  it("canal candado: lo ven todos menos quien ya tiene ese nivel o uno superior", () => {
    const o = overwritesFor("todos", false, roles, { ocultarDesde: "Atún" });
    expect(get(o, "E")!.deny & PERM.VIEW_CHANNEL).toBe(0n); // los Papus sin nivel lo ven
    expect(get(o, "T0")).toBeUndefined(); // Puerro todavía lo ve (le falta Atún)
    for (const t of ["T1", "T2", "T3", "T4"]) expect(get(o, t)!.deny & PERM.VIEW_CHANNEL, t).toBe(PERM.VIEW_CHANNEL);
    expect(can(o, "B", PERM.SEND_MESSAGES)).toBe(true);
  });

  it("categoría de un rol especial (Papu de honor): solo ese rol, ningún nivel por pagar", () => {
    const r = { ...roles, extra: { "papu-de-honor": "H" } };
    const o = overwritesFor("rol:🏅 Papu de honor", true, r);
    expect(get(o, "E")!.deny & PERM.VIEW_CHANNEL).toBe(PERM.VIEW_CHANNEL);
    expect(can(o, "H", PERM.VIEW_CHANNEL)).toBe(true);
    for (const t of ["T0", "T1", "T2", "T3", "T4"]) expect(get(o, t), t).toBeUndefined();
    expect(() => overwritesFor("rol:Inexistente", true, r)).toThrow(/Inexistente/);
  });

  it("canal de voz: los bots de música sí pueden entrar", () => {
    const o = overwritesFor("todos", true, { ...roles, music: "M" }, { voz: true });
    expect(can(o, "M", PERM.CONNECT | PERM.SPEAK)).toBe(true);
  });

  it("nivel desconocido: error claro", () => {
    expect(() => overwritesFor("Sushi", true, roles)).toThrow(/Sushi/);
  });
});

describe("reorderWithin", () => {
  it("sube los colores sobre las insignias usando los mismos puestos, sin tocar a nadie de afuera", () => {
    // Hoy: honor 14, Fundador 13, Papu 12, colores 11 y 10.
    const current = [
      { id: "honor", position: 14 },
      { id: "fundador", position: 13 },
      { id: "papu", position: 12 },
      { id: "rin", position: 11 },
      { id: "kaito", position: 10 },
    ];
    const changes = reorderWithin(current, ["rin", "kaito", "honor", "fundador", "papu"]);
    expect(changes).toEqual([
      { id: "rin", position: 14 },
      { id: "kaito", position: 13 },
      { id: "honor", position: 12 },
      { id: "fundador", position: 11 },
      { id: "papu", position: 10 },
    ]);
    expect(reorderWithin(changes, ["rin", "kaito", "honor", "fundador", "papu"])).toEqual([]);
  });
});

describe("config/servidor.json", () => {
  const layout = loadLayout();
  it("los niveles de Ko-fi en orden y cada categoría de pago apunta a uno existente", () => {
    expect(layout.niveles.map((n) => n.rol)).toEqual(["🥬 Puerro", "🐟 Atún", "🥖 Baguette", "📱 Celular", "💥 Triple Baka"]);
    // Las categorías nombran el nivel sin emoji ("Puerro"): se reconoce igual.
    const valid = new Set(["todos", "staff", ...layout.niveles.map((n) => nameKey(n.rol)), ...layout.rolesExtra.map((r) => `rol:${r.rol}`)]);
    for (const c of layout.categorias) expect(valid.has(c.leen.startsWith("rol:") ? c.leen : nameKey(c.leen)), c.nombre).toBe(true);
  });
  it("sin canales repetidos y con los que usan los bots", () => {
    const names = layout.categorias.flatMap((c) => c.canales.map((x) => nameKey(x.nombre)));
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["bienvenida", "general", "moderacion", "registro-bots", "votaciones", "tips-y-curiosidades", "boveda", "cola-de-pedidos"]) expect(names).toContain(n);
  });
  it("la bóveda y la cola solo para Triple Baka; staff oculto", () => {
    const cat = (n: string) => layout.categorias.find((c) => c.canales.some((x) => nameKey(x.nombre) === n))!;
    expect(cat("boveda").leen).toBe("Triple Baka");
    expect(cat("moderacion").leen).toBe("staff");
  });
});
