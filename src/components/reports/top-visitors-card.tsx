import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export const TopVisitorsCard = ({
  title = "Top Visitors",
  entries,
}: {
  title?: string;
  entries: Array<{ visitorUserId: string; visitorDisplayName: string; visitCountInRange: number }>;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2">
      {entries.length ? entries.map((entry, index) => (
        <div className="flex items-center justify-between rounded-md border border-border/80 px-3 py-2" key={entry.visitorUserId}>
          <div>
            <div className="text-sm font-medium text-slate-900">{index + 1}. {entry.visitorDisplayName}</div>
            <div className="text-xs text-muted-foreground">Visits in selected period</div>
          </div>
          <div className="text-lg font-semibold text-slate-950">{entry.visitCountInRange}</div>
        </div>
      )) : (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No visitors match this filter.
        </div>
      )}
    </CardContent>
  </Card>
);
