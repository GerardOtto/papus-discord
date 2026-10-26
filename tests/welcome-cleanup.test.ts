import { describe, expect, it } from "vitest";
import { planWelcomeCleanup, WELCOME_GRACE_MS, type WelcomeMessage } from "../src/services/welcome-cleanup";

const H = 3_600_000;
const guide: WelcomeMessage = { id: "guia", at: 0, pinned: true, papus: 0 };
/** n saludos de un Papu, uno cada `gap` ms desde `from`. */
const greetings = (n: number, from: number, gap = 60_000) =>
  Array.from({ length: n }, (_, i): WelcomeMessage => ({ id: `s${i + 1}`, at: from + i * gap, pinned: false, papus: 1 }));

describe("planWelcomeCleanup", () => {
  it("con menos de 10 Papus saludados no hace nada", () => {
    expect(planWelcomeCleanup([guide, ...greetings(9, H)], 100 * H)).toEqual({ remove: [], nextAt: null });
  });

  it("al décimo Papu espera 2 horas antes de limpiar", () => {
    const msgs = [guide, ...greetings(10, H)];
    const tenth = msgs.at(-1)!.at;
    expect(planWelcomeCleanup(msgs, tenth + 60_000)).toEqual({ remove: [], nextAt: tenth + WELCOME_GRACE_MS });
  });

  it("pasadas las 2 horas borra los saludos viejos, nunca la guía fijada ni los saludos recientes", () => {
    const msgs = [guide, ...greetings(10, H), { id: "nuevo", at: H + 2.5 * H, pinned: false, papus: 1 }];
    const plan = planWelcomeCleanup(msgs, H + 3 * H);
    expect(plan.remove).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"]);
    expect(plan.remove).not.toContain("guia");
    expect(plan.remove).not.toContain("nuevo");
  });

  it("un saludo grupal cuenta a cada Papu saludado", () => {
    const msgs = [guide, ...greetings(2, H), { id: "grupo", at: 2 * H, pinned: false, papus: 8 }];
    expect(planWelcomeCleanup(msgs, 2 * H).nextAt).toBe(2 * H + WELCOME_GRACE_MS);
  });
});
