import { CalendarDays, FolderKanban, Home } from "lucide-react";
import { NavLink } from "react-router-dom";

import type { AppAuthUser } from "../../lib/auth";
import { cn } from "../../lib/utils";

export type NavigationSection = {
  label: string;
  items: Array<{
    label: string;
    href: string;
    icon?: typeof Home;
  }>;
};

const baseNavigation: NavigationSection[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: Home },
      { label: "Sample Records", href: "/records", icon: FolderKanban },
    ],
  },
  {
    label: "Calendar",
    items: [
      { label: "Connect & Configure", href: "/calendar", icon: CalendarDays },
      { label: "Schedule", href: "/calendar/schedule", icon: CalendarDays },
    ],
  },
];

type SideMenuProps = {
  onNavigate?: () => void;
  user: AppAuthUser | null;
};

export const SideMenu = ({ onNavigate }: SideMenuProps) => {
  const sections = baseNavigation;

  return (
    <nav className="flex-1 space-y-4">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-blue-200/60">
            {section.label}
          </p>
          <div className="space-y-1">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.href}
                  end={item.href === "/calendar"}
                  to={item.href}
                  className={({ isActive }) =>
                    cn(
                      "flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-blue-100/80 transition-colors hover:bg-white/8 hover:text-white",
                      isActive && "bg-primary text-white shadow-lg shadow-blue-950/20",
                    )
                  }
                  onClick={onNavigate}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
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
