import { api } from "@/lib/api";
import type { Result, ShiftType } from "./types";

// Open vagas / furos a freelancer can self-accept (§ vaga flow).
export interface OpenVaga {
  cycleId: string;
  restaurantId: string;
  restaurantName: string;
  date: string;
  shiftType: ShiftType;
  openCount: number;
  openedAt: string | null;
  hasPriority: boolean;
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

export async function listOpenVagas(): Promise<Result<OpenVaga[]>> {
  return wrap(api.get<OpenVaga[]>("/vacancies/open"), []);
}

export async function claimVaga(v: {
  cycleId: string; restaurantId: string; date: string; shiftType: ShiftType;
}): Promise<{ error: { message: string } | null }> {
  try { await api.post("/vacancies/claim", v); return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}
