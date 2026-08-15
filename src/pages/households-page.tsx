import { AlertCircle, ArrowUpDown, CheckCircle2, Clock3, MapPinOff, MoreHorizontal, Plus, RefreshCcw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import type { CreateHouseholdInput, HouseholdGeocodeStatus, HouseholdSummary } from "../../shared/types";
import { HouseholdFormDialog } from "../components/members/household-ui";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { PageHeader } from "../components/common/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { api, isApiConfigured } from "../lib/api";
import { isAdminUser, useAuth } from "../lib/auth";
import { useHouseholdsIndex, refreshHouseholdsIndexCache } from "../lib/households-index";
import { useMembersIndex } from "../lib/members-index";

type SortMode = "az" | "recent";
const PAGE_SIZE = 25;

const getHouseholdGeocodeStatus = (household: HouseholdSummary): HouseholdGeocodeStatus | "unmapped" => {
  if (household.location?.geocodeStatus) {
    return household.location.geocodeStatus;
  }

  return household.location?.latitude !== undefined && household.location?.longitude !== undefined
    ? "success"
    : "unmapped";
};

const geocodeStatusMeta: Record<
  HouseholdGeocodeStatus | "unmapped",
  {
    label: string;
    badgeVariant: "success" | "warning" | "neutral";
    Icon: typeof CheckCircle2;
  }
> = {
  success: {
    label: "Geocoded",
    badgeVariant: "success",
    Icon: CheckCircle2,
  },
  pending: {
    label: "Geocoding pending",
    badgeVariant: "warning",
    Icon: Clock3,
  },
  failed: {
    label: "Geocode failed",
    badgeVariant: "warning",
    Icon: AlertCircle,
  },
  not_started: {
    label: "Not geocoded",
    badgeVariant: "neutral",
    Icon: MapPinOff,
  },
  unmapped: {
    label: "Not geocoded",
    badgeVariant: "neutral",
    Icon: MapPinOff,
  },
};

export const HouseholdsPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const {
    cacheScope,
    items: households,
    isPending,
    isFetching,
    error: householdsError,
    refresh,
  } = useHouseholdsIndex();
  const { items: members } = useMembersIndex();
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("az");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredHouseholds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const next = normalized
      ? households.filter((household) => household.normalizedSearchText.includes(normalized))
      : households;

    return [...next].sort((left, right) =>
      sortMode === "az"
        ? left.householdName.localeCompare(right.householdName)
        : right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [households, query, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filteredHouseholds.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedHouseholds = filteredHouseholds.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const geocodeCounts = useMemo(() => households.reduce(
    (totals, household) => {
      const status = getHouseholdGeocodeStatus(household);
      totals[status] += 1;
      return totals;
    },
    {
      success: 0,
      pending: 0,
      failed: 0,
      not_started: 0,
      unmapped: 0,
    } as Record<HouseholdGeocodeStatus | "unmapped", number>,
  ), [households]);

  const handleCreate = useCallback(async (value: CreateHouseholdInput) => {
    setSaving(true);
    setError(null);
    try {
      await api.post("/households", value);
      setCreateOpen(false);
      await refreshHouseholdsIndexCache(queryClient, cacheScope);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create household.");
    } finally {
      setSaving(false);
    }
  }, [cacheScope, queryClient]);

  if (!isApiConfigured) {
    return <ErrorState description="Set `VITE_API_BASE_URL` or regenerate `amplify_outputs.json` before using household APIs." title="API not configured" />;
  }

  if (isPending && !households.length) {
    return <LoadingState description="Loading households." title="Preparing households" />;
  }

  return (
    <div className="space-y-3">
      <PageHeader className="overflow-hidden rounded-lg border border-border bg-white p-3" title="Households">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-background px-3 py-1.5 sm:min-w-[280px]">
            <input
              aria-label="Search households"
              className="w-full min-w-0 bg-transparent text-sm outline-none"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search households by name, address, or member"
              value={query}
            />
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{filteredHouseholds.length} households</span>
          </label>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
            <Button onClick={() => setSortMode((current) => current === "az" ? "recent" : "az")} size="sm" type="button" variant="outline">
              <ArrowUpDown className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">{sortMode === "az" ? "A-Z" : "Recent"}</span>
            </Button>
            <Button disabled={isFetching} onClick={() => void refresh()} size="sm" type="button" variant="outline">
              <RefreshCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              <span className="sr-only sm:not-sr-only">Refresh</span>
            </Button>
            <Button onClick={() => setCreateOpen(true)} size="sm" type="button">
              <Plus className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Create Household</span>
            </Button>
          </div>
        </div>
      </PageHeader>

      {error ? <ErrorState description={error} title="Household action failed" /> : null}
      {!error && householdsError ? (
        <ErrorState
          description={householdsError instanceof Error ? householdsError.message : "Unable to refresh households."}
          title="Using cached households"
        />
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 py-2 text-sm">
        <div className="text-muted-foreground">
          Showing {filteredHouseholds.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0} - {Math.min(currentPage * PAGE_SIZE, filteredHouseholds.length)} of {filteredHouseholds.length}
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} size="sm" type="button" variant="outline">Previous</Button>
          <div className="text-xs text-muted-foreground">Page {currentPage} of {totalPages}</div>
          <Button disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} size="sm" type="button" variant="outline">Next</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-white px-3 py-2">
        <Badge variant="success">Geocoded: {geocodeCounts.success}</Badge>
        <Badge variant="warning">Pending: {geocodeCounts.pending}</Badge>
        <Badge variant="warning">Failed: {geocodeCounts.failed}</Badge>
        <Badge variant="neutral">Not geocoded: {geocodeCounts.not_started + geocodeCounts.unmapped}</Badge>
      </div>

      <div className="grid gap-2">
        {paginatedHouseholds.map((household) => (
          (() => {
            const status = getHouseholdGeocodeStatus(household);
            const statusMeta = geocodeStatusMeta[status];
            const StatusIcon = statusMeta.Icon;

            return (
              <button
                className="flex items-start gap-3 rounded-lg border border-border bg-white px-3 py-3 text-left transition-colors hover:border-primary/25 hover:bg-accent"
                key={household.householdId}
                onClick={() => navigate(`/households/${household.householdId}`)}
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-slate-900">{household.householdName}</div>
                        <Badge className="gap-1" variant={statusMeta.badgeVariant}>
                          <StatusIcon className="h-3 w-3" />
                          {statusMeta.label}
                        </Badge>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{household.address || "No address"}</div>
                      {isAdminUser(user?.groups ?? []) && household.addressKey ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {household.addressKey}
                        </div>
                      ) : null}
                    </div>
                    <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{household.memberCount} members</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {household.members.slice(0, 5).map((member) => (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground" key={member.memberId}>
                        {member.fullName}
                      </span>
                    ))}
                    {household.memberCount > household.members.length ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        +{household.memberCount - household.members.length} more
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })()
        ))}
      </div>

      <HouseholdFormDialog
        busy={saving}
        initialValue={undefined}
        members={members.filter((member) => !member.householdId)}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        open={createOpen}
        title="Create Household"
      />
    </div>
  );
};
