import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ClipboardCheck, Sun, Moon, Loader2, RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LatenessBadge, NoShowBadge, fmtTime } from "@/components/attendance/StatusBadges";
import { listAttendance } from "@/lib/skalaup/attendance";
import type { AttendanceShift, ShiftType } from "@/lib/skalaup/types";

const todayStr = () => new Date().toISOString().slice(0, 10);
const SHIFT_ICON: Record<ShiftType, typeof Sun> = { lunch: Sun, dinner: Moon };

type Status = "noShow" | "left" | "present" | "awaiting";
function statusOf(s: AttendanceShift): Status {
  if (s.noShow) return "noShow";
  if (s.checkinAt && s.checkoutAt) return "left";
  if (s.checkinAt) return "present";
  return "awaiting";
}
const STATUS_CLASS: Record<Status, string> = {
  awaiting: "border-muted-foreground/30 bg-muted text-muted-foreground",
  present: "border-success/30 bg-success/10 text-success",
  left: "border-primary/30 bg-primary/10 text-primary",
  noShow: "border-red-400/60 bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
};

export default function TodayPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";
  const [shifts, setShifts] = useState<AttendanceShift[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await listAttendance({ date: todayStr() });
    if (error) toast.error(error.message);
    else setShifts(data);
  }, []);

  useEffect(() => {
    void (async () => { setLoading(true); await reload(); setLoading(false); })();
  }, [reload]);

  // Group by restaurant, then sort shifts (lunch first) and members by name.
  const groups = useMemo(() => {
    const m = new Map<string, AttendanceShift[]>();
    for (const s of shifts) {
      const arr = m.get(s.restaurantName) ?? [];
      arr.push(s);
      m.set(s.restaurantName, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.shiftType === b.shiftType ? a.freelancerName.localeCompare(b.freelancerName) : a.shiftType === "lunch" ? -1 : 1));
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shifts]);

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
          <div className="pointer-events-none absolute -top-20 -right-12 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25">
                <ClipboardCheck className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("skala.today.title")}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t("skala.today.subtitle")}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void reload()} className="shrink-0 self-start">
              <RefreshCw className="h-4 w-4" />{t("skala.today.refresh")}
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("skala.common.loading")}</p>
        ) : groups.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.today.noShifts")}</Card>
        ) : (
          <div className="space-y-5">
            {groups.map(([restaurant, rows]) => (
              <Card key={restaurant} className="overflow-hidden">
                <div className="border-b border-border/60 bg-muted/40 px-4 py-2.5">
                  <h2 className="font-semibold text-foreground">{restaurant}</h2>
                </div>
                <ul className="divide-y divide-border/60">
                  {rows.map((s) => {
                    const Icon = SHIFT_ICON[s.shiftType];
                    const st = statusOf(s);
                    return (
                      <li key={s.assignmentId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Icon className={`h-4 w-4 shrink-0 ${s.shiftType === "lunch" ? "text-amber-500" : "text-indigo-500"}`} />
                          <div>
                            <p className="text-sm font-medium text-foreground">{s.freelancerName}</p>
                            <p className="text-xs text-muted-foreground">
                              {t(`skala.scheduleBuilder.shift.${s.shiftType}`)} · {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {st === "noShow" ? (
                            <NoShowBadge />
                          ) : (
                            <>
                              {s.checkinAt && <LatenessBadge category={s.latenessCategory} minutes={s.latenessMinutes} />}
                              <span className="text-xs text-muted-foreground">
                                {fmtTime(s.checkinAt, lng)} → {fmtTime(s.checkoutAt, lng)}
                              </span>
                              <Badge variant="outline" className={`rounded-full font-medium ${STATUS_CLASS[st]}`}>
                                {t(`skala.today.${st}`)}
                              </Badge>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
