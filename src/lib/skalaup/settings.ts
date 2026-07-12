import { api } from "@/lib/api";
import type { Result } from "./types";

// Editable scoring configuration (R1/R7) — backed by /api/settings/score.
export interface ScoreSettings {
  points: Record<string, number>;
  starCutoffs: number[];
  monthlyTargetShifts: number;
  swapScoringCap: number;
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

export const getScoreSettings = () =>
  wrap(api.get<ScoreSettings>("/settings/score"), null as ScoreSettings | null);

export const saveScoreSettings = (body: Partial<ScoreSettings>) =>
  wrap(api.put<ScoreSettings>("/settings/score", body), null as ScoreSettings | null);
