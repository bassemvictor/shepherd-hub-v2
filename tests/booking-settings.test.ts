import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { createHandler } from "../amplify/functions/shepherd-hub-api/handler.js";

const key = (item: { PK: string; SK: string }) => `${item.PK}|${item.SK}`;
const calendar = (id: string, accessRole = "owner", user = "priest-1") => ({
  PK: `USER#${user}`, SK: `CALENDAR#${id}`, tenantId: "tenant-1", calendarId: id, accessRole,
});
const connection = (user = "priest-1") => ({ PK: `USER#${user}`, SK: "GOOGLE_CONNECTION", tenantId: "tenant-1", status: "connected" });

const memoryClient = (seed: Array<Record<string, unknown>> = []) => {
  const items = new Map(seed.map((item) => [key(item as { PK: string; SK: string }), item]));
  return {
    items,
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (command.constructor.name === "GetCommand") return { Item: items.get(key(command.input.Key as { PK: string; SK: string })) };
      if (command.constructor.name !== "TransactWriteCommand") return {};
      const writes = command.input.TransactItems as Array<{
        Put?: { Item: Record<string, unknown>; ConditionExpression?: string };
        Delete?: { Key: { PK: string; SK: string } };
      }>;
      for (const write of writes) {
        const put = write.Put;
        if (put?.ConditionExpression === "attribute_not_exists(PK)" && items.has(key(put.Item as { PK: string; SK: string }))) {
          const error = new Error("duplicate"); error.name = "TransactionCanceledException"; throw error;
        }
      }
      for (const write of writes) {
        if (write.Put) items.set(key(write.Put.Item as { PK: string; SK: string }), { ...write.Put.Item });
        if (write.Delete) items.delete(key(write.Delete.Key));
      }
      return {};
    },
  };
};

const event = (body: unknown, groups: string[] = ["priest"], user = "priest-1") => ({
  body: JSON.stringify(body), rawPath: "/booking-settings", pathParameters: undefined,
  requestContext: { authorizer: { jwt: { claims: { sub: user, email: `${user}@example.com`, "custom:tenantId": "tenant-1", "cognito:groups": groups } } }, http: { method: "PUT" } },
});

const input = (overrides: Record<string, unknown> = {}) => ({
  slug: " Fr-Cyril-A7K2 ", displayName: "Fr Cyril", timezone: "America/Toronto", startIntervalMinutes: 30,
  bookingCalendarId: "book", conflictCalendarIds: ["conflict"], minimumNoticeMinutes: 60, maximumBookingDays: 90,
  globalDateOverrides: [{ date: "2026-10-15", unavailable: true }],
  appointmentTypes: [{ id: "confession", name: "Confession", enabled: true, allowedDurationsMinutes: [45, 30, 45], defaultDurationMinutes: 45,
    weeklyAvailability: { wednesday: [{ start: "11:15", end: "17:45" }] }, dateOverrides: [{ date: "2026-12-25", unavailable: true }, { date: "2026-12-24", ranges: [{ start: "09:00", end: "13:00" }] }] }],
  ...overrides,
});

const invoke = async (handler: ReturnType<typeof createHandler>, request: Record<string, unknown>) => handler(request as never, {} as never, () => undefined) as Promise<APIGatewayProxyStructuredResultV2>;

test("priest creates and updates normalized booking settings with independent duration and availability granularity", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = memoryClient([connection(), calendar("book"), calendar("conflict")]);
  const handler = createHandler({ documentClient, now: () => "2026-09-01T00:00:00.000Z", uuid: () => "profile-1" });
  const created = await invoke(handler, event(input({ ownerUserId: "another-priest" })));
  assert.equal(created.statusCode, 201);
  const profile = JSON.parse(created.body ?? "{}").profile;
  assert.equal(profile.slug, "fr-cyril-a7k2");
  assert.equal(profile.ownerUserId, "priest-1");
  assert.deepEqual(profile.appointmentTypes[0].allowedDurationsMinutes, [30, 45]);
  assert.equal(profile.appointmentTypes[0].weeklyAvailability.wednesday[0].start, "11:15");
  assert.equal(profile.globalDateOverrides[0].unavailable, true);
  const updated = await invoke(handler, event(input({ displayName: "Father Cyril" })));
  assert.equal(updated.statusCode, 200);
  assert.equal(JSON.parse(updated.body ?? "{}").profile.displayName, "Father Cyril");
});

