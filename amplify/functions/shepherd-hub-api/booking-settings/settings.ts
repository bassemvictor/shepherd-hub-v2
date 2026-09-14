import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type {
  AppointmentTypeDateOverride,
  AppCognitoGroup,
  BookingTimeRange,
  GlobalDateOverride,
  PublicAppointmentType,
  PublicBookingProfile,
  PublicBookingPage,
  SaveBookingSettingsInput,
  WeeklyBookingAvailability,
} from "../../../../shared/types.js";

type Context = {
  actorGroups: AppCognitoGroup[];
  actorSub: string;
  tableName: string;
  tenantId: string;
};

type Dependencies = {
  documentClient: Pick<DynamoDBDocumentClient, "send">;
  now: () => string;
  uuid: () => string;
};

type CalendarItem = {
  PK: string;
  SK: string;
  tenantId: string;
  calendarId: string;
  accessRole?: string;
};

type GoogleConnectionItem = { tenantId: string; status: "connected" | "error" | "expired" };

type BookingProfileItem = PublicBookingProfile & {
  PK: string;
  SK: string;
  entityType: "BOOKING_PROFILE";
};

type BookingSlugItem = {
  profileId: string;
  tenantId: string;
  ownerUserId: string;
};

export class BookingSettingsError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "BookingSettingsError";
  }
}

const userPk = (userId: string) => `USER#${userId}`;
const profileSk = () => "BOOKING_PROFILE";
const slugPk = (slug: string) => `BOOKING_SLUG#${slug}`;
const slugSk = () => "PROFILE";
const calendarSk = (calendarId: string) => `CALENDAR#${calendarId}`;
const googleConnectionSk = () => "GOOGLE_CONNECTION";
const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const timePattern = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const response = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const normalizeSlug = (value: unknown) => String(value ?? "").trim().toLowerCase();
const isWriteableCalendar = (calendar: CalendarItem) => calendar.accessRole === "owner" || calendar.accessRole === "writer";
const minuteOfDay = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const validateTimezone = (timezone: unknown): string => {
  const value = String(timezone ?? "").trim();
  try {
    if (!value) throw new RangeError();
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new BookingSettingsError(400, "timezone must be a valid IANA timezone identifier.");
  }
  return value;
};

const validateRange = (range: unknown, label: string): BookingTimeRange => {
  const value = range as Partial<BookingTimeRange>;
  if (!value || typeof value !== "object" || !timePattern.test(String(value.start)) || !timePattern.test(String(value.end))) {
    throw new BookingSettingsError(400, `${label} must use 15-minute HH:mm times.`);
  }
  const normalized = { start: String(value.start), end: String(value.end) };
  if (minuteOfDay(normalized.start) >= minuteOfDay(normalized.end)) {
    throw new BookingSettingsError(400, `${label} must start before it ends; overnight ranges are not supported.`);
  }
  return normalized;
};

const validateRanges = (ranges: unknown, label: string): BookingTimeRange[] => {
  if (!Array.isArray(ranges) || !ranges.length) throw new BookingSettingsError(400, `${label} requires at least one range.`);
  const normalized = ranges.map((range) => validateRange(range, label)).sort((a, b) => minuteOfDay(a.start) - minuteOfDay(b.start));
  for (let index = 1; index < normalized.length; index += 1) {
    if (minuteOfDay(normalized[index].start) < minuteOfDay(normalized[index - 1].end)) {
      throw new BookingSettingsError(400, `${label} ranges must not overlap.`);
    }
  }
  return normalized;
};

const validateWeeklyAvailability = (value: unknown): WeeklyBookingAvailability => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BookingSettingsError(400, "weeklyAvailability is required.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((day) => !days.includes(day as typeof days[number]))) {
    throw new BookingSettingsError(400, "weeklyAvailability contains an invalid day.");
  }
  return Object.fromEntries(days.flatMap((day) => input[day] === undefined ? [] : [[day, validateRanges(input[day], `${day} availability`)]])) as WeeklyBookingAvailability;
};

const validateDate = (date: unknown, label: string) => {
  const value = String(date ?? "");
  if (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BookingSettingsError(400, `${label} must be an ISO calendar date.`);
  }
  return value;
};

