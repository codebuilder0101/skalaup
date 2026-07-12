import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeftRight, Loader2, Sun, Moon, Star, Check, X, AlertTriangle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { listAssignments } from "@/lib/skalaup/assignments";
import { listRestaurants } from "@/lib/skalaup/restaurants";
import {
  listSwaps, listEligible, createSwap, respondSwap, decideSwap, cancelSwap,
  type SwapRow, type SwapCandidate, type SwapLists,
} from "@/lib/skalaup/swaps";
import type { Restaurant, ScheduleAssignment } from "@/lib/skalaup/types";

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtTime = (t: string) => (t ? t.slice(0, 5) : "");

export default function SwapsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lng = i18n.language || "pt-BR";
  const isOps = user?.role === "coordinator" || user?.role === "administrator";

  const [lists, setLists] = useState<SwapLists>({});
  const [myShifts, setMyShifts] = useState<ScheduleAssignment[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Request dialog state
  const [dialogShift, setDialogShift] = useState<ScheduleAssignment | null>(null);
  const [candidates, setCandidates] = useState<SwapCandidate[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [ackBonus, setAckBonus] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await listSwaps();
    setLists(data);
    if (!isOps && user) {
      const [{ data: as }, { data: rs }] = await Promise.all([
        listAssignments({ userId: user.id, status: "published" }),
        listRestaurants(),
      ]);
      const today = todayStr();
      setMyShifts(as.filter((a) => a.date.slice(0, 10) >= today));
      setRestaurants(rs);
    }
  }, [isOps, user]);

  useEffect(() => {
    void (async () => { setLoading(true); await reload(); setLoading(false); })();
  }, [reload]);

  const restaurantById = useMemo(() => {
    const m = new Map<string, Restaurant>();
    restaurants.forEach((r) => m.set(r.id, r));
    return m;
  }, [restaurants]);

  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat(lng, { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })
      .format(new Date(`${date.slice(0, 10)}T00:00:00Z`));

  const ShiftIcon = ({ s }: { s: string }) =>
    s === "lunch" ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500" />;

  const statusBadge = (status: SwapRow["status"]) => {
    const tone: Record<string, string> = {
      pending_target: "text-amber-600", pending_coordinator: "text-blue-600",
      approved: "text-emerald-600", rejected: "text-rose-600", cancelled: "text-muted-foreground",
    };
    return <Badge variant="secondary" className={tone[status]}>{t(`skala.swaps.status.${status}`)}</Badge>;
  };

  // ---- open request dialog ----
  const openRequest = async (shift: ScheduleAssignment) => {
    setDialogShift(shift);
    setTargetId(null);
    setAckBonus(false);
    setCandLoading(true);
    const { data, error } = await listEligible(shift.id);
    if (error) toast.error(error.message);
    setCandidates(data);
    setCandLoading(false);
  };

  const submitRequest = async () => {
    if (!dialogShift || !targetId) return;
    if (dialogShift.isWeekendMandatory && !ackBonus) {
      toast.error(t("skala.swaps.bonusAckRequired"));
      return;
    }
    setBusy("request");
    const { error } = await createSwap({
      assignmentId: dialogShift.id, targetUserId: targetId,
      bonusLossAcknowledged: dialogShift.isWeekendMandatory ? ackBonus : undefined,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.swaps.requestSent"));
    setDialogShift(null);
    await reload();
  };

  const act = async (key: string, fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(okMsg);
    await reload();
  };

  // ---- row renderers ----
  const SwapContext = ({ s }: { s: SwapRow }) => (
    <div className="flex items-center gap-2 text-sm">
      <ShiftIcon s={s.shiftType} />
      <span className="font-medium text-foreground">{dateLabel(s.date)}</span>
      <span className="text-muted-foreground">· {fmtTime(s.startTime)}–{fmtTime(s.endTime)}</span>
      <span className="text-muted-foreground truncate">· {s.restaurantName}</span>
      {s.affectsWeekendBonus && <Star className="w-3.5 h-3.5 text-amber-500 fill-current shrink-0" />}
    </div>
  );

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ArrowLeftRight className="w-6 h-6 text-primary" /> {t("skala.swaps.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isOps ? t("skala.swaps.subtitleOps") : t("skala.swaps.subtitleFreelancer")}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("skala.common.loading")}
          </div>
        ) : isOps ? (
          <>
            {/* Coordinator: completed swaps — auto-approved, reversible while upcoming */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground">{t("skala.swaps.pendingApproval")}</h2>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">{t("skala.swaps.recentHint")}</p>
              {(lists.queue ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.swaps.emptyQueue")}</p>
              ) : (
                <div className="space-y-3">
                  {lists.queue!.map((s) => (
                    <div key={s.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
                      <SwapContext s={s} />
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.requesterName} → {s.targetName}
                        {s.affectsWeekendBonus ? ` · ${t("skala.swaps.weekendBonusFlag")}` : ""}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="outline" className="text-destructive" disabled={busy === s.id}
                          onClick={() => act(s.id, () => decideSwap(s.id, false), t("skala.swaps.reproved"))}>
                          <X className="w-4 h-4 mr-1" />{t("skala.swaps.reprovar")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Recent history */}
            {(lists.recent ?? []).length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold text-foreground mb-2">{t("skala.swaps.history")}</h2>
                <div className="space-y-2 opacity-80">
                  {lists.recent!.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm border-b border-border last:border-0 pb-2 last:pb-0">
                      <span className="truncate">{dateLabel(s.date)} · {s.requesterName} → {s.targetName}</span>
                      {statusBadge(s.status)}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        ) : (
          <>
            {/* Incoming requests */}
            {(lists.incoming ?? []).length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold text-foreground mb-2">{t("skala.swaps.incoming")}</h2>
                <div className="space-y-3">
                  {lists.incoming!.map((s) => (
                    <div key={s.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
                      <SwapContext s={s} />
                      <p className="text-xs text-muted-foreground mt-1">{t("skala.swaps.from")}: {s.requesterName}</p>
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" disabled={busy === s.id}
                          onClick={() => act(s.id, () => respondSwap(s.id, true), t("skala.swaps.accepted"))}>
                          <Check className="w-4 h-4 mr-1" />{t("skala.swaps.accept")}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === s.id}
                          onClick={() => act(s.id, () => respondSwap(s.id, false), t("skala.swaps.declined"))}>
                          <X className="w-4 h-4 mr-1" />{t("skala.swaps.decline")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* My shifts → request a swap */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground mb-2">{t("skala.swaps.myShifts")}</h2>
              {myShifts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.swaps.noShifts")}</p>
              ) : (
                <div className="space-y-2">
                  {myShifts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 border-b border-border last:border-0 py-2">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <ShiftIcon s={a.shiftType} />
                        <span className="font-medium text-foreground">{dateLabel(a.date)}</span>
                        <span className="text-muted-foreground truncate">· {restaurantById.get(a.restaurantId)?.name ?? ""}</span>
                        {a.isWeekendMandatory && <Star className="w-3.5 h-3.5 text-amber-500 fill-current shrink-0" />}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => void openRequest(a)}>
                        <ArrowLeftRight className="w-4 h-4 mr-1" />{t("skala.swaps.request")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* My outgoing requests */}
            {(lists.outgoing ?? []).length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold text-foreground mb-2">{t("skala.swaps.outgoing")}</h2>
                <div className="space-y-2">
                  {lists.outgoing!.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 border-b border-border last:border-0 py-2">
                      <div className="min-w-0">
                        <SwapContext s={s} />
                        <p className="text-xs text-muted-foreground mt-0.5">→ {s.targetName}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {statusBadge(s.status)}
                        {s.status === "pending_target" && (
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === s.id}
                            onClick={() => act(s.id, () => cancelSwap(s.id), t("skala.swaps.cancelled"))}>
                            {t("skala.swaps.cancel")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Request swap dialog */}
      <Dialog open={!!dialogShift} onOpenChange={(o) => !o && setDialogShift(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("skala.swaps.requestTitle")}</DialogTitle>
          </DialogHeader>
          {dialogShift && (
            <div className="space-y-4">
              <div className="text-sm flex items-center gap-2">
                <ShiftIcon s={dialogShift.shiftType} />
                {dateLabel(dialogShift.date)} · {restaurantById.get(dialogShift.restaurantId)?.name}
              </div>

              {dialogShift.isWeekendMandatory && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm">
                  <p className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium">
                    <AlertTriangle className="w-4 h-4" />{t("skala.swaps.bonusWarningTitle")}
                  </p>
                  <p className="text-xs text-amber-700/90 dark:text-amber-400/90 mt-1">{t("skala.swaps.bonusWarningBody")}</p>
                  <label className="flex items-center gap-2 mt-2 text-xs text-foreground cursor-pointer">
                    <input type="checkbox" checked={ackBonus} onChange={(e) => setAckBonus(e.target.checked)} />
                    {t("skala.swaps.bonusAck")}
                  </label>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-1.5">{t("skala.swaps.chooseColleague")}</p>
                {candLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> {t("skala.common.loading")}
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">{t("skala.swaps.noCandidates")}</p>
                ) : (
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {candidates.map((c) => (
                      <button key={c.id} type="button"
                        onClick={() => setTargetId(c.id)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm border ${
                          targetId === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
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
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogShift(null)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void submitRequest()} disabled={!targetId || busy === "request"}>
              {t("skala.swaps.sendRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
