import { defineFunction } from "@aws-amplify/backend";

export const shepherdHubApi = defineFunction({
  name: "shepherd-hub-api",
  memoryMB: 1024,
  runtime: 24,
  timeoutSeconds: 120,
});
