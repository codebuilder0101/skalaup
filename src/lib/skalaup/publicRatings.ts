import { api, ApiError } from "@/lib/api";
import type { Result } from "./types";

// Per-employee public rating via QR (R2 item 5). The /public/* endpoints are
// unauthenticated (customer-facing); /freelancers/:id/ratings is the coordinator view.
// Ratings are informational only and never affect the freelancer's score.

export interface PublicRatingTarget {
  name: string;
  photoUrl: string | null;
}

export interface PublicRatingItem {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string;
}

export interface FreelancerRatings {
  count: number;
  average: number;
  recent: PublicRatingItem[];
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

// A stable per-device id for the daily anti-spam throttle (client decision).
export function deviceHash(): string {
  const KEY = "skalaup-device-id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `d-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}

export const getPublicRatingTarget = (token: string) =>
  wrap(api.get<PublicRatingTarget>(`/public/ratings/${encodeURIComponent(token)}`), null as PublicRatingTarget | null);

export async function submitPublicRating(
  token: string, body: { stars: number; comment?: string | null; deviceHash: string },
): Promise<{ error: { message: string; status?: number } | null }> {
  try {
    await api.post(`/public/ratings/${encodeURIComponent(token)}`, body);
    return { error: null };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : undefined;
    return { error: { message: (e as Error).message, status } };
  }
}

export const getFreelancerRatings = (userId: string) =>
  wrap(api.get<FreelancerRatings>(`/freelancers/${userId}/ratings`), { count: 0, average: 0, recent: [] } as FreelancerRatings);
