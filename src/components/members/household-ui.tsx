import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CreateHouseholdInput,
  HouseholdSummary,
  MemberIndexItem,
} from "../../../shared/types";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { MemberAvatar, MemberChip } from "./member-ui";

export const HouseholdSearchAutocomplete = ({
  items,
  query,
  onQueryChange,
  onSelect,
  placeholder = "Search households",
}: {
  items: HouseholdSummary[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (item: HouseholdSummary) => void;
  placeholder?: string;
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    return items.filter((item) => item.normalizedSearchText.includes(normalized)).slice(0, 8);
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!query.trim()) {
    return (
      <label className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          className="w-full bg-transparent text-sm outline-none"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          value={query}
        />
      </label>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          className="w-full bg-transparent text-sm outline-none"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (!results.length) {
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % results.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => (current - 1 + results.length) % results.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              onSelect(results[activeIndex] ?? results[0]);
            }
          }}
          placeholder={placeholder}
          value={query}
        />
      </label>
      {results.length ? (
        <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-white p-1 panel-shadow">
          {results.map((item, index) => (
            <button
              className={cn(
                "flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left transition-colors",
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
              )}
              key={item.householdId}
              onClick={() => onSelect(item)}
              ref={(element) => {
                resultRefs.current[index] = element;
              }}
              type="button"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.householdName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.address || "No address"} · {item.memberCount} members
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          No households match that search yet.
        </div>
      )}
    </div>
  );
};

const householdDefaults: CreateHouseholdInput = {
  householdName: "",
  address: "",
  postalCode: "",
  notes: "",
  memberIds: [],
};

export const HouseholdFormDialog = ({
  open,
  title,
  busy,
  members,
  initialValue,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  busy: boolean;
  members: MemberIndexItem[];
  initialValue?: Partial<CreateHouseholdInput>;
  onClose: () => void;
  onSubmit: (value: CreateHouseholdInput) => Promise<void> | void;
}) => {
  const [form, setForm] = useState<CreateHouseholdInput>(householdDefaults);
  const [memberQuery, setMemberQuery] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ ...householdDefaults, ...initialValue, memberIds: initialValue?.memberIds ?? [] });
      setMemberQuery("");
    }
  }, [initialValue, open]);

  const selectedIds = form.memberIds ?? [];
  const selectedMembers = members.filter((member) => selectedIds.includes(member.memberId));
  const memberResults = useMemo(() => {
    const normalized = memberQuery.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    return members
      .filter((member) => !selectedIds.includes(member.memberId) && member.normalizedSearchText.includes(normalized))
      .slice(0, 8);
  }, [memberQuery, members, selectedIds]);

  return (
    <Dialog onClose={onClose} open={open} size="lg" title={title}>
      <div className="space-y-3">
        <label className="space-y-1">
          <span className="text-sm font-medium">Household Name</span>
          <Input
            onChange={(event) => setForm((current) => ({ ...current, householdName: event.target.value }))}
            value={form.householdName ?? ""}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Address</span>
          <Textarea
            onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
            rows={3}
            value={form.address ?? ""}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Postal Code</span>
          <Input
            onChange={(event) => setForm((current) => ({ ...current, postalCode: event.target.value }))}
            value={form.postalCode ?? ""}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Notes</span>
          <Textarea
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            rows={4}
            value={form.notes ?? ""}
          />
        </label>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Members</span>
          <label className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="Search members"
              value={memberQuery}
            />
          </label>
          {memberResults.length ? (
            <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-white p-1 panel-shadow">
              {memberResults.map((member) => (
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  key={member.memberId}
                  onClick={() => {
                    setForm((current) => ({
                      ...current,
                      memberIds: [...new Set([...(current.memberIds ?? []), member.memberId])],
                    }));
                    setMemberQuery("");
                  }}
                  type="button"
                >
                  <MemberAvatar fullName={member.fullName} initials={member.initials} size="sm" />
                  <span className="truncate text-sm font-medium">{member.fullName}</span>
                </button>
              ))}
            </div>
          ) : memberQuery.trim() ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              No members match that search.
            </div>
          ) : null}
          {selectedMembers.length ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedMembers.map((member) => (
                <MemberChip
                  key={member.memberId}
                  member={member}
                  onRemove={(memberId) =>
                    setForm((current) => ({
                      ...current,
                      memberIds: (current.memberIds ?? []).filter((id) => id !== memberId),
                    }))
                  }
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              No members selected yet.
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} type="button" variant="outline">Cancel</Button>
          <Button
            disabled={busy}
            onClick={() => void onSubmit({
              householdName: form.householdName ?? "",
              address: form.address,
              postalCode: form.postalCode,
              notes: form.notes,
              memberIds: form.memberIds ?? [],
            })}
            type="button"
          >
            {busy ? "Saving..." : "Save Household"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
