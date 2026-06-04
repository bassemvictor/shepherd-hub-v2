import { defineAuth } from "@aws-amplify/backend";

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ["sales_engineer", "sales_manager", "pricing_engineer", "admin", "super_user"],
});
