import { Download, Play, Search } from "lucide-react";

import type {
  ReportVisitorOption,
  ReportsSortBy,
  ReportsSortDirection,
  ReportsVisitationTypeFilter,
} from "../../../shared/types";
import { visitationTypes } from "../../../shared/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import {
  getActivityCopy,
  type ReportPeriod,
  type ReportScope,
  type ReportShowFilter,
} from "./visitation-report-utils";

const FilterField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="min-w-0 space-y-1">
    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {label}
    </span>
    {children}
  </label>
);

export const CompactFilterBar = ({
  search,
  onSearchChange,
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  selectedVisitorUserId,
  onVisitorChange,
  visitors,
  visitationType,
  onVisitationTypeChange,
  sortBy,
  sortDirection,
  onSortChange,
  showFilter,
  onShowFilterChange,
  onRunReport,
  runDisabled,
  onExport,
  scope,
  tagControls,
  activeFilters,
  dashboard = false,
}: {
  tagControls?: React.ReactNode;
  activeFilters?: React.ReactNode;
  dashboard?: boolean;
  search?: string;
  onSearchChange?: (value: string) => void;
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  customFrom?: string;
  customTo?: string;
  onCustomFromChange?: (value: string) => void;
  onCustomToChange?: (value: string) => void;
  selectedVisitorUserId?: string;
  onVisitorChange: (value?: string) => void;
  visitors: ReportVisitorOption[];
  visitationType: ReportsVisitationTypeFilter;
  onVisitationTypeChange: (value: ReportsVisitationTypeFilter) => void;
  sortBy: ReportsSortBy;
  sortDirection: ReportsSortDirection;
  onSortChange: (value: { sortBy: ReportsSortBy; sortDirection: ReportsSortDirection }) => void;
  showFilter: ReportShowFilter;
  onShowFilterChange: (value: ReportShowFilter) => void;
  onRunReport: () => void;
  runDisabled?: boolean;
  onExport: () => void;
  scope: ReportScope;
}) => {
  const activityCopy = getActivityCopy(visitationType);

  return (
    <>
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 md:grid-cols-5 2xl:flex 2xl:flex-wrap [&>label]:2xl:min-w-[115px] [&>label]:2xl:flex-1 [&>div]:2xl:w-[145px] [&>div]:2xl:shrink-0">
        {onSearchChange ? (
          <FilterField label="Search">
            <span className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-8"
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search members"
                value={search ?? ""}
              />
            </span>
          </FilterField>
        ) : null}

        {!dashboard ? (
          <FilterField label="Show">
            <Select
              onChange={(event) => onShowFilterChange(event.target.value as ReportShowFilter)}
              value={showFilter}
            >
              <option value="everyone">Everyone</option>
              <option value="never_visited">Never visited</option>
              <option value="need_visit">{activityCopy.needsLabel}</option>
              <option value="visited">{activityCopy.hasLabel}</option>
            </Select>
          </FilterField>
        ) : null}

        <FilterField label="Period">
          <Select onChange={(event) => onPeriodChange(event.target.value as ReportPeriod)} value={period}>
            <option value="all_time">All Time</option>
            <option value="last_30_days">Last 30 Days</option>
            <option value="last_90_days">Last 90 Days</option>
            <option value="this_year">This Year</option>
            <option value="custom">Custom</option>
          </Select>
        </FilterField>

        <FilterField label="Caregiver">
          <Select
            disabled={scope === "me"}
            onChange={(event) => onVisitorChange(event.target.value || undefined)}
            value={scope === "me" ? "" : (selectedVisitorUserId ?? "")}
          >
            <option value="">Everyone</option>
            {visitors.map((visitor) => (
              <option key={visitor.visitorUserId} value={visitor.visitorUserId}>
                {visitor.visitorDisplayName}
              </option>
            ))}
          </Select>
        </FilterField>

        {tagControls}

        <FilterField label="Type">
          <Select
            onChange={(event) => onVisitationTypeChange(event.target.value as ReportsVisitationTypeFilter)}
            value={visitationType}
          >
            <option value="all">All</option>
            {visitationTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </FilterField>

        {!dashboard ? (
          <FilterField label="Sort">
            <Select
              onChange={(event) => {
                const value = event.target.value;
                if (value === "visit_count_desc") {
                  onSortChange({ sortBy: "visit_count", sortDirection: "desc" });
                  return;
                }
                if (value === "visit_count_asc") {
                  onSortChange({ sortBy: "visit_count", sortDirection: "asc" });
                  return;
                }
                onSortChange({ sortBy: "member_name", sortDirection: "asc" });
              }}
              value={sortBy === "visit_count" ? `visit_count_${sortDirection}` : "member_name_asc"}
            >
              <option value="member_name_asc">Member Name</option>
              <option value="visit_count_desc">Count: High to Low</option>
              <option value="visit_count_asc">Count: Low to High</option>
            </Select>
          </FilterField>
        ) : null}

        <FilterField label="Run Report">
          <Button className="w-full" disabled={runDisabled} onClick={onRunReport} type="button">
            <Play className="h-3.5 w-3.5" />
            Run Report
          </Button>
        </FilterField>

        {!dashboard ? (
          <FilterField label="Export">
            <Button className="w-full" onClick={onExport} type="button">
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </FilterField>
        ) : null}
      </div>

      {activeFilters ? <div className="mt-2">{activeFilters}</div> : null}

      {period === "custom" ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <FilterField label="From">
            <Input
              onChange={(event) => onCustomFromChange?.(event.target.value)}
              type="date"
              value={customFrom ?? ""}
            />
          </FilterField>
          <FilterField label="To">
            <Input
              onChange={(event) => onCustomToChange?.(event.target.value)}
              type="date"
              value={customTo ?? ""}
            />
          </FilterField>
        </div>
      ) : null}
    </>
  );
};
