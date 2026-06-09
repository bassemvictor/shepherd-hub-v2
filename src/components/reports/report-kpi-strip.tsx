import type { VisitationReportKpiSummary } from "../../../shared/types";

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

export const ReportKpiStrip = ({ summary }: { summary: VisitationReportKpiSummary }) => {
  const items = [
    { label: "Total Members", value: summary.totalMembers },
    { label: "Matching Members", value: summary.matchingMembers },
    { label: "Not Visited", value: summary.notVisitedMembers },
    { label: "Low Visitation", value: summary.lowVisitationMembers },
    { label: "Visited In Range", value: summary.visitedInRangeMembers },
    { label: "Avg Visits / Member", value: summary.averageVisitsPerMember },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      {items.map((item) => (
        <div
          className="rounded-lg border border-border bg-white px-3 py-2.5 panel-shadow"
          key={item.label}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(item.value)}</div>
        </div>
      ))}
    </div>
  );
};
