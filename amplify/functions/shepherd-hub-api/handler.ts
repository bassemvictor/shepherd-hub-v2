import { randomBytes, randomUUID } from "node:crypto";

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
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyHandlerV2 } from "aws-lambda";
import * as XLSX from "xlsx";
import { visitationTypes } from "../../../shared/types.js";

import type {
  AppCognitoGroup,
  AdminManagedGroup,
  AdminResetAction,
  AdminResetSummary,
  CalendarSyncConfig,
  CalendarSyncSnapshot,
  CreateMemberInput,
  CreateManualVisitationInput,
  ConnectGoogleResponse,
  CreateScheduleEventInput,
  EventMemberSummary,
  EventMembersResponse,
  GoogleConnectionStatus,
  GoogleConnectionSummary,
  InitialSyncRange,
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
  UpdateEventMembersInput,
  UpdateMemberInput,
  UpdateScheduleEventInput,
  UpdateCalendarSettingsInput,
  UpdateTenantUserGroupsInput,
  UpdateTenantUserGroupsResponse,
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
  result: MemberImportResult;
};

type MemberImportChunkItem = BaseItem & {
  tenantId: string;
  jobId: string;
  chunkIndex: number;
  rowCount: number;
  rows: ImportWorkbookRow[];
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

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

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
const memberImportJobSk = (jobId: string) => `MEMBER_IMPORT_JOB#${jobId}`;
const memberImportChunkSk = (jobId: string, chunkIndex: number) =>
  `MEMBER_IMPORT_JOB#${jobId}#CHUNK#${String(chunkIndex).padStart(6, "0")}`;
const memberImportChunkSkPrefix = (jobId: string) => `MEMBER_IMPORT_JOB#${jobId}#CHUNK#`;
const memberGsiPk = (tenantId: string) => `TENANT#${tenantId}#MEMBERS`;
const memberGsiSk = (normalizedName: string, memberId: string) => `NAME#${normalizedName}#MEMBER#${memberId}`;
const memberUnityGsiPk = (tenantId: string) => `TENANT#${tenantId}#UNITY`;
const memberUnityGsiSk = (unityId: string) => `UNITY#${unityId}`;
const tenantEventPk = (tenantId: string, eventId: string) => `TENANT#${tenantId}#EVENT#${eventId}`;
const tenantVisitationPk = (tenantId: string, visitationId: string) => `TENANT#${tenantId}#VISITATION#${visitationId}`;
const eventMemberSk = (memberId: string) => `MEMBER#${memberId}`;
const tenantMemberPk = (tenantId: string, memberId: string) => `TENANT#${tenantId}#MEMBER#${memberId}`;
const memberEventGsiPk = (tenantId: string, memberId: string) => `TENANT#${tenantId}#MEMBER#${memberId}`;
const memberEventGsiSk = (eventStartDateTime: string, eventId: string) => `EVENT#${eventStartDateTime}#${eventId}`;
const tenantEventAssignmentGsiPk = (tenantId: string) => `TENANT#${tenantId}#EVENT_ASSIGNMENTS`;
const tenantEventAssignmentGsiSk = (eventStartDateTime: string, memberId: string, eventId: string) =>
  `EVENT#${eventStartDateTime}#MEMBER#${memberId}#EVENT#${eventId}`;
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
const isAdminGroup = (group: AppCognitoGroup) => group === "admin";
const importJobChunkSize = 20;
const importJobErrorLimit = 100;

const defaultCalendarListRefreshThresholdMinutes = 60 * 24 * 7;

const defaultInitialSyncRange = (nowIso: string): InitialSyncRange => {
  const now = new Date(nowIso);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return {
    from: `${sixMonthsAgo.getFullYear()}-01-01`,
    to: `${now.getFullYear() + 2}-12-31`,
  };
};

const normalizeRefreshInterval = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60;
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

  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) {
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

const normalizeSearchText = (...values: Array<unknown>) =>
  values
    .map((value) => normalizeWhitespace(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

const normalizeName = (value: unknown) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();

const toOptionalString = (value: unknown) => {
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
};

const defaultVisitationType: VisitationType = "Visitation";

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
  timeMax: `${range.to}T23:59:59.999Z`,
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
  createdAt: item.createdAt,
  entityType: item.entityType,
  tenantId: item.tenantId,
  updatedAt: item.updatedAt,
  memberId: item.memberId,
  unityId: item.unityId,
  source: item.source,
  isUnityMember: item.isUnityMember,
  familyId: item.familyId,
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
  memberId: item.memberId,
  fullName: item.fullName,
  initials: item.initials,
  phone: item.phone,
  email: item.email,
  householdName: item.householdName,
  unityId: item.unityId,
  isUnityImported: item.source === "UNITY",
  source: item.source,
  normalizedSearchText: item.normalizedSearchText,
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
    !String(input.initialSyncRange?.to ?? "").trim() ||
    Number.isNaN(Date.parse(String(input.initialSyncRange?.from))) ||
    Number.isNaN(Date.parse(String(input.initialSyncRange?.to))) ||
    String(input.initialSyncRange?.from) > String(input.initialSyncRange?.to)
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
    Number(input.calendarListRefreshThresholdMinutes) <= 0
  ) {
    return "Calendar list refresh threshold must be greater than zero.";
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

const parseImportWorkbook = (input: MemberImportInput) => {
  const workbook = XLSX.read(Buffer.from(input.workbookBase64, "base64"), { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<Array<unknown>>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });

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
        next[header] = values[index] ?? "";
        return next;
      }, {});

      return {
        rowNumber,
        values: record,
      };
    });
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
  timeMax: string,
  deps: HandlerDependencies,
) => {
  const queryStart = expandEventQueryStart(timeMin);
  const items = await queryAll(deps.documentClient, {
    ExpressionAttributeNames: {
      "#gsiPk": "GSI1PK",
      "#gsiSk": "GSI1SK",
    },
    ExpressionAttributeValues: {
      ":gsiPk": eventGsiPk(context.actorSub, calendarId),
      ":from": `EVENT#${queryStart}`,
      ":to": `EVENT#${timeMax}~`,
    },
    IndexName: GSI1_NAME,
    KeyConditionExpression: "#gsiPk = :gsiPk AND #gsiSk BETWEEN :from AND :to",
    TableName: context.tableName,
  });

  return (items as EventItem[]).filter((item) => hasMatchingTenant(context, item) && item.end >= timeMin && item.start <= timeMax);
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
) => {
  const normalizedEvent: EventItem = {
    ...event,
    updatedAt: deps.now(),
  };
  const assignedMembers = await syncEventMembers(context, normalizedEvent, normalizedEvent.memberIds ?? [], deps);
  const persistedEvent: EventItem = {
    ...normalizedEvent,
    memberIds: assignedMembers.map((member) => member.memberId),
    memberNames: assignedMembers.map((member) => member.fullName),
    visitationType: assignedMembers.length ? normalizeVisitationType(normalizedEvent.visitationType) : undefined,
  };
  await putEvent(context, persistedEvent, deps);
  await syncVisitationRecords(context, persistedEvent, assignedMembers, deps);
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
  deps: HandlerDependencies,
): Promise<Omit<MemberImportResult, "errorCount">> => {
  const unityId = toOptionalString(row.values["Member ID"]);
  const fullName = normalizeWhitespace(row.values["Member Name"]);
  if (!unityId || !fullName) {
    return {
      created: 0,
      updated: 0,
      skipped: 1,
      errors: [],
    };
  }

  try {
    const existing = await getMemberByUnityId(context, unityId, deps);
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
      errors: [],
    };
  } catch (error) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [
        {
          row: row.rowNumber,
          message: error instanceof Error ? error.message : "Unknown import error.",
        },
      ],
    };
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
  const timestamp = deps.now();
  const memberId = existing?.memberId ?? deps.uuid();
  const fullName = normalizeWhitespace(input.fullName ?? existing?.fullName);
  const { firstName, lastName } = splitName(fullName);
  const source = (input.source ?? existing?.source ?? "MANUAL") as MemberSource;
  const unityId = toOptionalString(input.unityId ?? existing?.unityId);
  const normalizedName = normalizeName(fullName);
  return {
    PK: tenantPk(context.tenantId),
    SK: memberSk(memberId),
    GSI1PK: memberGsiPk(context.tenantId),
    GSI1SK: memberGsiSk(normalizedName, memberId),
    GSI2PK: unityId ? memberUnityGsiPk(context.tenantId) : undefined,
    GSI2SK: unityId ? memberUnityGsiSk(unityId) : undefined,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    entityType: "MEMBER",
    tenantId: context.tenantId,
    memberId,
    unityId,
    source,
    isUnityMember: source === "UNITY",
    familyId: toOptionalString(input.familyId ?? existing?.familyId),
    householdName: toOptionalString(input.householdName ?? existing?.householdName),
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
  deps: HandlerDependencies,
) => {
  const existingRecords = await listVisitationsForEvent(context, event.calendarId, event.eventId, deps);
  const existingMemberIds = new Set(existingRecords.map((item) => item.memberId));
  const nextMembers = members;
  const nextMemberIds = new Set(nextMembers.map((item) => item.memberId));
  const visitationId = eventVisitationId(event.calendarId, event.eventId);
  const memberIds = nextMembers.map((item) => item.memberId);
  const memberNames = nextMembers.map((item) => item.fullName);
  const visitationType = normalizeVisitationType(event.visitationType);

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
  const records = await scanTenantItemsByEntityTypes(context, ["MEMBER", "MEMBER_ACTIVITY"], deps);
  const members = records.filter((item): item is MemberItem => item.entityType === "MEMBER");
  const memberActivities = records.filter((item): item is MemberActivityItem => item.entityType === "MEMBER_ACTIVITY");
  await deleteItemsInBatches(context, [...toDeleteKeys(members), ...toDeleteKeys(memberActivities)], deps);

  return buildResetSummary("members", {
    MEMBER: members.length,
    MEMBER_ACTIVITY: memberActivities.length,
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
    const expiredConnection: GoogleConnectionItem = {
      ...connection,
      status: "expired",
      updatedAt: deps.now(),
    };
    await putGoogleConnection(context, expiredConnection, deps);
    throw new Error("Google connection expired and no refresh token is available.");
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
    const failedConnection: GoogleConnectionItem = {
      ...connection,
      status: "error",
      updatedAt: deps.now(),
    };
    await putGoogleConnection(context, failedConnection, deps);
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
  const metadataMemberIds = parseGoogleMemberIds(googleEvent.extendedProperties?.private?.memberIds);
  const memberIds = metadataMemberIds.length ? metadataMemberIds : normalizeMemberIds(existingItem?.memberIds);
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
    timeMax,
  });

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
  requestedTimeMax: string,
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
  timeMax: string,
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
    timeMax: string;
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

const getMembers = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await listMembers(context, deps);
  const response: MemberDirectoryResponse = {
    items: items.map(toMember),
    total: items.length,
  };
  return json(200, response);
};

