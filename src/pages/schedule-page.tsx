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
  Mail,
  MapPin,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Users,
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
const QUARTER_HOUR_MINUTES = 15;

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

const buildOptionalEventFields = (form: EventFormState) => {
  const attendees = parseAttendees(form.attendeesText);
  const description = form.description.trim();
  const location = form.location.trim();

  return {
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(attendees.length ? { attendees } : {}),
    ...(form.memberIds.length ? { memberIds: form.memberIds } : {}),
  };
};

const getSelectedMemberNames = (memberIds: string[], memberIndex: MemberIndexItem[]) =>
  emptyMemberSelection(memberIndex, memberIds)
    .map((member) => member.fullName)
    .filter(Boolean);

const isVisitationSummary = (value: string) => {
  const normalized = value.trim();
  return normalized === "Visitation" || normalized.startsWith(VISITATION_TITLE_PREFIX.trim());
};

const buildVisitationSummary = (memberIds: string[], memberIndex: MemberIndexItem[]) => {
  const memberNames = getSelectedMemberNames(memberIds, memberIndex);

  return memberNames.length ? `${VISITATION_TITLE_PREFIX}${memberNames.join(", ")}` : "Visitation";
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
  const previousFirstMember = emptyMemberSelection(memberIndex, currentForm.memberIds)[0];
  const nextSelectedMembers = emptyMemberSelection(memberIndex, nextMemberIds);
  const nextFirstMember = nextSelectedMembers[0];

  return {
    ...currentForm,
    summary:
      !currentForm.summary.trim() || isVisitationSummary(currentForm.summary)
        ? buildVisitationSummary(nextMemberIds, memberIndex)
        : currentForm.summary,
    description:
      !currentForm.description.trim() || isVisitationDescription(currentForm.description)
        ? buildVisitationDescription(nextMemberIds, memberIndex)
        : currentForm.description,
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
  start: allDay ? toDateOnlyValue(startValue) : toLocalDateTimeInputFromDate(snapDateToQuarterHour(startValue)),
  end: allDay ? shiftDateOnlyValue(toDateOnlyValue(endValue), -1) : toLocalDateTimeInputFromDate(snapDateToQuarterHour(endValue)),
  allDay,
  memberIds: [],
  memberQuery: "",
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
    summary: memberName ? `${VISITATION_TITLE_PREFIX}${memberName}` : "Visitation",
    description: memberName ? `Members: ${memberName}` : "",
    location: memberAddress,
    attendeesText: memberEmail,
    memberIds: [memberId],
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
  const sectionCardClassName = "space-y-3 rounded-[1.2rem] border border-slate-200/80 bg-white/96 p-3 shadow-[0_14px_32px_rgba(15,23,42,0.05)] backdrop-blur sm:p-3.5";
  const fieldClassName = "h-10 rounded-xl border-slate-200 bg-white px-3 text-sm shadow-sm shadow-slate-200/35 transition focus:border-primary focus:ring-primary/10";
  const allDayLabel = form.allDay ? "All-day event" : "Specific start and end time";

  const content = (
    <div className="space-y-3">
      <section className={sectionCardClassName}>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-slate-950">
            <Users className="h-4 w-4 text-primary" />
            <h4 className="text-lg font-semibold tracking-tight">Members</h4>
          </div>
          <p className="text-sm text-slate-500">Add one or more members to this event.</p>
        </div>
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
          placeholder="Search members..."
          query={form.memberQuery}
          selectedIds={form.memberIds}
        />
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-500">Selected ({selectedMembers.length})</div>
          {selectedMembers.length ? (
            <div className="flex flex-wrap gap-1.5">
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
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-500">
              No members selected yet.
            </div>
          )}
        </div>
      </section>

      <section className={sectionCardClassName}>
        <label className="space-y-1.5">
          <span className="text-lg font-semibold tracking-tight text-slate-950">Calendar</span>
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
          <span className="text-lg font-semibold tracking-tight text-slate-950">Event Title</span>
          <div className="relative">
            <FileText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
          <div className="flex items-center gap-2 text-slate-950">
            <Clock3 className="h-4 w-4 text-primary" />
            <h4 className="text-lg font-semibold tracking-tight">Start &amp; End</h4>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="space-y-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm shadow-slate-200/35">
            <span className="text-sm font-medium text-slate-500">Start</span>
            <div className="relative">
              <Clock3 className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-7 border-0 bg-transparent px-0 pl-7 text-sm shadow-none focus:border-0 focus:ring-0"
                onChange={(event) => onChange({
                  ...form,
                  start: form.allDay ? event.target.value : snapDateTimeInputToQuarterHour(event.target.value),
                })}
                step={form.allDay ? undefined : 900}
                type={form.allDay ? "date" : "datetime-local"}
                value={form.start}
              />
            </div>
          </label>
          <label className="space-y-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm shadow-slate-200/35">
            <span className="text-sm font-medium text-slate-500">End</span>
            <div className="relative">
              <Clock3 className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-7 border-0 bg-transparent px-0 pl-7 text-sm shadow-none focus:border-0 focus:ring-0"
                onChange={(event) => onChange({
                  ...form,
                  end: form.allDay ? event.target.value : snapDateTimeInputToQuarterHour(event.target.value),
                })}
                step={form.allDay ? undefined : 900}
                type={form.allDay ? "date" : "datetime-local"}
                value={form.end}
              />
            </div>
          </label>
        </div>
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-900">
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

      <section className="rounded-[1.2rem] border border-slate-200/80 bg-white/96 shadow-[0_14px_32px_rgba(15,23,42,0.05)] backdrop-blur">
        <button
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left sm:px-3.5"
          onClick={() => setDetailsOpen((current) => !current)}
          type="button"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <AlignLeft className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold tracking-tight text-slate-950">Additional Details</div>
              <div className="text-[13px] text-slate-500">Add location, notes or more information.</div>
            </div>
          </div>
          <ChevronDown className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
        </button>
        {detailsOpen ? (
          <div className="space-y-2.5 border-t border-slate-200/80 px-3 pb-3 pt-3 sm:px-3.5 sm:pb-3.5">
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-900">Location</span>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className={`${fieldClassName} pl-10`}
                  onChange={(event) => onChange({ ...form, location: event.target.value })}
                  value={form.location}
                />
              </div>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-900">Attendees</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className={`${fieldClassName} pl-10`}
                  onChange={(event) => onChange({ ...form, attendeesText: event.target.value })}
                  placeholder="name@example.com, person@example.com"
                  value={form.attendeesText}
                />
              </div>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-slate-900">Description</span>
              <Textarea
                className="min-h-20 rounded-xl border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm shadow-slate-200/35 focus:border-primary focus:ring-primary/10"
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
      contentClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] px-2 py-2.5 sm:px-3 sm:py-3"
      footer={footer}
      footerClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] px-2 py-2.5 sm:px-3"
      headerClassName="border-b border-slate-200/80 bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)] px-2 py-2.5 sm:px-3"
      headerLeading={(
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] bg-[linear-gradient(180deg,#eef4ff_0%,#f6f9ff_100%)] text-primary shadow-inner">
          <CalendarDays className="h-6 w-6" />
        </div>
      )}
      onClose={onClose}
      open={open}
      panelClassName="bg-[linear-gradient(180deg,#f7faff_0%,#f3f7fd_100%)]"
      description={editorDescription}
      descriptionClassName="text-xs text-slate-500 sm:text-sm"
      title={editorTitle}
      titleClassName="text-2xl font-semibold tracking-tight text-slate-950"
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
