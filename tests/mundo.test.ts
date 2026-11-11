// Prototipo del mundo 3D de los Papus: reglas puras de la sala (worker/src/mundo/juego.ts).
import { describe, expect, it } from "vitest";
import { COOKIE_TOKEN, cookie, leerCookie, regresoValido, urlAutorizar } from "../worker/src/mundo/web";
import { aparicion, ASPECTOS, limpiarChat, leerPose, moverValido, OBSTACULOS, RADIO, TIENDAS, validarAspecto, VELOCIDAD, ZONAS } from "../worker/src/mundo/juego";
import type { Pose } from "../worker/src/mundo/tipos";
import { seededRng } from "./helpers";

const quieto: Pose = { x: 0, z: 5, r: 0, a: 0, m: 0 };

describe("mundo: movimiento", () => {
  it("acepta caminar y correr a su velocidad", () => {
    expect(moverValido(quieto, { ...quieto, z: 5 + VELOCIDAD.camina * 0.2, a: 1 }, 200)).toBe(true);
    expect(moverValido(quieto, { ...quieto, z: 5 + VELOCIDAD.corre * 0.2, a: 2 }, 200)).toBe(true);
  });

  it("rechaza teletransportarse", () => {
    expect(moverValido(quieto, { ...quieto, x: 15 }, 200)).toBe(false);
  });

  it("la patineta va mas rapido que correr, a pie no", () => {
    const lejos = { ...quieto, z: 5 + VELOCIDAD.montura };
    expect(moverValido(quieto, { ...lejos, m: 1 }, 1000)).toBe(true);
    expect(moverValido(quieto, { ...lejos, m: 0 }, 1000)).toBe(false);
  });

  it("no deja salir de la plaza", () => {
    const borde = { ...quieto, x: RADIO - 0.2, z: 0 };
    expect(moverValido(borde, { ...borde, x: RADIO + 1 }, 200)).toBe(false);
  });

  it("una espera muy larga no habilita saltos enormes", () => {
    expect(moverValido(quieto, { ...quieto, x: 25 }, 60_000)).toBe(false);
  });

  it("lee solo poses con forma valida", () => {
    expect(leerPose({ x: 1.234, z: 2, r: 7, a: 1, m: 0 })).toEqual({ x: 1.23, z: 2, r: Math.round((7 - Math.PI * 2) * 100) / 100, a: 1, m: 0 });
    expect(leerPose({ x: "1", z: 2, r: 0, a: 1, m: 0 })).toBeNull();
    expect(leerPose({ x: Infinity, z: 2, r: 0, a: 1, m: 0 })).toBeNull();
    expect(leerPose({ x: 1, z: 2, r: 0, a: 5, m: 0 })).toBeNull();
  });

  it("se aparece dentro de la plaza y fuera de la fuente y los stands", () => {
    const rnd = seededRng(3);
    for (let i = 0; i < 200; i++) {
      const p = aparicion(rnd);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(RADIO);
      for (const o of OBSTACULOS) expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThan(o.r);
    }
  });

  it("las tiendas tienen su obstaculo y las zonas caben en el mundo", () => {
    for (const s of TIENDAS) expect(OBSTACULOS.some((o) => o.x === s.x && o.z === s.z)).toBe(true);
    for (const z of ZONAS) expect(Math.hypot(z.x, z.z)).toBeLessThan(RADIO - 8);
  });
});

describe("mundo: aspecto y chat", () => {
  it("valida el aspecto por indice", () => {
    expect(validarAspecto({ ropa: 1, piel: 2, sombrero: 4 })).toEqual({ ropa: 1, piel: 2, sombrero: 4 });
    expect(validarAspecto({ ropa: ASPECTOS.ropa.length, piel: 0, sombrero: 0 })).toBeNull();
    expect(validarAspecto({ ropa: 1.5, piel: 0, sombrero: 0 })).toBeNull();
    expect(validarAspecto(null)).toBeNull();
  });

  it("limpia el chat a una linea recortada", () => {
    expect(limpiarChat("  hola\n\n  papus  ")).toBe("hola papus");
    expect(limpiarChat("x".repeat(500))).toHaveLength(120);
    expect(limpiarChat("   ")).toBeNull();
    expect(limpiarChat(42)).toBeNull();
  });
});

describe("mundo: entrada por el navegador", () => {
  it("lee la cookie de sesion entre otras", () => {
    expect(leerCookie("a=1; mundo_token=abc%3D; b=2", COOKIE_TOKEN)).toBe("abc=");
    expect(leerCookie("mundo_tokenx=1", COOKIE_TOKEN)).toBeNull();
    expect(leerCookie(null, COOKIE_TOKEN)).toBeNull();
  });

  it("la cookie es HttpOnly, de /mundo, y Secure solo en https", () => {
    const c = cookie(COOKIE_TOKEN, "t", { maxAge: 60, https: true });
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Path=/mundo");
    expect(c).toContain("Secure");
    expect(cookie(COOKIE_TOKEN, "", { maxAge: 0, https: false })).not.toContain("Secure");
  });

  it("pide a Discord solo quien es y su ficha del servidor, y vuelve a /mundo/api/volver", () => {
    const u = new URL(urlAutorizar("123", "https://x.workers.dev", "e1"));
    expect(u.searchParams.get("scope")).toBe("identify guilds.members.read");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x.workers.dev/mundo/api/volver");
    expect(u.searchParams.get("state")).toBe("e1");
    // El acceso web debe permitir que Discord muestre su login si el Papu no tiene una sesion abierta.
    expect(u.searchParams.has("prompt")).toBe(false);
  });

  it("el regreso exige el mismo state que se guardo", () => {
    expect(regresoValido("c", "e1", "e1")).toBe(true);
    expect(regresoValido("c", "e1", "otro")).toBe(false);
    expect(regresoValido("c", "e1", null)).toBe(false);
    expect(regresoValido(null, "e1", "e1")).toBe(false);
  });
});
