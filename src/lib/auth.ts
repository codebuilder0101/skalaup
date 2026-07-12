// SkalaUp roles. `administrator` manages WHO gets access (user approvals) and is a
// superset of `coordinator`; `coordinator` runs operations but cannot approve users.
export type UserRole = "administrator" | "coordinator" | "restaurant_manager" | "freelancer" | "visitor";

/** Normalize DB/cached values (and map any legacy roles) to a SkalaUp role. */
export function parseUserRole(raw: unknown): UserRole {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "administrator") return "administrator";
  if (s === "coordinator") return "coordinator";
  if (s === "restaurant_manager") return "restaurant_manager";
  if (s === "visitor") return "visitor";
  if (s === "freelancer") return "freelancer";
  // legacy fallbacks
  if (s === "system_administrator") return "administrator";
  if (s === "admin_manager") return "coordinator";
  if (s === "department_manager") return "restaurant_manager";
  if (s === "professional" || s === "staff") return "freelancer";
  return "freelancer";
}

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  mustChangePassword?: boolean;
};

export const roleHomePath: Record<UserRole, string> = {
  administrator: "/dashboard",
  coordinator: "/dashboard",
  restaurant_manager: "/today",
  freelancer: "/my-schedule",
  visitor: "/availability",
};

// Operations the coordinator runs (NO user approvals).
const COORDINATOR_PATHS = [
  "/dashboard", "/scheduling", "/restaurants", "/freelancers", "/demand", "/availability",
  "/attendance", "/swaps", "/extra-shifts", "/feedback", "/performance", "/financial",
  "/notifications", "/settings", "/profile",
];
// Administrator = everything the coordinator can do PLUS user approvals.
const ADMINISTRATOR_PATHS = [...COORDINATOR_PATHS, "/approvals"];
const MANAGER_PATHS = ["/dashboard", "/today", "/extra-shifts", "/feedback", "/notifications", "/settings", "/profile"];
const FREELANCER_PATHS = [
  "/my-schedule", "/availability", "/vagas", "/checkin", "/swaps", "/performance", "/notifications", "/settings", "/profile",
];
const VISITOR_PATHS = ["/availability", "/notifications", "/settings", "/profile"];

export const rolePermissions: Record<UserRole, Set<string>> = {
  administrator: new Set(ADMINISTRATOR_PATHS),
  coordinator: new Set(COORDINATOR_PATHS),
  restaurant_manager: new Set(MANAGER_PATHS),
  freelancer: new Set(FREELANCER_PATHS),
  visitor: new Set(VISITOR_PATHS),
};

export const canAccessPath = (role: UserRole, path: string) => rolePermissions[role].has(path);

export function canAccessPathForUser(user: AuthUser, path: string): boolean {
  return rolePermissions[user.role].has(path);
}
