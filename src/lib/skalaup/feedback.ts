import { api } from "@/lib/api";
import type { Result, ShiftType, FeedbackStatus, FeedbackCategory } from "./types";

// Manager feedback (§10). Backed by /api/feedback.
export interface FeedbackRow {
  id: string;
  restaurantId: string;
  managerUserId: string;
  freelancerUserId: string;
  assignmentId: string | null;
  stars: number;
  justification: string;
  status: FeedbackStatus;
  category: FeedbackCategory | null;
  pointsAwarded: number | null;
  validatedAt: string | null;
  createdAt: string;
  restaurantName: string | null;
  managerName: string | null;
  freelancerName: string | null;
}

export interface FeedbackRequestRow {
  id: string;
  restaurantId: string;
  freelancerUserId: string;
  assignmentId: string | null;
  monthRef: string;
  restaurantName: string | null;
  freelancerName: string | null;
  date: string | null;
  shiftType: ShiftType | null;
}

export interface FeedbackCandidate {
  restaurantId: string;
  restaurantName: string | null;
  freelancerUserId: string;
  freelancerName: string | null;
}

export interface CoverageRow {
  userId: string; name: string; shifts: number; received: number; target: number;
}

export interface FeedbackLists {
  toGive?: FeedbackRequestRow[];
  submitted?: FeedbackRow[];
  queue?: FeedbackRow[];
  recent?: FeedbackRow[];
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}
async function voidWrap(p: Promise<unknown>): Promise<{ error: { message: string } | null }> {
  try { await p; return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}

export async function listFeedback(): Promise<Result<FeedbackLists>> {
  return wrap(api.get<FeedbackLists>("/feedback"), {});
}

export async function listFeedbackCandidates(): Promise<Result<FeedbackCandidate[]>> {
  return wrap(api.get<FeedbackCandidate[]>("/feedback/candidates"), []);
}

export async function submitFeedback(params: {
  restaurantId: string; freelancerUserId: string; stars: number;
  justification: string; assignmentId?: string | null; requestId?: string | null;
}): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.post("/feedback", params));
}

export async function validateFeedback(id: string, category: FeedbackCategory): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.post(`/feedback/${id}/validate`, { category }));
}

export async function rejectFeedback(id: string): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.post(`/feedback/${id}/reject`, {}));
}

export async function getCoverage(month?: string): Promise<Result<CoverageRow[]>> {
  const q = month ? `?month=${month}` : "";
  return wrap(api.get<CoverageRow[]>(`/feedback/coverage${q}`), []);
}
