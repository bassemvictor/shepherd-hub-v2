import { useEffect, useId, type ReactNode } from "react";

import { cn } from "../../lib/utils";

type DialogProps = {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: "md" | "lg";
};

export const Dialog = ({
  children,
  open,
  onClose,
  title,
  description,
  size = "md",
}: DialogProps) => {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-0 py-0 sm:items-start sm:px-4 sm:py-6">
      <button aria-label="Close dialog overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "relative z-10 flex max-h-screen w-full flex-col rounded-none border border-border bg-card text-card-foreground panel-shadow sm:max-h-[calc(100vh-3rem)] sm:rounded-md",
          size === "lg" ? "sm:max-w-lg" : "sm:max-w-md",
        )}
        role="dialog"
      >
        <div className="sticky top-0 z-[1] border-b border-border bg-card px-3 py-3 sm:px-4">
          <h3 className="text-sm font-semibold text-foreground sm:text-base" id={titleId}>{title}</h3>
          {description ? <p className="mt-1 text-xs text-muted-foreground sm:text-sm" id={descriptionId}>{description}</p> : null}
        </div>
        <div className="overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">{children}</div>
      </div>
    </div>
  );
};
