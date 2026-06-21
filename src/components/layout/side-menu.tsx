import { BarChart3, CalendarDays, ChevronDown, ClipboardList, Settings2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { isAdminUser, type AppAuthUser } from "../../lib/auth";
import { cn } from "../../lib/utils";
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
    items: [
      { label: "Schedule", href: "/calendar/schedule", icon: CalendarDays },
      { label: "Schedule", href: "/calendar/schedule-beta", icon: CalendarDays, badge: "Beta" },
    ],
  },
  {
    label: "Congregation",
    items: [{ label: "Members", href: "/members", icon: Users }],
  },
  {
    label: "Insights",
    items: [
      {
        label: "Reports",
        icon: BarChart3,
        children: [
          { label: "Reports", href: "/reports" },
          { label: "Reports Dashboard", href: "/reports/dashboard" },
          { label: "Member Visitation", href: "/reports/member-visitation" },
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
  const [reportsOpen, setReportsOpen] = useState(() => pathname.startsWith("/reports"));
  const navigation = buildNavigation(user ?? null);

  useEffect(() => {
    if (pathname.startsWith("/reports")) {
      setReportsOpen(true);
    }
  }, [pathname]);

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

              if (item.children) {
                return (
                  <div className="space-y-1" key={item.label}>
                    <button
                      className={cn(
                        "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm text-blue-100/80 transition-colors hover:bg-white/8 hover:text-white",
                        reportsOpen && "bg-white/8 text-white",
                        activeChild && "text-white",
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
                  <span className="flex items-center gap-2">
                    <span>{item.label}</span>
                    {item.badge ? (
                      <Badge className="bg-white/12 px-1.5 py-0 text-[10px] text-blue-100" variant="neutral">
                        {item.badge}
                      </Badge>
                    ) : null}
                  </span>
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
};
