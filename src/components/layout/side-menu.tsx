import { BarChart3, CalendarDays, ChevronDown, ClipboardList, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import type { AppAuthUser } from "../../lib/auth";
import { cn } from "../../lib/utils";

type NavigationItem = {
  label: string;
  href?: string;
  icon: typeof Users;
  children?: Array<{
    label: string;
    href: string;
  }>;
};

type NavigationSection = {
  label: string;
  items: NavigationItem[];
};

const baseNavigation: NavigationSection[] = [
  {
    label: "Calendar",
    items: [
      { label: "Connect & Configure", href: "/calendar", icon: CalendarDays },
      { label: "Schedule", href: "/calendar/schedule", icon: CalendarDays },
    ],
  },
  {
    label: "Congregation",
    items: [{ label: "Members", href: "/members", icon: Users }],
  },
  {
    label: "Reports",
    items: [
      {
        label: "Reports",
        icon: BarChart3,
        children: [
          { label: "Reports Dashboard", href: "/reports/dashboard" },
          { label: "Member Visitation", href: "/reports/member-visitation" },
        ],
      },
    ],
  },
];

type SideMenuProps = {
  onNavigate?: () => void;
  user: AppAuthUser | null;
};

export const SideMenu = ({ onNavigate }: SideMenuProps) => {
  const { pathname } = useLocation();
  const [reportsOpen, setReportsOpen] = useState(() => pathname.startsWith("/reports"));

  useEffect(() => {
    if (pathname.startsWith("/reports")) {
      setReportsOpen(true);
    }
  }, [pathname]);

  return (
    <nav className="flex-1 space-y-4">
      {baseNavigation.map((section) => (
        <div key={section.label}>
          <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-blue-200/60">
            {section.label}
          </p>
          <div className="space-y-1">
            {section.items.map((item) => {
              const Icon = item.icon;
              const activeChild = item.children?.some((child) => pathname === child.href);

              if (item.children) {
                return (
                  <div className="space-y-1" key={item.label}>
                    <button
                      className={cn(
                        "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm text-blue-100/80 transition-colors hover:bg-white/8 hover:text-white",
                        activeChild && "bg-primary text-white shadow-lg shadow-blue-950/20",
                      )}
                      onClick={() => setReportsOpen((current) => !current)}
                      type="button"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="flex-1 text-left">{item.label}</span>
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", reportsOpen && "rotate-180")} />
                    </button>
                    {reportsOpen ? (
                      <div className="space-y-1 pl-3">
                        {item.children.map((child) => (
                          <NavLink
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
                            <span>{child.label}</span>
                          </NavLink>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }

              return (
                <NavLink
                  key={item.href}
                  end={item.href === "/calendar"}
                  to={item.href ?? "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-blue-100/80 transition-colors hover:bg-white/8 hover:text-white",
                      isActive && "bg-primary text-white shadow-lg shadow-blue-950/20",
                    )
                  }
                  onClick={onNavigate}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
};
