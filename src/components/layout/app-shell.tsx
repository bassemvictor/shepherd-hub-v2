import { Bell, ChevronRight, LogOut, Menu, Moon, Search, Shield, SunMedium } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { formatGroupLabel, useAuth } from "../../lib/auth";
import { useMembersIndex } from "../../lib/members-index";
import { useTheme } from "../../lib/theme";
import { APP_NAME, APP_SHORT_VERSION, APP_VERSION } from "../../lib/app-metadata";
import { getBreadcrumbs, getPageTitle } from "../../lib/route-metadata";
import { useOverlayHistory } from "../../lib/use-overlay-history";
import { cn } from "../../lib/utils";
import { useIsMobile } from "../../pages/calendar-shared";
import { AndroidBackButtonHandler } from "../common/android-back-button-handler";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { SideMenu } from "./side-menu";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

export const AppShell = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, signOutUser } = useAuth();
  const { items: members } = useMembersIndex();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const isMobile = useIsMobile();
  const closeSidebar = useOverlayHistory(sidebarOpen, () => setSidebarOpen(false));
  const memberSearchRef = useRef<HTMLFormElement | null>(null);
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);
  const title = useMemo(() => getPageTitle(pathname), [pathname]);
  const showMobileBottomNav = isMobile;
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
  const normalizedMemberSearchQuery = memberSearchQuery.trim().toLowerCase();
  const memberMatches = useMemo(() => {
    if (!normalizedMemberSearchQuery) {
      return [];
    }

    return members
      .filter((member) => member.normalizedSearchText.includes(normalizedMemberSearchQuery))
      .slice(0, 6);
  }, [members, normalizedMemberSearchQuery]);
  const showMemberResults = memberSearchOpen && normalizedMemberSearchQuery.length > 0;

  useEffect(() => {
    setMemberSearchQuery("");
    setMemberSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!memberSearchOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!memberSearchRef.current?.contains(event.target as Node)) {
        setMemberSearchOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [memberSearchOpen]);

  const navigateToMembersSearch = () => {
    const nextQuery = memberSearchQuery.trim();
    navigate(nextQuery ? `/members?q=${encodeURIComponent(nextQuery)}` : "/members");
    setMemberSearchOpen(false);
  };

  const openMember = (memberId: string) => {
    navigate(`/members/${memberId}`);
    setMemberSearchOpen(false);
  };

  return (
    <div className="min-h-screen bg-transparent">
      <AndroidBackButtonHandler />
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
                  <h1 className="mt-1 flex items-center gap-2 text-[1.25rem] font-semibold leading-none tracking-tight text-white sm:text-[1.45rem]">
                    <span className="truncate">{APP_NAME}</span>
                    <Badge className="shrink-0 bg-white/12 text-[10px] text-blue-100" variant="neutral">
                      {APP_SHORT_VERSION}
                    </Badge>
                  </h1>
                </div>
              </div>
              <button
                className="rounded-md p-2 text-blue-100 lg:hidden"
                onClick={closeSidebar}
                type="button"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>

            <SideMenu onNavigate={() => setSidebarOpen(false)} user={user} />

            <div className="rounded-md border border-white/10 bg-white/6 p-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white">{APP_NAME}</p>
                <Badge className="shrink-0 bg-white/12 text-[10px] text-blue-100" variant="neutral">
                  {APP_VERSION}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-blue-100/70">Tenant: {user?.tenantId ?? "unassigned"}</p>
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
            onClick={closeSidebar}
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
                <form
                  className="relative hidden w-[min(26rem,42vw)] md:block"
                  onSubmit={(event) => {
                    event.preventDefault();
                    navigateToMembersSearch();
                  }}
                  ref={memberSearchRef}
                >
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    aria-label="Search members"
                    className="h-10 w-full rounded-xl border border-border bg-muted/45 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                    onChange={(event) => {
                      setMemberSearchQuery(event.target.value);
                      setMemberSearchOpen(true);
                    }}
                    onFocus={() => setMemberSearchOpen(true)}
                    placeholder="Search members"
                    value={memberSearchQuery}
                  />
                  {showMemberResults ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                      {memberMatches.length ? (
                        <div className="py-1.5">
                          {memberMatches.map((member) => (
                            <button
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"
                              key={member.memberId}
                              onClick={() => openMember(member.memberId)}
                              type="button"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{member.fullName}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {member.email || member.phone || member.householdName || "Member"}
                                </div>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">Open</span>
                            </button>
                          ))}
                          <button
                            className="w-full border-t border-border px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-accent"
                            type="submit"
                          >
                            View all matching members
                          </button>
                        </div>
                      ) : (
                        <div className="px-3 py-3 text-sm text-muted-foreground">No matching members found.</div>
                      )}
                    </div>
                  ) : null}
                </form>
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
