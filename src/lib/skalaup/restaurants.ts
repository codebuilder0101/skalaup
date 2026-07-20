import { api } from "@/lib/api";
import type { Restaurant, Result, ShiftTemplate, NoShowDiscountMode } from "./types";

// Data access for restaurants — backed by the standalone PostgreSQL API
// (server/), which already returns camelCase shapes matching `Restaurant`.

export type RestaurantInput = {
  name: string;
  address?: string | null;
  cep?: string | null;
  cnpj?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofenceRadiusM?: number;
  timezone?: string;
  basePayPerShift?: number | null;
  bonusPayPerShift?: number | null;
  basePayLunch?: number | null;
  bonusPayLunch?: number | null;
  basePayDinner?: number | null;
  bonusPayDinner?: number | null;
  lateDiscountAmount?: number | null;
  noShowDiscountMode?: NoShowDiscountMode | null;
  noShowCustomAmount?: number | null;
  weekendBonusEnabled?: boolean | null;
  active?: boolean;
  // Full desired set of shift templates; when provided, replaces the stored set.
  shiftTemplates?: ShiftTemplate[];
  // Full desired set of linked member ids; when provided, replaces the stored links.
  memberUserIds?: string[];
};

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try {
    return { data: await p, error: null };
  } catch (e) {
    return { data: fallback, error: { message: (e as Error).message } };
  }
}

export async function listRestaurants(opts?: { activeOnly?: boolean }): Promise<Result<Restaurant[]>> {
  return wrap(api.get<Restaurant[]>(`/restaurants${opts?.activeOnly ? "?activeOnly=1" : ""}`), []);
}

export async function getRestaurant(id: string): Promise<Result<Restaurant | null>> {
  return wrap(api.get<Restaurant>(`/restaurants/${id}`), null);
}

export async function createRestaurant(input: RestaurantInput): Promise<Result<Restaurant | null>> {
  return wrap(api.post<Restaurant>("/restaurants", input), null);
}

export async function updateRestaurant(id: string, input: Partial<RestaurantInput>): Promise<Result<Restaurant | null>> {
  return wrap(api.put<Restaurant>(`/restaurants/${id}`, input), null);
}

export async function deleteRestaurant(id: string): Promise<{ error: { message: string } | null }> {
  try {
    await api.del(`/restaurants/${id}`);
    return { error: null };
  } catch (e) {
    return { error: { message: (e as Error).message } };
  }
}
