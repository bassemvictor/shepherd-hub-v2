import { ArrowRight } from "lucide-react";

import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import type { ReportsVisitationTypeFilter, VisitationOverviewRow } from "../../../shared/types";
import { formatRelativeVisitAge, getActivityCopy } from "./visitation-report-utils";

export const MembersRequiringAttentionCard = ({
  title = "Members Needing a Visit",
  members,
  getLastVisitLabel,
  visitationType,
  onViewAll,
}: {
  title?: string;
  members: VisitationOverviewRow[];
  getLastVisitLabel: (member: VisitationOverviewRow) => string | undefined;
  visitationType: ReportsVisitationTypeFilter;
  onViewAll: () => void;
}) => {
  const activityCopy = getActivityCopy(visitationType);

  return (
    <Card>
      <CardHeader className="items-start sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
        </div>
        <Button onClick={onViewAll} size="sm" type="button" variant="outline">
          View All
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.length ? members.map((member) => (
          <div className="flex items-center justify-between rounded-md border border-border/80 px-3 py-2" key={member.memberId}>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{member.memberFullName}</div>
              <div className="text-xs text-muted-foreground">{member.sectorOrGroup || "No group assigned"}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-medium text-slate-900">{formatRelativeVisitAge(getLastVisitLabel(member))}</div>
              <div className="text-xs text-muted-foreground">{getLastVisitLabel(member) ? activityCopy.lastLabel : activityCopy.noneYetLabel}</div>
            </div>
          </div>
        )) : (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Everyone has matching {activityCopy.pluralLower} for this period.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
