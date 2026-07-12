import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { useNotifications } from "@/hooks/useNotifications";
import { formatRelative, notificationLink, type AppNotification } from "@/lib/skalaup/notifications";

function roleLabelFromKey(role: string, t: (key: string) => string) {
  if (role === "administrator") return t("skala.roles.administrator");
  if (role === "coordinator") return t("skala.roles.coordinator");
  if (role === "restaurant_manager") return t("skala.roles.restaurantManager");
  if (role === "visitor") return t("skala.roles.visitor");
  return t("skala.roles.freelancer");
}

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const { user, logout, canAccess } = useAuth();
  const navigate = useNavigate();
  const lng = i18n.language || "pt-BR";
  const { items, unreadCount, markRead, markAll } = useNotifications(10);
  const [theme, setThemeState] = useState<Theme>(getStoredTheme());

  const openNotification = (n: AppNotification) => {
    if (!n.readAt) void markRead(n.id);
    const link = notificationLink(n);
    if (link && canAccess(link)) navigate(link);
    else navigate("/notifications");
  };

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                aria-label={t("skala.notifications.bellLabel", { count: unreadCount })}
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-[18px] text-destructive-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
              <div className="flex items-center justify-between px-3 py-2">
                <DropdownMenuLabel className="p-0 text-sm font-semibold">
                  {t("skala.notifications.title")}
                </DropdownMenuLabel>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); void markAll(); }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {t("skala.notifications.markAllReadShort")}
                  </button>
                )}
              </div>
              <DropdownMenuSeparator className="my-0" />
              {items.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("skala.notifications.empty")}
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {items.map((n) => (
                    <DropdownMenuItem
                      key={n.id}
                      onSelect={() => openNotification(n)}
                      className={`flex flex-col items-start gap-0.5 px-3 py-2.5 ${n.readAt ? "" : "bg-primary/[0.04]"}`}
                    >
                      <div className="flex w-full items-center gap-2">
                        {!n.readAt && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" aria-hidden />}
                        <span className={`flex-1 truncate text-sm ${n.readAt ? "font-medium" : "font-semibold"}`}>
                          {n.title}
                        </span>
                        <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                          {formatRelative(n.createdAt, lng, t("skala.notifications.justNow"))}
                        </span>
                      </div>
                      {n.body && <span className="line-clamp-2 w-full text-xs text-muted-foreground">{n.body}</span>}
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
              <DropdownMenuSeparator className="my-0" />
              <DropdownMenuItem asChild className="justify-center py-2 text-sm font-medium text-primary">
                <Link to="/notifications">{t("skala.notifications.viewAll")}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
