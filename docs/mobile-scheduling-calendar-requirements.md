# Requirements — Mobile Scheduling Calendar (month view → day detail)

**Status:** proposed · **Date:** 2026-07-13 · **Area:** `src/pages/SchedulingPage.tsx`
**Trigger:** client feedback — the current scheduling grid is a desktop spreadsheet that is unusable on a phone (1020px+ wide, horizontal-scroll only). Client wants "a calendar like Google Calendar; tap a day to see that day's schedule."

---

## 1. Goal

Give coordinators and restaurant managers a phone-friendly way to read and edit the schedule:

1. A **month calendar** (Google-Calendar style) that shows, at a glance, which days have coverage, which have a deficit, and which are weekend/bonus days.
2. Tapping a day opens a **day detail** view that lists that day's shifts (lunch/dinner) → restaurants → assigned people, with the same assign/remove actions the desktop grid already has.

This is an **additive view**, not a rewrite of the scheduling logic. All business rules (cycles, availability, waiting list, conflicts, eligibility, publish lock, manager scope) stay exactly as they are today.

## 2. Scope & where it applies

- **Mobile (below the `sm` / 640px breakpoint):** the calendar + day-detail becomes the default and only scheduling UI. The current wide grid is hidden (`hidden sm:block`).
- **Desktop (`sm` and up):** unchanged — the existing week/month/custom grid stays. (Optional future: offer the calendar as a 4th view mode on desktop too. Out of scope for this update.)
- No backend changes. The calendar and the day detail are both fed by the **existing** `getWeekBoard({ rangeStart, rangeEnd, cycleId, restaurantId })` call over a full-month range.

## 3. Data source (reuse, no new API)

- On month change, call `getWeekBoard` with `rangeStart = first of month`, `rangeEnd = last of month` (reuse `monthRefOf`, `endOfMonth`). Also fetch the cycle via `getCycleByMonth` as today.
- Per-day aggregation for the calendar cells is computed **client-side** from `board.shifts[].restaurants[].cells[]`:
  - `assignedTotal(day)` = Σ `cell.assignedCount` for all cells on that date.
  - `deficitTotal(day)` = Σ `cell.deficit` for all cells on that date.
  - `requiredTotal(day)` = Σ `cell.required`.
  - `isWeekendMandatory(day)` = any cell that date has `isWeekendMandatory === true`.
  - `hasAnyDemand(day)` = `requiredTotal > 0 || assignedTotal > 0`.
- The day-detail view **filters the same already-loaded board** to the selected date — no extra request when switching days within the loaded month.
- The existing per-cell candidate/assign flow (`ScheduleCell`, `listSlotAvailability`, `listAllMembers`, `createAssignment`, `cancelAssignment`) is reused verbatim inside the day detail.

## 4. Month calendar view

