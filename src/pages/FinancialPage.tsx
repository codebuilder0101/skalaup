import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DollarSign, Loader2, RefreshCw, Lock, LockOpen, Download, Plus, Trash2,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, CalendarDays, Users, Coins,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getPayrollSummary, recomputePayroll, closePayroll, reopenPayroll,
  addPayrollAdjustment, deletePayrollAdjustment, listPayrollEntries,
  type PayrollReport, type PayrollFreelancer, type PayrollEntry,
} from "@/lib/skalaup/payroll";
import { listFreelancers, type FreelancerWithProfile } from "@/lib/skalaup/freelancers";
import { listRestaurants } from "@/lib/skalaup/restaurants";
import type { Restaurant } from "@/lib/skalaup/types";

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function FinancialPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";

  const [month, setMonth] = useState<string>(currentMonth());
  const [report, setReport] = useState<PayrollReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [entriesByUser, setEntriesByUser] = useState<Record<string, PayrollEntry[]>>({});

  // Manual adjustment dialog
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjUserId, setAdjUserId] = useState<string>("");
  const [adjRestaurantId, setAdjRestaurantId] = useState<string>("none");
  const [adjAmount, setAdjAmount] = useState<string>("");
  const [adjNotes, setAdjNotes] = useState<string>("");
  const [adjSaving, setAdjSaving] = useState(false);

  const [freelancers, setFreelancers] = useState<FreelancerWithProfile[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);

  const fmtBRL = useCallback(
    (n: number) => new Intl.NumberFormat(lng, { style: "currency", currency: "BRL" }).format(n || 0),
    [lng],
  );
  const monthLabel = useMemo(() => {
    const d = new Date(`${month}-01T00:00:00Z`);
    return new Intl.DateTimeFormat(lng, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  }, [month, lng]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await getPayrollSummary(month);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setReport(data);
    setExpanded(new Set());
    setEntriesByUser({});
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const [{ data: frs }, { data: rsts }] = await Promise.all([
        listFreelancers(),
        listRestaurants({ activeOnly: true }),
      ]);
      setFreelancers(frs);
      setRestaurants(rsts);
    })();
  }, []);

  const isClosed = report?.period.status === "closed";

  const applyResult = (data: PayrollReport | null, okMsg: string) => {
    if (data) { setReport(data); setExpanded(new Set()); setEntriesByUser({}); toast.success(okMsg); }
  };

  const recompute = async () => {
    setBusy(true);
    const { data, error } = await recomputePayroll(month);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    applyResult(data, t("skala.financial.recomputed"));
  };

  const closeMonth = async () => {
    setBusy(true);
    const { data, error } = await closePayroll(month);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    applyResult(data, t("skala.financial.closed"));
  };

  const reopenMonth = async () => {
    setBusy(true);
    const { data, error } = await reopenPayroll(month);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    applyResult(data, t("skala.financial.reopened"));
  };

  const toggleExpand = async (userId: string) => {
    const next = new Set(expanded);
    if (next.has(userId)) { next.delete(userId); setExpanded(next); return; }
    next.add(userId);
    setExpanded(next);
    if (!entriesByUser[userId]) {
      const { data } = await listPayrollEntries(month, userId);
      setEntriesByUser((m) => ({ ...m, [userId]: data }));
    }
  };

  const openAdjust = (userId?: string) => {
    setAdjUserId(userId ?? "");
    setAdjRestaurantId("none");
    setAdjAmount("");
    setAdjNotes("");
    setAdjOpen(true);
  };

  const saveAdjustment = async () => {
    const amount = Number(adjAmount.replace(",", "."));
    if (!adjUserId) { toast.error(t("skala.financial.adjPickFreelancer")); return; }
    if (!Number.isFinite(amount) || amount === 0) { toast.error(t("skala.financial.adjBadAmount")); return; }
    setAdjSaving(true);
    const { data, error } = await addPayrollAdjustment({
      month, userId: adjUserId,
      restaurantId: adjRestaurantId === "none" ? null : adjRestaurantId,
      amount, notes: adjNotes || null,
    });
    setAdjSaving(false);
    if (error) { toast.error(error.message); return; }
    setAdjOpen(false);
    applyResult(data, t("skala.financial.adjAdded"));
  };

  const removeEntry = async (entryId: string) => {
    const { data, error } = await deletePayrollAdjustment(entryId);
    if (error) { toast.error(error.message); return; }
    applyResult(data, t("skala.financial.adjRemoved"));
  };

  const exportCsv = () => {
    if (!report) return;
    const money = (n: number) => (n || 0).toFixed(2);
    const header = [
      t("skala.financial.csv.month"), t("skala.financial.csv.freelancer"), t("skala.financial.csv.restaurant"),
      t("skala.financial.csv.shifts"), t("skala.financial.csv.shiftPay"), t("skala.financial.csv.bonus"),
      t("skala.financial.csv.lateDiscount"), t("skala.financial.csv.noShowDiscount"),
      t("skala.financial.csv.adjustment"), t("skala.financial.csv.net"),
    ];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    for (const fr of report.freelancers) {
      for (const rb of fr.byRestaurant) {
        lines.push([
          month, fr.name, rb.restaurantName, String(rb.shiftCount),
          money(rb.shiftPay), money(rb.weekendBonus), money(rb.lateDiscount),
          money(rb.noShowDiscount), money(rb.manualAdjustment), money(rb.net),
        ].map(esc).join(","));
      }
      lines.push([
        month, fr.name, t("skala.financial.csv.total"), String(fr.totals.shiftCount),
        money(fr.totals.shiftPay), money(fr.totals.weekendBonus), money(fr.totals.lateDiscount),
        money(fr.totals.noShowDiscount), money(fr.totals.manualAdjustment), money(fr.totals.net),
      ].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `folha-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = report?.totals;
  const discountsTotal = (totals?.lateDiscount ?? 0) + (totals?.noShowDiscount ?? 0);

  const entryTypeLabel = (type: PayrollEntry["type"]) => t(`skala.financial.entryType.${type}`);

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
          <div className="pointer-events-none absolute -top-20 -right-12 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative p-5 sm:p-6 flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25">
              <DollarSign className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("skala.financial.title")}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("skala.financial.subtitle")}</p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <Card className="p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skala.financial.month")}</Label>
              <Input type="month" className="h-9 w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skala.financial.status")}</Label>
              <div className="h-9 flex items-center">
                {isClosed ? (
                  <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" />{t("skala.financial.statusClosed")}</Badge>
                ) : (
                  <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600"><LockOpen className="h-3 w-3" />{t("skala.financial.statusOpen")}</Badge>
                )}
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={exportCsv} disabled={!report || report.freelancers.length === 0}>
                <Download className="mr-1.5 h-4 w-4" />{t("skala.financial.exportCsv")}
              </Button>
              {!isClosed && (
                <>
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void openAdjust()} disabled={busy}>
                    <Plus className="mr-1.5 h-4 w-4" />{t("skala.financial.addAdjustment")}
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void recompute()} disabled={busy}>
                    {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                    {t("skala.financial.recompute")}
                  </Button>
                  <Button size="sm" className="rounded-xl shadow-sm shadow-primary/20" onClick={() => void closeMonth()} disabled={busy}>
                    <Lock className="mr-1.5 h-4 w-4" />{t("skala.financial.closeMonth")}
                  </Button>
                </>
              )}
              {isClosed && (
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void reopenMonth()} disabled={busy}>
                  <LockOpen className="mr-1.5 h-4 w-4" />{t("skala.financial.reopenMonth")}
                </Button>
              )}
            </div>
          </div>
          {isClosed && report?.period.closedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("skala.financial.closedInfo", {
                who: report.period.closedByName ?? "—",
                when: new Intl.DateTimeFormat(lng, { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.period.closedAt)),
              })}
            </p>
          )}
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <SummaryCard icon={<Coins className="h-4 w-4" />} label={t("skala.financial.summary.net")} value={fmtBRL(totals?.net ?? 0)} accent />
          <SummaryCard icon={<CalendarDays className="h-4 w-4" />} label={t("skala.financial.summary.shifts")} value={String(totals?.shiftCount ?? 0)} />
          <SummaryCard icon={<TrendingUp className="h-4 w-4" />} label={t("skala.financial.summary.bonus")} value={fmtBRL(totals?.weekendBonus ?? 0)} />
          <SummaryCard icon={<TrendingDown className="h-4 w-4" />} label={t("skala.financial.summary.discounts")} value={fmtBRL(discountsTotal)} />
          <SummaryCard icon={<Users className="h-4 w-4" />} label={t("skala.financial.summary.freelancers")} value={String(report?.freelancerCount ?? 0)} />
        </div>

        {/* Per-freelancer table */}
        <Card className="overflow-hidden">
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground capitalize">{monthLabel}</h2>
            <p className="text-xs text-muted-foreground">{t("skala.financial.tableHint")}</p>
          </div>
          {loading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />{t("skala.common.loading")}
            </p>
          ) : !report || report.freelancers.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{t("skala.financial.empty")}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t("skala.financial.col.freelancer")}</TableHead>
                  <TableHead className="text-center">{t("skala.financial.col.shifts")}</TableHead>
                  <TableHead className="text-right">{t("skala.financial.col.shiftPay")}</TableHead>
                  <TableHead className="text-right">{t("skala.financial.col.bonus")}</TableHead>
                  <TableHead className="text-right">{t("skala.financial.col.discounts")}</TableHead>
                  <TableHead className="text-right">{t("skala.financial.col.adjustment")}</TableHead>
                  <TableHead className="text-right">{t("skala.financial.col.net")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.freelancers.map((fr) => (
                  <FreelancerRows
                    key={fr.userId}
                    fr={fr}
                    expanded={expanded.has(fr.userId)}
                    entries={entriesByUser[fr.userId]}
                    fmtBRL={fmtBRL}
                    isClosed={!!isClosed}
                    entryTypeLabel={entryTypeLabel}
                    onToggle={() => void toggleExpand(fr.userId)}
                    onAdjust={() => openAdjust(fr.userId)}
                    onRemoveEntry={(id) => void removeEntry(id)}
                    t={t}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      {/* Manual adjustment dialog */}
      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("skala.financial.adjTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skala.financial.col.freelancer")}</Label>
              <Select value={adjUserId} onValueChange={setAdjUserId}>
                <SelectTrigger><SelectValue placeholder={t("skala.financial.adjPickFreelancer")} /></SelectTrigger>
                <SelectContent>
                  {freelancers.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skala.financial.adjRestaurant")}</Label>
              <Select value={adjRestaurantId} onValueChange={setAdjRestaurantId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("skala.financial.adjNoRestaurant")}</SelectItem>
                  {restaurants.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skala.financial.adjAmount")}</Label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value.replace(/[^0-9,.-]/g, ""))}
              />
              <p className="text-[11px] text-muted-foreground">{t("skala.financial.adjAmountHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skala.financial.adjNotes")}</Label>
              <Textarea rows={2} value={adjNotes} onChange={(e) => setAdjNotes(e.target.value)} placeholder={t("skala.financial.adjNotesPlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void saveAdjustment()} disabled={adjSaving}>
              {adjSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              {t("skala.financial.adjSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function SummaryCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <Card className={`p-3 ${accent ? "border-primary/40 bg-primary/[0.04]" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
      <p className={`mt-1 text-lg font-bold tracking-tight ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    </Card>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function FreelancerRows({
  fr, expanded, entries, fmtBRL, isClosed, entryTypeLabel, onToggle, onAdjust, onRemoveEntry, t,
}: {
  fr: PayrollFreelancer;
  expanded: boolean;
  entries: PayrollEntry[] | undefined;
  fmtBRL: (n: number) => string;
  isClosed: boolean;
  entryTypeLabel: (type: PayrollEntry["type"]) => string;
  onToggle: () => void;
  onAdjust: () => void;
  onRemoveEntry: (id: string) => void;
  t: TFn;
}) {
  const discounts = fr.totals.lateDiscount + fr.totals.noShowDiscount;
  const money = (n: number, cls = "") =>
    <span className={n < 0 ? `text-destructive ${cls}` : cls}>{fmtBRL(n)}</span>;

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="align-middle">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-medium text-foreground">{fr.name}</TableCell>
        <TableCell className="text-center tabular-nums">{fr.totals.shiftCount}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtBRL(fr.totals.shiftPay)}</TableCell>
        <TableCell className="text-right tabular-nums">{fr.totals.weekendBonus > 0 ? fmtBRL(fr.totals.weekendBonus) : "—"}</TableCell>
        <TableCell className="text-right tabular-nums">{discounts < 0 ? money(discounts) : "—"}</TableCell>
        <TableCell className="text-right tabular-nums">{fr.totals.manualAdjustment !== 0 ? money(fr.totals.manualAdjustment) : "—"}</TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{money(fr.totals.net)}</TableCell>
        <TableCell className="text-right">
          {!isClosed && (
            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              title={t("skala.financial.addAdjustment")}
              onClick={(e) => { e.stopPropagation(); onAdjust(); }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={8} className="py-3">
            {/* Per-restaurant breakdown (§12) */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("skala.financial.byRestaurant")}
              </p>
              {fr.byRestaurant.map((rb) => (
                <div key={rb.restaurantId ?? "none"} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-xs">
                  <span className="font-medium text-foreground">{rb.restaurantName}</span>
                  <span className="tabular-nums text-muted-foreground">{rb.shiftCount} {t("skala.financial.shiftsShort")}</span>
                  <span className="tabular-nums">{fmtBRL(rb.shiftPay)}</span>
                  <span className="tabular-nums">{rb.weekendBonus > 0 ? `+${fmtBRL(rb.weekendBonus)}` : "—"}</span>
                  <span className={`text-right font-semibold tabular-nums ${rb.net < 0 ? "text-destructive" : ""}`}>{fmtBRL(rb.net)}</span>
                </div>
              ))}
            </div>

            {/* Raw line items (with manual-adjustment removal) */}
            {entries && entries.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("skala.financial.lineItems")}
                </p>
                {entries.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs">
                    <Badge variant="outline" className="font-normal">{entryTypeLabel(e.type)}</Badge>
                    <span className="text-muted-foreground">{e.restaurantName ?? "—"}</span>
                    {e.notes && <span className="truncate text-muted-foreground/80">· {e.notes}</span>}
                    <span className="flex-1" />
                    <span className={`tabular-nums ${e.amount < 0 ? "text-destructive" : ""}`}>{fmtBRL(e.amount)}</span>
                    {!isClosed && e.type === "manual_adjustment" && (
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => onRemoveEntry(e.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
