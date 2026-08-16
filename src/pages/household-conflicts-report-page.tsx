import { ArrowRight, Home, TriangleAlert, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import type {
  HouseholdConflict,
  HouseholdGeocodeStatus,
  HouseholdConflictListResponse,
  ResolveHouseholdConflictAction,
} from "../../shared/types";
import { ReportsLayout } from "../components/reports/reports-layout";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { api, getDisplayErrorMessage } from "../lib/api";
import { refreshHouseholdsIndexCache, useHouseholdsIndex } from "../lib/households-index";
import { refreshMembersIndexCache, useMembersIndex } from "../lib/members-index";

const geocodeStatusMeta: Record<HouseholdGeocodeStatus, { label: string; variant: "success" | "warning" | "neutral" }> = {
  success: { label: "Geocoded", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  failed: { label: "Failed", variant: "warning" },
  not_started: { label: "Not geocoded", variant: "neutral" },
};

const GeocodeStatusBadge = ({ status }: { status?: HouseholdGeocodeStatus }) => {
  if (!status) {
    return null;
  }

  const meta = geocodeStatusMeta[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
};

export const HouseholdConflictsReportPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { cacheScope: memberCacheScope } = useMembersIndex();
  const { cacheScope: householdCacheScope } = useHouseholdsIndex();
  const [items, setItems] = useState<HouseholdConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);

  const loadConflicts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<HouseholdConflictListResponse>("/household-conflicts");
      setItems(response.items);
    } catch (reason) {
      setError(getDisplayErrorMessage(reason, "Unable to load household conflicts."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConflicts();
  }, [loadConflicts]);

  const handleResolve = useCallback(async (memberId: string, action: ResolveHouseholdConflictAction) => {
    setResolvingKey(`${memberId}:${action}`);
    setError(null);
    try {
      await api.post(`/household-conflicts/${memberId}/resolve`, { action });
      await Promise.all([
        loadConflicts(),
        refreshMembersIndexCache(queryClient, memberCacheScope),
        refreshHouseholdsIndexCache(queryClient, householdCacheScope),
      ]);
    } catch (reason) {
      setError(getDisplayErrorMessage(reason, "Unable to resolve household conflict."));
    } finally {
      setResolvingKey(null);
    }
  }, [householdCacheScope, loadConflicts, memberCacheScope, queryClient]);

  if (loading) {
    return <LoadingState description="Loading unresolved household conflicts." title="Preparing conflicts" />;
  }

  return (
    <ReportsLayout
      title="Household Conflicts"
      subtitle="Review members whose imported address does not match their current household assignment."
    >
      {error ? <ErrorState description={error} title="Conflict action failed" /> : null}

      {!items.length ? (
        <div className="rounded-lg border border-border bg-white p-6 text-center text-sm text-muted-foreground">
          No unresolved household conflicts right now.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((conflict) => (
            <section className="rounded-lg border border-border bg-white p-4" key={conflict.memberId}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                      <TriangleAlert className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{conflict.memberFullName}</div>
                      <div className="text-xs text-muted-foreground">
                        Detected {new Date(conflict.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <div className="rounded-md border border-border bg-background/40 p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        <Home className="h-3.5 w-3.5" />
                        Current Household
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-slate-900">{conflict.currentHouseholdName || "No household"}</div>
                        <GeocodeStatusBadge status={conflict.currentHouseholdGeocodeStatus} />
                      </div>
                      <div className="text-xs text-muted-foreground">{conflict.currentHouseholdAddress || "No address"}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background/40 p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        <UserRound className="h-3.5 w-3.5" />
                        Imported Address
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-900">{conflict.importedAddress || "No address"}</div>
                      <div className="text-xs text-muted-foreground">{conflict.importedPostalCode || "No postal code"}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background/40 p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        <ArrowRight className="h-3.5 w-3.5" />
                        Suggested Match
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-slate-900">{conflict.matchedHouseholdName || "No exact household match"}</div>
                        <GeocodeStatusBadge status={conflict.matchedHouseholdGeocodeStatus} />
                      </div>
                      <div className="text-xs text-muted-foreground">{conflict.matchedHouseholdAddress || "Create a new household if needed"}</div>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2 lg:w-56">
                  <Button onClick={() => navigate(`/members/${conflict.memberId}`)} size="sm" type="button" variant="ghost">
                    Open member
                  </Button>
                  <Button
                    disabled={resolvingKey === `${conflict.memberId}:KEEP_CURRENT_HOUSEHOLD`}
                    onClick={() => void handleResolve(conflict.memberId, "KEEP_CURRENT_HOUSEHOLD")}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Keep current
                  </Button>
                  {conflict.matchedHouseholdId ? (
                    <Button
                      disabled={resolvingKey === `${conflict.memberId}:MOVE_TO_MATCHING_HOUSEHOLD`}
                      onClick={() => void handleResolve(conflict.memberId, "MOVE_TO_MATCHING_HOUSEHOLD")}
                      size="sm"
                      type="button"
                    >
                      Move to match
                    </Button>
                  ) : null}
                  <Button
                    disabled={resolvingKey === `${conflict.memberId}:CREATE_NEW_HOUSEHOLD`}
                    onClick={() => void handleResolve(conflict.memberId, "CREATE_NEW_HOUSEHOLD")}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Create new household
                  </Button>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </ReportsLayout>
  );
};
