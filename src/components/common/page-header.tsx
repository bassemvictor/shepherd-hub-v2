import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

type PageHeaderProps = {
  title?: string;
  description?: string;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  children?: ReactNode;
};

export const PageHeader = ({
  title,
  description,
  className,
  titleClassName,
  descriptionClassName,
  action,
  children,
}: PageHeaderProps) => (
  <div className={cn("flex flex-col gap-3 rounded-md border border-border/80 bg-white p-3 panel-shadow", className)}>
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-1">
        {title ? <h1 className={cn("text-xl font-semibold text-slate-900", titleClassName)}>{title}</h1> : null}
        {description ? <p className={cn("max-w-3xl text-sm text-muted-foreground", descriptionClassName)}>{description}</p> : null}
      </div>
      {action ? (
        <Button className="w-full sm:w-auto" onClick={action.onClick} type="button">
          {action.label}
        </Button>
      ) : null}
    </div>
    {children}
  </div>
);
