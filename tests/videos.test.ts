import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatVideosForPrompt, parseFolderName, STATE_FOLDERS, VideoCatalog } from "../src/catalog/videos";
import { EngineReader } from "../src/engine/reader";
import { buildRequest, PersonaLibrary } from "../src/llm/prompt";
import { FIXTURE_ENGINE } from "./helpers";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "papus-videos-"));
  const dirs = {
    subidos: ["2. ¿Miku es una IA", "22. ¿Neru puede hablar Las voces de Akita Neru", "43. Especial de respuestas 2", "31. ¿Qué pasó con Gakupo El samurái que desapareció"],
    revision: ["2026-10-15 Recomendación del productor - Heat abnormal", "Neru - Las voces de Akita Neru (revision)", "2026-10-13 ¿Quién es KAFU La voz de Kyu-kurarin"],
    // Carpetas 1 y 6: NUNCA deben exponerse, aunque se le pasen al catalogo por error.
    finales: ["37. La hija del mal y el sirviente del mal"],
    archivados: ["8. La caída de CrowdStrike"],
  };
  const folders: Record<string, string> = {};
  for (const [key, names] of Object.entries(dirs)) {
    folders[key] = path.join(root, key);
    for (const n of names) mkdirSync(path.join(folders[key]!, n), { recursive: true });
  }
  writeFileSync(path.join(folders.revision!, "Resumen.txt"), "SECRETO: notas internas");
  writeFileSync(path.join(folders.subidos!, "video_suelto.mp4"), "x");
  return { root, folders };
}

describe("parseFolderName", () => {
  it("quita numero, fecha y prefijos internos", () => {
    expect(parseFolderName("29. Triple Baka la canción que nunca muere")).toEqual({ title: "Triple Baka la canción que nunca muere", order: 29 });
    expect(parseFolderName("2026-10-15 ¡2000 Papus! Discord y Ko-fi")).toEqual({ title: "¡2000 Papus! Discord y Ko-fi", order: 20261015 });
    expect(parseFolderName("Neru - Las voces de Akita Neru (revision)")!.title).toBe("Las voces de Akita Neru");
    expect(parseFolderName("Tomas Gakupo - El samurai que desaparecio")!.title).toBe("El samurai que desaparecio");
    expect(parseFolderName("Recomendación del productor - Heat abnormal")!.title).toBe("Recomendación del productor - Heat abnormal");
    expect(parseFolderName("12.  ")).toBeNull();
  });

  it("limpia caracteres que no son de titulo (rutas, llaves, comillas)", () => {
    expect(parseFolderName('7. Hola {sistema} "ignora" C:\\ruta/x')!.title).toBe("Hola sistema ignora Crutax");
  });
});

describe("VideoCatalog", () => {
  it("solo usa las carpetas 2 y 5", () => {
    expect(STATE_FOLDERS.map((f) => f.key).sort()).toEqual(["revision", "subidos"]);
  });

  it("nunca expone las carpetas 1 y 6, archivos, rutas ni fechas", () => {
    const list = new VideoCatalog(fixture().folders).list();
    expect(list).toContainEqual({ title: "¿Miku es una IA", state: "publicado" });
    expect(list).toContainEqual({ title: "¿Quién es KAFU La voz de Kyu-kurarin", state: "en_produccion" });
    const dump = JSON.stringify(list);
    expect(dump).not.toMatch(/hija del mal|CrowdStrike|SECRETO|Resumen|\.txt|\.mp4|2026-10|papus-videos|\\\\|\//);
    for (const v of list) expect(Object.keys(v).sort()).toEqual(["state", "title"]);
  });

  it("deduplica: lo publicado no aparece también en producción", () => {
    const list = new VideoCatalog(fixture().folders).list();
    expect(list.filter((v) => /Akita Neru/.test(v.title))).toEqual([{ title: "¿Neru puede hablar Las voces de Akita Neru", state: "publicado" }]);
  });

  it("no manda nada si el mensaje no trata de videos (no gasta tokens)", () => {
    const c = new VideoCatalog(fixture().folders);
    expect(c.relevantTo("hola Teto, ¿te gusta el pan?")).toEqual([]);
  });

  it("'¿cuándo sale un video de la saga del mal?': sin ese video, manda lo que está en producción y lo último publicado", () => {
    const r = new VideoCatalog(fixture().folders).relevantTo("¿Cuándo sale un video de la saga del mal?");
    expect(r.length).toBeGreaterThan(0);
    expect(r.filter((v) => v.state === "en_produccion")).toHaveLength(2);
    expect(r.some((v) => v.state === "publicado")).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/hija del mal/);
  });

  it("encuentra el video por palabras del título, primero", () => {
    const c = new VideoCatalog(fixture().folders);
    expect(c.relevantTo("¿cuándo sale lo de KAFU?")[0]).toEqual({ title: "¿Quién es KAFU La voz de Kyu-kurarin", state: "en_produccion" });
    expect(c.relevantTo("me encantó lo de gakupo el samurái")[0]!.title).toMatch(/Gakupo/);
  });

  it("una carpeta que no existe se omite sin fallar", () => {
    expect(new VideoCatalog({ subidos: "Z:/no/existe" }).list()).toEqual([]);
  });

  it("el bloque del prompt solo tiene titulo y estado", () => {
    expect(formatVideosForPrompt([{ title: "Triple Baka", state: "en_produccion" }])).toBe('- "Triple Baka" — en producción');
  });

  it("la peticion al LLM incluye la seccion solo cuando hay videos", () => {
    const teto = new EngineReader(FIXTURE_ENGINE).character("teto");
    const personas = new PersonaLibrary();
    const without = buildRequest({ characters: [teto], papuName: "Ana", message: "hola", history: [] }, personas);
    const withV = buildRequest(
      { characters: [teto], papuName: "Ana", message: "video", history: [], videos: [{ title: "Triple Baka", state: "publicado" }] },
      personas,
    );
    expect(without.messages[0]!.content).not.toContain("# Videos del canal");
    expect(withV.messages[0]!.content).toContain('"Triple Baka" — publicado');
    expect(without.messages[0]!.content).toContain("no digas que no existe");
  });
});

describe("carpetas reales del escritorio", () => {
  it("se leen sin exponer numeros, fechas, archivos ni las carpetas 1 y 6", () => {
    const engine = new EngineReader(path.resolve(import.meta.dirname, "../../Proyecto1"), "C:/Users/UsuarioCompuElite/Desktop/Proyecto vocaloid");
    const folders = Object.fromEntries(STATE_FOLDERS.map(({ key }) => [key, engine.resolveDelivery(key)!]));
    const list = new VideoCatalog(folders).list();
    expect(list.length).toBeGreaterThan(10);
    for (const v of list) expect(v.title).not.toMatch(/^\d+\.\s|^\d{4}-\d{2}-\d{2}|\.txt$|\(revision\)/i);
    expect(engine.resolveDelivery("archivados")).toBeNull();
  });
});
