import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import writeExcelFile from "write-excel-file/node";

import { createHandler } from "../amplify/functions/shepherd-hub-api/handler.js";
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

const itemKey = (key: { PK: string; SK: string }) => `${key.PK}||${key.SK}`;

const createInMemoryDocumentClient = (
  seedItems: Array<Record<string, unknown>> = [],
  commands: Array<{ name: string; input: Record<string, unknown> }> = [],
) => {
  const items = new Map<string, Record<string, unknown>>(
    seedItems.map((item) => [itemKey({ PK: String(item.PK), SK: String(item.SK) }), { ...item }]),
  );

  return {
    items,
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      commands.push({ input: command.input, name: command.constructor.name });

      if (command.constructor.name === "GetCommand") {
        const key = command.input.Key as { PK: string; SK: string };
        return { Item: items.get(itemKey(key)) };
      }

      if (command.constructor.name === "PutCommand") {
        const item = command.input.Item as Record<string, unknown>;
        items.set(itemKey({ PK: String(item.PK), SK: String(item.SK) }), { ...item });
        return {};
      }

      if (command.constructor.name === "UpdateCommand") {
        const key = command.input.Key as { PK: string; SK: string };
        const existing = items.get(itemKey(key));
        if (!existing) {
          throw new Error("Missing item for update");
        }

        const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
        if (values[":expectedUpdatedAt"] !== undefined && existing.updatedAt !== values[":expectedUpdatedAt"]) {
          const error = new Error("ConditionalCheckFailedException");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }

        const nextItem = { ...existing };
        const updateExpression = typeof command.input.UpdateExpression === "string"
          ? command.input.UpdateExpression
          : "";
        if (values[":location"] !== undefined || updateExpression.includes("#location")) {
          nextItem.location = values[":location"];
        }
        if (values[":updatedAt"] !== undefined) {
          nextItem.updatedAt = values[":updatedAt"];
        }
        if (values[":startedAt"] !== undefined && nextItem.startedAt === undefined) {
          nextItem.startedAt = values[":startedAt"];
        }
        if (values[":status"] !== undefined) {
          nextItem.status = values[":status"];
        }
        if (values[":leaseOwner"] !== undefined) {
          nextItem.leaseOwner = values[":leaseOwner"];
        }
        if (values[":leaseExpiresAt"] !== undefined) {
          nextItem.leaseExpiresAt = values[":leaseExpiresAt"];
        }
        items.set(itemKey(key), nextItem);
        return { Attributes: nextItem };
      }

      if (command.constructor.name === "BatchGetCommand") {
        return { Responses: { "records-table": [] } };
      }

      if (command.constructor.name === "TransactWriteCommand") {
        const transactItems = command.input.TransactItems as Array<{ Put?: { Item?: Record<string, unknown> } }>;
        for (const transactItem of transactItems) {
          const item = transactItem.Put?.Item;
          if (!item) {
            continue;
          }
          items.set(itemKey({ PK: String(item.PK), SK: String(item.SK) }), { ...item });
        }
        return {};
      }

      if (command.constructor.name === "QueryCommand") {
        const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
        const indexName = command.input.IndexName;

        if (indexName === "GSI2") {
          return {
            Items: [...items.values()].filter((item) =>
              item.GSI2PK === values[":gsiPk"] && item.GSI2SK === values[":gsiSk"]),
          };
        }

        if (indexName === "GSI5") {
          return {
            Items: [...items.values()].filter((item) =>
              item.GSI5PK === values[":gsiPk"]),
          };
        }

        if (indexName === "GSI4") {
          const from = String(values[":from"]);
          const to = String(values[":to"]);
          return {
            Items: [...items.values()].filter((item) =>
              item.GSI4PK === values[":gsiPk"] && typeof item.GSI4SK === "string" && item.GSI4SK >= from && item.GSI4SK <= to),
          };
        }

        if (!indexName && values[":pk"] !== undefined && values[":sk"] !== undefined) {
          return {
            Items: [...items.values()].filter((item) =>
              item.PK === values[":pk"] && typeof item.SK === "string" && item.SK.startsWith(String(values[":sk"]))),
          };
        }

        return { Items: [] };
      }

      return {};
    },
  };
};

const createHouseholdItem = (overrides: Record<string, unknown> = {}) => ({
  PK: "TENANT#tenant-abc",
  SK: `HOUSEHOLD#${String(overrides.householdId ?? "household-1")}`,
  GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
  GSI4SK: `NAME#${String(overrides.householdName ?? "alpha household").toLowerCase()}#HOUSEHOLD#${String(overrides.householdId ?? "household-1")}`,
  GSI2PK: overrides.addressKey ? "TENANT#tenant-abc#HOUSEHOLD_ADDRESS" : undefined,
  GSI2SK: overrides.addressKey ? `ADDRESS#${String(overrides.addressKey)}` : undefined,
  createdAt: "2026-06-01T09:00:00.000Z",
  updatedAt: "2026-06-01T09:00:00.000Z",
  entityType: "HOUSEHOLD",
  tenantId: "tenant-abc",
  householdId: "household-1",
  householdName: "Alpha Household",
  address: "123 Main St",
  postalCode: "K2P 1L4",
  normalizedAddress: "123 MAIN ST",
  normalizedPostalCode: "K2P1L4",
  addressKey: "123 MAIN ST|K2P1L4",
  notes: undefined,
  location: undefined,
  areaId: undefined,
  memberCount: 0,
  primaryContactMemberId: undefined,
  members: [],
  normalizedSearchText: "alpha household 123 main st",
  ...overrides,
});

test("creates a member and scopes it to the tenant", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
    tagIds: undefined,
    PK: "TENANT#tenant-abc",
    SK: "MEMBER#member-1",
    GSI1PK: "TENANT#tenant-abc#MEMBERS",
    GSI1SK: "NAME#adel abraham#MEMBER#member-1",
    GSI2PK: undefined,
    GSI2SK: undefined,
    GSI5PK: undefined,
    GSI5SK: undefined,
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "MEMBER",
    tenantId: "tenant-abc",
    memberId: "member-1",
    unityId: undefined,
    source: "MANUAL",
    isUnityMember: false,
    familyId: undefined,
    householdId: undefined,
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
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const previousLogging = process.env.ENABLE_MEMBER_ACTIVITY_LOGGING;
  process.env.ENABLE_MEMBER_ACTIVITY_LOGGING = "true";
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

  try {
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
    tagIds: undefined,
      PK: "TENANT#tenant-abc",
      SK: "MEMBER#member-1",
      GSI1PK: "TENANT#tenant-abc#MEMBERS",
      GSI1SK: "NAME#adel abraham#MEMBER#member-1",
      GSI2PK: undefined,
      GSI2SK: undefined,
      GSI5PK: undefined,
      GSI5SK: undefined,
      createdAt: "2026-06-03T12:00:00.000Z",
      updatedAt: "2026-06-03T12:00:00.000Z",
      entityType: "MEMBER",
      tenantId: "tenant-abc",
      memberId: "member-1",
      unityId: undefined,
      source: "MANUAL",
      isUnityMember: false,
      familyId: undefined,
      householdId: undefined,
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
  } finally {
    if (previousLogging === undefined) {
      delete process.env.ENABLE_MEMBER_ACTIVITY_LOGGING;
    } else {
      process.env.ENABLE_MEMBER_ACTIVITY_LOGGING = previousLogging;
    }
  }
});

test("creates an async Unity import job when headers start below a title row", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const workbookBase64 = (await writeExcelFile([
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
  ], { sheet: "Sheet1" }).toBuffer()).toString("base64");
  const uuids = ["import-job-1"];

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

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(String(response.body)), {
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "MEMBER_IMPORT_JOB",
    tenantId: "tenant-abc",
    jobId: "import-job-1",
    fileName: "Adel.xlsx",
    status: "queued",
    totalRows: 1,
    processedRows: 0,
    totalChunks: 1,
    processedChunks: 0,
    result: {
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
    },
  });
  assert.equal(commands[0]?.name, "PutCommand");
  assert.equal(commands[1]?.name, "BatchWriteCommand");
});

test("serializes workbook date cells before writing import chunks", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const workbookBase64 = (await writeExcelFile([
    ["UnityApp"],
    [
      "Family ID",
      "Household Name",
      "Member ID",
      "Member Name",
      "Date of Birth",
      "Registration Date",
    ],
    [
      "family-1",
      "Abraham Household",
      "17317",
      "Adel Abraham",
      new Date("2010-01-04T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    ],
  ], {
    dateFormat: "yyyy-mm-dd",
    sheet: "Sheet1",
  }).toBuffer()).toString("base64");
  const uuids = ["import-job-1"];

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

  assert.equal(response.statusCode, 202);
  const batchWrite = commands.find((command) => command.name === "BatchWriteCommand");
  const requestItems = batchWrite?.input.RequestItems as Record<string, Array<{
    PutRequest?: { Item?: { rows?: Array<{ values?: Record<string, unknown> }> } };
  }>> | undefined;
  const chunkWrites = requestItems?.["records-table"];
  const firstRowValues = chunkWrites?.[0]?.PutRequest?.Item?.rows?.[0]?.values;

  assert.equal(firstRowValues?.["Date of Birth"], "2010-01-04");
  assert.equal(firstRowValues?.["Registration Date"], "2026-06-03");
});

test("processes multiple member import job chunks in one request and preserves existing member tags", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const uuids = ["member-1", "activity-1"];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });

        if (command.constructor.name === "GetCommand") {
          return {
            Item: {
              PK: "TENANT#tenant-abc",
              SK: "MEMBER_IMPORT_JOB#import-job-1",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "MEMBER_IMPORT_JOB",
              tenantId: "tenant-abc",
              jobId: "import-job-1",
              fileName: "Adel.xlsx",
              status: "queued",
              totalRows: 2,
              processedRows: 0,
              totalChunks: 2,
              processedChunks: 0,
              result: {
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
              },
            },
          };
        }

        if (command.constructor.name === "UpdateCommand") {
          return {
            Attributes: {
              PK: "TENANT#tenant-abc",
              SK: "MEMBER_IMPORT_JOB#import-job-1",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "MEMBER_IMPORT_JOB",
              tenantId: "tenant-abc",
              jobId: "import-job-1",
              fileName: "Adel.xlsx",
              status: "running",
              totalRows: 2,
              processedRows: 0,
              totalChunks: 2,
              processedChunks: 0,
              startedAt: "2026-06-03T12:00:00.000Z",
              leaseOwner: "member-1",
              leaseExpiresAt: "2026-06-03T12:01:00.000Z",
              result: {
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
              },
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          if (command.input.IndexName === "GSI2") {
            return { Items: [] };
          }

          if (command.input.IndexName === "GSI1") {
            return { Items: [{ PK: "TENANT#tenant-abc", SK: "MEMBER#existing", entityType: "MEMBER", tenantId: "tenant-abc", memberId: "existing", unityId: "17317", fullName: "Adel", source: "UNITY", tagIds: ["tag-youth"], notes: "Keep notes", createdAt: "2026-01-01", updatedAt: "2026-01-01" }] };
          }

          return {
            Items: [
              {
                PK: "TENANT#tenant-abc",
                SK: "MEMBER_IMPORT_JOB#import-job-1#CHUNK#000000",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "MEMBER_IMPORT_CHUNK",
                tenantId: "tenant-abc",
                jobId: "import-job-1",
                chunkIndex: 0,
                rowCount: 1,
                rows: [
                  {
                    rowNumber: 3,
                    values: {
                      "Family ID": "family-1",
                      "Household Name": "Abraham Household",
                      "Member ID": "17317",
                      "Member Name": "Adel Abraham",
                      "Phone Number": "(613) 606-4114",
                      Email: "adel@example.com",
                    },
                  },
                ],
              },
              {
                PK: "TENANT#tenant-abc",
                SK: "MEMBER_IMPORT_JOB#import-job-1#CHUNK#000001",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-03T12:00:00.000Z",
                entityType: "MEMBER_IMPORT_CHUNK",
                tenantId: "tenant-abc",
                jobId: "import-job-1",
                chunkIndex: 1,
                rowCount: 1,
                rows: [
                  {
                    rowNumber: 4,
                    values: {
                      "Family ID": "family-2",
                      "Household Name": "Ibrahim Household",
                      "Member ID": "17318",
                      "Member Name": "Mina Ibrahim",
                      "Phone Number": "(613) 555-1212",
                      Email: "mina@example.com",
                    },
                  },
                ],
              },
            ],
          };
        }

        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/import/import-job-1",
      pathParameters: {
        jobId: "import-job-1",
      },
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
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "MEMBER_IMPORT_JOB",
    tenantId: "tenant-abc",
    jobId: "import-job-1",
    fileName: "Adel.xlsx",
    status: "completed",
    totalRows: 2,
    processedRows: 2,
    totalChunks: 2,
    processedChunks: 2,
    startedAt: "2026-06-03T12:00:00.000Z",
    completedAt: "2026-06-03T12:00:00.000Z",
    result: {
      created: 1,
      updated: 1,
      skipped: 0,
      householdsCreated: 0,
      householdsMatched: 0,
      membersAssignedToHouseholds: 0,
      membersWithoutHouseholds: 2,
      householdConflicts: 0,
      errorCount: 0,
      errors: [],
    },
  });
  const imported = commands.find((command) => command.name === "PutCommand" && (command.input.Item as { memberId?: string })?.memberId === "existing");
  assert.deepEqual((imported?.input.Item as { tagIds?: string[] }).tagIds, ["tag-youth"]);
  assert.ok(commands.some((command) => command.name === "BatchWriteCommand"));
  assert.ok(commands.some((command) => command.name === "PutCommand"));
});

test("member import processing backs off when another lambda already holds the lease", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });

        if (command.constructor.name === "GetCommand") {
          return {
            Item: {
              PK: "TENANT#tenant-abc",
              SK: "MEMBER_IMPORT_JOB#import-job-1",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "MEMBER_IMPORT_JOB",
              tenantId: "tenant-abc",
              jobId: "import-job-1",
              fileName: "Adel.xlsx",
              status: "running",
              totalRows: 2,
              processedRows: 1,
              totalChunks: 2,
              processedChunks: 1,
              startedAt: "2026-06-03T12:00:00.000Z",
              leaseOwner: "other-worker",
              leaseExpiresAt: "2026-06-03T12:01:00.000Z",
              result: {
                created: 1,
                updated: 0,
                skipped: 0,
                householdsCreated: 0,
                householdsMatched: 0,
                membersAssignedToHouseholds: 0,
                membersWithoutHouseholds: 1,
                householdConflicts: 0,
                errorCount: 0,
                errors: [],
              },
            },
          };
        }

        if (command.constructor.name === "UpdateCommand") {
          const error = new Error("The conditional request failed.");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }

        if (command.constructor.name === "QueryCommand") {
          throw new Error("chunks should not be queried when the lease is held");
        }

        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "worker-2",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/import/import-job-1",
      pathParameters: {
        jobId: "import-job-1",
      },
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
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "MEMBER_IMPORT_JOB",
    tenantId: "tenant-abc",
    jobId: "import-job-1",
    fileName: "Adel.xlsx",
    status: "running",
    totalRows: 2,
    processedRows: 1,
    totalChunks: 2,
    processedChunks: 1,
    startedAt: "2026-06-03T12:00:00.000Z",
    result: {
      created: 1,
      updated: 0,
      skipped: 0,
      householdsCreated: 0,
      householdsMatched: 0,
      membersAssignedToHouseholds: 0,
      membersWithoutHouseholds: 1,
      householdConflicts: 0,
      errorCount: 0,
      errors: [],
    },
  });
  assert.equal(commands.filter((command) => command.name === "UpdateCommand").length, 1);
  assert.equal(commands.filter((command) => command.name === "QueryCommand").length, 0);
});

test("admin can cancel a running member import job", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    {
      PK: "TENANT#tenant-abc",
      SK: "MEMBER_IMPORT_JOB#import-job-cancel-1",
      createdAt: "2026-08-15T10:00:00.000Z",
      updatedAt: "2026-08-15T10:00:00.000Z",
      entityType: "MEMBER_IMPORT_JOB",
      tenantId: "tenant-abc",
      jobId: "import-job-cancel-1",
      fileName: "unity.xlsx",
      status: "running",
      totalRows: 20,
      processedRows: 8,
      totalChunks: 2,
      processedChunks: 1,
      startedAt: "2026-08-15T10:00:00.000Z",
      leaseOwner: "worker-1",
      leaseExpiresAt: "2026-08-15T10:01:00.000Z",
      result: {
        created: 5,
        updated: 2,
        skipped: 1,
        householdsCreated: 2,
        householdsMatched: 4,
        membersAssignedToHouseholds: 7,
        membersWithoutHouseholds: 1,
        householdConflicts: 0,
        errorCount: 0,
        errors: [],
      },
    },
  ]);

  const handler = createHandler({
    documentClient,
    now: () => "2026-08-15T10:05:00.000Z",
    uuid: () => "unused-id",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/import/import-job-cancel-1/cancel",
      pathParameters: { jobId: "import-job-cancel-1" },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["admin"],
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(String(response.body));
  assert.equal(body.status, "cancelled");
  assert.equal(body.completedAt, "2026-08-15T10:05:00.000Z");
  assert.equal(documentClient.items.get("TENANT#tenant-abc||MEMBER_IMPORT_JOB#import-job-cancel-1")?.status, "cancelled");
});

