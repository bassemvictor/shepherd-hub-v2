import { CalendarSync, Cloud, Link2Off, RefreshCcw, Save, Trash2 } from "lucide-react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ConnectGoogleResponse,
  SaveScheduleSettingsInput,
  ScheduleCalendar,
  ScheduleOverviewResponse,
  UpdateCalendarSettingsInput,
} from "../../shared/types";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { PageHeader } from "../components/common/page-header";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { api, getDisplayErrorMessage, isApiConfigured } from "../lib/api";
import {
  cacheThresholdOptions,
  CalendarSourceBadge,
  calendarListThresholdOptions,
  formatDateTime,
  ToastItem,
  ToastStack,
} from "./calendar-shared";

type CalendarSettingsDraft = UpdateCalendarSettingsInput & { calendarId: string };

const manualCalendarListRefreshThresholdMinutes = 0;
const defaultCalendarListRefreshThresholdMinutes = manualCalendarListRefreshThresholdMinutes;

const toDraft = (calendar: ScheduleCalendar): CalendarSettingsDraft => ({
  calendarId: calendar.calendarId,
  showInCalendar: calendar.selected,
  syncMode: calendar.sync.syncMode,
  cacheStaleThresholdMinutes: calendar.sync.refreshIntervalMinutes,
  initialSyncRange: calendar.sync.initialSyncRange,
});

const sortDrafts = (drafts: CalendarSettingsDraft[]) =>
  [...drafts].sort((left, right) => left.calendarId.localeCompare(right.calendarId));

const isInitialSyncRangeLocked = (calendar: ScheduleCalendar) => !calendar.sync.requiresFullSync;

