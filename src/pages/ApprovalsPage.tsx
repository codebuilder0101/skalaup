import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { UserCheck, Check, X, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type PendingUser = {
  id: string; name: string; email: string; role: string; status: string; createdAt: string;
};

const FILTERS = ["pending", "active", "rejected", "all"] as const;
type Filter = (typeof FILTERS)[number];

export default function ApprovalsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("pending");
  const [items, setItems] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.get<PendingUser[]>(`/users?status=${filter}`));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      await api.put(`/users/${id}/${action}`, {});
      toast.success(t(action === "approve" ? "skala.approvals.approved" : "skala.approvals.rejected"));
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const roleLabel = (r: string) =>
    r === "administrator" ? t("skala.roles.administrator")
      : r === "coordinator" ? t("skala.roles.coordinator")
        : r === "restaurant_manager" ? t("skala.roles.restaurantManager")
          : r === "visitor" ? t("skala.roles.visitor")
            : t("skala.roles.freelancer");

  const statusBadge = (s: string) => {
    const variant = s === "active" ? "default" : s === "pending" ? "secondary" : "destructive";
    const label = s === "active" ? t("skala.approvals.statusActive")
      : s === "pending" ? t("skala.approvals.statusPending")
        : s === "rejected" ? t("skala.approvals.statusRejected") : s;
    return <Badge variant={variant as "default" | "secondary" | "destructive"}>{label}</Badge>;
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" /> {t("skala.approvals.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("skala.approvals.subtitle")}</p>
        </div>

        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} onClick={() => setFilter(f)}>
              {t(`skala.approvals.filter.${f}`)}
            </Button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("skala.common.loading")}</p>
        ) : items.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">
            <UserCheck className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
            {t("skala.approvals.empty")}
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map((u) => (
              <Card key={u.id} className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                  {u.name.trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                <Badge variant="outline">{roleLabel(u.role)}</Badge>
                {statusBadge(u.status)}
                {u.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busyId === u.id} onClick={() => void act(u.id, "approve")}>
                      <Check className="w-4 h-4 mr-1" />{t("skala.approvals.approve")}
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" disabled={busyId === u.id}
                      onClick={() => void act(u.id, "reject")}>
                      <X className="w-4 h-4 mr-1" />{t("skala.approvals.reject")}
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
