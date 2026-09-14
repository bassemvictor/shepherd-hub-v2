import { randomBytes, randomUUID } from "node:crypto";
import { DateTime } from "luxon";

import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyHandlerV2 } from "aws-lambda";
import { readSheet } from "read-excel-file/node";
import { buildAddressBasedHouseholdName, normalizeAddress } from "../../../shared/address-normalization.js";
import {
  getVisitationAreaDefinition,
  resolveVisitationAreaId,
  visitationAreaDefinitions,
} from "../../../shared/visitation-areas.js";
import { visitationTypes } from "../../../shared/types.js";
import {
  BookingSettingsError,
  getBookingSettings,
  getPublicBookingPage,
  getPublicBookingProfile,
  saveBookingSettings,
} from "./booking-settings/settings.js";

import type {
  Tag,
  TagInput,
  TagFilters,
  AppCognitoGroup,
  AdminManagedGroup,
  AdminJobsResponse,
  AdminResetAction,
  AdminResetSummary,
  CalendarSyncConfig,
  CalendarSyncSnapshot,
  CreateHouseholdInput,
  CreateMemberInput,
  CreateManualVisitationInput,
  ConnectGoogleResponse,
  CreateScheduleEventInput,
  EventMemberSummary,
  EventMembersResponse,
  GoogleConnectionStatus,
  GoogleConnectionSummary,
  InitialSyncRange,
  Household,
  HouseholdConflict,
  HouseholdConflictListResponse,
  HouseholdDetailResponse,
  HouseholdDirectoryResponse,
  HouseholdGeocodeStatus,
  HouseholdLocation,
  HouseholdMatchResponse,
  HouseholdMemberSummary,
  HouseholdSummary,
  HouseholdGeocodeJob,
  HouseholdGeocodeJobMode,
  HouseholdGeocodeJobStatus,
  Member,
  MemberActivity,
  MemberDetailResponse,
  MemberDirectoryResponse,
  MemberVisitation,
  MemberImportInput,
  MemberImportJob,
  MemberImportJobStatus,
  MemberImportResult,
  MemberIndexItem,
  MemberIndexResponse,
  MemberSource,
  SaveScheduleSettingsInput,
  ScheduleCalendar,
  ScheduleEvent,
  ScheduleEventsResponse,
  ScheduleOverviewResponse,
  ScheduleSettings,
  ReportPagination,
  ReportVisitorOption,
  ResolveHouseholdConflictInput,
  ReportsMemberScope,
  ReportsMemberStatusFilter,
  ReportsMemberSourceFilter,
  ReportsSortBy,
  ReportsSortDirection,
  ReportsVisitCountMode,
  ReportsVisitationTypeFilter,
  ReportsVisitorFilterMode,
  SyncSource,
  SyncStatus,
  AttachMemberToHouseholdInput,
  UpdateEventMembersInput,
  UpdateHouseholdInput,
  UpdateMemberInput,
  UpdateScheduleEventInput,
  UpdateCalendarSettingsInput,
  UpdateTenantUserGroupsInput,
  UpdateTenantUserGroupsResponse,
  CreateHouseholdGeocodeJobInput,
  CurrentUserVisitationActivity,
  TenantUserSummary,
  TenantUsersResponse,
  ActivityTypeDistributionBucket,
  MonthlyActivityTrendPoint,
  VisitedMemberBreakdownBucket,
  VisitationDistributionBucket,
  VisitationOverviewRow,
  VisitationReportFilters,
  VisitationReportKpiSummary,
  VisitationReportResponse,
  VisitationScopeMetrics,
  VisitationSource,
  UpdateManualVisitationInput,
  VisitorLeaderboardEntry,
  VisitationType,
  VisitationGeographyFeature,
  VisitationGeographyFeatureCollection,
  VisitationGeographyReportResponse,
  VisitationAreaSummary,
  VisitationGeographySummary,
  SaveBookingSettingsInput,
  PublicBookingMonthAvailability,
  PublicBookingDayAvailability,
} from "../../../shared/types.js";

type BaseItem = {
  PK: string;
  SK: string;
  entityType: string;
  createdAt: string;
  updatedAt: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  GSI3PK?: string;
  GSI3SK?: string;
  GSI4PK?: string;
  GSI4SK?: string;
  GSI5PK?: string;
  GSI5SK?: string;
};

type GoogleConnectionItem = BaseItem & {
  userId: string;
  tenantId: string;
  googleAccountId: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  scopes: string[];
  status: GoogleConnectionStatus;
  connectedAt: string;
  lastConnectedAt: string;
  lastTokenRefreshAt?: string;
};

type CalendarItem = BaseItem & {
  userId: string;
  tenantId: string;
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

type BookingDayItem = BaseItem & {
  profileId: string;
  reservations: Array<{
    bookingId: string;
    appointmentTypeId: string;
    start: string;
    end: string;
    status: "CONFIRMED" | "RESERVED" | string;
    expiresAt?: string;
  }>;
};

type EventItem = BaseItem & {
  userId: string;
  tenantId: string;
  calendarId: string;
  eventId: string;
  googleEventId?: string;
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
  autoLinkedMemberIds?: string[];
  autoLinkedMemberNames?: string[];
  dismissedAutoLinkedMemberIds?: string[];
  autoLinkedVisitationType?: VisitationType;
  memberIds?: string[];
  memberNames?: string[];
  visitationType?: VisitationType;
};

type VisitationItem = BaseItem & {
  tenantId: string;
  visitationId: string;
  source: VisitationSource;
  type?: VisitationType;
  memberId: string;
  memberIds: string[];
  memberNames: string[];
  visitorUserId: string;
  visitorDisplayName: string;
  createdByUserId: string;
  createdByName: string;
  visitDate: string;
  title: string;
  endDate?: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  visitStatus: string;
  eventId?: string;
  calendarEventId?: string;
  calendarId?: string;
  calendarOwnerUserId?: string;
  calendarOwnerName?: string;
};

type MemberItem = BaseItem & Omit<Member, keyof BaseItem | "tenantId" | "createdAt" | "updatedAt" | "entityType"> & {
  tenantId: string;
};

type HouseholdItem = BaseItem & Omit<Household, keyof BaseItem | "tenantId" | "createdAt" | "updatedAt" | "entityType"> & {
  tenantId: string;
};

type HouseholdConflictItem = BaseItem & {
  tenantId: string;
  memberId: string;
  memberFullName: string;
  currentHouseholdId?: string;
  currentHouseholdName?: string;
  currentHouseholdAddress?: string;
  currentHouseholdAddressKey?: string;
  currentHouseholdGeocodeStatus?: HouseholdGeocodeStatus;
  importedAddress?: string;
  importedPostalCode?: string;
  importedAddressKey?: string;
  matchedHouseholdId?: string;
  matchedHouseholdName?: string;
  matchedHouseholdAddress?: string;
  matchedHouseholdGeocodeStatus?: HouseholdGeocodeStatus;
};

type GeocodeCacheItem = BaseItem & {
  addressKey: string;
  normalizedAddress?: string;
  normalizedPostalCode?: string;
  geocodeStatus: HouseholdGeocodeStatus;
  latitude?: number;
  longitude?: number;
  geocodedAt?: string;
  geocodeProvider: string;
  failureReason?: string;
};

type EventMemberItem = BaseItem & {
  tenantId: string;
  calendarId: string;
  eventId: string;
  calendarOwnerUserId: string;
  calendarOwnerName: string;
  memberId: string;
  memberName: string;
  memberPhoneSnapshot?: string;
  memberEmailSnapshot?: string;
  unityIdSnapshot?: string;
  sourceSnapshot: MemberSource;
  eventTitle: string;
  eventStart: string;
  eventEnd: string;
  eventLocation?: string;
  eventDescription?: string;
  allDay?: boolean;
  assignmentStatus: string;
  visitStatus: string;
  createdByUserId: string;
  createdByName: string;
};

type MemberActivityItem = BaseItem & {
  tenantId: string;
  activityId: string;
  action: string;
  message: string;
  actorUserId: string;
  actorDisplayName: string;
  metadata?: Record<string, unknown>;
};

type ImportWorkbookRow = {
  rowNumber: number;
  values: Record<string, unknown>;
};

type MemberImportJobItem = BaseItem & {
  tenantId: string;
  jobId: string;
  fileName: string;
  status: MemberImportJobStatus;
  totalRows: number;
  processedRows: number;
  totalChunks: number;
  processedChunks: number;
  startedAt?: string;
  completedAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  result: MemberImportResult;
};

type MemberImportChunkItem = BaseItem & {
  tenantId: string;
  jobId: string;
  chunkIndex: number;
  rowCount: number;
  rows: ImportWorkbookRow[];
};

type HouseholdGeocodeJobItem = BaseItem & {
  tenantId: string;
  jobId: string;
  mode: HouseholdGeocodeJobMode;
  status: HouseholdGeocodeJobStatus;
  total: number;
  processed: number;
  success: number;
  failed: number;
  remaining: number;
  startedAt?: string;
  completedAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastProcessedHouseholdId?: string;
  lastProcessedAddressKey?: string;
  lastFailureReason?: string;
};

type AuditLogItem = BaseItem & {
  tenantId: string;
  auditId: string;
  actionType: string;
  actorUserId: string;
  actorEmail: string;
  actorDisplayName: string;
  targetUserId?: string;
  targetUsername?: string;
  resultStatus: "success" | "failed";
  deletionCounts?: Record<string, number>;
  metadata?: Record<string, unknown>;
};

type OAuthStateItem = BaseItem & {
  state: string;
  userId: string;
  tenantId: string;
  actorEmail: string;
  expiresAt: string;
};

type ScheduleSettingsItem = BaseItem & {
  userId: string;
  tenantId: string;
  calendarListRefreshThresholdMinutes: number;
};

type RequestContext = {
  actorEmail: string;
  actorGroups: AppCognitoGroup[];
  actorName: string;
  actorSub: string;
  tableName: string;
  tenantId: string;
};

type HandlerDependencies = {
  cognitoClient: Pick<CognitoIdentityProviderClient, "send">;
  documentClient: Pick<DynamoDBDocumentClient, "send">;
  now: () => string;
  uuid: () => string;
  randomState: () => string;
  fetchImpl: typeof fetch;
};

type GeocodingQuery = {
  addressKey: string;
  normalizedAddress?: string;
  normalizedPostalCode?: string;
};

type GeocodingLookupResult =
  | {
    geocodeStatus: "success";
    latitude: number;
    longitude: number;
    geocodedAt: string;
    geocodeProvider: string;
  }
  | {
    geocodeStatus: "failed";
    geocodedAt: string;
    geocodeProvider: string;
    failureReason: "no_result" | "timeout" | "provider_error" | "invalid_coordinates";
  };

type GeocodingConfig = {
  provider: string;
  baseUrl: string;
  userAgent: string;
  email?: string;
  timeoutMs: number;
  countryCodes?: string;
  acceptLanguage?: string;
};

type GeocodingService = {
  provider: string;
  geocode: (query: GeocodingQuery, deps: HandlerDependencies) => Promise<GeocodingLookupResult>;
};

type ImportExecutionState = {
  existingMembersByUnityId: Map<string, MemberItem>;
  householdsById: Map<string, HouseholdItem>;
  householdsByAddressKey: Map<string, HouseholdItem>;
};

type AutoLinkedInteractionResult = {
  interactionType?: VisitationType;
  matchedMembers: MemberItem[];
};

type SyncResult = {
  calendar: CalendarItem;
  events: EventItem[];
  refreshed: boolean;
  source: SyncSource;
};

type GoogleEventPayload = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  attendees?: Array<{ email?: string }>;
  status?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: {
    private?: Record<string, string | null | undefined>;
    shared?: Record<string, string | null | undefined>;
  };
};

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

const defaultDependencies: HandlerDependencies = {
  cognitoClient: new CognitoIdentityProviderClient({}),
  documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  }),
  now: () => new Date().toISOString(),
  uuid: () => randomUUID(),
  randomState: () => randomBytes(24).toString("hex"),
  fetchImpl: fetch,
};

const pendingGeocodeRequests = new Map<string, Promise<GeocodingLookupResult>>();
const nominatimMinIntervalMs = 1_000;
let nextNominatimRequestAt = 0;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });

const awaitNominatimWindow = async () => {
  const now = Date.now();
  const delay = Math.max(0, nextNominatimRequestAt - now);
  nextNominatimRequestAt = Math.max(nextNominatimRequestAt, now) + nominatimMinIntervalMs;
  if (delay > 0) {
    logHouseholdGeocodingEvent("nominatim.rate_limit_wait", {
      delayMs: delay,
    });
    await wait(delay);
  }
};

const allGroups: AppCognitoGroup[] = [
  "admin",
  "priest",
  "servant",
];

const adminManagedGroups: AdminManagedGroup[] = ["admin", "priest", "servant"];

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
];
const GOOGLE_REQUIRED_SCOPES = ["https://www.googleapis.com/auth/calendar"];

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_CALENDAR_EVENTS_URL = (calendarId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GSI1_NAME = "GSI1";
const GSI4_NAME = "GSI4";

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

const isDynamoCancellationError = (error: unknown) =>
  error instanceof Error
  && (
    error.name === "TransactionCanceledException"
    || error.name === "ConditionalCheckFailedException"
    || error.name === "CanceledError"
    || error.name === "CancelledError"
  );

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});

const html = (statusCode: number, body: string) => ({
  statusCode,
  headers: {
    "content-type": "text/html; charset=utf-8",
  },
  body,
});

const redirect = (location: string) => ({
  statusCode: 302,
  headers: {
    location,
  },
  body: "",
});

const parseBody = <T>(raw: string | undefined | null): T => {
  if (!raw) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
};

const normalizeGroupEntries = (rawGroups: unknown): string[] => {
  if (Array.isArray(rawGroups)) {
    return rawGroups.flatMap((group) => normalizeGroupEntries(group));
  }

  if (typeof rawGroups !== "string") {
    return [];
  }

  const trimmed = rawGroups.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? normalizeGroupEntries(parsed) : [];
    } catch {
      const unwrapped = trimmed.slice(1, -1).trim();
      return unwrapped
        .split(/[,\s]+/)
        .map((group) => group.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
        .filter(Boolean);
    }
  }

  return trimmed
    .split(trimmed.includes(",") ? "," : /\s+/)
    .map((group) => group.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
    .filter(Boolean);
};

const normalizeGroups = (rawGroups: unknown): AppCognitoGroup[] =>
  [...new Set(normalizeGroupEntries(rawGroups).filter((group): group is AppCognitoGroup =>
    allGroups.includes(group as AppCognitoGroup),
  ))];

const getContext = (event: APIGatewayProxyEventV2WithJWTAuthorizer): RequestContext => {
  const claims = event.requestContext.authorizer?.jwt.claims ?? {};
  const tableName = process.env.SHEPHERD_HUB_RECORDS_TABLE ?? "";

  if (!tableName) {
    throw new Error("Missing SHEPHERD_HUB_RECORDS_TABLE environment variable.");
  }

  const actorSub = typeof claims.sub === "string" ? claims.sub : "anonymous";
  const actorEmail = typeof claims.email === "string" ? claims.email : "unknown@example.com";
  const actorName = typeof claims.name === "string" ? claims.name : actorEmail;
  const tenantId =
    (typeof claims["custom:tenantId"] === "string" && claims["custom:tenantId"].trim()) ||
    (typeof claims["custom:tenant_id"] === "string" && claims["custom:tenant_id"].trim()) ||
    actorSub;

  const rawGroups = claims["cognito:groups"];
  const actorGroups = normalizeGroups(rawGroups);

  return {
    actorEmail,
    actorGroups,
    actorName,
    actorSub,
    tableName,
    tenantId,
  };
};

const tenantPk = (tenantId: string) => `TENANT#${tenantId}`;
const userPk = (userId: string) => `USER#${userId}`;
const googleConnectionSk = () => "GOOGLE_CONNECTION";
const calendarSk = (calendarId: string) => `CALENDAR#${calendarId}`;
const eventSk = (calendarId: string, eventId: string) => `EVENT#${calendarId}#${eventId}`;
const eventGsiPk = (userId: string, calendarId: string) => `USER#${userId}#CALENDAR#${calendarId}`;
const eventGsiSk = (start: string, eventId: string) => `EVENT#${start}#${eventId}`;
const memberSk = (memberId: string) => `MEMBER#${memberId}`;
const householdSk = (householdId: string) => `HOUSEHOLD#${householdId}`;
const geocodeCachePk = (addressKey: string) => `GEOCODE_CACHE#ADDRESS#${addressKey}`;
const geocodeCacheSk = () => "GEOCODE_CACHE";
const householdConflictSk = (memberId: string) => `HOUSEHOLD_CONFLICT#MEMBER#${memberId}`;
const householdConflictSkPrefix = () => "HOUSEHOLD_CONFLICT#";
const memberImportJobSk = (jobId: string) => `MEMBER_IMPORT_JOB#${jobId}`;
const memberImportJobSkPrefix = () => "MEMBER_IMPORT_JOB#";
const memberImportChunkSk = (jobId: string, chunkIndex: number) =>
  `MEMBER_IMPORT_JOB#${jobId}#CHUNK#${String(chunkIndex).padStart(6, "0")}`;
const memberImportChunkSkPrefix = (jobId: string) => `MEMBER_IMPORT_JOB#${jobId}#CHUNK#`;
const householdGeocodeJobSk = (jobId: string) => `HOUSEHOLD_GEOCODE_JOB#${jobId}`;
const householdGeocodeJobSkPrefix = () => "HOUSEHOLD_GEOCODE_JOB#";
const memberGsiPk = (tenantId: string) => `TENANT#${tenantId}#MEMBERS`;
const memberGsiSk = (normalizedName: string, memberId: string) => `NAME#${normalizedName}#MEMBER#${memberId}`;
const memberUnityGsiPk = (tenantId: string) => `TENANT#${tenantId}#UNITY`;
const memberUnityGsiSk = (unityId: string) => `UNITY#${unityId}`;
const householdGsiPk = (tenantId: string) => `TENANT#${tenantId}#HOUSEHOLDS`;
const householdGsiSk = (normalizedName: string, householdId: string) => `NAME#${normalizedName}#HOUSEHOLD#${householdId}`;
const householdAddressGsiPk = (tenantId: string) => `TENANT#${tenantId}#HOUSEHOLD_ADDRESS`;
const householdAddressGsiSk = (addressKey: string) => `ADDRESS#${addressKey}`;
const tenantEventPk = (tenantId: string, eventId: string) => `TENANT#${tenantId}#EVENT#${eventId}`;
const tenantVisitationPk = (tenantId: string, visitationId: string) => `TENANT#${tenantId}#VISITATION#${visitationId}`;
const eventMemberSk = (memberId: string) => `MEMBER#${memberId}`;
const tenantMemberPk = (tenantId: string, memberId: string) => `TENANT#${tenantId}#MEMBER#${memberId}`;
const memberEventGsiPk = (tenantId: string, memberId: string) => `TENANT#${tenantId}#MEMBER#${memberId}`;
const memberEventGsiSk = (eventStartDateTime: string, eventId: string) => `EVENT#${eventStartDateTime}#${eventId}`;
const tenantEventAssignmentGsiPk = (tenantId: string) => `TENANT#${tenantId}#EVENT_ASSIGNMENTS`;
const tenantEventAssignmentGsiSk = (eventStartDateTime: string, memberId: string, eventId: string) =>
  `EVENT#${eventStartDateTime}#MEMBER#${memberId}#EVENT#${eventId}`;
const householdMemberGsiPk = (tenantId: string, householdId: string) => `TENANT#${tenantId}#HOUSEHOLD#${householdId}`;
const householdMemberGsiSk = (normalizedName: string, memberId: string) => `NAME#${normalizedName}#MEMBER#${memberId}`;
const memberActivitySk = (createdAt: string, activityId: string) => `ACTIVITY#${createdAt}#${activityId}`;
const auditLogSk = (createdAt: string, auditId: string) => `AUDIT#${createdAt}#${auditId}`;
const visitationMemberSk = (memberId: string) => `MEMBER#${memberId}`;
const tenantVisitationGsiSk = (visitDate: string, visitorUserId: string, memberId: string, visitationId: string) =>
  `VISIT#${visitDate}#VISITOR#${visitorUserId}#MEMBER#${memberId}#VISITATION#${visitationId}`;
const memberVisitationGsiSk = (visitDate: string, visitationId: string) => `VISIT#${visitDate}#VISITATION#${visitationId}`;
const eventVisitationId = (calendarId: string, eventId: string) => `CALENDAR#${calendarId}#EVENT#${eventId}`;
const oauthStatePk = (state: string) => `OAUTH_STATE#${state}`;
const oauthStateSk = (state: string) => `OAUTH_STATE#${state}`;
const scheduleSettingsSk = () => "SCHEDULE_SETTINGS";
const bookingDayPk = (profileId: string) => `PUBLIC_BOOKING_DAY#${profileId}`;
const bookingWeekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const isAdminGroup = (group: AppCognitoGroup) => group === "admin";
const importJobChunkSize = 75;
const importJobChunksPerRequest = 2;
const importJobErrorLimit = 100;
const importJobLeaseDurationMs = 60_000;
const householdGeocodeJobLeaseDurationMs = 60_000;
const importTimingWarnThresholdMs = 200;

const defaultCalendarListRefreshThresholdMinutes = 0;
const defaultGeocodingTimeoutMs = 4_000;

const getElapsedMs = (startedAt: number) => Date.now() - startedAt;
const addMillisecondsToIso = (value: string, milliseconds: number) => new Date(Date.parse(value) + milliseconds).toISOString();

const getGeocodingConfig = (): GeocodingConfig => {
  const provider = normalizeWhitespace(process.env.GEOCODING_PROVIDER).toLowerCase() || "nominatim";
  const baseUrl = normalizeWhitespace(process.env.NOMINATIM_BASE_URL).replace(/\/+$/, "")
    || "https://nominatim.openstreetmap.org";
  const userAgent = normalizeWhitespace(process.env.NOMINATIM_USER_AGENT)
    || "ShepherdHub/0.2 (household geocoding)";
  const email = toOptionalString(process.env.NOMINATIM_EMAIL);
  const acceptLanguage = toOptionalString(process.env.NOMINATIM_ACCEPT_LANGUAGE);
  const countryCodes = toOptionalString(process.env.NOMINATIM_COUNTRY_CODES);
  const timeoutMs = Math.max(
    500,
    normalizeNonNegativeNumber(process.env.NOMINATIM_TIMEOUT_MS, defaultGeocodingTimeoutMs),
  );

  return {
    provider,
    baseUrl,
    userAgent,
    email,
    timeoutMs,
    countryCodes,
    acceptLanguage,
  };
};

const isMemberActivityLoggingEnabled = () =>
  normalizeWhitespace(process.env.ENABLE_MEMBER_ACTIVITY_LOGGING).toLowerCase() === "true";

const logImportTiming = (
  stage: string,
  startedAt: number,
  details: Record<string, unknown> = {},
) => {
  const elapsedMs = getElapsedMs(startedAt);
  if (elapsedMs < importTimingWarnThresholdMs) {
    return elapsedMs;
  }

  console.log("[member-import]", JSON.stringify({
    stage,
    elapsedMs,
    ...details,
  }));

  return elapsedMs;
};

const logImportEvent = (
  stage: string,
  details: Record<string, unknown> = {},
) => {
  console.log("[member-import]", JSON.stringify({
    stage,
    ...details,
  }));
};

const logHouseholdGeocodingEvent = (
  stage: string,
  details: Record<string, unknown> = {},
) => {
  console.log("[household-geocoding]", JSON.stringify({
    stage,
    ...details,
  }));
};

const defaultInitialSyncRange = (nowIso: string): InitialSyncRange => {
  const now = new Date(nowIso);
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  return {
    from: threeMonthsAgo.toISOString().slice(0, 10),
    to: "",
  };
};

const normalizeRefreshInterval = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60;
  }

  return Math.round(parsed);
};

const normalizeCalendarListRefreshThreshold = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultCalendarListRefreshThresholdMinutes;
  }

  if (parsed <= 0) {
    return 0;
  }

  return Math.round(parsed);
};

const isDateOnlyValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const shiftDateOnlyValue = (value: string, days: number) => {
  const [year, month, day] = value.split("-").map((segment) => Number.parseInt(segment, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const normalizeInitialSyncRange = (value: Partial<InitialSyncRange> | undefined, nowIso: string): InitialSyncRange => {
  const fallback = defaultInitialSyncRange(nowIso);
  const from = String(value?.from ?? "").trim();
  const to = String(value?.to ?? "").trim();

  if (!from || Number.isNaN(Date.parse(from))) {
    return fallback;
  }

  if (to && (Number.isNaN(Date.parse(to)) || from > to)) {
    return fallback;
  }

  return { from, to };
};

const normalizeAttendees = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry).trim())
    .filter(Boolean);
};

const normalizeMemberIds = (value: unknown) =>
  Array.isArray(value)
    ? [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))]
    : [];

const serializeGoogleMemberIds = (memberIds: string[]) => normalizeMemberIds(memberIds).join(",");

const parseGoogleMemberIds = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return normalizeMemberIds(parsed);
    }
  } catch {
    // Support plain CSV values as the stable on-wire format.
  }

  return normalizeMemberIds(normalized.split(","));
};

const normalizeWhitespace = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const stripDiacritics = (value: unknown) =>
  normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const normalizeSearchText = (...values: Array<unknown>) =>
  values
    .map((value) => normalizeWhitespace(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

const normalizeName = (value: unknown) =>
  stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();

const slugifyReadableIdPart = (value: unknown) =>
  stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildReadableHouseholdIdFromAddressKey = (addressKey: string) => {
  const [normalizedAddress, normalizedPostalCode, unit] = addressKey.split("|");
  const parts = [
    slugifyReadableIdPart(normalizedAddress),
    slugifyReadableIdPart(normalizedPostalCode),
    unit ? `unit-${slugifyReadableIdPart(unit)}` : undefined,
  ].filter(Boolean);

  return parts.length ? `addr_${parts.join("__")}` : "";
};

const normalizeEmail = (value: unknown) => normalizeWhitespace(value).toLowerCase();

const extractEmails = (...values: Array<unknown>) => {
  const found = new Set<string>();

  for (const value of values) {
    const matches = String(value ?? "").match(emailPattern) ?? [];
    for (const match of matches) {
      const normalized = normalizeEmail(match);
      if (normalized) {
        found.add(normalized);
      }
    }
  }

  return [...found];
};

const includesNormalizedName = (value: string, candidate: string) =>
  value === candidate
  || value.startsWith(`${candidate} `)
  || value.endsWith(` ${candidate}`)
  || value.includes(` ${candidate} `);

const toOptionalString = (value: unknown) => {
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
};

const defaultVisitationType: VisitationType = "Visitation";
const autoLinkInteractionPrefixes: Array<{ prefix: string; type: VisitationType }> = [
  { prefix: "visitation:", type: "Visitation" },
  { prefix: "phone call:", type: "Phone Call" },
  { prefix: "confession:", type: "Confession" },
  { prefix: "meeting:", type: "Meeting" },
];
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const normalizeVisitationType = (value: unknown): VisitationType => {
  const normalized = toOptionalString(value);
  return visitationTypes.includes(normalized as VisitationType)
    ? normalized as VisitationType
    : defaultVisitationType;
};

const toOptionalNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toOptionalBoolean = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (["true", "yes", "1", "active", "approved", "locked"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0", "inactive", "pending", "unlocked"].includes(normalized)) {
    return false;
  }

  return undefined;
};

const toIsoDate = (value: unknown) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
};

const toInitials = (fullName: string) =>
  fullName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const splitName = (fullName: string) => {
  const parts = fullName.split(" ").filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
};

const buildInitialSyncWindow = (range: InitialSyncRange) => ({
  timeMin: `${range.from}T00:00:00.000Z`,
  timeMax: range.to ? `${range.to}T23:59:59.999Z` : undefined,
});

const expandEventQueryStart = (timeMin: string) => {
  const base = new Date(timeMin);
  base.setDate(base.getDate() - 45);
  return base.toISOString();
};

const isGoogleConfigured = () =>
  Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_REDIRECT_URI?.trim(),
  );

const toConnectionSummary = (item: GoogleConnectionItem): GoogleConnectionSummary => ({
  googleAccountId: item.googleAccountId,
  email: item.email,
  scopes: item.scopes,
  status: item.status,
  connectedAt: item.connectedAt,
  lastTokenRefreshAt: item.lastTokenRefreshAt,
  tokenExpiresAt: item.tokenExpiresAt,
});

const normalizeScopeList = (scopes: string[] | undefined) =>
  [...new Set((scopes ?? []).map((scope) => String(scope).trim()).filter(Boolean))];

const hasRequiredGoogleScopes = (scopes: string[] | undefined) => {
  const normalized = new Set(normalizeScopeList(scopes));
  return GOOGLE_REQUIRED_SCOPES.every((scope) => normalized.has(scope));
};

const googleReconnectMessage =
  "Google Calendar access is missing the required calendar scope. Disconnect and reconnect Google Calendar, then approve calendar access.";
const googleReauthMessage =
  "Google Calendar connection expired or was revoked. Disconnect and reconnect Google Calendar to continue.";

const toScheduleSettings = (item?: ScheduleSettingsItem | null): ScheduleSettings => ({
  calendarListRefreshThresholdMinutes:
    item?.calendarListRefreshThresholdMinutes ?? defaultCalendarListRefreshThresholdMinutes,
});

const toScheduleCalendar = (item: CalendarItem): ScheduleCalendar => ({
  ownerUserId: item.userId,
  calendarId: item.calendarId,
  summary: item.summary,
  description: item.description,
  timeZone: item.timeZone,
  backgroundColor: item.backgroundColor,
  foregroundColor: item.foregroundColor,
  primary: item.primary,
  accessRole: item.accessRole,
  enabled: item.enabled,
  selected: item.selected,
  calendarListRefreshedAt: item.calendarListRefreshedAt,
  sync: item.sync,
  createdAt: item.createdAt,
  entityType: item.entityType,
  tenantId: item.tenantId,
  updatedAt: item.updatedAt,
});

const toScheduleEvent = (item: EventItem): ScheduleEvent => ({
  ownerUserId: item.userId,
  allDay: item.allDay,
  attendees: item.attendees,
  autoLinkedMemberIds: item.autoLinkedMemberIds,
  autoLinkedMemberNames: item.autoLinkedMemberNames,
  dismissedAutoLinkedMemberIds: item.dismissedAutoLinkedMemberIds,
  autoLinkedVisitationType: item.autoLinkedVisitationType,
  calendarColor: item.calendarColor,
  calendarId: item.calendarId,
  calendarName: item.calendarName,
  createdAt: item.createdAt,
  description: item.description,
  end: item.end,
  entityType: item.entityType,
  eventId: item.eventId,
  googleEventId: item.googleEventId,
  htmlLink: item.htmlLink,
  location: item.location,
  source: item.source,
  start: item.start,
  status: item.status,
  summary: item.summary,
  tenantId: item.tenantId,
  updatedAt: item.updatedAt,
  assignedMemberIds: item.memberIds,
  assignedMemberNames: item.memberNames,
  memberIds: item.memberIds,
  memberNames: item.memberNames,
  visitationType: item.memberIds?.length ? normalizeVisitationType(item.visitationType) : undefined,
});

const toMember = (item: MemberItem): Member => ({
  tagIds: item.tagIds ?? [],
  createdAt: item.createdAt,
  entityType: item.entityType,
  tenantId: item.tenantId,
  updatedAt: item.updatedAt,
  memberId: item.memberId,
  unityId: item.unityId,
  source: item.source,
  isUnityMember: item.isUnityMember,
  familyId: item.familyId,
  householdId: item.householdId,
  householdName: item.householdName,
  fullName: item.fullName,
  firstName: item.firstName,
  lastName: item.lastName,
  initials: item.initials,
  phone: item.phone,
  email: item.email,
  whatsappPhone: item.whatsappPhone,
  address: item.address,
  postalCode: item.postalCode,
  dateOfBirth: item.dateOfBirth,
  age: item.age,
  gender: item.gender,
  familyStatus: item.familyStatus,
  church: item.church,
  fatherOfConfession: item.fatherOfConfession,
  deaconshipRank: item.deaconshipRank,
  ordinationDate: item.ordinationDate,
  churchProvince: item.churchProvince,
  churchCity: item.churchCity,
  churchRegion: item.churchRegion,
  diocese: item.diocese,
  activated: item.activated,
  approved: item.approved,
  locked: item.locked,
  visibility: item.visibility,
  username: item.username,
  registrationDate: item.registrationDate,
  groups: item.groups,
  customFlag: item.customFlag,
  licensePlate: item.licensePlate,
  notes: item.notes,
  normalizedSearchText: item.normalizedSearchText,
});

const toMemberIndexItem = (item: MemberItem): MemberIndexItem => ({
  tagIds: item.tagIds ?? [],
  memberId: item.memberId,
  fullName: item.fullName,
  initials: item.initials,
  phone: item.phone,
  email: item.email,
  address: item.address,
  postalCode: item.postalCode,
  householdId: item.householdId,
  householdName: item.householdName,
  unityId: item.unityId,
  isUnityImported: item.source === "UNITY",
  source: item.source,
  normalizedSearchText: item.normalizedSearchText,
  updatedAt: item.updatedAt,
});

const toHouseholdSummary = (
  item: HouseholdItem,
  members: HouseholdMemberSummary[] = item.members ?? [],
): HouseholdSummary => ({
  tagIds: item.tagIds ?? [],
  createdAt: item.createdAt,
  entityType: item.entityType,
  tenantId: item.tenantId,
  updatedAt: item.updatedAt,
  householdId: item.householdId,
  householdName: item.householdName,
  address: item.address,
  postalCode: item.postalCode,
  normalizedAddress: item.normalizedAddress,
  normalizedPostalCode: item.normalizedPostalCode,
  unit: item.unit,
  addressKey: item.addressKey,
  notes: item.notes,
  location: item.location,
  areaId: resolveVisitationAreaId({ areaId: item.areaId, postalCode: item.postalCode }),
  memberCount: item.memberCount,
  primaryContactMemberId: item.primaryContactMemberId,
  members,
  normalizedSearchText: item.normalizedSearchText,
});

