import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tag, TagMatchMode } from "../../../shared/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { TagBadge } from "./tag-pill";

export type TagFilterValue = { ids: string[]; mode: TagMatchMode };
type Props = {
  label: string;
  tags: Tag[];
  value: TagFilterValue;
  onChange: (value: TagFilterValue) => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

export const TagFilterPopover = ({ label, tags, value, onChange, loading, error, onRetry }: Props) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TagFilterValue>(value);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState({ left: 8, top: 8, width: 304, maxHeight: 420 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const name = value.ids.length
    ? (tags.find((tag) => tag.tagId === value.ids[0])?.name ?? "Unavailable tag")
    : "Any";
  const showSearch = tags.length > 7;
  const matches = tags.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const mobile = width < 640;
      const panelWidth = Math.min(304, width - 16);
      const availableBelow = height + offsetTop - rect.bottom - 16;
      const above = !mobile && availableBelow < 260 && rect.top - offsetTop > availableBelow;
      const maxHeight = mobile
        ? Math.min(420, height - 16)
        : Math.max(120, Math.min(420, above ? rect.top - offsetTop - 16 : availableBelow));
      setPosition({
        width: mobile ? width - 16 : panelWidth,
        left: mobile
          ? offsetLeft + 8
          : Math.max(offsetLeft + 8, Math.min(rect.left, offsetLeft + width - panelWidth - 8)),
        top: mobile ? offsetTop + height - maxHeight - 8 : above ? rect.top - maxHeight - 8 : rect.bottom + 6,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node))
        close(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node))
        close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", focusOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="min-w-0 space-y-1">
      <span
        id={`${id}-label`}
        className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
      >
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}: ${name}${value.ids.length > 1 ? ` +${value.ids.length - 1}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-left text-sm text-foreground outline-none transition hover:bg-accent focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        onClick={() => {
          if (open) close(false);
          else {
            setDraft({ ids: [...value.ids], mode: value.mode });
            setSearch("");
            setOpen(true);
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {value.ids.length > 1 ? (
          <span className="shrink-0 text-xs text-muted-foreground">+{value.ids.length - 1}</span>
        ) : null}
        <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              id={id}
              role="dialog"
              aria-labelledby={`${id}-title`}
              style={position}
              className="fixed z-[100] flex flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-xl"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
                <h3 id={`${id}-title`} className="text-sm font-semibold">
                  {label}
                </h3>
                <Button
                  aria-label={`Close ${label}`}
                  onClick={() => close(true)}
                  size="icon"
                  variant="ghost"
                  type="button"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-h-0 space-y-2 overflow-y-auto p-2">
                {showSearch ? (
                  <Input
                    aria-label={`Search ${label.toLowerCase()}`}
                    placeholder="Search tags…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                ) : null}
                {draft.ids.length >= 2 ? (
                  <div className="flex items-center justify-between gap-2 px-1 py-1">
                    <span className="text-xs text-muted-foreground">Match</span>
                    <div
                      role="group"
                      aria-label={`${label} match mode`}
                      className="flex rounded-md border border-border p-0.5"
                    >
                      {(["any", "all"] as const).map((mode) => (
                        <button
                          type="button"
                          key={mode}
                          aria-pressed={draft.mode === mode}
                          className={`rounded px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${draft.mode === mode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
                          onClick={() => setDraft({ ...draft, mode })}
                        >
                          {mode === "any" ? "Any" : "All"}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {loading ? (
                  <p role="status" className="p-2 text-sm text-muted-foreground">
                    Loading tags…
                  </p>
                ) : error ? (
                  <button type="button" className="p-2 text-sm text-red-700 underline" onClick={onRetry}>
                    Unable to load tags. Retry
                  </button>
                ) : (
                  <div role="group" aria-label={`${label} options`}>
                    {matches.map((tag) => {
                      const selected = draft.ids.includes(tag.tagId);
                      return (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          aria-label={tag.name}
                          disabled={!selected && draft.ids.length >= 20}
                          key={tag.tagId}
                          className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:opacity-50 ${selected ? "bg-primary/5" : "hover:bg-accent"}`}
                          onClick={() => {
                            const ids = selected
                              ? draft.ids.filter((id) => id !== tag.tagId)
                              : [...draft.ids, tag.tagId];
                            setDraft({ ids, mode: ids.length < 2 ? "any" : draft.mode });
                          }}
                        >
                          <span
                            aria-hidden
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-white" : "border-border"}`}
                          >
                            {selected ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <TagBadge tag={tag} />
                        </button>
                      );
                    })}
                    {!matches.length ? (
                      <p className="p-2 text-sm text-muted-foreground">
                        {tags.length ? "No matching tags." : "No applicable tags."}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft({ ids: [], mode: "any" });
                    setSearch("");
                  }}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onChange({ ids: draft.ids, mode: draft.ids.length < 2 ? "any" : draft.mode });
                    close(true);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
