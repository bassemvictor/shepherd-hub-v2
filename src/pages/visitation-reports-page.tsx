import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Play } from "lucide-react";

import type {
  ReportsSortBy,
  ReportsSortDirection,
  ReportsVisitationTypeFilter,
  VisitationOverviewRow,
  VisitationReportResponse,
} from "../../shared/types";
import { visitationTypes } from "../../shared/types";
import { CompactFilterBar } from "../components/reports/compact-filter-bar";
import { MemberVisitationView } from "../components/reports/member-visitation-view";
import { ReportsDashboard } from "../components/reports/reports-dashboard";
import { ReportsLayout } from "../components/reports/reports-layout";
import { Button } from "../components/ui/button";
import { Select } from "../components/ui/select";
import {
  getActivityCopy,
  buildReportFilters,
  formatReportDate,
  getFilterSummary,
  getLastVisit,
  getRelevantVisits,
  getVisitCountForPeriod,
  getVisitStatus,
  type ReportPeriod,
  type ReportScope,
  type ReportShowFilter,
  type ReportView,
} from "../components/reports/visitation-report-utils";
import { useAuth } from "../lib/auth";
import { api, isApiConfigured } from "../lib/api";

const DEFAULT_PAGE_SIZE = 25;
const MEMBER_VISITATION_ROUTE = "/reports/member-visitation";
const REPORT_SCOPE: ReportScope = "everyone";

const buildSearchState = (params: URLSearchParams) => ({
  period: (params.get("period") as ReportPeriod) || "last_90_days",
  selectedVisitorUserId: params.get("visitor") || undefined,
  visitationType: (params.get("type") as ReportsVisitationTypeFilter) || "all",
  sortBy: (params.get("sortBy") as ReportsSortBy) || "member_name",
  sortDirection: (params.get("sortDirection") as ReportsSortDirection) || "asc",
  show: (params.get("show") as ReportShowFilter) || "everyone",
  search: params.get("search") || "",
  customFrom: params.get("from") || "",
  customTo: params.get("to") || "",
  page: Math.max(1, Number(params.get("page") || 1)),
});

type SearchState = ReturnType<typeof buildSearchState>;

const buildParams = (state: ReturnType<typeof buildSearchState>) => {
  const params = new URLSearchParams();
  params.set("period", state.period);
  params.set("show", state.show);
  params.set("page", String(state.page));

  if (state.search) {
    params.set("search", state.search);
  }
  if (state.selectedVisitorUserId) {
    params.set("visitor", state.selectedVisitorUserId);
  }
  if (state.visitationType && state.visitationType !== "all") {
    params.set("type", state.visitationType);
  }
  if (state.sortBy !== "member_name") {
    params.set("sortBy", state.sortBy);
  }
  if (state.sortDirection !== "asc") {
    params.set("sortDirection", state.sortDirection);
  }
  if (state.period === "custom") {
    if (state.customFrom) {
      params.set("from", state.customFrom);
    }
    if (state.customTo) {
      params.set("to", state.customTo);
    }
  }

  return params;
};

const toCsv = (
  rows: VisitationOverviewRow[],
  scope: ReportScope,
  period: ReportPeriod,
  activityTypeLabel: string,
  currentUserName?: string,
) => {
  const activityCopy = getActivityCopy(activityTypeLabel === "All" ? "all" : activityTypeLabel as ReportsVisitationTypeFilter);
  const headers = ["Member", "Phone", "Group", activityTypeLabel === "All" ? "Care" : "Activity Type", activityCopy.lastLabel, activityCopy.countLabel, "Caregiver", "Status", "Scope"];
  const lines = rows.map((row) => {
    const metrics = getRelevantVisits(row, scope);
    return [
      row.memberFullName,
      row.phone ?? "",
      row.sectorOrGroup ?? "",
      activityTypeLabel,
      formatReportDate(getLastVisit(row, scope)),
      getVisitCountForPeriod(row, period, scope),
      metrics.lastVisitedBy ?? "",
      getVisitStatus(row, period, scope, activityTypeLabel === "All" ? "all" : activityTypeLabel as ReportsVisitationTypeFilter),
      scope === "me" ? `Me${currentUserName ? ` (${currentUserName})` : ""}` : "Everyone",
    ];
  });

  return [headers, ...lines]
    .map((line) => line.map((value) => `"${String(value).replace(/"/g, "\"\"")}"`).join(","))
    .join("\n");
};

const downloadCsv = (content: string, fileName: string) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const filtersToQueryString = (filters: ReturnType<typeof buildReportFilters>, page: number) => {
  const params = new URLSearchParams();
  if (filters.from) {
    params.set("from", filters.from.slice(0, 10));
  }
  if (filters.to) {
    params.set("to", filters.to.slice(0, 10));
  }
  if (filters.sinceBeginning) {
    params.set("sinceBeginning", "true");
  }
  params.set("visitCountMode", filters.visitCountMode);
  params.set("visitCountThreshold", String(filters.visitCountThreshold));
  params.set("visitorMode", filters.visitorMode);
  if (filters.visitorUserId) {
    params.set("visitorUserId", filters.visitorUserId);
  }
  params.set("memberScope", filters.memberScope);
  params.set("memberSource", filters.memberSource);
  params.set("type", filters.type);
  params.set("status", filters.status);
  params.set("sortBy", filters.sortBy);
  params.set("sortDirection", filters.sortDirection);
  params.set("page", String(page));
  params.set("pageSize", String(filters.pageSize));
  return params.toString();
};

