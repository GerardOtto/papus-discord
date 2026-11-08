import { describe, expect, it } from "vitest";
import { BOT_IDS } from "../src/config";
import { BOT_BITS, CHAT_BOT_BITS, loadLayout, nameKey, botColorRoles, blockAtBottom, blockAtTop, blockBelow, overwritesFor, PERM, WRITE_BITS, type Overwrite } from "../src/setup/layout";
import { loadEspeciales } from "../src/services/especiales";

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

  it("Vocaloids de conversación (rol Coro): ven y escriben en todos los canales, sin encuestas ni fijar (regla 2)", () => {
    const r = { ...roles, chatBots: "C" };
    for (const leen of ["todos", "Puerro", "Triple Baka", "staff"]) {
      for (const escriben of [true, false]) {
        const o = overwritesFor(leen, escriben, r);
        expect(can(o, "C", PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.READ_MESSAGE_HISTORY), `${leen} ${escriben}`).toBe(true);
        expect(get(o, "C")!.allow & (PERM.SEND_POLLS | PERM.PIN_MESSAGES)).toBe(0n);
      }
    }
    const privado = overwritesFor("rol:💙 Esposa de Kaito", true, { ...r, extra: { [nameKey("💙 Esposa de Kaito")]: "K" } });
    expect(get(privado, "C")!.allow).toBe(CHAT_BOT_BITS);
    // Sin rol Coro (servidor antiguo): no se agrega nada.
    expect(get(overwritesFor("todos", true, roles), "C")).toBeUndefined();
  });

  it("nivel desconocido: error claro", () => {
    expect(() => overwritesFor("Sushi", true, roles)).toThrow(/Sushi/);
  });
});

describe("canal de tickets", () => {
  it("los Papus no escriben ni abren hilos en el canal, pero sí escriben en su hilo; los bots crean y cierran hilos", () => {
    const roles = { everyone: "E", tiers: [], bots: "B" };
    const o = overwritesFor("todos", true, roles, { tickets: true });
    const deny = o.find((x) => x.id === "E")!.deny;
    expect(deny & PERM.SEND_MESSAGES).toBe(PERM.SEND_MESSAGES);
    expect(deny & PERM.CREATE_PRIVATE_THREADS).toBe(PERM.CREATE_PRIVATE_THREADS);
    expect(deny & PERM.SEND_MESSAGES_IN_THREADS).toBe(0n);
    expect(can(o, "B", PERM.CREATE_PRIVATE_THREADS | PERM.MANAGE_THREADS)).toBe(true);
    expect(can(overwritesFor("todos", true, roles), "B", PERM.MANAGE_THREADS)).toBe(false);
  });
});