test("member import processing does not overwrite a cancelled job", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  let getCount = 0;

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });

        if (command.constructor.name === "GetCommand") {
          getCount += 1;
          if (getCount === 1) {
            return {
              Item: {
                PK: "TENANT#tenant-abc",
                SK: "MEMBER_IMPORT_JOB#import-job-race-1",
                createdAt: "2026-08-15T12:00:00.000Z",
                updatedAt: "2026-08-15T12:00:00.000Z",
                entityType: "MEMBER_IMPORT_JOB",
                tenantId: "tenant-abc",
                jobId: "import-job-race-1",
                fileName: "race.xlsx",
                status: "queued",
                totalRows: 1,
                processedRows: 0,
                totalChunks: 1,
                processedChunks: 0,
                result: {
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
                },
              },
            };
          }

          return {
            Item: {
              PK: "TENANT#tenant-abc",
              SK: "MEMBER_IMPORT_JOB#import-job-race-1",
              createdAt: "2026-08-15T12:00:00.000Z",
              updatedAt: "2026-08-15T12:01:00.000Z",
              entityType: "MEMBER_IMPORT_JOB",
              tenantId: "tenant-abc",
              jobId: "import-job-race-1",
              fileName: "race.xlsx",
              status: "cancelled",
              totalRows: 1,
              processedRows: 0,
              totalChunks: 1,
              processedChunks: 0,
              completedAt: "2026-08-15T12:01:00.000Z",
              result: {
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
              },
            },
          };
        }

        if (command.constructor.name === "UpdateCommand") {
          return {
            Attributes: {
              PK: "TENANT#tenant-abc",
              SK: "MEMBER_IMPORT_JOB#import-job-race-1",
              createdAt: "2026-08-15T12:00:00.000Z",
              updatedAt: "2026-08-15T12:00:00.000Z",
              entityType: "MEMBER_IMPORT_JOB",
              tenantId: "tenant-abc",
              jobId: "import-job-race-1",
              fileName: "race.xlsx",
              status: "running",
              totalRows: 1,
              processedRows: 0,
              totalChunks: 1,
              processedChunks: 0,
              startedAt: "2026-08-15T12:00:00.000Z",
              leaseOwner: "worker-1",
              leaseExpiresAt: "2026-08-15T12:01:00.000Z",
              result: {
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
              },
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          return {
            Items: [
              {
                PK: "TENANT#tenant-abc",
                SK: "MEMBER_IMPORT_JOB#import-job-race-1#CHUNK#000000",
                createdAt: "2026-08-15T12:00:00.000Z",
                updatedAt: "2026-08-15T12:00:00.000Z",
                entityType: "MEMBER_IMPORT_CHUNK",
                tenantId: "tenant-abc",
                jobId: "import-job-race-1",
                chunkIndex: 0,
                rowCount: 1,
                rows: [
                  {
                    rowNumber: 3,
                    values: {
                      "Family ID": "family-1",
                      "Household Name": "Abraham Household",
                      "Member ID": "17317",
                      "Member Name": "Adel Abraham",
                      "Phone Number": "(613) 606-4114",
                      Email: "adel@example.com",
                    },
                  },
                ],
              },
            ],
          };
        }

        return {};
      },
    },
    now: () => "2026-08-15T12:00:00.000Z",
    uuid: () => "worker-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/import/import-job-race-1",
      pathParameters: {
        jobId: "import-job-race-1",
      },
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

  const body = JSON.parse(String(response.body));
  assert.equal(body.status, "cancelled");
  assert.equal(
    commands.some(
      (command) =>
        command.name === "PutCommand"
        && command.input.Item
        && typeof command.input.Item === "object"
        && "SK" in command.input.Item
        && command.input.Item.SK === "MEMBER_IMPORT_JOB#import-job-race-1",
    ),
    false,
  );
});

test("admin jobs lists member import and household geocoding job history", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    {
      PK: "TENANT#tenant-abc",
      SK: "MEMBER_IMPORT_JOB#import-job-2",
      createdAt: "2026-08-14T09:00:00.000Z",
      updatedAt: "2026-08-14T09:10:00.000Z",
      entityType: "MEMBER_IMPORT_JOB",
      tenantId: "tenant-abc",
      jobId: "import-job-2",
      fileName: "members-batch.xlsx",
      status: "completed",
      totalRows: 25,
      processedRows: 25,
      totalChunks: 3,
      processedChunks: 3,
      startedAt: "2026-08-14T09:00:00.000Z",
      completedAt: "2026-08-14T09:10:00.000Z",
      result: {
        created: 11,
        updated: 9,
        skipped: 5,
        householdsCreated: 4,
        householdsMatched: 12,
        membersAssignedToHouseholds: 20,
        membersWithoutHouseholds: 5,
        householdConflicts: 1,
        errorCount: 2,
        errors: [{ row: 8, message: "Missing member name" }],
      },
    },
    {
      PK: "TENANT#tenant-abc",
      SK: "MEMBER_IMPORT_JOB#import-job-2#CHUNK#000000",
      createdAt: "2026-08-14T09:00:00.000Z",
      updatedAt: "2026-08-14T09:04:00.000Z",
      entityType: "MEMBER_IMPORT_CHUNK",
      tenantId: "tenant-abc",
      jobId: "import-job-2",
      chunkIndex: 0,
      status: "completed",
      startedAt: "2026-08-14T09:00:00.000Z",
      completedAt: "2026-08-14T09:04:00.000Z",
      inputRows: [],
      rowCount: 10,
      summary: {
        created: 4,
        updated: 3,
        skipped: 3,
        householdsCreated: 2,
        householdsMatched: 5,
        membersAssignedToHouseholds: 8,
        membersWithoutHouseholds: 2,
        householdConflicts: 0,
        errorCount: 0,
        errors: [],
      },
    },
    {
      PK: "TENANT#tenant-abc",
      SK: "MEMBER_IMPORT_JOB#import-job-2#CHUNK#000001",
      createdAt: "2026-08-14T09:00:00.000Z",
      updatedAt: "2026-08-14T09:07:00.000Z",
      entityType: "MEMBER_IMPORT_CHUNK",
      tenantId: "tenant-abc",
      jobId: "import-job-2",
      chunkIndex: 1,
      status: "completed",
      startedAt: "2026-08-14T09:04:00.000Z",
      completedAt: "2026-08-14T09:07:00.000Z",
      inputRows: [],
      rowCount: 10,
      summary: {
        created: 5,
        updated: 4,
        skipped: 1,
        householdsCreated: 1,
        householdsMatched: 4,
        membersAssignedToHouseholds: 9,
        membersWithoutHouseholds: 1,
        householdConflicts: 1,
        errorCount: 1,
        errors: [{ row: 12, message: "Duplicate email" }],
      },
    },
    {
      PK: "TENANT#tenant-abc",
      SK: "HOUSEHOLD_GEOCODE_JOB#geocode-job-9",
      createdAt: "2026-08-14T10:00:00.000Z",
      updatedAt: "2026-08-14T10:03:00.000Z",
      entityType: "HOUSEHOLD_GEOCODE_JOB",
      tenantId: "tenant-abc",
      jobId: "geocode-job-9",
      mode: "retry_failed",
      status: "completed",
      total: 6,
      processed: 6,
      success: 5,
      failed: 1,
      remaining: 0,
      startedAt: "2026-08-14T10:00:00.000Z",
      completedAt: "2026-08-14T10:03:00.000Z",
      lastProcessedHouseholdId: "household-22",
      lastProcessedAddressKey: "22 ELM ST|K2P1L5",
      lastFailureReason: "no_result",
    },
  ]);

  const handler = createHandler({
    documentClient,
    now: () => "2026-08-14T10:05:00.000Z",
    uuid: () => "unused-id",
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/jobs",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["admin"],
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
    householdGeocodeCounts: {
      failed: 0,
      unmapped: 0,
    },
    memberImportJobs: [
      {
        createdAt: "2026-08-14T09:00:00.000Z",
        updatedAt: "2026-08-14T09:10:00.000Z",
        entityType: "MEMBER_IMPORT_JOB",
        tenantId: "tenant-abc",
        jobId: "import-job-2",
        fileName: "members-batch.xlsx",
        status: "completed",
        totalRows: 25,
        processedRows: 25,
        totalChunks: 3,
        processedChunks: 3,
        startedAt: "2026-08-14T09:00:00.000Z",
        completedAt: "2026-08-14T09:10:00.000Z",
        result: {
          created: 11,
          updated: 9,
          skipped: 5,
          householdsCreated: 4,
          householdsMatched: 12,
          membersAssignedToHouseholds: 20,
          membersWithoutHouseholds: 5,
          householdConflicts: 1,
          errorCount: 2,
          errors: [{ row: 8, message: "Missing member name" }],
        },
      },
    ],
    householdGeocodeJobs: [
      {
        createdAt: "2026-08-14T10:00:00.000Z",
        updatedAt: "2026-08-14T10:03:00.000Z",
        entityType: "HOUSEHOLD_GEOCODE_JOB",
        tenantId: "tenant-abc",
        jobId: "geocode-job-9",
        mode: "retry_failed",
        status: "completed",
        total: 6,
        processed: 6,
        success: 5,
        failed: 1,
        remaining: 0,
        startedAt: "2026-08-14T10:00:00.000Z",
        completedAt: "2026-08-14T10:03:00.000Z",
        lastProcessedHouseholdId: "household-22",
        lastProcessedAddressKey: "22 ELM ST|K2P1L5",
        lastFailureReason: "no_result",
      },
    ],
  });
});

test("admin can cancel a running household geocode job", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    {
      PK: "TENANT#tenant-abc",
      SK: "HOUSEHOLD_GEOCODE_JOB#geocode-job-cancel-1",
      createdAt: "2026-08-15T11:00:00.000Z",
      updatedAt: "2026-08-15T11:00:00.000Z",
      entityType: "HOUSEHOLD_GEOCODE_JOB",
      tenantId: "tenant-abc",
      jobId: "geocode-job-cancel-1",
      mode: "unmapped_only",
      status: "running",
      total: 10,
      processed: 4,
      success: 3,
      failed: 1,
      remaining: 6,
      startedAt: "2026-08-15T11:00:00.000Z",
      leaseOwner: "worker-2",
      leaseExpiresAt: "2026-08-15T11:01:00.000Z",
      lastProcessedHouseholdId: "household-1",
      lastProcessedAddressKey: "1 MAIN ST|K2P1L4",
      lastFailureReason: "no_result",
    },
  ]);

  const handler = createHandler({
    documentClient,
    now: () => "2026-08-15T11:06:00.000Z",
    uuid: () => "unused-id",
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-cancel-1/cancel",
      pathParameters: { jobId: "geocode-job-cancel-1" },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["admin"],
              "custom:tenantId": "tenant-abc",
              email: "owner@example.com",
              name: "Owner Example",
              sub: "user-123",
            },
          },
        },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(String(response.body));
  assert.equal(body.status, "cancelled");
  assert.equal(body.completedAt, "2026-08-15T11:06:00.000Z");
  assert.equal(documentClient.items.get("TENANT#tenant-abc||HOUSEHOLD_GEOCODE_JOB#geocode-job-cancel-1")?.status, "cancelled");
});

test("creating a household returns 409 when the normalized address is claimed concurrently", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
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
                  source: "MANUAL",
                  isUnityMember: false,
                  fullName: "Adel Abraham",
                  firstName: "Adel",
                  lastName: "Abraham",
                  initials: "AA",
                  normalizedSearchText: "adel abraham",
                },
              ],
            },
          };
        }

        if (command.constructor.name === "GetCommand") {
          return {};
        }

        if (command.constructor.name === "TransactWriteCommand") {
          const error = new Error("Transaction cancelled, please refer cancellation reasons for specific reasons.");
          error.name = "TransactionCanceledException";
          throw error;
        }

        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Abraham Household",
        address: "123 Main St",
        postalCode: "K2P 1L4",
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

  assert.equal(response.statusCode, 409);
  assert.match(String(response.body), /A household already exists for this address/);
});

test("creating a household accepts valid optional geographic fields", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });

        if (command.constructor.name === "BatchGetCommand") {
          return { Responses: { "records-table": [] } };
        }

        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-geo-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Geo Household",
        notes: "Mapped for route planning",
        areaId: "area-central",
        location: {
          latitude: 45.4215,
          longitude: -75.6972,
          geocodeStatus: "success",
          geocodedAt: "2026-06-01T10:30:00.000Z",
          geocodeProvider: "manual",
        },
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
  const body = JSON.parse(String(response.body));
  assert.deepEqual(body.location, {
    latitude: 45.4215,
    longitude: -75.6972,
    geocodeStatus: "success",
    geocodedAt: "2026-06-01T10:30:00.000Z",
    geocodeProvider: "manual",
  });
  assert.equal(body.areaId, "CENTRAL");

  const transactWrite = commands.find((command) => command.name === "TransactWriteCommand");
  const createdHousehold = (transactWrite?.input.TransactItems as Array<{ Put?: { Item?: Record<string, unknown> } }> | undefined)
    ?.find((item) => item.Put?.Item && (item.Put.Item.SK as string | undefined)?.startsWith("HOUSEHOLD#"))
    ?.Put?.Item;
  assert.deepEqual(createdHousehold?.location, {
    latitude: 45.4215,
    longitude: -75.6972,
    geocodeStatus: "success",
    geocodedAt: "2026-06-01T10:30:00.000Z",
    geocodeProvider: "manual",
  });
  assert.equal(createdHousehold?.areaId, "CENTRAL");
});

