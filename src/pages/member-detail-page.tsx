import {
  AlignLeft,
  ArrowLeft,
  CalendarDays,
  CheckCheck,
  Clock3,
  Ellipsis,
  FileText,
  Mail,
  MapPin,
  MessageCircleCheck,
  MessageCircle,
  MessagesSquare,
  Phone,
  UserRound,
  Users,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type {
  CreateHouseholdInput,
  CreateManualVisitationInput,
  HouseholdSummary,
  Member,
  MemberActivity,
  MemberDetailResponse,
  MemberIndexItem,
  MemberVisitation,
  ReportVisitorOption,
  UpdateManualVisitationInput,
  VisitationType,
} from "../../shared/types";
import { visitationTypes } from "../../shared/types";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { RightSideDrawer } from "../components/common/right-side-drawer";
import {
  HouseholdFormDialog,
  HouseholdSearchAutocomplete,
} from "../components/members/household-ui";
import {
  MemberAvatar,
  MemberChip,
  MemberDetailsTabs,
  MemberFormDialog,
  MemberSearchAutocomplete,
  UnityBadge,
  emptyMemberSelection,
} from "../components/members/member-ui";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { refreshHouseholdsIndexCache, useHouseholdsIndex } from "../lib/households-index";
import { useMembersIndex } from "../lib/members-index";

const isDateOnlyValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const getVisitationDateValue = (visitation: MemberVisitation) => {
  const visit = visitation as MemberVisitation & {
    startTime?: string;
    eventStart?: string;
  };
  return visit.visitDate || visit.startTime || visit.eventStart || visitation.createdAt;
};

const toVisitTimestamp = (visitation: MemberVisitation) => {
  const value = getVisitationDateValue(visitation);
  if (!value) {
    return 0;
  }

  if (isDateOnlyValue(value)) {
    return new Date(`${value}T00:00:00`).getTime();
  }

  return new Date(value).getTime();
};

const formatVisitDateTime = (visitation: MemberVisitation) => {
  const value = getVisitationDateValue(visitation);
  if (isDateOnlyValue(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const toLocalDateTimeInput = (value: string) => {
  const date = new Date(value);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
};

const DEFAULT_VISITATION_TYPE: VisitationType = "Visitation";

const normalizeVisitationType = (value: string | undefined): VisitationType =>
  visitationTypes.includes(value as VisitationType) ? value as VisitationType : DEFAULT_VISITATION_TYPE;

const isVisitationTitle = (value: string) => {
  const normalized = value.trim();
  return visitationTypes.some((type) => normalized === type || normalized.startsWith(`${type}: `));
};

const buildVisitationTitle = (
  memberIds: string[],
  memberIndex: MemberIndexItem[],
  visitationType: VisitationType = DEFAULT_VISITATION_TYPE,
) => {
  const memberNames = emptyMemberSelection(memberIndex, memberIds)
    .map((selectedMember) => selectedMember.fullName)
    .filter(Boolean);

  return memberNames.length ? `${visitationType}: ${memberNames.join(", ")}` : visitationType;
};

type ManualVisitationFormState = {
  title: string;
  visitDate: string;
  type: VisitationType;
  location: string;
  visitStatus: string;
  notes: string;
  memberIds: string[];
  memberQuery: string;
  visitorUserId: string;
  visitorDisplayName: string;
};

const createEmptyManualForm = (
  memberId: string,
  currentUser?: { id: string; name: string } | null,
  memberName?: string,
): ManualVisitationFormState => ({
  title: memberName ? `${DEFAULT_VISITATION_TYPE}: ${memberName}` : "",
  visitDate: toLocalDateTimeInput(new Date().toISOString()),
  type: DEFAULT_VISITATION_TYPE,
  location: "",
  visitStatus: "completed",
  notes: "",
  memberIds: memberId ? [memberId] : [],
  memberQuery: "",
  visitorUserId: currentUser?.id ?? "",
  visitorDisplayName: currentUser?.name ?? "",
});

type ManualVisitationErrors = Partial<Record<keyof CreateManualVisitationInput | "memberIds", string>>;

const validateManualForm = (form: ManualVisitationFormState): ManualVisitationErrors => {
  const errors: ManualVisitationErrors = {};

  if (!form.title.trim()) {
    errors.title = "Enter a visit title.";
  }

  if (!form.visitDate.trim()) {
    errors.visitDate = "Choose a visit date and time.";
  }

  if (!form.memberIds.length) {
    errors.memberIds = "Select at least one member.";
  }

  if (!form.visitorUserId.trim() || !form.visitorDisplayName.trim()) {
    errors.visitorUserId = "Choose a visitor.";
  }

  return errors;
};

const toManualPayload = (form: ManualVisitationFormState): CreateManualVisitationInput => ({
  title: form.title.trim(),
  visitDate: new Date(form.visitDate).toISOString(),
  type: normalizeVisitationType(form.type),
  location: form.location.trim() || undefined,
  visitStatus: form.visitStatus,
  notes: form.notes.trim() || undefined,
  memberIds: form.memberIds,
  visitorUserId: form.visitorUserId,
  visitorDisplayName: form.visitorDisplayName,
});

const visitationStatusLabel = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

const applyManualVisitationType = (
  current: ManualVisitationFormState,
  nextType: VisitationType,
  memberIndex: MemberIndexItem[],
): ManualVisitationFormState => ({
  ...current,
  title:
    !current.title.trim() || isVisitationTitle(current.title)
      ? buildVisitationTitle(current.memberIds, memberIndex, nextType)
      : current.title,
  type: nextType,
});

export const MemberDetailPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { memberId = "" } = useParams();
  const [member, setMember] = useState<Member | null>(null);
  const [household, setHousehold] = useState<HouseholdSummary | null>(null);
  const [activity, setActivity] = useState<MemberActivity[]>([]);
  const [visitations, setVisitations] = useState<MemberVisitation[]>([]);
  const {
    items: memberIndex,
    isPending: memberIndexPending,
    isFetching: memberIndexFetching,
    refresh: refreshMemberIndex,
    tenantId,
  } = useMembersIndex();
  const {
    cacheScope: householdCacheScope,
    items: households,
  } = useHouseholdsIndex();
  const [activeTab, setActiveTab] = useState<"details" | "visitations" | "activity">("details");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [manualEditorOpen, setManualEditorOpen] = useState(false);
  const [manualEditorMode, setManualEditorMode] = useState<"create" | "edit">("create");
  const [manualForm, setManualForm] = useState<ManualVisitationFormState>(createEmptyManualForm(memberId, user));
  const [manualErrors, setManualErrors] = useState<ManualVisitationErrors>({});
  const [manualSaving, setManualSaving] = useState(false);
  const [manualDeleting, setManualDeleting] = useState(false);
  const [selectedManualVisitation, setSelectedManualVisitation] = useState<MemberVisitation | null>(null);
  const [editingManualVisitation, setEditingManualVisitation] = useState<MemberVisitation | null>(null);
  const [manualDeleteOpen, setManualDeleteOpen] = useState(false);
  const [attachHouseholdOpen, setAttachHouseholdOpen] = useState(false);
  const [createHouseholdOpen, setCreateHouseholdOpen] = useState(false);
  const [householdQuery, setHouseholdQuery] = useState("");
  const [householdSaving, setHouseholdSaving] = useState(false);

  const loadMember = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [details, memberEvents] = await Promise.all([
        api.get<MemberDetailResponse>(`/members/${memberId}`),
        api.get<{ items: MemberVisitation[] }>(`/members/${memberId}/events`),
      ]);
      setMember(details.member);
      setHousehold(details.household ?? null);
      setActivity(details.activity);
      setVisitations(memberEvents.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load member.");
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void loadMember();
  }, [loadMember]);

  const sortedVisitations = useMemo(
    () => [...visitations].sort((left, right) => toVisitTimestamp(right) - toVisitTimestamp(left)),
    [visitations],
  );

  const visitorOptions = useMemo<ReportVisitorOption[]>(() => {
    const byId = new Map<string, ReportVisitorOption>();

    if (user?.id && user.name) {
      byId.set(user.id, {
        visitorUserId: user.id,
        visitorDisplayName: user.name,
      });
    }

    visitations.forEach((visitation) => {
      if (visitation.visitorUserId && visitation.visitorDisplayName) {
        byId.set(visitation.visitorUserId, {
          visitorUserId: visitation.visitorUserId,
          visitorDisplayName: visitation.visitorDisplayName,
        });
      }
    });

    const currentUserOption = user?.id ? byId.get(user.id) : undefined;
    const otherOptions = [...byId.values()]
      .filter((option) => option.visitorUserId !== user?.id)
      .sort((left, right) => left.visitorDisplayName.localeCompare(right.visitorDisplayName));

    return currentUserOption ? [currentUserOption, ...otherOptions] : otherOptions;
  }, [user, visitations]);

  const quickActions = useMemo(() => {
    if (!member) {
      return [];
    }

    return [
      { href: member.phone ? `tel:${member.phone}` : undefined, icon: Phone, label: "Call" },
      { href: member.phone ? `sms:${member.phone}` : undefined, icon: MessagesSquare, label: "Text" },
      { href: member.whatsappPhone ? `https://wa.me/${member.whatsappPhone.replace(/\D/g, "")}` : undefined, icon: MessageCircleCheck, label: "WhatsApp" },
      { href: member.email ? `mailto:${member.email}` : undefined, icon: Mail, label: "Email" },
    ].filter((item) => item.href);
  }, [member]);

  const memberPreview = useMemo(
    () => memberIndex.find((item) => item.memberId === memberId),
    [memberId, memberIndex],
  );

  const ensureMemberIndexLoaded = useCallback(async () => {
    if (memberIndex.length) {
      return;
    }

    try {
      await refreshMemberIndex();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load members for visitation selection.");
    }
  }, [memberIndex.length, refreshMemberIndex]);

  const handleSave = useCallback(async (value: Partial<Member>) => {
    setSaving(true);
    try {
      await api.put(`/members/${memberId}`, value);
      setEditing(false);
      await loadMember();
      await refreshMemberIndex();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update member.");
    } finally {
      setSaving(false);
    }
  }, [loadMember, memberId, refreshMemberIndex]);

  const handleDelete = useCallback(async () => {
    try {
      await api.delete(`/members/${memberId}`);
      await refreshMemberIndex();
      navigate("/members");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete member.");
    }
  }, [memberId, navigate, refreshMemberIndex]);

  const refreshHouseholdData = useCallback(async () => {
    await Promise.all([
      loadMember(),
      refreshMemberIndex(),
      refreshHouseholdsIndexCache(queryClient, householdCacheScope),
    ]);
  }, [householdCacheScope, loadMember, queryClient, refreshMemberIndex]);

  const handleAttachHousehold = useCallback(async (nextHousehold: HouseholdSummary) => {
    setHouseholdSaving(true);
    setError(null);
    try {
      if (member?.householdId && member.householdId !== nextHousehold.householdId) {
        const confirmed = window.confirm(
          "This member already belongs to another household. Continue and move them to the selected household?",
        );
        if (!confirmed) {
          return;
        }
      }

      await api.post(`/members/${memberId}/household`, { householdId: nextHousehold.householdId });
      setAttachHouseholdOpen(false);
      setHouseholdQuery("");
      await refreshHouseholdData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to attach member to household.");
    } finally {
      setHouseholdSaving(false);
    }
  }, [member?.householdId, memberId, refreshHouseholdData]);

  const handleCreateHousehold = useCallback(async (value: CreateHouseholdInput) => {
    setHouseholdSaving(true);
    setError(null);
    try {
      await api.post("/households", value);
      setCreateHouseholdOpen(false);
      await refreshHouseholdData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create household.");
    } finally {
      setHouseholdSaving(false);
    }
  }, [refreshHouseholdData]);

  const handleRemoveFromHousehold = useCallback(async () => {
    setHouseholdSaving(true);
    setError(null);
    try {
      await api.delete(`/members/${memberId}/household`);
      await refreshHouseholdData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove member from household.");
    } finally {
      setHouseholdSaving(false);
    }
  }, [memberId, refreshHouseholdData]);

  const openCreateManualVisitation = useCallback(() => {
    setManualEditorMode("create");
    setEditingManualVisitation(null);
    setSelectedManualVisitation(null);
    setManualErrors({});
    setManualForm(createEmptyManualForm(memberId, user, member?.fullName));
    setManualEditorOpen(true);
    void ensureMemberIndexLoaded();
  }, [ensureMemberIndexLoaded, member?.fullName, memberId, user]);

  const openEditManualVisitation = useCallback((visitation: MemberVisitation) => {
    setManualEditorMode("edit");
    setEditingManualVisitation(visitation);
    setManualErrors({});
    setManualForm({
      title: visitation.title,
      visitDate: toLocalDateTimeInput(getVisitationDateValue(visitation)),
      type: normalizeVisitationType(visitation.type),
      location: visitation.location ?? "",
      visitStatus: visitation.visitStatus,
      notes: visitation.notes ?? "",
      memberIds: visitation.memberIds,
      memberQuery: "",
      visitorUserId: visitation.visitorUserId,
      visitorDisplayName: visitation.visitorDisplayName,
    });
    setSelectedManualVisitation(null);
    setManualEditorOpen(true);
    void ensureMemberIndexLoaded();
  }, [ensureMemberIndexLoaded]);

  const handleVisitationClick = useCallback((visitation: MemberVisitation) => {
    if (visitation.source === "calendar" && visitation.eventId && visitation.calendarId) {
      const params = new URLSearchParams({
        eventId: visitation.eventId,
        calendarId: visitation.calendarId,
        date: getVisitationDateValue(visitation),
      });
      navigate(`/calendar/schedule?${params.toString()}`);
      return;
    }

    setSelectedManualVisitation(visitation);
  }, [navigate]);

  const handleManualSubmit = useCallback(async () => {
    const nextErrors = validateManualForm(manualForm);
    setManualErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      return;
    }

    setManualSaving(true);
    setError(null);
    try {
      const payload = toManualPayload(manualForm);
      if (manualEditorMode === "create") {
        await api.post(`/members/${memberId}/visitations`, payload);
      } else if (editingManualVisitation) {
        await api.put(
          `/members/${memberId}/visitations/${editingManualVisitation.visitationId}`,
          payload as UpdateManualVisitationInput,
        );
      }

      setManualEditorOpen(false);
      setEditingManualVisitation(null);
      setSelectedManualVisitation(null);
      await loadMember();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save manual visitation.");
    } finally {
      setManualSaving(false);
    }
  }, [editingManualVisitation, loadMember, manualEditorMode, manualForm, memberId]);

  const handleManualDelete = useCallback(async () => {
    if (!selectedManualVisitation) {
      return;
    }

    setManualDeleting(true);
    setError(null);
    try {
      await api.delete(`/members/${memberId}/visitations/${selectedManualVisitation.visitationId}`);
      setManualDeleteOpen(false);
      setSelectedManualVisitation(null);
      setManualEditorOpen(false);
      await loadMember();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete manual visitation.");
    } finally {
      setManualDeleting(false);
    }
  }, [loadMember, memberId, selectedManualVisitation]);

  if (loading && memberPreview) {
    return (
      <div className="space-y-3">
        <section className="rounded-lg border border-border bg-white p-3 panel-shadow">
          <div className="flex items-start justify-between">
            <button className="flex items-center gap-2 text-sm font-semibold text-slate-900" onClick={() => navigate("/members")} type="button">
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
              Loading details...
            </div>
          </div>

          <div className="mt-3 flex flex-col items-center text-center">
            <MemberAvatar fullName={memberPreview.fullName} initials={memberPreview.initials} size="lg" />
            <div className="mt-2.5 flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{memberPreview.fullName}</h1>
              <UnityBadge source={memberPreview.source} unityId={memberPreview.unityId} />
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {memberPreview.email || memberPreview.phone || memberPreview.householdName || "Loading profile..."}
            </div>
          </div>

          <div className="mt-3">
            <MemberDetailsTabs activeTab={activeTab} onChange={setActiveTab} />
          </div>

          <div className="mt-2.5 grid gap-2">
            {[0, 1, 2, 3].map((item) => (
              <div className="animate-pulse rounded-md border border-border bg-background/60 px-3 py-3" key={item}>
                <div className="h-2.5 w-20 rounded bg-slate-200" />
                <div className="mt-2 h-4 w-full rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (loading) {
    return <LoadingState description="Loading member profile." title="Preparing member" />;
  }

  if (!member) {
    return <ErrorState description={error ?? "Member not found."} title="Unable to load member" />;
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorState description={error} title="Member action failed" /> : null}

      <section className="rounded-lg border border-border bg-white p-3 panel-shadow">
        <div className="flex items-start justify-between">
          <button className="flex items-center gap-2 text-sm font-semibold text-slate-900" onClick={() => navigate("/members")} type="button">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="relative">
            <Button onClick={() => setMenuOpen((current) => !current)} size="icon" type="button" variant="ghost">
              <Ellipsis className="h-4 w-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-10 w-36 rounded-md border border-border bg-white p-1.5 shadow-lg">
                <button className="block w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium hover:bg-accent" onClick={() => setEditing(true)} type="button">
                  Edit
                </button>
                <button className="block w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium text-rose-600 hover:bg-rose-50" onClick={() => void handleDelete()} type="button">
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-col items-center text-center">
          <MemberAvatar fullName={member.fullName} initials={member.initials} size="lg" />
          <div className="mt-2.5 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{member.fullName}</h1>
            <UnityBadge source={member.source} unityId={member.unityId} />
          </div>
        </div>

        <div className="mt-3 flex justify-center gap-2">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <a
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-accent"
                href={item.href}
                key={item.label}
                rel="noreferrer"
                target={item.href?.startsWith("http") ? "_blank" : undefined}
              >
                <Icon className="h-4 w-4 text-primary" />
              </a>
            );
          })}
        </div>

        <div className="mt-3">
          <MemberDetailsTabs activeTab={activeTab} onChange={setActiveTab} />
        </div>

        <div className="mt-2.5 rounded-lg border border-border bg-background/50 p-3">
          {activeTab === "details" ? (
            <div className="grid gap-2">
              <div className="rounded-md border border-border bg-white px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{member.unityId ? "UNITY ID" : "MEMBER ID"}</div>
                <div className="mt-1 text-sm text-slate-900">{member.unityId ?? member.memberId}</div>
              </div>
              <div className="rounded-md border border-border bg-white px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Phone</div>
                <div className="mt-1 text-sm text-slate-900">{member.phone || "Not set"}</div>
              </div>
              <div className="rounded-md border border-border bg-white px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Email</div>
                <div className="mt-1 text-sm text-slate-900">{member.email || "Not set"}</div>
              </div>
              <div className="rounded-md border border-border bg-white px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Address</div>
                <div className="mt-1 text-sm text-slate-900">{member.address || "Not set"}</div>
              </div>
              <div className="rounded-md border border-border bg-white px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Household</div>
                {household ? (
                  <div className="mt-1 space-y-2">
                    <div className="text-sm font-semibold text-slate-900">{household.householdName}</div>
                    <div className="text-xs text-muted-foreground">{household.memberCount} members</div>
                    <div className="space-y-2">
                      <Button
                        className="h-10 w-full text-sm sm:w-auto"
                        onClick={() => navigate(`/households/${household.householdId}`)}
                        type="button"
                      >
                        View Household
                      </Button>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        <Button
                          className="h-10 w-full border-primary/40 text-primary hover:bg-primary/5 sm:w-auto"
                          onClick={() => setAttachHouseholdOpen(true)}
                          type="button"
                          variant="outline"
                        >
                          Change
                        </Button>
                        <Button
                          className="h-10 w-full border-rose-300 text-rose-500 hover:bg-rose-50 hover:text-rose-600 sm:w-auto"
                          disabled={householdSaving}
                          onClick={() => void handleRemoveFromHousehold()}
                          type="button"
                          variant="outline"
                        >
                          {householdSaving ? "Working..." : "Remove"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 space-y-2">
                    <div className="text-sm text-slate-900">Not assigned to any household</div>
                    <div className="space-y-2">
                      <Button className="h-10 w-full text-sm sm:w-auto" onClick={() => setAttachHouseholdOpen(true)} type="button">
                        Attach to Household
                      </Button>
                      <Button
                        className="h-10 w-full border-primary/40 text-primary hover:bg-primary/5 sm:w-auto"
                        onClick={() => setCreateHouseholdOpen(true)}
                        type="button"
                        variant="outline"
                      >
                        Create Household
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-md border border-border bg-white px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Notes</div>
                <div className="mt-1 text-sm text-slate-900">{member.notes || "Not set"}</div>
              </div>
            </div>
          ) : null}

          {activeTab === "visitations" ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => {
                    const params = new URLSearchParams({ memberId: member.memberId });

                    if (member.fullName) {
                      params.set("memberName", member.fullName);
                    }
                    if (member.email) {
                      params.set("memberEmail", member.email);
                    }
                    if (member.address) {
                      params.set("memberAddress", member.address);
                    }

                    navigate(`/calendar/schedule?${params.toString()}`);
                  }}
                  type="button"
                >
                  Schedule Activity
                </Button>
                <Button className="w-full" onClick={() => void openCreateManualVisitation()} size="sm" type="button" variant="outline">
                  Record Activity
                </Button>
              </div>

              {sortedVisitations.length ? (
                <div className="space-y-2">
                  {sortedVisitations.map((visitation) => {
                    const isFuture = toVisitTimestamp(visitation) >= Date.now();
                    return (
                      <button
                        className="w-full rounded-md border border-border bg-white px-3 py-2.5 text-left transition-colors hover:border-primary/25 hover:bg-accent"
                        key={`${visitation.visitationId}:${visitation.memberId}`}
                        onClick={() => handleVisitationClick(visitation)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className={isFuture ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-600"}>
                            {isFuture ? "Future" : "Past"}
                          </Badge>
                          <Badge variant={visitation.source === "calendar" ? "default" : "neutral"}>
                            {visitation.source === "calendar" ? "Calendar Event" : "Manual Visit"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{visitation.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{formatVisitDateTime(visitation)}</div>
                        {visitation.location ? (
                          <div className="mt-1 text-xs text-muted-foreground">{visitation.location}</div>
                        ) : null}
                        <div className="mt-1 text-xs font-medium text-slate-700">
                          Visitor: <span className="font-semibold text-slate-900">{visitation.visitorDisplayName || visitation.createdByName}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Visit status: {visitationStatusLabel(visitation.visitStatus)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border bg-white px-4 text-center text-sm font-medium text-muted-foreground">
                  No activities recorded yet.
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "activity" ? (
            <div className="space-y-3">
              {activity.map((item) => (
                <div className="flex gap-3" key={item.activityId}>
                  <div className="flex flex-col items-center">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    <span className="mt-1.5 h-full min-h-10 w-px rounded-full bg-border" />
                  </div>
                  <div className="flex-1 rounded-md border border-border bg-white px-3 py-2.5">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-sm bg-accent px-1.5 py-0.5 font-medium text-accent-foreground">{item.action}</span>
                      <span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-1.5 text-sm text-slate-900">{item.message}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <MemberFormDialog
        busy={saving}
        initialValue={member}
        onClose={() => setEditing(false)}
        onSubmit={handleSave}
        open={editing}
        title="Edit Member"
      />

      <RightSideDrawer
        contentClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] dark:bg-[linear-gradient(180deg,#09111f_0%,#0b1422_100%)] px-2 py-2.5 sm:px-3 sm:py-3"
        description={manualEditorMode === "create" ? "Add a visit record without creating a Google Calendar event." : "Update this manual visit record."}
        descriptionClassName="text-xs text-muted-foreground sm:text-sm"
        footer={(
          <div className="space-y-2.5">
            <Button className="h-11 w-full rounded-xl text-sm font-semibold shadow-[0_14px_26px_rgba(37,99,235,0.24)]" disabled={manualSaving} onClick={() => void handleManualSubmit()} type="button">
              <CalendarDays className="h-4 w-4" />
              {manualSaving ? "Saving..." : manualEditorMode === "create" ? "Save Visit" : "Save Changes"}
            </Button>
            <Button
              className="h-11 w-full rounded-xl text-sm font-semibold"
              onClick={() => {
                setManualEditorOpen(false);
                setEditingManualVisitation(null);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        )}
        footerClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] dark:bg-[linear-gradient(180deg,#09111f_0%,#0b1422_100%)] px-2 py-2.5 sm:px-3"
        headerClassName="border-b border-slate-200/80 bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] dark:border-border/80 dark:bg-[linear-gradient(180deg,#09111f_0%,#0b1422_100%)] px-2 py-2.5 sm:px-3"
        headerLeading={(
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] bg-[linear-gradient(180deg,#eef4ff_0%,#f6f9ff_100%)] text-primary shadow-inner">
            <CalendarDays className="h-6 w-6" />
          </div>
        )}
        onClose={() => {
          setManualEditorOpen(false);
          setEditingManualVisitation(null);
        }}
        open={manualEditorOpen}
        panelClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] dark:bg-[linear-gradient(180deg,#09111f_0%,#0b1422_100%)]"
        title={manualEditorMode === "create" ? "Record Activity" : "Edit Manual Activity"}
        titleClassName="text-2xl font-semibold tracking-tight text-foreground"
        width="lg"
      >
        {(() => {
          const sectionCardClassName = "space-y-3 rounded-[1.2rem] border border-border/80 bg-card/96 p-3 shadow-[0_14px_32px_rgba(15,23,42,0.05)] backdrop-blur dark:shadow-[0_14px_32px_rgba(0,0,0,0.24)] sm:p-3.5";
          const fieldClassName = "h-10 rounded-xl border-border bg-card px-3 text-sm shadow-sm shadow-slate-200/35 transition focus:border-primary focus:ring-primary/10 dark:shadow-black/20";

          return (
            <div className="space-y-3">
              {memberIndexPending || memberIndexFetching ? (
                <div className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm shadow-slate-200/30 dark:shadow-black/20">
                  Loading members for selection...
                </div>
              ) : null}

              <section className={sectionCardClassName}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    <h4 className="text-lg font-semibold tracking-tight">Members</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">Add one or more members to this visitation.</p>
                </div>
                <MemberSearchAutocomplete
                  items={memberIndex}
                  onQueryChange={(value) => setManualForm((current) => ({ ...current, memberQuery: value }))}
                  onSelect={(item) =>
                    setManualForm((current) => ({
                      ...current,
                      title:
                        !current.title.trim() || isVisitationTitle(current.title)
                          ? buildVisitationTitle(
                            [...new Set([...current.memberIds, item.memberId])],
                            memberIndex,
                            normalizeVisitationType(current.type),
                          )
                          : current.title,
                      memberIds: [...new Set([...current.memberIds, item.memberId])],
                      memberQuery: "",
                    }))
                  }
                  placeholder="Search members..."
                  query={manualForm.memberQuery}
                  selectedIds={manualForm.memberIds}
                />
                <div className="space-y-1.5">
                  <div className="text-sm font-semibold text-muted-foreground">Selected ({manualForm.memberIds.length})</div>
                  {manualForm.memberIds.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {emptyMemberSelection(memberIndex, manualForm.memberIds).map((selectedMember) => (
                        <MemberChip
                          key={selectedMember.memberId}
                          member={selectedMember}
                          onRemove={(selectedId) =>
                            setManualForm((current) => ({
                              ...current,
                              title:
                                !current.title.trim() || isVisitationTitle(current.title)
                                  ? buildVisitationTitle(
                                    current.memberIds.filter((entry) => entry !== selectedId),
                                    memberIndex,
                                    normalizeVisitationType(current.type),
                                  )
                                  : current.title,
                              memberIds: current.memberIds.filter((entry) => entry !== selectedId),
                            }))
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-muted/35 px-3 py-2.5 text-sm text-muted-foreground">
                      No members selected yet.
                    </div>
                  )}
                  {manualErrors.memberIds ? <div className="text-xs text-rose-600">{manualErrors.memberIds}</div> : null}
                </div>
                {manualForm.memberIds.length ? (
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-foreground">Activity Type</span>
                    <Select
                      className={fieldClassName}
                      onChange={(event) =>
                        setManualForm((current) => applyManualVisitationType(current, normalizeVisitationType(event.target.value), memberIndex))
                      }
                      value={normalizeVisitationType(manualForm.type)}
                    >
                      {visitationTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : null}
              </section>

              <section className={sectionCardClassName}>
                <label className="space-y-1.5">
                  <span className="text-lg font-semibold tracking-tight text-foreground">Visit Title</span>
                  <div className="relative">
                    <FileText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className={`${fieldClassName} pl-10`}
                      onChange={(event) => setManualForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Home visit"
                      value={manualForm.title}
                    />
                  </div>
                  {manualErrors.title ? <div className="text-xs text-rose-600">{manualErrors.title}</div> : null}
                </label>
              </section>

              <section className={sectionCardClassName}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-foreground">
                    <Clock3 className="h-4 w-4 text-primary" />
                    <h4 className="text-lg font-semibold tracking-tight">Visit Details</h4>
                  </div>
                  <p className="text-[13px] text-muted-foreground">Set the date, visitor, and current status.</p>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-foreground">Visit Date/Time</span>
                    <div className="relative">
                      <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className={`${fieldClassName} pl-10`}
                        onChange={(event) => setManualForm((current) => ({ ...current, visitDate: event.target.value }))}
                        type="datetime-local"
                        value={manualForm.visitDate}
                      />
                    </div>
                    {manualErrors.visitDate ? <div className="text-xs text-rose-600">{manualErrors.visitDate}</div> : null}
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-foreground">Visitor</span>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Select
                        className={`${fieldClassName} pl-10`}
                        onChange={(event) => {
                          const selectedVisitor = visitorOptions.find((option) => option.visitorUserId === event.target.value);
                          setManualForm((current) => ({
                            ...current,
                            visitorUserId: event.target.value,
                            visitorDisplayName: selectedVisitor?.visitorDisplayName ?? "",
                          }));
                        }}
                        value={manualForm.visitorUserId}
                      >
                        <option value="" disabled>Select visitor</option>
                        {visitorOptions.map((visitor) => (
                          <option key={visitor.visitorUserId} value={visitor.visitorUserId}>
                            {visitor.visitorDisplayName}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {manualErrors.visitorUserId ? <div className="text-xs text-rose-600">{manualErrors.visitorUserId}</div> : null}
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-foreground">Visit Status</span>
                    <div className="relative">
                      <CheckCheck className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Select
                        className={`${fieldClassName} pl-10`}
                        onChange={(event) => setManualForm((current) => ({ ...current, visitStatus: event.target.value }))}
                        value={manualForm.visitStatus}
                      >
                        <option value="completed">Completed</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="follow_up_needed">Follow Up Needed</option>
                      </Select>
                    </div>
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-foreground">Location</span>
                    <div className="relative">
                      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className={`${fieldClassName} pl-10`}
                        onChange={(event) => setManualForm((current) => ({ ...current, location: event.target.value }))}
                        placeholder="Optional address or meeting spot"
                        value={manualForm.location}
                      />
                    </div>
                  </label>
                </div>
              </section>

              <section className="rounded-[1.2rem] border border-border/80 bg-card/96 shadow-[0_14px_32px_rgba(15,23,42,0.05)] backdrop-blur dark:shadow-[0_14px_32px_rgba(0,0,0,0.24)]">
                <div className="flex items-center gap-3 px-3 py-3 sm:px-3.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/55 text-muted-foreground">
                    <AlignLeft className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-lg font-semibold tracking-tight text-foreground">Notes</div>
                    <div className="text-[13px] text-muted-foreground">Capture anything worth remembering from the visit.</div>
                  </div>
                </div>
                <div className="border-t border-border/80 px-3 pb-3 pt-3 sm:px-3.5 sm:pb-3.5">
                  <Textarea
                    className="min-h-20 rounded-xl border-border bg-card px-3 py-2.5 text-sm shadow-sm shadow-slate-200/35 focus:border-primary focus:ring-primary/10 dark:shadow-black/20"
                    onChange={(event) => setManualForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Optional notes"
                    value={manualForm.notes}
                  />
                </div>
              </section>
            </div>
          );
        })()}
      </RightSideDrawer>

      <RightSideDrawer
        description="Manual visit details. Editing or deleting here will not affect Google Calendar."
        footer={
          selectedManualVisitation ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button className="bg-rose-600 hover:bg-rose-700" onClick={() => setManualDeleteOpen(true)} type="button">
                Delete
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button onClick={() => setSelectedManualVisitation(null)} type="button" variant="outline">
                  Close
                </Button>
                <Button onClick={() => void openEditManualVisitation(selectedManualVisitation)} type="button">
                  Edit
                </Button>
              </div>
            </div>
          ) : null
        }
        onClose={() => setSelectedManualVisitation(null)}
        open={Boolean(selectedManualVisitation)}
        title={selectedManualVisitation?.title ?? "Manual Activity"}
      >
        {selectedManualVisitation ? (
          <div className="space-y-3">
            <Badge className="bg-slate-100 text-slate-700">No Calendar Event Attached</Badge>
            <div className="grid gap-2">
              {[
                ["Visit Date", formatVisitDateTime(selectedManualVisitation)],
                ["Activity Type", normalizeVisitationType(selectedManualVisitation.type)],
                ["Location", selectedManualVisitation.location || "Not set"],
                ["Visitor", selectedManualVisitation.visitorDisplayName],
                ["Visit Status", visitationStatusLabel(selectedManualVisitation.visitStatus)],
                ["Created By", selectedManualVisitation.createdByName],
                ["Created Date", new Date(selectedManualVisitation.createdAt).toLocaleString()],
              ].map(([label, value]) => (
                <div className="rounded-md border border-border bg-slate-50 px-3 py-2.5" key={label}>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
                  <div className="mt-1 text-sm text-slate-900">{value}</div>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-border bg-slate-50 px-3 py-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notes</div>
              <div className="mt-1 text-sm text-slate-900">{selectedManualVisitation.notes || "No notes added."}</div>
            </div>
            <div className="rounded-md border border-border bg-slate-50 px-3 py-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Members</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedManualVisitation.memberNames.map((name) => (
                  <Badge key={name} variant="neutral">{name}</Badge>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </RightSideDrawer>

      <ConfirmDialog
        busy={manualDeleting}
        confirmLabel="Delete Visit"
        description="This deletes only the manual visitation record. No Google Calendar event will be changed."
        destructive
        onClose={() => setManualDeleteOpen(false)}
        onConfirm={() => void handleManualDelete()}
        open={manualDeleteOpen}
        title="Delete Manual Activity?"
      />
      <ConfirmDialog
        busy={householdSaving}
        confirmLabel="Close"
        description="Search for an existing household to attach this member."
        onClose={() => {
          setAttachHouseholdOpen(false);
          setHouseholdQuery("");
        }}
        onConfirm={() => {
          setAttachHouseholdOpen(false);
          setHouseholdQuery("");
        }}
        open={attachHouseholdOpen}
        title={household ? "Change Household" : "Attach to Household"}
      >
        <HouseholdSearchAutocomplete
          items={households.filter((item) => item.householdId !== member.householdId)}
          onQueryChange={setHouseholdQuery}
          onSelect={(item) => void handleAttachHousehold(item)}
          placeholder="Search households"
          query={householdQuery}
        />
      </ConfirmDialog>
      <HouseholdFormDialog
        busy={householdSaving}
        initialValue={{
          householdName: member.lastName ? `${member.lastName} Household` : `${member.fullName} Household`,
          address: member.address,
          memberIds: [member.memberId],
        }}
        members={memberIndex}
        onClose={() => setCreateHouseholdOpen(false)}
        onSubmit={handleCreateHousehold}
        open={createHouseholdOpen}
        title="Create Household"
      />
    </div>
  );
};
