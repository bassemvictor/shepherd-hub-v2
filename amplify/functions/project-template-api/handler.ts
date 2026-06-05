import { randomBytes, randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyHandlerV2 } from "aws-lambda";

import type {
  AppCognitoGroup,
  CalendarSyncConfig,
  CalendarSyncSnapshot,
  ConnectGoogleResponse,
  CreateScheduleEventInput,
  DashboardSummary,
  GoogleConnectionStatus,
  GoogleConnectionSummary,
  InitialSyncRange,
  RecordStatus,
  SaveScheduleSettingsInput,
  SampleRecord,
  SampleRecordInput,
  ScheduleCalendar,
  ScheduleEvent,
  ScheduleEventsResponse,
  ScheduleOverviewResponse,
  ScheduleSettings,
  SyncSource,
  SyncStatus,
  UpdateScheduleEventInput,
  UpdateCalendarSettingsInput,
} from "../../../shared/types.js";

type BaseItem = {
  PK: string;
  SK: string;
  entityType: string;
  createdAt: string;
  updatedAt: string;
  GSI1PK?: string;
  GSI1SK?: string;
};

type StoredEntity = BaseItem & {
  tenantId: string;
  recordId: string;
  name: string;
  status: RecordStatus;
  owner: string;
};

type GoogleConnectionItem = BaseItem & {
  userId: string;
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
  calendarId: string;
  eventId: string;
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

type OAuthStateItem = BaseItem & {
  state: string;
  userId: string;
  tenantId: string;
  actorEmail: string;
  expiresAt: string;
};

type ScheduleSettingsItem = BaseItem & {
  userId: string;
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

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

const defaultDependencies: HandlerDependencies = {
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
  "sales_engineer",
  "sales_manager",
  "pricing_engineer",
  "admin",
  "super_user",
];

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
];

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_CALENDAR_EVENTS_URL = (calendarId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GSI1_NAME = "GSI1";

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

const normalizeGroups = (rawGroups: unknown): AppCognitoGroup[] => {
  if (!Array.isArray(rawGroups)) {
    return [];
  }

  return rawGroups
    .map((group) => String(group))
    .filter((group): group is AppCognitoGroup => allGroups.includes(group as AppCognitoGroup));
};

const getContext = (event: APIGatewayProxyEventV2WithJWTAuthorizer): RequestContext => {
  const claims = event.requestContext.authorizer?.jwt.claims ?? {};
  const tableName = process.env.PROJECT_TEMPLATE_TABLE ?? "";

  if (!tableName) {
    throw new Error("Missing PROJECT_TEMPLATE_TABLE environment variable.");
  }

  const actorSub = typeof claims.sub === "string" ? claims.sub : "anonymous";
  const actorEmail = typeof claims.email === "string" ? claims.email : "unknown@example.com";
  const actorName = typeof claims.name === "string" ? claims.name : actorEmail;
  const tenantId =
    (typeof claims["custom:tenantId"] === "string" && claims["custom:tenantId"].trim()) ||
    (typeof claims["custom:tenant_id"] === "string" && claims["custom:tenant_id"].trim()) ||
    actorSub;

  const rawGroups = claims["cognito:groups"];
  const actorGroups =
    typeof rawGroups === "string" ? normalizeGroups([rawGroups]) : normalizeGroups(rawGroups);

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
const recordSk = (recordId: string) => `RECORD#${recordId}`;
const userPk = (userId: string) => `USER#${userId}`;
const googleConnectionSk = () => "GOOGLE_CONNECTION";
const calendarSk = (calendarId: string) => `CALENDAR#${calendarId}`;
const eventSk = (calendarId: string, eventId: string) => `EVENT#${calendarId}#${eventId}`;
const eventGsiPk = (userId: string, calendarId: string) => `USER#${userId}#CALENDAR#${calendarId}`;
const eventGsiSk = (start: string, eventId: string) => `EVENT#${start}#${eventId}`;
const oauthStatePk = (state: string) => `OAUTH_STATE#${state}`;
const oauthStateSk = (state: string) => `OAUTH_STATE#${state}`;
const scheduleSettingsSk = () => "SCHEDULE_SETTINGS";

const defaultCalendarListRefreshThresholdMinutes = 30;

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

const toRecord = (item: StoredEntity): SampleRecord => ({
  createdAt: item.createdAt,
  entityType: item.entityType,
  name: item.name,
  owner: item.owner,
  recordId: item.recordId,
  status: item.status,
  tenantId: item.tenantId,
  updatedAt: item.updatedAt,
});

const toConnectionSummary = (item: GoogleConnectionItem): GoogleConnectionSummary => ({
  googleAccountId: item.googleAccountId,
  email: item.email,
  scopes: item.scopes,
  status: item.status,
  connectedAt: item.connectedAt,
  lastTokenRefreshAt: item.lastTokenRefreshAt,
  tokenExpiresAt: item.tokenExpiresAt,
});

const toScheduleSettings = (item?: ScheduleSettingsItem | null): ScheduleSettings => ({
  calendarListRefreshThresholdMinutes:
    item?.calendarListRefreshThresholdMinutes ?? defaultCalendarListRefreshThresholdMinutes,
});

const toScheduleCalendar = (item: CalendarItem): ScheduleCalendar => ({
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
  tenantId: item.userId,
  updatedAt: item.updatedAt,
});

const toScheduleEvent = (item: EventItem): ScheduleEvent => ({
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
  htmlLink: item.htmlLink,
  location: item.location,
  source: item.source,
  start: item.start,
  status: item.status,
  summary: item.summary,
  tenantId: item.userId,
  updatedAt: item.updatedAt,
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

const validateRecordInput = (input: Partial<SampleRecordInput>) => {
  const name = String(input.name ?? "").trim();
  const owner = String(input.owner ?? "").trim();
  const status = String(input.status ?? "").trim() as RecordStatus;
  const allowedStatuses: RecordStatus[] = ["draft", "active", "archived"];

  if (!name) {
    return "Name is required.";
  }

  if (!owner) {
    return "Owner is required.";
  }

  if (!allowedStatuses.includes(status)) {
    return "Status must be draft, active, or archived.";
  }

  return null;
};

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

  return (response.Item as GoogleConnectionItem | undefined) ?? null;
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

  return (response.Item as ScheduleSettingsItem | undefined) ?? null;
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

  return (items as CalendarItem[]).sort((left, right) => {
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

  return (response.Item as CalendarItem | undefined) ?? null;
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

  return (response.Item as EventItem | undefined) ?? null;
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

  return (items as EventItem[]).filter((item) => item.end >= timeMin && item.start <= timeMax);
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

  return items as EventItem[];
};

const putEvent = async (context: RequestContext, event: EventItem, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new PutCommand({
      Item: event,
      TableName: context.tableName,
    }),
  );
};

const deleteEvent = async (context: RequestContext, calendarId: string, eventId: string, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new DeleteCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: eventSk(calendarId, eventId),
      },
      TableName: context.tableName,
    }),
  );
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
      syncMode: entry.primary ? "ALWAYS_GOOGLE" : "CACHE_UNTIL_STALE",
      refreshIntervalMinutes: entry.primary ? 15 : 60 * 24,
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
  googleEvent: {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    attendees?: Array<{ email?: string }>;
    status?: string;
    htmlLink?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
  },
  source: SyncSource,
  deps: HandlerDependencies,
) => {
  const now = deps.now();
  const start = googleEvent.start?.dateTime ?? `${googleEvent.start?.date ?? now}T00:00:00.000Z`;
  const end = googleEvent.end?.dateTime ?? `${googleEvent.end?.date ?? now}T23:59:59.999Z`;
  const item: EventItem = {
    PK: userPk(context.actorSub),
    SK: eventSk(calendar.calendarId, googleEvent.id),
    GSI1PK: eventGsiPk(context.actorSub, calendar.calendarId),
    GSI1SK: eventGsiSk(start, googleEvent.id),
    createdAt: now,
    updatedAt: now,
    entityType: "schedule_event",
    userId: context.actorSub,
    calendarId: calendar.calendarId,
    eventId: googleEvent.id,
    calendarName: calendar.summary,
    calendarColor: calendar.backgroundColor,
    summary: googleEvent.summary ?? "(Untitled event)",
    description: googleEvent.description,
    location: googleEvent.location,
    attendees: normalizeAttendees((googleEvent.attendees ?? []).map((entry) => entry.email ?? "")),
    start,
    end,
    allDay: !googleEvent.start?.dateTime,
    status: googleEvent.status ?? "confirmed",
    source,
    htmlLink: googleEvent.htmlLink,
  };

  const existing = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: eventSk(calendar.calendarId, googleEvent.id),
      },
      TableName: context.tableName,
    }),
  );

  const existingItem = existing.Item as EventItem | undefined;
  await putEvent(
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
  for (const event of allExisting) {
    await deleteEvent(context, calendar.calendarId, event.eventId, deps);
  }

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
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        location?: string;
        attendees?: Array<{ email?: string }>;
        status?: string;
        htmlLink?: string;
        start?: { date?: string; dateTime?: string };
        end?: { date?: string; dateTime?: string };
      }>;
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    for (const event of payload.items ?? []) {
      if (event.status === "cancelled") {
        continue;
      }

      await upsertGoogleEventIntoCache(context, calendar, event, "GOOGLE", deps);
    }

    pageToken = payload.nextPageToken ?? "";
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

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
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        location?: string;
        attendees?: Array<{ email?: string }>;
        status?: string;
        htmlLink?: string;
        start?: { date?: string; dateTime?: string };
        end?: { date?: string; dateTime?: string };
      }>;
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    for (const event of payload.items ?? []) {
      if (event.status === "cancelled") {
        await deleteEvent(context, calendar.calendarId, event.id, deps);
      } else {
        await upsertGoogleEventIntoCache(context, calendar, event, "GOOGLE", deps);
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
    return {
      calendar: updatedCalendar,
      events: result.cachedEvents,
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
      return refreshCalendarEvents(context, resetCalendar, connection, deps);
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
    const refreshNeeded = shouldRefreshCalendar(calendar, options.forceSync);
    if (refreshNeeded) {
      if (!connection) {
        throw new Error("Connect Google Calendar before running a sync.");
      }

      const refreshed = await refreshCalendarEvents(context, calendar, connection, deps);
      const filtered = refreshed.events.filter(
        (event) => event.start <= options.timeMax && event.end >= options.timeMin,
      );
      results.push({
        ...refreshed,
        events: filtered,
      });
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

const listRecords = async (context: RequestContext, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new QueryCommand({
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":pk": tenantPk(context.tenantId),
        ":recordPrefix": "RECORD#",
      },
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :recordPrefix)",
      TableName: context.tableName,
    }),
  );

  const items = (response.Items ?? []) as StoredEntity[];
  const sortedItems = items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return json(200, { items: sortedItems.map(toRecord) });
};

const getRecord = async (context: RequestContext, recordId: string, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: recordSk(recordId),
      },
      TableName: context.tableName,
    }),
  );

  const item = response.Item as StoredEntity | undefined;

  if (!item) {
    return json(404, { message: "Record not found." });
  }

  return json(200, toRecord(item));
};