test("creating a household rejects invalid latitude", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";

  const handler = createHandler({
    documentClient: {
      send: async () => ({}),
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-invalid-lat",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Invalid Latitude Household",
        location: {
          latitude: 145.4215,
          longitude: -75.6972,
        },
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

  assert.equal(response.statusCode, 400);
  assert.match(String(response.body), /Latitude must be between -90 and 90/);
});

test("creating a household rejects invalid longitude", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";

  const handler = createHandler({
    documentClient: {
      send: async () => ({}),
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-invalid-lng",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Invalid Longitude Household",
        location: {
          latitude: 45.4215,
          longitude: -195.6972,
        },
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

  assert.equal(response.statusCode, 400);
  assert.match(String(response.body), /Longitude must be between -180 and 180/);
});

test("existing household without location still reads successfully", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "GetCommand") {
          return {
            Item: {
              PK: "TENANT#tenant-abc",
              SK: "HOUSEHOLD#household-1",
              GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
              GSI4SK: "NAME#alpha household#HOUSEHOLD#household-1",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "HOUSEHOLD",
              tenantId: "tenant-abc",
              householdId: "household-1",
              householdName: "Alpha Household",
              address: "123 Main St",
              postalCode: "K2P 1L4",
              normalizedAddress: "123 MAIN ST",
              normalizedPostalCode: "K2P1L4",
              unit: undefined,
              addressKey: "123 MAIN ST|K2P1L4",
              notes: "No coordinates yet",
              memberCount: 0,
              primaryContactMemberId: undefined,
              members: [],
              normalizedSearchText: "alpha household 123 main st no coordinates yet",
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
    uuid: () => "unused",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households/household-1",
      pathParameters: { householdId: "household-1" },
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
  const body = JSON.parse(String(response.body));
  assert.equal(body.household.householdId, "household-1");
  assert.equal("location" in body.household, false);
});

test("updating a household preserves location fields through round-trip", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const existingHousehold = {
    PK: "TENANT#tenant-abc",
    SK: "HOUSEHOLD#household-1",
    GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
    GSI4SK: "NAME#alpha household#HOUSEHOLD#household-1",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    entityType: "HOUSEHOLD",
    tenantId: "tenant-abc",
    householdId: "household-1",
    householdName: "Alpha Household",
    address: "123 Main St",
    postalCode: "K2P 1L4",
    normalizedAddress: "123 MAIN ST",
    normalizedPostalCode: "K2P1L4",
    unit: undefined,
    addressKey: "123 MAIN ST|K2P1L4",
    notes: "Initial notes",
    location: {
      latitude: 45.4,
      longitude: -75.7,
      geocodeStatus: "pending",
      geocodedAt: "2026-06-01T09:00:00.000Z",
      geocodeProvider: "manual",
    },
    areaId: "area-old",
    memberCount: 0,
    primaryContactMemberId: undefined,
    members: [],
    normalizedSearchText: "alpha household 123 main st initial notes",
  };

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ input: command.input, name: command.constructor.name });

        if (command.constructor.name === "GetCommand") {
          return { Item: existingHousehold };
        }

        if (command.constructor.name === "QueryCommand") {
          return { Items: [] };
        }

        if (command.constructor.name === "BatchGetCommand") {
          return { Responses: { "records-table": [] } };
        }

        return {};
      },
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "unused",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households/household-1",
      pathParameters: { householdId: "household-1" },
      body: JSON.stringify({
        notes: "Updated notes",
        location: {
          latitude: 45.4215,
          longitude: -75.6972,
          geocodeStatus: "success",
          geocodedAt: "2026-06-03T11:45:00.000Z",
          geocodeProvider: "manual",
        },
        areaId: "area-central",
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
  const body = JSON.parse(String(response.body));
  assert.deepEqual(body.location, {
    latitude: 45.4215,
    longitude: -75.6972,
    geocodeStatus: "success",
    geocodedAt: "2026-06-03T11:45:00.000Z",
    geocodeProvider: "manual",
  });
  assert.equal(body.areaId, "CENTRAL");

  const transactWrite = commands.find((command) => command.name === "TransactWriteCommand");
  const updatedHousehold = (transactWrite?.input.TransactItems as Array<{ Put?: { Item?: Record<string, unknown> } }> | undefined)
    ?.find((item) => item.Put?.Item && item.Put.Item.SK === "HOUSEHOLD#household-1")
    ?.Put?.Item;
  assert.deepEqual(updatedHousehold?.location, {
    latitude: 45.4215,
    longitude: -75.6972,
    geocodeStatus: "success",
    geocodedAt: "2026-06-03T11:45:00.000Z",
    geocodeProvider: "manual",
  });
  assert.equal(updatedHousehold?.areaId, "CENTRAL");
});

test("creating a household geocodes the normalized address and stores the result", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.NOMINATIM_USER_AGENT = "ShepherdHub-Test/1.0";
  process.env.NOMINATIM_TIMEOUT_MS = "1500";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const documentClient = createInMemoryDocumentClient([], commands);
  let requestedUrl = "";
  let requestUserAgent = "";

  const handler = createHandler({
    documentClient,
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestUserAgent = String((init?.headers as Record<string, string> | undefined)?.["user-agent"] ?? "");
      return {
        ok: true,
        json: async () => [{ lat: "45.4215", lon: "-75.6972" }],
      } as Response;
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-geo-auto-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Auto Geocode Household",
        address: "123 Main St",
        postalCode: "K2P 1L4",
      }),
      requestContext: {
        authorizer: { jwt: { claims: { "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 201);
  const body = JSON.parse(String(response.body));
  assert.deepEqual(body.location, {
    latitude: 45.4215,
    longitude: -75.6972,
    geocodeStatus: "success",
    geocodedAt: "2026-06-03T12:00:00.000Z",
    geocodeProvider: "nominatim",
  });
  assert.match(requestedUrl, /\/search\?/);
  assert.match(requestedUrl, /q=123\+MAIN\+ST%2C\+K2P1L4/);
  assert.equal(requestUserAgent, "ShepherdHub-Test/1.0");

  const createdHousehold = commands
    .find((command) => command.name === "TransactWriteCommand")
    ?.input.TransactItems as Array<{ Put?: { Item?: Record<string, unknown> } }> | undefined;
  const initialLocation = createdHousehold
    ?.find((item) => item.Put?.Item?.SK === "HOUSEHOLD#addr_123-main-st__k2p1l4")
    ?.Put?.Item?.location;
  assert.deepEqual(initialLocation, {
    geocodeStatus: "pending",
    geocodeProvider: "nominatim",
  });

  const updatedHousehold = documentClient.items.get("TENANT#tenant-abc||HOUSEHOLD#addr_123-main-st__k2p1l4");
  assert.deepEqual(updatedHousehold?.location, body.location);
  const cacheItem = documentClient.items.get("GEOCODE_CACHE#ADDRESS#123 MAIN ST|K2P1L4||GEOCODE_CACHE");
  assert.equal(cacheItem?.geocodeStatus, "success");
});

test("no-result geocoding does not block household creation", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const documentClient = createInMemoryDocumentClient([], commands);

  const handler = createHandler({
    documentClient,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [],
    }) as Response,
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-no-result-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Missing Match Household",
        address: "999 Unknown Ave",
        postalCode: "K1A 0A1",
      }),
      requestContext: {
        authorizer: { jwt: { claims: { "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 201);
  const body = JSON.parse(String(response.body));
  assert.deepEqual(body.location, {
    geocodeStatus: "failed",
    geocodedAt: "2026-06-03T12:00:00.000Z",
    geocodeProvider: "nominatim",
  });
  assert.equal(documentClient.items.get("GEOCODE_CACHE#ADDRESS#999 UNKNOWN AVE|K1A0A1||GEOCODE_CACHE")?.failureReason, "no_result");
  assert.ok(commands.some((command) => command.name === "UpdateCommand"));
});

test("timeout geocoding does not block household creation", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const documentClient = createInMemoryDocumentClient([], commands);

  const handler = createHandler({
    documentClient,
    fetchImpl: async () => {
      const error = new Error("Timed out");
      error.name = "TimeoutError";
      throw error;
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-timeout-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Timeout Household",
        address: "100 Delay Rd",
        postalCode: "K1A 0B1",
      }),
      requestContext: {
        authorizer: { jwt: { claims: { "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 201);
  const body = JSON.parse(String(response.body));
  assert.deepEqual(body.location, {
    geocodeStatus: "failed",
    geocodedAt: "2026-06-03T12:00:00.000Z",
    geocodeProvider: "nominatim",
  });
  assert.equal(documentClient.items.has("GEOCODE_CACHE#ADDRESS#100 DELAY RD|K1A0B1||GEOCODE_CACHE"), false);
});

test("provider and invalid-coordinate geocoding failures still save households", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";

  const providerFailureClient = createInMemoryDocumentClient();
  const providerFailureHandler = createHandler({
    documentClient: providerFailureClient,
    fetchImpl: async () => ({
      ok: false,
      json: async () => [],
    }) as Response,
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-provider-failure-1",
  });

  const providerFailureResponse = await providerFailureHandler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Provider Failure Household",
        address: "101 Error Rd",
        postalCode: "K1A 0C1",
      }),
      requestContext: {
        authorizer: { jwt: { claims: { "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(providerFailureResponse.statusCode, 201);
  assert.equal(providerFailureClient.items.has("GEOCODE_CACHE#ADDRESS#101 ERROR RD|K1A0C1||GEOCODE_CACHE"), false);

  const invalidCoordinatesClient = createInMemoryDocumentClient();
  const invalidCoordinatesHandler = createHandler({
    documentClient: invalidCoordinatesClient,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ lat: "145.42", lon: "-75.69" }],
    }) as Response,
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "household-invalid-coords-1",
  });

  const invalidCoordinatesResponse = await invalidCoordinatesHandler(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Invalid Coords Household",
        address: "102 Invalid Rd",
        postalCode: "K1A 0D1",
      }),
      requestContext: {
        authorizer: { jwt: { claims: { "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(invalidCoordinatesResponse.statusCode, 201);
  const invalidCoordsBody = JSON.parse(String(invalidCoordinatesResponse.body));
  assert.deepEqual(invalidCoordsBody.location, {
    geocodeStatus: "failed",
    geocodedAt: "2026-06-03T12:00:00.000Z",
    geocodeProvider: "nominatim",
  });
  assert.equal(invalidCoordinatesClient.items.get("GEOCODE_CACHE#ADDRESS#102 INVALID RD|K1A0D1||GEOCODE_CACHE")?.failureReason, "invalid_coordinates");
});

test("geocode cache is reused for the same normalized address", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  let fetchCount = 0;
  const sharedCommands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const documentClient = createInMemoryDocumentClient([], sharedCommands);

  const createGeocodingHandler = (tenantId: string, householdId: string) => createHandler({
    documentClient,
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        json: async () => [{ lat: "45.4215", lon: "-75.6972" }],
      } as Response;
    },
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => householdId,
  });

  const firstResponse = await createGeocodingHandler("tenant-abc", "household-cache-1")(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Cache Household A",
        address: "123 Main St",
        postalCode: "K2P 1L4",
      }),
      requestContext: {
        authorizer: { jwt: { claims: { "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  const secondResponse = await createGeocodingHandler("tenant-def", "household-cache-2")(
    createEvent({
      rawPath: "/households",
      body: JSON.stringify({
        householdName: "Cache Household B",
        address: "123 Main St",
        postalCode: "K2P 1L4",
      }),
      requestContext: {
        authorizer: { jwt: { claims: { "custom:tenantId": "tenant-def", email: "owner@example.com", name: "Owner Example", sub: "user-456" } } },
        http: { method: "POST" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(firstResponse.statusCode, 201);
  assert.equal(secondResponse.statusCode, 201);
  assert.equal(fetchCount, 1);
});

test("updating a household address triggers automatic geocoding", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const existingHousehold = {
    PK: "TENANT#tenant-abc",
    SK: "HOUSEHOLD#household-1",
    GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
    GSI4SK: "NAME#alpha household#HOUSEHOLD#household-1",
    GSI2PK: "TENANT#tenant-abc#HOUSEHOLD_ADDRESS",
    GSI2SK: "ADDRESS#123 MAIN ST|K2P1L4",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    entityType: "HOUSEHOLD",
    tenantId: "tenant-abc",
    householdId: "household-1",
    householdName: "Alpha Household",
    address: "123 Main St",
    postalCode: "K2P 1L4",
    normalizedAddress: "123 MAIN ST",
    normalizedPostalCode: "K2P1L4",
    addressKey: "123 MAIN ST|K2P1L4",
    location: {
      latitude: 45.4,
      longitude: -75.7,
      geocodeStatus: "success",
      geocodedAt: "2026-06-01T09:00:00.000Z",
      geocodeProvider: "manual",
    },
    memberCount: 0,
    primaryContactMemberId: undefined,
    members: [],
    normalizedSearchText: "alpha household 123 main st",
  };
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const documentClient = createInMemoryDocumentClient([existingHousehold], commands);

  const handler = createHandler({
    documentClient,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ lat: "45.4300", lon: "-75.6800" }],
    }) as Response,
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "unused",
  });

  const response = await handler(
    createEvent({
      rawPath: "/households/household-1",
      pathParameters: { householdId: "household-1" },
      body: JSON.stringify({
        address: "456 Queen St",
        postalCode: "K1P 1N2",
      }),
      requestContext: {
        authorizer: { jwt: { claims: { "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } },
        http: { method: "PUT" },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(String(response.body));
  assert.deepEqual(body.location, {
    latitude: 45.43,
    longitude: -75.68,
    geocodeStatus: "success",
    geocodedAt: "2026-06-03T12:00:00.000Z",
    geocodeProvider: "nominatim",
  });

  const initialHouseholdWrite = commands
    .find((command) => command.name === "TransactWriteCommand")
    ?.input.TransactItems as Array<{ Put?: { Item?: Record<string, unknown> } }> | undefined;
  assert.deepEqual(
    initialHouseholdWrite?.find((item) => item.Put?.Item?.SK === "HOUSEHOLD#household-1")?.Put?.Item?.location,
    {
      geocodeStatus: "pending",
      geocodeProvider: "nominatim",
    },
  );
});

test("household geocode job skips already successful households", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    createHouseholdItem({
      householdId: "household-success",
      householdName: "Mapped Household",
      addressKey: "10 MAPLE ST|K2P1L4",
      location: {
        latitude: 45.42,
        longitude: -75.69,
        geocodeStatus: "success",
        geocodedAt: "2026-06-01T09:00:00.000Z",
        geocodeProvider: "nominatim",
      },
    }),
  ]);
  let fetchCount = 0;
  const uuids = ["geocode-job-1", "lease-1"];
  const handler = createHandler({
    documentClient,
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => [] } as Response;
    },
    now: () => "2026-08-14T13:00:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/household-geocoding",
      body: JSON.stringify({ mode: "unmapped_only" }),
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "POST" } },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  const body = JSON.parse(String(response.body));
  assert.equal(body.total, 0);
  assert.equal(body.status, "completed");
  assert.equal(fetchCount, 0);
});

test("household geocode job processes pending households", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    createHouseholdItem({
      householdId: "household-pending",
      householdName: "Pending Household",
      address: "11 Pine St",
      postalCode: "K2P 1L5",
      normalizedAddress: "11 PINE ST",
      normalizedPostalCode: "K2P1L5",
      addressKey: "11 PINE ST|K2P1L5",
      location: {
        geocodeStatus: "pending",
        geocodeProvider: "nominatim",
      },
    }),
  ]);
  const uuids = ["geocode-job-2", "lease-2"];
  const handler = createHandler({
    documentClient,
    fetchImpl: async () => ({ ok: true, json: async () => [{ lat: "45.4215", lon: "-75.6972" }] }) as Response,
    now: () => "2026-08-14T13:05:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding",
      body: JSON.stringify({ mode: "unmapped_only" }),
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "POST" } },
    }) as never,
    {} as never,
    () => undefined,
  );

  const response = await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-2",
      pathParameters: { jobId: "geocode-job-2" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  const body = JSON.parse(String(response.body));
  assert.equal(body.status, "completed");
  assert.equal(body.processed, 1);
  assert.equal(body.success, 1);
  assert.equal(body.failed, 0);
  assert.deepEqual(documentClient.items.get("TENANT#tenant-abc||HOUSEHOLD#household-pending")?.location, {
    latitude: 45.4215,
    longitude: -75.6972,
    geocodeStatus: "success",
    geocodedAt: "2026-08-14T13:05:00.000Z",
    geocodeProvider: "nominatim",
  });
});

test("household geocode job retries failed households only when requested", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    createHouseholdItem({
      householdId: "household-failed",
      householdName: "Failed Household",
      address: "12 Birch St",
      postalCode: "K2P 1L6",
      normalizedAddress: "12 BIRCH ST",
      normalizedPostalCode: "K2P1L6",
      addressKey: "12 BIRCH ST|K2P1L6",
      location: {
        geocodeStatus: "failed",
        geocodedAt: "2026-08-10T10:00:00.000Z",
        geocodeProvider: "nominatim",
      },
    }),
  ]);
  let fetchCount = 0;
  const uuids = ["geocode-job-3", "lease-3", "geocode-job-4", "lease-4"];
  const handler = createHandler({
    documentClient,
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => [{ lat: "45.43", lon: "-75.68" }] } as Response;
    },
    now: () => "2026-08-14T13:10:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  const unmappedResponse = await handler(
    createEvent({
      rawPath: "/admin/household-geocoding",
      body: JSON.stringify({ mode: "unmapped_only" }),
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "POST" } },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;
  assert.equal(JSON.parse(String(unmappedResponse.body)).total, 0);

  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding",
      body: JSON.stringify({ mode: "retry_failed" }),
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "POST" } },
    }) as never,
    {} as never,
    () => undefined,
  );

  const retryResponse = await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-4",
      pathParameters: { jobId: "geocode-job-4" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  const body = JSON.parse(String(retryResponse.body));
  assert.equal(body.success, 1);
  assert.equal(fetchCount, 1);
});

test("household geocode job respects rate limiting between live requests", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    createHouseholdItem({
      householdId: "household-a",
      householdName: "Household A",
      address: "13 Cedar St",
      postalCode: "K2P 1L7",
      normalizedAddress: "13 CEDAR ST",
      normalizedPostalCode: "K2P1L7",
      addressKey: "13 CEDAR ST|K2P1L7",
      location: { geocodeStatus: "pending", geocodeProvider: "nominatim" },
    }),
    createHouseholdItem({
      householdId: "household-b",
      householdName: "Household B",
      address: "14 Cedar St",
      postalCode: "K2P 1L8",
      normalizedAddress: "14 CEDAR ST",
      normalizedPostalCode: "K2P1L8",
      addressKey: "14 CEDAR ST|K2P1L8",
      location: { geocodeStatus: "pending", geocodeProvider: "nominatim" },
      SK: "HOUSEHOLD#household-b",
      GSI4SK: "NAME#household b#HOUSEHOLD#household-b",
    }),
  ]);
  const uuids = ["geocode-job-5", "lease-5", "lease-6"];
  const callTimes: number[] = [];
  const handler = createHandler({
    documentClient,
    fetchImpl: async () => {
      callTimes.push(Date.now());
      return { ok: true, json: async () => [{ lat: "45.43", lon: "-75.68" }] } as Response;
    },
    now: () => "2026-08-14T13:15:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding",
      body: JSON.stringify({ mode: "unmapped_only" }),
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "POST" } },
    }) as never,
    {} as never,
    () => undefined,
  );

  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-5",
      pathParameters: { jobId: "geocode-job-5" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  );
  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-5",
      pathParameters: { jobId: "geocode-job-5" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  );

  assert.equal(callTimes.length, 2);
  assert.ok(callTimes[1]! - callTimes[0]! >= 900);
});

