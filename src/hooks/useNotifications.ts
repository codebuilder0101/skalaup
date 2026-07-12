import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  NOTIFICATIONS_CHANGED, type AppNotification,
} from "@/lib/skalaup/notifications";

const POLL_MS = 45_000;

// Shared notification state for the header bell and the /notifications page.
// Each consumer polls independently, but a mutation anywhere emits
// NOTIFICATIONS_CHANGED so every mounted instance re-syncs immediately.
export function useNotifications(limit = 30) {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) return;
    const { data } = await listNotifications(limit);
    setItems(data.items);
    setUnreadCount(data.unreadCount);
    setLoading(false);
  }, [user, limit]);

  useEffect(() => {
    if (!user) { setItems([]); setUnreadCount(0); setLoading(false); return; }
    let alive = true;
    const run = () => { if (alive) void reload(); };
    run();
    const interval = window.setInterval(run, POLL_MS);
    window.addEventListener("focus", run);
    window.addEventListener(NOTIFICATIONS_CHANGED, run);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", run);
      window.removeEventListener(NOTIFICATIONS_CHANGED, run);
    };
  }, [user, reload]);

  // Optimistically flip the item to read; the authoritative unread count arrives
  // via the reload that markNotificationRead triggers (NOTIFICATIONS_CHANGED).
  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)));
    await markNotificationRead(id);
  }, []);

  const markAll = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    await markAllNotificationsRead();
  }, []);

  return { items, unreadCount, loading, reload, markRead, markAll };
}
