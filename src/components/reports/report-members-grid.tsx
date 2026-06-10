import { CalendarDays, Mail, MessageCircle, Phone } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import type { DataGridColumn } from "../common/data-grid";
import { DataGrid } from "../common/data-grid";
import type { VisitationOverviewRow } from "../../../shared/types";
import { Button } from "../ui/button";

const formatDateTime = (value?: string) => {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : "short",
  }).format(new Date(value));
};

export const ReportMembersGrid = ({ rows }: { rows: VisitationOverviewRow[] }) => {
  const navigate = useNavigate();

  const columns = useMemo<DataGridColumn<VisitationOverviewRow>[]>(() => [
    {
      key: "member",
      header: "Member",
      cell: (row) => (
        <button
          className="text-left"
          onClick={() => navigate(`/members/${row.memberId}`)}
          type="button"
        >
          <div className="font-semibold text-slate-900 hover:text-primary">{row.memberFullName}</div>
          <div className="text-xs text-muted-foreground">{row.unityId ? `Unity ${row.unityId}` : row.memberSource === "UNITY" ? "Imported member" : "Manual member"}</div>
        </button>
      ),
    },
    {
      key: "contact",
      header: "Phone / Email",
      cell: (row) => (
        <div className="space-y-1 text-sm">
          <div>{row.phone || "Not set"}</div>
          <div className="text-xs text-muted-foreground">{row.email || "Not set"}</div>
        </div>
      ),
    },
    {
      key: "group",
      header: "Sector / Group",
      cell: (row) => row.sectorOrGroup || "Not set",
    },
    {
      key: "last_visit",
      header: "Last Visit",
      cell: (row) => (
        <div className="space-y-1 text-sm">
          <div>{formatDateTime(row.lastVisitDate)}</div>
          <div className="text-xs text-muted-foreground">{row.lastVisitedBy || "No visitor yet"}</div>
        </div>
      ),
    },
    {
      key: "counts",
      header: "Counts",
      cell: (row) => (
        <div className="space-y-1 text-sm">
          <div>Range: {row.visitCountInRange}</div>
          <div className="text-xs text-muted-foreground">Lifetime: {row.totalLifetimeVisits}</div>
        </div>
      ),
    },
    {
      key: "next_visit",
      header: "Next Scheduled",
      cell: (row) => formatDateTime(row.nextScheduledVisit),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <span
          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
            row.status === "Not Visited"
              ? "bg-rose-50 text-rose-700"
              : row.status === "Low Visitation"
                ? "bg-amber-50 text-amber-700"
                : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      mobileVariant: "actions",
      cell: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => navigate(`/members/${row.memberId}`)} size="sm" type="button" variant="outline">Open</Button>
          {row.phone ? <a className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs" href={`tel:${row.phone}`}><Phone className="mr-1 h-3.5 w-3.5" />Call</a> : null}
          {row.phone ? <a className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs" href={`sms:${row.phone}`}><MessageCircle className="mr-1 h-3.5 w-3.5" />Text</a> : null}
          {row.phone ? <a className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs" href={`https://wa.me/${row.phone.replace(/\D/g, "")}`} rel="noreferrer" target="_blank"><MessageCircle className="mr-1 h-3.5 w-3.5" />WhatsApp</a> : null}
          {row.email ? <a className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs" href={`mailto:${row.email}`}><Mail className="mr-1 h-3.5 w-3.5" />Email</a> : null}
          <Button onClick={() => navigate(`/calendar/schedule?memberId=${row.memberId}`)} size="sm" type="button" variant="outline"><CalendarDays className="mr-1 h-3.5 w-3.5" />Schedule</Button>
        </div>
      ),
    },
  ], [navigate]);

  return (
    <DataGrid
      columns={columns}
      emptyDescription="No members match this report."
      emptyTitle="No matching members"
      getRowKey={(row) => row.memberId}
      rows={rows}
    />
  );
};
