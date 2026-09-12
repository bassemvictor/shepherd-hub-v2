import assert from "node:assert/strict";
import test from "node:test";
import { encodeCsv, loadReportExportRows } from "../shared/report-export.js";
import { createHandler } from "../amplify/functions/shepherd-hub-api/handler.js";

// Transaction-aware DynamoDB double: conditions are evaluated against the old
// snapshot before any writes commit. This exercises race/failure paths too.
type Item = Record<string, any>;
const keyOf = (item: Item) => `${item.PK}|${item.SK}`;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fixture = () => {
  process.env.SHEPHERD_HUB_RECORDS_TABLE = "records-table";
  process.env.COGNITO_USER_POOL_ID = "pool";
  const items = new Map<string, Item>();
  const commands: { name: string; input: Item }[] = [];
  let seq = 0;
  let rejectNextTransaction = false;
  const check = (write: Item) => {
    const item = items.get(keyOf(write.Item ?? write.Key));
    const expr = write.ConditionExpression ?? "";
    const values = write.ExpressionAttributeValues ?? {};
    if (expr.includes("attribute_not_exists(PK)") && item) return false;
    if (expr.includes("attribute_exists(PK)") && !item) return false;
    if (expr.includes("attribute_not_exists(tagIds)") && item?.tagIds !== undefined) return false;
    if (expr.includes("tagIds = :previousTags") && !equal(item?.tagIds, values[":previousTags"]))
      return false;
    if (expr.includes("revision = :version") && item?.revision !== values[":version"]) return false;
    if (expr.includes("assignmentCount = :count") && item?.assignmentCount !== values[":count"]) return false;
    if (expr.includes("assignmentCount = :zero") && item?.assignmentCount !== 0) return false;
    if (expr.includes("assignmentCount > :zero") && !(item?.assignmentCount > 0)) return false;
    if (
      expr.includes("#active = :active") &&
      (!item?.active || ![values[":target"], values[":both"]].includes(item.target))
    )
      return false;
    return true;
  };
  const fail = () => {
    const error = new Error("TransactionCanceledException");
    error.name = "TransactionCanceledException";
    throw error;
  };
  const apply = (operation: Item) => {
    if (operation.Put) items.set(keyOf(operation.Put.Item), structuredClone(operation.Put.Item));
    if (operation.Delete) items.delete(keyOf(operation.Delete.Key));
    if (operation.Update) {
      const write = operation.Update;
      const item = items.get(keyOf(write.Key))!;
      if (write.UpdateExpression === "ADD assignmentCount :delta")
        item.assignmentCount += write.ExpressionAttributeValues[":delta"];
    }
  };
  const send = async (command: { constructor: { name: string }; input: Item }): Promise<any> => {
    const input = command.input;
    const name = command.constructor.name;
    commands.push({ name, input });
    if (name === "GetCommand") return { Item: structuredClone(items.get(keyOf(input.Key))) };
    if (name === "TransactWriteCommand") {
      if (rejectNextTransaction) {
        rejectNextTransaction = false;
        fail();
      }
      if (
        !input.TransactItems.every((op: Item) => check(op.Put ?? op.Update ?? op.Delete ?? op.ConditionCheck))
      )
        fail();
      input.TransactItems.forEach(apply);
      return {};
    }
    if (name === "PutCommand" || name === "DeleteCommand") {
      if (!check(input)) fail();
      apply(name === "PutCommand" ? { Put: input } : { Delete: input });
      return {};
    }
    if (name === "BatchGetCommand")
      return {
        Responses: Object.fromEntries(
          Object.entries(input.RequestItems).map(([table, request]) => [
            table,
            (request as Item).Keys.map((key: Item) => structuredClone(items.get(keyOf(key)))).filter(Boolean),
          ]),
        ),
      };
    if (name === "BatchWriteCommand") {
      Object.values(input.RequestItems)
        .flat()
        .forEach((write: any) =>
          apply(write.DeleteRequest ? { Delete: write.DeleteRequest } : { Put: write.PutRequest }),
        );
      return {};
    }
    if (name === "QueryCommand") {
      const values = input.ExpressionAttributeValues ?? {};
      const index = input.IndexName;
      let found = [...items.values()].filter((item) =>
        index ? item[`${index}PK`] === values[":gsiPk"] : item.PK === values[":pk"],
      );
      if (index && values[":from"])
        found = found.filter(
          (item) => item[`${index}SK`] >= values[":from"] && item[`${index}SK`] <= values[":to"],
        );
      const prefix = values[":prefix"] ?? values[":sk"];
      if (prefix) found = found.filter((item) => item.SK.startsWith(prefix));
      if (index && values[":gsiSk"]) found = found.filter((item) => item[`${index}SK`] === values[":gsiSk"]);
      return { Items: structuredClone(found), Count: found.length };
    }
    if (name === "ScanCommand")
      return {
        Items: structuredClone(
          [...items.values()].filter(
            (item) => item.tenantId === input.ExpressionAttributeValues[":tenantId"],
          ),
        ),
      };
    return {};
  };
  const handler = createHandler({
    documentClient: { send },
    cognitoClient: { send: async () => ({ Users: [] }) },
    now: () => "2026-09-11T12:00:00.000Z",
    uuid: () => `id-${++seq}`,
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
    tenant = "one",
    role = "admin",
  ) => {
    const segments = path.split("/");
    const response = (await handler(
      {
        rawPath: path,
        body: body === undefined ? undefined : JSON.stringify(body),
        queryStringParameters: query,
        pathParameters: {
          memberId: segments[1] === "members" ? segments[2] : undefined,
          householdId: segments[1] === "households" ? segments[2] : undefined,
          action: segments[1] === "admin" ? segments[3] : undefined,
        },
        requestContext: {
          http: { method },
          authorizer: {
            jwt: {
              claims: {
                "custom:tenantId": tenant,
                "cognito:groups": [role],
                sub: "user",
                name: "User",
                email: "user@example.com",
              },
            },
          },
        },
      } as never,
      {} as never,
      () => {},
    )) as { statusCode: number; body: string };
    return { status: response.statusCode, body: JSON.parse(response.body) };
  };
  const tag = async (name: string, target = "both", tenant = "one") => {
    const result = await call("POST", "/tags", { name, target, active: true }, {}, tenant);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const member = async (name: string, ids?: string[]) => {
    const result = await call("POST", "/members", { fullName: name, tagIds: ids });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const household = async (name: string, ids?: string[]) => {
    const result = await call("POST", "/households", { householdName: name, tagIds: ids, memberIds: [] });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  return {
    items,
    commands,
    call,
    tag,
    member,
    household,
    reject: () => {
      rejectNextTransaction = true;
    },
  };
};

test("tag management normalizes names, enforces tenant uniqueness, rename, activation and deletion", async () => {
  const f = fixture();
  const tag = await f.tag("  Newcomer  ", "member");
  assert.equal(tag.name, "Newcomer");
  assert.equal(tag.normalizedName, "newcomer");
  for (const name of ["NEWCOMER", "newcomer", "Ｎｅｗｃｏｍｅｒ"])
    assert.equal((await f.call("POST", "/tags", { name, target: "both" })).status, 409);
  await f.tag("NEWCOMER", "both", "two");
  assert.equal(
    (await f.call("PUT", `/tags/${tag.tagId}`, { name: "New Member", active: false })).status,
    200,
  );
  assert.equal((await f.call("GET", "/tags")).body.items.length, 0);
  assert.equal(
    (await f.call("GET", "/tags", undefined, { includeInactive: "true" })).body.items[0].name,
    "New Member",
  );
  assert.equal((await f.call("DELETE", `/tags/${tag.tagId}`)).status, 200);
  await f.tag("New Member");
  assert.equal((await f.call("GET", "/tags", undefined, {}, "two")).body.items.length, 1);
});

test("tag APIs enforce admin writes, protected reads, scope and validation", async () => {
  const f = fixture();
  const tag = await f.tag("Youth", "member");
  await f.tag("Family", "household");
  await f.tag("Follow-up", "both");
  assert.equal(
    (await f.call("GET", "/tags", undefined, { target: "member" }, "one", "servant")).body.items.length,
    2,
  );
  assert.equal((await f.call("GET", "/tags", undefined, { target: "both" })).body.items.length, 1);
  for (const role of ["priest", "servant"])
    for (const method of ["POST", "PUT", "DELETE"]) {
      assert.equal(
        (
          await f.call(
            method,
            method === "POST" ? "/tags" : `/tags/${tag.tagId}`,
            { name: "Other", target: "both" },
            {},
            "one",
            role,
          )
        ).status,
        403,
      );
    }
  assert.equal((await f.call("PUT", `/tags/${tag.tagId}`, { name: "Other" }, {}, "two")).status, 404);
  assert.equal((await f.call("DELETE", `/tags/${tag.tagId}`, undefined, {}, "two")).status, 404);
  for (const input of [
    { name: " " },
    { name: "a".repeat(61) },
    { name: "ok", target: "bad" },
    { name: "ok", color: "red" },
    { name: "ok", active: "yes" },
  ]) {
    assert.equal((await f.call("POST", "/tags", { target: "both", ...input })).status, 400);
  }
});

for (const target of ["member", "household"] as const) {
  test(`${target} assignments validate target, tenant, inactive and invalid IDs; preserve omitted IDs`, async () => {
    const f = fixture();
    const a = await f.tag("A", target);
    const b = await f.tag("B");
    const wrong = await f.tag("Wrong", target === "member" ? "household" : "member");
    const foreign = await f.tag("Foreign", "both", "two");
    const entity = await f[target]("Example", [a.tagId, b.tagId]);
    const id = entity[`${target}Id`];
    const path = `/${target}s/${id}`;
    assert.deepEqual(entity.tagIds, [a.tagId, b.tagId].sort());
    assert.equal(
      (await f.call("GET", "/tags")).body.items.find((tag: Item) => tag.tagId === a.tagId).assignmentCount,
      1,
    );
    for (const ids of [
      ["missing"],
      [wrong.tagId],
      [foreign.tagId],
      ["bad#id"],
      null,
      "bad",
      Array(21).fill(a.tagId),
    ]) {
      assert.equal((await f.call("PUT", path, { tagIds: ids })).status, 400);
      assert.deepEqual(f.items.get(`TENANT#one|${target.toUpperCase()}#${id}`)?.tagIds, entity.tagIds);
    }
    assert.equal(
      (
        await f.call(
          "PUT",
          path,
          target === "member" ? { fullName: "Renamed" } : { householdName: "Renamed" },
        )
      ).status,
      200,
    );
    assert.deepEqual(f.items.get(`TENANT#one|${target.toUpperCase()}#${id}`)?.tagIds, entity.tagIds);
    assert.equal((await f.call("PUT", `/tags/${a.tagId}`, { target: "both" })).status, 409);
    assert.equal((await f.call("DELETE", `/tags/${a.tagId}`)).status, 409);
    assert.equal((await f.call("PUT", `/tags/${a.tagId}`, { active: false })).status, 200);
    assert.equal((await f.call("PUT", path, { tagIds: [a.tagId] })).status, 200);
    const fresh = await f[target]("No tags");
    assert.equal(
      (await f.call("PUT", `/${target}s/${fresh[`${target}Id`]}`, { tagIds: [a.tagId] })).status,
      400,
    );
    assert.equal((await f.call("PUT", path, { tagIds: [] })).status, 200);
    assert.equal((await f.call("DELETE", `/tags/${a.tagId}`)).status, 200);
    assert.equal([...f.items.values()].filter((item) => item.entityType === "TAG_ASSIGNMENT").length, 0);
  });

  test(`${target} ANY/ALL filters combine with search, zero results and tenant isolation`, async () => {
    const f = fixture();
    const a = await f.tag("A");
    const b = await f.tag("B");
    const one = await f[target]("Alpha", [a.tagId]);
    const two = await f[target]("Beta", [a.tagId, b.tagId]);
    await f[target]("Gamma", [b.tagId]);
    await f[target]("Delta");
    const route = target === "member" ? "/members/index" : "/households";
    const check = async (ids: string[], mode: string, expected: number, extra = {}) => {
      const result = await f.call("GET", route, undefined, {
        tagIds: ids.join(","),
        tagMatchMode: mode,
        ...extra,
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.items.length, expected);
      return result.body;
    };
    await check([a.tagId], "any", 2);
    await check([a.tagId, b.tagId], "any", 3);
    await check([a.tagId, b.tagId], "all", 1);
    await check([a.tagId, "missing"], "all", 0);
    await check([a.tagId], "any", 1, { q: "alpha" });
    assert.equal((await f.call("GET", route, undefined, { tagIds: a.tagId }, "two")).body.items.length, 0);
    if (target === "household") {
      const first = await check([a.tagId], "any", 1, { limit: "1" });
      assert.equal(first.total, 2);
      assert.equal(first.items[0].householdId, one.householdId);
      const second = await check([a.tagId], "any", 1, { limit: "1", cursor: first.nextCursor });
      assert.equal(second.items[0].householdId, two.householdId);
      assert.equal(second.nextCursor, undefined);
    }
    assert.equal(
      f.commands.some((command) => command.name === "ScanCommand"),
      false,
    );
  });
}

test("failed assignment transaction leaves entity, index and counters unchanged", async () => {
  const f = fixture();
  const tag = await f.tag("A");
  const member = await f.member("Alpha");
  const before = structuredClone([...f.items]);
  f.reject();
  assert.equal((await f.call("PUT", `/members/${member.memberId}`, { tagIds: [tag.tagId] })).status, 409);
  assert.deepEqual([...f.items], before);
});

test("report tag filters affect rows, pagination, KPIs and activity charts, including never visited", async () => {
  const f = fixture();
  const tag = await f.tag("Youth");
  const a = await f.member("Alpha", [tag.tagId]);
  await f.member("Beta", [tag.tagId]);
  const c = await f.member("Other");
  for (const member of [a, c])
    f.items.set(`visit-${member.memberId}`, {
      PK: "TENANT#one",
      SK: `VISITATION#${member.memberId}`,
      GSI1PK: "TENANT#one",
      GSI1SK: "VISIT#2026-09-01",
      tenantId: "one",
      entityType: "VISITATION",
      memberId: member.memberId,
      visitDate: "2026-09-01",
      visitorUserId: "user",
      visitorDisplayName: "User",
      type: "Visitation",
    });
  const params = {
    tagIds: tag.tagId,
    sinceBeginning: "true",
    pageSize: "1",
    visitCountMode: "all",
    status: "all",
  };
  const report = (await f.call("GET", "/reports/visitations", undefined, params)).body;
  assert.equal(report.summary.totalMembers, 2);
  assert.equal(report.summary.matchingMembers, 2);
  assert.equal(report.pagination.totalPages, 2);
  assert.equal(report.rows.length, 1);
  const next = (await f.call("GET", "/reports/visitations", undefined, { ...params, page: "2" })).body;
  assert.notEqual(report.rows[0].memberId, next.rows[0].memberId);
  assert.equal(report.summary.visitedInRangeMembers, 1);
  assert.equal(report.activityTypeDistribution[0].count, 1);
  const never = (
    await f.call("GET", "/reports/visitations", undefined, { ...params, status: "never_visited" })
  ).body;
  assert.equal(never.summary.totalMembers, 1);
  assert.equal(never.summary.notVisitedMembers, 1);
  assert.equal(never.rows[0].memberFullName, "Beta");
  assert.equal(never.activityTypeDistribution[0].count, 0);
  assert.equal(never.monthlyActivityTrend.length, 0);
  assert.equal(never.topVisitors.length, 0);
  const search = (await f.call("GET", "/reports/visitations", undefined, { ...params, search: "alpha" }))
    .body;
  assert.equal(search.pagination.totalItems, 1);
  const empty = (await f.call("GET", "/reports/visitations", undefined, { ...params, tagIds: "missing" }))
    .body;
  assert.equal(empty.summary.totalMembers, 0);
  assert.equal(empty.rows.length, 0);
});

test("household reports filter geography and members without inheriting assignments", async () => {
  const f = fixture();
  const tag = await f.tag("Family", "household");
  const h = await f.household("Family", [tag.tagId]);
  await f.household("Other");
  const member = await f.member("Alpha");
  const item = f.items.get(`TENANT#one|MEMBER#${member.memberId}`)!;
  item.householdId = h.householdId;
  const household = f.items.get(`TENANT#one|HOUSEHOLD#${h.householdId}`)!;
  household.memberCount = 1;
  household.members = [{ memberId: member.memberId, fullName: "Alpha" }];
  household.location = { latitude: 45, longitude: -75 };
  const report = (
    await f.call("GET", "/reports/visitations", undefined, {
      householdTagIds: tag.tagId,
      sinceBeginning: "true",
    })
  ).body;
  assert.equal(report.summary.totalMembers, 1);
  assert.equal(report.rows[0].memberId, member.memberId);
  assert.deepEqual(item.tagIds ?? [], []);
  const geography = (
    await f.call("GET", "/reports/visitation-geography", undefined, { householdTagIds: tag.tagId })
  ).body;
  assert.equal(geography.summary.totalHouseholds, 1);
  assert.equal(geography.summary.totalMembers, 1);
  assert.equal(geography.households.features.length, 1);
  assert.equal(
    geography.areas.reduce((sum: number, area: Item) => sum + area.households, 0),
    1,
  );
});

test("full tenant reset removes definitions, name locks and assignments only for its tenant", async () => {
  const f = fixture();
  const tag = await f.tag("A");
  await f.member("Alpha", [tag.tagId]);
  await f.tag("Other", "both", "two");
  const response = await f.call("POST", "/admin/reset/tenant_all", {});
  assert.equal(response.status, 200);
  assert.equal(
    [...f.items.values()].some(
      (item) => item.tenantId === "one" && ["TAG", "TAG_NAME", "TAG_ASSIGNMENT"].includes(item.entityType),
    ),
    false,
  );
  assert.equal((await f.call("GET", "/tags", undefined, {}, "two")).body.items.length, 1);
});

test("concurrent assignments cannot overwrite each other or leave orphan indexes", async () => {
  const f = fixture();
  const a = await f.tag("A");
  const b = await f.tag("B");
  const member = await f.member("Alpha");
  const results = await Promise.all(
    [a, b].map((tag) => f.call("PUT", `/members/${member.memberId}`, { tagIds: [tag.tagId] })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const stored = f.items.get(`TENANT#one|MEMBER#${member.memberId}`)!;
  const assignments = [...f.items.values()].filter((item) => item.entityType === "TAG_ASSIGNMENT");
  assert.deepEqual(
    assignments.map((item) => item.tagId),
    stored.tagIds,
  );
  assert.equal(
    (await f.call("GET", "/tags")).body.items.reduce(
      (sum: number, tag: Item) => sum + tag.assignmentCount,
      0,
    ),
    1,
  );
});

test("concurrent case-insensitive duplicate creation commits only one name", async () => {
  const f = fixture();
  const results = await Promise.all(
    ["Youth", "YOUTH"].map((name) => f.call("POST", "/tags", { name, target: "both" })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await f.call("GET", "/tags")).body.items.length, 1);
});

test("CSV export fetches every page with the applied tag filters and escapes labels", async () => {
  const f = fixture();
  const tag = await f.tag("Youth");
  for (let i = 0; i < 102; i++) await f.member(`Member ${String(i).padStart(3, "0")}`, [tag.tagId]);
  await f.member("Excluded");
  const initial = (
    await f.call("GET", "/reports/visitations", undefined, {
      tagIds: tag.tagId,
      pageSize: "25",
      page: "2",
      sinceBeginning: "true",
    })
  ).body;
  const pages: number[] = [];
  const rows = await loadReportExportRows(initial.filters, async (filters) => {
    pages.push(filters.page);
    assert.deepEqual(filters.tagIds, [tag.tagId]);
    return (
      await f.call("GET", "/reports/visitations", undefined, {
        tagIds: filters.tagIds!.join(","),
        tagMatchMode: filters.tagMatchMode!,
        sinceBeginning: "true",
        pageSize: String(filters.pageSize),
        page: String(filters.page),
      })
    ).body;
  });
  assert.equal(rows.length, 102);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(new Set(rows.map((row) => row.memberId)).size, 102);
  assert.equal(encodeCsv(rows.map((row) => [row.memberFullName])).includes("Excluded"), false);
  assert.equal(encodeCsv([["A, B", 'Say "hello"']]), '"A, B","Say ""hello"""');
});

for (const target of ["member", "household"] as const) {
  test(`${target} deletion atomically removes assignments and permits tag deletion`, async () => {
    const f = fixture();
    const tag = await f.tag("A");
    const entity = await f[target]("Alpha", [tag.tagId]);
    const result = await f.call("DELETE", `/${target}s/${entity[`${target}Id`]}`);
    assert.equal(result.status, 200);
    assert.equal(
      [...f.items.values()].some((item) => item.entityType === "TAG_ASSIGNMENT"),
      false,
    );
    assert.equal((await f.call("DELETE", `/tags/${tag.tagId}`)).status, 200);
  });
}

test("member reset clears assignment counters while preserving reusable definitions", async () => {
  const f = fixture();
  const tag = await f.tag("Follow-up");
  await f.member("Alpha", [tag.tagId]);
  await f.household("Family", [tag.tagId]);
  assert.equal((await f.call("POST", "/admin/reset/members", {})).status, 200);
  const tags = (await f.call("GET", "/tags")).body.items;
  assert.equal(tags.length, 1);
  assert.equal(tags[0].assignmentCount, 0);
  assert.equal(
    [...f.items.values()].some((item) => item.entityType === "TAG_ASSIGNMENT"),
    false,
  );
});
