import { NavLink } from "react-router-dom";

import { cn } from "../../lib/utils";

type TabItem = {
  label: string;
  href: string;
};

type TabsProps = {
  items: TabItem[];
};

export const RouteTabs = ({ items }: TabsProps) => (
  <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:px-0">
    <div className="inline-flex min-w-full gap-2 rounded-2xl border border-border bg-white p-2">
      {items.map((item) => (
        <NavLink
          key={item.href}
          to={item.href}
          className={({ isActive }) =>
            cn(
              "rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors sm:px-4",
              isActive && "bg-primary text-primary-foreground",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  </div>
);
