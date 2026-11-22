import { describe, expect, it } from "vitest";
import { enlacesRedes, RedesStore, usuarioInstagram, usuarioX } from "../src/fanart/redes";
import { memDb } from "./helpers";

describe("redes de los Papus (/redes)", () => {
  it("solo acepta el formato de usuario (el enlace lo arma el bot)", () => {
    expect(usuarioInstagram("@papu.artista")).toBe("papu.artista");
    expect(usuarioInstagram("https://www.instagram.com/papu_dibuja/")).toBe("papu_dibuja");
    expect(usuarioInstagram("papu..raro")).toBeNull();
    expect(usuarioInstagram("javascript:alert(1)")).toBeNull();
    expect(usuarioInstagram("a".repeat(31))).toBeNull();
    expect(usuarioX("@papu_x")).toBe("papu_x");
    expect(usuarioX("https://x.com/papu123")).toBe("papu123");
    expect(usuarioX("nombre.con.puntos")).toBeNull();
    expect(usuarioX("a".repeat(16))).toBeNull();
  });

  it("guarda, muestra y se quita (es opcional)", () => {
    const s = new RedesStore(memDb());
    expect(s.get("u")).toBeNull();
    expect(enlacesRedes(s.get("u"))).toEqual([]);
    s.set("u", { instagram: "papu.artista", x: null });
    expect(enlacesRedes(s.get("u"))).toEqual(["📸 [Instagram](https://instagram.com/papu.artista)"]);
    s.set("u", { instagram: "papu.artista", x: "papu_x" });
    expect(enlacesRedes(s.get("u"))).toHaveLength(2);
    s.set("u", { instagram: null, x: null });
    expect(s.get("u")).toBeNull();
  });
});
