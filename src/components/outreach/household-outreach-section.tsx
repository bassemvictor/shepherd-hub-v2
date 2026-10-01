import { MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  CreateOutreachActivityInput,
  OutreachActivity,
  OutreachActivityType,
  OutreachGroupSummary,
} from "../../../shared/types";
import { outreachActivityTypes } from "../../../shared/types";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { api } from "../../lib/api";

const today = () => new Date().toISOString().slice(0, 10);

export const HouseholdOutreachSection = ({
  householdId,
}: {
  householdId: string;
}) => {
  const [activities, setActivities] = useState<OutreachActivity[]>([]);
  const [groups, setGroups] = useState<OutreachGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateOutreachActivityInput>({
    groupId: "",
    activityDate: today(),
    activityType: "Visit",
    comment: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [activityResponse, groupResponse] = await Promise.all([
        api.get<{ items: OutreachActivity[] }>(
          `/outreach/households/${householdId}/activities`,
        ),
        api.get<{ items: OutreachGroupSummary[] }>(
          `/outreach/households/${householdId}/groups`,
        ),
      ]);
      setActivities(activityResponse.items);
      setGroups(groupResponse.items);
      setForm((current) => ({
        ...current,
        groupId: current.groupId || groupResponse.items[0]?.groupId || "",
      }));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load Outreach activity.",
      );
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/outreach/households/${householdId}/activities`, form);
      setOpen(false);
      setForm({
        groupId: groups[0]?.groupId ?? "",
        activityDate: today(),
        activityType: "Visit",
        comment: "",
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to record Outreach activity.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-semibold">Outreach</h2>
            <p className="text-xs text-muted-foreground">
              Household Outreach activity
            </p>
          </div>
          <Button
            className="w-full whitespace-nowrap sm:w-auto"
            disabled={loading || !groups.length}
            onClick={() => setOpen(true)}
            size="sm"
            type="button"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Record Outreach Activity
          </Button>
        </div>
        {error ? (
          <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        {loading ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
          </div>
        ) : activities.length ? (
          <div className="space-y-2">
            {activities.map((activity) => (
              <div
                className="rounded-md border border-border p-3"
                key={activity.activityId}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{activity.activityType}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(activity.activityDate).toLocaleDateString()}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {activity.groupName} · {activity.createdByName}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {activity.comment}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No Outreach activities recorded yet.
          </p>
        )}
        <Dialog
          open={open}
          onClose={() => !saving && setOpen(false)}
          title="Record Outreach Activity"
        >
          <div className="space-y-3">
            <label className="block text-sm">
              Date
              <Input
                type="date"
                value={form.activityDate}
                onChange={(event) =>
                  setForm({ ...form, activityDate: event.target.value })
                }
              />
            </label>
            <label className="block text-sm">
              Activity type
              <Select
                value={form.activityType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    activityType: event.target.value as OutreachActivityType,
                  })
                }
              >
                {outreachActivityTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </label>
            {groups.length > 1 ? (
              <label className="block text-sm">
                Outreach group
                <Select
                  value={form.groupId}
                  onChange={(event) =>
                    setForm({ ...form, groupId: event.target.value })
                  }
                >
                  {groups.map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <label className="block text-sm">
              Comment
              <Textarea
                required
                value={form.comment}
                onChange={(event) =>
                  setForm({ ...form, comment: event.target.value })
                }
              />
            </label>
            <Button
              disabled={saving || !form.groupId || !form.comment.trim()}
              onClick={() => void submit()}
              type="button"
            >
              {saving ? "Recording…" : "Record activity"}
            </Button>
          </div>
        </Dialog>
      </CardContent>
    </Card>
  );
};