const toHouseholdConflict = (item: HouseholdConflictItem): HouseholdConflict => ({
  memberId: item.memberId,
  memberFullName: item.memberFullName,
  currentHouseholdId: item.currentHouseholdId,
  currentHouseholdName: item.currentHouseholdName,
  currentHouseholdAddress: item.currentHouseholdAddress,
  currentHouseholdAddressKey: item.currentHouseholdAddressKey,
  currentHouseholdGeocodeStatus: item.currentHouseholdGeocodeStatus,
  importedAddress: item.importedAddress,
  importedPostalCode: item.importedPostalCode,
  importedAddressKey: item.importedAddressKey,
  matchedHouseholdId: item.matchedHouseholdId,
  matchedHouseholdName: item.matchedHouseholdName,
  matchedHouseholdAddress: item.matchedHouseholdAddress,
  matchedHouseholdGeocodeStatus: item.matchedHouseholdGeocodeStatus,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const toEventMemberSummary = (item: EventMemberItem): EventMemberSummary => ({
  memberId: item.memberId,
  fullName: item.memberName,
  initials: toInitials(item.memberName),
  phone: item.memberPhoneSnapshot,
  email: item.memberEmailSnapshot,
  unityId: item.unityIdSnapshot,
  source: item.sourceSnapshot,
});

const toMemberVisitation = (item: VisitationItem, currentUserId: string): MemberVisitation => ({
  createdAt: item.createdAt,
  entityType: item.entityType,
  visitationId: item.visitationId,
  source: item.source,
  type: normalizeVisitationType(item.type),
  title: item.title,
  visitDate: item.visitDate,
  endDate: item.endDate,
  allDay: item.allDay,
  location: item.location,
  notes: item.notes,
  memberId: item.memberId,
  memberIds: item.memberIds,
  memberNames: item.memberNames,
  visitStatus: item.visitStatus,
  eventId: item.eventId,
  calendarEventId: item.calendarEventId,
  calendarId: item.calendarId,
  calendarOwnerUserId: item.calendarOwnerUserId,
  calendarOwnerName: item.calendarOwnerName,
  tenantId: item.tenantId,
  updatedAt: item.updatedAt,
  createdByUserId: item.createdByUserId,
  createdByName: item.createdByName,
  visitorUserId: item.visitorUserId,
  visitorDisplayName: item.visitorDisplayName,
  isOwnCalendar: item.calendarOwnerUserId === currentUserId,
});

const toMemberActivity = (item: MemberActivityItem): MemberActivity => ({
  activityId: item.activityId,
  action: item.action,
  message: item.message,
  actorUserId: item.actorUserId,
  actorDisplayName: item.actorDisplayName,
  metadata: item.metadata,
  createdAt: item.createdAt,
});

const toSyncSnapshot = (calendar: CalendarItem, result: SyncResult): CalendarSyncSnapshot => ({
  calendarId: calendar.calendarId,
  calendarName: calendar.summary,
  enabled: calendar.enabled,
  refreshed: result.refreshed,
  refreshIntervalMinutes: calendar.sync.refreshIntervalMinutes,
  requiresFullSync: calendar.sync.requiresFullSync,
  source: result.source,
  syncMode: calendar.sync.syncMode,
  lastSyncedAt: calendar.sync.lastSyncedAt,
  lastSyncError: calendar.sync.lastSyncError,
  lastSyncSource: calendar.sync.lastSyncSource,
  lastSyncStatus: calendar.sync.lastSyncStatus,
});

const validateCalendarSettings = (input: Partial<UpdateCalendarSettingsInput>) => {
  if (typeof input.showInCalendar !== "boolean") {
    return "Show in Calendar flag is required.";
  }

  if (input.syncMode !== "ALWAYS_GOOGLE" && input.syncMode !== "CACHE_UNTIL_STALE") {
    return "Sync mode must be ALWAYS_GOOGLE or CACHE_UNTIL_STALE.";
  }

  if (
    !String(input.initialSyncRange?.from ?? "").trim() ||
    Number.isNaN(Date.parse(String(input.initialSyncRange?.from))) ||
    (
      String(input.initialSyncRange?.to ?? "").trim() &&
      (
        Number.isNaN(Date.parse(String(input.initialSyncRange?.to))) ||
        String(input.initialSyncRange?.from) > String(input.initialSyncRange?.to)
      )
    )
  ) {
    return "Initial sync date range is invalid.";
  }

  if (
    !Number.isFinite(Number(input.cacheStaleThresholdMinutes)) ||
    Number(input.cacheStaleThresholdMinutes) <= 0
  ) {
    return "Refresh interval must be greater than zero.";
  }

  return null;
};

const validateScheduleSettings = (input: Partial<SaveScheduleSettingsInput>) => {
  if (
    !Number.isFinite(Number(input.calendarListRefreshThresholdMinutes)) ||
    Number(input.calendarListRefreshThresholdMinutes) < 0
  ) {
    return "Calendar list refresh threshold must be zero or greater.";
  }

  if (!Array.isArray(input.calendars)) {
    return "Calendars payload is required.";
  }

  for (const calendar of input.calendars) {
    if (!String(calendar.calendarId ?? "").trim()) {
      return "Each calendar requires a calendarId.";
    }

    const calendarError = validateCalendarSettings(calendar);
    if (calendarError) {
      return calendarError;
    }
  }

  return null;
};

const validateEventInput = (input: Partial<CreateScheduleEventInput>) => {
  if (!String(input.calendarId ?? "").trim()) {
    return "Calendar is required.";
  }

  if (!String(input.summary ?? "").trim()) {
    return "Event title is required.";
  }

  if (!String(input.start ?? "").trim() || Number.isNaN(Date.parse(String(input.start)))) {
    return "A valid start date is required.";
  }

  if (!String(input.end ?? "").trim() || Number.isNaN(Date.parse(String(input.end)))) {
    return "A valid end date is required.";
  }

  if (new Date(String(input.end)).getTime() <= new Date(String(input.start)).getTime()) {
    return "End time must be after start time.";
  }

  return null;
};

const validateEventUpdateInput = (input: Partial<UpdateScheduleEventInput>) => {
  if (!String(input.calendarId ?? "").trim()) {
    return "Calendar is required.";
  }

  if (input.summary !== undefined && !String(input.summary).trim()) {
    return "Event title is required.";
  }

  if (input.start !== undefined && (typeof input.start !== "string" || Number.isNaN(Date.parse(input.start)))) {
    return "A valid start date is required.";
  }

  if (input.end !== undefined && (typeof input.end !== "string" || Number.isNaN(Date.parse(input.end)))) {
    return "A valid end date is required.";
  }

  if (input.start && input.end && new Date(input.end).getTime() <= new Date(input.start).getTime()) {
    return "End time must be after start time.";
  }

  return null;
};

const validateMemberInput = (input: Partial<CreateMemberInput>) => {
  if (!normalizeWhitespace(input.fullName)) {
    return "Member full name is required.";
  }

  return null;
};

const householdNameMaxLength = 120;
const householdAddressMaxLength = 240;
const householdNotesMaxLength = 2000;
const householdAreaIdMaxLength = 120;
const householdGeocodeProviderMaxLength = 120;

const normalizeHouseholdGeocodeStatus = (value: unknown): HouseholdGeocodeStatus | undefined => {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return normalized === "not_started"
    || normalized === "pending"
    || normalized === "success"
    || normalized === "failed"
    ? normalized
    : undefined;
};

const toOptionalCoordinate = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
};

const normalizeHouseholdLocation = (value: unknown): HouseholdLocation | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const location = value as Record<string, unknown>;
  const hasLatitude = location.latitude !== undefined && location.latitude !== null && location.latitude !== "";
  const hasLongitude = location.longitude !== undefined && location.longitude !== null && location.longitude !== "";
  const latitude = toOptionalCoordinate(location.latitude);
  const longitude = toOptionalCoordinate(location.longitude);
  const geocodeStatus = normalizeHouseholdGeocodeStatus(location.geocodeStatus);
  const geocodedAt = toOptionalString(location.geocodedAt);
  const geocodeProvider = toOptionalString(location.geocodeProvider);

  if (!hasLatitude && !hasLongitude && !geocodeStatus && !geocodedAt && !geocodeProvider) {
    return undefined;
  }

  return {
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(geocodeStatus !== undefined ? { geocodeStatus } : {}),
    ...(geocodedAt !== undefined ? { geocodedAt } : {}),
    ...(geocodeProvider !== undefined ? { geocodeProvider } : {}),
  };
};

const validateHouseholdInput = (input: Partial<CreateHouseholdInput | UpdateHouseholdInput>) => {
  const householdName = normalizeWhitespace(input.householdName);
  if (!householdName) {
    return "Household name is required.";
  }

  if (householdName.length > householdNameMaxLength) {
    return `Household name must be ${householdNameMaxLength} characters or fewer.`;
  }

  const address = normalizeWhitespace(input.address);
  if (address.length > householdAddressMaxLength) {
    return `Address must be ${householdAddressMaxLength} characters or fewer.`;
  }

  const notes = normalizeWhitespace(input.notes);
  if (notes.length > householdNotesMaxLength) {
    return `Notes must be ${householdNotesMaxLength} characters or fewer.`;
  }

  const areaId = normalizeWhitespace(input.areaId);
  if (areaId.length > householdAreaIdMaxLength) {
    return `Area ID must be ${householdAreaIdMaxLength} characters or fewer.`;
  }

  const location = normalizeHouseholdLocation(input.location);
  if (input.location && !location) {
    return "Household location must include coordinates or geocode metadata.";
  }

  if (location) {
    const hasLatitude = location.latitude !== undefined;
    const hasLongitude = location.longitude !== undefined;

    if (hasLatitude !== hasLongitude) {
      return "Household location must include both latitude and longitude.";
    }

    if (hasLatitude && (!Number.isFinite(location.latitude!) || location.latitude! < -90 || location.latitude! > 90)) {
      return "Latitude must be between -90 and 90.";
    }

    if (hasLongitude && (!Number.isFinite(location.longitude!) || location.longitude! < -180 || location.longitude! > 180)) {
      return "Longitude must be between -180 and 180.";
    }

    if (input.location?.geocodeStatus !== undefined && !location.geocodeStatus) {
      return "Geocode status must be not_started, pending, success, or failed.";
    }

    if (location.geocodedAt && Number.isNaN(Date.parse(location.geocodedAt))) {
      return "Geocoded date must be a valid ISO date.";
    }

    if ((location.geocodeProvider?.length ?? 0) > householdGeocodeProviderMaxLength) {
      return `Geocode provider must be ${householdGeocodeProviderMaxLength} characters or fewer.`;
    }
  }

  const memberIds = normalizeMemberIds(input.memberIds);
  if (Array.isArray(input.memberIds) && memberIds.length !== input.memberIds.filter(Boolean).length) {
    return "Duplicate household member IDs are not allowed.";
  }

  if (input.primaryContactMemberId && !memberIds.includes(String(input.primaryContactMemberId).trim())) {
    return "Primary contact must be a household member.";
  }

  return null;
};

const validateManualVisitationInput = (
  input: Partial<CreateManualVisitationInput | UpdateManualVisitationInput>,
) => {
  if (!toOptionalString(input.title)) {
    return "Visit title is required.";
  }

  if (!toOptionalString(input.visitDate) || Number.isNaN(Date.parse(String(input.visitDate)))) {
    return "Visit date and time is required.";
  }

  if (!normalizeMemberIds(input.memberIds).length) {
    return "Select at least one member.";
  }

  const visitorUserId = toOptionalString(input.visitorUserId);
  const visitorDisplayName = toOptionalString(input.visitorDisplayName);
  if ((visitorUserId && !visitorDisplayName) || (!visitorUserId && visitorDisplayName)) {
    return "Choose a valid visitor.";
  }

  return null;
};

const normalizePageNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeNonNegativeNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeReportSortBy = (value: string | undefined): ReportsSortBy =>
  value === "member_name" || value === "visit_count" || value === "last_visit_date"
    ? value
    : "last_visit_date";

const normalizeReportSortDirection = (value: string | undefined): ReportsSortDirection =>
  value === "asc" || value === "desc" ? value : "asc";

const normalizeReportVisitCountMode = (value: string | undefined): ReportsVisitCountMode =>
  value === "all" || value === "gt" || value === "lte" || value === "not_visited"
    ? value
    : "all";

const normalizeReportVisitorMode = (value: string | undefined): ReportsVisitorFilterMode =>
  value === "me_only" || value === "exclude_me" || value === "specific" || value === "any"
    ? value
    : "any";

const normalizeReportMemberScope = (value: string | undefined): ReportsMemberScope =>
  value === "active_only" || value === "all_members" ? value : "active_only";

const normalizeReportMemberSource = (value: string | undefined): ReportsMemberSourceFilter =>
  value === "manual" || value === "unity" || value === "all" ? value : "all";

const normalizeReportVisitationType = (value: string | undefined): ReportsVisitationTypeFilter =>
  value === "all" || visitationTypes.includes(value as VisitationType)
    ? (value as ReportsVisitationTypeFilter)
    : "all";

const normalizeReportStatusFilter = (value: string | undefined): ReportsMemberStatusFilter =>
  value === "all"
  || value === "never_visited"
  || value === "not_visited_recently"
  || value === "low_visitation"
  || value === "visited"
    ? value
    : "all";

const startOfCurrentYear = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setMonth(0, 1);
  return date.toISOString();
};

const startOfCurrentMonth = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date.toISOString();
};

const startOfCurrentWeek = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  return date.toISOString();
};

const parseVisitationReportFilters = (event: APIGatewayProxyEventV2WithJWTAuthorizer): VisitationReportFilters => {
  const params = event.queryStringParameters ?? {};
  const from = typeof params.from === "string" && !Number.isNaN(Date.parse(params.from))
    ? params.from
    : undefined;
  const to = typeof params.to === "string" && !Number.isNaN(Date.parse(params.to))
    ? params.to
    : undefined;
  const sinceBeginning = params.sinceBeginning === "true";
  const visitCountMode = normalizeReportVisitCountMode(params.visitCountMode);
  const visitorMode = normalizeReportVisitorMode(params.visitorMode);
  const visitorUserId = visitorMode === "specific" ? toOptionalString(params.visitorUserId) : undefined;

  return {
    ...parseTagFilters(params),
    householdTagIds: parseTagIds(params.householdTagIds?.split(",").filter(Boolean)),
    householdTagMatchMode: parseTagMode(params.householdTagMatchMode),
    from: sinceBeginning ? undefined : (from ?? startOfCurrentYear()),
    to: sinceBeginning ? undefined : to,
    sinceBeginning,
    visitCountMode,
    visitCountThreshold: normalizeNonNegativeNumber(params.visitCountThreshold, 1),
    visitorMode,
    visitorUserId,
    memberScope: normalizeReportMemberScope(params.memberScope),
    memberSource: normalizeReportMemberSource(params.memberSource),
    type: normalizeReportVisitationType(params.type),
    status: normalizeReportStatusFilter(params.status),
    group: toOptionalString(params.group),
    search: toOptionalString(params.search),
    sortBy: normalizeReportSortBy(params.sortBy),
    sortDirection: normalizeReportSortDirection(params.sortDirection),
    page: normalizePageNumber(params.page, 1),
    pageSize: Math.min(100, normalizePageNumber(params.pageSize, 25)),
  };
};

const matchesReportVisitorFilter = (
  item: VisitationItem,
  filters: VisitationReportFilters,
  currentUserId: string,
) => {
  if (filters.visitorMode === "me_only") {
    return item.visitorUserId === currentUserId;
  }

  if (filters.visitorMode === "exclude_me") {
    return item.visitorUserId !== currentUserId;
  }

  if (filters.visitorMode === "specific") {
    return item.visitorUserId === filters.visitorUserId;
  }

  return true;
};

const parseImportWorkbook = async (input: MemberImportInput) => {
  const rows = await readSheet(Buffer.from(input.workbookBase64, "base64"));

  const headerRowIndex = rows.findIndex((row) => {
    const values = Array.isArray(row) ? row.map((cell) => normalizeWhitespace(cell)) : [];
    return values.includes("Member ID") && values.includes("Member Name");
  });

  if (headerRowIndex < 0) {
    return [];
  }

  const headerRow = rows[headerRowIndex] ?? [];
  const headers = Array.isArray(headerRow)
    ? headerRow.map((cell, index) => normalizeWhitespace(cell) || `Column ${index + 1}`)
    : [];

  return rows
    .slice(headerRowIndex + 1)
    .map((row, index) => ({ row, rowNumber: headerRowIndex + index + 2 }))
    .filter(({ row }) => Array.isArray(row) && row.some((cell) => normalizeWhitespace(cell)))
    .map(({ row, rowNumber }) => {
      const values = Array.isArray(row) ? row : [];
      const record = headers.reduce<Record<string, unknown>>((next, header, index) => {
        next[header] = normalizeImportWorkbookCellValue(values[index]);
        return next;
      }, {});

      return {
        rowNumber,
        values: record,
      };
    });
};

const normalizeImportWorkbookCellValue = (value: unknown) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value ?? "";
};

const chunkItems = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const emptyImportResult = (): MemberImportResult => ({
  created: 0,
  updated: 0,
  skipped: 0,
  householdsCreated: 0,
  householdsMatched: 0,
  membersAssignedToHouseholds: 0,
  membersWithoutHouseholds: 0,
  householdConflicts: 0,
  errorCount: 0,
  errors: [],
});

const mergeImportErrors = (
  current: MemberImportResult["errors"],
  additions: MemberImportResult["errors"],
) => [...current, ...additions].slice(0, importJobErrorLimit);

const toMemberImportJob = (item: MemberImportJobItem): MemberImportJob => ({
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  entityType: item.entityType,
  tenantId: item.tenantId,
  jobId: item.jobId,
  fileName: item.fileName,
  status: item.status,
  totalRows: item.totalRows,
  processedRows: item.processedRows,
  totalChunks: item.totalChunks,
  processedChunks: item.processedChunks,
  startedAt: item.startedAt,
  completedAt: item.completedAt,
  result: item.result,
});

const toHouseholdGeocodeJob = (item: HouseholdGeocodeJobItem): HouseholdGeocodeJob => ({
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  entityType: item.entityType,
  tenantId: item.tenantId,
  jobId: item.jobId,
  mode: item.mode,
  status: item.status,
  total: item.total,
  processed: item.processed,
  success: item.success,
  failed: item.failed,
  remaining: item.remaining,
  startedAt: item.startedAt,
  completedAt: item.completedAt,
  lastProcessedHouseholdId: item.lastProcessedHouseholdId,
  lastProcessedAddressKey: item.lastProcessedAddressKey,
  lastFailureReason: item.lastFailureReason,
});

const putItemsInBatches = async (
  documentClient: Pick<DynamoDBDocumentClient, "send">,
  tableName: string,
  items: Record<string, unknown>[],
) => {
  for (const batch of chunkItems(items, 25)) {
    await documentClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((Item) => ({
            PutRequest: { Item },
          })),
        },
      }),
    );
  }
};

const deleteKeysInBatches = async (
  documentClient: Pick<DynamoDBDocumentClient, "send">,
  tableName: string,
  keys: Array<{ PK: string; SK: string }>,
) => {
  for (const batch of chunkItems(keys, 25)) {
    await documentClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((Key) => ({
            DeleteRequest: { Key },
          })),
        },
      }),
    );
  }
};

const transactWriteInChunks = async (
  documentClient: Pick<DynamoDBDocumentClient, "send">,
  transactItems: Array<Record<string, unknown>>,
) => {
  for (const batch of chunkItems(transactItems, 25)) {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: batch,
      }),
    );
  }
};

const queryAll = async (
  documentClient: Pick<DynamoDBDocumentClient, "send">,
  input: ConstructorParameters<typeof QueryCommand>[0],
) => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await documentClient.send(
      new QueryCommand({
        ...input,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...(response.Items ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

const encodeCursor = (value: Record<string, unknown> | undefined) =>
  value ? Buffer.from(JSON.stringify(value), "utf8").toString("base64") : undefined;

const decodeCursor = (value: string | undefined) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid pagination cursor.");
  }
};

const queryPage = async (
  documentClient: Pick<DynamoDBDocumentClient, "send">,
  input: ConstructorParameters<typeof QueryCommand>[0],
) => documentClient.send(new QueryCommand(input));

const queryCount = async (
  documentClient: Pick<DynamoDBDocumentClient, "send">,
  input: ConstructorParameters<typeof QueryCommand>[0],
) => {
  let count = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await documentClient.send(
      new QueryCommand({
        ...input,
        ExclusiveStartKey: exclusiveStartKey,
        Select: "COUNT",
      }),
    );

    count += response.Count ?? 0;
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return count;
};

const scanAll = async (
  documentClient: Pick<DynamoDBDocumentClient, "send">,
  input: ConstructorParameters<typeof ScanCommand>[0],
) => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await documentClient.send(
      new ScanCommand({
        ...input,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...(response.Items ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

const hasMatchingTenant = (context: RequestContext, item?: { tenantId?: string } | null) =>
  item?.tenantId === context.tenantId;

const getUserPoolId = () => {
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  if (!userPoolId) {
    throw new Error("Missing COGNITO_USER_POOL_ID environment variable.");
  }

  return userPoolId;
};

const listAttributeMap = (attributes: Array<{ Name?: string; Value?: string }> | undefined) =>
  new Map((attributes ?? []).map((attribute) => [attribute.Name ?? "", attribute.Value ?? ""]));

const logAuditEvent = async (
  context: RequestContext,
  actionType: string,
  resultStatus: AuditLogItem["resultStatus"],
  deps: HandlerDependencies,
  options: {
    deletionCounts?: Record<string, number>;
    metadata?: Record<string, unknown>;
    targetUserId?: string;
    targetUsername?: string;
  } = {},
) => {
  const createdAt = deps.now();
  const auditId = deps.uuid();
  const item: AuditLogItem = {
    PK: tenantPk(context.tenantId),
    SK: auditLogSk(createdAt, auditId),
    createdAt,
    updatedAt: createdAt,
    entityType: "AUDIT_LOG",
    tenantId: context.tenantId,
    auditId,
    actionType,
    actorUserId: context.actorSub,
    actorEmail: context.actorEmail,
    actorDisplayName: context.actorName,
    targetUserId: options.targetUserId,
    targetUsername: options.targetUsername,
    resultStatus,
    deletionCounts: options.deletionCounts,
    metadata: options.metadata,
  };

  await deps.documentClient.send(
    new PutCommand({
      Item: item,
      TableName: context.tableName,
    }),
  );
};

const requireAdminContext = async (
  context: RequestContext,
  deps: HandlerDependencies,
  actionType: string,
) => {
  if (context.actorGroups.some(isAdminGroup)) {
    return;
  }

  const actorGroups = await getActorGroups(context, deps);
  if (actorGroups.some(isAdminGroup)) {
    return;
  }

  await logAuditEvent(context, actionType, "failed", deps, {
    metadata: {
      reason: "forbidden",
      actorGroups,
    },
  });
  throw new HttpError(403, "Admin access is required.");
};

const getActorGroups = async (context: RequestContext, deps: HandlerDependencies): Promise<AppCognitoGroup[]> => {
  try {
    const filters = [
      `sub = "${escapeCognitoFilterValue(context.actorSub)}"`,
      context.actorEmail !== "unknown@example.com" ? `email = "${escapeCognitoFilterValue(context.actorEmail)}"` : "",
    ].filter(Boolean);

    for (const filter of filters) {
      const response = await deps.cognitoClient.send(
        new ListUsersCommand({
          UserPoolId: getUserPoolId(),
          Filter: filter,
          Limit: 1,
        }),
      );

      const username = response.Users?.[0]?.Username;
      if (!username) {
        continue;
      }

      const groupsResponse = await deps.cognitoClient.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: getUserPoolId(),
          Username: username,
        }),
      );

      return normalizeGroups((groupsResponse.Groups ?? []).map((group) => group.GroupName ?? ""));
    }
  } catch {
    return context.actorGroups;
  }

  return context.actorGroups;
};

const escapeCognitoFilterValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const toTenantUserSummary = (
  username: string,
  attributes: Array<{ Name?: string; Value?: string }> | undefined,
  groups: AppCognitoGroup[],
  enabled = true,
  status?: string,
): TenantUserSummary => {
  const attributeMap = listAttributeMap(attributes);
  const email = attributeMap.get("email")?.trim() || username;
  const name = attributeMap.get("name")?.trim() || email;
  const tenantId = attributeMap.get("custom:tenantId")?.trim() || attributeMap.get("custom:tenant_id")?.trim() || "";
  const sub = attributeMap.get("sub")?.trim() || username;

  return {
    username,
    sub,
    email,
    name,
    tenantId,
    enabled,
    status,
    groups,
  };
};

const getTenantUser = async (context: RequestContext, username: string, deps: HandlerDependencies) => {
  const response = await deps.cognitoClient.send(
    new AdminGetUserCommand({
      UserPoolId: getUserPoolId(),
      Username: username,
    }),
  );
  const groupsResponse = await deps.cognitoClient.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: getUserPoolId(),
      Username: username,
    }),
  );
  const user = toTenantUserSummary(
    response.Username ?? username,
    response.UserAttributes,
    normalizeGroups((groupsResponse.Groups ?? []).map((group) => group.GroupName ?? "")),
    true,
    response.UserStatus,
  );

  if (user.tenantId !== context.tenantId) {
    throw new HttpError(404, "User not found in this tenant.");
  }

  return user;
};

const listTenantUsers = async (context: RequestContext, deps: HandlerDependencies) => {
  const users: TenantUserSummary[] = [];
  let paginationToken: string | undefined;

  do {
    const response = await deps.cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: getUserPoolId(),
        PaginationToken: paginationToken,
      }),
    );

    for (const entry of response.Users ?? []) {
      const username = entry.Username ?? "";
      if (!username) {
        continue;
      }
      const groupResponse = await deps.cognitoClient.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: getUserPoolId(),
          Username: username,
        }),
      );
      users.push(
        toTenantUserSummary(
          username,
          entry.Attributes,
          normalizeGroups((groupResponse.Groups ?? []).map((group) => group.GroupName ?? "")),
          Boolean(entry.Enabled),
          entry.UserStatus,
        ),
      );
    }

    paginationToken = response.PaginationToken;
  } while (paginationToken);

  return users
    .filter((user) => user.tenantId === context.tenantId)
    .sort((left, right) => left.name.localeCompare(right.name) || left.email.localeCompare(right.email));
};

const deleteItemsInBatches = async (
  context: RequestContext,
  keys: Array<{ PK: string; SK: string }>,
  deps: HandlerDependencies,
) => {
  let deleted = 0;
  for (let index = 0; index < keys.length; index += 25) {
    let pendingKeys = keys.slice(index, index + 25);
    if (!pendingKeys.length) {
      continue;
    }

    do {
      const response = await deps.documentClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [context.tableName]: pendingKeys.map((key) => ({
              DeleteRequest: {
                Key: key,
              },
            })),
          },
        }),
      );

      const unprocessed = (response.UnprocessedItems?.[context.tableName] ?? [])
        .map((request) => request.DeleteRequest?.Key)
        .filter(Boolean) as Array<{ PK: string; SK: string }>;
      deleted += pendingKeys.length - unprocessed.length;
      pendingKeys = unprocessed;
    } while (pendingKeys.length);
  }

  return deleted;
};

const getGoogleConnection = async (context: RequestContext, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: googleConnectionSk(),
      },
      TableName: context.tableName,
    }),
  );

  const item = (response.Item as GoogleConnectionItem | undefined) ?? null;
  return hasMatchingTenant(context, item) ? item : null;
};

const getScheduleSettings = async (context: RequestContext, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: scheduleSettingsSk(),
      },
      TableName: context.tableName,
    }),
  );

  const item = (response.Item as ScheduleSettingsItem | undefined) ?? null;
  return hasMatchingTenant(context, item) ? item : null;
};

const putScheduleSettings = async (
  context: RequestContext,
  settings: ScheduleSettingsItem,
  deps: HandlerDependencies,
) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: settings,
      TableName: context.tableName,
    }),
  );

  return settings;
};

const putGoogleConnection = async (
  context: RequestContext,
  connection: GoogleConnectionItem,
  deps: HandlerDependencies,
) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: connection,
      TableName: context.tableName,
    }),
  );

  return connection;
};

const markGoogleConnectionScopeError = async (
  context: RequestContext,
  connection: GoogleConnectionItem,
  deps: HandlerDependencies,
) => {
  const failedConnection: GoogleConnectionItem = {
    ...connection,
    status: "error",
    updatedAt: deps.now(),
  };

  await putGoogleConnection(context, failedConnection, deps);
  return failedConnection;
};

const markGoogleConnectionError = async (
  context: RequestContext,
  connection: GoogleConnectionItem,
  deps: HandlerDependencies,
  status: GoogleConnectionItem["status"] = "error",
) => {
  const failedConnection: GoogleConnectionItem = {
    ...connection,
    status,
    updatedAt: deps.now(),
  };

  await putGoogleConnection(context, failedConnection, deps);
  return failedConnection;
};

const isGoogleRefreshTokenInvalid = (details: string) =>
  details.includes("invalid_grant") ||
  details.includes("expired or revoked") ||
  details.includes("Token has been expired or revoked");

const deleteGoogleConnection = async (context: RequestContext, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new DeleteCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: googleConnectionSk(),
      },
      TableName: context.tableName,
    }),
  );
};

const listCalendars = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": userPk(context.actorSub),
      ":calendarPrefix": "CALENDAR#",
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :calendarPrefix)",
    TableName: context.tableName,
  });

  return (items as CalendarItem[]).filter((item) => hasMatchingTenant(context, item)).sort((left, right) => {
    if (left.primary !== right.primary) {
      return left.primary ? -1 : 1;
    }

    return left.summary.localeCompare(right.summary);
  });
};

const getCalendar = async (context: RequestContext, calendarId: string, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: calendarSk(calendarId),
      },
      TableName: context.tableName,
    }),
  );

  const item = (response.Item as CalendarItem | undefined) ?? null;
  return hasMatchingTenant(context, item) ? item : null;
};

const getEvent = async (
  context: RequestContext,
  calendarId: string,
  eventId: string,
  deps: HandlerDependencies,
) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: eventSk(calendarId, eventId),
      },
      TableName: context.tableName,
    }),
  );

  const item = (response.Item as EventItem | undefined) ?? null;
  return hasMatchingTenant(context, item) ? item : null;
};

const putCalendar = async (context: RequestContext, calendar: CalendarItem, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: calendar,
      TableName: context.tableName,
    }),
  );

  return calendar;
};

const listEventsForCalendar = async (
  context: RequestContext,
  calendarId: string,
  timeMin: string,
  timeMax: string | undefined,
  deps: HandlerDependencies,
) => {
  const queryStart = expandEventQueryStart(timeMin);
  const queryEnd = timeMax ?? "9999-12-31T23:59:59.999Z";
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI1PK",
      "#gsiSk": "GSI1SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": eventGsiPk(context.actorSub, calendarId),
      ":from": `EVENT#${queryStart}`,
      ":to": `EVENT#${queryEnd}~`,
    },
    IndexName: GSI1_NAME,
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return (items as EventItem[]).filter(
    (item) =>
      hasMatchingTenant(context, item) &&
      item.end >= timeMin &&
      (!timeMax || item.start <= timeMax),
  );
};

const listAllEventsForCalendar = async (context: RequestContext, calendarId: string, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": userPk(context.actorSub),
      ":eventPrefix": `EVENT#${calendarId}#`,
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :eventPrefix)",
    TableName: context.tableName,
  });

  return (items as EventItem[]).filter((item) => hasMatchingTenant(context, item));
};

const putEvent = async (context: RequestContext, event: EventItem, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: event,
      TableName: context.tableName,
    }),
  );
};

const persistEventWithMemberAssignments = async (
  context: RequestContext,
  event: EventItem,
  deps: HandlerDependencies,
  options: {
    autoLinkedMembers?: MemberItem[];
    visitationTypeOverride?: VisitationType;
  } = {},
) => {
  const normalizedEvent: EventItem = {
    ...event,
    updatedAt: deps.now(),
  };
  const assignedMembers = await syncEventMembers(context, normalizedEvent, normalizedEvent.memberIds ?? [], deps);
  const visitationMembers = [...new Map(
    [...assignedMembers, ...(options.autoLinkedMembers ?? [])].map((member) => [member.memberId, member]),
  ).values()];
  const persistedEvent: EventItem = {
    ...normalizedEvent,
    memberIds: assignedMembers.map((member) => member.memberId),
    memberNames: assignedMembers.map((member) => member.fullName),
    dismissedAutoLinkedMemberIds: normalizeMemberIds(normalizedEvent.dismissedAutoLinkedMemberIds),
    visitationType: assignedMembers.length ? normalizeVisitationType(normalizedEvent.visitationType) : undefined,
  };
  await putEvent(context, persistedEvent, deps);
  await syncVisitationRecords(
    context,
    persistedEvent,
    visitationMembers,
    options.visitationTypeOverride,
    deps,
  );
  return persistedEvent;
};

const deleteEvent = async (
  context: RequestContext,
  userId: string,
  calendarId: string,
  eventId: string,
  deps: HandlerDependencies,
) => {
  await deps.documentClient.send(
    new DeleteCommand({
      Key: {
        PK: userPk(userId),
        SK: eventSk(calendarId, eventId),
      },
      TableName: context.tableName,
    }),
  );
};

const getMember = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: memberSk(memberId),
      },
      TableName: context.tableName,
    }),
  );

  return (response.Item as MemberItem | undefined) ?? null;
};

const getMemberByUnityId = async (context: RequestContext, unityId: string, deps: HandlerDependencies) => {
  const response = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI2PK",
      "#gsiSk": "GSI2SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": memberUnityGsiPk(context.tenantId),
      ":gsiSk": memberUnityGsiSk(unityId),
    },
    IndexName: "GSI2",
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk = :gsiSk",
    TableName: context.tableName,
  });

  return (response[0] as MemberItem | undefined) ?? null;
};

const listMembersByUnityId = async (context: RequestContext, unityId: string, deps: HandlerDependencies) => {
  const response = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI2PK",
      "#gsiSk": "GSI2SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": memberUnityGsiPk(context.tenantId),
      ":gsiSk": memberUnityGsiSk(unityId),
    },
    IndexName: "GSI2",
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk = :gsiSk",
    TableName: context.tableName,
  });

  return response as MemberItem[];
};

const getHousehold = async (context: RequestContext, householdId: string, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: householdSk(householdId),
      },
      TableName: context.tableName,
    }),
  );

  return (response.Item as HouseholdItem | undefined) ?? null;
};

const getHouseholdByAddressKey = async (
  context: RequestContext,
  addressKey: string,
  deps: HandlerDependencies,
) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI2PK",
      "#gsiSk": "GSI2SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": householdAddressGsiPk(context.tenantId),
      ":gsiSk": householdAddressGsiSk(addressKey),
    },
    IndexName: "GSI2",
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk = :gsiSk",
    TableName: context.tableName,
  });

  return (items[0] as HouseholdItem | undefined) ?? null;
};

const listMembersByHouseholdId = async (
  context: RequestContext,
  householdId: string,
  deps: HandlerDependencies,
) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI5PK",
      "#gsiSk": "GSI5SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": householdMemberGsiPk(context.tenantId, householdId),
      ":from": "NAME#",
      ":to": "NAME#~",
    },
    IndexName: "GSI5",
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return items as MemberItem[];
};

const listHouseholds = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI4PK",
      "#gsiSk": "GSI4SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": householdGsiPk(context.tenantId),
      ":from": "NAME#",
      ":to": "NAME#~",
    },
    IndexName: GSI4_NAME,
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return items as HouseholdItem[];
};

const upsertHouseholdInImportState = (state: ImportExecutionState | undefined, household: HouseholdItem) => {
  if (!state) {
    return;
  }

  const previous = state.householdsById.get(household.householdId);
  if (previous?.addressKey) {
    state.householdsByAddressKey.delete(previous.addressKey);
  }

  state.householdsById.set(household.householdId, household);
  if (household.addressKey) {
    state.householdsByAddressKey.set(household.addressKey, household);
  }
};

const buildHouseholdSearchText = (
  householdName: string,
  address: string | undefined,
  notes: string | undefined,
  members: Array<Pick<MemberItem, "fullName">>,
) => normalizeSearchText(
  householdName,
  address,
  notes,
  ...members.map((member) => member.fullName),
);

