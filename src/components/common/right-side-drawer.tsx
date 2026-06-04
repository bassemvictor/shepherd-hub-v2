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
          width === "lg" ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-5 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer ? <div className="border-t border-border px-5 py-4 sm:px-6">{footer}</div> : null}
      </aside>
    </div>
  );
};
