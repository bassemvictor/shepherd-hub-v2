import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, {
  type DateClickArg,
  type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type {
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  DateSelectArg,
} from "@fullcalendar/core/index.js";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type {
  CreateScheduleEventInput,
  MemberIndexItem,
  ScheduleCalendar,
  ScheduleEvent,
  ScheduleEventsResponse,
  ScheduleOverviewResponse,
  UpdateScheduleEventInput,
} from "../../shared/types";
import {
  MemberChip,
  MemberSearchAutocomplete,
  emptyMemberSelection,
} from "../components/members/member-ui";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { PageHeader } from "../components/common/page-header";
import { RightSideDrawer } from "../components/common/right-side-drawer";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { api, isApiConfigured } from "../lib/api";
import {
  CalendarSourceBadge,
  formatDateTime,
  ToastItem,
  ToastStack,
  useIsMobile,
} from "./calendar-shared";

type EditorMode = "create" | "edit";

type EventFormState = {
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  attendeesText: string;
  start: string;
  end: string;
  allDay: boolean;
  memberIds: string[];
  memberQuery: string;
};

const fullCalendarPlugins = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];

const FALLBACK_EVENT_COLOR = "#2563eb";
const VISITATION_TITLE_PREFIX = "Visitation: ";

const normalizeHexColor = (value?: string | null) => {
  const color = value?.trim();
  if (!color) {
    return FALLBACK_EVENT_COLOR;
  }

  const normalized = color.startsWith("#") ? color.slice(1) : color;
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `#${normalized}`;
  }

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    return `#${normalized
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }

  return FALLBACK_EVENT_COLOR;
};

const getEventTextColor = (backgroundColor?: string | null) => {
  const hex = normalizeHexColor(backgroundColor).slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness > 170 ? "#0f172a" : "#ffffff";
};

const isDateOnlyValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseDateOnlyValue = (value: string) => {
  const [year, month, day] = value.split("-").map((segment) => Number.parseInt(segment, 10));
  return new Date(year, month - 1, day);
};

const toDateOnlyValue = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 10);
};

const shiftDateOnlyValue = (value: string, days: number) => {
  const date = parseDateOnlyValue(value);
  date.setDate(date.getDate() + days);
  return toDateOnlyValue(date);
};

const isSameLocalDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

const getCurrentScrollTime = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}:00`;
};

const normalizeAllDayStartValue = (value: string) => (isDateOnlyValue(value) ? value : value.slice(0, 10));

const normalizeAllDayEndValue = (value: string) => (isDateOnlyValue(value) ? value : value.slice(0, 10));

const toLocalDateInput = (value: string) => {
  if (isDateOnlyValue(value)) {
    return value;
  }

  const date = new Date(value);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 10);
};

const toLocalDateTimeInput = (value: string) => {
  const date = new Date(value);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
};

const localInputToIso = (value: string, allDay: boolean, boundary: "start" | "end") => {
  if (allDay) {
    return boundary === "start" ? value : shiftDateOnlyValue(value, 1);
  }

  return new Date(value).toISOString();
};

const parseAttendees = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const isVisitationSummary = (value: string) => {
  const normalized = value.trim();
  return normalized === "Visitation" || normalized.startsWith(VISITATION_TITLE_PREFIX.trim());
};

const buildVisitationSummary = (memberIds: string[], memberIndex: MemberIndexItem[]) => {
  const memberNames = emptyMemberSelection(memberIndex, memberIds)
    .map((member) => member.fullName)
    .filter(Boolean);

  return `${VISITATION_TITLE_PREFIX}${memberNames.join(", ")}`;
};

const applyMemberSelectionToForm = (
  currentForm: EventFormState,
  nextMemberIds: string[],
  memberIndex: MemberIndexItem[],
): EventFormState => {
  const previousFirstMember = emptyMemberSelection(memberIndex, currentForm.memberIds)[0];
  const nextSelectedMembers = emptyMemberSelection(memberIndex, nextMemberIds);
  const nextFirstMember = nextSelectedMembers[0];

  return {
    ...currentForm,
    summary:
      isVisitationSummary(currentForm.summary)
        ? buildVisitationSummary(nextMemberIds, memberIndex)
        : currentForm.summary,
    location:
      previousFirstMember?.memberId !== nextFirstMember?.memberId
        ? nextFirstMember?.address ?? ""
        : currentForm.location,
    attendeesText:
      previousFirstMember?.memberId !== nextFirstMember?.memberId
        ? nextFirstMember?.email ?? ""
        : currentForm.attendeesText,
    memberIds: nextMemberIds,
    memberQuery: "",
  };
};

const emptyEventForm = (calendarId = ""): EventFormState => {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    calendarId,
    summary: "",
    description: "",
    location: "",
    attendeesText: "",
    start: toLocalDateTimeInput(start.toISOString()),
    end: toLocalDateTimeInput(end.toISOString()),
    allDay: false,
    memberIds: [],
    memberQuery: "",
  };
};

