import { ArrowRight } from "lucide-react";

import { Card, CardContent } from "../ui/card";
import { cn } from "../../lib/utils";

export const DashboardKpiCard = ({
  label,
  value,
  helper,
  accent = "default",
  onClick,
}: {
  label: string;
  value: string;
  helper?: string;
  accent?: "default" | "danger" | "success";
  onClick?: () => void;
}) => (
  <button
    className="text-left"
    onClick={onClick}
    type="button"
  >
    <Card
      className={cn(
        "h-full min-w-0 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
        accent === "danger" && "border-rose-200/80 bg-rose-50/50",
        accent === "success" && "border-emerald-200/80 bg-emerald-50/50",
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold leading-none text-slate-950">{value}</div>
        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{helper ?? "Open member view"}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </CardContent>
    </Card>
  </button>
);
