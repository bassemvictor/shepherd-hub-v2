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
  headerLeading?: ReactNode;
  panelClassName?: string;
  contentClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export const RightSideDrawer = ({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  width = "md",
  headerLeading,
  panelClassName,
  contentClassName,
  headerClassName,
  footerClassName,
  titleClassName,
  descriptionClassName,
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
          "absolute inset-y-0 right-0 flex h-full w-full flex-col border-l border-border bg-card text-card-foreground panel-shadow",
          width === "lg" ? "lg:max-w-[36rem]" : "lg:max-w-[26rem]",
          panelClassName,
        )}
      >
        <div className={cn("sticky top-0 z-[1] flex items-start justify-between gap-3 border-b border-border bg-card px-3 py-3 sm:px-4", headerClassName)}>
          <div className="flex min-w-0 items-start gap-3">
            {headerLeading}
            <div className="min-w-0">
              <h2 className={cn("text-sm font-semibold text-foreground sm:text-base", titleClassName)}>{title}</h2>
              {description ? <p className={cn("mt-1 text-xs text-muted-foreground sm:text-sm", descriptionClassName)}>{description}</p> : null}
            </div>
          </div>
          <Button onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4", contentClassName)}>{children}</div>
        {footer ? <div className={cn("sticky bottom-0 border-t border-border bg-card px-3 py-3 sm:px-4", footerClassName)}>{footer}</div> : null}
      </aside>
    </div>
  );
};
