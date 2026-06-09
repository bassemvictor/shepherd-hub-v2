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
  groups: ["sales_engineer", "sales_manager", "pricing_engineer", "admin", "super_user"],
});
