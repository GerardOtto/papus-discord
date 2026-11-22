import { describe, expect, it } from "vitest";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { CoinService } from "../src/coins/service";
import { CumpleService, lineaProximo, loadCumpleSettings } from "../src/cumpleanos/service";
import { loadPhraseFile } from "../src/phrases/catalog";
import { cumpleBoton, cumpleConfirmar, cumpleModal, deClave, diasHasta, esCumple, fechaClave, fechaTexto, leerFecha, proximos } from "../src/setup/cumple";
import { memDb } from "./helpers";

const TZ = "America/Santiago";
const at = (iso: string) => Date.parse(iso);

describe("fechas de cumpleaños (#tus-roles, 18 nov. 2026)", () => {
  it("lee día y mes (número o nombre) y rechaza fechas que no existen", () => {
    expect(leerFecha("12", "3")).toEqual({ ok: true, fecha: { dia: 12, mes: 3 } });
    expect(leerFecha(" 5 ", "Noviembre")).toEqual({ ok: true, fecha: { dia: 5, mes: 11 } });
    expect(leerFecha("1", "setiembre")).toEqual({ ok: true, fecha: { dia: 1, mes: 9 } });
    expect(leerFecha("29", "feb")).toEqual({ ok: true, fecha: { dia: 29, mes: 2 } });
    for (const [d, m] of [["31", "4"], ["30", "febrero"], ["0", "1"], ["10", "13"], ["x", "1"], ["3", "ju"]]) expect(leerFecha(d!, m!).ok, `${d}/${m}`).toBe(false);
  });

  it("texto y clave", () => {
    expect(fechaTexto({ dia: 12, mes: 3 })).toBe("12 de marzo");
    expect(fechaClave({ dia: 5, mes: 11 })).toBe("11-05");
    expect(deClave("11-05")).toEqual({ dia: 5, mes: 11 });
    expect(deClave("02-30")).toBeNull();
  });

  it("el 29 de febrero se celebra el 28 en los años no bisiestos", () => {
    const f = { dia: 29, mes: 2 };
    expect(esCumple(f, "2027-02-28")).toBe(true);
    expect(esCumple(f, "2028-02-28")).toBe(false);
    expect(esCumple(f, "2028-02-29")).toBe(true);
  });

  it("los próximos 7 días, del más cercano al más lejano (cruzando el año)", () => {
    expect(diasHasta({ dia: 2, mes: 1 }, "2026-12-30")).toBe(3);
    const lista = proximos(
      [
        { quien: "a", fecha: { dia: 25, mes: 11 } },
        { quien: "b", fecha: { dia: 18, mes: 11 } },
        { quien: "c", fecha: { dia: 26, mes: 11 } },
        { quien: "d", fecha: { dia: 20, mes: 11 } },
      ],
      "2026-11-18",
      7,
    );
    expect(lista.map((x) => [x.quien, x.en])).toEqual([["b", 0], ["d", 2], ["a", 7]]);
    expect(lineaProximo(lista[1]!, "**Ana**")).toBe("• 20 de noviembre — **Ana** (en 2 días)");
  });

  it("botón, ventanita y confirmación de #tus-roles", () => {
    expect(JSON.stringify(cumpleBoton())).toContain("papu_cumple");
    expect(JSON.stringify(cumpleModal())).toContain("sin el año");
    expect(JSON.stringify(cumpleConfirmar({ dia: 12, mes: 3 }))).toContain("papu_cumple_ok:03-12");
  });
});