const buildHouseholdItem = (
  context: RequestContext,
  householdId: string,
  input: Pick<CreateHouseholdInput, "householdName" | "address" | "postalCode" | "notes" | "primaryContactMemberId" | "location" | "areaId" | "tagIds">,
  members: MemberItem[],
  deps: HandlerDependencies,
  existing?: HouseholdItem | null,
): HouseholdItem => {
  const householdName = normalizeWhitespace(input.householdName);
  const address = toOptionalString(input.address);
  const postalCode = toOptionalString(input.postalCode) ?? existing?.postalCode;
  const location = normalizeHouseholdLocation(input.location) ?? existing?.location;
  const areaId = resolveVisitationAreaId({
    areaId: toOptionalString(input.areaId) ?? existing?.areaId,
    postalCode,
  });
  const normalized = normalizeAddress({
    address,
    postalCode,
  });
  const notes = toOptionalString(input.notes);
  const memberSummaries: HouseholdMemberSummary[] = members
    .map((member) => ({
      memberId: member.memberId,
      fullName: member.fullName,
      initials: member.initials,
      phone: member.phone,
      email: member.email,
      householdId,
      householdName,
    }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
  const timestamp = deps.now();

  return {
    PK: tenantPk(context.tenantId),
    SK: householdSk(householdId),
    GSI4PK: householdGsiPk(context.tenantId),
    GSI4SK: householdGsiSk(normalizeName(householdName), householdId),
    GSI2PK: normalized.addressKey ? householdAddressGsiPk(context.tenantId) : undefined,
    GSI2SK: normalized.addressKey ? householdAddressGsiSk(normalized.addressKey) : undefined,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    tagIds: input.tagIds ?? existing?.tagIds,
    entityType: "HOUSEHOLD",
    tenantId: context.tenantId,
    householdId,
    householdName,
    address,
    postalCode,
    normalizedAddress: normalized.normalizedAddress,
    normalizedPostalCode: normalized.normalizedPostalCode,
    unit: normalized.unit,
    addressKey: normalized.addressKey,
    notes,
    location,
    areaId,
    memberCount: memberSummaries.length,
    primaryContactMemberId: toOptionalString(input.primaryContactMemberId),
    members: memberSummaries,
    normalizedSearchText: buildHouseholdSearchText(householdName, address, notes, members),
  };
};

const getGeocodeCache = async (addressKey: string, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: geocodeCachePk(addressKey),
        SK: geocodeCacheSk(),
      },
      TableName: process.env.SHEPHERD_HUB_RECORDS_TABLE ?? "",
    }),
  );

  const item = response.Item as GeocodeCacheItem | undefined;
  const cacheItem = item?.entityType === "GEOCODE_CACHE" ? item : null;
  logHouseholdGeocodingEvent("cache.lookup", {
    addressKey,
    hit: Boolean(cacheItem),
    ...(cacheItem ? {
      cachedAt: cacheItem.geocodedAt ?? cacheItem.updatedAt,
      cachedFailureReason: cacheItem.failureReason,
      cachedStatus: cacheItem.geocodeStatus,
      geocodeProvider: cacheItem.geocodeProvider,
    } : {}),
  });
  return cacheItem;
};

const putGeocodeCache = async (
  query: GeocodingQuery,
  result: GeocodingLookupResult,
  deps: HandlerDependencies,
) => {
  logHouseholdGeocodingEvent("cache.store", {
    addressKey: query.addressKey,
    failureReason: result.geocodeStatus === "failed" ? result.failureReason : undefined,
    geocodedAt: result.geocodedAt,
    geocodeProvider: result.geocodeProvider,
    geocodeStatus: result.geocodeStatus,
    latitude: result.geocodeStatus === "success" ? result.latitude : undefined,
    longitude: result.geocodeStatus === "success" ? result.longitude : undefined,
  });
  await deps.documentClient.send(
    new PutCommand({
      Item: {
        PK: geocodeCachePk(query.addressKey),
        SK: geocodeCacheSk(),
        createdAt: result.geocodedAt,
        updatedAt: result.geocodedAt,
        entityType: "GEOCODE_CACHE",
        addressKey: query.addressKey,
        normalizedAddress: query.normalizedAddress,
        normalizedPostalCode: query.normalizedPostalCode,
        geocodeStatus: result.geocodeStatus,
        latitude: result.geocodeStatus === "success" ? result.latitude : undefined,
        longitude: result.geocodeStatus === "success" ? result.longitude : undefined,
        geocodedAt: result.geocodedAt,
        geocodeProvider: result.geocodeProvider,
        failureReason: result.geocodeStatus === "failed" ? result.failureReason : undefined,
      } satisfies GeocodeCacheItem,
      TableName: process.env.SHEPHERD_HUB_RECORDS_TABLE ?? "",
    }),
  );
};

const toHouseholdLocationFromLookup = (result: GeocodingLookupResult): HouseholdLocation => (
  result.geocodeStatus === "success"
    ? {
      latitude: result.latitude,
      longitude: result.longitude,
      geocodeStatus: result.geocodeStatus,
      geocodedAt: result.geocodedAt,
      geocodeProvider: result.geocodeProvider,
    }
    : {
      geocodeStatus: result.geocodeStatus,
      geocodedAt: result.geocodedAt,
      geocodeProvider: result.geocodeProvider,
    }
);

const toGeocodingLookupFromCache = (item: GeocodeCacheItem): GeocodingLookupResult => (
  item.geocodeStatus === "success"
  && Number.isFinite(item.latitude)
  && Number.isFinite(item.longitude)
  && item.latitude! >= -90
  && item.latitude! <= 90
  && item.longitude! >= -180
  && item.longitude! <= 180
    ? {
      geocodeStatus: "success",
      latitude: item.latitude!,
      longitude: item.longitude!,
      geocodedAt: item.geocodedAt ?? item.updatedAt,
      geocodeProvider: item.geocodeProvider,
    }
    : {
      geocodeStatus: "failed",
      geocodedAt: item.geocodedAt ?? item.updatedAt,
      geocodeProvider: item.geocodeProvider,
      failureReason:
        item.failureReason === "no_result"
        || item.failureReason === "timeout"
        || item.failureReason === "provider_error"
        || item.failureReason === "invalid_coordinates"
          ? item.failureReason
          : "provider_error",
    }
);

const nominatimGeocodingService: GeocodingService = {
  provider: "nominatim",
  geocode: async (query, deps) => {
    const config = getGeocodingConfig();
    const geocodedAt = deps.now();
    const params = new URLSearchParams();
    params.set("format", "jsonv2");
    params.set("limit", "1");
    params.set("q", [query.normalizedAddress, query.normalizedPostalCode].filter(Boolean).join(", "));
    if (config.countryCodes) {
      params.set("countrycodes", config.countryCodes);
    }
    if (config.acceptLanguage) {
      params.set("accept-language", config.acceptLanguage);
    }
    if (config.email) {
      params.set("email", config.email);
    }

    const requestUrl = `${config.baseUrl}/search?${params.toString()}`;
    logHouseholdGeocodingEvent("provider.request.prepared", {
      acceptLanguage: config.acceptLanguage,
      addressKey: query.addressKey,
      countryCodes: config.countryCodes,
      emailConfigured: Boolean(config.email),
      geocodeProvider: nominatimGeocodingService.provider,
      normalizedAddress: query.normalizedAddress,
      normalizedPostalCode: query.normalizedPostalCode,
      timeoutMs: config.timeoutMs,
      url: requestUrl,
      userAgent: config.userAgent,
    });

    try {
      await awaitNominatimWindow();

      const response = await deps.fetchImpl(requestUrl, {
        headers: {
          "user-agent": config.userAgent,
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      logHouseholdGeocodingEvent("provider.response.received", {
        addressKey: query.addressKey,
        geocodeProvider: nominatimGeocodingService.provider,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
      });

      if (!response.ok) {
        let responseBody: unknown = undefined;
        try {
          responseBody = await response.text();
        } catch {
          responseBody = "<unavailable>";
        }
        logHouseholdGeocodingEvent("provider.response.error", {
          addressKey: query.addressKey,
          body: responseBody,
          failureReason: "provider_error",
          geocodeProvider: nominatimGeocodingService.provider,
          status: response.status,
          statusText: response.statusText,
        });
        return {
          geocodeStatus: "failed",
          geocodedAt,
          geocodeProvider: nominatimGeocodingService.provider,
          failureReason: "provider_error",
        };
      }

      const payload = await response.json() as Array<{ lat?: string; lon?: string }>;
      const first = payload[0];
      logHouseholdGeocodingEvent("provider.response.parsed", {
        addressKey: query.addressKey,
        candidateCount: payload.length,
        firstCandidate: first ?? null,
        geocodeProvider: nominatimGeocodingService.provider,
      });
      if (!first) {
        logHouseholdGeocodingEvent("provider.result.no_result", {
          addressKey: query.addressKey,
          failureReason: "no_result",
          geocodeProvider: nominatimGeocodingService.provider,
        });
        return {
          geocodeStatus: "failed",
          geocodedAt,
          geocodeProvider: nominatimGeocodingService.provider,
          failureReason: "no_result",
        };
      }

      const latitude = Number(first.lat);
      const longitude = Number(first.lon);
      if (
        !Number.isFinite(latitude)
        || !Number.isFinite(longitude)
        || latitude < -90
        || latitude > 90
        || longitude < -180
        || longitude > 180
      ) {
        logHouseholdGeocodingEvent("provider.result.invalid_coordinates", {
          addressKey: query.addressKey,
          failureReason: "invalid_coordinates",
          geocodeProvider: nominatimGeocodingService.provider,
          rawLatitude: first.lat,
          rawLongitude: first.lon,
        });
        return {
          geocodeStatus: "failed",
          geocodedAt,
          geocodeProvider: nominatimGeocodingService.provider,
          failureReason: "invalid_coordinates",
        };
      }

      logHouseholdGeocodingEvent("provider.result.success", {
        addressKey: query.addressKey,
        geocodeProvider: nominatimGeocodingService.provider,
        latitude,
        longitude,
      });
      return {
        geocodeStatus: "success",
        latitude,
        longitude,
        geocodedAt,
        geocodeProvider: nominatimGeocodingService.provider,
      };
    } catch (error) {
      const failureReason = error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "provider_error";
      logHouseholdGeocodingEvent("provider.request.failed", {
        addressKey: query.addressKey,
        errorMessage: error instanceof Error ? error.message : "Unknown geocoding error",
        errorName: error instanceof Error ? error.name : typeof error,
        failureReason,
        geocodeProvider: nominatimGeocodingService.provider,
      });

      return {
        geocodeStatus: "failed",
        geocodedAt,
        geocodeProvider: nominatimGeocodingService.provider,
        failureReason,
      };
    }
  },
};

const getGeocodingService = (): GeocodingService => {
  const config = getGeocodingConfig();
  return config.provider === "nominatim" ? nominatimGeocodingService : nominatimGeocodingService;
};

const geocodeAddress = async (query: GeocodingQuery, deps: HandlerDependencies) => {
  logHouseholdGeocodingEvent("lookup.started", {
    addressKey: query.addressKey,
    normalizedAddress: query.normalizedAddress,
    normalizedPostalCode: query.normalizedPostalCode,
  });
  const cached = await getGeocodeCache(query.addressKey, deps);
  if (cached) {
    const cachedResult = toGeocodingLookupFromCache(cached);
    logHouseholdGeocodingEvent("lookup.cache_hit", {
      addressKey: query.addressKey,
      failureReason: cachedResult.geocodeStatus === "failed" ? cachedResult.failureReason : undefined,
      geocodeProvider: cachedResult.geocodeProvider,
      geocodeStatus: cachedResult.geocodeStatus,
      latitude: cachedResult.geocodeStatus === "success" ? cachedResult.latitude : undefined,
      longitude: cachedResult.geocodeStatus === "success" ? cachedResult.longitude : undefined,
    });
    return cachedResult;
  }

  const inFlight = pendingGeocodeRequests.get(query.addressKey);
  if (inFlight) {
    logHouseholdGeocodingEvent("lookup.inflight_reused", {
      addressKey: query.addressKey,
    });
    return inFlight;
  }

  const request = (async () => {
    logHouseholdGeocodingEvent("lookup.provider_start", {
      addressKey: query.addressKey,
      geocodeProvider: getGeocodingService().provider,
    });
    const service = getGeocodingService();
    const result = await service.geocode(query, deps);
    if (result.geocodeStatus === "success" || result.failureReason === "no_result" || result.failureReason === "invalid_coordinates") {
      await putGeocodeCache(query, result, deps);
    }
    logHouseholdGeocodingEvent("lookup.completed", {
      addressKey: query.addressKey,
      failureReason: result.geocodeStatus === "failed" ? result.failureReason : undefined,
      geocodeProvider: result.geocodeProvider,
      geocodeStatus: result.geocodeStatus,
      latitude: result.geocodeStatus === "success" ? result.latitude : undefined,
      longitude: result.geocodeStatus === "success" ? result.longitude : undefined,
    });
    return result;
  })();

  pendingGeocodeRequests.set(query.addressKey, request);
  try {
    return await request;
  } finally {
    pendingGeocodeRequests.delete(query.addressKey);
  }
};

const updateHouseholdLocation = async (
  context: RequestContext,
  household: HouseholdItem,
  location: HouseholdLocation | undefined,
  deps: HandlerDependencies,
) => {
  const updatedAt = deps.now();
  logHouseholdGeocodingEvent("household.location_update", {
    addressKey: household.addressKey,
    geocodeProvider: location?.geocodeProvider,
    geocodeStatus: location?.geocodeStatus,
    householdId: household.householdId,
    latitude: location?.latitude,
    longitude: location?.longitude,
    updatedAt,
  });
  await deps.documentClient.send(
    new UpdateCommand({
      ConditionExpression: "#updatedAt = :expectedUpdatedAt",
      ExpressionAttributeNames: {
        "#location": "location",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":expectedUpdatedAt": household.updatedAt,
        ":location": location,
        ":updatedAt": updatedAt,
      },
      Key: {
        PK: tenantPk(context.tenantId),
        SK: householdSk(household.householdId),
      },
      TableName: context.tableName,
      UpdateExpression: "SET #location = :location, #updatedAt = :updatedAt",
    }),
  );

  return {
    ...household,
    location,
    updatedAt,
  };
};

const prepareAutoGeocodeLocation = (_existing?: HouseholdItem | null): HouseholdLocation => ({
  geocodeStatus: "pending",
  geocodeProvider: getGeocodingService().provider,
});

const buildBatchPendingGeocodeLocation = (): HouseholdLocation => ({
  geocodeStatus: "pending",
  geocodeProvider: getGeocodingService().provider,
});

const normalizeHouseholdGeocodeJobMode = (value: unknown): HouseholdGeocodeJobMode =>
  value === "retry_failed" ? "retry_failed" : "unmapped_only";

const isHouseholdEligibleForGeocodeJob = (
  household: HouseholdItem,
  job: Pick<HouseholdGeocodeJobItem, "mode" | "startedAt">,
) => {
  const status = household.location?.geocodeStatus;

  if (status === "success" && hasValidHouseholdCoordinates(household)) {
    return false;
  }

  if (!household.addressKey) {
    return false;
  }

  if (!household.location) {
    return true;
  }

  if (status === "pending" || status === "not_started" || status === undefined) {
    return true;
  }

  if (status === "failed" && job.mode === "retry_failed") {
    if (!job.startedAt || !household.location.geocodedAt) {
      return true;
    }

    return household.location.geocodedAt < job.startedAt;
  }

  return false;
};

const selectNextHouseholdForGeocodeJob = (
  households: HouseholdItem[],
  job: Pick<HouseholdGeocodeJobItem, "mode" | "startedAt">,
) =>
  households
    .filter((household) => isHouseholdEligibleForGeocodeJob(household, job))
    .sort((left, right) => {
      const leftStatus = left.location?.geocodeStatus ?? "not_started";
      const rightStatus = right.location?.geocodeStatus ?? "not_started";
      const leftRank = leftStatus === "pending" ? 0 : leftStatus === "not_started" ? 1 : leftStatus === "failed" ? 2 : 3;
      const rightRank = rightStatus === "pending" ? 0 : rightStatus === "not_started" ? 1 : rightStatus === "failed" ? 2 : 3;
      return leftRank - rightRank || left.householdId.localeCompare(right.householdId);
    })[0] ?? null;

const shouldTriggerAutoGeocoding = (
  nextHousehold: Pick<HouseholdItem, "addressKey">,
  existing: HouseholdItem | null | undefined,
  hasExplicitLocation: boolean,
) => {
  if (hasExplicitLocation || !nextHousehold.addressKey) {
    return false;
  }

  return !existing || existing.addressKey !== nextHousehold.addressKey;
};

const applyAutomaticHouseholdGeocoding = async (
  context: RequestContext,
  household: HouseholdItem,
  deps: HandlerDependencies,
) => {
  if (!household.addressKey) {
    logHouseholdGeocodingEvent("household.skipped", {
      householdId: household.householdId,
      reason: "missing_address_key",
    });
    return household;
  }

  logHouseholdGeocodingEvent("household.autogeocode.started", {
    addressKey: household.addressKey,
    householdId: household.householdId,
    normalizedAddress: household.normalizedAddress,
    normalizedPostalCode: household.normalizedPostalCode,
  });
  const result = await geocodeAddress({
    addressKey: household.addressKey,
    normalizedAddress: household.normalizedAddress,
    normalizedPostalCode: household.normalizedPostalCode,
  }, deps);

  try {
    const updatedHousehold = await updateHouseholdLocation(context, household, toHouseholdLocationFromLookup(result), deps);
    logHouseholdGeocodingEvent("household.autogeocode.finished", {
      addressKey: household.addressKey,
      failureReason: result.geocodeStatus === "failed" ? result.failureReason : undefined,
      geocodeProvider: result.geocodeProvider,
      geocodeStatus: result.geocodeStatus,
      householdId: household.householdId,
      latitude: result.geocodeStatus === "success" ? result.latitude : undefined,
      longitude: result.geocodeStatus === "success" ? result.longitude : undefined,
    });
    return updatedHousehold;
  } catch (error) {
    if (isDynamoCancellationError(error)) {
      logHouseholdGeocodingEvent("household.location_update_skipped", {
        addressKey: household.addressKey,
        errorMessage: error instanceof Error ? error.message : "Conditional update failed",
        householdId: household.householdId,
        reason: "concurrent_household_update",
      });
      return household;
    }

    logHouseholdGeocodingEvent("household.location_update_failed", {
      addressKey: household.addressKey,
      errorMessage: error instanceof Error ? error.message : "Unknown location update error",
      errorName: error instanceof Error ? error.name : typeof error,
      householdId: household.householdId,
    });
    throw error;
  }
};

const getHouseholdConflict = async (
  context: RequestContext,
  memberId: string,
  deps: HandlerDependencies,
) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: householdConflictSk(memberId),
      },
      TableName: context.tableName,
    }),
  );

  const item = response.Item as HouseholdConflictItem | undefined;
  return item?.entityType === "HOUSEHOLD_CONFLICT" ? item : null;
};

const listHouseholdConflicts = async (
  context: RequestContext,
  deps: HandlerDependencies,
) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantPk(context.tenantId),
      ":sk": householdConflictSkPrefix(),
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
    TableName: context.tableName,
  });

  return (items as HouseholdConflictItem[]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const putHouseholdConflict = async (
  context: RequestContext,
  item: HouseholdConflictItem,
  deps: HandlerDependencies,
) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: item,
      TableName: context.tableName,
    }),
  );
};

const deleteHouseholdConflict = async (
  context: RequestContext,
  memberId: string,
  deps: HandlerDependencies,
) => {
  await deps.documentClient.send(
    new DeleteCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: householdConflictSk(memberId),
      },
      TableName: context.tableName,
    }),
  );
};

const findHouseholdsByAddressMatch = async (
  context: RequestContext,
  address: string | undefined,
  postalCode: string | undefined,
  deps: HandlerDependencies,
  state?: ImportExecutionState,
) => {
  const startedAt = Date.now();
  const normalized = normalizeAddress({ address, postalCode });
  if (!normalized.addressKey) {
    return { normalized, households: [] as HouseholdItem[] };
  }

  const cachedHousehold = state?.householdsByAddressKey.get(normalized.addressKey);
  if (cachedHousehold) {
    logImportTiming("findHouseholdsByAddressMatch", startedAt, {
      addressKey: normalized.addressKey,
      householdsMatched: 1,
      lookupHit: true,
      source: "import_state",
    });
    return { normalized, households: [cachedHousehold] };
  }

  const indexedHousehold = await getHouseholdByAddressKey(context, normalized.addressKey, deps);
  if (indexedHousehold) {
    upsertHouseholdInImportState(state, indexedHousehold);
    logImportTiming("findHouseholdsByAddressMatch", startedAt, {
      addressKey: normalized.addressKey,
      householdsMatched: 1,
      lookupHit: true,
      source: "gsi2",
    });
    return { normalized, households: [indexedHousehold] };
  }

  logImportTiming("findHouseholdsByAddressMatch", startedAt, {
    addressKey: normalized.addressKey,
    householdsMatched: 0,
    lookupHit: false,
  });

  return { normalized, households: [] as HouseholdItem[] };
};

const buildHouseholdConflictItem = (
  context: RequestContext,
  member: MemberItem,
  currentHousehold: HouseholdItem,
  deps: HandlerDependencies,
  options: {
    importedAddressKey?: string;
    matchedHousehold?: HouseholdItem | null;
    existing?: HouseholdConflictItem | null;
  } = {},
): HouseholdConflictItem => ({
  PK: tenantPk(context.tenantId),
  SK: householdConflictSk(member.memberId),
  createdAt: options.existing?.createdAt ?? deps.now(),
  updatedAt: deps.now(),
  entityType: "HOUSEHOLD_CONFLICT",
  tenantId: context.tenantId,
  memberId: member.memberId,
  memberFullName: member.fullName,
  currentHouseholdId: currentHousehold.householdId,
  currentHouseholdName: currentHousehold.householdName,
  currentHouseholdAddress: currentHousehold.address,
  currentHouseholdAddressKey: currentHousehold.addressKey,
  currentHouseholdGeocodeStatus: currentHousehold.location?.geocodeStatus
    ?? (currentHousehold.location?.latitude !== undefined && currentHousehold.location?.longitude !== undefined ? "success" : undefined),
  importedAddress: member.address,
  importedPostalCode: member.postalCode,
  importedAddressKey: options.importedAddressKey,
  matchedHouseholdId: options.matchedHousehold?.householdId,
  matchedHouseholdName: options.matchedHousehold?.householdName,
  matchedHouseholdAddress: options.matchedHousehold?.address,
  matchedHouseholdGeocodeStatus: options.matchedHousehold?.location?.geocodeStatus
    ?? (options.matchedHousehold?.location?.latitude !== undefined && options.matchedHousehold.location?.longitude !== undefined ? "success" : undefined),
});

const getMemberImportJob = async (context: RequestContext, jobId: string, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: memberImportJobSk(jobId),
      },
      TableName: context.tableName,
    }),
  );

  return (response.Item as MemberImportJobItem | undefined) ?? null;
};

const getHouseholdGeocodeJob = async (context: RequestContext, jobId: string, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: householdGeocodeJobSk(jobId),
      },
      TableName: context.tableName,
    }),
  );

  return (response.Item as HouseholdGeocodeJobItem | undefined) ?? null;
};

const listMemberImportJobs = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantPk(context.tenantId),
      ":sk": memberImportJobSkPrefix(),
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
    TableName: context.tableName,
  });

  return items
    .filter((item): item is MemberImportJobItem => item.entityType === "MEMBER_IMPORT_JOB")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const listHouseholdGeocodeJobs = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantPk(context.tenantId),
      ":sk": householdGeocodeJobSkPrefix(),
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
    TableName: context.tableName,
  });

  return (items as HouseholdGeocodeJobItem[]).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const getAdminJobs = async (context: RequestContext, deps: HandlerDependencies) => {
  await requireAdminContext(context, deps, "admin.jobs.list");

  const [memberImportJobs, householdGeocodeJobs, households] = await Promise.all([
    listMemberImportJobs(context, deps),
    listHouseholdGeocodeJobs(context, deps),
    listHouseholds(context, deps),
  ]);

  const householdGeocodeCounts = households.reduce(
    (counts, household) => {
      const status = household.location?.geocodeStatus;
      const hasCoordinates = household.location?.latitude !== undefined && household.location?.longitude !== undefined;

      if (status === "failed") {
        counts.failed += 1;
      } else if (status === "pending" || status === "not_started" || (!status && !hasCoordinates)) {
        counts.unmapped += 1;
      }

      return counts;
    },
    { failed: 0, unmapped: 0 },
  );

  const response: AdminJobsResponse = {
    memberImportJobs: memberImportJobs.map((job) => toMemberImportJob(job)),
    householdGeocodeJobs: householdGeocodeJobs.map((job) => toHouseholdGeocodeJob(job)),
    householdGeocodeCounts,
  };

  return json(200, response);
};

const cancelMemberImportJob = async (context: RequestContext, jobId: string, deps: HandlerDependencies) => {
  await requireAdminContext(context, deps, "admin.member_import.cancel");

  const job = await getMemberImportJob(context, jobId, deps);
  if (!job) {
    return json(404, { message: "Import job not found." });
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return json(200, toMemberImportJob(job));
  }

  const cancelledAt = deps.now();
  const cancelledJob: MemberImportJobItem = {
    ...job,
    updatedAt: cancelledAt,
    completedAt: cancelledAt,
    status: "cancelled",
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  };

  await putImportJob(context, cancelledJob, deps);
  await logAuditEvent(context, "admin.member_import.cancel", "success", deps, {
    metadata: { jobId, previousStatus: job.status },
  });

  return json(200, toMemberImportJob(cancelledJob));
};

const cancelHouseholdGeocodeJob = async (context: RequestContext, jobId: string, deps: HandlerDependencies) => {
  await requireAdminContext(context, deps, "admin.household_geocode.cancel");

  const job = await getHouseholdGeocodeJob(context, jobId, deps);
  if (!job) {
    return json(404, { message: "Household geocode job not found." });
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return json(200, toHouseholdGeocodeJob(job));
  }

  const cancelledAt = deps.now();
  const cancelledJob: HouseholdGeocodeJobItem = {
    ...job,
    updatedAt: cancelledAt,
    completedAt: cancelledAt,
    status: "cancelled",
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  };

  await putHouseholdGeocodeJob(context, cancelledJob, deps);
  await logAuditEvent(context, "admin.household_geocode.cancel", "success", deps, {
    metadata: { jobId, mode: job.mode, previousStatus: job.status },
  });

  return json(200, toHouseholdGeocodeJob(cancelledJob));
};

const tryAcquireMemberImportJobLease = async (
  context: RequestContext,
  jobId: string,
  deps: HandlerDependencies,
) => {
  const now = deps.now();
  const leaseOwner = deps.uuid();
  const leaseExpiresAt = addMillisecondsToIso(now, importJobLeaseDurationMs);

  try {
    const response = await deps.documentClient.send(
      new UpdateCommand({
        Key: {
          PK: tenantPk(context.tenantId),
          SK: memberImportJobSk(jobId),
        },
        TableName: context.tableName,
        UpdateExpression: "SET updatedAt = :updatedAt, startedAt = if_not_exists(startedAt, :startedAt), #status = :status, leaseOwner = :leaseOwner, leaseExpiresAt = :leaseExpiresAt",
        ConditionExpression: "#status <> :completed AND #status <> :failed AND #status <> :cancelled AND (attribute_not_exists(leaseExpiresAt) OR leaseExpiresAt < :now)",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":updatedAt": now,
          ":startedAt": now,
          ":status": "running",
          ":leaseOwner": leaseOwner,
          ":leaseExpiresAt": leaseExpiresAt,
          ":completed": "completed",
          ":failed": "failed",
          ":cancelled": "cancelled",
          ":now": now,
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    return (response.Attributes as MemberImportJobItem | undefined) ?? null;
  } catch (error) {
    if (
      error instanceof Error
      && (error.name === "ConditionalCheckFailedException" || error.name === "TransactionCanceledException")
    ) {
      return null;
    }

    throw error;
  }
};

const putHouseholdGeocodeJob = async (
  context: RequestContext,
  item: HouseholdGeocodeJobItem,
  deps: HandlerDependencies,
) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: item,
      TableName: context.tableName,
    }),
  );
};

const tryAcquireHouseholdGeocodeJobLease = async (
  context: RequestContext,
  jobId: string,
  deps: HandlerDependencies,
) => {
  const now = deps.now();
  const leaseOwner = deps.uuid();
  const leaseExpiresAt = addMillisecondsToIso(now, householdGeocodeJobLeaseDurationMs);

  try {
    const response = await deps.documentClient.send(
      new UpdateCommand({
        Key: {
          PK: tenantPk(context.tenantId),
          SK: householdGeocodeJobSk(jobId),
        },
        TableName: context.tableName,
        UpdateExpression: "SET updatedAt = :updatedAt, startedAt = if_not_exists(startedAt, :startedAt), #status = :status, leaseOwner = :leaseOwner, leaseExpiresAt = :leaseExpiresAt",
        ConditionExpression: "#status <> :completed AND #status <> :failed AND #status <> :cancelled AND (attribute_not_exists(leaseExpiresAt) OR leaseExpiresAt < :now)",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":updatedAt": now,
          ":startedAt": now,
          ":status": "running",
          ":leaseOwner": leaseOwner,
          ":leaseExpiresAt": leaseExpiresAt,
          ":completed": "completed",
          ":failed": "failed",
          ":cancelled": "cancelled",
          ":now": now,
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    return (response.Attributes as HouseholdGeocodeJobItem | undefined) ?? null;
  } catch (error) {
    if (
      error instanceof Error
      && (error.name === "ConditionalCheckFailedException" || error.name === "TransactionCanceledException")
    ) {
      return null;
    }

    throw error;
  }
};

const ensureMemberAssignedToHousehold = async (
  context: RequestContext,
  member: MemberItem,
  household: HouseholdItem,
  deps: HandlerDependencies,
  state?: ImportExecutionState,
) => {
  const startedAt = Date.now();
  if (member.householdId === household.householdId) {
    return false;
  }

  const updatedHousehold = await updateHouseholdMembership(context, household.householdId, {
    householdName: household.householdName,
    address: household.address,
    postalCode: household.postalCode,
    notes: household.notes,
    location: household.location,
    areaId: household.areaId,
    memberIds: [...new Set([...(household.members ?? []).map((entry) => entry.memberId), member.memberId])],
    primaryContactMemberId: household.primaryContactMemberId,
  }, deps, household, { allowReassign: true });
  upsertHouseholdInImportState(state, updatedHousehold);
  if (state && member.householdId && member.householdId !== household.householdId) {
    const previousHousehold = state.householdsById.get(member.householdId);
    if (previousHousehold) {
      upsertHouseholdInImportState(state, {
        ...previousHousehold,
        members: (previousHousehold.members ?? []).filter((entry) => entry.memberId !== member.memberId),
        memberCount: Math.max(0, previousHousehold.memberCount - 1),
      });
    }
  }

  await logMemberActivity(
    context,
    member.memberId,
    "Household Assigned",
    `Automatically assigned to ${household.householdName} during Unity import.`,
    deps,
    { householdId: household.householdId, source: "unity_import" },
  );

  logImportTiming("ensureMemberAssignedToHousehold", startedAt, {
    memberId: member.memberId,
    householdId: household.householdId,
  });

  return true;
};

const buildAutoHouseholdId = (addressKey: string | undefined, deps: HandlerDependencies) => {
  if (!addressKey) {
    return deps.uuid();
  }

  const readableId = buildReadableHouseholdIdFromAddressKey(addressKey);
  return readableId || deps.uuid();
};

const resolveImportHouseholdAssignment = async (
  context: RequestContext,
  member: MemberItem,
  deps: HandlerDependencies,
  state?: ImportExecutionState,
) => {
  const startedAt = Date.now();
  const normalized = normalizeAddress({ address: member.address, postalCode: member.postalCode });
  if (!normalized.addressKey) {
    await deleteHouseholdConflict(context, member.memberId, deps);
    logImportTiming("resolveImportHouseholdAssignment", startedAt, {
      memberId: member.memberId,
      outcome: "no_address_key",
    });
    return {
      householdCreated: 0,
      householdMatched: 0,
      memberAssigned: 0,
      memberWithoutHousehold: member.householdId ? 0 : 1,
      conflict: 0,
    };
  }

  if (member.householdId) {
    const household = state?.householdsById.get(member.householdId) ?? await getHousehold(context, member.householdId, deps);
    if (household) {
      upsertHouseholdInImportState(state, household);
    }
    const currentHouseholdAddressKey = household
      ? (household.addressKey ?? normalizeAddress({
        address: household.address,
        postalCode: household.postalCode,
      }).addressKey)
      : undefined;
    if (household && currentHouseholdAddressKey && currentHouseholdAddressKey !== normalized.addressKey) {
      const { households: matchedHouseholds } = await findHouseholdsByAddressMatch(
        context,
        member.address,
        member.postalCode,
        deps,
        state,
      );
      const matchedHousehold = matchedHouseholds.find((item) => item.householdId !== household.householdId) ?? null;
      const existingConflict = await getHouseholdConflict(context, member.memberId, deps);
      await putHouseholdConflict(
        context,
        buildHouseholdConflictItem(context, member, household, deps, {
          importedAddressKey: normalized.addressKey,
          matchedHousehold,
          existing: existingConflict,
        }),
        deps,
      );
      await logMemberActivity(
        context,
        member.memberId,
        "Household Address Review",
        `Imported address differs from the assigned household address for ${household.householdName}.`,
        deps,
        {
          householdId: household.householdId,
          householdAddressKey: household.addressKey,
          importedAddressKey: normalized.addressKey,
          source: "unity_import",
        },
      );
      logImportTiming("resolveImportHouseholdAssignment", startedAt, {
        memberId: member.memberId,
        householdId: household.householdId,
        outcome: "conflict",
      });
      return {
        householdCreated: 0,
        householdMatched: 0,
        memberAssigned: 0,
        memberWithoutHousehold: 0,
        conflict: 1,
      };
    }

    await deleteHouseholdConflict(context, member.memberId, deps);
    logImportTiming("resolveImportHouseholdAssignment", startedAt, {
      memberId: member.memberId,
      householdId: household?.householdId,
      outcome: "already_assigned",
    });
    return {
      householdCreated: 0,
      householdMatched: 0,
      memberAssigned: 0,
      memberWithoutHousehold: 0,
      conflict: 0,
    };
  }

  const { households } = await findHouseholdsByAddressMatch(
    context,
    member.address,
    member.postalCode,
    deps,
    state,
  );
  const household = households[0];
  if (household) {
    const assigned = await ensureMemberAssignedToHousehold(context, member, household, deps, state);
    await deleteHouseholdConflict(context, member.memberId, deps);
    logImportTiming("resolveImportHouseholdAssignment", startedAt, {
      memberId: member.memberId,
      householdId: household.householdId,
      outcome: assigned ? "matched_and_assigned" : "matched_existing",
    });
    return {
      householdCreated: 0,
      householdMatched: 1,
      memberAssigned: assigned ? 1 : 0,
      memberWithoutHousehold: 0,
      conflict: 0,
    };
  }

  const householdId = buildAutoHouseholdId(normalized.addressKey, deps);
  const createdHousehold = await updateHouseholdMembership(context, householdId, {
    householdName: buildAddressBasedHouseholdName(member.address),
    address: member.address,
    postalCode: member.postalCode,
    notes: undefined,
    location: buildBatchPendingGeocodeLocation(),
    memberIds: [member.memberId],
  }, deps, null);
  upsertHouseholdInImportState(state, createdHousehold);

  await logMemberActivity(
    context,
    member.memberId,
    "Household Assigned",
    `Automatically assigned to ${createdHousehold.householdName} during Unity import.`,
    deps,
    { householdId: createdHousehold.householdId, source: "unity_import" },
  );
  await deleteHouseholdConflict(context, member.memberId, deps);
  logImportTiming("resolveImportHouseholdAssignment", startedAt, {
    memberId: member.memberId,
    householdId: createdHousehold.householdId,
    outcome: "created_household",
  });

  return {
    householdCreated: 1,
    householdMatched: 0,
    memberAssigned: 1,
    memberWithoutHousehold: 0,
    conflict: 0,
  };
};

const listMemberImportChunks = async (context: RequestContext, jobId: string, deps: HandlerDependencies) => {
  const response = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantPk(context.tenantId),
      ":sk": memberImportChunkSkPrefix(jobId),
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
    TableName: context.tableName,
  });

  return response as MemberImportChunkItem[];
};

const processImportRow = async (
  context: RequestContext,
  row: ImportWorkbookRow,
  fileName: string,
  state: ImportExecutionState,
  deps: HandlerDependencies,
): Promise<Omit<MemberImportResult, "errorCount">> => {
  const startedAt = Date.now();
  const unityId = toOptionalString(row.values["Member ID"]);
  const fullName = normalizeWhitespace(row.values["Member Name"]);
  if (!unityId || !fullName) {
    return {
      created: 0,
      updated: 0,
      skipped: 1,
      householdsCreated: 0,
      householdsMatched: 0,
      membersAssignedToHouseholds: 0,
      membersWithoutHouseholds: 0,
      householdConflicts: 0,
      errors: [],
    };
  }

  try {
    const existing = state.existingMembersByUnityId.get(unityId) ?? null;
    const member = buildMemberItem(
      context,
      {
        source: "UNITY",
        unityId,
        familyId: toOptionalString(row.values["Family ID"]),
        householdName: toOptionalString(row.values["Household Name"]),
        fullName,
        phone: toOptionalString(row.values["Phone Number"]),
        email: toOptionalString(row.values["Email"]),
        dateOfBirth: toIsoDate(row.values["Date of Birth"]),
        age: toOptionalNumber(row.values["Age"]),
        gender: toOptionalString(row.values["Gender"]),
        familyStatus: toOptionalString(row.values["Family Status"]),
        church: toOptionalString(row.values["Church"]),
        fatherOfConfession: toOptionalString(row.values["Father of Confession"]),
        deaconshipRank: toOptionalString(row.values["Deaconship Rank"]),
        ordinationDate: toIsoDate(row.values["Ordination Date"]),
        churchProvince: toOptionalString(row.values["Church Province"]),
        churchCity: toOptionalString(row.values["Church City"]),
        churchRegion: toOptionalString(row.values["Church Region"]),
        diocese: toOptionalString(row.values["Diocese"]),
        address: toOptionalString(row.values["Address"]),
        postalCode: toOptionalString(row.values["Postal Code"]),
        activated: toOptionalBoolean(row.values["Activated"]),
        approved: toOptionalBoolean(row.values["Approved"]),
        locked: toOptionalBoolean(row.values["Locked"]),
        visibility: toOptionalString(row.values["Visibility"]),
        username: toOptionalString(row.values["Username"]),
        registrationDate: toIsoDate(row.values["Registration Date"]),
        groups: String(row.values["Groups"] ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        customFlag: toOptionalString(row.values["Custom Flag"]),
        licensePlate: toOptionalString(row.values["License Plate"]),
      },
      deps,
      existing,
    );
    member.notes = existing?.notes;
    await putMember(context, member, deps);
    state.existingMembersByUnityId.set(unityId, member);
    const householdAssignment = await resolveImportHouseholdAssignment(context, member, deps, state);
    await logMemberActivity(
      context,
      member.memberId,
      existing ? "Member Updated" : "Member Imported",
      existing ? `${member.fullName} refreshed from Unity import.` : `${member.fullName} imported from Unity.`,
      deps,
      { unityId, row: row.rowNumber, fileName },
    );
    return {
      created: existing ? 0 : 1,
      updated: existing ? 1 : 0,
      skipped: 0,
      householdsCreated: householdAssignment.householdCreated,
      householdsMatched: householdAssignment.householdMatched,
      membersAssignedToHouseholds: householdAssignment.memberAssigned,
      membersWithoutHouseholds: householdAssignment.memberWithoutHousehold,
      householdConflicts: householdAssignment.conflict,
      errors: [],
    };
  } catch (error) {
    logImportTiming("processImportRow.failed", startedAt, {
      unityId,
      rowNumber: row.rowNumber,
      message: error instanceof Error ? error.message : "Unknown import error.",
    });
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      householdsCreated: 0,
      householdsMatched: 0,
      membersAssignedToHouseholds: 0,
      membersWithoutHouseholds: 0,
      householdConflicts: 0,
      errors: [
        {
          row: row.rowNumber,
          message: error instanceof Error ? error.message : "Unknown import error.",
        },
      ],
    };
  } finally {
    logImportTiming("processImportRow", startedAt, {
      unityId,
      rowNumber: row.rowNumber,
    });
  }
};

const listMembers = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI1PK",
      "#gsiSk": "GSI1SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": memberGsiPk(context.tenantId),
      ":from": "NAME#",
      ":to": "NAME#~",
    },
    IndexName: GSI1_NAME,
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return items as MemberItem[];
};

