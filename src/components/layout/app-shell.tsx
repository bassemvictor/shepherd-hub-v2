import { Bell, ChevronRight, LogOut, Menu, Moon, Search, Shield, SunMedium } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { formatGroupLabel, useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";
import { APP_DISPLAY_NAME, APP_SHORT_DISPLAY_NAME } from "../../lib/app-metadata";
import { getBreadcrumbs, getPageTitle } from "../../lib/route-metadata";
import { cn } from "../../lib/utils";
import { useIsMobile } from "../../pages/calendar-shared";
import { MobileBottomNav, shouldShowMobileBottomNav } from "./mobile-bottom-nav";
import { SideMenu } from "./side-menu";
import { Button } from "../ui/button";

export const AppShell = () => {
  const { pathname } = useLocation();
  const { user, signOutUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);
  const title = useMemo(() => getPageTitle(pathname), [pathname]);
  const showMobileBottomNav = isMobile && shouldShowMobileBottomNav(pathname);
  const primaryGroup = user?.groups[0] ? formatGroupLabel(user.groups[0]) : "Authenticated User";
  const initials = useMemo(() => {
    const source = user?.name || user?.email || "AU";
    return source
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [user?.email, user?.name]);

  return (
    <div className="min-h-screen bg-transparent">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-[82vw] max-w-80 overflow-y-auto overscroll-contain bg-sidebar px-3 py-4 text-sidebar-foreground transition-transform sm:w-[78vw] sm:max-w-72 lg:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex min-h-full flex-col">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <img alt="Shepherd Hub logo" className="h-10 w-10 shrink-0 object-contain" src="/logo_bw.png" />
                <div className="min-w-0 pt-0.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-blue-200/80">
                    {user?.tenantId ?? "No Tenant Assigned"}
                  </p>
                  <h1 className="mt-1 truncate text-[1.25rem] font-semibold leading-none tracking-tight text-white sm:text-[1.45rem]">
                    {APP_SHORT_DISPLAY_NAME}
                  </h1>
                </div>
              </div>
              <button
                className="rounded-md p-2 text-blue-100 lg:hidden"
                onClick={() => setSidebarOpen(false)}
                type="button"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>

            <SideMenu onNavigate={() => setSidebarOpen(false)} user={user} />

            <div className="rounded-md border border-white/10 bg-white/6 p-3">
              <p className="text-sm font-medium text-white">{APP_DISPLAY_NAME}</p>
              <p className="mt-1 text-xs text-blue-100/70">
                Coordinate tenant {user?.tenantId ?? "unassigned"} events and member visitations.  
              </p>
              <Button
                className="mt-3 w-full justify-center border-white/15 bg-white/8 text-sidebar-foreground hover:bg-white/14 sm:hidden"
                onClick={toggleTheme}
                type="button"
                variant="outline"
              >
                {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </Button>
            </div>
          </div>
        </aside>

        {sidebarOpen ? (
          <button
            aria-label="Close sidebar overlay"
            className="fixed inset-0 z-30 bg-slate-950/35 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col lg:pl-72">
          <header className="sticky top-0 z-20 border-b border-border/90 bg-background/85 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4 lg:px-6">
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                <button
                  className="rounded-md border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
                  onClick={() => setSidebarOpen(true)}
                  type="button"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <div className="mb-1 hidden flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                    {breadcrumbs.map((crumb, index) => (
                      <div className="flex items-center gap-2" key={`${crumb.label}-${index}`}>
                        {crumb.href ? <NavLink to={crumb.href}>{crumb.label}</NavLink> : <span>{crumb.label}</span>}
                        {index < breadcrumbs.length - 1 ? <ChevronRight className="h-3.5 w-3.5" /> : null}
                      </div>
                    ))}
                  </div>
                  <h2 className="text-xl font-semibold leading-tight text-foreground">{title}</h2>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:gap-3 lg:justify-end">
                <div className="hidden items-center gap-2 rounded-md border border-border bg-muted/45 px-2.5 py-1.5 text-xs text-muted-foreground md:flex">
                  <Search className="h-3.5 w-3.5" />
                  Search records, pages, or actions
                </div>
                <Button
                  aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                  className="hidden sm:flex"
                  onClick={toggleTheme}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <button
                  className="hidden h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
                  type="button"
                >
                  <Bell className="h-4 w-4" />
                </button>
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                    {initials}
                  </div>
                  <div className="hidden min-w-0 text-left lg:block xl:block">
                    <p className="truncate text-sm font-medium text-foreground">{user?.name || user?.email || "Project User"}</p>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      <span className="truncate">{primaryGroup}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Tenant: {user?.tenantId ?? "No tenant assigned"}
                    </div>
                  </div>
                  <Button
                    className="rounded-md p-0"
                    onClick={() => void signOutUser()}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </header>

          <main
            className={cn(
              "min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-4 lg:px-6",
              showMobileBottomNav && "pb-[calc(7.5rem+env(safe-area-inset-bottom))]",
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>

      {showMobileBottomNav ? <MobileBottomNav onOpenMore={() => setSidebarOpen(true)} /> : null}
    </div>
  );
};
