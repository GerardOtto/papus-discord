import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { channelKey } from "../src/discord/channels";
import { loadLayout } from "../src/setup/layout";

const ROOT = path.resolve(import.meta.dirname, "..");
const raw = JSON.parse(readFileSync(path.join(ROOT, "content/guias.json"), "utf8")) as Record<string, unknown>;
const etiquetas = raw.$etiquetas as string[];
const guias = Object.entries(raw).filter(([k]) => !k.startsWith("$")) as [string, { titulo: string; etiquetas: string[]; bot: string; reaccion: string; imagen?: string; texto: string; fijada?: boolean }][];
const canales = new Set(loadLayout().categorias.flatMap((c) => c.canales.filter((ch) => !ch.archivado).map((ch) => channelKey(ch.nombre))));

describe("guías del foro (content/guias.json)", () => {
  it("una sola fijada, etiquetas del foro (máx. 20 letras), títulos y textos que caben", () => {
    expect(guias.filter(([, g]) => g.fijada)).toHaveLength(1);
    expect(etiquetas.length).toBeLessThanOrEqual(20);
    for (const e of etiquetas) expect([...e].length, e).toBeLessThanOrEqual(20);
    for (const [k, g] of guias) {
      expect(g.etiquetas.length, k).toBeGreaterThan(0);
      for (const e of g.etiquetas) expect(etiquetas, k).toContain(e);
      expect(g.titulo.length, k).toBeLessThanOrEqual(100);
      expect(g.texto.length, k).toBeLessThan(3800);
      expect(existsSync(path.join(ROOT, "assets/bots/reacciones", `${g.bot}_${g.reaccion}.png`)), `${k}: reacción`).toBe(true);
      if (g.imagen) expect(existsSync(path.join(ROOT, g.imagen)), `${k}: imagen`).toBe(true);
    }
  });

  it("los enlaces van a canales activos y a guías que existen", () => {
    // Las fichas (npm run peleas:wiki y carreras:wiki) también son publicaciones del foro.
    const claves = new Set([...guias.map(([k]) => k), ...((raw.$wikis as string[] | undefined) ?? [])]);
    for (const [k, g] of guias) {
      for (const [, guia, ref] of g.texto.matchAll(/\{(guia:)?([a-z0-9-]+)\}/g)) {
        if (guia) expect(claves.has(ref!), `${k} → guía ${ref}`).toBe(true);
        else expect(canales.has(ref!), `${k} → #${ref}`).toBe(true);
      }
    }
  });
});
