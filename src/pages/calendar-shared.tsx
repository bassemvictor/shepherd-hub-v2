import { useEffect, useState } from "react";

import type { ScheduleCalendar, SyncSource, SyncStatus } from "../../shared/types";
import { Badge } from "../components/ui/badge";

export type ToastItem = {
  id: string;
  tone: "success" | "error";
  message: string;
};

export const calendarListThresholdOptions = [
  { label: "1 minute", value: 1 },
  { label: "5 minutes", value: 5 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "12 hours", value: 720 },
  { label: "1 day", value: 1440 },
  { label: "3 days", value: 4320 },
  { label: "7 days", value: 10080 },
  { label: "15 days", value: 21600 },
];

export const cacheThresholdOptions = [
  { label: "5 minutes", value: 5 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "12 hours", value: 720 },
  { label: "1 day", value: 1440 },
  { label: "3 days", value: 4320 },
  { label: "7 days", value: 10080 },
  { label: "15 days", value: 21600 },
];

export const formatDateTime = (value?: string) => {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

type SyncBadgeState = {
  lastSyncedAt?: string;
  refreshIntervalMinutes: number;
  syncMode: ScheduleCalendar["sync"]["syncMode"];
};

export const isCalendarSyncStale = ({ syncMode, lastSyncedAt, refreshIntervalMinutes }: SyncBadgeState) => {
  if (syncMode !== "CACHE_UNTIL_STALE" || !lastSyncedAt) {
    return false;
  }

  const ageMs = Date.now() - new Date(lastSyncedAt).getTime();
  return ageMs >= refreshIntervalMinutes * 60_000;
};

export const getCalendarSourceLabel = (
  sync: SyncBadgeState,
  source?: SyncSource,
  status?: SyncStatus,
  syncing = false,
) => {
  if (syncing) {
    return "Syncing";
  }

  if (status === "error") {
    return "Error";
  }

  if (isCalendarSyncStale(sync)) {
    return "Cache Stale";
  }

  if (source === "GOOGLE") {
    return "Synced from Google";
  }

  if (source === "CACHE") {
    return "Loaded from Cache";
  }

  return "Pending";
};

export const CalendarSourceBadge = ({
  calendar,
  source,
  status,
  syncing = false,
  lastSyncedAt,
  refreshIntervalMinutes,
}: {
  calendar: ScheduleCalendar;
  source?: SyncSource;
  status?: SyncStatus;
  syncing?: boolean;
  lastSyncedAt?: string;
  refreshIntervalMinutes?: number;
}) => {
  const label = getCalendarSourceLabel(
    {
      syncMode: calendar.sync.syncMode,
      lastSyncedAt: lastSyncedAt ?? calendar.sync.lastSyncedAt,
      refreshIntervalMinutes: refreshIntervalMinutes ?? calendar.sync.refreshIntervalMinutes,
    },
    source,
    status,
    syncing,
  );
  const variant =
    label === "Synced from Google"
      ? "success"
      : label === "Loaded from Cache"
        ? "neutral"
        : label === "Pending"
          ? "neutral"
          : "warning";

  return <Badge variant={variant}>{label}</Badge>;
};

export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1024 : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isMobile;
};

export const ToastStack = ({ toasts }: { toasts: ToastItem[] }) => (
  <div className="pointer-events-none fixed right-3 top-3 z-[70] flex max-w-sm flex-col gap-2">
    {toasts.map((toast) => (
      <div
        className={`rounded-md border px-3 py-2 text-sm shadow-lg ${
          toast.tone === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-rose-200 bg-rose-50 text-rose-800"
        }`}
        key={toast.id}
      >
        {toast.message}
      </div>
    ))}
  </div>
);