const resolveAutoLinkedInteractionMembers = async (
  context: RequestContext,
  event: Pick<EventItem, "calendarId" | "eventId" | "googleEventId" | "summary" | "attendees">,
  deps: HandlerDependencies,
): Promise<AutoLinkedInteractionResult> => {
  const normalizedTitle = normalizeWhitespace(event.summary).toLowerCase();
  const matchedPrefix = autoLinkInteractionPrefixes.find(({ prefix }) => normalizedTitle.startsWith(prefix));
  if (!matchedPrefix) {
    return { matchedMembers: [] };
  }

  const extractedEmails = extractEmails(event.summary, ...(event.attendees ?? []));
  const extractedEmailSet = new Set(extractedEmails);
  const normalizedTitleBody = normalizeName(
    normalizeWhitespace(event.summary)
      .slice(matchedPrefix.prefix.length)
      .replace(emailPattern, " "),
  );
  const matchedMembers = (await listMembers(context, deps)).filter((member) => {
    const email = normalizeEmail(member.email);
    if (email && extractedEmailSet.has(email)) {
      return true;
    }

    const normalizedMemberName = normalizeName(member.fullName);
    return normalizedMemberName ? includesNormalizedName(normalizedTitleBody, normalizedMemberName) : false;
  });

  if (!matchedMembers.length) {
    await logAuditEvent(context, "AUTO_LINK_FAILED", "failed", deps, {
      metadata: {
        calendarId: event.calendarId,
        extractedEmails,
        googleEventId: event.googleEventId ?? event.eventId,
        normalizedTitleBody,
      },
    });
  }

  return {
    interactionType: matchedPrefix.type,
    matchedMembers,
  };
};

const listMemberActivities = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantMemberPk(context.tenantId, memberId),
      ":activityPrefix": "ACTIVITY#",
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :activityPrefix)",
    TableName: context.tableName,
  });

  return (items as MemberActivityItem[]).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const listMemberEvents = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI2PK",
      "#gsiSk": "GSI2SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": memberEventGsiPk(context.tenantId, memberId),
      ":from": "EVENT#",
      ":to": "EVENT#~",
    },
    IndexName: "GSI2",
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return (items as EventMemberItem[]).sort((left, right) => left.eventStart.localeCompare(right.eventStart));
};

const listUpcomingEventAssignments = async (context: RequestContext, from: string, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI3PK",
      "#gsiSk": "GSI3SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": tenantEventAssignmentGsiPk(context.tenantId),
      ":from": `EVENT#${from}`,
      ":to": "EVENT#~",
    },
    IndexName: "GSI3",
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return items as EventMemberItem[];
};

const listMemberVisitations = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI2PK",
      "#gsiSk": "GSI2SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": tenantMemberPk(context.tenantId, memberId),
      ":from": "VISIT#",
      ":to": "VISIT#~",
    },
    IndexName: "GSI2",
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return (items as VisitationItem[]).sort((left, right) => right.visitDate.localeCompare(left.visitDate));
};

const listVisitationsForMemberRecord = async (context: RequestContext, member: MemberItem, deps: HandlerDependencies) => {
  const relatedMembers = member.unityId
    ? await listMembersByUnityId(context, member.unityId, deps)
    : [member];
  const memberIds = [...new Set(relatedMembers.map((item) => item.memberId))];
  const visitations = await Promise.all(memberIds.map((memberId) => listMemberVisitations(context, memberId, deps)));

  return visitations
    .flat()
    .sort((left, right) => right.visitDate.localeCompare(left.visitDate));
};

const listVisitationsForEvent = async (
  context: RequestContext,
  calendarId: string,
  eventId: string,
  deps: HandlerDependencies,
) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantVisitationPk(context.tenantId, eventVisitationId(calendarId, eventId)),
      ":memberPrefix": "MEMBER#",
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :memberPrefix)",
    TableName: context.tableName,
  });

  return items as VisitationItem[];
};

const getVisitationGroup = async (context: RequestContext, visitationId: string, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantVisitationPk(context.tenantId, visitationId),
      ":memberPrefix": "MEMBER#",
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :memberPrefix)",
    TableName: context.tableName,
  });

  return items as VisitationItem[];
};

const listTenantVisitations = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI1PK",
      "#gsiSk": "GSI1SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": tenantPk(context.tenantId),
      ":from": "VISIT#",
      ":to": "VISIT#~",
    },
    IndexName: GSI1_NAME,
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return (items as VisitationItem[]).sort((left, right) => right.visitDate.localeCompare(left.visitDate));
};

const listEventMembers = async (
  context: RequestContext,
  calendarId: string,
  eventId: string,
  deps: HandlerDependencies,
) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantEventPk(context.tenantId, eventId),
      ":memberPrefix": "MEMBER#",
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :memberPrefix)",
    TableName: context.tableName,
  });

  return (items as EventMemberItem[]).sort((left, right) => left.memberName.localeCompare(right.memberName));
};

const putMember = async (context: RequestContext, member: MemberItem, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new PutCommand({
      ...tagSnapshotGuard(member.tagIds),
      Item: member,
      TableName: context.tableName,
    }),
  );
};

const logMemberActivity = async (
  context: RequestContext,
  memberId: string,
  action: string,
  message: string,
  deps: HandlerDependencies,
  metadata?: Record<string, unknown>,
) => {
  if (!isMemberActivityLoggingEnabled()) {
    return;
  }

  const createdAt = deps.now();
  const activityId = deps.uuid();
  const item: MemberActivityItem = {
    PK: tenantMemberPk(context.tenantId, memberId),
    SK: memberActivitySk(createdAt, activityId),
    createdAt,
    updatedAt: createdAt,
    entityType: "MEMBER_ACTIVITY",
    tenantId: context.tenantId,
    activityId,
    action,
    message,
    actorUserId: context.actorSub,
    actorDisplayName: context.actorName,
    metadata,
  };

  await deps.documentClient.send(
    new PutCommand({
      Item: item,
      TableName: context.tableName,
    }),
  );
};

const buildMemberItem = (
  context: RequestContext,
  input: Partial<CreateMemberInput>,
  deps: HandlerDependencies,
  existing?: MemberItem | null,
): MemberItem => {
  const hasInputField = (field: keyof CreateMemberInput) => Object.prototype.hasOwnProperty.call(input, field);
  const timestamp = deps.now();
  const memberId = existing?.memberId ?? deps.uuid();
  const fullName = normalizeWhitespace(input.fullName ?? existing?.fullName);
  const { firstName, lastName } = splitName(fullName);
  const source = (input.source ?? existing?.source ?? "MANUAL") as MemberSource;
  const unityId = toOptionalString(input.unityId ?? existing?.unityId);
  const normalizedName = normalizeName(fullName);
  const householdId = hasInputField("householdId")
    ? toOptionalString(input.householdId)
    : toOptionalString(existing?.householdId);
  return {
    PK: tenantPk(context.tenantId),
    SK: memberSk(memberId),
    GSI1PK: memberGsiPk(context.tenantId),
    GSI1SK: memberGsiSk(normalizedName, memberId),
    GSI2PK: unityId ? memberUnityGsiPk(context.tenantId) : undefined,
    GSI2SK: unityId ? memberUnityGsiSk(unityId) : undefined,
    GSI5PK: householdId ? householdMemberGsiPk(context.tenantId, householdId) : undefined,
    GSI5SK: householdId ? householdMemberGsiSk(normalizedName, memberId) : undefined,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    tagIds: input.tagIds ?? existing?.tagIds,
    entityType: "MEMBER",
    tenantId: context.tenantId,
    memberId,
    unityId,
    source,
    isUnityMember: source === "UNITY",
    familyId: toOptionalString(input.familyId ?? existing?.familyId),
    householdId,
    householdName: hasInputField("householdName")
      ? toOptionalString(input.householdName)
      : toOptionalString(existing?.householdName),
    fullName,
    firstName: toOptionalString(input.firstName ?? existing?.firstName ?? firstName),
    lastName: toOptionalString(input.lastName ?? existing?.lastName ?? lastName),
    initials: toInitials(fullName),
    phone: toOptionalString(input.phone ?? existing?.phone),
    email: toOptionalString(input.email ?? existing?.email),
    whatsappPhone: toOptionalString(input.whatsappPhone ?? existing?.whatsappPhone ?? input.phone ?? existing?.phone),
    address: toOptionalString(input.address ?? existing?.address),
    postalCode: toOptionalString(input.postalCode ?? existing?.postalCode),
    dateOfBirth: toIsoDate(input.dateOfBirth ?? existing?.dateOfBirth),
    age: toOptionalNumber(input.age ?? existing?.age),
    gender: toOptionalString(input.gender ?? existing?.gender),
    familyStatus: toOptionalString(input.familyStatus ?? existing?.familyStatus),
    church: toOptionalString(input.church ?? existing?.church),
    fatherOfConfession: toOptionalString(input.fatherOfConfession ?? existing?.fatherOfConfession),
    deaconshipRank: toOptionalString(input.deaconshipRank ?? existing?.deaconshipRank),
    ordinationDate: toIsoDate(input.ordinationDate ?? existing?.ordinationDate),
    churchProvince: toOptionalString(input.churchProvince ?? existing?.churchProvince),
    churchCity: toOptionalString(input.churchCity ?? existing?.churchCity),
    churchRegion: toOptionalString(input.churchRegion ?? existing?.churchRegion),
    diocese: toOptionalString(input.diocese ?? existing?.diocese),
    activated: toOptionalBoolean(input.activated ?? existing?.activated),
    approved: toOptionalBoolean(input.approved ?? existing?.approved),
    locked: toOptionalBoolean(input.locked ?? existing?.locked),
    visibility: toOptionalString(input.visibility ?? existing?.visibility),
    username: toOptionalString(input.username ?? existing?.username),
    registrationDate: toIsoDate(input.registrationDate ?? existing?.registrationDate),
    groups: Array.isArray(input.groups)
      ? input.groups.map((entry) => normalizeWhitespace(entry)).filter(Boolean)
      : existing?.groups,
    customFlag: toOptionalString(input.customFlag ?? existing?.customFlag),
    licensePlate: toOptionalString(input.licensePlate ?? existing?.licensePlate),
    notes: toOptionalString(existing?.notes ?? input.notes),
    normalizedSearchText: normalizeSearchText(
      fullName,
      input.phone ?? existing?.phone,
      input.email ?? existing?.email,
      unityId,
      input.address ?? existing?.address,
      input.householdName ?? existing?.householdName,
    ),
  };
};

const syncEventMembers = async (
  context: RequestContext,
  event: EventItem,
  memberIds: string[],
  deps: HandlerDependencies,
) => {
  const current = await listEventMembers(context, event.calendarId, event.eventId, deps);
  const currentByMemberId = new Map(current.map((item) => [item.memberId, item]));
  const currentIds = new Set(current.map((item) => item.memberId));
  const nextIds = [...new Set(memberIds.filter(Boolean))];

  const keys = nextIds.map((memberId) => ({
    PK: tenantPk(context.tenantId),
    SK: memberSk(memberId),
  }));
  const batch = keys.length
    ? await deps.documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [context.tableName]: {
              Keys: keys,
            },
          },
        }),
      )
    : ({ Responses: {} } as { Responses?: Record<string, MemberItem[]> });

  const fetchedMembers = ((batch.Responses?.[context.tableName] ?? []) as MemberItem[]).filter(Boolean);
  const membersById = new Map(fetchedMembers.map((item) => [item.memberId, item]));
  const transactItems: Array<Record<string, unknown>> = [];
  const visitationType = normalizeVisitationType(event.visitationType);

  for (const item of current) {
    if (nextIds.includes(item.memberId)) {
      continue;
    }

    transactItems.push({
      Delete: {
        Key: { PK: tenantEventPk(context.tenantId, event.eventId), SK: eventMemberSk(item.memberId) },
        TableName: context.tableName,
      },
    });
    await logMemberActivity(
      context,
      item.memberId,
      "Member Removed From Event",
      `${event.summary} unassigned.`,
      deps,
      { eventId: event.eventId },
    );
  }

  for (const memberId of nextIds) {
    const member = membersById.get(memberId);
    const existingAssignment = currentByMemberId.get(memberId);
    if (!member) {
      continue;
    }

    const eventMember: EventMemberItem = {
      PK: tenantEventPk(context.tenantId, event.eventId),
      SK: eventMemberSk(memberId),
      GSI2PK: memberEventGsiPk(context.tenantId, memberId),
      GSI2SK: memberEventGsiSk(event.start, event.eventId),
      GSI3PK: tenantEventAssignmentGsiPk(context.tenantId),
      GSI3SK: tenantEventAssignmentGsiSk(event.start, memberId, event.eventId),
      createdAt: existingAssignment?.createdAt ?? event.createdAt,
      updatedAt: deps.now(),
      entityType: "EVENT_MEMBER",
      tenantId: context.tenantId,
      calendarId: event.calendarId,
      eventId: event.eventId,
      calendarOwnerUserId: event.userId,
      calendarOwnerName: context.actorName,
      memberId,
      memberName: member.fullName,
      memberPhoneSnapshot: member.phone,
      memberEmailSnapshot: member.email,
      unityIdSnapshot: member.unityId,
      sourceSnapshot: member.source,
      eventTitle: event.summary,
      eventStart: event.start,
      eventEnd: event.end,
      eventLocation: event.location,
      eventDescription: event.description,
      allDay: event.allDay,
      assignmentStatus: event.status === "cancelled" ? "cancelled" : "scheduled",
      visitStatus: event.status === "cancelled" ? "cancelled" : "scheduled",
      createdByUserId: existingAssignment?.createdByUserId ?? context.actorSub,
      createdByName: existingAssignment?.createdByName ?? context.actorName,
    };

    transactItems.push({
      Put: {
        Item: eventMember,
        TableName: context.tableName,
      },
    });

    if (!currentIds.has(memberId)) {
      await logMemberActivity(
        context,
        memberId,
        "Visitation Scheduled",
        `${visitationType} scheduled for ${member.fullName}.`,
        deps,
        { eventId: event.eventId, type: visitationType },
      );
    }
  }

  while (transactItems.length) {
    await deps.documentClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems.splice(0, 25),
      }),
    );
  }

  return fetchedMembers;
};

const syncVisitationRecords = async (
  context: RequestContext,
  event: EventItem,
  members: MemberItem[],
  visitationTypeOverride: VisitationType | undefined,
  deps: HandlerDependencies,
) => {
  const existingRecords = await listVisitationsForEvent(context, event.calendarId, event.eventId, deps);
  const existingMemberIds = new Set(existingRecords.map((item) => item.memberId));
  const nextMembers = members;
  const nextMemberIds = new Set(nextMembers.map((item) => item.memberId));
  const visitationId = eventVisitationId(event.calendarId, event.eventId);
  const memberIds = nextMembers.map((item) => item.memberId);
  const memberNames = nextMembers.map((item) => item.fullName);
  const visitationType = normalizeVisitationType(visitationTypeOverride ?? event.visitationType);

  for (const record of existingRecords) {
    if (nextMemberIds.has(record.memberId)) {
      continue;
    }

    await deps.documentClient.send(
      new DeleteCommand({
        Key: {
          PK: tenantVisitationPk(context.tenantId, visitationId),
          SK: visitationMemberSk(record.memberId),
        },
        TableName: context.tableName,
      }),
    );
  }

  for (const member of nextMembers) {
    const record: VisitationItem = {
      PK: tenantVisitationPk(context.tenantId, visitationId),
      SK: visitationMemberSk(member.memberId),
      GSI1PK: tenantPk(context.tenantId),
      GSI1SK: tenantVisitationGsiSk(event.start, context.actorSub, member.memberId, visitationId),
      GSI2PK: tenantMemberPk(context.tenantId, member.memberId),
      GSI2SK: memberVisitationGsiSk(event.start, visitationId),
      createdAt: existingMemberIds.has(member.memberId)
        ? existingRecords.find((item) => item.memberId === member.memberId)?.createdAt ?? event.createdAt
        : event.createdAt,
      updatedAt: deps.now(),
      entityType: "VISITATION",
      tenantId: context.tenantId,
      visitationId,
      source: "calendar",
      type: visitationType,
      memberId: member.memberId,
      memberIds,
      memberNames,
      visitorUserId: context.actorSub,
      visitorDisplayName: context.actorName,
      createdByUserId: existingRecords.find((item) => item.memberId === member.memberId)?.createdByUserId ?? context.actorSub,
      createdByName: existingRecords.find((item) => item.memberId === member.memberId)?.createdByName ?? context.actorName,
      visitDate: event.start,
      title: event.summary,
      endDate: event.end,
      allDay: event.allDay,
      location: event.location,
      notes: event.description,
      visitStatus: event.status === "cancelled" ? "cancelled" : "scheduled",
      eventId: event.eventId,
      calendarEventId: event.googleEventId ?? event.eventId,
      calendarId: event.calendarId,
      calendarOwnerUserId: event.userId,
      calendarOwnerName: existingRecords.find((item) => item.memberId === member.memberId)?.calendarOwnerName ?? context.actorName,
    };

    await deps.documentClient.send(
      new PutCommand({
        Item: record,
        TableName: context.tableName,
      }),
    );

    if (existingMemberIds.has(member.memberId)) {
      const existingRecord = existingRecords.find((item) => item.memberId === member.memberId);
      if (
        existingRecord
        && (
          normalizeVisitationType(existingRecord.type) !== visitationType
          || existingRecord.title !== record.title
          || existingRecord.visitDate !== record.visitDate
          || existingRecord.endDate !== record.endDate
          || existingRecord.location !== record.location
          || existingRecord.notes !== record.notes
          || existingRecord.visitStatus !== record.visitStatus
        )
      ) {
        await logMemberActivity(
          context,
          member.memberId,
          "Visitation Updated",
          `${visitationType} updated for ${member.fullName}.`,
          deps,
          { eventId: event.eventId, type: visitationType, visitationId },
        );
      }
    }
  }
};

const loadMembersByIds = async (context: RequestContext, memberIds: string[], deps: HandlerDependencies) => {
  const normalizedIds = normalizeMemberIds(memberIds);
  const keys = normalizedIds.map((memberId) => ({
    PK: tenantPk(context.tenantId),
    SK: memberSk(memberId),
  }));

  if (!keys.length) {
    return [];
  }

  const batch = await deps.documentClient.send(
    new BatchGetCommand({
      RequestItems: {
        [context.tableName]: {
          Keys: keys,
        },
      },
    }),
  );

  const membersById = new Map(
    ((batch.Responses?.[context.tableName] ?? []) as MemberItem[]).filter(Boolean).map((item) => [item.memberId, item]),
  );
  return normalizedIds.map((memberId) => membersById.get(memberId)).filter(Boolean) as MemberItem[];
};

const resolveHouseholdMemberIds = async (context: RequestContext, householdIds: string[] | undefined, deps: HandlerDependencies) => {
  const normalizedIds = normalizeMemberIds(householdIds);
  const memberIds = new Set<string>();

  for (const householdId of normalizedIds) {
    const household = await getHousehold(context, householdId, deps);
    if (!household) {
      throw new HttpError(404, "Household not found.");
    }

    const members = await listMembersByHouseholdId(context, householdId, deps);
    members.forEach((member) => memberIds.add(member.memberId));
  }

  return [...memberIds];
};

const updateHouseholdMembership = async (
  context: RequestContext,
  householdId: string,
  input: CreateHouseholdInput,
  deps: HandlerDependencies,
  existing?: HouseholdItem | null,
  options: {
    allowReassign?: boolean;
  } = {},
) => {
  const startedAt = Date.now();
  const memberIds = normalizeMemberIds(input.memberIds);
  const members = await loadMembersByIds(context, memberIds, deps);
  if (members.length !== memberIds.length) {
    throw new HttpError(400, "One or more household members were not found.");
  }

  const household = buildHouseholdItem(context, householdId, input, members, deps, existing);
  if (household.addressKey) {
    const existingHousehold = await getHouseholdByAddressKey(context, household.addressKey, deps);
    if (existingHousehold && existingHousehold.householdId !== householdId) {
      throw new HttpError(409, "A household already exists for this address.");
    }
  }

  const existingMembers = existing ? await listMembersByHouseholdId(context, householdId, deps) : [];
  const nextIds = new Set(memberIds);
  const priorHouseholdIds = new Set<string>();
  for (const member of members) {
    if (member.householdId && member.householdId !== householdId) {
      if (!options.allowReassign) {
        throw new HttpError(409, `${member.fullName} already belongs to another household.`);
      }
      priorHouseholdIds.add(member.householdId);
    }
  }

  const tagWrites = await tagAssignmentWrites(context, household, existing, deps);
  const transactItems: Array<Record<string, unknown>> = [
    { Put: { Item: household, TableName: context.tableName, ...tagSnapshotGuard(existing?.tagIds) } },
    ...tagWrites,
  ];

  for (const priorHouseholdId of priorHouseholdIds) {
    const priorHousehold = await getHousehold(context, priorHouseholdId, deps);
    if (!priorHousehold) {
      continue;
    }

    const priorMembership = await listMembersByHouseholdId(context, priorHouseholdId, deps);
    const remainingMembers = priorMembership.filter((item) => !memberIds.includes(item.memberId));
    const updatedPriorHousehold = buildHouseholdItem(
      context,
      priorHouseholdId,
      {
        householdName: priorHousehold.householdName,
        address: priorHousehold.address,
        postalCode: priorHousehold.postalCode,
        notes: priorHousehold.notes,
        location: priorHousehold.location,
        areaId: priorHousehold.areaId,
        primaryContactMemberId:
          priorHousehold.primaryContactMemberId && memberIds.includes(priorHousehold.primaryContactMemberId)
            ? undefined
            : priorHousehold.primaryContactMemberId,
      },
      remainingMembers,
      deps,
      priorHousehold,
    );

    transactItems.push({
      Put: {
        ...tagSnapshotGuard(updatedPriorHousehold.tagIds),
        Item: updatedPriorHousehold,
        TableName: context.tableName,
      },
    });
  }

  for (const member of members) {
    const updatedMember = buildMemberItem(
      context,
      {
        ...member,
        householdId,
        householdName: household.householdName,
      },
      deps,
      member,
    );

    transactItems.push({
      Put: {
        ...tagSnapshotGuard(updatedMember.tagIds),
        Item: updatedMember,
        TableName: context.tableName,
      },
    });
  }

  const removedMembersById = new Map(
    (
      await loadMembersByIds(
        context,
        existingMembers
          .filter((existingMember) => !nextIds.has(existingMember.memberId))
          .map((existingMember) => existingMember.memberId),
        deps,
      )
    ).map((item) => [item.memberId, item]),
  );
  for (const existingMember of existingMembers) {
    if (nextIds.has(existingMember.memberId)) {
      continue;
    }

    const member = removedMembersById.get(existingMember.memberId);
    if (member) {
      transactItems.push({
        Put: {
          ...tagSnapshotGuard(member.tagIds),
          Item: buildMemberItem(
            context,
            {
              ...member,
              householdId: undefined,
              householdName: undefined,
            },
            deps,
            member,
          ),
          TableName: context.tableName,
        },
      });
    }
  }

  try {
    if (tagWrites.length) {
      await deps.documentClient.send(new TransactWriteCommand({ TransactItems: transactItems.slice(0, 100) }));
      await transactWriteInChunks(deps.documentClient, transactItems.slice(100));
    } else {
      await transactWriteInChunks(deps.documentClient, transactItems);
    }
  } catch (error) {
    if (household.addressKey && isDynamoCancellationError(error)) {
      throw new HttpError(409, "A household already exists for this address.");
    }

    if (isDynamoCancellationError(error)) {
      throw new HttpError(
        409,
        "This household could not be updated because the address or membership changed at the same time. Please refresh and try again.",
      );
    }

    throw error;
  }

  logImportTiming("updateHouseholdMembership", startedAt, {
    householdId,
    memberCount: memberIds.length,
    reassignedCount: [...priorHouseholdIds].length,
    transactItemCount: transactItems.length,
  });

  return household;
};

const putVisitationRecord = async (context: RequestContext, record: VisitationItem, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: record,
      TableName: context.tableName,
    }),
  );
};

const persistManualVisitationGroup = async (
  context: RequestContext,
  visitationId: string,
  existing: VisitationItem[] | null,
  input: CreateManualVisitationInput | Required<Pick<CreateManualVisitationInput, "title" | "visitDate" | "memberIds">> & {
    type?: VisitationType;
    location?: string;
    notes?: string;
    visitStatus?: string;
    visitorUserId?: string;
    visitorDisplayName?: string;
  },
  deps: HandlerDependencies,
) => {
  const members = await loadMembersByIds(context, input.memberIds, deps);
  if (members.length !== normalizeMemberIds(input.memberIds).length) {
    throw new HttpError(400, "One or more selected members could not be found.");
  }

  const memberIds = members.map((member) => member.memberId);
  const memberNames = members.map((member) => member.fullName);
  const createdAt = existing?.[0]?.createdAt ?? deps.now();
  const createdByUserId = existing?.[0]?.createdByUserId ?? context.actorSub;
  const createdByName = existing?.[0]?.createdByName ?? context.actorName;
  const visitorUserId = toOptionalString(input.visitorUserId) ?? existing?.[0]?.visitorUserId ?? context.actorSub;
  const visitorDisplayName = toOptionalString(input.visitorDisplayName) ?? existing?.[0]?.visitorDisplayName ?? context.actorName;
  const existingByMemberId = new Map((existing ?? []).map((item) => [item.memberId, item]));
  const visitationType = normalizeVisitationType(input.type ?? existing?.[0]?.type);

  for (const record of existing ?? []) {
    await deps.documentClient.send(
      new DeleteCommand({
        Key: {
          PK: tenantVisitationPk(context.tenantId, visitationId),
          SK: visitationMemberSk(record.memberId),
        },
        TableName: context.tableName,
      }),
    );
  }

  for (const member of members) {
    const existingRecord = existingByMemberId.get(member.memberId);
    const nextRecord: VisitationItem = {
      PK: tenantVisitationPk(context.tenantId, visitationId),
      SK: visitationMemberSk(member.memberId),
      GSI1PK: tenantPk(context.tenantId),
      GSI1SK: tenantVisitationGsiSk(input.visitDate, visitorUserId, member.memberId, visitationId),
      GSI2PK: tenantMemberPk(context.tenantId, member.memberId),
      GSI2SK: memberVisitationGsiSk(input.visitDate, visitationId),
      createdAt: existingRecord?.createdAt ?? createdAt,
      updatedAt: deps.now(),
      entityType: "VISITATION",
      tenantId: context.tenantId,
      visitationId,
      source: "manual",
      type: visitationType,
      memberId: member.memberId,
      memberIds,
      memberNames,
      visitorUserId,
      visitorDisplayName,
      createdByUserId,
      createdByName,
      visitDate: input.visitDate,
      title: input.title,
      endDate: undefined,
      allDay: false,
      location: toOptionalString(input.location),
      notes: toOptionalString(input.notes),
      visitStatus: toOptionalString(input.visitStatus) ?? "completed",
      eventId: undefined,
      calendarEventId: undefined,
      calendarId: undefined,
      calendarOwnerUserId: undefined,
      calendarOwnerName: undefined,
    };
    await putVisitationRecord(context, nextRecord, deps);
  }

  return await getVisitationGroup(context, visitationId, deps);
};

const deleteCachedEventOnly = async (context: RequestContext, event: EventItem, deps: HandlerDependencies) => {
  await deleteEvent(context, event.userId, event.calendarId, event.eventId, deps);
};

const deleteEventMemberAssignmentsForEvent = async (
  context: RequestContext,
  event: Pick<EventItem, "calendarId" | "eventId">,
  deps: HandlerDependencies,
) => {
  const existingMembers = await listEventMembers(context, event.calendarId, event.eventId, deps);
  for (const member of existingMembers) {
    await deps.documentClient.send(
      new DeleteCommand({
        Key: {
          PK: tenantEventPk(context.tenantId, event.eventId),
          SK: eventMemberSk(member.memberId),
        },
        TableName: context.tableName,
      }),
    );
  }
};

const deleteStoredEvent = async (context: RequestContext, event: EventItem, deps: HandlerDependencies) => {
  await deleteCachedEventOnly(context, event, deps);
  await deleteEventMemberAssignmentsForEvent(context, event, deps);
  const visitationRecords = await listVisitationsForEvent(context, event.calendarId, event.eventId, deps);
  for (const record of visitationRecords) {
    await deps.documentClient.send(
      new DeleteCommand({
        Key: {
          PK: tenantVisitationPk(context.tenantId, eventVisitationId(event.calendarId, event.eventId)),
          SK: visitationMemberSk(record.memberId),
        },
        TableName: context.tableName,
      }),
    );
  }
};

const listAuditLogs = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#pk": "PK",
      "#sk": "SK",
    },
    ExpressionAttributeValues: {
      ":pk": tenantPk(context.tenantId),
      ":auditPrefix": "AUDIT#",
    },
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :auditPrefix)",
    TableName: context.tableName,
  });

  return items as AuditLogItem[];
};

const scanTenantItemsByEntityTypes = async (
  context: RequestContext,
  entityTypes: string[],
  deps: HandlerDependencies,
) => {
  if (!entityTypes.length) {
    return [] as BaseItem[];
  }

  const names: Record<string, string> = {
    "#tenantId": "tenantId",
    "#entityType": "entityType",
  };
  const values: Record<string, unknown> = {
    ":tenantId": context.tenantId,
  };
  const entityClauses = entityTypes.map((entityType, index) => {
    const key = `:entityType${index}`;
    values[key] = entityType;
    return `#entityType = ${key}`;
  });

  const items = await scanAll(deps.documentClient, {
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    FilterExpression: `#tenantId = :tenantId AND (${entityClauses.join(" OR ")})`,
    TableName: context.tableName,
  });

  return items as BaseItem[];
};

const toDeleteKeys = (items: Array<Pick<BaseItem, "PK" | "SK">>) => items.map((item) => ({ PK: item.PK, SK: item.SK }));

const countEntityTypes = (items: BaseItem[]) =>
  items.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.entityType] = (accumulator[item.entityType] ?? 0) + 1;
    return accumulator;
  }, {});

const buildResetSummary = (
  action: AdminResetAction,
  affectedEntities: Record<string, number>,
): AdminResetSummary => ({
  action,
  recordsDeleted: Object.values(affectedEntities).reduce((total, value) => total + value, 0),
  affectedEntities: Object.entries(affectedEntities)
    .filter(([, deleted]) => deleted > 0)
    .map(([entityType, deleted]) => ({ entityType, deleted }))
    .sort((left, right) => left.entityType.localeCompare(right.entityType)),
  status: "success",
});

const resetGoogleCachedEvents = async (context: RequestContext, deps: HandlerDependencies) => {
  const records = await scanTenantItemsByEntityTypes(context, ["schedule_event", "EVENT_MEMBER", "VISITATION"], deps);
  const eventRecords = records.filter((item): item is EventItem => item.entityType === "schedule_event");
  const assignmentRecords = records.filter((item): item is EventMemberItem => item.entityType === "EVENT_MEMBER");
  const visitationRecords = records.filter(
    (item): item is VisitationItem => item.entityType === "VISITATION" && (item as VisitationItem).source === "calendar",
  );

  await deleteItemsInBatches(
    context,
    [...toDeleteKeys(eventRecords), ...toDeleteKeys(assignmentRecords), ...toDeleteKeys(visitationRecords)],
    deps,
  );

  return buildResetSummary("google_cached_events", {
    schedule_event: eventRecords.length,
    EVENT_MEMBER: assignmentRecords.length,
    VISITATION: visitationRecords.length,
  });
};

