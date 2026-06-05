import { FolderKanban, Lock, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import type { DashboardSummary } from "../../shared/types";
import { PageHeader } from "../components/common/page-header";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { api, isApiConfigured } from "../lib/api";
import { formatGroupLabel, useAuth } from "../lib/auth";

const cards = [
  {
    key: "totalRecords",
    label: "Total Records",
    icon: FolderKanban,
    tone: "bg-blue-50 text-blue-700",
  },
  {
    key: "activeRecords",
    label: "Active Records",
    icon: ShieldCheck,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    key: "draftRecords",
    label: "Draft Records",
    icon: Lock,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    key: "archivedRecords",
    label: "Archived Records",
    icon: UserRound,
    tone: "bg-slate-100 text-slate-700",
  },
] as const;

export const DashboardPage = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(isApiConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isApiConfigured) {
      return;
    }

    setLoading(true);
    void api
      .get<DashboardSummary>("/dashboard/summary")
      .then((response) => {
        setSummary(response);
        setError(null);
      })
      .catch((reason: Error) => {
        setError(reason.message);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        description="This starter dashboard confirms protected routing, Amplify authentication, and authenticated backend calls."
        title="Dashboard"
      />

      <section className="grid gap-3 xl:grid-cols-[1.3fr_0.9fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Authenticated Session</CardTitle>
              <CardDescription>Read the current user directly from the Amplify session provider.</CardDescription>
            </div>
            <Badge variant="success">Protected Route</Badge>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-2.5">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Name</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{user?.name || "Unavailable"}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-2.5">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Email</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{user?.email || "Unavailable"}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-2.5">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Username</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{user?.username || "Unavailable"}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-2.5">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Groups</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {user?.groups.length ? (
                  user.groups.map((group) => (
                    <Badge key={group} variant="default">
                      {formatGroupLabel(group)}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="neutral">No groups in token</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Template Checklist</CardTitle>
              <CardDescription>Use these pieces as the baseline for future apps.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <div className="rounded-md bg-slate-50 p-2.5">Amplify Cognito sign-in with protected React routes</div>
            <div className="rounded-md bg-slate-50 p-2.5">API Gateway to Lambda with bearer token forwarding</div>
            <div className="rounded-md bg-slate-50 p-2.5">DynamoDB-backed sample CRUD with tenant-aware partitioning</div>
            <div className="rounded-md bg-slate-50 p-2.5">Reusable grid and right-side drawer UI patterns</div>
          </CardContent>
        </Card>
      </section>

      {loading ? (
        <LoadingState
          description="Loading a small summary from the backend."
          title="Fetching dashboard data"
        />
      ) : error ? (
        <ErrorState
          description={error}
          title="Dashboard request failed"
        />
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            const value = summary ? summary[card.key] : 0;

            return (
              <Card key={card.key}>
                <CardHeader className="items-center">
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <div>
                    <CardDescription>{card.label}</CardDescription>
                    <CardTitle className="mt-1 text-xl">{value}</CardTitle>
                    </div>
                    <div className={`rounded-md p-2 ${card.tone}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
};
