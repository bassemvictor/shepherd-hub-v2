import type { AppCognitoGroup } from "./types.js";

export const hasAnyCognitoGroup = (
  groups: readonly AppCognitoGroup[],
  allowedGroups: readonly AppCognitoGroup[],
) => allowedGroups.some((group) => groups.includes(group));

export const isGlobalAdmin = (groups: readonly AppCognitoGroup[]) =>
  hasAnyCognitoGroup(groups, ["admin"]);

export const hasOutreachAdminPrivileges = (groups: readonly AppCognitoGroup[]) =>
  hasAnyCognitoGroup(groups, ["admin", "outreach_admin"]);

export const isCongregationEditor = (groups: readonly AppCognitoGroup[]) =>
  hasAnyCognitoGroup(groups, ["admin", "outreach_admin", "priest"]);

export const isRegularServant = (groups: readonly AppCognitoGroup[]) =>
  groups.includes("servant") && !isCongregationEditor(groups);
