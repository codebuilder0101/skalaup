import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MessageSquare, Loader2, Star, Check, X, Plus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import {
  listFeedback, listFeedbackCandidates, submitFeedback, validateFeedback,
  rejectFeedback, getCoverage,
  type FeedbackLists, type FeedbackRequestRow, type FeedbackCandidate, type CoverageRow,
} from "@/lib/skalaup/feedback";
import type { FeedbackCategory } from "@/lib/skalaup/types";

const CATEGORIES: FeedbackCategory[] = ["fundamentos", "proatividade", "encantamento", "extraordinario"];
const CATEGORY_PTS: Record<FeedbackCategory, number> = {
  fundamentos: 1, proatividade: 2, encantamento: 3, extraordinario: 5,
};

export default function FeedbackPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOps = user?.role === "coordinator" || user?.role === "administrator";

  const [lists, setLists] = useState<FeedbackLists>({});
  const [candidates, setCandidates] = useState<FeedbackCandidate[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Submit dialog
  const [formOpen, setFormOpen] = useState(false);
  const [formTarget, setFormTarget] = useState<{ restaurantId: string; freelancerUserId: string; name: string; assignmentId?: string | null; requestId?: string | null } | null>(null);
  const [stars, setStars] = useState(0);
  const [justification, setJustification] = useState("");

  // Coordinator: per-feedback chosen category before validating
  const [cat, setCat] = useState<Record<string, FeedbackCategory>>({});

  const reload = useCallback(async () => {
    const { data } = await listFeedback();
    setLists(data);
    if (isOps) {
      const { data: cov } = await getCoverage();
      setCoverage(cov);
    } else if (user?.role === "restaurant_manager") {
      const { data: cand } = await listFeedbackCandidates();
      setCandidates(cand);
    }
  }, [isOps, user]);

  useEffect(() => {
    void (async () => { setLoading(true); await reload(); setLoading(false); })();
  }, [reload]);

  const candidateGroups = useMemo(() => {
    const m = new Map<string, FeedbackCandidate[]>();
    candidates.forEach((c) => {
      const k = c.restaurantName ?? c.restaurantId;
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    });
    return [...m.entries()];
  }, [candidates]);

  const openForm = (target: typeof formTarget) => {
    setFormTarget(target);
    setStars(0);
    setJustification("");
    setFormOpen(true);
  };

  const openFromRequest = (r: FeedbackRequestRow) =>
    openForm({
      restaurantId: r.restaurantId, freelancerUserId: r.freelancerUserId,
      name: r.freelancerName ?? "", assignmentId: r.assignmentId, requestId: r.id,
    });

  const submit = async () => {
    if (!formTarget) return;
    if (stars < 1) { toast.error(t("skala.feedback.starsRequired")); return; }
    if (!justification.trim()) { toast.error(t("skala.feedback.justificationRequired")); return; }
    setBusy("submit");
    const { error } = await submitFeedback({
      restaurantId: formTarget.restaurantId, freelancerUserId: formTarget.freelancerUserId,
      stars, justification: justification.trim(),
      assignmentId: formTarget.assignmentId ?? null, requestId: formTarget.requestId ?? null,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.feedback.submitted"));
    setFormOpen(false);
    await reload();
  };

  const validate = async (id: string) => {
    const c = cat[id];
    if (!c) { toast.error(t("skala.feedback.pickCategory")); return; }
    setBusy(id);
    const { error } = await validateFeedback(id, c);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.feedback.validated"));
    await reload();
  };

  const reject = async (id: string) => {
    setBusy(id);
    const { error } = await rejectFeedback(id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.feedback.rejected"));
    await reload();
  };

  const Stars = ({ n, interactive = false }: { n: number; interactive?: boolean }) => (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <button key={i} type="button" disabled={!interactive}
          onClick={interactive ? () => setStars(i + 1) : undefined}
          className={interactive ? "cursor-pointer" : "cursor-default"}>
          <Star className={`w-5 h-5 ${i < n ? "text-amber-500 fill-current" : "text-muted-foreground/30"}`} />
        </button>
      ))}
    </div>
  );

  const statusBadge = (s: string) => {
    const tone: Record<string, string> = {
      pending_validation: "text-amber-600", validated: "text-emerald-600", rejected: "text-rose-600",
    };
    return <Badge variant="secondary" className={tone[s]}>{t(`skala.feedback.status.${s}`)}</Badge>;
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-primary" /> {t("skala.feedback.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isOps ? t("skala.feedback.subtitleOps") : t("skala.feedback.subtitleManager")}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("skala.common.loading")}
          </div>
        ) : isOps ? (
          <>
            {/* Validation queue */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground mb-2">{t("skala.feedback.validationQueue")}</h2>
              {(lists.queue ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.feedback.emptyQueue")}</p>
              ) : (
                <div className="space-y-4">
                  {lists.queue!.map((f) => (
                    <div key={f.id} className="border-b border-border last:border-0 pb-4 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground text-sm">{f.freelancerName}</span>
                        <Stars n={f.stars} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {f.restaurantName} · {f.managerName}
                      </p>
                      <p className="text-sm text-foreground mt-1.5 bg-muted/40 rounded p-2">{f.justification}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Select value={cat[f.id] ?? ""} onValueChange={(v) => setCat((p) => ({ ...p, [f.id]: v as FeedbackCategory }))}>
                          <SelectTrigger className="w-56"><SelectValue placeholder={t("skala.feedback.chooseCategory")} /></SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {t(`skala.feedback.category.${c}`)} (+{CATEGORY_PTS[c]})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" disabled={busy === f.id} onClick={() => void validate(f.id)}>
                          <Check className="w-4 h-4 mr-1" />{t("skala.feedback.validate")}
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive" disabled={busy === f.id}
                          onClick={() => void reject(f.id)}>
                          <X className="w-4 h-4 mr-1" />{t("skala.feedback.reject")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 40% coverage dashboard */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground mb-2">{t("skala.feedback.coverage")}</h2>
              {coverage.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.feedback.noCoverage")}</p>
              ) : (
                <div className="space-y-1.5">
                  {coverage.map((c) => {
                    const ok = c.received >= c.target;
                    return (
                      <div key={c.userId} className="flex items-center justify-between gap-2 text-sm border-b border-border last:border-0 py-1.5">
                        <span className="truncate">{c.name}</span>
                        <span className={`text-xs font-medium ${ok ? "text-emerald-600" : "text-amber-600"}`}>
                          {c.received}/{c.target} ({c.shifts} {t("skala.feedback.shifts")})
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        ) : (
          <>
            {/* Manager: suggested feedback requests (40% rule) */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground mb-2">{t("skala.feedback.toGive")}</h2>
              {(lists.toGive ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.feedback.noRequests")}</p>
              ) : (
                <div className="space-y-2">
                  {lists.toGive!.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 border-b border-border last:border-0 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.freelancerName}</p>
                        <p className="text-xs text-muted-foreground">{r.restaurantName}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => openFromRequest(r)}>
                        {t("skala.feedback.giveFeedback")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Manager: ad-hoc feedback */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-foreground">{t("skala.feedback.adHoc")}</h2>
              </div>
              {candidateGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.feedback.noCandidates")}</p>
              ) : (
                <div className="space-y-3">
                  {candidateGroups.map(([rest, cands]) => (
                    <div key={rest}>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{rest}</p>
                      <div className="flex flex-wrap gap-2">
                        {cands.map((c) => (
                          <Button key={c.freelancerUserId} size="sm" variant="outline"
                            onClick={() => openForm({ restaurantId: c.restaurantId, freelancerUserId: c.freelancerUserId, name: c.freelancerName ?? "" })}>
                            <Plus className="w-3.5 h-3.5 mr-1" />{c.freelancerName}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Manager: submitted history */}
            {(lists.submitted ?? []).length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold text-foreground mb-2">{t("skala.feedback.submittedHistory")}</h2>
                <div className="space-y-2">
                  {lists.submitted!.map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2 border-b border-border last:border-0 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{f.freelancerName}</p>
                        <div className="flex items-center gap-2"><Stars n={f.stars} /></div>
                      </div>
                      {statusBadge(f.status)}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Submit feedback dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("skala.feedback.formTitle", { name: formTarget?.name ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1.5">{t("skala.feedback.rating")}</p>
              <Stars n={stars} interactive />
            </div>
            <div>
              <p className="text-sm font-medium mb-1.5">{t("skala.feedback.justification")}</p>
              <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={4}
                placeholder={t("skala.feedback.justificationPlaceholder")} />
              <p className="text-xs text-muted-foreground mt-1">{t("skala.feedback.justificationHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void submit()} disabled={busy === "submit"}>{t("skala.feedback.send")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
