import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushSupported, pushPermission, enablePush } from "@/lib/skalaup/push";

const DISMISS_KEY = "skalaup-push-nudge-dismissed";

// Dismissible prompt nudging the user to turn on phone push, so schedule alerts and
// the check-in reminder actually reach the phone (client 2026-07-29 — pushes only
// land for devices that opted in). Hidden when push is already granted, unsupported,
// or the user dismissed it. Self-contained; safe to drop at the top of a page.
export function EnablePushBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;              // e.g. iOS Safari not installed as PWA
    if (pushPermission() === "granted") return; // already on
    try { if (localStorage.getItem(DISMISS_KEY) === "1") return; } catch { /* ignore */ }
    setShow(true);
  }, []);

  if (!show) return null;

  const enable = async () => {
    setBusy(true);
    const { ok, error } = await enablePush();
    setBusy(false);
    if (ok) { toast.success(t("skala.push.enabled")); setShow(false); return; }
    if (error === "denied") { toast.error(t("skala.push.deniedToast")); return; }
    if (error === "unsupported") { setShow(false); return; }
    toast.error(t("skala.push.error"));
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3">
      <BellRing className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{t("skala.push.nudgeTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("skala.push.nudgeBody")}</p>
      </div>
      <Button size="sm" className="h-8 shrink-0 rounded-xl" onClick={() => void enable()} disabled={busy}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        {t("skala.push.enable")}
      </Button>
      <button type="button" onClick={dismiss} aria-label={t("skala.common.close")}
        className="shrink-0 text-muted-foreground/60 transition-colors hover:text-muted-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
