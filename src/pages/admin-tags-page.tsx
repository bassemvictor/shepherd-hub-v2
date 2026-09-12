import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Tag, TagInput } from "../../shared/types";
import { api } from "../lib/api";
import { useTags } from "../lib/tags";
import { TagBadge } from "../components/tags/tag-ui";
import { PageHeader } from "../components/common/page-header";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import { Button } from "../components/ui/button";

const defaults: TagInput = { name: "", description: "", target: "both", active: true, color: "" };
const palette = [
  ["", "None"],
  ["#2563eb", "Blue"],
  ["#15803d", "Green"],
  ["#c2410c", "Orange"],
  ["#7e22ce", "Purple"],
  ["#b91c1c", "Red"],
  ["#64748b", "Gray"],
];
export const AdminTagsPage = () => {
  const tags = useTags();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const [form, setForm] = useState<TagInput>(defaults);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: ["tags"] });
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (editing === "new") await api.post<Tag>("/tags", form);
      else if (editing) await api.put<Tag>(`/tags/${editing.tagId}`, form);
      setEditing(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save tag.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/tags/${deleting.tagId}`);
      setDeleting(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete tag.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <PageHeader title="Tags">
        <Button
          onClick={() => {
            setForm(defaults);
            setEditing("new");
            setError("");
          }}
        >
          Create tag
        </Button>
      </PageHeader>
      <p className="text-sm text-muted-foreground">
        Organize members and households with shared tags. Deactivate tags that are no longer needed; assigned
        tags must be removed from their records before deletion.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {tags.isPending ? (
        <p role="status">Loading tags…</p>
      ) : tags.error ? (
        <Button onClick={() => void tags.refetch()} variant="outline">
          Unable to load tags. Retry
        </Button>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Name / color", "Description", "Applies to", "Status", "Assignments", "Actions"].map(
                  (label) => (
                    <th className="p-3" key={label}>
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {tags.data?.items.map((tag) => (
                <tr className="border-b border-border last:border-0" key={tag.tagId}>
                  <td className="p-3">
                    <TagBadge tag={tag} />
                  </td>
                  <td className="max-w-xs p-3">{tag.description || "—"}</td>
                  <td className="p-3">
                    {tag.target === "both"
                      ? "Members & households"
                      : tag.target === "member"
                        ? "Members"
                        : "Households"}
                  </td>
                  <td className="p-3">{tag.active ? "Active" : "Inactive"}</td>
                  <td className="p-3">{tag.assignmentCount}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          setEditing(tag);
                          setForm(tag);
                          setError("");
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={() => {
                          setDeleting(tag);
                          setError("");
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tags.data?.items.length ? (
            <p className="p-4 text-sm text-muted-foreground">No tags yet. Create your first tag.</p>
          ) : null}
        </div>
      )}
      <Dialog
        open={editing !== null}
        onClose={() => {
          if (!busy) setEditing(null);
        }}
        title={editing === "new" ? "Create tag" : "Edit tag"}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <label className="block text-sm">
            Name *
            <Input
              autoFocus
              required
              maxLength={60}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="block text-sm">
            Description
            <Textarea
              maxLength={500}
              value={form.description ?? ""}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <label className="block text-sm">
            Applies to
            <Select
              disabled={editing !== "new" && !!editing?.assignmentCount}
              value={form.target}
              onChange={(event) => setForm({ ...form, target: event.target.value as TagInput["target"] })}
            >
              <option value="member">Members</option>
              <option value="household">Households</option>
              <option value="both">Both</option>
            </Select>
          </label>
          <label className="block text-sm">
            Color
            <Select
              value={form.color ?? ""}
              onChange={(event) => setForm({ ...form, color: event.target.value })}
            >
              {palette.map(([value, name]) => (
                <option key={name} value={value}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm({ ...form, active: event.target.checked })}
            />
            Active
          </label>
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => setEditing(null)} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={busy || !form.name.trim()} type="submit">
              {busy ? "Saving…" : "Save tag"}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        busy={busy}
        open={!!deleting}
        title="Delete tag?"
        description={
          deleting?.assignmentCount
            ? `This tag has ${deleting.assignmentCount} assignments. Deactivate it in Edit, or remove all assignments first. Deletion will be rejected while it is assigned.`
            : `Delete “${deleting?.name ?? ""}”? This cannot be undone.`
        }
        confirmLabel={busy ? "Deleting…" : "Delete tag"}
        destructive
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        onConfirm={() => {
          if (!busy) void remove();
        }}
      >
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
};