test("booking settings reject servants, invalid schedules, timezone and calendars not owned by the priest", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const handler = createHandler({ documentClient: memoryClient([connection(), calendar("book", "reader"), calendar("other", "owner", "priest-2")]), uuid: () => "profile-1" });
  assert.equal((await invoke(handler, event(input(), ["servant"]))).statusCode, 403);
  assert.equal((await invoke(handler, event(input({ timezone: "Toronto/Not-A-Timezone" })))).statusCode, 400);
  assert.equal((await invoke(handler, event(input({ startIntervalMinutes: 20 })))).statusCode, 400);
  assert.equal((await invoke(handler, event(input({ bookingCalendarId: "arbitrary-calendar-id" })))).statusCode, 400);
  assert.equal((await invoke(handler, event(input({ bookingCalendarId: "other" })))).statusCode, 400);
  assert.equal((await invoke(handler, event(input({ appointmentTypes: [{ ...input().appointmentTypes[0], defaultDurationMinutes: 60 }] })))).statusCode, 400);
  assert.equal((await invoke(handler, event(input({ appointmentTypes: [{ ...input().appointmentTypes[0], weeklyAvailability: { wednesday: [{ start: "09:00", end: "12:00" }, { start: "11:15", end: "13:00" }] } }] })))).statusCode, 400);
});

test("duplicate and concurrent duplicate slugs are atomically rejected", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = memoryClient([connection(), connection("priest-2"), calendar("book"), calendar("conflict"), calendar("book", "owner", "priest-2"), calendar("conflict", "owner", "priest-2")]);
  const handler = createHandler({ documentClient, uuid: () => "profile" });
  const [first, second] = await Promise.all([invoke(handler, event(input(), ["priest"], "priest-1")), invoke(handler, event(input(), ["priest"], "priest-2"))]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [201, 409]);
});

test("public booking pages work without Cognito and expose only enabled appointment type fields", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = memoryClient([connection(), calendar("book"), calendar("conflict")]);
  const handler = createHandler({ documentClient, uuid: () => "profile-1" });
  await invoke(handler, event(input({ appointmentTypes: [
    ...input().appointmentTypes,
    { id: "hidden", name: "Hidden", enabled: false, allowedDurationsMinutes: [30], defaultDurationMinutes: 30, weeklyAvailability: {}, dateOverrides: [] },
  ] })));
  const publicRequest = {
    body: null, rawPath: "/public/booking-pages/fr-cyril-a7k2", pathParameters: { slug: "fr-cyril-a7k2" },
    requestContext: { http: { method: "GET" } },
  };
  const response = await invoke(handler, publicRequest);
  assert.equal(response.statusCode, 200);
  const page = JSON.parse(response.body ?? "{}");
  assert.equal(page.slug, "fr-cyril-a7k2");
  assert.deepEqual(page.appointmentTypes.map((type: { id: string }) => type.id), ["confession"]);
  assert.equal("tenantId" in page, false);
  assert.equal("ownerUserId" in page, false);
  assert.equal("bookingCalendarId" in page, false);
  assert.equal("weeklyAvailability" in page.appointmentTypes[0], false);

  const protectedResponse = await invoke(handler, { ...publicRequest, rawPath: "/booking-settings" });
  assert.equal(protectedResponse.statusCode, 403);
  const missingResponse = await invoke(handler, { ...publicRequest, rawPath: "/public/booking-pages/no-such-page", pathParameters: { slug: "no-such-page" } });
  assert.equal(missingResponse.statusCode, 404);

  const profile = documentClient.items.get("USER#priest-1|BOOKING_PROFILE");
  assert.ok(profile);
  profile.enabled = false;
  const disabledResponse = await invoke(handler, publicRequest);
  assert.equal(disabledResponse.statusCode, 404);
  assert.equal(disabledResponse.body, missingResponse.body);
});

test("monthly availability uses the default duration, 30-minute midnight grid, and no Google event details", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const googleConnection = { ...connection(), accessToken: "token", scopes: ["https://www.googleapis.com/auth/calendar"], status: "connected" };
  const documentClient = memoryClient([googleConnection, calendar("book"), calendar("conflict")]);
  const handler = createHandler({
    documentClient,
    now: () => "2026-09-01T00:00:00.000Z",
    uuid: () => "profile-1",
    fetchImpl: async () => new Response(JSON.stringify({ calendars: { book: { busy: [] }, conflict: { busy: [] } } }), { status: 200 }),
  });
  await invoke(handler, event(input({ appointmentTypes: [{ ...input().appointmentTypes[0], weeklyAvailability: { wednesday: [{ start: "11:15", end: "12:00" }] } }] })));
  const request = (extra = "") => ({ body: null, rawPath: "/public/booking-pages/fr-cyril-a7k2/availability/month", pathParameters: { slug: "fr-cyril-a7k2" }, queryStringParameters: { appointmentTypeId: "confession", month: "2026-09", ...(extra ? { durationMinutes: extra } : {}) }, requestContext: { http: { method: "GET" } } });
  const defaultAvailability = await invoke(handler, request());
  assert.equal(defaultAvailability.statusCode, 200);
  assert.deepEqual(JSON.parse(defaultAvailability.body ?? "{}").availableDates, []);
  const thirtyMinuteAvailability = await invoke(handler, request("30"));
  const payload = JSON.parse(thirtyMinuteAvailability.body ?? "{}");
  assert.equal(thirtyMinuteAvailability.statusCode, 200);
  assert.ok(payload.availableDates.includes("2026-09-02"));
  assert.equal(JSON.stringify(payload).includes("busy"), false);
});
