import * as React from "react";

import { cn } from "../../lib/utils";

type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded border-border text-primary outline-none focus:ring-4 focus:ring-primary/15",
        className,
      )}
      {...props}
    />
  ),
);

Checkbox.displayName = "Checkbox";
