import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { VisitationOverviewRow, VisitationReportResponse } from "../../shared/types";
import { CompactFilterBar } from "../components/reports/compact-filter-bar";
import { MemberVisitationView } from "../components/reports/member-visitation-view";
import { ReportsDashboard } from "../components/reports/reports-dashboard";
import { ReportsLayout } from "../components/reports/reports-layout";
import {
  buildReportFilters,
  formatReportDate,
  getLastVisit,
  getRelevantVisits,
  getVisitStatus,
  type MemberStatusFilter,
  type ReportPeriod,
  type ReportScope,
  type ReportView,
} from "../components/reports/visitation-report-utils";
import { useAuth } from "../lib/auth";
import { api, isApiConfigured } from "../lib/api";

const DEFAULT_PAGE_SIZE = 25;
const MEMBER_VISITATION_ROUTE = "/reports/member-visitation";
const REPORT_SCOPE: ReportScope = "everyone";

const buildSearchState = (params: URLSearchParams) => ({
  period: (params.get("period") as ReportPeriod) || "this_month",
  selectedVisitorUserId: params.get("visitor") || undefined,
  status: (params.get("status") as MemberStatusFilter) || "all",
  search: params.get("search") || "",
  customFrom: params.get("from") || "",
  customTo: params.get("to") || "",
  page: Math.max(1, Number(params.get("page") || 1)),
});

const buildParams = (state: ReturnType<typeof buildSearchState>) => {
  const params = new URLSearchParams();
  params.set("period", state.period);
  params.set("status", state.status);
  params.set("page", String(state.page));

  if (state.search) {
    params.set("search", state.search);
  }
  if (state.selectedVisitorUserId) {
    params.set("visitor", state.selectedVisitorUserId);
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
  currentUserName?: string,
) => {
  const headers = ["Member", "Phone", "Group", "Last Visit", "Visit Count", "Visitor", "Status", "Scope"];
  const lines = rows.map((row) => {
    const metrics = getRelevantVisits(row, scope);
    return [
      row.memberFullName,
      row.phone ?? "",
      row.sectorOrGroup ?? "",
      formatReportDate(getLastVisit(row, scope)),
      metrics.visitCountInRange,
      metrics.lastVisitedBy ?? "",
      getVisitStatus(row, scope),
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
  params.set("status", filters.status);
  if (filters.search) {
    params.set("search", filters.search);
  }
  params.set("sortBy", filters.sortBy);
  params.set("sortDirection", filters.sortDirection);
  params.set("page", String(page));
  params.set("pageSize", String(filters.pageSize));
  return params.toString();
};

export const VisitationReportsPage = ({ reportView }: { reportView: ReportView }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = useMemo(() => buildSearchState(searchParams), [searchParams]);
  const [report, setReport] = useState<VisitationReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setState = useCallback((patch: Partial<ReturnType<typeof buildSearchState>>) => {
    setSearchParams(buildParams({
      ...searchState,
      ...patch,
      page: patch.page ?? (patch.search !== undefined || patch.status !== undefined || patch.period !== undefined || patch.selectedVisitorUserId !== undefined ? 1 : searchState.page),
    }));
  }, [searchState, setSearchParams]);

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
      filters.search = searchState.search || undefined;
      filters.status = searchState.status;
      filters.pageSize = reportView === "dashboard" ? 1 : DEFAULT_PAGE_SIZE;

      const response = await api.get<VisitationReportResponse>(
        `/reports/visitations?${filtersToQueryString(filters, reportView === "dashboard" ? 1 : searchState.page)}`,
      );

      setReport(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load visitation reports.");
    } finally {
      setLoading(false);
    }
  }, [reportView, searchState.customFrom, searchState.customTo, searchState.page, searchState.period, searchState.search, searchState.selectedVisitorUserId, searchState.status]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const totalPages = report?.pagination.totalPages ?? 1;
  const currentPage = report?.pagination.page ?? searchState.page;

  const applyDashboardFilter = useCallback((filter: { view: "members"; status?: MemberStatusFilter }) => {
    const nextState = {
      ...searchState,
      status: filter.status ?? "all",
      page: 1,
    };
    navigate({
      pathname: MEMBER_VISITATION_ROUTE,
      search: `?${buildParams(nextState).toString()}`,
    });
  }, [navigate, searchState]);

  const exportCsv = useCallback(async () => {
    const filters = buildReportFilters(
      searchState.period,
      searchState.selectedVisitorUserId,
      searchState.customFrom || undefined,
      searchState.customTo || undefined,
    );
    filters.search = searchState.search || undefined;
    filters.status = searchState.status;
    filters.pageSize = 100;

    const firstPage = await api.get<VisitationReportResponse>(`/reports/visitations?${filtersToQueryString(filters, 1)}`);
    let rows = [...firstPage.rows];

    for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
      const response = await api.get<VisitationReportResponse>(`/reports/visitations?${filtersToQueryString(filters, page)}`);
      rows = rows.concat(response.rows);
    }

    downloadCsv(toCsv(rows, REPORT_SCOPE, user?.name), "visitation-report.csv");
  }, [searchState.customFrom, searchState.customTo, searchState.period, searchState.search, searchState.selectedVisitorUserId, searchState.status, user?.name]);

  if (!isApiConfigured) {
    return <div className="rounded-lg border border-border bg-white p-4 text-sm text-slate-700">Configure the API before using visitation reports.</div>;
  }

  return (
    <ReportsLayout
      controls={(
        <CompactFilterBar
          customFrom={searchState.customFrom}
          customTo={searchState.customTo}
          includeStatus={reportView === "members"}
          onCustomFromChange={(customFrom) => setState({ customFrom, page: 1 })}
          onCustomToChange={(customTo) => setState({ customTo, page: 1 })}
          onExport={exportCsv}
          onPeriodChange={(period) => setState({ period, page: 1 })}
          onSearchChange={reportView === "members" ? (search) => setState({ search, page: 1 }) : undefined}
          onStatusChange={reportView === "members" ? (status) => setState({ status, page: 1 }) : undefined}
          onVisitorChange={(selectedVisitorUserId) => setState({ selectedVisitorUserId, page: 1 })}
          period={searchState.period}
          scope={REPORT_SCOPE}
          search={searchState.search}
          selectedVisitorUserId={searchState.selectedVisitorUserId}
          statusFilter={searchState.status}
          visitors={report?.visitors ?? []}
        />
      )}
      subtitle={
        reportView === "dashboard"
          ? "A compact dashboard for visitation health and coverage."
          : "Detailed member-level visitation analysis and filtering."
      }
      title={reportView === "dashboard" ? "Reports Dashboard" : "Member Visitation"}
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
            currentUser={user}
            onApplyDashboardFilter={applyDashboardFilter}
            period={searchState.period}
            report={report}
            scope={REPORT_SCOPE}
          />
        ) : report.rows.length ? (
          <MemberVisitationView
            currentUser={user}
            onPageChange={(page) => setState({ page })}
            page={currentPage}
            rows={report.rows}
            scope={REPORT_SCOPE}
            totalPages={totalPages}
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
