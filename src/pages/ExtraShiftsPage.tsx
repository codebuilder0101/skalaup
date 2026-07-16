import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Zap, Loader2, Sun, Moon, Check, X, Users, Send, Star } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  listExtraShifts, listExtraEligible, requestExtraShift, assignExtraShift,
  openExtraShift, rejectExtraShift, cancelExtraShift, cancelExtraInvite,
  type ExtraShiftRequest, type ExtraShiftCandidate, type ExtraShiftStatus,
} from "@/lib/skalaup/extraShifts";
import type { ShiftType } from "@/lib/skalaup/types";

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ExtraShiftsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lng = i18n.language || "pt-BR";
  const isOps = user?.role === "coordinator" || user?.role === "administrator";
  const isManager = user?.role === "restaurant_manager";

  const [rows, setRows] = useState<ExtraShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // request form (manager)
  const [date, setDate] = useState(todayStr());
  const [shift, setShift] = useState<ShiftType>("lunch");
  const [headcount, setHeadcount] = useState(1);
  const [reason, setReason] = useState("");

  // assign dialog (ops)
  const [assignFor, setAssignFor] = useState<ExtraShiftRequest | null>(null);
  const [candidates, setCandidates] = useState<ExtraShiftCandidate[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data } = await listExtraShifts();
    setRows(data);
  }, []);

  useEffect(() => {
    void (async () => { setLoading(true); await reload(); setLoading(false); })();
  }, [reload]);

  const dateLabel = (d: string) =>
    new Intl.DateTimeFormat(lng, { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })
      .format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

  const ShiftIcon = ({ s }: { s: string }) =>
    s === "lunch" ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500" />;

  // Managers only ever see a coarse status ("Aprovado"/"Pendente"), never who is
  // assigned nor the internal churn. Ops see the granular internal status.
  const statusBadge = (status: ExtraShiftStatus) => {
    if (isManager) {
      const mkey =
        status === "filled" || status === "assigned" ? "approved"
          : status === "rejected" ? "rejected"
            : status === "cancelled" ? "cancelled"
              : "pending";
      const mtone: Record<string, string> = {
        approved: "text-emerald-600", pending: "text-amber-600",
        rejected: "text-rose-600", cancelled: "text-muted-foreground",
      };
      return <Badge variant="secondary" className={mtone[mkey]}>{t(`skala.extraShifts.managerStatus.${mkey}`)}</Badge>;
    }
    const tone: Record<ExtraShiftStatus, string> = {
      pending: "text-amber-600", assigned: "text-emerald-600", opened: "text-blue-600",
      awaiting_accept: "text-blue-600", filled: "text-emerald-600",
      rejected: "text-rose-600", cancelled: "text-muted-foreground",
    };
    return <Badge variant="secondary" className={tone[status]}>{t(`skala.extraShifts.status.${status}`)}</Badge>;
  };

  const act = async (key: string, fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(okMsg);
    await reload();
  };

  const submitRequest = async () => {
    if (!date || date < todayStr()) { toast.error(t("skala.extraShifts.pastDate")); return; }
    // A shift one calendar day out (or sooner) is always under 48h — block early.
    // The exact 48h boundary is enforced server-side in the restaurant's timezone.
    const minLead = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    if (date < minLead) { toast.error(t("skala.extraShifts.leadTimeError")); return; }
    setBusy("request");
    const { error } = await requestExtraShift({ date, shiftType: shift, headcount, reason: reason.trim() || undefined });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.extraShifts.requestSent"));
    setReason("");
    setHeadcount(1);
    await reload();
  };

  const openAssign = async (r: ExtraShiftRequest) => {
    setAssignFor(r);
    setPickedId(null);
    setCandLoading(true);
    const { data, error } = await listExtraEligible(r.id);
    if (error) toast.error(error.message);
    setCandidates(data);
    setCandLoading(false);
  };

  const confirmAssign = async () => {
    if (!assignFor || !pickedId) return;
    const id = assignFor.id;
    setAssignFor(null);
    await act(id, () => assignExtraShift(id, pickedId), t("skala.extraShifts.inviteSent"));
  };

  const RequestRow = ({ r, actions }: { r: ExtraShiftRequest; actions?: React.ReactNode }) => (
    <div className="border-b border-border last:border-0 pb-3 last:pb-0">
      <div className="flex items-center gap-2 text-sm">
        <ShiftIcon s={r.shiftType} />
        <span className="font-medium text-foreground">{dateLabel(r.date)}</span>
        <span className="text-muted-foreground truncate">· {r.restaurantName}</span>
        {r.headcount > 1 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Users className="w-3.5 h-3.5" />{r.headcount}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {r.requestedByName ? `${t("skala.extraShifts.by")}: ${r.requestedByName}` : ""}
        {r.reason ? ` · ${r.reason}` : ""}
      </p>
      {actions && <div className="flex flex-wrap gap-2 mt-2">{actions}</div>}
    </div>
  );

  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" /> {t("skala.extraShifts.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isOps ? t("skala.extraShifts.subtitleOps") : t("skala.extraShifts.subtitleManager")}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("skala.common.loading")}
          </div>
        ) : (
          <>
            {/* Manager: request form */}
            {isManager && (
              <Card className="p-5 space-y-4">
                <h2 className="font-semibold text-foreground">{t("skala.extraShifts.requestTitle")}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("skala.extraShifts.date")}</label>
                    <Input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("skala.extraShifts.shift")}</label>
                    <div className="flex gap-2">
                      {(["lunch", "dinner"] as ShiftType[]).map((s) => (
                        <Button key={s} type="button" variant={shift === s ? "default" : "outline"}
                          size="sm" className="flex-1" onClick={() => setShift(s)}>
                          <ShiftIcon s={s} /><span className="ml-1">{t(`skala.extraShifts.${s}`)}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("skala.extraShifts.headcount")}</label>
                    <Input type="number" min={1} max={20} value={headcount}
                      onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value) || 1))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("skala.extraShifts.reason")}</label>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder={t("skala.extraShifts.reasonPlaceholder")} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => void submitRequest()} disabled={busy === "request"}>
                    <Send className="w-4 h-4 mr-1.5" />{t("skala.extraShifts.send")}
                  </Button>
                </div>
              </Card>
            )}

            {/* Ops: pending queue with actions */}
            {isOps && (
              <Card className="p-5">
                <h2 className="font-semibold text-foreground mb-3">{t("skala.extraShifts.pending")}</h2>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.extraShifts.emptyPending")}</p>
                ) : (
                  <div className="space-y-3">
                    {pending.map((r) => (
                      <RequestRow key={r.id} r={r} actions={<>
                        <Button size="sm" disabled={busy === r.id} onClick={() => void openAssign(r)}>
                          <Users className="w-4 h-4 mr-1" />{t("skala.extraShifts.assign")}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === r.id}
                          onClick={() => act(r.id, () => openExtraShift(r.id), t("skala.extraShifts.opened"))}>
                          <Zap className="w-4 h-4 mr-1" />{t("skala.extraShifts.openVaga")}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === r.id}
                          onClick={() => act(r.id, () => rejectExtraShift(r.id), t("skala.extraShifts.rejected"))}>
                          <X className="w-4 h-4 mr-1" />{t("skala.extraShifts.reject")}
                        </Button>
                      </>} />
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* History / my requests */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground mb-3">
                {isManager ? t("skala.extraShifts.myRequests") : t("skala.extraShifts.history")}
              </h2>
              {(isManager ? rows : history).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.extraShifts.emptyHistory")}</p>
              ) : (
                <div className="space-y-2">
                  {(isManager ? rows : history).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 border-b border-border last:border-0 py-2">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <ShiftIcon s={r.shiftType} />
                        <span className="font-medium text-foreground">{dateLabel(r.date)}</span>
                        <span className="text-muted-foreground truncate">· {r.restaurantName}</span>
                        {isOps && r.status === "awaiting_accept" && r.assignedUserName && (
                          <span className="text-blue-600 truncate">· {r.assignedUserName}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {statusBadge(r.status)}
                        {isManager && r.status === "pending" && (
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === r.id}
                            onClick={() => act(r.id, () => cancelExtraShift(r.id), t("skala.extraShifts.cancelled"))}>
                            {t("skala.extraShifts.cancel")}
                          </Button>
                        )}
                        {isOps && r.status === "awaiting_accept" && (
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === r.id}
                            onClick={() => act(r.id, () => cancelExtraInvite(r.id), t("skala.extraShifts.inviteCancelled"))}>
                            {t("skala.extraShifts.cancelInvite")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>

      {/* Assign dialog */}
      <Dialog open={!!assignFor} onOpenChange={(o) => !o && setAssignFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("skala.extraShifts.assignTitle")}</DialogTitle>
          </DialogHeader>
          {assignFor && (
            <div className="space-y-3">
              <div className="text-sm flex items-center gap-2">
                <ShiftIcon s={assignFor.shiftType} />
                {dateLabel(assignFor.date)} · {assignFor.restaurantName}
              </div>
              {candLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("skala.common.loading")}
                </div>
              ) : candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">{t("skala.extraShifts.noCandidates")}</p>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {candidates.map((c) => (
                    <button key={c.id} type="button" onClick={() => setPickedId(c.id)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm border ${
                        pickedId === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                      }`}>
                      <span>{c.name}</span>
                      <span className="flex items-center gap-1 text-amber-500 text-xs">
                        <Star className="w-3 h-3 fill-current" />{c.score}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignFor(null)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void confirmAssign()} disabled={!pickedId}>
              <Check className="w-4 h-4 mr-1.5" />{t("skala.extraShifts.confirmAssign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
