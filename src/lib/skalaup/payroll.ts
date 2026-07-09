import { api } from "@/lib/api";
import type { Result } from "./types";

// Financial module (§8, §12) — monthly payroll report & close.
// Backed by server/routes/payroll.js.

export type PayrollStatus = "open" | "closed";

// Per-type money buckets shared by freelancer totals and each restaurant breakdown.
export interface PayrollBucket {
  shiftPay: number;
  weekendBonus: number;
  lateDiscount: number;    // ≤ 0
  noShowDiscount: number;  // ≤ 0
  manualAdjustment: number;
  shiftCount: number;
  net: number;
}

export interface PayrollRestaurantLine extends PayrollBucket {
  restaurantId: string | null;
  restaurantName: string;
}

export interface PayrollFreelancer {
  userId: string;
  name: string;
  totals: PayrollBucket;
  byRestaurant: PayrollRestaurantLine[];
}

export interface PayrollPeriod {
  referenceMonth: string; // YYYY-MM-01
  status: PayrollStatus;
  closedAt: string | null;
  closedByName: string | null;
}

export interface PayrollReport {
  period: PayrollPeriod;
  totals: PayrollBucket;
  freelancerCount: number;
  freelancers: PayrollFreelancer[];
}

export type PayrollEntryType =
  | "shift_pay" | "weekend_bonus" | "late_discount" | "no_show_discount" | "manual_adjustment";

export interface PayrollEntry {
  id: string;
  userId: string;
  userName: string;
  restaurantId: string | null;
  restaurantName: string | null;
  type: PayrollEntryType;
  amount: number;
  shiftCount: number | null;
  notes: string | null;
  createdAt: string;
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}
async function wrapMaybe<T>(p: Promise<T>): Promise<Result<T | null>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: null, error: { message: (e as Error).message } }; }
}

const EMPTY_REPORT = (month: string): PayrollReport => ({
  period: { referenceMonth: `${month}-01`, status: "open", closedAt: null, closedByName: null },
  totals: {
    shiftPay: 0, weekendBonus: 0, lateDiscount: 0, noShowDiscount: 0,
    manualAdjustment: 0, shiftCount: 0, net: 0,
  },
  freelancerCount: 0,
  freelancers: [],
});

// month = "YYYY-MM"
export async function getPayrollSummary(month: string): Promise<Result<PayrollReport>> {
  return wrap(api.get<PayrollReport>(`/payroll/summary?month=${encodeURIComponent(month)}`), EMPTY_REPORT(month));
}

export async function recomputePayroll(month: string): Promise<Result<PayrollReport | null>> {
  return wrapMaybe(api.post<PayrollReport>("/payroll/recompute", { month }));
}

export async function closePayroll(month: string): Promise<Result<PayrollReport | null>> {
  return wrapMaybe(api.post<PayrollReport>("/payroll/close", { month }));
}

export async function reopenPayroll(month: string): Promise<Result<PayrollReport | null>> {
  return wrapMaybe(api.post<PayrollReport>("/payroll/reopen", { month }));
}

export async function listPayrollEntries(month: string, userId?: string): Promise<Result<PayrollEntry[]>> {
  const q = new URLSearchParams({ month });
  if (userId) q.set("userId", userId);
  return wrap(api.get<PayrollEntry[]>(`/payroll/entries?${q.toString()}`), []);
}

export async function addPayrollAdjustment(body: {
  month: string; userId: string; restaurantId?: string | null; amount: number; notes?: string | null;
}): Promise<Result<PayrollReport | null>> {
  return wrapMaybe(api.post<PayrollReport>("/payroll/entries", body));
}

export async function deletePayrollAdjustment(id: string): Promise<Result<PayrollReport | null>> {
  return wrapMaybe(api.del<PayrollReport>(`/payroll/entries/${id}`));
}
