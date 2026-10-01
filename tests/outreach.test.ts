import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { createHandler } from "../amplify/functions/shepherd-hub-api/handler.js";

const key = (item: Record<string, unknown>) => `${item.PK}|${item.SK}`;

const createStore = () => {
  const items = new Map<string, Record<string, unknown>>();
  const users = [
    { Username: "servant-one", Attributes: [{ Name: "sub", Value: "servant-1" }, { Name: "email", Value: "one@example.com" }, { Name: "name", Value: "Servant One" }, { Name: "custom:tenantId", Value: "tenant-a" }] },
    { Username: "servant-two", Attributes: [{ Name: "sub", Value: "servant-2" }, { Name: "email", Value: "two@example.com" }, { Name: "name", Value: "Servant Two" }, { Name: "custom:tenantId", Value: "tenant-a" }] },
  ];
  const documentClient = { send: async (command: { constructor: { name: string }; input: Record<string, any> }) => {
    const { input } = command;
    if (command.constructor.name === "PutCommand") { items.set(key(input.Item), { ...input.Item }); return {}; }
    if (command.constructor.name === "GetCommand") return { Item: items.get(key(input.Key)) };
    if (command.constructor.name === "QueryCommand") {
      const values = input.ExpressionAttributeValues ?? {};
      const pk = values[":pk"];
      const prefix = values[":prefix"] ?? "";
      return { Items: [...items.values()].filter((item) => item.PK === pk && String(item.SK).startsWith(prefix)) };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      for (const operation of input.TransactItems) {
        if (operation.Put) items.set(key(operation.Put.Item), { ...operation.Put.Item });
        if (operation.Delete) items.delete(key(operation.Delete.Key));
      }
      return {};
    }
    if (command.constructor.name === "BatchWriteCommand") {
      for (const request of input.RequestItems["records-table"] ?? []) if (request.DeleteRequest) items.delete(key(request.DeleteRequest.Key));
      return { UnprocessedItems: {} };
    }
    return {};
  } };
  const cognitoClient = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    if (command.constructor.name === "ListUsersCommand") return { Users: users };
    if (command.constructor.name === "AdminListGroupsForUserCommand") return { Groups: [{ GroupName: "servant" }] };
    return {};
  } };
  return { documentClient, cognitoClient, items };
};

const event = (method: string, path: string, groups: string[], tenantId = "tenant-a", pathParameters?: Record<string, string>, body?: unknown) => ({
  rawPath: path, pathParameters, body: body === undefined ? null : JSON.stringify(body),
  requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: groups.includes("servant") ? "servant-1" : "manager-1", email: "manager@example.com", name: "Manager", "custom:tenantId": tenantId, "cognito:groups": groups } } } },
});

const invoke = async (handler: ReturnType<typeof createHandler>, ...args: Parameters<typeof event>) =>
  handler(event(...args) as never, {} as never, () => undefined) as Promise<APIGatewayProxyStructuredResultV2>;
const body = (response: APIGatewayProxyStructuredResultV2) => JSON.parse(String(response.body));

