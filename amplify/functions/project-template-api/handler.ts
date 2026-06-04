import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2, APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

import type { AppCognitoGroup, DashboardSummary, RecordStatus, SampleRecord, SampleRecordInput } from "../../../shared/types.js";

type StoredEntity = {
  PK: string;
  SK: string;
  entityType: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  recordId: string;
  name: string;
  status: RecordStatus;
  owner: string;
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
};

const defaultDependencies: HandlerDependencies = {
  documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  now: () => new Date().toISOString(),
  uuid: () => randomUUID(),
};

const allGroups: AppCognitoGroup[] = [
  "sales_engineer",
  "sales_manager",
  "pricing_engineer",
  "admin",
  "super_user",
];

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
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
    typeof rawGroups === "string"
      ? normalizeGroups([rawGroups])
      : normalizeGroups(rawGroups);

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

export const createHandler = (deps: HandlerDependencies = defaultDependencies): APIGatewayProxyHandlerV2 =>
  async (event) => {
    try {
      const typedEvent = event as APIGatewayProxyEventV2WithJWTAuthorizer;
      const context = getContext(typedEvent);
      const method = typedEvent.requestContext.http.method;
      const path = typedEvent.rawPath;
      const recordId = typedEvent.pathParameters?.recordId;

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

      return json(404, { message: "Route not found." });
    } catch (error) {
      return json(500, {
        message: error instanceof Error ? error.message : "Unexpected server error.",
      });
    }
  };

export const handler = createHandler();
