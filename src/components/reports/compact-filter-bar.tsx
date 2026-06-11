import { Download, Search } from "lucide-react";

import type { ReportVisitorOption } from "../../../shared/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import type { MemberStatusFilter, ReportPeriod, ReportScope } from "./visitation-report-utils";

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
  statusFilter,
  onStatusChange,
  onExport,
  scope,
  includeStatus = true,
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
  statusFilter?: MemberStatusFilter;
  onStatusChange?: (value: MemberStatusFilter) => void;
  onExport: () => void;
  scope: ReportScope;
  includeStatus?: boolean;
}) => (
  <div className="rounded-lg border border-border bg-white p-3 panel-shadow">
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1.3fr)_160px_160px_160px_auto]">
      {onSearchChange ? (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-8"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search members"
            value={search ?? ""}
          />
        </label>
      ) : null}

      <Select
        disabled={scope === "me"}
        onChange={(event) => onVisitorChange(event.target.value || undefined)}
        value={scope === "me" ? "" : (selectedVisitorUserId ?? "")}
      >
        <option value="">Visitor: Everyone</option>
        {visitors.map((visitor) => (
          <option key={visitor.visitorUserId} value={visitor.visitorUserId}>
            {visitor.visitorDisplayName}
          </option>
        ))}
      </Select>

      <Select onChange={(event) => onPeriodChange(event.target.value as ReportPeriod)} value={period}>
        <option value="this_week">This Week</option>
        <option value="this_month">This Month</option>
        <option value="this_year">This Year</option>
        <option value="custom">Custom</option>
      </Select>

      {includeStatus && onStatusChange ? (
        <Select onChange={(event) => onStatusChange(event.target.value as MemberStatusFilter)} value={statusFilter}>
          <option value="all">All Statuses</option>
          <option value="never_visited">Never Visited</option>
          <option value="not_visited_recently">Not Visited Recently</option>
          <option value="low_visitation">Low Visitation</option>
          <option value="visited">Visited</option>
        </Select>
      ) : null}

      <Button className="w-full lg:w-auto" onClick={onExport} type="button">
        <Download className="h-3.5 w-3.5" />
        Export
      </Button>
    </div>

    {period === "custom" ? (
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Input onChange={(event) => onCustomFromChange?.(event.target.value)} type="date" value={customFrom ?? ""} />
        <Input onChange={(event) => onCustomToChange?.(event.target.value)} type="date" value={customTo ?? ""} />
      </div>
    ) : null}
  </div>
);