test("Outreach groups and bidirectional household/servant assignments are tenant scoped", async () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "pool";
  const store = createStore();
  const ids = ["group-1", "group-2", "group-3"];
  const handler = createHandler({ ...store, uuid: () => ids.shift() ?? "audit", now: () => "2026-09-30T12:00:00.000Z" });
  for (const householdId of ["household-1", "household-2"]) store.items.set(`TENANT#tenant-a|HOUSEHOLD#${householdId}`, { PK: "TENANT#tenant-a", SK: `HOUSEHOLD#${householdId}`, entityType: "HOUSEHOLD", householdId, householdName: householdId, tenantId: "tenant-a", createdAt: "x", updatedAt: "x" });

  const first = await invoke(handler, "POST", "/outreach/groups", ["outreach_admin"], "tenant-a", undefined, { name: "Ottawa East" });
  assert.equal(first.statusCode, 201);
  const group1 = body(first).groupId;
  const updated = await invoke(handler, "PUT", `/outreach/groups/${group1}`, ["outreach_admin"], "tenant-a", { groupId: group1 }, { name: "Ottawa East Updated", active: false });
  assert.equal(updated.statusCode, 200);
  assert.equal(body(updated).name, "Ottawa East Updated");
  const second = await invoke(handler, "POST", "/outreach/groups", ["admin"], "tenant-a", undefined, { name: "Orleans A" });
  const group2 = body(second).groupId;
  const third = await invoke(handler, "POST", "/outreach/groups", ["admin"], "tenant-a", undefined, { name: "Private Group" });
  const group3 = body(third).groupId;
  assert.equal((await invoke(handler, "GET", "/outreach/groups", ["priest"])).statusCode, 200);

  assert.equal((await invoke(handler, "PUT", `/outreach/groups/${group1}/households`, ["outreach_admin"], "tenant-a", { groupId: group1 }, { householdIds: ["household-1"] })).statusCode, 200);
  assert.equal(body(await invoke(handler, "PUT", `/outreach/groups/${group2}/households`, ["admin"], "tenant-a", { groupId: group2 }, { householdIds: ["household-1", "household-2"] })).items.length, 2);
  assert.equal((await invoke(handler, "PUT", `/outreach/groups/${group3}/households`, ["admin"], "tenant-a", { groupId: group3 }, { householdIds: ["household-1"] })).statusCode, 200);
  assert.equal(body(await invoke(handler, "GET", "/outreach/households/household-1/groups", ["priest"], "tenant-a", { householdId: "household-1" })).items.length, 2);

  assert.equal((await invoke(handler, "PUT", `/outreach/groups/${group1}/servants`, ["outreach_admin"], "tenant-a", { groupId: group1 }, { servantIds: ["servant-1"] })).statusCode, 200);
  assert.equal((await invoke(handler, "PUT", `/outreach/groups/${group2}/servants`, ["admin"], "tenant-a", { groupId: group2 }, { servantIds: ["servant-2"] })).statusCode, 200);
  assert.equal(body(await invoke(handler, "GET", "/outreach/servants/servant-1/groups", ["servant"], "tenant-a", { userId: "servant-1" })).items.length, 1);
  assert.equal(body(await invoke(handler, "GET", "/outreach/groups", ["servant"])).items.length, 1);
  assert.equal(body(await invoke(handler, "GET", `/outreach/groups/${group1}/households`, ["servant"], "tenant-a", { groupId: group1 })).items.length, 1);
  assert.equal((await invoke(handler, "GET", "/outreach/groups/unassigned/households", ["servant"], "tenant-a", { groupId: "unassigned" })).statusCode, 404);
  assert.equal((await invoke(handler, "POST", "/outreach/groups", ["servant"], "tenant-a", undefined, { name: "Denied" })).statusCode, 403);
  const activity = await invoke(handler, "POST", "/outreach/households/household-1/activities", ["servant"], "tenant-a", { householdId: "household-1" }, { groupId: group1, activityDate: "2026-09-10", activityType: "Visit", comment: "Checked in" });
  assert.equal(activity.statusCode, 201);
  assert.equal(body(activity).comment, "Checked in");
  assert.equal((await invoke(handler, "POST", "/outreach/households/household-1/activities", ["servant"], "tenant-a", { householdId: "household-1" }, { groupId: group3, activityDate: "2026-09-11", activityType: "Visit", comment: "Spoof" })).statusCode, 403);
  assert.equal((await invoke(handler, "POST", "/outreach/households/household-2/activities", ["servant"], "tenant-a", { householdId: "household-2" }, { groupId: group1, activityDate: "2026-09-11", activityType: "Visit", comment: "Denied" })).statusCode, 404);
  assert.equal((await invoke(handler, "POST", "/outreach/households/household-1/activities", ["outreach_admin"], "tenant-a", { householdId: "household-1" }, { groupId: group2, activityDate: "2026-09-12", activityType: "Email", comment: "Follow up" })).statusCode, 201);
  assert.equal((await invoke(handler, "POST", "/outreach/households/household-1/activities", ["admin"], "tenant-a", { householdId: "household-1" }, { groupId: group2, activityDate: "2026-09-13", activityType: "Meeting", comment: "Admin note" })).statusCode, 201);
  const activities = body(await invoke(handler, "GET", "/outreach/households/household-1/activities", ["servant"], "tenant-a", { householdId: "household-1" })).items;
  assert.deepEqual(activities.map((item: { comment: string }) => item.comment), ["Admin note", "Follow up", "Checked in"]);

  assert.equal((await invoke(handler, "PUT", `/outreach/groups/${group1}/households`, ["admin"], "tenant-a", { groupId: group1 }, { householdIds: [] })).statusCode, 200);
  assert.equal(body(await invoke(handler, "GET", "/outreach/households/household-1/groups", ["priest"], "tenant-a", { householdId: "household-1" })).items.length, 1);
  assert.equal((await invoke(handler, "GET", `/outreach/groups/${group1}`, ["admin"], "tenant-b", { groupId: group1 })).statusCode, 404);
  assert.equal((await invoke(handler, "DELETE", `/outreach/groups/${group2}`, ["outreach_admin"], "tenant-a", { groupId: group2 })).statusCode, 200);
  assert.equal(body(await invoke(handler, "GET", "/outreach/servants/servant-1/groups", ["servant"], "tenant-a", { userId: "servant-1" })).items.length, 1);
});
