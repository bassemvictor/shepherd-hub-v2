import { CalendarDays, Mail, MessageCircle, Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { AppAuthUser } from "../../lib/auth";
import type { VisitationOverviewRow } from "../../../shared/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  formatReportDate,
  getLastVisit,
  getRelevantVisits,
  getVisitCountForPeriod,
  getVisitStatus,
  type ReportPeriod,
  type ReportScope,
} from "./visitation-report-utils";

const statusVariant = (status: ReturnType<typeof getVisitStatus>) =>
  (status === "Need a Visit" ? "warning" as const : "success" as const);

export const MemberVisitationView = ({
  rows,
  scope,
  period,
  currentUser,
  page,
  totalPages,
  onPageChange,
}: {
  rows: VisitationOverviewRow[];
  scope: ReportScope;
  period: ReportPeriod;
  currentUser?: AppAuthUser | null;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) => {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="items-start sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Member Visitation</CardTitle>
          <div className="text-xs text-muted-foreground">Clear member-by-member results for the filters you selected.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} size="sm" type="button" variant="outline">
            Previous
          </Button>
          <div className="text-xs text-muted-foreground">Page {page} of {totalPages}</div>
          <Button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} size="sm" type="button" variant="outline">
            Next
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:hidden">
          {rows.map((row) => {
            const relevant = getRelevantVisits(row, scope, currentUser);
            const status = getVisitStatus(row, period, scope, currentUser);
            return (
              <button
                className="rounded-lg border border-border/80 bg-slate-50 p-3 text-left"
                key={row.memberId}
                onClick={() => navigate(`/members/${row.memberId}`)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-950">{row.memberFullName}</div>
                    <div className="text-xs text-muted-foreground">{row.phone || row.email || "No contact info"}</div>
                  </div>
                  <Badge variant={statusVariant(status)}>{status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-700">
                  <div>Group: {row.sectorOrGroup || "Not set"}</div>
                  <div>Last Visit: {formatReportDate(getLastVisit(row, scope, currentUser))}</div>
                  <div>Visits: {getVisitCountForPeriod(row, period, scope, currentUser)}</div>
                  <div>Visitor: {relevant.lastVisitedBy || "No visitor yet"}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {row.phone ? <a className="inline-flex h-8 items-center rounded-md border border-border bg-white px-2 text-xs" href={`tel:${row.phone}`} onClick={(event) => event.stopPropagation()}><Phone className="mr-1 h-3.5 w-3.5" />Call</a> : null}
                  {row.phone ? <a className="inline-flex h-8 items-center rounded-md border border-border bg-white px-2 text-xs" href={`sms:${row.phone}`} onClick={(event) => event.stopPropagation()}><MessageCircle className="mr-1 h-3.5 w-3.5" />Text</a> : null}
                  {row.email ? <a className="inline-flex h-8 items-center rounded-md border border-border bg-white px-2 text-xs" href={`mailto:${row.email}`} onClick={(event) => event.stopPropagation()}><Mail className="mr-1 h-3.5 w-3.5" />Email</a> : null}
                  <Button onClick={(event) => { event.stopPropagation(); navigate(`/calendar/schedule?memberId=${row.memberId}`); }} size="sm" type="button" variant="outline"><CalendarDays className="h-3.5 w-3.5" />Schedule</Button>
                </div>
              </button>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left">
                {["Member", "Phone", "Group", "Last Visit", "Visits", "Visitor", "Status", "Actions"].map((header) => (
                  <th className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground" key={header}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const relevant = getRelevantVisits(row, scope, currentUser);
                const status = getVisitStatus(row, period, scope, currentUser);
                return (
                  <tr className="bg-white hover:bg-slate-50/80" key={row.memberId}>
                    <td className="border-b border-border/70 px-3 py-3">
                      <button className="text-left" onClick={() => navigate(`/members/${row.memberId}`)} type="button">
                        <div className="font-semibold text-slate-950">{row.memberFullName}</div>
                        <div className="text-xs text-muted-foreground">{row.unityId ? `Unity ${row.unityId}` : "Member record"}</div>
                      </button>
                    </td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{row.phone || "Not set"}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{row.sectorOrGroup || "Not set"}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{formatReportDate(getLastVisit(row, scope, currentUser))}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{getVisitCountForPeriod(row, period, scope, currentUser)}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{relevant.lastVisitedBy || "No visitor yet"}</td>
                    <td className="border-b border-border/70 px-3 py-3"><Badge variant={statusVariant(status)}>{status}</Badge></td>
                    <td className="border-b border-border/70 px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Button onClick={() => navigate(`/members/${row.memberId}`)} size="sm" type="button" variant="outline">Open</Button>
                        <Button onClick={() => navigate(`/calendar/schedule?memberId=${row.memberId}`)} size="sm" type="button" variant="outline">Schedule</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};
