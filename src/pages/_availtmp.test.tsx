import { describe, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "pt-BR" } }),
}));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", role: "coordinator", name: "Coord" } }) }));
vi.mock("@/components/calendar/MonthCalendarGrid", () => ({ MonthCalendarGrid: () => <div>grid</div> }));

const cycle = { id: "c1", referenceMonth: "2026-07-01", opensAt: "2026-07-01T00:00:00", closesAt: "2026-07-31T23:59:59", status: "open", reopened: false };
vi.mock("@/lib/skalaup/availability", () => ({
  listCycles: () => Promise.resolve({ data: [cycle] }),
  listMyAvailability: () => Promise.resolve({ data: [] }),
  bulkSubmitAvailability: () => Promise.resolve({ data: [], error: null }),
  listMyClients: () => Promise.resolve({ data: [] }),
  listVacancies: () => Promise.resolve({ data: [] }),
  getCycleByMonth: () => Promise.resolve({ data: cycle }),
  createCycle: () => Promise.resolve({ data: cycle, error: null }),
  setCycleStatus: () => Promise.resolve({ error: null }),
}));

import AvailabilityPage from "./AvailabilityPage";

describe("AvailabilityPage as coordinator", () => {
  it("renders without throwing and shows the window panel", async () => {
    const { container, findByText } = render(<AvailabilityPage />);
    await findByText("skala.availability.manage.title");
    // Dump what ops actually see.
    // eslint-disable-next-line no-console
    console.log("OPS_RENDER_TEXT:", container.textContent);
  });
});