const resetGoogleConnections = async (context: RequestContext, deps: HandlerDependencies) => {
  const records = await scanTenantItemsByEntityTypes(
    context,
    [
      "schedule_event",
      "EVENT_MEMBER",
      "VISITATION",
      "google_connection",
      "schedule_calendar",
      "schedule_settings",
      "oauth_state",
    ],
    deps,
  );
  const eventRecords = records.filter((item): item is EventItem => item.entityType === "schedule_event");
  const assignmentRecords = records.filter((item): item is EventMemberItem => item.entityType === "EVENT_MEMBER");
  const visitationRecords = records.filter(
    (item): item is VisitationItem => item.entityType === "VISITATION" && (item as VisitationItem).source === "calendar",
  );
  const connectionRecords = records.filter((item) =>
    item.entityType === "google_connection" ||
    item.entityType === "schedule_calendar" ||
    item.entityType === "schedule_settings" ||
    item.entityType === "oauth_state"
  );
  const groupedCounts = countEntityTypes([
    ...eventRecords,
    ...assignmentRecords,
    ...visitationRecords,
    ...connectionRecords,
  ]);

  await deleteItemsInBatches(
    context,
    [
      ...toDeleteKeys(eventRecords),
      ...toDeleteKeys(assignmentRecords),
      ...toDeleteKeys(visitationRecords),
      ...toDeleteKeys(connectionRecords),
    ],
    deps,
  );

  return buildResetSummary("google_connections", groupedCounts);
};

const resetVisitations = async (context: RequestContext, deps: HandlerDependencies) => {
  const visitations = await listTenantVisitations(context, deps);
  await deleteItemsInBatches(
    context,
    toDeleteKeys(visitations),
    deps,
  );

  return buildResetSummary("visitations", { VISITATION: visitations.length });
};

const resetMembers = async (context: RequestContext, deps: HandlerDependencies) => {
  const records = await scanTenantItemsByEntityTypes(
    context,
    ["MEMBER", "MEMBER_ACTIVITY", "HOUSEHOLD"],
    deps,
  );
  const members = records.filter((item): item is MemberItem => item.entityType === "MEMBER");
  const memberActivities = records.filter((item): item is MemberActivityItem => item.entityType === "MEMBER_ACTIVITY");
  const households = records.filter((item): item is HouseholdItem => item.entityType === "HOUSEHOLD");
  let tagAssignments = 0;
  for (const entity of [...members, ...households]) {
    tagAssignments += entity.tagIds?.length ?? 0;
    if (entity.tagIds?.length) await persistTaggedEntity(context, { ...entity, tagIds: [] }, entity, deps);
  }
  await deleteItemsInBatches(context, [...toDeleteKeys(members), ...toDeleteKeys(memberActivities)], deps);
  await deleteItemsInBatches(context, toDeleteKeys(households), deps);

  return buildResetSummary("members", {
    TAG_ASSIGNMENT: tagAssignments,
    MEMBER: members.length,
    MEMBER_ACTIVITY: memberActivities.length,
    HOUSEHOLD: households.length,
  });
};

const resetAuditLogs = async (context: RequestContext, deps: HandlerDependencies) => {
  const auditLogs = await listAuditLogs(context, deps);
  await deleteItemsInBatches(
    context,
    toDeleteKeys(auditLogs),
    deps,
  );

  return buildResetSummary("audit_logs", {
    AUDIT_LOG: auditLogs.length,
  });
};

const resetEntireTenant = async (context: RequestContext, deps: HandlerDependencies) => {
  const records = await scanAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#tenantId": "tenantId",
    },
    ExpressionAttributeValues: {
      ":tenantId": context.tenantId,
    },
    FilterExpression: "#tenantId = :tenantId",
    TableName: context.tableName,
  });

  const groupedCounts = (records as BaseItem[]).reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.entityType] = (accumulator[item.entityType] ?? 0) + 1;
    return accumulator;
  }, {});

  await deleteItemsInBatches(
    context,
    toDeleteKeys(records as BaseItem[]),
    deps,
  );

  return buildResetSummary("tenant_all", groupedCounts);
};

const deleteOAuthState = async (state: string, tableName: string, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new DeleteCommand({
      Key: {
        PK: oauthStatePk(state),
        SK: oauthStateSk(state),
      },
      TableName: tableName,
    }),
  );
};

const refreshGoogleAccessTokenIfNeeded = async (
  context: RequestContext,
  connection: GoogleConnectionItem,
  deps: HandlerDependencies,
) => {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const now = Date.now();

  if (!expiresAt || expiresAt - now > 60_000) {
    return connection;
  }

  if (!connection.refreshToken) {
    await markGoogleConnectionError(context, connection, deps, "expired");
    throw new HttpError(400, googleReauthMessage);
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken,
  });

  const response = await deps.fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    await markGoogleConnectionError(context, connection, deps);
    if (isGoogleRefreshTokenInvalid(details)) {
      throw new HttpError(400, googleReauthMessage);
    }

    throw new Error(`Unable to refresh Google token: ${details}`);
  }

  const payload = (await response.json()) as GoogleTokenResponse;
  const refreshedAt = deps.now();
  const refreshedConnection: GoogleConnectionItem = {
    ...connection,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? connection.refreshToken,
    tokenExpiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : connection.tokenExpiresAt,
    lastTokenRefreshAt: refreshedAt,
    scopes: payload.scope ? payload.scope.split(" ") : connection.scopes,
    status: "connected",
    updatedAt: refreshedAt,
  };

  await putGoogleConnection(context, refreshedConnection, deps);
  return refreshedConnection;
};

const googleFetch = async (
  context: RequestContext,
  connection: GoogleConnectionItem,
  url: string,
  deps: HandlerDependencies,
  init?: RequestInit,
) => {
  const currentConnection = await refreshGoogleAccessTokenIfNeeded(context, connection, deps);
  if (!hasRequiredGoogleScopes(currentConnection.scopes)) {
    await markGoogleConnectionScopeError(context, currentConnection, deps);
    throw new HttpError(400, googleReconnectMessage);
  }

  const response = await deps.fetchImpl(url, {
    ...init,
    headers: {
      authorization: `Bearer ${currentConnection.accessToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    if (
      response.status === 403 &&
      (details.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
        details.includes("insufficientPermissions") ||
        details.includes("insufficient authentication scopes"))
    ) {
      await markGoogleConnectionScopeError(context, currentConnection, deps);
      throw new HttpError(400, googleReconnectMessage);
    }

    throw new Error(`Google Calendar request failed: ${details}`);
  }

  return response;
};

const fetchGoogleCalendars = async (
  context: RequestContext,
  connection: GoogleConnectionItem,
  deps: HandlerDependencies,
) => {
  const response = await googleFetch(context, connection, GOOGLE_CALENDAR_LIST_URL, deps);
  const payload = (await response.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      timeZone?: string;
      backgroundColor?: string;
      foregroundColor?: string;
      primary?: boolean;
      accessRole?: string;
    }>;
  };

  return payload.items ?? [];
};

const syncCalendarListFromGoogle = async (
  context: RequestContext,
  connection: GoogleConnectionItem,
  deps: HandlerDependencies,
) => {
  const now = deps.now();
  const existingCalendars = await listCalendars(context, deps);
  const existingById = new Map(existingCalendars.map((calendar) => [calendar.calendarId, calendar]));
  const googleCalendars = await fetchGoogleCalendars(context, connection, deps);

  const syncedCalendars: CalendarItem[] = [];

  for (const entry of googleCalendars) {
    const existing = existingById.get(entry.id);
    const sync = existing?.sync ?? {
      syncMode: "CACHE_UNTIL_STALE",
      refreshIntervalMinutes: entry.primary ? 5 : 60 * 24,
      initialSyncRange: defaultInitialSyncRange(now),
      lastSyncStatus: "idle" as SyncStatus,
      requiresFullSync: true,
    };

    const calendar: CalendarItem = {
      PK: userPk(context.actorSub),
      SK: calendarSk(entry.id),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      entityType: "schedule_calendar",
      userId: context.actorSub,
      tenantId: context.tenantId,
      calendarId: entry.id,
      summary: entry.summary ?? "Untitled calendar",
      description: entry.description,
      timeZone: entry.timeZone,
      backgroundColor: entry.backgroundColor,
      foregroundColor: entry.foregroundColor,
      primary: Boolean(entry.primary),
      accessRole: entry.accessRole,
      enabled: existing?.enabled ?? true,
      selected: existing?.selected ?? Boolean(entry.primary),
      calendarListRefreshedAt: now,
      sync: {
        ...sync,
        initialSyncRange: normalizeInitialSyncRange(sync.initialSyncRange, now),
      },
    };

    await putCalendar(context, calendar, deps);
    syncedCalendars.push(calendar);
  }

  return syncedCalendars.sort((left, right) => {
    if (left.primary !== right.primary) {
      return left.primary ? -1 : 1;
    }

    return left.summary.localeCompare(right.summary);
  });
};

const shouldRefreshCalendar = (calendar: CalendarItem, forceSync: boolean) => {
  if (!calendar.enabled) {
    return false;
  }

  if (forceSync || calendar.sync.requiresFullSync) {
    return true;
  }

  if (calendar.sync.syncMode === "ALWAYS_GOOGLE") {
    return true;
  }

  if (!calendar.sync.lastSyncedAt) {
    return true;
  }

  const ageMs = Date.now() - new Date(calendar.sync.lastSyncedAt).getTime();
  return ageMs >= calendar.sync.refreshIntervalMinutes * 60_000;
};

const upsertGoogleEventIntoCache = async (
  context: RequestContext,
  calendar: CalendarItem,
  googleEvent: GoogleEventPayload,
  source: SyncSource,
  existingOverride: EventItem | undefined,
  deps: HandlerDependencies,
) => {
  const now = deps.now();
  const allDay = !googleEvent.start?.dateTime;
  const defaultStartDate = now.slice(0, 10);
  const start = allDay
    ? googleEvent.start?.date ?? defaultStartDate
    : googleEvent.start?.dateTime ?? `${defaultStartDate}T00:00:00.000Z`;
  const end = allDay
    ? googleEvent.end?.date ?? shiftDateOnlyValue(start, 1)
    : googleEvent.end?.dateTime ?? `${defaultStartDate}T23:59:59.999Z`;
  const existing = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: eventSk(calendar.calendarId, googleEvent.id),
      },
      TableName: context.tableName,
    }),
  );

  const existingItem = existingOverride ?? (existing.Item as EventItem | undefined);
  const dismissedAutoLinkedMemberIds = normalizeMemberIds(existingItem?.dismissedAutoLinkedMemberIds);
  const metadataMemberIds = parseGoogleMemberIds(googleEvent.extendedProperties?.private?.memberIds);
  const memberIds = metadataMemberIds.length ? metadataMemberIds : normalizeMemberIds(existingItem?.memberIds);
  const existingVisitations = await listVisitationsForEvent(context, calendar.calendarId, googleEvent.id, deps);
  const existingVisitationMemberIds = [...new Set(existingVisitations.map((record) => record.memberId))];
  const autoLinkedInteraction = existingVisitations.length
    ? {
        interactionType:
          existingItem?.autoLinkedVisitationType
          ?? (existingVisitations[0] ? normalizeVisitationType(existingVisitations[0].type) : undefined),
        matchedMembers: (await listMembers(context, deps)).filter((member) =>
          existingVisitationMemberIds.includes(member.memberId)
        ),
      }
    : await resolveAutoLinkedInteractionMembers(
        context,
        {
          calendarId: calendar.calendarId,
          eventId: googleEvent.id,
          googleEventId: googleEvent.id,
          summary: googleEvent.summary ?? "(Untitled event)",
          attendees: normalizeAttendees((googleEvent.attendees ?? []).map((entry) => entry.email ?? "")),
        },
        deps,
      );
  const filteredAutoLinkedMembers = autoLinkedInteraction.matchedMembers.filter(
    (member) => !dismissedAutoLinkedMemberIds.includes(member.memberId),
  );
  const item: EventItem = {
    PK: userPk(context.actorSub),
    SK: eventSk(calendar.calendarId, googleEvent.id),
    GSI1PK: eventGsiPk(context.actorSub, calendar.calendarId),
    GSI1SK: eventGsiSk(start, googleEvent.id),
    createdAt: now,
    updatedAt: now,
    entityType: "schedule_event",
    userId: context.actorSub,
    tenantId: context.tenantId,
    calendarId: calendar.calendarId,
    eventId: googleEvent.id,
    googleEventId: googleEvent.id,
    calendarName: calendar.summary,
    calendarColor: calendar.backgroundColor,
    summary: googleEvent.summary ?? "(Untitled event)",
    description: googleEvent.description,
    location: googleEvent.location,
    attendees: normalizeAttendees((googleEvent.attendees ?? []).map((entry) => entry.email ?? "")),
    start,
    end,
    allDay,
    status: googleEvent.status ?? "confirmed",
    source,
    htmlLink: googleEvent.htmlLink,
    autoLinkedMemberIds: filteredAutoLinkedMembers.map((member) => member.memberId),
    autoLinkedMemberNames: filteredAutoLinkedMembers.map((member) => member.fullName),
    dismissedAutoLinkedMemberIds,
    autoLinkedVisitationType: autoLinkedInteraction.interactionType,
    memberIds,
    visitationType: memberIds.length ? normalizeVisitationType(existingItem?.visitationType) : undefined,
  };
  return await persistEventWithMemberAssignments(
    context,
    {
      ...item,
      createdAt: existingItem?.createdAt ?? item.createdAt,
    },
    deps,
    {
      autoLinkedMembers: filteredAutoLinkedMembers,
      visitationTypeOverride: autoLinkedInteraction.interactionType,
    },
  );
};

const applyFullSync = async (
  context: RequestContext,
  calendar: CalendarItem,
  connection: GoogleConnectionItem,
  deps: HandlerDependencies,
) => {
  const syncRange = normalizeInitialSyncRange(calendar.sync.initialSyncRange, deps.now());
  const { timeMin, timeMax } = buildInitialSyncWindow(syncRange);
  const params = new URLSearchParams({
    singleEvents: "true",
    showDeleted: "true",
    orderBy: "startTime",
    timeMin,
  });
  if (timeMax) {
    params.set("timeMax", timeMax);
  }

  const allExisting = await listAllEventsForCalendar(context, calendar.calendarId, deps);
  const existingByEventId = new Map(allExisting.map((event) => [event.eventId, event]));
  const seenEventIds = new Set<string>();

  let pageToken = "";
  let nextSyncToken = "";

  do {
    if (pageToken) {
      params.set("pageToken", pageToken);
    } else {
      params.delete("pageToken");
    }

    const response = await googleFetch(
      context,
      connection,
      `${GOOGLE_CALENDAR_EVENTS_URL(calendar.calendarId)}?${params.toString()}`,
      deps,
    );

    const payload = (await response.json()) as {
      items?: GoogleEventPayload[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    for (const event of payload.items ?? []) {
      seenEventIds.add(event.id);
      if (event.status === "cancelled") {
        const existingEvent = existingByEventId.get(event.id);
        if (existingEvent) {
          await deleteStoredEvent(context, existingEvent, deps);
        }
        continue;
      }

      await upsertGoogleEventIntoCache(context, calendar, event, "GOOGLE", existingByEventId.get(event.id), deps);
    }

    pageToken = payload.nextPageToken ?? "";
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  for (const event of allExisting) {
    if (!seenEventIds.has(event.eventId)) {
      await deleteCachedEventOnly(context, event, deps);
    }
  }

  const cachedEvents = await listEventsForCalendar(context, calendar.calendarId, timeMin, timeMax, deps);
  return {
    cachedEvents,
    syncToken: nextSyncToken,
    timeMin,
    timeMax,
  };
};

const applyIncrementalSync = async (
  context: RequestContext,
  calendar: CalendarItem,
  connection: GoogleConnectionItem,
  deps: HandlerDependencies,
) => {
  let pageToken = "";
  let nextSyncToken = calendar.sync.syncToken ?? "";

  do {
    const params = new URLSearchParams({
      showDeleted: "true",
      syncToken: calendar.sync.syncToken ?? "",
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await googleFetch(
      context,
      connection,
      `${GOOGLE_CALENDAR_EVENTS_URL(calendar.calendarId)}?${params.toString()}`,
      deps,
    );

    const payload = (await response.json()) as {
      items?: GoogleEventPayload[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    for (const event of payload.items ?? []) {
      if (event.status === "cancelled") {
        const existingEvent = await getEvent(context, calendar.calendarId, event.id, deps);
        if (existingEvent) {
          await deleteStoredEvent(context, existingEvent, deps);
        }
      } else {
        await upsertGoogleEventIntoCache(context, calendar, event, "GOOGLE", undefined, deps);
      }
    }

    pageToken = payload.nextPageToken ?? "";
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  const syncWindow = buildInitialSyncWindow(normalizeInitialSyncRange(calendar.sync.initialSyncRange, deps.now()));
  const cachedEvents = await listEventsForCalendar(context, calendar.calendarId, syncWindow.timeMin, syncWindow.timeMax, deps);
  return {
    cachedEvents,
    syncToken: nextSyncToken,
    timeMin: syncWindow.timeMin,
    timeMax: syncWindow.timeMax,
  };
};

const refreshCalendarEvents = async (
  context: RequestContext,
  calendar: CalendarItem,
  connection: GoogleConnectionItem,
  requestedTimeMin: string,
  requestedTimeMax: string | undefined,
  deps: HandlerDependencies,
) => {
  try {
    const result =
      calendar.sync.syncToken && !calendar.sync.requiresFullSync
        ? await applyIncrementalSync(context, calendar, connection, deps)
        : await applyFullSync(context, calendar, connection, deps);

    const now = deps.now();
    const updatedCalendar: CalendarItem = {
      ...calendar,
      updatedAt: now,
      sync: {
        ...calendar.sync,
        initialSyncWindowStart: result.timeMin,
        initialSyncWindowEnd: result.timeMax,
        lastSyncedAt: now,
        lastSyncCompletedAt: now,
        lastSyncError: undefined,
        lastSyncSource: "GOOGLE",
        lastSyncStartedAt: calendar.sync.lastSyncStartedAt ?? now,
        lastSyncStatus: "success",
        requiresFullSync: false,
        syncToken: result.syncToken,
      },
    };

    await putCalendar(context, updatedCalendar, deps);
    const requestedEvents = await listEventsForCalendar(
      context,
      calendar.calendarId,
      requestedTimeMin,
      requestedTimeMax,
      deps,
    );
    return {
      calendar: updatedCalendar,
      events: requestedEvents,
      refreshed: true,
      source: "GOOGLE" as SyncSource,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error.";
    const recoverable = message.includes("Sync token") || message.includes("410");
    if (recoverable) {
      const resetCalendar: CalendarItem = {
        ...calendar,
        updatedAt: deps.now(),
        sync: {
          ...calendar.sync,
          requiresFullSync: true,
          syncToken: undefined,
        },
      };
      await putCalendar(context, resetCalendar, deps);
      return refreshCalendarEvents(
        context,
        resetCalendar,
        connection,
        requestedTimeMin,
        requestedTimeMax,
        deps,
      );
    }

    const failedCalendar: CalendarItem = {
      ...calendar,
      updatedAt: deps.now(),
      sync: {
        ...calendar.sync,
        lastSyncCompletedAt: deps.now(),
        lastSyncError: message,
        lastSyncSource: "GOOGLE",
        lastSyncStatus: "error",
      },
    };
    await putCalendar(context, failedCalendar, deps);
    throw error;
  }
};

const getCachedCalendarEvents = async (
  context: RequestContext,
  calendar: CalendarItem,
  timeMin: string,
  timeMax: string | undefined,
  deps: HandlerDependencies,
) => {
  const events = await listEventsForCalendar(context, calendar.calendarId, timeMin, timeMax, deps);
  const now = deps.now();
  const updatedCalendar: CalendarItem = {
    ...calendar,
    updatedAt: now,
    sync: {
      ...calendar.sync,
      lastSyncSource: "CACHE",
      lastSyncStatus: calendar.sync.lastSyncStatus === "error" ? "error" : "success",
    },
  };

  await putCalendar(context, updatedCalendar, deps);
  return {
    calendar: updatedCalendar,
    events,
    refreshed: false,
    source: "CACHE" as SyncSource,
  };
};

const syncSelectedCalendars = async (
  context: RequestContext,
  deps: HandlerDependencies,
  options: {
    timeMin: string;
    timeMax: string | undefined;
    forceSync: boolean;
    cacheOnly?: boolean;
    calendarIds?: string[];
  },
): Promise<ScheduleEventsResponse> => {
  const connection = await getGoogleConnection(context, deps);
  const calendars = (await listCalendars(context, deps)).filter(
    (calendar) =>
      calendar.enabled &&
      (options.calendarIds?.length
        ? options.calendarIds.includes(calendar.calendarId)
        : calendar.selected) &&
      (!options.calendarIds?.length || options.calendarIds.includes(calendar.calendarId)),
  );

  if (!calendars.length) {
    return {
      events: [],
      calendars: [],
      generatedAt: deps.now(),
    };
  }

  const results: SyncResult[] = [];

  for (const calendar of calendars) {
    const refreshNeeded = !options.cacheOnly && shouldRefreshCalendar(calendar, options.forceSync);
    if (refreshNeeded) {
      if (!connection) {
        throw new Error("Connect Google Calendar before running a sync.");
      }

      results.push(
        await refreshCalendarEvents(
          context,
          calendar,
          connection,
          options.timeMin,
          options.timeMax,
          deps,
        ),
      );
    } else {
      results.push(await getCachedCalendarEvents(context, calendar, options.timeMin, options.timeMax, deps));
    }
  }

  const events = results
    .flatMap((result) => result.events)
    .sort((left, right) => left.start.localeCompare(right.start))
    .map(toScheduleEvent);

  return {
    events,
    calendars: results.map((result) => toSyncSnapshot(result.calendar, result)),
    generatedAt: deps.now(),
  };
};

type TagItem = Tag & BaseItem & { revision: string };
const parseTagIds = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
  ) {
    throw new HttpError(400, "Select up to 20 valid tags.");
  }
  return [...new Set(value as string[])].sort();
};
const parseTagMode = (value: unknown): "any" | "all" => {
  if (value !== undefined && value !== "any" && value !== "all")
    throw new HttpError(400, "Tag match mode must be any or all.");
  return value === "all" ? "all" : "any";
};
const parseTagFilters = (params: Record<string, string | undefined>): TagFilters => ({
  tagIds: parseTagIds(params.tagIds?.split(",").filter(Boolean)),
  tagMatchMode: parseTagMode(params.tagMatchMode),
});
const tagKey = (context: RequestContext, id: string) => ({ PK: tenantPk(context.tenantId), SK: `TAG#${id}` });
const tagNameKey = (context: RequestContext, name: string) => ({
  PK: tenantPk(context.tenantId),
  SK: `TAG_NAME#${name}`,
});
const tagPartition = (context: RequestContext, id: string) => `${tenantPk(context.tenantId)}#TAG#${id}`;
const toTag = ({ PK: _pk, SK: _sk, revision: _revision, ...tag }: TagItem): Tag => tag;
const getTag = async (context: RequestContext, id: string, deps: HandlerDependencies) => {
  const result = await deps.documentClient.send(
    new GetCommand({ TableName: context.tableName, Key: tagKey(context, id), ConsistentRead: true }),
  );
  return result.Item as TagItem | undefined;
};
const normalizeTagInput = (input: TagInput): TagInput & { normalizedName: string } => {
  if (typeof input.name !== "string") throw new HttpError(400, "Tag name is required.");
  const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name))
    throw new HttpError(400, "Tag name must contain 1–60 printable characters.");
  if (!["member", "household", "both"].includes(input.target))
    throw new HttpError(400, "Invalid tag target.");
  if (input.active !== undefined && typeof input.active !== "boolean")
    throw new HttpError(400, "Active must be a boolean.");
  if (
    input.description !== undefined &&
    (typeof input.description !== "string" || input.description.length > 500)
  )
    throw new HttpError(400, "Description must be at most 500 characters.");
  if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color))
    throw new HttpError(400, "Color must be a six-digit hex color.");
  return {
    name,
    normalizedName: name.toLocaleLowerCase("en-US"),
    target: input.target,
    active: input.active ?? true,
    description: input.description?.trim() || undefined,
    color: input.color || undefined,
  };
};
const handleTags = async (
  context: RequestContext,
  method: string,
  id: string | undefined,
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: HandlerDependencies,
) => {
  if (method === "GET" && !id) {
    const target = event.queryStringParameters?.target;
    if (target && !["member", "household", "both"].includes(target))
      throw new HttpError(400, "Invalid tag target.");
    const items = await queryAll(deps.documentClient, {
      TableName: context.tableName,
      ConsistentRead: true,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": tenantPk(context.tenantId), ":prefix": "TAG#" },
    });
    return json(200, {
      items: (items as TagItem[])
        .filter(
          (tag) =>
            (event.queryStringParameters?.includeInactive === "true" || tag.active) &&
            (!target || tag.target === target || tag.target === "both"),
        )
        .map(toTag)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  await requireAdminContext(context, deps, `admin.tags.${method.toLowerCase()}`);
  const existing = id ? await getTag(context, id, deps) : undefined;
  if (id && !existing) throw new HttpError(404, "Tag not found.");
  if (method === "DELETE" && existing) {
    // A counter is updated in the same transaction as every assignment. The
    // conditional delete also closes the race with a simultaneous assignment.
    if (existing.assignmentCount)
      throw new HttpError(
        409,
        "This tag is assigned. Deactivate it, or remove its assignments before deleting.",
      );
    try {
      await deps.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: context.tableName,
                Key: tagKey(context, existing.tagId),
                ConditionExpression: "assignmentCount = :zero AND revision = :version",
                ExpressionAttributeValues: { ":zero": 0, ":version": existing.revision },
              },
            },
            { Delete: { TableName: context.tableName, Key: tagNameKey(context, existing.normalizedName) } },
          ],
        }),
      );
    } catch (error) {
      if (isDynamoCancellationError(error))
        throw new HttpError(409, "The tag changed or was assigned while deleting. Refresh and try again.");
      throw error;
    }
    return json(200, { deleted: true });
  }
  if ((method !== "POST" || id) && (method !== "PUT" || !id)) throw new HttpError(405, "Method not allowed.");
  let raw: TagInput;
  try {
    raw = parseBody<TagInput>(event.body);
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "Invalid tag input.");
  const input = normalizeTagInput({ ...existing, ...raw });
  if (existing && existing.target !== input.target && existing.assignmentCount)
    throw new HttpError(409, "Remove assignments before changing the tag target.");
  const tagId = existing?.tagId ?? deps.uuid();
  const timestamp = deps.now();
  const item: TagItem = {
    ...tagKey(context, tagId),
    ...input,
    entityType: "TAG",
    tenantId: context.tenantId,
    tagId,
    assignmentCount: existing?.assignmentCount ?? 0,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    revision: deps.uuid(),
  };
  const writes: Array<Record<string, unknown>> = [
    {
      Put: {
        TableName: context.tableName,
        Item: item,
        ConditionExpression: existing
          ? "revision = :version AND assignmentCount = :count"
          : "attribute_not_exists(PK)",
        ...(existing
          ? {
              ExpressionAttributeValues: {
                ":version": existing.revision,
                ":count": existing.assignmentCount,
              },
            }
          : {}),
      },
    },
  ];
  if (!existing || existing.normalizedName !== item.normalizedName) {
    writes.push({
      Put: {
        TableName: context.tableName,
        Item: {
          ...tagNameKey(context, item.normalizedName),
          tenantId: context.tenantId,
          entityType: "TAG_NAME",
          tagId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
    if (existing)
      writes.push({
        Delete: { TableName: context.tableName, Key: tagNameKey(context, existing.normalizedName) },
      });
  }
  try {
    await deps.documentClient.send(new TransactWriteCommand({ TransactItems: writes }));
  } catch (error) {
    if (isDynamoCancellationError(error))
      throw new HttpError(
        409,
        "A tag with this name already exists, or the tag changed. Refresh and try again.",
      );
    throw error;
  }
  return json(existing ? 200 : 201, toTag(item));
};

// Every full entity write guards its tag snapshot, including imports and moves.
// This prevents an unrelated stale write from undoing a concurrent tag edit.
const tagSnapshotGuard = (ids: string[] | undefined) => ({
  ConditionExpression: ids === undefined ? "attribute_not_exists(tagIds)" : "tagIds = :previousTags",
  ...(ids === undefined ? {} : { ExpressionAttributeValues: { ":previousTags": ids } }),
});
const tagAssignmentWrites = async (
  context: RequestContext,
  entity: MemberItem | HouseholdItem,
  previous: MemberItem | HouseholdItem | null | undefined,
  deps: HandlerDependencies,
) => {
  const next = parseTagIds(entity.tagIds);
  const before = previous?.tagIds ?? [];
  if (entity.tagIds !== undefined) entity.tagIds = next;
  const target = entity.entityType === "MEMBER" ? "member" : "household";
  const added = next.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !next.includes(id));
  const definitions = await Promise.all(added.map((id) => getTag(context, id, deps)));
  if (definitions.some((tag) => !tag || !tag.active || (tag.target !== target && tag.target !== "both")))
    throw new HttpError(400, "One or more tags are missing, inactive, or do not apply to this entity.");
  const writes: Array<Record<string, unknown>> = [];
  for (const id of [...added, ...removed]) {
    const adding = added.includes(id);
    writes.push({
      Update: {
        TableName: context.tableName,
        Key: tagKey(context, id),
        UpdateExpression: "ADD assignmentCount :delta",
        ConditionExpression: adding
          ? "attribute_exists(PK) AND #active = :active AND (#target = :target OR #target = :both)"
          : "attribute_exists(PK) AND assignmentCount > :zero",
        ...(adding ? { ExpressionAttributeNames: { "#target": "target", "#active": "active" } } : {}),
        ExpressionAttributeValues: adding
          ? { ":delta": 1, ":active": true, ":target": target, ":both": "both" }
          : { ":delta": -1, ":zero": 0 },
      },
    });
    const key = { PK: tagPartition(context, id), SK: entity.SK };
    writes.push(
      adding
        ? {
            Put: {
              TableName: context.tableName,
              Item: {
                ...key,
                tenantId: context.tenantId,
                entityType: "TAG_ASSIGNMENT",
                tagId: id,
                createdAt: deps.now(),
                updatedAt: deps.now(),
              },
            },
          }
        : { Delete: { TableName: context.tableName, Key: key } },
    );
  }
  return writes;
};
const persistTaggedEntity = async (
  context: RequestContext,
  entity: MemberItem | HouseholdItem,
  previous: MemberItem | HouseholdItem | undefined,
  deps: HandlerDependencies,
) => {
  const writes = await tagAssignmentWrites(context, entity, previous, deps);
  try {
    const put = { TableName: context.tableName, Item: entity, ...tagSnapshotGuard(previous?.tagIds) };
    if (!writes.length) await deps.documentClient.send(new PutCommand(put));
    else
      await deps.documentClient.send(new TransactWriteCommand({ TransactItems: [{ Put: put }, ...writes] }));
  } catch (error) {
    if (isDynamoCancellationError(error))
      throw new HttpError(409, "Tags changed while saving. Refresh and try again.");
    throw error;
  }
};
const deleteTaggedEntity = async (
  context: RequestContext,
  entity: MemberItem | HouseholdItem,
  deps: HandlerDependencies,
) => {
  const writes = await tagAssignmentWrites(context, { ...entity, tagIds: [] }, entity, deps);
  const deletion = {
    TableName: context.tableName,
    Key: { PK: entity.PK, SK: entity.SK },
    ...tagSnapshotGuard(entity.tagIds),
  };
  try {
    if (writes.length)
      await deps.documentClient.send(
        new TransactWriteCommand({ TransactItems: [{ Delete: deletion }, ...writes] }),
      );
    else await deps.documentClient.send(new DeleteCommand(deletion));
  } catch (error) {
    if (isDynamoCancellationError(error))
      throw new HttpError(409, "Tags changed while deleting. Refresh and try again.");
    throw error;
  }
};
const taggedEntityIds = async (
  context: RequestContext,
  filters: TagFilters,
  target: "MEMBER" | "HOUSEHOLD",
  deps: HandlerDependencies,
): Promise<Set<string> | undefined> => {
  if (!filters.tagIds?.length) return undefined;
  const groups = await Promise.all(
    filters.tagIds.map(async (id) => {
      const items = await queryAll(deps.documentClient, {
        TableName: context.tableName,
        ConsistentRead: true,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": tagPartition(context, id), ":prefix": `${target}#` },
      });
      return new Set(items.map((item) => String(item.SK).slice(target.length + 1)));
    }),
  );
  return filters.tagMatchMode === "all"
    ? new Set([...groups[0]].filter((id) => groups.every((group) => group.has(id))))
    : new Set(groups.flatMap((group) => [...group]));
};
const loadTaggedEntities = async <T,>(
  context: RequestContext,
  ids: Set<string>,
  prefix: string,
  deps: HandlerDependencies,
): Promise<T[]> => {
  const items: T[] = [];
  for (const batch of chunkItems([...ids], 100)) {
    let request: Record<string, { Keys: Record<string, string>[]; ConsistentRead?: boolean }> = {
      [context.tableName]: {
        Keys: batch.map((id) => ({ PK: tenantPk(context.tenantId), SK: `${prefix}#${id}` })),
        ConsistentRead: true,
      },
    };
    for (let attempt = 0; Object.keys(request).length; attempt++) {
      if (attempt === 6) throw new HttpError(503, "Tag results are temporarily unavailable. Please retry.");
      const response = await deps.documentClient.send(new BatchGetCommand({ RequestItems: request }));
      items.push(...((response.Responses?.[context.tableName] ?? []) as T[]));
      request = (response.UnprocessedKeys ?? {}) as typeof request;
      if (Object.keys(request).length) await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
  return items;
};
const taggedMembers = async (context: RequestContext, filters: TagFilters, deps: HandlerDependencies) => {
  const ids = await taggedEntityIds(context, filters, "MEMBER", deps);
  return ids ? loadTaggedEntities<MemberItem>(context, ids, "MEMBER", deps) : listMembers(context, deps);
};
const taggedHouseholds = async (context: RequestContext, filters: TagFilters, deps: HandlerDependencies) => {
  const ids = await taggedEntityIds(context, filters, "HOUSEHOLD", deps);
  return ids
    ? loadTaggedEntities<HouseholdItem>(context, ids, "HOUSEHOLD", deps)
    : listHouseholds(context, deps);
};
const taggedReportMembers = async (
  context: RequestContext,
  filters: VisitationReportFilters,
  deps: HandlerDependencies,
) => {
  const [members, householdIds] = await Promise.all([
    taggedMembers(context, filters, deps),
    taggedEntityIds(
      context,
      { tagIds: filters.householdTagIds, tagMatchMode: filters.householdTagMatchMode },
      "HOUSEHOLD",
      deps,
    ),
  ]);
  return householdIds
    ? members.filter((member) => member.householdId && householdIds.has(member.householdId))
    : members;
};

const getMembers = async (context: RequestContext, deps: HandlerDependencies, event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const eligible = await taggedMembers(context, parseTagFilters(event.queryStringParameters ?? {}), deps);
  const search = normalizeName(event.queryStringParameters?.q);
  const items = search ? eligible.filter((item) => item.normalizedSearchText.includes(search)) : eligible;
  const response: MemberDirectoryResponse = {
    items: items.map(toMember),
    total: items.length,
  };
  return json(200, response);
};

const getMembersIndex = async (context: RequestContext, deps: HandlerDependencies, event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const eligible = await taggedMembers(context, parseTagFilters(event.queryStringParameters ?? {}), deps);
  const search = normalizeName(event.queryStringParameters?.q);
  const items = search ? eligible.filter((item) => item.normalizedSearchText.includes(search)) : eligible;
  const response: MemberIndexResponse = {
    items: items.map(toMemberIndexItem),
    generatedAt: deps.now(),
  };
  return json(200, response);
};

const getHouseholdConflictsResponse = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await listHouseholdConflicts(context, deps);
  return json(200, {
    items: items.map(toHouseholdConflict),
    total: items.length,
  } satisfies HouseholdConflictListResponse);
};

const getMemberDetails = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const member = await getMember(context, memberId, deps);
  if (!member) {
    return json(404, { message: "Member not found." });
  }

  const activity = await listMemberActivities(context, memberId, deps);
  const household = member.householdId ? await getHousehold(context, member.householdId, deps) : null;
  const householdConflict = await getHouseholdConflict(context, memberId, deps);
  const response: MemberDetailResponse = {
    member: toMember(member),
    household: household ? toHouseholdSummary(household) : undefined,
    householdConflict: householdConflict ? toHouseholdConflict(householdConflict) : undefined,
    activity: activity.map(toMemberActivity),
  };
  return json(200, response);
};

const getHouseholds = async (
  context: RequestContext,
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: HandlerDependencies,
) => {
  const query = normalizeName(event.queryStringParameters?.q);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(event.queryStringParameters?.limit ?? "25"), 10) || 25));

  const tagFilters = parseTagFilters(event.queryStringParameters ?? {});
  if (query || tagFilters.tagIds?.length) {
    const items = (await taggedHouseholds(context, tagFilters, deps))
      .filter((item) => !query || item.normalizedSearchText.includes(query))
      .sort((a, b) => a.householdName.localeCompare(b.householdName) || a.householdId.localeCompare(b.householdId));
    const offset = Number(decodeCursor(event.queryStringParameters?.cursor)?.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, "Invalid pagination cursor.");
    return json(200, {
      items: items.slice(offset, offset + limit).map((item) => toHouseholdSummary(item)),
      total: items.length,
      nextCursor: offset + limit < items.length ? encodeCursor({ offset: offset + limit }) : undefined,
    } satisfies HouseholdDirectoryResponse);
  }

  const page = await queryPage(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI4PK",
      "#gsiSk": "GSI4SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": householdGsiPk(context.tenantId),
      ":from": "NAME#",
      ":to": "NAME#~",
    },
    ExclusiveStartKey: decodeCursor(event.queryStringParameters?.cursor),
    IndexName: GSI4_NAME,
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    Limit: limit,
    TableName: context.tableName,
  });

  const total = await queryCount(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI4PK",
      "#gsiSk": "GSI4SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": householdGsiPk(context.tenantId),
      ":from": "NAME#",
      ":to": "NAME#~",
    },
    IndexName: GSI4_NAME,
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });
  return json(200, {
    items: ((page.Items ?? []) as HouseholdItem[]).map((item) => toHouseholdSummary(item)),
    nextCursor: encodeCursor(page.LastEvaluatedKey as Record<string, unknown> | undefined),
    total,
  } satisfies HouseholdDirectoryResponse);
};

