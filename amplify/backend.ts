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

backend.projectTemplateApi.addEnvironment("PROJECT_TEMPLATE_TABLE", recordsTable.tableName);
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

addProtectedRoutes("/dashboard/summary", [HttpMethod.GET]);
addProtectedRoutes("/records", [HttpMethod.GET, HttpMethod.POST]);
addProtectedRoutes("/records/{recordId}", [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE]);

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
