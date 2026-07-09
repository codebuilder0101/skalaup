import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Settings2, Lock, Unlock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  setCycleStatus, listReopens, addReopen, removeReopen, type ReopenException,
} from "@/lib/skalaup/availability";
import { listFreelancers } from "@/lib/skalaup/freelancers";
import type { AvailabilityCycle, Restaurant } from "@/lib/skalaup/types";

// Coordinator control to close / reopen an availability cycle, including the
// granular reopen for one restaurant or one freelancer (§3.1).
export function CycleControl({
  cycle, restaurants, onChanged,
}: {
  cycle: AvailabilityCycle;
  restaurants: Restaurant[];
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reopens, setReopens] = useState<ReopenException[]>([]);
  const [freelancers, setFreelancers] = useState<{ id: string; name: string }[]>([]);
  const [targetType, setTargetType] = useState<"restaurant" | "user">("restaurant");
  const [targetId, setTargetId] = useState("");

  const isOpen = cycle.status === "open";

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [{ data: rs }, { data: fs }] = await Promise.all([
        listReopens(cycle.id),
        listFreelancers(),
      ]);
      setReopens(rs);
      setFreelancers(fs.map((f) => ({ id: f.id, name: f.name })));
    })();
  }, [open, cycle.id]);

  const reload = async () => {
    const { data } = await listReopens(cycle.id);
    setReopens(data);
    await onChanged();
  };

  const setStatus = async (status: "open" | "closed") => {
    setBusy(true);
    const { error } = await setCycleStatus(cycle.id, status);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t(status === "open" ? "skala.cycle.reopenedAll" : "skala.cycle.closed"));
    await onChanged();
  };

  const addException = async () => {
    if (!targetId) { toast.error(t("skala.cycle.pickTarget")); return; }
    setBusy(true);
    const { error } = await addReopen(
      cycle.id,
      targetType === "restaurant" ? { restaurantId: targetId } : { userId: targetId },
    );
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setTargetId("");
    toast.success(t("skala.cycle.exceptionAdded"));
    await reload();
  };

  const remove = async (id: string) => {
    const { error } = await removeReopen(id);
    if (error) { toast.error(error.message); return; }
    await reload();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-xl gap-1.5">
          <Settings2 className="h-4 w-4" />{t("skala.cycle.manage")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b border-border">
          <p className="text-sm font-semibold">{t("skala.cycle.title")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t(`skala.scheduleBuilder.cycleStatus.${cycle.status}`)}
          </p>
        </div>

        {/* Whole-cycle open/close */}
        <div className="p-3 border-b border-border">
          {isOpen ? (
            <Button variant="outline" size="sm" className="w-full" onClick={() => void setStatus("closed")} disabled={busy}>
              <Lock className="h-3.5 w-3.5 mr-1.5" />{t("skala.cycle.close")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => void setStatus("open")} disabled={busy}>
              <Unlock className="h-3.5 w-3.5 mr-1.5" />{t("skala.cycle.reopenAll")}
            </Button>
          )}
        </div>

        {/* Granular reopen — only meaningful while the cycle is not fully open */}
        {!isOpen && (
          <div className="p-3 border-b border-border space-y-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("skala.cycle.reopenFor")}
            </Label>
            <div className="flex gap-1.5">
              <Select value={targetType} onValueChange={(v) => { setTargetType(v as "restaurant" | "user"); setTargetId(""); }}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="restaurant">{t("skala.cycle.client")}</SelectItem>
                  <SelectItem value="user">{t("skala.cycle.freelancer")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder={t("skala.cycle.select")} /></SelectTrigger>
                <SelectContent>
                  {(targetType === "restaurant" ? restaurants : freelancers).map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="w-full h-8" onClick={() => void addException()} disabled={busy}>
              <Plus className="h-3.5 w-3.5 mr-1" />{t("skala.cycle.reopen")}
            </Button>
          </div>
        )}

        {/* Existing exceptions */}
        {reopens.length > 0 && (
          <div className="p-3 space-y-1 max-h-48 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              {t("skala.cycle.activeExceptions")} ({reopens.length})
            </p>
            {reopens.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {r.restaurantName ?? r.userName}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {r.restaurantId ? t("skala.cycle.client") : t("skala.cycle.freelancer")}
                  </span>
                </span>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => void remove(r.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