describe("cumpleaños en el bot", () => {
  const s = loadCumpleSettings();

  function setup(now: number) {
    const db = memDb();
    let t = now;
    const c = new CumpleService({ db, query: null, settings: s, timeZone: TZ, now: () => t });
    c.cargar(new Map([["ana", { dia: 18, mes: 11 }], ["beto", { dia: 21, mes: 11 }], ["ido", { dia: 18, mes: 11 }]]));
    return { db, c, set: (x: number) => (t = x) };
  }

  it("la config: Ruko a las 12, 7 días, XP ×2, la insignia existe y Teto el 1 de abril (lore del motor)", () => {
    expect(s).toMatchObject({ hora: 12, dias: 7, bot: "ruko", multiplicador: 2 });
    expect(loadCatalog().find((o) => o.id === s.insignia)?.rareza).toBe("exclusivo");
    expect(s.vocaloids.teto).toBe("04-01");
  });

  it("XP ×2 solo su día (hora de Chile)", () => {
    const { c, set } = setup(at("2026-11-18T15:00:00-03:00"));
    expect(c.boost("ana")).toBe(2);
    expect(c.boost("beto")).toBe(1);
    set(at("2026-11-19T00:30:00-03:00"));
    expect(c.boost("ana")).toBe(1);
  });

  it("el aviso: los de hoy, los de los próximos días y los Vocaloids; sin los que ya no están", () => {
    const { c } = setup(at("2026-11-18T12:00:00-03:00"));
    const a = c.aviso((id) => id !== "ido")!;
    expect(a.hoyPapus).toEqual(["ana"]);
    expect(a.pronto.map((x) => x.quien)).toContainEqual({ tipo: "papu", id: "beto" });
    // Ningún Vocaloid con fecha cumple entre el 18 y el 25 de noviembre.
    expect(a.hoyVocaloids).toEqual([]);
    const miku = setup(at("2026-08-31T12:00:00-04:00")).c.aviso(() => true)!;
    expect(miku.hoyVocaloids).toContain("miku");
  });

  it("/cumple proximos mira 30 días (Haku el 21 y Meiko no, que ya pasó)", () => {
    const { c } = setup(at("2026-11-18T12:00:00-03:00"));
    const a = c.aviso(() => true, undefined, 30)!;
    expect(a.pronto.map((x) => x.quien.id)).toContain("haku");
    expect(a.pronto.map((x) => x.quien.id)).not.toContain("meiko");
    expect(a.pronto.every((x) => x.en <= 30)).toBe(true);
    // El aviso diario sigue mirando 7 días.
    expect(c.aviso(() => true)!.pronto.every((x) => x.en <= 7)).toBe(true);
  });

  it("el aviso sale una vez al día, desde las 12", () => {
    const { c, set } = setup(at("2026-11-18T11:59:00-03:00"));
    expect(c.tocaAviso()).toBe(false);
    set(at("2026-11-18T12:00:00-03:00"));
    expect(c.tocaAviso()).toBe(true);
    expect(c.tocaAviso()).toBe(false);
    set(at("2026-11-19T12:01:00-03:00"));
    expect(c.tocaAviso()).toBe(true);
  });

  it("la insignia del pastel: una vez, y se la pone si tiene lugar", () => {
    const { db, c } = setup(at("2026-11-18T09:00:00-03:00"));
    const coins = new CoinService({ db, settings: loadCoinSettings(), catalog: loadCatalog(), timeZone: TZ });
    expect(c.insigniasPendientes()).toEqual(["ana", "ido"]);
    c.marcarInsignia("ana");
    expect(c.insigniasPendientes()).toEqual(["ido"]);
    expect(coins.giftBadge("ana", s.insignia, "cumpleaños")?.id).toBe(s.insignia);
    expect(coins.giftBadge("ana", s.insignia, "cumpleaños")).toBeNull();
    expect([...coins.equipped("ana").values()].map((o) => o.id)).toContain(s.insignia);
  });

  it("Ruko tiene 30 frases de cada grupo de cumpleaños", () => {
    const f = loadPhraseFile("ruko");
    for (const [g, campo] of [["cumple_hoy", "{papus}"], ["cumple_vocaloid", "{vocaloid}"], ["cumple_proximos", ""]] as const) {
      expect(f[g]!.length, g).toBeGreaterThanOrEqual(30);
      if (campo) for (const x of f[g]!) expect(x, g).toContain(campo);
    }
  });
});
