import { BarChart3, CalendarDays, ChevronDown, ClipboardList, Settings2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { isAdminUser, type AppAuthUser } from "../../lib/auth";
import {
  MOBILE_SCHEDULE_MODE_EVENT,
  MOBILE_SCHEDULE_MODE_STORAGE_KEY,
  normalizeMobileScheduleMode,
  readStoredMobileScheduleMode,
  writeStoredMobileScheduleMode,
} from "../../lib/schedule-mobile-mode";
import { cn } from "../../lib/utils";
import { useIsMobile } from "../../pages/calendar-shared";
import { Badge } from "../ui/badge";

type NavigationItem = {
  label: string;
  href?: string;
  icon: typeof Users;
  badge?: string;
  children?: Array<{
    label: string;
    href: string;
    badge?: string;
  }>;
};

type NavigationSection = {
  label: string;
  items: NavigationItem[];
};

const buildNavigation = (user: AppAuthUser | null): NavigationSection[] => [
  {
    label: "Calendar",
    items: [{ label: "Schedule", href: "/calendar/schedule", icon: CalendarDays }],
  },
  {
    label: "Congregation",
    items: [
      { label: "Members", href: "/members", icon: Users },
      { label: "Households", href: "/households", icon: Users },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        label: "Reports",
        href: "/reports",
        icon: BarChart3,
        children: [
          { label: "Reports Overview", href: "/reports/dashboard" },
          { label: "Member Report", href: "/reports/member-visitation" },
        ],
      },
    ],
  },
  {
    label: "Settings",
    items: [{ label: "Connect & Configure", href: "/calendar", icon: Settings2 }],
  },
  ...(user && isAdminUser(user.groups)
    ? [
        {
          label: "Admin",
          items: [
            { label: "User Groups", href: "/admin/user-groups", icon: Users },
            { label: "Tenant Reset", href: "/admin/tenant-reset", icon: Settings2 },
          ],
        } satisfies NavigationSection,
      ]
    : []),
];

type SideMenuProps = {
  onNavigate?: () => void;
  user: AppAuthUser | null;
};