test("household geocode job reuses cached addresses", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    createHouseholdItem({
      householdId: "household-cache",
      householdName: "Cache Household",
      address: "15 Elm St",
      postalCode: "K2P 1L9",
      normalizedAddress: "15 ELM ST",
      normalizedPostalCode: "K2P1L9",
      addressKey: "15 ELM ST|K2P1L9",
      location: { geocodeStatus: "pending", geocodeProvider: "nominatim" },
    }),
    {
      PK: "GEOCODE_CACHE#ADDRESS#15 ELM ST|K2P1L9",
      SK: "GEOCODE_CACHE",
      createdAt: "2026-08-13T10:00:00.000Z",
      updatedAt: "2026-08-13T10:00:00.000Z",
      entityType: "GEOCODE_CACHE",
      addressKey: "15 ELM ST|K2P1L9",
      normalizedAddress: "15 ELM ST",
      normalizedPostalCode: "K2P1L9",
      geocodeStatus: "success",
      latitude: 45.41,
      longitude: -75.71,
      geocodedAt: "2026-08-13T10:00:00.000Z",
      geocodeProvider: "nominatim",
    },
  ]);
  let fetchCount = 0;
  const uuids = ["geocode-job-6", "lease-7"];
  const handler = createHandler({
    documentClient,
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => [] } as Response;
    },
    now: () => "2026-08-14T13:20:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding",
      body: JSON.stringify({ mode: "unmapped_only" }),
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "POST" } },
    }) as never,
    {} as never,
    () => undefined,
  );
  const response = await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-6",
      pathParameters: { jobId: "geocode-job-6" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(fetchCount, 0);
  assert.equal(JSON.parse(String(response.body)).success, 1);
  assert.deepEqual(documentClient.items.get("TENANT#tenant-abc||HOUSEHOLD#household-cache")?.location, {
    latitude: 45.41,
    longitude: -75.71,
    geocodeStatus: "success",
    geocodedAt: "2026-08-13T10:00:00.000Z",
    geocodeProvider: "nominatim",
  });
});

test("household geocode job continues after one address fails", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    createHouseholdItem({
      householdId: "household-fail-1",
      householdName: "Fail Household",
      address: "16 Oak St",
      postalCode: "K2P 1M0",
      normalizedAddress: "16 OAK ST",
      normalizedPostalCode: "K2P1M0",
      addressKey: "16 OAK ST|K2P1M0",
      location: { geocodeStatus: "pending", geocodeProvider: "nominatim" },
    }),
    createHouseholdItem({
      householdId: "household-success-2",
      householdName: "Success Household",
      address: "17 Oak St",
      postalCode: "K2P 1M1",
      normalizedAddress: "17 OAK ST",
      normalizedPostalCode: "K2P1M1",
      addressKey: "17 OAK ST|K2P1M1",
      location: { geocodeStatus: "pending", geocodeProvider: "nominatim" },
      SK: "HOUSEHOLD#household-success-2",
      GSI4SK: "NAME#success household#HOUSEHOLD#household-success-2",
    }),
  ]);
  const uuids = ["geocode-job-7", "lease-8", "lease-9"];
  let callIndex = 0;
  const handler = createHandler({
    documentClient,
    fetchImpl: async () => {
      callIndex += 1;
      return callIndex === 1
        ? ({ ok: true, json: async () => [] } as Response)
        : ({ ok: true, json: async () => [{ lat: "45.44", lon: "-75.67" }] } as Response);
    },
    now: () => "2026-08-14T13:25:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding",
      body: JSON.stringify({ mode: "unmapped_only" }),
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "POST" } },
    }) as never,
    {} as never,
    () => undefined,
  );
  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-7",
      pathParameters: { jobId: "geocode-job-7" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  );
  const response = await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-7",
      pathParameters: { jobId: "geocode-job-7" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  const body = JSON.parse(String(response.body));
  assert.equal(body.processed, 2);
  assert.equal(body.success, 1);
  assert.equal(body.failed, 1);
  assert.equal(body.status, "completed");
});

test("household geocode job processing is idempotent after completion", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const documentClient = createInMemoryDocumentClient([
    createHouseholdItem({
      householdId: "household-idempotent",
      householdName: "Idempotent Household",
      address: "18 Spruce St",
      postalCode: "K2P 1M2",
      normalizedAddress: "18 SPRUCE ST",
      normalizedPostalCode: "K2P1M2",
      addressKey: "18 SPRUCE ST|K2P1M2",
      location: { geocodeStatus: "pending", geocodeProvider: "nominatim" },
    }),
  ]);
  let fetchCount = 0;
  const uuids = ["geocode-job-8", "lease-10"];
  const handler = createHandler({
    documentClient,
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => [{ lat: "45.45", lon: "-75.66" }] } as Response;
    },
    now: () => "2026-08-14T13:30:00.000Z",
    uuid: () => uuids.shift() ?? "fallback-id",
  });

  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding",
      body: JSON.stringify({ mode: "unmapped_only" }),
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "POST" } },
    }) as never,
    {} as never,
    () => undefined,
  );
  await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-8",
      pathParameters: { jobId: "geocode-job-8" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  );
  const response = await handler(
    createEvent({
      rawPath: "/admin/household-geocoding/geocode-job-8",
      pathParameters: { jobId: "geocode-job-8" },
      requestContext: { authorizer: { jwt: { claims: { "cognito:groups": ["admin"], "custom:tenantId": "tenant-abc", email: "owner@example.com", name: "Owner Example", sub: "user-123" } } }, http: { method: "GET" } },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(fetchCount, 1);
  const body = JSON.parse(String(response.body));
  assert.equal(body.processed, 1);
  assert.equal(body.status, "completed");
});

test("visitation geography report aggregates households and excludes unmapped coordinates", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";

  const households = [
    {
      PK: "TENANT#tenant-abc",
      SK: "HOUSEHOLD#household-1",
      GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
      GSI4SK: "NAME#alpha household#HOUSEHOLD#household-1",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T09:00:00.000Z",
      entityType: "HOUSEHOLD",
      tenantId: "tenant-abc",
      householdId: "household-1",
      householdName: "Alpha Household",
      memberCount: 2,
      members: [
        {
          memberId: "member-1",
          fullName: "Member One",
          initials: "MO",
          householdId: "household-1",
          householdName: "Alpha Household",
        },
        {
          memberId: "member-2",
          fullName: "Member Two",
          initials: "MT",
          householdId: "household-1",
          householdName: "Alpha Household",
        },
      ],
      normalizedSearchText: "alpha household",
      location: {
        latitude: 45.4215,
        longitude: -75.6972,
      },
      areaId: "area-central",
    },
    {
      PK: "TENANT#tenant-abc",
      SK: "HOUSEHOLD#household-2",
      GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
      GSI4SK: "NAME#beta household#HOUSEHOLD#household-2",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T09:00:00.000Z",
      entityType: "HOUSEHOLD",
      tenantId: "tenant-abc",
      householdId: "household-2",
      householdName: "Beta Household",
      memberCount: 1,
      members: [
        {
          memberId: "member-3",
          fullName: "Member Three",
          initials: "MT",
          householdId: "household-2",
          householdName: "Beta Household",
        },
      ],
      normalizedSearchText: "beta household",
      location: {
        latitude: 45.45,
        longitude: -75.61,
      },
    },
    {
      PK: "TENANT#tenant-abc",
      SK: "HOUSEHOLD#household-3",
      GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
      GSI4SK: "NAME#gamma household#HOUSEHOLD#household-3",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T09:00:00.000Z",
      entityType: "HOUSEHOLD",
      tenantId: "tenant-abc",
      householdId: "household-3",
      householdName: "Gamma Household",
      memberCount: 1,
      members: [
        {
          memberId: "member-4",
          fullName: "Member Four",
          initials: "MF",
          householdId: "household-3",
          householdName: "Gamma Household",
        },
      ],
      normalizedSearchText: "gamma household",
    },
  ];

  const visitations = [
    {
      PK: "TENANT#tenant-abc#VISITATION#visit-1",
      SK: "MEMBER#member-1",
      GSI1PK: "TENANT#tenant-abc",
      GSI1SK: "VISIT#2026-06-10T10:00:00.000Z#VISITOR#user-1#MEMBER#member-1#VISITATION#visit-1",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
      entityType: "VISITATION",
      tenantId: "tenant-abc",
      visitationId: "visit-1",
      source: "manual",
      memberId: "member-1",
      memberIds: ["member-1"],
      memberNames: ["Member One"],
      visitorUserId: "user-1",
      visitorDisplayName: "Visitor A",
      createdByUserId: "user-1",
      createdByName: "Visitor A",
      visitDate: "2026-06-10T10:00:00.000Z",
      title: "Visit 1",
      visitStatus: "completed",
      type: "Visitation",
    },
    {
      PK: "TENANT#tenant-abc#VISITATION#visit-2",
      SK: "MEMBER#member-2",
      GSI1PK: "TENANT#tenant-abc",
      GSI1SK: "VISIT#2026-06-12T10:00:00.000Z#VISITOR#user-1#MEMBER#member-2#VISITATION#visit-2",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T10:00:00.000Z",
      entityType: "VISITATION",
      tenantId: "tenant-abc",
      visitationId: "visit-2",
      source: "manual",
      memberId: "member-2",
      memberIds: ["member-2"],
      memberNames: ["Member Two"],
      visitorUserId: "user-1",
      visitorDisplayName: "Visitor A",
      createdByUserId: "user-1",
      createdByName: "Visitor A",
      visitDate: "2026-06-12T10:00:00.000Z",
      title: "Visit 2",
      visitStatus: "completed",
      type: "Visitation",
    },
    {
      PK: "TENANT#tenant-abc#VISITATION#visit-3",
      SK: "MEMBER#member-2",
      GSI1PK: "TENANT#tenant-abc",
      GSI1SK: "VISIT#2026-06-18T10:00:00.000Z#VISITOR#user-2#MEMBER#member-2#VISITATION#visit-3",
      createdAt: "2026-06-18T10:00:00.000Z",
      updatedAt: "2026-06-18T10:00:00.000Z",
      entityType: "VISITATION",
      tenantId: "tenant-abc",
      visitationId: "visit-3",
      source: "manual",
      memberId: "member-2",
      memberIds: ["member-2"],
      memberNames: ["Member Two"],
      visitorUserId: "user-2",
      visitorDisplayName: "Visitor B",
      createdByUserId: "user-2",
      createdByName: "Visitor B",
      visitDate: "2026-06-18T10:00:00.000Z",
      title: "Visit 3",
      visitStatus: "completed",
      type: "Phone Call",
    },
  ];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "QueryCommand") {
          const expressionValues = command.input.ExpressionAttributeValues as Record<string, unknown> | undefined;
          if (command.input.IndexName === "GSI4") {
            return { Items: households };
          }

          if (command.input.IndexName === "GSI1" && expressionValues?.[":gsiPk"] === "TENANT#tenant-abc") {
            return { Items: visitations };
          }
        }

        return {};
      },
    },
    now: () => "2026-08-13T12:00:00.000Z",
    uuid: () => "unused",
  });

  const response = await handler(
    createEvent({
      rawPath: "/reports/visitation-geography",
      queryStringParameters: {
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-30T23:59:59.999Z",
        sinceBeginning: "false",
      },
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
  const body = JSON.parse(String(response.body));

  assert.deepEqual(body.summary, {
    totalMembers: 4,
    totalHouseholds: 3,
    visitedHouseholds: 1,
    notVisitedHouseholds: 2,
    coverage: (1 / 3) * 100,
    visitations: 3,
    mappedHouseholds: 2,
    unmappedHouseholds: 1,
  });

  assert.equal(body.households.type, "FeatureCollection");
  assert.equal(body.households.features.length, 2);
  assert.deepEqual(body.areas, [
    {
      areaId: "KANATA",
      areaName: "Kanata",
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    },
    {
      areaId: "NEPEAN",
      areaName: "Nepean",
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    },
    {
      areaId: "BARRHAVEN",
      areaName: "Barrhaven",
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    },
    {
      areaId: "ORLEANS",
      areaName: "Orleans",
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    },
    {
      areaId: "CENTRAL",
      areaName: "Central",
      members: 2,
      households: 1,
      visited: 1,
      notVisited: 0,
      visitations: 3,
      coverage: 100,
    },
    {
      areaId: "GLOUCESTER",
      areaName: "Gloucester",
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    },
    {
      areaId: "SOUTH_OTTAWA",
      areaName: "South Ottawa",
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    },
    {
      areaId: "GATINEAU",
      areaName: "Gatineau",
      members: 0,
      households: 0,
      visited: 0,
      notVisited: 0,
      visitations: 0,
      coverage: 0,
    },
    {
      areaId: "UNASSIGNED",
      areaName: "Other / Unassigned",
      members: 2,
      households: 2,
      visited: 0,
      notVisited: 2,
      visitations: 0,
      coverage: 0,
    },
  ]);

  const alphaFeature = body.households.features.find((feature: { properties: { householdId: string } }) => feature.properties.householdId === "household-1");
  const betaFeature = body.households.features.find((feature: { properties: { householdId: string } }) => feature.properties.householdId === "household-2");
  const gammaFeature = body.households.features.find((feature: { properties: { householdId: string } }) => feature.properties.householdId === "household-3");

  assert.deepEqual(alphaFeature.geometry.coordinates, [-75.6972, 45.4215]);
  assert.deepEqual(alphaFeature.properties, {
    householdId: "household-1",
    memberNames: ["Member One", "Member Two"],
    memberCount: 2,
    visited: 1,
    visitCount: 3,
    lastVisitDate: "2026-06-18T10:00:00.000Z",
    lastVisitedBy: "Visitor B",
    areaId: "CENTRAL",
  });
  assert.deepEqual(betaFeature.properties, {
    householdId: "household-2",
    memberNames: ["Member Three"],
    memberCount: 1,
    visited: 0,
    visitCount: 0,
    areaId: "UNASSIGNED",
  });
  assert.equal(gammaFeature, undefined);
});

test("visitation geography report respects date filters", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";

  const households = [
    {
      PK: "TENANT#tenant-abc",
      SK: "HOUSEHOLD#household-1",
      GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
      GSI4SK: "NAME#alpha household#HOUSEHOLD#household-1",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T09:00:00.000Z",
      entityType: "HOUSEHOLD",
      tenantId: "tenant-abc",
      householdId: "household-1",
      householdName: "Alpha Household",
      memberCount: 1,
      members: [
        {
          memberId: "member-1",
          fullName: "Member One",
          initials: "MO",
          householdId: "household-1",
          householdName: "Alpha Household",
        },
      ],
      normalizedSearchText: "alpha household",
      location: {
        latitude: 45.4215,
        longitude: -75.6972,
      },
    },
  ];

  const visitations = [
    {
      PK: "TENANT#tenant-abc#VISITATION#visit-old",
      SK: "MEMBER#member-1",
      GSI1PK: "TENANT#tenant-abc",
      GSI1SK: "VISIT#2026-01-10T10:00:00.000Z#VISITOR#user-1#MEMBER#member-1#VISITATION#visit-old",
      createdAt: "2026-01-10T10:00:00.000Z",
      updatedAt: "2026-01-10T10:00:00.000Z",
      entityType: "VISITATION",
      tenantId: "tenant-abc",
      visitationId: "visit-old",
      source: "manual",
      memberId: "member-1",
      memberIds: ["member-1"],
      memberNames: ["Member One"],
      visitorUserId: "user-1",
      visitorDisplayName: "Visitor A",
      createdByUserId: "user-1",
      createdByName: "Visitor A",
      visitDate: "2026-01-10T10:00:00.000Z",
      title: "Old Visit",
      visitStatus: "completed",
      type: "Visitation",
    },
    {
      PK: "TENANT#tenant-abc#VISITATION#visit-new",
      SK: "MEMBER#member-1",
      GSI1PK: "TENANT#tenant-abc",
      GSI1SK: "VISIT#2026-07-10T10:00:00.000Z#VISITOR#user-1#MEMBER#member-1#VISITATION#visit-new",
      createdAt: "2026-07-10T10:00:00.000Z",
      updatedAt: "2026-07-10T10:00:00.000Z",
      entityType: "VISITATION",
      tenantId: "tenant-abc",
      visitationId: "visit-new",
      source: "manual",
      memberId: "member-1",
      memberIds: ["member-1"],
      memberNames: ["Member One"],
      visitorUserId: "user-1",
      visitorDisplayName: "Visitor A",
      createdByUserId: "user-1",
      createdByName: "Visitor A",
      visitDate: "2026-07-10T10:00:00.000Z",
      title: "New Visit",
      visitStatus: "completed",
      type: "Visitation",
    },
  ];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "QueryCommand") {
          const expressionValues = command.input.ExpressionAttributeValues as Record<string, unknown> | undefined;
          if (command.input.IndexName === "GSI4") {
            return { Items: households };
          }

          if (command.input.IndexName === "GSI1" && expressionValues?.[":gsiPk"] === "TENANT#tenant-abc") {
            return { Items: visitations };
          }
        }

        return {};
      },
    },
    now: () => "2026-08-13T12:00:00.000Z",
    uuid: () => "unused",
  });

  const response = await handler(
    createEvent({
      rawPath: "/reports/visitation-geography",
      queryStringParameters: {
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-31T23:59:59.999Z",
        sinceBeginning: "false",
      },
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
  const body = JSON.parse(String(response.body));
  assert.equal(body.summary.visitedHouseholds, 1);
  assert.equal(body.summary.visitations, 1);
  assert.equal(body.households.features[0].properties.visitCount, 1);
  assert.equal(body.households.features[0].properties.lastVisitDate, "2026-07-10T10:00:00.000Z");
});

test("resolving a household conflict by creating a new household reassigns the member", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const member = {
    PK: "TENANT#tenant-abc",
    SK: "MEMBER#member-1",
    GSI1PK: "TENANT#tenant-abc#MEMBERS",
    GSI1SK: "NAME#abanoub otros#MEMBER#member-1",
    GSI5PK: "TENANT#tenant-abc#HOUSEHOLD#household-current",
    GSI5SK: "NAME#abanoub otros#MEMBER#member-1",
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "MEMBER",
    tenantId: "tenant-abc",
    memberId: "member-1",
    source: "MANUAL",
    isUnityMember: false,
    householdId: "household-current",
    householdName: "603 Ottawa St Household",
    fullName: "Abanoub Otros",
    firstName: "Abanoub",
    lastName: "Otros",
    initials: "AO",
    address: "603 Ottawa St",
    postalCode: "K1Z 5H6",
    normalizedSearchText: "abanoub otros",
  };
  const currentHousehold = {
    PK: "TENANT#tenant-abc",
    SK: "HOUSEHOLD#household-current",
    GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
    GSI4SK: "NAME#603 ottawa st household#HOUSEHOLD#household-current",
    GSI2PK: "TENANT#tenant-abc#HOUSEHOLD_ADDRESS",
    GSI2SK: "ADDRESS#603 ottawa st|K1Z5H6",
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "HOUSEHOLD",
    tenantId: "tenant-abc",
    householdId: "household-current",
    householdName: "603 Ottawa St Household",
    address: "603 Ottawa St",
    postalCode: "K1Z 5H6",
    addressKey: "603 ottawa st|K1Z5H6",
    memberCount: 1,
    primaryContactMemberId: "member-1",
    memberIds: ["member-1"],
  };
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, any> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };

          if (key.SK === "HOUSEHOLD_CONFLICT#MEMBER#member-1") {
            return {
              Item: {
                PK: "TENANT#tenant-abc",
                SK: "HOUSEHOLD_CONFLICT#MEMBER#member-1",
                createdAt: "2026-08-12T20:47:24.000Z",
                updatedAt: "2026-08-12T20:47:24.000Z",
                entityType: "HOUSEHOLD_CONFLICT",
                tenantId: "tenant-abc",
                memberId: "member-1",
                memberFullName: "Abanoub Otros",
                currentHouseholdId: "household-current",
                currentHouseholdName: "603 Ottawa St Household",
                currentHouseholdAddress: "603 Ottawa St",
                currentHouseholdAddressKey: "603 ottawa st|K1Z5H6",
                importedAddress: "457 Ottawa St",
                importedPostalCode: "K1F5H1",
              },
            };
          }

          if (key.SK === "MEMBER#member-1") {
            return { Item: member };
          }

          if (key.SK === "HOUSEHOLD#household-current") {
            return { Item: currentHousehold };
          }

          return {};
        }

        if (command.constructor.name === "BatchGetCommand") {
          return {
            Responses: {
              "records-table": [member],
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          if (command.input.IndexName === "GSI2") {
            return { Items: [] };
          }

          if (
            command.input.IndexName === "GSI5"
            && command.input.ExpressionAttributeValues?.[":gsiPk"] === "TENANT#tenant-abc#HOUSEHOLD#household-current"
          ) {
            return { Items: [member] };
          }

          return { Items: [] };
        }

        return {};
      },
    },
    now: () => "2026-08-12T20:52:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/household-conflicts/member-1/resolve",
      pathParameters: { memberId: "member-1" },
      body: JSON.stringify({ action: "CREATE_NEW_HOUSEHOLD" }),
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
  assert.match(String(response.body), /457 Ottawa St/);
  assert.equal(commands.some((command) => command.name === "TransactWriteCommand"), true);
  assert.equal(commands.some((command) => command.name === "DeleteCommand"), true);
});