const eventToFormState = (event: ScheduleEvent): EventFormState => ({
  calendarId: event.calendarId,
  summary: event.summary,
  description: event.description ?? "",
  location: event.location ?? "",
  attendeesText: (event.attendees ?? []).join(", "),
  start: event.allDay ? normalizeAllDayStartValue(event.start) : toLocalDateTimeInput(event.start),
  end: event.allDay ? shiftDateOnlyValue(normalizeAllDayEndValue(event.end), -1) : toLocalDateTimeInput(event.end),
  allDay: event.allDay,
  memberIds: event.memberIds ?? [],
  memberQuery: "",
});

const createFormFromSelection = (
  startValue: Date,
  endValue: Date,
  allDay: boolean,
  calendarId: string,
): EventFormState => ({
  calendarId,
  summary: "",
  description: "",
  location: "",
  attendeesText: "",
  start: allDay ? toDateOnlyValue(startValue) : toLocalDateTimeInput(startValue.toISOString()),
  end: allDay ? shiftDateOnlyValue(toDateOnlyValue(endValue), -1) : toLocalDateTimeInput(endValue.toISOString()),
  allDay,
  memberIds: [],
  memberQuery: "",
});

type EventEditorProps = {
  calendars: ScheduleCalendar[];
  mode: EditorMode;
  mobile: boolean;
  open: boolean;
  form: EventFormState;
  busy: boolean;
  canDelete: boolean;
  memberIndex: MemberIndexItem[];
  onChange: (next: EventFormState) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
};

