import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CalendarCheck, ChevronLeft, ChevronRight, Plus, X, Star, Send,
  Sun, Moon, AlertTriangle, CalendarDays, MapPin, Briefcase, Car,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { CycleControl } from "@/components/CycleControl";
import { listRestaurants } from "@/lib/skalaup/restaurants";
import { formatDateBR } from "@/lib/br-format";
import { getCycleByMonth, createCycle, listSlotAvailability } from "@/lib/skalaup/availability";
import { createAssignment, cancelAssignment, publishCycle } from "@/lib/skalaup/assignments";
import {
  getWeekBoard, getMyScope, listAllMembers,
  type WeekBoard, type WeekCell, type ShiftSlot,
} from "@/lib/skalaup/scheduling";
import type { AvailabilityCycle, Restaurant, ShiftType } from "@/lib/skalaup/types";

// ---- date helpers (UTC-safe; date-only strings) ----------------------------
const isoUTC = (d: Date) => d.toISOString().slice(0, 10);
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoUTC(d);
}
function mondayOf(date: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return addDays(date, -((dow + 6) % 7));
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const monthRefOf = (date: string) => `${date.slice(0, 7)}-01`;
const cycleWindow = (monthRef: string) => ({
  opensAt: `${monthRef.slice(0, 7)}-20T00:00:00`,
  closesAt: `${monthRef.slice(0, 7)}-25T23:59:59`,
});
function endOfMonth(date: string) {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}
function addMonths(date: string, n: number) {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  return isoUTC(new Date(Date.UTC(y, m - 1 + n, 1)));
}
type ViewMode = "week" | "month" | "custom";

type SlotCandidate = {
  id: string; userId: string; name: string; score: number; level: number | null;
  transport: string | null; experience: string | null; homeAddress: string | null;
  registeredHere?: boolean;
  flexible?: boolean;
};

function Stars({ level }: { level: number | null }) {
  if (!level) return null;
  return (
    <span className="inline-flex">
      {Array.from({ length: level }).map((_, i) => (
        <Star key={i} className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
      ))}
    </span>
  );
}

// ---- One grid cell (restaurant × shift × day) with assign popover ----------
function ScheduleCell({
  cell, restaurantId, shiftType, startTime, endTime, slots, cycleId, isToday, busyUserIds, canEdit, onChanged,
}: {
  cell: WeekCell;
  restaurantId: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  slots: ShiftSlot[];
  cycleId: string | null;
  isToday: boolean;
  busyUserIds: Set<string>;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<SlotCandidate[]>([]);
  const [loadingCand, setLoadingCand] = useState(false);
  const [working, setWorking] = useState(false);
  const [slotIdx, setSlotIdx] = useState(0);
  // Fallback pool: all active members, shown on demand when availability is thin (§3.3).
  const [showAll, setShowAll] = useState(false);
  const [allMembers, setAllMembers] = useState<SlotCandidate[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  // The slots available for this meal period; fall back to the primary times.
  const slotList: ShiftSlot[] = slots.length ? slots : [{ label: null, startTime, endTime }];
  const slot = slotList[Math.min(slotIdx, slotList.length - 1)] ?? slotList[0];
  const slotText = (s: ShiftSlot) =>
    `${s.label ? `${s.label} · ` : ""}${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`;

  const emptyNoDemand = cell.required === 0 && cell.assignedCount === 0;
  // No capacity cap (§3.5): the cell shows only how many are scheduled; a deficit
  // vs the restaurant's demand is signalled in red.
  const hasDeficit = cell.deficit > 0;

  const loadCandidates = useCallback(async () => {
    if (!cycleId) { setCandidates([]); return; }
    setLoadingCand(true);
    // Availability-based (§3.3/§3.4): only freelancers who submitted availability for
    // this restaurant+slot, ranked by score — this ranked list IS the waiting list.
    const { data } = await listSlotAvailability({ cycleId, date: cell.date, shiftType, restaurantId });
    setCandidates((data as unknown as SlotCandidate[]).filter(
      (c) => !cell.assigned.some((a) => a.userId === c.userId),
    ));
    setLoadingCand(false);
  }, [cycleId, cell.date, cell.assigned, shiftType, restaurantId]);

  const loadAllMembers = useCallback(async () => {
    setLoadingAll(true);
    const { data } = await listAllMembers({ date: cell.date, shiftType, restaurantId });
    setAllMembers((data as unknown as SlotCandidate[]).filter(
      (c) => !cell.assigned.some((a) => a.userId === c.userId),
    ));
    setLoadingAll(false);
  }, [cell.date, cell.assigned, shiftType, restaurantId]);

  useEffect(() => {
    if (open) { setSlotIdx(0); setShowAll(false); void loadCandidates(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleShowAll = async () => {
    const next = !showAll;
    setShowAll(next);
    if (next) await loadAllMembers();
  };

  const renderRow = (c: SlotCandidate) => {
    const conflicted = busyUserIds.has(c.userId);
    return (
      <div key={c.id} className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm flex items-center gap-1.5 truncate">
            {c.name} <Stars level={c.level} />
            <span className="text-[10px] text-muted-foreground">{Number(c.score).toFixed(1)}</span>
            {c.registeredHere && (
              <Badge variant="outline" className="border-primary/40 text-primary text-[9px]">
                {t("skala.scheduleBuilder.registeredHere")}
              </Badge>
            )}
            {c.flexible && (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[9px]">
                {t("skala.availability.flexible")}
              </Badge>
            )}
            {conflicted && (
              <Badge variant="outline" className="text-destructive border-destructive/40 text-[9px]">
                {t("skala.scheduleBuilder.conflict")}
              </Badge>
            )}
          </span>
          {/* Ficha resumida (§3.3): transporte, localização e experiência */}
          {(c.transport || c.homeAddress || c.experience) && (
            <div className="mt-0.5 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
              {c.transport && (
                <span className="flex items-center gap-1">
                  <Car className="w-2.5 h-2.5 shrink-0" />{t(`skala.transport.${c.transport}`)}
                </span>
              )}
              {c.homeAddress && (
                <span className="flex items-center gap-1 truncate" title={c.homeAddress}>
                  <MapPin className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{c.homeAddress}</span>
                </span>
              )}
              {c.experience && (
                <span className="flex items-center gap-1 truncate" title={c.experience}>
                  <Briefcase className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{c.experience}</span>
                </span>
              )}
            </div>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7" disabled={working || conflicted}
          title={conflicted ? t("skala.scheduleBuilder.conflictHint") : undefined}
          onClick={() => void assign(c.userId)}>
          <Plus className="w-3 h-3 mr-0.5" />{t("skala.scheduleBuilder.assign")}
        </Button>
      </div>
    );
  };

  const assign = async (userId: string) => {
    if (!canEdit) return;
    setWorking(true);
    const res = await createAssignment({
      cycleId, restaurantId, userId, date: cell.date, shiftType,
      startTime: slot.startTime, endTime: slot.endTime,
    });
    setWorking(false);
    if (res.error) { toast.error(res.error.message); return; }
    if ((res.data as { eligibilityWarning?: boolean } | null)?.eligibilityWarning) {
      toast.warning(t("skala.scheduleBuilder.eligibilityWarning"));
    }
    await onChanged();
    void loadCandidates();
    if (showAll) void loadAllMembers();
  };

  const remove = async (assignmentId: string) => {
    setWorking(true);
    const { error } = await cancelAssignment(assignmentId);
    setWorking(false);
    if (error) { toast.error(error.message); return; }
    await onChanged();
    void loadCandidates();
    if (showAll) void loadAllMembers();
  };

  return (
    <Popover open={open} onOpenChange={canEdit ? setOpen : undefined}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!canEdit}
          className={`text-left w-full h-full min-h-[64px] p-1.5 border-l border-t border-border/60 transition-colors
            ${isToday ? "bg-primary/5" : ""} ${canEdit ? "hover:bg-accent/40 cursor-pointer" : "cursor-default"}`}
        >
          <div className="flex items-center justify-between mb-1">
            {emptyNoDemand ? (
              <span className="text-[10px] text-muted-foreground/50">—</span>
            ) : (
              <Badge
                variant={hasDeficit ? "destructive" : "secondary"}
                className="text-[10px] px-1.5 py-0"
                title={hasDeficit ? t("skala.scheduleBuilder.legendDeficit") : undefined}
              >
                {cell.assignedCount}
              </Badge>
            )}
            {cell.isWeekendMandatory && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
          </div>
          <div className="space-y-0.5">
            {cell.assigned.map((a) => (
              <div key={a.assignmentId} className="flex items-center gap-1 rounded bg-emerald-500/10 px-1 py-0.5">
                <span className="text-[11px] text-foreground truncate flex-1">{a.name.split(" ")[0]}</span>
                <span className="text-[9px] text-muted-foreground">{Number(a.score).toFixed(0)}</span>
              </div>
            ))}
            {!emptyNoDemand && cell.deficit > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-destructive">
                <Plus className="w-3 h-3" />{t("skala.scheduleBuilder.pendingN", { n: cell.deficit })}
              </div>
            )}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b border-border">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            {shiftType === "lunch" ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5 text-indigo-500" />}
            {t(`skala.scheduleBuilder.shift.${shiftType}`)}
            {cell.isWeekendMandatory && (
              <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">{t("skala.scheduleBuilder.bonusShift")}</Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatDateBR(cell.date)}</p>
          {slotList.length > 1 ? (
            <div className="space-y-1 mt-2">
              <Label className="text-[11px]">{t("skala.scheduleBuilder.slot")}</Label>
              <Select value={String(Math.min(slotIdx, slotList.length - 1))} onValueChange={(v) => setSlotIdx(Number(v))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {slotList.map((s, idx) => (
                    <SelectItem key={idx} value={String(idx)}>{slotText(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">{slotText(slot)}</p>
          )}
        </div>

        {/* Assigned */}
        {cell.assigned.length > 0 && (
          <div className="p-3 border-b border-border space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              {t("skala.scheduleBuilder.assignedList")} ({cell.assigned.length})
            </p>
            {cell.assigned.map((a) => (
              <div key={a.assignmentId} className="flex items-center justify-between gap-2">
                <span className="text-sm flex items-center gap-1.5 truncate">
                  {a.name} <Stars level={a.level} />
                  <span className="text-[10px] text-muted-foreground">{Number(a.score).toFixed(1)}</span>
                </span>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                  onClick={() => void remove(a.assignmentId)} disabled={working}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Candidates */}
        <div className="p-3 space-y-1 max-h-64 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            {t("skala.scheduleBuilder.waitingList")} ({candidates.length})
          </p>
          {!cycleId ? (
            <p className="text-xs text-muted-foreground">{t("skala.scheduleBuilder.noCycle")}</p>
          ) : loadingCand ? (
            <p className="text-xs text-muted-foreground">{t("skala.common.loading")}</p>
          ) : candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("skala.scheduleBuilder.noCandidates")}</p>
          ) : (
            candidates.map(renderRow)
          )}

          {/* Fallback (§3.3): staff a slot from ALL members when availability is thin. */}
          {canEdit && (
            <div className="pt-2 mt-1 border-t border-border">
              <button type="button" onClick={() => void toggleShowAll()}
                className="text-xs text-primary hover:underline">
                {showAll ? t("skala.scheduleBuilder.hideAllMembers") : t("skala.scheduleBuilder.assignAnyone")}
              </button>
              {showAll && (
                <div className="mt-1.5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    {t("skala.scheduleBuilder.allMembers")} ({allMembers.length})
                  </p>
                  {loadingAll ? (
                    <p className="text-xs text-muted-foreground">{t("skala.common.loading")}</p>
                  ) : allMembers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("skala.scheduleBuilder.noMembers")}</p>
                  ) : (
                    allMembers.map(renderRow)
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function SchedulingPage() {
  const { t, i18n } = useTranslation();
  useAuth();
  const lng = i18n.language || "pt-BR";

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantFilter, setRestaurantFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<string>(() => todayIso());
  const [customStart, setCustomStart] = useState<string>(() => mondayOf(todayIso()));
  const [customEnd, setCustomEnd] = useState<string>(() => addDays(mondayOf(todayIso()), 6));
  const [cycle, setCycle] = useState<AvailabilityCycle | null>(null);
  const [board, setBoard] = useState<WeekBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which restaurants the current user may EDIT (ops = all; manager = own only).
  const [scope, setScope] = useState<{ canEditAll: boolean; ids: Set<string> }>({
    canEditAll: false, ids: new Set(),
  });

  useEffect(() => {
    void (async () => {
      const { data } = await listRestaurants({ activeOnly: true });
      setRestaurants(data);
    })();
    void (async () => {
      const { data } = await getMyScope();
      if (data) setScope({ canEditAll: data.canEditAll, ids: new Set(data.restaurantIds) });
    })();
  }, []);

  // The visible date range, derived from the view mode (§R2: week / month / custom).
  const range = useMemo<{ start: string; end: string } | null>(() => {
    if (viewMode === "month") return { start: monthRefOf(anchor), end: endOfMonth(anchor) };
    if (viewMode === "custom") {
      if (!customStart || !customEnd) return null;
      return customStart <= customEnd
        ? { start: customStart, end: customEnd }
        : { start: customEnd, end: customStart };
    }
    const start = mondayOf(anchor);
    return { start, end: addDays(start, 6) };
  }, [viewMode, anchor, customStart, customEnd]);

  const loadBoard = useCallback(async () => {
    if (!range) { setBoard(null); setCycle(null); return; }
    setLoading(true);
    const { data: c } = await getCycleByMonth(monthRefOf(range.start));
    setCycle(c);
    const { data, error } = await getWeekBoard({
      rangeStart: range.start, rangeEnd: range.end, cycleId: c?.id ?? null,
      restaurantId: restaurantFilter === "all" ? null : restaurantFilter,
    });
    if (error) toast.error(error.message);
    setBoard(data);
    setLoading(false);
  }, [range, restaurantFilter]);

  useEffect(() => { void loadBoard(); }, [loadBoard]);

  // userIds assigned per date+shift (any restaurant) — for conflict flags.
  const busyByDateShift = useMemo(() => {
    const m = new Map<string, Set<string>>();
    board?.shifts.forEach((sg) =>
      sg.restaurants.forEach((r) =>
        r.cells.forEach((c) => {
          const k = `${c.date}|${sg.shiftType}`;
          if (!m.has(k)) m.set(k, new Set());
          c.assigned.forEach((a) => m.get(k)!.add(a.userId));
        })));
    return m;
  }, [board]);

  const published = cycle?.status === "published";
  const canEdit = !!cycle && !published;
  const today = todayIso();

  const rangeLabel = useMemo(() => {
    if (!range) return "—";
    if (viewMode === "month") {
      return new Intl.DateTimeFormat(lng, { month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${range.start}T00:00:00Z`));
    }
    const f = (d: string, o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(lng, { ...o, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
    return `${f(range.start, { month: "short", day: "numeric" })} – ${f(range.end, { month: "short", day: "numeric", year: "numeric" })}`;
  }, [range, viewMode, lng]);

  const goPrev = () => setAnchor(viewMode === "month" ? addMonths(anchor, -1) : addDays(anchor, -7));
  const goNext = () => setAnchor(viewMode === "month" ? addMonths(anchor, 1) : addDays(anchor, 7));
  const goToday = () => {
    setAnchor(todayIso());
    if (viewMode === "custom") {
      const m = mondayOf(todayIso());
      setCustomStart(m); setCustomEnd(addDays(m, 6));
    }
  };

  const dayHeader = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    return {
      wd: new Intl.DateTimeFormat(lng, { weekday: "short", timeZone: "UTC" }).format(d),
      n: Number(date.slice(8, 10)),
      weekend: [0, 5, 6].includes(d.getUTCDay()), // Fri/Sat/Sun — the most-wanted shifts
    };
  };

  const onCreatecycle = async () => {
    const monthRef = monthRefOf(range?.start ?? todayIso());
    setBusy(true);
    const { error } = await createCycle({ referenceMonth: monthRef, ...cycleWindow(monthRef) });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.scheduleBuilder.cycleCreated"));
    void loadBoard();
  };

  const onPublish = async () => {
    if (!cycle) return;
    if (!window.confirm(t("skala.scheduleBuilder.publishConfirm"))) return;
    setBusy(true);
    const { error } = await publishCycle(cycle.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.scheduleBuilder.publishedToast"));
    void loadBoard();
  };

  const dayCount = board?.days.length ?? 7;
  const gridCols = { gridTemplateColumns: `minmax(150px,180px) repeat(${dayCount}, minmax(116px,1fr))` };
  const innerMinWidth = 180 + dayCount * 120;

  return (
    <AppLayout>
      <div className="p-6 max-w-[1400px] mx-auto space-y-5">
        {/* Header — title, status, week navigation & primary action */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
          <div className="pointer-events-none absolute -top-20 -right-12 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-52 w-52 rounded-full bg-accent/10 blur-3xl" />

          <div className="relative p-5 sm:p-6 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            {/* Title cluster */}
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25">
                <CalendarCheck className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    {t("skala.scheduleBuilder.title")}
                  </h1>
                  {cycle && (
                    <Badge
                      variant="outline"
                      className={`gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${
                        published
                          ? "border-info/30 bg-info/10 text-info"
                          : "border-success/30 bg-success/10 text-success"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${published ? "bg-info" : "bg-success"}`} />
                      {t(`skala.scheduleBuilder.cycleStatus.${cycle.status}`)}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {t("skala.scheduleBuilder.subtitle")}
                </p>
              </div>
            </div>

            {/* View switch + period navigation + actions */}
            <div className="flex flex-wrap items-center gap-2.5 xl:shrink-0">
              {/* View-mode switch (week / month / custom) */}
              <div className="flex items-center rounded-xl border border-border/70 bg-card/70 p-1 shadow-sm backdrop-blur">
                {(["week", "month", "custom"] as ViewMode[]).map((m) => (
                  <Button
                    key={m}
                    variant={viewMode === m ? "default" : "ghost"}
                    size="sm" className="h-8 rounded-lg px-3 text-xs"
                    onClick={() => setViewMode(m)}
                  >
                    {t(`skala.scheduleBuilder.view.${m}`)}
                  </Button>
                ))}
              </div>

              {/* Period navigator (week/month) or custom date range */}
              {viewMode === "custom" ? (
                <div className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 p-1.5 shadow-sm backdrop-blur">
                  <Input
                    type="date" value={customStart} max={customEnd || undefined}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="h-8 w-[140px] text-xs" aria-label={t("skala.scheduleBuilder.rangeFrom")}
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input
                    type="date" value={customEnd} min={customStart || undefined}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="h-8 w-[140px] text-xs" aria-label={t("skala.scheduleBuilder.rangeTo")}
                  />
                </div>
              ) : (
                <div className="flex items-center rounded-xl border border-border/70 bg-card/70 p-1 shadow-sm backdrop-blur">
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 rounded-lg"
                    onClick={goPrev} aria-label="Previous"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex min-w-[190px] items-center justify-center gap-2 px-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold capitalize text-foreground">{rangeLabel}</span>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 rounded-lg"
                    onClick={goNext} aria-label="Next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              <Button
                variant="ghost" size="sm" className="rounded-xl text-muted-foreground hover:text-foreground"
                onClick={goToday}
              >
                {t("skala.scheduleBuilder.today")}
              </Button>

              {cycle && scope.canEditAll && (
                <CycleControl cycle={cycle} restaurants={restaurants} onChanged={loadBoard} />
              )}

              <Button
                className="rounded-xl shadow-md shadow-primary/25"
                onClick={() => void onPublish()}
                disabled={busy || !cycle || published}
              >
                <Send className="mr-1.5 h-4 w-4" />
                {published ? t("skala.scheduleBuilder.alreadyPublished") : t("skala.scheduleBuilder.publish")}
              </Button>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <Card className="p-3">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skala.scheduleBuilder.restaurant")}</Label>
              <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("skala.scheduleBuilder.allRestaurants")}</SelectItem>
                  {restaurants.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!cycle && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">{t("skala.scheduleBuilder.noCycle")}</span>
                <Button size="sm" variant="outline" onClick={() => void onCreatecycle()} disabled={busy}>
                  <Plus className="w-3.5 h-3.5 mr-1" />{t("skala.scheduleBuilder.createCycle")}
                </Button>
              </div>
            )}
            {/* Legend */}
            <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Sun className="w-3.5 h-3.5 text-amber-500" />{t("skala.scheduleBuilder.shift.lunch")}</span>
              <span className="flex items-center gap-1"><Moon className="w-3.5 h-3.5 text-indigo-500" />{t("skala.scheduleBuilder.shift.dinner")}</span>
              <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{t("skala.scheduleBuilder.bonusShift")}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-destructive inline-block" />{t("skala.scheduleBuilder.legendDeficit")}</span>
            </div>
          </div>
        </Card>

        {/* Grid */}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("skala.common.loading")}</p>
        ) : !board || board.shifts.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.scheduleBuilder.noRestaurants")}</Card>
        ) : (
          <Card className="overflow-x-auto">
            <div style={{ minWidth: `${innerMinWidth}px` }}>
              {/* Header row */}
              <div className="grid border-b border-border bg-muted/30" style={gridCols}>
                <div className="p-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("skala.scheduleBuilder.dutyRestaurant")}
                </div>
                {board.days.map((d) => {
                  const h = dayHeader(d.date);
                  const isToday = d.date === today;
                  return (
                    <div key={d.date} className={`p-2 text-center border-l border-border ${isToday ? "bg-primary/10" : ""}`}>
                      <p className="text-[10px] uppercase text-muted-foreground">{h.wd}</p>
                      <p className={`text-sm font-bold ${isToday || h.weekend ? "text-primary" : "text-foreground"}`}>{h.n}</p>
                    </div>
                  );
                })}
              </div>

              {/* Shift groups */}
              {board.shifts.map((sg) => (
                <div key={sg.shiftType}>
                  <div className="grid bg-muted/20 border-b border-border" style={gridCols}>
                    <div className="col-span-full p-1.5 px-2 text-xs font-semibold text-foreground flex items-center gap-1.5">
                      {sg.shiftType === "lunch"
                        ? <Sun className="w-3.5 h-3.5 text-amber-500" />
                        : <Moon className="w-3.5 h-3.5 text-indigo-500" />}
                      {t(`skala.scheduleBuilder.shift.${sg.shiftType}`)}
                      <span className="text-muted-foreground font-normal">
                        {sg.restaurants[0]?.startTime.slice(0, 5)}–{sg.restaurants[0]?.endTime.slice(0, 5)}
                      </span>
                    </div>
                  </div>
                  {sg.restaurants.map((row) => {
                    // Managers can view every restaurant but only edit their own.
                    const mayEditRow = scope.canEditAll || scope.ids.has(row.restaurantId);
                    const rowCanEdit = canEdit && mayEditRow;
                    const readOnlyForManager = canEdit && !mayEditRow;
                    return (
                      <div key={row.restaurantId} className="grid border-b border-border" style={gridCols}>
                        <div className="p-2 flex items-center gap-1.5 text-sm font-medium text-foreground bg-muted/10">
                          <span className="truncate">{row.restaurantName}</span>
                          {readOnlyForManager && (
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 shrink-0">
                              {t("skala.scheduleBuilder.readOnly")}
                            </span>
                          )}
                        </div>
                        {row.cells.map((cell) => (
                          <ScheduleCell
                            key={`${row.restaurantId}-${cell.date}`}
                            cell={cell}
                            restaurantId={row.restaurantId}
                            shiftType={sg.shiftType}
                            startTime={row.startTime}
                            endTime={row.endTime}
                            slots={row.slots}
                            cycleId={board.cycleId}
                            isToday={cell.date === today}
                            busyUserIds={busyByDateShift.get(`${cell.date}|${sg.shiftType}`) ?? new Set()}
                            canEdit={rowCanEdit}
                            onChanged={loadBoard}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
