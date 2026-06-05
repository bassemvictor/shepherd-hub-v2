import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export const EmptyState = ({ title, description, action }: EmptyStateProps) => (
  <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border bg-slate-50 px-4 py-6">
    <div className="max-w-md text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-700">
        <Inbox className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  </div>
);
