import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MapPin, Sun, Moon, Loader2, LogIn, LogOut, CheckCircle2, Ban } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LatenessBadge, NoShowBadge, fmtTime } from "@/components/attendance/StatusBadges";
import { checkin, checkout, listMyShifts } from "@/lib/skalaup/attendance";
import type { AttendanceShift, ShiftType } from "@/lib/skalaup/types";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Best-effort phone GPS for the geofenced check-in. Resolves null on any failure
// (no support, permission denied, timeout) — the server decides whether the
// missing location blocks the check-in, so we never guess here.
function getCurrentCoords(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

export default function CheckinPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";

  const [shifts, setShifts] = useState<AttendanceShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await listMyShifts();
    if (error) toast.error(error.message);
    else setShifts(data);
  }, []);

  useEffect(() => {
    void (async () => { setLoading(true); await reload(); setLoading(false); })();
  }, [reload]);

  // Group shifts by date for a clean day-by-day list.
  const groups = useMemo(() => {
    const m = new Map<string, AttendanceShift[]>();
    for (const s of shifts) {
      const arr = m.get(s.date) ?? [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shifts]);

  const dayLabel = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    return new Intl.DateTimeFormat(lng, { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }).format(d);
  };

  const onCheckin = async (s: AttendanceShift) => {
    setBusy(s.assignmentId);
    const coords = await getCurrentCoords(); // geofence: server enforces if required
    const { data, error } = await checkin(s.assignmentId, coords);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    if (data && data.latenessCategory && data.latenessCategory !== "none") {
      toast.warning(t("skala.checkin.toast.checkedInLate", { cat: t(`skala.attendance.cat.${data.latenessCategory}`) }));
    } else {
      toast.success(t("skala.checkin.toast.checkedIn"));
    }
    await reload();
  };

  const onCheckout = async (s: AttendanceShift) => {
    setBusy(s.assignmentId);
    const { error } = await checkout(s.assignmentId);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.checkin.toast.checkedOut"));
    await reload();
  };

  const today = todayStr();

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <PageHeader />
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("skala.common.loading")}</p>
        ) : groups.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.checkin.noShifts")}</Card>
        ) : (
          <div className="space-y-5">
            {groups.map(([date, daysShifts]) => (
              <div key={date} className="space-y-2.5">
                <h2 className="px-1 text-sm font-semibold capitalize text-muted-foreground">{dayLabel(date)}</h2>
                {daysShifts.map((s) => (
                  <ShiftCard
                    key={s.assignmentId}
                    shift={s}
                    lng={lng}
                    today={today}
                    busy={busy === s.assignmentId}
                    onCheckin={() => onCheckin(s)}
                    onCheckout={() => onCheckout(s)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function PageHeader() {
  const { t } = useTranslation();
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
      <div className="pointer-events-none absolute -top-20 -right-12 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex items-start gap-4 p-5 sm:p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25">
          <MapPin className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("skala.checkin.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("skala.checkin.subtitle")}</p>
        </div>
      </div>
    </div>
  );
}

const SHIFT_ICON: Record<ShiftType, typeof Sun> = { lunch: Sun, dinner: Moon };

function ShiftCard({
  shift, lng, today, busy, onCheckin, onCheckout,
}: {
  shift: AttendanceShift; lng: string; today: string; busy: boolean;
  onCheckin: () => void; onCheckout: () => void;
}) {
  const { t } = useTranslation();
  const Icon = SHIFT_ICON[shift.shiftType];
  const canCheckin = !shift.noShow && !shift.checkinAt && shift.date <= today;
  const canCheckout = !shift.noShow && !!shift.checkinAt && !shift.checkoutAt;

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <Icon className={`h-5 w-5 ${shift.shiftType === "lunch" ? "text-amber-500" : "text-indigo-500"}`} />
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-foreground">{shift.restaurantName}</p>
          <p className="text-xs text-muted-foreground">
            {t(`skala.scheduleBuilder.shift.${shift.shiftType}`)} · {shift.startTime.slice(0, 5)}–{shift.endTime.slice(0, 5)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {shift.noShow ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300"><Ban className="h-3.5 w-3.5" />{t("skala.checkin.noShow")}</span>
            ) : shift.checkinAt ? (
              <>
                <span className="text-xs text-muted-foreground">{t("skala.checkin.checkedInAt", { time: fmtTime(shift.checkinAt, lng, shift.timezone) })}</span>
                <LatenessBadge category={shift.latenessCategory} minutes={shift.latenessMinutes} />
                {shift.checkoutAt && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" />{t("skala.checkin.checkedOutAt", { time: fmtTime(shift.checkoutAt, lng, shift.timezone) })}</span>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        {canCheckin && (
          <Button size="sm" onClick={onCheckin} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {t("skala.checkin.checkIn")}
          </Button>
        )}
        {canCheckout && (
          <Button size="sm" variant="secondary" onClick={onCheckout} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {t("skala.checkin.checkOut")}
          </Button>
        )}
        {!canCheckin && !canCheckout && shift.checkoutAt && (
          <span className="inline-flex items-center gap-1 self-center text-xs font-medium text-success"><CheckCircle2 className="h-4 w-4" />{t("skala.checkin.done")}</span>
        )}
      </div>
    </Card>
  );
}
