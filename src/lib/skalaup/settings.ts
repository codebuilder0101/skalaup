import { api } from "@/lib/api";
import type { Result } from "./types";

// Coordinator-defined manual scoring criterion (R15). Applied by hand; never
// auto-calculated. Points may be negative (penalty).
export interface CustomCriterion {
  id: string;
  label: string;
  points: number;
  active: boolean;
}

// Editable scoring configuration (R1/R7) — backed by /api/settings/score.
export interface ScoreSettings {
  points: Record<string, number>;
  starCutoffs: number[];
  monthlyTargetShifts: number;
  swapScoringCap: number;
  manualScoreMonthlyCap: number;
  customCriteria: CustomCriterion[];
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

export const getScoreSettings = () =>
  wrap(api.get<ScoreSettings>("/settings/score"), null as ScoreSettings | null);

export const saveScoreSettings = (body: Partial<ScoreSettings>) =>
  wrap(api.put<ScoreSettings>("/settings/score", body), null as ScoreSettings | null);
