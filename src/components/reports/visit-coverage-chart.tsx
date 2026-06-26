import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const colors = {
  visited: "#0f766e",
  need_visit: "#e11d48",
};

export const VisitCoverageChart = ({
  data,
}: {
  data: ReadonlyArray<{ key: "visited" | "need_visit"; label: string; count: number }>;
}) => {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const visited = data.find((item) => item.key === "visited")?.count ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Visit Coverage</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
        <div className="relative h-44 w-full">
          <ResponsiveContainer aspect={1} minHeight={176} minWidth={0} width="100%">
            <PieChart>
              <Pie data={data} dataKey="count" innerRadius={48} outerRadius={72} paddingAngle={2} strokeWidth={0}>
                {data.map((item) => (
                  <Cell fill={colors[item.key]} key={item.key} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-2xl font-semibold text-slate-950">{visited}</div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Visited</div>
          </div>
        </div>
        <div className="space-y-2">
          {data.map((item) => (
            <div className="flex items-center justify-between rounded-md border border-border/80 px-3 py-2" key={item.key}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[item.key] }} />
                <span className="text-sm text-slate-900">{item.label}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-900">{item.count}</div>
                <div className="text-xs text-muted-foreground">
                  {total ? `${Math.round((item.count / total) * 100)}%` : "0%"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
