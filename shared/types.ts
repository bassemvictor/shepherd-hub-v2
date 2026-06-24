export type EntityEnvelope = {
  entityType: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
};

export type AppCognitoGroup =
  | "admin"
  | "priest"
  | "servant";

export type AdminManagedGroup = "admin" | "priest" | "servant";

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
  ownerUserId: string;
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
  ownerUserId: string;
  eventId: string;
  googleEventId?: string;
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
  assignedMemberIds?: string[];
  assignedMemberNames?: string[];
  memberIds?: string[];
  memberNames?: string[];
  visitationType?: VisitationType;
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
  memberIds?: string[];
  type?: VisitationType;
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
  memberIds?: string[];
  type?: VisitationType;
};

export type ConnectGoogleResponse = {
  authUrl: string;
};

export type MemberSource = "UNITY" | "MANUAL";
export const visitationTypes = ["Visitation", "Confession", "Phone Call", "Meeting", "Other"] as const;
export type VisitationType = typeof visitationTypes[number];

export type MemberIndexItem = {
  memberId: string;
  fullName: string;
  initials: string;
  phone?: string;
  email?: string;
  householdName?: string;
  unityId?: string;
  isUnityImported: boolean;
  source: MemberSource;
  normalizedSearchText: string;
  updatedAt: string;
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

export type VisitationSource = "calendar" | "manual";

export type MemberVisitation = EntityEnvelope & {
  visitationId: string;
  source: VisitationSource;
  type: VisitationType;
  title: string;
  visitDate: string;
  endDate?: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  memberId: string;
  memberIds: string[];
  memberNames: string[];
  visitStatus: string;
  eventId?: string;
  calendarEventId?: string;
  calendarId?: string;
  calendarOwnerUserId?: string;
  calendarOwnerName?: string;
  createdByUserId: string;
  createdByName: string;
  visitorUserId: string;
  visitorDisplayName: string;
  isOwnCalendar: boolean;
};

export type VisitationReportItem = MemberVisitation & {
  memberFullName: string;
  memberSource: MemberSource;
};

export type ReportsVisitorFilterMode = "any" | "me_only" | "exclude_me" | "specific";
export type ReportsVisitCountMode = "all" | "not_visited" | "lte" | "gt";
export type ReportsMemberScope = "active_only" | "all_members";
export type ReportsMemberSourceFilter = "all" | "unity" | "manual";
export type ReportsVisitationTypeFilter = "all" | VisitationType;
export type ReportsSortBy = "last_visit_date" | "visit_count" | "member_name";
export type ReportsSortDirection = "asc" | "desc";
export type ReportsMemberStatusFilter = "all" | "never_visited" | "not_visited_recently" | "low_visitation" | "visited";

export type VisitationReportFilters = {
  from?: string;
  to?: string;
  sinceBeginning: boolean;
  visitCountMode: ReportsVisitCountMode;
  visitCountThreshold: number;
  visitorMode: ReportsVisitorFilterMode;
  visitorUserId?: string;
  memberScope: ReportsMemberScope;
  memberSource: ReportsMemberSourceFilter;
  type: ReportsVisitationTypeFilter;
  status: ReportsMemberStatusFilter;
  group?: string;
  search?: string;
  sortBy: ReportsSortBy;
  sortDirection: ReportsSortDirection;
  page: number;
  pageSize: number;
};

export type VisitationReportKpiSummary = {
  totalMembers: number;
  matchingMembers: number;
  notVisitedMembers: number;
  overdueMembers: number;
  lowVisitationMembers: number;
  visitedInRangeMembers: number;
  averageVisitsPerMember: number;
};

export type VisitationDistributionBucket = {
  key: "not_visited" | "one_visit" | "two_to_three" | "four_to_six" | "seven_plus";
  label: string;
  count: number;
  percentage: number;
};

export type ActivityTypeDistributionBucket = {
  key: "all" | VisitationType;
  label: string;
  count: number;
  percentage: number;
};

export type VisitationOverviewRow = {
  memberId: string;
  memberFullName: string;
  initials: string;
  phone?: string;
  email?: string;
  unityId?: string;
  memberSource: MemberSource;
  sectorOrGroup?: string;
  lastVisitDate?: string;
  lastVisitedBy?: string;
  lastVisitType?: VisitationType;
  visitCountInRange: number;
  totalLifetimeVisits: number;
  nextScheduledVisit?: string;
  status: "Not Visited" | "Low Visitation" | "Recently Visited";
  normalizedSearchText: string;
  scopeMetrics: {
    everyone: VisitationScopeMetrics;
    me: VisitationScopeMetrics;
  };
};

export type VisitationScopeMetrics = {
  visitCountInRange: number;
  totalLifetimeVisits: number;
  lastVisitDate?: string;
  lastVisitedBy?: string;
  lastVisitType?: VisitationType;
};

export type VisitedMemberBreakdownBucket = {
  key: VisitationType | "Other";
  label: string;
  memberCount: number;
  percentage: number;
};

export type MonthlyActivityTrendPoint = {
  month: string;
  label: string;
  count: number;
};

export type VisitorLeaderboardEntry = {
  visitorUserId: string;
  visitorDisplayName: string;
  visitCountInRange: number;
};

export type CurrentUserVisitationActivity = {
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
};

export type ReportPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type ReportVisitorOption = {
  visitorUserId: string;
  visitorDisplayName: string;
};

export type VisitationReportResponse = {
  filters: VisitationReportFilters;
  summary: VisitationReportKpiSummary;
  distribution: VisitationDistributionBucket[];
  activityTypeDistribution: ActivityTypeDistributionBucket[];
  visitedBreakdownByType: VisitedMemberBreakdownBucket[];
  monthlyActivityTrend: MonthlyActivityTrendPoint[];
  attentionMembers: VisitationOverviewRow[];
  rows: VisitationOverviewRow[];
  pagination: ReportPagination;
  visitors: ReportVisitorOption[];
  availableGroups: string[];
  topVisitors: VisitorLeaderboardEntry[];
  currentUserActivity: CurrentUserVisitationActivity;
  generatedAt: string;
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
  errorCount: number;
  errors: Array<{ row: number; message: string }>;
};

export type MemberImportJobStatus = "queued" | "running" | "completed" | "failed";

export type MemberImportJob = EntityEnvelope & {
  jobId: string;
  fileName: string;
  status: MemberImportJobStatus;
  totalRows: number;
  processedRows: number;
  totalChunks: number;
  processedChunks: number;
  completedAt?: string;
  startedAt?: string;
  result: MemberImportResult;
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

export type CreateManualVisitationInput = {
  title: string;
  visitDate: string;
  type?: VisitationType;
  location?: string;
  visitStatus?: string;
  notes?: string;
  memberIds: string[];
  visitorUserId?: string;
  visitorDisplayName?: string;
};

export type UpdateManualVisitationInput = Partial<CreateManualVisitationInput>;

export type MemberImportInput = {
  fileName: string;
  workbookBase64: string;
};

export type TenantUserSummary = {
  username: string;
  sub: string;
  email: string;
  name: string;
  tenantId: string;
  enabled: boolean;
  status?: string;
  groups: AppCognitoGroup[];
};

export type TenantUsersResponse = {
  items: TenantUserSummary[];
};

export type UpdateTenantUserGroupsInput = {
  groups: AdminManagedGroup[];
};

export type UpdateTenantUserGroupsResponse = {
  user: TenantUserSummary;
};

export type AdminResetAction =
  | "tenant_all"
  | "google_cached_events"
  | "google_connections"
  | "visitations"
  | "members"
  | "audit_logs";

export type AdminResetSummary = {
  action: AdminResetAction;
  recordsDeleted: number;
  affectedEntities: Array<{
    entityType: string;
    deleted: number;
  }>;
  status: "success" | "error";
};
