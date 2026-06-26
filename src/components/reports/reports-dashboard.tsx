import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";

import type { ReportsVisitationTypeFilter, VisitationReportResponse } from "../../../shared/types";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { getActivityCopy } from "./visitation-report-utils";

const getTypeLabels = (visitationType: ReportsVisitationTypeFilter) => {
  if (visitationType === "all") {
    return {
      totalLabel: "Total Care Activities",
      coverageLabel: "Care Coverage",
      attentionLabel: "Members Needing Attention",
      receivedLabel: "Members Receiving Care",
      coverageMembersLabel: "members received care",
      coverageSummaryLabel: "members received care",
      trendLabel: "Monthly Care Activity Trend",
      breakdownLabel: "Care Breakdown",
      emptyTrendLabel: "No care activity trend is available for the selected filters.",
      emptyBreakdownLabel: "No care activities match these filters.",
      tooltipMetricLabel: "Care Activities",
      centerMetricLabel: "Care Activities",
    };
  }

  if (visitationType === "Visitation") {
    return {
      totalLabel: "Total Visitations",
      coverageLabel: "Visitation Coverage",
      attentionLabel: "Members Needing Visitation",
      receivedLabel: "Members Receiving Visits",
      coverageMembersLabel: "members received visitation",
      coverageSummaryLabel: "members received visitation",
      trendLabel: "Monthly Visitation Trend",
      breakdownLabel: "Visitation Breakdown",
      emptyTrendLabel: "No visitation trend is available for the selected filters.",
      emptyBreakdownLabel: "No visitations match these filters.",
      tooltipMetricLabel: "Visitations",
      centerMetricLabel: "Visitations",
    };
  }

  const pluralLabel = visitationType === "Phone Call"
    ? "Phone Calls"
    : visitationType === "Confession"
      ? "Confessions"
      : visitationType === "Meeting"
        ? "Meetings"
        : visitationType === "Other"
          ? "Other Activities"
          : `${visitationType}s`;

  const activityCopy = getActivityCopy(visitationType);
  return {
    totalLabel: `Total ${pluralLabel}`,
    coverageLabel: `${visitationType} Coverage`,
    attentionLabel: `Members Needing ${pluralLabel}`,
    receivedLabel: `Members Receiving ${pluralLabel}`,
    coverageMembersLabel: `members received ${visitationType.toLowerCase()}`,
    coverageSummaryLabel: `members received ${visitationType.toLowerCase()}`,
    trendLabel: `Monthly ${visitationType} Trend`,
    breakdownLabel: `${visitationType} Breakdown`,
    emptyTrendLabel: `No ${visitationType.toLowerCase()} trend is available for the selected filters.`,
    emptyBreakdownLabel: `No ${pluralLabel.toLowerCase()} match these filters.`,
    tooltipMetricLabel: pluralLabel,
    centerMetricLabel: pluralLabel,
  };
};

const kpiCards = (report: VisitationReportResponse, visitationType: ReportsVisitationTypeFilter, attentionLabel: string) => [
  { label: "Members", value: report.summary.totalMembers },
  { label: attentionLabel, value: report.summary.notVisitedMembers },
  { label: getTypeLabels(visitationType).receivedLabel, value: report.summary.visitedInRangeMembers },
  { label: getTypeLabels(visitationType).totalLabel, value: report.activityTypeDistribution.find((bucket) => bucket.key === "all")?.count ?? 0 },
];

const donutColors: Record<string, string> = {
  Visitation: "#2563eb",
  Confession: "#0f766e",
  "Phone Call": "#d97706",
  Meeting: "#7c3aed",
  Other: "#64748b",
};

const formatPercent = (value: number) => `${Math.round(value)}%`;

const MeasuredChartFrame = ({
  aspect,
  className,
  minHeight,
  children,
}: {
  aspect: number;
  className?: string;
  minHeight: number;
  children: (size: { width: number; height: number }) => ReactNode;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof window === "undefined") {
      return;
    }

    const updateWidth = () => {
      setWidth(element.getBoundingClientRect().width);
    };

    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const height = width > 0 ? Math.max(minHeight, width / aspect) : minHeight;

  return (
    <div className={className} ref={containerRef}>
      {width > 0 ? children({ width, height }) : null}
    </div>
  );
};

