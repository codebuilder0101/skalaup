import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Gauge, Sun, Moon, Plus, Trash2, Save, Loader2, CalendarPlus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { listRestaurants } from "@/lib/skalaup/restaurants";
import {
  listDemand, setDemand, listOverrides, setOverride, deleteOverride,
  type DemandRow, type OverrideRow,
} from "@/lib/skalaup/scheduling";
import type { Restaurant, ShiftType } from "@/lib/skalaup/types";

const SHIFTS: ShiftType[] = ["lunch", "dinner"];
// Display Monday→Sunday; numeric weekday is 0=Sun..6=Sat (matches the backend).
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SUNDAY_REF = "2024-01-07"; // a known Sunday, for weekday labels

export default function DemandPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState<string>("");
  const [grid, setGrid] = useState<Record<string, string>>({}); // `${weekday}-${shift}` -> count
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingBase, setSavingBase] = useState(false);

  // New-override form
  const [ovDate, setOvDate] = useState("");
  const [ovShift, setOvShift] = useState<ShiftType>("lunch");
  const [ovCount, setOvCount] = useState("");
  const [ovReason, setOvReason] = useState("");
  const [addingOv, setAddingOv] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await listRestaurants({ activeOnly: true });
      setRestaurants(data);
      if (data[0]) setRestaurantId(data[0].id);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    const [{ data: demand }, { data: ovs }] = await Promise.all([
      listDemand(restaurantId),
      listOverrides({ restaurantId }),
    ]);
    const g: Record<string, string> = {};
    (demand as DemandRow[]).forEach((d) => { g[`${d.weekday}-${d.shiftType}`] = String(d.requiredCount); });
    setGrid(g);
    setOverrides(ovs);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => { void load(); }, [load]);

  const weekdayLabel = (weekday: number) => {
    const d = new Date(`${SUNDAY_REF}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + weekday);
    return new Intl.DateTimeFormat(lng, { weekday: "long", timeZone: "UTC" }).format(d);
  };
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(lng, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

  const cellVal = (weekday: number, shift: ShiftType) => grid[`${weekday}-${shift}`] ?? "";
  const setCell = (weekday: number, shift: ShiftType, v: string) =>
    setGrid((g) => ({ ...g, [`${weekday}-${shift}`]: v.replace(/[^0-9]/g, "") }));

  const saveBase = async () => {
    if (!restaurantId) return;
    setSavingBase(true);
    try {
      for (const weekday of WEEKDAY_ORDER) {
        for (const shift of SHIFTS) {
          const raw = grid[`${weekday}-${shift}`];
          const requiredCount = Math.max(0, Number(raw || 0));
          const { error } = await setDemand({ restaurantId, weekday, shiftType: shift, requiredCount });
          if (error) throw new Error(error.message);
        }
      }
      toast.success(t("skala.demand.baseSaved"));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingBase(false);
    }
  };

  const addOverride = async () => {
    if (!restaurantId || !ovDate || ovCount === "") {
      toast.error(t("skala.demand.overrideMissing"));
      return;
    }
    setAddingOv(true);
    const { error } = await setOverride({
      restaurantId, date: ovDate, shiftType: ovShift,
      requiredCount: Math.max(0, Number(ovCount)), reason: ovReason || null,
    });
    setAddingOv(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.demand.overrideSaved"));
    setOvDate(""); setOvCount(""); setOvReason(""); setOvShift("lunch");
    await load();
  };

  const removeOverride = async (id: string) => {
    const { error } = await deleteOverride(id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const sortedOverrides = useMemo(
    () => [...overrides].sort((a, b) => a.date.localeCompare(b.date)),
    [overrides],
  );

  const shiftIcon = (shift: ShiftType) => shift === "lunch"
    ? <Sun className="h-3.5 w-3.5 text-amber-500" />
    : <Moon className="h-3.5 w-3.5 text-indigo-500" />;

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
          <div className="pointer-events-none absolute -top-20 -right-12 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative p-5 sm:p-6 flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25">
              <Gauge className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("skala.demand.title")}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("skala.demand.subtitle")}</p>
            </div>
          </div>
        </div>

        {/* Restaurant selector */}
        <Card className="p-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skala.scheduleBuilder.restaurant")}</Label>
              <Select value={restaurantId} onValueChange={setRestaurantId}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {restaurants.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("skala.common.loading")}</p>
        ) : !restaurantId ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.demand.noRestaurants")}</Card>
        ) : (
          <>
            {/* Base demand grid */}
            <Card className="p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{t("skala.demand.baseTitle")}</h2>
                  <p className="text-xs text-muted-foreground">{t("skala.demand.baseHint")}</p>
                </div>
                <Button size="sm" className="rounded-xl shadow-sm shadow-primary/20" onClick={() => void saveBase()} disabled={savingBase}>
                  {savingBase ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  {t("skala.demand.saveBase")}
                </Button>
              </div>
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span>{t("skala.demand.weekday")}</span>
                  <span className="w-20 text-center">{t("skala.scheduleBuilder.shift.lunch")}</span>
                  <span className="w-20 text-center">{t("skala.scheduleBuilder.shift.dinner")}</span>
                </div>
                {WEEKDAY_ORDER.map((weekday) => (
                  <div key={weekday} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5">
                    <span className="text-sm font-medium capitalize text-foreground">{weekdayLabel(weekday)}</span>
                    {SHIFTS.map((shift) => (
                      <Input
                        key={shift}
                        inputMode="numeric"
                        className="h-8 w-20 text-center text-sm"
                        value={cellVal(weekday, shift)}
                        placeholder="0"
                        onChange={(e) => setCell(weekday, shift, e.target.value)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </Card>

            {/* Date overrides */}
            <Card className="p-4 sm:p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t("skala.demand.overridesTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t("skala.demand.overridesHint")}</p>
              </div>

              {/* Add form */}
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/60 bg-muted/30 p-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">{t("skala.scheduleBuilder.date")}</Label>
                  <Input type="date" className="h-8 w-40 text-sm" value={ovDate} onChange={(e) => setOvDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">{t("skala.demand.shift")}</Label>
                  <Select value={ovShift} onValueChange={(v) => setOvShift(v as ShiftType)}>
                    <SelectTrigger className="h-8 w-28 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SHIFTS.map((s) => <SelectItem key={s} value={s}>{t(`skala.scheduleBuilder.shift.${s}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">{t("skala.demand.count")}</Label>
                  <Input inputMode="numeric" className="h-8 w-20 text-center text-sm" placeholder="0"
                    value={ovCount} onChange={(e) => setOvCount(e.target.value.replace(/[^0-9]/g, ""))} />
                </div>
                <div className="space-y-1 flex-1 min-w-[140px]">
                  <Label className="text-[11px]">{t("skala.demand.reason")}</Label>
                  <Input className="h-8 text-sm" placeholder={t("skala.demand.reasonPlaceholder")}
                    value={ovReason} onChange={(e) => setOvReason(e.target.value)} />
                </div>
                <Button size="sm" className="h-8 rounded-xl" onClick={() => void addOverride()} disabled={addingOv}>
                  {addingOv ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                  {t("skala.demand.addOverride")}
                </Button>
              </div>

              {/* List */}
              {sortedOverrides.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarPlus className="h-4 w-4" />{t("skala.demand.noOverrides")}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {sortedOverrides.map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 px-3 py-2">
                      <span className="text-sm font-medium text-foreground w-28 shrink-0">{fmtDate(o.date)}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground w-24 shrink-0">
                        {shiftIcon(o.shiftType)}{t(`skala.scheduleBuilder.shift.${o.shiftType}`)}
                      </span>
                      <span className="text-sm font-semibold text-primary w-10 shrink-0">{o.requiredCount}</span>
                      <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{o.reason || "—"}</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => void removeOverride(o.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
