import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import type { VisitationDistributionBucket } from "../../../shared/types";

const bucketColors: Record<VisitationDistributionBucket["key"], string> = {
  not_visited: "#e11d48",
  one_visit: "#0f766e",
  two_to_three: "#2563eb",
  four_to_six: "#7c3aed",
  seven_plus: "#0f172a",
};

const percentLabel = (value: number) => `${value.toFixed(0)}%`;

const Donut = ({
  distribution,
  centerLabel,
  centerSubLabel,
}: {
  distribution: VisitationDistributionBucket[];
  centerLabel: string;
  centerSubLabel: string;
}) => (
  <div className="relative h-56 w-full">
    <ResponsiveContainer height="100%" width="100%">
      <PieChart>
        <Pie
          cx="50%"
          cy="50%"
          data={distribution}
          dataKey="count"
          innerRadius={56}
          outerRadius={86}
          paddingAngle={2}
          strokeWidth={0}
        >
          {distribution.map((bucket) => (
            <Cell fill={bucketColors[bucket.key]} key={bucket.key} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
      <div className="text-2xl font-semibold text-slate-900">{centerLabel}</div>
      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {centerSubLabel}
      </div>
    </div>
  </div>
);

export const VisitDistributionDonutChart = ({
  distribution,
  totalMembers,
}: {
  distribution: VisitationDistributionBucket[];
  totalMembers: number;
}) => {
  const visitedPercent = totalMembers
    ? 100 - (distribution.find((bucket) => bucket.key === "not_visited")?.percentage ?? 0)
    : 0;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
      <div className="rounded-lg border border-border bg-white p-3 panel-shadow">
        <div className="text-sm font-semibold text-slate-900">Visit Count Distribution</div>
        <div className="mt-2">
          <Donut centerLabel={String(totalMembers)} centerSubLabel="Members" distribution={distribution} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white p-3 panel-shadow">
        <div className="text-sm font-semibold text-slate-900">Coverage Mix</div>
        <div className="mt-2">
          <Donut centerLabel={percentLabel(visitedPercent)} centerSubLabel="Visited" distribution={distribution} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white p-3 panel-shadow">
        <div className="text-sm font-semibold text-slate-900">Legend</div>
        <div className="mt-3 space-y-2">
          {distribution.map((bucket) => (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/80 px-2.5 py-2" key={bucket.key}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: bucketColors[bucket.key] }} />
                <span className="text-sm text-slate-900">{bucket.label}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-900">{bucket.count}</div>
                <div className="text-xs text-muted-foreground">{percentLabel(bucket.percentage)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
