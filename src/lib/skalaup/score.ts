import { api } from "@/lib/api";
import type { Result, ScoreEvent, ScoreEventType } from "./types";

// Backed by the standalone PostgreSQL API (server/). Endpoints under /score
// are added as the Performance screen is built.

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

export async function addScoreEvent(params: {
  userId: string; eventType: ScoreEventType; occurredOn: string;
  points?: number; referenceType?: ScoreEvent["referenceType"]; referenceId?: string | null;
  createdBy?: string | null; notes?: string | null;
  // R15: apply a coordinator-defined custom criterion (server uses its point value).
  criterionId?: string;
}): Promise<Result<ScoreEvent | null>> {
  return wrap(api.post<ScoreEvent>("/score/events", params), null);
}

export async function voidScoreEvent(id: string): Promise<{ error: { message: string } | null }> {
  try { await api.put(`/score/events/${id}/void`, {}); return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}

export async function listScoreEvents(userId: string): Promise<Result<ScoreEvent[]>> {
  return wrap(api.get<ScoreEvent[]>(`/score/events?userId=${userId}`), []);
}

export async function getAccumulatedScore(userId: string): Promise<number> {
  try {
    const r = await api.get<{ total: number }>(`/score/accumulated?userId=${userId}`);
    return r.total ?? 0;
  } catch {
    return 0;
  }
}
