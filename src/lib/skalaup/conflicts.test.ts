import { describe, it, expect } from "vitest";
import { windowsOverlap, findBusyConflict } from "./conflicts";
import type { BusyWindow } from "./scheduling";

const w = (startTime: string, endTime: string) => ({ startTime, endTime });

describe("windowsOverlap", () => {
  // The bug this rule exists for: MANÉ BSB runs a 14:00–22:00 shift filed as
  // "lunch", which the old shift_type check happily paired with an 18:00–22:00
  // "dinner" at CB Lago Norte — the same person at two addresses at once.
  it("flags a late lunch that runs into another restaurant's dinner", () => {
    expect(windowsOverlap(w("14:00", "22:00"), w("18:00", "22:00"))).toBe(true);
  });

  it("allows a standard lunch and dinner on the same day", () => {
    expect(windowsOverlap(w("12:00", "16:00"), w("18:00", "22:00"))).toBe(false);
  });

  it("allows back-to-back shifts that only touch", () => {
    expect(windowsOverlap(w("12:00", "17:00"), w("17:00", "22:00"))).toBe(false);
  });

  it("flags a one-minute overlap", () => {
    expect(windowsOverlap(w("12:00", "17:01"), w("17:00", "22:00"))).toBe(true);
  });

  it("is symmetric", () => {
    expect(windowsOverlap(w("18:00", "22:00"), w("14:00", "22:00"))).toBe(true);
  });

  it("treats an end at or before the start as crossing midnight", () => {
    expect(windowsOverlap(w("19:00", "01:00"), w("12:00", "16:00"))).toBe(false);
    expect(windowsOverlap(w("19:00", "01:00"), w("20:00", "23:00"))).toBe(true);
  });

  it("ignores seconds in the time string", () => {
    expect(windowsOverlap(w("14:00:00", "22:00:00"), w("18:00:00", "22:00:00"))).toBe(true);
  });
});

describe("findBusyConflict", () => {
  const windows: BusyWindow[] = [
    { userId: "u1", date: "2026-09-19", restaurantName: "MANÉ BSB", startTime: "14:00", endTime: "22:00" },
    { userId: "u2", date: "2026-09-19", restaurantName: "REBU", startTime: "12:00", endTime: "16:00" },
  ];

  it("names the shift standing in the way", () => {
    expect(findBusyConflict(windows, "u1", w("18:00", "22:00"))?.restaurantName).toBe("MANÉ BSB");
  });

  it("only looks at the given freelancer", () => {
    expect(findBusyConflict(windows, "u2", w("18:00", "22:00"))).toBeUndefined();
  });

  it("returns nothing when the hours are free", () => {
    expect(findBusyConflict(windows, "u2", w("18:00", "22:00"))).toBeUndefined();
    expect(findBusyConflict([], "u1", w("18:00", "22:00"))).toBeUndefined();
  });
});
