import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { api, setToken, getToken } from "@/lib/api";
import { AuthUser, canAccessPathForUser, parseUserRole } from "@/lib/auth";

type LoginResult = { success: boolean; error?: string };
type RegisterResult = { success: boolean; error?: string; pending?: boolean };

type RegisterInput = {
  name: string;
  email: string;
  password: string;
  // No `role`: the server takes it from the invitation registered for this email
  // (client 2026-07-20) and ignores anything the client sends.
  // Optional freelancer registration "ficha" fields.
  phone?: string;
  cpf?: string;
  pixKey?: string;
  whatsapp?: string;
  homeAddress?: string;
  homeCep?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (input: RegisterInput) => Promise<RegisterResult>;
  logout: () => void;
  refresh: () => Promise<void>;
  canAccess: (path: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type RawUser = { id: string; name: string; email: string; role: string; mustChangePassword?: boolean };

function normalizeUser(raw: RawUser): AuthUser {
  return {
    id: raw.id, name: raw.name, email: raw.email,
    role: parseUserRole(raw.role), mustChangePassword: !!raw.mustChangePassword,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate from the stored JWT on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!getToken()) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await api.get<RawUser>("/auth/me");
        if (!cancelled) setUser(normalizeUser(me));
      } catch {
        setToken(null);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    try {
      const res = await api.post<{ token: string; user: RawUser }>(
        "/auth/login",
        { email, password },
      );
      setToken(res.token);
      setUser(normalizeUser(res.user));
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message || "auth.errors.invalidCredentials" };
    }
  };

  const register = async (input: RegisterInput): Promise<RegisterResult> => {
    try {
      // Freelancers with a pre-authorized email are created active and get a token
      // back → log them straight in. Other roles are `pending` (no token) and must
      // be approved before logging in.
      const res = await api.post<{ pending?: boolean; token?: string; user?: RawUser }>(
        "/auth/register", input,
      );
      if (res.token && res.user) {
        setToken(res.token);
        setUser(normalizeUser(res.user));
        return { success: true, pending: false };
      }
      return { success: true, pending: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  const refresh = async () => {
    try {
      const me = await api.get<RawUser>("/auth/me");
      setUser(normalizeUser(me));
    } catch { /* ignore */ }
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      refresh,
      canAccess: (path: string) => (user ? canAccessPathForUser(user, path) : false),
    }),
    [user, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
