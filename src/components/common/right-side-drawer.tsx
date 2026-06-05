import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type RightSideDrawerProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: "md" | "lg";
};

export const RightSideDrawer = ({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  width = "md",
}: RightSideDrawerProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Close drawer overlay"
        className="absolute inset-0 bg-slate-950/35"
        onClick={onClose}
        type="button"
      />
      <aside
        className={cn(
          "absolute inset-y-0 right-0 flex h-full w-full flex-col border-l border-border bg-white panel-shadow",
          width === "lg" ? "lg:max-w-[31rem]" : "lg:max-w-[26rem]",
        )}
      >
        <div className="sticky top-0 z-[1] flex items-start justify-between gap-3 border-b border-border bg-white px-3 py-3 sm:px-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 sm:text-base">{title}</h2>
            {description ? <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{description}</p> : null}
          </div>
          <Button onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">{children}</div>
        {footer ? <div className="sticky bottom-0 border-t border-border bg-white px-3 py-3 sm:px-4">{footer}</div> : null}
      </aside>
    </div>
  );
};
