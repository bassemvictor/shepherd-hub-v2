import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

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
