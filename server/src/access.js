// Authorization helpers shared by the scheduling & assignment routes.
import { pool } from "./db.js";

// Coordinators and administrators run operations across ALL restaurants.
export function isOps(role) {
  return role === "coordinator" || role === "administrator";
}

// The restaurant ids a manager is linked to (public.manager_assignments).
// Returns [] for non-managers / unlinked managers.
export async function managerRestaurantIds(userId) {
  const { rows } = await pool.query(
    `select restaurant_id from public.manager_assignments where manager_user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.restaurant_id);
}

// True when the authenticated user may EDIT the given restaurant's schedule:
// ops can edit anything; a manager only their own restaurant(s).
export async function canEditRestaurant(user, restaurantId) {
  if (isOps(user.role)) return true;
  if (user.role !== "restaurant_manager") return false;
  const ids = await managerRestaurantIds(user.sub);
  return ids.includes(restaurantId);
}
