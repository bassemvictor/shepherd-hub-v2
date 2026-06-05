import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

type ErrorStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export const ErrorState = ({ title, description, action }: ErrorStateProps) => (
  <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
    <div className="flex items-start gap-3">
      <div className="rounded-full bg-white/80 p-1.5 text-rose-600">
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-rose-900">{title}</h3>
        <p className="mt-1 text-sm text-rose-800/80">{description}</p>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  </div>
);
