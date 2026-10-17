import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";
import { BASE_ENV } from "./helpers";

describe("loadConfig", () => {
  it("lee tokens, cuota y zona horaria con valores por defecto", () => {
    const c = loadConfig({ ...BASE_ENV }, "C:/repo");
    expect(c.tokens.neru).toBe("n");
    expect(c.dailyQuota).toBe(7);
    expect(c.quotaTimeZone).toBe("America/Santiago");
    expect(c.ownerId).toBeNull();
  });

  it("los Vocaloids de conversacion son opcionales: se conectan solo con token", () => {
    expect(loadConfig({ ...BASE_ENV }).activeBots).toEqual(["teto", "miku", "luka", "neru"]);
    const c = loadConfig({ ...BASE_ENV, DISCORD_TOKEN_IA: "i", DISCORD_TOKEN_GAKUPO: " " });
    expect(c.activeBots).toEqual(["teto", "miku", "luka", "neru", "ia"]);
    expect(c.tokens.ia).toBe("i");
    expect(c.tokens.gakupo).toBeUndefined();
  });

  it("falla nombrando las variables que faltan, sin mostrar valores", () => {
    const { DISCORD_TOKEN_MIKU: _, ...env } = BASE_ENV;
    expect(() => loadConfig(env)).toThrow(/DISCORD_TOKEN_MIKU/);
  });

  it("rechaza una cuota o zona horaria invalidas", () => {
    expect(() => loadConfig({ ...BASE_ENV, DAILY_QUOTA: "-1" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE_ENV, DAILY_QUOTA: "2.5" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE_ENV, QUOTA_RESET_TZ: "Marte/Olympus" })).toThrow(ConfigError);
  });
});
