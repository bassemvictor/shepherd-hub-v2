import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "../../lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "h-8 w-full appearance-none rounded-md border border-border bg-white px-2.5 pr-8 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10",
        className,
      )}
      {...props}
    />
    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
  </div>
));

Select.displayName = "Select";
