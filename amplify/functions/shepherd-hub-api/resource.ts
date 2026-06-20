import { defineFunction } from "@aws-amplify/backend";

export const shepherdHubApi = defineFunction({
  name: "shepherd-hub-api",
  memoryMB: 256,
  runtime: 24,
  timeoutSeconds: 30,
});