export const ReportsDashboard = ({
  report,
  visitationType,
}: {
  report: VisitationReportResponse;
  visitationType: ReportsVisitationTypeFilter;
}) => {
  const labels = getTypeLabels(visitationType);
  const totalMembers = report.summary.totalMembers;
  const visitedMembers = report.summary.visitedInRangeMembers;
  const coveragePercent = totalMembers > 0 ? Math.round((visitedMembers / totalMembers) * 100) : 0;
  const coverageProgress = totalMembers > 0 ? (visitedMembers / totalMembers) * 100 : 0;
  const activityMix = report.activityTypeDistribution.filter((bucket) => bucket.key !== "all" && bucket.count > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards(report, visitationType, labels.attentionLabel).map((card) => (
          <Card className="rounded-xl" key={card.label}>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{card.label}</div>
              <div className="mt-3 text-3xl font-semibold leading-none text-slate-900">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:auto-rows-fr xl:grid-cols-3">
        <Card className="flex h-full flex-col rounded-xl">
          <CardHeader className="p-4 pb-0">
            <div>
              <CardTitle>{labels.coverageLabel}</CardTitle>
              <div className="text-sm text-muted-foreground">Member coverage for the selected period.</div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-5 p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-5xl font-semibold leading-none text-slate-900">{coveragePercent}%</div>
                <div className="mt-2 text-sm text-muted-foreground">{labels.coverageMembersLabel}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-primary" style={{ width: `${coverageProgress}%` }} />
              </div>
              <div className="text-sm text-slate-700">{visitedMembers} of {totalMembers} {labels.coverageSummaryLabel}</div>
            </div>

            <div className="mt-auto space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">{labels.breakdownLabel}</div>
              {report.visitedBreakdownByType.some((bucket) => bucket.memberCount > 0) ? (
                report.visitedBreakdownByType
                  .filter((bucket) => bucket.memberCount > 0)
                  .map((bucket) => (
                    <div className="flex items-center justify-between py-1" key={bucket.key}>
                      <div className="text-sm text-slate-900">{bucket.label}</div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-slate-900">{bucket.memberCount} members</div>
                        <div className="text-xs text-muted-foreground">{formatPercent(bucket.percentage)}</div>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  No visited members match these filters.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="flex h-full flex-col rounded-xl">
          <CardHeader className="p-4 pb-0">
            <div>
              <CardTitle>{labels.trendLabel}</CardTitle>
              <div className="text-sm text-muted-foreground">Total activity by month.</div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 p-4">
            {report.monthlyActivityTrend.length ? (
              <MeasuredChartFrame aspect={1.7} className="h-72 w-full min-w-0 self-stretch" minHeight={288}>
                {({ width, height }) => (
                  <BarChart data={report.monthlyActivityTrend} height={height} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} width={width}>
                    <XAxis axisLine={false} dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} tickLine={false} />
                    <YAxis allowDecimals={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 12 }} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, borderColor: "#dbe4f0", boxShadow: "0 12px 30px rgba(16, 33, 61, 0.08)" }}
                      cursor={{ fill: "rgba(37, 99, 235, 0.08)" }}
                      formatter={(value) => [Number(value ?? 0), labels.tooltipMetricLabel]}
                      labelFormatter={(label) => label}
                    />
                    <Bar dataKey="count" fill="#2563eb" radius={[10, 10, 0, 0]} />
                  </BarChart>
                )}
              </MeasuredChartFrame>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
                {labels.emptyTrendLabel}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col rounded-xl">
          <CardHeader className="p-4 pb-0">
            <div>
              <CardTitle>{labels.breakdownLabel}</CardTitle>
              <div className="text-sm text-muted-foreground">Total activity by type.</div>
            </div>
          </CardHeader>
          <CardContent className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_190px] lg:items-center">
            {activityMix.length ? (
              <>
                <MeasuredChartFrame aspect={1} className="relative h-72 w-full min-w-0" minHeight={288}>
                  {({ width, height }) => (
                    <>
                      <PieChart height={height} width={width}>
                        <Pie
                          cx="50%"
                          cy="50%"
                          data={activityMix}
                          dataKey="count"
                          innerRadius={68}
                          outerRadius={102}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {activityMix.map((bucket) => (
                            <Cell fill={donutColors[bucket.key] ?? donutColors.Other} key={bucket.key} />
                          ))}
                        </Pie>
                      </PieChart>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                        <div className="text-3xl font-semibold text-slate-900">
                          {report.activityTypeDistribution.find((bucket) => bucket.key === "all")?.count ?? 0}
                        </div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{labels.centerMetricLabel}</div>
                      </div>
                    </>
                  )}
                </MeasuredChartFrame>
                <div className="space-y-2">
                  {activityMix.map((bucket) => (
                    <div className="rounded-lg border border-border/80 px-3 py-2.5" key={bucket.key}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: donutColors[bucket.key] ?? donutColors.Other }} />
                          <span className="text-sm text-slate-900">{bucket.key === "Visitation" ? "Visit" : bucket.label}</span>
                        </div>
                        <div className="text-sm font-semibold text-slate-900">{bucket.count}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatPercent(bucket.percentage)}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground lg:col-span-2">
                {labels.emptyBreakdownLabel}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
