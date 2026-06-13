import type { AppAuthUser } from "../../lib/auth";
import type { VisitationOverviewRow, VisitationReportResponse } from "../../../shared/types";
import { DashboardKpiCard } from "./dashboard-kpi-card";
import { MembersRequiringAttentionCard } from "./members-requiring-attention-card";
import { TopVisitorsCard } from "./top-visitors-card";
import { VisitCoverageChart } from "./visit-coverage-chart";
import { VisitFrequencyChart } from "./visit-frequency-chart";
import {
  getAverageDaysSinceLastVisit,
  getCoverageChartData,
  getFilterSummary,
  getFrequencyChartData,
  getLastVisit,
  getNeverVisitedCount,
  getTotalVisits,
  matchesShowFilter,
  needsVisitInPeriod,
  sortMembersForDisplay,
  type ReportPeriod,
  type ReportScope,
  type ReportShowFilter,
} from "./visitation-report-utils";

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

export const ReportsDashboard = ({
  report,
  rows,
  scope,
  period,
  showFilter,
  currentUser,
  onApplyDashboardFilter,
}: {
  report: VisitationReportResponse;
  rows: VisitationOverviewRow[];
  scope: ReportScope;
  period: ReportPeriod;
  showFilter: ReportShowFilter;
  currentUser?: AppAuthUser | null;
  onApplyDashboardFilter: (filter: { view: "members"; show?: ReportShowFilter; period?: ReportPeriod }) => void;
}) => {
  const filteredRows = rows.filter((row) => matchesShowFilter(row, period, scope, showFilter, currentUser));
  const membersNeedingVisits = rows.filter((row) => needsVisitInPeriod(row, period, scope, currentUser)).length;
  const neverVisitedCount = getNeverVisitedCount(rows, scope, currentUser);
  const totalVisits = getTotalVisits(filteredRows, period, scope, currentUser);
  const averageDaysSinceLastVisit = getAverageDaysSinceLastVisit(filteredRows, scope, currentUser);
  const averageVisitsPerMember = filteredRows.length ? totalVisits / filteredRows.length : 0;
  const coverageData = getCoverageChartData(rows, period, scope, currentUser);
  const frequencyData = getFrequencyChartData(rows, period, scope, currentUser);
  const membersNeedingVisitRows = sortMembersForDisplay(
    rows.filter((row) => needsVisitInPeriod(row, period, scope, currentUser)),
    period,
    scope,
    currentUser,
  ).slice(0, 5);

  const cards = showFilter === "need_visit"
    ? [
      {
        label: "Members Needing Visits",
        value: String(filteredRows.length),
        accent: "danger" as const,
        onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit" }),
      },
      {
        label: "Never Visited",
        value: String(filteredRows.filter((row) => row.totalLifetimeVisits === 0).length),
        onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit", period: "all_time" }),
      },
      {
        label: "Average Days Since Last Visit",
        value: averageDaysSinceLastVisit === null ? "Never" : String(averageDaysSinceLastVisit),
        helper: getFilterSummary(showFilter, period),
        onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit" }),
      },
    ]
    : showFilter === "visited"
      ? [
        {
          label: "Members Visited",
          value: String(filteredRows.length),
          accent: "success" as const,
          onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
        },
        {
          label: "Total Visits",
          value: String(totalVisits),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
        },
        {
          label: "Average Visits Per Member",
          value: formatNumber(averageVisitsPerMember),
          helper: getFilterSummary(showFilter, period),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
        },
      ]
      : [
        {
          label: "Total Members",
          value: String(rows.length),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "everyone" }),
        },
        {
          label: "Never Visited",
          value: String(neverVisitedCount),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit", period: "all_time" }),
        },
        {
          label: "Members Needing Visits",
          value: String(membersNeedingVisits),
          accent: "danger" as const,
          helper: getFilterSummary("need_visit", period),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit" }),
        },
      ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <DashboardKpiCard
            accent={card.accent}
            helper={card.helper}
            key={card.label}
            label={card.label}
            onClick={card.onClick}
            value={card.value}
          />
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <VisitCoverageChart data={coverageData} />
        <VisitFrequencyChart data={frequencyData} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {scope === "everyone" ? (
          <TopVisitorsCard entries={report.topVisitors} />
        ) : (
          <TopVisitorsCard
            title="My Visitation Activity"
            entries={[
              { visitorUserId: "year", visitorDisplayName: "Visits This Year", visitCountInRange: report.currentUserActivity.thisYear },
            ]}
          />
        )}
        <MembersRequiringAttentionCard
          getLastVisitLabel={(member) => getLastVisit(member, scope, currentUser)}
          members={membersNeedingVisitRows}
          onViewAll={() => onApplyDashboardFilter({ view: "members", show: "need_visit" })}
          title="Members Needing a Visit"
        />
      </div>
    </div>
  );
};
