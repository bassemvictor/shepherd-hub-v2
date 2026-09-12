import { X } from "lucide-react";
import type { Tag } from "../../../shared/types";
import { TagBadge } from "./tag-pill";

export const ActiveTagFilters = ({
  tags,
  memberIds = [],
  householdIds = [],
  onRemove,
  onClear,
  pending = false,
}: {
  tags: Tag[];
  memberIds?: string[];
  householdIds?: string[];
  onRemove: (target: "member" | "household", id: string) => void;
  onClear: () => void;
  pending?: boolean;
}) => {
  if (!memberIds.length && !householdIds.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Active tag filters">
      <span className="mr-1 text-muted-foreground">Active filters:</span>
      {(
        [
          ["member", memberIds],
          ["household", householdIds],
        ] as const
      ).flatMap(([target, ids]) =>
        ids.map((id) => {
          const tag = tags.find((item) => item.tagId === id);
          return (
            <button
              type="button"
              key={`${target}-${id}`}
              aria-label={`Remove ${target} tag ${tag?.name ?? "unavailable tag"}`}
              className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full px-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              onClick={() => onRemove(target, id)}
            >
              {target === "household" ? <span className="text-muted-foreground">Household:</span> : null}
              {tag ? <TagBadge tag={tag} /> : <span className="text-muted-foreground">Unavailable tag</span>}
              <X aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          );
        }),
      )}
      <button
        type="button"
        className="ml-auto rounded px-2 py-1.5 text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        onClick={onClear}
      >
        Clear tag filters
      </button>
      {pending ? (
        <span className="w-full text-muted-foreground" role="status">
          Run Report to apply changes.
        </span>
      ) : null}
    </div>
  );
};
