import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aciertosPorIntentos,
  buscarPersonaje,
  comparar,
  compartir,
  completo,
  diaClave,
  elegidoDelDia,
  msHastaManana,
  nivelSilueta,
  numeroReto,
  type CelularSettings,
  type Personaje,
  type PersonajeCompleto,
} from "../src/celular/rules";

const ROOT = path.resolve(import.meta.dirname, "..");
const settings = JSON.parse(readFileSync(path.join(ROOT, "config/celular.json"), "utf8")) as CelularSettings;
const datos = JSON.parse(readFileSync(path.join(ROOT, "content/vocaloidle.json"), "utf8")) as { personajes: Personaje[] };
const todos = datos.personajes;
const pool = todos.filter(completo);
const p = (id: string) => pool.find((x) => x.id === id) as PersonajeCompleto;

describe("celular: el reto del día", () => {
  it("cambia a medianoche de México, no de UTC", () => {
    // 17 nov. 2026, 05:30 UTC = 16 nov. 23:30 en Ciudad de México.
    expect(diaClave(Date.UTC(2026, 10, 17, 5, 30), "America/Mexico_City")).toBe("2026-11-16");
    expect(diaClave(Date.UTC(2026, 10, 17, 6, 30), "America/Mexico_City")).toBe("2026-11-17");
  });

  it("numera desde el inicio", () => {
    expect(numeroReto("2026-11-17", "2026-11-17")).toBe(1);
    expect(numeroReto("2026-12-17", "2026-11-17")).toBe(31);
    expect(numeroReto("2026-11-01", "2026-11-17")).toBe(1);
  });

  it("dice cuánto falta para el siguiente", () => {
    const ms = msHastaManana(Date.UTC(2026, 10, 17, 5, 30), "America/Mexico_City");
    expect(ms).toBeGreaterThan(29 * 60_000);
    expect(ms).toBeLessThan(31 * 60_000);
  });

  it("recorre a todos sin repetir en cada vuelta, ni de una vuelta a la siguiente", () => {
    const ids = ["a", "b", "c", "d", "e"];
    for (let v = 0; v < 6; v++) {
      const vuelta = ids.map((_, k) => elegidoDelDia(ids, v * ids.length + k + 1, "sal"));
      expect(new Set(vuelta).size).toBe(ids.length);
    }
    for (let n = 1; n < 60; n++) expect(elegidoDelDia(ids, n + 1, "sal")).not.toBe(elegidoDelDia(ids, n, "sal"));
  });

  it("es el mismo para todos y no depende del orden de la lista", () => {
    expect(elegidoDelDia(["c", "a", "b"], 7, "x")).toBe(elegidoDelDia(["a", "b", "c"], 7, "x"));
  });
});

describe("celular: XP de los juegos diarios", () => {
  it("3 aciertos de trivia en 1-3 intentos, 2 en 4-6 y 1 desde el 7", () => {
    expect([1, 3, 4, 6, 7, 15].map((n) => aciertosPorIntentos(settings, n))).toEqual([3, 3, 2, 2, 1, 1]);
  });
});

describe("celular: Vocaloidle", () => {
  it("los 15 tienen todos los datos (y uno incompleto no entraría)", () => {
    expect(pool.length).toBe(todos.length);
    expect(completo({ ...todos[0]!, anio: null })).toBe(false);
    for (const x of pool) expect(completo(x)).toBe(true);
    expect(new Set(todos.map((x) => x.id)).size).toBe(todos.length);
  });

  it("verde, amarillo y rojo con flechas de año (la maqueta: Teto, Luka y Miku contra Rin)", () => {
    const rin = p("rin");
    const teto = comparar(p("teto"), rin);
    expect([teto.empresa.color, teto.anio.color, teto.pelo.color, teto.origen.color, teto.voz.color]).toEqual(["rojo", "amarillo", "rojo", "rojo", "verde"]);
    expect(teto.anio.flecha).toBe("antes");
    const luka = comparar(p("luka"), rin);
    expect(luka.anio).toMatchObject({ color: "rojo", flecha: "antes" });
    expect(comparar(p("kaito"), rin).anio).toMatchObject({ color: "amarillo", flecha: "despues" });
    expect(comparar(p("meiko"), rin).anio).toMatchObject({ color: "rojo", flecha: "despues" });
    const miku = comparar(p("miku"), rin);
    expect(miku.anio).toMatchObject({ color: "verde", flecha: null });
    expect(comparar(rin, rin).acierto).toBe(true);
    expect(miku.acierto).toBe(false);
  });

  it("pelo del mismo tono y orígenes de fans cuentan como casi", () => {
    expect(comparar(p("ia"), p("luka")).pelo.color).toBe("amarillo");
    expect(comparar(p("neru"), p("teto")).origen.color).toBe("amarillo");
    expect(comparar(p("miku"), p("teto")).origen.color).toBe("rojo");
  });

  it("comparte sin spoilers", () => {
    const rin = p("rin");
    const txt = compartir(42, [comparar(p("teto"), rin), comparar(rin, rin)]);
    expect(txt).toBe("Vocaloidle #42 · 2 intentos\n🟥🟨🟥🟥🟩\n🟩🟩🟩🟩🟩");
    expect(txt).not.toMatch(/rin/i);
  });

  it("encuentra al personaje por nombre, apellido o id, sin acentos", () => {
    expect(buscarPersonaje(todos, "MIKU")?.id).toBe("miku");
    expect(buscarPersonaje(todos, "kagamine len")?.id).toBe("len");
    expect(buscarPersonaje(todos, "yowane")?.id).toBe("haku");
    expect(buscarPersonaje(todos, "nadie")).toBeNull();
    expect(buscarPersonaje(todos, "  ")).toBeNull();
  });
});

describe("celular: Silueta", () => {
  it("se aclara con cada intento fallido y queda clara al resolver", () => {
    const clara = settings.silueta.bloques.length;
    expect(nivelSilueta(settings, 0, false)).toBe(0);
    expect(nivelSilueta(settings, 2, false)).toBe(2);
    expect(nivelSilueta(settings, 99, false)).toBe(clara);
    expect(nivelSilueta(settings, 0, true)).toBe(clara);
  });
});
