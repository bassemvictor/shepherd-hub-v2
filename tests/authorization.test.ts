import assert from "node:assert/strict";
import test from "node:test";

import {
  hasOutreachAdminPrivileges,
  isCongregationEditor,
  isGlobalAdmin,
  isRegularServant,
} from "../shared/authorization.js";

test("authorization roles distinguish outreach administration from global administration", () => {
  assert.equal(hasOutreachAdminPrivileges(["admin"]), true);
  assert.equal(hasOutreachAdminPrivileges(["outreach_admin"]), true);
  assert.equal(isGlobalAdmin(["outreach_admin"]), false);
});

test("congregation editor and regular servant semantics are centralized", () => {
  assert.equal(isCongregationEditor(["priest"]), true);
  assert.equal(isCongregationEditor(["servant"]), false);
  assert.equal(isRegularServant(["servant"]), true);
  assert.equal(isRegularServant(["servant", "outreach_admin"]), false);
});
