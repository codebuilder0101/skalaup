import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Zap, Sun, Moon, Loader2, MapPin, Star, Info } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listOpenVagas, claimVaga, type OpenVaga } from "@/lib/skalaup/vacancies";

const slotKey = (v: OpenVaga) => `${v.cycleId}|${v.restaurantId}|${v.date}|${v.shiftType}`;

export default function VagasPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "pt-BR";
  const [vagas, setVagas] = useState<OpenVaga[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await listOpenVagas();
    if (error) toast.error(error.message);
    setVagas(data);
  }, []);

  useEffect(() => {
    void (async () => { setLoading(true); await reload(); setLoading(false); })();
  }, [reload]);

  const dayLabel = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    return {
      wd: new Intl.DateTimeFormat(lng, { weekday: "short", timeZone: "UTC" }).format(d),
      full: new Intl.DateTimeFormat(lng, { day: "2-digit", month: "short", timeZone: "UTC" }).format(d),
      n: Number(date.slice(8, 10)),
      weekend: [0, 5, 6].includes(d.getUTCDay()),
    };
  };

  const claim = async (v: OpenVaga) => {
    const key = slotKey(v);
    setClaiming(key);
    const { error } = await claimVaga({
      cycleId: v.cycleId, restaurantId: v.restaurantId, date: v.date, shiftType: v.shiftType,
    });
    setClaiming(null);
    if (error) { toast.error(error.message); await reload(); return; }
    toast.success(t("skala.vagas.claimed"));
    await reload();
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
          <div className="pointer-events-none absolute -top-20 -right-12 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative p-5 sm:p-6 flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("skala.vagas.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("skala.vagas.subtitle")}</p>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("skala.vagas.hint")}</span>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />{t("skala.common.loading")}
          </p>
        ) : vagas.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.vagas.empty")}</Card>
        ) : (
          <div className="space-y-2.5">
            {vagas.map((v) => {
              const dl = dayLabel(v.date);
              const key = slotKey(v);
              const busy = claiming === key;
              return (
                <Card key={key} className="p-3 sm:p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      {/* Date */}
                      <div className={`flex w-14 shrink-0 flex-col items-center rounded-xl border py-1.5 ${dl.weekend ? "border-primary/40 bg-primary/5 text-primary" : "border-border bg-muted/40 text-foreground"}`}>
                        <span className="text-[10px] uppercase tracking-wide">{dl.wd}</span>
                        <span className="text-lg font-bold leading-none">{dl.n}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                            {v.shiftType === "lunch"
                              ? <Sun className="h-4 w-4 text-amber-500" />
                              : <Moon className="h-4 w-4 text-indigo-500" />}
                            {t(`skala.scheduleBuilder.shift.${v.shiftType}`)}
                          </span>
                          {v.hasPriority && (
                            <Badge variant="outline" className="gap-1 rounded-full border-primary/40 bg-primary/10 text-primary text-[10px]">
                              <Star className="h-3 w-3" />{t("skala.vagas.priority")}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground truncate">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{v.restaurantName}</span>
                          <span className="text-muted-foreground/60">· {dl.full}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:shrink-0">
                      <Badge variant="secondary" className="rounded-full">
                        {t("skala.vagas.openCount", { count: v.openCount })}
                      </Badge>
                      <Button size="sm" className="rounded-xl shadow-sm shadow-primary/20" disabled={busy} onClick={() => void claim(v)}>
                        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4" />}
                        {busy ? t("skala.vagas.claiming") : t("skala.vagas.claim")}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
