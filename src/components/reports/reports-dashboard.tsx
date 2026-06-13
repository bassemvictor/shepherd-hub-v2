import type { AppAuthUser } from "../../lib/auth";
import type { VisitationReportResponse } from "../../../shared/types";
import { DashboardKpiCard } from "./dashboard-kpi-card";
import { MembersRequiringAttentionCard } from "./members-requiring-attention-card";
import { ReportKpiStrip } from "./report-kpi-strip";
import { TopVisitorsCard } from "./top-visitors-card";
import { VisitDistributionDonutChart } from "./visit-distribution-donut-chart";
import {
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
  currentUser,
  onApplyDashboardFilter,
}: {
  report: VisitationReportResponse;
  scope: ReportScope;
  period: ReportPeriod;
  showFilter: ReportShowFilter;
  currentUser?: AppAuthUser | null;
  onApplyDashboardFilter: (filter: { view: "members"; show?: ReportShowFilter; period?: ReportPeriod }) => void;
}) => {
  const notVisitedCount = report.distribution.find((bucket) => bucket.key === "not_visited")?.count ?? 0;
  const totalMembers = report.summary.matchingMembers;
  const coverageData = [
    { key: "visited" as const, label: "Visited", count: Math.max(0, totalMembers - notVisitedCount) },
    { key: "need_visit" as const, label: "Need a Visit", count: notVisitedCount },
  ];
  const frequencyData = report.distribution.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
  }));

  const cards = showFilter === "need_visit"
    ? [
      {
        label: "Members Needing Visits",
        value: String(report.summary.matchingMembers),
        accent: "danger" as const,
        onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit" }),
      },
      {
        label: period === "all_time" ? "Never Visited" : "Not Visited",
        value: String(notVisitedCount),
        onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit", period: "all_time" }),
      },
      {
        label: "Avg Visits / Member",
        value: String(report.summary.averageVisitsPerMember),
        helper: getFilterSummary(showFilter, period),
        onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
      },
    ]
    : showFilter === "visited"
      ? [
        {
          label: "Members Visited",
          value: String(report.summary.matchingMembers),
          accent: "success" as const,
          onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
        },
        {
          label: "Visited In Period",
          value: String(report.summary.visitedInRangeMembers),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "visited" }),
        },
        {
          label: "Average Visits Per Member",
          value: String(report.summary.averageVisitsPerMember),
          helper: getFilterSummary(showFilter, period),
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
          label: period === "all_time" ? "Never Visited" : "Not Visited",
          value: String(notVisitedCount),
          onClick: () => onApplyDashboardFilter({ view: "members", show: "need_visit", period: "all_time" }),
        },
        {
          label: "Members Needing Visits",
          value: String(notVisitedCount),
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

      <ReportKpiStrip summary={report.summary} />

      <VisitDistributionDonutChart
        distribution={report.distribution}
        totalMembers={report.summary.matchingMembers}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <TopVisitorsCard entries={report.topVisitors} />
        <TopVisitorsCard
          title="My Visitation Activity"
          entries={[
            { visitorUserId: "week", visitorDisplayName: "Visits This Week", visitCountInRange: report.currentUserActivity.thisWeek },
            { visitorUserId: "month", visitorDisplayName: "Visits This Month", visitCountInRange: report.currentUserActivity.thisMonth },
            { visitorUserId: "year", visitorDisplayName: "Visits This Year", visitCountInRange: report.currentUserActivity.thisYear },
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
            <div className="text-sm font-semibold text-slate-900">Visit Frequency</div>
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
          title="Members Needing a Visit"
        />
      </div>
    </div>
  );
};
