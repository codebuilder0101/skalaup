// SkalaUp HTTP client — talks to the standalone PostgreSQL-backed API server
// (server/). Replaces the Supabase client entirely.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "")
  || "http://localhost:4000/api";

const TOKEN_KEY = "skalaup-token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  // Retry idempotent GETs on a transient network error or gateway hiccup so a brief
  // blip (mobile signal, a server restart) doesn't blank the screen and look like the
  // data vanished (client 2026-08-18). Non-GET requests never auto-retry.
  const retriable = method === "GET";
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method, headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      if (retriable && attempt < 2) { await sleep(400 * (attempt + 1)); continue; }
      throw new ApiError("Sem conexão. Verifique sua internet e tente novamente.", 0);
    }
    if (retriable && attempt < 2 && (res.status === 502 || res.status === 503 || res.status === 504)) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    break;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // An authenticated request that comes back 401 means the session expired/invalid.
    // Clear it and send the user to log in — never leave them on a silently-empty
    // screen thinking their schedule disappeared.
    if (res.status === 401 && token) {
      setToken(null);
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
        window.location.assign("/auth");
      }
    }
    // Prefer the human-readable `message` (e.g. "Turno lotado…"); fall back to the
    // machine `error` code (e.g. "auth.pending", which AuthPage maps to i18n).
    const msg = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  base: API_BASE,
};
