import { describe, it, expect } from "vitest";
import { markDraft } from "./AvailabilityPage";
import type { DesiredSlot } from "@/lib/skalaup/availability";

const s = (date: string, shiftType: "lunch" | "dinner", restaurantId: string | null): DesiredSlot =>
  ({ date, shiftType, restaurantId });

describe("markDraft", () => {
  it("flags lunch/dinner and counts every pick per day", () => {
    const draft = new Map<string, DesiredSlot>([
      ["k1", s("2026-07-05", "lunch", null)],
      ["k2", s("2026-07-05", "lunch", "r1")], // same shift, different restaurant → 2 picks
      ["k3", s("2026-07-05", "dinner", "r2")],
      ["k4", s("2026-07-09", "dinner", null)],
    ]);
    const marks = markDraft(draft);
    expect(marks.get("2026-07-05")).toEqual({ lunch: true, dinner: true, count: 3 });
    expect(marks.get("2026-07-09")).toEqual({ lunch: false, dinner: true, count: 1 });
    expect(marks.get("2026-07-01")).toBeUndefined();
  });

  it("returns an empty map for an empty draft", () => {
    expect(markDraft(new Map()).size).toBe(0);
  });
});
