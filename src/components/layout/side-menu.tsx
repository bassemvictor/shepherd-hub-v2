import { FolderKanban, Home } from "lucide-react";
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
];

type SideMenuProps = {
  onNavigate?: () => void;
  user: AppAuthUser | null;
};

export const SideMenu = ({ onNavigate }: SideMenuProps) => {
  const sections = baseNavigation;

  return (
    <nav className="flex-1 space-y-7">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="mb-3 text-xs uppercase tracking-[0.18em] text-blue-200/60">
            {section.label}
          </p>
          <div className="space-y-1.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-blue-100/80 transition-colors hover:bg-white/8 hover:text-white",
                      isActive && "bg-primary text-white shadow-lg shadow-blue-950/20",
                    )
                  }
                  onClick={onNavigate}
                >
                  {Icon ? <Icon className="h-4 w-4" /> : null}
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
