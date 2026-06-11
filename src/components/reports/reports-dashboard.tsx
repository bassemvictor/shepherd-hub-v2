import type { AppAuthUser } from "../../lib/auth";
import type { CurrentUserVisitationActivity, VisitationOverviewRow, VisitorLeaderboardEntry } from "../../../shared/types";
import { DashboardKpiCard } from "./dashboard-kpi-card";
import { MembersRequiringAttentionCard } from "./members-requiring-attention-card";
import { TopVisitorsCard } from "./top-visitors-card";
import { VisitCoverageChart } from "./visit-coverage-chart";
import { VisitFrequencyChart } from "./visit-frequency-chart";
import {
  getAverageVisitsLabel,
  getCoverageChartData,
  getFrequencyChartData,
  getLastVisit,
  getMembersRequiringAttention,
  getNeverVisitedLabel,
  getOverdueLabel,
  getPeriodLabel,
  getRelevantVisits,
  getVisitCount,
  getVisitStatus,
  getVisitedLabel,
  type MemberStatusFilter,
  type ReportPeriod,
  type ReportScope,
} from "./visitation-report-utils";

export const ReportsDashboard = ({
  rows,
  scope,
  period,
  currentUser,
  topVisitors,
  currentUserActivity,
  onApplyDashboardFilter,
}: {
  rows: VisitationOverviewRow[];
  scope: ReportScope;
  period: ReportPeriod;
  currentUser?: AppAuthUser | null;
  topVisitors: VisitorLeaderboardEntry[];
  currentUserActivity: CurrentUserVisitationActivity;
  onApplyDashboardFilter: (filter: { view: "members"; status?: MemberStatusFilter }) => void;
}) => {
  const visitedCount = rows.filter((row) => getVisitCount(row, period, scope, currentUser) > 0).length;
  const overdueCount = rows.filter((row) => getVisitStatus(row, scope, currentUser) === "Overdue").length;
  const neverVisitedCount = rows.filter((row) => getRelevantVisits(row, scope, currentUser).totalLifetimeVisits === 0).length;
  const averageVisits = rows.length
    ? (rows.reduce((sum, row) => sum + getVisitCount(row, period, scope, currentUser), 0) / rows.length).toFixed(2)
    : "0.00";
  const attentionMembers = getMembersRequiringAttention(rows, scope, currentUser);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardKpiCard helper="All active members" label="Total Members" value={String(rows.length)} />
        <DashboardKpiCard
          accent="success"
          label={getVisitedLabel(period, scope)}
          onClick={() => onApplyDashboardFilter({ view: "members", status: "visited" })}
          value={String(visitedCount)}
        />
        <DashboardKpiCard
          accent="danger"
          label={getOverdueLabel(scope)}
          onClick={() => onApplyDashboardFilter({ view: "members", status: "not_visited_recently" })}
          value={String(overdueCount)}
        />
        <DashboardKpiCard
          accent="danger"
          label={getNeverVisitedLabel(scope)}
          onClick={() => onApplyDashboardFilter({ view: "members", status: "never_visited" })}
          value={String(neverVisitedCount)}
        />
        <DashboardKpiCard
          label={getAverageVisitsLabel(scope)}
          onClick={() => onApplyDashboardFilter({ view: "members" })}
          value={averageVisits}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <VisitCoverageChart data={getCoverageChartData(rows, scope, currentUser)} />
        <VisitFrequencyChart data={getFrequencyChartData(rows, scope, currentUser)} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {scope === "everyone" ? (
          <TopVisitorsCard entries={topVisitors} />
        ) : (
          <TopVisitorsCard
            title="My Visitation Activity"
            entries={[
              { visitorUserId: "week", visitorDisplayName: `Visits ${getPeriodLabel("this_week")}`, visitCountInRange: currentUserActivity.thisWeek },
              { visitorUserId: "month", visitorDisplayName: `Visits ${getPeriodLabel("this_month")}`, visitCountInRange: currentUserActivity.thisMonth },
              { visitorUserId: "year", visitorDisplayName: `Visits ${getPeriodLabel("this_year")}`, visitCountInRange: currentUserActivity.thisYear },
            ]}
          />
        )}
        <MembersRequiringAttentionCard
          getLastVisitLabel={(member) => getLastVisit(member, scope, currentUser)}
          members={attentionMembers}
          onViewAll={() => onApplyDashboardFilter({ view: "members", status: "not_visited_recently" })}
        />
      </div>
    </div>
  );
};
