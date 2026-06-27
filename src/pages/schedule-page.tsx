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
  AlignLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  List,
  Mail,
  MapPin,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  User,
  Users,
} from "lucide-react";
import type { JSX, MutableRefObject, TouchEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type {
  CreateScheduleEventInput,
  MemberIndexItem,
  ScheduleCalendar,
  ScheduleEvent,
  ScheduleEventsResponse,
  ScheduleOverviewResponse,
  UpdateScheduleEventInput,
  VisitationType,
} from "../../shared/types";
import { visitationTypes } from "../../shared/types";
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
import { useMembersIndex } from "../lib/members-index";
import {
  MOBILE_SCHEDULE_MODE_EVENT,
  MOBILE_SCHEDULE_MODE_PARAM,
  MOBILE_SCHEDULE_MODE_STORAGE_KEY,
  normalizeMobileScheduleMode,
  readStoredMobileScheduleMode,
  writeStoredMobileScheduleMode,
} from "../lib/schedule-mobile-mode";
import {
  CalendarSourceBadge,
  formatDateTime,
  ToastItem,
  ToastStack,
  useIsMobile,
} from "./calendar-shared";

type EditorMode = "create" | "edit";
type MobileBetaTab = "list" | "day";

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
  visitationType: VisitationType;
};

const fullCalendarPlugins = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];

const FALLBACK_EVENT_COLOR = "#2563eb";
const QUARTER_HOUR_MINUTES = 15;
const MOBILE_BETA_SLOT_MINUTES = 30;
const MOBILE_BETA_DAY_START_HOUR = 6;
const MOBILE_BETA_DAY_END_HOUR = 24;
const MOBILE_BETA_TAB_STORAGE_KEY = "schedule-beta-mobile-tab";
const EVENT_DURATION_PRESETS = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hr", minutes: 60 },
  { label: "1.5 hr", minutes: 90 },
  { label: "2 hr", minutes: 120 },
] as const;
const DEFAULT_VISITATION_TYPE: VisitationType = "Visitation";

const clampSyncProgress = (value: number) => Math.max(0, Math.min(100, value));

const SyncProgressCalendarIcon = ({
  className,
  progress,
}: {
  className?: string;
  progress: number;
}) => {
  const clampedProgress = clampSyncProgress(progress);

  return (
    <span
      aria-hidden="true"
      aria-valuenow={Math.round(clampedProgress)}
      className={`schedule-sync-progress-icon ${className ?? ""}`}
    >
      <CalendarDays className="schedule-sync-progress-icon-base" />
      <span
        className="schedule-sync-progress-icon-overlay"
        style={{ clipPath: `inset(${100 - clampedProgress}% 0 0 0)` }}
      >
        <CalendarDays className="schedule-sync-progress-icon-fill" />
      </span>
    </span>
  );
};

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

const addDays = (date: Date, days: number) => {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfWeekMonday = (date: Date) => {
  const start = startOfLocalDay(date);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
};

const getWeekForDate = (date: Date) => {
  const start = startOfWeekMonday(date);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const end = days[6]!;
  const endExclusive = addDays(end, 1);

  return { start, end, endExclusive, days };
};

const isSameLocalDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

const isDateWithinDay = (value: Date, date: Date) => {
  const dayStart = startOfLocalDay(date);
  const dayEnd = addDays(dayStart, 1);
  return value >= dayStart && value < dayEnd;
};

const getCurrentScrollTime = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}:00`;
};

const formatWeekRange = (start: Date, end: Date) => {
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "short" });
  const dayFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric" });
  const startMonth = monthFormatter.format(start);
  const endMonth = monthFormatter.format(end);

  if (startMonth === endMonth) {
    return `${startMonth} ${dayFormatter.format(start)} - ${dayFormatter.format(end)}`;
  }

  return `${startMonth} ${dayFormatter.format(start)} - ${endMonth} ${dayFormatter.format(end)}`;
};

const formatSelectedDayHeading = (date: Date) =>
  new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
  }).format(date);

const formatWeekdayShort = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).replace(".", "").toUpperCase();

const formatWeekdayNarrow = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(date);

const formatEventTimeRange = (event: ScheduleEvent) => {
  if (event.allDay) {
    return "All day";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${formatter.format(new Date(event.start))} - ${formatter.format(new Date(event.end))}`;
};

const getMemberAttachmentCount = (event: ScheduleEvent) => event.memberIds?.length ?? 0;

const getMemberAttachmentIcon = (event: ScheduleEvent) => {
  const memberCount = getMemberAttachmentCount(event);

  if (memberCount === 1) {
    return User;
  }

  if (memberCount > 1) {
    return Users;
  }

  return null;
};

const getEventDateRange = (event: ScheduleEvent) => ({
  start: event.allDay
    ? parseDateOnlyValue(normalizeAllDayStartValue(event.start))
    : new Date(event.start),
  end: event.allDay
    ? parseDateOnlyValue(normalizeAllDayEndValue(event.end))
    : new Date(event.end),
});

const getEventsForDay = (events: ScheduleEvent[], date: Date) => {
  const dayStart = startOfLocalDay(date);
  const dayEnd = addDays(dayStart, 1);

  return events.filter((event) => {
    const { start: eventStart, end: eventEnd } = getEventDateRange(event);

    return eventStart < dayEnd && eventEnd > dayStart;
  });
};

const sortEventsByStartTime = (events: ScheduleEvent[]) =>
  [...events].sort((left, right) => getEventDateRange(left).start.getTime() - getEventDateRange(right).start.getTime());

const getAvailableTimeSlots = (
  events: ScheduleEvent[],
  date: Date,
  {
    dayStartHour = MOBILE_BETA_DAY_START_HOUR,
    dayEndHour = MOBILE_BETA_DAY_END_HOUR,
    stepMinutes = MOBILE_BETA_SLOT_MINUTES,
  }: {
    dayStartHour?: number;
    dayEndHour?: number;
    stepMinutes?: number;
  } = {},
) => {
  const dayStart = startOfLocalDay(date);
  const firstSlot = new Date(dayStart);
  firstSlot.setHours(dayStartHour, 0, 0, 0);
  const lastSlot = new Date(dayStart);
  lastSlot.setHours(dayEndHour, 0, 0, 0);
  const now = new Date();
  const slots: Date[] = [];

  for (let cursor = new Date(firstSlot); cursor < lastSlot; cursor.setMinutes(cursor.getMinutes() + stepMinutes)) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor);
    slotEnd.setMinutes(slotEnd.getMinutes() + stepMinutes);

    if (isSameLocalDay(slotStart, now) && slotStart < now) {
      continue;
    }

    const blocked = events.some((event) => {
      const { start: eventStart, end: eventEnd } = getEventDateRange(event);

      return slotStart < eventEnd && slotEnd > eventStart;
    });

    if (!blocked) {
      slots.push(slotStart);
    }
  }

  return slots;
};