const getHouseholdDetails = async (context: RequestContext, householdId: string, deps: HandlerDependencies) => {
  const household = await getHousehold(context, householdId, deps);
  if (!household) {
    return json(404, { message: "Household not found." });
  }

  const members = await listMembersByHouseholdId(context, householdId, deps);
  return json(200, {
    household: toHouseholdSummary(
      {
        ...household,
        memberCount: members.length,
      },
      members.map((member) => ({
        memberId: member.memberId,
        fullName: member.fullName,
        initials: member.initials,
        phone: member.phone,
        email: member.email,
        householdId: member.householdId,
        householdName: member.householdName,
      })),
    ),
  } satisfies HouseholdDetailResponse);
};

const createHousehold = async (
  context: RequestContext,
  input: CreateHouseholdInput,
  deps: HandlerDependencies,
  options: {
    allowReassign?: boolean;
  } = {},
) => {
  if (input.tagIds !== undefined) parseTagIds(input.tagIds);
  const normalized = normalizeAddress({
    address: toOptionalString(input.address),
    postalCode: toOptionalString(input.postalCode),
  });
  const shouldAutoGeocode = shouldTriggerAutoGeocoding(
    { addressKey: normalized.addressKey },
    null,
    input.location !== undefined,
  );
  const geocodingInput = shouldAutoGeocode
    ? {
      ...input,
      location: prepareAutoGeocodeLocation(),
    }
    : input;

  const validationError = validateHouseholdInput(geocodingInput);
  if (validationError) {
    return json(400, { message: validationError });
  }

  if (normalized.addressKey) {
    const existing = await getHouseholdByAddressKey(context, normalized.addressKey, deps);
    if (existing) {
      return json(409, { message: "A household already exists for this address." });
    }
  }
  const householdId = buildAutoHouseholdId(normalized.addressKey, deps);
  const household = await updateHouseholdMembership(context, householdId, geocodingInput, deps, null, options);

  let responseHousehold = household;
  if (shouldAutoGeocode) {
    try {
      responseHousehold = await applyAutomaticHouseholdGeocoding(context, household, deps);
    } catch (error) {
      console.warn("[household-geocoding]", JSON.stringify({
        action: "create",
        addressKey: household.addressKey,
        error: error instanceof Error ? error.message : "Unexpected geocoding error",
        householdId: household.householdId,
      }));
    }
  }

  return json(201, toHouseholdSummary(responseHousehold));
};

const updateHousehold = async (
  context: RequestContext,
  householdId: string,
  input: UpdateHouseholdInput,
  deps: HandlerDependencies,
) => {
  if (input.tagIds !== undefined) parseTagIds(input.tagIds);
  const existing = await getHousehold(context, householdId, deps);
  if (!existing) {
    return json(404, { message: "Household not found." });
  }
  const membership = await listMembersByHouseholdId(context, householdId, deps);

  const merged: CreateHouseholdInput = {
    tagIds: input.tagIds ?? existing.tagIds,
    householdName: input.householdName ?? existing.householdName,
    address: input.address ?? existing.address,
    postalCode: input.postalCode ?? existing.postalCode,
    notes: input.notes ?? existing.notes,
    location: input.location ?? existing.location,
    areaId: input.areaId ?? existing.areaId,
    memberIds: input.memberIds ?? membership.map((member) => member.memberId),
    primaryContactMemberId: input.primaryContactMemberId ?? existing.primaryContactMemberId,
  };
  const nextNormalized = normalizeAddress({
    address: toOptionalString(merged.address),
    postalCode: toOptionalString(merged.postalCode),
  });
  const shouldAutoGeocode = shouldTriggerAutoGeocoding(
    { addressKey: nextNormalized.addressKey },
    existing,
    input.location !== undefined,
  );
  const geocodingInput = shouldAutoGeocode
    ? {
      ...merged,
      location: prepareAutoGeocodeLocation(existing),
    }
    : merged;

  const validationError = validateHouseholdInput(geocodingInput);
  if (validationError) {
    return json(400, { message: validationError });
  }

  const household = await updateHouseholdMembership(context, householdId, geocodingInput, deps, existing);

  let responseHousehold = household;
  if (shouldAutoGeocode) {
    try {
      responseHousehold = await applyAutomaticHouseholdGeocoding(context, household, deps);
    } catch (error) {
      console.warn("[household-geocoding]", JSON.stringify({
        action: "update",
        addressKey: household.addressKey,
        error: error instanceof Error ? error.message : "Unexpected geocoding error",
        householdId: household.householdId,
      }));
    }
  }

  return json(200, toHouseholdSummary(responseHousehold));
};

const deleteHousehold = async (context: RequestContext, householdId: string, deps: HandlerDependencies) => {
  const household = await getHousehold(context, householdId, deps);
  if (!household) {
    return json(404, { message: "Household not found." });
  }

  const members = await listMembersByHouseholdId(context, householdId, deps);
  if (members.length > 0) {
    return json(400, { message: "Only empty households can be deleted." });
  }

  await deleteTaggedEntity(context, household, deps);

  return json(200, { deleted: true, householdId });
};

const matchHouseholdByAddress = async (
  context: RequestContext,
  input: { address?: string; postalCode?: string },
  deps: HandlerDependencies,
) => {
  const { normalized, households } = await findHouseholdsByAddressMatch(
    context,
    toOptionalString(input.address),
    toOptionalString(input.postalCode),
    deps,
  );

  return json(200, {
    normalizedAddress: normalized.normalizedAddress,
    normalizedPostalCode: normalized.normalizedPostalCode,
    unit: normalized.unit,
    addressKey: normalized.addressKey,
    status: households.length ? "MATCH" : "NO_MATCH",
    matches: households.map((household) => toHouseholdSummary(household)),
  } satisfies HouseholdMatchResponse);
};

const attachMemberToHousehold = async (
  context: RequestContext,
  memberId: string,
  householdId: string,
  deps: HandlerDependencies,
) => {
  const member = await getMember(context, memberId, deps);
  if (!member) {
    return json(404, { message: "Member not found." });
  }

  const household = await getHousehold(context, householdId, deps);
  if (!household) {
    return json(404, { message: "Household not found." });
  }
  const membership = await listMembersByHouseholdId(context, householdId, deps);

  const memberIds = [...new Set([...membership.map((entry) => entry.memberId), memberId])];
  const updated = await updateHouseholdMembership(context, householdId, {
    householdName: household.householdName,
    address: household.address,
    postalCode: household.postalCode,
    notes: household.notes,
    location: household.location,
    areaId: household.areaId,
    memberIds,
    primaryContactMemberId: household.primaryContactMemberId,
  }, deps, household, { allowReassign: true });

  return json(200, toHouseholdSummary(updated));
};

const removeMemberFromHousehold = async (
  context: RequestContext,
  memberId: string,
  householdId: string,
  deps: HandlerDependencies,
) => {
  const household = await getHousehold(context, householdId, deps);
  if (!household) {
    return json(404, { message: "Household not found." });
  }
  const membership = await listMembersByHouseholdId(context, householdId, deps);

  const nextIds = membership.map((entry) => entry.memberId).filter((id) => id !== memberId);
  const updated = await updateHouseholdMembership(context, householdId, {
    householdName: household.householdName,
    address: household.address,
    postalCode: household.postalCode,
    notes: household.notes,
    location: household.location,
    areaId: household.areaId,
    memberIds: nextIds,
    primaryContactMemberId:
      household.primaryContactMemberId === memberId ? undefined : household.primaryContactMemberId,
  }, deps, household);

  return json(200, toHouseholdSummary(updated));
};

const resolveHouseholdConflict = async (
  context: RequestContext,
  memberId: string,
  input: ResolveHouseholdConflictInput,
  deps: HandlerDependencies,
) => {
  const conflict = await getHouseholdConflict(context, memberId, deps);
  if (!conflict) {
    return json(404, { message: "Household conflict not found." });
  }

  const member = await getMember(context, memberId, deps);
  if (!member) {
    return json(404, { message: "Member not found." });
  }

  if (input.action === "KEEP_CURRENT_HOUSEHOLD") {
    await deleteHouseholdConflict(context, memberId, deps);
    await logMemberActivity(
      context,
      memberId,
      "Household Conflict Resolved",
      "Kept the current household assignment.",
      deps,
      { resolution: input.action },
    );
    return json(200, { resolved: true, action: input.action });
  }

  if (input.action === "MOVE_TO_MATCHING_HOUSEHOLD") {
    const matchedHouseholdId = conflict.matchedHouseholdId
      ?? (await findHouseholdsByAddressMatch(
        context,
        conflict.importedAddress ?? member.address,
        conflict.importedPostalCode ?? member.postalCode,
        deps,
      )).households.find((household) => household.householdId !== conflict.currentHouseholdId)?.householdId;

    if (!matchedHouseholdId) {
      return json(400, { message: "No matching household is available for this conflict." });
    }

    const response = await attachMemberToHousehold(context, memberId, matchedHouseholdId, deps);
    await deleteHouseholdConflict(context, memberId, deps);
    await logMemberActivity(
      context,
      memberId,
      "Household Conflict Resolved",
      "Moved the member to the matching household.",
      deps,
      { resolution: input.action, householdId: matchedHouseholdId },
    );
    return response;
  }

  if (input.action === "CREATE_NEW_HOUSEHOLD") {
    const normalized = normalizeAddress({
      address: conflict.importedAddress ?? member.address,
      postalCode: conflict.importedPostalCode ?? member.postalCode,
    });
    const existingHousehold = normalized.addressKey
      ? await getHouseholdByAddressKey(context, normalized.addressKey, deps)
      : null;

    const response = existingHousehold
      ? await attachMemberToHousehold(context, memberId, existingHousehold.householdId, deps)
      : await createHousehold(context, {
        householdName: buildAddressBasedHouseholdName(conflict.importedAddress ?? member.address),
        address: conflict.importedAddress ?? member.address,
        postalCode: conflict.importedPostalCode ?? member.postalCode,
        memberIds: [memberId],
      }, deps, { allowReassign: true });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      await deleteHouseholdConflict(context, memberId, deps);
      await logMemberActivity(
        context,
        memberId,
        "Household Conflict Resolved",
        existingHousehold
          ? "Moved the member to an existing household matching the imported address."
          : "Created a new household from the imported address.",
        deps,
        {
          resolution: input.action,
          householdId: existingHousehold?.householdId,
        },
      );
    }

    return response;
  }

  return json(400, { message: "Unsupported resolution action." });
};

const createMember = async (context: RequestContext, input: CreateMemberInput, deps: HandlerDependencies) => {
  if (input.tagIds !== undefined) parseTagIds(input.tagIds);
  const validationError = validateMemberInput(input);
  if (validationError) {
    return json(400, { message: validationError });
  }

  if (input.unityId) {
    const duplicate = await getMemberByUnityId(context, input.unityId, deps);
    if (duplicate) {
      return json(409, { message: "A member with this Unity ID already exists." });
    }
  }

  const member = buildMemberItem(context, input, deps, null);
  await persistTaggedEntity(context, member, undefined, deps);
  await logMemberActivity(context, member.memberId, "Member Created", `${member.fullName} added.`, deps);
  return json(201, toMember(member));
};

const updateMember = async (
  context: RequestContext,
  memberId: string,
  input: UpdateMemberInput,
  deps: HandlerDependencies,
) => {
  if (input.tagIds !== undefined) parseTagIds(input.tagIds);
  const existing = await getMember(context, memberId, deps);
  if (!existing) {
    return json(404, { message: "Member not found." });
  }

  const merged = { ...existing, ...input, fullName: input.fullName ?? existing.fullName };
  const validationError = validateMemberInput(merged);
  if (validationError) {
    return json(400, { message: validationError });
  }

  if (input.unityId && input.unityId !== existing.unityId) {
    const duplicate = await getMemberByUnityId(context, input.unityId, deps);
    if (duplicate && duplicate.memberId !== memberId) {
      return json(409, { message: "A member with this Unity ID already exists." });
    }
  }

  const member = buildMemberItem(context, merged, deps, existing);
  member.notes = toOptionalString(existing.notes ?? input.notes);
  await persistTaggedEntity(context, member, existing, deps);
  await logMemberActivity(context, member.memberId, "Member Updated", `${member.fullName} updated.`, deps);
  return json(200, toMember(member));
};

const deleteMember = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const member = await getMember(context, memberId, deps);
  if (!member) {
    return json(404, { message: "Member not found." });
  }

  if (member.householdId) {
    const household = await getHousehold(context, member.householdId, deps);
    if (household) {
      const householdMembers = await listMembersByHouseholdId(context, household.householdId, deps);
      await updateHouseholdMembership(context, household.householdId, {
        householdName: household.householdName,
        address: household.address,
        postalCode: household.postalCode,
        notes: household.notes,
        location: household.location,
        areaId: household.areaId,
        memberIds: householdMembers
          .map((item) => item.memberId)
          .filter((id) => id !== memberId),
        primaryContactMemberId:
          household.primaryContactMemberId === memberId ? undefined : household.primaryContactMemberId,
      }, deps, household);
    }
  }

  const eventLinks = await listMemberEvents(context, memberId, deps);
  const visitations = await listMemberVisitations(context, memberId, deps);
  const affectedCalendarEvents = new Map<string, { calendarId: string; eventId: string }>();

  for (const link of eventLinks) {
    affectedCalendarEvents.set(`${link.calendarId}#${link.eventId}`, {
      calendarId: link.calendarId,
      eventId: link.eventId,
    });
  }

  for (const visitation of visitations) {
    if (visitation.source !== "calendar" || !visitation.calendarId || !visitation.eventId) {
      continue;
    }

    affectedCalendarEvents.set(`${visitation.calendarId}#${visitation.eventId}`, {
      calendarId: visitation.calendarId,
      eventId: visitation.eventId,
    });
  }

  for (const { calendarId, eventId } of affectedCalendarEvents.values()) {
    const event = await getEvent(context, calendarId, eventId, deps);
    if (!event) {
      continue;
    }

    const nextAssignedMemberIds = normalizeMemberIds(event.memberIds).filter((id) => id !== memberId);
    const nextAutoLinkedMemberIds = normalizeMemberIds(event.autoLinkedMemberIds).filter((id) => id !== memberId);
    const nextDismissedAutoLinkedMemberIds = normalizeMemberIds(event.dismissedAutoLinkedMemberIds).filter((id) => id !== memberId);
    const nextAutoLinkedMembers = await loadMembersByIds(context, nextAutoLinkedMemberIds, deps);

    await persistEventWithMemberAssignments(
      context,
      {
        ...event,
        memberIds: nextAssignedMemberIds,
        autoLinkedMemberIds: nextAutoLinkedMembers.map((item) => item.memberId),
        autoLinkedMemberNames: nextAutoLinkedMembers.map((item) => item.fullName),
        dismissedAutoLinkedMemberIds: nextDismissedAutoLinkedMemberIds,
      },
      deps,
      {
        autoLinkedMembers: nextAutoLinkedMembers,
        visitationTypeOverride: event.autoLinkedVisitationType,
      },
    );
  }

  for (const visitation of visitations.filter((item) => item.source === "manual")) {
    const group = await getVisitationGroup(context, visitation.visitationId, deps);
    const nextMembers = await loadMembersByIds(
      context,
      group.map((item) => item.memberId).filter((id) => id !== memberId),
      deps,
    );

    await persistManualVisitationGroup(context, visitation.visitationId, group, {
      ...visitation,
      memberIds: nextMembers.map((item) => item.memberId),
    }, deps);
  }

  const manualVisitations = visitations;
  for (const visitation of manualVisitations.filter((item) => item.source === "manual")) {
    await deps.documentClient.send(
      new DeleteCommand({
        Key: {
          PK: tenantVisitationPk(context.tenantId, visitation.visitationId),
          SK: visitationMemberSk(memberId),
        },
        TableName: context.tableName,
      }),
    );
  }

  await deleteTaggedEntity(context, member, deps);
  await logMemberActivity(context, memberId, "Member Deleted", `${member.fullName} deleted.`, deps);
  return json(200, { deleted: true, memberId });
};

const createMemberImportJob = async (context: RequestContext, input: MemberImportInput, deps: HandlerDependencies) => {
  const rows = await parseImportWorkbook(input);
  if (!rows.length) {
    return json(400, { message: "No Unity member rows were found in this workbook." });
  }

  const createdAt = deps.now();
  const jobId = deps.uuid();
  const chunks = chunkItems(rows, importJobChunkSize);
  const jobItem: MemberImportJobItem = {
    PK: tenantPk(context.tenantId),
    SK: memberImportJobSk(jobId),
    createdAt,
    updatedAt: createdAt,
    entityType: "MEMBER_IMPORT_JOB",
    tenantId: context.tenantId,
    jobId,
    fileName: toOptionalString(input.fileName) ?? "Unity import.xlsx",
    status: "queued",
    totalRows: rows.length,
    processedRows: 0,
    totalChunks: chunks.length,
    processedChunks: 0,
    startedAt: undefined,
    completedAt: undefined,
    result: emptyImportResult(),
  };

  const chunkItemsToWrite: MemberImportChunkItem[] = chunks.map((chunk, chunkIndex) => ({
    PK: tenantPk(context.tenantId),
    SK: memberImportChunkSk(jobId, chunkIndex),
    createdAt,
    updatedAt: createdAt,
    entityType: "MEMBER_IMPORT_CHUNK",
    tenantId: context.tenantId,
    jobId,
    chunkIndex,
    rowCount: chunk.length,
    rows: chunk,
  }));

  await putImportJob(context, jobItem, deps);
  await putItemsInBatches(deps.documentClient, context.tableName, chunkItemsToWrite);
  logImportEvent("createMemberImportJob", {
    jobId,
    totalRows: rows.length,
    totalChunks: chunks.length,
    fileName: jobItem.fileName,
  });

  return json(202, toMemberImportJob(jobItem));
};

const createHouseholdGeocodeJob = async (
  context: RequestContext,
  input: CreateHouseholdGeocodeJobInput,
  deps: HandlerDependencies,
) => {
  await requireAdminContext(context, deps, "admin.household_geocode.start");

  const mode = normalizeHouseholdGeocodeJobMode(input.mode);
  const existingJobs = await listHouseholdGeocodeJobs(context, deps);
  const activeJob = existingJobs.find((job) => job.mode === mode && (job.status === "queued" || job.status === "running"));
  if (activeJob) {
    return json(200, toHouseholdGeocodeJob(activeJob));
  }

  const households = await listHouseholds(context, deps);
  const createdAt = deps.now();
  const startedAt = createdAt;
  const total = households.filter((household) => isHouseholdEligibleForGeocodeJob(household, { mode, startedAt })).length;
  const jobId = deps.uuid();
  const job: HouseholdGeocodeJobItem = {
    PK: tenantPk(context.tenantId),
    SK: householdGeocodeJobSk(jobId),
    createdAt,
    updatedAt: createdAt,
    entityType: "HOUSEHOLD_GEOCODE_JOB",
    tenantId: context.tenantId,
    jobId,
    mode,
    status: total > 0 ? "queued" : "completed",
    total,
    processed: 0,
    success: 0,
    failed: 0,
    remaining: total,
    startedAt,
    completedAt: total > 0 ? undefined : createdAt,
  };

  await putHouseholdGeocodeJob(context, job, deps);
  await logAuditEvent(context, "admin.household_geocode.start", "success", deps, {
    metadata: { jobId, mode, total },
  });

  return json(202, toHouseholdGeocodeJob(job));
};

const putImportJob = async (context: RequestContext, item: MemberImportJobItem, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: item,
      TableName: context.tableName,
    }),
  );
};

const processMemberImportJob = async (context: RequestContext, jobId: string, deps: HandlerDependencies) => {
  const startedAt = Date.now();
  const job = await getMemberImportJob(context, jobId, deps);
  if (!job) {
    return json(404, { message: "Import job not found." });
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    logImportEvent("processMemberImportJob.skipped", {
      jobId,
      status: job.status,
      processedRows: job.processedRows,
      totalRows: job.totalRows,
    });
    return json(200, toMemberImportJob(job));
  }

  const leasedJob = await tryAcquireMemberImportJobLease(context, jobId, deps);
  if (!leasedJob) {
    const currentJob = await getMemberImportJob(context, jobId, deps);
    return json(200, toMemberImportJob(currentJob ?? job));
  }

  const chunks = await listMemberImportChunks(context, jobId, deps);
  if (!chunks.length) {
    const completedAt = deps.now();
    const completedJob: MemberImportJobItem = {
      ...leasedJob,
      updatedAt: completedAt,
      completedAt,
      status: "completed",
      processedRows: leasedJob.totalRows,
      processedChunks: leasedJob.totalChunks,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    };
    await putImportJob(context, completedJob, deps);
    logImportEvent("processMemberImportJob.completed", {
      jobId,
      status: completedJob.status,
      processedRows: completedJob.processedRows,
      totalRows: completedJob.totalRows,
      elapsedMs: getElapsedMs(startedAt),
    });
    return json(200, toMemberImportJob(completedJob));
  }

  const existingMembers = await listMembers(context, deps);
  const importState: ImportExecutionState = {
    existingMembersByUnityId: new Map(
      existingMembers
        .filter((member) => member.unityId)
        .map((member) => [member.unityId as string, member]),
    ),
    householdsById: new Map<string, HouseholdItem>(),
    householdsByAddressKey: new Map<string, HouseholdItem>(),
  };
  for (const household of await listHouseholds(context, deps)) {
    upsertHouseholdInImportState(importState, household);
  }
  const chunksToProcess = chunks.slice(0, importJobChunksPerRequest);
  logImportEvent("processMemberImportJob.started", {
    jobId,
    queuedChunks: chunks.length,
    processingChunks: chunksToProcess.length,
    chunkIndexes: chunksToProcess.map((chunk) => chunk.chunkIndex),
    priorProcessedRows: job.processedRows,
    totalRows: leasedJob.totalRows,
  });
  let chunkResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    householdsCreated: 0,
    householdsMatched: 0,
    membersAssignedToHouseholds: 0,
    membersWithoutHouseholds: 0,
    householdConflicts: 0,
    errors: [] as MemberImportResult["errors"],
  };
  let processedRowDelta = 0;
  for (const chunk of chunksToProcess) {
    processedRowDelta += chunk.rowCount;
    for (const row of chunk.rows) {
      const outcome = await processImportRow(context, row, job.fileName, importState, deps);
      chunkResult = {
        created: chunkResult.created + outcome.created,
        updated: chunkResult.updated + outcome.updated,
        skipped: chunkResult.skipped + outcome.skipped,
        householdsCreated: chunkResult.householdsCreated + outcome.householdsCreated,
        householdsMatched: chunkResult.householdsMatched + outcome.householdsMatched,
        membersAssignedToHouseholds: chunkResult.membersAssignedToHouseholds + outcome.membersAssignedToHouseholds,
        membersWithoutHouseholds: chunkResult.membersWithoutHouseholds + outcome.membersWithoutHouseholds,
        householdConflicts: chunkResult.householdConflicts + outcome.householdConflicts,
        errors: [...chunkResult.errors, ...outcome.errors],
      };
    }
  }

  await deleteKeysInBatches(
    deps.documentClient,
    context.tableName,
    chunksToProcess.map((chunk) => ({ PK: chunk.PK, SK: chunk.SK })),
  );

  const updatedAt = deps.now();
  const processedRows = Math.min(leasedJob.totalRows, leasedJob.processedRows + processedRowDelta);
  const processedChunks = Math.min(leasedJob.totalChunks, leasedJob.processedChunks + chunksToProcess.length);
  const result: MemberImportResult = {
    created: (leasedJob.result.created ?? 0) + chunkResult.created,
    updated: (leasedJob.result.updated ?? 0) + chunkResult.updated,
    skipped: (leasedJob.result.skipped ?? 0) + chunkResult.skipped,
    householdsCreated: (leasedJob.result.householdsCreated ?? 0) + chunkResult.householdsCreated,
    householdsMatched: (leasedJob.result.householdsMatched ?? 0) + chunkResult.householdsMatched,
    membersAssignedToHouseholds: (leasedJob.result.membersAssignedToHouseholds ?? 0) + chunkResult.membersAssignedToHouseholds,
    membersWithoutHouseholds: (leasedJob.result.membersWithoutHouseholds ?? 0) + chunkResult.membersWithoutHouseholds,
    householdConflicts: (leasedJob.result.householdConflicts ?? 0) + chunkResult.householdConflicts,
    errorCount: (leasedJob.result.errorCount ?? 0) + chunkResult.errors.length,
    errors: mergeImportErrors(leasedJob.result.errors, chunkResult.errors),
  };
  const status: MemberImportJobStatus = processedChunks >= leasedJob.totalChunks ? "completed" : "running";
  const nextJob: MemberImportJobItem = {
    ...leasedJob,
    updatedAt,
    startedAt: leasedJob.startedAt ?? updatedAt,
    completedAt: status === "completed" ? updatedAt : undefined,
    processedRows,
    processedChunks,
    status,
    result,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  };
  const currentJob = await getMemberImportJob(context, jobId, deps);
  if (currentJob?.status === "cancelled") {
    return json(200, toMemberImportJob(currentJob));
  }
  await putImportJob(context, nextJob, deps);
  logImportEvent("processMemberImportJob.completed", {
    jobId,
    status,
    processedRows,
    totalRows: job.totalRows,
    processedChunks,
    totalChunks: job.totalChunks,
    chunkIndexes: chunksToProcess.map((chunk) => chunk.chunkIndex),
    chunkRows: processedRowDelta,
    created: chunkResult.created,
    updated: chunkResult.updated,
    skipped: chunkResult.skipped,
    householdsCreated: chunkResult.householdsCreated,
    householdsMatched: chunkResult.householdsMatched,
    membersAssignedToHouseholds: chunkResult.membersAssignedToHouseholds,
    householdConflicts: chunkResult.householdConflicts,
    errorCount: chunkResult.errors.length,
    elapsedMs: getElapsedMs(startedAt),
  });

  return json(200, toMemberImportJob(nextJob));
};

const processHouseholdGeocodeJob = async (
  context: RequestContext,
  jobId: string,
  deps: HandlerDependencies,
) => {
  await requireAdminContext(context, deps, "admin.household_geocode.process");

  const job = await getHouseholdGeocodeJob(context, jobId, deps);
  if (!job) {
    return json(404, { message: "Household geocode job not found." });
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return json(200, toHouseholdGeocodeJob(job));
  }

  const leasedJob = await tryAcquireHouseholdGeocodeJobLease(context, jobId, deps);
  if (!leasedJob) {
    const currentJob = await getHouseholdGeocodeJob(context, jobId, deps);
    return json(200, toHouseholdGeocodeJob(currentJob ?? job));
  }

  const households = await listHouseholds(context, deps);
  const nextHousehold = selectNextHouseholdForGeocodeJob(households, leasedJob);

  if (!nextHousehold) {
    const completedAt = deps.now();
    const completedJob: HouseholdGeocodeJobItem = {
      ...leasedJob,
      updatedAt: completedAt,
      completedAt,
      status: "completed",
      remaining: 0,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    };
    await putHouseholdGeocodeJob(context, completedJob, deps);
    return json(200, toHouseholdGeocodeJob(completedJob));
  }

  let updatedHousehold: HouseholdItem;
  let jobFailureReason: string | undefined;

  try {
    updatedHousehold = await applyAutomaticHouseholdGeocoding(
      context,
      {
        ...nextHousehold,
        location: nextHousehold.location ?? buildBatchPendingGeocodeLocation(),
      },
      deps,
    );
    jobFailureReason = updatedHousehold.location?.geocodeStatus === "failed"
      ? "failed"
      : undefined;
  } catch (error) {
    logHouseholdGeocodingEvent("job.household_processing_failed", {
      addressKey: nextHousehold.addressKey,
      errorMessage: error instanceof Error ? error.message : "Unexpected job error",
      errorName: error instanceof Error ? error.name : typeof error,
      householdId: nextHousehold.householdId,
      jobId,
    });
    updatedHousehold = nextHousehold;
    jobFailureReason = "job_error";
  }

  const success = leasedJob.success + (updatedHousehold.location?.geocodeStatus === "success" ? 1 : 0);
  const failed = leasedJob.failed + (updatedHousehold.location?.geocodeStatus === "success" ? 0 : 1);
  const processed = leasedJob.processed + 1;
  const remaining = Math.max(0, leasedJob.total - processed);
  const completedAt = remaining === 0 ? deps.now() : undefined;
  const nextJob: HouseholdGeocodeJobItem = {
    ...leasedJob,
    updatedAt: deps.now(),
    completedAt,
    failed,
    lastFailureReason: jobFailureReason,
    lastProcessedAddressKey: nextHousehold.addressKey,
    lastProcessedHouseholdId: nextHousehold.householdId,
    processed,
    remaining,
    status: remaining === 0 ? "completed" : "running",
    success,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  };
  const currentJob = await getHouseholdGeocodeJob(context, jobId, deps);
  if (currentJob?.status === "cancelled") {
    return json(200, toHouseholdGeocodeJob(currentJob));
  }
  await putHouseholdGeocodeJob(context, nextJob, deps);
  return json(200, toHouseholdGeocodeJob(nextJob));
};

const getMemberEventsResponse = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const member = await getMember(context, memberId, deps);
  if (!member) {
    return json(404, { message: "Member not found." });
  }

  const items = await listVisitationsForMemberRecord(context, member, deps);
  return json(200, { items: items.map((item) => toMemberVisitation(item, context.actorSub)) });
};

const createManualVisitation = async (
  context: RequestContext,
  memberId: string,
  input: CreateManualVisitationInput,
  deps: HandlerDependencies,
) => {
  const validationError = validateManualVisitationInput(input);
  if (validationError) {
    return json(400, { message: validationError });
  }

  const member = await getMember(context, memberId, deps);
  if (!member) {
    return json(404, { message: "Member not found." });
  }

  const nextMemberIds = [...new Set([memberId, ...normalizeMemberIds(input.memberIds)])];
  const records = await persistManualVisitationGroup(context, deps.uuid(), null, {
    ...input,
    memberIds: nextMemberIds,
  }, deps);
  for (const record of records) {
    const visitationType = normalizeVisitationType(record.type);
    await logMemberActivity(
      context,
      record.memberId,
      "Visitation Created",
      `${visitationType} recorded for ${record.memberNames.find((name, index) => record.memberIds[index] === record.memberId) ?? record.title}.`,
      deps,
      { visitationId: record.visitationId, type: visitationType },
    );
  }
  return json(201, { items: records.map((item) => toMemberVisitation(item, context.actorSub)) });
};

const updateManualVisitation = async (
  context: RequestContext,
  memberId: string,
  visitationId: string,
  input: UpdateManualVisitationInput,
  deps: HandlerDependencies,
) => {
  const existing = await getVisitationGroup(context, visitationId, deps);
  if (!existing.length || !existing.some((item) => item.memberId === memberId)) {
    return json(404, { message: "Visitation not found." });
  }

  if (existing[0]?.source !== "manual") {
    return json(400, { message: "Only manual visitations can be updated here." });
  }

  const merged: CreateManualVisitationInput = {
    title: input.title ?? existing[0].title,
    visitDate: input.visitDate ?? existing[0].visitDate,
    type: input.type ?? existing[0].type,
    location: input.location ?? existing[0].location,
    visitStatus: input.visitStatus ?? existing[0].visitStatus,
    notes: input.notes ?? existing[0].notes,
    memberIds: normalizeMemberIds(input.memberIds ?? existing[0].memberIds),
    visitorUserId: input.visitorUserId ?? existing[0].visitorUserId,
    visitorDisplayName: input.visitorDisplayName ?? existing[0].visitorDisplayName,
  };
  const validationError = validateManualVisitationInput(merged);
  if (validationError) {
    return json(400, { message: validationError });
  }

  const records = await persistManualVisitationGroup(context, visitationId, existing, merged, deps);
  for (const record of records) {
    const visitationType = normalizeVisitationType(record.type);
    await logMemberActivity(
      context,
      record.memberId,
      "Visitation Updated",
      `${visitationType} updated for ${record.memberNames.find((name, index) => record.memberIds[index] === record.memberId) ?? record.title}.`,
      deps,
      { visitationId: record.visitationId, type: visitationType },
    );
  }
  return json(200, { items: records.map((item) => toMemberVisitation(item, context.actorSub)) });
};

const deleteManualVisitation = async (
  context: RequestContext,
  memberId: string,
  visitationId: string,
  deps: HandlerDependencies,
) => {
  const existing = await getVisitationGroup(context, visitationId, deps);
  if (!existing.length || !existing.some((item) => item.memberId === memberId)) {
    return json(404, { message: "Visitation not found." });
  }

  if (existing[0]?.source !== "manual") {
    return json(400, { message: "Only manual visitations can be deleted here." });
  }

  for (const record of existing) {
    await deps.documentClient.send(
      new DeleteCommand({
        Key: {
          PK: tenantVisitationPk(context.tenantId, visitationId),
          SK: visitationMemberSk(record.memberId),
        },
        TableName: context.tableName,
      }),
    );
  }

  return json(200, { deleted: true, visitationId });
};