test("resolving a household conflict by creating a new household reuses an existing matching household", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const member = {
    PK: "TENANT#tenant-abc",
    SK: "MEMBER#member-1",
    GSI1PK: "TENANT#tenant-abc#MEMBERS",
    GSI1SK: "NAME#aaron ghaly#MEMBER#member-1",
    GSI5PK: "TENANT#tenant-abc#HOUSEHOLD#household-current",
    GSI5SK: "NAME#aaron ghaly#MEMBER#member-1",
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "MEMBER",
    tenantId: "tenant-abc",
    memberId: "member-1",
    source: "MANUAL",
    isUnityMember: false,
    householdId: "household-current",
    householdName: "895 Ottawa St Household",
    fullName: "Aaron Ghaly",
    firstName: "Aaron",
    lastName: "Ghaly",
    initials: "AG",
    address: "895 Ottawa St",
    postalCode: "K1Z 5H6",
    normalizedSearchText: "aaron ghaly",
  };
  const currentHousehold = {
    PK: "TENANT#tenant-abc",
    SK: "HOUSEHOLD#household-current",
    GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
    GSI4SK: "NAME#895 ottawa st household#HOUSEHOLD#household-current",
    GSI2PK: "TENANT#tenant-abc#HOUSEHOLD_ADDRESS",
    GSI2SK: "ADDRESS#895 ottawa st|K1Z5H6",
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "HOUSEHOLD",
    tenantId: "tenant-abc",
    householdId: "household-current",
    householdName: "895 Ottawa St Household",
    address: "895 Ottawa St",
    postalCode: "K1Z 5H6",
    addressKey: "895 ottawa st|K1Z5H6",
    memberCount: 1,
    primaryContactMemberId: "member-1",
    memberIds: ["member-1"],
  };
  const existingMatchedHousehold = {
    PK: "TENANT#tenant-abc",
    SK: "HOUSEHOLD#household-match",
    GSI4PK: "TENANT#tenant-abc#HOUSEHOLDS",
    GSI4SK: "NAME#1027 ottawa st household#HOUSEHOLD#household-match",
    GSI2PK: "TENANT#tenant-abc#HOUSEHOLD_ADDRESS",
    GSI2SK: "ADDRESS#1027 ottawa st|K1Z5H6",
    createdAt: "2026-06-03T12:00:00.000Z",
    updatedAt: "2026-06-03T12:00:00.000Z",
    entityType: "HOUSEHOLD",
    tenantId: "tenant-abc",
    householdId: "household-match",
    householdName: "1027 Ottawa St Household",
    address: "1027 Ottawa St",
    postalCode: "K1Z 5H6",
    addressKey: "1027 ottawa st|K1Z5H6",
    memberCount: 0,
    memberIds: [],
  };
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, any> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };

          if (key.SK === "HOUSEHOLD_CONFLICT#MEMBER#member-1") {
            return {
              Item: {
                PK: "TENANT#tenant-abc",
                SK: "HOUSEHOLD_CONFLICT#MEMBER#member-1",
                createdAt: "2026-08-12T20:47:24.000Z",
                updatedAt: "2026-08-12T20:47:24.000Z",
                entityType: "HOUSEHOLD_CONFLICT",
                tenantId: "tenant-abc",
                memberId: "member-1",
                memberFullName: "Aaron Ghaly",
                currentHouseholdId: "household-current",
                currentHouseholdName: "895 Ottawa St Household",
                currentHouseholdAddress: "895 Ottawa St",
                currentHouseholdAddressKey: "895 ottawa st|K1Z5H6",
                importedAddress: "1027 Ottawa St",
                importedPostalCode: "K1Z5H6",
              },
            };
          }

          if (key.SK === "MEMBER#member-1") {
            return { Item: member };
          }

          if (key.SK === "HOUSEHOLD#household-current") {
            return { Item: currentHousehold };
          }

          if (key.SK === "HOUSEHOLD#household-match") {
            return { Item: existingMatchedHousehold };
          }

          return {};
        }

        if (command.constructor.name === "BatchGetCommand") {
          return {
            Responses: {
              "records-table": [member],
            },
          };
        }

        if (command.constructor.name === "QueryCommand") {
          if (command.input.IndexName === "GSI2") {
            return { Items: [existingMatchedHousehold] };
          }

          if (
            command.input.IndexName === "GSI5"
            && command.input.ExpressionAttributeValues?.[":gsiPk"] === "TENANT#tenant-abc#HOUSEHOLD#household-current"
          ) {
            return { Items: [member] };
          }

          if (
            command.input.IndexName === "GSI5"
            && command.input.ExpressionAttributeValues?.[":gsiPk"] === "TENANT#tenant-abc#HOUSEHOLD#household-match"
          ) {
            return { Items: [] };
          }

          return { Items: [] };
        }

        return {};
      },
    },
    now: () => "2026-08-12T21:26:34.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/household-conflicts/member-1/resolve",
      pathParameters: { memberId: "member-1" },
      body: JSON.stringify({ action: "CREATE_NEW_HOUSEHOLD" }),
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
  assert.match(String(response.body), /1027 Ottawa St Household/);
  assert.equal(
    commands.some(
      (command) =>
        command.name === "GetCommand"
        && (command.input.Key as { PK: string; SK: string }).SK === "HOUSEHOLD#household-match",
    ),
    true,
  );
  assert.equal(commands.some((command) => command.name === "DeleteCommand"), true);
});

test("member responses ignore legacy role and status fields from stored items", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
      tagIds: [],
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

test("deleting a member preserves other auto-linked members on the same event", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

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
                source: "UNITY",
                isUnityMember: true,
                fullName: "Adel Abraham",
                firstName: "Adel",
                lastName: "Abraham",
                initials: "AA",
                email: "adel@example.com",
                normalizedSearchText: "adel abraham adel@example.com",
              },
            };
          }

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
                googleEventId: "event-1",
                calendarName: "Main Calendar",
                summary: "Meeting with adel@example.com and mary@example.com",
                attendees: ["adel@example.com", "mary@example.com"],
                start: "2026-06-04T15:00:00.000Z",
                end: "2026-06-04T16:00:00.000Z",
                allDay: false,
                status: "confirmed",
                source: "GOOGLE",
                autoLinkedMemberIds: ["member-1", "member-2"],
                autoLinkedMemberNames: ["Adel Abraham", "Mary Smith"],
                dismissedAutoLinkedMemberIds: [],
                autoLinkedVisitationType: "Meeting",
                memberIds: [],
                memberNames: [],
              },
            };
          }

          return {};
        }

        if (command.constructor.name === "QueryCommand") {
          const values = command.input.ExpressionAttributeValues as Record<string, string>;

          if (values[":gsiPk"] === "TENANT#tenant-abc#MEMBER#member-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  type: "Meeting",
                  memberId: "member-1",
                  memberIds: ["member-1", "member-2"],
                  memberNames: ["Adel Abraham", "Mary Smith"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Owner Example",
                  createdByUserId: "user-123",
                  createdByName: "Owner Example",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  title: "Meeting with adel@example.com and mary@example.com",
                  endDate: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  visitStatus: "scheduled",
                  eventId: "event-1",
                  calendarEventId: "event-1",
                  calendarId: "calendar-1",
                  calendarOwnerUserId: "user-123",
                  calendarOwnerName: "Owner Example",
                },
              ],
            };
          }

          if (values[":pk"] === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  type: "Meeting",
                  memberId: "member-1",
                  memberIds: ["member-1", "member-2"],
                  memberNames: ["Adel Abraham", "Mary Smith"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Owner Example",
                  createdByUserId: "user-123",
                  createdByName: "Owner Example",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  title: "Meeting with adel@example.com and mary@example.com",
                  endDate: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  visitStatus: "scheduled",
                  eventId: "event-1",
                  calendarEventId: "event-1",
                  calendarId: "calendar-1",
                  calendarOwnerUserId: "user-123",
                  calendarOwnerName: "Owner Example",
                },
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  type: "Meeting",
                  memberId: "member-2",
                  memberIds: ["member-1", "member-2"],
                  memberNames: ["Adel Abraham", "Mary Smith"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Owner Example",
                  createdByUserId: "user-123",
                  createdByName: "Owner Example",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  title: "Meeting with adel@example.com and mary@example.com",
                  endDate: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  visitStatus: "scheduled",
                  eventId: "event-1",
                  calendarEventId: "event-1",
                  calendarId: "calendar-1",
                  calendarOwnerUserId: "user-123",
                  calendarOwnerName: "Owner Example",
                },
              ],
            };
          }

          return { Items: [] };
        }

        if (command.constructor.name === "BatchGetCommand") {
          const requestItems = command.input.RequestItems as Record<string, { Keys?: Array<{ PK: string; SK: string }> }>;
          const keys = requestItems["records-table"]?.Keys ?? [];
          const responses = keys
            .filter((key) => key.SK === "MEMBER#member-2")
            .map(() => ({
              PK: "TENANT#tenant-abc",
              SK: "MEMBER#member-2",
              createdAt: "2026-06-03T12:00:00.000Z",
              updatedAt: "2026-06-03T12:00:00.000Z",
              entityType: "MEMBER",
              tenantId: "tenant-abc",
              memberId: "member-2",
              source: "UNITY",
              isUnityMember: true,
              fullName: "Mary Smith",
              firstName: "Mary",
              lastName: "Smith",
              initials: "MS",
              email: "mary@example.com",
              normalizedSearchText: "mary smith mary@example.com",
            }));

          return { Responses: { "records-table": responses } };
        }

        return {};
      },
    },
    now: () => "2026-06-03T13:00:00.000Z",
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
          method: "DELETE",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(String(response.body)), { deleted: true, memberId: "member-1" });

  const eventPut = commands.find(
    (command) =>
      command.name === "PutCommand"
      && (command.input.Item as { entityType?: string } | undefined)?.entityType === "schedule_event",
  );
  assert.deepEqual((eventPut?.input.Item as { autoLinkedMemberIds?: string[] }).autoLinkedMemberIds, ["member-2"]);
  assert.deepEqual((eventPut?.input.Item as { autoLinkedMemberNames?: string[] }).autoLinkedMemberNames, ["Mary Smith"]);

  const visitationPut = commands.find(
    (command) =>
      command.name === "PutCommand"
      && (command.input.Item as { entityType?: string; memberId?: string } | undefined)?.entityType === "VISITATION"
      && (command.input.Item as { memberId?: string } | undefined)?.memberId === "member-2",
  );
  assert.deepEqual((visitationPut?.input.Item as { memberIds?: string[] }).memberIds, ["member-2"]);
  assert.deepEqual((visitationPut?.input.Item as { memberNames?: string[] }).memberNames, ["Mary Smith"]);
});

test("members index returns only lightweight list fields for the tenant", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "QueryCommand") {
          return {
            Items: [
              {
                PK: "TENANT#tenant-abc",
                SK: "MEMBER#member-1",
                GSI1PK: "TENANT#tenant-abc#MEMBERS",
                GSI1SK: "NAME#adel abraham#MEMBER#member-1",
                createdAt: "2026-06-03T12:00:00.000Z",
                updatedAt: "2026-06-08T12:00:00.000Z",
                entityType: "MEMBER",
                tenantId: "tenant-abc",
                memberId: "member-1",
                unityId: "17317",
                source: "UNITY",
                isUnityMember: true,
                householdName: "Abraham Household",
                fullName: "Adel Abraham",
                initials: "AA",
                phone: "(613) 606-4114",
                email: "adel@example.com",
                address: "123 Main St",
                notes: "Long member note",
                normalizedSearchText: "adel abraham 6136064114 adel@example.com 17317",
              },
            ],
          };
        }

        return {};
      },
    },
    now: () => "2026-06-09T12:00:00.000Z",
    uuid: () => "unused",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/index",
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
    items: [
      {
        tagIds: [],
        memberId: "member-1",
        fullName: "Adel Abraham",
        initials: "AA",
        phone: "(613) 606-4114",
        email: "adel@example.com",
        address: "123 Main St",
        householdName: "Abraham Household",
        unityId: "17317",
        isUnityImported: true,
        source: "UNITY",
        normalizedSearchText: "adel abraham 6136064114 adel@example.com 17317",
        updatedAt: "2026-06-08T12:00:00.000Z",
      },
    ],
    generatedAt: "2026-06-09T12:00:00.000Z",
  });
  assert.doesNotMatch(String(response.body), /notes/);
});

test("stores visitation member links with VISITATION type", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
      "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
      "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-2#EVENT#event-1",
    ],
  );
  assert.deepEqual(
    writtenVisitations.map((item) => item.visitationId),
    [
      "CALENDAR#calendar-1#EVENT#event-1",
      "CALENDAR#calendar-2#EVENT#event-1",
    ],
  );
});

