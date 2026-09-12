import type { VisitationOverviewRow, VisitationReportFilters, VisitationReportResponse } from "./types.js";

/** Fetch every page with the same applied filters, independent of the visible page. */
export const loadReportExportRows = async (
  filters: VisitationReportFilters,
  fetchPage: (filters: VisitationReportFilters) => Promise<VisitationReportResponse>,
): Promise<VisitationOverviewRow[]> => {
  const rows: VisitationOverviewRow[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await fetchPage({ ...filters, pageSize: 100, page });
    rows.push(...result.rows);
    totalPages = result.pagination.totalPages;
    page++;
  } while (page <= totalPages);
  return rows;
};

export const encodeCsv = (lines: (string | number)[][]) =>
  lines.map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
