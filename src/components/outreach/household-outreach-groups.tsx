import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { isOutreachAdminUser, useAuth } from "../../lib/auth";
import {
  toggleOutreachAssignment,
  useOutreachActions,
  useOutreachGroups,
  useOutreachHouseholdGroups,
} from "../../lib/outreach";

export const HouseholdOutreachGroups = ({
  householdId,
  memberContext = false,
}: {
  householdId: string;
  memberContext?: boolean;
}) => {
  const { user } = useAuth();
  const canManage = isOutreachAdminUser(user?.groups ?? []);
  const groups = useOutreachGroups();
  const assigned = useOutreachHouseholdGroups(householdId);
  const actions = useOutreachActions();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentIds = assigned.data?.items.map((group) => group.groupId) ?? [];
  const nextIds = selected ?? currentIds;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await actions.replaceHouseholdGroups(householdId, currentIds, nextIds);
      setSelected(null);
      setOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update Outreach groups.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rounded-lg border border-border bg-white p-3 panel-shadow">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            Outreach Groups{memberContext ? " (inherited from household)" : ""}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {memberContext
              ? "Groups are assigned at the household level."
              : "A household may belong to multiple Outreach groups."}
          </p>
        </div>
        {canManage ? (
          <Button
            className="w-full whitespace-nowrap sm:w-auto"
            onClick={() => setOpen(true)}
            size="sm"
            type="button"
          >
            Manage Groups
          </Button>
        ) : null}
      </div>
      {assigned.isPending ? (
        <div className="mt-3 h-6 animate-pulse rounded bg-muted" />
      ) : currentIds.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {assigned.data?.items.map((group) => (
            <Badge
              key={group.groupId}
              variant={group.active ? "success" : "neutral"}
            >
              {group.name}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No Outreach groups assigned.
        </p>
      )}
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      <Dialog
        open={open}
        onClose={() => !saving && setOpen(false)}
        title="Manage Household Outreach Groups"
        description="Outreach groups are assigned at the household level. Changes apply to every member of this household."
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select all groups that should apply. This supports moving a
            household while keeping any other assignments.
          </p>
          {groups.data?.items.map((group) => (
            <label
              className="flex items-center gap-2 rounded border border-border p-2"
              key={group.groupId}
            >
              <Checkbox
                checked={nextIds.includes(group.groupId)}
                onChange={() =>
                  setSelected(toggleOutreachAssignment(nextIds, group.groupId))
                }
              />
              <span className="text-sm">
                {group.name}
                {group.active ? "" : " (Inactive)"}
              </span>
            </label>
          ))}
          {groups.isPending ? (
            <p className="text-sm text-muted-foreground">Loading groups…</p>
          ) : null}
          <Button disabled={saving} onClick={() => void save()} type="button">
            {saving ? "Saving…" : "Save group assignments"}
          </Button>
        </div>
      </Dialog>
    </section>
  );
};
