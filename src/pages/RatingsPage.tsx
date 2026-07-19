import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Star, Loader2, Check, X, MessageSquareQuote } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { listRatings, approveRating, rejectRating, type PendingRating, type RatingStatus } from "@/lib/skalaup/ratings";
import { getScoreSettings, type RatingType } from "@/lib/skalaup/settings";

const STATUSES: RatingStatus[] = ["pending", "approved", "rejected"];

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`w-4 h-4 ${i < n ? "text-amber-500 fill-current" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );
}

export default function RatingsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";

  const [status, setStatus] = useState<RatingStatus>("pending");
  const [items, setItems] = useState<PendingRating[]>([]);
  const [types, setTypes] = useState<RatingType[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const activeTypes = useMemo(() => types.filter((tp) => tp.active), [types]);

  const load = useCallback(async (st: RatingStatus) => {
    setLoading(true);
    const [{ data: rows, error }, { data: cfg }] = await Promise.all([
      listRatings(st),
      getScoreSettings(),
    ]);
    if (error) toast.error(error.message);
    setItems(rows);
    if (cfg?.ratingTypes) setTypes(cfg.ratingTypes);
    setLoading(false);
  }, []);

  useEffect(() => { void load(status); }, [status, load]);

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(lng, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

  const onApprove = async (r: PendingRating) => {
    const typeId = selected[r.id];
    if (!typeId) { toast.error(t("skala.ratings.pickType")); return; }
    setBusy(r.id);
    const { error } = await approveRating(r.id, typeId);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.ratings.approved"));
    setItems((xs) => xs.filter((x) => x.id !== r.id));
  };

  const onReject = async (r: PendingRating) => {
    setBusy(r.id);
    const { error } = await rejectRating(r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.ratings.rejected"));
    setItems((xs) => xs.filter((x) => x.id !== r.id));
  };

  const typeLabel = (id: string | null) => (id ? types.find((x) => x.id === id)?.label ?? "—" : "—");

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MessageSquareQuote className="w-6 h-6 text-primary" /> {t("skala.ratings.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("skala.ratings.subtitle")}</p>
        </div>

        <div className="flex gap-2">
          {STATUSES.map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
              {t(`skala.ratings.status.${s}`)}
            </Button>
          ))}
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />{t("skala.common.loading")}</p>
        ) : items.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.ratings.empty")}</Card>
        ) : status === "pending" && activeTypes.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">{t("skala.ratings.noTypes")}</Card>
        ) : (
          <div className="space-y-3">
            {items.map((r) => (
              <Card key={r.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{r.freelancerName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Stars n={r.stars} />
                      <span className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span>
                    </div>
                  </div>
                  {status !== "pending" && (
                    <Badge variant={status === "approved" ? "secondary" : "outline"}>
                      {status === "approved" ? typeLabel(r.ratingTypeId) : t("skala.ratings.status.rejected")}
                    </Badge>
                  )}
                </div>
                {r.comment && (
                  <p className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2">“{r.comment}”</p>
                )}
                {status === "pending" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={selected[r.id] ?? ""} onValueChange={(v) => setSelected((m) => ({ ...m, [r.id]: v }))}>
                      <SelectTrigger className="w-56"><SelectValue placeholder={t("skala.ratings.pickTypePlaceholder")} /></SelectTrigger>
                      <SelectContent>
                        {activeTypes.map((tp) => (
                          <SelectItem key={tp.id} value={tp.id}>
                            {tp.label} ({tp.points >= 0 ? `+${tp.points}` : tp.points})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => void onApprove(r)} disabled={busy === r.id}>
                      <Check className="w-4 h-4 mr-1" />{t("skala.ratings.approve")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void onReject(r)} disabled={busy === r.id}>
                      <X className="w-4 h-4 mr-1" />{t("skala.ratings.reject")}
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
