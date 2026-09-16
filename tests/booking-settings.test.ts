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
      if (command.constructor.name === "PutCommand") {
        const item = command.input.Item as Record<string, unknown>; const itemId = key(item as { PK: string; SK: string }); const existing = items.get(itemId);
        const condition = String(command.input.ConditionExpression ?? ""); const values = command.input.ExpressionAttributeValues as Record<string, unknown> | undefined;
        const failed = (condition.includes("attribute_not_exists(PK)") && Boolean(existing))
          || (condition.includes("#version = :expectedVersion") && existing?.version !== values?.[":expectedVersion"])
          || (condition.includes("requestHash = :requestHash") && existing?.requestHash !== values?.[":requestHash"]);
        if (failed) { const error = new Error("conditional"); error.name = "ConditionalCheckFailedException"; throw error; }
        items.set(itemId, { ...item }); return {};
      }
      if (command.constructor.name === "DeleteCommand") {
        items.delete(key(command.input.Key as { PK: string; SK: string })); return {};
      }
      if (command.constructor.name === "QueryCommand") {
        const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
        return { Items: [...items.values()].filter((item) => item.PK === values[":pk"] && String(item.SK) >= String(values[":from"] ?? "") && String(item.SK) <= String(values[":to"] ?? "~")) };
      }
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
  const resetSlug = await invoke(handler, event(input({ slug: "father-cyril-8a6e42bf", displayName: "Father Cyril" })));
  assert.equal(resetSlug.statusCode, 200);
  assert.equal(JSON.parse(resetSlug.body ?? "{}").profile.slug, "father-cyril-8a6e42bf");
  assert.equal(documentClient.items.has("BOOKING_SLUG#fr-cyril-a7k2|PROFILE"), false);
  assert.equal(documentClient.items.get("BOOKING_SLUG#father-cyril-8a6e42bf|PROFILE")?.ownerUserId, "priest-1");
  const send = documentClient.send;
  documentClient.send = async (command) => {
    const itemKey = command.input.Key as { PK: string; SK: string } | undefined;
    if (command.constructor.name === "GetCommand" && itemKey && !command.input.ConsistentRead &&
      ["BOOKING_SLUG#father-cyril-8a6e42bf|PROFILE", "USER#priest-1|BOOKING_PROFILE"].includes(key(itemKey))) {
      return {}; // Simulate a stale eventual read immediately after the slug transaction.
    }
    return send(command);
  };
  const publicRequest = (slug: string) => ({ body: null, rawPath: `/public/booking-pages/${slug}`, requestContext: { http: { method: "GET" } } });
  assert.equal((await invoke(handler, publicRequest("fr-cyril-a7k2"))).statusCode, 404);
  const newPublicPage = await invoke(handler, publicRequest("father-cyril-8a6e42bf"));
  assert.equal(newPublicPage.statusCode, 200);
  assert.equal(JSON.parse(newPublicPage.body ?? "{}").slug, "father-cyril-8a6e42bf");
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
  const dayResponse = await invoke(handler, {
    body: null, rawPath: "/public/booking-pages/fr-cyril-a7k2/availability/day", pathParameters: { slug: "fr-cyril-a7k2" },
    queryStringParameters: { appointmentTypeId: "confession", date: "2026-09-02", durationMinutes: "30" }, requestContext: { http: { method: "GET" } },
  });
  assert.equal(dayResponse.statusCode, 200);
  const dayPayload = JSON.parse(dayResponse.body ?? "{}");
  assert.equal(dayPayload.slots.length, 1);
  assert.match(dayPayload.slots[0].start, /T15:30:00\.000Z$/);
  const invalidDuration = await invoke(handler, {
    body: null, rawPath: "/public/booking-pages/fr-cyril-a7k2/availability/day", pathParameters: { slug: "fr-cyril-a7k2" },
    queryStringParameters: { appointmentTypeId: "confession", date: "2026-09-02", durationMinutes: "55" }, requestContext: { http: { method: "GET" } },
  });
  assert.equal(invalidDuration.statusCode, 400);
});

const publicBookingRequest = (start: string, idempotencyKey: string) => ({
  body: JSON.stringify({ appointmentTypeId: "confession", durationMinutes: 45, start, visitorName: "Visitor Name", visitorEmail: "VISITOR@EXAMPLE.COM", visitorPhone: "555-0100", note: "Private note", idempotencyKey }),
  rawPath: "/public/booking-pages/fr-cyril-a7k2/bookings", pathParameters: { slug: "fr-cyril-a7k2" }, requestContext: { http: { method: "POST" } },
});

