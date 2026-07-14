import { useMemo } from "react";
import { Card } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Shared, presentational month calendar — Sunday-first to match the pt-BR
// calendar our users expect (weekday header reads D S T Q Q S S). It renders a
// month grid with a per-day "mark" (lunch/dinner dots + a count) and reports the
// tapped day via onSelectDay. It fetches nothing; callers build the marks map.
//
// Used by the freelancer schedule (published shifts) and availability entry
// (draft picks). The coordinator scheduling board keeps its own Monday-first
// MonthCalendar (different data model), so this stays freelancer-focused.
// ---------------------------------------------------------------------------

export type DayMark = {
  lunch?: boolean; // has a lunch (almoço) shift/pick that day
  dinner?: boolean; // has a dinner (janta) shift/pick that day
  count?: number; // total items that day (shifts or availability picks)
};

const DAY_MS = 86_400_000;
const dateKey = (d: string) => d.slice(0, 10);
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${dateKey(date)}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const utcDow = (date: string) => new Date(`${dateKey(date)}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat

// Build the Sunday-first grid of YYYY-MM-DD cells covering `month`.
export function monthGridCells(month: string): string[] {
  const ym = dateKey(month).slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const firstOfMonth = `${ym}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const gridStart = addDays(firstOfMonth, -utcDow(firstOfMonth)); // back up to Sunday
  const weeks = Math.ceil((utcDow(firstOfMonth) + daysInMonth) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
}

export function MonthCalendarGrid({
  month,
  marks,
  selectedDate,
  today,
  lng,
  onSelectDay,
  weekendDays = [0, 5, 6], // Fri/Sat/Sun — the most-wanted shifts
  className,
}: {
  month: string; // any YYYY-MM-DD within the month to render
  marks: Map<string, DayMark>;
  selectedDate: string | null;
  today: string;
  lng: string;
  onSelectDay: (date: string) => void;
  weekendDays?: number[];
  className?: string;
}) {
  const monthKey = dateKey(month).slice(0, 7);
  const cells = useMemo(() => monthGridCells(month), [month]);

  // Localized weekday abbreviations, Sunday-first (2023-01-01 was a Sunday).
  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lng, { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(`${addDays("2023-01-01", i)}T00:00:00Z`)),
    );
  }, [lng]);

  return (
    <Card className={`p-2 sm:p-3 ${className ?? ""}`}>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-medium uppercase text-muted-foreground py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date) => {
          const inMonth = date.slice(0, 7) === monthKey;
          const mark = marks.get(date);
          const count = mark?.count ?? 0;
          const isToday = date === today;
          const isSelected = date === selectedDate;
          const weekend = weekendDays.includes(utcDow(date));
          const dayNum = Number(date.slice(8, 10));
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDay(date)}
              aria-pressed={isSelected}
              aria-label={`${dayNum} ${weekdayLabels[utcDow(date)]}${count > 0 ? `, ${count}` : ""}`}
              className={`min-h-[46px] sm:min-h-[52px] rounded-lg border p-1 flex flex-col items-center gap-0.5 transition-colors
                ${isSelected ? "border-primary bg-primary/10" : "border-border/50 hover:bg-accent/40"}
                ${isToday && !isSelected ? "ring-1 ring-primary/50" : ""}
                ${inMonth ? "" : "opacity-40"}`}
            >
              <span
                className={`text-xs font-semibold ${
                  isToday ? "text-primary" : weekend ? "text-primary/80" : "text-foreground"
                }`}
              >
                {dayNum}
              </span>
              <div className="flex items-center gap-0.5 min-h-[8px]" aria-hidden>
                {mark?.lunch && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                {mark?.dinner && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                {count > 1 && <span className="text-[9px] leading-none text-muted-foreground">{count}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
