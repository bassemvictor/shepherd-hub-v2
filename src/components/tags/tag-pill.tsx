import type { Tag } from "../../../shared/types";

export const TagBadge = ({ tag }: { tag: Tag }) => (
  <span
    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-800"
    style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(tag.color ?? "") ? `${tag.color}12` : "#f8fafc" }}
    title={`${tag.name}${tag.active ? "" : " (inactive)"}`}
  >
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: tag.color || "#64748b" }}
    />
    <span className="truncate">
      {tag.name}
      {tag.active ? "" : " (inactive)"}
    </span>
  </span>
);