const applyShowFilter = (
  filters: ReturnType<typeof buildReportFilters>,
  show: ReportShowFilter,
) => {
  if (show === "need_visit") {
    filters.visitCountMode = "not_visited";
    filters.visitCountThreshold = 0;
    return;
  }

  if (show === "visited") {
    filters.visitCountMode = "gt";
    filters.visitCountThreshold = 0;
  }
};

const getActivityTypeLabel = (visitationType: ReportsVisitationTypeFilter) =>
  visitationType === "all" ? "All" : visitationType;

export const VisitationReportsPage = ({ reportView }: { reportView: ReportView }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = useMemo(() => buildSearchState(searchParams), [searchParams]);
  const [draftState, setDraftState] = useState<SearchState>(searchState);
  const [report, setReport] = useState<VisitationReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftState(searchState);
  }, [searchState]);

  const setState = useCallback((patch: Partial<SearchState>) => {
    const shouldResetPage = patch.search !== undefined
      || patch.show !== undefined
      || patch.period !== undefined
      || patch.selectedVisitorUserId !== undefined
      || patch.visitationType !== undefined
      || patch.sortBy !== undefined
      || patch.sortDirection !== undefined
      || patch.customFrom !== undefined
      || patch.customTo !== undefined;

    setSearchParams(buildParams({
      ...searchState,
      ...patch,
      page: patch.page ?? (shouldResetPage ? 1 : searchState.page),
    }));
  }, [searchState, setSearchParams]);

  const hasPendingChanges = draftState.period !== searchState.period
    || draftState.selectedVisitorUserId !== searchState.selectedVisitorUserId
    || draftState.visitationType !== searchState.visitationType
    || draftState.sortBy !== searchState.sortBy
    || draftState.sortDirection !== searchState.sortDirection
    || draftState.show !== searchState.show
    || draftState.search !== searchState.search
    || draftState.customFrom !== searchState.customFrom
    || draftState.customTo !== searchState.customTo;

  const runReport = useCallback(() => {
    setState({
      period: draftState.period,
      selectedVisitorUserId: draftState.selectedVisitorUserId,
      visitationType: draftState.visitationType,
      sortBy: draftState.sortBy,
      sortDirection: draftState.sortDirection,
      show: draftState.show,
      search: draftState.search,
      customFrom: draftState.customFrom,
      customTo: draftState.customTo,
      page: 1,
    });
  }, [draftState, setState]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filters = buildReportFilters(
        searchState.period,
        searchState.selectedVisitorUserId,
        searchState.customFrom || undefined,
        searchState.customTo || undefined,
      );
      filters.page = reportView === "members" ? searchState.page : 1;
      filters.pageSize = DEFAULT_PAGE_SIZE;
      filters.search = reportView === "members" ? searchState.search.trim() || undefined : undefined;
      filters.type = searchState.visitationType as typeof filters.type;
      filters.sortBy = searchState.sortBy;
      filters.sortDirection = searchState.sortDirection;
      applyShowFilter(filters, searchState.show);

      const nextReport = await api.get<VisitationReportResponse>(
        `/reports/visitations?${filtersToQueryString(filters, filters.page)}`,
      );

      setReport(nextReport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load visitation reports.");
    } finally {
      setLoading(false);
    }
  }, [
    reportView,
    searchState.customFrom,
    searchState.customTo,
    searchState.page,
    searchState.period,
    searchState.search,
    searchState.selectedVisitorUserId,
    searchState.sortBy,
    searchState.sortDirection,
    searchState.visitationType,
    searchState.show,
  ]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const applyDashboardFilter = useCallback((filter: { view: "members"; show?: ReportShowFilter; period?: ReportPeriod; search?: string }) => {
    const nextState = {
      ...searchState,
      show: filter.show ?? searchState.show,
      period: filter.period ?? searchState.period,
      search: filter.search ?? searchState.search,
      page: 1,
    };
    navigate({
      pathname: MEMBER_VISITATION_ROUTE,
      search: `?${buildParams(nextState).toString()}`,
    });
  }, [navigate, searchState]);

  const exportCsv = useCallback(() => {
    if (!report) {
      return;
    }

    downloadCsv(
      toCsv(report.rows, REPORT_SCOPE, searchState.period, getActivityTypeLabel(searchState.visitationType), user?.name),
      "member-report.csv",
    );
  }, [report, searchState.period, searchState.visitationType, user?.name]);

  if (!isApiConfigured) {
    return <div className="rounded-lg border border-border bg-white p-4 text-sm text-slate-700">Configure the API before using visitation reports.</div>;
  }

  return (
    <ReportsLayout
      controls={(
        reportView === "dashboard" ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Period</span>
                  <Select
                    onChange={(event) => setDraftState((current) => ({ ...current, period: event.target.value as ReportPeriod }))}
                    value={draftState.period}
                  >
                    <option value="all_time">All Time</option>
                    <option value="last_30_days">Last 30 Days</option>
                    <option value="last_90_days">Last 90 Days</option>
                    <option value="this_year">This Year</option>
                    <option value="custom">Custom</option>
                  </Select>
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Caregiver</span>
                  <Select
                    onChange={(event) => setDraftState((current) => ({ ...current, selectedVisitorUserId: event.target.value || undefined }))}
                    value={draftState.selectedVisitorUserId ?? ""}
                  >
                    <option value="">Everyone</option>
                    {(report?.visitors ?? []).map((visitor) => (
                      <option key={visitor.visitorUserId} value={visitor.visitorUserId}>
                        {visitor.visitorDisplayName}
                    </option>
                  ))}
                  </Select>
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Type</span>
                  <Select
                    onChange={(event) => setDraftState((current) => ({ ...current, visitationType: event.target.value as ReportsVisitationTypeFilter }))}
                    value={draftState.visitationType}
                  >
                    <option value="all">All</option>
                    {visitationTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <Button className="w-full lg:w-auto" disabled={loading || !hasPendingChanges} onClick={runReport} type="button">
                <Play className="h-3.5 w-3.5" />
                Run Report
              </Button>
            </div>
            {draftState.period === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:max-w-[420px]">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">From</span>
                <input
                  className="h-8 w-full rounded-md border border-border bg-card px-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  onChange={(event) => setDraftState((current) => ({ ...current, customFrom: event.target.value }))}
                  type="date"
                  value={draftState.customFrom ?? ""}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">To</span>
                <input
                  className="h-8 w-full rounded-md border border-border bg-card px-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  onChange={(event) => setDraftState((current) => ({ ...current, customTo: event.target.value }))}
                  type="date"
                  value={draftState.customTo ?? ""}
                />
              </label>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <CompactFilterBar
              customFrom={draftState.customFrom}
              customTo={draftState.customTo}
              onCustomFromChange={(customFrom) => setDraftState((current) => ({ ...current, customFrom }))}
              onCustomToChange={(customTo) => setDraftState((current) => ({ ...current, customTo }))}
              onExport={exportCsv}
              onPeriodChange={(period) => setDraftState((current) => ({ ...current, period }))}
              onRunReport={runReport}
              runDisabled={loading || !hasPendingChanges}
              onSearchChange={reportView === "members" ? (search) => setDraftState((current) => ({ ...current, search })) : undefined}
              onShowFilterChange={(show) => setDraftState((current) => ({ ...current, show }))}
              onSortChange={({ sortBy, sortDirection }) => setDraftState((current) => ({ ...current, sortBy, sortDirection }))}
              onVisitorChange={(selectedVisitorUserId) => setDraftState((current) => ({ ...current, selectedVisitorUserId }))}
              onVisitationTypeChange={(visitationType) => setDraftState((current) => ({ ...current, visitationType }))}
              period={draftState.period}
              scope={REPORT_SCOPE}
              search={reportView === "members" ? draftState.search : ""}
              selectedVisitorUserId={draftState.selectedVisitorUserId}
              sortBy={draftState.sortBy}
              sortDirection={draftState.sortDirection}
              visitationType={draftState.visitationType}
              showFilter={draftState.show}
              visitors={report?.visitors ?? []}
            />
            <div className="text-xs text-muted-foreground">
              {getFilterSummary(searchState.show, searchState.period, searchState.visitationType)}
            </div>
          </div>
        )
      )}
      subtitle={
        reportView === "dashboard"
          ? "Overview of member visits and activities."
          : "See exactly which members match the visitation filters you selected."
      }
      title={reportView === "dashboard" ? "Reports" : "Member Report"}
    >
      {loading ? (
        <div className="rounded-lg border border-border bg-white p-4 text-sm text-muted-foreground">Loading report data...</div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {!loading && report ? (
        reportView === "dashboard" ? (
          <ReportsDashboard
            report={report}
            visitationType={searchState.visitationType}
          />
        ) : report.rows.length ? (
          <MemberVisitationView
            currentUser={user}
            onPageChange={(page) => setState({ page })}
            page={report.pagination.page}
            period={searchState.period}
            rows={report.rows}
            scope={REPORT_SCOPE}
            totalPages={report.pagination.totalPages}
            visitationType={searchState.visitationType}
          />
        ) : (
          <div className="rounded-lg border border-border bg-white p-8 text-center text-sm text-muted-foreground">
            No members match the current filters.
          </div>
        )
      ) : null}
    </ReportsLayout>
  );
};
