import type {
  ReportVisitorOption,
  ReportsMemberScope,
  ReportsMemberSourceFilter,
  ReportsSortBy,
  ReportsSortDirection,
  ReportsVisitCountMode,
  ReportsVisitorFilterMode,
  VisitationReportFilters,
} from "../../../shared/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

export type VisitationReportDraft = VisitationReportFilters;

const quickRanges = [
  { id: "since_beginning", label: "Since beginning" },
  { id: "this_year", label: "This year" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "last_90_days", label: "Last 90 days" },
] as const;

export const ReportFilterPanel = ({
  draft,
  visitors,
  availableGroups,
  open,
  onToggleOpen,
  onChange,
  onQuickRange,
  onApply,
  onClear,
}: {
  draft: VisitationReportDraft;
  visitors: ReportVisitorOption[];
  availableGroups: string[];
  open: boolean;
  onToggleOpen: () => void;
  onChange: (next: VisitationReportDraft) => void;
  onQuickRange: (presetId: typeof quickRanges[number]["id"]) => void;
  onApply: () => void;
  onClear: () => void;
}) => (
  <div className="rounded-lg border border-border bg-white p-3 panel-shadow">
    <div className="flex items-center justify-between gap-2">
      <div>
        <div className="text-sm font-semibold text-slate-900">Filters</div>
        <div className="text-xs text-muted-foreground">Date, visitor, and member filters for visitation reports.</div>
      </div>
      <Button onClick={onToggleOpen} size="sm" type="button" variant="outline">
        {open ? "Hide Filters" : "Show Filters"}
      </Button>
    </div>

    {open ? (
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">From date</span>
            <Input
              disabled={draft.sinceBeginning}
              onChange={(event) => onChange({ ...draft, from: event.target.value || undefined })}
              type="date"
              value={(draft.from ?? "").slice(0, 10)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">To date</span>
            <Input
              disabled={draft.sinceBeginning}
              onChange={(event) => onChange({ ...draft, to: event.target.value || undefined })}
              type="date"
              value={(draft.to ?? "").slice(0, 10)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Visit count condition</span>
            <Select
              onChange={(event) => onChange({ ...draft, visitCountMode: event.target.value as ReportsVisitCountMode })}
              value={draft.visitCountMode}
            >
              <option value="all">All members</option>
              <option value="not_visited">Not visited</option>
              <option value="lte">Visited threshold or less</option>
              <option value="gt">Above threshold</option>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Threshold</span>
            <Input
              min={0}
              onChange={(event) => onChange({ ...draft, visitCountThreshold: Number(event.target.value || 0) })}
              type="number"
              value={draft.visitCountThreshold}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Visitor filter</span>
            <Select
              onChange={(event) => onChange({ ...draft, visitorMode: event.target.value as ReportsVisitorFilterMode, visitorUserId: undefined })}
              value={draft.visitorMode}
            >
              <option value="any">Any visitor</option>
              <option value="me_only">Only visits by me</option>
              <option value="exclude_me">Exclude visits by me</option>
              <option value="specific">Specific visitor</option>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Specific visitor</span>
            <Select
              disabled={draft.visitorMode !== "specific"}
              onChange={(event) => onChange({ ...draft, visitorUserId: event.target.value || undefined })}
              value={draft.visitorUserId ?? ""}
            >
              <option value="">Choose visitor</option>
              {visitors.map((visitor) => (
                <option key={visitor.visitorUserId} value={visitor.visitorUserId}>
                  {visitor.visitorDisplayName}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Member filter</span>
            <Select
              onChange={(event) => onChange({ ...draft, memberScope: event.target.value as ReportsMemberScope })}
              value={draft.memberScope}
            >
              <option value="active_only">Active members only</option>
              <option value="all_members">All members</option>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Source</span>
            <Select
              onChange={(event) => onChange({ ...draft, memberSource: event.target.value as ReportsMemberSourceFilter })}
              value={draft.memberSource}
            >
              <option value="all">All members</option>
              <option value="unity">Unity imported members</option>
              <option value="manual">Manually added members</option>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sector / Group</span>
            <Select onChange={(event) => onChange({ ...draft, group: event.target.value || undefined })} value={draft.group ?? ""}>
              <option value="">All groups</option>
              {availableGroups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Search</span>
            <Input
              onChange={(event) => onChange({ ...draft, search: event.target.value || undefined })}
              placeholder="Member name, phone, email, or Unity ID"
              value={draft.search ?? ""}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sort by</span>
            <Select onChange={(event) => onChange({ ...draft, sortBy: event.target.value as ReportsSortBy })} value={draft.sortBy}>
              <option value="last_visit_date">Last visit date</option>
              <option value="visit_count">Visit count</option>
              <option value="member_name">Member name</option>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Direction</span>
            <Select onChange={(event) => onChange({ ...draft, sortDirection: event.target.value as ReportsSortDirection })} value={draft.sortDirection}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </Select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {quickRanges.map((range) => (
            <Button key={range.id} onClick={() => onQuickRange(range.id)} size="sm" type="button" variant="outline">
              {range.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onApply} type="button">Apply Filters</Button>
          <Button onClick={onClear} type="button" variant="outline">Clear</Button>
        </div>
      </div>
    ) : null}
  </div>
);