export const SideMenu = ({ onNavigate, user }: SideMenuProps) => {
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const [reportsOpen, setReportsOpen] = useState(() => pathname.startsWith("/reports"));
  const [mobileScheduleMode, setMobileScheduleMode] = useState(() => readStoredMobileScheduleMode());
  const navigation = buildNavigation(user ?? null);

  useEffect(() => {
    if (pathname.startsWith("/reports")) {
      setReportsOpen(true);
    }
  }, [pathname]);

  useEffect(() => {
    const handleModeEvent = (event: Event) => {
      const nextMode = normalizeMobileScheduleMode((event as CustomEvent<string>).detail);
      if (nextMode) {
        setMobileScheduleMode(nextMode);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== MOBILE_SCHEDULE_MODE_STORAGE_KEY) {
        return;
      }

      const nextMode = normalizeMobileScheduleMode(event.newValue);
      if (nextMode) {
        setMobileScheduleMode(nextMode);
      }
    };

    window.addEventListener(MOBILE_SCHEDULE_MODE_EVENT, handleModeEvent);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(MOBILE_SCHEDULE_MODE_EVENT, handleModeEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const handleScheduleModeSelect = (mode: typeof mobileScheduleMode) => {
    setMobileScheduleMode(mode);
    writeStoredMobileScheduleMode(mode);
  };

  return (
    <nav className="flex-1 space-y-4">
      {navigation.map((section) => (
        <div key={section.label}>
          <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-blue-200/60">
            {section.label}
          </p>
          <div className="space-y-1">
            {section.items.map((item) => {
              const Icon = item.icon;
              const activeChild = item.children?.some((child) => pathname === child.href);
              const isParentActive = item.href ? pathname === item.href : false;

              if (item.children) {
                return (
                  <div className="space-y-1" key={item.label}>
                    <div
                      className={cn(
                        "flex h-9 items-center rounded-md transition-colors",
                        reportsOpen && "bg-white/8",
                        (activeChild || isParentActive) && "text-white",
                      )}
                    >
                      <NavLink
                        className={cn(
                          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-md px-2.5 text-sm text-blue-100/80 transition-colors hover:bg-white/8 hover:text-white",
                          (reportsOpen || activeChild || isParentActive) && "text-white",
                          isParentActive && "bg-primary text-white shadow-lg shadow-blue-950/20",
                        )}
                        end
                        onClick={() => {
                          setReportsOpen(true);
                          onNavigate?.();
                        }}
                        to={item.href ?? "/reports"}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="flex-1 text-left">{item.label}</span>
                      </NavLink>
                      <button
                        aria-label={reportsOpen ? "Collapse Reports menu" : "Expand Reports menu"}
                        className={cn(
                          "flex h-full items-center rounded-r-md px-2.5 text-blue-100/80 transition-colors hover:bg-white/8 hover:text-white",
                          (reportsOpen || activeChild || isParentActive) && "text-white",
                        )}
                        onClick={() => setReportsOpen((current) => !current)}
                        type="button"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", reportsOpen && "rotate-180")} />
                      </button>
                    </div>
                    {reportsOpen ? (
                      <div className="space-y-1 pl-3">
                        {item.children.map((child) => (
                          <NavLink
                            end={child.href === "/reports"}
                            key={child.href}
                            to={child.href}
                            className={({ isActive }) =>
                              cn(
                                "flex min-h-8 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-blue-100/70 transition-colors hover:bg-white/8 hover:text-white",
                                isActive && "bg-white/12 text-white",
                              )
                            }
                            onClick={onNavigate}
                          >
                            <ClipboardList className="h-3.5 w-3.5" />
                            <span className="flex items-center gap-2">
                              <span>{child.label}</span>
                              {child.badge ? (
                                <Badge className="bg-white/12 px-1.5 py-0 text-[10px] text-blue-100" variant="neutral">
                                  {child.badge}
                                </Badge>
                              ) : null}
                            </span>
                          </NavLink>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }

              return (
                <div className="space-y-1" key={item.href}>
                  <div className="relative">
                    <NavLink
                      end={item.href === "/calendar"}
                      to={item.href ?? "/"}
                      className={({ isActive }) =>
                        cn(
                          "flex h-9 min-w-0 items-center gap-2 rounded-md px-2.5 text-sm text-blue-100/80 transition-colors hover:bg-white/8 hover:text-white",
                          isMobile && item.href === "/calendar/schedule" && "w-full pr-[5.9rem]",
                          isActive && "bg-primary text-white shadow-lg shadow-blue-950/20",
                        )
                      }
                      onClick={onNavigate}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="flex items-center gap-2">
                        <span>{item.label}</span>
                        {item.badge ? (
                          <Badge className="bg-white/12 px-1.5 py-0 text-[10px] text-blue-100" variant="neutral">
                            {item.badge}
                          </Badge>
                        ) : null}
                      </span>
                    </NavLink>

                    {isMobile && item.href === "/calendar/schedule" ? (
                      <button
                        aria-label={mobileScheduleMode === "beta" ? "Use classic schedule view" : "Use new schedule view"}
                        aria-pressed={mobileScheduleMode === "beta"}
                        className="absolute right-2 top-1/2 flex h-6 -translate-y-1/2 items-center gap-1.5 rounded-full px-1 text-[8px] font-normal uppercase tracking-[0.05em] text-white/72"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleScheduleModeSelect(mobileScheduleMode === "beta" ? "classic" : "beta");
                        }}
                        type="button"
                      >
                        <span
                          className={cn(
                            "relative flex h-4 w-8 items-center rounded-full border transition-colors",
                            mobileScheduleMode === "beta"
                              ? "border-white/10 bg-blue-500/55"
                              : "border-white/16 bg-white/12",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute h-3 w-3 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.4)] transition-transform",
                              mobileScheduleMode === "beta" ? "translate-x-[1.05rem]" : "translate-x-[0.1rem]",
                            )}
                          />
                        </span>
                        <span className="text-[12.5px] font-light leading-none tracking-[0.06em] text-white/72">new</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
};
