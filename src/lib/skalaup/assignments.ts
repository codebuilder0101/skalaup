import { api } from "@/lib/api";
import type { AssignedVia, Result, ScheduleAssignment, ShiftType } from "./types";

// Backed by the standalone PostgreSQL API (server/). Endpoints under /assignments
// are added as the Scheduling screen is built.

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}
async function voidWrap(p: Promise<unknown>): Promise<{ error: { message: string } | null }> {
  try { await p; return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}

export async function listAssignments(params: {
  date?: string; restaurantId?: string; userId?: string; cycleId?: string;
  status?: "draft" | "published" | "cancelled";
}): Promise<Result<ScheduleAssignment[]>> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, String(v)); });
  return wrap(api.get<ScheduleAssignment[]>(`/assignments?${q.toString()}`), []);
}

export async function createAssignment(params: {
  cycleId?: string | null; restaurantId: string; userId: string; date: string;
  shiftType: ShiftType; startTime: string; endTime: string;
  assignedVia?: AssignedVia; createdBy?: string | null;
}): Promise<Result<ScheduleAssignment | null>> {
  return wrap(api.post<ScheduleAssignment>("/assignments", params), null);
}

export async function cancelAssignment(id: string): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.put(`/assignments/${id}/cancel`, {}));
}

export async function publishCycle(cycleId: string): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.post(`/assignments/publish`, { cycleId }));
}