const validateGlobalOverrides = (value: unknown): GlobalDateOverride[] => {
  if (!Array.isArray(value)) throw new BookingSettingsError(400, "globalDateOverrides must be an array.");
  const seen = new Set<string>();
  return value.map((entry) => {
    const override = entry as Partial<GlobalDateOverride>;
    const date = validateDate(override?.date, "Global override date");
    if (override?.unavailable !== true || seen.has(date)) throw new BookingSettingsError(400, "Global overrides must be unique unavailable dates.");
    seen.add(date);
    return { date, unavailable: true as const };
  }).sort((a, b) => a.date.localeCompare(b.date));
};

const validateDateOverrides = (value: unknown): AppointmentTypeDateOverride[] => {
  if (!Array.isArray(value)) throw new BookingSettingsError(400, "dateOverrides must be an array.");
  const seen = new Set<string>();
  return value.map((entry) => {
    const override = entry as { date?: unknown; unavailable?: unknown; ranges?: unknown };
    const date = validateDate(override?.date, "Date override date");
    if (seen.has(date)) throw new BookingSettingsError(400, "Date overrides must be unique per appointment type.");
    seen.add(date);
    if (override.unavailable === true && override.ranges === undefined) return { date, unavailable: true as const };
    if (override.unavailable !== true && override.ranges !== undefined) return { date, ranges: validateRanges(override.ranges, "Date override") };
    throw new BookingSettingsError(400, "A date override must be unavailable or provide replacement ranges.");
  }).sort((a, b) => a.date.localeCompare(b.date));
};

const validateAppointmentTypes = (value: unknown): PublicAppointmentType[] => {
  if (!Array.isArray(value)) throw new BookingSettingsError(400, "appointmentTypes must be an array.");
  const ids = new Set<string>();
  return value.map((entry) => {
    const input = entry as Partial<PublicAppointmentType>;
    const id = String(input?.id ?? "").trim();
    const name = String(input?.name ?? "").trim();
    if (!id || !name || ids.has(id)) throw new BookingSettingsError(400, "Appointment types require unique ids and names.");
    ids.add(id);
    if (!Array.isArray(input.allowedDurationsMinutes) || !input.allowedDurationsMinutes.length) throw new BookingSettingsError(400, "At least one allowed duration is required.");
    const allowedDurationsMinutes = [...new Set(input.allowedDurationsMinutes)].sort((a, b) => a - b);
    if (allowedDurationsMinutes.some((duration) => !Number.isInteger(duration) || duration < 15 || duration > 240 || duration % 15 !== 0)) {
      throw new BookingSettingsError(400, "Allowed durations must be 15-240 minute multiples of 15.");
    }
    if (!allowedDurationsMinutes.includes(input.defaultDurationMinutes as number)) throw new BookingSettingsError(400, "defaultDurationMinutes must be one of the allowed durations.");
    return {
      id, name,
      ...(String(input.description ?? "").trim() ? { description: String(input.description).trim() } : {}),
      enabled: input.enabled !== false,
      ...(String(input.publicLocation ?? "").trim() ? { publicLocation: String(input.publicLocation).trim() } : {}),
      allowedDurationsMinutes,
      defaultDurationMinutes: input.defaultDurationMinutes as number,
      weeklyAvailability: validateWeeklyAvailability(input.weeklyAvailability),
      dateOverrides: validateDateOverrides(input.dateOverrides ?? []),
    };
  });
};

const getCalendar = async (context: Context, calendarId: string, deps: Dependencies) => {
  const result = await deps.documentClient.send(new GetCommand({
    TableName: context.tableName, Key: { PK: userPk(context.actorSub), SK: calendarSk(calendarId) },
  }));
  const calendar = result.Item as CalendarItem | undefined;
  return calendar?.tenantId === context.tenantId ? calendar : undefined;
};

