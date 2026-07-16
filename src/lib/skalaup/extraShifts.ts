import { api } from "@/lib/api";
import type { Result, ShiftType } from "./types";

// Extra shifts ("turno extra", R9). Backed by /api/extra-shifts.
export type ExtraShiftStatus =
  | "pending" | "assigned" | "opened" | "awaiting_accept" | "filled" | "rejected" | "cancelled";

export interface ExtraShiftRequest {
  id: string;
  restaurantId: string;
  restaurantName: string | null;
  date: string;
  shiftType: ShiftType;
  headcount: number;
  reason: string | null;
  status: ExtraShiftStatus;
  requestedBy: string | null;
  requestedByName: string | null;
  createdAt: string;
  decidedAt: string | null;
  // Ops-only (never sent to the requesting manager): who was invited + the 24h deadline.
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  acceptDeadline?: string | null;
}

export interface ExtraShiftCandidate { id: string; name: string; score: number }

// A pending extra-shift invite shown to the invited freelancer (accept/decline).
export interface ExtraShiftInvite {
  id: string;
  restaurantId: string;
  restaurantName: string | null;
  date: string;
  shiftType: ShiftType;
  reason: string | null;
  acceptDeadline: string | null;
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}
async function voidWrap(p: Promise<unknown>): Promise<{ error: { message: string } | null }> {
  try { await p; return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}

export const listExtraShifts = () =>
  wrap(api.get<ExtraShiftRequest[]>("/extra-shifts"), []);

export const listExtraEligible = (id: string) =>
  wrap(api.get<ExtraShiftCandidate[]>(`/extra-shifts/${id}/eligible`), []);

export const requestExtraShift = (params: {
  restaurantId?: string; date: string; shiftType: ShiftType; headcount?: number; reason?: string;
}) => voidWrap(api.post("/extra-shifts", params));

export const assignExtraShift = (id: string, userId: string) =>
  voidWrap(api.post(`/extra-shifts/${id}/assign`, { userId }));

export const openExtraShift = (id: string) =>
  voidWrap(api.post(`/extra-shifts/${id}/open`));

export const rejectExtraShift = (id: string) =>
  voidWrap(api.post(`/extra-shifts/${id}/reject`));

export const cancelExtraShift = (id: string) =>
  voidWrap(api.del(`/extra-shifts/${id}`));

// Coordinator withdraws a pending invite (back to 'pending' so someone else can be scheduled).
export const cancelExtraInvite = (id: string) =>
  voidWrap(api.post(`/extra-shifts/${id}/cancel-invite`));

// Freelancer-facing: their pending invites + accept/decline.
export const listMyExtraInvites = () =>
  wrap(api.get<ExtraShiftInvite[]>("/extra-shifts/invites"), []);

export const acceptExtraInvite = (id: string) =>
  voidWrap(api.post(`/extra-shifts/${id}/accept`));

export const declineExtraInvite = (id: string) =>
  voidWrap(api.post(`/extra-shifts/${id}/decline`));
