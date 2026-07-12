import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar, MobileSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";

interface AppLayoutProps {
  children: ReactNode;
}

// Non-blocking prompt shown while the user is still on a temporary password (FR-B4).
function TempPasswordBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!user?.mustChangePassword) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
      <span>{t("skala.profile.tempPasswordBanner")}</span>
      <Link to="/profile" className="whitespace-nowrap font-medium underline underline-offset-2">
        {t("skala.profile.changeNow")}
      </Link>
    </div>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <AppHeader onMenuClick={() => setMobileNavOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <MobileSidebar open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
        <main className="flex-1 overflow-auto bg-background">
          <TempPasswordBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