const validateCalendars = async (context: Context, input: SaveBookingSettingsInput, deps: Dependencies) => {
  const bookingCalendarId = String(input.bookingCalendarId ?? "").trim() || undefined;
  const conflictCalendarIds = [...new Set(Array.isArray(input.conflictCalendarIds) ? input.conflictCalendarIds.map((id) => String(id).trim()).filter(Boolean) : [])];
  if (!Array.isArray(input.conflictCalendarIds)) throw new BookingSettingsError(400, "conflictCalendarIds must be an array.");
  if (bookingCalendarId || conflictCalendarIds.length) {
    const result = await deps.documentClient.send(new GetCommand({
      TableName: context.tableName, Key: { PK: userPk(context.actorSub), SK: googleConnectionSk() },
    }));
    const connection = result.Item as GoogleConnectionItem | undefined;
    if (connection?.tenantId !== context.tenantId || connection.status !== "connected") {
      throw new BookingSettingsError(400, "Connect Google Calendar before selecting booking calendars.");
    }
  }
  for (const id of [...conflictCalendarIds, ...(bookingCalendarId ? [bookingCalendarId] : [])]) {
    const calendar = await getCalendar(context, id, deps);
    if (!calendar) throw new BookingSettingsError(400, "A selected Google calendar is not accessible through your connection.");
    if (id === bookingCalendarId && !isWriteableCalendar(calendar)) throw new BookingSettingsError(400, "bookingCalendarId requires Google owner or writer permission.");
  }
  return { bookingCalendarId, conflictCalendarIds };
};

const normalizeInput = async (context: Context, input: SaveBookingSettingsInput, deps: Dependencies) => {
  const slug = normalizeSlug(input.slug);
  if (!/^[a-z0-9-]{3,64}$/.test(slug)) throw new BookingSettingsError(400, "slug must be 3-64 lowercase letters, digits, or hyphens.");
  const displayName = String(input.displayName ?? "").trim();
  if (!displayName) throw new BookingSettingsError(400, "displayName is required.");
  if (input.startIntervalMinutes !== 15 && input.startIntervalMinutes !== 30) throw new BookingSettingsError(400, "startIntervalMinutes must be 15 or 30.");
  const minimumNoticeMinutes = Number(input.minimumNoticeMinutes);
  const maximumBookingDays = Number(input.maximumBookingDays);
  if (!Number.isInteger(minimumNoticeMinutes) || minimumNoticeMinutes < 0 || !Number.isInteger(maximumBookingDays) || maximumBookingDays < 1) {
    throw new BookingSettingsError(400, "minimumNoticeMinutes must be non-negative and maximumBookingDays must be at least 1.");
  }
  const calendars = await validateCalendars(context, input, deps);
  const appointmentTypes = validateAppointmentTypes(input.appointmentTypes ?? []);
  const enabled = input.enabled !== false;
  if (enabled) {
    if (!calendars.bookingCalendarId) throw new BookingSettingsError(400, "Select a booking calendar before enabling public booking.");
    const enabledTypes = appointmentTypes.filter((type) => type.enabled);
    if (!enabledTypes.length) throw new BookingSettingsError(400, "Enable at least one appointment type before enabling public booking.");
    if (!enabledTypes.some((type) => Object.values(type.weeklyAvailability).some((ranges) => ranges.length))) {
      throw new BookingSettingsError(400, "At least one enabled appointment type needs weekly availability before enabling public booking.");
    }
  }
  return {
    enabled, slug, displayName,
    ...(String(input.introduction ?? "").trim() ? { introduction: String(input.introduction).trim() } : {}),
    timezone: validateTimezone(input.timezone), startIntervalMinutes: input.startIntervalMinutes,
    ...calendars, minimumNoticeMinutes, maximumBookingDays,
    globalDateOverrides: validateGlobalOverrides(input.globalDateOverrides ?? []),
    appointmentTypes,
  };
};

const getProfile = async (context: Context, deps: Dependencies) => {
  const result = await deps.documentClient.send(new GetCommand({
    TableName: context.tableName, Key: { PK: userPk(context.actorSub), SK: profileSk() },
  }));
  const profile = result.Item as BookingProfileItem | undefined;
  return profile?.tenantId === context.tenantId && profile.ownerUserId === context.actorSub ? profile : undefined;
};

const requirePriest = (context: Context) => {
  if (!context.actorGroups.includes("priest")) throw new BookingSettingsError(403, "Priest access is required.");
};

export const getBookingSettings = async (context: Context, deps: Dependencies) => {
  requirePriest(context);
  return response(200, { profile: (await getProfile(context, deps)) ?? null });
};