const bookingHarness = async (failGoogleCreate = false) => {
  const googleConnection = { ...connection(), accessToken: "token", scopes: ["https://www.googleapis.com/auth/calendar"], status: "connected" };
  const documentClient = memoryClient([googleConnection, calendar("book"), calendar("conflict")]);
  let googleEvents = 0;
  let lastGoogleEventBody: Record<string, unknown> | null = null;
  let generatedIds = 0;
  let generatedTokens = 0;
  const handler = createHandler({
    documentClient, now: () => "2026-09-01T00:00:00.000Z", uuid: () => ++generatedIds === 1 ? "profile-1" : `booking-${generatedIds - 1}`,
    managementToken: () => `management-token-with-at-least-32-bytes-value-${++generatedTokens}`,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/freeBusy")) return new Response(JSON.stringify({ calendars: { book: { busy: [] }, conflict: { busy: [] } } }), { status: 200 });
      if (init?.method === "POST") { googleEvents += 1; lastGoogleEventBody = JSON.parse(String(init.body)); return failGoogleCreate ? new Response("failed", { status: 500 }) : new Response(JSON.stringify({ id: `google-${googleEvents}` }), { status: 200 }); }
      return new Response(null, { status: 204 });
    },
  });
  await invoke(handler, event(input()));
  return { documentClient, handler, getGoogleEvents: () => googleEvents, getLastGoogleEventBody: () => lastGoogleEventBody };
};

test("public booking atomically blocks overlapping requests, preserves non-overlapping requests, and keeps PII out of BOOKING_DAY", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const overlap = await bookingHarness();
  const [first, second] = await Promise.all([
    invoke(overlap.handler, publicBookingRequest("2026-09-02T15:30:00.000Z", "request-overlap-a")),
    invoke(overlap.handler, publicBookingRequest("2026-09-02T16:00:00.000Z", "request-overlap-b")),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [201, 409]);
  assert.equal(overlap.getGoogleEvents(), 1);
  const day = overlap.documentClient.items.get("PUBLIC_BOOKING_DAY#profile-1|2026-09-02");
  assert.ok(day); assert.equal(JSON.stringify(day).includes("Visitor Name"), false); assert.equal(JSON.stringify(day).includes("visitor@example.com"), false);

  const adjacent = await bookingHarness();
  const [a, b] = await Promise.all([
    invoke(adjacent.handler, publicBookingRequest("2026-09-02T15:30:00.000Z", "request-adjacent-a")),
    invoke(adjacent.handler, publicBookingRequest("2026-09-02T16:30:00.000Z", "request-adjacent-b")),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 201]);
  assert.equal(adjacent.getGoogleEvents(), 2);
});

test("public booking is idempotent and cleans only its reservation when Google creation fails", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const success = await bookingHarness();
  const request = publicBookingRequest("2026-09-02T15:30:00.000Z", "request-idempotent");
  const first = await invoke(success.handler, request); const replay = await invoke(success.handler, request);
  assert.equal(first.statusCode, 201); assert.equal(replay.statusCode, 201); assert.equal(success.getGoogleEvents(), 1);
  assert.ok(JSON.parse(first.body ?? "{}").managementToken); assert.equal(JSON.parse(replay.body ?? "{}").managementToken, undefined);
  const changedReplay = publicBookingRequest("2026-09-02T16:30:00.000Z", "request-idempotent");
  assert.equal((await invoke(success.handler, changedReplay)).statusCode, 409);
  const bookingRecord = [...success.documentClient.items.values()].find((item) => item.entityType === "PUBLIC_BOOKING");
  assert.equal(bookingRecord?.visitorEmail, "visitor@example.com");
  const googleEventBody = success.getLastGoogleEventBody() as { summary?: string; attendees?: unknown; extendedProperties?: { private?: { visitorEmail?: string } } } | null;
  assert.equal(googleEventBody?.summary, "Appointment: Visitor Name");
  assert.equal(googleEventBody?.extendedProperties?.private?.visitorEmail, "visitor@example.com");
  assert.deepEqual(googleEventBody?.attendees, [{ email: "visitor@example.com" }]);
  assert.equal("managementToken" in (bookingRecord ?? {}), false);
  assert.equal(typeof bookingRecord?.managementTokenHash, "string");

  const failed = await bookingHarness(true);
  const response = await invoke(failed.handler, publicBookingRequest("2026-09-02T15:30:00.000Z", "request-google-fail"));
  assert.equal(response.statusCode, 500);
  const day = failed.documentClient.items.get("PUBLIC_BOOKING_DAY#profile-1|2026-09-02");
  assert.deepEqual(day?.reservations, []);

  const tampering = await bookingHarness();
  const invalidDurationRequest = publicBookingRequest("2026-09-02T15:30:00.000Z", "request-bad-duration");
  invalidDurationRequest.body = JSON.stringify({ ...JSON.parse(invalidDurationRequest.body), durationMinutes: 55 });
  assert.equal((await invoke(tampering.handler, invalidDurationRequest)).statusCode, 400);
  assert.equal((await invoke(tampering.handler, publicBookingRequest("2026-09-02T15:45:00.000Z", "request-bad-boundary"))).statusCode, 400);
});