const getMembersIndex = async (context: RequestContext, deps: HandlerDependencies) => {
  const items = await listMembers(context, deps);
  const response: MemberIndexResponse = {
    items: items.map(toMemberIndexItem),
    generatedAt: deps.now(),
  };
  return json(200, response);
};

const getMemberDetails = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const member = await getMember(context, memberId, deps);
  if (!member) {
    return json(404, { message: "Member not found." });
  }

  const activity = await listMemberActivities(context, memberId, deps);
  const response: MemberDetailResponse = {
    member: toMember(member),
    activity: activity.map(toMemberActivity),
  };
  return json(200, response);
};

const createMember = async (context: RequestContext, input: CreateMemberInput, deps: HandlerDependencies) => {
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
  await putMember(context, member, deps);
  await logMemberActivity(context, member.memberId, "Member Created", `${member.fullName} added.`, deps);
  return json(201, toMember(member));
};

const updateMember = async (
  context: RequestContext,
  memberId: string,
  input: UpdateMemberInput,
  deps: HandlerDependencies,
) => {
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
  await putMember(context, member, deps);
  await logMemberActivity(context, member.memberId, "Member Updated", `${member.fullName} updated.`, deps);
  return json(200, toMember(member));
};

const deleteMember = async (context: RequestContext, memberId: string, deps: HandlerDependencies) => {
  const member = await getMember(context, memberId, deps);
  if (!member) {
    return json(404, { message: "Member not found." });
  }

  const eventLinks = await listMemberEvents(context, memberId, deps);
  for (const link of eventLinks) {
    await deps.documentClient.send(
      new DeleteCommand({
        Key: {
          PK: tenantEventPk(context.tenantId, link.eventId),
          SK: eventMemberSk(memberId),
        },
        TableName: context.tableName,
      }),
    );

    await deps.documentClient.send(
      new DeleteCommand({
        Key: {
          PK: tenantVisitationPk(
            context.tenantId,
            eventVisitationId(link.calendarId, link.eventId),
          ),
          SK: visitationMemberSk(memberId),
        },
        TableName: context.tableName,
      }),
    );
  }

  const manualVisitations = await listMemberVisitations(context, memberId, deps);
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

  await deps.documentClient.send(
    new DeleteCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: memberSk(memberId),
      },
      TableName: context.tableName,
    }),
  );
  await logMemberActivity(context, memberId, "Member Deleted", `${member.fullName} deleted.`, deps);
  return json(200, { deleted: true, memberId });
};

