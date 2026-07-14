import { describe, it, expect } from "vitest";
import { markShifts } from "./MySchedulePage";
import type { ScheduleAssignment } from "@/lib/skalaup/types";

const a = (date: string, shiftType: "lunch" | "dinner"): ScheduleAssignment =>
  ({ id: `${date}-${shiftType}`, date, shiftType } as ScheduleAssignment);

describe("markShifts", () => {
  it("flags lunch/dinner and counts shifts per day", () => {
    const marks = markShifts([
      a("2026-07-11", "dinner"),
      a("2026-07-15", "lunch"),
      a("2026-07-15", "dinner"),
    ]);
    expect(marks.get("2026-07-11")).toEqual({ lunch: false, dinner: true, count: 1 });
    expect(marks.get("2026-07-15")).toEqual({ lunch: true, dinner: true, count: 2 });
    expect(marks.get("2026-07-20")).toBeUndefined();
  });

  it("normalises ISO-timestamp dates to YYYY-MM-DD keys", () => {
    const marks = markShifts([
      { id: "x", date: "2026-07-11T00:00:00.000Z", shiftType: "lunch" } as ScheduleAssignment,
    ]);
    expect(marks.get("2026-07-11")).toEqual({ lunch: true, dinner: false, count: 1 });
  });
});
