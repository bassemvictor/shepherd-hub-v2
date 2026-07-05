import { CalendarDays, Mail, MessageCircle, Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { AppAuthUser } from "../../lib/auth";
import type { VisitationOverviewRow } from "../../../shared/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  formatReportDate,
  formatCaregiverNames,
  getActivityCopy,
  getLastVisit,
  getRelevantVisits,
  getVisitCountForPeriod,
  getVisitStatus,
  type ReportPeriod,
  type ReportScope,
} from "./visitation-report-utils";
import type { ReportsVisitationTypeFilter } from "../../../shared/types";

const statusVariant = (status: ReturnType<typeof getVisitStatus>) =>
  (status.startsWith("Needs ") ? "warning" as const : "success" as const);

export const MemberVisitationView = ({
  rows,
  scope,
  period,
  visitationType,
  currentUser,
  page,
  totalPages,
  onPageChange,
}: {
  rows: VisitationOverviewRow[];
  scope: ReportScope;
  period: ReportPeriod;
  visitationType: ReportsVisitationTypeFilter;
  currentUser?: AppAuthUser | null;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) => {
  const navigate = useNavigate();
  const activityCopy = getActivityCopy(visitationType);
  const allCaregiversLabel = "All Caregivers";
  const lastCaregiverLabel = "Last Caregiver";
  const lastCareDateLabel = "Date of Last Care";
  const typeLabel = visitationType === "all" ? "Care" : "Activity Type";

  return (
    <Card>
      <CardHeader className="items-start sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Member Report</CardTitle>
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
            const status = getVisitStatus(row, period, scope, visitationType, currentUser);
            return (
              <div
                className="rounded-xl border border-border/80 bg-card/95 p-3 text-left shadow-sm shadow-slate-950/5 backdrop-blur-sm"
                key={row.memberId}
              >
                <div className="flex items-start justify-between gap-3">
                  <button className="min-w-0 text-left text-foreground transition-colors hover:text-primary" onClick={() => navigate(`/members/${row.memberId}`)} type="button">
                    <div className="truncate text-sm font-semibold">{row.memberFullName}</div>
                    <div className="text-xs text-muted-foreground">{row.phone || row.email || "No contact info"}</div>
                  </button>
                  <Badge variant={statusVariant(status)}>{status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-foreground">
                  <div>Group: {row.sectorOrGroup || "Not set"}</div>
                  <div>{typeLabel}: {visitationType === "all" ? "All" : visitationType}</div>
                  <div>{lastCareDateLabel}: {formatReportDate(getLastVisit(row, scope, currentUser))}</div>
                  <div>{activityCopy.countLabel}: {getVisitCountForPeriod(row, period, scope, currentUser)}</div>
                  <div>{allCaregiversLabel}: {formatCaregiverNames(relevant, activityCopy.noneYetLabel)}</div>
                  <div>{lastCaregiverLabel}: {relevant.lastVisitedBy || activityCopy.noneYetLabel}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {row.phone ? <a className="inline-flex h-8 items-center rounded-md border border-border bg-background/60 px-2 text-xs text-foreground transition-colors hover:bg-accent" href={`tel:${row.phone}`}><Phone className="mr-1 h-3.5 w-3.5" />Call</a> : null}
                  {row.phone ? <a className="inline-flex h-8 items-center rounded-md border border-border bg-background/60 px-2 text-xs text-foreground transition-colors hover:bg-accent" href={`sms:${row.phone}`}><MessageCircle className="mr-1 h-3.5 w-3.5" />Text</a> : null}
                  {row.email ? <a className="inline-flex h-8 items-center rounded-md border border-border bg-background/60 px-2 text-xs text-foreground transition-colors hover:bg-accent" href={`mailto:${row.email}`}><Mail className="mr-1 h-3.5 w-3.5" />Email</a> : null}
                  <Button className="border-border/90 bg-background/60 hover:bg-accent" onClick={() => navigate(`/calendar/schedule?memberId=${row.memberId}`)} size="sm" type="button" variant="outline"><CalendarDays className="h-3.5 w-3.5" />Schedule</Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-border/70 bg-card/95 shadow-sm shadow-slate-950/5 md:block">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left">
                {["Member", "Phone", "Group", typeLabel, lastCareDateLabel, activityCopy.countLabel, allCaregiversLabel, lastCaregiverLabel, "Status", "Actions"].map((header) => (
                  <th className="border-b border-border/80 bg-muted/35 px-3 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground" key={header}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const relevant = getRelevantVisits(row, scope, currentUser);
                const status = getVisitStatus(row, period, scope, visitationType, currentUser);
                return (
                  <tr className="bg-card/80 text-foreground transition-colors odd:bg-card even:bg-muted/14 hover:bg-accent/45" key={row.memberId}>
                    <td className="border-b border-border/70 px-3 py-3">
                      <button className="text-left text-foreground transition-colors hover:text-primary" onClick={() => navigate(`/members/${row.memberId}`)} type="button">
                        <div className="font-semibold">{row.memberFullName}</div>
                        <div className="text-xs text-muted-foreground">{row.unityId ? `Unity ${row.unityId}` : "Member record"}</div>
                      </button>
                    </td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{row.phone || "Not set"}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{row.sectorOrGroup || "Not set"}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{visitationType === "all" ? "All" : visitationType}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{formatReportDate(getLastVisit(row, scope, currentUser))}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{getVisitCountForPeriod(row, period, scope, currentUser)}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{formatCaregiverNames(relevant, activityCopy.noneYetLabel)}</td>
                    <td className="border-b border-border/70 px-3 py-3 text-sm">{relevant.lastVisitedBy || activityCopy.noneYetLabel}</td>
                    <td className="border-b border-border/70 px-3 py-3"><Badge variant={statusVariant(status)}>{status}</Badge></td>
                    <td className="border-b border-border/70 px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Button className="border-border/90 bg-background/55 hover:bg-accent" onClick={() => navigate(`/members/${row.memberId}`)} size="sm" type="button" variant="outline">Open</Button>
                        <Button className="border-border/90 bg-background/55 hover:bg-accent" onClick={() => navigate(`/calendar/schedule?memberId=${row.memberId}`)} size="sm" type="button" variant="outline">Schedule</Button>
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
