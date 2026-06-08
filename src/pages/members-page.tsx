import { ArrowUpDown, Download, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { CreateMemberInput, Member, MemberDirectoryResponse, MemberImportResult } from "../../shared/types";
import { MemberAvatar, MemberFormDialog, MemberImportDialog, UnityBadge } from "../components/members/member-ui";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { PageHeader } from "../components/common/page-header";
import { Button } from "../components/ui/button";
import { api, isApiConfigured } from "../lib/api";

type SortMode = "az" | "recent";

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
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("az");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [savingMember, setSavingMember] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<MemberImportResult | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<MemberDirectoryResponse>("/members");
      setMembers(response.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load members.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

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

  const handleCreateMember = useCallback(async (value: CreateMemberInput) => {
    setSavingMember(true);
    try {
      await api.post("/members", value);
      setCreateOpen(false);
      await loadMembers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create member.");
    } finally {
      setSavingMember(false);
    }
  }, [loadMembers]);

  const handleImport = useCallback(async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const workbookBase64 = await fileToBase64(file);
      const result = await api.post<MemberImportResult>("/members/import", {
        fileName: file.name,
        workbookBase64,
      });
      setImportResult(result);
      await loadMembers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to import members.");
    } finally {
      setImporting(false);
    }
  }, [loadMembers]);

  if (!isApiConfigured) {
    return <ErrorState description="Set `VITE_API_BASE_URL` or regenerate `amplify_outputs.json` before using member APIs." title="API not configured" />;
  }

  if (loading) {
    return <LoadingState description="Loading congregation directory." title="Preparing members" />;
  }

  if (error && !members.length) {
    return <ErrorState description={error} title="Unable to load members" />;
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              value={query}
            />
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
              {filteredMembers.length} members
            </span>
          </label>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
            <Button
              aria-label={sortMode === "az" ? "Sort A to Z" : "Sort by recent"}
              className="w-full sm:w-auto"
              onClick={() => setSortMode((current) => (current === "az" ? "recent" : "az"))}
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

      <div className="grid gap-2">
        {filteredMembers.map((member) => (
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
                {member.email || member.phone || "Manual member"}
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
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
        open={importOpen}
        result={importResult}
      />
    </div>
  );
};
