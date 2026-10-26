import { describe, expect, it } from "vitest";
import { addDays, choices, isHonorWeek, weekToShow, zonedTime } from "../src/calendar/plan";
import { CalendarService, type FinalVideo } from "../src/calendar/service";
import { memDb } from "./helpers";

const ZONA = "America/Mexico_City";
const settings = { canal: "calendario", hora: "13:00", zona: ZONA, semanas: 2 };
const rounds = { primera: Date.parse("2026-10-17T18:00:00-03:00"), cadaDias: 7, opciones: 3, semilla: ["Video de Kafu", "Video de Ruko", "Video de Momo"] };
const honor = { primera: Date.parse("2026-10-19T18:00:00-03:00"), cadaDias: 14 };
const FINALES: FinalVideo[] = [
  { order: 21, title: "TetoPera, Tako Luka y las mascotas más raras de Vocaloid" },
  { order: 20, title: "Objetos Vocaloid parte 2" },
  { order: 23, title: "Las versiones masculinas de Vocaloid" },
  { order: 24, title: "¿Quién es Saki Fujita? La mamá de Miku" },
  { order: 25, title: "Las colaboraciones más extrañas de Miku" },
];

interface Tables {
  rondas?: unknown[];
  candidatos?: unknown[];
  rondas_honor?: unknown[];
  listos?: unknown[];
}
function service(tables: Tables, now: string, db = memDb(), finales = FINALES) {
  const query = async <T>(sql: string): Promise<T[]> => {
    const t = /FROM (\w+)/.exec(sql)![1] as keyof Tables;
    return (tables[t] ?? []) as T[];
  };
  return new CalendarService({ db, query, finales: () => finales, rounds, honor, settings, now: () => Date.parse(now) });
}
const at = (iso: string) => Date.parse(iso);

describe("calendario: fechas", () => {
  it("13:00 de México y la semana que se muestra", () => {
    expect(zonedTime("2026-10-19", "13:00", ZONA)).toBe(at("2026-10-19T19:00:00Z"));
    expect(weekToShow("2026-10-21")).toBe("2026-10-19"); // miércoles: la semana en curso
    expect(weekToShow("2026-10-17")).toBe("2026-10-19"); // sábado: la que viene
    expect(weekToShow("2026-10-18")).toBe("2026-10-19"); // domingo: la que viene
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });

  it("la votación de honor va cada 2 semanas desde el lunes 19", () => {
    expect(isHonorWeek("2026-10-19", "2026-10-19", 14)).toBe(true);
    expect(isHonorWeek("2026-10-26", "2026-10-19", 14)).toBe(false);
    expect(isHonorWeek("2026-11-02", "2026-10-19", 14)).toBe(true);
    expect(isHonorWeek("2026-10-12", "2026-10-19", 14)).toBe(false);
  });

  it("opciones en corto: Video de A / B / C", () => {
    expect(choices(["Video de Kafu", "Video de Ruko", "Video de Momo"])).toBe("Video de Kafu / Ruko / Momo");
    expect(choices(["Video de Kafu", "Especial de Teto"])).toBe("Video de Kafu / Especial de Teto");
  });
});