const createRecord = async (
  context: RequestContext,
  input: SampleRecordInput,
  deps: HandlerDependencies,
) => {
  const validationError = validateRecordInput(input);

  if (validationError) {
    return json(400, { message: validationError });
  }

  const timestamp = deps.now();
  const recordId = deps.uuid();
  const item: StoredEntity = {
    PK: tenantPk(context.tenantId),
    SK: recordSk(recordId),
    createdAt: timestamp,
    entityType: "record",
    name: input.name.trim(),
    owner: input.owner.trim(),
    recordId,
    status: input.status,
    tenantId: context.tenantId,
    updatedAt: timestamp,
  };

  await deps.documentClient.send(
    new PutCommand({
      Item: item,
      TableName: context.tableName,
    }),
  );

  return json(201, toRecord(item));
};

const updateRecord = async (
  context: RequestContext,
  recordId: string,
  input: SampleRecordInput,
  deps: HandlerDependencies,
) => {
  const existingResponse = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: recordSk(recordId),
      },
      TableName: context.tableName,
    }),
  );

  const existing = existingResponse.Item as StoredEntity | undefined;

  if (!existing) {
    return json(404, { message: "Record not found." });
  }

  const validationError = validateRecordInput(input);

  if (validationError) {
    return json(400, { message: validationError });
  }

  const updated: StoredEntity = {
    ...existing,
    name: input.name.trim(),
    owner: input.owner.trim(),
    status: input.status,
    updatedAt: deps.now(),
  };

  await deps.documentClient.send(
    new PutCommand({
      Item: updated,
      TableName: context.tableName,
    }),
  );

  return json(200, toRecord(updated));
};

