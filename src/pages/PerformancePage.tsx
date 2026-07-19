import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Star, Loader2, TrendingUp, TrendingDown, QrCode, Download, Printer } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getFreelancer } from "@/lib/skalaup/freelancers";
import { listScoreEvents } from "@/lib/skalaup/score";
import type { ScoreEvent, ScoreEventType } from "@/lib/skalaup/types";

const MAX_STARS = 5;

export default function PerformancePage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lng = i18n.language || "pt-BR";

  const [score, setScore] = useState(0);
  const [level, setLevel] = useState<number | null>(null);
  const [events, setEvents] = useState<ScoreEvent[]>([]);
  const [ratingToken, setRatingToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const qrBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      if (!user) return;
      setLoading(true);
      const [{ data: me }, { data: evs, error }] = await Promise.all([
        getFreelancer(user.id),
        listScoreEvents(user.id),
      ]);
      if (error) toast.error(error.message);
      setScore(Number(me?.profile?.currentScore ?? 0));
      setLevel(me?.profile?.currentLevel ?? null);
      setRatingToken(me?.profile?.publicRatingToken ?? null);
      // pg returns numeric columns as strings (e.g. "-8.00") — coerce to real numbers.
      setEvents(evs.filter((e) => !e.isVoided).map((e) => ({ ...e, points: Number(e.points) })));
      setLoading(false);
    })();
  }, [user]);

  // The freelancer's own customer-rating QR (client 2026-07-19): they can show or
  // print it so a customer can rate their service. Same /rate/:token page the admin uses.
  const ratingUrl = ratingToken ? `${window.location.origin}/rate/${ratingToken}` : "";

  const downloadQr = () => {
    const canvas = qrBoxRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${user?.name ?? "avaliacao"}.png`;
    a.click();
  };

  const printQr = () => {
    const canvas = qrBoxRef.current?.querySelector("canvas");
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(
      `<html><head><title>QR ${user?.name ?? ""}</title></head>` +
      `<body style="text-align:center;font-family:sans-serif;padding:24px">` +
      `<h2 style="margin:0 0 4px">${user?.name ?? ""}</h2>` +
      `<p style="color:#666;margin:0 0 16px">${t("skala.performance.qr.printCaption")}</p>` +
      `<img src="${dataUrl}" style="width:280px;height:280px"/>` +
      `</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const eventLabel = (type: ScoreEventType) => t(`skala.score.events.${type}`);
  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(lng, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

  // Split positive/negative counts for a quick summary (spec §9 — own score only).
  const summary = useMemo(() => {
    let pos = 0, neg = 0;
    for (const e of events) {
      if (e.points > 0) pos += e.points;
      else if (e.points < 0) neg += e.points;
    }
    return { pos, neg };
  }, [events]);

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Star className="w-6 h-6 text-amber-500" /> {t("skala.performance.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("skala.performance.subtitle")}</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("skala.common.loading")}
          </div>
        ) : (
          <>
            {/* Score + level summary */}
            <Card className="p-6">
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-center">
                  <p className="text-4xl font-bold text-amber-500 leading-none">{score}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("skala.performance.accumulated")}</p>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: MAX_STARS }, (_, i) => (
                      <Star
                        key={i}
                        className={`w-6 h-6 ${level != null && i < level ? "text-amber-500 fill-current" : "text-muted-foreground/30"}`}
                      />
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5">
                    {level != null
                      ? t("skala.performance.levelName", { level })
                      : t("skala.performance.noLevel")}
                  </p>
                </div>
                <div className="flex gap-4 text-sm">
                  <span className="flex items-center gap-1 text-emerald-600">
                    <TrendingUp className="w-4 h-4" />+{summary.pos}
                  </span>
                  <span className="flex items-center gap-1 text-rose-600">
                    <TrendingDown className="w-4 h-4" />{summary.neg}
                  </span>
                </div>
              </div>
            </Card>

            {/* Own customer-rating QR (client 2026-07-19) — freelancer shows/prints it. */}
            {ratingUrl && (
              <Card className="p-5">
                <h2 className="font-semibold text-foreground mb-1 flex items-center gap-2">
                  <QrCode className="w-4 h-4" /> {t("skala.performance.qr.title")}
                </h2>
                <p className="text-sm text-muted-foreground mb-4">{t("skala.performance.qr.hint")}</p>
                <div ref={qrBoxRef} className="flex flex-col items-center gap-3">
                  <div className="rounded-xl bg-white p-3">
                    <QRCodeCanvas value={ratingUrl} size={200} includeMargin level="M" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={downloadQr}>
                      <Download className="w-4 h-4 mr-1.5" />{t("skala.performance.qr.download")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={printQr}>
                      <Printer className="w-4 h-4 mr-1.5" />{t("skala.performance.qr.print")}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Event history (spec §9.1) */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground mb-2">{t("skala.performance.history")}</h2>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">{t("skala.performance.empty")}</p>
              ) : (
                <div>
                  {events.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{eventLabel(e.eventType)}</p>
                        {e.eventType === "manual_adjustment" && e.notes && (
                          <p className="text-xs text-muted-foreground truncate">{e.notes}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{fmtDate(e.occurredOn)}</p>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ${e.points >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {e.points > 0 ? `+${e.points}` : e.points}
                      </span>
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