const EventEditor = ({
  calendars,
  mode,
  mobile,
  open,
  form,
  busy,
  canDelete,
  memberIndex,
  onChange,
  onClose,
  onSave,
  onDelete,
}: EventEditorProps) => {
  const navigate = useNavigate();
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDetailsOpen(
      mode === "edit"
      || Boolean(form.summary.trim() || form.description.trim() || form.location.trim() || form.attendeesText.trim()),
    );
  }, [mode, open]);

  if (!open) {
    return null;
  }

  const selectedMembers = emptyMemberSelection(memberIndex, form.memberIds);

  const content = (
    <div className="space-y-5">
      <div className="space-y-2">
        <span className="text-sm font-medium text-slate-900">Members *</span>
        <MemberSearchAutocomplete
          items={memberIndex}
          onQueryChange={(value) => onChange({ ...form, memberQuery: value })}
          onSelect={(member) =>
            onChange(
              applyMemberSelectionToForm(
                form,
                [...new Set([...form.memberIds, member.memberId])],
                memberIndex,
              ),
            )
          }
          placeholder="Search members"
          query={form.memberQuery}
          selectedIds={form.memberIds}
        />
        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Selected</span>
          {selectedMembers.length ? (
            <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-slate-50 p-2">
              {selectedMembers.map((member) => (
                <MemberChip
                  key={member.memberId}
                  member={member}
                  onClick={(memberId) => {
                    onClose();
                    navigate(`/members/${memberId}`);
                  }}
                  onRemove={(memberId) =>
                    onChange(
                      applyMemberSelectionToForm(
                        form,
                        form.memberIds.filter((currentId) => currentId !== memberId),
                        memberIndex,
                      ),
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-slate-500">
              No members selected
            </div>
          )}
        </div>
      </div>

      <label className="space-y-1.5">
        <span className="text-sm font-medium text-slate-900">Calendar</span>
        <Select
          onChange={(event) => onChange({ ...form, calendarId: event.target.value })}
          value={form.calendarId}
        >
          <option value="">Choose a calendar</option>
          {calendars.map((calendar) => (
            <option key={calendar.calendarId} value={calendar.calendarId}>
              {calendar.summary}
            </option>
          ))}
        </Select>
      </label>

      <div className="space-y-3">
        <span className="text-sm font-medium text-slate-900">Start - End</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Start</span>
            <Input
              onChange={(event) => onChange({ ...form, start: event.target.value })}
              type={form.allDay ? "date" : "datetime-local"}
              value={form.start}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">End</span>
            <Input
              onChange={(event) => onChange({ ...form, end: event.target.value })}
              type={form.allDay ? "date" : "datetime-local"}
              value={form.end}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
          <Checkbox checked={form.allDay} onChange={(event) => onChange({ ...form, allDay: event.target.checked })} />
          <span>All Day</span>
        </label>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setDetailsOpen((current) => !current)}
          type="button"
        >
          <span className="text-sm font-medium text-slate-900">Additional Details</span>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
        </button>
        {detailsOpen ? (
          <div className="space-y-3">
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-900">Event Title</span>
              <Input
                onChange={(event) => onChange({ ...form, summary: event.target.value })}
                placeholder="Add an event title"
                value={form.summary}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-900">Location</span>
              <Input onChange={(event) => onChange({ ...form, location: event.target.value })} value={form.location} />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-900">Attendees</span>
              <Input
                onChange={(event) => onChange({ ...form, attendeesText: event.target.value })}
                placeholder="name@example.com, person@example.com"
                value={form.attendeesText}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-900">Description</span>
              <Textarea onChange={(event) => onChange({ ...form, description: event.target.value })} value={form.description} />
            </label>
          </div>
        ) : null}
      </div>

      <div className="h-px bg-border" />
    </div>
  );

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {canDelete ? (
          <Button className="bg-rose-600 hover:bg-rose-700" onClick={onDelete} type="button">
            Delete Event
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button onClick={onClose} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={busy} onClick={onSave} type="button">
          {busy ? "Saving..." : mode === "create" ? "Create Event" : "Save Changes"}
        </Button>
      </div>
    </div>
  );

  if (mobile) {
    return (
      <Dialog onClose={onClose} open={open} title={mode === "create" ? "New Event" : "Edit Event"}>
        <div className="space-y-3">
          {content}
          {footer}
        </div>
      </Dialog>
    );
  }

  return (
    <RightSideDrawer
      footer={footer}
      onClose={onClose}
      open={open}
      title={mode === "create" ? "New Event" : "Edit Event"}
    >
      {content}
    </RightSideDrawer>
  );
};

const CalendarVisibilityList = ({
  calendars,
  activeCalendarIds,
  syncStatusByCalendarId,
  onToggle,
}: {
  calendars: ScheduleCalendar[];
  activeCalendarIds: string[];
  syncStatusByCalendarId: Map<string, ScheduleEventsResponse["calendars"][number]>;
  onToggle: (calendarId: string, checked: boolean) => void;
}) => (
  <div className="space-y-2">
    {calendars.map((calendar) => {
      const visible = activeCalendarIds.includes(calendar.calendarId);
      const sync = syncStatusByCalendarId.get(calendar.calendarId);

      return (
        <label
          className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5"
          key={calendar.calendarId}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Checkbox checked={visible} onChange={(event) => onToggle(calendar.calendarId, event.target.checked)} />
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ backgroundColor: calendar.backgroundColor ?? "#2563eb" }}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{calendar.summary}</p>
              <p className="text-xs text-muted-foreground">
                Last sync {formatDateTime(sync?.lastSyncedAt ?? calendar.sync.lastSyncedAt)}
              </p>
            </div>
          </div>
          <CalendarSourceBadge
            calendar={calendar}
            lastSyncedAt={sync?.lastSyncedAt ?? calendar.sync.lastSyncedAt}
            refreshIntervalMinutes={sync?.refreshIntervalMinutes ?? calendar.sync.refreshIntervalMinutes}
            source={sync?.source ?? calendar.sync.lastSyncSource}
            status={sync?.lastSyncStatus ?? calendar.sync.lastSyncStatus}
          />
        </label>
      );
    })}
  </div>
);

const toFullCalendarEventRange = (event: ScheduleEvent) => {
  if (!event.allDay) {
    return {
      start: event.start,
      end: event.end,
    };
  }

  return {
    start: normalizeAllDayStartValue(event.start),
    end: normalizeAllDayEndValue(event.end),
  };
};

const mergeOverviewWithSyncMetadata = (
  current: ScheduleOverviewResponse | null,
  calendars: ScheduleEventsResponse["calendars"],
): ScheduleOverviewResponse | null => {
  if (!current || !calendars.length) {
    return current;
  }

  const snapshotsById = new Map(calendars.map((calendar) => [calendar.calendarId, calendar]));

  return {
    ...current,
    calendars: current.calendars.map((calendar) => {
      const snapshot = snapshotsById.get(calendar.calendarId);
      if (!snapshot) {
        return calendar;
      }

      return {
        ...calendar,
        sync: {
          ...calendar.sync,
          lastSyncedAt: snapshot.lastSyncedAt,
          lastSyncError: snapshot.lastSyncError,
          lastSyncSource: snapshot.lastSyncSource,
          lastSyncStatus: snapshot.lastSyncStatus,
          refreshIntervalMinutes: snapshot.refreshIntervalMinutes,
          requiresFullSync: snapshot.requiresFullSync,
          syncMode: snapshot.syncMode,
        },
      };
    }),
  };
};

export const SchedulePage = () => {
  const calendarRef = useRef<FullCalendar | null>(null);
  const requestSequenceRef = useRef(0);
  const mobileScrollFrameRef = useRef<number | null>(null);
  const deepLinkedDateRef = useRef<string | null>(null);
  const deepLinkedEventRef = useRef<string | null>(null);
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState<ScheduleOverviewResponse | null>(null);
  const [memberIndex, setMemberIndex] = useState<MemberIndexItem[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [syncMetadata, setSyncMetadata] = useState<ScheduleEventsResponse["calendars"]>([]);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);
  const [syncingVisible, setSyncingVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [form, setForm] = useState<EventFormState>(emptyEventForm());
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  const [rawEvents, setRawEvents] = useState<ScheduleEvent[]>([]);
  const [visibleRange, setVisibleRange] = useState<{ timeMin: string; timeMax: string } | null>(null);
  const [currentView, setCurrentView] = useState("dayGridMonth");
  const [viewTitle, setViewTitle] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const pushToast = useCallback((tone: ToastItem["tone"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setError(null);
    try {
      const response = await api.get<ScheduleOverviewResponse>("/schedule/overview");
      setOverview(response);

      const defaultVisible = response.calendars
        .filter((calendar) => calendar.selected)
        .map((calendar) => calendar.calendarId);

      setVisibleCalendarIds(defaultVisible);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load schedule.");
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadMemberIndex = useCallback(async () => {
    try {
      const response = await api.get<{ items: MemberIndexItem[] }>("/members/index");
      setMemberIndex(response.items);
    } catch {
      setMemberIndex([]);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadMemberIndex();
  }, [loadMemberIndex, loadOverview]);

  const calendars = useMemo(
    () => (overview?.calendars ?? []).filter((calendar) => calendar.selected),
    [overview?.calendars],
  );

  const activeCalendarIds = useMemo(() => {
    const allowedIds = new Set(calendars.map((calendar) => calendar.calendarId));
    return visibleCalendarIds.filter((calendarId) => allowedIds.has(calendarId));
  }, [calendars, visibleCalendarIds]);

  const activeCalendarIdsKey = useMemo(
    () => activeCalendarIds.join(","),
    [activeCalendarIds],
  );

  const availableEditorCalendars = useMemo(
    () => calendars.filter((calendar) => activeCalendarIds.includes(calendar.calendarId)),
    [activeCalendarIds, calendars],
  );

  const defaultCalendarId = useMemo(
    () => activeCalendarIds[0] ?? calendars[0]?.calendarId ?? "",
    [activeCalendarIds, calendars],
  );

  const syncStatusByCalendarId = useMemo(
    () => new Map(syncMetadata.map((item) => [item.calendarId, item])),
    [syncMetadata],
  );

  const toggleCalendarVisibility = useCallback((calendarId: string, checked: boolean) => {
    setVisibleCalendarIds((current) =>
      checked
        ? [...new Set([...current, calendarId])]
        : current.filter((id) => id !== calendarId),
    );
  }, []);

  const applyEventsResponse = useCallback((response: ScheduleEventsResponse) => {
    setRawEvents(response.events);
    setSyncMetadata(response.calendars);
    setLastLoadedAt(response.generatedAt);
    setOverview((current) => mergeOverviewWithSyncMetadata(current, response.calendars));
  }, []);

  const loadEvents = useCallback(async (
    timeMin: string,
    timeMax: string,
    calendarIds: string[],
  ) => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;

    if (!calendarIds.length) {
      setRawEvents([]);
      setSyncMetadata([]);
      setFetchingEvents(false);
      return;
    }

    setFetchingEvents(true);
    setError(null);

    const baseParams = new URLSearchParams({
      timeMin,
      timeMax,
      calendarIds: calendarIds.join(","),
    });

    const cacheParams = new URLSearchParams(baseParams);
    cacheParams.set("cacheOnly", "true");

    const cachePromise = api.get<ScheduleEventsResponse>(`/schedule/events?${cacheParams.toString()}`);
    const refreshPromise = api.get<ScheduleEventsResponse>(`/schedule/events?${baseParams.toString()}`);

    let cacheResolved = false;

    try {
      const cacheResponse = await cachePromise;
      cacheResolved = true;
      if (requestSequenceRef.current === sequence) {
        applyEventsResponse(cacheResponse);
      }
    } catch {
      // Fall through to the refresh-backed request below.
    }

    try {
      const refreshResponse = await refreshPromise;
      if (requestSequenceRef.current === sequence) {
        applyEventsResponse(refreshResponse);
      }
    } catch (reason) {
      if (requestSequenceRef.current !== sequence) {
        return;
      }

      if (!cacheResolved) {
        setRawEvents([]);
      }

      const message = reason instanceof Error ? reason.message : "Unable to load calendar events.";
      setError(message);
      pushToast("error", message);
    } finally {
      if (requestSequenceRef.current === sequence) {
        setFetchingEvents(false);
      }
    }
  }, [applyEventsResponse, pushToast]);

  useEffect(() => {
    if (!visibleRange) {
      return;
    }

    void loadEvents(visibleRange.timeMin, visibleRange.timeMax, activeCalendarIds);
  }, [activeCalendarIdsKey, loadEvents, visibleRange]);

  const calendarEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filteredEvents = !query
      ? rawEvents
      : rawEvents.filter((event) =>
          [event.summary, event.location, event.description, event.calendarName, ...(event.memberNames ?? [])]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(query)),
        );

    return filteredEvents.map<EventInput>((event) => ({
      ...toFullCalendarEventRange(event),
      id: event.eventId,
      title: event.summary,
      allDay: event.allDay,
      backgroundColor: normalizeHexColor(event.calendarColor),
      borderColor: normalizeHexColor(event.calendarColor),
      textColor: getEventTextColor(event.calendarColor),
      extendedProps: { scheduleEvent: event },
    }));
  }, [rawEvents, searchQuery]);

  const openCreateEditor = useCallback((nextForm?: EventFormState) => {
    setEditorMode("create");
    setEditingEvent(null);
    setForm(nextForm ?? emptyEventForm(defaultCalendarId));
    setEditorOpen(true);
  }, [defaultCalendarId]);

  const openEditEditor = useCallback((event: ScheduleEvent) => {
    setEditorMode("edit");
    setEditingEvent(event);
    setForm(eventToFormState(event));
    setEditorOpen(true);
  }, []);

  const clearIntentSearchParams = useCallback((keys: string[]) => {
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;

    keys.forEach((key) => {
      if (nextParams.has(key)) {
        nextParams.delete(key);
        changed = true;
      }
    });

    if (changed) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleDateClick = useCallback((info: DateClickArg) => {
    const end = new Date(info.date);
    if (info.allDay) {
      end.setDate(end.getDate() + 1);
    } else {
      end.setHours(end.getHours() + 1);
    }

    openCreateEditor(createFormFromSelection(info.date, end, info.allDay, defaultCalendarId));
  }, [defaultCalendarId, openCreateEditor]);

  const handleSelect = useCallback((info: DateSelectArg) => {
    openCreateEditor(createFormFromSelection(info.start, info.end, info.allDay, defaultCalendarId));
  }, [defaultCalendarId, openCreateEditor]);

  const handleEventClick = useCallback((info: EventClickArg) => {
    openEditEditor(info.event.extendedProps.scheduleEvent as ScheduleEvent);
  }, [openEditEditor]);

  const renderCalendarEvent = useCallback((info: EventContentArg) => {
    const scheduleEvent = info.event.extendedProps.scheduleEvent as ScheduleEvent;
    const textColor = getEventTextColor(scheduleEvent.calendarColor);
    return (
      <div
        className={`fc-card-event ${info.view.type.startsWith("dayGrid") ? "fc-card-event-compact" : ""}`}
        style={{ color: textColor }}
      >
        <div className="fc-card-event-header">
          <span className="fc-card-event-title">{info.event.title}</span>
          {!scheduleEvent.allDay ? <span className="fc-card-event-time">{info.timeText}</span> : null}
        </div>
        {scheduleEvent.location || scheduleEvent.memberNames?.length ? (
          <div className="fc-card-event-meta">
            <span>{scheduleEvent.location ?? scheduleEvent.memberNames?.join(", ")}</span>
          </div>
        ) : null}
      </div>
    );
  }, []);

  const handleForceSyncVisible = useCallback(async () => {
    if (!activeCalendarIds.length) {
      return;
    }

    const calendarApi = calendarRef.current?.getApi();
    const timeMin = calendarApi?.view.activeStart.toISOString();
    const timeMax = calendarApi?.view.activeEnd.toISOString();

    if (!timeMin || !timeMax) {
      return;
    }

    setSyncingVisible(true);
    try {
      const response = await api.post<ScheduleEventsResponse>("/schedule/sync", {
        calendarIds: activeCalendarIds,
        timeMin,
        timeMax,
      });
      setSyncMetadata(response.calendars);
      setLastLoadedAt(response.generatedAt);
      setRawEvents(response.events);
      setOverview((current) => mergeOverviewWithSyncMetadata(current, response.calendars));
      pushToast("success", "Visible calendars synced from Google.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to sync visible calendars.";
      setError(message);
      pushToast("error", message);
    } finally {
      setSyncingVisible(false);
    }
  }, [activeCalendarIds, pushToast]);

  const handleSaveEvent = useCallback(async () => {
    const startIso = localInputToIso(form.start, form.allDay, "start");
    const endIso = localInputToIso(form.end, form.allDay, "end");

    if (!form.summary.trim()) {
      pushToast("error", "Event title is required.");
      return;
    }

    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      pushToast("error", "End time must be after start time.");
      return;
    }

    setSavingEvent(true);
    try {
      if (editorMode === "create") {
        const payload: CreateScheduleEventInput = {
          calendarId: form.calendarId,
          summary: form.summary,
          description: form.description,
          location: form.location,
          attendees: parseAttendees(form.attendeesText),
          start: startIso,
          end: endIso,
          allDay: form.allDay,
          memberIds: form.memberIds,
        };
        await api.post("/schedule/events", payload);
        pushToast("success", "Event created.");
      } else if (editingEvent) {
        const payload: UpdateScheduleEventInput = {
          calendarId: editingEvent.calendarId,
          summary: form.summary,
          description: form.description,
          location: form.location,
          attendees: parseAttendees(form.attendeesText),
          start: startIso,
          end: endIso,
          allDay: form.allDay,
          memberIds: form.memberIds,
        };
        await api.put(`/schedule/events/${editingEvent.eventId}`, payload);
        pushToast("success", "Event updated.");
      }

      setEditorOpen(false);
      if (searchParams.get("memberId")) {
        setSearchParams({}, { replace: true });
      }
      if (visibleRange) {
        void loadEvents(visibleRange.timeMin, visibleRange.timeMax, activeCalendarIds);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to save event.";
      setError(message);
      pushToast("error", message);
    } finally {
      setSavingEvent(false);
    }
  }, [activeCalendarIds, editingEvent, editorMode, form, loadEvents, pushToast, searchParams, setSearchParams, visibleRange]);

  useEffect(() => {
    const memberId = searchParams.get("memberId");
    if (!memberId || searchParams.get("eventId") || !defaultCalendarId || editorOpen || !memberIndex.length) {
      return;
    }

    openCreateEditor(
      applyMemberSelectionToForm(
        { ...emptyEventForm(defaultCalendarId), summary: VISITATION_TITLE_PREFIX },
        [memberId],
        memberIndex,
      ),
    );
    clearIntentSearchParams(["memberId"]);
  }, [clearIntentSearchParams, defaultCalendarId, editorOpen, memberIndex, openCreateEditor, searchParams]);

  useEffect(() => {
    const eventDate = searchParams.get("date");
    const eventId = searchParams.get("eventId");
    const calendarApi = calendarRef.current?.getApi();

    if (!eventDate || !eventId || !calendarApi || deepLinkedDateRef.current === `${eventId}:${eventDate}`) {
      return;
    }

    calendarApi.gotoDate(eventDate);
    if (isMobile) {
      calendarApi.changeView("timeGridDay", eventDate);
    }
    deepLinkedDateRef.current = `${eventId}:${eventDate}`;
  }, [isMobile, searchParams]);

  useEffect(() => {
    const eventId = searchParams.get("eventId");
    const calendarId = searchParams.get("calendarId");
    if (!eventId || editorOpen || deepLinkedEventRef.current === eventId) {
      return;
    }

    const matchingEvent = rawEvents.find((event) => event.eventId === eventId);
    if (matchingEvent) {
      openEditEditor(matchingEvent);
      deepLinkedEventRef.current = eventId;
      clearIntentSearchParams(["eventId", "date", "calendarId"]);
      return;
    }

    if (!calendarId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const event = await api.get<ScheduleEvent>(
          `/schedule/events/${eventId}?calendarId=${encodeURIComponent(calendarId)}`,
        );
        if (cancelled) {
          return;
        }

        openEditEditor(event);
        deepLinkedEventRef.current = eventId;
        clearIntentSearchParams(["eventId", "date", "calendarId"]);
      } catch (reason) {
        if (cancelled) {
          return;
        }

        const message = reason instanceof Error ? reason.message : "Unable to load event details.";
        setError(message);
        pushToast("error", message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearIntentSearchParams, editorOpen, openEditEditor, pushToast, rawEvents, searchParams]);

  const handleDeleteEvent = useCallback(async () => {
    if (!editingEvent) {
      return;
    }

    setDeletingEvent(true);
    try {
      await api.delete(`/schedule/events/${editingEvent.eventId}?calendarId=${encodeURIComponent(editingEvent.calendarId)}`);
      setDeleteDialogOpen(false);
      setEditorOpen(false);
      if (visibleRange) {
        void loadEvents(visibleRange.timeMin, visibleRange.timeMax, activeCalendarIds);
      }
      pushToast("success", "Event deleted.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to delete event.";
      setError(message);
      pushToast("error", message);
    } finally {
      setDeletingEvent(false);
    }
  }, [activeCalendarIds, editingEvent, loadEvents, pushToast, visibleRange]);

  const handleEventMove = useCallback(async (
    eventId: string,
    calendarId: string,
    start: string,
    end: string,
    allDay: boolean,
  ) => {
    const payload: UpdateScheduleEventInput = { calendarId, start, end, allDay };
    await api.put(`/schedule/events/${eventId}`, payload);
  }, []);

  const getMovedEventBoundary = useCallback((
    value: Date | null,
    fallback: string,
    allDay: boolean,
    boundary: "start" | "end",
  ) => {
    if (!allDay) {
      return value?.toISOString() ?? fallback;
    }

    if (value) {
      return toDateOnlyValue(value);
    }

    const normalizedFallback = boundary === "start"
      ? normalizeAllDayStartValue(fallback)
      : normalizeAllDayEndValue(fallback);

    return normalizedFallback;
  }, []);

  const handleEventDrop = useCallback(async (info: EventDropArg) => {
    const scheduleEvent = info.event.extendedProps.scheduleEvent as ScheduleEvent;
    try {
      await handleEventMove(
        scheduleEvent.eventId,
        scheduleEvent.calendarId,
        getMovedEventBoundary(info.event.start, scheduleEvent.start, info.event.allDay, "start"),
        getMovedEventBoundary(info.event.end, scheduleEvent.end, info.event.allDay, "end"),
        info.event.allDay,
      );
      if (visibleRange) {
        void loadEvents(visibleRange.timeMin, visibleRange.timeMax, activeCalendarIds);
      }
      pushToast("success", "Event moved.");
    } catch (reason) {
      info.revert();
      pushToast("error", reason instanceof Error ? reason.message : "Unable to move event.");
    }
  }, [activeCalendarIds, getMovedEventBoundary, handleEventMove, loadEvents, pushToast, visibleRange]);

  const handleEventResize = useCallback(async (info: EventResizeDoneArg) => {
    const scheduleEvent = info.event.extendedProps.scheduleEvent as ScheduleEvent;
    try {
      await handleEventMove(
        scheduleEvent.eventId,
        scheduleEvent.calendarId,
        getMovedEventBoundary(info.event.start, scheduleEvent.start, info.event.allDay, "start"),
        getMovedEventBoundary(info.event.end, scheduleEvent.end, info.event.allDay, "end"),
        info.event.allDay,
      );
      if (visibleRange) {
        void loadEvents(visibleRange.timeMin, visibleRange.timeMax, activeCalendarIds);
      }
      pushToast("success", "Event duration updated.");
    } catch (reason) {
      info.revert();
      pushToast("error", reason instanceof Error ? reason.message : "Unable to resize event.");
    }
  }, [activeCalendarIds, getMovedEventBoundary, handleEventMove, loadEvents, pushToast, visibleRange]);

  const navigateCalendar = useCallback((direction: "prev" | "next" | "today") => {
    const apiRef = calendarRef.current?.getApi();
    if (!apiRef) {
      return;
    }

    if (direction === "prev") {
      apiRef.prev();
    } else if (direction === "next") {
      apiRef.next();
    } else {
      apiRef.today();
    }

    setCurrentView(apiRef.view.type);
    setViewTitle(apiRef.view.title);
  }, []);

  const changeView = useCallback((view: string) => {
    const apiRef = calendarRef.current?.getApi();
    if (!apiRef) {
      return;
    }

    apiRef.changeView(view);
    setCurrentView(apiRef.view.type);
    setViewTitle(apiRef.view.title);
  }, []);

  const scrollMobileDayViewToCurrentTime = useCallback((viewType: string, viewStart: Date) => {
    if (!isMobile || viewType !== "timeGridDay" || !isSameLocalDay(viewStart, new Date())) {
      return;
    }

    if (mobileScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileScrollFrameRef.current);
    }

    mobileScrollFrameRef.current = window.requestAnimationFrame(() => {
      calendarRef.current?.getApi().scrollToTime(getCurrentScrollTime());
      mobileScrollFrameRef.current = null;
    });
  }, [isMobile]);

  useEffect(() => () => {
    if (mobileScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileScrollFrameRef.current);
    }
  }, []);

  if (!isApiConfigured) {
    return <ErrorState description="Set `VITE_API_BASE_URL` or regenerate `amplify_outputs.json` before using the schedule APIs." title="API not configured" />;
  }

  if (loadingOverview) {
    return <LoadingState description="Loading calendar setup and visible schedule settings." title="Preparing schedule" />;
  }

  if (!overview) {
    return (
      <ErrorState
        action={<Button onClick={() => void loadOverview()} type="button">Retry</Button>}
        description={error ?? "Schedule overview did not load."}
        title="Unable to load schedule"
      />
    );
  }

  const scheduleLoading = syncingVisible || fetchingEvents;

  return (
    <div className="space-y-4">
      <ToastStack toasts={toasts} />

      {!isMobile ? (
        <PageHeader
          className="p-3"
          description="View, search, create, edit, drag, and resize events for the calendars you’ve chosen to display."
          descriptionClassName="text-xs sm:text-sm"
          title="Schedule"
          titleClassName="text-xl"
        >
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center">
            <label className="flex items-center gap-2 rounded-md border border-border bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search events"
                value={searchQuery}
              />
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-slate-50 px-2.5 py-1.5">
              {scheduleLoading ? <RefreshCcw className="h-4 w-4 animate-spin text-primary" /> : null}
              <span className="text-sm text-slate-600">Visible {activeCalendarIds.length}</span>
              <span className="text-xs text-slate-500">
                {scheduleLoading ? "Loading schedule..." : `Updated ${formatDateTime(lastLoadedAt ?? undefined)}`}
              </span>
            </div>
            <Button disabled={scheduleLoading || !activeCalendarIds.length} onClick={() => void handleForceSyncVisible()} type="button">
              <RefreshCcw className={`h-4 w-4 ${scheduleLoading ? "animate-spin" : ""}`} />
              {scheduleLoading ? "Loading..." : "Force Sync Visible"}
            </Button>
            <Button onClick={() => setFiltersOpen(true)} type="button" variant="outline">
              <CalendarDays className="h-4 w-4" />
              Calendars
            </Button>
          </div>
        </PageHeader>
      ) : null}

      {error ? <ErrorState description={error} title="Schedule action failed" /> : null}

      <div>
        <Card className="overflow-hidden">
          <CardContent className="space-y-3 p-2.5 sm:p-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="-mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
                <Button onClick={() => navigateCalendar("today")} size="sm" type="button" variant="outline">Today</Button>
                <Button onClick={() => navigateCalendar("prev")} size="sm" type="button" variant="outline"><ChevronLeft className="h-4 w-4" /></Button>
                <Button onClick={() => navigateCalendar("next")} size="sm" type="button" variant="outline"><ChevronRight className="h-4 w-4" /></Button>
                <div className="ml-1 whitespace-nowrap text-sm font-medium text-slate-900">{viewTitle || "Schedule"}</div>
              </div>
              <div className="-mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
                {[
                  ["dayGridMonth", "Month"],
                  ["timeGridWeek", "Week"],
                  ["timeGridDay", "Day"],
                  ["listWeek", "List"],
                ].map(([viewId, label]) => (
                  <Button
                    key={viewId}
                    onClick={() => changeView(viewId)}
                    size="sm"
                    type="button"
                    variant={currentView === viewId ? "default" : "outline"}
                    >
                      {label}
                    </Button>
                ))}
                {isMobile ? (
                  <>
                    <Button
                      aria-label={scheduleLoading ? "Loading schedule" : "Force sync visible calendars"}
                      className="h-7 w-7 shrink-0"
                      disabled={scheduleLoading || !activeCalendarIds.length}
                      onClick={() => void handleForceSyncVisible()}
                      size="icon"
                      type="button"
                    >
                      <RefreshCcw className={`h-4 w-4 ${scheduleLoading ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      aria-label="Choose visible calendars"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setFiltersOpen(true)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <CalendarDays className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="schedule-calendar-shell">
              <FullCalendar
                key={isMobile ? "mobile-calendar" : "desktop-calendar"}
                ref={calendarRef}
                allDaySlot
                dayMaxEventRows={3}
                editable
                eventDurationEditable
                eventClick={handleEventClick}
                eventContent={renderCalendarEvent}
                eventDrop={handleEventDrop}
                eventMinHeight={isMobile ? 36 : 40}
                eventResizableFromStart
                eventShortHeight={isMobile ? 36 : 40}
                eventStartEditable
                eventResize={handleEventResize}
                events={calendarEvents}
                headerToolbar={false}
                height="auto"
                initialView={isMobile ? "timeGridDay" : "dayGridMonth"}
                nowIndicator
                plugins={fullCalendarPlugins}
                scrollTime="06:00:00"
                selectable
                select={handleSelect}
                slotMaxTime="24:00:00"
                slotMinTime="06:00:00"
                weekends
                dateClick={handleDateClick}
                viewDidMount={(info) => {
                  setCurrentView(info.view.type);
                  setViewTitle(info.view.title);
                  scrollMobileDayViewToCurrentTime(info.view.type, info.view.currentStart);
                }}
                datesSet={(info) => {
                  setCurrentView(info.view.type);
                  setViewTitle(info.view.title);
                  setVisibleRange({
                    timeMin: info.view.activeStart.toISOString(),
                    timeMax: info.view.activeEnd.toISOString(),
                  });
                  scrollMobileDayViewToCurrentTime(info.view.type, info.view.currentStart);
                }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                {scheduleLoading ? (
                  <RefreshCcw className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <CalendarDays className="h-4 w-4" />
                )}
                <span>
                  {syncingVisible
                    ? "Syncing visible calendars with Google..."
                    : fetchingEvents
                      ? "Refreshing current view..."
                      : "Events load only for the visible date range and visible calendars."}
                </span>
              </div>
              {!isMobile ? (
                <Button onClick={() => openCreateEditor(emptyEventForm(defaultCalendarId))} type="button" variant="outline">
                  <Plus className="h-4 w-4" />
                  New Event
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {isMobile ? (
        <button
          className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg"
          onClick={() => openCreateEditor(emptyEventForm(defaultCalendarId))}
          type="button"
        >
          <Plus className="h-5 w-5" />
        </button>
      ) : null}

      <EventEditor
        busy={savingEvent}
        calendars={availableEditorCalendars}
        canDelete={editorMode === "edit"}
        form={form}
        memberIndex={memberIndex}
        mobile={isMobile}
        mode={editorMode}
        onChange={setForm}
        onClose={() => setEditorOpen(false)}
        onDelete={() => setDeleteDialogOpen(true)}
        onSave={() => void handleSaveEvent()}
        open={editorOpen}
      />

      {isMobile ? (
        <Dialog
          description="Choose which configured calendars are visible in this schedule view."
          onClose={() => setFiltersOpen(false)}
          open={filtersOpen}
          title="Visible Calendars"
        >
          <CalendarVisibilityList
            activeCalendarIds={activeCalendarIds}
            calendars={calendars}
            onToggle={toggleCalendarVisibility}
            syncStatusByCalendarId={syncStatusByCalendarId}
          />
        </Dialog>
      ) : (
        <RightSideDrawer
          description="Choose which configured calendars are visible in this schedule view."
          onClose={() => setFiltersOpen(false)}
          open={filtersOpen}
          title="Visible Calendars"
        >
          <CalendarVisibilityList
            activeCalendarIds={activeCalendarIds}
            calendars={calendars}
            onToggle={toggleCalendarVisibility}
            syncStatusByCalendarId={syncStatusByCalendarId}
          />
        </RightSideDrawer>
      )}

      <ConfirmDialog
        busy={deletingEvent}
        confirmLabel="Delete Event"
        description="This deletes the event in Google Calendar and removes it from the local cache."
        destructive
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => void handleDeleteEvent()}
        open={deleteDialogOpen}
        title="Delete Event"
      />
    </div>
  );
};