### 4.1 Layout
- Standard 7-column month grid, weeks as rows. **Week starts Monday** (the app's week rule — reuse `mondayOf`); weekday header row = Seg…Dom, localized.
- Leading/trailing days from adjacent months are shown greyed (muted) and are still tappable (they belong to a different month's board — see §4.4).
- Each day cell is a tap target of at least 44×44px.

### 4.2 What each day cell shows
Priority order, kept compact so it fits a phone cell:
1. **Day number** (top). Today is highlighted (ring/filled per existing `isToday` styling); weekend days (Fri/Sat/Sun) use the primary color like the current grid.
2. **Coverage indicator** — a small badge/dot with `assignedTotal`. If `deficitTotal > 0`, the indicator is **red (destructive)**; otherwise neutral/secondary. Days with `hasAnyDemand === false` show nothing (no dot) — a plain empty day.
3. **Weekend-bonus mark** — the amber star when `isWeekendMandatory` is true (matches current grid's star semantics).
4. Optional density cue: if the phone cell is too small for numbers, fall back to a colored dot (green = fully covered, red = deficit, grey = no demand).

### 4.3 Navigation
- Header shows the **month + year** label (localized, capitalized), with **‹ prev / next ›** chevrons and a **"Hoje" (Today)** button — reuse `goPrev`/`goNext`/`goToday`, but stepping by **month** in this view regardless of the desktop `viewMode`.
- The existing **restaurant filter** still applies: when a restaurant is selected, the calendar aggregates only that restaurant's cells. The filter control stays visible above the calendar (already wraps on mobile).
- The **cycle status badge** (draft/published), **"criar ciclo"** action, and **publish** button remain accessible on mobile (in a collapsed header or a top action row). Publishing is a coordinator-only action (`scope.canEditAll`).

### 4.4 Month-boundary taps
- Tapping a greyed adjacent-month day navigates the calendar to that month AND opens its day detail. Because the loaded board only covers the current month, switching months triggers the normal month reload before the detail renders (show the loading state briefly).

## 5. Day detail view

Opens when a day is tapped. Presented as either a full-screen sheet/drawer (preferred on mobile, reuse the existing `Sheet` component used for the sidebar drawer) or an inline expanded panel below the calendar. Must be dismissible (back/close) and must not horizontally overflow at 360px.

### 5.1 Header
- Full date, localized via `formatDateBR` (e.g. "sábado, 12/07/2026").
- Weekend-bonus badge when applicable.
- Prev/next **day** arrows to move one day without returning to the calendar (stays within the loaded month; crossing the month edge reloads).

### 5.2 Body — stacked, no horizontal scroll
For the selected date, render **per shift** (Almoço, then Janta), each as a section:
- Section header: shift icon (sun/moon) + label + time range (reuse existing shift header).
- Under each shift, one block **per restaurant** that has demand or assignments that day:
  - Restaurant name; a **"somente leitura" (read-only)** tag when the current user is a manager who can't edit this restaurant (`canEdit && !mayEditRow`).
  - **Assigned count** badge — red when that cell has a deficit.
  - The **assigned people** as a vertical list (name + first-name, score, stars, remove ✕ when editable) — reuse the `cell.assigned` rendering.
  - A **deficit line** ("faltam N") when `cell.deficit > 0`.
  - An **assign** affordance: tapping opens the existing candidate/waiting-list popover/sheet (`ScheduleCell` logic) — availability-ranked candidates, "assign anyone" fallback, conflict flags, eligibility warning toast. On mobile this should render as a sheet or full-width popover (already fixed to `w-[min(20rem,calc(100vw-2rem))]`).
- Days with no demand and no assignments across all shifts show an empty state ("Sem demanda neste dia").

### 5.3 Editing rules (unchanged, must be honored)
- Edits allowed only when a cycle exists and is **not published** (`canEdit = !!cycle && cycle.status !== 'published'`). When published, the detail is read-only (no assign/remove controls).
- **Manager scope:** managers see all restaurants but can only edit their own (`scope.ids`); coordinators edit all (`scope.canEditAll`). Same `rowCanEdit` logic as the grid.
- **Conflict flag:** a candidate already assigned to another restaurant in the same date+shift is flagged and blocked, reusing `busyByDateShift`.
- After any assign/remove, reload the month board (`loadBoard`) so both the calendar indicators and the open day detail reflect the change.

## 6. States
- **Loading:** month board loading → calendar skeleton or spinner; day detail shows loading text.
- **No cycle for the month:** calendar still renders demand-less (all empty), with the existing "no cycle" notice + "criar ciclo" (coordinator) in the header. Assigns are disabled until a cycle exists.
- **No restaurants / empty board:** show the existing empty-state card message.

## 7. Non-goals
- No change to the scheduling backend, availability, scoring, payroll, or publish flow.
- No change to the desktop grid behavior.
- No offline/caching behavior beyond what exists.
- Drag-and-drop assignment is out of scope (tap-to-assign only).

## 8. i18n
- Reuse existing `skala.scheduleBuilder.*` keys where possible (shift labels, assign, waiting list, deficit, read-only, publish, create cycle, today).
- New keys needed: month-calendar weekday abbreviations (or derive via `Intl`), "day detail" close/back label, "no demand this day" empty state, per-day "coverage" aria-labels for accessibility.
- All new strings added to both `pt-BR` and `en` resource files.

## 9. Accessibility
- Day cells are real buttons with an aria-label like "12 de julho, 5 escalados, déficit de 2".
- Day detail is a focus-trapped dialog/sheet; ESC / back closes it.
- Color is never the only signal for deficit — pair red with the numeric count or an icon.

## 10. Acceptance criteria
1. On a 360px viewport, the scheduling page shows a month calendar with **no horizontal scroll** anywhere on the page.
2. Each day with demand shows a coverage count; days with a deficit are visibly red; weekend-bonus days show the star.
3. Prev/next month and "Hoje" navigate correctly; week starts Monday.
4. Tapping any day opens a day detail listing that day's lunch/dinner shifts and restaurants, matching the numbers shown on the desktop grid for the same date/filters.
5. From the day detail, a coordinator can assign and remove people (candidate list, "assign anyone", conflict block, eligibility warning) and the calendar count updates after the change.
6. A restaurant manager sees all restaurants but can only edit their own; published cycles are read-only for everyone.
7. The restaurant filter and cycle status/publish controls remain usable on mobile.
8. Desktop (`sm`+) scheduling is visually and behaviorally unchanged.
9. `tsc` passes; no new backend endpoints added.

## 11. Rough implementation outline (for estimation, not binding)
- Add a `MonthCalendar` subcomponent + a `DayDetail` (Sheet) subcomponent inside `SchedulingPage.tsx` (or a new `src/pages/scheduling/` folder).
- Gate with `useIsMobile()` / Tailwind `hidden sm:block` / `sm:hidden`: mobile renders calendar+detail, desktop renders the current grid.
- Reuse `getWeekBoard` month-range load already present; add a `useMemo` that buckets cells by date for O(1) day lookup and per-day aggregates.
- Reuse `ScheduleCell`'s candidate/assign internals — extract the popover body into a shared piece if needed so both grid-cell and day-detail can mount it.
- Estimated size: medium — one page file, no schema/API work.
