import assert from "node:assert/strict";
import test from "node:test";

import {
  canEditCongregation,
  isAdminUser,
  isOutreachAdminUser,
  isRegularServantUser,
} from "../../src/lib/auth";

test("frontend authorization helpers expose the outreach role semantics", () => {
  assert.equal(isOutreachAdminUser(["admin"]), true);
  assert.equal(isOutreachAdminUser(["outreach_admin"]), true);
  assert.equal(isAdminUser(["outreach_admin"]), false);
  assert.equal(canEditCongregation(["priest"]), true);
  assert.equal(canEditCongregation(["servant"]), false);
  assert.equal(isRegularServantUser(["servant"]), true);
  assert.equal(isRegularServantUser(["servant", "outreach_admin"]), false);
});
