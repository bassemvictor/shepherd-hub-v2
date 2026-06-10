import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import * as XLSX from "xlsx";

import { createHandler } from "../amplify/functions/project-template-api/handler.js";
import type { VisitationReportResponse } from "../shared/types.js";

const createEvent = (overrides: Record<string, unknown> = {}) => ({
  body: null,
  pathParameters: undefined,
  rawPath: "/members",
  requestContext: {
    authorizer: {
      jwt: {
        claims: {
          "cognito:groups": ["admin"],
          "custom:tenantId": "tenant-123",
          email: "owner@example.com",
          name: "Owner Example",
          sub: "user-123",
        },
      },
    },
    http: {
      method: "GET",
    },
  },
  ...overrides,
});

test("creates a member and scopes it to the tenant", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const uuids = ["member-1", "activity-1"];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });
        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  const response = await handler(
    createEvent({
      body: JSON.stringify({ fullName: "Adel Abraham", phone: "(613) 606-4114", source: "MANUAL" }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 201);
  assert.equal(commands[0]?.name, "PutCommand");
  assert.equal(commands[0]?.input.TableName, "records-table");
  assert.deepEqual(commands[0]?.input.Item, {
    PK: "TENANT#tenant-abc",
    SK: "MEMBER#member-1",
    GSI1PK: "TENANT#tenant-abc#MEMBERS",
    GSI1SK: "NAME#adel abraham#MEMBER#member-1",
    GSI2PK: undefined,
    GSI2SK: undefined,
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "MEMBER",
    tenantId: "tenant-abc",
    memberId: "member-1",
    unityId: undefined,
    source: "MANUAL",
    isUnityMember: false,
    familyId: undefined,
    householdName: undefined,
    fullName: "Adel Abraham",
    firstName: "Adel",
    lastName: "Abraham",
    initials: "AA",
    phone: "(613) 606-4114",
    email: undefined,
    whatsappPhone: "(613) 606-4114",
    address: undefined,
    postalCode: undefined,
    dateOfBirth: undefined,
    age: undefined,
    gender: undefined,
    familyStatus: undefined,
    church: undefined,
    fatherOfConfession: undefined,
    deaconshipRank: undefined,
    ordinationDate: undefined,
    churchProvince: undefined,
    churchCity: undefined,
    churchRegion: undefined,
    diocese: undefined,
    activated: undefined,
    approved: undefined,
    locked: undefined,
    visibility: undefined,
    username: undefined,
    registrationDate: undefined,
    groups: undefined,
    customFlag: undefined,
    licensePlate: undefined,
    notes: undefined,
    normalizedSearchText: "adel abraham (613) 606-4114",
  });
});

test("returns a validation error when required member fields are missing", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async () => {
        throw new Error("document client should not be called");
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "member-1",
  });

  const response = await handler(
    createEvent({
      body: JSON.stringify({ fullName: "", source: "MANUAL" }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              email: "owner@example.com",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 400);
  assert.match(String(response.body), /Member full name is required/);
});

test("creates a member with tenant and member indexes", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const uuids = ["member-1", "activity-1"];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });
        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members",
      body: JSON.stringify({ fullName: "Adel Abraham", phone: "(613) 606-4114", source: "MANUAL" }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 201);
  assert.equal(commands[0]?.name, "PutCommand");
  assert.deepEqual(commands[0]?.input.Item, {
    PK: "TENANT#tenant-abc",
    SK: "MEMBER#member-1",
    GSI1PK: "TENANT#tenant-abc#MEMBERS",
    GSI1SK: "NAME#adel abraham#MEMBER#member-1",
    GSI2PK: undefined,
    GSI2SK: undefined,
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "MEMBER",
    tenantId: "tenant-abc",
    memberId: "member-1",
    unityId: undefined,
    source: "MANUAL",
    isUnityMember: false,
    familyId: undefined,
    householdName: undefined,
    fullName: "Adel Abraham",
    firstName: "Adel",
    lastName: "Abraham",
    initials: "AA",
    phone: "(613) 606-4114",
    email: undefined,
    whatsappPhone: "(613) 606-4114",
    address: undefined,
    postalCode: undefined,
    dateOfBirth: undefined,
    age: undefined,
    gender: undefined,
    familyStatus: undefined,
    church: undefined,
    fatherOfConfession: undefined,
    deaconshipRank: undefined,
    ordinationDate: undefined,
    churchProvince: undefined,
    churchCity: undefined,
    churchRegion: undefined,
    diocese: undefined,
    activated: undefined,
    approved: undefined,
    locked: undefined,
    visibility: undefined,
    username: undefined,
    registrationDate: undefined,
    groups: undefined,
    customFlag: undefined,
    licensePlate: undefined,
    notes: undefined,
    normalizedSearchText: "adel abraham (613) 606-4114",
  });
  assert.equal(commands[1]?.name, "PutCommand");
  assert.match(String(response.body), /Adel Abraham/);
});

test("imports a Unity workbook when headers start below a title row", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["UnityApp"],
    [
      "Family ID",
      "Household Name",
      "Member ID",
      "Member Name",
      "Phone Number",
      "Email",
    ],
    ["family-1", "Abraham Household", "17317", "Adel Abraham", "(613) 606-4114", "adel@example.com"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  const workbookBase64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
  const uuids = ["member-1", "activity-1"];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });
        if (command.constructor.name === "QueryCommand") {
          return { Items: [] };
        }
        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/import",
      body: JSON.stringify({ fileName: "Adel.xlsx", workbookBase64 }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(String(response.body)), {
    created: 1,
    updated: 0,
    skipped: 0,
    errors: [],
  });
  assert.ok(commands.some((command) => command.name === "PutCommand"));
});

