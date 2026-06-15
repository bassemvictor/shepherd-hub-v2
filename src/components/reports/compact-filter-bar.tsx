import { Download, Play, Search } from "lucide-react";

import type { ReportVisitorOption } from "../../../shared/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import type { ReportPeriod, ReportScope, ReportShowFilter } from "./visitation-report-utils";

const FilterField = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="space-y-1">
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
  showFilter,
  onShowFilterChange,
  onRunReport,
  runDisabled,
  onExport,
  scope,
}: {
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
  showFilter: ReportShowFilter;
  onShowFilterChange: (value: ReportShowFilter) => void;
  onRunReport: () => void;
  runDisabled?: boolean;
  onExport: () => void;
  scope: ReportScope;
}) => (
  <>
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_170px_170px_170px_150px_120px]">
      {onSearchChange ? (
        <FilterField label="Search">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-8"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search members"
              value={search ?? ""}
            />
          </label>
        </FilterField>
      ) : null}

      <FilterField label="Show">
        <Select onChange={(event) => onShowFilterChange(event.target.value as ReportShowFilter)} value={showFilter}>
          <option value="everyone">Everyone</option>
          <option value="need_visit">Need a Visit</option>
          <option value="visited">Visited</option>
        </Select>
      </FilterField>

      <FilterField label="Period">
        <Select onChange={(event) => onPeriodChange(event.target.value as ReportPeriod)} value={period}>
          <option value="all_time">All Time</option>
          <option value="last_30_days">Last 30 Days</option>
          <option value="last_90_days">Last 90 Days</option>
          <option value="this_year">This Year</option>
          <option value="custom">Custom</option>
        </Select>
      </FilterField>

      <FilterField label="Visitor">
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

      <FilterField label="Run Report">
        <Button className="w-full" disabled={runDisabled} onClick={onRunReport} type="button">
          <Play className="h-3.5 w-3.5" />
          Run Report
        </Button>
      </FilterField>

      <FilterField label="Export">
        <Button className="w-full" onClick={onExport} type="button">
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </FilterField>
    </div>

    {period === "custom" ? (
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <FilterField label="From">
          <Input onChange={(event) => onCustomFromChange?.(event.target.value)} type="date" value={customFrom ?? ""} />
        </FilterField>
        <FilterField label="To">
          <Input onChange={(event) => onCustomToChange?.(event.target.value)} type="date" value={customTo ?? ""} />
        </FilterField>
      </div>
    ) : null}
  </>
);