test("writes memberIds into Google event private metadata when creating a schedule event", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  let googleRequestBody = "";
  let storedEvent: Record<string, unknown> | undefined;
  const writtenVisitations: Array<Record<string, unknown>> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "PutCommand") {
          const item = command.input.Item as Record<string, unknown>;
          if (item.entityType === "schedule_event") {
            storedEvent = item;
          }
          if (item.entityType === "VISITATION") {
            writtenVisitations.push(item);
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
  assert.equal(storedEvent?.visitationType, "Visitation");
  assert.equal(writtenVisitations[0]?.type, "Visitation");
});

test("stores an explicit visitation type when creating a schedule event", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  let storedEvent: Record<string, unknown> | undefined;
  const writtenVisitations: Array<Record<string, unknown>> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "PutCommand") {
          const item = command.input.Item as Record<string, unknown>;
          if (item.entityType === "schedule_event") {
            storedEvent = item;
          }
          if (item.entityType === "VISITATION") {
            writtenVisitations.push(item);
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
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        id: "event-1",
        summary: "Phone Call",
        start: { dateTime: "2026-06-04T15:00:00.000Z" },
        end: { dateTime: "2026-06-04T16:00:00.000Z" },
        extendedProperties: {
          private: {
            memberIds: "member-1",
          },
        },
      }),
    }) as Response,
    now: () => "2026-06-03T12:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/events",
      body: JSON.stringify({
        calendarId: "calendar-1",
        summary: "Phone Call",
        start: "2026-06-04T15:00:00.000Z",
        end: "2026-06-04T16:00:00.000Z",
        memberIds: ["member-1"],
        type: "Phone Call",
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
  assert.equal(storedEvent?.visitationType, "Phone Call");
  assert.equal(writtenVisitations.at(-1)?.type, "Phone Call");
});

test("updates the visitation type when editing a schedule event", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  let storedEvent: Record<string, unknown> | undefined;
  const writtenVisitations: Array<Record<string, unknown>> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "PutCommand") {
          const item = command.input.Item as Record<string, unknown>;
          if (item.entityType === "schedule_event") {
            storedEvent = item;
          }
          if (item.entityType === "VISITATION") {
            writtenVisitations.push(item);
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
                googleEventId: "event-1",
                calendarName: "Main Calendar",
                summary: "Visitation",
                start: "2026-06-04T15:00:00.000Z",
                end: "2026-06-04T16:00:00.000Z",
                allDay: false,
                status: "confirmed",
                source: "GOOGLE",
                memberIds: ["member-1"],
                memberNames: ["Adel Abraham"],
                visitationType: "Visitation",
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
          if (values[":pk"] === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  type: "Visitation",
                  memberId: "member-1",
                  memberIds: ["member-1"],
                  memberNames: ["Adel Abraham"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Owner Example",
                  createdByUserId: "user-123",
                  createdByName: "Owner Example",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  title: "Visitation",
                  endDate: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  visitStatus: "scheduled",
                  eventId: "event-1",
                  calendarEventId: "event-1",
                  calendarId: "calendar-1",
                  calendarOwnerUserId: "user-123",
                  calendarOwnerName: "Owner Example",
                },
              ],
            };
          }

          return { Items: [] };
        }

        return {};
      },
    },
    fetchImpl: async () => ({
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
    }) as Response,
    now: () => "2026-06-03T13:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/events/event-1",
      pathParameters: { eventId: "event-1" },
      body: JSON.stringify({
        calendarId: "calendar-1",
        type: "Phone Call",
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
  assert.equal(storedEvent?.visitationType, "Phone Call");
  assert.equal(writtenVisitations.at(-1)?.type, "Phone Call");
  assert.equal(JSON.parse(String(response.body)).visitationType, "Phone Call");
});

test("editing an event can persist dismissed auto-linked members", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                googleEventId: "event-1",
                calendarName: "Main Calendar",
                summary: "Meeting with adel@example.com",
                attendees: ["adel@example.com"],
                start: "2026-06-04T15:00:00.000Z",
                end: "2026-06-04T16:00:00.000Z",
                allDay: false,
                status: "confirmed",
                source: "GOOGLE",
                autoLinkedMemberIds: ["member-1"],
                autoLinkedMemberNames: ["Adel Abraham"],
                autoLinkedVisitationType: "Meeting",
                memberIds: [],
                memberNames: [],
              },
            };
          }

          return {};
        }

        if (command.constructor.name === "QueryCommand") {
          const values = command.input.ExpressionAttributeValues as Record<string, string>;
          if (values[":pk"] === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  type: "Meeting",
                  memberId: "member-1",
                  memberIds: ["member-1"],
                  memberNames: ["Adel Abraham"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Owner Example",
                  createdByUserId: "user-123",
                  createdByName: "Owner Example",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  title: "Meeting with adel@example.com",
                  endDate: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  visitStatus: "scheduled",
                  eventId: "event-1",
                  calendarEventId: "event-1",
                  calendarId: "calendar-1",
                  calendarOwnerUserId: "user-123",
                  calendarOwnerName: "Owner Example",
                },
              ],
            };
          }

          if (values[":gsiPk"] === "TENANT#tenant-abc#MEMBERS") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#adel abraham#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Adel Abraham",
                  initials: "AA",
                  source: "UNITY",
                  isUnityMember: true,
                  email: "adel@example.com",
                  normalizedSearchText: "adel abraham adel@example.com",
                },
              ],
            };
          }

          return { Items: [] };
        }

        if (command.constructor.name === "BatchGetCommand") {
          return { Responses: { "records-table": [] } };
        }

        return {};
      },
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        id: "event-1",
        summary: "Meeting with adel@example.com",
        attendees: [{ email: "adel@example.com" }],
        start: { dateTime: "2026-06-04T15:00:00.000Z" },
        end: { dateTime: "2026-06-04T16:00:00.000Z" },
        status: "confirmed",
        extendedProperties: {
          private: {
            memberIds: "",
          },
        },
      }),
    }) as Response,
    now: () => "2026-06-03T13:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/events/event-1",
      pathParameters: { eventId: "event-1" },
      body: JSON.stringify({
        calendarId: "calendar-1",
        memberIds: [],
        dismissedAutoLinkedMemberIds: ["member-1"],
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
  const eventPut = [...commands].reverse().find(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string } | undefined)?.entityType === "schedule_event",
  );
  assert.deepEqual((eventPut?.input.Item as { autoLinkedMemberIds?: string[] }).autoLinkedMemberIds, []);
  assert.deepEqual((eventPut?.input.Item as { dismissedAutoLinkedMemberIds?: string[] }).dismissedAutoLinkedMemberIds, ["member-1"]);
  const visitationDeletes = commands.filter(
    (command) =>
      command.name === "DeleteCommand" &&
      (command.input.Key as { PK?: string } | undefined)?.PK === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
  );
  assert.ok(visitationDeletes.length >= 1);
  const responseBody = JSON.parse(String(response.body)) as {
    autoLinkedMemberIds?: string[];
    dismissedAutoLinkedMemberIds?: string[];
  };
  assert.deepEqual(responseBody.autoLinkedMemberIds, []);
  assert.deepEqual(responseBody.dismissedAutoLinkedMemberIds, ["member-1"]);
});

test("editing an event keeps remaining auto-linked members after dismissing one", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                googleEventId: "event-1",
                calendarName: "Main Calendar",
                summary: "Meeting with adel@example.com and mary@example.com",
                attendees: ["adel@example.com", "mary@example.com"],
                start: "2026-06-04T15:00:00.000Z",
                end: "2026-06-04T16:00:00.000Z",
                allDay: false,
                status: "confirmed",
                source: "GOOGLE",
                autoLinkedMemberIds: ["member-1", "member-2"],
                autoLinkedMemberNames: ["Adel Abraham", "Mary Smith"],
                autoLinkedVisitationType: "Meeting",
                memberIds: [],
                memberNames: [],
              },
            };
          }

          return {};
        }

        if (command.constructor.name === "QueryCommand") {
          const values = command.input.ExpressionAttributeValues as Record<string, string>;
          if (values[":pk"] === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  type: "Meeting",
                  memberId: "member-1",
                  memberIds: ["member-1", "member-2"],
                  memberNames: ["Adel Abraham", "Mary Smith"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Owner Example",
                  createdByUserId: "user-123",
                  createdByName: "Owner Example",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  title: "Meeting with adel@example.com and mary@example.com",
                  endDate: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  visitStatus: "scheduled",
                  eventId: "event-1",
                  calendarEventId: "event-1",
                  calendarId: "calendar-1",
                  calendarOwnerUserId: "user-123",
                  calendarOwnerName: "Owner Example",
                },
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  type: "Meeting",
                  memberId: "member-2",
                  memberIds: ["member-1", "member-2"],
                  memberNames: ["Adel Abraham", "Mary Smith"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Owner Example",
                  createdByUserId: "user-123",
                  createdByName: "Owner Example",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  title: "Meeting with adel@example.com and mary@example.com",
                  endDate: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  visitStatus: "scheduled",
                  eventId: "event-1",
                  calendarEventId: "event-1",
                  calendarId: "calendar-1",
                  calendarOwnerUserId: "user-123",
                  calendarOwnerName: "Owner Example",
                },
              ],
            };
          }

          if (values[":gsiPk"] === "TENANT#tenant-abc#MEMBERS") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#adel abraham#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Adel Abraham",
                  initials: "AA",
                  source: "UNITY",
                  isUnityMember: true,
                  email: "adel@example.com",
                  normalizedSearchText: "adel abraham adel@example.com",
                },
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-2",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#mary smith#member-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-2",
                  fullName: "Mary Smith",
                  initials: "MS",
                  source: "UNITY",
                  isUnityMember: true,
                  email: "mary@example.com",
                  normalizedSearchText: "mary smith mary@example.com",
                },
              ],
            };
          }

          return { Items: [] };
        }

        if (command.constructor.name === "BatchGetCommand") {
          const requestItems = command.input.RequestItems as Record<string, { Keys?: Array<{ PK: string; SK: string }> }>;
          const keys = requestItems["records-table"]?.Keys ?? [];
          return {
            Responses: {
              "records-table": keys
                .map((key) => {
                  if (key.SK === "MEMBER#member-2") {
                    return {
                      PK: "TENANT#tenant-abc",
                      SK: "MEMBER#member-2",
                      createdAt: "2026-06-03T12:00:00.000Z",
                      updatedAt: "2026-06-03T12:00:00.000Z",
                      entityType: "MEMBER",
                      tenantId: "tenant-abc",
                      memberId: "member-2",
                      fullName: "Mary Smith",
                      initials: "MS",
                      source: "UNITY",
                      isUnityMember: true,
                      email: "mary@example.com",
                      normalizedSearchText: "mary smith mary@example.com",
                    };
                  }
                  return null;
                })
                .filter(Boolean),
            },
          };
        }

        return {};
      },
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        id: "event-1",
        summary: "Meeting with adel@example.com and mary@example.com",
        attendees: [{ email: "adel@example.com" }, { email: "mary@example.com" }],
        start: { dateTime: "2026-06-04T15:00:00.000Z" },
        end: { dateTime: "2026-06-04T16:00:00.000Z" },
        status: "confirmed",
        extendedProperties: {
          private: {
            memberIds: "",
          },
        },
      }),
    }) as Response,
    now: () => "2026-06-03T13:00:00.000Z",
    uuid: () => "activity-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/events/event-1",
      pathParameters: { eventId: "event-1" },
      body: JSON.stringify({
        calendarId: "calendar-1",
        memberIds: [],
        dismissedAutoLinkedMemberIds: ["member-1"],
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
  const eventPut = [...commands].reverse().find(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string } | undefined)?.entityType === "schedule_event",
  );
  assert.deepEqual((eventPut?.input.Item as { autoLinkedMemberIds?: string[] }).autoLinkedMemberIds, ["member-2"]);

  const visitationPut = [...commands].reverse().find(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string; memberId?: string } | undefined)?.entityType === "VISITATION" &&
      (command.input.Item as { memberId?: string } | undefined)?.memberId === "member-2",
  );
  assert.deepEqual((visitationPut?.input.Item as { memberIds?: string[] }).memberIds, ["member-2"]);
  assert.deepEqual((visitationPut?.input.Item as { memberNames?: string[] }).memberNames, ["Mary Smith"]);

  const responseBody = JSON.parse(String(response.body)) as {
    autoLinkedMemberIds?: string[];
    dismissedAutoLinkedMemberIds?: string[];
  };
  assert.deepEqual(responseBody.autoLinkedMemberIds, ["member-2"]);
  assert.deepEqual(responseBody.dismissedAutoLinkedMemberIds, ["member-1"]);
});

test("full sync restores member links from Google event private metadata", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
  assert.match(JSON.stringify(memberLinkWrite?.input), /"GSI3PK":"TENANT#tenant-abc#EVENT_ASSIGNMENTS"/);
});

test("full Google sync auto-links meeting and public appointment events by matching email", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                entityType: "GOOGLE_CONNECTION",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account-1",
                email: "owner@example.com",
                accessToken: "access-token",
                refreshToken: "refresh-token",
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
            return { Items: [] };
          }

          if (command.input.IndexName === "GSI1" && values?.[":gsiPk"] === "TENANT#tenant-abc#MEMBERS") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#mary mina#MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Mary Mina",
                  initials: "MM",
                  email: "mary@example.com",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "mary mina mary@example.com",
                },
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-2",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#john gira#MEMBER#member-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-2",
                  fullName: "John Gira",
                  initials: "JG",
                  email: "john@example.com",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "john gira john@example.com",
                },
              ],
            };
          }

          if (values?.[":pk"] === "TENANT#tenant-abc#EVENT#event-1") {
            return { Items: [] };
          }

          if (values?.[":pk"] === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1") {
            return { Items: [] };
          }

          if (command.input.IndexName === "GSI1") {
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
          items: [
            {
              id: "event-1",
              summary: "  Meeting: Reach Mary at MARY@example.com and John at JOHN@example.com  ",
              attendees: [
                { email: "mary@example.com" },
                { email: "MARY@example.com" },
                { email: "john@example.com" },
              ],
              start: { dateTime: "2026-06-04T15:00:00.000Z" },
              end: { dateTime: "2026-06-04T16:00:00.000Z" },
            },
            {
              id: "event-2",
              summary: "Appointment: Different Visitor Name",
              attendees: [{ email: "mary@example.com" }],
              extendedProperties: { private: { source: "public_booking", visitorEmail: "MARY@EXAMPLE.COM" } },
              start: { dateTime: "2026-06-05T15:00:00.000Z" },
              end: { dateTime: "2026-06-05T16:00:00.000Z" },
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
  const visitationPuts = commands.filter(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string } | undefined)?.entityType === "VISITATION",
  );
  assert.equal(visitationPuts.length, 3);
  assert.deepEqual(
    visitationPuts.map((command) => (command.input.Item as { memberId?: string }).memberId).sort(),
    ["member-1", "member-1", "member-2"],
  );
  visitationPuts.filter((command) => (command.input.Item as { eventId?: string }).eventId === "event-1").forEach((command) => {
    assert.equal((command.input.Item as { type?: string }).type, "Meeting");
    assert.equal((command.input.Item as { eventId?: string }).eventId, "event-1");
    assert.equal((command.input.Item as { calendarEventId?: string }).calendarEventId, "event-1");
  });
  const appointmentVisitation = visitationPuts.find((command) => (command.input.Item as { eventId?: string }).eventId === "event-2")?.input.Item as { memberId?: string; type?: string } | undefined;
  assert.equal(appointmentVisitation?.memberId, "member-1");
  assert.equal(appointmentVisitation?.type, "Visitation");
  const eventPut = commands.find(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string } | undefined)?.entityType === "schedule_event",
  );
  assert.deepEqual(
    (eventPut?.input.Item as { autoLinkedMemberIds?: string[] }).autoLinkedMemberIds,
    ["member-1", "member-2"],
  );
  assert.equal((eventPut?.input.Item as { autoLinkedVisitationType?: string }).autoLinkedVisitationType, "Meeting");
  assert.deepEqual((eventPut?.input.Item as { memberIds?: string[] }).memberIds, []);
  const appointmentEventPut = commands.find((command) => command.name === "PutCommand" && (command.input.Item as { eventId?: string } | undefined)?.eventId === "event-2" && (command.input.Item as { entityType?: string } | undefined)?.entityType === "schedule_event");
  assert.deepEqual((appointmentEventPut?.input.Item as { autoLinkedMemberIds?: string[] } | undefined)?.autoLinkedMemberIds, ["member-1"]);
  assert.deepEqual((appointmentEventPut?.input.Item as { attendees?: string[] } | undefined)?.attendees, ["mary@example.com"]);
  assert.equal(JSON.stringify(appointmentEventPut?.input.Item).includes("visitorEmail"), false);
  assert.equal(commands.some((command) => command.name === "TransactWriteCommand"), false);
});

