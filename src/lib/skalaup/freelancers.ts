import { api } from "@/lib/api";
import type { FreelancerProfile, MemberType, Result, Transport, User } from "./types";

// Data access for freelancers — backed by the standalone PostgreSQL API.
// The API returns the user fields plus a nested `profile` (or null).

export type MemberClient = { id: string; name: string };
export type FreelancerWithProfile = User & {
  profile: FreelancerProfile | null;
  clients: MemberClient[];
};

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try {
    return { data: await p, error: null };
  } catch (e) {
    return { data: fallback, error: { message: (e as Error).message } };
  }
}

export async function listFreelancers(): Promise<Result<FreelancerWithProfile[]>> {
  return wrap(api.get<FreelancerWithProfile[]>("/freelancers"), []);
}

export async function getFreelancer(userId: string): Promise<Result<FreelancerWithProfile | null>> {
  return wrap(api.get<FreelancerWithProfile>(`/freelancers/${userId}`), null);
}

// Self-registration allow-list (client 2026-07-19, extended 2026-07-20). An administrator
// pre-registers an email together with the ROLE that person will hold; they then sign
// up with that email and the server applies the role. Nobody picks their own role.
export type AuthorizedRole = "coordinator" | "restaurant_manager" | "freelancer" | "visitor";

export type AuthorizedEmail = {
  id: string;
  email: string;
  role: AuthorizedRole;
  restaurantIds: string[];
  createdAt: string;
  claimedAt: string | null;
  userId: string | null;
  userName: string | null;
  userStatus: string | null;
};

export async function listAuthorizedEmails(): Promise<Result<AuthorizedEmail[]>> {
  return wrap(api.get<AuthorizedEmail[]>("/freelancers/authorized-emails"), []);
}

// The roles the logged-in user is allowed to hand out (administrator may grant
// coordinator; a coordinator may not). Drives the picker options.
export async function listGrantableRoles(): Promise<Result<AuthorizedRole[]>> {
  try {
    const res = await api.get<{ roles: AuthorizedRole[] }>("/freelancers/authorized-emails/roles");
    return { data: res.roles ?? [], error: null };
  } catch (e) {
    return { data: [], error: { message: (e as Error).message } };
  }
}

export async function addAuthorizedEmail(
  email: string, role: AuthorizedRole, restaurantIds: string[] = [],
): Promise<Result<AuthorizedEmail | null>> {
  try {
    return {
      data: await api.post<AuthorizedEmail>("/freelancers/authorized-emails", { email, role, restaurantIds }),
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
}

export async function removeAuthorizedEmail(id: string): Promise<{ error: { message: string } | null }> {
  try {
    await api.del(`/freelancers/authorized-emails/${id}`);
    return { error: null };
  } catch (e) {
    return { error: { message: (e as Error).message } };
  }
}

export type ProfileInput = {
  memberType?: MemberType;
  photoUrl?: string | null;
  cpf?: string | null;
  pixKey?: string | null;
  bankName?: string | null;
  birthDate?: string | null;
  whatsapp?: string | null;
  homeAddress?: string | null;
  homeCep?: string | null;
  state?: string | null;
  homeLatitude?: number | null;
  homeLongitude?: number | null;
  transport?: Transport | null;
  experience?: string | null;
  hireDate?: string | null;
  notes?: string | null;
};

export async function upsertFreelancerProfile(userId: string, input: ProfileInput): Promise<{ error: { message: string } | null }> {
  try {
    await api.put(`/freelancers/${userId}/profile`, input);
    return { error: null };
  } catch (e) {
    return { error: { message: (e as Error).message } };
  }
}

// ---- CRUD (coordinator) ----------------------------------------------------

export type FreelancerCreateInput = {
  name: string;
  email: string;
  role?: "freelancer" | "visitor";
  phone?: string | null;
  cpf?: string | null;
  pixKey?: string | null;
  bankName?: string | null;
  birthDate?: string | null;
  whatsapp?: string | null;
  homeAddress?: string | null;
  homeCep?: string | null;
  restaurantIds?: string[];
};

export type FreelancerCreated = FreelancerWithProfile & { tempPassword?: string };

export async function createFreelancer(input: FreelancerCreateInput): Promise<Result<FreelancerCreated | null>> {
  return wrap(api.post<FreelancerCreated>("/freelancers", input), null);
}

export type FreelancerUpdateInput = {
  name?: string;
  phone?: string | null;
  cpf?: string | null;
  pixKey?: string | null;
  bankName?: string | null;
  birthDate?: string | null;
  whatsapp?: string | null;
  homeAddress?: string | null;
  homeCep?: string | null;
  restaurantIds?: string[];
};

export async function updateFreelancer(userId: string, input: FreelancerUpdateInput): Promise<Result<FreelancerWithProfile | null>> {
  return wrap(api.put<FreelancerWithProfile>(`/freelancers/${userId}`, input), null);
}

export async function setFreelancerStatus(
  userId: string, status: "active" | "inactive",
): Promise<Result<FreelancerWithProfile | null>> {
  return wrap(api.put<FreelancerWithProfile>(`/freelancers/${userId}/status`, { status }), null);
}

export async function deleteFreelancer(userId: string): Promise<{ error: { message: string } | null }> {
  try {
    await api.del(`/freelancers/${userId}`);
    return { error: null };
  } catch (e) {
    return { error: { message: (e as Error).message } };
  }
}
