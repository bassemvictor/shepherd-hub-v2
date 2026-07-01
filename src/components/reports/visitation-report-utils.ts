import type { AppAuthUser } from "../../lib/auth";
import type {
  ReportsVisitationTypeFilter,
  VisitationOverviewRow,
  VisitationReportFilters,
  VisitationScopeMetrics,
} from "../../../shared/types";

export type ReportScope = "me" | "everyone";
export type ReportView = "dashboard" | "members";
export type ReportPeriod = "all_time" | "last_30_days" | "last_90_days" | "this_year" | "custom";
export type ReportShowFilter = "everyone" | "need_visit" | "visited";

const withArticle = (label: string) => (/^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`);

export const getActivityCopy = (visitationType: ReportsVisitationTypeFilter) => {
  const singular = visitationType === "all"
    ? "Care"
    : visitationType === "Visitation"
      ? "Visit"
      : visitationType;
  const plural = visitationType === "all"
    ? "Care"
    : visitationType === "Visitation"
      ? "Visits"
      : visitationType === "Confession"
        ? "Confessions"
        : visitationType === "Phone Call"
          ? "Phone Calls"
          : visitationType === "Meeting"
            ? "Meetings"
            : visitationType === "Other"
              ? "Other Activities"
              : `${visitationType}s`;
  const singularLower = singular.toLowerCase();
  const pluralLower = plural.toLowerCase();

  return {
    singular,
    plural,
    singularLower,
    pluralLower,
    needsLabel: visitationType === "all" ? "Needs Care" : `Needs ${withArticle(singular)}`,
    membersNeedingLabel: visitationType === "all" ? "Needing Care" : `Needing ${withArticle(singular)}`,
    hasLabel: visitationType === "all" ? "Has Care" : `Has ${singular}`,
    noneYetLabel: visitationType === "all" ? "No care yet" : `No ${singularLower} yet`,
    lastLabel: `Last ${singular}`,
    countLabel: `${singular} Count`,
  };
};

const DAY_IN_MS = 86_400_000;

const startOfToday = () => {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
};

export const getPeriodDateRange = (period: ReportPeriod, customFrom?: string, customTo?: string) => {
  if (period === "all_time") {
    return {
      from: undefined,
      to: undefined,
      sinceBeginning: true,
    };
  }

  if (period === "custom") {
    return {
      from: customFrom ? new Date(`${customFrom}T00:00:00.000Z`).toISOString() : undefined,
      to: customTo ? new Date(`${customTo}T23:59:59.999Z`).toISOString() : undefined,
      sinceBeginning: false,
    };
  }

  const now = new Date();

  if (period === "last_30_days" || period === "last_90_days") {
    const start = startOfToday();
    start.setDate(start.getDate() - (period === "last_30_days" ? 29 : 89));
    return { from: start.toISOString(), to: undefined, sinceBeginning: false };
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
    type: "all",
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
    caregiverNames: member.caregiverNames,
  });

export const formatCaregiverNames = (metrics: VisitationScopeMetrics, fallback: string) =>
  metrics.caregiverNames.length ? metrics.caregiverNames.join(", ") : fallback;

export const getVisitCountForPeriod = (
  member: VisitationOverviewRow,
  period: ReportPeriod,
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => {
  const relevant = getRelevantVisits(member, scope, currentUser);
  return period === "all_time" ? relevant.totalLifetimeVisits : relevant.visitCountInRange;
};

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
  return Math.max(0, Math.floor(diff / DAY_IN_MS));
};

export const hasVisitInPeriod = (
  member: VisitationOverviewRow,
  period: ReportPeriod,
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => getVisitCountForPeriod(member, period, scope, currentUser) > 0;

export const needsVisitInPeriod = (
  member: VisitationOverviewRow,
  period: ReportPeriod,
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => !hasVisitInPeriod(member, period, scope, currentUser);

export const getVisitStatus = (
  member: VisitationOverviewRow,
  period: ReportPeriod,
  scope: ReportScope,
  visitationType: ReportsVisitationTypeFilter,
  currentUser?: AppAuthUser | null,
) => {
  const copy = getActivityCopy(visitationType);
  return hasVisitInPeriod(member, period, scope, currentUser) ? copy.hasLabel : copy.needsLabel;
};

export const matchesShowFilter = (
  member: VisitationOverviewRow,
  period: ReportPeriod,
  scope: ReportScope,
  showFilter: ReportShowFilter,
  currentUser?: AppAuthUser | null,
) => {
  if (showFilter === "everyone") {
    return true;
  }

  if (showFilter === "need_visit") {
    return needsVisitInPeriod(member, period, scope, currentUser);
  }

  return hasVisitInPeriod(member, period, scope, currentUser);
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
  if (period === "all_time") {
    return "All Time";
  }
  if (period === "last_30_days") {
    return "Last 30 Days";
  }
  if (period === "last_90_days") {
    return "Last 90 Days";
  }
  if (period === "this_year") {
    return "This Year";
  }
  return "Custom";
};

export const getPeriodDescription = (period: ReportPeriod) => {
  if (period === "all_time") {
    return "all time";
  }
  if (period === "last_30_days") {
    return "the last 30 days";
  }
  if (period === "last_90_days") {
    return "the last 90 days";
  }
  if (period === "this_year") {
    return "this year";
  }
  return "the selected period";
};

export const getFilterSummary = (
  showFilter: ReportShowFilter,
  period: ReportPeriod,
  visitationType: ReportsVisitationTypeFilter,
) => {
  const copy = getActivityCopy(visitationType);

  if (showFilter === "everyone") {
    return "Showing all members.";
  }

  if (showFilter === "need_visit") {
    if (period === "all_time") {
      return `Showing members with no recorded ${copy.pluralLower}.`;
    }
    return `Showing members with no recorded ${copy.pluralLower} in ${getPeriodDescription(period)}.`;
  }

  if (period === "all_time") {
    return `Showing members with at least one recorded ${copy.singularLower}.`;
  }

  return `Showing members with recorded ${copy.pluralLower} in ${getPeriodDescription(period)}.`;
};

export const getCoverageChartData = (
  rows: VisitationOverviewRow[],
  period: ReportPeriod,
  scope: ReportScope,
  visitationType: ReportsVisitationTypeFilter,
  currentUser?: AppAuthUser | null,
) => {
  const visited = rows.filter((row) => hasVisitInPeriod(row, period, scope, currentUser)).length;
  const needVisit = rows.length - visited;
  const copy = getActivityCopy(visitationType);

  return [
    { key: "visited", label: copy.hasLabel, count: visited },
    { key: "need_visit", label: copy.needsLabel, count: needVisit },
  ] as const;
};

export const getFrequencyChartData = (
  rows: VisitationOverviewRow[],
  period: ReportPeriod,
  scope: ReportScope,
  visitationType: ReportsVisitationTypeFilter,
  currentUser?: AppAuthUser | null,
) => {
  const counts = {
    zero: 0,
    one: 0,
    two_to_three: 0,
    four_to_six: 0,
    seven_plus: 0,
  };

  rows.forEach((row) => {
    const total = getVisitCountForPeriod(row, period, scope, currentUser);
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

  const copy = getActivityCopy(visitationType);

  return [
    { key: "zero", label: `0 ${copy.plural}`, count: counts.zero },
    { key: "one", label: `1 ${copy.singular}`, count: counts.one },
    { key: "two_to_three", label: `2-3 ${copy.plural}`, count: counts.two_to_three },
    { key: "four_to_six", label: `4-6 ${copy.plural}`, count: counts.four_to_six },
    { key: "seven_plus", label: `7+ ${copy.plural}`, count: counts.seven_plus },
  ] as const;
};

export const getAverageDaysSinceLastVisit = (
  rows: VisitationOverviewRow[],
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => {
  const values = rows
    .map((row) => getDaysSinceLastVisit(getLastVisit(row, scope, currentUser)))
    .filter((value): value is number => value !== null);

  if (!values.length) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

export const getTotalVisits = (
  rows: VisitationOverviewRow[],
  period: ReportPeriod,
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => rows.reduce((sum, row) => sum + getVisitCountForPeriod(row, period, scope, currentUser), 0);

export const getNeverVisitedCount = (
  rows: VisitationOverviewRow[],
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) => rows.filter((row) => getRelevantVisits(row, scope, currentUser).totalLifetimeVisits === 0).length;

export const sortMembersForDisplay = (
  rows: VisitationOverviewRow[],
  period: ReportPeriod,
  scope: ReportScope,
  currentUser?: AppAuthUser | null,
) =>
  [...rows].sort((left, right) => {
    const leftNeedsVisit = needsVisitInPeriod(left, period, scope, currentUser);
    const rightNeedsVisit = needsVisitInPeriod(right, period, scope, currentUser);

    if (leftNeedsVisit !== rightNeedsVisit) {
      return leftNeedsVisit ? -1 : 1;
    }

    const leftDays = getDaysSinceLastVisit(getLastVisit(left, scope, currentUser)) ?? Number.POSITIVE_INFINITY;
    const rightDays = getDaysSinceLastVisit(getLastVisit(right, scope, currentUser)) ?? Number.POSITIVE_INFINITY;
    if (leftDays !== rightDays) {
      return rightDays - leftDays;
    }

    return left.memberFullName.localeCompare(right.memberFullName);
  });
