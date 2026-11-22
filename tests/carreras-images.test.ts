import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bannerApuestas, bannerPodio, repartirApostadores, VERSIONES_APUESTAS, type Apostador } from "../src/carreras/images";
import type { MarcoMembresia } from "../src/membresias/marco";
import { avatarFile } from "../src/peleas/images";

const marco = (nombre: string): MarcoMembresia => ({ estilo: "basico", color: "#39C5BB", nombre });
const papu = (nombre: string, nivel: number): Apostador => ({ nombre, nivel, marco: nivel >= 0 ? marco(`N${nivel}`) : undefined });
const nombres = (l: Apostador[] | undefined) => (l ?? []).map((p) => p.nombre);

describe("repartirApostadores", () => {
  it("cada Papu sale una sola vez, en el corredor del podio al que más le apostó", () => {
    const a = papu("A", 0);
    const { porCorredor, vallas, tambien } = repartirApostadores(["miku", "gumi", "teto"], [
      { papu: a, corredor: "teto", monto: 100 },
      { papu: a, corredor: "miku", monto: 300 },
      { papu: a, corredor: "neru", monto: 900 },
    ]);
    expect(nombres(porCorredor.get("miku"))).toEqual(["A"]);
    expect(porCorredor.get("teto")).toEqual([]);
    expect(vallas).toEqual([]);
    expect(tambien).toEqual([]);
  });

  it("muestra a todos: con membresía primero (nivel más alto, luego monto) y después los demás por monto", () => {
    const { porCorredor } = repartirApostadores(["miku", "gumi", "teto"], [
      { papu: papu("sin-mucho", -1), corredor: "miku", monto: 999 },
      { papu: papu("bajo-mucho", 0), corredor: "miku", monto: 900 },
      { papu: papu("alto-poco", 4), corredor: "miku", monto: 10 },
      { papu: papu("sin-poco", -1), corredor: "miku", monto: 5 },
    ]);
    expect(nombres(porCorredor.get("miku"))).toEqual(["alto-poco", "bajo-mucho", "sin-mucho", "sin-poco"]);
  });

  it("fuera del podio: con membresía a las vallas, sin membresía a la fila de abajo", () => {
    const { vallas, tambien } = repartirApostadores(["miku", "gumi", "teto"], [
      { papu: papu("socio", 2), corredor: "neru", monto: 50 },
      { papu: papu("papu", -1), corredor: "neru", monto: 50 },
    ]);
    expect(vallas.map((v) => [v.tipo, v.papu.nombre])).toEqual([["patrocina", "socio"]]);
    expect(nombres(tambien)).toEqual(["papu"]);
  });

  it("llena las vallas libres con Papus de honor al azar, sin repetir a quien ya salió", () => {
    const honor = ["H1", "H2", "H3", "H4", "H5", "H6", "socio"].map((n) => papu(n, -1));
    const { vallas } = repartirApostadores(["miku", "gumi", "teto"], [{ papu: papu("socio", 2), corredor: "neru", monto: 50 }], honor, () => 0.3);
    expect(vallas).toHaveLength(5);
    expect(vallas[0]).toMatchObject({ tipo: "patrocina" });
    expect(vallas.slice(1).every((v) => v.tipo === "honor" && v.papu.nombre !== "socio")).toBe(true);
    expect(new Set(vallas.map((v) => v.papu.nombre)).size).toBe(5);
  });
});

describe("imágenes de las carreras", () => {
  const corredores = ["teto", "miku", "neru", "kaito", "gumi", "pina"].map((id) => ({ nombre: id, color: "#D23246", avatar: readFileSync(avatarFile(id)) }));

  it("dibuja las tres versiones del banner de apuestas", async () => {
    for (const version of VERSIONES_APUESTAS) {
      const png = await bannerApuestas({ version, corredores, hora: "17:40", minutos: 5 });
      expect(png.subarray(1, 4).toString()).toBe("PNG");
    }
  });

  it("dibuja el podio lleno (nombres larguísimos, muchos apostadores, sin icono) y vacío", async () => {
    const largo = (nivel: number) => papu("UnNombreDePapuLarguisimoQueNoCabeEnLaEtiqueta", nivel);
    const lista = [...Array.from({ length: 6 }, () => largo(4)), ...Array.from({ length: 20 }, () => largo(-1))];
    const c = (i: number, apostadores: Apostador[]) => ({ ...corredores[i]!, pagos: { ganador: 2.4, segundo: 1.4, tercero: 1.1 }, repartido: 123456, apostadores });
    const lleno = await bannerPodio({ podio: [c(0, lista), c(1, []), c(2, lista.slice(0, 3))], vallas: Array.from({ length: 9 }, () => ({ tipo: "honor" as const, papu: largo(-1) })), tambien: Array.from({ length: 40 }, () => largo(-1)), hora: "17:40" });
    const vacio = await bannerPodio({ podio: [c(0, []), c(1, []), c(2, [])], vallas: [], tambien: [], hora: "17:40" });
    expect(lleno.subarray(1, 4).toString()).toBe("PNG");
    expect(vacio.subarray(1, 4).toString()).toBe("PNG");
  });
});
