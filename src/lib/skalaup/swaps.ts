import { api } from "@/lib/api";
import type { Result, ShiftType, SwapStatus } from "./types";

// Shift swaps (§7). Backed by /api/swaps.
export interface SwapRow {
  id: string;
  assignmentId: string;
  requesterUserId: string;
  targetUserId: string | null;
  status: SwapStatus;
  affectsWeekendBonus: boolean;
  bonusLossAcknowledged: boolean;
  createdAt: string;
  targetRespondedAt: string | null;
  coordinatorDecisionAt: string | null;
  date: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  restaurantId: string;
  restaurantName: string | null;
  requesterName: string | null;
  targetName: string | null;
}

export interface SwapCandidate { id: string; name: string; score: number }

export interface SwapLists {
  incoming?: SwapRow[];
  outgoing?: SwapRow[];
  queue?: SwapRow[];
  recent?: SwapRow[];
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}
async function voidWrap(p: Promise<unknown>): Promise<{ error: { message: string } | null }> {
  try { await p; return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}

export async function listSwaps(): Promise<Result<SwapLists>> {
  return wrap(api.get<SwapLists>("/swaps"), {});
}

export async function listEligible(assignmentId: string): Promise<Result<SwapCandidate[]>> {
  return wrap(api.get<SwapCandidate[]>(`/swaps/eligible?assignmentId=${assignmentId}`), []);
}

export async function createSwap(params: {
  assignmentId: string; targetUserId: string; bonusLossAcknowledged?: boolean;
}): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.post("/swaps", params));
}

export async function respondSwap(id: string, accept: boolean): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.post(`/swaps/${id}/respond`, { accept }));
}

export async function decideSwap(id: string, approve: boolean): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.post(`/swaps/${id}/decision`, { approve }));
}

export async function cancelSwap(id: string): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.del(`/swaps/${id}`));
}
