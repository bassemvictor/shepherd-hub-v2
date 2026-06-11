import { cn } from "../../lib/utils";

import type { ReportScope } from "./visitation-report-utils";

export const ScopeToggle = ({
  scope,
  onChange,
}: {
  scope: ReportScope;
  onChange: (scope: ReportScope) => void;
}) => (
  <div className="inline-flex rounded-full border border-border bg-slate-100 p-1">
    {[
      { id: "me", label: "Me" },
      { id: "everyone", label: "Everyone" },
    ].map((item) => (
      <button
        className={cn(
          "rounded-full px-3 py-1.5 text-xs font-semibold transition sm:px-4",
          scope === item.id ? "bg-white text-slate-900 shadow-sm" : "text-muted-foreground hover:text-slate-900",
        )}
        key={item.id}
        onClick={() => onChange(item.id as ReportScope)}
        type="button"
      >
        {item.label}
      </button>
    ))}
  </div>
);