test("member responses ignore legacy role and status fields from stored items", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === "GetCommand") {
          return {
            Item: {
              PK: "TENANT#tenant-abc",
              SK: "MEMBER#member-1",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "MEMBER",
              tenantId: "tenant-abc",
              memberId: "member-1",
              unityId: "17317",
              source: "UNITY",
              isUnityMember: true,
              fullName: "Adel Abraham",
              firstName: "Adel",
              lastName: "Abraham",
              initials: "AA",
              phone: "(613) 606-4114",
              email: "adel@example.com",
              normalizedSearchText: "adel abraham 6136064114 adel@example.com",
              profession: "Legacy Role",
              accountStatus: "Legacy Status",
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          return { Items: [] };
        }

        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/member-1",
      pathParameters: { memberId: "member-1" },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "GET",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(String(response.body)), {
    member: {
      createdAt: "2026-06-03T12:00:00.000Z",
      entityType: "MEMBER",
      tenantId: "tenant-abc",
      updatedAt: "2026-06-03T12:00:00.000Z",
      memberId: "member-1",
      unityId: "17317",
      source: "UNITY",
      isUnityMember: true,
      fullName: "Adel Abraham",
      firstName: "Adel",
      lastName: "Abraham",
      initials: "AA",
      phone: "(613) 606-4114",
      email: "adel@example.com",
      normalizedSearchText: "adel abraham 6136064114 adel@example.com",
    },
    activity: [],
  });
  assert.doesNotMatch(String(response.body), /Legacy Role|Legacy Status|profession|accountStatus/);
});

test("stores visitation member links with VISITATION type", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });

        if (command.constructor.name === "GetCommand") {
          return {
            Item: {
              PK: "USER#user-123",
              SK: "EVENT#calendar-1#event-1",
              GSI1PK: "USER#user-123#CALENDAR#calendar-1",
              GSI1SK: "EVENT#2026-06-04T15:00:00.000Z#event-1",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "schedule_event",
              userId: "user-123",
              tenantId: "tenant-abc",
              calendarId: "calendar-1",
              eventId: "event-1",
              calendarName: "Main Calendar",
              summary: "Visitation",
              start: "2026-06-04T15:00:00.000Z",
              end: "2026-06-04T16:00:00.000Z",
              allDay: false,
              status: "confirmed",
              source: "GOOGLE",
            },
          };
        }

        if (command.constructor.name === "BatchGetCommand") {
          return {
            Responses: {
              "records-table": [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Adel Abraham",
                  initials: "AA",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "adel abraham",
                },
              ],
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          return { Items: [] };
        }

        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/events/event-1/members",
      pathParameters: { eventId: "event-1" },
      body: JSON.stringify({
        calendarId: "calendar-1",
        memberIds: ["member-1"],
      }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "PUT",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const transactWrite = commands.find((command) => command.name === "TransactWriteCommand");
  assert.ok(transactWrite);
});

test("stores tenant visitation records under the canonical tenant event partition for the Google event id", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const writtenVisitations: Array<Record<string, unknown>> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "PutCommand") {
          const item = command.input.Item as Record<string, unknown>;
          if (item.entityType === "VISITATION") {
            writtenVisitations.push(item);
          }
          return {};
        }

        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };
          if (key.PK === "USER#user-123" && key.SK === "EVENT#calendar-1#event-1") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "EVENT#calendar-1#event-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "schedule_event",
                userId: "user-123",
                tenantId: "tenant-abc",
                calendarId: "calendar-1",
                eventId: "event-1",
                calendarName: "Calendar One",
                summary: "Visitation",
                start: "2026-06-04T15:00:00.000Z",
                end: "2026-06-04T16:00:00.000Z",
                allDay: false,
                status: "confirmed",
                source: "GOOGLE",
              },
            };
          }

          if (key.PK === "USER#user-123" && key.SK === "EVENT#calendar-2#event-1") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "EVENT#calendar-2#event-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "schedule_event",
                userId: "user-123",
                tenantId: "tenant-abc",
                calendarId: "calendar-2",
                eventId: "event-1",
                calendarName: "Calendar Two",
                summary: "Visitation",
                start: "2026-06-05T15:00:00.000Z",
                end: "2026-06-05T16:00:00.000Z",
                allDay: false,
                status: "confirmed",
                source: "GOOGLE",
              },
            };
          }

          return {};
        }

        if (command.constructor.name === "BatchGetCommand") {
          return {
            Responses: {
              "records-table": [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Adel Abraham",
                  initials: "AA",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "adel abraham",
                },
              ],
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          return { Items: [] };
        }

        if (command.constructor.name === "TransactWriteCommand") {
          return {};
        }

        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "activity-1",
  });

  const baseEvent = {
    rawPath: "/events/event-1/members",
    pathParameters: { eventId: "event-1" },
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            "custom:tenantId": "tenant-abc",
            email: "owner@example.com",
            name: "Owner Example",
            sub: "user-123",
          },
        },
      },
      http: {
        method: "PUT",
      },
    },
  };

  await handler(
    createEvent({
      ...baseEvent,
      body: JSON.stringify({ calendarId: "calendar-1", memberIds: ["member-1"] }),
    }) as never,
    {} as never,
    () => undefined,
  );

  await handler(
    createEvent({
      ...baseEvent,
      body: JSON.stringify({ calendarId: "calendar-2", memberIds: ["member-1"] }),
    }) as never,
    {} as never,
    () => undefined,
  );

  assert.equal(writtenVisitations.length, 2);
  assert.deepEqual(
    writtenVisitations.map((item) => item.PK),
    [
      "TENANT#tenant-abc#EVENT#event-1",
      "TENANT#tenant-abc#EVENT#event-1",
    ],
  );
  assert.deepEqual(
    writtenVisitations.map((item) => item.visitationId),
    [
      "calendar-1:event-1:member-1",
      "calendar-2:event-1:member-1",
    ],
  );
});

