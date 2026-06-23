import type { ReportsVisitationTypeFilter, VisitationReportKpiSummary } from "../../../shared/types";
import { getActivityCopy } from "./visitation-report-utils";

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

export const ReportKpiStrip = ({
  summary,
  visitationType,
}: {
  summary: VisitationReportKpiSummary;
  visitationType: ReportsVisitationTypeFilter;
}) => {
  const activityCopy = getActivityCopy(visitationType);
  const items = [
    { label: "Total Members", value: summary.totalMembers },
    { label: "Matching Members", value: summary.matchingMembers },
    { label: `No ${activityCopy.plural}`, value: summary.notVisitedMembers },
    { label: `Members ${activityCopy.membersNeedingLabel}`, value: summary.overdueMembers + summary.lowVisitationMembers },
    { label: `Members With ${activityCopy.plural}`, value: summary.visitedInRangeMembers },
    { label: `Avg ${activityCopy.plural} / Member`, value: summary.averageVisitsPerMember },
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
