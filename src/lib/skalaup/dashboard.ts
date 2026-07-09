import { api } from "@/lib/api";
import type { Result, ShiftType } from "./types";

// Role-aware dashboard data — backed by GET /api/dashboard (server/).

export interface TodayShift {
  id: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  status: "draft" | "published" | "cancelled";
  freelancerName: string;
  restaurantName: string;
  checkinAt?: string | null;
  checkoutAt?: string | null;
}

export interface TodayCounts {
  total: number;
  published: number;
  freelancers: number;
}

export interface ShiftsTrendPoint {
  date: string; // YYYY-MM-DD
  total: number;
  published: number;
}

export interface ScoreBucket {
  label: string; // score band, e.g. "10-24"
  count: number;
}

export interface CoordinatorDashboard {
  role: "coordinator" | "administrator";
  restaurants: { total: number; active: number };
  freelancers: { total: number; active: number; pending: number };
  subscribers: number;
  today: TodayCounts;
  swaps: number;
  feedback: number;
  approvals: number;
  finance: { shifts: number; estimated: number; weekendShifts: number };
  todaySchedule: TodayShift[];
  shiftsTrend: ShiftsTrendPoint[];
  scoreBuckets: ScoreBucket[];
}

export interface ManagerDashboard {
  role: "restaurant_manager";
  restaurants: { id: string; name: string; address: string | null }[];
  subscribers: number;
  today: TodayCounts;
  todaySchedule: TodayShift[];
  feedback: number;
}

export type DashboardData = CoordinatorDashboard | ManagerDashboard;

export function isManagerDashboard(d: DashboardData): d is ManagerDashboard {
  return d.role === "restaurant_manager";
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

export async function getDashboard(): Promise<Result<DashboardData | null>> {
  return wrap(api.get<DashboardData>("/dashboard"), null);
}