test("writes memberIds into Google event private metadata when creating a schedule event", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  let googleRequestBody = "";
  let storedEvent: Record<string, unknown> | undefined;

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "PutCommand") {
          const item = command.input.Item as Record<string, unknown>;
          if (item.entityType === "schedule_event") {
            storedEvent = item;
          }
          return {};
        }

        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };
          if (key.PK === "USER#user-123" && key.SK === "GOOGLE_CONNECTION") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "GOOGLE_CONNECTION",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "google_connection",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account",
                email: "owner@example.com",
                accessToken: "token-123",
                scopes: ["https://www.googleapis.com/auth/calendar"],
                status: "connected",
                connectedAt: "2026-06-03T12:00:00.000Z",
                lastConnectedAt: "2026-06-03T12:00:00.000Z",
              },
            };
          }

          if (key.PK === "USER#user-123" && key.SK === "CALENDAR#calendar-1") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "CALENDAR#calendar-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "schedule_calendar",
                userId: "user-123",
                tenantId: "tenant-abc",
                calendarId: "calendar-1",
                summary: "Main Calendar",
                primary: true,
                enabled: true,
                selected: true,
                sync: {
                  syncMode: "ALWAYS_GOOGLE",
                  refreshIntervalMinutes: 15,
                  initialSyncRange: { from: "2026-01-01", to: "2027-12-31" },
                  lastSyncStatus: "idle",
                  requiresFullSync: false,
                },
              },
            };
          }

          if (key.PK === "USER#user-123" && key.SK === "EVENT#calendar-1#event-1") {
            return { Item: storedEvent };
          }

          return {};
        }

        if (command.constructor.name === "BatchGetCommand") {
          return {
            Responses: {
              "records-table": [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Adel Abraham",
                  initials: "AA",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "adel abraham",
                },
              ],
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          return { Items: [] };
        }

        return {};
      },
    },
    fetchImpl: async (_url, init) => {
      googleRequestBody = String(init?.body ?? "");
      return {
        ok: true,
        json: async () => ({
          id: "event-1",
          summary: "Visitation",
          start: { dateTime: "2026-06-04T15:00:00.000Z" },
          end: { dateTime: "2026-06-04T16:00:00.000Z" },
          extendedProperties: {
            private: {
              memberIds: "member-1",
            },
          },
        }),
      } as Response;
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/events",
      body: JSON.stringify({
        calendarId: "calendar-1",
        summary: "Visitation",
        start: "2026-06-04T15:00:00.000Z",
        end: "2026-06-04T16:00:00.000Z",
        memberIds: ["member-1"],
      }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 201);
  assert.deepEqual(JSON.parse(googleRequestBody), {
    summary: "Visitation",
    attendees: [],
    extendedProperties: {
      private: {
        memberIds: "member-1",
      },
    },
    start: { dateTime: "2026-06-04T15:00:00.000Z" },
    end: { dateTime: "2026-06-04T16:00:00.000Z" },
  });
  assert.ok(storedEvent);
  assert.equal(storedEvent?.calendarId, "calendar-1");
  assert.equal(storedEvent?.eventId, "event-1");
  assert.equal(storedEvent?.summary, "Visitation");
  assert.equal(storedEvent?.source, "GOOGLE");
  assert.deepEqual(storedEvent?.memberIds, ["member-1"]);
  assert.deepEqual(storedEvent?.memberNames, ["Adel Abraham"]);
});

