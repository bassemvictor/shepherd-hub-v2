import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

type ErrorStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export const ErrorState = ({ title, description, action }: ErrorStateProps) => (
  <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 p-6">
    <div className="flex items-start gap-3">
      <div className="rounded-full bg-white/80 p-2 text-rose-600">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-rose-900">{title}</h3>
        <p className="mt-1 text-sm text-rose-800/80">{description}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  </div>
);
