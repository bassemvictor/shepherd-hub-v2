import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import * as XLSX from "xlsx";

import { createHandler } from "../amplify/functions/project-template-api/handler.js";

const createEvent = (overrides: Record<string, unknown> = {}) => ({
  body: null,
  pathParameters: undefined,
  rawPath: "/records",
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

test("creates a record and scopes it to the tenant", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });
        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "record-1",
  });

  const response = await handler(
    createEvent({
      body: JSON.stringify({ name: "Starter Record", owner: "Project Owner", status: "active" }),
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
    SK: "RECORD#record-1",
    createdAt: "2026-06-03T12:00:00.000Z",
    entityType: "record",
    name: "Starter Record",
    owner: "Project Owner",
    recordId: "record-1",
    status: "active",
    tenantId: "tenant-abc",
    updatedAt: "2026-06-03T12:00:00.000Z",
  });
});

test("returns a validation error when required fields are missing", async () => {
  process.env.PROJECT_TEMPLATE_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async () => {
        throw new Error("document client should not be called");
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "record-1",
  });

  const response = await handler(
    createEvent({
      body: JSON.stringify({ name: "", owner: "", status: "active" }),
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
  assert.match(String(response.body), /Name is required/);
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
    profession: undefined,
    familyStatus: undefined,
    church: undefined,
    fatherOfConfession: undefined,
    deaconshipRank: undefined,
    ordinationDate: undefined,
    churchProvince: undefined,
    churchCity: undefined,
    churchRegion: undefined,
    diocese: undefined,
    accountStatus: undefined,
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
              calendarId: "calendar-1",
              eventId: "event-1",
              calendarName: "Main Calendar",
              summary: "Visitation",
              start: "2026-06-04T15:00:00.000Z",
              end: "2026-06-04T16:00:00.000Z",
              allDay: false,
              status: "confirmed",
              source: "GOOGLE",
              eventType: "VISITATION",
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
  assert.match(JSON.stringify(transactWrite?.input), /"eventType":"VISITATION"/);
});