test("full sync restores member links from Google event private metadata", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });

        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };
          if (key.PK === "USER#user-123" && key.SK === "GOOGLE_CONNECTION") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "GOOGLE_CONNECTION",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "google_connection",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account",
                email: "owner@example.com",
                accessToken: "token-123",
                scopes: ["https://www.googleapis.com/auth/calendar"],
                status: "connected",
                connectedAt: "2026-06-03T12:00:00.000Z",
                lastConnectedAt: "2026-06-03T12:00:00.000Z",
              },
            };
          }

          return {};
        }

        if (command.constructor.name === "BatchGetCommand") {
          return {
            Responses: {
              "records-table": [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Adel Abraham",
                  initials: "AA",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "adel abraham",
                },
              ],
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          const values = command.input.ExpressionAttributeValues as Record<string, string>;
          if (values?.[":pk"] === "USER#user-123" && values?.[":calendarPrefix"] === "CALENDAR#") {
            return {
              Items: [
                {
                  PK: "USER#user-123",
                  SK: "CALENDAR#calendar-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "schedule_calendar",
                  userId: "user-123",
                  tenantId: "tenant-abc",
                  calendarId: "calendar-1",
                  summary: "Main Calendar",
                  primary: true,
                  enabled: true,
                  selected: true,
                  backgroundColor: "#2563eb",
                  sync: {
                    syncMode: "ALWAYS_GOOGLE",
                    refreshIntervalMinutes: 15,
                    initialSyncRange: { from: "2026-01-01", to: "2027-12-31" },
                    lastSyncStatus: "idle",
                    requiresFullSync: true,
                  },
                },
              ],
            };
          }

          if (values?.[":pk"] === "USER#user-123" && values?.[":eventPrefix"] === "EVENT#calendar-1#") {
            return {
              Items: [
                {
                  PK: "USER#user-123",
                  SK: "EVENT#calendar-1#event-1",
                  GSI1PK: "USER#user-123#CALENDAR#calendar-1",
                  GSI1SK: "EVENT#2026-06-04T15:00:00.000Z#event-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "schedule_event",
                  userId: "user-123",
                  tenantId: "tenant-abc",
                  calendarId: "calendar-1",
                  eventId: "event-1",
                  calendarName: "Main Calendar",
                  calendarColor: "#2563eb",
                  summary: "Visitation",
                  start: "2026-06-04T15:00:00.000Z",
                  end: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  status: "confirmed",
                  source: "GOOGLE",
                  memberIds: ["member-1"],
                  memberNames: ["Adel Abraham"],
                },
              ],
            };
          }

          if (command.input.IndexName === "GSI1") {
            return {
              Items: [
                {
                  PK: "USER#user-123",
                  SK: "EVENT#calendar-1#event-1",
                  GSI1PK: "USER#user-123#CALENDAR#calendar-1",
                  GSI1SK: "EVENT#2026-06-04T15:00:00.000Z#event-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "schedule_event",
                  userId: "user-123",
                  tenantId: "tenant-abc",
                  calendarId: "calendar-1",
                  eventId: "event-1",
                  calendarName: "Main Calendar",
                  calendarColor: "#2563eb",
                  summary: "Visitation",
                  start: "2026-06-04T15:00:00.000Z",
                  end: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  status: "confirmed",
                  source: "GOOGLE",
                  memberIds: ["member-1"],
                  memberNames: ["Adel Abraham"],
                },
              ],
            };
          }

          return { Items: [] };
        }

        return {};
      },
    },
    fetchImpl: async (_url) =>
      ({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "event-1",
              summary: "Visitation",
              start: { dateTime: "2026-06-04T15:00:00.000Z" },
              end: { dateTime: "2026-06-04T16:00:00.000Z" },
              extendedProperties: {
                private: {
                  memberIds: "member-1",
                },
              },
            },
          ],
          nextSyncToken: "sync-token-1",
        }),
      }) as Response,
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/events",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "GET",
        },
      },
      queryStringParameters: {
        forceSync: "true",
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const eventPut = commands.find(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string; eventId?: string } | undefined)?.entityType === "schedule_event",
  );
  assert.ok(eventPut);
  assert.deepEqual((eventPut?.input.Item as { memberIds?: string[] }).memberIds, ["member-1"]);
  assert.deepEqual((eventPut?.input.Item as { memberNames?: string[] }).memberNames, ["Adel Abraham"]);
  const memberLinkWrite = commands.find((command) => command.name === "TransactWriteCommand");
  assert.ok(memberLinkWrite);
  assert.match(JSON.stringify(memberLinkWrite?.input), /"GSI2PK":"TENANT#tenant-abc#MEMBER#member-1"/);
});

