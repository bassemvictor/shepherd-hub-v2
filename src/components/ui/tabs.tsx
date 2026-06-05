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
  <div className="-mx-2 overflow-x-auto overscroll-x-contain px-2 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:px-0">
    <div className="inline-flex min-w-full gap-1.5 rounded-md border border-border bg-white p-1.5">
      {items.map((item) => (
        <NavLink
          key={item.href}
          to={item.href}
          className={({ isActive }) =>
            cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors sm:px-3",
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
