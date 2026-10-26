import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deliveryPaths, diffManifest, engineSyncPaths, rewriteEnv, safeRelative, tar, untar } from "../nube/lib";

describe("tar del traslado a la nube", () => {
  const entries = [
    { name: "2. Episodios en revisión" },
    { name: "2. Episodios en revisión/24. ¿Quién es Saki Fujita La mamá de Miku" },
    { name: "src/main.ts", data: Buffer.from("console.log('hola')\n") },
    { name: `assets/${"carpeta-larga/".repeat(10)}imagen.png`, data: Buffer.alloc(1300, 7) },
    { name: "vacio.txt", data: Buffer.alloc(0) },
  ];

  it("ida y vuelta con tildes, ¿ y nombres largos", () => {
    const back = untar(tar(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(back[2]!.data!.toString()).toBe("console.log('hola')\n");
    expect(back[3]!.data!.equals(entries[3]!.data!)).toBe(true);
    expect(back[4]!.data!.length).toBe(0);
  });

  // El servidor extrae con el tar de Linux: los nombres deben salir iguales. (En Windows no aplica: su tar es justo
  // el que guarda mal los nombres.)
  const linuxTar = process.platform !== "win32" && spawnSync("tar", ["--version"]).status === 0;
  it.skipIf(!linuxTar)("el tar de Linux lo extrae con los mismos nombres", () => {
    const out = mkdtempSync(path.join(tmpdir(), "nube-out-"));
    execFileSync("tar", ["-xf", "-"], { cwd: out, input: tar(entries) });
    expect(readdirSync(path.join(out, "2. Episodios en revisión"))).toEqual(["24. ¿Quién es Saki Fujita La mamá de Miku"]);
    expect(readFileSync(path.join(out, entries[3]!.name)).length).toBe(1300);
  });

  it("rechaza rutas que salen de la carpeta", () => {
    expect(safeRelative("../.env")).toBeNull();
    expect(safeRelative("/etc/passwd")).toBe("etc/passwd");
    expect(safeRelative("data/a/../../x")).toBeNull();
    expect(safeRelative("C:/x")).toBeNull();
    expect(safeRelative("./data/papus.sqlite")).toBe("data/papus.sqlite");
  });
});

describe(".env del servidor", () => {
  it("cambia solo las rutas y agrega las que faltan", () => {
    const env = "# tokens\r\nDISCORD_TOKEN_TETO=abc\r\nENGINE_DIR=../Proyecto1\r\nDELIVERY_DIR=C:/Users/x/Desktop\r\n";
    const out = rewriteEnv(env, { ENGINE_DIR: "../motor", DELIVERY_DIR: "/home/ubuntu/papus/entrega", DATA_DIR: "data" });
    expect(out).toBe("# tokens\nDISCORD_TOKEN_TETO=abc\nENGINE_DIR=../motor\nDELIVERY_DIR=/home/ubuntu/papus/entrega\nDATA_DIR=data\n");
  });
});

describe("manifiesto", () => {
  it("sube lo nuevo o cambiado y borra lo que ya no existe", () => {
    expect(diffManifest({ a: "1", b: "2", c: "3" }, { a: "1", b: "x", d: "4" })).toEqual({ changed: ["b", "c"], removed: ["d"] });
  });
});

describe("datos del motor que viajan", () => {
  const paths = JSON.parse(readFileSync(path.join(import.meta.dirname, "../config/engine-paths.json"), "utf8"));

  it("todo lo que el bot revisa al arrancar, sin las carpetas por personaje o episodio", () => {
    const list = engineSyncPaths(paths);
    expect(list).toContain("config/autopilot/lore.json");
    expect(list).toContain("config/characters.json");
    expect(list).toContain("projects/_autopilot/calendario.json");
    expect(list.some((p) => p.includes("{"))).toBe(false);
  });

  it("carpetas de entrega sin la barra final", () => {
    expect(deliveryPaths(paths)).toEqual(["1. Videos finales", "2. Episodios en revisión", "5. Subidos"]);
  });
});
