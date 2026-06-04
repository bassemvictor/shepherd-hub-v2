import type { ReactNode } from "react";

import { Button } from "../ui/button";

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  children?: ReactNode;
};

export const PageHeader = ({ title, description, action, children }: PageHeaderProps) => (
  <div className="flex flex-col gap-4 rounded-[1.4rem] border border-border/80 bg-white p-5 panel-shadow sm:p-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
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
