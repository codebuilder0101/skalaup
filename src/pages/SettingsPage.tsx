import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Settings, Globe, Star, Loader2, Save, Bell, BellOff } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  SUPPORTED_LANGUAGES, setStoredLanguage, type SupportedLanguage,
} from "@/i18n/config";
import { getScoreSettings, saveScoreSettings, type ScoreSettings } from "@/lib/skalaup/settings";
import { pushSupported, pushPermission, isPushSubscribed, enablePush, disablePush } from "@/lib/skalaup/push";

// Enable/disable web push on this device (R13).
function PushCard() {
  const { t } = useTranslation();
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(pushSupported());
    setDenied(pushPermission() === "denied");
    void isPushSubscribed().then(setSubscribed);
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
        toast.success(t("skala.settings.push.disabled"));
      } else {
        const r = await enablePush();
        if (r.ok) { setSubscribed(true); toast.success(t("skala.settings.push.enabled")); }
        else if (r.error === "denied") { setDenied(true); toast.error(t("skala.settings.push.deniedToast")); }
        else if (r.error === "unsupported") { setSupported(false); }
        else { toast.error(t("skala.settings.push.error")); }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card rounded-lg p-6 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Bell className="w-4 h-4" /> {t("skala.settings.push.title")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">{t("skala.settings.push.subtitle")}</p>
      </div>
      {!supported ? (
        <p className="text-sm text-muted-foreground">{t("skala.settings.push.unsupported")}</p>
      ) : denied && !subscribed ? (
        <p className="text-sm text-amber-600">{t("skala.settings.push.deniedHint")}</p>
      ) : (
        <Button variant={subscribed ? "outline" : "default"} onClick={() => void toggle()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            : subscribed ? <BellOff className="w-4 h-4 mr-1.5" /> : <Bell className="w-4 h-4 mr-1.5" />}
          {subscribed ? t("skala.settings.push.disable") : t("skala.settings.push.enable")}
        </Button>
      )}
    </div>
  );
}

// Point fields grouped for the editor. Keys must match server event types.
const POINT_GROUPS: { titleKey: string; keys: string[] }[] = [
  { titleKey: "goals", keys: ["flexible_availability", "target_10_shifts", "furo_covered"] },
  { titleKey: "engagement", keys: ["meeting", "online_training", "innovation_video", "charity_event", "inperson_training"] },
  { titleKey: "feedback", keys: ["feedback_fundamentos", "feedback_proatividade", "feedback_encantamento", "feedback_extraordinario"] },
  { titleKey: "penalties", keys: ["late_light", "late_moderate", "late_severe", "late_critical", "no_show_unjustified"] },
  { titleKey: "swaps", keys: ["swap_requested", "swap_accepted"] },
];

function ScoreConfigCard() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<ScoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getScoreSettings().then(({ data, error }) => {
      if (error) toast.error(error.message);
      setCfg(data);
      setLoading(false);
    });
  }, []);

  const setPoint = (key: string, v: string) =>
    setCfg((c) => (c ? { ...c, points: { ...c.points, [key]: v === "" || v === "-" ? 0 : Number(v) } } : c));
  const setCutoff = (i: number, v: string) =>
    setCfg((c) => {
      if (!c) return c;
      const next = [...c.starCutoffs];
      next[i] = Number(v) || 0;
      return { ...c, starCutoffs: next };
    });

  const save = async () => {
    if (!cfg) return;
    // Guard: cutoffs must be strictly ascending (server enforces too, but fail fast).
    for (let i = 1; i < cfg.starCutoffs.length; i++) {
      if (cfg.starCutoffs[i] <= cfg.starCutoffs[i - 1]) {
        toast.error(t("skala.settings.score.cutoffOrderError"));
        return;
      }
    }
    setSaving(true);
    const { data, error } = await saveScoreSettings(cfg);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (data) setCfg(data);
    toast.success(t("skala.settings.score.saved"));
  };

  if (loading) {
    return (
      <div className="glass-card rounded-lg p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {t("skala.common.loading")}
      </div>
    );
  }
  if (!cfg) return null;

  return (
    <div className="glass-card rounded-lg p-6 space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Star className="w-4 h-4" /> {t("skala.settings.score.title")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">{t("skala.settings.score.subtitle")}</p>
      </div>

      {/* Star level cutoffs */}
      <div>
        <Label className="text-sm font-medium">{t("skala.settings.score.starTitle")}</Label>
        <p className="text-xs text-muted-foreground mb-2">{t("skala.settings.score.starHint")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {cfg.starCutoffs.map((val, i) => (
            <div key={i}>
              <Label className="text-xs text-muted-foreground">{t("skala.settings.score.starLevel", { level: i + 2 })}</Label>
              <Input type="number" value={val} onChange={(e) => setCutoff(i, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {/* Point values by group */}
      {POINT_GROUPS.map((g) => (
        <div key={g.titleKey}>
          <Label className="text-sm font-medium">{t(`skala.settings.score.groups.${g.titleKey}`)}</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {g.keys.map((k) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{t(`skala.settings.score.labels.${k}`)}</span>
                <Input type="number" step="0.5" className="w-24"
                  value={cfg.points[k] ?? 0} onChange={(e) => setPoint(k, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Numeric knobs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">{t("skala.settings.score.monthlyTarget")}</span>
          <Input type="number" min={0} className="w-24" value={cfg.monthlyTargetShifts}
            onChange={(e) => setCfg((c) => (c ? { ...c, monthlyTargetShifts: Number(e.target.value) || 0 } : c))} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">{t("skala.settings.score.swapCap")}</span>
          <Input type="number" min={0} className="w-24" value={cfg.swapScoringCap}
            onChange={(e) => setCfg((c) => (c ? { ...c, swapScoringCap: Number(e.target.value) || 0 } : c))} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
          {t("skala.settings.score.save")}
        </Button>
      </div>
    </div>
  );
}

const SettingsPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isOps = user?.role === "coordinator" || user?.role === "administrator";

  const handleLanguageChange = (lang: string) => {
    const code = lang as SupportedLanguage;
    setStoredLanguage(code);
    i18n.changeLanguage(code);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Settings className="w-5 h-5 text-accent" />
            {t("settings.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.description")}
          </p>
        </div>

        <div className="glass-card rounded-lg p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              {t("settings.preferences")}
            </h2>

            <div className="space-y-2">
              <Label htmlFor="language-select" className="text-sm font-medium">
                {t("settings.language")}
              </Label>
              <p className="text-xs text-muted-foreground mb-3">
                {t("settings.languageDescription")}
              </p>
              <Select
                value={
                  SUPPORTED_LANGUAGES.some((l) => l.code === i18n.language)
                    ? i18n.language
                    : i18n.language.startsWith("pt") ? "pt-BR" : "en"
                }
                onValueChange={handleLanguageChange}
              >
                <SelectTrigger id="language-select" className="w-full max-w-xs">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <PushCard />

        {isOps && <ScoreConfigCard />}
      </div>
    </AppLayout>
  );
};

export default SettingsPage;
