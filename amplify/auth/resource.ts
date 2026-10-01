import { defineAuth } from "@aws-amplify/backend";

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    "custom:tenantId": {
      dataType: "String",
      mutable: true,
    },
  },
  groups: ["admin", "outreach_admin", "priest", "servant"],
});
