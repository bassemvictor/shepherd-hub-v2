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
  eventType?: MemberEventType;
  memberIds?: string[];
  memberNames?: string[];
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
  eventType?: MemberEventType;
  memberIds?: string[];
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
  eventType?: MemberEventType;
  memberIds?: string[];
};

export type ConnectGoogleResponse = {
  authUrl: string;
};

export type MemberSource = "UNITY" | "MANUAL";
export type MemberEventType = "VISITATION" | "GENERAL";

export type MemberIndexItem = {
  memberId: string;
  fullName: string;
  initials: string;
  phone?: string;
  email?: string;
  unityId?: string;
  source: MemberSource;
  normalizedSearchText: string;
};

export type Member = EntityEnvelope & {
  memberId: string;
  unityId?: string;
  source: MemberSource;
  isUnityMember: boolean;
  familyId?: string;
  householdName?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  initials: string;
  phone?: string;
  email?: string;
  whatsappPhone?: string;
  address?: string;
  postalCode?: string;
  dateOfBirth?: string;
  age?: number;
  gender?: string;
  familyStatus?: string;
  church?: string;
  fatherOfConfession?: string;
  deaconshipRank?: string;
  ordinationDate?: string;
  churchProvince?: string;
  churchCity?: string;
  churchRegion?: string;
  diocese?: string;
  activated?: boolean;
  approved?: boolean;
  locked?: boolean;
  visibility?: string;
  username?: string;
  registrationDate?: string;
  groups?: string[];
  customFlag?: string;
  licensePlate?: string;
  notes?: string;
  normalizedSearchText: string;
};

export type MemberDirectoryResponse = {
  items: Member[];
  nextCursor?: string;
  total: number;
};

export type MemberIndexResponse = {
  items: MemberIndexItem[];
  generatedAt: string;
};

export type MemberEvent = EntityEnvelope & {
  eventId: string;
  memberId: string;
  eventTitleSnapshot: string;
  eventStartDateTime: string;
  eventEndDateTime: string;
  eventType: MemberEventType;
  status: string;
};

export type MemberActivity = {
  activityId: string;
  action: string;
  message: string;
  actorUserId: string;
  actorDisplayName: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type MemberDetailResponse = {
  member: Member;
  activity: MemberActivity[];
};

export type MemberImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

export type CreateMemberInput = Partial<
  Omit<Member, keyof EntityEnvelope | "memberId" | "source" | "isUnityMember" | "normalizedSearchText">
> & {
  fullName: string;
  source?: MemberSource;
};

export type UpdateMemberInput = Partial<CreateMemberInput>;

export type EventMemberSummary = Pick<
  Member,
  "memberId" | "fullName" | "initials" | "phone" | "email" | "unityId" | "source"
>;

export type EventMembersResponse = {
  items: EventMemberSummary[];
};

export type UpdateEventMembersInput = {
  calendarId: string;
  memberIds: string[];
};

export type MemberImportInput = {
  fileName: string;
  workbookBase64: string;
};
