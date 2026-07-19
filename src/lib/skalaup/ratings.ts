import { api } from "@/lib/api";
import type { Result } from "./types";

// Customer-rating validation queue (client 2026-07-19). Coordinators list pending QR
// ratings, then approve (picking a rating type → awards its points) or reject them.

export type RatingStatus = "pending" | "approved" | "rejected";

export interface PendingRating {
  id: string;
  stars: number;
  comment: string | null;
  status: RatingStatus;
  ratingTypeId: string | null;
  createdAt: string;
  ratedOn: string;
  reviewedAt: string | null;
  freelancerId: string;
  freelancerName: string;
  reviewedByName: string | null;
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

export function listRatings(status: RatingStatus = "pending"): Promise<Result<PendingRating[]>> {
  return wrap(api.get<PendingRating[]>(`/ratings?status=${status}`), []);
}

export async function approveRating(id: string, ratingTypeId: string): Promise<{ error: { message: string } | null }> {
  try { await api.post(`/ratings/${id}/approve`, { ratingTypeId }); return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}

export async function rejectRating(id: string): Promise<{ error: { message: string } | null }> {
  try { await api.post(`/ratings/${id}/reject`); return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}
