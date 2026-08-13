import { defineBackend } from "@aws-amplify/backend";
import { Duration, Stack } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";

import { auth } from "./auth/resource.js";
import { shepherdHubApi } from "./functions/shepherd-hub-api/resource.js";

const backend = defineBackend({
  auth,
  shepherdHubApi,
});

const apiStack = backend.createStack("project-template-api");
const dataStack = backend.createStack("project-template-data");

const tableName = process.env.SHEPHERD_HUB_RECORDS_TABLE?.trim();

const recordsTable = new Table(dataStack, "SHTable", {
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

recordsTable.addGlobalSecondaryIndex({
  indexName: "GSI4",
  partitionKey: {
    name: "GSI4PK",
    type: AttributeType.STRING,
  },
  sortKey: {
    name: "GSI4SK",
    type: AttributeType.STRING,
  },
});

recordsTable.addGlobalSecondaryIndex({
  indexName: "GSI5",
  partitionKey: {
    name: "GSI5PK",
    type: AttributeType.STRING,
  },
  sortKey: {
    name: "GSI5SK",
    type: AttributeType.STRING,
  },
});

backend.shepherdHubApi.addEnvironment("SHEPHERD_HUB_RECORDS_TABLE", recordsTable.tableName);
backend.shepherdHubApi.addEnvironment("COGNITO_USER_POOL_ID", backend.auth.resources.userPool.userPoolId);
backend.shepherdHubApi.addEnvironment("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID ?? "");
backend.shepherdHubApi.addEnvironment("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET ?? "");
backend.shepherdHubApi.addEnvironment("GOOGLE_REDIRECT_URI", process.env.GOOGLE_REDIRECT_URI ?? "");
backend.shepherdHubApi.addEnvironment(
  "GOOGLE_OAUTH_SUCCESS_REDIRECT_URL",
  process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT_URL ?? "",
);
recordsTable.grantReadWriteData(backend.shepherdHubApi.resources.lambda);
backend.shepherdHubApi.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:ListUsers",
    ],
    resources: [backend.auth.resources.userPool.userPoolArn],
  }),
);

const httpApi = new HttpApi(apiStack, "ProjectTemplateHttpApi", {
  apiName: "shepherdHubApi",
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
  backend.shepherdHubApi.resources.lambda,
  {
    scopePermissionToRoute: false,
  },
);

const importIntegration = new HttpLambdaIntegration(
  "ProjectTemplateImportIntegration",
  backend.shepherdHubApi.resources.lambda,
  {
    scopePermissionToRoute: false,
    // HTTP API integrations top out at 30 seconds, so keep this just under the cap explicitly.
    timeout: Duration.seconds(29),
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
httpApi.addRoutes({
  path: "/members/import",
  methods: [HttpMethod.POST],
  integration: importIntegration,
  authorizer,
});
httpApi.addRoutes({
  path: "/members/import/{jobId}",
  methods: [HttpMethod.GET],
  integration: importIntegration,
  authorizer,
});
addProtectedRoutes("/members/{memberId}", [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE]);
addProtectedRoutes("/members/{memberId}/household", [HttpMethod.POST, HttpMethod.DELETE]);
addProtectedRoutes("/members/{memberId}/events", [HttpMethod.GET]);
addProtectedRoutes("/members/{memberId}/visitations", [HttpMethod.POST]);
addProtectedRoutes("/members/{memberId}/visitations/{visitationId}", [HttpMethod.PUT, HttpMethod.DELETE]);
addProtectedRoutes("/household-conflicts", [HttpMethod.GET]);
addProtectedRoutes("/household-conflicts/{memberId}/resolve", [HttpMethod.POST]);
addProtectedRoutes("/households", [HttpMethod.GET, HttpMethod.POST]);
addProtectedRoutes("/households/match", [HttpMethod.POST]);
addProtectedRoutes("/households/{householdId}", [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE]);
addProtectedRoutes("/households/{householdId}/members", [HttpMethod.POST]);
addProtectedRoutes("/households/{householdId}/members/{memberId}", [HttpMethod.DELETE]);
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
addProtectedRoutes("/admin/users", [HttpMethod.GET]);
addProtectedRoutes("/admin/users/{username}/groups", [HttpMethod.PUT]);
addProtectedRoutes("/admin/reset/{action}", [HttpMethod.POST]);

httpApi.addRoutes({
  path: "/schedule/google/callback",
  methods: [HttpMethod.GET],
  integration,
});

backend.addOutput({
  custom: {
    API: {
      shepherdHubApi: {
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