test("refreshed calendars return events only for the requested schedule range", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };
          if (key.PK === "USER#user-123" && key.SK === "GOOGLE_CONNECTION") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "GOOGLE_CONNECTION",
                createdAt: "2026-06-07T12:00:00.000Z",
                updatedAt: "2026-06-07T12:00:00.000Z",
                entityType: "google_connection",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account",
                email: "owner@example.com",
                accessToken: "token-123",
                scopes: ["https://www.googleapis.com/auth/calendar"],
                status: "connected",
                connectedAt: "2026-06-07T12:00:00.000Z",
                lastConnectedAt: "2026-06-07T12:00:00.000Z",
              },
            };
          }

          return {};
        }

        if (command.constructor.name === "QueryCommand") {
          const values = command.input.ExpressionAttributeValues as Record<string, string>;

          if (values?.[":pk"] === "USER#user-123" && values?.[":calendarPrefix"] === "CALENDAR#") {
            return {
              Items: [
                {
                  PK: "USER#user-123",
                  SK: "CALENDAR#calendar-1",
                  createdAt: "2026-06-07T12:00:00.000Z",
                  updatedAt: "2026-06-07T12:00:00.000Z",
                  entityType: "schedule_calendar",
                  userId: "user-123",
                  tenantId: "tenant-abc",
                  calendarId: "calendar-1",
                  summary: "Main Calendar",
                  primary: true,
                  enabled: true,
                  selected: true,
                  backgroundColor: "#2563eb",
                  sync: {
                    syncMode: "ALWAYS_GOOGLE",
                    refreshIntervalMinutes: 15,
                    initialSyncRange: { from: "2026-01-01", to: "2027-12-31" },
                    lastSyncedAt: "2026-06-06T10:00:00.000Z",
                    lastSyncStatus: "success",
                    requiresFullSync: false,
                    syncToken: "sync-token-0",
                  },
                },
              ],
            };
          }

          if (command.input.IndexName === "GSI1") {
            if (values?.[":from"] === "EVENT#2025-11-17T00:00:00.000Z") {
              return {
                Items: [
                  {
                    PK: "USER#user-123",
                    SK: "EVENT#calendar-1#event-1",
                    GSI1PK: "USER#user-123#CALENDAR#calendar-1",
                    GSI1SK: "EVENT#2026-06-04T15:00:00.000Z#event-1",
                    createdAt: "2026-06-04T15:00:00.000Z",
                    updatedAt: "2026-06-07T12:00:00.000Z",
                    entityType: "schedule_event",
                    userId: "user-123",
                    tenantId: "tenant-abc",
                    calendarId: "calendar-1",
                    eventId: "event-1",
                    calendarName: "Main Calendar",
                    calendarColor: "#2563eb",
                    summary: "Earlier This Week",
                    start: "2026-06-04T15:00:00.000Z",
                    end: "2026-06-04T16:00:00.000Z",
                    allDay: false,
                    status: "confirmed",
                    source: "GOOGLE",
                  },
                ],
              };
            }

            return { Items: [] };
          }
        }

        return {};
      },
    },
    fetchImpl: async () =>
      ({
        ok: true,
        json: async () => ({
          items: [],
          nextSyncToken: "sync-token-1",
        }),
      }) as Response,
    now: () => "2026-06-07T12:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/events",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "GET",
        },
      },
      queryStringParameters: {
        timeMin: "2026-06-07T00:00:00.000Z",
        timeMax: "2026-06-08T00:00:00.000Z",
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body ?? "{}") as { events?: Array<{ eventId: string }> };
  assert.deepEqual(body.events ?? [], []);
});

test("member visitation history is tenant-shared and includes assignment snapshots", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };
          if (key.PK === "TENANT#tenant-abc" && key.SK === "MEMBER#member-1") {
            return {
              Item: {
                PK: "TENANT#tenant-abc",
                SK: "MEMBER#member-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "MEMBER",
                tenantId: "tenant-abc",
                memberId: "member-1",
                fullName: "Adel Abraham",
                initials: "AA",
                source: "UNITY",
                isUnityMember: true,
                normalizedSearchText: "adel abraham",
              },
            };
          }
          return {};
        }

        if (command.constructor.name === "QueryCommand") {
          const values = command.input.ExpressionAttributeValues as Record<string, string>;

          if (command.input.IndexName === "GSI2" && values?.[":gsiPk"] === "TENANT#tenant-abc#MEMBER#member-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  GSI2PK: "TENANT#tenant-abc#MEMBER#member-1",
                  GSI2SK: "EVENT#2026-06-04T15:00:00.000Z#event-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-04T16:00:00.000Z",
                  entityType: "EVENT_MEMBER",
                  tenantId: "tenant-abc",
                  calendarId: "calendar-1",
                  eventId: "event-1",
                  calendarOwnerUserId: "user-456",
                  calendarOwnerName: "Visitor B",
                  memberId: "member-1",
                  memberName: "Adel Abraham",
                  memberPhoneSnapshot: undefined,
                  memberEmailSnapshot: undefined,
                  unityIdSnapshot: undefined,
                  sourceSnapshot: "UNITY",
                  eventTitle: "Visitation: Adel Abraham",
                  eventStart: "2026-06-04T15:00:00.000Z",
                  eventEnd: "2026-06-04T16:00:00.000Z",
                  eventLocation: "123 Main St",
                  eventDescription: "Pastoral visit",
                  allDay: false,
                  assignmentStatus: "scheduled",
                  visitStatus: "scheduled",
                  createdByUserId: "user-456",
                  createdByName: "Visitor B",
                },
              ],
            };
          }

          return { Items: [] };
        }

        return {};
      },
    },
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/member-1/events",
      pathParameters: { memberId: "member-1" },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "viewer@example.com",
              name: "Viewer A",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "GET",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(String(response.body)), {
    items: [
      {
        createdAt: "2026-06-03T12:00:00.000Z",
        eventId: "event-1",
        calendarId: "calendar-1",
        calendarOwnerName: "Visitor B",
        calendarOwnerUserId: "user-456",
        createdByName: "Visitor B",
        createdByUserId: "user-456",
        entityType: "EVENT_MEMBER",
        eventDescription: "Pastoral visit",
        eventEnd: "2026-06-04T16:00:00.000Z",
        eventLocation: "123 Main St",
        eventStart: "2026-06-04T15:00:00.000Z",
        eventTitle: "Visitation: Adel Abraham",
        isOwnCalendar: false,
        memberName: "Adel Abraham",
        memberId: "member-1",
        assignmentStatus: "scheduled",
        tenantId: "tenant-abc",
        updatedAt: "2026-06-04T16:00:00.000Z",
        visitStatus: "scheduled",
      },
    ],
  });
});

