import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type {
  VisitationReportFilters,
  VisitationReportResponse,
} from "../../shared/types";
import { ReportFilterPanel, type VisitationReportDraft } from "../components/reports/report-filter-panel";
import { ReportKpiStrip } from "../components/reports/report-kpi-strip";
import { ReportMembersGrid } from "../components/reports/report-members-grid";
import { ReportsLayout } from "../components/reports/reports-layout";
import { ReportEmptyState, ReportErrorState, ReportLoadingState } from "../components/reports/report-states";
import { ReportPresetButtons } from "../components/reports/report-preset-buttons";
import { VisitDistributionDonutChart } from "../components/reports/visit-distribution-donut-chart";
import { Button } from "../components/ui/button";
import { api, isApiConfigured } from "../lib/api";

const buildDefaultFilters = (): VisitationReportFilters => ({
  from: new Date(new Date().getFullYear(), 0, 1).toISOString(),
  to: undefined,
  sinceBeginning: false,
  visitCountMode: "all",
  visitCountThreshold: 1,
  visitorMode: "any",
  visitorUserId: undefined,
  memberScope: "active_only",
  memberSource: "all",
  group: undefined,
  search: undefined,
  sortBy: "last_visit_date",
  sortDirection: "asc",
  page: 1,
  pageSize: 25,
});

const dateOnlyToIso = (value?: string) => (value ? `${value}T00:00:00.000Z` : undefined);

const filtersFromSearchParams = (params: URLSearchParams): VisitationReportFilters => {
  const defaults = buildDefaultFilters();
  return {
    ...defaults,
    from: dateOnlyToIso(params.get("from") ?? undefined) ?? defaults.from,
    to: dateOnlyToIso(params.get("to") ?? undefined) ?? defaults.to,
    sinceBeginning: params.get("sinceBeginning") === "true",
    visitCountMode: (params.get("visitCountMode") as VisitationReportFilters["visitCountMode"]) ?? defaults.visitCountMode,
    visitCountThreshold: Number(params.get("visitCountThreshold") ?? defaults.visitCountThreshold),
    visitorMode: (params.get("visitorMode") as VisitationReportFilters["visitorMode"]) ?? defaults.visitorMode,
    visitorUserId: params.get("visitorUserId") ?? undefined,
    memberScope: (params.get("memberScope") as VisitationReportFilters["memberScope"]) ?? defaults.memberScope,
    memberSource: (params.get("memberSource") as VisitationReportFilters["memberSource"]) ?? defaults.memberSource,
    group: params.get("group") ?? undefined,
    search: params.get("search") ?? undefined,
    sortBy: (params.get("sortBy") as VisitationReportFilters["sortBy"]) ?? defaults.sortBy,
    sortDirection: (params.get("sortDirection") as VisitationReportFilters["sortDirection"]) ?? defaults.sortDirection,
    page: Number(params.get("page") ?? defaults.page),
    pageSize: Number(params.get("pageSize") ?? defaults.pageSize),
  };
};

