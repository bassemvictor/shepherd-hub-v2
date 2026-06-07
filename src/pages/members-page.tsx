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
    <div className="space-y-4">
      <PageHeader
        className="overflow-hidden rounded-[2rem] border-0 bg-[linear-gradient(180deg,#fefefe_0%,#fbfbf8_100%)] p-4 shadow-[0_16px_45px_rgba(16,33,61,0.08)]"
        description="Search, import, and manage congregation members with a mobile-first directory."
        title="Congregation"
      >
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#b39b62]">Congregation</div>
          <label className="flex items-center gap-3 rounded-full border border-[#efe7d3] bg-white px-4 py-3">
            <input
              className="w-full bg-transparent text-sm outline-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              value={query}
            />
            <span className="text-sm text-[#b39b62]">{filteredMembers.length} members</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setSortMode((current) => (current === "az" ? "recent" : "az"))} type="button" variant="outline">
              <ArrowUpDown className="h-4 w-4" />
              {sortMode === "az" ? "A-Z" : "Recent"}
            </Button>
            <Button onClick={() => setImportOpen(true)} type="button" variant="outline">
              <Download className="h-4 w-4" />
              Import Excel
            </Button>
            <Button onClick={() => setCreateOpen(true)} type="button">
              <Plus className="h-4 w-4" />
              Add Member
            </Button>
          </div>
        </div>
      </PageHeader>

      {error ? <ErrorState description={error} title="Member action failed" /> : null}

      <div className="grid gap-3">
        {filteredMembers.map((member) => (
          <button
            className="flex items-center gap-4 rounded-[2rem] bg-[#f2ede2] px-4 py-4 text-left shadow-[0_10px_24px_rgba(16,33,61,0.05)] transition-transform hover:-translate-y-0.5"
            key={member.memberId}
            onClick={() => navigate(`/members/${member.memberId}`)}
            type="button"
          >
            <MemberAvatar fullName={member.fullName} initials={member.initials} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-semibold text-slate-900">{member.fullName}</div>
              <div className="truncate text-sm text-[#9f8a58]">
                {member.unityId ? `unity#${member.unityId}` : member.email || member.phone || "Manual member"}
              </div>
            </div>
            <UnityBadge source={member.source} unityId={member.unityId} />
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
