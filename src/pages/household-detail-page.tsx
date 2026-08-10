import { ArrowLeft, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import type { CreateHouseholdInput, HouseholdDetailResponse, HouseholdSummary } from "../../shared/types";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { HouseholdFormDialog } from "../components/members/household-ui";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Button } from "../components/ui/button";
import { api } from "../lib/api";
import { isAdminUser, useAuth } from "../lib/auth";
import { refreshHouseholdsIndexCache, useHouseholdsIndex } from "../lib/households-index";
import { useMembersIndex } from "../lib/members-index";

export const HouseholdDetailPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { householdId = "" } = useParams();
  const { cacheScope } = useHouseholdsIndex();
  const { items: members } = useMembersIndex();
  const [household, setHousehold] = useState<HouseholdSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const loadHousehold = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<HouseholdDetailResponse>(`/households/${householdId}`);
      setHousehold(response.household);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load household.");
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void loadHousehold();
  }, [loadHousehold]);

  const handleSave = useCallback(async (value: CreateHouseholdInput) => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/households/${householdId}`, value);
      setEditing(false);
      await Promise.all([
        loadHousehold(),
        refreshHouseholdsIndexCache(queryClient, cacheScope),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update household.");
    } finally {
      setSaving(false);
    }
  }, [cacheScope, householdId, loadHousehold, queryClient]);

  const handleDelete = useCallback(async () => {
    try {
      await api.delete(`/households/${householdId}`);
      await refreshHouseholdsIndexCache(queryClient, cacheScope);
      navigate("/households");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete household.");
    }
  }, [cacheScope, householdId, navigate, queryClient]);

  const handleRemoveMember = useCallback(async (memberId: string) => {
    setRemovingMemberId(memberId);
    setError(null);
    try {
      await api.delete(`/households/${householdId}/members/${memberId}`);
      await Promise.all([
        loadHousehold(),
        refreshHouseholdsIndexCache(queryClient, cacheScope),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove member.");
    } finally {
      setRemovingMemberId(null);
    }
  }, [cacheScope, householdId, loadHousehold, queryClient]);

  if (loading) {
    return <LoadingState description="Loading household details." title="Preparing household" />;
  }

  if (!household) {
    return <ErrorState description={error ?? "Household not found."} title="Unable to load household" />;
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorState description={error} title="Household action failed" /> : null}

      <section className="rounded-lg border border-border bg-white p-3 panel-shadow">
        <div className="flex items-start justify-between gap-3">
          <button className="flex items-center gap-2 text-sm font-semibold text-slate-900" onClick={() => navigate("/households")} type="button">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <Button onClick={() => setEditing(true)} size="sm" type="button" variant="outline">Edit Household</Button>
            <Button
              disabled={household.memberCount > 0}
              onClick={() => setDeleteOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{household.householdName}</h1>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{household.address || "No address"}</div>
          {isAdminUser(user?.groups ?? []) && (household.normalizedAddress || household.addressKey) ? (
            <div className="mt-2 text-xs text-muted-foreground">
              {household.normalizedAddress || "No normalized address"} · {household.addressKey || "No address key"}
            </div>
          ) : null}
          {household.notes ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{household.notes}</p> : null}
          <div className="mt-3 text-sm font-medium text-slate-900">{household.memberCount} members</div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-white p-3 panel-shadow">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Members</h2>
            <div className="text-xs text-muted-foreground">Tap a member to open their details.</div>
          </div>
          <Button onClick={() => setEditing(true)} size="sm" type="button">
            <Plus className="h-4 w-4" />
            Add Member
          </Button>
        </div>

        <div className="grid gap-2">
          {household.members.map((member) => (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2.5" key={member.memberId}>
              <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/members/${member.memberId}`)} type="button">
                <div className="truncate text-sm font-semibold text-slate-900">{member.fullName}</div>
                <div className="truncate text-xs text-muted-foreground">{member.email || member.phone || "Open member details"}</div>
              </button>
              <Button
                disabled={removingMemberId === member.memberId}
                onClick={() => void handleRemoveMember(member.memberId)}
                size="sm"
                type="button"
                variant="outline"
              >
                {removingMemberId === member.memberId ? "Removing..." : "Remove"}
              </Button>
            </div>
          ))}
        </div>
      </section>

      <HouseholdFormDialog
        busy={saving}
        initialValue={{
          householdName: household.householdName,
          address: household.address,
          notes: household.notes,
          memberIds: household.members.map((member) => member.memberId),
        }}
        members={members}
        onClose={() => setEditing(false)}
        onSubmit={handleSave}
        open={editing}
        title="Edit Household"
      />
      <ConfirmDialog
        confirmLabel="Delete Household"
        description="Delete this household. This is only allowed when it has no members."
        destructive
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
        open={deleteOpen}
        title="Delete household?"
      />
    </div>
  );
};
