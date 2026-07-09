import { api } from "@/lib/api";
import type { Result, ShiftType } from "./types";

// Schedule-builder data access (§3.3–§3.5) — demand config, per-date overrides and
// the aggregated board, backed by the standalone PostgreSQL API (server/).

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}
async function voidWrap(p: Promise<unknown>): Promise<{ error: { message: string } | null }> {
  try { await p; return { error: null }; }
  catch (e) { return { error: { message: (e as Error).message } }; }
}

// ---- Builder board ---------------------------------------------------------

export interface BoardAssigned {
  assignmentId: string;
  userId: string;
  name: string;
  status: "draft" | "published" | "cancelled";
  assignedVia: "coordinator" | "waiting_list" | "swap" | "manager";
  isWeekendMandatory: boolean;
  score: number;
  level: number | null;
}

export interface BoardCandidate {
  submissionId: string;
  userId: string;
  name: string;
  score: number;
  level: number | null;
  transport: string | null;
  experience: string | null;
  homeAddress: string | null;
  registeredHere?: boolean;
  flexible?: boolean; // offered "any restaurant" (no preference)
  conflicted: boolean;
}

export interface BoardShift {
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  isWeekendMandatory: boolean;
  required: number;
  requiredSource: "override" | "base" | "none";
  assignedCount: number;
  deficit: number;
  assigned: BoardAssigned[];
  candidates: BoardCandidate[];
}

export interface SchedulingBoard {
  date: string;
  restaurantId: string;
  weekday: number;
  cycleId: string | null;
  shifts: BoardShift[];
}

export async function getBoard(params: {
  date: string; restaurantId: string; cycleId?: string | null;
}): Promise<Result<SchedulingBoard | null>> {
  const q = new URLSearchParams({ date: params.date, restaurantId: params.restaurantId });
  if (params.cycleId) q.set("cycleId", params.cycleId);
  return wrap(api.get<SchedulingBoard>(`/scheduling/board?${q.toString()}`), null);
}

// All active team members (not only availability-submitters) — the builder's
// fallback pool so a slot can be staffed even with zero availability (§3.3).
export interface BoardMember {
  id: string;
  userId: string;
  name: string;
  score: number;
  level: number | null;
  transport: string | null;
  experience: string | null;
  homeAddress: string | null;
  registeredHere: boolean;
  conflicted: boolean;
}

export async function listAllMembers(params: {
  date: string; shiftType: ShiftType; restaurantId: string;
}): Promise<Result<BoardMember[]>> {
  const q = new URLSearchParams({
    date: params.date, shiftType: params.shiftType, restaurantId: params.restaurantId,
  });
  return wrap(api.get<BoardMember[]>(`/scheduling/members?${q.toString()}`), []);
}

// ---- Weekly grid board -----------------------------------------------------

export interface WeekDay {
  date: string;
  weekday: number; // 0 = Sunday
}

export interface WeekCell {
  date: string;
  weekday: number;
  required: number;
  requiredSource: "override" | "base" | "none";
  isWeekendMandatory: boolean;
  assignedCount: number;
  deficit: number;
  candidateCount: number;
  assigned: BoardAssigned[];
}

export interface ShiftSlot {
  label: string | null;
  startTime: string;
  endTime: string;
}

export interface WeekRestaurantRow {
  restaurantId: string;
  restaurantName: string;
  startTime: string; // primary (earliest) slot, for the group header
  endTime: string;
  slots: ShiftSlot[];
  cells: WeekCell[];
}

export interface WeekShiftGroup {
  shiftType: ShiftType;
  restaurants: WeekRestaurantRow[];
}

export interface WeekBoard {
  weekStart: string;
  weekEnd: string;
  cycleId: string | null;
  days: WeekDay[];
  shifts: WeekShiftGroup[];
}

// Board for a date range. Pass either weekStart (legacy 7-day week) or
// rangeStart+rangeEnd (any span — month/custom). One column per day either way.
export async function getWeekBoard(params: {
  weekStart?: string; rangeStart?: string; rangeEnd?: string;
  cycleId?: string | null; restaurantId?: string | null;
}): Promise<Result<WeekBoard | null>> {
  const q = new URLSearchParams();
  if (params.rangeStart && params.rangeEnd) {
    q.set("rangeStart", params.rangeStart);
    q.set("rangeEnd", params.rangeEnd);
  } else if (params.weekStart) {
    q.set("weekStart", params.weekStart);
  }
  if (params.cycleId) q.set("cycleId", params.cycleId);
  if (params.restaurantId) q.set("restaurantId", params.restaurantId);
  return wrap(api.get<WeekBoard>(`/scheduling/week?${q.toString()}`), null);
}

// ---- Edit scope ------------------------------------------------------------
// Which restaurants the current user may EDIT on the board. Ops edit everything
// (canEditAll = true); a restaurant_manager only their linked restaurant(s).
export interface SchedulingScope {
  canEditAll: boolean;
  restaurantIds: string[];
}

export async function getMyScope(): Promise<Result<SchedulingScope | null>> {
  return wrap(api.get<SchedulingScope>("/scheduling/my-scope"), null);
}

export interface AutofillResult {
  filledSlots: number;
  assignmentsCreated: number;
  stillShort: number;
  skippedConflicts: number;
}

export async function autofill(params: {
  cycleId: string; weekStart?: string; rangeStart?: string; rangeEnd?: string;
  restaurantId?: string | null;
}): Promise<Result<AutofillResult | null>> {
  return wrap(api.post<AutofillResult>("/scheduling/autofill", params), null);
}

// ---- Base demand -----------------------------------------------------------

export interface DemandRow {
  id: string;
  restaurantId: string;
  weekday: number;
  shiftType: ShiftType;
  requiredCount: number;
}

export async function listDemand(restaurantId?: string): Promise<Result<DemandRow[]>> {
  const q = restaurantId ? `?restaurantId=${restaurantId}` : "";
  return wrap(api.get<DemandRow[]>(`/scheduling/demand${q}`), []);
}

export async function setDemand(params: {
  restaurantId: string; weekday: number; shiftType: ShiftType; requiredCount: number;
}): Promise<Result<DemandRow | null>> {
  return wrap(api.put<DemandRow>(`/scheduling/demand`, params), null);
}

// ---- Per-date overrides ----------------------------------------------------

export interface OverrideRow {
  id: string;
  restaurantId: string;
  date: string;
  shiftType: ShiftType;
  requiredCount: number;
  reason: string | null;
}

export async function listOverrides(params: {
  restaurantId?: string; date?: string;
}): Promise<Result<OverrideRow[]>> {
  const q = new URLSearchParams();
  if (params.restaurantId) q.set("restaurantId", params.restaurantId);
  if (params.date) q.set("date", params.date);
  return wrap(api.get<OverrideRow[]>(`/scheduling/overrides?${q.toString()}`), []);
}

export async function setOverride(params: {
  restaurantId: string; date: string; shiftType: ShiftType; requiredCount: number; reason?: string | null;
}): Promise<Result<OverrideRow | null>> {
  return wrap(api.put<OverrideRow>(`/scheduling/overrides`, params), null);
}

export async function deleteOverride(id: string): Promise<{ error: { message: string } | null }> {
  return voidWrap(api.del(`/scheduling/overrides/${id}`));
}