test("member visitation history merges duplicate Unity member rows for the same tenant member", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };
          if (key.PK === "TENANT#tenant-abc" && key.SK === "MEMBER#member-1") {
            return {
              Item: {
                PK: "TENANT#tenant-abc",
                SK: "MEMBER#member-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "MEMBER",
                tenantId: "tenant-abc",
                memberId: "member-1",
                unityId: "17317",
                source: "UNITY",
                isUnityMember: true,
                fullName: "Bassem Wanis",
                initials: "BW",
                normalizedSearchText: "bassem wanis 17317",
              },
            };
          }
          return {};
        }

        if (command.constructor.name === "QueryCommand") {
          const values = command.input.ExpressionAttributeValues as Record<string, string>;

          if (command.input.IndexName === "GSI2" && values?.[":gsiPk"] === "TENANT#tenant-abc#UNITY") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  unityId: "17317",
                  source: "UNITY",
                  isUnityMember: true,
                  fullName: "Bassem Wanis",
                  initials: "BW",
                  normalizedSearchText: "bassem wanis 17317",
                },
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-2",
                  unityId: "17317",
                  source: "UNITY",
                  isUnityMember: true,
                  fullName: "Bassem Wanis",
                  initials: "BW",
                  normalizedSearchText: "bassem wanis 17317",
                },
              ],
            };
          }

          if (command.input.IndexName === "GSI2" && values?.[":gsiPk"] === "TENANT#tenant-abc#MEMBER#member-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  GSI2PK: "TENANT#tenant-abc#MEMBER#member-1",
                  GSI2SK: "EVENT#2026-06-04T15:00:00.000Z#event-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-04T16:00:00.000Z",
                  entityType: "EVENT_MEMBER",
                  tenantId: "tenant-abc",
                  calendarId: "calendar-1",
                  eventId: "event-1",
                  calendarOwnerUserId: "user-456",
                  calendarOwnerName: "Visitor B",
                  memberId: "member-1",
                  memberName: "Bassem Wanis",
                  sourceSnapshot: "UNITY",
                  eventTitle: "Visitation: Bassem Wanis",
                  eventStart: "2026-06-04T15:00:00.000Z",
                  eventEnd: "2026-06-04T16:00:00.000Z",
                  assignmentStatus: "scheduled",
                  visitStatus: "scheduled",
                  createdByUserId: "user-456",
                  createdByName: "Visitor B",
                },
              ],
            };
          }

          if (command.input.IndexName === "GSI2" && values?.[":gsiPk"] === "TENANT#tenant-abc#MEMBER#member-2") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#EVENT#event-2",
                  SK: "MEMBER#member-2",
                  GSI2PK: "TENANT#tenant-abc#MEMBER#member-2",
                  GSI2SK: "EVENT#2026-06-05T15:00:00.000Z#event-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-05T16:00:00.000Z",
                  entityType: "EVENT_MEMBER",
                  tenantId: "tenant-abc",
                  calendarId: "calendar-2",
                  eventId: "event-2",
                  calendarOwnerUserId: "user-789",
                  calendarOwnerName: "Visitor C",
                  memberId: "member-2",
                  memberName: "Bassem Wanis",
                  sourceSnapshot: "UNITY",
                  eventTitle: "Visitation: Bassem Wanis",
                  eventStart: "2026-06-05T15:00:00.000Z",
                  eventEnd: "2026-06-05T16:00:00.000Z",
                  assignmentStatus: "scheduled",
                  visitStatus: "scheduled",
                  createdByUserId: "user-789",
                  createdByName: "Visitor C",
                },
              ],
            };
          }

          return { Items: [] };
        }

        return {};
      },
    },
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/member-1/events",
      pathParameters: { memberId: "member-1" },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "viewer@example.com",
              name: "Viewer A",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "GET",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(String(response.body)) as { items: Array<{ eventId: string }> };
  assert.deepEqual(body.items.map((item) => item.eventId), [
    "event-1",
    "event-2",
  ]);
});

