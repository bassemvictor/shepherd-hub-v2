import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";

import { auth } from "./auth/resource.js";
import { projectTemplateApi } from "./functions/project-template-api/resource.js";

const backend = defineBackend({
  auth,
  projectTemplateApi,
});

const apiStack = backend.createStack("project-template-api");
const dataStack = backend.createStack("project-template-data");

const tableName = process.env.PROJECT_TEMPLATE_TABLE?.trim();

const recordsTable = new Table(dataStack, "ProjectTemplateTable", {
  ...(tableName ? { tableName } : {}),
  billingMode: BillingMode.PAY_PER_REQUEST,
  partitionKey: {
    name: "PK",
    type: AttributeType.STRING,
  },
  sortKey: {
    name: "SK",
    type: AttributeType.STRING,
  },
});

recordsTable.addGlobalSecondaryIndex({
  indexName: "GSI1",
  partitionKey: {
    name: "GSI1PK",
    type: AttributeType.STRING,
  },
  sortKey: {
    name: "GSI1SK",
    type: AttributeType.STRING,
  },
});

recordsTable.addGlobalSecondaryIndex({
  indexName: "GSI2",
  partitionKey: {
    name: "GSI2PK",
    type: AttributeType.STRING,
  },
  sortKey: {
    name: "GSI2SK",
    type: AttributeType.STRING,
  },
});

recordsTable.addGlobalSecondaryIndex({
  indexName: "GSI3",
  partitionKey: {
    name: "GSI3PK",
    type: AttributeType.STRING,
  },
  sortKey: {
    name: "GSI3SK",
    type: AttributeType.STRING,
  },
});

backend.projectTemplateApi.addEnvironment("PROJECT_TEMPLATE_TABLE", recordsTable.tableName);
backend.projectTemplateApi.addEnvironment("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID ?? "");
backend.projectTemplateApi.addEnvironment("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET ?? "");
backend.projectTemplateApi.addEnvironment("GOOGLE_REDIRECT_URI", process.env.GOOGLE_REDIRECT_URI ?? "");
backend.projectTemplateApi.addEnvironment(
  "GOOGLE_OAUTH_SUCCESS_REDIRECT_URL",
  process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT_URL ?? "",
);
recordsTable.grantReadWriteData(backend.projectTemplateApi.resources.lambda);

const httpApi = new HttpApi(apiStack, "ProjectTemplateHttpApi", {
  apiName: "projectTemplateApi",
  corsPreflight: {
    allowOrigins: ["*"],
    allowHeaders: ["content-type", "authorization"],
    allowMethods: [
      CorsHttpMethod.GET,
      CorsHttpMethod.POST,
      CorsHttpMethod.PUT,
      CorsHttpMethod.DELETE,
      CorsHttpMethod.OPTIONS,
    ],
  },
  createDefaultStage: true,
});

const integration = new HttpLambdaIntegration(
  "ProjectTemplateApiIntegration",
  backend.projectTemplateApi.resources.lambda,
  {
    scopePermissionToRoute: false,
  },
);

const authorizer = new HttpUserPoolAuthorizer("ProjectTemplateAuthorizer", backend.auth.resources.userPool, {
  userPoolClients: [backend.auth.resources.userPoolClient],
});

const addProtectedRoutes = (path: string, methods: HttpMethod[]) =>
  httpApi.addRoutes({
    path,
    methods,
    integration,
    authorizer,
  });

addProtectedRoutes("/members", [HttpMethod.GET, HttpMethod.POST]);
addProtectedRoutes("/members/index", [HttpMethod.GET]);
addProtectedRoutes("/members/import", [HttpMethod.POST]);
addProtectedRoutes("/members/{memberId}", [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE]);
addProtectedRoutes("/members/{memberId}/events", [HttpMethod.GET]);
addProtectedRoutes("/members/{memberId}/visitations", [HttpMethod.POST]);
addProtectedRoutes("/members/{memberId}/visitations/{visitationId}", [HttpMethod.PUT, HttpMethod.DELETE]);
addProtectedRoutes("/events/{eventId}/members", [HttpMethod.GET, HttpMethod.PUT]);
addProtectedRoutes("/reports/visitations", [HttpMethod.GET]);
addProtectedRoutes("/schedule/overview", [HttpMethod.GET]);
addProtectedRoutes("/schedule/google/connect", [HttpMethod.POST]);
addProtectedRoutes("/schedule/google/connection", [HttpMethod.DELETE]);
addProtectedRoutes("/schedule/calendars/refresh", [HttpMethod.POST]);
addProtectedRoutes("/schedule/settings", [HttpMethod.PUT]);
addProtectedRoutes("/schedule/calendars/{calendarId}", [HttpMethod.PUT]);
addProtectedRoutes("/schedule/calendars/{calendarId}/sync", [HttpMethod.POST]);
addProtectedRoutes("/schedule/calendars/{calendarId}/cache", [HttpMethod.DELETE]);
addProtectedRoutes("/schedule/sync", [HttpMethod.POST]);
addProtectedRoutes("/schedule/cache", [HttpMethod.DELETE]);
addProtectedRoutes("/schedule/events", [HttpMethod.GET, HttpMethod.POST]);
addProtectedRoutes("/schedule/events/{eventId}", [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE]);

httpApi.addRoutes({
  path: "/schedule/google/callback",
  methods: [HttpMethod.GET],
  integration,
});

backend.addOutput({
  custom: {
    API: {
      [httpApi.httpApiName!]: {
        apiName: httpApi.httpApiName,
        endpoint: httpApi.url,
        region: Stack.of(httpApi).region,
      },
    },
    storage: {
      recordsTable: {
        region: Stack.of(recordsTable).region,
        tableName: recordsTable.tableName,
      },
    },
  },
});
