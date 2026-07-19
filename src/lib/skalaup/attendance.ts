import { api } from "@/lib/api";
import type {
  AttendanceShift, AttendanceMutationResult, PendingAbsence, AbsenceType,
  CoordinatorDecision, Result,
} from "./types";

// Check-in / check-out, lateness and no-shows (§4, §4.1, §5, §6).
// Backed by the standalone PostgreSQL API (server/routes/attendance.js).

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}
async function wrapMaybe<T>(p: Promise<T>): Promise<Result<T | null>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: null, error: { message: (e as Error).message } }; }
}

// Coordinator / manager board: shifts for a date (+ optional restaurant/user filter).
export async function listAttendance(params: {
  date?: string; restaurantId?: string; userId?: string;
}): Promise<Result<AttendanceShift[]>> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, String(v)); });
  return wrap(api.get<AttendanceShift[]>(`/attendance?${q.toString()}`), []);
}

// The signed-in freelancer's own shifts (defaults to today..+7 on the server).
export async function listMyShifts(params: { from?: string; to?: string } = {}): Promise<Result<AttendanceShift[]>> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, String(v)); });
  const qs = q.toString();
  return wrap(api.get<AttendanceShift[]>(`/attendance/mine${qs ? `?${qs}` : ""}`), []);
}

// Optional GPS coordinates attached to a self check-in for the geofence check.
export interface CheckinCoords { latitude: number; longitude: number; }

export async function checkin(
  assignmentId: string,
  coords?: CheckinCoords | null,
): Promise<Result<AttendanceMutationResult | null>> {
  const body = coords
    ? { assignmentId, latitude: coords.latitude, longitude: coords.longitude }
    : { assignmentId };
  return wrapMaybe(api.post<AttendanceMutationResult>("/attendance/checkin", body));
}

export async function checkout(assignmentId: string): Promise<Result<AttendanceMutationResult | null>> {
  return wrapMaybe(api.post<AttendanceMutationResult>("/attendance/checkout", { assignmentId }));
}

// Coordinator override of check-in/out times (§4 OBS). ISO strings, or null to clear.
export async function editAttendance(
  assignmentId: string,
  body: { checkinAt: string | null; checkoutAt: string | null; reason?: string | null },
): Promise<Result<AttendanceMutationResult | null>> {
  return wrapMaybe(api.put<AttendanceMutationResult>(`/attendance/${assignmentId}/edit`, body));
}

// Record a furo (§5). type: 'no_show_unjustified' | 'justified'.
export async function markNoShow(body: {
  assignmentId: string; type: AbsenceType; justificationText?: string | null; certificateUrl?: string | null;
}): Promise<Result<AttendanceMutationResult | null>> {
  return wrapMaybe(api.post<AttendanceMutationResult>("/attendance/no-show", body));
}

export async function undoNoShow(assignmentId: string): Promise<Result<AttendanceMutationResult | null>> {
  return wrapMaybe(api.del<AttendanceMutationResult>(`/attendance/${assignmentId}/no-show`));
}

// Furos awaiting a coordinator decision (2nd+ unjustified, §5).
export async function listPendingAbsences(): Promise<Result<PendingAbsence[]>> {
  return wrap(api.get<PendingAbsence[]>("/attendance/absences/pending"), []);
}

export async function decideAbsence(
  absenceId: string, decision: Exclude<CoordinatorDecision, "none">,
): Promise<Result<{ ok: boolean; decision: string; cancelledCount: number } | null>> {
  return wrapMaybe(
    api.post<{ ok: boolean; decision: string; cancelledCount: number }>(
      `/attendance/absences/${absenceId}/decision`, { decision },
    ),
  );
}
