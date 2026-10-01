import assert from "node:assert/strict";
import test from "node:test";
import { afterEach } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

import { buildNavigation } from "../../src/components/layout/side-menu";
import { api } from "../../src/lib/api";
import { outreachApi, toggleOutreachAssignment } from "../../src/lib/outreach";
import type { AppAuthUser } from "../../src/lib/auth";
import { canEditCongregation } from "../../src/lib/auth";
import { filterOutreachHouseholds } from "../../src/pages/outreach-page";
import { paginate } from "../../src/pages/outreach-manage-page";
import { HouseholdOutreachSection } from "../../src/components/outreach/household-outreach-section";
import type { HouseholdSummary } from "../../shared/types";

const user = (groups: AppAuthUser["groups"]): AppAuthUser => ({
  id: "user-1",
  username: "user@example.test",
  email: "user@example.test",
  name: "Test User",
  tenantId: "tenant-1",
  groups,
});

const linksFor = (groups: AppAuthUser["groups"]) =>
  buildNavigation(user(groups)).flatMap((section) => section.items.map((item) => item.href));

afterEach(cleanup);

test("only Outreach administrators receive the Manage Groups navigation link", () => {
  assert.ok(linksFor(["servant"]).includes("/outreach"));
  assert.equal(linksFor(["servant"]).includes("/outreach/manage"), false);
  assert.ok(linksFor(["outreach_admin"]).includes("/outreach/manage"));
  assert.ok(linksFor(["admin"]).includes("/outreach/manage"));
});

test("household and servant selection is independently multi-group safe", () => {
  const groupAHouseholds = toggleOutreachAssignment(["H1"], "H3");
  const groupBHouseholds = toggleOutreachAssignment(["H2"], "H3");
  assert.deepEqual(groupAHouseholds, ["H1", "H3"]);
  assert.deepEqual(groupBHouseholds, ["H2", "H3"]);
  assert.deepEqual(toggleOutreachAssignment(groupAHouseholds, "H1"), ["H3"]);
  assert.deepEqual(groupBHouseholds, ["H2", "H3"]);

  const groupAServants = toggleOutreachAssignment(["S1"], "S3");
  const groupBServants = toggleOutreachAssignment(["S2"], "S3");
  assert.deepEqual(toggleOutreachAssignment(groupAServants, "S1"), ["S3"]);
  assert.deepEqual(groupBServants, ["S2", "S3"]);
});

test("Outreach management pagination and selection are page bounded", () => {
  const ids = Array.from({ length: 52 }, (_, index) => `H${index + 1}`);
  assert.deepEqual(paginate(ids, 1, 25), ids.slice(0, 25));
  assert.deepEqual(paginate(ids, 2, 25), ids.slice(25, 50));
  assert.deepEqual(paginate(ids, 3, 25), ids.slice(50));

  // The header checkbox operates on rows displayed on the current page only;
  // it must never imply that all search matches were selected.
  const selectedFromFirstPage = new Set(paginate(ids, 1, 25));
  assert.equal(selectedFromFirstPage.size, 25);
  assert.equal(selectedFromFirstPage.has("H26"), false);
});

test("group creation uses the typed Outreach API abstraction", async () => {
  const originalPost = api.post;
  const calls: Array<{ path: string; body: unknown }> = [];
  api.post = async <T,>(path: string, body?: unknown) => {
    calls.push({ path, body });
    return { groupId: "group-1", name: "North", active: true } as T;
  };
  try {
    await outreachApi.createGroup({ name: "North", description: "North area", active: true });
    assert.deepEqual(calls, [{ path: "/outreach/groups", body: { name: "North", description: "North area", active: true } }]);
  } finally {
    api.post = originalPost;
  }
});

test("Outreach workspace scopes and searches assigned households, including a shared household", () => {
  const households = [
    { householdId: "H1", householdName: "Alpha", address: "1 Main", postalCode: "A1A 1A1", members: [{ memberId: "M1", fullName: "Mary One" }], memberCount: 1 },
    { householdId: "H2", householdName: "Bravo", address: "2 Main", postalCode: "A1A 1A2", members: [{ memberId: "M2", fullName: "Mark Two" }], memberCount: 1 },
    { householdId: "H3", householdName: "Common", address: "3 Main", postalCode: "A1A 1A3", members: [{ memberId: "M3", fullName: "Casey Shared" }], memberCount: 1 },
  ] as HouseholdSummary[];
  assert.deepEqual(filterOutreachHouseholds(households, new Set(["H1", "H3"]), "").map((item) => item.householdId), ["H1", "H3"]);
  assert.deepEqual(filterOutreachHouseholds(households, new Set(["H2", "H3"]), "casey").map((item) => item.householdId), ["H3"]);
  assert.deepEqual(filterOutreachHouseholds(households, new Set(["H1", "H3", "H3"]), "").map((item) => item.householdId), ["H1", "H3"]);
});

test("regular servants stay read-only while elevated congregation roles retain editing", () => {
  assert.equal(canEditCongregation(["servant"]), false);
  assert.equal(canEditCongregation(["outreach_admin"]), true);
  assert.equal(canEditCongregation(["admin"]), true);
  assert.equal(canEditCongregation(["priest"]), true);
});

test("household Outreach timeline renders and records an activity through the API", async () => {
  const originalGet = api.get;
  const originalPost = api.post;
  const posts: Array<{ path: string; body: unknown }> = [];
  api.get = async <T,>(path: string) => {
    if (path.endsWith("/activities")) return { items: [{ activityId: "a1", activityType: "Visit", activityDate: "2026-09-10", groupName: "North", createdByName: "Servant", comment: "Existing note" }] } as T;
    return { items: [{ groupId: "g1", name: "North", active: true }] } as T;
  };
  api.post = async <T,>(path: string, body?: unknown) => { posts.push({ path, body }); return {} as T; };
  try {
    render(createElement(HouseholdOutreachSection, { householdId: "H1" }));
    assert.ok(await screen.findByText("Existing note"));
    fireEvent.click(screen.getByRole("button", { name: "Record Outreach Activity" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "New note" } });
    fireEvent.click(screen.getByRole("button", { name: "Record activity" }));
    await waitFor(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], { path: "/outreach/households/H1/activities", body: { groupId: "g1", activityDate: posts[0].body && (posts[0].body as { activityDate: string }).activityDate, activityType: "Visit", comment: "New note" } });
  } finally { api.get = originalGet; api.post = originalPost; }
});