export const getPublicBookingPage = async (
  rawSlug: string | undefined,
  tableName: string,
  deps: Dependencies,
): Promise<PublicBookingPage | null> => {
  const slug = normalizeSlug(rawSlug);
  if (!tableName || !/^[a-z0-9-]{3,64}$/.test(slug)) return null;
  const lookupResult = await deps.documentClient.send(new GetCommand({
    TableName: tableName, Key: { PK: slugPk(slug), SK: slugSk() },
  }));
  const lookup = lookupResult.Item as BookingSlugItem | undefined;
  if (!lookup?.profileId || !lookup.ownerUserId || !lookup.tenantId) return null;
  const profileResult = await deps.documentClient.send(new GetCommand({
    TableName: tableName, Key: { PK: userPk(lookup.ownerUserId), SK: profileSk() },
  }));
  const profile = profileResult.Item as BookingProfileItem | undefined;
  if (!profile || !profile.enabled || profile.profileId !== lookup.profileId || profile.slug !== slug ||
    profile.ownerUserId !== lookup.ownerUserId || profile.tenantId !== lookup.tenantId) return null;
  return {
    slug: profile.slug,
    displayName: profile.displayName,
    ...(profile.introduction ? { introduction: profile.introduction } : {}),
    timezone: profile.timezone,
    startIntervalMinutes: profile.startIntervalMinutes,
    appointmentTypes: profile.appointmentTypes.filter((type) => type.enabled).map((type) => ({
      id: type.id,
      name: type.name,
      ...(type.description ? { description: type.description } : {}),
      ...(type.publicLocation ? { publicLocation: type.publicLocation } : {}),
      allowedDurationsMinutes: type.allowedDurationsMinutes,
      defaultDurationMinutes: type.defaultDurationMinutes,
    })),
  };
};

export const saveBookingSettings = async (context: Context, input: SaveBookingSettingsInput, deps: Dependencies) => {
  requirePriest(context);
  const existing = await getProfile(context, deps);
  const now = deps.now();
  const normalized = await normalizeInput(context, input, deps);
  const profile: BookingProfileItem = {
    PK: userPk(context.actorSub), SK: profileSk(), entityType: "BOOKING_PROFILE",
    profileId: existing?.profileId ?? deps.uuid(), tenantId: context.tenantId, ownerUserId: context.actorSub,
    createdAt: existing?.createdAt ?? now, updatedAt: now, ...normalized,
  };
  const slugItem = { PK: slugPk(profile.slug), SK: slugSk(), entityType: "BOOKING_SLUG", profileId: profile.profileId, tenantId: context.tenantId, ownerUserId: context.actorSub, createdAt: existing?.createdAt ?? now, updatedAt: now };
  const transaction: Array<Record<string, unknown>> = [];
  if (!existing) {
    transaction.push({ Put: { TableName: context.tableName, Item: profile, ConditionExpression: "attribute_not_exists(PK)" } });
    transaction.push({ Put: { TableName: context.tableName, Item: slugItem, ConditionExpression: "attribute_not_exists(PK)" } });
  } else if (existing.slug !== profile.slug) {
    transaction.push({ Delete: { TableName: context.tableName, Key: { PK: slugPk(existing.slug), SK: slugSk() }, ConditionExpression: "profileId = :profileId", ExpressionAttributeValues: { ":profileId": existing.profileId } } });
    transaction.push({ Put: { TableName: context.tableName, Item: slugItem, ConditionExpression: "attribute_not_exists(PK)" } });
    transaction.push({ Put: { TableName: context.tableName, Item: profile, ConditionExpression: "attribute_exists(PK)" } });
  } else {
    transaction.push({ Put: { TableName: context.tableName, Item: profile, ConditionExpression: "attribute_exists(PK)" } });
  }
  try {
    await deps.documentClient.send(new TransactWriteCommand({ TransactItems: transaction }));
  } catch (error) {
    if (error instanceof Error && (error.name === "TransactionCanceledException" || error.name === "ConditionalCheckFailedException")) {
      throw new BookingSettingsError(409, "This booking slug is already in use.");
    }
    throw error;
  }
  return response(existing ? 200 : 201, { profile });
};
