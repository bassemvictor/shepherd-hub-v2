import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const frequencyColors = ["#cbd5e1", "#0f766e", "#2563eb", "#7c3aed", "#0f172a"];

export const VisitFrequencyChart = ({
  data,
}: {
  data: ReadonlyArray<{ key: string; label: string; count: number }>;
}) => {
  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Visit Frequency</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
        <div className="relative h-44 w-full">
          <ResponsiveContainer height="100%" width="100%">
            <PieChart>
              <Pie data={data} dataKey="count" innerRadius={48} outerRadius={72} paddingAngle={2} strokeWidth={0}>
                {data.map((item, index) => (
                  <Cell fill={frequencyColors[index] ?? "#64748b"} key={item.key} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-2xl font-semibold text-slate-950">{total}</div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Members</div>
          </div>
        </div>
        <div className="space-y-2">
          {data.map((item, index) => (
            <div className="flex items-center justify-between rounded-md border border-border/80 px-3 py-2" key={item.key}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: frequencyColors[index] ?? "#64748b" }} />
                <span className="text-sm text-slate-900">{item.label}</span>
              </div>
              <div className="text-sm font-semibold text-slate-900">{item.count}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
