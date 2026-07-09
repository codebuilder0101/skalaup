import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, Sun, Moon, Globe, LogOut, UserCircle, Settings, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { SUPPORTED_LANGUAGES } from "@/i18n/config";
import { getStoredTheme, setTheme, type Theme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

function roleLabelFromKey(role: string, t: (key: string) => string) {
  if (role === "administrator") return t("skala.roles.administrator");
  if (role === "coordinator") return t("skala.roles.coordinator");
  if (role === "restaurant_manager") return t("skala.roles.restaurantManager");
  if (role === "visitor") return t("skala.roles.visitor");
  return t("skala.roles.freelancer");
}

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [theme, setThemeState] = useState<Theme>(getStoredTheme());

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  };

  const initials = (user?.name?.trim()?.charAt(0) || "?").toUpperCase();

  return (
    <header className="h-28 flex items-center justify-between gap-4 px-4 sm:px-6 border-b border-border bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60 z-30">
      {/* Left: brand — full wordmark logo */}
      <Link to="/dashboard" className="flex items-center flex-shrink-0">
        <img src="/logo.png" alt="SkalaUp" className="h-24 w-auto object-contain" />
      </Link>

      {/* Right: global actions */}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Notifications */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon" className="relative">
                <Link to="/notifications" aria-label={t("header.notifications")}>
                  <Bell className="w-5 h-5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.notifications")}</TooltipContent>
          </Tooltip>

          {/* Light / dark theme */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t("header.toggleTheme")}>
                {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.toggleTheme")}</TooltipContent>
          </Tooltip>

          {/* Language */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("header.language")}>
                <Globe className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <DropdownMenuItem key={lang.code} onClick={() => void i18n.changeLanguage(lang.code)}>
                  <Check className={`w-4 h-4 mr-2 ${i18n.language === lang.code ? "opacity-100" : "opacity-0"}`} />
                  {lang.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-6 bg-border mx-1 hidden sm:block" />

          {/* User menu */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 px-1.5 sm:px-2 gap-2">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:flex flex-col items-start leading-tight">
                    <span className="text-sm font-medium text-foreground truncate max-w-[150px]">{user.name}</span>
                    <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                      {roleLabelFromKey(user.role, t)}
                    </span>
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium truncate">{user.name}</span>
                    <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile"><UserCircle className="w-4 h-4 mr-2" />{t("nav.profile")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings"><Settings className="w-4 h-4 mr-2" />{t("nav.settings")}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                  <LogOut className="w-4 h-4 mr-2" />{t("nav.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </TooltipProvider>
    </header>
  );
}
