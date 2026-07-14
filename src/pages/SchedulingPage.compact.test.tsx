import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

function setMatchMedia(compact: boolean) {
  window.matchMedia = ((q: string) => ({
    // compact=true → report a coarse pointer; compact=false → everything false (desktop, mouse).
    matches: compact && q.includes("pointer: coarse"),
    media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// i18n: return the key so we can assert on stable strings.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "pt-BR" } }),
}));
// Layout + heavy children → pass-through / no-op.
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/CycleControl", () => ({ CycleControl: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
// Data layer → deterministic, no network.
vi.mock("@/lib/skalaup/restaurants", () => ({ listRestaurants: () => Promise.resolve({ data: [] }) }));
vi.mock("@/lib/skalaup/availability", () => ({
  getCycleByMonth: () => Promise.resolve({ data: null }),
  createCycle: () => Promise.resolve({ error: null }),
  listSlotAvailability: () => Promise.resolve({ data: [] }),
}));
vi.mock("@/lib/skalaup/assignments", () => ({
  createAssignment: () => Promise.resolve({ data: null, error: null }),
  cancelAssignment: () => Promise.resolve({ error: null }),
  publishCycle: () => Promise.resolve({ error: null }),
}));
vi.mock("@/lib/skalaup/scheduling", () => ({
  getMyScope: () => Promise.resolve({ data: { canEditAll: true, restaurantIds: [] } }),
  listAllMembers: () => Promise.resolve({ data: [] }),
  getWeekBoard: () => Promise.resolve({
    data: { weekStart: "2026-07-01", weekEnd: "2026-07-31", cycleId: null, days: [], shifts: [] },
    error: null,
  }),
}));

import SchedulingPage from "./SchedulingPage";

describe("SchedulingPage — compact (touch) layout", () => {
  it("renders the calendar + inline day view and NOT the desktop grid", async () => {
    setMatchMedia(true);
    render(<SchedulingPage />);

    // Inline day-detail card is present (its prev/next-day controls have literal labels).
    expect(await screen.findByLabelText("Previous day")).toBeInTheDocument();
    expect(screen.getByLabelText("Next day")).toBeInTheDocument();

    // The calendar rendered day buttons (month-nav "Previous" + day cells).
    expect(screen.getByLabelText("Previous")).toBeInTheDocument();

    // The desktop grid's "Turno / Cliente" header must NOT render in compact mode.
    expect(screen.queryByText("skala.scheduleBuilder.dutyRestaurant")).not.toBeInTheDocument();

    // The week/month/custom view switch is hidden in compact mode.
    expect(screen.queryByText("skala.scheduleBuilder.view.custom")).not.toBeInTheDocument();
  });

  it("renders the desktop grid (and shows the view switch) on a non-touch desktop", async () => {
    setMatchMedia(false);
    render(<SchedulingPage />);

    // Desktop keeps the week/month/custom switch...
    expect(await screen.findByText("skala.scheduleBuilder.view.custom")).toBeInTheDocument();
    // ...and does NOT render the compact inline day view's day-stepper.
    expect(screen.queryByLabelText("Previous day")).not.toBeInTheDocument();
  });
});
