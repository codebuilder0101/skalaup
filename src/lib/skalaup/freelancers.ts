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

export type ProfileInput = {
  memberType?: MemberType;
  photoUrl?: string | null;
  cpf?: string | null;
  pixKey?: string | null;
  whatsapp?: string | null;
  homeAddress?: string | null;
  homeCep?: string | null;
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
  whatsapp?: string | null;
  homeAddress?: string | null;
  homeCep?: string | null;
  restaurantIds?: string[];
};

export async function updateFreelancer(userId: string, input: FreelancerUpdateInput): Promise<Result<FreelancerWithProfile | null>> {
  return wrap(api.put<FreelancerWithProfile>(`/freelancers/${userId}`, input), null);
}

export async function deleteFreelancer(userId: string): Promise<{ error: { message: string } | null }> {
  try {
    await api.del(`/freelancers/${userId}`);
    return { error: null };
  } catch (e) {
    return { error: { message: (e as Error).message } };
  }
}
