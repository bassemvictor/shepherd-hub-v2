import { AlertTriangle, RotateCcw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { AdminResetAction, AdminResetSummary } from "../../shared/types";
import { PageHeader } from "../components/common/page-header";
import { ErrorState } from "../components/states/error-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { api, isApiConfigured } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ToastStack, type ToastItem } from "./calendar-shared";

const confirmationText = "RESET";

const resetActions: Array<{
  action: AdminResetAction;
  description: string;
  impact: string;
  title: string;
  warning: string;
}> = [
  {
    action: "tenant_all",
    title: "Delete all tenant data",
    description: "Deletes every tenant-scoped record in the database for the current tenant.",
    warning: "This is the broadest reset and permanently removes members, visitations, Google sync data, and audit history.",
    impact: "Estimated impact: all records stored for this tenant.",
  },
  {
    action: "google_cached_events",
    title: "Delete Google cached events",
    description: "Deletes cached Google Calendar event records and their dependent assignment and visitation cache records only.",
    warning: "Google account connections, refresh tokens, calendar configuration, and sync settings are preserved.",
    impact: "Estimated impact: cached schedule events plus related event assignment and calendar visitation cache rows.",
  },
  {
    action: "google_connections",
    title: "Delete Google accounts and tokens",
    description: "Deletes Google account connection records, token records, synced calendar configuration, sync metadata, and dependent cached events.",
    warning: "Users will need to reconnect Google Calendar and resync calendars after this reset.",
    impact: "Estimated impact: Google connection records, calendars, sync settings, cached events, and related sync state for this tenant.",
  },
  {
    action: "visitations",
    title: "Delete visitation records",
    description: "Deletes all visitation records for the current tenant.",
    warning: "Visitation history will be permanently removed.",
    impact: "Estimated impact: all `VISITATION` records in this tenant.",
  },
  {
    action: "members",
    title: "Delete members",
    description: "Deletes members, households, their activity records and tag assignments for the current tenant. Tag definitions are preserved.",
    warning: "Member profiles and related activity history will be permanently removed.",
    impact: "Estimated impact: all `MEMBER` and `MEMBER_ACTIVITY` records in this tenant.",
  },
  {
    action: "audit_logs",
    title: "Delete auditing events",
    description: "Deletes admin audit log records for the current tenant only.",
    warning: "Audit history is permanently removed and cannot be recovered.",
    impact: "Estimated impact: all tenant `AUDIT_LOG` records.",
  },
];

export const AdminTenantResetPage = () => {
  const { user } = useAuth();
  const [activeAction, setActiveAction] = useState<AdminResetAction | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [runningAction, setRunningAction] = useState<AdminResetAction | null>(null);
  const [lastSummary, setLastSummary] = useState<AdminResetSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((tone: ToastItem["tone"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const selectedAction = useMemo(
    () => resetActions.find((item) => item.action === activeAction) ?? null,
    [activeAction],
  );

  const runReset = useCallback(async () => {
    if (!activeAction) {
      return;
    }

    setRunningAction(activeAction);
    setError(null);
    try {
      const summary = await api.post<AdminResetSummary>(`/admin/reset/${activeAction}`);
      setLastSummary(summary);
      setActiveAction(null);
      setConfirmation("");
      pushToast(
        "success",
        `${selectedAction?.title ?? "Reset"} completed. ${summary.recordsDeleted} rows deleted.`,
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to run tenant reset.";
      setError(message);
      pushToast("error", message);
    } finally {
      setRunningAction(null);
    }
  }, [activeAction, pushToast, selectedAction?.title]);

  if (!isApiConfigured) {
    return <ErrorState description="Configure the API before using admin tools." title="API not configured" />;
  }

  return (
    <>
      <ToastStack toasts={toasts} />
      <div className="space-y-4">
        <PageHeader
          description="Run destructive, tenant-scoped reset tools. Every action requires typed confirmation and is enforced server-side for admin users only."
          title="Tenant Reset"
        />

        {error ? <ErrorState description={error} title="Reset failed" /> : null}

        {lastSummary ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Last reset result</CardTitle>
                <CardDescription>Status: {lastSummary.status}</CardDescription>
              </div>
              <Badge variant={lastSummary.status === "success" ? "success" : "warning"}>
                {lastSummary.recordsDeleted} rows deleted
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {lastSummary.affectedEntities.length ? lastSummary.affectedEntities.map((entity) => (
                <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-sm" key={entity.entityType}>
                  <span>{entity.entityType}</span>
                  <span className="font-medium">{entity.deleted}</span>
                </div>
              )) : <p className="text-sm text-muted-foreground">No matching records were found for that reset.</p>}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          {resetActions.map((item) => (
            <Card key={item.action}>
              <CardHeader>
                <div>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{item.warning}</span>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">{item.impact}</div>
                <div className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  Tenant scope: {user?.tenantId ?? "Unassigned"}
                </div>
                <Button
                  className="w-full bg-rose-600 text-white hover:bg-rose-700"
                  disabled={runningAction !== null}
                  onClick={() => {
                    setActiveAction(item.action);
                    setConfirmation("");
                  }}
                  type="button"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Open reset flow
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog
        description={selectedAction?.description}
        onClose={() => {
          if (runningAction) {
            return;
          }
          setActiveAction(null);
          setConfirmation("");
        }}
        open={Boolean(selectedAction)}
        title={selectedAction?.title ?? "Tenant Reset"}
      >
        <div className="space-y-4">
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-400/35 dark:bg-rose-500/12 dark:text-rose-100">
            {selectedAction?.warning}
          </div>
          <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {selectedAction?.impact}
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground" htmlFor="tenant-reset-confirmation">
              Type <span className="font-semibold">{confirmationText}</span> to confirm
            </label>
            <Input
              id="tenant-reset-confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={confirmationText}
              value={confirmation}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              disabled={runningAction !== null}
              onClick={() => {
                setActiveAction(null);
                setConfirmation("");
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={confirmation !== confirmationText || runningAction !== null}
              onClick={() => void runReset()}
              type="button"
            >
              {runningAction ? "Resetting..." : "Run reset"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};
