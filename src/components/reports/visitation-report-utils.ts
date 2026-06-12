import type { AppAuthUser } from "../../lib/auth";
import type { VisitationOverviewRow, VisitationReportFilters, VisitationScopeMetrics } from "../../../shared/types";

export type ReportScope = "me" | "everyone";
export type ReportView = "dashboard" | "members";
export type ReportPeriod = "this_week" | "this_month" | "this_year" | "custom";
export type MemberStatusFilter = "all" | "never_visited" | "not_visited_recently" | "low_visitation" | "visited";
export type AttentionBucket = "never_visited" | "overdue";

export const OVERDUE_DAYS = 90;

export const getPeriodDateRange = (period: ReportPeriod, customFrom?: string, customTo?: string) => {
  const now = new Date();

  if (period === "custom") {
    return {
      from: customFrom ? new Date(`${customFrom}T00:00:00.000Z`).toISOString() : undefined,
      to: customTo ? new Date(`${customTo}T23:59:59.999Z`).toISOString() : undefined,
      sinceBeginning: false,
    };
  }

  if (period === "this_week") {
    const start = new Date(now);
    const day = start.getDay();
    const diff = (day + 6) % 7;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: undefined, sinceBeginning: false };
  }

  if (period === "this_month") {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: undefined,
      sinceBeginning: false,
    };
  }

  return {
    from: new Date(now.getFullYear(), 0, 1).toISOString(),
    to: undefined,
    sinceBeginning: false,
  };
};

export const buildReportFilters = (
  period: ReportPeriod,
  selectedVisitorUserId?: string,
  customFrom?: string,
  customTo?: string,
): VisitationReportFilters => {
  const range = getPeriodDateRange(period, customFrom, customTo);

  return {
    ...range,
    visitCountMode: "all",
    visitCountThreshold: 1,
    visitorMode: selectedVisitorUserId ? "specific" : "any",
    visitorUserId: selectedVisitorUserId,
    memberScope: "active_only",
    memberSource: "all",
    status: "all",
    group: undefined,
    search: undefined,
    sortBy: "member_name",
    sortDirection: "asc",
    page: 1,
    pageSize: 100,
  };
};

export const getRelevantVisits = (
  member: VisitationOverviewRow,
  scope: ReportScope,
  _currentUser?: AppAuthUser | null,
): VisitationScopeMetrics => (scope === "me"
  ? member.scopeMetrics.me
  : {
    visitCountInRange: member.visitCountInRange,
    totalLifetimeVisits: member.totalLifetimeVisits,
    lastVisitDate: member.lastVisitDate,
    lastVisitedBy: member.lastVisitedBy,
  });