test("visitation reports default to all visitors and support only-my-visits filtering", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "QueryCommand" && command.input.IndexName === "GSI1") {
          return {
            Items: [
              {
                PK: "TENANT#tenant-abc#CALENDAR#calendar-1#EVENT#event-1",
                SK: "VISIT#member-1",
                GSI1PK: "TENANT#tenant-abc",
                GSI1SK: "VISIT#2026-06-05T15:00:00.000Z#VISITOR#user-123#MEMBER#member-1#VISITATION#calendar-1:event-1:member-1",
                GSI2PK: "TENANT#tenant-abc#MEMBER#member-1",
                GSI2SK: "VISIT#2026-06-05T15:00:00.000Z#VISITATION#calendar-1:event-1:member-1",
                createdAt: "2026-06-05T15:00:00.000Z",
                updatedAt: "2026-06-05T16:00:00.000Z",
                entityType: "VISITATION",
                tenantId: "tenant-abc",
                calendarId: "calendar-1",
                visitationId: "calendar-1:event-1:member-1",
                memberId: "member-1",
                memberNameSnapshot: "Adel Abraham",
                memberSourceSnapshot: "UNITY",
                visitorUserId: "user-123",
                visitorDisplayName: "Viewer A",
                visitDate: "2026-06-05T15:00:00.000Z",
                sourceEventId: "event-1",
                ownerUserId: "user-123",
                status: "confirmed",
              },
              {
                PK: "TENANT#tenant-abc#CALENDAR#calendar-2#EVENT#event-2",
                SK: "VISIT#member-2",
                GSI1PK: "TENANT#tenant-abc",
                GSI1SK: "VISIT#2026-06-04T15:00:00.000Z#VISITOR#user-456#MEMBER#member-2#VISITATION#calendar-2:event-2:member-2",
                GSI2PK: "TENANT#tenant-abc#MEMBER#member-2",
                GSI2SK: "VISIT#2026-06-04T15:00:00.000Z#VISITATION#calendar-2:event-2:member-2",
                createdAt: "2026-06-04T15:00:00.000Z",
                updatedAt: "2026-06-04T16:00:00.000Z",
                entityType: "VISITATION",
                tenantId: "tenant-abc",
                calendarId: "calendar-2",
                visitationId: "calendar-2:event-2:member-2",
                memberId: "member-2",
                memberNameSnapshot: "Mary Mina",
                memberSourceSnapshot: "MANUAL",
                visitorUserId: "user-456",
                visitorDisplayName: "Visitor B",
                visitDate: "2026-06-04T15:00:00.000Z",
                sourceEventId: "event-2",
                ownerUserId: "user-456",
                status: "confirmed",
              },
            ],
          };
        }

        return {};
      },
    },
    now: () => "2026-06-06T12:00:00.000Z",
  });

  const allResponse = await handler(
    createEvent({
      rawPath: "/reports/visitations",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "viewer@example.com",
              name: "Viewer A",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "GET",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(allResponse.statusCode, 200);
  const allBody = JSON.parse(String(allResponse.body)) as VisitationReportResponse;
  assert.equal(allBody.rows.length, 2);
  assert.deepEqual(allBody.visitors, [
    { visitorUserId: "user-123", visitorDisplayName: "Viewer A" },
    { visitorUserId: "user-456", visitorDisplayName: "Visitor B" },
  ]);

  const myResponse = await handler(
    createEvent({
      rawPath: "/reports/visitations",
      queryStringParameters: { visitorMode: "me_only" },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "viewer@example.com",
              name: "Viewer A",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "GET",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(myResponse.statusCode, 200);
  const myBody = JSON.parse(String(myResponse.body)) as VisitationReportResponse;
  assert.equal(myBody.rows.length, 2);
  assert.equal(myBody.rows.find((row) => row.memberId === "member-1")?.visitCountInRange, 1);
  assert.equal(myBody.rows.find((row) => row.memberId === "member-2")?.visitCountInRange, 0);
});

test("schedule overview excludes user-owned records from a different tenant", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };
          if (key.PK === "USER#user-123" && key.SK === "GOOGLE_CONNECTION") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "GOOGLE_CONNECTION",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "google_connection",
                userId: "user-123",
                tenantId: "tenant-other",
                googleAccountId: "google-account",
                email: "owner@example.com",
                accessToken: "token-123",
                scopes: ["https://www.googleapis.com/auth/calendar"],
                status: "connected",
                connectedAt: "2026-06-03T12:00:00.000Z",
                lastConnectedAt: "2026-06-03T12:00:00.000Z",
              },
            };
          }

          return {};
        }

        if (command.constructor.name === "QueryCommand") {
          return {
            Items: [
              {
                PK: "USER#user-123",
                SK: "CALENDAR#calendar-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "schedule_calendar",
                userId: "user-123",
                tenantId: "tenant-other",
                calendarId: "calendar-1",
                summary: "Main Calendar",
                primary: true,
                enabled: true,
                selected: true,
                sync: {
                  syncMode: "ALWAYS_GOOGLE",
                  refreshIntervalMinutes: 15,
                  initialSyncRange: { from: "2026-01-01", to: "2027-12-31" },
                  lastSyncStatus: "idle",
                  requiresFullSync: false,
                },
              },
            ],
          };
        }

        return {};
      },
    },
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/overview",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "viewer@example.com",
              name: "Viewer A",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "GET",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(String(response.body)), {
    connection: null,
    calendars: [],
    oauthConfigured: false,
    settings: {
      calendarListRefreshThresholdMinutes: 30,
    },
  });
});

test("refreshing calendars returns a reconnect message when the stored Google token lacks calendar scope", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "GetCommand") {
          return {
            Item: {
              PK: "USER#user-123",
              SK: "GOOGLE_CONNECTION",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "google_connection",
              userId: "user-123",
              tenantId: "tenant-abc",
              googleAccountId: "google-account",
              email: "owner@example.com",
              accessToken: "token-123",
              scopes: ["openid", "email", "profile"],
              status: "connected",
              connectedAt: "2026-06-03T12:00:00.000Z",
              lastConnectedAt: "2026-06-03T12:00:00.000Z",
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          return { Items: [] };
        }

        return {};
      },
    },
    fetchImpl: async () => {
      throw new Error("Google Calendar should not be called when scopes are already known to be insufficient.");
    },
    now: () => "2026-06-09T12:00:00.000Z",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/calendars/refresh",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 400);
  assert.match(String(response.body), /Disconnect and reconnect Google Calendar/);
  const failedConnectionWrite = commands.find(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string; status?: string } | undefined)?.entityType === "google_connection",
  );
  assert.equal((failedConnectionWrite?.input.Item as { status?: string } | undefined)?.status, "error");
});

