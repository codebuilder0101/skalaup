import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ShieldAlert, Sun, Moon, Loader2, Ban, Pencil, Undo2, AlertTriangle,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LatenessBadge, NoShowBadge, fmtTime } from "@/components/attendance/StatusBadges";
import { listRestaurants } from "@/lib/skalaup/restaurants";
import {
  listAttendance, listPendingAbsences, markNoShow, undoNoShow, editAttendance, decideAbsence,
} from "@/lib/skalaup/attendance";
import type {
  AttendanceShift, PendingAbsence, Restaurant, ShiftType, AbsenceType,
} from "@/lib/skalaup/types";

const todayStr = () => new Date().toISOString().slice(0, 10);
const SHIFT_ICON: Record<ShiftType, typeof Sun> = { lunch: Sun, dinner: Moon };

// ISO <-> <input type="datetime-local"> (local wall-clock) conversion.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function AttendancePage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [date, setDate] = useState(todayStr());
  const [restaurantId, setRestaurantId] = useState<string>("all");
  const [shifts, setShifts] = useState<AttendanceShift[]>([]);
  const [pending, setPending] = useState<PendingAbsence[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // dialog state
  const [noShowTarget, setNoShowTarget] = useState<AttendanceShift | null>(null);
  const [nsType, setNsType] = useState<AbsenceType>("no_show_unjustified");
  const [nsJustification, setNsJustification] = useState("");
  const [nsCertificate, setNsCertificate] = useState("");

  const [editTarget, setEditTarget] = useState<AttendanceShift | null>(null);
  const [edCheckin, setEdCheckin] = useState("");
  const [edCheckout, setEdCheckout] = useState("");
  const [edReason, setEdReason] = useState("");

  useEffect(() => {
    void (async () => {
      const { data } = await listRestaurants({ activeOnly: true });
      setRestaurants(data);
    })();
  }, []);

  const reload = useCallback(async () => {
    const [{ data: rows, error }, { data: pend }] = await Promise.all([
      listAttendance({ date, restaurantId: restaurantId === "all" ? undefined : restaurantId }),
      listPendingAbsences(),
    ]);
    if (error) toast.error(error.message);
    else setShifts(rows);
    setPending(pend);
  }, [date, restaurantId]);

  useEffect(() => {
    void (async () => { setLoading(true); await reload(); setLoading(false); })();
  }, [reload]);

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

  // ---- actions ----
  const openNoShow = (s: AttendanceShift) => {
    setNoShowTarget(s);
    setNsType(s.absenceType ?? "no_show_unjustified");
    setNsJustification(s.justificationText ?? "");
    setNsCertificate(s.certificateUrl ?? "");
  };

  const submitNoShow = async () => {
    if (!noShowTarget) return;
    setBusy(noShowTarget.assignmentId);
    const { error } = await markNoShow({
      assignmentId: noShowTarget.assignmentId,
      type: nsType,
      justificationText: nsJustification.trim() || null,
      certificateUrl: nsCertificate.trim() || null,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setNoShowTarget(null);
    toast.success(t("skala.attendance.toast.marked"));
    await reload();
  };

  const onUndoNoShow = async (s: AttendanceShift) => {
    setBusy(s.assignmentId);
    const { error } = await undoNoShow(s.assignmentId);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.attendance.toast.undone"));
    await reload();
  };

  const openEdit = (s: AttendanceShift) => {
    setEditTarget(s);
    setEdCheckin(toLocalInput(s.checkinAt));
    setEdCheckout(toLocalInput(s.checkoutAt));
    setEdReason(s.justificationText ?? "");
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    setBusy(editTarget.assignmentId);
    const { error } = await editAttendance(editTarget.assignmentId, {
      checkinAt: fromLocalInput(edCheckin),
      checkoutAt: fromLocalInput(edCheckout),
      reason: edReason.trim() || null,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setEditTarget(null);
    toast.success(t("skala.attendance.toast.edited"));
    await reload();
  };

  const decide = async (a: PendingAbsence, decision: "forgive" | "cancel_remaining") => {
    setBusy(a.absenceId);
    const { data, error } = await decideAbsence(a.absenceId, decision);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    if (decision === "cancel_remaining") toast.success(t("skala.attendance.toast.cancelled", { n: data?.cancelledCount ?? 0 }));
    else toast.success(t("skala.attendance.toast.forgiven"));
    await reload();
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        {/* Header + filters */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
          <div className="pointer-events-none absolute -top-20 -right-12 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("skala.attendance.title")}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t("skala.attendance.subtitle")}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("skala.attendance.date")}</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("skala.attendance.restaurant")}</Label>
                <Select value={restaurantId} onValueChange={setRestaurantId}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("skala.attendance.allRestaurants")}</SelectItem>
                    {restaurants.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Pending furo decisions (§5) */}
        {pending.length > 0 && (
          <Card className="border-amber-300/60 bg-amber-50/60 p-4 dark:bg-amber-500/5">
            <div className="mb-3 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t("skala.attendance.pending.title")}</h2>
                <p className="text-xs text-amber-700/80 dark:text-amber-300/70">{t("skala.attendance.pending.desc")}</p>
              </div>
            </div>
            <ul className="space-y-2">
              {pending.map((a) => (
                <li key={a.absenceId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200/70 bg-card px-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium text-foreground">{a.freelancerName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {a.restaurantName} · {a.date} · {t(`skala.scheduleBuilder.shift.${a.shiftType}`)}
                    </span>
                    <Badge variant="outline" className="ml-2 rounded-full border-red-300/60 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300">
                      {t("skala.attendance.pending.occurrence", { n: a.occurrenceInMonth ?? 2 })}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={busy === a.absenceId} onClick={() => void decide(a, "forgive")}>
                      {t("skala.attendance.pending.forgive")}
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy === a.absenceId} onClick={() => void decide(a, "cancel_remaining")}>
                      {busy === a.absenceId ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {t("skala.attendance.pending.cancelRemaining")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Shifts board */}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("skala.common.loading")}</p>
        ) : groups.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.attendance.noShifts")}</Card>
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
                    return (
                      <li key={s.assignmentId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Icon className={`h-4 w-4 shrink-0 ${s.shiftType === "lunch" ? "text-amber-500" : "text-indigo-500"}`} />
                          <div>
                            <p className="text-sm font-medium text-foreground">{s.freelancerName}</p>
                            <p className="text-xs text-muted-foreground">
                              {t(`skala.scheduleBuilder.shift.${s.shiftType}`)} · {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
                              {s.checkinAt && <> · {fmtTime(s.checkinAt, lng)} → {fmtTime(s.checkoutAt, lng)}</>}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {s.noShow ? (
                            <>
                              <NoShowBadge />
                              {s.absenceType === "justified" && (
                                <Badge variant="outline" className="rounded-full border-success/30 bg-success/10 text-success">{t("skala.attendance.markJustified")}</Badge>
                              )}
                              <Button size="sm" variant="ghost" disabled={busy === s.assignmentId} onClick={() => void onUndoNoShow(s)}>
                                <Undo2 className="h-4 w-4" />{t("skala.attendance.undoNoShow")}
                              </Button>
                            </>
                          ) : (
                            <>
                              {s.checkinAt
                                ? <LatenessBadge category={s.latenessCategory} minutes={s.latenessMinutes} />
                                : <span className="text-xs text-muted-foreground">{t("skala.attendance.notCheckedIn")}</span>}
                              {s.editedByCoordinator && (
                                <Badge variant="outline" className="rounded-full border-muted-foreground/30 bg-muted text-muted-foreground">{t("skala.attendance.editedBadge")}</Badge>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                                <Pencil className="h-4 w-4" />{t("skala.attendance.editTimes")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openNoShow(s)}>
                                <Ban className="h-4 w-4" />{t("skala.attendance.noShowMark")}
                              </Button>
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

      {/* No-show dialog */}
      <Dialog open={!!noShowTarget} onOpenChange={(o) => !o && setNoShowTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("skala.attendance.markDialogTitle")}</DialogTitle>
            <DialogDescription>{t("skala.attendance.markDialogDesc")}</DialogDescription>
          </DialogHeader>
          {noShowTarget && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{noShowTarget.freelancerName}</span>
                {" · "}{noShowTarget.restaurantName} · {noShowTarget.date} · {t(`skala.scheduleBuilder.shift.${noShowTarget.shiftType}`)}
              </p>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("skala.attendance.type")}</Label>
                <Select value={nsType} onValueChange={(v) => setNsType(v as AbsenceType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no_show_unjustified">{t("skala.attendance.markUnjustified")}</SelectItem>
                    <SelectItem value="justified">{t("skala.attendance.markJustified")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("skala.attendance.justificationText")}</Label>
                <Textarea value={nsJustification} onChange={(e) => setNsJustification(e.target.value)} rows={2} />
              </div>
              {nsType === "justified" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("skala.attendance.certificateUrl")}</Label>
                  <Input value={nsCertificate} onChange={(e) => setNsCertificate(e.target.value)} placeholder="https://…" />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoShowTarget(null)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void submitNoShow()} disabled={busy === noShowTarget?.assignmentId}>
              {busy === noShowTarget?.assignmentId ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("skala.common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit times dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("skala.attendance.editDialogTitle")}</DialogTitle>
            <DialogDescription>{t("skala.attendance.editDialogDesc")}</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{editTarget.freelancerName}</span>
                {" · "}{editTarget.restaurantName} · {editTarget.date} · {t(`skala.scheduleBuilder.shift.${editTarget.shiftType}`)}
              </p>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("skala.attendance.checkinTime")}</Label>
                <div className="flex gap-2">
                  <Input type="datetime-local" value={edCheckin} onChange={(e) => setEdCheckin(e.target.value)} />
                  {edCheckin && <Button variant="outline" size="sm" onClick={() => setEdCheckin("")}>{t("skala.attendance.clearTime")}</Button>}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("skala.attendance.checkoutTime")}</Label>
                <div className="flex gap-2">
                  <Input type="datetime-local" value={edCheckout} onChange={(e) => setEdCheckout(e.target.value)} />
                  {edCheckout && <Button variant="outline" size="sm" onClick={() => setEdCheckout("")}>{t("skala.attendance.clearTime")}</Button>}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("skala.attendance.reason")}</Label>
                <Input value={edReason} onChange={(e) => setEdReason(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void submitEdit()} disabled={busy === editTarget?.assignmentId}>
              {busy === editTarget?.assignmentId ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("skala.common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