test("full Google sync auto-links meeting-prefixed events to all matching members named in the title", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                entityType: "GOOGLE_CONNECTION",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account-1",
                email: "owner@example.com",
                accessToken: "access-token",
                refreshToken: "refresh-token",
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
            return { Items: [] };
          }

          if (command.input.IndexName === "GSI1" && values?.[":gsiPk"] === "TENANT#tenant-abc#MEMBERS") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#mary mina#MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Mary Mina",
                  initials: "MM",
                  email: "mary@example.com",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "mary mina mary@example.com",
                },
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-2",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#john gira#MEMBER#member-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-2",
                  fullName: "John Gira",
                  initials: "JG",
                  email: "john@example.com",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "john gira john@example.com",
                },
              ],
            };
          }

          if (values?.[":pk"] === "TENANT#tenant-abc#EVENT#event-1") {
            return { Items: [] };
          }

          if (values?.[":pk"] === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1") {
            return { Items: [] };
          }

          if (command.input.IndexName === "GSI1") {
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
          items: [
            {
              id: "event-1",
              summary: "Meeting: Mary Mina and John Gira",
              attendees: [],
              start: { dateTime: "2026-06-04T15:00:00.000Z" },
              end: { dateTime: "2026-06-04T16:00:00.000Z" },
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
      (command.input.Item as { entityType?: string } | undefined)?.entityType === "schedule_event",
  );
  assert.ok(eventPut);
  assert.deepEqual(
    (eventPut?.input.Item as { autoLinkedMemberIds?: string[] }).autoLinkedMemberIds,
    ["member-1", "member-2"],
  );
  const visitationPuts = commands.filter(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string } | undefined)?.entityType === "VISITATION",
  );
  assert.equal(visitationPuts.length, 2);
});

test("Google sync skips auto-link when the event already has a visitation entry", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                entityType: "GOOGLE_CONNECTION",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account-1",
                email: "owner@example.com",
                accessToken: "access-token",
                refreshToken: "refresh-token",
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
            return { Items: [] };
          }

          if (values?.[":pk"] === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-9",
                  createdAt: "2026-06-02T12:00:00.000Z",
                  updatedAt: "2026-06-02T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  type: "Meeting",
                  memberId: "member-9",
                  memberIds: ["member-9"],
                  memberNames: ["Existing Member"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Owner Example",
                  createdByUserId: "user-123",
                  createdByName: "Owner Example",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  title: "Meeting: Existing visitation",
                  endDate: "2026-06-04T16:00:00.000Z",
                  allDay: false,
                  visitStatus: "scheduled",
                  eventId: "event-1",
                  calendarEventId: "event-1",
                  calendarId: "calendar-1",
                  calendarOwnerUserId: "user-123",
                  calendarOwnerName: "Owner Example",
                },
              ],
            };
          }

          if (command.input.IndexName === "GSI1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-9",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#existing member#MEMBER#member-9",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-9",
                  fullName: "Existing Member",
                  initials: "EM",
                  email: "existing@example.com",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "existing member existing@example.com",
                },
              ],
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
          items: [
            {
              id: "event-1",
              summary: "Meeting: Reach Mary at mary@example.com",
              attendees: [{ email: "mary@example.com" }],
              start: { dateTime: "2026-06-04T15:00:00.000Z" },
              end: { dateTime: "2026-06-04T16:00:00.000Z" },
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
      (command.input.Item as { entityType?: string } | undefined)?.entityType === "schedule_event",
  );
  assert.ok(eventPut);
  assert.deepEqual((eventPut?.input.Item as { autoLinkedMemberIds?: string[] }).autoLinkedMemberIds, ["member-9"]);
  assert.equal((eventPut?.input.Item as { autoLinkedVisitationType?: string }).autoLinkedVisitationType, "Meeting");
  const visitationPuts = commands.filter(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string } | undefined)?.entityType === "VISITATION",
  );
  assert.equal(visitationPuts.length, 1);
});

test("incremental Google sync logs AUTO_LINK_FAILED when a prefixed interaction event has no matching member", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                createdAt: "2026-06-07T12:00:00.000Z",
                updatedAt: "2026-06-07T12:00:00.000Z",
                entityType: "GOOGLE_CONNECTION",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account-1",
                email: "owner@example.com",
                accessToken: "access-token",
                refreshToken: "refresh-token",
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

          if (command.input.IndexName === "GSI1" && values?.[":gsiPk"] === "TENANT#tenant-abc#MEMBERS") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-2",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#other member#MEMBER#member-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-2",
                  fullName: "Other Member",
                  initials: "OM",
                  email: "other@example.com",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "other member other@example.com",
                },
              ],
            };
          }

          if (values?.[":pk"] === "TENANT#tenant-abc#EVENT#event-2") {
            return { Items: [] };
          }

          if (values?.[":pk"] === "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-2") {
            return { Items: [] };
          }

          if (command.input.IndexName === "GSI1") {
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
          items: [
            {
              id: "event-2",
              summary: " Confession: Follow up with MISSING@example.com ",
              attendees: [{ email: "missing@example.com" }],
              start: { dateTime: "2026-06-07T15:00:00.000Z" },
              end: { dateTime: "2026-06-07T16:00:00.000Z" },
            },
          ],
          nextSyncToken: "sync-token-1",
        }),
      }) as Response,
    now: () => "2026-06-07T12:00:00.000Z",
    uuid: () => "audit-1",
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
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 200);
  const auditPut = commands.find(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string; actionType?: string } | undefined)?.entityType === "AUDIT_LOG" &&
      (command.input.Item as { actionType?: string } | undefined)?.actionType === "AUTO_LINK_FAILED",
  );
  assert.ok(auditPut);
  assert.deepEqual((auditPut?.input.Item as { metadata?: { extractedEmails?: string[] } }).metadata?.extractedEmails, [
    "missing@example.com",
  ]);
  assert.equal((auditPut?.input.Item as { metadata?: { googleEventId?: string } }).metadata?.googleEventId, "event-2");
  assert.equal(
    commands.some(
      (command) =>
        command.name === "PutCommand" &&
        (command.input.Item as { entityType?: string } | undefined)?.entityType === "VISITATION",
    ),
    false,
  );
});

test("refreshed calendars return events only for the requested schedule range", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";

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
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  GSI2PK: "TENANT#tenant-abc#MEMBER#member-1",
                  GSI2SK: "VISIT#2026-06-04T15:00:00.000Z#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-04T16:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  calendarId: "calendar-1",
                  eventId: "event-1",
                  calendarOwnerUserId: "user-456",
                  calendarOwnerName: "Visitor B",
                  memberIds: ["member-1"],
                  memberNames: ["Adel Abraham"],
                  memberId: "member-1",
                  title: "Visitation: Adel Abraham",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  endDate: "2026-06-04T16:00:00.000Z",
                  location: "123 Main St",
                  notes: "Pastoral visit",
                  allDay: false,
                  visitStatus: "scheduled",
                  createdByUserId: "user-456",
                  createdByName: "Visitor B",
                  visitorUserId: "user-456",
                  visitorDisplayName: "Visitor B",
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
        allDay: false,
        calendarId: "calendar-1",
        calendarOwnerName: "Visitor B",
        calendarOwnerUserId: "user-456",
        createdAt: "2026-06-03T12:00:00.000Z",
        createdByName: "Visitor B",
        createdByUserId: "user-456",
        endDate: "2026-06-04T16:00:00.000Z",
        eventId: "event-1",
        entityType: "VISITATION",
        memberId: "member-1",
        memberIds: ["member-1"],
        memberNames: ["Adel Abraham"],
        isOwnCalendar: false,
        location: "123 Main St",
        notes: "Pastoral visit",
        source: "calendar",
        tenantId: "tenant-abc",
        type: "Visitation",
        updatedAt: "2026-06-04T16:00:00.000Z",
        visitDate: "2026-06-04T15:00:00.000Z",
        visitStatus: "scheduled",
        visitationId: "CALENDAR#calendar-1#EVENT#event-1",
        visitorDisplayName: "Visitor B",
        visitorUserId: "user-456",
        title: "Visitation: Adel Abraham",
      },
    ],
  });
});

test("member visitation history merges duplicate Unity member rows for the same tenant member", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  SK: "MEMBER#member-1",
                  GSI2PK: "TENANT#tenant-abc#MEMBER#member-1",
                  GSI2SK: "VISIT#2026-06-04T15:00:00.000Z#VISITATION#CALENDAR#calendar-1#EVENT#event-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-04T16:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-1#EVENT#event-1",
                  source: "calendar",
                  calendarId: "calendar-1",
                  eventId: "event-1",
                  calendarOwnerUserId: "user-456",
                  calendarOwnerName: "Visitor B",
                  memberIds: ["member-1"],
                  memberNames: ["Bassem Wanis"],
                  memberId: "member-1",
                  title: "Visitation: Bassem Wanis",
                  visitDate: "2026-06-04T15:00:00.000Z",
                  endDate: "2026-06-04T16:00:00.000Z",
                  visitStatus: "scheduled",
                  createdByUserId: "user-456",
                  createdByName: "Visitor B",
                  visitorUserId: "user-456",
                  visitorDisplayName: "Visitor B",
                },
              ],
            };
          }

          if (command.input.IndexName === "GSI2" && values?.[":gsiPk"] === "TENANT#tenant-abc#MEMBER#member-2") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#VISITATION#CALENDAR#calendar-2#EVENT#event-2",
                  SK: "MEMBER#member-2",
                  GSI2PK: "TENANT#tenant-abc#MEMBER#member-2",
                  GSI2SK: "VISIT#2026-06-05T15:00:00.000Z#VISITATION#CALENDAR#calendar-2#EVENT#event-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-05T16:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "CALENDAR#calendar-2#EVENT#event-2",
                  source: "calendar",
                  calendarId: "calendar-2",
                  eventId: "event-2",
                  calendarOwnerUserId: "user-789",
                  calendarOwnerName: "Visitor C",
                  memberIds: ["member-2"],
                  memberNames: ["Bassem Wanis"],
                  memberId: "member-2",
                  title: "Visitation: Bassem Wanis",
                  visitDate: "2026-06-05T15:00:00.000Z",
                  endDate: "2026-06-05T16:00:00.000Z",
                  visitStatus: "scheduled",
                  createdByUserId: "user-789",
                  createdByName: "Visitor C",
                  visitorUserId: "user-789",
                  visitorDisplayName: "Visitor C",
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
    "event-2",
    "event-1",
  ]);
});

test("visitation reports default to all visitors and support only-my-visits filtering", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "QueryCommand" && command.input.IndexName === "GSI1") {
          const values = command.input.ExpressionAttributeValues as Record<string, string>;
          if (values[":gsiPk"] === "TENANT#tenant-abc#MEMBERS") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-1",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#adel abraham#MEMBER#member-1",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-1",
                  fullName: "Adel Abraham",
                  initials: "AA",
                  source: "UNITY",
                  normalizedSearchText: "adel abraham",
                  groups: ["North"],
                },
                {
                  PK: "TENANT#tenant-abc",
                  SK: "MEMBER#member-2",
                  GSI1PK: "TENANT#tenant-abc#MEMBERS",
                  GSI1SK: "NAME#mary mina#MEMBER#member-2",
                  createdAt: "2026-06-03T12:00:00.000Z",
                  updatedAt: "2026-06-03T12:00:00.000Z",
                  entityType: "MEMBER",
                  tenantId: "tenant-abc",
                  memberId: "member-2",
                  fullName: "Mary Mina",
                  initials: "MM",
                  source: "MANUAL",
                  normalizedSearchText: "mary mina",
                  groups: ["South"],
                },
              ],
            };
          }

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
              {
                PK: "TENANT#tenant-abc#CALENDAR#calendar-3#EVENT#event-3",
                SK: "VISIT#member-1",
                GSI1PK: "TENANT#tenant-abc",
                GSI1SK: "VISIT#2026-06-06T15:00:00.000Z#VISITOR#user-456#MEMBER#member-1#VISITATION#calendar-3:event-3:member-1",
                GSI2PK: "TENANT#tenant-abc#MEMBER#member-1",
                GSI2SK: "VISIT#2026-06-06T15:00:00.000Z#VISITATION#calendar-3:event-3:member-1",
                createdAt: "2026-06-06T15:00:00.000Z",
                updatedAt: "2026-06-06T16:00:00.000Z",
                entityType: "VISITATION",
                tenantId: "tenant-abc",
                calendarId: "calendar-3",
                visitationId: "calendar-3:event-3:member-1",
                memberId: "member-1",
                memberNameSnapshot: "Adel Abraham",
                memberSourceSnapshot: "UNITY",
                visitorUserId: "user-456",
                visitorDisplayName: "Visitor B",
                visitDate: "2026-06-06T15:00:00.000Z",
                sourceEventId: "event-3",
                ownerUserId: "user-456",
                status: "confirmed",
              },
            ],
          };
        }

        if (command.constructor.name === "QueryCommand" && command.input.IndexName === "GSI3") {
          return { Items: [] };
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
  assert.deepEqual(allBody.rows.find((row) => row.memberId === "member-1")?.caregiverNames, ["Viewer A", "Visitor B"]);

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
  assert.deepEqual(myBody.rows.find((row) => row.memberId === "member-1")?.caregiverNames, ["Viewer A"]);
  assert.equal(myBody.rows.find((row) => row.memberId === "member-2")?.visitCountInRange, 0);

  const visitedResponse = await handler(
    createEvent({
      rawPath: "/reports/visitations",
      queryStringParameters: {
        sinceBeginning: "true",
        visitCountMode: "gt",
        visitCountThreshold: "0",
      },
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

  assert.equal(visitedResponse.statusCode, 200);
  const visitedBody = JSON.parse(String(visitedResponse.body)) as VisitationReportResponse;
  assert.equal(visitedBody.rows.length, 2);
  assert.equal(visitedBody.rows.find((row) => row.memberId === "member-1")?.visitCountInRange, 2);
  assert.equal(visitedBody.rows.find((row) => row.memberId === "member-2")?.visitCountInRange, 1);
});

test("manual visitation creation preserves the selected visitor while keeping the actor as creator", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const putItems: Array<Record<string, unknown>> = [];
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

        if (command.constructor.name === "PutCommand") {
          putItems.push(command.input.Item as Record<string, unknown>);
          return {};
        }

        if (command.constructor.name === "QueryCommand") {
          return { Items: putItems };
        }

        return {};
      },
    },
    now: () => "2026-06-06T12:00:00.000Z",
    uuid: () => "visit-123",
  });

  const response = await handler(
    createEvent({
      rawPath: "/members/member-1/visitations",
      pathParameters: { memberId: "member-1" },
      body: JSON.stringify({
        title: "Home visit",
        visitDate: "2026-06-05T15:00:00.000Z",
        memberIds: ["member-1"],
        visitorUserId: "user-456",
        visitorDisplayName: "Visitor B",
      }),
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
          method: "POST",
        },
      },
    }) as never,
    {} as never,
    () => undefined,
  ) as APIGatewayProxyStructuredResultV2;

  assert.equal(response.statusCode, 201);
  const visitationItems = putItems.filter((item) => item.entityType === "VISITATION");
  assert.equal(visitationItems.length, 1);
  assert.equal(visitationItems[0]?.visitorUserId, "user-456");
  assert.equal(visitationItems[0]?.visitorDisplayName, "Visitor B");
  assert.equal(visitationItems[0]?.createdByUserId, "user-123");
  assert.equal(visitationItems[0]?.createdByName, "Viewer A");
  assert.equal(visitationItems[0]?.type, "Visitation");
  assert.match(String(visitationItems[0]?.GSI1SK), /VISITOR#user-456#/);
});

test("member visitation responses default missing visitation types to Visitation", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
                unityId: "unity-1",
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
          if (values[":gsiPk"] === "TENANT#tenant-abc#UNITY") {
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
                  unityId: "unity-1",
                  fullName: "Adel Abraham",
                  initials: "AA",
                  source: "UNITY",
                  isUnityMember: true,
                  normalizedSearchText: "adel abraham",
                },
              ],
            };
          }

          if (values[":gsiPk"] === "TENANT#tenant-abc#MEMBER#member-1") {
            return {
              Items: [
                {
                  PK: "TENANT#tenant-abc#VISITATION#legacy-visit-1",
                  SK: "MEMBER#member-1",
                  createdAt: "2026-06-05T12:00:00.000Z",
                  updatedAt: "2026-06-05T12:00:00.000Z",
                  entityType: "VISITATION",
                  tenantId: "tenant-abc",
                  visitationId: "legacy-visit-1",
                  source: "manual",
                  memberId: "member-1",
                  memberIds: ["member-1"],
                  memberNames: ["Adel Abraham"],
                  visitorUserId: "user-123",
                  visitorDisplayName: "Viewer A",
                  createdByUserId: "user-123",
                  createdByName: "Viewer A",
                  visitDate: "2026-06-05T15:00:00.000Z",
                  title: "Legacy visit",
                  visitStatus: "completed",
                },
              ],
            };
          }

          return { Items: [] };
        }

        return {};
      },
    },
    now: () => "2026-06-06T12:00:00.000Z",
    uuid: () => "visit-123",
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
  assert.equal(JSON.parse(String(response.body)).items[0]?.type, "Visitation");
});

