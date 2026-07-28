import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Users, BellRing, Loader2, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getSubmissionStatus, remindAvailability, type SubmissionStatus } from "@/lib/skalaup/availability";
import type { AvailabilityCycle } from "@/lib/skalaup/types";

// Coordinator view (client 2026-07-27): who has / hasn't submitted availability for
// the cycle, so they can chase the missing ones — instead of checking restaurant by
// restaurant. Shows push-reachability + whether the reminder was read, and a nudge
// ("Cobrar") button that re-sends the availability reminder to the missing people.
export function AvailabilityStatusPanel({ cycle }: { cycle: AvailabilityCycle | null }) {
  const { t } = useTranslation();
  const [data, setData] = useState<SubmissionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [reminding, setReminding] = useState(false);

  const load = useCallback(async () => {
    if (!cycle) { setData(null); return; }
    setLoading(true);
    const { data: res } = await getSubmissionStatus(cycle.id);
    setData(res);
    setLoading(false);
  }, [cycle]);
  useEffect(() => { void load(); }, [load]);

  const missing = data?.members.filter((m) => !m.submitted) ?? [];

  const remind = async (userIds: string[]) => {
    if (!cycle || !userIds.length) return;
    setReminding(true);
    const { data: res, error } = await remindAvailability(cycle.id, userIds);
    setReminding(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.availability.status.reminded", { count: res?.sent ?? 0 }));
    void load();
  };

  if (!cycle) return null;

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Users className="h-4.5 w-4.5" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-foreground">{t("skala.availability.status.title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("skala.availability.status.subtitle")}</p>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">{t("skala.availability.status.submitted")}: {data.submittedCount}</Badge>
            <Badge variant={data.missingCount > 0 ? "destructive" : "secondary"}>{t("skala.availability.status.missing")}: {data.missingCount}</Badge>
            <Badge variant="outline">{t("skala.availability.status.total")}: {data.total}</Badge>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("skala.common.loading")}
        </div>
      ) : !data ? null : missing.length === 0 ? (
        <p className="flex items-center gap-1.5 py-2 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" /> {t("skala.availability.status.noMissing")}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("skala.availability.status.missingList")} ({missing.length})
            </p>
            <Button size="sm" className="h-8 rounded-xl" disabled={reminding}
              onClick={() => void remind(missing.map((m) => m.userId))}>
              {reminding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BellRing className="mr-1.5 h-3.5 w-3.5" />}
              {t("skala.availability.status.remindAll", { count: missing.length })}
            </Button>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border">
            {missing.map((m) => (
              <div key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{m.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className={`text-[9px] ${m.pushEnabled ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-muted-foreground/30 text-muted-foreground"}`}>
                      {m.pushEnabled ? t("skala.availability.status.pushOn") : t("skala.availability.status.pushOff")}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] text-muted-foreground">
                      {!m.reminderSentAt
                        ? t("skala.availability.status.notReminded")
                        : m.reminderReadAt
                          ? t("skala.availability.status.reminderRead")
                          : t("skala.availability.status.reminderUnread")}
                    </Badge>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-xl" disabled={reminding}
                  onClick={() => void remind([m.userId])}>
                  <BellRing className="mr-1.5 h-3.5 w-3.5" />{t("skala.availability.status.remind")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
