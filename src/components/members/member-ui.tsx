import { Check, Loader2, Search, Upload, UserPlus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CreateMemberInput,
  EventMemberSummary,
  Member,
  MemberImportJob,
  MemberVisitation,
  MemberIndexItem,
} from "../../../shared/types";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export const UnityBadge = ({ source, unityId, className }: { source: Member["source"]; unityId?: string; className?: string }) =>
  source === "UNITY" && unityId ? (
    <span
      aria-label="Imported from Unity"
      className={cn(
        "inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1877F2] text-white shadow-sm ring-1 ring-[#1877F2]/15",
        className,
      )}
      role="img"
      title="Imported from Unity"
    >
      <Check className="h-3 w-3 stroke-[3]" />
    </span>
  ) : null;

export const MemberAvatar = ({
  fullName,
  initials,
  size = "md",
}: {
  fullName: string;
  initials: string;
  size?: "sm" | "md" | "lg";
}) => (
  <div
    aria-label={fullName}
    className={cn(
      "flex shrink-0 items-center justify-center rounded-full bg-[linear-gradient(160deg,#7aa7e8_0%,#376dbd_100%)] font-semibold text-white shadow-sm",
      size === "sm" && "h-8 w-8 text-xs",
      size === "md" && "h-10 w-10 text-sm",
      size === "lg" && "h-20 w-20 text-2xl",
    )}
  >
    {initials}
  </div>
);

export const MemberChip = ({
  member,
  onRemove,
  onClick,
  accessory,
}: {
  member: Pick<EventMemberSummary, "memberId" | "fullName" | "initials">;
  onRemove?: (memberId: string) => void;
  onClick?: (memberId: string) => void;
  accessory?: ReactNode;
}) => (
  <div className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-1.5 py-1 text-xs text-foreground">
    <button
      className={cn(
        "inline-flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 text-left transition-colors",
        onClick ? "hover:bg-accent focus-visible:bg-accent" : "",
      )}
      onClick={onClick ? () => onClick(member.memberId) : undefined}
      type="button"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
        {member.initials}
      </span>
      <span className="truncate font-medium">{member.fullName}</span>
    </button>
    {accessory ? <span className="flex shrink-0 items-center">{accessory}</span> : null}
    {onRemove ? (
      <button
        className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => onRemove(member.memberId)}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    ) : null}
  </div>
);