describe("blockBelow", () => {
  it("pone colores e insignias juntos bajo el nivel más bajo, sin tocar lo que está sobre el bot", () => {
    // Desordenado como lo deja Discord al crear roles: kofi(9) teto(8) puerro(7) honor(6) bot(5) rin(4) papu(3) kaito(2) musica(1)
    const roles = [
      { id: "kofi", position: 9 },
      { id: "teto", position: 8 },
      { id: "puerro", position: 7 },
      { id: "honor", position: 6 },
      { id: "bot", position: 5 },
      { id: "rin", position: 4 },
      { id: "papu", position: 3 },
      { id: "kaito", position: 2 },
      { id: "musica", position: 1 },
      { id: "everyone", position: 0 },
    ];
    const block = ["rin", "kaito", "honor", "papu"];
    const changes = blockBelow(roles, "puerro", block, 8);
    const after = new Map(roles.map((r) => [r.id, r.position]));
    for (const c of changes) after.set(c.id, c.position);
    const order = [...after.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(order).toEqual(["kofi", "teto", "puerro", "rin", "kaito", "honor", "papu", "bot", "musica", "everyone"]);
    expect(changes.some((c) => c.id === "kofi" || c.id === "teto" || c.id === "everyone")).toBe(false);
    const fixed = roles.map((r) => ({ id: r.id, position: after.get(r.id)! }));
    expect(blockBelow(fixed, "puerro", block, 8)).toEqual([]);
  });

  it("sube los colores arriba de todo, justo debajo del bot, y no se mueve si ya están", () => {
    const roles = [
      { id: "teto", position: 6 },
      { id: "tb", position: 5 },
      { id: "kaito", position: 4 },
      { id: "puerro", position: 3 },
      { id: "rin", position: 2 },
      { id: "papu", position: 1 },
      { id: "everyone", position: 0 },
    ];
    const changes = blockAtTop(roles, ["rin", "kaito"], 6);
    const after = new Map(roles.map((r) => [r.id, r.position]));
    for (const c of changes) after.set(c.id, c.position);
    const order = [...after.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(order).toEqual(["teto", "rin", "kaito", "tb", "puerro", "papu", "everyone"]);
    expect(blockAtTop(roles.map((r) => ({ id: r.id, position: after.get(r.id)! })), ["rin", "kaito"], 6)).toEqual([]);
  });

  it("con roles recién creados todos en la posición 1, nunca pide una posición a la altura del bot", () => {
    // Así quedó el servidor el 19 oct. 2026 tras crear los 24 países: Discord rechazaba el orden (Missing Permissions).
    const roles = [
      { id: "teto", position: 4 },
      { id: "puerro", position: 3 },
      { id: "rin", position: 2 },
      { id: "papu", position: 1 },
      { id: "mx", position: 1 },
      { id: "cl", position: 1 },
      { id: "everyone", position: 0 },
    ];
    for (const changes of [blockAtTop(roles, ["rin"], 4), blockAtBottom(roles, ["mx", "cl"], 4), blockBelow(roles, "puerro", ["papu"], 4)]) {
      for (const c of changes) expect(c.position).toBeLessThan(4);
      for (const c of changes) expect(c.position).toBeGreaterThan(0);
    }
    expect(blockAtTop(roles, ["rin"], 4)).toEqual([{ id: "rin", position: 3 }, { id: "puerro", position: 2 }]);
  });

  it("deja a Coro como el último rol separado: debajo de Música y de los países, justo sobre @everyone", () => {
    const roles = [
      { id: "teto", position: 8 },
      { id: "vocaloids", position: 7 },
      { id: "puerro", position: 6 },
      { id: "coro", position: 5 },
      { id: "honor", position: 4 },
      { id: "musica", position: 3 },
      { id: "mx", position: 2 },
      { id: "cl", position: 1 },
      { id: "everyone", position: 0 },
    ];
    const changes = blockAtBottom(roles, ["mx", "cl", "coro"], 8);
    const after = new Map(roles.map((r) => [r.id, r.position]));
    for (const c of changes) after.set(c.id, c.position);
    const order = [...after.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(order).toEqual(["teto", "vocaloids", "puerro", "honor", "musica", "mx", "cl", "coro", "everyone"]);
    const hoisted = new Set(["vocaloids", "puerro", "honor", "musica", "coro"]);
    expect(order.filter((id) => hoisted.has(id)).at(-1)).toBe("coro");
  });

  it("deja los países al fondo, justo sobre @everyone, sin tocar lo que está sobre el bot", () => {
    const roles = [
      { id: "teto", position: 7 },
      { id: "puerro", position: 6 },
      { id: "cl", position: 5 },
      { id: "papu", position: 4 },
      { id: "mx", position: 3 },
      { id: "musica", position: 2 },
      { id: "kaito", position: 1 },
      { id: "everyone", position: 0 },
    ];
    const changes = blockAtBottom(roles, ["mx", "cl"], 7);
    const after = new Map(roles.map((r) => [r.id, r.position]));
    for (const c of changes) after.set(c.id, c.position);
    const order = [...after.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(order).toEqual(["teto", "puerro", "papu", "musica", "kaito", "mx", "cl", "everyone"]);
    expect(blockAtBottom(roles.map((r) => ({ id: r.id, position: after.get(r.id)! })), ["mx", "cl"], 7)).toEqual([]);
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
  it("el canal privado de Kaito y Piña solo lo ve el rol de Piña (de una sola persona, no de un nivel)", () => {
    const cat = layout.categorias.find((c) => nameKey(c.nombre) === "kaito-y-pina")!;
    expect(cat.leen).toBe("rol:💙 Esposa de Kaito");
    expect(cat.canales.map((c) => nameKey(c.nombre))).toEqual(["kaito-y-pina"]);
    const especiales = loadEspeciales().filter((p) => p.rol && nameKey(p.rol) === nameKey("💙 Esposa de Kaito"));
    expect(especiales.map((p) => p.nombre)).toEqual(["🍍♡Piña♡🍍"]);
    const r = { ...roles, extra: { [nameKey("💙 Esposa de Kaito")]: "K" } };
    const o = overwritesFor(cat.leen, true, r);
    expect(get(o, "E")!.deny & PERM.VIEW_CHANNEL).toBe(PERM.VIEW_CHANNEL);
    expect(can(o, "K", PERM.VIEW_CHANNEL)).toBe(true);
    for (const t of ["T0", "T1", "T2", "T3", "T4"]) expect(get(o, t), t).toBeUndefined();
  });
  it("sin canales repetidos y con los que usan los bots", () => {
    const names = layout.categorias.flatMap((c) => c.canales.map((x) => nameKey(x.nombre)));
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["bienvenida", "general", "moderacion", "registro-bots", "votaciones", "tips-y-curiosidades", "boveda", "cola-de-pedidos"]) expect(names).toContain(n);
  });
  it("rol Vocaloids solo para las 4 chicas y rol Coro (separado, sin color) para los de conversación", () => {
    const vocaloids = layout.rolesExtra.filter((r) => r.bots);
    const coro = layout.rolesExtra.filter((r) => r.botsCharla);
    expect(vocaloids.map((r) => r.rol)).toEqual(["Vocaloids"]);
    expect(coro).toHaveLength(1);
    expect(coro[0]!.separado).toBe(true);
    expect(coro[0]!.color).toBe("#000000");
    expect(coro[0]!.bots).toBeUndefined();
  });

  it("las categorías hechas a mano van después de una categoría pública que existe", () => {
    const cat = layout.categorias.find((c) => nameKey(c.nombre) === nameKey(layout.categoriasManualesDespuesDe ?? ""));
    expect(cat, layout.categoriasManualesDespuesDe).toBeDefined();
    expect(cat!.leen).toBe("todos");
  });

  it("la bóveda y la cola solo para Triple Baka; staff oculto", () => {
    const cat = (n: string) => layout.categorias.find((c) => c.canales.some((x) => nameKey(x.nombre) === n))!;
    expect(cat("boveda").leen).toBe("Triple Baka");
    expect(cat("moderacion").leen).toBe("staff");
  });
});

describe("colores de los Vocaloids (coloresBots)", () => {
  const layout = loadLayout();
  const { byBot, botOnly } = botColorRoles(layout);
  const palette = new Set((layout.coloresPapu?.colores ?? []).map((c) => nameKey(c.rol)));

  it("cada bot tiene su color, y es de la paleta o uno solo suyo con color", () => {
    for (const id of BOT_IDS) expect(byBot.has(id), id).toBe(true);
    for (const [bot, rol] of byBot) {
      expect(BOT_IDS as readonly string[], bot).toContain(bot);
      expect(palette.has(nameKey(rol)) || botOnly.some((b) => nameKey(b.rol) === nameKey(rol)), rol).toBe(true);
    }
    for (const b of botOnly) expect(b.color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("los colores solo de bots no aparecen en el menu de #tus-roles", () => {
    for (const b of botOnly) expect(palette.has(nameKey(b.rol)), b.rol).toBe(false);
  });
});