export const getVisitCount = (
  member: VisitationOverviewRow,
  _period: ReportPeriod,
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => getRelevantVisits(member, scope, currentUser).visitCountInRange;

export const getLastVisit = (
  member: VisitationOverviewRow,
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => getRelevantVisits(member, scope, currentUser).lastVisitDate;

export const getDaysSinceLastVisit = (value?: string) => {
  if (!value) {
    return null;
  }

  const diff = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
};

export const getVisitStatus = (
  member: VisitationOverviewRow,
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => {
  const relevant = getRelevantVisits(member, scope, currentUser);
  const daysSinceLastVisit = getDaysSinceLastVisit(relevant.lastVisitDate);

  if (relevant.totalLifetimeVisits === 0) {
    return "Never Visited" as const;
  }

  if (daysSinceLastVisit !== null && daysSinceLastVisit > OVERDUE_DAYS) {
    return "Overdue" as const;
  }

  if (relevant.visitCountInRange <= 1) {
    return "Low Visitation" as const;
  }

  return "Healthy" as const;
};

export const matchesStatusFilter = (
  member: VisitationOverviewRow,
  scope: ReportScope,
  statusFilter: MemberStatusFilter,
  currentUser?: AppAuthUser | null,
) => {
  const status = getVisitStatus(member, scope, currentUser);

  if (statusFilter === "all") {
    return true;
  }

  if (statusFilter === "never_visited") {
    return status === "Never Visited";
  }

  if (statusFilter === "not_visited_recently") {
    return status === "Overdue";
  }

  if (statusFilter === "low_visitation") {
    return status === "Low Visitation";
  }

  return status === "Healthy";
};

export const formatReportDate = (value?: string) => {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
};

export const formatRelativeVisitAge = (value?: string) => {
  const days = getDaysSinceLastVisit(value);
  if (days === null) {
    return "Never";
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "1 day ago";
  }
  return `${days} days ago`;
};

export const getPeriodLabel = (period: ReportPeriod) => {
  if (period === "this_week") {
    return "This Week";
  }
  if (period === "this_month") {
    return "This Month";
  }
  if (period === "this_year") {
    return "This Year";
  }
  return "Custom";
};

export const getVisitedLabel = (period: ReportPeriod, scope: ReportScope) => {
  const base = `Visited ${getPeriodLabel(period)}`;
  return scope === "me" ? `${base} by Me` : base;
};

export const getAverageVisitsLabel = (scope: ReportScope) =>
  scope === "me" ? "Average Visits / Member by Me" : "Average Visits / Member";

export const getNeverVisitedLabel = (scope: ReportScope) =>
  scope === "me" ? "Never Visited by Me" : "Never Visited";

export const getOverdueLabel = (scope: ReportScope) =>
  scope === "me" ? "Not Visited > 90 Days by Me" : "Not Visited > 90 Days";

export const getCoverageChartData = (rows: VisitationOverviewRow[], scope: ReportScope, currentUser?: AppAuthUser | null) => {
  const visited = rows.filter((row) => getRelevantVisits(row, scope, currentUser).totalLifetimeVisits > 0).length;
  const notVisited = rows.length - visited;

  return [
    { key: "visited", label: "Visited", count: visited },
    { key: "not_visited", label: "Not Visited", count: notVisited },
  ] as const;
};

export const getFrequencyChartData = (rows: VisitationOverviewRow[], scope: ReportScope, currentUser?: AppAuthUser | null) => {
  const counts = {
    zero: 0,
    one: 0,
    two_to_three: 0,
    four_to_six: 0,
    seven_plus: 0,
  };

  rows.forEach((row) => {
    const total = getRelevantVisits(row, scope, currentUser).totalLifetimeVisits;
    if (total === 0) {
      counts.zero += 1;
    } else if (total === 1) {
      counts.one += 1;
    } else if (total <= 3) {
      counts.two_to_three += 1;
    } else if (total <= 6) {
      counts.four_to_six += 1;
    } else {
      counts.seven_plus += 1;
    }
  });

  return [
    { key: "zero", label: "0 Visits", count: counts.zero },
    { key: "one", label: "1 Visit", count: counts.one },
    { key: "two_to_three", label: "2-3 Visits", count: counts.two_to_three },
    { key: "four_to_six", label: "4-6 Visits", count: counts.four_to_six },
    { key: "seven_plus", label: "7+ Visits", count: counts.seven_plus },
  ] as const;
};

export const getMembersRequiringAttention = (
  rows: VisitationOverviewRow[],
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) =>
  [...rows]
    .filter((row) => {
      const status = getVisitStatus(row, scope, currentUser);
      return status === "Never Visited" || status === "Overdue";
    })
    .sort((left, right) => {
      const leftDays = getDaysSinceLastVisit(getLastVisit(left, scope, currentUser)) ?? Number.POSITIVE_INFINITY;
      const rightDays = getDaysSinceLastVisit(getLastVisit(right, scope, currentUser)) ?? Number.POSITIVE_INFINITY;
      return rightDays - leftDays;
    })
    .slice(0, 5);

export const sortMembersForGrid = (
  rows: VisitationOverviewRow[],
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) =>
  [...rows].sort((left, right) => {
    const leftStatus = getVisitStatus(left, scope, currentUser);
    const rightStatus = getVisitStatus(right, scope, currentUser);
    const statusWeight = {
      "Never Visited": 0,
      Overdue: 1,
      "Low Visitation": 2,
      Healthy: 3,
    } as const;

    if (statusWeight[leftStatus] !== statusWeight[rightStatus]) {
      return statusWeight[leftStatus] - statusWeight[rightStatus];
    }

    const leftDays = getDaysSinceLastVisit(getLastVisit(left, scope, currentUser)) ?? Number.POSITIVE_INFINITY;
    const rightDays = getDaysSinceLastVisit(getLastVisit(right, scope, currentUser)) ?? Number.POSITIVE_INFINITY;
    if (leftDays !== rightDays) {
      return rightDays - leftDays;
    }

    return left.memberFullName.localeCompare(right.memberFullName);
  });
