import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MonthCalendarGrid, monthGridCells, type DayMark } from "./MonthCalendarGrid";

describe("monthGridCells", () => {
  it("builds a Sunday-first grid whose length is a multiple of 7", () => {
    // July 2026 starts on a Wednesday → Sunday-first grid begins Sun Jun 28.
    const cells = monthGridCells("2026-07-15");
    expect(cells.length % 7).toBe(0);
    expect(cells.length).toBe(35);
    expect(cells[0]).toBe("2026-06-28"); // the Sunday before July 1
    expect(cells).toContain("2026-07-31");
  });

  it("accepts a bare first-of-month reference", () => {
    // Feb 2024 (leap): Feb 1 is a Thursday → grid starts Sun Jan 28.
    const cells = monthGridCells("2024-02-01");
    expect(cells[0]).toBe("2024-01-28");
    expect(cells).toContain("2024-02-29");
  });
});

describe("MonthCalendarGrid", () => {
  const marks = new Map<string, DayMark>([
    ["2026-07-11", { lunch: true, dinner: false, count: 1 }],
    ["2026-07-15", { lunch: true, dinner: true, count: 3 }],
  ]);
  const renderCal = (onSelectDay = vi.fn(), selected: string | null = null) => {
    render(
      <MonthCalendarGrid
        month="2026-07-01"
        marks={marks}
        selectedDate={selected}
        today="2026-07-13"
        lng="pt-BR"
        onSelectDay={onSelectDay}
      />,
    );
    return onSelectDay;
  };

  it("renders a Sunday-first grid (first cell is the preceding Sunday)", () => {
    renderCal();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(35);
    expect(buttons[0].getAttribute("aria-label")).toMatch(/^28\b/); // Jun 28, a Sunday
  });

  it("shows the day number and a count badge for days with multiple picks", () => {
    renderCal();
    const day15 = screen.getByRole("button", { name: /^15\b/ });
    expect(within(day15).getByText("15")).toBeInTheDocument();
    expect(within(day15).getByText("3")).toBeInTheDocument(); // count > 1 badge
  });

  it("does not show a count badge for a single-pick day", () => {
    renderCal();
    const day11 = screen.getByRole("button", { name: /^11\b/ });
    // count is 1 → no numeric badge beyond the day number itself
    expect(within(day11).queryByText("1")).not.toBeInTheDocument();
  });

  it("marks the selected day with aria-pressed", () => {
    renderCal(vi.fn(), "2026-07-15");
    expect(screen.getByRole("button", { name: /^15\b/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^11\b/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onSelectDay with the ISO date when a day is tapped", () => {
    const onSelectDay = renderCal();
    fireEvent.click(screen.getByRole("button", { name: /^15\b/ }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-07-15");
  });
});
