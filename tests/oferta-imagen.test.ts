import { describe, expect, it } from "vitest";
import { ofertaImage } from "../src/coins/images";
import { loadCatalog } from "../src/coins/rules";

describe("imagen de las ofertas de #centro-de-comercio", () => {
  const cat = loadCatalog();
  it("sin objetos no hay imagen", async () => {
    expect(await ofertaImage({ titulo: "Oferta #1", entrega: [], pide: [] })).toBeNull();
  });
  it("con objetos sale un JPG con sus cartas", async () => {
    const img = await ofertaImage({ titulo: "Oferta #2", entrega: cat.slice(0, 7), pide: cat.slice(7, 8) });
    expect(img).not.toBeNull();
    expect(img!.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});
