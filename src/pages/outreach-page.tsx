import {
  ChevronDown,
  Home,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  Phone,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type {
  CreateOutreachActivityInput,
  HouseholdSummary,
  OutreachActivityType,
  OutreachGroupSummary,
} from "../../shared/types";
import { outreachActivityTypes } from "../../shared/types";
import { PageHeader } from "../components/common/page-header";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import { Select } from "../components/ui/select";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { isOutreachAdminUser, useAuth } from "../lib/auth";
import { useHouseholdsIndex } from "../lib/households-index";
import {
  outreachApi,
  useOutreachGroups,
  useOutreachHouseholdsForGroups,
} from "../lib/outreach";

const ALL_GROUPS = "__all__";
const today = () => new Date().toISOString().slice(0, 10);
const phoneDigits = (phone: string) => phone.replace(/\D/g, "");
const ageFromDateOfBirth = (dateOfBirth?: string) => {
  if (!dateOfBirth) return undefined;
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const today = new Date();
  const age =
    today.getFullYear() -
    year -
    (today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day)
      ? 1
      : 0);
  return age >= 0 ? age : undefined;
};

export const filterOutreachHouseholds = (
  households: HouseholdSummary[],
  assignedHouseholdIds: ReadonlySet<string>,
  query: string,
) => {
  const normalized = query.trim().toLowerCase();
  return households
    .filter((household) => {
      if (!assignedHouseholdIds.has(household.householdId)) return false;
      return (
        !normalized ||
        [
          household.householdName,
          household.address,
          household.postalCode,
          ...household.members.map((member) => member.fullName),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalized)
      );
    })
    .sort((left, right) =>
      left.householdName.localeCompare(right.householdName),
    );
};

