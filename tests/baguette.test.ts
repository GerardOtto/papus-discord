import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readDelivery, splitNotes, uploadLimitBytes } from "../src/services/baguette";

const NOTES = "﻿===== Mensaje 1 de 2 (20 caracteres) =====\r\n\r\n# Notas\r\nhola <https://x.y>\r\n\r\n===== Mensaje 2 de 2 (5 caracteres) =====\r\n\r\n— GyroP\r\n";

describe("entrega Baguette", () => {
  it("separa las notas en mensajes, sin la linea separadora", () => {
    expect(splitNotes(NOTES)).toEqual(["# Notas\nhola <https://x.y>", "— GyroP"]);
  });

  it("rechaza un mensaje de mas de 2000 caracteres", () => {
    expect(() => splitNotes(`===== Mensaje 1 de 1 =====\n${"a".repeat(2001)}`)).toThrow(/2001/);
  });

  it("limite de subida segun las mejoras del servidor", () => {
    expect(uploadLimitBytes(0)).toBe(10 * 1024 * 1024);
    expect(uploadLimitBytes(2)).toBe(50 * 1024 * 1024);
    expect(uploadLimitBytes(3)).toBe(100 * 1024 * 1024);
  });

  it("lee la carpeta de la entrega (o la de Discord directamente)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "baguette-"));
    const dir = path.join(root, "Discord (Baguette)");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "Notas de producción.txt"), NOTES);
    writeFileSync(path.join(dir, "Adelanto 24 h.mp4"), Buffer.alloc(1234));
    for (const folder of [root, dir]) {
      const d = readDelivery(folder);
      expect(d.notes).toHaveLength(2);
      expect(d.teaser).toEqual({ file: path.join(dir, "Adelanto 24 h.mp4"), bytes: 1234 });
      expect(d.teaserText).toBeNull();
    }
    writeFileSync(path.join(dir, "Adelanto.txt"), "🎬 Adelanto\n");
    expect(readDelivery(root).teaserText).toBe("🎬 Adelanto");
  });
});