export const CalendarSettingsPage = () => {
  const [overview, setOverview] = useState<ScheduleOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CalendarSettingsDraft>>({});
  const [calendarListRefreshThresholdMinutes, setCalendarListRefreshThresholdMinutes] = useState(
    defaultCalendarListRefreshThresholdMinutes,
  );
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [refreshingList, setRefreshingList] = useState(false);
  const [syncingCalendarId, setSyncingCalendarId] = useState<string | null>(null);
  const [clearingCalendarId, setClearingCalendarId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deleteCacheCalendar, setDeleteCacheCalendar] = useState<ScheduleCalendar | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const autoRefreshCheckedRef = useRef(false);

  const pushToast = useCallback((tone: ToastItem["tone"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const hydrateOverview = useCallback((response: ScheduleOverviewResponse) => {
    setOverview(response);
    setCalendarListRefreshThresholdMinutes(response.settings.calendarListRefreshThresholdMinutes);
    setDrafts(
      Object.fromEntries(response.calendars.map((calendar) => [calendar.calendarId, toDraft(calendar)])),
    );
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<ScheduleOverviewResponse>("/schedule/overview");
      hydrateOverview(response);
    } catch (reason) {
      setError(getDisplayErrorMessage(reason, "Unable to load calendar settings."));
    } finally {
      setLoading(false);
    }
  }, [hydrateOverview]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const draftPayload = useMemo(
    () => ({
      calendarListRefreshThresholdMinutes,
      calendars: sortDrafts(Object.values(drafts)),
    }),
    [calendarListRefreshThresholdMinutes, drafts],
  );

  const savedPayload = useMemo(
    () => ({
      calendarListRefreshThresholdMinutes:
        overview?.settings.calendarListRefreshThresholdMinutes ?? defaultCalendarListRefreshThresholdMinutes,
      calendars: sortDrafts((overview?.calendars ?? []).map(toDraft)),
    }),
    [overview],
  );

  const hasUnsavedChanges = JSON.stringify(draftPayload) !== JSON.stringify(savedPayload);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!hasUnsavedChanges) {
          return;
        }

        event.preventDefault();
      },
      [hasUnsavedChanges],
    ),
  );

  const blocker = useBlocker(hasUnsavedChanges);
  useEffect(() => {
    if (blocker.state !== "blocked") {
      return;
    }

    if (window.confirm("You have unsaved calendar configuration changes. Leave this page?")) {
      blocker.proceed();
      return;
    }

    blocker.reset();
  }, [blocker]);

  const latestCalendarListSync = useMemo(() => {
    const values = (overview?.calendars ?? [])
      .map((calendar) => calendar.calendarListRefreshedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());

    return values[0];
  }, [overview]);

  useEffect(() => {
    if (
      !overview?.connection ||
      !latestCalendarListSync ||
      autoRefreshCheckedRef.current ||
      calendarListRefreshThresholdMinutes <= manualCalendarListRefreshThresholdMinutes
    ) {
      return;
    }

    const ageMs = Date.now() - new Date(latestCalendarListSync).getTime();
    if (ageMs < calendarListRefreshThresholdMinutes * 60_000) {
      autoRefreshCheckedRef.current = true;
      return;
    }

    autoRefreshCheckedRef.current = true;
    void (async () => {
      try {
        setRefreshingList(true);
        await api.post("/schedule/calendars/refresh");
        const response = await api.get<ScheduleOverviewResponse>("/schedule/overview");
        hydrateOverview(response);
        pushToast("success", "Calendar list refreshed from Google.");
      } catch (reason) {
        pushToast("error", getDisplayErrorMessage(reason, "Unable to refresh calendar list."));
      } finally {
        setRefreshingList(false);
      }
    })();
  }, [
    calendarListRefreshThresholdMinutes,
    hydrateOverview,
    latestCalendarListSync,
    overview?.connection,
    pushToast,
  ]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const response = await api.post<ConnectGoogleResponse>("/schedule/google/connect");
      window.location.assign(response.authUrl);
    } catch (reason) {
      setError(getDisplayErrorMessage(reason, "Unable to start Google OAuth."));
      setConnecting(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await api.delete("/schedule/google/connection");
      await loadOverview();
      setDisconnectOpen(false);
      pushToast("success", "Google Calendar disconnected.");
    } catch (reason) {
      const message = getDisplayErrorMessage(reason, "Unable to disconnect Google Calendar.");
      setError(message);
      pushToast("error", message);
    } finally {
      setDisconnecting(false);
    }
  }, [loadOverview, pushToast]);

  const handleRefreshCalendarList = useCallback(async () => {
    setRefreshingList(true);
    try {
      await api.post("/schedule/calendars/refresh");
      await loadOverview();
      pushToast("success", "Calendar list refreshed from Google.");
    } catch (reason) {
      const message = getDisplayErrorMessage(reason, "Unable to refresh calendar list.");
      setError(message);
      pushToast("error", message);
    } finally {
      setRefreshingList(false);
    }
  }, [loadOverview, pushToast]);

  const handleSave = useCallback(async () => {
    const payload: SaveScheduleSettingsInput = draftPayload;
    setSaving(true);
    try {
      const response = await api.put<ScheduleOverviewResponse>("/schedule/settings", payload);
      hydrateOverview(response);
      pushToast("success", "Calendar configuration saved.");
    } catch (reason) {
      const message = getDisplayErrorMessage(reason, "Unable to save calendar settings.");
      setError(message);
      pushToast("error", message);
    } finally {
      setSaving(false);
    }
  }, [draftPayload, hydrateOverview, pushToast]);

  const handleForceSync = useCallback(
    async (calendarId: string) => {
      setSyncingCalendarId(calendarId);
      try {
        await api.post(`/schedule/calendars/${calendarId}/sync`, { calendarIds: [calendarId] });
        await loadOverview();
        pushToast("success", "Calendar synced from Google.");
      } catch (reason) {
        const message = getDisplayErrorMessage(reason, "Unable to sync calendar.");
        setError(message);
        pushToast("error", message);
      } finally {
        setSyncingCalendarId(null);
      }
    },
    [loadOverview, pushToast],
  );

  const handleDeleteCache = useCallback(async () => {
    if (!deleteCacheCalendar) {
      return;
    }

    setClearingCalendarId(deleteCacheCalendar.calendarId);
    try {
      await api.delete(`/schedule/calendars/${deleteCacheCalendar.calendarId}/cache`);
      await loadOverview();
      pushToast("success", "Calendar cache deleted.");
      setDeleteCacheCalendar(null);
    } catch (reason) {
      const message = getDisplayErrorMessage(reason, "Unable to delete calendar cache.");
      setError(message);
      pushToast("error", message);
    } finally {
      setClearingCalendarId(null);
    }
  }, [deleteCacheCalendar, loadOverview, pushToast]);

  const connected = Boolean(overview?.connection);
  const calendarListStatus = useMemo(() => {
    if (!connected) {
      return "Not Connected";
    }

    if (refreshingList) {
      return "Syncing";
    }

    if (calendarListRefreshThresholdMinutes <= manualCalendarListRefreshThresholdMinutes) {
      return "Manual";
    }

    if (!latestCalendarListSync) {
      return "Pending";
    }

    const ageMs = Date.now() - new Date(latestCalendarListSync).getTime();
    return ageMs >= calendarListRefreshThresholdMinutes * 60_000 ? "Stale" : "Ready";
  }, [calendarListRefreshThresholdMinutes, connected, latestCalendarListSync, refreshingList]);

  if (!isApiConfigured) {
    return (
      <ErrorState
        description="Set `VITE_API_BASE_URL` or regenerate `amplify_outputs.json` before using the schedule APIs."
        title="API not configured"
      />
    );
  }

  if (loading) {
    return (
      <LoadingState
        description="Loading connection details, sync defaults, and calendar configuration."
        title="Preparing calendar settings"
      />
    );
  }

  if (!overview) {
    return (
      <ErrorState
        action={
          <Button onClick={() => void loadOverview()} type="button">
            Retry
          </Button>
        }
        description={error ?? "Calendar settings did not load."}
        title="Unable to load calendar settings"
      />
    );
  }

  return (
    <div className="space-y-4">
      <ToastStack toasts={toasts} />

      <PageHeader
        description="Connect Google, control calendar-list refresh behavior, and choose which calendars feed the schedule view."
        title="Connect & Configure"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {hasUnsavedChanges ? <Badge variant="warning">Unsaved Changes</Badge> : <Badge variant="neutral">All Changes Saved</Badge>}
          <Button className="w-full sm:w-auto" disabled={!hasUnsavedChanges || saving} onClick={() => void handleSave()} type="button">
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save All Changes"}
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={!hasUnsavedChanges || saving}
            onClick={() => overview && hydrateOverview(overview)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </PageHeader>

      {error ? <ErrorState description={error} title="Calendar action failed" /> : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>1. Google Connection</CardTitle>
            <CardDescription>OAuth happens through your backend. The React app never talks to Google directly.</CardDescription>
          </div>
          <Badge variant={connected ? "success" : "warning"}>{connected ? "Connected" : "Not Connected"}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {!overview.oauthConfigured ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Google OAuth is not configured on the API yet. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
              `GOOGLE_REDIRECT_URI` for the backend, then redeploy Amplify so the Connect Google button becomes available.
            </div>
          ) : null}

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Connected Account</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {overview.connection?.email || "No Google account connected"}
            </p>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Last Token Refresh</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {formatDateTime(overview.connection?.lastTokenRefreshAt)}
            </p>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Access Token Expiry</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {formatDateTime(overview.connection?.tokenExpiresAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3">
            {!connected ? (
              <Button
                className="w-full sm:w-auto"
                disabled={connecting || !overview.oauthConfigured}
                onClick={() => void handleConnect()}
                type="button"
              >
                <Cloud className="h-4 w-4" />
                {connecting ? "Redirecting..." : overview.oauthConfigured ? "Connect Google" : "OAuth Not Configured"}
              </Button>
            ) : (
              <Button className="w-full sm:w-auto" onClick={() => setDisconnectOpen(true)} type="button" variant="outline">
                <Link2Off className="h-4 w-4" />
                Disconnect
              </Button>
            )}
          </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>2. Sync Calendar List</CardTitle>
            <CardDescription>Refresh the list of calendars from Google without touching event cache unless the backend decides to.</CardDescription>
          </div>
          <Badge variant={calendarListStatus === "Ready" ? "success" : "warning"}>{calendarListStatus}</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[200px_200px_minmax(0,1fr)_auto] lg:items-end">
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Last Calendar-list Sync</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{formatDateTime(latestCalendarListSync)}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Last Sync Status</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{calendarListStatus}</p>
          </div>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-900">
              Check for updates if last sync from Google was older than
            </span>
            <Select
              onChange={(event) => {
                setCalendarListRefreshThresholdMinutes(Number(event.target.value));
              }}
              value={calendarListRefreshThresholdMinutes}
            >
              <option value={manualCalendarListRefreshThresholdMinutes}>Do not auto sync</option>
              {calendarListThresholdOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <Button className="w-full lg:w-auto" disabled={!connected || refreshingList} onClick={() => void handleRefreshCalendarList()} type="button">
            <RefreshCcw className="h-4 w-4" />
            {refreshingList ? "Syncing..." : "Force Sync Calendar List"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>3. Calendars to Sync</CardTitle>
            <CardDescription>Control visibility defaults, sync mode, sync window, and per-calendar maintenance in one compact view.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {overview.calendars.length ? (
            <>
              <div className="grid gap-3 lg:hidden">
                {overview.calendars.map((calendar) => {
                  const draft = drafts[calendar.calendarId];
                  if (!draft) {
                    return null;
                  }
                  const initialSyncRangeLocked = isInitialSyncRangeLocked(calendar);

                  return (
                    <div className="rounded-md border border-border/70 bg-white p-3 shadow-sm" key={calendar.calendarId}>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3.5 w-3.5 rounded-full"
                              style={{ backgroundColor: calendar.backgroundColor ?? "#2563eb" }}
                            />
                            <span className="min-w-0 truncate text-sm font-medium text-slate-900">{calendar.summary}</span>
                            {calendar.primary ? <Badge variant="success">Primary</Badge> : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {calendar.description || calendar.accessRole || "Google calendar"}
                          </p>
                        </div>

                        <label className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                          <span className="text-sm font-medium text-slate-900">Show in Calendar</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{draft.showInCalendar ? "Shown" : "Hidden"}</span>
                            <Checkbox
                              checked={draft.showInCalendar}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [calendar.calendarId]: {
                                    ...draft,
                                    showInCalendar: event.target.checked,
                                  },
                                }))
                              }
                            />
                          </div>
                        </label>

                        <div className="space-y-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            Sync Mode
                          </span>
                          <div className="grid gap-1 rounded-md border border-border bg-slate-50 p-1">
                            <button
                              className={`rounded-sm px-2.5 py-1.5 text-left text-xs font-medium ${
                                draft.syncMode === "ALWAYS_GOOGLE" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                              }`}
                              onClick={() =>
                                setDrafts((current) => ({
                                  ...current,
                                  [calendar.calendarId]: {
                                    ...draft,
                                    syncMode: "ALWAYS_GOOGLE",
                                  },
                                }))
                              }
                              type="button"
                            >
                              Always pull from Google
                            </button>
                            <button
                              className={`rounded-sm px-2.5 py-1.5 text-left text-xs font-medium ${
                                draft.syncMode === "CACHE_UNTIL_STALE" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                              }`}
                              onClick={() =>
                                setDrafts((current) => ({
                                  ...current,
                                  [calendar.calendarId]: {
                                    ...draft,
                                    syncMode: "CACHE_UNTIL_STALE",
                                  },
                                }))
                              }
                              type="button"
                            >
                              Load from cache
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                              Cache Threshold
                            </span>
                            {draft.syncMode === "CACHE_UNTIL_STALE" ? (
                              <Select
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [calendar.calendarId]: {
                                      ...draft,
                                      cacheStaleThresholdMinutes: Number(event.target.value),
                                    },
                                  }))
                                }
                                value={draft.cacheStaleThresholdMinutes}
                              >
                                {cacheThresholdOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-muted-foreground">Always fresh</div>
                            )}
                          </div>

                          <div className="space-y-1.5">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                              Status
                            </span>
                            <div className="space-y-1 rounded-md bg-slate-50 px-3 py-2">
                              <CalendarSourceBadge
                                calendar={calendar}
                                source={calendar.sync.lastSyncSource}
                                status={calendar.sync.lastSyncStatus}
                                syncing={syncingCalendarId === calendar.calendarId}
                              />
                              <p className="text-xs text-muted-foreground">
                                Last synced {formatDateTime(calendar.sync.lastSyncedAt)}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            Initial Sync Range
                          </span>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Input
                              disabled={initialSyncRangeLocked}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [calendar.calendarId]: {
                                    ...draft,
                                    initialSyncRange: {
                                      ...draft.initialSyncRange,
                                      from: event.target.value,
                                    },
                                  },
                                }))
                              }
                              type="date"
                              value={draft.initialSyncRange.from}
                            />
                            <Input
                              disabled={initialSyncRangeLocked}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [calendar.calendarId]: {
                                    ...draft,
                                    initialSyncRange: {
                                      ...draft.initialSyncRange,
                                      to: event.target.value,
                                    },
                                  },
                                }))
                              }
                              type="date"
                              value={draft.initialSyncRange.to}
                            />
                          </div>
                          {initialSyncRangeLocked ? (
                            <p className="text-xs text-muted-foreground">
                              Initial sync is already complete for this calendar.
                            </p>
                          ) : null}
                        </div>

                        <div className="flex gap-2 border-t border-border/70 pt-3">
                          <Button
                            className="flex-1"
                            disabled={syncingCalendarId === calendar.calendarId}
                            onClick={() => void handleForceSync(calendar.calendarId)}
                            type="button"
                            variant="outline"
                          >
                            <CalendarSync className="h-4 w-4" />
                            {syncingCalendarId === calendar.calendarId ? "Syncing..." : "Force Sync"}
                          </Button>
                          <Button
                            className="flex-1"
                            disabled={clearingCalendarId === calendar.calendarId}
                            onClick={() => setDeleteCacheCalendar(calendar)}
                            type="button"
                            variant="outline"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete Cache
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Calendar</TableHead>
                      <TableHead>Show in Calendar</TableHead>
                      <TableHead>Sync Mode</TableHead>
                      <TableHead>Cache Threshold</TableHead>
                      <TableHead>Initial Sync Range</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.calendars.map((calendar) => {
                      const draft = drafts[calendar.calendarId];
                      if (!draft) {
                        return null;
                      }
                      const initialSyncRangeLocked = isInitialSyncRangeLocked(calendar);

                      return (
                        <TableRow key={calendar.calendarId}>
                          <TableCell>
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <span
                                  className="h-3.5 w-3.5 rounded-full"
                                  style={{ backgroundColor: calendar.backgroundColor ?? "#2563eb" }}
                                />
                                <span className="font-medium text-slate-900">{calendar.summary}</span>
                                {calendar.primary ? <Badge variant="success">Primary</Badge> : null}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {calendar.description || calendar.accessRole || "Google calendar"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <label className="flex items-center gap-3">
                              <Checkbox
                                checked={draft.showInCalendar}
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [calendar.calendarId]: {
                                      ...draft,
                                      showInCalendar: event.target.checked,
                                    },
                                  }))
                                }
                              />
                              <span>{draft.showInCalendar ? "Shown" : "Hidden"}</span>
                            </label>
                          </TableCell>
                          <TableCell>
                            <div className="inline-flex rounded-md border border-border bg-slate-50 p-1">
                              <button
                                className={`rounded-sm px-2.5 py-1.5 text-xs font-medium ${
                                  draft.syncMode === "ALWAYS_GOOGLE" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                                }`}
                                onClick={() =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [calendar.calendarId]: {
                                      ...draft,
                                      syncMode: "ALWAYS_GOOGLE",
                                    },
                                  }))
                                }
                                type="button"
                              >
                                Always pull from Google
                              </button>
                              <button
                                className={`rounded-sm px-2.5 py-1.5 text-xs font-medium ${
                                  draft.syncMode === "CACHE_UNTIL_STALE" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                                }`}
                                onClick={() =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [calendar.calendarId]: {
                                      ...draft,
                                      syncMode: "CACHE_UNTIL_STALE",
                                    },
                                  }))
                                }
                                type="button"
                              >
                                Load from cache
                              </button>
                            </div>
                          </TableCell>
                          <TableCell>
                            {draft.syncMode === "CACHE_UNTIL_STALE" ? (
                              <Select
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [calendar.calendarId]: {
                                      ...draft,
                                      cacheStaleThresholdMinutes: Number(event.target.value),
                                    },
                                  }))
                                }
                                value={draft.cacheStaleThresholdMinutes}
                              >
                                {cacheThresholdOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <span className="text-sm text-muted-foreground">Always fresh</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="grid gap-2">
                              <Input
                                disabled={initialSyncRangeLocked}
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [calendar.calendarId]: {
                                      ...draft,
                                      initialSyncRange: {
                                        ...draft.initialSyncRange,
                                        from: event.target.value,
                                      },
                                    },
                                  }))
                                }
                                type="date"
                                value={draft.initialSyncRange.from}
                              />
                              <Input
                                disabled={initialSyncRangeLocked}
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [calendar.calendarId]: {
                                      ...draft,
                                      initialSyncRange: {
                                        ...draft.initialSyncRange,
                                        to: event.target.value,
                                      },
                                    },
                                  }))
                                }
                                type="date"
                                value={draft.initialSyncRange.to}
                              />
                              {initialSyncRangeLocked ? (
                                <p className="text-xs text-muted-foreground">
                                  Initial sync is already complete for this calendar.
                                </p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-2">
                              <CalendarSourceBadge
                                calendar={calendar}
                                source={calendar.sync.lastSyncSource}
                                status={calendar.sync.lastSyncStatus}
                                syncing={syncingCalendarId === calendar.calendarId}
                              />
                              <p className="text-xs text-muted-foreground">
                                Last synced {formatDateTime(calendar.sync.lastSyncedAt)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                aria-label={`Force sync ${calendar.summary}`}
                                disabled={syncingCalendarId === calendar.calendarId}
                                onClick={() => void handleForceSync(calendar.calendarId)}
                                size="icon"
                                type="button"
                                variant="outline"
                              >
                                <CalendarSync className="h-4 w-4" />
                              </Button>
                              <Button
                                aria-label={`Delete cache for ${calendar.summary}`}
                                disabled={clearingCalendarId === calendar.calendarId}
                                onClick={() => setDeleteCacheCalendar(calendar)}
                                size="icon"
                                type="button"
                                variant="outline"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <ErrorState
              description="Connect Google and sync the calendar list to configure calendars here."
              title="No calendars available"
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        busy={disconnecting}
        confirmLabel="Disconnect"
        description="This removes the saved Google connection from the app. Existing cached events remain until you clear them."
        onClose={() => setDisconnectOpen(false)}
        onConfirm={() => void handleDisconnect()}
        open={disconnectOpen}
        title="Disconnect Google Calendar?"
      />

      <ConfirmDialog
        busy={Boolean(deleteCacheCalendar && clearingCalendarId === deleteCacheCalendar.calendarId)}
        confirmLabel="Delete Cache"
        description="This removes only the cached events for this calendar. Google events are not deleted."
        destructive
        onClose={() => setDeleteCacheCalendar(null)}
        onConfirm={() => void handleDeleteCache()}
        open={Boolean(deleteCacheCalendar)}
        title={`Delete cache for ${deleteCacheCalendar?.summary ?? "calendar"}?`}
      />
    </div>
  );
};