test("management token isolates a booking, supports idempotent cancellation, and reschedules on the same day", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const harness = await bookingHarness();
  const created = await invoke(harness.handler, publicBookingRequest("2026-09-02T15:30:00.000Z", "request-manage"));
  const token = JSON.parse(created.body ?? "{}").managementToken as string;
  const lookup = [...harness.documentClient.items.values()].find((item) => item.entityType === "PUBLIC_BOOKING_MANAGEMENT");
  assert.ok(lookup); const storedBooking = harness.documentClient.items.get(`${lookup.bookingPk}|${lookup.bookingSk}`); assert.ok(storedBooking);
  const storedProfile = harness.documentClient.items.get(`USER#${storedBooking.ownerUserId}|BOOKING_PROFILE`); assert.ok(storedProfile); assert.equal(storedProfile.profileId, storedBooking.profileId);
  const manageRequest = (path: string, body: Record<string, unknown>) => ({ body: JSON.stringify(body), rawPath: path, requestContext: { http: { method: "POST" } } });
  const managed = await invoke(harness.handler, manageRequest("/public/bookings/manage", { token }));
  const managedDto = JSON.parse(managed.body ?? "{}");
  assert.equal(managed.statusCode, 200); assert.equal(managedDto.bookingId, "booking-1");
  assert.equal("tenantId" in managedDto, false); assert.equal("googleEventId" in managedDto, false); assert.equal("visitorEmail" in managedDto, false);
  assert.equal((await invoke(harness.handler, manageRequest("/public/bookings/manage", { token: "not-a-valid-management-token" }))).statusCode, 404);

  const moved = await invoke(harness.handler, manageRequest("/public/bookings/reschedule", { token, start: "2026-09-02T16:30:00.000Z", durationMinutes: 30 }));
  assert.equal(moved.statusCode, 200); assert.equal(JSON.parse(moved.body ?? "{}").durationMinutes, 30);
  const cancelled = await invoke(harness.handler, manageRequest("/public/bookings/cancel", { token }));
  const repeatedCancel = await invoke(harness.handler, manageRequest("/public/bookings/cancel", { token }));
  assert.equal(cancelled.statusCode, 200); assert.equal(repeatedCancel.statusCode, 200);
  assert.equal(JSON.parse(repeatedCancel.body ?? "{}").status, "CANCELLED");
  assert.deepEqual(harness.documentClient.items.get("PUBLIC_BOOKING_DAY#profile-1|2026-09-02")?.reservations, []);

  const crossDay = await bookingHarness();
  const crossCreated = await invoke(crossDay.handler, publicBookingRequest("2026-09-02T15:30:00.000Z", "request-cross-day"));
  const crossToken = JSON.parse(crossCreated.body ?? "{}").managementToken as string;
  const crossMoved = await invoke(crossDay.handler, manageRequest("/public/bookings/reschedule", { token: crossToken, start: "2026-09-09T15:30:00.000Z", durationMinutes: 45 }));
  assert.equal(crossMoved.statusCode, 200);
  assert.deepEqual(crossDay.documentClient.items.get("PUBLIC_BOOKING_DAY#profile-1|2026-09-02")?.reservations, []);
  const newDay = crossDay.documentClient.items.get("PUBLIC_BOOKING_DAY#profile-1|2026-09-09") as { reservations?: Array<{ status?: string }> } | undefined;
  assert.equal(newDay?.reservations?.[0]?.status, "CONFIRMED");
});