describe("calendario: lo que muestra", () => {
  it("sábado antes de la primera votación: semana 19 con videos de GyroP y honor por votar; semana 26 con los candidatos", async () => {
    const s = service({ listos: [{ nombre: "Las versiones masculinas de Vocaloid", estado: "espera" }] }, "2026-10-17T15:00:00-03:00");
    const [w1, w2] = await s.build();
    expect(w1!.monday).toBe("2026-10-19");
    expect(w1!.current).toBe(false);
    expect(w1!.slots.map((x) => [x.kind, x.title])).toEqual([
      ["propio", "Objetos Vocaloid parte 2"], // aún no hay ganador Ko-fi para este lunes
      ["propio", "TetoPera, Tako Luka y las mascotas más raras de Vocaloid"],
      ["honor", null],
    ]);
    expect(w1!.slots[2]!.pending).toBe("se vota del lunes al jueves");
    expect(w2!.slots[0]).toMatchObject({ kind: "kofi", title: "Video de Kafu / Ruko / Momo", pending: "se vota del sábado al martes" });
    // La de la lista de honor no se usa como video de GyroP.
    expect(w2!.slots.map((x) => x.title)).toEqual(["Video de Kafu / Ruko / Momo", "¿Quién es Saki Fujita? La mamá de Miku", "Las colaboraciones más extrañas de Miku"]);
    const text = s.render([w1!, w2!]);
    expect(text).toContain("🔜 La próxima semana");
    expect(text).toContain("🗓️ En dos semanas");
    expect(text).toContain(`<t:${at("2026-10-19T19:00:00Z") / 1000}:t>`);
    expect(text).toContain("🗳️ Elegido por los Puerros · se vota del sábado al martes");
  });

  it("un video fijado a mano (config 'fijos') manda; el que tenía ese día vuelve a la fila", async () => {
    const db = memDb();
    const now = "2026-10-18T12:00:00-03:00";
    await service({}, now, db).build(); // lunes 19 = "Objetos Vocaloid parte 2" (asignado y guardado)
    const kaito = "¿Quién es KAITO? Sus canciones, sus shipeos y su origen";
    const query = async <T>(): Promise<T[]> => [];
    const fixedSettings = { ...settings, fijos: { $comment: "x", "2026-10-19": kaito } };
    const s = new CalendarService({ db, query, finales: () => FINALES, rounds, honor, settings: fixedSettings, now: () => Date.parse(now) });
    const [w1] = await s.build();
    expect(w1!.slots[0]).toMatchObject({ kind: "propio", title: kaito });
    expect(w1!.slots[1]!.title).toBe("TetoPera, Tako Luka y las mascotas más raras de Vocaloid"); // los demás días no cambian
    // "Objetos" quedó libre: sale en el próximo día de GyroP que no tenga video (sin fijos, el 19 lo recupera).
    const [again] = await service({}, now, db).build();
    expect(again!.slots[0]!.title).toBe("Objetos Vocaloid parte 2");
  });

  it("estrenos de /estreno: solo los del último día", async () => {
    const now = Date.parse("2026-10-22T18:00:00-03:00");
    const seen: unknown[][] = [];
    const query = async <T>(_sql: string, ...params: unknown[]): Promise<T[]> => {
      seen.push(params);
      return [{ titulo: "Triple Baka", at: now - 60_000 }] as T[];
    };
    const s = new CalendarService({ db: memDb(), query, finales: () => FINALES, rounds, honor, settings, now: () => now });
    expect(await s.launched()).toEqual([{ title: "Triple Baka", at: now - 60_000 }]);
    expect(seen[0]).toEqual([now - 86_400_000]);
  });

  it("un fijado con hora propia sale a esa hora (ej.: 18:00 de Chile)", async () => {
    const now = "2026-10-18T12:00:00-03:00";
    const query = async <T>(): Promise<T[]> => [];
    const fijos = { "2026-10-21": { titulo: "Carrusel de Bad End Night", hora: "18:00", zona: "America/Santiago" } };
    const s = new CalendarService({ db: memDb(), query, finales: () => FINALES, rounds, honor, settings: { ...settings, fijos }, now: () => Date.parse(now) });
    const weeks = await s.build();
    expect(weeks[0]!.slots[1]).toMatchObject({ kind: "propio", title: "Carrusel de Bad End Night" });
    const text = s.render(weeks);
    expect(text).toContain(`<t:${at("2026-10-21T21:00:00Z") / 1000}:t>`);
    expect(text).toContain(`<t:${at("2026-10-19T19:00:00Z") / 1000}:t>`); // los demás días, a la hora de siempre
  });

  it("con ganadores: lunes del Ko-fi, idea de honor al viernes siguiente, y los de GyroP no cambian", async () => {
    const db = memDb();
    const tables: Tables = {
      rondas: [
        { opciones: JSON.stringify(["Video de Momo", "Video de Gumi", "Video de Rin"]), estado: "abierta", ganador: null, abierta_at: at("2026-10-24T18:00:00-03:00") },
        { opciones: JSON.stringify(["Video de Kafu", "Video de Ruko", "Video de Momo"]), estado: "cerrada", ganador: "Video de Ruko", abierta_at: at("2026-10-17T18:00:00-03:00") },
      ],
      rondas_honor: [
        { opciones: JSON.stringify(["Las versiones masculinas de Vocaloid", "Especial de Teto SV"]), estado: "cerrada", ganador: "Especial de Teto SV", abierta_at: at("2026-10-19T18:00:00-03:00") },
      ],
      listos: [{ nombre: "Las versiones masculinas de Vocaloid", estado: "espera" }],
    };
    const first = await service(tables, "2026-10-21T10:00:00-03:00", db).build(); // miércoles 21
    expect(first[0]!.current).toBe(true);
    // Ganó una idea: este viernes va uno de GyroP, la idea sale el viernes 30.
    expect(first[0]!.slots[2]).toMatchObject({ kind: "propio" });
    expect(first[1]!.slots[0]).toMatchObject({ kind: "kofi", title: "Video de Ruko" });
    expect(first[1]!.slots[2]).toMatchObject({ kind: "honor", title: "Especial de Teto SV" });
    // La semana siguiente (lunes 2 nov.): la votación abierta del sábado 24 con sus opciones.
    const later = await service(tables, "2026-10-28T10:00:00-03:00", db).build();
    expect(later[1]!.slots[0]).toMatchObject({ kind: "kofi", title: "Video de Momo / Gumi / Rin", pending: "se vota hasta el martes" });
    // El miércoles 28 conserva el video que se le asignó la semana pasada.
    expect(later[0]!.slots[1]!.title).toBe(first[1]!.slots[1]!.title);
  });
});
