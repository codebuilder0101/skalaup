import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarDays, Sun, Moon, Loader2, Info, Star, Sparkles, CheckCheck, Eraser, Send } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MonthCalendarGrid, type DayMark } from "@/components/calendar/MonthCalendarGrid";
import { useAuth } from "@/contexts/AuthContext";
import {
  listCycles, listMyAvailability, bulkSubmitAvailability, listMyClients, listVacancies,
  type MyClient, type Vacancy, type DesiredSlot,
} from "@/lib/skalaup/availability";
import { AvailabilityWindowPanel } from "@/components/AvailabilityWindowPanel";
import type { AvailabilityCycle, ShiftType } from "@/lib/skalaup/types";

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

// Aggregate the freelancer's draft picks into per-day markers for the grid.
export function markDraft(draft: Map<string, DesiredSlot>): Map<string, DayMark> {
  const m = new Map<string, DayMark>();
  for (const s of draft.values()) {
    const k = dateKey(s.date);
    const cur = m.get(k) ?? { lunch: false, dinner: false, count: 0 };
    if (s.shiftType === "lunch") cur.lunch = true;
    else cur.dinner = true;
    cur.count = (cur.count ?? 0) + 1;
    m.set(k, cur);
  }
  return m;
}

export default function AvailabilityPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lng = i18n.language || "pt-BR";

  const [cycle, setCycle] = useState<AvailabilityCycle | null>(null);
  const [clients, setClients] = useState<MyClient[]>([]);
  const [vacancies, setVacancies] = useState<Map<string, number>>(new Map());
  // Local, unsaved draft of the freelancer's picks. Nothing is persisted until
  // they press "Enviar minha disponibilidade" (§ batch submit).
  const [draft, setDraft] = useState<Map<string, DesiredSlot>>(new Map());
  const [serverSet, setServerSet] = useState<Set<string>>(new Set()); // what's persisted
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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

  // (Re)load the persisted availability into both the draft and the server snapshot.
  const reloadSubs = useCallback(async () => {
    if (!cycle || !user) { setDraft(new Map()); setServerSet(new Set()); return; }
    const { data } = await listMyAvailability(cycle.id, user.id);
    const m = new Map<string, DesiredSlot>();
    data.filter((s) => s.status === "submitted").forEach((s) => {
      m.set(slotKey(s.date, s.shiftType, s.restaurantId),
        { date: dateKey(s.date), shiftType: s.shiftType, restaurantId: s.restaurantId });
    });
    setDraft(new Map(m));
    setServerSet(new Set(m.keys()));
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
  const days = useMemo(() => (cycle ? daysOfMonth(cycle.referenceMonth) : []), [cycle]);
  const today = new Date().toISOString().slice(0, 10);
  const selectedCount = draft.size;
  const marks = useMemo(() => markDraft(draft), [draft]);

  // Default the selected day to today (if it falls in the cycle month) else day 1.
  useEffect(() => {
    if (!cycle) { setSelectedDay(null); return; }
    setSelectedDay((prev) => {
      if (prev && prev.slice(0, 7) === cycle.referenceMonth.slice(0, 7)) return prev;
      return today.slice(0, 7) === cycle.referenceMonth.slice(0, 7) ? today : days[0] ?? null;
    });
  }, [cycle, days, today]);

  // Unsaved changes: draft differs from the persisted snapshot.
  const dirty = useMemo(() => {
    if (draft.size !== serverSet.size) return true;
    for (const k of draft.keys()) if (!serverSet.has(k)) return true;
    return false;
  }, [draft, serverSet]);

  const monthLabel = useMemo(() => {
    if (!cycle) return "";
    const d = new Date(`${cycle.referenceMonth.slice(0, 10)}T00:00:00Z`);
    return new Intl.DateTimeFormat(lng, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  }, [cycle, lng]);

  const selectedLabel = useMemo(() => {
    if (!selectedDay) return "";
    return new Intl.DateTimeFormat(lng, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
      .format(new Date(`${selectedDay}T00:00:00Z`));
  }, [selectedDay, lng]);

  // Toggle a slot in the LOCAL draft only. Enforces the any/specific exclusion:
  // picking "any restaurant" clears specific picks for that slot and vice-versa.
  const toggle = (date: string, shift: ShiftType, restaurantId: string | null) => {
    if (!editable) return;
    setDraft((prev) => {
      const next = new Map(prev);
      const k = slotKey(date, shift, restaurantId);
      if (next.has(k)) { next.delete(k); return next; }
      if (restaurantId === null) {
        for (const r of clients) next.delete(slotKey(date, shift, r.id));
      } else {
        next.delete(slotKey(date, shift, null));
      }
      next.set(k, { date: dateKey(date), shiftType: shift, restaurantId });
      return next;
    });
  };

  // Mark every day + turno as "any restaurant" (one tap; they then unmark what
  // they can't do). Maximises flexibility, which is what earns the bonus.
  const selectAll = () => {
    if (!editable) return;
    const next = new Map<string, DesiredSlot>();
    for (const date of days) for (const shift of SHIFTS) {
      next.set(slotKey(date, shift, null), { date: dateKey(date), shiftType: shift, restaurantId: null });
    }
    setDraft(next);
  };
  const clearAll = () => { if (editable) setDraft(new Map()); };

  const submit = async () => {
    if (!cycle || !user || !editable || submitting) return;
    setSubmitting(true);
    const { data, error } = await bulkSubmitAvailability(cycle.id, user.id, [...draft.values()]);
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    const m = new Map<string, DesiredSlot>();
    data.filter((s) => s.status === "submitted").forEach((s) =>
      m.set(slotKey(s.date, s.shiftType, s.restaurantId),
        { date: dateKey(s.date), shiftType: s.shiftType, restaurantId: s.restaurantId }));
    setDraft(new Map(m));
    setServerSet(new Set(m.keys()));
    toast.success(t("skala.availability.submitted", { count: m.size }));
  };

  // The per-shift picker for a single day (rendered in the day-detail panel).
  const renderShiftPicker = (date: string) => (
    <div className="space-y-3">
      {SHIFTS.map((shift) => {
        const anyOn = draft.has(slotKey(date, shift, null));
        const specificOn = clients.some((r) => draft.has(slotKey(date, shift, r.id)));
        return (
          <div key={shift} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {shift === "lunch"
                ? <Sun className="h-3.5 w-3.5 text-amber-500" />
                : <Moon className="h-3.5 w-3.5 text-indigo-500" />}
              {t(`skala.scheduleBuilder.shift.${shift}`)}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {/* Any restaurant / no preference */}
              <button
                type="button"
                disabled={!editable || (specificOn && !anyOn)}
                onClick={() => toggle(date, shift, null)}
                title={t("skala.availability.anyHint")}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors
                  ${anyOn
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"}
                  ${(!editable || (specificOn && !anyOn)) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <Star className="h-3 w-3" />
                {t("skala.availability.anyRestaurant")}
              </button>
              {/* Specific restaurants (his clients) with vacancy counts */}
              {clients.map((r) => {
                const key = slotKey(date, shift, r.id);
                const on = draft.has(key);
                const vac = vacancies.get(vacKey(date, shift, r.id)) ?? 0;
                const disabled = !editable || (anyOn && !on);
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(date, shift, r.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors
                      ${on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"}
                      ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
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
  );

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
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
            {cycle && !isOps && (
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

        {/* Flexibility + review hints — freelancers only (R16: ops never submit here). */}
        {editable && clients.length > 0 && !isOps && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-2.5 text-sm text-foreground">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{t("skala.availability.anyHint")}</span>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("skala.availability.reviewHint")}</span>
            </div>
          </div>
        )}

        {/* Submission flow — freelancers/visitors only. Ops (R16) manage the window above. */}
        {!isOps && (loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("skala.common.loading")}</p>
        ) : !cycle ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.availability.noCycle")}</Card>
        ) : clients.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.availability.noRestaurants")}</Card>
        ) : (
          <div className="space-y-4">
            {/* Month calendar of the cycle's reference month */}
            <MonthCalendarGrid
              month={`${cycle.referenceMonth.slice(0, 7)}-01`}
              marks={marks}
              selectedDate={selectedDay}
              today={today}
              lng={lng}
              onSelectDay={setSelectedDay}
            />

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />{t("skala.scheduleBuilder.shift.lunch")}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-500" />{t("skala.scheduleBuilder.shift.dinner")}</span>
            </div>

            {/* Selected-day picker */}
            {selectedDay && (
              <Card className="p-4 sm:p-5">
                <h2 className="font-semibold text-foreground mb-3 capitalize">{selectedLabel}</h2>
                {renderShiftPicker(selectedDay)}
              </Card>
            )}
          </div>
        ))}

        {/* Sticky action bar: select all / clear / submit (§ batch submit). Freelancers only. */}
        {editable && clients.length > 0 && !isOps && (
          <div className="sticky bottom-4 z-10">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/95 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={selectAll} disabled={submitting}>
                <CheckCheck className="mr-1.5 h-4 w-4" />{t("skala.availability.selectAll")}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl" onClick={clearAll} disabled={submitting || draft.size === 0}>
                <Eraser className="mr-1.5 h-4 w-4" />{t("skala.availability.clearAll")}
              </Button>
              <div className="flex-1" />
              {dirty && <span className="text-xs font-medium text-amber-600 dark:text-amber-500">{t("skala.availability.unsaved")}</span>}
              <Button size="sm" className="rounded-xl shadow-sm shadow-primary/20" onClick={() => void submit()} disabled={submitting || !dirty}>
                {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                {submitting ? t("skala.availability.submitting") : t("skala.availability.submit")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