const createMemberImportJob = async (context: RequestContext, input: MemberImportInput, deps: HandlerDependencies) => {
  const rows = parseImportWorkbook(input);
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

  return json(202, toMemberImportJob(jobItem));
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
  const job = await getMemberImportJob(context, jobId, deps);
  if (!job) {
    return json(404, { message: "Import job not found." });
  }

  if (job.status === "completed" || job.status === "failed") {
    return json(200, toMemberImportJob(job));
  }

  const chunks = await listMemberImportChunks(context, jobId, deps);
  const nextChunk = chunks[0];
  if (!nextChunk) {
    const completedAt = deps.now();
    const completedJob: MemberImportJobItem = {
      ...job,
      updatedAt: completedAt,
      completedAt,
      status: "completed",
      processedRows: job.totalRows,
      processedChunks: job.totalChunks,
    };
    await putImportJob(context, completedJob, deps);
    return json(200, toMemberImportJob(completedJob));
  }

  let chunkResult = { created: 0, updated: 0, skipped: 0, errors: [] as MemberImportResult["errors"] };
  for (const row of nextChunk.rows) {
    const outcome = await processImportRow(context, row, job.fileName, deps);
    chunkResult = {
      created: chunkResult.created + outcome.created,
      updated: chunkResult.updated + outcome.updated,
      skipped: chunkResult.skipped + outcome.skipped,
      errors: [...chunkResult.errors, ...outcome.errors],
    };
  }

  await deleteKeysInBatches(deps.documentClient, context.tableName, [{ PK: nextChunk.PK, SK: nextChunk.SK }]);

  const updatedAt = deps.now();
  const processedRows = Math.min(job.totalRows, job.processedRows + nextChunk.rowCount);
  const processedChunks = Math.min(job.totalChunks, job.processedChunks + 1);
  const result: MemberImportResult = {
    created: job.result.created + chunkResult.created,
    updated: job.result.updated + chunkResult.updated,
    skipped: job.result.skipped + chunkResult.skipped,
    errorCount: job.result.errorCount + chunkResult.errors.length,
    errors: mergeImportErrors(job.result.errors, chunkResult.errors),
  };
  const status: MemberImportJobStatus = processedChunks >= job.totalChunks ? "completed" : "running";
  const nextJob: MemberImportJobItem = {
    ...job,
    updatedAt,
    startedAt: job.startedAt ?? updatedAt,
    completedAt: status === "completed" ? updatedAt : undefined,
    processedRows,
    processedChunks,
    status,
    result,
  };
  await putImportJob(context, nextJob, deps);

  return json(200, toMemberImportJob(nextJob));
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
    listMembers(context, deps),
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
      lastVisitType: undefined,
    };
    current.totalLifetimeVisits += 1;
    if (!current.lastVisitDate || visitation.visitDate > current.lastVisitDate) {
      current.lastVisitDate = visitation.visitDate;
      current.lastVisitedBy = visitation.visitorDisplayName;
      current.lastVisitType = normalizeVisitationType(visitation.type);
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
          lastVisitType: everyoneLifetime?.lastVisitType,
        },
        me: {
          visitCountInRange: currentUserRangeCount,
          totalLifetimeVisits: currentUserLifetime?.totalLifetimeVisits ?? 0,
          lastVisitDate: currentUserLifetime?.lastVisitDate,
          lastVisitedBy: currentUserLifetime?.lastVisitedBy,
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

  allRows.sort((left, right) => {
    const direction = filters.sortDirection === "asc" ? 1 : -1;
    if (filters.sortBy === "member_name") {
      return left.memberFullName.localeCompare(right.memberFullName) * direction;
    }

    if (filters.sortBy === "visit_count") {
      return (left.visitCountInRange - right.visitCountInRange) * direction;
    }

    const leftValue = left.lastVisitDate ?? "";
    const rightValue = right.lastVisitDate ?? "";
    return leftValue.localeCompare(rightValue) * direction;
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
    totalMembers: filteredMembers.length,
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
  const nextRange = normalizeInitialSyncRange(input.initialSyncRange, now);
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

    const nextRange = normalizeInitialSyncRange(calendarInput.initialSyncRange, now);
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
      calendarListRefreshThresholdMinutes: normalizeRefreshInterval(
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
    ...(memberIds.length
      ? {
        extendedProperties: {
          private: {
            memberIds: serializeGoogleMemberIds(memberIds),
          },
        },
      }
      : {}),
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

  const response = await googleFetch(
    context,
    connection,
    GOOGLE_CALENDAR_EVENTS_URL(input.calendarId),
    deps,
    {
      method: "POST",
      body: JSON.stringify(buildGoogleEventBody(input)),
    },
  );

  const created = (await response.json()) as GoogleEventPayload;

  const stored = await upsertGoogleEventIntoCache(context, calendar, created, "GOOGLE", undefined, deps);
  const updatedStored = await persistEventWithMemberAssignments(context, {
    ...stored,
    memberIds: input.memberIds ?? [],
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
    type: input.type ?? existing.visitationType,
  };

  if (new Date(nextEvent.end).getTime() <= new Date(nextEvent.start).getTime()) {
    return json(400, { message: "End time must be after start time." });
  }

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

  const stored = await upsertGoogleEventIntoCache(context, calendar, updated, "GOOGLE", undefined, deps);
  const updatedStored = await persistEventWithMemberAssignments(context, {
    ...stored,
    memberIds: nextEvent.memberIds ?? [],
    visitationType: nextEvent.type,
  }, deps);
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

      const context = getContext(typedEvent);
      const calendarId = typedEvent.pathParameters?.calendarId;
      const eventId = typedEvent.pathParameters?.eventId;
      const username = typedEvent.pathParameters?.username;
      const resetAction = typedEvent.pathParameters?.action;

      if (method === "GET" && path === "/members") {
        return await getMembers(context, deps);
      }

      if (method === "GET" && path === "/members/index") {
        return await getMembersIndex(context, deps);
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

      if (path === `/members/${memberId}/events` && memberId && method === "GET") {
        return await getMemberEventsResponse(context, memberId, deps);
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

      if (method === "GET" && path === "/reports/visitations") {
        return await getVisitationReport(context, typedEvent, deps);
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
