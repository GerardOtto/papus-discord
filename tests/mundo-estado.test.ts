// Plaza de los Papus: la "foto" del servidor que muestran sus zonas (src/mundo/estado.ts) y su publicacion en D1.
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { D1Query } from "../src/cloud/d1";
import { armarEstado, huella, type EstadoDeps } from "../src/mundo/estado";
import { MundoPuente } from "../src/mundo/puente";
import type { ConversationService } from "../src/services/conversation";

const AHORA = 1_800_000_000_000;

function deps(over: Partial<EstadoDeps> = {}): EstadoDeps {
  return {
    ultimaBoda: () => ({ bot: "teto", userId: "111", name: "Ana", startedAt: AHORA - 3_600_000, endsAt: AHORA + 3_600_000, divorcedAt: null }),
    pelea: () => ({ a: "miku", b: "godzilla", cuotas: [1.8, 2.1], estado: "abierta", cierraAt: AHORA + 300_000, ganador: null }),
    mercado: () => ({ abierto: false, apertura: { abre: AHORA + 7_200_000, cierra: AHORA + 10_800_000 } }),
    ranking: () => [1, 2, 3, 4].map((i) => ({ userId: `u${i}`, level: 50 - i, prestige: 0, rank: { nombre: "Estrella" } })),
    ultimoSorteo: () => ({ userId: "u9", detalle: JSON.stringify({ premio: "Sobre legendario" }), at: AHORA - 1000 }),
    nombre: (id) => `Papu ${id}`,
    luchador: (id) => ({ miku: "Hatsune Miku", godzilla: "Godzilla" })[id] ?? id,
    now: () => AHORA,
    ...over,
  };
}

describe("mundo: foto del servidor", () => {
  it("arma lo que muestran las zonas", () => {
    const e = armarEstado(deps());
    expect(e.boda).toMatchObject({ bot: "teto", nombre: "Ana", vigente: true });
    expect(e.pelea).toMatchObject({ a: { nombre: "Hatsune Miku", cuota: 1.8 }, b: { nombre: "Godzilla", cuota: 2.1 }, estado: "abierta" });
    expect(e.fama.map((f) => f.nombre)).toEqual(["Papu u1", "Papu u2", "Papu u3"]);
    expect(e.sorteo).toMatchObject({ premio: "Sobre legendario", nombre: "Papu u9" });
    expect(e.mercado.abierto).toBe(false);
  });

  it("una boda con divorcio termina en el divorcio", () => {
    const e = armarEstado(deps({ ultimaBoda: () => ({ bot: "miku", userId: "1", name: "Bo", startedAt: AHORA - 9e6, endsAt: AHORA + 9e6, divorcedAt: AHORA - 1000 }) }));
    expect(e.boda).toMatchObject({ vigente: false, hasta: AHORA - 1000 });
  });

  it("sin nada del servidor, las zonas quedan vacias", () => {
    const e = armarEstado(deps({ ultimaBoda: () => null, pelea: () => null, ranking: () => [], ultimoSorteo: () => null }));
    expect([e.boda, e.pelea, e.sorteo, e.fama.length]).toEqual([null, null, null, 0]);
  });

  it("la huella ignora la hora", () => {
    expect(huella(armarEstado(deps({ now: () => 1 })))).toBe(huella(armarEstado(deps({ now: () => 2 }))));
  });

  it("el puente la publica en D1 solo cuando cambia", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(path.resolve(import.meta.dirname, "../worker/schema.sql"), "utf8"));
    let escrituras = 0;
    const query: D1Query = async <T,>(sql: string, ...params: unknown[]) => {
      if (sql.includes("mundo_estado")) escrituras++;
      return db.prepare(sql).all(...(params as never[])) as T[];
    };
    let t = AHORA;
    const puente = new MundoPuente({
      query,
      makeConversation: () => ({}) as ConversationService,
      bots: ["teto"],
      owners: new Set(),
      stats: () => ({ nivel: 1, prestigio: 0, restante: 3, limite: 3, ruletas: 0 }),
      now: () => t,
    });
    let nivel = 49;
    puente.estado = () => armarEstado(deps({ now: () => t, ranking: () => [{ userId: "u1", level: nivel, prestige: 0, rank: { nombre: "x" } }] }));
    await puente.sync();
    t += 61_000;
    await puente.sync(); // igual: no escribe
    nivel = 50;
    t += 61_000;
    await puente.sync();
    expect(escrituras).toBe(2);
    const fila = db.prepare("SELECT valor FROM mundo_estado WHERE clave = 'servidor'").get() as { valor: string };
    expect(JSON.parse(fila.valor).fama[0].nivel).toBe(50);
  });

  it("recupera acciones reclamadas que quedaron interrumpidas por un reinicio", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(path.resolve(import.meta.dirname, "../worker/schema.sql"), "utf8"));
    db.prepare("INSERT INTO mundo_acciones (sala, papu_id, papu_nombre, accion, datos, ref, creado_at, tomado) VALUES (?, ?, ?, ?, ?, ?, ?, 1)")
      .run("plaza", "123456789012345678", "Ana", "pesca.capturar", "null", 7, AHORA - 60_001);
    const query: D1Query = async <T,>(sql: string, ...params: unknown[]) =>
      db.prepare(sql).all(...(params as never[])) as T[];
    const puente = new MundoPuente({
      query,
      makeConversation: () => ({}) as ConversationService,
      bots: ["teto"],
      owners: new Set(),
      stats: () => ({ nivel: 1, prestigio: 0, restante: 3, limite: 3, ruletas: 0 }),
      now: () => AHORA,
    });

    await puente.sync();

    const fila = db.prepare("SELECT tomado, resultado FROM mundo_acciones WHERE ref = 7").get() as { tomado: number; resultado: string };
    expect(fila.tomado).toBe(2);
    expect(JSON.parse(fila.resultado)).toMatchObject({
      ok: false,
      motivo: "La acción se interrumpió antes de confirmar su respuesta. Revisa tu progreso antes de repetirla.",
    });
    db.close();
  });

});