test("schedule overview excludes user-owned records from a different tenant", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
      calendarListRefreshThresholdMinutes: 0,
    },
  });
});

test("refreshing calendars returns a reconnect message when the stored Google token lacks calendar scope", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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

test("refreshing calendars returns a reconnect message when the Google refresh token was revoked", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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
              refreshToken: "refresh-123",
              tokenExpiresAt: "2026-06-09T11:59:00.000Z",
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
        text: async () =>
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
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
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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

test("full Google sync omits timeMax when the initial sync range end date is empty", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  let googleEventsUrl = "";
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
                createdAt: "2026-08-17T12:00:00.000Z",
                updatedAt: "2026-08-17T12:00:00.000Z",
                entityType: "google_connection",
                userId: "user-123",
                tenantId: "tenant-abc",
                googleAccountId: "google-account",
                email: "owner@example.com",
                accessToken: "token-123",
                scopes: ["https://www.googleapis.com/auth/calendar"],
                status: "connected",
                connectedAt: "2026-08-17T12:00:00.000Z",
                lastConnectedAt: "2026-08-17T12:00:00.000Z",
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
                  createdAt: "2026-08-17T12:00:00.000Z",
                  updatedAt: "2026-08-17T12:00:00.000Z",
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
                    initialSyncRange: { from: "2026-08-17", to: "" },
                    lastSyncStatus: "idle",
                    requiresFullSync: true,
                  },
                },
              ],
            };
          }

          if (values?.[":pk"] === "USER#user-123" && values?.[":eventPrefix"] === "EVENT#calendar-1#") {
            return { Items: [] };
          }

          if (command.input.IndexName === "GSI1") {
            return { Items: [] };
          }

          return { Items: [] };
        }

        return {};
      },
    },
    fetchImpl: async (url) => {
      googleEventsUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          items: [],
          nextSyncToken: "sync-token-1",
        }),
      } as Response;
    },
    now: () => "2026-08-17T12:00:00.000Z",
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
  assert.match(googleEventsUrl, /timeMin=2026-08-17T00%3A00%3A00.000Z/);
  assert.doesNotMatch(googleEventsUrl, /timeMax=/);
});

test("saving schedule settings keeps the initial sync range unchanged after initial sync is complete", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];

  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "GetCommand") {
          const key = command.input.Key as { PK: string; SK: string };

          if (key.PK === "USER#user-123" && key.SK === "SCHEDULE_SETTINGS") {
            return {
              Item: {
                PK: "USER#user-123",
                SK: "SCHEDULE_SETTINGS",
                createdAt: "2026-08-17T12:00:00.000Z",
                updatedAt: "2026-08-17T12:00:00.000Z",
                entityType: "schedule_settings",
                userId: "user-123",
                tenantId: "tenant-abc",
                calendarListRefreshThresholdMinutes: 5,
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
                  createdAt: "2026-08-17T12:00:00.000Z",
                  updatedAt: "2026-08-17T12:00:00.000Z",
                  entityType: "schedule_calendar",
                  userId: "user-123",
                  tenantId: "tenant-abc",
                  calendarId: "calendar-1",
                  summary: "Main Calendar",
                  primary: true,
                  enabled: true,
                  selected: true,
                  calendarListRefreshedAt: "2026-08-22T19:58:00.000Z",
                  sync: {
                    syncMode: "ALWAYS_GOOGLE",
                    refreshIntervalMinutes: 15,
                    initialSyncRange: { from: "2026-08-17", to: "2026-08-22" },
                    lastSyncedAt: "2026-08-22T19:58:00.000Z",
                    lastSyncStatus: "success",
                    requiresFullSync: false,
                  },
                },
              ],
            };
          }

          return { Items: [] };
        }

        return {};
      },
    },
    now: () => "2026-08-22T20:00:00.000Z",
  });

  const response = await handler(
    createEvent({
      rawPath: "/schedule/settings",
      body: JSON.stringify({
        calendarListRefreshThresholdMinutes: 5,
        calendars: [
          {
            calendarId: "calendar-1",
            showInCalendar: true,
            syncMode: "ALWAYS_GOOGLE",
            cacheStaleThresholdMinutes: 15,
            initialSyncRange: { from: "2026-08-01", to: "2026-08-31" },
          },
        ],
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
  const calendarPut = commands.find(
    (command) =>
      command.name === "PutCommand" &&
      (command.input.Item as { entityType?: string; calendarId?: string } | undefined)?.entityType === "schedule_calendar" &&
      (command.input.Item as { calendarId?: string } | undefined)?.calendarId === "calendar-1",
  );
  assert.deepEqual(
    (calendarPut?.input.Item as { sync?: { initialSyncRange?: { from: string; to: string } } } | undefined)?.sync
      ?.initialSyncRange,
    { from: "2026-08-17", to: "2026-08-22" },
  );
  assert.equal(
    (calendarPut?.input.Item as { sync?: { requiresFullSync?: boolean } } | undefined)?.sync?.requiresFullSync,
    false,
  );
});

test("creating a schedule event stores the Google event id as the canonical event id", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
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

test("admin routes reject non-admin users and write an audit log", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });
        return {};
      },
    },
    now: () => "2026-06-17T12:00:00.000Z",
    uuid: () => "audit-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/users",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["servant"],
              "custom:tenantId": "tenant-abc",
              email: "servant@example.com",
              name: "Servant Example",
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

  assert.equal(response.statusCode, 403);
  const auditPut = commands.find((command) => command.name === "PutCommand");
  assert.equal((auditPut?.input.Item as { entityType?: string }).entityType, "AUDIT_LOG");
  assert.equal((auditPut?.input.Item as { resultStatus?: string }).resultStatus, "failed");
});

test("admin routes fall back to Cognito groups when the token omits admin", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  let actorLookupCalls = 0;
  const handler = createHandler({
    cognitoClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "ListUsersCommand") {
          actorLookupCalls += 1;
          if (actorLookupCalls === 1) {
            assert.equal(command.input.Filter, "sub = \"user-123\"");
            return {
              Users: [{ Username: "owner@example.com" }],
            };
          }

          assert.equal(command.input.Filter, undefined);
          return {
            Users: [],
          };
        }

        if (command.constructor.name === "AdminListGroupsForUserCommand") {
          assert.equal(command.input.Username, "owner@example.com");
          return {
            Groups: [{ GroupName: "admin" }, { GroupName: "servant" }],
          };
        }

        throw new Error(`Unexpected Cognito command: ${command.constructor.name}`);
      },
    },
    documentClient: {
      send: async () => ({}),
    },
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/users",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["servant"],
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
});

test("admin group updates prevent removing your own admin role", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  const documentCommands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    cognitoClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "AdminGetUserCommand") {
          return {
            Username: "owner@example.com",
            UserStatus: "CONFIRMED",
            UserAttributes: [
              { Name: "sub", Value: "user-123" },
              { Name: "email", Value: "owner@example.com" },
              { Name: "name", Value: "Owner Example" },
              { Name: "custom:tenantId", Value: "tenant-abc" },
            ],
          };
        }

        if (command.constructor.name === "AdminListGroupsForUserCommand") {
          return {
            Groups: [{ GroupName: "admin" }, { GroupName: "priest" }],
          };
        }

        throw new Error(`Unexpected Cognito command: ${command.constructor.name}`);
      },
    },
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        documentCommands.push({ name: command.constructor.name, input: command.input });
        return {};
      },
    },
    now: () => "2026-06-17T12:00:00.000Z",
    uuid: () => "audit-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/users/owner@example.com/groups",
      pathParameters: {
        username: "owner@example.com",
      },
      body: JSON.stringify({ groups: ["priest"] }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["admin"],
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

  assert.equal(response.statusCode, 400);
  assert.match(String(response.body), /cannot remove your own admin access/i);
  const failureAudit = documentCommands.find((command) => command.name === "PutCommand");
  assert.equal((failureAudit?.input.Item as { resultStatus?: string }).resultStatus, "failed");
});

test("google cached event reset deletes cached events using the event owner partition", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "ScanCommand") {
          return {
            Items: [
              {
                PK: "USER#owner-456",
                SK: "EVENT#calendar-1#event-1",
                createdAt: "2026-06-11T03:00:46.732Z",
                updatedAt: "2026-06-12T21:48:21.981Z",
                entityType: "schedule_event",
                tenantId: "SGSA_Church",
                userId: "owner-456",
                calendarId: "calendar-1",
                eventId: "event-1",
                googleEventId: "event-1",
                calendarName: "Main Calendar",
                summary: "TEST bwanis",
                start: "2026-05-10T09:00:00-04:00",
                end: "2026-05-10T10:00:00-04:00",
                allDay: false,
                status: "confirmed",
                source: "GOOGLE",
                memberIds: [],
                memberNames: [],
              },
              {
                PK: "TENANT#SGSA_Church#EVENT#event-1",
                SK: "MEMBER#member-1",
                createdAt: "2026-06-11T03:00:46.732Z",
                updatedAt: "2026-06-12T21:48:21.981Z",
                entityType: "EVENT_MEMBER",
                tenantId: "SGSA_Church",
                calendarId: "calendar-1",
                eventId: "event-1",
                calendarOwnerUserId: "owner-456",
                calendarOwnerName: "Calendar Owner",
                memberId: "member-1",
                memberName: "Member One",
                sourceSnapshot: "MANUAL",
                eventTitle: "TEST bwanis",
                eventStart: "2026-05-10T09:00:00-04:00",
                eventEnd: "2026-05-10T10:00:00-04:00",
                assignmentStatus: "assigned",
                visitStatus: "scheduled",
                createdByUserId: "admin-123",
                createdByName: "Admin Example",
              },
              {
                PK: "TENANT#SGSA_Church#VISITATION#EVENT#calendar-1#event-1",
                SK: "MEMBER#member-1",
                createdAt: "2026-06-11T03:00:46.732Z",
                updatedAt: "2026-06-12T21:48:21.981Z",
                entityType: "VISITATION",
                tenantId: "SGSA_Church",
                visitationId: "EVENT#calendar-1#event-1",
                source: "calendar",
                memberId: "member-1",
                memberIds: ["member-1"],
                memberNames: ["Member One"],
                visitorUserId: "owner-456",
                visitorDisplayName: "Calendar Owner",
                createdByUserId: "owner-456",
                createdByName: "Calendar Owner",
                visitDate: "2026-05-10T09:00:00-04:00",
                title: "TEST bwanis",
                visitStatus: "scheduled",
                eventId: "event-1",
                calendarEventId: "event-1",
                calendarId: "calendar-1",
                calendarOwnerUserId: "owner-456",
                calendarOwnerName: "Calendar Owner",
              },
            ],
          };
        }

        return {};
      },
    },
    now: () => "2026-06-17T12:00:00.000Z",
    uuid: () => "audit-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/reset/google_cached_events",
      pathParameters: {
        action: "google_cached_events",
      },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["admin"],
              "custom:tenantId": "SGSA_Church",
              email: "admin@example.com",
              name: "Admin Example",
              sub: "admin-123",
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
    action: "google_cached_events",
    recordsDeleted: 3,
    affectedEntities: [
      { entityType: "EVENT_MEMBER", deleted: 1 },
      { entityType: "schedule_event", deleted: 1 },
      { entityType: "VISITATION", deleted: 1 },
    ],
    status: "success",
  });
  const batchWriteCommand = commands.find((command) => command.name === "BatchWriteCommand");
  assert.deepEqual(batchWriteCommand?.input.RequestItems, {
    "records-table": [
      {
        DeleteRequest: {
          Key: {
            PK: "USER#owner-456",
            SK: "EVENT#calendar-1#event-1",
          },
        },
      },
      {
        DeleteRequest: {
          Key: {
            PK: "TENANT#SGSA_Church#EVENT#event-1",
            SK: "MEMBER#member-1",
          },
        },
      },
      {
        DeleteRequest: {
          Key: {
            PK: "TENANT#SGSA_Church#VISITATION#EVENT#calendar-1#event-1",
            SK: "MEMBER#member-1",
          },
        },
      },
    ],
  });
});

test("member reset deletes members and activities in a single batched pass", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  const handler = createHandler({
    documentClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });

        if (command.constructor.name === "ScanCommand") {
          return {
            Items: [
              {
                PK: "TENANT#tenant-abc",
                SK: "MEMBER#member-1",
                createdAt: "2026-06-11T03:00:46.732Z",
                updatedAt: "2026-06-12T21:48:21.981Z",
                entityType: "MEMBER",
                tenantId: "tenant-abc",
                memberId: "member-1",
                fullName: "Member One",
                initials: "MO",
                source: "MANUAL",
                isUnityMember: false,
                normalizedSearchText: "member one",
              },
              {
                PK: "TENANT#tenant-abc#MEMBER#member-1",
                SK: "ACTIVITY#activity-1",
                createdAt: "2026-06-11T03:00:46.732Z",
                updatedAt: "2026-06-12T21:48:21.981Z",
                entityType: "MEMBER_ACTIVITY",
                tenantId: "tenant-abc",
                activityId: "activity-1",
                action: "Member Created",
                message: "Created.",
                actorUserId: "admin-123",
                actorDisplayName: "Admin Example",
              },
            ],
          };
        }

        return {};
      },
    },
    now: () => "2026-06-17T12:00:00.000Z",
    uuid: () => "audit-1",
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/reset/members",
      pathParameters: {
        action: "members",
      },
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["admin"],
              "custom:tenantId": "tenant-abc",
              email: "admin@example.com",
              name: "Admin Example",
              sub: "admin-123",
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
  assert.equal(commands.filter((command) => command.name === "ScanCommand").length, 1);
  assert.equal(commands.filter((command) => command.name === "QueryCommand").length, 0);
  assert.deepEqual(JSON.parse(String(response.body)), {
    action: "members",
    recordsDeleted: 2,
    affectedEntities: [
      { entityType: "MEMBER", deleted: 1 },
      { entityType: "MEMBER_ACTIVITY", deleted: 1 },
    ],
    status: "success",
  });
});

test("admin endpoints accept stringified cognito group claims", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  const handler = createHandler({
    cognitoClient: {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === "ListUsersCommand") {
          return {
            Users: [],
          };
        }

        throw new Error(`Unexpected Cognito command: ${command.constructor.name}`);
      },
    },
    documentClient: {
      send: async () => ({}),
    },
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/users",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": "[\"admin\"]",
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
});

test("admin endpoints accept bracketed cognito group claims", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  const handler = createHandler({
    cognitoClient: {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === "ListUsersCommand") {
          return {
            Users: [],
          };
        }

        throw new Error(`Unexpected Cognito command: ${command.constructor.name}`);
      },
    },
    documentClient: {
      send: async () => ({}),
    },
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/users",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": "[admin]",
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
});

test("admin endpoints accept whitespace-delimited cognito group claims", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  const handler = createHandler({
    cognitoClient: {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === "ListUsersCommand") {
          return {
            Users: [],
          };
        }

        throw new Error(`Unexpected Cognito command: ${command.constructor.name}`);
      },
    },
    documentClient: {
      send: async () => ({}),
    },
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/users",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": "[priest admin servant]",
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
});

test("admin user listing filters tenant users locally without a Cognito filter", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_example";
  const listUsersInputs: Array<Record<string, unknown>> = [];
  const handler = createHandler({
    cognitoClient: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "ListUsersCommand") {
          listUsersInputs.push(command.input);
          return {
            Users: [
              {
                Username: "admin@example.com",
                Enabled: true,
                UserStatus: "CONFIRMED",
                Attributes: [
                  { Name: "sub", Value: "user-123" },
                  { Name: "email", Value: "admin@example.com" },
                  { Name: "name", Value: "Admin Example" },
                  { Name: "custom:tenantId", Value: "tenant-abc" },
                ],
              },
              {
                Username: "other@example.com",
                Enabled: true,
                UserStatus: "CONFIRMED",
                Attributes: [
                  { Name: "sub", Value: "user-456" },
                  { Name: "email", Value: "other@example.com" },
                  { Name: "name", Value: "Other Example" },
                  { Name: "custom:tenantId", Value: "tenant-other" },
                ],
              },
            ],
          };
        }

        if (command.constructor.name === "AdminListGroupsForUserCommand") {
          return {
            Groups: [{ GroupName: "admin" }],
          };
        }

        throw new Error(`Unexpected Cognito command: ${command.constructor.name}`);
      },
    },
    documentClient: {
      send: async () => ({}),
    },
  });

  const response = await handler(
    createEvent({
      rawPath: "/admin/users",
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              "cognito:groups": ["admin"],
              "custom:tenantId": "tenant-abc",
              email: "admin@example.com",
              name: "Admin Example",
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
  assert.equal(listUsersInputs.length, 1);
  assert.equal(listUsersInputs[0]?.Filter, undefined);
  assert.match(String(response.body), /admin@example\.com/);
  assert.doesNotMatch(String(response.body), /other@example\.com/);
});
