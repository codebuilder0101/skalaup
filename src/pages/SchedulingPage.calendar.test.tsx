import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { aggregateByDay, MonthCalendar } from "./SchedulingPage";
import type { WeekBoard } from "@/lib/skalaup/scheduling";

// Minimal synthetic board for July 2026:
//  - Sat 2026-07-11 lunch: required 5 / assigned 3 → deficit 2, weekend-mandatory
//  - Wed 2026-07-15 dinner: required 2 / assigned 2 → no deficit
function makeBoard(): WeekBoard {
  const person = (id: string, name: string) => ({
    assignmentId: id, userId: `u-${id}`, name, score: 10, level: 2,
    status: "draft" as const, isWeekendMandatory: true, assignedVia: "coordinator" as const,
  });
  return {
    weekStart: "2026-07-01", weekEnd: "2026-07-31", cycleId: "c1",
    days: [],
    shifts: [
      {
        shiftType: "lunch",
        restaurants: [{
          restaurantId: "r1", restaurantName: "Centro",
          startTime: "12:00", endTime: "16:00", slots: [],
          cells: [{
            date: "2026-07-11", weekday: 6, required: 5, requiredSource: "base",
            isWeekendMandatory: true, assignedCount: 3, deficit: 2, candidateCount: 4,
            assigned: [person("a1", "Ana"), person("a2", "Bia"), person("a3", "Caio")],
          }],
        }],
      },
      {
        shiftType: "dinner",
        restaurants: [{
          restaurantId: "r1", restaurantName: "Centro",
          startTime: "18:00", endTime: "22:00", slots: [],
          cells: [{
            date: "2026-07-15", weekday: 3, required: 2, requiredSource: "base",
            isWeekendMandatory: false, assignedCount: 2, deficit: 0, candidateCount: 2,
            assigned: [],
          }],
        }],
      },
    ],
  };
}

describe("aggregateByDay", () => {
  it("sums assigned/deficit/required per date and flags weekend/demand", () => {
    const agg = aggregateByDay(makeBoard());
    expect(agg.get("2026-07-11")).toEqual({
      assigned: 3, deficit: 2, required: 5, weekend: true, hasDemand: true,
    });
    expect(agg.get("2026-07-15")).toEqual({
      assigned: 2, deficit: 0, required: 2, weekend: false, hasDemand: true,
    });
    // A day with no cells is absent from the map.
    expect(agg.get("2026-07-20")).toBeUndefined();
  });

  it("returns an empty map for a null board", () => {
    expect(aggregateByDay(null).size).toBe(0);
  });
});

describe("MonthCalendar", () => {
  const renderCal = (onSelectDay = vi.fn()) => {
    render(
      <MonthCalendar
        monthAnchor="2026-07-01"
        board={makeBoard()}
        today="2026-07-13"
        lng="pt-BR"
        selectedDay={null}
        onSelectDay={onSelectDay}
      />,
    );
    return onSelectDay;
  };

  it("renders July's day numbers (incl. unambiguous mid/end-of-month days)", () => {
    renderCal();
    // 11/13/15/31 appear once (no adjacent-month collision).
    for (const n of [11, 13, 15, 31]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${n}\\b`) })).toBeInTheDocument();
    }
    // Day "1" appears (July 1, plus a trailing Aug 1 in the final week).
    expect(screen.getAllByRole("button", { name: /^1\b/ }).length).toBeGreaterThanOrEqual(1);
  });

  it("shows a deficit day in red with its assigned count and a bonus star", () => {
    renderCal();
    const day11 = screen.getByRole("button", { name: /^11\b/ });
    // Assigned count is shown.
    expect(within(day11).getByText("3")).toBeInTheDocument();
    // Deficit → destructive styling on the count pill.
    const pill = within(day11).getByText("3");
    expect(pill.className).toContain("text-destructive");
    // Weekend-mandatory → a star svg is present.
    expect(day11.querySelector("svg")).toBeTruthy();
  });

  it("shows a fully-covered day in emerald (no deficit)", () => {
    renderCal();
    const day15 = screen.getByRole("button", { name: /^15\b/ });
    const pill = within(day15).getByText("2");
    expect(pill.className).toContain("emerald");
    expect(pill.className).not.toContain("text-destructive");
  });

  it("fires onSelectDay with the ISO date when a day is tapped", () => {
    const onSelectDay = renderCal();
    fireEvent.click(screen.getByRole("button", { name: /^11\b/ }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-07-11");
  });

  it("renders a Monday-first grid whose cell count is a multiple of 7", () => {
    renderCal();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length % 7).toBe(0);
    // July 2026 starts on a Wednesday → 5 weeks (35 cells) cover it.
    expect(buttons.length).toBe(35);
  });
});