test("refreshing calendars maps Google scope 403 errors to a reconnect message", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "GetCommand") {
          return {
            Item: {
              PK: "USER#user-123",
              SK: "GOOGLE_CONNECTION",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "google_connection",
              userId: "user-123",
              tenantId: "tenant-abc",
              googleAccountId: "google-account",
              email: "owner@example.com",
              accessToken: "token-123",
              scopes: ["https://www.googleapis.com/auth/calendar"],
              status: "connected",
              connectedAt: "2026-06-03T12:00:00.000Z",
              lastConnectedAt: "2026-06-03T12:00:00.000Z",
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          return { Items: [] };
        }

        return {};
      },
    },
    fetchImpl: async () =>
      ({
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            error: {
              code: 403,
              message: "Request had insufficient authentication scopes.",
              status: "PERMISSION_DENIED",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
                },
              ],
            },
          }),
      }) as Response,
    now: () => "2026-06-09T12:00:00.000Z",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/calendars/refresh",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 400);
  assert.match(String(response.body), /Disconnect and reconnect Google Calendar/);
  const failedConnectionWrite = [...commands]
    .reverse()
    .find(
      (command) =>
        command.name === "PutCommand" &&
        (command.input.Item as { entityType?: string; status?: string } | undefined)?.entityType === "google_connection",
    );
  assert.equal((failedConnectionWrite?.input.Item as { status?: string } | undefined)?.status, "error");
});

test("clearing a calendar cache deletes cached events without deleting tenant-shared assignments", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "GetCommand") {
          return {
            Item: {
              PK: "USER#user-123",
              SK: "CALENDAR#calendar-1",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "schedule_calendar",
              userId: "user-123",
              tenantId: "tenant-abc",
              calendarId: "calendar-1",
              summary: "Main Calendar",
              primary: true,
              enabled: true,
              selected: true,
              sync: {
                syncMode: "ALWAYS_GOOGLE",
                refreshIntervalMinutes: 15,
                initialSyncRange: { from: "2026-01-01", to: "2027-12-31" },
                lastSyncStatus: "success",
                requiresFullSync: false,
              },
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          return {
            Items: [
              {
                PK: "USER#user-123",
                SK: "EVENT#calendar-1#google-event-1",
                GSI1PK: "USER#user-123#CALENDAR#calendar-1",
                GSI1SK: "EVENT#2026-06-05T15:00:00.000Z#google-event-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "schedule_event",
                userId: "user-123",
                tenantId: "tenant-abc",
                calendarId: "calendar-1",
                eventId: "google-event-1",
                googleEventId: "google-event-1",
                calendarName: "Main Calendar",
                summary: "Visitation: Adel Abraham",
                start: "2026-06-05T15:00:00.000Z",
                end: "2026-06-05T16:00:00.000Z",
                allDay: false,
                status: "confirmed",
                source: "GOOGLE",
              },
            ],
          };
        }

        return {};
      },
    },
    now: () => "2026-06-09T12:00:00.000Z",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/calendars/calendar-1/cache",
      pathParameters: { calendarId: "calendar-1" },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "viewer@example.com",
              name: "Viewer A",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "DELETE",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const deleteCommands = commands.filter((command) => command.name === "DeleteCommand");
  assert.deepEqual(deleteCommands.map((command) => command.input.Key), [
    {
      PK: "USER#user-123",
      SK: "EVENT#calendar-1#google-event-1",
    },
  ]);
});

test("creating a schedule event stores the Google event id as the canonical event id", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };
          if (key.SK === "GOOGLE_CONNECTION") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "GOOGLE_CONNECTION",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "google_connection",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account",
                email: "owner@example.com",
                accessToken: "token-123",
                scopes: ["https://www.googleapis.com/auth/calendar"],
                status: "connected",
                connectedAt: "2026-06-03T12:00:00.000Z",
                lastConnectedAt: "2026-06-03T12:00:00.000Z",
              },
            };
          }

          if (key.SK === "CALENDAR#calendar-1") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "CALENDAR#calendar-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "schedule_calendar",
                userId: "user-123",
                tenantId: "tenant-abc",
                calendarId: "calendar-1",
                summary: "Main Calendar",
                primary: true,
                enabled: true,
                selected: true,
                sync: {
                  syncMode: "ALWAYS_GOOGLE",
                  refreshIntervalMinutes: 15,
                  initialSyncRange: { from: "2026-01-01", to: "2027-12-31" },
                  lastSyncStatus: "idle",
                  requiresFullSync: false,
                },
              },
            };
          }
        }

        return {};
      },
    },
    fetchImpl: async () =>
      ({
        ok: true,
        json: async () => ({
          id: "google-event-1",
          summary: "Visitation: Adel Abraham",
          start: { dateTime: "2026-06-05T15:00:00.000Z" },
          end: { dateTime: "2026-06-05T16:00:00.000Z" },
          status: "confirmed",
        }),
      }) as Response,
    now: () => "2026-06-03T12:00:00.000Z",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/events",
      body: JSON.stringify({
        calendarId: "calendar-1",
        summary: "Visitation: Adel Abraham",
        start: "2026-06-05T15:00:00.000Z",
        end: "2026-06-05T16:00:00.000Z",
        memberIds: [],
      }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: {
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 201);
  const putEventCommand = commands.find(
    (command) =>
      command.name === "PutCommand" &&
      String((command.input.Item as { entityType?: string }).entityType) === "schedule_event",
  );
  assert.equal((putEventCommand?.input.Item as { eventId?: string }).eventId, "google-event-1");
  assert.equal((putEventCommand?.input.Item as { SK?: string }).SK, "EVENT#calendar-1#google-event-1");
});