const filtersToSearchParams = (filters: VisitationReportFilters) => {
  const params = new URLSearchParams();
  if (filters.from && !filters.sinceBeginning) {
    params.set("from", filters.from.slice(0, 10));
  }
  if (filters.to && !filters.sinceBeginning) {
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
  if (filters.group) {
    params.set("group", filters.group);
  }
  if (filters.search) {
    params.set("search", filters.search);
  }
  params.set("sortBy", filters.sortBy);
  params.set("sortDirection", filters.sortDirection);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  return params;
};

const toCsv = (rows: VisitationReportResponse["rows"]) => {
  const headers = [
    "Member Name",
    "Phone",
    "Email",
    "Sector/Group",
    "Unity ID",
    "Last Visit Date",
    "Last Visited By",
    "Visit Count In Range",
    "Total Lifetime Visits",
    "Next Scheduled Visit",
    "Status",
  ];

  const lines = rows.map((row) => [
    row.memberFullName,
    row.phone ?? "",
    row.email ?? "",
    row.sectorOrGroup ?? "",
    row.unityId ?? "",
    row.lastVisitDate ?? "",
    row.lastVisitedBy ?? "",
    row.visitCountInRange,
    row.totalLifetimeVisits,
    row.nextScheduledVisit ?? "",
    row.status,
  ]);

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

export const VisitationReportsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<VisitationReportDraft>(() => filtersFromSearchParams(searchParams));
  const [report, setReport] = useState<VisitationReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const appliedFilters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);

  useEffect(() => {
    setDraft(appliedFilters);
  }, [appliedFilters]);

  const loadReport = useCallback(async (filters: VisitationReportFilters) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<VisitationReportResponse>(`/reports/visitations?${filtersToSearchParams(filters).toString()}`);
      setReport(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load visitation overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport(appliedFilters);
  }, [appliedFilters, loadReport]);

  const applyDraft = useCallback((nextDraft: VisitationReportDraft) => {
    setSearchParams(filtersToSearchParams({ ...nextDraft, page: 1 }));
  }, [setSearchParams]);

  const clearFilters = useCallback(() => {
    const defaults = buildDefaultFilters();
    setDraft(defaults);
    setSearchParams(filtersToSearchParams(defaults));
  }, [setSearchParams]);

  const setQuickRange = useCallback((presetId: string) => {
    const now = new Date();
    const nextDraft = { ...draft, sinceBeginning: false };
    if (presetId === "since_beginning") {
      nextDraft.sinceBeginning = true;
      nextDraft.from = undefined;
      nextDraft.to = undefined;
    } else if (presetId === "this_week") {
      const day = now.getDay();
      const diff = (day + 6) % 7;
      const start = new Date(now);
      start.setDate(start.getDate() - diff);
      start.setHours(0, 0, 0, 0);
      nextDraft.from = start.toISOString();
      nextDraft.to = undefined;
    } else if (presetId === "this_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      nextDraft.from = start.toISOString();
      nextDraft.to = undefined;
    } else if (presetId === "this_year") {
      const start = new Date(now.getFullYear(), 0, 1);
      nextDraft.from = start.toISOString();
      nextDraft.to = undefined;
    } else if (presetId === "last_30_days" || presetId === "last_90_days") {
      const days = presetId === "last_30_days" ? 30 : 90;
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      nextDraft.from = start.toISOString();
      nextDraft.to = undefined;
    }
    setDraft(nextDraft);
  }, [draft]);

  const applyPreset = useCallback((presetId: string) => {
    const base = buildDefaultFilters();
    const now = new Date();
    const preset = { ...base };
    if (presetId === "not_visited_since_beginning") {
      preset.sinceBeginning = true;
      preset.from = undefined;
      preset.visitCountMode = "not_visited";
    } else if (presetId === "visited_one_or_less_this_year") {
      preset.from = new Date(now.getFullYear(), 0, 1).toISOString();
      preset.visitCountMode = "lte";
      preset.visitCountThreshold = 1;
    } else if (presetId === "my_visits_this_week") {
      const day = now.getDay();
      const diff = (day + 6) % 7;
      const start = new Date(now);
      start.setDate(start.getDate() - diff);
      start.setHours(0, 0, 0, 0);
      preset.from = start.toISOString();
      preset.visitorMode = "me_only";
      preset.visitCountMode = "gt";
      preset.visitCountThreshold = 0;
    } else if (presetId === "my_visits_this_month") {
      preset.from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      preset.visitorMode = "me_only";
      preset.visitCountMode = "gt";
      preset.visitCountThreshold = 0;
    } else if (presetId === "my_visits_this_year") {
      preset.from = new Date(now.getFullYear(), 0, 1).toISOString();
      preset.visitorMode = "me_only";
      preset.visitCountMode = "gt";
      preset.visitCountThreshold = 0;
    } else if (presetId === "not_visited_this_month") {
      preset.from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      preset.visitCountMode = "not_visited";
    } else if (presetId === "not_visited_this_year") {
      preset.from = new Date(now.getFullYear(), 0, 1).toISOString();
      preset.visitCountMode = "not_visited";
    } else if (presetId === "members_not_visited_by_me") {
      preset.sinceBeginning = true;
      preset.from = undefined;
      preset.visitorMode = "me_only";
      preset.visitCountMode = "not_visited";
    } else if (presetId === "members_not_visited_by_anyone") {
      preset.sinceBeginning = true;
      preset.from = undefined;
      preset.visitCountMode = "not_visited";
    } else if (presetId === "recently_visited_members") {
      preset.from = new Date(now.getFullYear(), 0, 1).toISOString();
      preset.visitCountMode = "gt";
      preset.visitCountThreshold = 1;
    } else if (presetId === "custom_range") {
      setFiltersOpen(true);
      return;
    }

    setDraft(preset);
    setSearchParams(filtersToSearchParams(preset));
  }, [setSearchParams]);

  const exportCsv = useCallback(async () => {
    try {
      const response = await api.get<VisitationReportResponse>(
        `/reports/visitations?${filtersToSearchParams({ ...appliedFilters, page: 1, pageSize: 500 }).toString()}`,
      );
      downloadCsv(toCsv(response.rows), "visitation-overview.csv");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to export report.");
    }
  }, [appliedFilters]);

  const movePage = useCallback((nextPage: number) => {
    setSearchParams(filtersToSearchParams({ ...appliedFilters, page: nextPage }));
  }, [appliedFilters, setSearchParams]);

  if (!isApiConfigured) {
    return <ReportErrorState description="Set `VITE_API_BASE_URL` or regenerate `amplify_outputs.json` before using reports." />;
  }

  if (loading && !report) {
    return <ReportLoadingState />;
  }

  if (error && !report) {
    return <ReportErrorState description={error} />;
  }

  return (
    <ReportsLayout
      subtitle="Overview of visitation distribution and member visitation summary."
      title="Visitation Overview"
      actions={(
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button onClick={() => setFiltersOpen((current) => !current)} size="sm" type="button" variant="outline">
            {filtersOpen ? "Hide Filters" : "Filters"}
          </Button>
          <Button onClick={() => void exportCsv()} size="sm" type="button">
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      )}
    >
      <ReportPresetButtons
        morePresets={[
          { id: "not_visited_this_month", label: "Not visited this month" },
          { id: "not_visited_this_year", label: "Not visited this year" },
          { id: "members_not_visited_by_me", label: "Members not visited by me" },
          { id: "members_not_visited_by_anyone", label: "Members not visited by anyone" },
          { id: "recently_visited_members", label: "Recently visited members" },
          { id: "custom_range", label: "Custom range" },
        ]}
        onPresetSelect={applyPreset}
        presets={[
          { id: "not_visited_since_beginning", label: "Not visited since beginning" },
          { id: "visited_one_or_less_this_year", label: "Visited 1 or less this year" },
          { id: "my_visits_this_week", label: "My visitations this week" },
          { id: "my_visits_this_month", label: "My visitations this month" },
          { id: "my_visits_this_year", label: "My visitations this year" },
        ]}
      />

      <ReportFilterPanel
        availableGroups={report?.availableGroups ?? []}
        draft={draft}
        onApply={() => applyDraft(draft)}
        onChange={setDraft}
        onClear={clearFilters}
        onQuickRange={setQuickRange}
        onToggleOpen={() => setFiltersOpen((current) => !current)}
        open={filtersOpen}
        visitors={report?.visitors ?? []}
      />

      {error ? <ReportErrorState description={error} /> : null}

      {report ? <ReportKpiStrip summary={report.summary} /> : null}

      {report ? (
        <VisitDistributionDonutChart
          distribution={report.distribution}
          totalMembers={report.summary.totalMembers}
        />
      ) : null}

      {report && report.rows.length ? (
        <div className="space-y-3 rounded-lg border border-border bg-white p-3 panel-shadow">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Members</div>
              <div className="text-xs text-muted-foreground">
                Showing {report.rows.length} of {report.pagination.totalItems} matching members.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={report.pagination.page <= 1}
                onClick={() => movePage(report.pagination.page - 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                Previous
              </Button>
              <div className="text-xs text-muted-foreground">
                Page {report.pagination.page} of {report.pagination.totalPages}
              </div>
              <Button
                disabled={report.pagination.page >= report.pagination.totalPages}
                onClick={() => movePage(report.pagination.page + 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>
          <ReportMembersGrid rows={report.rows} />
        </div>
      ) : (
        <ReportEmptyState />
      )}
    </ReportsLayout>
  );
};