const getEventMembersResponse = async (
  context: RequestContext,
  eventId: string,
  calendarId: string | undefined,
  deps: HandlerDependencies,
) => {
  if (!calendarId) {
    return json(400, { message: "Calendar is required." });
  }

  const event = await getEvent(context, calendarId, eventId, deps);
  if (!event) {
    return json(404, { message: "Event not found." });
  }

  const items = await listEventMembers(context, calendarId, eventId, deps);
  const response: EventMembersResponse = { items: items.map(toEventMemberSummary) };
  return json(200, response);
};

const updateEventMembersResponse = async (
  context: RequestContext,
  eventId: string,
  input: UpdateEventMembersInput,
  deps: HandlerDependencies,
) => {
  const event = await getEvent(context, input.calendarId, eventId, deps);
  if (!event) {
    return json(404, { message: "Event not found." });
  }

  const updatedEvent: EventItem = {
    ...event,
    updatedAt: deps.now(),
  };
  const persistedEvent = await persistEventWithMemberAssignments(
    context,
    {
      ...updatedEvent,
      memberIds: input.memberIds,
    },
    deps,
  );
  const assignedMembers = await loadMembersByIds(context, persistedEvent.memberIds ?? [], deps);
  return json(200, { items: assignedMembers.map((member) => toEventMemberSummary({
    PK: "",
    SK: "",
    createdAt: persistedEvent.createdAt,
    updatedAt: persistedEvent.updatedAt,
    entityType: "EVENT_MEMBER",
    tenantId: context.tenantId,
    calendarId: persistedEvent.calendarId,
    eventId: persistedEvent.eventId,
    calendarOwnerUserId: persistedEvent.userId,
    calendarOwnerName: context.actorName,
    memberId: member.memberId,
    memberName: member.fullName,
    memberPhoneSnapshot: member.phone,
    memberEmailSnapshot: member.email,
    unityIdSnapshot: member.unityId,
    sourceSnapshot: member.source,
    eventTitle: persistedEvent.summary,
    eventStart: persistedEvent.start,
    eventEnd: persistedEvent.end,
    eventLocation: persistedEvent.location,
    eventDescription: persistedEvent.description,
    allDay: persistedEvent.allDay,
    assignmentStatus: persistedEvent.status === "cancelled" ? "cancelled" : "scheduled",
    visitStatus: persistedEvent.status === "cancelled" ? "cancelled" : "scheduled",
    createdByUserId: context.actorSub,
    createdByName: context.actorName,
  })) });
};

const getVisitationReport = async (
  context: RequestContext,
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: HandlerDependencies,
) => {
  const filters = parseVisitationReportFilters(event);
  const [members, visitations, upcomingAssignments] = await Promise.all([
    taggedReportMembers(context, filters, deps),
    listTenantVisitations(context, deps),
    listUpcomingEventAssignments(context, deps.now(), deps),
  ]);
  const reportVisitations = filters.type === "all"
    ? visitations
    : visitations.filter((item) => normalizeVisitationType(item.type) === filters.type);
  const allVisitors: ReportVisitorOption[] = [...new Map(
    reportVisitations.map((item) => [item.visitorUserId, {
      visitorUserId: item.visitorUserId,
      visitorDisplayName: item.visitorDisplayName,
    }]),
  ).values()].sort((left, right) => left.visitorDisplayName.localeCompare(right.visitorDisplayName));

  const availableGroups = [...new Set(
    members.flatMap((member) => member.groups ?? []).map((group) => normalizeWhitespace(group)).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

  const filteredMembers = members.filter((member) => {
    if (filters.memberScope === "active_only" && (member.locked || member.activated === false)) {
      return false;
    }

    if (filters.memberSource === "unity" && member.source !== "UNITY") {
      return false;
    }

    if (filters.memberSource === "manual" && member.source !== "MANUAL") {
      return false;
    }

    if (filters.group && !(member.groups ?? []).includes(filters.group)) {
      return false;
    }

    if (filters.search && !member.normalizedSearchText.includes(normalizeName(filters.search))) {
      return false;
    }

    return true;
  });
  const filteredMemberIds = new Set(filteredMembers.map((member) => member.memberId));

  const topVisitorsByUserId = new Map<string, VisitorLeaderboardEntry>();
  const currentUserActivity: CurrentUserVisitationActivity = {
    thisWeek: 0,
    thisMonth: 0,
    thisYear: 0,
  };
  const activityTypeCounts = new Map<ActivityTypeDistributionBucket["key"], number>();
  const latestInRangeTypeByMemberId = new Map<string, { type: VisitationType; visitDate: string }>();
  const monthlyActivityCounts = new Map<string, number>();
  const everyoneLifetimeByMemberId = new Map<string, VisitationScopeMetrics>();
  const filteredLifetimeByMemberId = new Map<string, VisitationScopeMetrics>();
  const currentUserLifetimeByMemberId = new Map<string, VisitationScopeMetrics>();
  const everyoneRangeCountByMemberId = new Map<string, number>();
  const filteredRangeCountByMemberId = new Map<string, number>();
  const currentUserRangeCountByMemberId = new Map<string, number>();
  const weekStart = startOfCurrentWeek();
  const monthStart = startOfCurrentMonth();
  const yearStart = startOfCurrentYear();

  const incrementCount = (target: Map<string, number>, memberId: string) => {
    target.set(memberId, (target.get(memberId) ?? 0) + 1);
  };

  const updateScopeMetrics = (target: Map<string, VisitationScopeMetrics>, visitation: VisitationItem) => {
    const current = target.get(visitation.memberId) ?? {
      visitCountInRange: 0,
      totalLifetimeVisits: 0,
      lastVisitDate: undefined,
      lastVisitedBy: undefined,
      caregiverNames: [],
      lastVisitType: undefined,
    };
    current.totalLifetimeVisits += 1;
    if (!current.lastVisitDate || visitation.visitDate > current.lastVisitDate) {
      current.lastVisitDate = visitation.visitDate;
      current.lastVisitedBy = visitation.visitorDisplayName;
      current.lastVisitType = normalizeVisitationType(visitation.type);
    }
    if (!current.caregiverNames.includes(visitation.visitorDisplayName)) {
      current.caregiverNames.push(visitation.visitorDisplayName);
    }
    target.set(visitation.memberId, current);
  };

  for (const visitation of reportVisitations) {
    if (!filteredMemberIds.has(visitation.memberId)) {
      continue;
    }

    updateScopeMetrics(everyoneLifetimeByMemberId, visitation);

    const matchesVisitor = matchesReportVisitorFilter(visitation, filters, context.actorSub);
    if (matchesVisitor) {
      updateScopeMetrics(filteredLifetimeByMemberId, visitation);
    }

    if (visitation.visitorUserId === context.actorSub) {
      updateScopeMetrics(currentUserLifetimeByMemberId, visitation);

      if (visitation.visitDate >= weekStart) {
        currentUserActivity.thisWeek += 1;
      }
      if (visitation.visitDate >= monthStart) {
        currentUserActivity.thisMonth += 1;
      }
      if (visitation.visitDate >= yearStart) {
        currentUserActivity.thisYear += 1;
      }
    }

    const inFromRange = !filters.from || visitation.visitDate >= filters.from;
    const inToRange = !filters.to || visitation.visitDate <= filters.to;
    if (!inFromRange || !inToRange) {
      continue;
    }

    incrementCount(everyoneRangeCountByMemberId, visitation.memberId);

    if (visitation.visitorUserId === context.actorSub) {
      incrementCount(currentUserRangeCountByMemberId, visitation.memberId);
    }

    if (!matchesVisitor) {
      continue;
    }

    incrementCount(filteredRangeCountByMemberId, visitation.memberId);
    const normalizedType = normalizeVisitationType(visitation.type);
    activityTypeCounts.set(normalizedType, (activityTypeCounts.get(normalizedType) ?? 0) + 1);
    const monthKey = visitation.visitDate.slice(0, 7);
    monthlyActivityCounts.set(monthKey, (monthlyActivityCounts.get(monthKey) ?? 0) + 1);
    const latestInRange = latestInRangeTypeByMemberId.get(visitation.memberId);
    if (!latestInRange || visitation.visitDate > latestInRange.visitDate) {
      latestInRangeTypeByMemberId.set(visitation.memberId, {
        type: normalizedType,
        visitDate: visitation.visitDate,
      });
    }

    const existingVisitor = topVisitorsByUserId.get(visitation.visitorUserId);
    if (existingVisitor) {
      existingVisitor.visitCountInRange += 1;
    } else {
      topVisitorsByUserId.set(visitation.visitorUserId, {
        visitorUserId: visitation.visitorUserId,
        visitorDisplayName: visitation.visitorDisplayName,
        visitCountInRange: 1,
      });
    }
  }

  const nextScheduledVisitByMemberId = new Map<string, string>();
  for (const assignment of upcomingAssignments) {
    if (assignment.assignmentStatus === "cancelled" || nextScheduledVisitByMemberId.has(assignment.memberId)) {
      continue;
    }
    nextScheduledVisitByMemberId.set(assignment.memberId, assignment.eventStart);
  }

  const OVERDUE_DAYS = 90;
  const threshold = filters.visitCountThreshold;
  const nowTime = new Date(deps.now()).getTime();
  const getDaysSince = (value?: string) => {
    if (!value) {
      return null;
    }

    return Math.max(0, Math.floor((nowTime - new Date(value).getTime()) / 86_400_000));
  };

  const getMemberStatus = (
    totalLifetimeVisits: number,
    visitCountInRange: number,
    lastVisitDate?: string,
  ): ReportsMemberStatusFilter => {
    if (totalLifetimeVisits === 0) {
      return "never_visited";
    }

    const daysSinceLastVisit = getDaysSince(lastVisitDate);
    if (daysSinceLastVisit !== null && daysSinceLastVisit > OVERDUE_DAYS) {
      return "not_visited_recently";
    }

    if (visitCountInRange <= 1) {
      return "low_visitation";
    }

    return "visited";
  };

  const sortCaregiverNames = (caregiverNames?: string[]) =>
    [...(caregiverNames ?? [])].sort((left, right) => left.localeCompare(right));

  const allRows: VisitationOverviewRow[] = [];
  for (const member of filteredMembers) {
    const everyoneLifetime = everyoneLifetimeByMemberId.get(member.memberId);
    const filteredLifetime = filteredLifetimeByMemberId.get(member.memberId);
    const currentUserLifetime = currentUserLifetimeByMemberId.get(member.memberId);
    const matchingCount = filteredRangeCountByMemberId.get(member.memberId) ?? 0;
    const everyoneRangeCount = everyoneRangeCountByMemberId.get(member.memberId) ?? 0;
    const currentUserRangeCount = currentUserRangeCountByMemberId.get(member.memberId) ?? 0;
    const status: VisitationOverviewRow["status"] =
      matchingCount === 0
        ? "Not Visited"
        : matchingCount <= threshold
          ? "Low Visitation"
          : "Recently Visited";

    const row: VisitationOverviewRow = {
      memberId: member.memberId,
      memberFullName: member.fullName,
      initials: member.initials,
      phone: member.phone,
      email: member.email,
      unityId: member.unityId,
      memberSource: member.source,
      sectorOrGroup: member.groups?.join(", "),
      lastVisitDate: filteredLifetime?.lastVisitDate,
      lastVisitedBy: filteredLifetime?.lastVisitedBy,
      caregiverNames: sortCaregiverNames(filteredLifetime?.caregiverNames),
      lastVisitType: filteredLifetime?.lastVisitType,
      visitCountInRange: matchingCount,
      totalLifetimeVisits: filteredLifetime?.totalLifetimeVisits ?? 0,
      nextScheduledVisit: nextScheduledVisitByMemberId.get(member.memberId),
      status,
      normalizedSearchText: member.normalizedSearchText,
      scopeMetrics: {
        everyone: {
          visitCountInRange: everyoneRangeCount,
          totalLifetimeVisits: everyoneLifetime?.totalLifetimeVisits ?? 0,
          lastVisitDate: everyoneLifetime?.lastVisitDate,
          lastVisitedBy: everyoneLifetime?.lastVisitedBy,
          caregiverNames: sortCaregiverNames(everyoneLifetime?.caregiverNames),
          lastVisitType: everyoneLifetime?.lastVisitType,
        },
        me: {
          visitCountInRange: currentUserRangeCount,
          totalLifetimeVisits: currentUserLifetime?.totalLifetimeVisits ?? 0,
          lastVisitDate: currentUserLifetime?.lastVisitDate,
          lastVisitedBy: currentUserLifetime?.lastVisitedBy,
          caregiverNames: sortCaregiverNames(currentUserLifetime?.caregiverNames),
          lastVisitType: currentUserLifetime?.lastVisitType,
        },
      },
    };

    if (filters.visitCountMode === "not_visited") {
      if (row.visitCountInRange !== 0) {
        continue;
      }
    }

    if (filters.visitCountMode === "lte") {
      if (row.visitCountInRange > threshold) {
        continue;
      }
    }

    if (filters.visitCountMode === "gt") {
      if (row.visitCountInRange <= threshold) {
        continue;
      }
    }

    if (filters.status !== "all") {
      const memberStatus = getMemberStatus(row.totalLifetimeVisits, row.visitCountInRange, row.lastVisitDate);
      if (memberStatus !== filters.status) {
        continue;
      }
    }

    allRows.push(row);
  }

  if (filters.tagIds?.length || filters.householdTagIds?.length) {
    const matchingIds = new Set(allRows.map((row) => row.memberId));
    activityTypeCounts.clear(); monthlyActivityCounts.clear(); topVisitorsByUserId.clear();
    currentUserActivity.thisWeek = 0; currentUserActivity.thisMonth = 0; currentUserActivity.thisYear = 0;
    for (const visitation of reportVisitations) {
      if (!matchingIds.has(visitation.memberId) || !matchesReportVisitorFilter(visitation, filters, context.actorSub)) continue;
      if ((filters.from && visitation.visitDate < filters.from) || (filters.to && visitation.visitDate > filters.to)) continue;
      if (visitation.visitorUserId === context.actorSub) {
        if (visitation.visitDate >= weekStart) currentUserActivity.thisWeek++;
        if (visitation.visitDate >= monthStart) currentUserActivity.thisMonth++;
        if (visitation.visitDate >= yearStart) currentUserActivity.thisYear++;
      }
      const type = normalizeVisitationType(visitation.type);
      activityTypeCounts.set(type, (activityTypeCounts.get(type) ?? 0) + 1);
      const month = visitation.visitDate.slice(0, 7);
      monthlyActivityCounts.set(month, (monthlyActivityCounts.get(month) ?? 0) + 1);
      const visitor = topVisitorsByUserId.get(visitation.visitorUserId) ?? { visitorUserId: visitation.visitorUserId, visitorDisplayName: visitation.visitorDisplayName, visitCountInRange: 0 };
      visitor.visitCountInRange++;
      topVisitorsByUserId.set(visitor.visitorUserId, visitor);
    }
  }

  allRows.sort((left, right) => {
    const direction = filters.sortDirection === "asc" ? 1 : -1;
    if (filters.sortBy === "member_name") {
      return left.memberFullName.localeCompare(right.memberFullName) * direction || left.memberId.localeCompare(right.memberId);
    }

    if (filters.sortBy === "visit_count") {
      return (left.visitCountInRange - right.visitCountInRange) * direction || left.memberId.localeCompare(right.memberId);
    }

    const leftValue = left.lastVisitDate ?? "";
    const rightValue = right.lastVisitDate ?? "";
    return leftValue.localeCompare(rightValue) * direction || left.memberId.localeCompare(right.memberId);
  });

  let notVisitedCount = 0;
  let oneVisitCount = 0;
  let twoToThreeCount = 0;
  let fourToSixCount = 0;
  let sevenPlusCount = 0;
  let overdueCount = 0;
  let lowVisitationCount = 0;
  let visitedInRangeCount = 0;
  let totalVisitCount = 0;

  for (const row of allRows) {
    const memberStatus = getMemberStatus(row.totalLifetimeVisits, row.visitCountInRange, row.lastVisitDate);
    totalVisitCount += row.visitCountInRange;
    if (row.visitCountInRange === 0) {
      notVisitedCount += 1;
    } else {
      visitedInRangeCount += 1;
      if (row.visitCountInRange <= threshold) {
        lowVisitationCount += 1;
      }
    }
    if (memberStatus === "not_visited_recently") {
      overdueCount += 1;
    }

    if (row.visitCountInRange === 1) {
      oneVisitCount += 1;
    } else if (row.visitCountInRange >= 2 && row.visitCountInRange <= 3) {
      twoToThreeCount += 1;
    } else if (row.visitCountInRange >= 4 && row.visitCountInRange <= 6) {
      fourToSixCount += 1;
    } else if (row.visitCountInRange >= 7) {
      sevenPlusCount += 1;
    }
  }

  const distributionCounts = {
    not_visited: notVisitedCount,
    one_visit: oneVisitCount,
    two_to_three: twoToThreeCount,
    four_to_six: fourToSixCount,
    seven_plus: sevenPlusCount,
  };
  const distributionTotal = Math.max(allRows.length, 1);
  const distribution: VisitationDistributionBucket[] = [
    { key: "not_visited", label: "Not visited", count: distributionCounts.not_visited, percentage: (distributionCounts.not_visited / distributionTotal) * 100 },
    { key: "one_visit", label: "1 visit", count: distributionCounts.one_visit, percentage: (distributionCounts.one_visit / distributionTotal) * 100 },
    { key: "two_to_three", label: "2-3 visits", count: distributionCounts.two_to_three, percentage: (distributionCounts.two_to_three / distributionTotal) * 100 },
    { key: "four_to_six", label: "4-6 visits", count: distributionCounts.four_to_six, percentage: (distributionCounts.four_to_six / distributionTotal) * 100 },
    { key: "seven_plus", label: "7+ visits", count: distributionCounts.seven_plus, percentage: (distributionCounts.seven_plus / distributionTotal) * 100 },
  ];
  const totalActivities = [...activityTypeCounts.values()].reduce((sum, count) => sum + count, 0);
  const activityTypeDistribution: ActivityTypeDistributionBucket[] = [
    {
      key: "all",
      label: "All",
      count: totalActivities,
      percentage: totalActivities > 0 ? 100 : 0,
    },
    ...visitationTypes.map((type) => {
      const count = activityTypeCounts.get(type) ?? 0;
      return {
        key: type,
        label: type,
        count,
        percentage: totalActivities > 0 ? (count / totalActivities) * 100 : 0,
      };
    }),
  ];
  const visitedMemberCountsByType = new Map<VisitedMemberBreakdownBucket["key"], number>();
  for (const row of allRows) {
    if (row.visitCountInRange === 0) {
      continue;
    }

    const latestType = latestInRangeTypeByMemberId.get(row.memberId)?.type;
    const bucketKey: VisitedMemberBreakdownBucket["key"] = latestType === "Visitation"
      || latestType === "Confession"
      || latestType === "Phone Call"
      ? latestType
      : "Other";
    visitedMemberCountsByType.set(bucketKey, (visitedMemberCountsByType.get(bucketKey) ?? 0) + 1);
  }
  const visitedBreakdownOrder: VisitedMemberBreakdownBucket["key"][] = ["Visitation", "Confession", "Phone Call", "Other"];
  const visitedBreakdownByType: VisitedMemberBreakdownBucket[] = visitedBreakdownOrder
    .map((key) => {
      const memberCount = visitedMemberCountsByType.get(key) ?? 0;
      return {
        key,
        label: key === "Visitation" ? "Visit" : key,
        memberCount,
        percentage: visitedInRangeCount > 0 ? (memberCount / visitedInRangeCount) * 100 : 0,
      };
    })
    .filter((bucket) => bucket.memberCount > 0 || bucket.key !== "Other");
  const monthlyActivityTrend: MonthlyActivityTrendPoint[] = [...monthlyActivityCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, count]) => {
      const [year, monthIndex] = month.split("-");
      const label = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
        new Date(Number(year), Number(monthIndex) - 1, 1),
      );
      return {
        month,
        label,
        count,
      };
    });

  const summary: VisitationReportKpiSummary = {
    totalMembers: filters.tagIds?.length || filters.householdTagIds?.length ? allRows.length : filteredMembers.length,
    matchingMembers: allRows.length,
    notVisitedMembers: notVisitedCount,
    overdueMembers: overdueCount,
    lowVisitationMembers: lowVisitationCount,
    visitedInRangeMembers: visitedInRangeCount,
    averageVisitsPerMember: allRows.length
      ? Number((totalVisitCount / allRows.length).toFixed(2))
      : 0,
  };

  const attentionMembers = allRows
    .filter((row) => {
      const memberStatus = getMemberStatus(row.totalLifetimeVisits, row.visitCountInRange, row.lastVisitDate);
      return memberStatus === "never_visited" || memberStatus === "not_visited_recently";
    })
    .sort((left, right) => {
      const leftDays = getDaysSince(left.lastVisitDate) ?? Number.POSITIVE_INFINITY;
      const rightDays = getDaysSince(right.lastVisitDate) ?? Number.POSITIVE_INFINITY;
      return rightDays - leftDays || left.memberFullName.localeCompare(right.memberFullName);
    })
    .slice(0, 5);

  const totalItems = allRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / filters.pageSize));
  const page = Math.min(filters.page, totalPages);
  const startIndex = (page - 1) * filters.pageSize;
  const pagination: ReportPagination = {
    page,
    pageSize: filters.pageSize,
    totalItems,
    totalPages,
  };

  const response: VisitationReportResponse = {
    filters: {
      ...filters,
      page,
    },
    summary,
    distribution,
    activityTypeDistribution,
    visitedBreakdownByType,
    monthlyActivityTrend,
    attentionMembers,
    rows: allRows.slice(startIndex, startIndex + filters.pageSize),
    pagination,
    visitors: allVisitors,
    availableGroups,
    topVisitors: [...topVisitorsByUserId.values()]
      .sort((left, right) => right.visitCountInRange - left.visitCountInRange || left.visitorDisplayName.localeCompare(right.visitorDisplayName))
      .slice(0, 5),
    currentUserActivity,
    generatedAt: deps.now(),
  };

  return json(200, response);
};

const hasValidHouseholdCoordinates = (household: Pick<HouseholdItem, "location">) => {
  const latitude = household.location?.latitude;
  const longitude = household.location?.longitude;

  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude! >= -90
    && latitude! <= 90
    && longitude! >= -180
    && longitude! <= 180;
};

const getVisitationGeographyReport = async (
  context: RequestContext,
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: HandlerDependencies,
) => {
  const filters = parseVisitationReportFilters(event);
  const [households, visitations] = await Promise.all([
    taggedHouseholds(context, { tagIds: filters.householdTagIds?.length ? filters.householdTagIds : filters.tagIds, tagMatchMode: filters.householdTagIds?.length ? filters.householdTagMatchMode : filters.tagMatchMode }, deps),
    listTenantVisitations(context, deps),
  ]);

  const householdById = new Map(households.map((household) => [household.householdId, household]));
  const householdIdByMemberId = new Map<string, string>();
  for (const household of households) {
    for (const member of household.members ?? []) {
      householdIdByMemberId.set(member.memberId, household.householdId);
    }
  }

  const reportVisitations = filters.type === "all"
    ? visitations
    : visitations.filter((item) => normalizeVisitationType(item.type) === filters.type);

  const householdMetrics = new Map<string, { visitCount: number; lastVisitDate?: string; lastVisitedBy?: string }>();
  const areaSummaryById = new Map<string, VisitationAreaSummary>(
    visitationAreaDefinitions.map((definition) => [definition.id, {
      areaId: definition.id,
      areaName: definition.label,
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    }]),
  );

  for (const visitation of reportVisitations) {
    const householdId = householdIdByMemberId.get(visitation.memberId);
    if (!householdId || !householdById.has(householdId)) {
      continue;
    }

    if (!matchesReportVisitorFilter(visitation, filters, context.actorSub)) {
      continue;
    }

    const inFromRange = !filters.from || visitation.visitDate >= filters.from;
    const inToRange = !filters.to || visitation.visitDate <= filters.to;
    if (!inFromRange || !inToRange) {
      continue;
    }

    const current = householdMetrics.get(householdId) ?? {
      visitCount: 0,
      lastVisitDate: undefined,
      lastVisitedBy: undefined,
    };
    current.visitCount += 1;
    if (!current.lastVisitDate || visitation.visitDate > current.lastVisitDate) {
      current.lastVisitDate = visitation.visitDate;
      current.lastVisitedBy = visitation.visitorDisplayName;
    }
    householdMetrics.set(householdId, current);
  }

  const totalMembers = households.reduce((sum, household) => sum + household.memberCount, 0);
  const totalHouseholds = households.length;
  const visitedHouseholds = households.filter((household) => (householdMetrics.get(household.householdId)?.visitCount ?? 0) > 0).length;
  const notVisitedHouseholds = Math.max(0, totalHouseholds - visitedHouseholds);
  const visitationsCount = [...householdMetrics.values()].reduce((sum, item) => sum + item.visitCount, 0);
  const mappedHouseholds = households.filter(hasValidHouseholdCoordinates).length;
  const unmappedHouseholds = Math.max(0, totalHouseholds - mappedHouseholds);

  const features: VisitationGeographyFeature[] = households.flatMap((household) => {
    const areaId = resolveVisitationAreaId({ areaId: household.areaId, postalCode: household.postalCode });
    const areaSummary = areaSummaryById.get(areaId) ?? areaSummaryById.get("UNASSIGNED");
    const metrics = householdMetrics.get(household.householdId);
    const visited = metrics?.visitCount ? 1 : 0;

    if (areaSummary) {
      areaSummary.households += 1;
      areaSummary.members += household.memberCount;
      areaSummary.visited += visited;
      areaSummary.visitations += metrics?.visitCount ?? 0;
    }

    if (!hasValidHouseholdCoordinates(household)) {
      return [];
    }

    return [{
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [household.location!.longitude!, household.location!.latitude!],
      },
      properties: {
        householdId: household.householdId,
        normalizedAddress: household.normalizedAddress,
        memberNames: (household.members ?? [])
          .map((member) => normalizeWhitespace(member.fullName))
          .filter(Boolean),
        memberCount: household.memberCount,
        visited,
        visitCount: metrics?.visitCount ?? 0,
        lastVisitDate: metrics?.lastVisitDate,
        lastVisitedBy: metrics?.lastVisitedBy,
        areaId,
      },
    }];
  });

  const areas = visitationAreaDefinitions.map((definition) => {
    const summary = areaSummaryById.get(definition.id) ?? {
      areaId: definition.id,
      areaName: definition.label,
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    };

    summary.notVisited = Math.max(0, summary.households - summary.visited);
    summary.coverage = summary.households ? (summary.visited / summary.households) * 100 : 0;
    summary.areaName = getVisitationAreaDefinition(summary.areaId).label;
    return summary;
  });

  const summary: VisitationGeographySummary = {
    totalMembers,
    totalHouseholds,
    visitedHouseholds,
    notVisitedHouseholds,
    coverage: totalHouseholds ? (visitedHouseholds / totalHouseholds) * 100 : 0,
    visitations: visitationsCount,
    mappedHouseholds,
    unmappedHouseholds,
  };

  const response: VisitationGeographyReportResponse = {
    summary,
    areas,
    households: {
      type: "FeatureCollection",
      features,
    } satisfies VisitationGeographyFeatureCollection,
  };

  return json(200, response);
};

const getScheduleOverview = async (context: RequestContext, deps: HandlerDependencies) => {
  const [connection, calendars, settings] = await Promise.all([
    getGoogleConnection(context, deps),
    listCalendars(context, deps),
    getScheduleSettings(context, deps),
  ]);

  const response: ScheduleOverviewResponse = {
    connection: connection ? toConnectionSummary(connection) : null,
    calendars: calendars.map(toScheduleCalendar),
    oauthConfigured: isGoogleConfigured(),
    settings: toScheduleSettings(settings),
  };

  return json(200, response);
};

