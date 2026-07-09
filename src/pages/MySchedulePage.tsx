import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CalendarDays, Sun, Moon, Loader2, Star, MapPin,
  Copy, ExternalLink, RefreshCw, Trash2,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { listAssignments } from "@/lib/skalaup/assignments";
import { listRestaurants } from "@/lib/skalaup/restaurants";
import { calendarApi } from "@/lib/skalaup";
import type { Restaurant, ScheduleAssignment, ShiftType } from "@/lib/skalaup/types";

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtTime = (t: string) => (t ? t.slice(0, 5) : "");

export default function MySchedulePage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lng = i18n.language || "pt-BR";

  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

  // Google Calendar export (spec §2.1, §14)
  const [calUrl, setCalUrl] = useState<string | null>(null);
  const [calBusy, setCalBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    const [{ data: rs }, { data: as, error }] = await Promise.all([
      listRestaurants(),
      listAssignments({ userId: user.id, status: "published" }),
    ]);
    if (error) toast.error(error.message);
    setRestaurants(rs);
    setAssignments(as);
  }, [user]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await reload();
      if (user) {
        const link = await calendarApi.getCalendarLink();
        setCalUrl(link.url);
      }
      setLoading(false);
    })();
  }, [reload, user]);

  const restaurantById = useMemo(() => {
    const m = new Map<string, Restaurant>();
    restaurants.forEach((r) => m.set(r.id, r));
    return m;
  }, [restaurants]);

  // Split into upcoming (today onwards) and past, each sorted appropriately.
  const today = todayStr();
  const { upcoming, past } = useMemo(() => {
    const up: ScheduleAssignment[] = [];
    const pa: ScheduleAssignment[] = [];
    for (const a of assignments) (a.date.slice(0, 10) >= today ? up : pa).push(a);
    up.sort((x, y) => x.date.localeCompare(y.date) || x.startTime.localeCompare(y.startTime));
    pa.sort((x, y) => y.date.localeCompare(x.date) || y.startTime.localeCompare(x.startTime));
    return { upcoming: up, past: pa };
  }, [assignments, today]);

  // The API returns `date` as a full ISO timestamp — normalise to YYYY-MM-DD.
  const dateOnly = (d: string) => d.slice(0, 10);
  const weekdayOf = (date: string) =>
    new Intl.DateTimeFormat(lng, { weekday: "long", timeZone: "UTC" })
      .format(new Date(`${dateOnly(date)}T00:00:00Z`));

  const ShiftRow = ({ a }: { a: ScheduleAssignment }) => {
    const r = restaurantById.get(a.restaurantId);
    const isLunch = a.shiftType === ("lunch" as ShiftType);
    const weekday = weekdayOf(a.date);
    return (
      <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
        <div className="flex flex-col items-center justify-center w-14 shrink-0">
          <span className="text-lg font-bold leading-none text-foreground">{Number(dateOnly(a.date).slice(8, 10))}</span>
          <span className="text-[11px] uppercase text-muted-foreground">{weekday.slice(0, 3)}</span>
        </div>
        <div className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${isLunch ? "bg-amber-100 text-amber-600" : "bg-indigo-100 text-indigo-600"}`}>
          {isLunch ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground truncate">
            {r?.name ?? t("skala.mySchedule.unknownRestaurant")}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {t(`skala.shift.${a.shiftType}`)} · {fmtTime(a.startTime)}–{fmtTime(a.endTime)}
            {r?.address ? <><span>·</span><MapPin className="w-3 h-3" />{r.address}</> : null}
          </p>
        </div>
        {a.isWeekendMandatory && (
          <Badge variant="secondary" className="shrink-0 gap-1 text-amber-600">
            <Star className="w-3 h-3 fill-current" />{t("skala.mySchedule.bonusShift")}
          </Badge>
        )}
      </div>
    );
  };

  // ---- Calendar export handlers ----
  const generateCalendar = async () => {
    setCalBusy(true);
    try {
      const { data, error } = await calendarApi.generateCalendarLink();
      if (error) throw new Error(error.message);
      setCalUrl(data.url);
      toast.success(t("skala.profile.calendar.generated"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCalBusy(false);
    }
  };
  const revokeCalendar = async () => {
    if (!window.confirm(t("skala.profile.calendar.confirmRevoke"))) return;
    setCalBusy(true);
    try {
      const { error } = await calendarApi.revokeCalendarLink();
      if (error) throw new Error(error.message);
      setCalUrl(null);
      toast.success(t("skala.profile.calendar.revoked"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCalBusy(false);
    }
  };
  const copyCalendar = async () => {
    if (!calUrl) return;
    try {
      await navigator.clipboard.writeText(calUrl);
      toast.success(t("skala.profile.calendar.copied"));
    } catch {
      toast.error(t("skala.profile.calendar.copyFailed"));
    }
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-primary" /> {t("skala.mySchedule.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("skala.mySchedule.subtitle")}</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("skala.common.loading")}
          </div>
        ) : (
          <>
            {/* Upcoming shifts */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground mb-1">{t("skala.mySchedule.upcoming")}</h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  {t("skala.mySchedule.emptyUpcoming")}
                </p>
              ) : (
                <div>{upcoming.map((a) => <ShiftRow key={a.id} a={a} />)}</div>
              )}
            </Card>

            {/* Google Calendar export */}
            <Card className="p-5 space-y-4">
              <div>
                <h2 className="font-semibold text-foreground flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  {t("skala.profile.calendar.title")}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">{t("skala.profile.calendar.description")}</p>
              </div>
              {calUrl ? (
                <>
                  <div className="flex gap-2">
                    <Input value={calUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="outline" size="icon" onClick={() => void copyCalendar()}
                      title={t("skala.profile.calendar.copy")}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("skala.profile.calendar.instructions")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="default">
                      <a
                        href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(calUrl.replace(/^https?:\/\//, "webcal://"))}`}
                        target="_blank" rel="noopener noreferrer"
                      >
                        <ExternalLink className="w-4 h-4 mr-1.5" />
                        {t("skala.profile.calendar.addToGoogle")}
                      </a>
                    </Button>
                    <Button variant="outline" onClick={() => void generateCalendar()} disabled={calBusy}>
                      <RefreshCw className="w-4 h-4 mr-1.5" />{t("skala.profile.calendar.regenerate")}
                    </Button>
                    <Button variant="ghost" className="text-destructive hover:text-destructive"
                      onClick={() => void revokeCalendar()} disabled={calBusy}>
                      <Trash2 className="w-4 h-4 mr-1.5" />{t("skala.profile.calendar.revoke")}
                    </Button>
                  </div>
                </>
              ) : (
                <Button onClick={() => void generateCalendar()} disabled={calBusy}>
                  <CalendarDays className="w-4 h-4 mr-1.5" />{t("skala.profile.calendar.generate")}
                </Button>
              )}
            </Card>

            {/* Past shifts */}
            {past.length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold text-foreground mb-1">{t("skala.mySchedule.past")}</h2>
                <div className="opacity-70">{past.map((a) => <ShiftRow key={a.id} a={a} />)}</div>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
