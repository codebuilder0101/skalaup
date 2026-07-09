import { api } from "@/lib/api";
import type { Result } from "./types";

// Google Calendar export (spec §2.1, §14). The freelancer gets a personal iCal
// subscription URL; calendar clients re-poll it so the published schedule auto-syncs.

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

// Current active subscription link (or null if none generated yet).
export async function getCalendarLink(): Promise<{ url: string | null }> {
  try { return await api.get<{ url: string | null }>("/calendar/token"); }
  catch { return { url: null }; }
}

// Generate a new link, revoking any previous one.
export async function generateCalendarLink(): Promise<Result<{ url: string }>> {
  return wrap(api.post<{ url: string }>("/calendar/token", {}), { url: "" });
}

// Revoke the active link (it stops working immediately).
export async function revokeCalendarLink(): Promise<{ error: { message: string } | null }> {
  try { await api.del("/calendar/token"); return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}
