import { ArrowUpDown, Download, Plus, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import type { CreateMemberInput, MemberImportJob } from "../../shared/types";
import { MemberAvatar, MemberFormDialog, MemberImportDialog, UnityBadge } from "../components/members/member-ui";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { PageHeader } from "../components/common/page-header";
import { Button } from "../components/ui/button";
import { api, isApiConfigured } from "../lib/api";
import { useAuth } from "../lib/auth";
import { refreshMembersIndexCache, useMembersIndex } from "../lib/members-index";

type SortMode = "az" | "recent";
const PAGE_SIZE = 25;
const activeImportJobStorageKey = "members-import-job-id";

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });

export const MembersPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const {
    cacheScope,
    items: members,
    isPending,
    isFetching,
    error: membersError,
    refresh,
    status: authStatus,
  } = useMembersIndex();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("az");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [savingMember, setSavingMember] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importJob, setImportJob] = useState<MemberImportJob | null>(null);

  useEffect(() => {
    if (searchParams.get("mobileAction") !== "new-member") {
      return;
    }

    setCreateOpen(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("mobileAction");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const persistedJobId = window.sessionStorage.getItem(activeImportJobStorageKey);
    if (!persistedJobId || importJob) {
      return;
    }

    void (async () => {
      try {
        const nextJob = await api.get<MemberImportJob>(`/members/import/${persistedJobId}`);
        setImportJob(nextJob);
      } catch {
        window.sessionStorage.removeItem(activeImportJobStorageKey);
      }
    })();
  }, [importJob]);

  const filteredMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const next = normalized
      ? members.filter((member) => member.normalizedSearchText.includes(normalized))
      : members;

    return [...next].sort((left, right) =>
      sortMode === "az"
        ? left.fullName.localeCompare(right.fullName)
        : right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [members, query, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedMembers = useMemo(
    () => filteredMembers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, filteredMembers],
  );

  const handleCreateMember = useCallback(async (value: CreateMemberInput) => {
    setSavingMember(true);
    setError(null);
    try {
      await api.post("/members", value);
      setCreateOpen(false);
      await refreshMembersIndexCache(queryClient, cacheScope);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create member.");
    } finally {
      setSavingMember(false);
    }
  }, [queryClient, user?.tenantId]);

  const handleImport = useCallback(async (file: File) => {
    setImporting(true);
    setImportJob(null);
    setError(null);
    try {
      const workbookBase64 = await fileToBase64(file);
      const nextJob = await api.post<MemberImportJob>("/members/import", {
        fileName: file.name,
        workbookBase64,
      });
      window.sessionStorage.setItem(activeImportJobStorageKey, nextJob.jobId);
      setImportJob(nextJob);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to import members.");
    } finally {
      setImporting(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    if (!importJob || !["queued", "running"].includes(importJob.status)) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const nextJob = await api.get<MemberImportJob>(`/members/import/${importJob.jobId}`);
          setImportJob(nextJob);
          if (nextJob.status === "completed") {
            window.sessionStorage.removeItem(activeImportJobStorageKey);
            await refreshMembersIndexCache(queryClient, cacheScope);
          }
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Unable to refresh import status.");
        }
      })();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [cacheScope, importJob, queryClient]);

  if (!isApiConfigured) {
    return <ErrorState description="Set `VITE_API_BASE_URL` or regenerate `amplify_outputs.json` before using member APIs." title="API not configured" />;
  }

  if (authStatus === "loading" || (isPending && !members.length)) {
    return <LoadingState description="Loading congregation directory." title="Preparing members" />;
  }

  if (membersError && !members.length) {
    return <ErrorState description={membersError instanceof Error ? membersError.message : "Unable to load members."} title="Unable to load members" />;
  }

  return (
    <div className="space-y-3">
      <PageHeader
        className="overflow-hidden rounded-lg border border-border bg-white p-3"
        title="Congregation"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-background px-3 py-1.5 sm:min-w-[280px]">
            <input
              aria-label="Search members"
              className="w-full min-w-0 bg-transparent text-sm outline-none"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search members"
              value={query}
            />
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
              {filteredMembers.length} members
            </span>
          </label>
          <div className="grid grid-cols-4 gap-2 sm:flex sm:items-center">
            <Button
              aria-label={sortMode === "az" ? "Sort A to Z" : "Sort by recent"}
              className="w-full sm:w-auto"
              onClick={() => {
                setSortMode((current) => (current === "az" ? "recent" : "az"));
                setPage(1);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <ArrowUpDown className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">{sortMode === "az" ? "A-Z" : "Recent"}</span>
            </Button>
            <Button
              aria-label="Import Excel"
              className="w-full sm:w-auto"
              onClick={() => setImportOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Import Excel</span>
            </Button>
            <Button
              aria-label="Refresh members"
              className="w-full sm:w-auto"
              disabled={isFetching}
              onClick={() => void refresh()}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              <span className="sr-only sm:not-sr-only">Refresh</span>
            </Button>
            <Button
              aria-label="Add Member"
              className="w-full sm:w-auto"
              onClick={() => setCreateOpen(true)}
              size="sm"
              type="button"
            >
              <Plus className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Add Member</span>
            </Button>
          </div>
        </div>
      </PageHeader>

      {error ? <ErrorState description={error} title="Member action failed" /> : null}
      {!error && membersError ? (
        <ErrorState
          description={membersError instanceof Error ? membersError.message : "Unable to refresh members."}
          title="Using cached member list"
        />
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 py-2 text-sm">
        <div className="text-muted-foreground">
          Showing {filteredMembers.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}
          {" "}-{" "}
          {Math.min(currentPage * PAGE_SIZE, filteredMembers.length)} of {filteredMembers.length}
        </div>
        <div className="flex items-center gap-2">
          {isFetching ? <div className="text-xs text-muted-foreground">Refreshing members...</div> : null}
          <Button
            disabled={currentPage <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            size="sm"
            type="button"
            variant="outline"
          >
            Previous
          </Button>
          <div className="text-xs text-muted-foreground">Page {currentPage} of {totalPages}</div>
          <Button
            disabled={currentPage >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            size="sm"
            type="button"
            variant="outline"
          >
            Next
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        {paginatedMembers.map((member) => (
          <button
            className="flex items-center gap-3 rounded-lg border border-border bg-white px-3 py-2 text-left transition-colors hover:border-primary/25 hover:bg-accent"
            key={member.memberId}
            onClick={() => navigate(`/members/${member.memberId}`)}
            type="button"
          >
            <MemberAvatar fullName={member.fullName} initials={member.initials} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-sm font-semibold text-slate-900">{member.fullName}</div>
                <UnityBadge className="shrink-0" source={member.source} unityId={member.unityId} />
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {member.email || member.phone || member.householdName || "Manual member"}
              </div>
            </div>
          </button>
        ))}
      </div>

      <MemberFormDialog
        busy={savingMember}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateMember}
        open={createOpen}
        title="Add Member"
      />
      <MemberImportDialog
        busy={importing}
        job={importJob}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
        open={importOpen}
      />
    </div>
  );
};
