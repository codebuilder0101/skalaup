import { api } from "@/lib/api";
import type { Result } from "./types";

// Notification center data access — backed by server/src/routes/notifications.js.
// Content (title/body) is authored server-side at each notify() call site, so the
// UI just renders it; `type` + `data` are used to build the deep-link on click.

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: AppNotification[];
  unreadCount: number;
}

async function wrap<T>(p: Promise<T>, fallback: T): Promise<Result<T>> {
  try { return { data: await p, error: null }; }
  catch (e) { return { data: fallback, error: { message: (e as Error).message } }; }
}

const EMPTY: NotificationList = { items: [], unreadCount: 0 };

// Broadcast so the header bell and the /notifications page stay in sync after a
// mutation without sharing state (both listen for this on `window`).
export const NOTIFICATIONS_CHANGED = "skala:notifications-changed";
export function emitNotificationsChanged() {
  try { window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)); } catch { /* SSR/no-DOM */ }
}

export const listNotifications = (limit = 30) =>
  wrap(api.get<NotificationList>(`/notifications?limit=${limit}`), EMPTY);

export const getUnreadCount = () =>
  wrap(api.get<{ unreadCount: number }>(`/notifications/unread-count`), { unreadCount: 0 });

export async function markNotificationRead(id: string) {
  const r = await wrap(
    api.post<{ ok: boolean; unreadCount: number }>(`/notifications/${id}/read`),
    { ok: false, unreadCount: 0 },
  );
  if (!r.error) emitNotificationsChanged();
  return r;
}

export async function markAllNotificationsRead() {
  const r = await wrap(
    api.post<{ ok: boolean; updated: number; unreadCount: number }>(`/notifications/read-all`),
    { ok: false, updated: 0, unreadCount: 0 },
  );
  if (!r.error) emitNotificationsChanged();
  return r;
}

// Localized "2 min ago" style relative time. `justNow` is passed in (i18n).
export function formatRelative(iso: string, lng: string, justNow: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 45) return justNow;
  const rtf = new Intl.RelativeTimeFormat(lng, { numeric: "auto" });
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return rtf.format(-hr, "hour");
  const day = Math.round(hr / 24);
  if (Math.abs(day) < 30) return rtf.format(-day, "day");
  const mon = Math.round(day / 30);
  if (Math.abs(mon) < 12) return rtf.format(-mon, "month");
  return rtf.format(-Math.round(mon / 12), "year");
}

// Best-effort deep link for a notification. Returns a route path, or null to just
// mark-read without navigating. `data.path` (set by some notify() call sites) wins.
export function notificationLink(n: AppNotification): string | null {
  const dataPath = typeof n.data?.path === "string" ? (n.data.path as string) : null;
  if (dataPath) return dataPath;
  switch (n.type) {
    case "feedback_received":
    case "feedback_request":
      return "/feedback";
    case "swap_request":
      return "/swaps";
    case "manager_checkin_checkout":
    case "checkin_absence":
    case "third_late":
    case "second_no_show":
      return "/attendance";
    case "coverage_deficit":
    case "schedule_conflict":
      return "/scheduling";
    case "availability_reminder":
    case "availability_cancelled":
    case "weekday_eligibility":
      return "/availability";
    case "waitlist_opening":
      return "/vagas";
    case "schedule_published":
    case "schedule_assigned":
    case "schedule_removed":
    case "shift_reminder":
    case "day_start_reminder":
    case "checkout_reminder":
      return "/my-schedule";
    default:
      return null;
  }
}