const formatAvailableSlot = (date: Date) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

const getDayFromCalendarClick = (date: Date) => snapDateToQuarterHour(date);

const buildMonthGrid = (month: Date) => {
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstGridDate = startOfWeekMonday(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(firstGridDate, index));
};

const getMonthPickerMonths = (selectedDate: Date, monthsBefore = 4, monthsAfter = 8) =>
  Array.from({ length: monthsBefore + monthsAfter + 1 }, (_, index) => {
    const monthOffset = index - monthsBefore;
    return new Date(selectedDate.getFullYear(), selectedDate.getMonth() + monthOffset, 1);
  });

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

const toLocalDateTimeInputFromDate = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
};

const parseLocalDateTimeInput = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes] = match;
  const date = new Date(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hours, 10),
    Number.parseInt(minutes, 10),
    0,
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateWithLocalOffset = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffsetMinutes / 60)).padStart(2, "0");
  const offsetRemainderMinutes = String(absoluteOffsetMinutes % 60).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainderMinutes}`;
};

const snapDateToQuarterHour = (date: Date, mode: "floor" | "ceil" | "nearest" = "nearest") => {
  const snapped = new Date(date);
  snapped.setSeconds(0, 0);

  const minutes = snapped.getMinutes();
  const remainder = minutes % QUARTER_HOUR_MINUTES;

  if (remainder === 0) {
    return snapped;
  }

  if (mode === "floor") {
    snapped.setMinutes(minutes - remainder);
    return snapped;
  }

  if (mode === "ceil") {
    snapped.setMinutes(minutes + (QUARTER_HOUR_MINUTES - remainder));
    return snapped;
  }

  snapped.setMinutes(
    remainder < QUARTER_HOUR_MINUTES / 2
      ? minutes - remainder
      : minutes + (QUARTER_HOUR_MINUTES - remainder),
  );
  return snapped;
};

const snapDateTimeInputToQuarterHour = (value: string, mode: "floor" | "ceil" | "nearest" = "nearest") => {
  const parsed = parseLocalDateTimeInput(value);
  return parsed ? toLocalDateTimeInputFromDate(snapDateToQuarterHour(parsed, mode)) : value;
};

const updateLocalDateTimeInputDate = (value: string, nextDate: string) => {
  const time = /^\d{2}:\d{2}$/.test(value.slice(11, 16)) ? value.slice(11, 16) : "09:00";
  return snapDateTimeInputToQuarterHour(`${nextDate}T${time}`);
};

const updateLocalDateTimeInputTime = (value: string, nextTime: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) ? value.slice(0, 10) : toDateOnlyValue(new Date());
  return snapDateTimeInputToQuarterHour(`${date}T${nextTime}`);
};

const localInputToIso = (value: string, allDay: boolean, boundary: "start" | "end") => {
  if (allDay) {
    return boundary === "start" ? value : shiftDateOnlyValue(value, 1);
  }

  const parsed = parseLocalDateTimeInput(value);
  return parsed ? formatDateWithLocalOffset(parsed) : "";
};

const parseAttendees = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeVisitationType = (value: string | undefined): VisitationType =>
  visitationTypes.includes(value as VisitationType) ? value as VisitationType : DEFAULT_VISITATION_TYPE;

const buildOptionalEventFields = (form: EventFormState) => {
  const attendees = parseAttendees(form.attendeesText);
  const description = form.description.trim();
  const location = form.location.trim();

  return {
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(attendees.length ? { attendees } : {}),
    ...(form.memberIds.length ? { memberIds: form.memberIds } : {}),
    ...(form.memberIds.length ? { type: normalizeVisitationType(form.visitationType) } : {}),
  };
};

const getSelectedMemberNames = (memberIds: string[], memberIndex: MemberIndexItem[]) =>
  emptyMemberSelection(memberIndex, memberIds)
    .map((member) => member.fullName)
    .filter(Boolean);

const getSelectedMemberEmails = (memberIds: string[], memberIndex: MemberIndexItem[]) =>
  emptyMemberSelection(memberIndex, memberIds)
    .map((member) => member.email?.trim() ?? "")
    .filter(Boolean);

const isVisitationSummary = (value: string) => {
  const normalized = value.trim();
  return visitationTypes.some((type) => normalized === type || normalized.startsWith(`${type}: `));
};

const buildVisitationSummary = (
  memberIds: string[],
  memberIndex: MemberIndexItem[],
  visitationType: VisitationType = DEFAULT_VISITATION_TYPE,
) => {
  const memberNames = getSelectedMemberNames(memberIds, memberIndex);

  return memberNames.length ? `${visitationType}: ${memberNames.join(", ")}` : visitationType;
};

const isVisitationDescription = (value: string) => value.trim().startsWith("Members:");

const buildVisitationDescription = (memberIds: string[], memberIndex: MemberIndexItem[]) => {
  const memberNames = getSelectedMemberNames(memberIds, memberIndex);
  return memberNames.length ? `Members: ${memberNames.join(", ")}` : "";
};

const applyMemberSelectionToForm = (
  currentForm: EventFormState,
  nextMemberIds: string[],
  memberIndex: MemberIndexItem[],
): EventFormState => {
  const hadMembers = currentForm.memberIds.length > 0;
  const hasMembers = nextMemberIds.length > 0;
  const nextVisitationType = hasMembers
    ? (hadMembers ? normalizeVisitationType(currentForm.visitationType) : DEFAULT_VISITATION_TYPE)
    : DEFAULT_VISITATION_TYPE;
  const previousMemberEmails = new Set(getSelectedMemberEmails(currentForm.memberIds, memberIndex));
  const nextMemberEmails = getSelectedMemberEmails(nextMemberIds, memberIndex);
  const manualAttendees = parseAttendees(currentForm.attendeesText).filter((email) => !previousMemberEmails.has(email));
  const attendeesText = [...new Set([...nextMemberEmails, ...manualAttendees])].join(", ");

  return {
    ...currentForm,
    summary:
      !currentForm.summary.trim() || isVisitationSummary(currentForm.summary)
        ? buildVisitationSummary(nextMemberIds, memberIndex, nextVisitationType)
        : currentForm.summary,
    description:
      !currentForm.description.trim() || isVisitationDescription(currentForm.description)
        ? buildVisitationDescription(nextMemberIds, memberIndex)
        : currentForm.description,
    location: currentForm.location,
    attendeesText,
    memberIds: nextMemberIds,
    memberQuery: "",
    visitationType: nextVisitationType,
  };
};

const applyVisitationTypeToForm = (
  currentForm: EventFormState,
  nextVisitationType: VisitationType,
  memberIndex: MemberIndexItem[],
): EventFormState => ({
  ...currentForm,
  summary:
    !currentForm.summary.trim() || isVisitationSummary(currentForm.summary)
      ? buildVisitationSummary(currentForm.memberIds, memberIndex, nextVisitationType)
      : currentForm.summary,
  visitationType: nextVisitationType,
});

const emptyEventForm = (calendarId = ""): EventFormState => {
  const start = snapDateToQuarterHour(new Date(), "ceil");
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    calendarId,
    summary: "",
    description: "",
    location: "",
    attendeesText: "",
    start: toLocalDateTimeInputFromDate(start),
    end: toLocalDateTimeInputFromDate(end),
    allDay: false,
    memberIds: [],
    memberQuery: "",
    visitationType: DEFAULT_VISITATION_TYPE,
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
  visitationType: event.memberIds?.length ? normalizeVisitationType(event.visitationType) : DEFAULT_VISITATION_TYPE,
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
  start: allDay ? toDateOnlyValue(startValue) : toLocalDateTimeInputFromDate(snapDateToQuarterHour(startValue)),
  end: allDay ? shiftDateOnlyValue(toDateOnlyValue(endValue), -1) : toLocalDateTimeInputFromDate(snapDateToQuarterHour(endValue)),
  allDay,
  memberIds: [],
  memberQuery: "",
  visitationType: DEFAULT_VISITATION_TYPE,
});

const createIntentFormFromSearchParams = (
  searchParams: URLSearchParams,
  calendarId: string,
  memberIndex: MemberIndexItem[],
) => {
  const memberId = searchParams.get("memberId");
  if (!memberId) {
    return null;
  }

  const memberName = searchParams.get("memberName")?.trim() ?? "";
  const memberEmail = searchParams.get("memberEmail")?.trim() ?? "";
  const memberAddress = searchParams.get("memberAddress")?.trim() ?? "";
  const baseForm: EventFormState = {
    ...emptyEventForm(calendarId),
    summary: memberName ? `${DEFAULT_VISITATION_TYPE}: ${memberName}` : DEFAULT_VISITATION_TYPE,
    description: memberName ? `Members: ${memberName}` : "",
    location: memberAddress,
    attendeesText: memberEmail,
    memberIds: [memberId],
    visitationType: DEFAULT_VISITATION_TYPE,
  };

  return memberIndex.length
    ? applyMemberSelectionToForm(baseForm, [memberId], memberIndex)
    : baseForm;
};

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
  const editorTitle = mode === "create" ? "New Event" : "Edit Event";
  const editorDescription = mode === "create" ? "Create a new calendar event." : "Update the calendar event details.";
  const primaryActionLabel = mode === "create" ? "Create Event" : "Save Changes";
  const sectionCardClassName = "space-y-3 rounded-[1.2rem] border border-border/80 bg-card/96 p-3 shadow-[0_14px_32px_rgba(15,23,42,0.05)] backdrop-blur dark:shadow-[0_14px_32px_rgba(0,0,0,0.24)] sm:p-3.5";
  const fieldClassName = "h-10 rounded-xl border-border bg-card px-3 text-sm shadow-sm shadow-slate-200/35 transition focus:border-primary focus:ring-primary/10 dark:shadow-black/20";

  const applyDurationPreset = (minutes: number) => {
    const startDate = parseLocalDateTimeInput(form.start);
    if (!startDate) {
      return;
    }

    const nextEnd = new Date(startDate);
    nextEnd.setMinutes(nextEnd.getMinutes() + minutes);
    onChange({ ...form, end: toLocalDateTimeInputFromDate(nextEnd) });
  };

  const selectedDurationMinutes = (() => {
    if (form.allDay) {
      return null;
    }

    const startDate = parseLocalDateTimeInput(form.start);
    const endDate = parseLocalDateTimeInput(form.end);
    if (!startDate || !endDate) {
      return null;
    }

    const diffMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    return diffMinutes > 0 ? diffMinutes : null;
  })();

  const content = (
    <div className="space-y-3">
      <section className={sectionCardClassName}>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-foreground">
            <Users className="h-4 w-4 text-primary" />
            <h4 className="text-lg font-semibold tracking-tight">Members</h4>
          </div>
          <p className="text-sm text-muted-foreground">Add one or more members to this event.</p>
        </div>
        <MemberSearchAutocomplete
          items={memberIndex}
          maxResults={24}
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
          placeholder="Search members..."
          query={form.memberQuery}
          selectedIds={form.memberIds}
        />
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-muted-foreground">Selected ({selectedMembers.length})</div>
          {selectedMembers.length ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedMembers.map((member) => (
                <MemberChip
                  key={member.memberId}
                  member={member}
                  onClick={(memberId) => navigate(`/members/${memberId}`)}
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
            <div className="rounded-xl border border-dashed border-border bg-muted/35 px-3 py-2.5 text-sm text-muted-foreground">
              No members selected yet.
            </div>
          )}
        </div>
        {selectedMembers.length ? (
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Activity Type</span>
            <Select
              className={fieldClassName}
              onChange={(event) => onChange(applyVisitationTypeToForm(form, normalizeVisitationType(event.target.value), memberIndex))}
              value={normalizeVisitationType(form.visitationType)}
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
          <span className="text-lg font-semibold tracking-tight text-foreground">Calendar</span>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-primary" />
            <Select
              className={`${fieldClassName} pl-10`}
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
          </div>
        </label>
      </section>

      <section className={sectionCardClassName}>
        <label className="space-y-1.5">
          <span className="text-lg font-semibold tracking-tight text-foreground">Event Title</span>
          <div className="relative">
            <FileText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className={`${fieldClassName} pl-10`}
              onChange={(event) => onChange({ ...form, summary: event.target.value })}
              placeholder="Add an event title"
              value={form.summary}
            />
          </div>
        </label>
      </section>

      <section className={sectionCardClassName}>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-foreground">
            <Clock3 className="h-4 w-4 text-primary" />
            <h4 className="text-lg font-semibold tracking-tight">Start &amp; End</h4>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 rounded-xl border border-border bg-card px-2.5 py-2 shadow-sm shadow-slate-200/35 dark:shadow-black/20">
            <span className="text-sm font-medium text-muted-foreground">Start</span>
            {form.allDay ? (
              <div className="relative">
                <Clock3 className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-7 border-0 bg-transparent px-0 pl-7 text-sm shadow-none focus:border-0 focus:ring-0"
                  onChange={(event) => onChange({ ...form, start: event.target.value })}
                  type="date"
                  value={form.start}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Clock3 className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-7 border-0 bg-transparent px-0 pl-7 text-sm shadow-none focus:border-0 focus:ring-0"
                    onChange={(event) => onChange({ ...form, start: updateLocalDateTimeInputDate(form.start, event.target.value) })}
                    type="date"
                    value={form.start.slice(0, 10)}
                  />
                </div>
                <Input
                  className="h-8 rounded-lg border-border/80 bg-muted/20 px-2.5 text-sm shadow-none"
                  onChange={(event) => onChange({ ...form, start: updateLocalDateTimeInputTime(form.start, event.target.value) })}
                  step={900}
                  type="time"
                  value={form.start.slice(11, 16)}
                />
              </div>
            )}
          </label>
          <label className="space-y-1 rounded-xl border border-border bg-card px-2.5 py-2 shadow-sm shadow-slate-200/35 dark:shadow-black/20">
            <span className="text-sm font-medium text-muted-foreground">End</span>
            {form.allDay ? (
              <div className="relative">
                <Clock3 className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-7 border-0 bg-transparent px-0 pl-7 text-sm shadow-none focus:border-0 focus:ring-0"
                  onChange={(event) => onChange({ ...form, end: event.target.value })}
                  type="date"
                  value={form.end}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Clock3 className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-7 border-0 bg-transparent px-0 pl-7 text-sm shadow-none focus:border-0 focus:ring-0"
                    onChange={(event) => onChange({ ...form, end: updateLocalDateTimeInputDate(form.end, event.target.value) })}
                    type="date"
                    value={form.end.slice(0, 10)}
                  />
                </div>
                <Input
                  className="h-8 rounded-lg border-border/80 bg-muted/20 px-2.5 text-sm shadow-none"
                  onChange={(event) => onChange({ ...form, end: updateLocalDateTimeInputTime(form.end, event.target.value) })}
                  step={900}
                  type="time"
                  value={form.end.slice(11, 16)}
                />
              </div>
            )}
          </label>
        </div>
        {!form.allDay ? (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Duration</div>
            <div className="grid grid-cols-5 gap-1.5">
              {EVENT_DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.minutes}
                  className={`schedule-beta-slot-pill min-h-0 px-2 py-1 text-[0.7rem] ${
                    selectedDurationMinutes === preset.minutes ? "schedule-beta-slot-pill-active" : ""
                  }`}
                  onClick={() => applyDurationPreset(preset.minutes)}
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <label className="flex items-center gap-2.5 text-sm font-medium text-foreground">
          <Checkbox
            checked={form.allDay}
            className="h-5 w-5 rounded-[0.45rem] border-slate-300"
            onChange={(event) => {
              const nextAllDay = event.target.checked;
              const nextStart = nextAllDay
                ? form.start.slice(0, 10)
                : snapDateTimeInputToQuarterHour(`${form.start.slice(0, 10)}T09:00`, "nearest");
              const nextEnd = nextAllDay
                ? form.end.slice(0, 10)
                : snapDateTimeInputToQuarterHour(`${form.end.slice(0, 10)}T10:00`, "nearest");

              onChange({
                ...form,
                allDay: nextAllDay,
                start: nextAllDay ? nextStart : nextStart,
                end: nextAllDay ? nextEnd : nextEnd,
              });
            }}
          />
          <span>All Day</span>
        </label>
      </section>

      <section className="rounded-[1.2rem] border border-border/80 bg-card/96 shadow-[0_14px_32px_rgba(15,23,42,0.05)] backdrop-blur dark:shadow-[0_14px_32px_rgba(0,0,0,0.24)]">
        <button
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left sm:px-3.5"
          onClick={() => setDetailsOpen((current) => !current)}
          type="button"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/55 text-muted-foreground">
              <AlignLeft className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold tracking-tight text-foreground">Additional Details</div>
              <div className="text-[13px] text-muted-foreground">Add location, notes or more information.</div>
            </div>
          </div>
          <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
        </button>
        {detailsOpen ? (
          <div className="space-y-2.5 border-t border-border/80 px-3 pb-3 pt-3 sm:px-3.5 sm:pb-3.5">
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">Location</span>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className={`${fieldClassName} pl-10`}
                  onChange={(event) => onChange({ ...form, location: event.target.value })}
                  value={form.location}
                />
              </div>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">Attendees</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className={`${fieldClassName} pl-10`}
                  onChange={(event) => onChange({ ...form, attendeesText: event.target.value })}
                  placeholder="name@example.com, person@example.com"
                  value={form.attendeesText}
                />
              </div>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">Description</span>
              <Textarea
                className="min-h-20 rounded-xl border-border bg-card px-3 py-2.5 text-sm shadow-sm shadow-slate-200/35 focus:border-primary focus:ring-primary/10 dark:shadow-black/20"
                onChange={(event) => onChange({ ...form, description: event.target.value })}
                value={form.description}
              />
            </label>
          </div>
        ) : null}
      </section>
    </div>
  );

  const footer = (
    <div className="space-y-2.5">
      <Button className="h-11 w-full rounded-xl text-sm font-semibold shadow-[0_14px_26px_rgba(37,99,235,0.24)]" disabled={busy} onClick={onSave} type="button">
        <CalendarDays className="h-4 w-4" />
        {busy ? "Saving..." : primaryActionLabel}
      </Button>
      <Button className="h-11 w-full rounded-xl text-sm font-semibold" onClick={onClose} type="button" variant="outline">
        Cancel
      </Button>
      <div className="min-h-8">
        {canDelete ? (
          <Button className="h-10 rounded-xl bg-rose-600 px-4 text-sm hover:bg-rose-700" onClick={onDelete} type="button">
            Delete Event
          </Button>
        ) : null}
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
      contentClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] dark:bg-[linear-gradient(180deg,#09111f_0%,#0b1422_100%)] px-2 py-2.5 sm:px-3 sm:py-3"
      footer={footer}
      footerClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] dark:bg-[linear-gradient(180deg,#09111f_0%,#0b1422_100%)] px-2 py-2.5 sm:px-3"
      headerClassName="border-b border-slate-200/80 bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] dark:border-border/80 dark:bg-[linear-gradient(180deg,#09111f_0%,#0b1422_100%)] px-2 py-2.5 sm:px-3"
      headerLeading={(
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] bg-[linear-gradient(180deg,#eef4ff_0%,#f6f9ff_100%)] text-primary shadow-inner">
          <CalendarDays className="h-6 w-6" />
        </div>
      )}
      onClose={onClose}
      open={open}
      panelClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] dark:bg-[linear-gradient(180deg,#09111f_0%,#0b1422_100%)]"
      description={editorDescription}
      descriptionClassName="text-xs text-muted-foreground sm:text-sm"
      title={editorTitle}
      titleClassName="text-2xl font-semibold tracking-tight text-foreground"
      width="lg"
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
              <p className="truncate text-sm font-medium text-foreground">{calendar.summary}</p>
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

const MobileMonthPicker = ({
  open,
  selectedDate,
  onClose,
  onSelectDate,
}: {
  open: boolean;
  selectedDate: Date;
  onClose: () => void;
  onSelectDate: (date: Date) => void;
}) => {
  const months = useMemo(() => getMonthPickerMonths(selectedDate), [selectedDate]);
  const selectedMonthKey = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}`;
  const today = new Date();
  const selectedDayRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.requestAnimationFrame(() => {
      selectedDayRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
    });
  }, [open, selectedDate]);

  return (
    <Dialog onClose={onClose} open={open} size="lg" title="Choose a day">
      <div className="space-y-5">
        {months.map((month) => {
          const monthKey = `${month.getFullYear()}-${month.getMonth()}`;
          const days = buildMonthGrid(month);

          return (
            <section key={monthKey}>
              <div className="mb-2 text-sm font-semibold text-foreground">
                {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {Array.from({ length: 7 }, (_, index) => formatWeekdayNarrow(addDays(startOfWeekMonday(month), index))).map((label, index) => (
                  <div key={`${monthKey}-${index}`}>{label}</div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {days.map((day) => {
                  const isCurrentMonth = day.getMonth() === month.getMonth();
                  const isToday = isSameLocalDay(day, today);
                  const isSelected = isSameLocalDay(day, selectedDate);

                  return (
                    <button
                      className={`schedule-beta-month-day ${isSelected ? "schedule-beta-month-day-selected" : ""} ${isToday ? "schedule-beta-month-day-today" : ""} ${isCurrentMonth ? "" : "schedule-beta-month-day-muted"}`}
                      key={`${monthKey}-${toDateOnlyValue(day)}`}
                      onClick={() => onSelectDate(day)}
                      ref={isSelected ? selectedDayRef : null}
                      type="button"
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
              {selectedMonthKey === monthKey ? <div className="mt-2 text-xs text-muted-foreground">Selected week updates after you choose a day.</div> : null}
            </section>
          );
        })}
      </div>
    </Dialog>
  );
};

const ScheduleBetaMobileView = ({
  activeCalendarIds,
  calendarEvents,
  calendarRef,
  currentTab,
  dayEvents,
  defaultCalendarId,
  onChangeTab,
  onDateClick,
  onOpenEvent,
  onNewEvent,
  onOpenAvailableTimes,
  onOpenMonthPicker,
  onSelectDay,
  onSelectSlot,
  onSwipeDay,
  onToggleCalendars,
  onForceSyncVisible,
  renderCalendarEvent,
  scheduleLoading,
  syncProgress,
  selectedDate,
  weekDays,
}: {
  activeCalendarIds: string[];
  calendarEvents: EventInput[];
  calendarRef: MutableRefObject<FullCalendar | null>;
  currentTab: MobileBetaTab;
  dayEvents: ScheduleEvent[];
  defaultCalendarId: string;
  onChangeTab: (tab: MobileBetaTab) => void;
  onDateClick: (info: DateClickArg) => void;
  onOpenEvent: (event: ScheduleEvent) => void;
  onNewEvent: () => void;
  onOpenAvailableTimes: () => void;
  onOpenMonthPicker: () => void;
  onSelectDay: (value: string) => void;
  onSelectSlot: (date: Date) => void;
  onSwipeDay: (direction: "prev" | "next") => void;
  onToggleCalendars: () => void;
  onForceSyncVisible: () => void;
  renderCalendarEvent: (info: EventContentArg) => JSX.Element;
  scheduleLoading: boolean;
  syncProgress: number;
  selectedDate: Date;
  weekDays: Date[];
}) => {
  const availableSlots = useMemo(() => getAvailableTimeSlots(dayEvents, selectedDate), [dayEvents, selectedDate]);
  const selectedDateValue = toDateOnlyValue(selectedDate);
  const weekLabel = formatWeekRange(weekDays[0]!, weekDays[6]!);
  const today = new Date();
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;

    if (!start || !touch) {
      return;
    }

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) {
      return;
    }

    onSwipeDay(deltaX < 0 ? "next" : "prev");
  };

  return (
    <div className="space-y-4">
      <div className="schedule-beta-mobile-shell">
        <div className="flex items-center justify-between gap-2">
          <Button onClick={() => onSwipeDay("prev")} size="icon" type="button" variant="outline">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button className="schedule-beta-week-trigger" onClick={onOpenMonthPicker} type="button">
            <span>{weekLabel}</span>
            <ChevronDown className="h-4 w-4" />
          </button>
          <Button onClick={() => onSwipeDay("next")} size="icon" type="button" variant="outline">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="schedule-beta-day-strip">
          {weekDays.map((day) => {
            const value = toDateOnlyValue(day);
            const isSelected = value === selectedDateValue;
            const isToday = isSameLocalDay(day, today);

            return (
              <button
                className={`schedule-beta-day-pill ${isSelected ? "schedule-beta-day-pill-selected" : ""}`}
                key={value}
                onClick={() => onSelectDay(value)}
                type="button"
              >
                <span className="schedule-beta-day-pill-label">{formatWeekdayShort(day)}</span>
                <span className="schedule-beta-day-pill-circle">
                  <span className="schedule-beta-day-pill-date">{day.getDate()}</span>
                </span>
                <span className={`schedule-beta-day-pill-indicator ${isToday ? "schedule-beta-day-pill-indicator-active" : ""}`} />
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2">
          <button
            className={`schedule-beta-tab ${currentTab === "list" ? "schedule-beta-tab-active" : ""}`}
            onClick={() => onChangeTab("list")}
            type="button"
          >
            <List className="h-4 w-4" />
            List
          </button>
          <button
            className={`schedule-beta-tab ${currentTab === "day" ? "schedule-beta-tab-active" : ""}`}
            onClick={() => onChangeTab("day")}
            type="button"
          >
            <CalendarDays className="h-4 w-4" />
            Calendar
          </button>
          <Button
            aria-label={scheduleLoading ? "Loading schedule" : "Force sync visible calendars"}
            className="h-10 w-10"
            disabled={scheduleLoading || !activeCalendarIds.length}
            onClick={onForceSyncVisible}
            size="icon"
            type="button"
            variant="outline"
          >
            <RefreshCcw className="h-4 w-4" />
          </Button>
          <Button
            aria-label="Choose visible calendars"
            className="h-10 w-10"
            onClick={onToggleCalendars}
            size="icon"
            type="button"
            variant="outline"
          >
            <SyncProgressCalendarIcon className="h-4 w-4" progress={syncProgress} />
          </Button>
        </div>
      </div>

      <div onTouchEnd={handleTouchEnd} onTouchStart={handleTouchStart}>
        {currentTab === "list" ? (
          <div className="space-y-4">
            <Card className="border-border/80 shadow-[0_18px_45px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_45px_rgba(0,0,0,0.32)]">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-foreground">{formatSelectedDayHeading(selectedDate)}</div>
                    <div className="text-sm text-muted-foreground">
                      {isDateWithinDay(selectedDate, today) ? "Today’s events and openings" : "Scheduled events and openings"}
                    </div>
                  </div>
                  <Button className="h-9 rounded-full px-3 text-sm" onClick={onNewEvent} type="button">
                    <Plus className="h-4 w-4" />
                    Event
                  </Button>
                </div>

                <div className="space-y-2.5">
                  {dayEvents.length ? dayEvents.map((event) => (
                    <button
                      className="schedule-beta-event-card"
                      key={event.eventId}
                      onClick={() => onOpenEvent(event)}
                      type="button"
                    >
                      <span
                        className="mt-1 h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: normalizeHexColor(event.calendarColor) }}
                      />
                      <div className="min-w-0 flex-1 pr-2 text-left">
                        <div className="truncate text-sm font-semibold text-foreground">{event.summary}</div>
                        <div className="text-sm text-muted-foreground">{formatEventTimeRange(event)}</div>
                      </div>
                      {(() => {
                        const MemberAttachmentIcon = getMemberAttachmentIcon(event);
                        return MemberAttachmentIcon ? (
                          <MemberAttachmentIcon
                            aria-hidden="true"
                            className="h-5 w-5 shrink-0 self-center text-slate-500"
                          />
                        ) : null;
                      })()}
                    </button>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-border bg-muted/35 px-4 py-5 text-sm text-muted-foreground">
                      No events scheduled for this day.
                    </div>
                  )}
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Available Times</div>
                      <div className="text-sm text-muted-foreground">Tap a slot to prefill a new event.</div>
                    </div>
                    <Button onClick={onOpenAvailableTimes} size="sm" type="button" variant="outline">
                      View All
                    </Button>
                  </div>

                  <div className="schedule-beta-slot-grid">
                    {availableSlots.length ? availableSlots.slice(0, 8).map((slot) => (
                      <button
                        className="schedule-beta-slot-pill"
                        key={slot.toISOString()}
                        onClick={() => onSelectSlot(slot)}
                        type="button"
                      >
                        {formatAvailableSlot(slot)}
                      </button>
                    )) : (
                      <div className="text-sm text-muted-foreground">No open slots within the current working window.</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div>
            <Card className="overflow-hidden border-border/80 shadow-[0_18px_45px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_45px_rgba(0,0,0,0.32)]">
              <CardContent className="space-y-3 p-2.5">
                <div className="px-1 pt-1 text-sm text-muted-foreground">
                  Tap any empty time to create an event. Existing events remain editable.
                </div>
                <div className="schedule-calendar-shell schedule-beta-day-calendar">
                  <FullCalendar
                    key={`beta-day-${selectedDateValue}`}
                    ref={calendarRef}
                    allDaySlot
                    dateClick={onDateClick}
                    editable={false}
                    eventClick={(info) => onOpenEvent(info.event.extendedProps.scheduleEvent as ScheduleEvent)}
                    eventContent={renderCalendarEvent}
                    eventDurationEditable={false}
                    eventMinHeight={40}
                    eventResizableFromStart={false}
                    eventShortHeight={40}
                    eventStartEditable={false}
                    events={calendarEvents}
                    headerToolbar={false}
                    height="auto"
                    initialDate={selectedDateValue}
                    initialView="timeGridDay"
                    nowIndicator
                    plugins={fullCalendarPlugins}
                    scrollTime="06:00:00"
                    select={(info) => onSelectSlot(getDayFromCalendarClick(info.start))}
                    selectable
                    slotDuration="00:15:00"
                    slotMaxTime="24:00:00"
                    slotMinTime="06:00:00"
                    weekends
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {defaultCalendarId ? null : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No visible calendar is selected yet. Choose a calendar before creating new events.
        </div>
      )}
    </div>
  );
};

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

const ScheduleExperiencePage = () => {
  const calendarRef = useRef<FullCalendar | null>(null);
  const requestSequenceRef = useRef(0);
  const mobileScrollFrameRef = useRef<number | null>(null);
  const deepLinkedDateRef = useRef<string | null>(null);
  const deepLinkedEventRef = useRef<string | null>(null);
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileScheduleMode, setMobileScheduleMode] = useState(() =>
    normalizeMobileScheduleMode(searchParams.get(MOBILE_SCHEDULE_MODE_PARAM)) ?? readStoredMobileScheduleMode(),
  );
  const useBetaMobileExperience = isMobile && mobileScheduleMode === "beta";
  const [overview, setOverview] = useState<ScheduleOverviewResponse | null>(null);
  const { items: memberIndex } = useMembersIndex();
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [syncMetadata, setSyncMetadata] = useState<ScheduleEventsResponse["calendars"]>([]);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);
  const [syncingVisible, setSyncingVisible] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
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
  const [selectedDateValue, setSelectedDateValue] = useState(() => searchParams.get("date") ?? toDateOnlyValue(new Date()));
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthPickerReturnTab, setMonthPickerReturnTab] = useState<MobileBetaTab>("list");
  const [newEventDialogOpen, setNewEventDialogOpen] = useState(false);
  const [availableTimesDialogOpen, setAvailableTimesDialogOpen] = useState(false);
  const [mobileBetaTab, setMobileBetaTab] = useState<MobileBetaTab>(() => {
    if (typeof window === "undefined") {
      return "list";
    }

    const stored = window.localStorage.getItem(MOBILE_BETA_TAB_STORAGE_KEY);
    return stored === "day" ? "day" : "list";
  });
  const progressIntervalRef = useRef<number | null>(null);

  const clearSyncProgressTimer = useCallback(() => {
    if (progressIntervalRef.current !== null) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  const startSyncProgress = useCallback(() => {
    clearSyncProgressTimer();
    setSyncProgress(0);
    progressIntervalRef.current = window.setInterval(() => {
      setSyncProgress((current) => {
        if (current >= 82) {
          return current;
        }
        if (current < 18) {
          return current + 8;
        }
        if (current < 42) {
          return current + 5;
        }
        if (current < 64) {
          return current + 3;
        }
        return current + 1;
      });
    }, 220);
  }, [clearSyncProgressTimer]);

  const finishSyncProgress = useCallback((success: boolean) => {
    clearSyncProgressTimer();
    setSyncProgress(success ? 100 : 0);
  }, [clearSyncProgressTimer]);

  useEffect(() => () => {
    clearSyncProgressTimer();
  }, [clearSyncProgressTimer]);

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

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const calendars = useMemo(
    () => (overview?.calendars ?? []).filter((calendar) => calendar.selected),
    [overview?.calendars],
  );
  const selectedDate = useMemo(() => parseDateOnlyValue(selectedDateValue), [selectedDateValue]);
  const selectedWeek = useMemo(() => getWeekForDate(selectedDate), [selectedDate]);
  const selectedDayEvents = useMemo(
    () => sortEventsByStartTime(getEventsForDay(rawEvents, selectedDate)),
    [rawEvents, selectedDate],
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

  useEffect(() => {
    if (!useBetaMobileExperience || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(MOBILE_BETA_TAB_STORAGE_KEY, mobileBetaTab);
  }, [mobileBetaTab, useBetaMobileExperience]);

  useEffect(() => {
    if (!useBetaMobileExperience) {
      return;
    }

    setVisibleRange({
      timeMin: selectedWeek.start.toISOString(),
      timeMax: selectedWeek.endExclusive.toISOString(),
    });
    setCurrentView(mobileBetaTab === "day" ? "timeGridDay" : "betaList");
    setViewTitle(formatWeekRange(selectedWeek.start, selectedWeek.end));
  }, [mobileBetaTab, selectedWeek, useBetaMobileExperience]);

  useEffect(() => {
    writeStoredMobileScheduleMode(mobileScheduleMode);
  }, [mobileScheduleMode]);

  useEffect(() => {
    const modeFromQuery = normalizeMobileScheduleMode(searchParams.get(MOBILE_SCHEDULE_MODE_PARAM));
    if (modeFromQuery) {
      setMobileScheduleMode(modeFromQuery);
      return;
    }

    setMobileScheduleMode(readStoredMobileScheduleMode());
  }, [searchParams]);

  useEffect(() => {
    const handleModeEvent = (event: Event) => {
      const nextMode = normalizeMobileScheduleMode((event as CustomEvent<string>).detail);
      if (nextMode) {
        setMobileScheduleMode(nextMode);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== MOBILE_SCHEDULE_MODE_STORAGE_KEY) {
        return;
      }

      const nextMode = normalizeMobileScheduleMode(event.newValue);
      if (nextMode) {
        setMobileScheduleMode(nextMode);
      }
    };

    window.addEventListener(MOBILE_SCHEDULE_MODE_EVENT, handleModeEvent);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(MOBILE_SCHEDULE_MODE_EVENT, handleModeEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

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
      finishSyncProgress(false);
      return;
    }

    setFetchingEvents(true);
    setError(null);
    startSyncProgress();

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
    let refreshSucceeded = false;

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
        refreshSucceeded = true;
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
        finishSyncProgress(refreshSucceeded);
      }
    }
  }, [applyEventsResponse, finishSyncProgress, pushToast, startSyncProgress]);

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
    setNewEventDialogOpen(false);
    setAvailableTimesDialogOpen(false);
    setEditorOpen(true);
  }, [defaultCalendarId]);

  const openEditEditor = useCallback((event: ScheduleEvent) => {
    setEditorMode("edit");
    setEditingEvent(event);
    setForm(eventToFormState(event));
    setNewEventDialogOpen(false);
    setAvailableTimesDialogOpen(false);
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

  const clearMobileViewSearchParam = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (!nextParams.has(MOBILE_SCHEDULE_MODE_PARAM)) {
      return;
    }

    nextParams.delete(MOBILE_SCHEDULE_MODE_PARAM);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const openCreateEditorForDate = useCallback((date: Date, durationMinutes = 60) => {
    const start = getDayFromCalendarClick(date);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + durationMinutes);
    openCreateEditor(createFormFromSelection(start, end, false, defaultCalendarId));
  }, [defaultCalendarId, openCreateEditor]);

  const handleDateClick = useCallback((info: DateClickArg) => {
    if (useBetaMobileExperience) {
      openCreateEditorForDate(info.date);
      return;
    }

    const end = new Date(info.date);
    if (info.allDay) {
      end.setDate(end.getDate() + 1);
    } else {
      end.setHours(end.getHours() + 1);
    }

    openCreateEditor(createFormFromSelection(info.date, end, info.allDay, defaultCalendarId));
  }, [defaultCalendarId, openCreateEditor, openCreateEditorForDate, useBetaMobileExperience]);

  const handleSelect = useCallback((info: DateSelectArg) => {
    if (useBetaMobileExperience) {
      openCreateEditorForDate(info.start);
      return;
    }

    openCreateEditor(createFormFromSelection(info.start, info.end, info.allDay, defaultCalendarId));
  }, [defaultCalendarId, openCreateEditor, openCreateEditorForDate, useBetaMobileExperience]);

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
    const timeMin = calendarApi?.view.activeStart.toISOString() ?? visibleRange?.timeMin ?? selectedWeek.start.toISOString();
    const timeMax = calendarApi?.view.activeEnd.toISOString() ?? visibleRange?.timeMax ?? selectedWeek.endExclusive.toISOString();

    if (!timeMin || !timeMax) {
      return;
    }

    setSyncingVisible(true);
    startSyncProgress();
    let syncSucceeded = false;
    try {
      const response = await api.post<ScheduleEventsResponse>("/schedule/sync", {
        calendarIds: activeCalendarIds,
        timeMin,
        timeMax,
      });
      syncSucceeded = true;
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
      finishSyncProgress(syncSucceeded);
    }
  }, [activeCalendarIds, finishSyncProgress, pushToast, selectedWeek, startSyncProgress, visibleRange]);

  const handleSaveEvent = useCallback(async () => {
    const startIso = localInputToIso(form.start, form.allDay, "start");
    const endIso = localInputToIso(form.end, form.allDay, "end");

    if (!form.summary.trim()) {
      pushToast("error", "Event title is required.");
      return;
    }

    if (!startIso || !endIso) {
      pushToast("error", "Choose a valid start and end time.");
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
          start: startIso,
          end: endIso,
          allDay: form.allDay,
          ...buildOptionalEventFields(form),
        };
        await api.post("/schedule/events", payload);
        pushToast("success", "Event created.");
      } else if (editingEvent) {
        const payload: UpdateScheduleEventInput = {
          calendarId: editingEvent.calendarId,
          summary: form.summary,
          start: startIso,
          end: endIso,
          allDay: form.allDay,
          ...buildOptionalEventFields(form),
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
    if (!memberId || searchParams.get("eventId") || !defaultCalendarId || editorOpen) {
      return;
    }

    const nextForm = createIntentFormFromSearchParams(searchParams, defaultCalendarId, memberIndex);
    if (!nextForm) {
      return;
    }

    openCreateEditor(nextForm);
    clearIntentSearchParams(["memberId", "memberName", "memberEmail", "memberAddress"]);
  }, [clearIntentSearchParams, defaultCalendarId, editorOpen, memberIndex, openCreateEditor, searchParams]);

  useEffect(() => {
    if (!isMobile || editorOpen || searchParams.get("mobileAction") !== "new-event") {
      return;
    }

    if (useBetaMobileExperience) {
      setNewEventDialogOpen(true);
    } else {
      openCreateEditor(emptyEventForm(defaultCalendarId));
    }
    clearIntentSearchParams(["mobileAction"]);
  }, [clearIntentSearchParams, defaultCalendarId, editorOpen, isMobile, openCreateEditor, searchParams, useBetaMobileExperience]);

  useEffect(() => {
    const eventDate = searchParams.get("date");
    const eventId = searchParams.get("eventId");
    const calendarApi = calendarRef.current?.getApi();

    if (!eventDate || !eventId || deepLinkedDateRef.current === `${eventId}:${eventDate}`) {
      return;
    }

    if (useBetaMobileExperience) {
      setSelectedDateValue(eventDate);
      deepLinkedDateRef.current = `${eventId}:${eventDate}`;
      return;
    }

    if (!calendarApi) {
      return;
    }

    calendarApi.gotoDate(eventDate);
    if (isMobile) {
      calendarApi.changeView("timeGridDay", eventDate);
    }
    deepLinkedDateRef.current = `${eventId}:${eventDate}`;
  }, [isMobile, searchParams, useBetaMobileExperience]);

  useEffect(() => {
    if (!isMobile) {
      clearMobileViewSearchParam();
    }
  }, [clearMobileViewSearchParam, isMobile]);

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
  const pageTitle = "Schedule";

  return (
    <div className="space-y-4">
      <ToastStack toasts={toasts} />

      {!isMobile ? (
        <PageHeader
          className="p-3"
          title={pageTitle}
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

      {useBetaMobileExperience ? (
        <ScheduleBetaMobileView
          activeCalendarIds={activeCalendarIds}
          calendarEvents={calendarEvents}
          calendarRef={calendarRef}
          currentTab={mobileBetaTab}
          dayEvents={selectedDayEvents}
          defaultCalendarId={defaultCalendarId}
          onChangeTab={setMobileBetaTab}
          onDateClick={handleDateClick}
          onOpenEvent={openEditEditor}
          onForceSyncVisible={() => void handleForceSyncVisible()}
          onNewEvent={() => setNewEventDialogOpen(true)}
          onOpenAvailableTimes={() => setAvailableTimesDialogOpen(true)}
          onOpenMonthPicker={() => {
            setMonthPickerReturnTab(mobileBetaTab);
            setMonthPickerOpen(true);
          }}
          onSelectDay={setSelectedDateValue}
          onSelectSlot={openCreateEditorForDate}
          onSwipeDay={(direction) => setSelectedDateValue((current) => shiftDateOnlyValue(current, direction === "next" ? 1 : -1))}
          onToggleCalendars={() => setFiltersOpen(true)}
          renderCalendarEvent={renderCalendarEvent}
          scheduleLoading={scheduleLoading}
          syncProgress={syncProgress}
          selectedDate={selectedDate}
          weekDays={selectedWeek.days}
        />
      ) : (
        <>
          <div>
            <Card className="overflow-hidden">
              <CardContent className="space-y-3 p-2.5 sm:p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="-mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
                    <Button onClick={() => navigateCalendar("today")} size="sm" type="button" variant="outline">Today</Button>
                    <Button onClick={() => navigateCalendar("prev")} size="sm" type="button" variant="outline"><ChevronLeft className="h-4 w-4" /></Button>
                    <Button onClick={() => navigateCalendar("next")} size="sm" type="button" variant="outline"><ChevronRight className="h-4 w-4" /></Button>
                    <div className="ml-1 whitespace-nowrap text-sm font-medium text-slate-900">{viewTitle || pageTitle}</div>
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
                    slotDuration="00:15:00"
                    scrollTime="06:00:00"
                    selectable
                    select={handleSelect}
                    snapDuration="00:15:00"
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
                    {scheduleLoading ? <RefreshCcw className="h-4 w-4 animate-spin text-primary" /> : <CalendarDays className="h-4 w-4" />}
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
        </>
      )}

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

      {useBetaMobileExperience ? (
        <>
          <MobileMonthPicker
            onClose={() => setMonthPickerOpen(false)}
            onSelectDate={(date) => {
              setSelectedDateValue(toDateOnlyValue(date));
              setMobileBetaTab(monthPickerReturnTab);
              setMonthPickerOpen(false);
            }}
            open={monthPickerOpen}
            selectedDate={selectedDate}
          />
          <Dialog
            description="Choose how you want to place the new event."
            onClose={() => setNewEventDialogOpen(false)}
            open={newEventDialogOpen}
            title="Add Event"
          >
            <div className="space-y-2">
              <button
                className="schedule-beta-action-card"
                onClick={() => {
                  setNewEventDialogOpen(false);
                  setAvailableTimesDialogOpen(true);
                }}
                type="button"
              >
                <Clock3 className="h-5 w-5 text-primary" />
                <div className="text-left">
                  <div className="font-semibold text-foreground">Available Times</div>
                  <div className="text-sm text-muted-foreground">Pick from open slots for the selected day.</div>
                </div>
              </button>
              <button
                className="schedule-beta-action-card"
                onClick={() => {
                  setNewEventDialogOpen(false);
                  setMobileBetaTab("day");
                }}
                type="button"
              >
                <CalendarDays className="h-5 w-5 text-primary" />
                <div className="text-left">
                  <div className="font-semibold text-foreground">Calendar</div>
                  <div className="text-sm text-muted-foreground">Tap an empty time directly on the day timeline.</div>
                </div>
              </button>
            </div>
          </Dialog>
          <Dialog
            description={`Available openings for ${formatSelectedDayHeading(selectedDate)}.`}
            onClose={() => setAvailableTimesDialogOpen(false)}
            open={availableTimesDialogOpen}
            title="Available Times"
          >
            <div className="schedule-beta-slot-grid">
              {getAvailableTimeSlots(selectedDayEvents, selectedDate).length ? getAvailableTimeSlots(selectedDayEvents, selectedDate).map((slot) => (
                <button
                  className="schedule-beta-slot-pill"
                  key={slot.toISOString()}
                  onClick={() => openCreateEditorForDate(slot)}
                  type="button"
                >
                  {formatAvailableSlot(slot)}
                </button>
              )) : (
                <div className="text-sm text-muted-foreground">No open slots are available for this day.</div>
              )}
            </div>
          </Dialog>
        </>
      ) : null}

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

export const SchedulePage = () => <ScheduleExperiencePage />;

export const LegacyScheduleBetaRedirectPage = () => {
  const location = useLocation();

  return <Navigate replace to={{ pathname: "/calendar/schedule", search: location.search }} />;
};