export const MemberDetailsTabs = ({
  activeTab,
  onChange,
}: {
  activeTab: "details" | "visitations" | "activity";
  onChange: (value: "details" | "visitations" | "activity") => void;
}) => {
  const items = [
    { id: "details", label: "Details" },
    { id: "visitations", label: "Activities" },
    { id: "activity", label: "Timeline" },
  ] as const;

  return (
    <div className="flex justify-between border-b border-border text-sm">
      {items.map((item) => (
        <button
          key={item.id}
          className={cn(
            "relative px-1 pb-2 pt-1.5 font-medium transition-colors",
            activeTab === item.id ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange(item.id)}
          type="button"
        >
          {item.label}
          {activeTab === item.id ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
        </button>
      ))}
    </div>
  );
};

export const MemberSearchAutocomplete = ({
  items,
  query,
  onQueryChange,
  selectedIds,
  onSelect,
  placeholder = "Search members",
  maxResults = 5,
}: {
  items: MemberIndexItem[];
  query: string;
  onQueryChange: (value: string) => void;
  selectedIds: string[];
  onSelect: (item: MemberIndexItem) => void;
  placeholder?: string;
  maxResults?: number;
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    return items
      .filter(
        (item) =>
          !selectedIds.includes(item.memberId) &&
          item.normalizedSearchText.includes(normalized),
      )
      .slice(0, maxResults);
  }, [items, maxResults, query, selectedIds]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const showSuggestions = query.trim().length > 0 && results.length > 0;

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          className="w-full bg-transparent text-sm outline-none"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (!showSuggestions) {
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
            } else if (event.key === "Escape") {
              event.preventDefault();
              onQueryChange("");
            }
          }}
          placeholder={placeholder}
          value={query}
        />
      </label>
      {showSuggestions ? (
        <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-white p-1 panel-shadow">
          {results.map((item, index) => (
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors",
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
              )}
              key={item.memberId}
              onClick={() => onSelect(item)}
              ref={(element) => {
                resultRefs.current[index] = element;
              }}
              type="button"
            >
              <MemberAvatar fullName={item.fullName} initials={item.initials} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.fullName}</div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const memberFormDefaults: CreateMemberInput = {
  fullName: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  source: "MANUAL",
};

export const MemberFormDialog = ({
  open,
  initialValue,
  busy,
  title,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initialValue?: Partial<CreateMemberInput>;
  busy: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (value: CreateMemberInput) => Promise<void> | void;
}) => {
  const [form, setForm] = useState<CreateMemberInput>(memberFormDefaults);

  useEffect(() => {
    if (open) {
      setForm({ ...memberFormDefaults, ...initialValue });
    }
  }, [initialValue, open]);

  return (
    <Dialog onClose={onClose} open={open} title={title}>
      <div className="space-y-3">
        <label className="space-y-1">
          <span className="text-sm font-medium">Full Name</span>
          <Input onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} value={form.fullName} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">Phone</span>
            <Input onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} value={form.phone ?? ""} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Email</span>
            <Input onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} value={form.email ?? ""} />
          </label>
        </div>
        <label className="space-y-1">
          <span className="text-sm font-medium">Address</span>
          <Input onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} value={form.address ?? ""} />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Notes</span>
          <Textarea onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} value={form.notes ?? ""} />
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void onSubmit(form)} type="button">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Save Member
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export const MemberImportDialog = ({
  open,
  busy,
  job,
  onClose,
  onImport,
}: {
  open: boolean;
  busy: boolean;
  job: MemberImportJob | null;
  onClose: () => void;
  onImport: (file: File) => Promise<void> | void;
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isProcessingJob = job ? ["queued", "running"].includes(job.status) : false;
  const isBusy = busy || isProcessingJob;
  const progressLabel = job ? `${job.processedRows} of ${job.totalRows} rows processed` : null;

  return (
    <Dialog
      description="Upload a Unity Excel export. Existing Unity members are updated in place."
      onClose={onClose}
      open={open}
      title="Import Excel"
    >
      <div className="space-y-3">
        <input
          accept=".xls,.xlsx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void onImport(file);
            }

            event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
        <button
          className="flex w-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-border bg-slate-50 px-4 py-8 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isBusy}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          <span>{isBusy ? "Importing Excel..." : "Choose Excel file"}</span>
          <span className="text-xs font-normal text-slate-500">
            {isBusy ? "Please wait while members are updated." : "Supports .xls and .xlsx files."}
          </span>
        </button>
        {job ? (
          <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium">
              {job.status === "completed"
                ? "Import complete."
                : job.status === "running"
                  ? "Import in progress."
                  : "Import queued."}
            </p>
            {progressLabel ? <p className="mt-1">{progressLabel}.</p> : null}
            <p className="mt-1">
              {job.result.created} created, {job.result.updated} updated, {job.result.skipped} skipped.
            </p>
            <p className="mt-1">
              Households: {job.result.householdsCreated} created, {job.result.householdsMatched} matched, {job.result.membersAssignedToHouseholds} members assigned.
            </p>
            <p className="mt-1">
              {job.result.membersWithoutHouseholds} members left without a household, {job.result.householdConflicts} conflicts.
            </p>
            {job.result.errorCount ? <p className="mt-1 text-rose-600">{job.result.errorCount} rows had errors.</p> : null}
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button disabled={isBusy} onClick={onClose} type="button" variant="outline">
            {isBusy ? "Importing..." : "Close"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export const formatMemberEventLabel = (event: MemberVisitation) =>
  event.isOwnCalendar ? "In your calendar" : `In ${event.calendarOwnerName ?? "shared"} calendar`;

export const emptyMemberSelection = (items: MemberIndexItem[], memberIds: string[] = []) =>
  items.filter((item) => memberIds.includes(item.memberId));
