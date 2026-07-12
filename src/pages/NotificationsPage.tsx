import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Bell, BellOff, Check, MessageSquare, ArrowLeftRight, CalendarDays,
  AlertTriangle, Star, Loader2,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useNotifications";
import {
  formatRelative, notificationLink, type AppNotification,
} from "@/lib/skalaup/notifications";

function TypeIcon({ type }: { type: string }) {
  const cls = "w-4 h-4";
  if (type.startsWith("feedback")) return <MessageSquare className={`${cls} text-sky-500`} />;
  if (type.includes("swap")) return <ArrowLeftRight className={`${cls} text-violet-500`} />;
  if (type.includes("no_show") || type.includes("late") || type.includes("absence") || type.includes("deficit"))
    return <AlertTriangle className={`${cls} text-amber-500`} />;
  if (type.includes("waitlist") || type.includes("weekday")) return <Star className={`${cls} text-amber-500`} />;
  if (type.includes("schedule") || type.includes("shift") || type.includes("availability") || type.includes("reminder"))
    return <CalendarDays className={`${cls} text-primary`} />;
  return <Bell className={`${cls} text-muted-foreground`} />;
}

export default function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";
  const navigate = useNavigate();
  const { canAccess } = useAuth();
  const { items, unreadCount, loading, markRead, markAll } = useNotifications(50);

  const open = (n: AppNotification) => {
    if (!n.readAt) void markRead(n.id);
    const link = notificationLink(n);
    if (link && canAccess(link)) navigate(link);
  };

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                {t("skala.notifications.title")}
                {unreadCount > 0 && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {unreadCount} {t("skala.notifications.unread")}
                  </span>
                )}
              </h1>
              <p className="text-sm text-muted-foreground">{t("skala.notifications.subtitle")}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void markAll()}
            disabled={unreadCount === 0}
            className="flex-shrink-0"
          >
            <Check className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">{t("skala.notifications.markAllRead")}</span>
            <span className="sm:hidden">{t("skala.notifications.markAllReadShort")}</span>
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <BellOff className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">{t("skala.notifications.empty")}</p>
            <p className="text-xs text-muted-foreground">{t("skala.notifications.emptyHint")}</p>
          </Card>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {items.map((n) => {
              const link = notificationLink(n);
              const clickable = !n.readAt || (link && canAccess(link));
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => open(n)}
                  disabled={!clickable}
                  className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors ${
                    clickable ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"
                  } ${n.readAt ? "" : "bg-primary/[0.04]"}`}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <TypeIcon type={n.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {!n.readAt && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" aria-hidden />}
                      <p className={`truncate text-sm ${n.readAt ? "font-medium text-foreground" : "font-semibold text-foreground"}`}>
                        {n.title}
                      </p>
                    </div>
                    {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
                  </div>
                  <time className="flex-shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {formatRelative(n.createdAt, lng, t("skala.notifications.justNow"))}
                  </time>
                </button>
              );
            })}
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
