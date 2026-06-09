import { Bell, ChevronRight, LogOut, Menu, Search, Shield, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { formatGroupLabel, useAuth } from "../../lib/auth";
import { getBreadcrumbs, getPageTitle } from "../../lib/route-metadata";
import { cn } from "../../lib/utils";
import { SideMenu } from "./side-menu";
import { Button } from "../ui/button";

export const AppShell = () => {
  const { pathname } = useLocation();
  const { user, signOutUser } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);
  const title = useMemo(() => getPageTitle(pathname), [pathname]);
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
            <div className="mb-4 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-blue-200/80">Starter Template</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  <h1 className="truncate text-base font-semibold sm:text-lg">Shepherd Hub 2.0</h1>
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
              <p className="text-sm font-medium text-white">Reusable app foundation</p>
              <p className="mt-1 text-xs text-blue-100/70">
                Keep the shell, auth flow, API wiring, and CRUD patterns. Replace sample pages as your project grows.
              </p>
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
          <header className="sticky top-0 z-20 border-b border-border/90 bg-white/90 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4 lg:px-6">
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                <button
                  className="rounded-md border border-border bg-white p-2 text-slate-600 lg:hidden"
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
                  <h2 className="text-xl font-semibold leading-tight text-slate-900">{title}</h2>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:gap-3 lg:justify-end">
                <div className="hidden items-center gap-2 rounded-md border border-border bg-slate-50 px-2.5 py-1.5 text-xs text-muted-foreground md:flex">
                  <Search className="h-3.5 w-3.5" />
                  Search records, pages, or actions
                </div>
                <button
                  className="hidden h-9 w-9 items-center justify-center rounded-md border border-border bg-white text-slate-600 sm:flex"
                  type="button"
                >
                  <Bell className="h-4 w-4" />
                </button>
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                    {initials}
                  </div>
                  <div className="hidden min-w-0 text-left lg:block xl:block">
                    <p className="truncate text-sm font-medium text-slate-900">{user?.name || user?.email || "Project User"}</p>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      <span className="truncate">{primaryGroup}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Tenant: {user?.tenantId ?? "No tenant assigned"}
                    </div>
                  </div>
                  <Button
                    className="rounded-md p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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

          <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-4 lg:px-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};