const connectGoogle = async (context: RequestContext, deps: HandlerDependencies) => {
  if (!isGoogleConfigured()) {
    return json(400, {
      message:
        "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
    });
  }

  const state = deps.randomState();
  const now = deps.now();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const stateItem: OAuthStateItem = {
    PK: oauthStatePk(state),
    SK: oauthStateSk(state),
    createdAt: now,
    updatedAt: now,
    entityType: "oauth_state",
    state,
    userId: context.actorSub,
    tenantId: context.tenantId,
    actorEmail: context.actorEmail,
    expiresAt,
  };

  await deps.documentClient.send(
    new PutCommand({
      Item: stateItem,
      TableName: context.tableName,
    }),
  );

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  });

  const response: ConnectGoogleResponse = {
    authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}`,
  };

  return json(200, response);
};

const handleGoogleCallback = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: HandlerDependencies,
) => {
  const state = event.queryStringParameters?.state ?? "";
  const code = event.queryStringParameters?.code ?? "";

  if (!state || !code) {
    return html(400, "<h1>Missing OAuth callback parameters.</h1>");
  }

  const tableName = process.env.SHEPHERD_HUB_RECORDS_TABLE ?? "";
  const stateResponse = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: oauthStatePk(state),
        SK: oauthStateSk(state),
      },
      TableName: tableName,
    }),
  );

  const stateItem = stateResponse.Item as OAuthStateItem | undefined;
  if (!stateItem || new Date(stateItem.expiresAt).getTime() < Date.now()) {
    return html(400, "<h1>OAuth state is invalid or expired.</h1>");
  }

  const tokenBody = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    code,
    grant_type: "authorization_code",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
  });

  const tokenResponse = await deps.fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
  });

  if (!tokenResponse.ok) {
    const details = await tokenResponse.text();
    return html(400, `<h1>OAuth token exchange failed.</h1><pre>${details}</pre>`);
  }

  const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
  const grantedScopes = normalizeScopeList(tokens.scope ? tokens.scope.split(" ") : GOOGLE_SCOPES);
  if (!hasRequiredGoogleScopes(grantedScopes)) {
    await deleteOAuthState(state, tableName, deps);
    return html(400, `<h1>Google Calendar access was not granted.</h1><p>${googleReconnectMessage}</p>`);
  }

  const profileResponse = await deps.fetchImpl(GOOGLE_USERINFO_URL, {
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
  const profile = (await profileResponse.json()) as { email?: string; sub?: string };
  const now = deps.now();
  const callbackContext: RequestContext = {
    actorEmail: stateItem.actorEmail,
    actorGroups: [],
    actorName: stateItem.actorEmail,
    actorSub: stateItem.userId,
    tableName,
    tenantId: stateItem.tenantId,
  };

  const existing = await getGoogleConnection(callbackContext, deps);
  const connection: GoogleConnectionItem = {
    PK: userPk(stateItem.userId),
    SK: googleConnectionSk(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    entityType: "google_connection",
    userId: stateItem.userId,
    tenantId: stateItem.tenantId,
    googleAccountId: profile.sub ?? profile.email ?? "google-account",
    email: profile.email ?? stateItem.actorEmail,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? existing?.refreshToken,
    tokenExpiresAt: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : existing?.tokenExpiresAt,
    scopes: grantedScopes,
    status: "connected",
    connectedAt: existing?.connectedAt ?? now,
    lastConnectedAt: now,
    lastTokenRefreshAt: now,
  };

  await putGoogleConnection(callbackContext, connection, deps);
  await deleteOAuthState(state, tableName, deps);

  const successRedirect = process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT_URL?.trim();
  if (successRedirect) {
    const target = new URL(successRedirect);
    target.searchParams.set("google", "connected");
    return redirect(target.toString());
  }

  return html(200, "<h1>Google Calendar connected.</h1><p>You can close this window.</p>");
};

const refreshCalendars = async (context: RequestContext, deps: HandlerDependencies) => {
  const connection = await getGoogleConnection(context, deps);
  if (!connection) {
    return json(400, { message: "Connect Google Calendar first." });
  }

  const calendars = await syncCalendarListFromGoogle(context, connection, deps);
  return json(200, { calendars: calendars.map(toScheduleCalendar) });
};

const disconnectGoogle = async (context: RequestContext, deps: HandlerDependencies) => {
  await deleteGoogleConnection(context, deps);
  return json(200, { disconnected: true });
};

const updateCalendarSettings = async (
  context: RequestContext,
  calendarId: string,
  input: UpdateCalendarSettingsInput,
  deps: HandlerDependencies,
) => {
  const validationError = validateCalendarSettings(input);
  if (validationError) {
    return json(400, { message: validationError });
  }

  const existing = await getCalendar(context, calendarId, deps);
  if (!existing) {
    return json(404, { message: "Calendar not found." });
  }

  const now = deps.now();
  const nextRange = existing.sync.requiresFullSync
    ? normalizeInitialSyncRange(input.initialSyncRange, now)
    : existing.sync.initialSyncRange;
  const windowChanged =
    nextRange.from !== existing.sync.initialSyncRange.from ||
    nextRange.to !== existing.sync.initialSyncRange.to;

  const updated: CalendarItem = {
    ...existing,
    enabled: true,
    selected: input.showInCalendar,
    updatedAt: now,
    sync: {
      ...existing.sync,
      syncMode: input.syncMode,
      refreshIntervalMinutes: normalizeRefreshInterval(input.cacheStaleThresholdMinutes),
      initialSyncRange: nextRange,
      requiresFullSync: existing.sync.requiresFullSync || windowChanged,
    },
  };

  await putCalendar(context, updated, deps);
  return json(200, toScheduleCalendar(updated));
};

const saveScheduleSettings = async (
  context: RequestContext,
  input: SaveScheduleSettingsInput,
  deps: HandlerDependencies,
) => {
  const validationError = validateScheduleSettings(input);
  if (validationError) {
    return json(400, { message: validationError });
  }

  const existingCalendars = await listCalendars(context, deps);
  const calendarsById = new Map(existingCalendars.map((calendar) => [calendar.calendarId, calendar]));
  const now = deps.now();

  for (const calendarInput of input.calendars) {
    const existing = calendarsById.get(calendarInput.calendarId);
    if (!existing) {
      return json(404, { message: `Calendar ${calendarInput.calendarId} not found.` });
    }

    const nextRange = existing.sync.requiresFullSync
      ? normalizeInitialSyncRange(calendarInput.initialSyncRange, now)
      : existing.sync.initialSyncRange;
    const updated: CalendarItem = {
      ...existing,
      enabled: true,
      selected: calendarInput.showInCalendar,
      updatedAt: now,
      sync: {
        ...existing.sync,
        syncMode: calendarInput.syncMode,
        refreshIntervalMinutes: normalizeRefreshInterval(calendarInput.cacheStaleThresholdMinutes),
        initialSyncRange: nextRange,
        requiresFullSync:
          existing.sync.requiresFullSync ||
          existing.sync.initialSyncRange.from !== nextRange.from ||
          existing.sync.initialSyncRange.to !== nextRange.to,
      },
    };

    await putCalendar(context, updated, deps);
  }

  const existingSettings = await getScheduleSettings(context, deps);
  await putScheduleSettings(
    context,
    {
      PK: userPk(context.actorSub),
      SK: scheduleSettingsSk(),
      createdAt: existingSettings?.createdAt ?? now,
      updatedAt: now,
      entityType: "schedule_settings",
      userId: context.actorSub,
      tenantId: context.tenantId,
      calendarListRefreshThresholdMinutes: normalizeCalendarListRefreshThreshold(
        input.calendarListRefreshThresholdMinutes,
      ),
    },
    deps,
  );

  return await getScheduleOverview(context, deps);
};

const getScheduleEvents = async (
  context: RequestContext,
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: HandlerDependencies,
) => {
  const timeMin =
    event.queryStringParameters?.timeMin ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax =
    event.queryStringParameters?.timeMax ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const forceSync = event.queryStringParameters?.forceSync === "true";
  const cacheOnly = event.queryStringParameters?.cacheOnly === "true";
  const calendarIds = event.queryStringParameters?.calendarIds
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return json(
    200,
    await syncSelectedCalendars(context, deps, {
      timeMin,
      timeMax,
      calendarIds,
      cacheOnly,
      forceSync,
    }),
  );
};

const getScheduleEventResponse = async (
  context: RequestContext,
  eventId: string,
  calendarId: string | undefined,
  deps: HandlerDependencies,
) => {
  if (!calendarId) {
    return json(400, { message: "Calendar is required." });
  }

  const event = await getEvent(context, calendarId, eventId, deps);
  if (!event) {
    return json(404, { message: "Event not found." });
  }

  return json(200, toScheduleEvent(event));
};

const forceSyncCalendars = async (
  context: RequestContext,
  body: { timeMin?: string; timeMax?: string; calendarIds?: string[] } | undefined,
  deps: HandlerDependencies,
) => {
  const timeMin = body?.timeMin ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = body?.timeMax ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  return json(
    200,
    await syncSelectedCalendars(context, deps, {
      timeMin,
      timeMax,
      forceSync: true,
      calendarIds: body?.calendarIds,
    }),
  );
};

const clearScheduleCache = async (context: RequestContext, deps: HandlerDependencies) => {
  const calendars = await listCalendars(context, deps);

  for (const calendar of calendars) {
    const events = await listAllEventsForCalendar(context, calendar.calendarId, deps);
    for (const event of events) {
      await deleteCachedEventOnly(context, event, deps);
    }

    const resetCalendar: CalendarItem = {
      ...calendar,
      updatedAt: deps.now(),
      sync: {
        ...calendar.sync,
        initialSyncWindowEnd: undefined,
        initialSyncWindowStart: undefined,
        lastSyncedAt: undefined,
        lastSyncCompletedAt: undefined,
        lastSyncError: undefined,
        lastSyncSource: undefined,
        lastSyncStartedAt: undefined,
        lastSyncStatus: "idle",
        requiresFullSync: true,
        syncToken: undefined,
      },
    };
    await putCalendar(context, resetCalendar, deps);
  }

  return json(200, { cleared: true });
};

const clearCalendarCache = async (
  context: RequestContext,
  calendarId: string,
  deps: HandlerDependencies,
) => {
  const calendar = await getCalendar(context, calendarId, deps);
  if (!calendar) {
    return json(404, { message: "Calendar not found." });
  }

  const events = await listAllEventsForCalendar(context, calendar.calendarId, deps);
  for (const event of events) {
    await deleteCachedEventOnly(context, event, deps);
  }

  const resetCalendar: CalendarItem = {
    ...calendar,
    updatedAt: deps.now(),
    sync: {
      ...calendar.sync,
      initialSyncWindowEnd: undefined,
      initialSyncWindowStart: undefined,
      lastSyncedAt: undefined,
      lastSyncCompletedAt: undefined,
      lastSyncError: undefined,
      lastSyncSource: undefined,
      lastSyncStartedAt: undefined,
      lastSyncStatus: "idle",
      requiresFullSync: true,
      syncToken: undefined,
    },
  };

  await putCalendar(context, resetCalendar, deps);
  return json(200, { cleared: true, calendarId });
};

const buildGoogleEventBody = (
  input: Pick<CreateScheduleEventInput, "summary" | "description" | "location" | "attendees" | "start" | "end" | "allDay" | "memberIds">,
) => {
  const memberIds = normalizeMemberIds(input.memberIds);
  const attendees = normalizeAttendees(input.attendees).map((email) => ({ email }));
  const description = input.description?.trim();
  const location = input.location?.trim();
  const base = {
    summary: input.summary.trim(),
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    attendees,
    extendedProperties: {
      private: {
        memberIds: serializeGoogleMemberIds(memberIds),
      },
    },
  };

  if (input.allDay) {
    return {
      ...base,
      start: { date: input.start.slice(0, 10) },
      end: { date: input.end.slice(0, 10) },
    };
  }

  return {
    ...base,
    start: { dateTime: input.start },
    end: { dateTime: input.end },
  };
};

const createScheduleEvent = async (
  context: RequestContext,
  input: CreateScheduleEventInput,
  deps: HandlerDependencies,
) => {
  const validationError = validateEventInput(input);
  if (validationError) {
    return json(400, { message: validationError });
  }

  const connection = await getGoogleConnection(context, deps);
  if (!connection) {
    return json(400, { message: "Connect Google Calendar first." });
  }

  const calendar = await getCalendar(context, input.calendarId, deps);
  if (!calendar) {
    return json(404, { message: "Calendar not found." });
  }

  const resolvedHouseholdMemberIds = await resolveHouseholdMemberIds(context, input.householdIds, deps);
  const resolvedMemberIds = [...new Set([...normalizeMemberIds(input.memberIds), ...resolvedHouseholdMemberIds])];
  const nextInput: CreateScheduleEventInput = {
    ...input,
    memberIds: resolvedMemberIds,
    dismissedAutoLinkedMemberIds: normalizeMemberIds(input.dismissedAutoLinkedMemberIds),
  };

  const response = await googleFetch(
    context,
    connection,
    GOOGLE_CALENDAR_EVENTS_URL(input.calendarId),
    deps,
    {
      method: "POST",
      body: JSON.stringify(buildGoogleEventBody(nextInput)),
    },
  );

  const created = (await response.json()) as GoogleEventPayload;

  const stored = await upsertGoogleEventIntoCache(context, calendar, created, "GOOGLE", undefined, deps);
  const updatedStored = await persistEventWithMemberAssignments(context, {
    ...stored,
    dismissedAutoLinkedMemberIds: nextInput.dismissedAutoLinkedMemberIds,
    memberIds: resolvedMemberIds,
    visitationType: input.type,
  }, deps);
  return json(201, toScheduleEvent(updatedStored));
};

const updateScheduleEvent = async (
  context: RequestContext,
  eventId: string,
  input: UpdateScheduleEventInput,
  deps: HandlerDependencies,
) => {
  const validationError = validateEventUpdateInput(input);
  if (validationError) {
    return json(400, { message: validationError });
  }

  const connection = await getGoogleConnection(context, deps);
  if (!connection) {
    return json(400, { message: "Connect Google Calendar first." });
  }

  const existing = await getEvent(context, input.calendarId, eventId, deps);
  if (!existing) {
    return json(404, { message: "Event not found." });
  }

  const calendar = await getCalendar(context, input.calendarId, deps);
  if (!calendar) {
    return json(404, { message: "Calendar not found." });
  }

  const nextEvent: CreateScheduleEventInput = {
    calendarId: input.calendarId,
    summary: input.summary ?? existing.summary,
    description: input.description ?? existing.description,
    location: input.location ?? existing.location,
    attendees: input.attendees ?? existing.attendees,
    start: input.start ?? existing.start,
    end: input.end ?? existing.end,
    allDay: input.allDay ?? existing.allDay,
    memberIds: input.memberIds ?? existing.memberIds,
    dismissedAutoLinkedMemberIds: input.dismissedAutoLinkedMemberIds ?? existing.dismissedAutoLinkedMemberIds,
    householdIds: input.householdIds,
    type: input.type ?? existing.visitationType,
  };

  if (new Date(nextEvent.end).getTime() <= new Date(nextEvent.start).getTime()) {
    return json(400, { message: "End time must be after start time." });
  }

  const resolvedHouseholdMemberIds = await resolveHouseholdMemberIds(context, nextEvent.householdIds, deps);
  nextEvent.memberIds = [...new Set([...normalizeMemberIds(nextEvent.memberIds), ...resolvedHouseholdMemberIds])];

  const response = await googleFetch(
    context,
    connection,
    GOOGLE_CALENDAR_EVENTS_URL(input.calendarId) + `/${encodeURIComponent(eventId)}`,
    deps,
    {
      method: "PATCH",
      body: JSON.stringify(buildGoogleEventBody(nextEvent)),
    },
  );

  const updated = (await response.json()) as GoogleEventPayload;

  const stored = await upsertGoogleEventIntoCache(
    context,
    calendar,
    updated,
    "GOOGLE",
    {
      ...existing,
      dismissedAutoLinkedMemberIds: nextEvent.dismissedAutoLinkedMemberIds,
      memberIds: nextEvent.memberIds,
      visitationType: nextEvent.type,
    },
    deps,
  );
  const persistedAutoLinkedMembers = await loadMembersByIds(context, stored.autoLinkedMemberIds ?? [], deps);
  const autoLinkedVisitationTypeOverride =
    persistedAutoLinkedMembers.length && !normalizeMemberIds(nextEvent.memberIds).length
      ? stored.autoLinkedVisitationType
      : undefined;
  const updatedStored = await persistEventWithMemberAssignments(context, {
    ...stored,
    dismissedAutoLinkedMemberIds: nextEvent.dismissedAutoLinkedMemberIds,
    memberIds: nextEvent.memberIds ?? [],
    visitationType: nextEvent.type,
  }, deps, {
    autoLinkedMembers: persistedAutoLinkedMembers,
    visitationTypeOverride: autoLinkedVisitationTypeOverride,
  });
  return json(200, toScheduleEvent(updatedStored));
};

const deleteScheduleEvent = async (
  context: RequestContext,
  eventId: string,
  calendarId: string,
  deps: HandlerDependencies,
) => {
  if (!calendarId) {
    return json(400, { message: "Calendar is required." });
  }

  const connection = await getGoogleConnection(context, deps);
  if (!connection) {
    return json(400, { message: "Connect Google Calendar first." });
  }

  const existing = await getEvent(context, calendarId, eventId, deps);
  if (!existing) {
    return json(404, { message: "Event not found." });
  }

  await googleFetch(
    context,
    connection,
    GOOGLE_CALENDAR_EVENTS_URL(calendarId) + `/${encodeURIComponent(eventId)}`,
    deps,
    {
      method: "DELETE",
    },
  );

  await deleteStoredEvent(context, existing, deps);
  return json(200, { deleted: true, eventId, calendarId });
};

const getAdminUsers = async (context: RequestContext, deps: HandlerDependencies) => {
  await requireAdminContext(context, deps, "admin.user_groups.list");
  const items = await listTenantUsers(context, deps);
  return json(200, { items } satisfies TenantUsersResponse);
};

const updateAdminUserGroups = async (
  context: RequestContext,
  username: string,
  input: UpdateTenantUserGroupsInput,
  deps: HandlerDependencies,
) => {
  await requireAdminContext(context, deps, "admin.user_groups.update");
  try {
    const requestedGroups = [...new Set(normalizeGroups(input.groups).filter((group): group is AdminManagedGroup =>
      adminManagedGroups.includes(group as AdminManagedGroup),
    ))];
    const targetUser = await getTenantUser(context, username, deps);
    const currentManagedGroups = targetUser.groups.filter((group): group is AdminManagedGroup =>
      adminManagedGroups.includes(group as AdminManagedGroup),
    );

    if (targetUser.sub === context.actorSub && currentManagedGroups.includes("admin") && !requestedGroups.includes("admin")) {
      throw new HttpError(400, "You cannot remove your own admin access from this page.");
    }

    const currentSet = new Set(currentManagedGroups);
    const requestedSet = new Set(requestedGroups);

    for (const group of adminManagedGroups) {
      if (!currentSet.has(group) && requestedSet.has(group)) {
        await deps.cognitoClient.send(
          new AdminAddUserToGroupCommand({
            GroupName: group,
            UserPoolId: getUserPoolId(),
            Username: username,
          }),
        );
        await logAuditEvent(context, "admin.user_group_added", "success", deps, {
          targetUserId: targetUser.sub,
          targetUsername: targetUser.username,
          metadata: { group },
        });
      }

      if (currentSet.has(group) && !requestedSet.has(group)) {
        await deps.cognitoClient.send(
          new AdminRemoveUserFromGroupCommand({
            GroupName: group,
            UserPoolId: getUserPoolId(),
            Username: username,
          }),
        );
        await logAuditEvent(context, "admin.user_group_removed", "success", deps, {
          targetUserId: targetUser.sub,
          targetUsername: targetUser.username,
          metadata: { group },
        });
      }
    }

    const user = await getTenantUser(context, username, deps);
    return json(200, { user } satisfies UpdateTenantUserGroupsResponse);
  } catch (error) {
    await logAuditEvent(context, "admin.user_groups.update", "failed", deps, {
      targetUsername: username,
      metadata: {
        message: error instanceof Error ? error.message : "Unexpected error",
      },
    });
    throw error;
  }
};

const runAdminReset = async (
  context: RequestContext,
  action: string,
  deps: HandlerDependencies,
) => {
  await requireAdminContext(context, deps, "admin.tenant_reset.run");

  try {
    let summary: AdminResetSummary;
    if (action === "tenant_all") {
      summary = await resetEntireTenant(context, deps);
    } else if (action === "google_cached_events") {
      summary = await resetGoogleCachedEvents(context, deps);
    } else if (action === "google_connections") {
      summary = await resetGoogleConnections(context, deps);
    } else if (action === "visitations") {
      summary = await resetVisitations(context, deps);
    } else if (action === "members") {
      summary = await resetMembers(context, deps);
    } else if (action === "audit_logs") {
      summary = await resetAuditLogs(context, deps);
    } else {
      throw new HttpError(404, "Reset action not found.");
    }

    await logAuditEvent(context, `admin.reset.${summary.action}`, "success", deps, {
      deletionCounts: Object.fromEntries(summary.affectedEntities.map((entry) => [entry.entityType, entry.deleted])),
    });
    return json(200, summary);
  } catch (error) {
    if (error instanceof HttpError) {
      await logAuditEvent(context, `admin.reset.${action}`, "failed", deps, {
        metadata: { message: error.message },
      });
      throw error;
    }

    await logAuditEvent(context, `admin.reset.${action}`, "failed", deps, {
      metadata: { message: error instanceof Error ? error.message : "Unexpected error" },
    });
    throw error;
  }
};

const getPublicMonthAvailability = async (
  slug: string,
  query: Record<string, string | undefined> | undefined,
  deps: HandlerDependencies,
): Promise<PublicBookingMonthAvailability | null> => {
  const tableName = process.env.SHEPHERD_HUB_RECORDS_TABLE ?? "";
  const profile = await getPublicBookingProfile(slug, tableName, deps);
  const appointmentTypeId = normalizeWhitespace(query?.appointmentTypeId);
  const month = normalizeWhitespace(query?.month);
  if (!profile) return null;
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "month must be YYYY-MM.");
  const appointmentType = profile.appointmentTypes.find((type) => type.id === appointmentTypeId && type.enabled);
  if (!appointmentType) return null;
  const requestedDuration = query?.durationMinutes ? Number(query.durationMinutes) : appointmentType.defaultDurationMinutes;
  if (!Number.isInteger(requestedDuration) || !appointmentType.allowedDurationsMinutes.includes(requestedDuration)) {
    throw new HttpError(400, "durationMinutes must be an allowed appointment duration.");
  }
  const monthStart = DateTime.fromISO(`${month}-01`, { zone: profile.timezone }).startOf("day");
  if (!monthStart.isValid) throw new HttpError(400, "Invalid booking timezone.");
  const monthEnd = monthStart.plus({ months: 1 });
  const now = DateTime.fromISO(deps.now(), { zone: "utc" });
  const minStart = now.plus({ minutes: profile.minimumNoticeMinutes });
  const horizonEnd = now.setZone(profile.timezone).startOf("day").plus({ days: profile.maximumBookingDays + 1 });
  const publicContext: RequestContext = { actorSub: profile.ownerUserId, tenantId: profile.tenantId, actorEmail: "unknown@example.com", actorName: "Public booking", actorGroups: [], tableName };
  const connection = await getGoogleConnection(publicContext, deps);
  if (!connection) throw new HttpError(400, "Booking calendar connection is unavailable.");
  const calendarIds = [...new Set([profile.bookingCalendarId, ...profile.conflictCalendarIds].filter((id): id is string => Boolean(id)))];
  const busyIntervals: Array<{ start: DateTime; end: DateTime }> = [];
  if (calendarIds.length) {
    const freeBusyResponse = await googleFetch(publicContext, connection, "https://www.googleapis.com/calendar/v3/freeBusy", deps, {
      method: "POST",
      body: JSON.stringify({ timeMin: monthStart.toUTC().toISO(), timeMax: monthEnd.toUTC().toISO(), items: calendarIds.map((id) => ({ id })) }),
    });
    const payload = await freeBusyResponse.json() as { calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }> };
    Object.values(payload.calendars ?? {}).flatMap((calendar) => calendar.busy ?? []).forEach((busy) => {
      const start = DateTime.fromISO(busy.start ?? "", { zone: "utc" }); const end = DateTime.fromISO(busy.end ?? "", { zone: "utc" });
      if (start.isValid && end.isValid && start < end) busyIntervals.push({ start, end });
    });
  }
  const bookingDays = await queryAll(deps.documentClient, {
    TableName: tableName, KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from AND :to",
    ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
    ExpressionAttributeValues: { ":pk": bookingDayPk(profile.profileId), ":from": monthStart.toISODate() ?? "", ":to": monthEnd.minus({ days: 1 }).toISODate() ?? "" },
  }) as BookingDayItem[];
  const reservationsByDate = new Map(bookingDays.map((day) => [day.SK, day.reservations ?? []]));
  const blackoutDates = new Set(profile.globalDateOverrides.map((override) => override.date));
  const overrides = new Map(appointmentType.dateOverrides.map((override) => [override.date, override]));
  const availableDates: string[] = [];
  for (let day = monthStart; day < monthEnd; day = day.plus({ days: 1 })) {
    const date = day.toISODate() ?? "";
    if (blackoutDates.has(date) || day < now.setZone(profile.timezone).startOf("day") || day >= horizonEnd) continue;
    const override = overrides.get(date);
    const ranges = override ? ("ranges" in override ? override.ranges : []) : (appointmentType.weeklyAvailability[bookingWeekdays[day.weekday - 1]] ?? []);
    if (!ranges.length) continue;
    const reservations = reservationsByDate.get(date) ?? [];
    let found = false;
    for (let minute = 0; minute < 24 * 60 && !found; minute += profile.startIntervalMinutes) {
      const candidate = day.plus({ minutes: minute }); const end = candidate.plus({ minutes: requestedDuration });
      if (!candidate.isValid || !end.isValid || candidate < minStart) continue;
      if (!ranges.some((range) => minute >= Number(range.start.slice(0, 2)) * 60 + Number(range.start.slice(3)) && minute + requestedDuration <= Number(range.end.slice(0, 2)) * 60 + Number(range.end.slice(3)))) continue;
      const candidateUtc = candidate.toUTC(); const endUtc = end.toUTC();
      const hasGoogleConflict = busyIntervals.some((busy) => candidateUtc < busy.end && endUtc > busy.start);
      const hasReservationConflict = reservations.some((reservation) => (reservation.status === "CONFIRMED" || (reservation.status === "RESERVED" && (!reservation.expiresAt || DateTime.fromISO(reservation.expiresAt) > now))) && candidateUtc < DateTime.fromISO(reservation.end, { zone: "utc" }) && endUtc > DateTime.fromISO(reservation.start, { zone: "utc" }));
      if (!hasGoogleConflict && !hasReservationConflict) found = true;
    }
    if (found) availableDates.push(date);
  }
  return { appointmentTypeId, durationMinutes: requestedDuration, month, availableDates };
};

const getPublicDayAvailability = async (
  slug: string,
  query: Record<string, string | undefined> | undefined,
  deps: HandlerDependencies,
): Promise<PublicBookingDayAvailability | null> => {
  const tableName = process.env.SHEPHERD_HUB_RECORDS_TABLE ?? "";
  const profile = await getPublicBookingProfile(slug, tableName, deps);
  const appointmentTypeId = normalizeWhitespace(query?.appointmentTypeId);
  const date = normalizeWhitespace(query?.date);
  const durationMinutes = Number(query?.durationMinutes);
  if (!profile) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date must be YYYY-MM-DD.");
  const type = profile.appointmentTypes.find((item) => item.id === appointmentTypeId && item.enabled);
  if (!type) return null;
  if (!Number.isInteger(durationMinutes) || !type.allowedDurationsMinutes.includes(durationMinutes)) throw new HttpError(400, "durationMinutes must be an allowed appointment duration.");
  const day = DateTime.fromISO(date, { zone: profile.timezone }).startOf("day");
  if (!day.isValid) throw new HttpError(400, "Invalid booking date.");
  const now = DateTime.fromISO(deps.now(), { zone: "utc" });
  const minStart = now.plus({ minutes: profile.minimumNoticeMinutes });
  const horizonEnd = now.setZone(profile.timezone).startOf("day").plus({ days: profile.maximumBookingDays + 1 });
  const unavailable = profile.globalDateOverrides.some((override) => override.date === date) || day < now.setZone(profile.timezone).startOf("day") || day >= horizonEnd;
  const override = type.dateOverrides.find((item) => item.date === date);
  const ranges = unavailable ? [] : override ? ("ranges" in override ? override.ranges : []) : (type.weeklyAvailability[bookingWeekdays[day.weekday - 1]] ?? []);
  if (!ranges.length) return { date, appointmentTypeId, durationMinutes, timezone: profile.timezone, slots: [] };
  const publicContext: RequestContext = { actorSub: profile.ownerUserId, tenantId: profile.tenantId, actorEmail: "unknown@example.com", actorName: "Public booking", actorGroups: [], tableName };
  const connection = await getGoogleConnection(publicContext, deps);
  if (!connection) throw new HttpError(400, "Booking calendar connection is unavailable.");
  const calendarIds = [...new Set([profile.bookingCalendarId, ...profile.conflictCalendarIds].filter((id): id is string => Boolean(id)))];
  const freeBusy = await googleFetch(publicContext, connection, "https://www.googleapis.com/calendar/v3/freeBusy", deps, { method: "POST", body: JSON.stringify({ timeMin: day.toUTC().toISO(), timeMax: day.plus({ days: 1 }).toUTC().toISO(), items: calendarIds.map((id) => ({ id })) }) });
  const busyPayload = await freeBusy.json() as { calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }> };
  const busy = Object.values(busyPayload.calendars ?? {}).flatMap((calendar) => calendar.busy ?? []).map((item) => ({ start: DateTime.fromISO(item.start ?? "", { zone: "utc" }), end: DateTime.fromISO(item.end ?? "", { zone: "utc" }) })).filter((item) => item.start.isValid && item.end.isValid && item.start < item.end);
  const dayResult = await deps.documentClient.send(new GetCommand({ TableName: tableName, Key: { PK: bookingDayPk(profile.profileId), SK: date } }));
  const reservations = ((dayResult.Item as BookingDayItem | undefined)?.reservations ?? []).filter((reservation) => reservation.status === "CONFIRMED" || (reservation.status === "RESERVED" && (!reservation.expiresAt || DateTime.fromISO(reservation.expiresAt) > now)));
  const slots: PublicBookingDayAvailability["slots"] = [];
  for (let minute = 0; minute < 24 * 60; minute += profile.startIntervalMinutes) {
    const start = day.plus({ minutes: minute }); const end = start.plus({ minutes: durationMinutes });
    if (!start.isValid || !end.isValid || start < minStart || !ranges.some((range) => minute >= Number(range.start.slice(0, 2)) * 60 + Number(range.start.slice(3)) && minute + durationMinutes <= Number(range.end.slice(0, 2)) * 60 + Number(range.end.slice(3)))) continue;
    const utcStart = start.toUTC(); const utcEnd = end.toUTC();
    if (busy.some((item) => utcStart < item.end && utcEnd > item.start) || reservations.some((item) => utcStart < DateTime.fromISO(item.end, { zone: "utc" }) && utcEnd > DateTime.fromISO(item.start, { zone: "utc" }))) continue;
    slots.push({ start: utcStart.toISO() ?? "", end: utcEnd.toISO() ?? "" });
  }
  return { date, appointmentTypeId, durationMinutes, timezone: profile.timezone, slots };
};

export const createHandler = (overrides: Partial<HandlerDependencies> = {}): APIGatewayProxyHandlerV2 => {
  const deps: HandlerDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  return async (event) => {
    try {
      const typedEvent = event as APIGatewayProxyEventV2WithJWTAuthorizer;
      const method = typedEvent.requestContext.http.method;
      const path = typedEvent.rawPath;

      if (method === "GET" && path === "/schedule/google/callback") {
        return await handleGoogleCallback(typedEvent, deps);
      }

      const publicDayAvailabilitySlug = /^\/public\/booking-pages\/([^/]+)\/availability\/day$/.exec(path)?.[1];
      if (method === "GET" && publicDayAvailabilitySlug) {
        const availability = await getPublicDayAvailability(publicDayAvailabilitySlug, typedEvent.queryStringParameters, deps);
        return availability ? json(200, availability) : json(404, { message: "Booking page not found." });
      }

      const publicAvailabilitySlug = /^\/public\/booking-pages\/([^/]+)\/availability\/month$/.exec(path)?.[1];
      if (method === "GET" && publicAvailabilitySlug) {
        const availability = await getPublicMonthAvailability(publicAvailabilitySlug, typedEvent.queryStringParameters, deps);
        return availability ? json(200, availability) : json(404, { message: "Booking page not found." });
      }

      const publicBookingSlug = /^\/public\/booking-pages\/([^/]+)$/.exec(path)?.[1];
      if (method === "GET" && publicBookingSlug) {
        const page = await getPublicBookingPage(publicBookingSlug, process.env.SHEPHERD_HUB_RECORDS_TABLE ?? "", deps);
        return page ? json(200, page) : json(404, { message: "Booking page not found." });
      }

      const context = getContext(typedEvent);
      const calendarId = typedEvent.pathParameters?.calendarId;
      const eventId = typedEvent.pathParameters?.eventId;
      const username = typedEvent.pathParameters?.username;
      const resetAction = typedEvent.pathParameters?.action;

      if (path === "/tags" || /^\/tags\/[^/]+$/.test(path)) {
        return await handleTags(context, method, path === "/tags" ? undefined : decodeURIComponent(path.split("/")[2]), typedEvent, deps);
      }

      if (method === "GET" && path === "/members") {
        return await getMembers(context, deps, typedEvent);
      }

      if (method === "GET" && path === "/members/index") {
        return await getMembersIndex(context, deps, typedEvent);
      }

      if (method === "GET" && path === "/household-conflicts") {
        return await getHouseholdConflictsResponse(context, deps);
      }

      if (method === "POST" && path === "/members") {
        return await createMember(context, parseBody<CreateMemberInput>(typedEvent.body), deps);
      }

      if (method === "POST" && path === "/members/import") {
        return await createMemberImportJob(context, parseBody<MemberImportInput>(typedEvent.body), deps);
      }

      const importJobId = typedEvent.pathParameters?.jobId;
      if (path === `/members/import/${importJobId}` && importJobId && method === "GET") {
        return await processMemberImportJob(context, importJobId, deps);
      }

      if (path === `/members/import/${importJobId}/cancel` && importJobId && method === "POST") {
        return await cancelMemberImportJob(context, importJobId, deps);
      }

      const householdGeocodeJobId = typedEvent.pathParameters?.jobId;
      if (method === "POST" && path === "/admin/household-geocoding") {
        return await createHouseholdGeocodeJob(
          context,
          parseBody<CreateHouseholdGeocodeJobInput>(typedEvent.body),
          deps,
        );
      }

      if (method === "GET" && path === "/admin/jobs") {
        return await getAdminJobs(context, deps);
      }

      if (path === `/admin/household-geocoding/${householdGeocodeJobId}` && householdGeocodeJobId && method === "GET") {
        return await processHouseholdGeocodeJob(context, householdGeocodeJobId, deps);
      }

      if (path === `/admin/household-geocoding/${householdGeocodeJobId}/cancel` && householdGeocodeJobId && method === "POST") {
        return await cancelHouseholdGeocodeJob(context, householdGeocodeJobId, deps);
      }

      const memberId = typedEvent.pathParameters?.memberId;

      if (path === `/members/${memberId}` && memberId) {
        if (method === "GET") {
          return await getMemberDetails(context, memberId, deps);
        }

        if (method === "PUT") {
          return await updateMember(context, memberId, parseBody<UpdateMemberInput>(typedEvent.body), deps);
        }

        if (method === "DELETE") {
          return await deleteMember(context, memberId, deps);
        }
      }

      if (path === `/members/${memberId}/household` && memberId) {
        if (method === "POST") {
          const input = parseBody<AttachMemberToHouseholdInput>(typedEvent.body);
          return await attachMemberToHousehold(context, memberId, input.householdId, deps);
        }

        if (method === "DELETE") {
          const member = await getMember(context, memberId, deps);
          if (!member?.householdId) {
            return json(400, { message: "Member is not assigned to a household." });
          }

          return await removeMemberFromHousehold(context, memberId, member.householdId, deps);
        }
      }

      if (path === `/household-conflicts/${memberId}/resolve` && memberId && method === "POST") {
        return await resolveHouseholdConflict(
          context,
          memberId,
          parseBody<ResolveHouseholdConflictInput>(typedEvent.body),
          deps,
        );
      }

      if (path === `/members/${memberId}/events` && memberId && method === "GET") {
        return await getMemberEventsResponse(context, memberId, deps);
      }

      if (method === "GET" && path === "/households") {
        return await getHouseholds(context, typedEvent, deps);
      }

      if (method === "POST" && path === "/households/match") {
        return await matchHouseholdByAddress(context, parseBody<{ address?: string; postalCode?: string }>(typedEvent.body), deps);
      }

      if (method === "POST" && path === "/households") {
        return await createHousehold(context, parseBody<CreateHouseholdInput>(typedEvent.body), deps);
      }

      const householdId = typedEvent.pathParameters?.householdId;
      const householdMemberId = typedEvent.pathParameters?.memberId;
      if (path === `/households/${householdId}` && householdId) {
        if (method === "GET") {
          return await getHouseholdDetails(context, householdId, deps);
        }

        if (method === "PUT") {
          return await updateHousehold(context, householdId, parseBody<UpdateHouseholdInput>(typedEvent.body), deps);
        }

        if (method === "DELETE") {
          return await deleteHousehold(context, householdId, deps);
        }
      }

      if (path === `/households/${householdId}/members` && householdId && method === "POST") {
        const input = parseBody<{ memberId: string }>(typedEvent.body);
        return await attachMemberToHousehold(context, input.memberId, householdId, deps);
      }

      if (path === `/households/${householdId}/members/${householdMemberId}` && householdId && householdMemberId && method === "DELETE") {
        return await removeMemberFromHousehold(context, householdMemberId, householdId, deps);
      }

      if (path === `/members/${memberId}/visitations` && memberId && method === "POST") {
        return await createManualVisitation(
          context,
          memberId,
          parseBody<CreateManualVisitationInput>(typedEvent.body),
          deps,
        );
      }

      const visitationId = typedEvent.pathParameters?.visitationId;
      if (path === `/members/${memberId}/visitations/${visitationId}` && memberId && visitationId) {
        if (method === "PUT") {
          return await updateManualVisitation(
            context,
            memberId,
            visitationId,
            parseBody<UpdateManualVisitationInput>(typedEvent.body),
            deps,
          );
        }

        if (method === "DELETE") {
          return await deleteManualVisitation(context, memberId, visitationId, deps);
        }
      }

      if (method === "GET" && path === "/schedule/overview") {
        return await getScheduleOverview(context, deps);
      }

      if (method === "GET" && path === "/booking-settings") {
        return await getBookingSettings(context, deps);
      }

      if (method === "PUT" && path === "/booking-settings") {
        return await saveBookingSettings(context, parseBody<SaveBookingSettingsInput>(typedEvent.body), deps);
      }

      if (method === "GET" && path === "/reports/visitations") {
        return await getVisitationReport(context, typedEvent, deps);
      }

      if (method === "GET" && path === "/reports/visitation-geography") {
        return await getVisitationGeographyReport(context, typedEvent, deps);
      }

      if (method === "POST" && path === "/schedule/google/connect") {
        return await connectGoogle(context, deps);
      }

      if (method === "DELETE" && path === "/schedule/google/connection") {
        return await disconnectGoogle(context, deps);
      }

      if (method === "POST" && path === "/schedule/calendars/refresh") {
        return await refreshCalendars(context, deps);
      }

      if (method === "PUT" && path === "/schedule/settings") {
        return await saveScheduleSettings(
          context,
          parseBody<SaveScheduleSettingsInput>(typedEvent.body),
          deps,
        );
      }

      if (method === "GET" && path === "/schedule/events") {
        return await getScheduleEvents(context, typedEvent, deps);
      }

      if (method === "POST" && path === "/schedule/events") {
        return await createScheduleEvent(context, parseBody<CreateScheduleEventInput>(typedEvent.body), deps);
      }

      if (path === `/schedule/events/${eventId}` && eventId) {
        if (method === "GET") {
          return await getScheduleEventResponse(
            context,
            eventId,
            typedEvent.queryStringParameters?.calendarId,
            deps,
          );
        }

        if (method === "PUT") {
          return await updateScheduleEvent(
            context,
            eventId,
            parseBody<UpdateScheduleEventInput>(typedEvent.body),
            deps,
          );
        }

        if (method === "DELETE") {
          return await deleteScheduleEvent(
            context,
            eventId,
            typedEvent.queryStringParameters?.calendarId ?? "",
            deps,
          );
        }
      }

      if (path === `/events/${eventId}/members` && eventId) {
        if (method === "GET") {
          return await getEventMembersResponse(context, eventId, typedEvent.queryStringParameters?.calendarId, deps);
        }

        if (method === "PUT") {
          return await updateEventMembersResponse(
            context,
            eventId,
            parseBody<UpdateEventMembersInput>(typedEvent.body),
            deps,
          );
        }
      }

      if (method === "POST" && path === "/schedule/sync") {
        return await forceSyncCalendars(
          context,
          parseBody<{ timeMin?: string; timeMax?: string; calendarIds?: string[] }>(typedEvent.body),
          deps,
        );
      }

      if (method === "DELETE" && path === "/schedule/cache") {
        return await clearScheduleCache(context, deps);
      }

      if (path === `/schedule/calendars/${calendarId}` && calendarId && method === "PUT") {
        return await updateCalendarSettings(
          context,
          calendarId,
          parseBody<UpdateCalendarSettingsInput>(typedEvent.body),
          deps,
        );
      }

      if (path === `/schedule/calendars/${calendarId}/sync` && calendarId && method === "POST") {
        return await forceSyncCalendars(
          context,
          {
            ...parseBody<{ timeMin?: string; timeMax?: string }>(typedEvent.body),
            calendarIds: [calendarId],
          },
          deps,
        );
      }

      if (path === `/schedule/calendars/${calendarId}/cache` && calendarId && method === "DELETE") {
        return await clearCalendarCache(context, calendarId, deps);
      }

      if (method === "GET" && path === "/admin/users") {
        return await getAdminUsers(context, deps);
      }

      if (path === `/admin/users/${username}/groups` && username && method === "PUT") {
        return await updateAdminUserGroups(
          context,
          username,
          parseBody<UpdateTenantUserGroupsInput>(typedEvent.body),
          deps,
        );
      }

      if (path === `/admin/reset/${resetAction}` && resetAction && method === "POST") {
        return await runAdminReset(context, resetAction, deps);
      }

      return json(404, { message: "Route not found." });
    } catch (error) {
      if (error instanceof BookingSettingsError) {
        return json(error.statusCode, { message: error.message });
      }

      if (error instanceof HttpError) {
        return json(error.statusCode, { message: error.message });
      }

      return json(500, {
        message: error instanceof Error ? error.message : "Unexpected server error.",
      });
    }
  };
};

export const handler = createHandler();
