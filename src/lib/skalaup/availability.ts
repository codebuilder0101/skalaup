import { api } from "@/lib/api";
import type {
  AvailabilityCycle, AvailabilitySubmission, Result, ShiftType,
} from "./types";

// Backed by the standalone PostgreSQL API (server/). Endpoints under /availability
// are added as the Availability / Scheduling screens are built.

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}
async function voidWrap(p: Promise<unknown>): Promise<{ error: { message: string } | null }> {
  try { await p; return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}

export async function getCycleByMonth(referenceMonth: string): Promise<Result<AvailabilityCycle | null>> {
  return wrap(api.get<AvailabilityCycle | null>(`/availability/cycles?month=${encodeURIComponent(referenceMonth)}`), null);
}

export async function listCycles(): Promise<Result<AvailabilityCycle[]>> {
  return wrap(api.get<AvailabilityCycle[]>("/availability/cycles"), []);
}

export async function createCycle(params: { referenceMonth: string; opensAt: string; closesAt: string }): Promise<Result<AvailabilityCycle | null>> {
  return wrap(api.post<AvailabilityCycle>("/availability/cycles", params), null);
}

export async function setCycleStatus(id: string, status: "open" | "closed" | "published"): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.put(`/availability/cycles/${id}/status`, { status }));
}

// restaurantId omitted / null = "any restaurant / no preference" (§3.2).
export async function submitAvailability(params: {
  cycleId: string; userId: string; date: string; shiftType: ShiftType;
  restaurantId?: string | null; preferenceRank?: number | null;
}): Promise<Result<AvailabilitySubmission | null>> {
  return wrap(api.post<AvailabilitySubmission>("/availability/submissions", params), null);
}

// Restaurants the current freelancer may offer availability for (their clients).
export interface MyClient { id: string; name: string }
export async function listMyClients(): Promise<Result<MyClient[]>> {
  return wrap(api.get<MyClient[]>("/availability/my-clients"), []);
}

// Vacancies per (date, shift, restaurant) for a month, from the base schedule (§3.5).
export interface Vacancy { restaurantId: string; date: string; shiftType: ShiftType; required: number }
export async function listVacancies(month: string): Promise<Result<Vacancy[]>> {
  return wrap(api.get<Vacancy[]>(`/availability/vacancies?month=${encodeURIComponent(month)}`), []);
}

export async function cancelAvailability(id: string): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.del(`/availability/submissions/${id}`));
}

export async function listMyAvailability(cycleId: string, userId: string): Promise<Result<AvailabilitySubmission[]>> {
  return wrap(api.get<AvailabilitySubmission[]>(`/availability/submissions?cycleId=${cycleId}&userId=${userId}`), []);
}

export async function listSlotAvailability(params: {
  cycleId: string; date: string; shiftType: ShiftType; restaurantId?: string;
}): Promise<Result<AvailabilitySubmission[]>> {
  const q = new URLSearchParams({ cycleId: params.cycleId, date: params.date, shiftType: params.shiftType });
  if (params.restaurantId) q.set("restaurantId", params.restaurantId);
  return wrap(api.get<AvailabilitySubmission[]>(`/availability/submissions/slot?${q.toString()}`), []);
}

// ---- Granular reopen (§3.1) -----------------------------------------------
export interface ReopenException {
  id: string;
  cycleId: string;
  restaurantId: string | null;
  userId: string | null;
  createdAt: string;
  restaurantName: string | null;
  userName: string | null;
}

export async function listReopens(cycleId: string): Promise<Result<ReopenException[]>> {
  return wrap(api.get<ReopenException[]>(`/availability/cycles/${cycleId}/reopens`), []);
}

export async function addReopen(
  cycleId: string, target: { restaurantId?: string; userId?: string },
): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.post(`/availability/cycles/${cycleId}/reopens`, target));
}

export async function removeReopen(id: string): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.del(`/availability/reopens/${id}`));
}
