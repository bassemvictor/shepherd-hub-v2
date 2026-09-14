import { Copy, ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AppointmentTypeDateOverride,
  BookingTimeRange,
  PublicAppointmentType,
  PublicBookingProfile,
  SaveBookingSettingsInput,
  ScheduleCalendar,
  ScheduleOverviewResponse,
} from "../../shared/types";
import { PageHeader } from "../components/common/page-header";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { api, getDisplayErrorMessage, isApiConfigured } from "../lib/api";

type BookingSettingsResponse = { profile: PublicBookingProfile | null };
type Day = keyof NonNullable<PublicAppointmentType["weeklyAvailability"]>;
const days: Array<{ key: Day; label: string }> = [
  { key: "monday", label: "Monday" }, { key: "tuesday", label: "Tuesday" }, { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" }, { key: "friday", label: "Friday" }, { key: "saturday", label: "Saturday" }, { key: "sunday", label: "Sunday" },
];
const timeOptions = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4); const minute = (index % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});
const durationOptions = Array.from({ length: 16 }, (_, index) => (index + 1) * 15);
const defaultDraft = (): SaveBookingSettingsInput => ({
  enabled: false, slug: "", displayName: "", introduction: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto",
  startIntervalMinutes: 30, bookingCalendarId: "", conflictCalendarIds: [], minimumNoticeMinutes: 60, maximumBookingDays: 90,
  globalDateOverrides: [], appointmentTypes: [],
});
const profileToDraft = (profile: PublicBookingProfile | null): SaveBookingSettingsInput => profile ? ({
  enabled: profile.enabled, slug: profile.slug, displayName: profile.displayName, introduction: profile.introduction ?? "", timezone: profile.timezone,
  startIntervalMinutes: profile.startIntervalMinutes, bookingCalendarId: profile.bookingCalendarId ?? "", conflictCalendarIds: profile.conflictCalendarIds,
  minimumNoticeMinutes: profile.minimumNoticeMinutes, maximumBookingDays: profile.maximumBookingDays, globalDateOverrides: profile.globalDateOverrides, appointmentTypes: profile.appointmentTypes,
}) : defaultDraft();
const newAppointmentType = (): PublicAppointmentType => ({
  id: globalThis.crypto?.randomUUID?.() ?? `appointment-${Date.now()}`, name: "New appointment", enabled: true,
  allowedDurationsMinutes: [30], defaultDurationMinutes: 30, weeklyAvailability: {}, dateOverrides: [],
});
const setRanges = (type: PublicAppointmentType, day: Day, ranges: BookingTimeRange[]): PublicAppointmentType => ({
  ...type, weeklyAvailability: { ...type.weeklyAvailability, ...(ranges.length ? { [day]: ranges } : { [day]: undefined }) },
});
const formatDuration = (duration: number) => `${duration} min`;

