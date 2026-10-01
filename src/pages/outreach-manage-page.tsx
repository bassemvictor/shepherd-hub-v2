import {
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type {
  CreateOutreachActivityInput,
  CreateOutreachGroupInput,
  HouseholdSummary,
  OutreachActivityType,
  OutreachGroupSummary,
} from "../../shared/types";
import { outreachActivityTypes } from "../../shared/types";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { PageHeader } from "../components/common/page-header";
import { ErrorState } from "../components/states/error-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { useHouseholdsIndex } from "../lib/households-index";
import {
  outreachApi,
  useOutreachActions,
  useOutreachGroupHouseholds,
  useOutreachGroupServants,
  useOutreachGroups,
  useOutreachServants,
} from "../lib/outreach";

type Tab = "overview" | "households" | "servants";
type AssignmentFilter = "all" | "assigned" | "unassigned";
type HouseholdSort = "name" | "address" | "members";
const blank: CreateOutreachGroupInput = {
  name: "",
  description: "",
  active: true,
};
const today = () => new Date().toISOString().slice(0, 10);
const PAGE_SIZES = [25, 50, 100];
const confirmLargeRemoval = (count: number, noun: string) =>
  count < 5 || window.confirm(`Remove ${count} ${noun} from this group?`);

export const paginate = <T,>(
  items: readonly T[],
  page: number,
  pageSize: number,
) => items.slice((page - 1) * pageSize, page * pageSize);
const sameIds = (values: readonly string[], set: ReadonlySet<string>) =>
  values.length === set.size && values.every((value) => set.has(value));

const Pager = ({
  count,
  page,
  pages,
  pageSize,
  onPage,
  onPageSize,
}: {
  count: number;
  page: number;
  pages: number;
  pageSize: number;
  onPage: (value: number) => void;
  onPageSize: (value: number) => void;
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
    <span>
      Showing {count ? (page - 1) * pageSize + 1 : 0}–
      {Math.min(page * pageSize, count)} of {count}
    </span>
    <div className="flex items-center gap-2">
      <Select
        aria-label="Rows per page"
        className="w-20"
        value={pageSize}
        onChange={(event) => onPageSize(Number(event.target.value))}
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size} rows
          </option>
        ))}
      </Select>
      <Button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        size="sm"
        variant="outline"
      >
        Previous
      </Button>
      <span>
        Page {page} of {pages}
      </span>
      <Button
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        size="sm"
        variant="outline"
      >
        Next
      </Button>
    </div>
  </div>
);
const TabButton = ({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) => (
  <button
    className={`border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

export const OutreachManagePage = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const groups = useOutreachGroups();
  const actions = useOutreachActions();
  const { items: households, isPending: householdsPending } =
    useHouseholdsIndex();
  const servants = useOutreachServants();
  const [selectedId, setSelectedId] = useState<string | null>(
    params.get("group"),
  );
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const [groupSearch, setGroupSearch] = useState("");
  const [editing, setEditing] = useState<OutreachGroupSummary | "new" | null>(
    null,
  );
  const [form, setForm] = useState(blank);
  const [deleting, setDeleting] = useState<OutreachGroupSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [householdQuery, setHouseholdQuery] = useState("");
  const [householdFilter, setHouseholdFilter] =
    useState<AssignmentFilter>("all");
  const [householdSort, setHouseholdSort] = useState<HouseholdSort>("name");
  const [householdPage, setHouseholdPage] = useState(1);
  const [householdPageSize, setHouseholdPageSize] = useState(25);
  const [selectedHouseholds, setSelectedHouseholds] = useState<Set<string>>(
    new Set(),
  );
  const [targetGroup, setTargetGroup] = useState("");
  const [activityHousehold, setActivityHousehold] =
    useState<HouseholdSummary | null>(null);
  const [activitySaving, setActivitySaving] = useState(false);
  const [activityForm, setActivityForm] = useState<
    Omit<CreateOutreachActivityInput, "groupId">
  >({ activityDate: today(), activityType: "Visit", comment: "" });
  const [servantQuery, setServantQuery] = useState("");
  const [servantFilter, setServantFilter] = useState<AssignmentFilter>("all");
  const [servantPage, setServantPage] = useState(1);
  const [servantPageSize, setServantPageSize] = useState(25);
  const [selectedServants, setSelectedServants] = useState<Set<string>>(
    new Set(),
  );
  const householdAssignments = useOutreachGroupHouseholds(selectedId);
  const servantAssignments = useOutreachGroupServants(selectedId);
  const selected =
    groups.data?.items.find((group) => group.groupId === selectedId) ?? null;
  const assignedHouseholds = useMemo(
    () =>
      new Set(
        householdAssignments.data?.items.map((item) => item.householdId) ?? [],
      ),
    [householdAssignments.data?.items],
  );
  const assignedServants = useMemo(
    () =>
      new Set(
        servantAssignments.data?.items.map((item) => item.servantId) ?? [],
      ),
    [servantAssignments.data?.items],
  );
  const assignedServantSummaries = useMemo(
    () =>
      (servants.data?.items ?? [])
        .filter((item) => assignedServants.has(item.sub))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [assignedServants, servants.data?.items],
  );
  useEffect(() => {
    if (
      groups.data?.items.length &&
      (!selectedId ||
        !groups.data.items.some((group) => group.groupId === selectedId))
    )
      setSelectedId(groups.data.items[0].groupId);
  }, [groups.data?.items, selectedId]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (selectedId) next.set("group", selectedId);
    if (tab !== "overview") next.set("tab", tab);
    setParams(next, { replace: true });
  }, [selectedId, setParams, tab]);
  useEffect(() => {
    setHouseholdPage(1);
    setSelectedHouseholds(new Set());
  }, [
    householdFilter,
    householdPageSize,
    householdQuery,
    householdSort,
    selectedId,
  ]);
  useEffect(() => {
    setServantPage(1);
    setSelectedServants(new Set());
  }, [selectedId, servantFilter, servantPageSize, servantQuery]);
  const visibleGroups = useMemo(
    () =>
      (groups.data?.items ?? []).filter((group) =>
        `${group.name} ${group.description ?? ""}`
          .toLowerCase()
          .includes(groupSearch.trim().toLowerCase()),
      ),
    [groups.data?.items, groupSearch],
  );
  const filteredHouseholds = useMemo(
    () =>
      households
        .filter((item) => {
          const assigned = assignedHouseholds.has(item.householdId);
          const q = householdQuery.trim().toLowerCase();
          const matchesAssignment =
            householdFilter === "all" ||
            (householdFilter === "assigned" ? assigned : !assigned);
          return (
            (!q ||
              `${item.householdName} ${item.address ?? ""} ${item.normalizedSearchText ?? ""}`
                .toLowerCase()
                .includes(q)) &&
            matchesAssignment
          );
        })
        .sort((a, b) =>
          householdSort === "members"
            ? b.memberCount - a.memberCount
            : householdSort === "address"
              ? (a.address ?? "").localeCompare(b.address ?? "")
              : a.householdName.localeCompare(b.householdName),
        ),
    [
      assignedHouseholds,
      householdFilter,
      householdQuery,
      householdSort,
      households,
    ],
  );
  const householdPages = Math.max(
    1,
    Math.ceil(filteredHouseholds.length / householdPageSize),
  );
  const currentHouseholdPage = Math.min(householdPage, householdPages);
  const householdRows = paginate(
    filteredHouseholds,
    currentHouseholdPage,
    householdPageSize,
  );
  const assignedHouseholdNames = useMemo(
    () =>
      households
        .filter((item) => assignedHouseholds.has(item.householdId))
        .sort((left, right) =>
          left.householdName.localeCompare(right.householdName),
        ),
    [assignedHouseholds, households],
  );
  const filteredServants = useMemo(
    () =>
      (servants.data?.items ?? []).filter((item) => {
        const assigned = assignedServants.has(item.sub);
        const q = servantQuery.trim().toLowerCase();
        const matchesAssignment =
          servantFilter === "all" ||
          (servantFilter === "assigned" ? assigned : !assigned);
        return (
          (!q || `${item.name} ${item.email}`.toLowerCase().includes(q)) &&
          matchesAssignment
        );
      }),
    [assignedServants, servantFilter, servantQuery, servants.data?.items],
  );
  const servantPages = Math.max(
    1,
    Math.ceil(filteredServants.length / servantPageSize),
  );
  const currentServantPage = Math.min(servantPage, servantPages);
  const servantRows = paginate(
    filteredServants,
    currentServantPage,
    servantPageSize,
  );
  const select = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) =>
    setter((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const saveGroup = async () => {
    if (!form.name.trim()) {
      setError("A group name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const value = {
        ...form,
        name: form.name.trim(),
        description: form.description?.trim(),
      };
      if (editing === "new")
        setSelectedId((await actions.create(value)).groupId);
      else if (editing) await actions.update(editing.groupId, value);
      setEditing(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save Outreach group.",
      );
    } finally {
      setBusy(false);
    }
  };
  const replaceHouseholds = async (next: Set<string>) => {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await actions.replaceHouseholds(selectedId, [...next]);
      setSelectedHouseholds(new Set());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update household assignments.",
      );
    } finally {
      setBusy(false);
    }
  };
  const replaceServants = async (next: Set<string>) => {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await actions.replaceServants(selectedId, [...next]);
      setSelectedServants(new Set());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update servant assignments.",
      );
    } finally {
      setBusy(false);
    }
  };
  const addToGroup = async () => {
    if (!targetGroup || !selectedHouseholds.size) return;
    setBusy(true);
    setError("");
    try {
      const current = await outreachApi.listGroupHouseholds(targetGroup);
      await actions.replaceHouseholds(targetGroup, [
        ...new Set([
          ...current.items.map((item) => item.householdId),
          ...selectedHouseholds,
        ]),
      ]);
      setSelectedHouseholds(new Set());
      setTargetGroup("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to add households to that group.",
      );
    } finally {
      setBusy(false);
    }
  };
  const openActivity = (household: HouseholdSummary) => {
    setActivityHousehold(household);
    setActivityForm({
      activityDate: today(),
      activityType: "Visit",
      comment: "",
    });
  };
  const recordActivity = async () => {
    if (!activityHousehold || !selectedId) return;
    setActivitySaving(true);
    setError("");
    try {
      await outreachApi.createActivity(activityHousehold.householdId, {
        ...activityForm,
        groupId: selectedId,
      });
      setActivityHousehold(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to record Outreach activity.",
      );
    } finally {
      setActivitySaving(false);
    }
  };
  if (groups.error)
    return (
      <ErrorState
        title="Unable to load Outreach groups"
        description={
          groups.error instanceof Error ? groups.error.message : "Try again."
        }
      />
    );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Manage Outreach Groups"
        description="Create groups and manage household and servant assignments."
      >
        <Button
          className="w-full sm:w-auto"
          onClick={() => {
            setForm(blank);
            setEditing("new");
          }}
        >
          <Plus className="h-4 w-4" />
          New Group
        </Button>
      </PageHeader>
      {error ? (
        <ErrorState title="Outreach action failed" description={error} />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] lg:items-start">
        <Card className="hidden lg:sticky lg:top-3 lg:block">
          <CardContent className="space-y-3 p-3">
            <div className="flex justify-between">
              <h2 className="text-sm font-semibold">Outreach Groups</h2>
              <span className="text-xs text-muted-foreground">
                {groups.data?.items.length ?? 0}
              </span>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border px-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search Outreach groups"
                className="border-0 px-0 shadow-none focus-visible:ring-0"
                placeholder="Search groups…"
                value={groupSearch}
                onChange={(event) => setGroupSearch(event.target.value)}
              />
            </label>
            <div className="max-h-[calc(100vh-230px)] space-y-1 overflow-y-auto pr-1">
              {groups.isPending ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div
                    className="h-16 animate-pulse rounded-md bg-muted"
                    key={i}
                  />
                ))
              ) : !visibleGroups.length ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  {groups.data?.items.length
                    ? "No groups match your search."
                    : "No Outreach groups yet."}
                </p>
              ) : (
                visibleGroups.map((group) => (
                  <button
                    aria-pressed={selectedId === group.groupId}
                    className={`w-full rounded-md border px-3 py-2.5 text-left ${selectedId === group.groupId ? "border-primary bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/40"}`}
                    key={group.groupId}
                    onClick={() => setSelectedId(group.groupId)}
                    type="button"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {group.name}
                      </span>
                      <Badge variant={group.active ? "success" : "neutral"}>
                        {group.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {group.householdCount ?? 0} households ·{" "}
                      {group.servantCount ?? 0} servants
                    </p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-0">
            <div className="border-b border-border p-3 lg:hidden">
              <label className="block text-xs font-medium text-muted-foreground">
                Selected Outreach group
                <Select
                  aria-label="Select Outreach group to manage"
                  className="mt-1"
                  value={selectedId ?? ""}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {(groups.data?.items ?? []).map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      {group.name}
                      {group.active ? "" : " (Inactive)"}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            {selected ? (
              <>
                <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold">{selected.name}</h2>
                      <Badge variant={selected.active ? "success" : "neutral"}>
                        {selected.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selected.description || "No description"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {assignedHouseholds.size} households ·{" "}
                      {assignedServants.size} servants
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 sm:flex-none"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setForm({
                          name: selected.name,
                          description: selected.description,
                          active: selected.active,
                        });
                        setEditing(selected);
                      }}
                    >
                      Edit Group
                    </Button>
                    <Button
                      aria-label="Delete group"
                      onClick={() => setDeleting(selected)}
                      size="icon"
                      variant="outline"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex overflow-x-auto border-b border-border">
                  <TabButton
                    active={tab === "overview"}
                    onClick={() => setTab("overview")}
                  >
                    Overview
                  </TabButton>
                  <TabButton
                    active={tab === "households"}
                    onClick={() => setTab("households")}
                  >
                    Households
                  </TabButton>
                  <TabButton
                    active={tab === "servants"}
                    onClick={() => setTab("servants")}
                  >
                    Servants
                  </TabButton>
                </div>
                {tab === "overview" ? (
                  <div className="grid gap-3 p-4 sm:grid-cols-2">
                    <div className="rounded-md border border-border p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Households
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {assignedHouseholds.size}
                      </p>
                      <Button
                        className="mt-3"
                        onClick={() => setTab("households")}
                        size="sm"
                        variant="outline"
                      >
                        Manage Households
                      </Button>
                    </div>
                    <div className="rounded-md border border-border p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Servants
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {assignedServants.size}
                      </p>
                      <Button
                        className="mt-3"
                        onClick={() => setTab("servants")}
                        size="sm"
                        variant="outline"
                      >
                        Manage Servants
                      </Button>
                    </div>
                  </div>
                ) : null}
                {tab === "households" ? (
                  <section className="[&_table]:min-w-0 [&_td:nth-child(3)]:hidden [&_td:nth-child(4)]:hidden [&_td:nth-child(5)]:hidden [&_th:nth-child(3)]:hidden [&_th:nth-child(4)]:hidden [&_th:nth-child(5)]:hidden sm:[&_table]:min-w-[640px] sm:[&_td:nth-child(3)]:table-cell sm:[&_td:nth-child(4)]:table-cell sm:[&_td:nth-child(5)]:table-cell sm:[&_th:nth-child(3)]:table-cell sm:[&_th:nth-child(4)]:table-cell sm:[&_th:nth-child(5)]:table-cell">
                    {!householdAssignments.isPending ? (
                      <div className="border-b border-border bg-muted/20 px-3 py-3">
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h3 className="font-semibold">
                              Households in this group
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              {assignedHouseholdNames.length} household
                              {assignedHouseholdNames.length === 1
                                ? ""
                                : "s"}{" "}
                              in {selected.name}.
                            </p>
                          </div>
                          {assignedHouseholdNames.length ? (
                            <Button
                              className="w-full sm:w-auto"
                              onClick={() => setHouseholdFilter("assigned")}
                              size="sm"
                              variant="outline"
                            >
                              View all
                            </Button>
                          ) : null}
                        </div>
                        {assignedHouseholdNames.length ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {assignedHouseholdNames.slice(0, 8).map((item) => (
                              <div
                                className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2"
                                key={item.householdId}
                              >
                                <button
                                  className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                  onClick={() =>
                                    navigate(`/households/${item.householdId}`)
                                  }
                                  type="button"
                                >
                                  <p className="truncate text-sm font-medium">
                                    {item.householdName}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {item.address || "No address"}
                                  </p>
                                </button>
                                <Button
                                  aria-label={`Record Outreach activity for ${item.householdName}`}
                                  onClick={() => openActivity(item)}
                                  size="icon"
                                  title="Record Outreach activity"
                                  type="button"
                                  variant="ghost"
                                >
                                  <MessageSquarePlus className="h-4 w-4" />
                                </Button>
                                <Button
                                  aria-label={`Remove ${item.householdName} from ${selected.name}`}
                                  disabled={busy}
                                  onClick={() =>
                                    void replaceHouseholds(
                                      new Set(
                                        [...assignedHouseholds].filter(
                                          (id) => id !== item.householdId,
                                        ),
                                      ),
                                    )
                                  }
                                  size="icon"
                                  title="Remove from group"
                                  type="button"
                                  variant="ghost"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            {assignedHouseholdNames.length > 8 ? (
                              <Badge
                                className="w-fit self-center"
                                variant="neutral"
                              >
                                +{assignedHouseholdNames.length - 8} more
                              </Badge>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">
                            No households in this group yet.
                          </p>
                        )}
                      </div>
                    ) : null}
                    <div className="space-y-2 border-b border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-semibold">Household directory</h3>
                          <p className="text-xs text-muted-foreground">
                            A household can remain assigned to multiple groups.
                          </p>
                        </div>
                        {selectedHouseholds.size ? (
                          <Button
                            onClick={() => setSelectedHouseholds(new Set())}
                            size="sm"
                            variant="ghost"
                          >
                            Clear selection
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_150px]">
                        <Input
                          aria-label="Search households"
                          placeholder="Search household or address…"
                          value={householdQuery}
                          onChange={(event) =>
                            setHouseholdQuery(event.target.value)
                          }
                        />
                        <Select
                          aria-label="Filter household assignments"
                          value={householdFilter}
                          onChange={(event) =>
                            setHouseholdFilter(
                              event.target.value as AssignmentFilter,
                            )
                          }
                        >
                          <option value="all">All households</option>
                          <option value="assigned">Assigned</option>
                          <option value="unassigned">Not assigned</option>
                        </Select>
                        <Select
                          aria-label="Sort households"
                          value={householdSort}
                          onChange={(event) =>
                            setHouseholdSort(
                              event.target.value as HouseholdSort,
                            )
                          }
                        >
                          <option value="name">Sort: Name</option>
                          <option value="address">Sort: Address</option>
                          <option value="members">Sort: Members</option>
                        </Select>
                      </div>
                    </div>
                    {selectedHouseholds.size ? (
                      <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                        <strong>{selectedHouseholds.size} selected</strong>
                        <Select
                          aria-label="Assign selected households to group"
                          className="w-full sm:w-52"
                          value={targetGroup}
                          onChange={(event) =>
                            setTargetGroup(event.target.value)
                          }
                        >
                          <option value="">Assign to group…</option>
                          {(groups.data?.items ?? []).map((group) => (
                            <option key={group.groupId} value={group.groupId}>
                              {group.groupId === selectedId
                                ? `${group.name} (current group)`
                                : group.name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          disabled={!targetGroup || busy}
                          onClick={() => void addToGroup()}
                          size="sm"
                        >
                          Assign to group
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            const removed = [...assignedHouseholds].filter(
                              (id) => selectedHouseholds.has(id),
                            ).length;
                            if (confirmLargeRemoval(removed, "households"))
                              void replaceHouseholds(
                                new Set(
                                  [...assignedHouseholds].filter(
                                    (id) => !selectedHouseholds.has(id),
                                  ),
                                ),
                              );
                          }}
                          size="sm"
                          variant="outline"
                        >
                          Remove from current group
                        </Button>
                      </div>
                    ) : null}
                    {householdsPending || householdAssignments.isPending ? (
                      <div className="space-y-2 p-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div
                            className="h-12 animate-pulse rounded bg-muted"
                            key={i}
                          />
                        ))}
                      </div>
                    ) : !filteredHouseholds.length ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        {householdQuery
                          ? "No households match your search."
                          : householdFilter === "assigned"
                            ? "No households are assigned to this group."
                            : "No households available."}
                      </div>
                    ) : (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10">
                                <Checkbox
                                  aria-label="Select households on this page"
                                  checked={
                                    householdRows.length > 0 &&
                                    householdRows.every((item) =>
                                      selectedHouseholds.has(item.householdId),
                                    )
                                  }
                                  onChange={() =>
                                    setSelectedHouseholds((current) =>
                                      sameIds(
                                        householdRows.map(
                                          (item) => item.householdId,
                                        ),
                                        new Set(
                                          householdRows
                                            .filter((item) =>
                                              current.has(item.householdId),
                                            )
                                            .map((item) => item.householdId),
                                        ),
                                      )
                                        ? new Set(
                                            [...current].filter(
                                              (id) =>
                                                !householdRows.some(
                                                  (item) =>
                                                    item.householdId === id,
                                                ),
                                            ),
                                          )
                                        : new Set([
                                            ...current,
                                            ...householdRows.map(
                                              (item) => item.householdId,
                                            ),
                                          ]),
                                    )
                                  }
                                />
                              </TableHead>
                              <TableHead>Household</TableHead>
                              <TableHead>Address</TableHead>
                              <TableHead className="text-right">
                                Members
                              </TableHead>
                              <TableHead>Current group</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {householdRows.map((item) => (
                              <TableRow key={item.householdId}>
                                <TableCell>
                                  <Checkbox
                                    aria-label={`Select ${item.householdName}`}
                                    checked={selectedHouseholds.has(
                                      item.householdId,
                                    )}
                                    onChange={() =>
                                      select(
                                        setSelectedHouseholds,
                                        item.householdId,
                                      )
                                    }
                                  />
                                </TableCell>
                                <TableCell className="break-words font-medium">
                                  {item.householdName}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {item.address || "No address"}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.memberCount}
                                </TableCell>
                                <TableCell>
                                  {assignedHouseholds.has(item.householdId) ? (
                                    <Badge>{selected.name}</Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      Not assigned
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <Pager
                          count={filteredHouseholds.length}
                          page={currentHouseholdPage}
                          pages={householdPages}
                          pageSize={householdPageSize}
                          onPage={setHouseholdPage}
                          onPageSize={setHouseholdPageSize}
                        />
                      </>
                    )}
                  </section>
                ) : null}
                {tab === "servants" ? (
                  <section>
                    {!servantAssignments.isPending ? (
                      <div className="border-b border-border bg-muted/20 px-3 py-3">
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h3 className="font-semibold">Assigned servants</h3>
                            <p className="text-xs text-muted-foreground">
                              {assignedServantSummaries.length} currently assigned to {selected.name}.
                            </p>
                          </div>
                          {assignedServantSummaries.length ? (
                            <Button
                              className="w-full sm:w-auto"
                              onClick={() => setServantFilter("assigned")}
                              size="sm"
                              variant="outline"
                            >
                              View all assigned
                            </Button>
                          ) : null}
                        </div>
                        {assignedServantSummaries.length ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {assignedServantSummaries.slice(0, 8).map((servant) => (
                              <div className="min-w-0 rounded-md border border-border bg-card px-2.5 py-2" key={servant.sub}>
                                <p className="truncate text-sm font-medium">{servant.name}</p>
                                <p className="truncate text-xs text-muted-foreground">{servant.email || "No email"}</p>
                              </div>
                            ))}
                            {assignedServantSummaries.length > 8 ? <Badge className="w-fit self-center" variant="neutral">+{assignedServantSummaries.length - 8} more</Badge> : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">No servants are assigned to this group yet.</p>
                        )}
                      </div>
                    ) : null}
                    <div className="space-y-2 border-b border-border p-3">
                      <div>
                        <h3 className="font-semibold">Servants</h3>
                        <p className="text-xs text-muted-foreground">
                          Servants can be assigned to more than one Outreach
                          group.
                        </p>
                      </div>
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
                        <Input
                          aria-label="Search servants"
                          placeholder="Search name or email…"
                          value={servantQuery}
                          onChange={(event) =>
                            setServantQuery(event.target.value)
                          }
                        />
                        <Select
                          aria-label="Filter servant assignments"
                          value={servantFilter}
                          onChange={(event) =>
                            setServantFilter(
                              event.target.value as AssignmentFilter,
                            )
                          }
                        >
                          <option value="all">All servants</option>
                          <option value="assigned">Assigned</option>
                          <option value="unassigned">Not assigned</option>
                        </Select>
                      </div>
                    </div>
                    {selectedServants.size ? (
                      <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                        <strong>{selectedServants.size} selected</strong>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void replaceServants(
                              new Set([
                                ...assignedServants,
                                ...selectedServants,
                              ]),
                            )
                          }
                          size="sm"
                        >
                          Assign to current group
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void replaceServants(
                              new Set(
                                [...assignedServants].filter(
                                  (id) => !selectedServants.has(id),
                                ),
                              ),
                            )
                          }
                          size="sm"
                          variant="outline"
                        >
                          Remove from current group
                        </Button>
                        <Button
                          onClick={() => setSelectedServants(new Set())}
                          size="sm"
                          variant="ghost"
                        >
                          Clear selection
                        </Button>
                      </div>
                    ) : null}
                    {servants.isPending || servantAssignments.isPending ? (
                      <div className="space-y-2 p-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div
                            className="h-12 animate-pulse rounded bg-muted"
                            key={i}
                          />
                        ))}
                      </div>
                    ) : !filteredServants.length ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        {servantQuery
                          ? "No servants match your search."
                          : servantFilter === "assigned"
                            ? "No servants are assigned to this group."
                            : "No servant users available."}
                      </div>
                    ) : (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10">
                                <Checkbox
                                  aria-label="Select servants on this page"
                                  checked={
                                    servantRows.length > 0 &&
                                    servantRows.every((item) =>
                                      selectedServants.has(item.sub),
                                    )
                                  }
                                  onChange={() =>
                                    setSelectedServants((current) =>
                                      sameIds(
                                        servantRows.map((item) => item.sub),
                                        new Set(
                                          servantRows
                                            .filter((item) =>
                                              current.has(item.sub),
                                            )
                                            .map((item) => item.sub),
                                        ),
                                      )
                                        ? new Set(
                                            [...current].filter(
                                              (id) =>
                                                !servantRows.some(
                                                  (item) => item.sub === id,
                                                ),
                                            ),
                                          )
                                        : new Set([
                                            ...current,
                                            ...servantRows.map(
                                              (item) => item.sub,
                                            ),
                                          ]),
                                    )
                                  }
                                />
                              </TableHead>
                              <TableHead>Servant</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Current group</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {servantRows.map((item) => (
                              <TableRow key={item.sub}>
                                <TableCell>
                                  <Checkbox
                                    aria-label={`Select ${item.name}`}
                                    checked={selectedServants.has(item.sub)}
                                    onChange={() =>
                                      select(setSelectedServants, item.sub)
                                    }
                                  />
                                </TableCell>
                                <TableCell className="font-medium">
                                  {item.name}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {item.email}
                                </TableCell>
                                <TableCell>
                                  {assignedServants.has(item.sub) ? (
                                    <Badge>{selected.name}</Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      Not assigned
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <Pager
                          count={filteredServants.length}
                          page={currentServantPage}
                          pages={servantPages}
                          pageSize={servantPageSize}
                          onPage={setServantPage}
                          onPageSize={setServantPageSize}
                        />
                      </>
                    )}
                  </section>
                ) : null}
              </>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <Users className="mb-3 h-8 w-8" />
                <p className="font-medium text-foreground">
                  Select an Outreach group
                </p>
                <p className="mt-1 text-sm">
                  Choose a group to manage its households and servants.
                </p>
                {!groups.isPending && !groups.data?.items.length ? (
                  <Button
                    className="mt-4"
                    onClick={() => {
                      setForm(blank);
                      setEditing("new");
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Create first group
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Dialog
        open={editing !== null}
        onClose={() => !busy && setEditing(null)}
        title={
          editing === "new" ? "Create Outreach group" : "Edit Outreach group"
        }
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveGroup();
          }}
        >
          <label className="block text-sm">
            Name
            <Input
              autoFocus
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            Description
            <Textarea
              value={form.description ?? ""}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.active ?? true}
              onChange={(event) =>
                setForm({ ...form, active: event.target.checked })
              }
            />
            Active group
          </label>
          <Button disabled={busy} type="submit">
            {busy
              ? "Saving…"
              : editing === "new"
                ? "Create Group"
                : "Save Changes"}
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(activityHousehold)}
        onClose={() => !activitySaving && setActivityHousehold(null)}
        title="Record Outreach Activity"
        description={
          activityHousehold
            ? `Add an activity for ${activityHousehold.householdName}.`
            : undefined
        }
      >
        <div className="space-y-3">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium">{selected?.name}</span>
            <span className="text-muted-foreground">
              {" "}
              · {activityHousehold?.address || "No address"}
            </span>
          </div>
          <label className="block text-sm">
            Date
            <Input
              type="date"
              value={activityForm.activityDate}
              onChange={(event) =>
                setActivityForm({
                  ...activityForm,
                  activityDate: event.target.value,
                })
              }
            />
          </label>
          <label className="block text-sm">
            Activity type
            <Select
              value={activityForm.activityType}
              onChange={(event) =>
                setActivityForm({
                  ...activityForm,
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
          <label className="block text-sm">
            Comment
            <Textarea
              required
              value={activityForm.comment}
              onChange={(event) =>
                setActivityForm({
                  ...activityForm,
                  comment: event.target.value,
                })
              }
            />
          </label>
          <Button
            disabled={activitySaving || !activityForm.comment.trim()}
            onClick={() => void recordActivity()}
            type="button"
          >
            {activitySaving ? "Recording…" : "Record activity"}
          </Button>
        </div>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          void actions
            .remove(deleting.groupId)
            .then(() => {
              if (selectedId === deleting.groupId) setSelectedId(null);
              setDeleting(null);
            })
            .catch((reason) =>
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Unable to delete Outreach group.",
              ),
            );
        }}
        title="Delete Outreach group?"
        description="This removes the group and all household and servant assignments."
        confirmLabel="Delete group"
        destructive
      />
    </div>
  );
};
