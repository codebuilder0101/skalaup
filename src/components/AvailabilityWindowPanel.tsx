import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SlidersHorizontal, Loader2, Unlock, Lock, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { getCycleByMonth, createCycle, setCycleStatus, listCycles } from "@/lib/skalaup/availability";
import type { AvailabilityCycle } from "@/lib/skalaup/types";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Coordinator/administrator control to open, extend or close the monthly
// availability window on demand (§3.1). Drives the parent page's active cycle so
// the freelancer grid reflects the change immediately.
interface Props {
  cycle: AvailabilityCycle | null;
  onChange: (cycle: AvailabilityCycle | null) => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const lastDayOfMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
// Sensible defaults for a month with no cycle yet: open from today (if we're
// inside/near the month) else the 1st, and close at month end.
function defaultsFor(ym: string) {
  const first = `${ym}-01`;
  const last = lastDayOfMonth(ym);
  const t = todayIso();
  const opens = t >= first && t <= last ? t : first;
  return { opens, closes: last };
}

export function AvailabilityWindowPanel({ cycle, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";

  const [month, setMonth] = useState<string>(() =>
    cycle ? cycle.referenceMonth.slice(0, 7) : currentMonth());
  const initial = defaultsFor(month);
  const [opensDate, setOpensDate] = useState<string>(cycle?.opensAt?.slice(0, 10) ?? initial.opens);
  const [closesDate, setClosesDate] = useState<string>(cycle?.closesAt?.slice(0, 10) ?? initial.closes);
  const [busy, setBusy] = useState(false);
  const [cycles, setCycles] = useState<AvailabilityCycle[]>([]);
  const syncedId = useRef<string | null>(cycle?.id ?? null);

  // All existing cycles, for the picker — so every month (open OR closed) is
  // visible and selectable. Opening a new month never hides a previous one.
  const refreshCycles = useCallback(async () => {
    const { data } = await listCycles();
    setCycles(data);
  }, []);
  useEffect(() => { void refreshCycles(); }, [refreshCycles]);

  // When the active cycle changes identity (initial load, month switch), mirror
  // its window into the inputs. Guarded by id so it never loops on our own writes.
  useEffect(() => {
    if (cycle && cycle.id !== syncedId.current) {
      syncedId.current = cycle.id;
      const d = defaultsFor(cycle.referenceMonth.slice(0, 7));
      setMonth(cycle.referenceMonth.slice(0, 7));
      setOpensDate(cycle.opensAt?.slice(0, 10) ?? d.opens);
      setClosesDate(cycle.closesAt?.slice(0, 10) ?? d.closes);
    }
  }, [cycle]);

  const isOpen = cycle?.status === "open";
  const fmt = (iso: string | null | undefined) =>
    iso
      ? new Intl.DateTimeFormat(lng, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
          .format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))
      : "";

  const loadMonth = async (ym: string) => {
    setMonth(ym);
    setBusy(true);
    const { data } = await getCycleByMonth(`${ym}-01`);
    setBusy(false);
    syncedId.current = data?.id ?? null;
    onChange(data);
    if (data) {
      setOpensDate(data.opensAt.slice(0, 10));
      setClosesDate(data.closesAt.slice(0, 10));
    } else {
      const d = defaultsFor(ym);
      setOpensDate(d.opens);
      setClosesDate(d.closes);
    }
  };

  // Open (or save/extend) the window with the chosen dates, then ensure it's open.
  const openOrSave = async () => {
    if (closesDate < opensDate) { toast.error(t("skala.availability.manage.invalidRange")); return; }
    if (closesDate < todayIso()) { toast.warning(t("skala.availability.manage.pastWarning")); }
    setBusy(true);
    const referenceMonth = `${month}-01`;
    const { data: up, error } = await createCycle({
      referenceMonth,
      opensAt: `${opensDate}T00:00:00`,
      closesAt: `${closesDate}T23:59:59`,
    });
    if (error || !up) { setBusy(false); toast.error(error?.message ?? "Erro"); return; }
    // On an existing cycle the upsert keeps the prior status — force it open.
    if (up.status !== "open") {
      const { error: se } = await setCycleStatus(up.id, "open");
      if (se) { setBusy(false); toast.error(se.message); return; }
    }
    const { data: fresh } = await getCycleByMonth(referenceMonth);
    setBusy(false);
    if (fresh) {
      syncedId.current = fresh.id;
      onChange(fresh);
      setOpensDate(fresh.opensAt.slice(0, 10));
      setClosesDate(fresh.closesAt.slice(0, 10));
    }
    void refreshCycles();
    toast.success(t(isOpen ? "skala.availability.manage.saved" : "skala.availability.manage.opened"));
  };

  const closeWindow = async () => {
    if (!cycle) return;
    setBusy(true);
    const { error } = await setCycleStatus(cycle.id, "closed");
    if (error) { setBusy(false); toast.error(error.message); return; }
    const { data: fresh } = await getCycleByMonth(cycle.referenceMonth);
    setBusy(false);
    if (fresh) { syncedId.current = fresh.id; onChange(fresh); }
    void refreshCycles();
    toast.success(t("skala.availability.manage.closed"));
  };

  // Month/year selectors (replace the native <input type="month">, whose letter
  // type-ahead jumped to Janeiro). Picking is click-only, so no letter-jump.
  const year = month.slice(0, 4);
  const mm = month.slice(5, 7);
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label: cap(new Intl.DateTimeFormat(lng, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, i, 1)))),
  }));
  const nowYear = new Date().getFullYear();
  const yearOptions = [...new Set<number>([
    nowYear - 1, nowYear, nowYear + 1, Number(year),
    ...cycles.map((c) => Number(c.referenceMonth.slice(0, 4))),
  ])].sort((a, b) => a - b);
  const pickMonth = (yr: string, mo: string) => void loadMonth(`${yr}-${mo}`);
  const monthLabel = (ym: string) =>
    cap(new Intl.DateTimeFormat(lng, { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${ym}-01T00:00:00Z`)));

  return (
    <Card className="p-4 sm:p-5 space-y-4 border-primary/30 bg-primary/[0.03]">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <SlidersHorizontal className="h-4.5 w-4.5" />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{t("skala.availability.manage.title")}</h2>
            {cycle && (
              <Badge variant={isOpen ? "default" : "secondary"} className={isOpen ? "gap-1 bg-emerald-600 hover:bg-emerald-600" : "gap-1"}>
                {isOpen ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {isOpen ? t("skala.availability.manage.openUntil", { date: fmt(cycle.closesAt) })
                        : t(`skala.scheduleBuilder.cycleStatus.${cycle.status}`)}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("skala.availability.manage.subtitle")}</p>
        </div>
      </div>

      {cycles.length > 0 && (
        <div className="space-y-1">
          <Label className="text-[11px]">{t("skala.availability.manage.cyclePicker")}</Label>
          <Select
            value={cycles.some((c) => c.referenceMonth.slice(0, 7) === month) ? month : undefined}
            onValueChange={(v) => void loadMonth(v)}
            disabled={busy}
          >
            <SelectTrigger className="h-9 w-64"><SelectValue placeholder={t("skala.availability.manage.cyclePickerPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {cycles.map((c) => (
                <SelectItem key={c.id} value={c.referenceMonth.slice(0, 7)}>
                  {monthLabel(c.referenceMonth.slice(0, 7))} — {t(`skala.scheduleBuilder.cycleStatus.${c.status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[11px]">{t("skala.availability.manage.month")}</Label>
          <div className="flex gap-2">
            <Select value={mm} onValueChange={(v) => pickMonth(year, v)} disabled={busy}>
              <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={year} onValueChange={(v) => pickMonth(v, mm)} disabled={busy}>
              <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">{t("skala.availability.manage.opensAt")}</Label>
          <Input type="date" className="h-9 w-40" value={opensDate} disabled={busy}
            onChange={(e) => setOpensDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">{t("skala.availability.manage.closesAt")}</Label>
          <Input type="date" className="h-9 w-40" value={closesDate} min={opensDate} disabled={busy}
            onChange={(e) => setClosesDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-9 rounded-xl shadow-sm shadow-primary/20" onClick={() => void openOrSave()} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : isOpen ? <Save className="mr-1.5 h-4 w-4" /> : <Unlock className="mr-1.5 h-4 w-4" />}
            {t(isOpen ? "skala.availability.manage.save" : "skala.availability.manage.open")}
          </Button>
          {isOpen && (
            <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => void closeWindow()} disabled={busy}>
              <Lock className="mr-1.5 h-4 w-4" />{t("skala.availability.manage.close")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