export const BookingSettingsPage = () => {
  const [draft, setDraft] = useState<SaveBookingSettingsInput>(defaultDraft);
  const [saved, setSaved] = useState<SaveBookingSettingsInput>(defaultDraft);
  const [overview, setOverview] = useState<ScheduleOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [settings, schedule] = await Promise.all([
        api.get<BookingSettingsResponse>("/booking-settings"), api.get<ScheduleOverviewResponse>("/schedule/overview"),
      ]);
      const next = profileToDraft(settings.profile); setDraft(next); setSaved(next); setOverview(schedule);
    } catch (reason) { setError(getDisplayErrorMessage(reason, "Unable to load public booking settings.")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const calendars = overview?.calendars ?? [];
  const publicUrl = useMemo(() => draft.slug.trim() ? `${window.location.origin}/book/${draft.slug.trim().toLowerCase()}` : "", [draft.slug]);
  const enabledTypes = draft.appointmentTypes.filter((type) => type.enabled);
  const canEnable = Boolean(
    draft.displayName.trim() && /^[a-z0-9-]{3,64}$/.test(draft.slug.trim().toLowerCase()) && draft.timezone.trim() &&
    overview?.connection && draft.bookingCalendarId && enabledTypes.length &&
    enabledTypes.some((type) => Object.values(type.weeklyAvailability).some((ranges) => ranges?.length)),
  );
  const updateType = (id: string, update: (type: PublicAppointmentType) => PublicAppointmentType) =>
    setDraft((current) => ({ ...current, appointmentTypes: current.appointmentTypes.map((type) => type.id === id ? update(type) : type) }));
  const save = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await api.put<BookingSettingsResponse>("/booking-settings", { ...draft, slug: draft.slug.trim().toLowerCase() });
      const next = profileToDraft(response.profile); setDraft(next); setSaved(next); setNotice("Public booking settings saved.");
    } catch (reason) { setError(getDisplayErrorMessage(reason, "Unable to save public booking settings.")); }
    finally { setSaving(false); }
  };
  const copyLink = async () => { try { await navigator.clipboard.writeText(publicUrl); setNotice("Public link copied."); } catch { setError("Unable to copy the link. Please copy it manually."); } };

  if (!isApiConfigured) return <ErrorState title="API not configured" description="Set `VITE_API_BASE_URL` or regenerate `amplify_outputs.json` before configuring public booking." />;
  if (loading) return <LoadingState title="Preparing public booking settings" description="Loading your profile and Google Calendar configuration." />;
  if (!overview) return <ErrorState title="Unable to load public booking settings" description={error ?? "Try again."} action={<Button onClick={() => void load()} type="button">Retry</Button>} />;

  return <div className="space-y-4">
    <PageHeader title="Public Booking" description="Configure the appointment types and calendar rules for your future public booking page.">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={draft.enabled ? "success" : "neutral"}>{draft.enabled ? "Public booking enabled" : "Not enabled"}</Badge>
        <Button disabled={saving || JSON.stringify(draft) === JSON.stringify(saved)} onClick={() => void save()} type="button"><Save className="h-4 w-4" />{saving ? "Saving..." : "Save settings"}</Button>
      </div>
    </PageHeader>
    {error ? <ErrorState title="Booking settings action failed" description={error} /> : null}
    {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div> : null}

    <Card><CardHeader><div><CardTitle>Public page</CardTitle><CardDescription>Only this page’s public URL will be shared later; no anonymous booking route is enabled in this step.</CardDescription></div></CardHeader><CardContent className="grid gap-3 lg:grid-cols-2">
      <label className="flex items-center gap-2 rounded-md border border-border p-3"><Checkbox checked={draft.enabled} disabled={!draft.enabled && !canEnable} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span><span className="block text-sm font-medium">Enable Public Booking</span><span className="text-xs text-muted-foreground">{canEnable ? "Ready to enable." : "Complete the required calendar and appointment type settings first."}</span></span></label>
      <label className="space-y-1"><span className="text-sm font-medium">Public display name</span><Input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} /></label>
      <label className="space-y-1 lg:col-span-2"><span className="text-sm font-medium">Introduction</span><Textarea value={draft.introduction ?? ""} onChange={(e) => setDraft({ ...draft, introduction: e.target.value })} /></label>
      <label className="space-y-1"><span className="text-sm font-medium">Public slug</span><Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} placeholder="fr-cyril-a7k2" /></label>
      <div className="space-y-1"><span className="text-sm font-medium">Generated public URL</span><div className="flex gap-2"><Input readOnly value={publicUrl} placeholder="Enter a slug to generate a URL" /><Button disabled={!publicUrl} onClick={() => void copyLink()} type="button" variant="outline"><Copy className="h-4 w-4" />Copy link</Button><Button disabled={!publicUrl} onClick={() => window.open(publicUrl, "_blank", "noopener,noreferrer")} type="button" variant="outline"><ExternalLink className="h-4 w-4" />Open</Button></div></div>
    </CardContent></Card>

    <Card><CardHeader><div><CardTitle>Common settings</CardTitle><CardDescription>Start-time interval controls how often an appointment may start. It does not control appointment duration.</CardDescription></div></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label className="space-y-1"><span className="text-sm font-medium">Timezone</span><Input value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} placeholder="America/Toronto" /></label>
      <label className="space-y-1"><span className="text-sm font-medium">Start-time interval</span><Select value={draft.startIntervalMinutes} onChange={(e) => setDraft({ ...draft, startIntervalMinutes: Number(e.target.value) as 15 | 30 })}><option value={15}>15 minutes</option><option value={30}>30 minutes</option></Select><span className="text-xs text-muted-foreground">30-minute starts: 9:00, 9:30, 10:00, 10:30</span></label>
      <label className="space-y-1"><span className="text-sm font-medium">Minimum booking notice (minutes)</span><Input min={0} type="number" value={draft.minimumNoticeMinutes} onChange={(e) => setDraft({ ...draft, minimumNoticeMinutes: Number(e.target.value) })} /></label>
      <label className="space-y-1"><span className="text-sm font-medium">Maximum future booking days</span><Input min={1} type="number" value={draft.maximumBookingDays} onChange={(e) => setDraft({ ...draft, maximumBookingDays: Number(e.target.value) })} /></label>
    </CardContent></Card>

    <Card><CardHeader><div><CardTitle>Calendars</CardTitle><CardDescription>Only calendars from your connected Google account can be selected.</CardDescription></div><Badge variant={overview.connection ? "success" : "warning"}>{overview.connection ? "Google connected" : "Connect Google first"}</Badge></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1"><span className="text-sm font-medium">Booking Calendar</span><Select disabled={!overview.connection} value={draft.bookingCalendarId ?? ""} onChange={(e) => setDraft({ ...draft, bookingCalendarId: e.target.value })}><option value="">Select a writable calendar</option>{calendars.filter((calendar) => calendar.accessRole === "owner" || calendar.accessRole === "writer").map((calendar) => <option key={calendar.calendarId} value={calendar.calendarId}>{calendar.summary}</option>)}</Select></label>
      <fieldset className="space-y-1"><legend className="text-sm font-medium">Conflict Calendars</legend><div className="max-h-32 space-y-1 overflow-auto rounded-md border border-border p-2">{calendars.map((calendar) => <label className="flex items-center gap-2 text-sm" key={calendar.calendarId}><Checkbox checked={draft.conflictCalendarIds.includes(calendar.calendarId)} onChange={(e) => setDraft({ ...draft, conflictCalendarIds: e.target.checked ? [...draft.conflictCalendarIds, calendar.calendarId] : draft.conflictCalendarIds.filter((id) => id !== calendar.calendarId) })} />{calendar.summary}</label>)}{!calendars.length ? <span className="text-xs text-muted-foreground">Refresh your Google calendar list in Connect & Configure.</span> : null}</div></fieldset>
    </CardContent></Card>

    <Card><CardHeader><div><CardTitle>Appointment types</CardTitle><CardDescription>Each type has its own durations, weekly availability, and date exceptions.</CardDescription></div><Button onClick={() => setDraft({ ...draft, appointmentTypes: [...draft.appointmentTypes, newAppointmentType()] })} type="button" variant="outline"><Plus className="h-4 w-4" />Add appointment type</Button></CardHeader><CardContent className="space-y-4">
      {draft.appointmentTypes.map((type) => <AppointmentTypeEditor key={type.id} type={type} onChange={(next) => updateType(type.id, () => next)} onDelete={() => setDraft({ ...draft, appointmentTypes: draft.appointmentTypes.filter((item) => item.id !== type.id) })} />)}
      {!draft.appointmentTypes.length ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Add an appointment type such as Confession or Phone Call.</p> : null}
    </CardContent></Card>

    <Card><CardHeader><div><CardTitle>Priest-wide blackouts</CardTitle><CardDescription>These dates make every appointment type unavailable. Add individual dates for vacation, retreat, travel, or parish events.</CardDescription></div><Button onClick={() => setDraft({ ...draft, globalDateOverrides: [...draft.globalDateOverrides, { date: "", unavailable: true }] })} type="button" variant="outline"><Plus className="h-4 w-4" />Add blackout date</Button></CardHeader><CardContent className="space-y-2">{draft.globalDateOverrides.map((override, index) => <div className="flex max-w-md gap-2" key={`${override.date}-${index}`}><Input type="date" value={override.date} onChange={(e) => setDraft({ ...draft, globalDateOverrides: draft.globalDateOverrides.map((item, itemIndex) => itemIndex === index ? { ...item, date: e.target.value } : item) })} /><Badge variant="warning">Unavailable for all types</Badge><Button aria-label="Remove blackout date" onClick={() => setDraft({ ...draft, globalDateOverrides: draft.globalDateOverrides.filter((_, itemIndex) => itemIndex !== index) })} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4" /></Button></div>)}{!draft.globalDateOverrides.length ? <p className="text-sm text-muted-foreground">No priest-wide blackout dates.</p> : null}</CardContent></Card>
  </div>;
};

const AppointmentTypeEditor = ({ type, onChange, onDelete }: { type: PublicAppointmentType; onChange: (type: PublicAppointmentType) => void; onDelete: () => void }) => {
  const update = (patch: Partial<PublicAppointmentType>) => onChange({ ...type, ...patch });
  const toggleDuration = (duration: number, checked: boolean) => {
    const allowed = checked ? [...type.allowedDurationsMinutes, duration].sort((a, b) => a - b) : type.allowedDurationsMinutes.filter((value) => value !== duration);
    update({ allowedDurationsMinutes: allowed, defaultDurationMinutes: allowed.includes(type.defaultDurationMinutes) ? type.defaultDurationMinutes : (allowed[0] ?? 0) });
  };
  return <div className="space-y-4 rounded-md border border-border bg-slate-50/50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Checkbox checked={type.enabled} onChange={(e) => update({ enabled: e.target.checked })} /><span className="text-sm font-semibold">Enabled</span></div><Button onClick={onDelete} type="button" variant="ghost"><Trash2 className="h-4 w-4" />Delete</Button></div>
    <div className="grid gap-3 md:grid-cols-3"><label className="space-y-1"><span className="text-sm font-medium">Name</span><Input value={type.name} onChange={(e) => update({ name: e.target.value })} /></label><label className="space-y-1"><span className="text-sm font-medium">Public location</span><Input value={type.publicLocation ?? ""} onChange={(e) => update({ publicLocation: e.target.value })} /></label><label className="space-y-1"><span className="text-sm font-medium">Default duration</span><Select disabled={!type.allowedDurationsMinutes.length} value={type.allowedDurationsMinutes.includes(type.defaultDurationMinutes) ? type.defaultDurationMinutes : ""} onChange={(e) => update({ defaultDurationMinutes: Number(e.target.value) })}><option value="">Choose duration</option>{type.allowedDurationsMinutes.map((duration) => <option key={duration} value={duration}>{formatDuration(duration)}</option>)}</Select></label><label className="space-y-1 md:col-span-3"><span className="text-sm font-medium">Description</span><Textarea value={type.description ?? ""} onChange={(e) => update({ description: e.target.value })} /></label></div>
    <fieldset><legend className="mb-1 text-sm font-medium">Allowed durations</legend><div className="flex flex-wrap gap-x-4 gap-y-2">{durationOptions.map((duration) => <label className="flex items-center gap-1.5 text-sm" key={duration}><Checkbox checked={type.allowedDurationsMinutes.includes(duration)} onChange={(e) => toggleDuration(duration, e.target.checked)} />{formatDuration(duration)}</label>)}</div>{!type.allowedDurationsMinutes.length ? <p className="mt-1 text-xs text-amber-700">Select at least one duration, then choose a default.</p> : null}</fieldset>
    <AvailabilityEditor type={type} onChange={onChange} />
    <DateOverrideEditor type={type} onChange={onChange} />
  </div>;
};

const AvailabilityEditor = ({ type, onChange }: { type: PublicAppointmentType; onChange: (type: PublicAppointmentType) => void }) => <div className="space-y-2"><div><h3 className="text-sm font-medium">Weekly availability</h3><p className="text-xs text-muted-foreground">Times always use 15-minute increments, independently of the appointment start-time interval.</p></div>{days.map(({ key, label }) => { const ranges = type.weeklyAvailability[key] ?? []; const apply = (next: BookingTimeRange[]) => onChange(setRanges(type, key, next)); return <div className="rounded-md border border-border bg-card p-2" key={key}><div className="flex items-center justify-between"><span className="text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">{ranges.length ? `${ranges.length} period${ranges.length === 1 ? "" : "s"}` : "Unavailable"}</span></div>{ranges.map((range, index) => <div className="mt-2 flex items-center gap-2" key={`${range.start}-${index}`}><Select value={range.start} onChange={(e) => apply(ranges.map((item, itemIndex) => itemIndex === index ? { ...item, start: e.target.value } : item))}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</Select><span className="text-xs">to</span><Select value={range.end} onChange={(e) => apply(ranges.map((item, itemIndex) => itemIndex === index ? { ...item, end: e.target.value } : item))}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</Select><Button aria-label={`Remove ${label} period`} onClick={() => apply(ranges.filter((_, itemIndex) => itemIndex !== index))} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4" /></Button></div>)}<Button className="mt-2" onClick={() => apply([...ranges, { start: "09:00", end: "17:00" }])} size="sm" type="button" variant="outline"><Plus className="h-3.5 w-3.5" />Add period</Button></div>; })}</div>;

const DateOverrideEditor = ({ type, onChange }: { type: PublicAppointmentType; onChange: (type: PublicAppointmentType) => void }) => {
  const update = (overrides: AppointmentTypeDateOverride[]) => onChange({ ...type, dateOverrides: overrides });
  return <div className="space-y-2"><div className="flex items-center justify-between"><div><h3 className="text-sm font-medium">Date overrides</h3><p className="text-xs text-muted-foreground">Changes only this appointment type’s normal weekly availability.</p></div><Button onClick={() => update([...type.dateOverrides, { date: "", unavailable: true }])} size="sm" type="button" variant="outline"><Plus className="h-3.5 w-3.5" />Add exception</Button></div>{type.dateOverrides.map((override, index) => <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2" key={`${override.date}-${index}`}><Input className="w-40" type="date" value={override.date} onChange={(e) => update(type.dateOverrides.map((item, itemIndex) => itemIndex === index ? { ...item, date: e.target.value } : item))} /><Select className="w-40" value={"unavailable" in override ? "unavailable" : "hours"} onChange={(e) => update(type.dateOverrides.map((item, itemIndex) => itemIndex !== index ? item : e.target.value === "unavailable" ? { date: item.date, unavailable: true } : { date: item.date, ranges: [{ start: "09:00", end: "17:00" }] }))}><option value="unavailable">Unavailable</option><option value="hours">Replacement hours</option></Select>{"ranges" in override ? <><Select className="w-28" value={override.ranges[0]?.start ?? "09:00"} onChange={(e) => update(type.dateOverrides.map((item, itemIndex) => itemIndex === index && "ranges" in item ? { ...item, ranges: [{ ...(item.ranges[0] ?? { end: "17:00" }), start: e.target.value }] } : item))}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</Select><span className="text-xs">to</span><Select className="w-28" value={override.ranges[0]?.end ?? "17:00"} onChange={(e) => update(type.dateOverrides.map((item, itemIndex) => itemIndex === index && "ranges" in item ? { ...item, ranges: [{ ...(item.ranges[0] ?? { start: "09:00" }), end: e.target.value }] } : item))}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</Select></> : null}<Button aria-label="Remove date override" onClick={() => update(type.dateOverrides.filter((_, itemIndex) => itemIndex !== index))} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4" /></Button></div>)}{!type.dateOverrides.length ? <p className="text-sm text-muted-foreground">No date-specific exceptions.</p> : null}</div>;
};