export const OutreachPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isManager = isOutreachAdminUser(user?.groups ?? []);
  const groups = useOutreachGroups();
  const {
    items: households,
    isPending: householdsPending,
    error: householdsError,
  } = useHouseholdsIndex();
  const [selectedGroupId, setSelectedGroupId] = useState<string>(ALL_GROUPS);
  const [query, setQuery] = useState("");
  const [expandedHouseholds, setExpandedHouseholds] = useState<Set<string>>(
    new Set(),
  );
  const [activityHousehold, setActivityHousehold] =
    useState<HouseholdSummary | null>(null);
  const [activitySaving, setActivitySaving] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityForm, setActivityForm] = useState<CreateOutreachActivityInput>(
    { groupId: "", activityDate: today(), activityType: "Visit", comment: "" },
  );
  const groupIds = useMemo(
    () => groups.data?.items.map((group) => group.groupId) ?? [],
    [groups.data?.items],
  );

  useEffect(() => {
    if (groupIds.length)
      setSelectedGroupId((current) =>
        current === ALL_GROUPS || groupIds.includes(current)
          ? current
          : ALL_GROUPS,
      );
  }, [groupIds]);

  const requestedGroupIds =
    selectedGroupId === ALL_GROUPS ? groupIds : [selectedGroupId];
  const assignmentQueries = useOutreachHouseholdsForGroups(requestedGroupIds);
  const assignmentsLoading = assignmentQueries.some(
    (result) => result.isPending,
  );
  const assignmentsError = assignmentQueries.find(
    (result) => result.error,
  )?.error;
  const assignedHouseholdIds = useMemo(
    () =>
      new Set(
        assignmentQueries.flatMap(
          (result) =>
            result.data?.items.map((assignment) => assignment.householdId) ??
            [],
        ),
      ),
    [assignmentQueries],
  );
  const householdGroupIds = useMemo(() => {
    const result = new Map<string, string[]>();
    assignmentQueries.forEach((query, index) => {
      const groupId = requestedGroupIds[index];
      query.data?.items.forEach((assignment) =>
        result.set(assignment.householdId, [
          ...(result.get(assignment.householdId) ?? []),
          groupId,
        ]),
      );
    });
    return result;
  }, [assignmentQueries, requestedGroupIds]);
  const filteredHouseholds = useMemo(
    () => filterOutreachHouseholds(households, assignedHouseholdIds, query),
    [assignedHouseholdIds, households, query],
  );
  const activityGroups = activityHousehold
    ? (householdGroupIds.get(activityHousehold.householdId) ?? [])
        .map((groupId) =>
          groups.data?.items.find((group) => group.groupId === groupId),
        )
        .filter((group): group is OutreachGroupSummary => Boolean(group))
    : [];
  const toggleHousehold = (householdId: string) =>
    setExpandedHouseholds((current) => {
      const next = new Set(current);
      next.has(householdId) ? next.delete(householdId) : next.add(householdId);
      return next;
    });
  const openActivity = (household: HouseholdSummary) => {
    const groupId = householdGroupIds.get(household.householdId)?.[0] ?? "";
    setActivityError(null);
    setActivityHousehold(household);
    setActivityForm({
      groupId,
      activityDate: today(),
      activityType: "Visit",
      comment: "",
    });
  };
  const recordActivity = async () => {
    if (!activityHousehold) return;
    setActivitySaving(true);
    setActivityError(null);
    try {
      await outreachApi.createActivity(
        activityHousehold.householdId,
        activityForm,
      );
      setActivityHousehold(null);
    } catch (reason) {
      setActivityError(
        reason instanceof Error
          ? reason.message
          : "Unable to record Outreach activity.",
      );
    } finally {
      setActivitySaving(false);
    }
  };

  if (groups.isPending || householdsPending)
    return (
      <LoadingState
        description="Loading Outreach groups and households."
        title="Preparing Outreach workspace"
      />
    );
  if (groups.error || householdsError || assignmentsError) {
    const error = groups.error ?? householdsError ?? assignmentsError;
    return (
      <ErrorState
        description={
          error instanceof Error
            ? error.message
            : "Unable to load Outreach workspace."
        }
        title="Unable to load Outreach"
      />
    );
  }
  if (!groups.data?.items.length)
    return (
      <div className="space-y-4">
        <PageHeader
          title="Outreach"
          description={
            isManager
              ? "View Outreach group households and members."
              : "Your assigned Outreach groups and households."
          }
        />
        <Card>
          <CardContent className="flex min-h-48 flex-col items-center justify-center text-center">
            <Users className="mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="font-semibold">
              {isManager
                ? "No Outreach groups yet"
                : "No Outreach groups have been assigned to you yet."}
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {isManager
                ? "Create a group from Manage Groups to start organizing households."
                : "Ask an Outreach administrator to assign you to a group."}
            </p>
          </CardContent>
        </Card>
      </div>
    );

  const activeGroup = groups.data.items.find(
    (group) => group.groupId === selectedGroupId,
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-3 sm:pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Outreach group
              </span>
              <Select
                aria-label="Select Outreach group"
                value={selectedGroupId}
                onChange={(event) => setSelectedGroupId(event.target.value)}
              >
                <option value={ALL_GROUPS}>
                  {isManager ? "All Outreach households" : "All My Households"}
                </option>
                {groups.data.items.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.name}
                    {group.active ? "" : " (Inactive)"}
                  </option>
                ))}
              </Select>
            </label>
            <label className="min-w-0 flex-[2]">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Find a household
              </span>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  aria-label="Search Outreach households"
                  className="h-10 w-full bg-transparent text-sm outline-none"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Household, member, or address"
                  value={query}
                />
              </div>
            </label>
          </div>
          {activeGroup ? (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {activeGroup.description || "No description"}
            </div>
          ) : null}
        </CardContent>
      </Card>
      {assignmentsLoading ? (
        <LoadingState
          description="Loading households for this group."
          title="Preparing households"
        />
      ) : filteredHouseholds.length ? (
        <>
          <div className="flex items-center justify-between px-1 text-sm">
            <h2 className="font-semibold">Households</h2>
            <span className="text-muted-foreground">
              {filteredHouseholds.length}{" "}
              {filteredHouseholds.length === 1 ? "household" : "households"}
            </span>
          </div>
          <div className="space-y-2">
            {filteredHouseholds.map((household) => (
              <Card key={household.householdId}>
                <CardContent className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2.5 sm:p-3">
                  <button
                    className="flex min-w-0 w-full items-center gap-2 overflow-hidden rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    onClick={() =>
                      navigate(`/households/${household.householdId}`)
                    }
                    type="button"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <Home className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-semibold">
                          {household.householdName}
                        </h2>
                        <p className="truncate text-xs text-muted-foreground">
                          {household.address || "No address"}
                        </p>
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge className="shrink-0" variant="neutral">
                      {household.memberCount}{" "}
                      {household.memberCount === 1 ? "member" : "members"}
                    </Badge>
                    <Button
                      aria-label={
                        "Record Outreach activity for " +
                        household.householdName
                      }
                      onClick={() => openActivity(household)}
                      size="icon"
                      title="Record Outreach activity"
                      type="button"
                      variant="ghost"
                    >
                      <MessageSquarePlus className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-expanded={expandedHouseholds.has(
                        household.householdId,
                      )}
                      aria-label={
                        (expandedHouseholds.has(household.householdId)
                          ? "Hide"
                          : "Show") +
                        " members of " +
                        household.householdName
                      }
                      onClick={() => toggleHousehold(household.householdId)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <ChevronDown
                        className={
                          "h-4 w-4 transition-transform " +
                          (expandedHouseholds.has(household.householdId)
                            ? "rotate-180"
                            : "")
                        }
                      />
                    </Button>
                  </div>
                  {expandedHouseholds.has(household.householdId) ? (
                    <div className="col-span-2 mt-2 w-full divide-y border-t border-border">
                      {household.members.map((member) => (
                        <div
                          className="flex flex-wrap items-center gap-2 py-2"
                          key={member.memberId}
                        >
                          <button
                            className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                            onClick={() =>
                              navigate(`/members/${member.memberId}`)
                            }
                            type="button"
                          >
                            {member.fullName}
                            {ageFromDateOfBirth(member.dateOfBirth) !==
                            undefined
                              ? " · " + ageFromDateOfBirth(member.dateOfBirth)
                              : ""}
                          </button>
                          {member.phone ? (
                            <>
                              <a
                                aria-label={"Call " + member.fullName}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                href={"tel:" + member.phone}
                                title="Call"
                              >
                                <Phone className="h-4 w-4" />
                              </a>
                              <a
                                aria-label={"Text " + member.fullName}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                href={"sms:" + member.phone}
                                title="Text message"
                              >
                                <MessageSquare className="h-4 w-4" />
                              </a>
                              {phoneDigits(member.phone) ? (
                                <a
                                  aria-label={"WhatsApp " + member.fullName}
                                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  href={
                                    "https://wa.me/" + phoneDigits(member.phone)
                                  }
                                  rel="noreferrer"
                                  target="_blank"
                                  title="WhatsApp"
                                >
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No phone
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="flex min-h-44 flex-col items-center justify-center text-center">
            <Home className="mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="font-semibold">
              {query
                ? "No matching households"
                : selectedGroupId === ALL_GROUPS
                  ? "No households in these Outreach groups"
                  : "No households in this Outreach group"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {query
                ? "Try a household name, member name, or address."
                : "Households can be assigned from Manage Groups."}
            </p>
          </CardContent>
        </Card>
      )}
      <Dialog
        open={Boolean(activityHousehold)}
        onClose={() => !activitySaving && setActivityHousehold(null)}
        title="Record Outreach Activity"
        description={
          activityHousehold
            ? "Add an activity for " + activityHousehold.householdName + "."
            : undefined
        }
      >
        <div className="space-y-3">
          {activityGroups.length > 1 ? (
            <label className="block text-sm">
              Outreach group
              <Select
                value={activityForm.groupId}
                onChange={(event) =>
                  setActivityForm({
                    ...activityForm,
                    groupId: event.target.value,
                  })
                }
              >
                {activityGroups.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
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
          {activityError ? (
            <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">
              {activityError}
            </p>
          ) : null}
          <Button
            disabled={
              activitySaving ||
              !activityForm.groupId ||
              !activityForm.comment.trim()
            }
            onClick={() => void recordActivity()}
            type="button"
          >
            {activitySaving ? "Recording…" : "Record activity"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
};
