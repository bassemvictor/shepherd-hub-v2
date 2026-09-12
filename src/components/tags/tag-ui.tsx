import { useState } from "react";
import type { TagMatchMode } from "../../../shared/types";
import { useTags } from "../../lib/tags";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

import { TagBadge } from "./tag-pill";
export { TagBadge } from "./tag-pill";

export const TagList = ({ ids = [], limit = 3 }: { ids?: string[]; limit?: number }) => {
  const { data, isPending, error } = useTags();
  if (!ids.length) return <span className="text-xs text-muted-foreground">No tags</span>;
  if (isPending) return <span className="text-xs">Loading tags…</span>;
  if (error)
    return (
      <span className="text-xs" role="status">
        Tags unavailable
      </span>
    );
  const tags = ids.map((id) => data?.items.find((tag) => tag.tagId === id));
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, limit).map((tag, index) =>
        tag ? (
          <TagBadge key={ids[index]} tag={tag} />
        ) : (
          <span className="text-xs text-muted-foreground" key={ids[index]}>
            Unavailable tag
          </span>
        ),
      )}
      {tags.length > limit ? (
        <span
          className="text-xs text-muted-foreground"
          title={tags
            .slice(limit)
            .map((tag) => tag?.name ?? "Unavailable tag")
            .join(", ")}
        >
          +{tags.length - limit}
        </span>
      ) : null}
    </span>
  );
};
export const TagSelector = ({
  ids = [],
  onChange,
  target,
  includeInactive = false,
}: {
  ids?: string[];
  onChange: (ids: string[]) => void;
  target: "member" | "household";
  includeInactive?: boolean;
}) => {
  const { data, isPending, error, refetch } = useTags();
  const [search, setSearch] = useState("");
  const applicable = (data?.items ?? []).filter(
    (tag) =>
      ids.includes(tag.tagId) ||
      ((tag.active || includeInactive) && (tag.target === target || tag.target === "both")),
  );
  const matches = applicable.filter((tag) => tag.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <button
            aria-label={`Remove ${data?.items.find((tag) => tag.tagId === id)?.name ?? "unavailable tag"}`}
            className="rounded-full border border-border px-2 py-1 text-xs"
            key={id}
            onClick={() => onChange(ids.filter((value) => value !== id))}
            type="button"
          >
            {data?.items.find((tag) => tag.tagId === id)?.name ?? "Unavailable tag"} ×
          </button>
        ))}
      </div>
      {isPending ? (
        <p className="text-xs" role="status">
          Loading tags…
        </p>
      ) : error ? (
        <button className="text-xs text-red-700" onClick={() => void refetch()} type="button">
          Unable to load tags. Retry
        </button>
      ) : (
        <>
          <Input
            aria-label="Search tags"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tags"
            value={search}
          />
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {matches.map((tag) => (
              <label
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm"
                key={tag.tagId}
              >
                <input
                  checked={ids.includes(tag.tagId)}
                  disabled={!ids.includes(tag.tagId) && ids.length >= 20}
                  onChange={(event) =>
                    onChange(
                      event.target.checked ? [...ids, tag.tagId] : ids.filter((id) => id !== tag.tagId),
                    )
                  }
                  type="checkbox"
                />
                <TagBadge tag={tag} />
              </label>
            ))}
            {applicable.length && !matches.length ? (
              <p className="text-xs text-muted-foreground">No matching tags.</p>
            ) : null}
            {!applicable.length ? (
              <p className="text-xs text-muted-foreground">
                No applicable tags. An admin can manage tags in Admin → Tags.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};
export const TagFilter = ({
  ids = [],
  mode = "any",
  onChange,
  target,
  label = "Tags",
}: {
  ids?: string[];
  mode?: TagMatchMode;
  target: "member" | "household";
  label?: string;
  onChange: (ids: string[], mode: TagMatchMode) => void;
}) => (
  <details className="relative min-w-0 rounded-md border border-border bg-white px-3 py-2 text-sm">
    <summary className="cursor-pointer">
      {label}
      {ids.length ? ` (${ids.length}, ${mode})` : ""}
    </summary>
    <div className="mt-2 w-full space-y-2 sm:min-w-64">
      <TagSelector ids={ids} includeInactive onChange={(next) => onChange(next, mode)} target={target} />
      <label className="block text-xs">
        Match
        <Select onChange={(event) => onChange(ids, event.target.value as TagMatchMode)} value={mode}>
          <option value="any">Any selected tag</option>
          <option value="all">All selected tags</option>
        </Select>
      </label>
      {ids.length ? (
        <button className="text-xs underline" onClick={() => onChange([], "any")} type="button">
          Clear tags
        </button>
      ) : null}
    </div>
  </details>
);
