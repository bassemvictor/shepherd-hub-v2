export type EntityEnvelope = {
  entityType: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
};

export type AppCognitoGroup =
  | "sales_engineer"
  | "sales_manager"
  | "pricing_engineer"
  | "admin"
  | "super_user";

export type RecordStatus = "draft" | "active" | "archived";

export type SampleRecord = EntityEnvelope & {
  recordId: string;
  name: string;
  status: RecordStatus;
  owner: string;
};

export type SampleRecordInput = {
  name: string;
  status: RecordStatus;
  owner: string;
};

export type SampleRecordListResponse = {
  items: SampleRecord[];
};

export type DashboardSummary = {
  tenantId: string;
  totalRecords: number;
  activeRecords: number;
  draftRecords: number;
  archivedRecords: number;
};

export type SyncMode = "ALWAYS_GOOGLE" | "CACHE_UNTIL_STALE";
export type SyncSource = "GOOGLE" | "CACHE";
export type SyncStatus = "idle" | "success" | "error" | "pending";
export type GoogleConnectionStatus = "not_connected" | "connected" | "error" | "expired";

export type GoogleConnectionSummary = {
  googleAccountId: string;
  email: string;
  scopes: string[];
  status: GoogleConnectionStatus;
  connectedAt: string;
  lastTokenRefreshAt?: string;
  tokenExpiresAt?: string;
};

export type InitialSyncRange = {
  from: string;
  to: string;
};

export type ScheduleSettings = {
  calendarListRefreshThresholdMinutes: number;
};

export type CalendarSyncConfig = {
  syncMode: SyncMode;
  refreshIntervalMinutes: number;
  initialSyncRange: InitialSyncRange;
  lastSyncedAt?: string;
  lastSyncStartedAt?: string;
  lastSyncCompletedAt?: string;
  lastSyncSource?: SyncSource;
  lastSyncStatus: SyncStatus;
  lastSyncError?: string;
  syncToken?: string;
  initialSyncWindowStart?: string;
  initialSyncWindowEnd?: string;
  requiresFullSync: boolean;
};

export type ScheduleCalendar = EntityEnvelope & {
  calendarId: string;
  summary: string;
  description?: string;
  timeZone?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary: boolean;
  accessRole?: string;
  enabled: boolean;
  selected: boolean;
  calendarListRefreshedAt?: string;
  sync: CalendarSyncConfig;
};

export type ScheduleEvent = EntityEnvelope & {
  eventId: string;
  calendarId: string;
  calendarName: string;
  calendarColor?: string;
  summary: string;
  description?: string;
  location?: string;
  attendees?: string[];
  start: string;
  end: string;
  allDay: boolean;
  status: string;
  source: SyncSource;
  htmlLink?: string;
};

export type CalendarSyncSnapshot = {
  calendarId: string;
  calendarName: string;
  enabled: boolean;
  syncMode: SyncMode;
  refreshIntervalMinutes: number;
  lastSyncedAt?: string;
  lastSyncSource?: SyncSource;
  lastSyncStatus: SyncStatus;
  lastSyncError?: string;
  refreshed: boolean;
  source: SyncSource;
  requiresFullSync: boolean;
};

export type ScheduleOverviewResponse = {
  connection: GoogleConnectionSummary | null;
  calendars: ScheduleCalendar[];
  oauthConfigured: boolean;
  settings: ScheduleSettings;
};

export type ScheduleEventsResponse = {
  events: ScheduleEvent[];
  calendars: CalendarSyncSnapshot[];
  generatedAt: string;
};

export type UpdateCalendarSettingsInput = {
  showInCalendar: boolean;
  syncMode: SyncMode;
  cacheStaleThresholdMinutes: number;
  initialSyncRange: InitialSyncRange;
};

export type SaveScheduleSettingsInput = {
  calendarListRefreshThresholdMinutes: number;
  calendars: Array<UpdateCalendarSettingsInput & { calendarId: string }>;
};

export type CreateScheduleEventInput = {
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  attendees?: string[];
  start: string;
  end: string;
  allDay?: boolean;
};

export type UpdateScheduleEventInput = {
  calendarId: string;
  summary?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  start?: string;
  end?: string;
  allDay?: boolean;
};

export type ConnectGoogleResponse = {
  authUrl: string;
};
