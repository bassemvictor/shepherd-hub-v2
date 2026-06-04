import { defineFunction } from "@aws-amplify/backend";

export const projectTemplateApi = defineFunction({
  name: "project-template-api",
  memoryMB: 256,
  runtime: 24,
  timeoutSeconds: 30,
});
