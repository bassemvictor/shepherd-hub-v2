import type { AppAuthUser } from "../../lib/auth";
import type { ReportsVisitationTypeFilter, VisitationReportResponse } from "../../../shared/types";
import { DashboardKpiCard } from "./dashboard-kpi-card";
import { MembersRequiringAttentionCard } from "./members-requiring-attention-card";
import { ReportKpiStrip } from "./report-kpi-strip";
import { TopVisitorsCard } from "./top-visitors-card";
import { VisitDistributionDonutChart } from "./visit-distribution-donut-chart";
import {
  getActivityCopy,
  getFilterSummary,
  getLastVisit,
  type ReportPeriod,
  type ReportScope,
  type ReportShowFilter,
} from "./visitation-report-utils";

export const ReportsDashboard = ({
  report,
  scope,
  period,
  showFilter,
  visitationType,
  currentUser,
  onApplyDashboardFilter,
}: {
  report: VisitationReportResponse;
  scope: ReportScope;
  period: ReportPeriod;
  showFilter: ReportShowFilter;
  visitationType: ReportsVisitationTypeFilter;
  currentUser?: AppAuthUser | null;
  onApplyDashboardFilter: (filter: { view: "members"; show?: ReportShowFilter; period?: ReportPeriod }) => void;
}) => {
  const activityCopy = getActivityCopy(visitationType);
  const notVisitedCount = report.distribution.find((bucket) => bucket.key === "not_visited")?.count ?? 0;
  const totalMembers = report.summary.matchingMembers;
  const coverageData = [
    { key: "visited" as const, label: activityCopy.hasLabel, count: Math.max(0, totalMembers - notVisitedCount) },
    { key: "need_visit" as const, label: activityCopy.needsLabel, count: notVisitedCount },
  ];
  const frequencyData = report.distribution.map((bucket) => ({
    key: bucket.key,
    label: bucket.label
      .replace(/Visits/g, activityCopy.plural)
      .replace(/Visit/g, activityCopy.singular)
      .replace(/visits/g, activityCopy.pluralLower)
      .replace(/visit/g, activityCopy.singularLower),
    count: bucket.count,
  }));

  const cards = showFilter === "need_visit"
    ? [
      {
        label: `Members ${activityCopy.membersNeedingLabel}`,
        value: String(report.summary.matchingMembers),
        accent: "danger" as const,
        onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit" }),
      },
      {
        label: period === "all_time" ? `No ${activityCopy.plural}` : `No ${activityCopy.plural} In Period`,
        value: String(notVisitedCount),
        onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit", period: "all_time" }),
      },
      {
        label: `Avg ${activityCopy.plural} / Member`,
        value: String(report.summary.averageVisitsPerMember),
        helper: getFilterSummary(showFilter, period, visitationType),
        onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
      },
    ]
    : showFilter === "visited"
      ? [
        {
          label: `Members With ${activityCopy.plural}`,
          value: String(report.summary.matchingMembers),
          accent: "success" as const,
          onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
        },
        {
          label: `${activityCopy.plural} In Period`,
          value: String(report.summary.visitedInRangeMembers),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
        },
        {
          label: `Average ${activityCopy.plural} Per Member`,
          value: String(report.summary.averageVisitsPerMember),
          helper: getFilterSummary(showFilter, period, visitationType),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
        },
      ]
      : [
        {
          label: "Total Members",
          value: String(report.summary.totalMembers),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "everyone" }),
        },
        {
          label: period === "all_time" ? `No ${activityCopy.plural}` : `No ${activityCopy.plural} In Period`,
          value: String(notVisitedCount),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit", period: "all_time" }),
        },
        {
          label: `Members ${activityCopy.membersNeedingLabel}`,
          value: String(notVisitedCount),
          accent: "danger" as const,
          helper: getFilterSummary("need_visit", period, visitationType),
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

      <ReportKpiStrip summary={report.summary} visitationType={visitationType} />


      <VisitDistributionDonutChart
        activityTypeDistribution={report.activityTypeDistribution}
        distribution={report.distribution}
        totalMembers={report.summary.matchingMembers}
        visitationType={visitationType}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <TopVisitorsCard entries={report.topVisitors} subtitle="Activities in selected period" title="Top Contributors" />
        <TopVisitorsCard
          subtitle="Activities in selected period"
          title="My Activity"
          entries={[
            { visitorUserId: "week", visitorDisplayName: "Activities This Week", visitCountInRange: report.currentUserActivity.thisWeek },
            { visitorUserId: "month", visitorDisplayName: "Activities This Month", visitCountInRange: report.currentUserActivity.thisMonth },
            { visitorUserId: "year", visitorDisplayName: "Activities This Year", visitCountInRange: report.currentUserActivity.thisYear },
          ]}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-border bg-white p-3 panel-shadow">
          <div className="text-sm font-semibold text-slate-900">Coverage Snapshot</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {coverageData.map((item) => (
              <div className="rounded-md border border-border/80 px-3 py-2" key={item.key}>
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{item.count}</div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <div className="text-sm font-semibold text-slate-900">{activityCopy.singular} Frequency</div>
            <div className="mt-2 space-y-2">
              {frequencyData.map((item) => (
                <div className="flex items-center justify-between rounded-md border border-border/80 px-3 py-2" key={item.key}>
                  <div className="text-sm text-slate-900">{item.label}</div>
                  <div className="text-sm font-semibold text-slate-900">{item.count}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <MembersRequiringAttentionCard
          getLastVisitLabel={(member) => getLastVisit(member, scope, currentUser)}
          members={report.attentionMembers}
          onViewAll={() => onApplyDashboardFilter({ view: "members", show: "need_visit" })}
          title={`Members ${activityCopy.membersNeedingLabel}`}
          visitationType={visitationType}
        />
      </div>
    </div>
  );
};
