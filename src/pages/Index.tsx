import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CalendarCheck, Store, Users, ArrowLeftRight, MessageSquare, DollarSign,
  UserPlus, ShieldCheck, LogIn, LogOut, Clock,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getDashboard, isManagerDashboard,
  type DashboardData, type TodayShift,
  type ShiftsTrendPoint, type ScoreBucket,
} from "@/lib/skalaup/dashboard";

const AXIS = "#94a3b8";
const C_TOTAL = "#ec4899";
const C_PUBLISHED = "#10b981";
const C_LEVEL = "#f59e0b";

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--foreground))",
} as const;

function DashboardCharts({ trend, buckets }: { trend: ShiftsTrendPoint[]; buckets: ScoreBucket[] }) {
  const { t } = useTranslation();
  const trendData = trend.map((d) => ({ ...d, label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}` }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="font-semibold text-foreground mb-4">{t("skala.dashboard.chartShiftsTitle")}</h2>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={trendData} margin={{ left: -16, right: 8, top: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C_TOTAL} stopOpacity={0.35} />
                <stop offset="95%" stopColor={C_TOTAL} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gPub" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C_PUBLISHED} stopOpacity={0.35} />
                <stop offset="95%" stopColor={C_PUBLISHED} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={AXIS} strokeOpacity={0.2} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={32} />
            <RTooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="total" name={t("skala.dashboard.chartShiftsTotal")} stroke={C_TOTAL} fill="url(#gTotal)" strokeWidth={2} />
            <Area type="monotone" dataKey="published" name={t("skala.dashboard.chartShiftsPublished")} stroke={C_PUBLISHED} fill="url(#gPub)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C_TOTAL }} />{t("skala.dashboard.chartShiftsTotal")}</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C_PUBLISHED }} />{t("skala.dashboard.chartShiftsPublished")}</span>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-foreground mb-4">{t("skala.dashboard.chartScoreTitle")}</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={buckets} margin={{ left: -16, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={AXIS} strokeOpacity={0.2} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: AXIS }} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={32} />
            <RTooltip contentStyle={tooltipStyle} cursor={{ fill: AXIS, fillOpacity: 0.08 }} />
            <Bar dataKey="count" name={t("skala.dashboard.chartScoreMembers")} fill={C_LEVEL} radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

type StatProps = {
  icon: typeof Store;
  label: string;
  value: string | number;
  hint?: string;
  to?: string;
  color: string;
};

function Stat({ icon: Icon, label, value, hint, to, color }: StatProps) {
  const inner = (
    <Card className="p-5 h-full hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
          {hint && <p className="text-xs text-muted-foreground mt-1 truncate">{hint}</p>}
        </div>
        <Icon className={`w-6 h-6 flex-shrink-0 ${color}`} />
      </div>
    </Card>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}

function shiftBadge(status: TodayShift["status"], t: (k: string) => string) {
  if (status === "published") return <Badge>{t("skala.scheduleBuilder.cycleStatus.published")}</Badge>;
  return <Badge variant="secondary">{t("skala.dashboard.draft")}</Badge>;
}

function TodaySchedule({ shifts, showRestaurant, showAttendance }: {
  shifts: TodayShift[]; showRestaurant: boolean; showAttendance: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-foreground flex items-center gap-2 mb-3">
        <CalendarCheck className="w-5 h-5 text-primary" /> {t("skala.dashboard.todaySchedule")}
      </h2>
      {shifts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.dashboard.noShiftsToday")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shifts.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{s.freelancerName}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {t(`skala.scheduleBuilder.shift.${s.shiftType}`)} · {s.startTime?.slice(0, 5)}–{s.endTime?.slice(0, 5)}
                  {showRestaurant && <> · {s.restaurantName}</>}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {showAttendance && (
                  s.checkinAt ? (
                    <span className="text-xs text-emerald-600 flex items-center gap-1" title={t("skala.dashboard.checkedIn")}>
                      <LogIn className="w-3.5 h-3.5" />
                      {s.checkoutAt && <LogOut className="w-3.5 h-3.5" />}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("skala.dashboard.notCheckedIn")}</span>
                  )
                )}
                {shiftBadge(s.status, t)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Index() {
  const { t } = useTranslation();
  const { user, canAccess } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await getDashboard();
    if (error) toast.error(error.message);
    setData(data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const money = (n: number) =>
    `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t("skala.dashboard.welcome", { name: user?.name ?? "" })}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("skala.dashboard.subtitle")}</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("skala.common.loading")}</p>
        ) : !data ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.dashboard.noData")}</Card>
        ) : isManagerDashboard(data) ? (
          /* ---------- Restaurant manager: single-restaurant view ---------- */
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Stat
                icon={Store} color="text-orange-500"
                label={t("skala.dashboard.myRestaurant")}
                value={data.restaurants[0]?.name ?? "—"}
                hint={data.restaurants.length > 1
                  ? t("skala.dashboard.plusMore", { n: data.restaurants.length - 1 })
                  : (data.restaurants[0]?.address ?? undefined)}
              />
              <Stat
                icon={Users} color="text-blue-500"
                label={t("skala.dashboard.subscribers")}
                value={data.subscribers}
                hint={t("skala.dashboard.thisCycle")}
              />
              <Stat
                icon={CalendarCheck} color="text-emerald-500"
                label={t("skala.dashboard.todayShifts")}
                value={data.today.total}
                hint={t("skala.dashboard.peopleScheduled", { n: data.today.freelancers })}
              />
            </div>
            <TodaySchedule shifts={data.todaySchedule} showRestaurant={data.restaurants.length > 1} showAttendance />
          </>
        ) : (
          /* ---------- Coordinator / administrator: operation overview ---------- */
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                icon={Store} color="text-orange-500" to="/restaurants"
                label={t("skala.dashboard.restaurants")}
                value={data.restaurants.active}
                hint={t("skala.dashboard.ofTotal", { n: data.restaurants.total })}
              />
              <Stat
                icon={Users} color="text-blue-500" to="/freelancers"
                label={t("skala.dashboard.freelancers")}
                value={data.freelancers.total}
                hint={t("skala.dashboard.activePending", { active: data.freelancers.active, pending: data.freelancers.pending })}
              />
              <Stat
                icon={UserPlus} color="text-violet-500"
                label={t("skala.dashboard.subscribers")}
                value={data.subscribers}
                hint={t("skala.dashboard.thisCycle")}
              />
              <Stat
                icon={CalendarCheck} color="text-emerald-500" to="/scheduling"
                label={t("skala.dashboard.todayShifts")}
                value={data.today.total}
                hint={t("skala.dashboard.publishedCount", { n: data.today.published })}
              />
              <Stat
                icon={ArrowLeftRight} color="text-green-500" to="/swaps"
                label={t("skala.dashboard.swaps")}
                value={data.swaps}
                hint={t("skala.dashboard.pending")}
              />
              <Stat
                icon={MessageSquare} color="text-amber-500" to="/feedback"
                label={t("skala.dashboard.feedback")}
                value={data.feedback}
                hint={t("skala.dashboard.toValidate")}
              />
              {canAccess("/approvals") && (
                <Stat
                  icon={ShieldCheck} color="text-rose-500" to="/approvals"
                  label={t("skala.dashboard.approvals")}
                  value={data.approvals}
                  hint={t("skala.dashboard.pending")}
                />
              )}
              <Stat
                icon={DollarSign} color="text-green-600" to="/financial"
                label={t("skala.dashboard.finance")}
                value={money(data.finance.estimated)}
                hint={t("skala.dashboard.shiftsThisMonth", { n: data.finance.shifts })}
              />
            </div>
            <DashboardCharts trend={data.shiftsTrend} buckets={data.scoreBuckets} />
            <TodaySchedule shifts={data.todaySchedule} showRestaurant showAttendance={false} />
          </>
        )}
      </div>
    </AppLayout>
  );
}
