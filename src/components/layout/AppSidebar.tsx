import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  LayoutDashboard,
  Settings,
  Users,
  Store,
  Star,
  MapPin,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  LogOut,
  UserCircle,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  MessageSquare,
  DollarSign,
  ShieldCheck,
  ShieldAlert,
  Gauge,
  Zap,
} from "lucide-react";
import type { UserRole } from "@/lib/auth";

const ADMIN: UserRole[] = ["administrator"]; // user approvals only
const COORD: UserRole[] = ["coordinator", "administrator"]; // operations (admin is a superset)
const MANAGER: UserRole[] = ["restaurant_manager"];
const FREELANCER: UserRole[] = ["freelancer", "visitor"];
const ALL: UserRole[] = ["administrator", "coordinator", "restaurant_manager", "freelancer", "visitor"];

type NavItem = { icon: typeof Users; labelKey: string; path: string; roles: UserRole[] };
type NavGroup = { labelKey: string; items: NavItem[] };

const navGroupsConfig: NavGroup[] = [
  {
    labelKey: "nav.coordination",
    items: [
      { icon: LayoutDashboard, labelKey: "nav.dashboard", path: "/dashboard", roles: [...COORD, ...MANAGER] },
      { icon: CalendarCheck, labelKey: "nav.scheduling", path: "/scheduling", roles: COORD },
      { icon: Store, labelKey: "nav.restaurants", path: "/restaurants", roles: COORD },
      { icon: Users, labelKey: "nav.freelancers", path: "/freelancers", roles: COORD },
      { icon: Gauge, labelKey: "nav.demand", path: "/demand", roles: COORD },
      { icon: CalendarDays, labelKey: "nav.availability", path: "/availability", roles: COORD },
    ],
  },
  {
    labelKey: "nav.operations",
    items: [
      { icon: ClipboardCheck, labelKey: "nav.today", path: "/today", roles: MANAGER },
      { icon: Zap, labelKey: "nav.extraShifts", path: "/extra-shifts", roles: [...COORD, ...MANAGER] },
      { icon: MapPin, labelKey: "nav.checkin", path: "/checkin", roles: FREELANCER },
      { icon: ShieldAlert, labelKey: "nav.attendance", path: "/attendance", roles: COORD },
      { icon: ArrowLeftRight, labelKey: "nav.swaps", path: "/swaps", roles: [...COORD, ...FREELANCER] },
      { icon: MessageSquare, labelKey: "nav.feedback", path: "/feedback", roles: [...COORD, ...MANAGER] },
    ],
  },
  {
    labelKey: "nav.insights",
    items: [
      { icon: Star, labelKey: "nav.performance", path: "/performance", roles: [...COORD, ...FREELANCER] },
      { icon: DollarSign, labelKey: "nav.financial", path: "/financial", roles: COORD },
    ],
  },
  {
    labelKey: "nav.myArea",
    items: [
      { icon: CalendarDays, labelKey: "nav.mySchedule", path: "/my-schedule", roles: FREELANCER },
      { icon: CalendarDays, labelKey: "nav.availability", path: "/availability", roles: FREELANCER },
      { icon: Zap, labelKey: "nav.vagas", path: "/vagas", roles: FREELANCER },
    ],
  },
  {
    labelKey: "nav.system",
    items: [
      { icon: ShieldCheck, labelKey: "nav.approvals", path: "/approvals", roles: ADMIN },
      // Notifications tab is hidden from the sidebar (the /notifications route and the
      // underlying notification system remain active). Re-add this item to show it again:
      // { icon: Bell, labelKey: "nav.notifications", path: "/notifications", roles: ALL },
      { icon: UserCircle, labelKey: "nav.profile", path: "/profile", roles: ALL },
      { icon: Settings, labelKey: "nav.settings", path: "/settings", roles: ALL },
    ],
  },
];

// Shared nav content — used by both the desktop aside and the mobile drawer.
// `onNavigate` lets the mobile drawer close itself when a link is tapped.
function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, canAccess, logout } = useAuth();

  return (
    <>
      <nav className="flex-1 overflow-y-auto py-4 space-y-6">
        {navGroupsConfig.map((group) => {
          const visibleItems = group.items.filter(
            (item) => (!user || item.roles.includes(user.role)) && canAccess(item.path),
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.labelKey}>
              {!collapsed && (
                <p className="px-4 mb-2 text-[10px] uppercase tracking-widest text-sidebar-muted font-semibold">
                  {t(group.labelKey)}
                </p>
              )}
              <ul className="space-y-0.5 px-2">
                {visibleItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  const label = t(item.labelKey);
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        onClick={onNavigate}
                        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                          isActive
                            ? "bg-sidebar-accent text-sidebar-primary font-medium"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }`}
                        title={collapsed ? label : undefined}
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0" />
                        {!collapsed && <span>{label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={() => { onNavigate?.(); logout(); }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title={collapsed ? t("nav.logout") : undefined}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>{t("nav.logout")}</span>}
        </button>
      </div>
    </>
  );
}

// Desktop sidebar — fixed, collapsible, hidden below md (mobile uses the drawer).
export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside
      className={`gradient-sidebar hidden md:flex flex-col border-r border-sidebar-border transition-all duration-300 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <SidebarNav collapsed={collapsed} />
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center h-12 border-t border-sidebar-border text-sidebar-muted hover:text-sidebar-accent-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
}

// Mobile drawer — same nav in an off-canvas sheet, opened from the header.
export function MobileSidebar({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="gradient-sidebar w-64 p-0 flex flex-col border-sidebar-border">
        <SheetTitle className="sr-only">SkalaUp</SheetTitle>
        <div className="flex flex-1 flex-col overflow-hidden pt-6">
          <SidebarNav collapsed={false} onNavigate={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