const deleteRecord = async (context: RequestContext, recordId: string, deps: HandlerDependencies) => {
  await deps.documentClient.send(
    new DeleteCommand({
      Key: {
        PK: tenantPk(context.tenantId),
        SK: recordSk(recordId),
      },
      TableName: context.tableName,
    }),
  );

  return json(200, { deleted: true, recordId });
};

const getDashboardSummary = async (context: RequestContext, deps: HandlerDependencies) => {
  const response = await deps.documentClient.send(
    new QueryCommand({
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":pk": tenantPk(context.tenantId),
        ":recordPrefix": "RECORD#",
      },
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :recordPrefix)",
      TableName: context.tableName,
    }),
  );

  const items = (response.Items ?? []) as StoredEntity[];
  const summary: DashboardSummary = {
    activeRecords: items.filter((item) => item.status === "active").length,
    archivedRecords: items.filter((item) => item.status === "archived").length,
    draftRecords: items.filter((item) => item.status === "draft").length,
    tenantId: context.tenantId,
    totalRecords: items.length,
  };

  return json(200, summary);
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
    prompt: "consent",
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

  const tableName = process.env.PROJECT_TEMPLATE_TABLE ?? "";
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
    googleAccountId: profile.sub ?? profile.email ?? "google-account",
    email: profile.email ?? stateItem.actorEmail,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? existing?.refreshToken,
    tokenExpiresAt: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : existing?.tokenExpiresAt,
    scopes: tokens.scope ? tokens.scope.split(" ") : GOOGLE_SCOPES,
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
      forceSync,
    }),
  );
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
      await deleteEvent(context, calendar.calendarId, event.eventId, deps);
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
    await deleteEvent(context, calendar.calendarId, event.eventId, deps);
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
  input: Pick<CreateScheduleEventInput, "summary" | "description" | "location" | "attendees" | "start" | "end" | "allDay">,
) => {
  const base = {
    summary: input.summary.trim(),
    description: input.description?.trim(),
    location: input.location?.trim(),
    attendees: normalizeAttendees(input.attendees).map((email) => ({ email })),
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

  const created = (await response.json()) as {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    attendees?: Array<{ email?: string }>;
    status?: string;
    htmlLink?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
  };

  await upsertGoogleEventIntoCache(context, calendar, created, "GOOGLE", deps);

  const storedResponse = await deps.documentClient.send(
    new GetCommand({
      Key: {
        PK: userPk(context.actorSub),
        SK: eventSk(calendar.calendarId, created.id),
      },
      TableName: context.tableName,
    }),
  );

  return json(201, toScheduleEvent(storedResponse.Item as EventItem));
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

  const updated = (await response.json()) as {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    attendees?: Array<{ email?: string }>;
    status?: string;
    htmlLink?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
  };

  await upsertGoogleEventIntoCache(context, calendar, updated, "GOOGLE", deps);
  const stored = await getEvent(context, input.calendarId, eventId, deps);
  return json(200, toScheduleEvent(stored as EventItem));
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

  await deleteEvent(context, calendarId, eventId, deps);
  return json(200, { deleted: true, eventId, calendarId });
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
      const recordId = typedEvent.pathParameters?.recordId;
      const calendarId = typedEvent.pathParameters?.calendarId;
      const eventId = typedEvent.pathParameters?.eventId;

      if (method === "GET" && path === "/dashboard/summary") {
        return await getDashboardSummary(context, deps);
      }

      if (method === "GET" && path === "/records") {
        return await listRecords(context, deps);
      }

      if (method === "POST" && path === "/records") {
        return await createRecord(context, parseBody<SampleRecordInput>(typedEvent.body), deps);
      }

      if (path === `/records/${recordId}` && recordId) {
        if (method === "GET") {
          return await getRecord(context, recordId, deps);
        }

        if (method === "PUT") {
          return await updateRecord(context, recordId, parseBody<SampleRecordInput>(typedEvent.body), deps);
        }

        if (method === "DELETE") {
          return await deleteRecord(context, recordId, deps);
        }
      }

      if (method === "GET" && path === "/schedule/overview") {
        return await getScheduleOverview(context, deps);
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

      return json(404, { message: "Route not found." });
    } catch (error) {
      return json(500, {
        message: error instanceof Error ? error.message : "Unexpected server error.",
      });
    }
  };
};

export const handler = createHandler();
