import type { AppAuthUser } from "../../lib/auth";
import type { VisitationReportResponse } from "../../../shared/types";
import { DashboardKpiCard } from "./dashboard-kpi-card";
import { MembersRequiringAttentionCard } from "./members-requiring-attention-card";
import { TopVisitorsCard } from "./top-visitors-card";
import { VisitCoverageChart } from "./visit-coverage-chart";
import { VisitFrequencyChart } from "./visit-frequency-chart";
import {
  getAverageVisitsLabel,
  getLastVisit,
  getNeverVisitedLabel,
  getOverdueLabel,
  getPeriodLabel,
  getVisitedLabel,
  type MemberStatusFilter,
  type ReportPeriod,
  type ReportScope,
} from "./visitation-report-utils";

export const ReportsDashboard = ({
  report,
  scope,
  period,
  currentUser,
  onApplyDashboardFilter,
}: {
  report: VisitationReportResponse;
  scope: ReportScope;
  period: ReportPeriod;
  currentUser?: AppAuthUser | null;
  onApplyDashboardFilter: (filter: { view: "members"; status?: MemberStatusFilter }) => void;
}) => {
  const visitedCount = report.summary.visitedInRangeMembers;
  const overdueCount = report.summary.overdueMembers;
  const neverVisitedCount = report.summary.notVisitedMembers;
  const averageVisits = report.summary.averageVisitsPerMember.toFixed(2);
  const coverageData = [
    { key: "visited" as const, label: "Visited", count: report.summary.matchingMembers - report.summary.notVisitedMembers },
    { key: "not_visited" as const, label: "Not Visited", count: report.summary.notVisitedMembers },
  ];
  const frequencyData = report.distribution.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
  }));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardKpiCard helper="All active members" label="Total Members" value={String(report.summary.totalMembers)} />
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
              { visitorUserId: "week", visitorDisplayName: `Visits ${getPeriodLabel("this_week")}`, visitCountInRange: report.currentUserActivity.thisWeek },
              { visitorUserId: "month", visitorDisplayName: `Visits ${getPeriodLabel("this_month")}`, visitCountInRange: report.currentUserActivity.thisMonth },
              { visitorUserId: "year", visitorDisplayName: `Visits ${getPeriodLabel("this_year")}`, visitCountInRange: report.currentUserActivity.thisYear },
            ]}
          />
        )}
        <MembersRequiringAttentionCard
          getLastVisitLabel={(member) => getLastVisit(member, scope, currentUser)}
          members={report.attentionMembers}
          onViewAll={() => onApplyDashboardFilter({ view: "members", status: "not_visited_recently" })}
        />
      </div>
    </div>
  );
};
