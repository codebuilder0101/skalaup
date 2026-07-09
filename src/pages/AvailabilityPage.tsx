import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarDays, Sun, Moon, Loader2, Info, Star, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import {
  listCycles, listMyAvailability, submitAvailability, cancelAvailability,
  listMyClients, listVacancies, type MyClient, type Vacancy,
} from "@/lib/skalaup/availability";
import { AvailabilityWindowPanel } from "@/components/AvailabilityWindowPanel";
import type { AvailabilityCycle, AvailabilitySubmission, ShiftType } from "@/lib/skalaup/types";

const SHIFTS: ShiftType[] = ["lunch", "dinner"];
const ANY = "ANY"; // sentinel for "any restaurant / no preference"
const dateKey = (d: string) => d.slice(0, 10);
const slotKey = (date: string, shift: ShiftType, restaurantId: string | null) =>
  `${dateKey(date)}|${shift}|${restaurantId ?? ANY}`;
const vacKey = (date: string, shift: ShiftType, restaurantId: string) =>
  `${dateKey(date)}|${shift}|${restaurantId}`;

// All YYYY-MM-DD days of the cycle's reference month (UTC-safe).
function daysOfMonth(referenceMonth: string): string[] {
  const ym = referenceMonth.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}

export default function AvailabilityPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lng = i18n.language || "pt-BR";

  const [cycle, setCycle] = useState<AvailabilityCycle | null>(null);
  const [clients, setClients] = useState<MyClient[]>([]);
  const [vacancies, setVacancies] = useState<Map<string, number>>(new Map());
  const [subs, setSubs] = useState<AvailabilitySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null); // slotKey being toggled

  const isOps = user?.role === "coordinator" || user?.role === "administrator";

  // Initial load: the freelancer's clients + the active (or latest) cycle.
  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [{ data: cs }, { data: cycles }] = await Promise.all([listMyClients(), listCycles()]);
      setClients(cs);
      setCycle(cycles.find((c) => c.status === "open") ?? cycles[0] ?? null);
      setLoading(false);
    })();
  }, []);

  const reloadSubs = useCallback(async () => {
    if (!cycle || !user) { setSubs([]); return; }
    const { data } = await listMyAvailability(cycle.id, user.id);
    setSubs(data);
  }, [cycle, user]);

  useEffect(() => { void reloadSubs(); }, [reloadSubs]);

  // Vacancies for the cycle's month (from the base schedule + overrides).
  useEffect(() => {
    void (async () => {
      if (!cycle) { setVacancies(new Map()); return; }
      const { data } = await listVacancies(`${cycle.referenceMonth.slice(0, 7)}-01`);
      const m = new Map<string, number>();
      (data as Vacancy[]).forEach((v) => m.set(vacKey(v.date, v.shiftType, v.restaurantId), v.required));
      setVacancies(m);
    })();
  }, [cycle]);

  const editable = cycle?.status === "open";

  const subMap = useMemo(() => {
    const m = new Map<string, AvailabilitySubmission>();
    subs.filter((s) => s.status === "submitted")
      .forEach((s) => m.set(slotKey(s.date, s.shiftType, s.restaurantId), s));
    return m;
  }, [subs]);

  const selectedCount = subMap.size;
  const days = useMemo(() => (cycle ? daysOfMonth(cycle.referenceMonth) : []), [cycle]);
  const today = new Date().toISOString().slice(0, 10);

  const monthLabel = useMemo(() => {
    if (!cycle) return "";
    const d = new Date(`${cycle.referenceMonth.slice(0, 10)}T00:00:00Z`);
    return new Intl.DateTimeFormat(lng, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  }, [cycle, lng]);

  const dayLabel = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    return {
      wd: new Intl.DateTimeFormat(lng, { weekday: "short", timeZone: "UTC" }).format(d),
      n: Number(date.slice(8, 10)),
      weekend: [0, 6].includes(d.getUTCDay()),
    };
  };

  const toggle = async (date: string, shift: ShiftType, restaurantId: string | null) => {
    if (!cycle || !user || !editable) return;
    const key = slotKey(date, shift, restaurantId);
    const existing = subMap.get(key);
    setPending(key);
    const { error } = existing
      ? await cancelAvailability(existing.id)
      : await submitAvailability({ cycleId: cycle.id, userId: user.id, date, shiftType: shift, restaurantId });
    setPending(null);
    if (error) { toast.error(error.message); return; }
    if (!existing && restaurantId === null) toast.success(t("skala.availability.flexibleToast"));
    await reloadSubs();
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
          <div className="pointer-events-none absolute -top-20 -right-12 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative p-5 sm:p-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25">
                <CalendarDays className="h-6 w-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("skala.availability.title")}</h1>
                  {cycle && (
                    <Badge
                      variant="outline"
                      className={`gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${
                        editable ? "border-success/30 bg-success/10 text-success" : "border-muted-foreground/30 bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${editable ? "bg-success" : "bg-muted-foreground"}`} />
                      {t(`skala.scheduleBuilder.cycleStatus.${cycle.status}`)}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("skala.availability.subtitle")}
                  {cycle && <span className="ml-1 font-medium text-foreground capitalize">{monthLabel}</span>}
                </p>
              </div>
            </div>
            {cycle && (
              <div className="shrink-0 text-right">
                <p className="text-2xl font-bold text-primary">{selectedCount}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("skala.availability.selectedCount")}</p>
              </div>
            )}
          </div>
        </div>

        {/* Coordinator/administrator: open, extend or close the availability window (§3.1). */}
        {isOps && <AvailabilityWindowPanel cycle={cycle} onChange={setCycle} />}

        {!editable && cycle && !isOps && (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            {t("skala.availability.closedNotice")}
          </div>
        )}

        {/* Flexibility hint */}
        {editable && clients.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-2.5 text-sm text-foreground">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{t("skala.availability.anyHint")}</span>
          </div>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("skala.common.loading")}</p>
        ) : !cycle ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.availability.noCycle")}</Card>
        ) : clients.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.availability.noRestaurants")}</Card>
        ) : (
          <div className="space-y-2.5">
            {days.map((date) => {
              const dl = dayLabel(date);
              const isToday = date === today;
              return (
                <Card key={date} className={`p-3 sm:p-4 ${isToday ? "ring-1 ring-primary/40" : ""}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    {/* Day label */}
                    <div className={`flex sm:w-20 shrink-0 items-center gap-2 sm:flex-col sm:items-start ${dl.weekend ? "text-primary" : "text-foreground"}`}>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{dl.wd}</span>
                      <span className="text-lg font-bold leading-none">{dl.n}</span>
                    </div>
                    {/* Shifts */}
                    <div className="flex-1 space-y-2.5">
                      {SHIFTS.map((shift) => {
                        const anyOn = subMap.has(slotKey(date, shift, null));
                        const specificOn = clients.some((r) => subMap.has(slotKey(date, shift, r.id)));
                        const anyKey = slotKey(date, shift, null);
                        return (
                          <div key={shift} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                            <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              {shift === "lunch"
                                ? <Sun className="h-3.5 w-3.5 text-amber-500" />
                                : <Moon className="h-3.5 w-3.5 text-indigo-500" />}
                              {t(`skala.scheduleBuilder.shift.${shift}`)}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {/* Any restaurant / no preference */}
                              <button
                                type="button"
                                disabled={!editable || pending === anyKey || (specificOn && !anyOn)}
                                onClick={() => void toggle(date, shift, null)}
                                title={t("skala.availability.anyHint")}
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors
                                  ${anyOn
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"}
                                  ${(!editable || pending === anyKey || (specificOn && !anyOn)) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                              >
                                {pending === anyKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
                                {t("skala.availability.anyRestaurant")}
                              </button>
                              {/* Specific restaurants (his clients) with vacancy counts */}
                              {clients.map((r) => {
                                const key = slotKey(date, shift, r.id);
                                const on = subMap.has(key);
                                const busy = pending === key;
                                const vac = vacancies.get(vacKey(date, shift, r.id)) ?? 0;
                                const disabled = !editable || busy || (anyOn && !on);
                                return (
                                  <button
                                    key={r.id}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => void toggle(date, shift, r.id)}
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors
                                      ${on
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"}
                                      ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                                  >
                                    {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                                    <span>{r.name}</span>
                                    {vac > 0 && (
                                      <span className={`rounded-full px-1.5 text-[10px] leading-4 ${on ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>
                                        {t("skala.availability.vacancies", { count: vac })}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
