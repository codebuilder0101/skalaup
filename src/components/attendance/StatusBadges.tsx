import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { LatenessCategory } from "@/lib/skalaup/types";

const CAT_CLASS: Record<LatenessCategory, string> = {
  none: "border-success/30 bg-success/10 text-success",
  light: "border-amber-300/50 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  moderate: "border-orange-300/50 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
  severe: "border-red-300/50 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  critical: "border-red-400/60 bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
};

// Lateness category chip (§4.1). Shows the minutes for moderate+ (positive delay).
export function LatenessBadge({ category, minutes }: { category: LatenessCategory; minutes: number | null }) {
  const { t } = useTranslation();
  const cat = category ?? "none";
  const showMin = cat !== "none" && cat !== "light" && minutes != null && minutes > 0;
  return (
    <Badge variant="outline" className={`gap-1 rounded-full font-medium ${CAT_CLASS[cat] ?? CAT_CLASS.none}`}>
      {t(`skala.attendance.cat.${cat}`)}
      {showMin ? ` · ${t("skala.attendance.lateByMin", { n: minutes })}` : ""}
    </Badge>
  );
}

export function NoShowBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="rounded-full border-red-400/60 bg-red-100 font-medium text-red-800 dark:bg-red-500/20 dark:text-red-200">
      {t("skala.attendance.noShow")}
    </Badge>
  );
}

// Format an ISO timestamp to a short HH:MM in the given timezone (restaurant's),
// or "—" when null. Falls back to browser-local time when no timezone is passed.
export function fmtTime(iso: string | null, lng: string, timeZone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(lng, {
    hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}),
  }).format(d);
}
