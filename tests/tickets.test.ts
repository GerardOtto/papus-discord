import { describe, expect, it } from "vitest";
import { MAX_TICKETS_PER_DAY, TicketStore } from "../src/services/tickets";
import { memDb } from "./helpers";

describe("tickets de #reportes-y-reclamos", () => {
  const live = (...ids: string[]) => (id: string) => ids.includes(id);

  it("números correlativos y un ticket abierto por Papu", () => {
    const t = new TicketStore(memDb());
    expect(t.canOpen("ana", "2026-10-17", live())).toEqual({ ok: true });
    expect(t.nextNumber()).toBe(1);
    t.opened("ana", "h1", "2026-10-17");
    expect(t.canOpen("ana", "2026-10-17", live("h1"))).toEqual({ ok: false, reason: "abierto", threadId: "h1" });
    expect(t.canOpen("beto", "2026-10-17", live("h1"))).toEqual({ ok: true });
    expect(t.nextNumber()).toBe(2);
  });

  it("cerrar libera al Papu; un hilo archivado o borrado cuenta como cerrado", () => {
    const t = new TicketStore(memDb());
    t.opened("ana", "h1", "2026-10-17");
    expect(t.ownerOf("h1")).toBe("ana");
    expect(t.close("h1")).toBe("ana");
    expect(t.openFor("ana")).toBeNull();
    expect(t.close("otro-hilo")).toBeNull();
    t.opened("ana", "h2", "2026-10-17");
    expect(t.canOpen("ana", "2026-10-17", live())).toEqual({ ok: true });
    expect(t.ownerOf("h2")).toBeNull();
  });

  it(`máximo ${MAX_TICKETS_PER_DAY} por día; al día siguiente se puede de nuevo`, () => {
    const t = new TicketStore(memDb());
    for (let i = 0; i < MAX_TICKETS_PER_DAY; i++) {
      t.opened("ana", `h${i}`, "2026-10-17");
      t.close(`h${i}`);
    }
    expect(t.canOpen("ana", "2026-10-17", live())).toEqual({ ok: false, reason: "limite" });
    expect(t.canOpen("ana", "2026-10-18", live())).toEqual({ ok: true });
  });
});
