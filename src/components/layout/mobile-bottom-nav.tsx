import { BarChart3, CalendarDays, Ellipsis, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { cn } from "../../lib/utils";
import { Dialog } from "../ui/dialog";

type MobileBottomNavProps = {
  onOpenMore: () => void;
};

export const MobileBottomNav = ({ onOpenMore }: MobileBottomNavProps) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  const navItems = useMemo(
    () => [
      {
        label: "Schedule",
        href: "/calendar/schedule-beta",
        icon: CalendarDays,
        active: pathname === "/calendar/schedule-beta",
      },
      {
        label: "Members",
        href: "/members",
        icon: Users,
        active: pathname.startsWith("/members"),
      },
      {
        label: "Reports",
        href: "/reports",
        icon: BarChart3,
        active: pathname.startsWith("/reports"),
      },
    ],
    [pathname],
  );

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="mobile-bottom-nav lg:hidden"
      >
        <div className="mobile-bottom-nav__inner">
          <div className="mobile-bottom-nav__grid">
            {navItems.slice(0, 2).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  aria-current={item.active ? "page" : undefined}
                  aria-label={item.label}
                  className={({ isActive }) =>
                    cn("mobile-bottom-nav__item", (isActive || item.active) && "mobile-bottom-nav__item--active")
                  }
                  end={item.href === "/members"}
                  key={item.href}
                  to={item.href}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}

            <button
              aria-expanded={newMenuOpen}
              aria-haspopup="dialog"
              aria-label="Create new"
              className="mobile-bottom-nav__new"
              onClick={() => setNewMenuOpen(true)}
              type="button"
            >
              <span className="mobile-bottom-nav__new-button">
                <Plus className="h-7 w-7" />
              </span>
            </button>

            {navItems.slice(2).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  aria-current={item.active ? "page" : undefined}
                  aria-label={item.label}
                  className={({ isActive }) =>
                    cn("mobile-bottom-nav__item", (isActive || item.active) && "mobile-bottom-nav__item--active")
                  }
                  key={item.href}
                  to={item.href}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}

            <button
              aria-label="Open more options"
              className="mobile-bottom-nav__item"
              onClick={onOpenMore}
              type="button"
            >
              <Ellipsis className="h-5 w-5" />
              <span>More</span>
            </button>
          </div>
        </div>
      </nav>

      <Dialog
        description="Choose what you want to create next."
        onClose={() => setNewMenuOpen(false)}
        open={newMenuOpen}
        title="Create New"
      >
        <div className="space-y-2">
          <button
            className="schedule-beta-action-card"
            onClick={() => {
              setNewMenuOpen(false);
              navigate("/calendar/schedule-beta?mobileAction=new-event");
            }}
            type="button"
          >
            <CalendarDays className="h-5 w-5 text-primary" />
            <div className="text-left">
              <div className="font-semibold text-foreground">New Event</div>
              <div className="text-sm text-muted-foreground">Open the alternate Schedule event flow.</div>
            </div>
          </button>
          <button
            className="schedule-beta-action-card"
            onClick={() => {
              setNewMenuOpen(false);
              navigate("/members?mobileAction=new-member");
            }}
            type="button"
          >
            <Users className="h-5 w-5 text-primary" />
            <div className="text-left">
              <div className="font-semibold text-foreground">New Member</div>
              <div className="text-sm text-muted-foreground">Open the member creation form.</div>
            </div>
          </button>
        </div>
      </Dialog>
    </>
  );
};
