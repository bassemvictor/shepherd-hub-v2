import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagFilterPopover, type TagFilterValue } from "../../src/components/tags/tag-filter-popover";
import { ActiveTagFilters } from "../../src/components/tags/active-tag-filters";
import { CompactFilterBar } from "../../src/components/reports/compact-filter-bar";
import type { Tag } from "../../shared/types";

const tags: Tag[] = ["Newcomer", "Youth", "Senior", "Family", "Care", "Follow-up", "Volunteer", "Choir"].map(
  (name, index) => ({
    tagId: `tag-${index}`,
    name,
    normalizedName: name.toLowerCase(),
    target: "both",
    active: true,
    color: "#2563eb",
    assignmentCount: 0,
    tenantId: "test",
    entityType: "TAG",
    createdAt: "",
    updatedAt: "",
  }),
);
afterEach(cleanup);
function Harness({ label = "Member Tags", count = 3 }: { label?: string; count?: number }) {
  const [value, setValue] = useState<TagFilterValue>({ ids: [], mode: "any" });
  return (
    <>
      <TagFilterPopover label={label} tags={tags.slice(0, count)} value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
      <button type="button">Outside</button>
    </>
  );
}
const value = () => JSON.parse(screen.getByTestId("value").textContent!);

for (const label of ["Member Tags", "Household Tags"]) {
  test(`${label} opens, applies selections, cancels with Escape and outside click`, () => {
    render(<Harness label={label} />);
    const trigger = screen.getByRole("button", { name: `${label}: Any` });
    fireEvent.click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.ok(screen.getByRole("dialog", { name: label }));
    assert.equal(screen.queryByRole("textbox"), null);
    fireEvent.click(screen.getByRole("checkbox", { name: "Newcomer" }));
    assert.deepEqual(value().ids, []);
    fireEvent.keyDown(document, { key: "Escape" });
    assert.equal(screen.queryByRole("dialog"), null);
    assert.equal(document.activeElement, trigger);
    fireEvent.click(trigger);
    assert.equal(screen.getByRole("checkbox", { name: "Newcomer" }).getAttribute("aria-checked"), "false");
    fireEvent.click(screen.getByRole("checkbox", { name: "Newcomer" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    assert.deepEqual(value(), { ids: ["tag-0"], mode: "any" });
    fireEvent.click(screen.getByRole("button", { name: `${label}: Newcomer` }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Youth" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    assert.equal(screen.queryByRole("dialog"), null);
    assert.deepEqual(value().ids, ["tag-0"]);
  });
}

test("multiple tags reveal Any/All, summary count, and transactional Clear", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Member Tags: Any" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Newcomer" }));
  assert.equal(screen.queryByRole("group", { name: "Member Tags match mode" }), null);
  fireEvent.click(screen.getByRole("checkbox", { name: "Youth" }));
  assert.equal(screen.getByRole("button", { name: "Any", exact: true }).getAttribute("aria-pressed"), "true");
  fireEvent.click(screen.getByRole("button", { name: "All", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  assert.deepEqual(value(), { ids: ["tag-0", "tag-1"], mode: "all" });
  fireEvent.click(screen.getByRole("button", { name: "Member Tags: Newcomer +1" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear", exact: true }));
  assert.equal(screen.queryByRole("group", { name: "Member Tags match mode" }), null);
  assert.equal(value().ids.length, 2);
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  assert.deepEqual(value(), { ids: [], mode: "any" });
});

test("search appears only above seven tags and filters rows", () => {
  const view = render(<Harness count={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Member Tags: Any" }));
  assert.equal(screen.queryByRole("textbox"), null);
  view.unmount();
  render(<Harness count={8} />);
  fireEvent.click(screen.getByRole("button", { name: "Member Tags: Any" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search member tags" }), { target: { value: "yOu" } });
  assert.equal(screen.getAllByRole("checkbox").length, 1);
  assert.ok(screen.getByRole("checkbox", { name: "Youth" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "nothing" } });
  assert.ok(screen.getByText("No matching tags."));
});

test("active pills distinguish household tags, remove individually and clear tags", () => {
  function Pills() {
    const [memberIds, setMembers] = useState(["tag-0"]);
    const [householdIds, setHouseholds] = useState(["tag-1"]);
    return (
      <ActiveTagFilters
        tags={tags}
        memberIds={memberIds}
        householdIds={householdIds}
        onRemove={(target, id) =>
          target === "member"
            ? setMembers(memberIds.filter((value) => value !== id))
            : setHouseholds(householdIds.filter((value) => value !== id))
        }
        onClear={() => {
          setMembers([]);
          setHouseholds([]);
        }}
      />
    );
  }
  render(<Pills />);
  assert.ok(screen.getByText("Household:"));
  fireEvent.click(screen.getByRole("button", { name: "Remove member tag Newcomer" }));
  assert.equal(screen.queryByText("Newcomer"), null);
  assert.ok(screen.getByText("Youth"));
  fireEvent.click(screen.getByRole("button", { name: "Clear tag filters" }));
  assert.equal(screen.queryByLabelText("Active tag filters"), null);
});

test("mobile panel fits viewport, and focus leaving closes it", () => {
  Object.defineProperty(window, "innerWidth", { value: 320, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 480, configurable: true });
  render(<Harness count={8} />);
  fireEvent.click(screen.getByRole("button", { name: "Member Tags: Any" }));
  const panel = screen.getByRole("dialog");
  assert.equal(panel.style.width, "304px");
  assert.equal(panel.style.left, "8px");
  assert.ok(Number.parseInt(panel.style.top) + Number.parseInt(panel.style.maxHeight) <= 480);
  fireEvent.focusIn(screen.getByRole("button", { name: "Outside" }));
  assert.equal(screen.queryByRole("dialog"), null);
});

test("existing toolbar filter callbacks, report execution and export remain connected", () => {
  const calls: string[] = [];
  render(
    <CompactFilterBar
      search=""
      onSearchChange={(v) => calls.push(`search:${v}`)}
      period="last_90_days"
      onPeriodChange={(v) => calls.push(`period:${v}`)}
      onVisitorChange={(v) => calls.push(`visitor:${v}`)}
      visitors={[{ visitorUserId: "priest", visitorDisplayName: "Priest" }]}
      visitationType="all"
      onVisitationTypeChange={(v) => calls.push(`type:${v}`)}
      sortBy="member_name"
      sortDirection="asc"
      onSortChange={(v) => calls.push(`sort:${v.sortBy}`)}
      showFilter="everyone"
      onShowFilterChange={(v) => calls.push(`show:${v}`)}
      onRunReport={() => calls.push("run")}
      onExport={() => calls.push("export")}
      scope="everyone"
      tagControls={<Harness />}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("Search members"), { target: { value: "Mary" } });
  fireEvent.change(screen.getByLabelText("Show"), { target: { value: "never_visited" } });
  fireEvent.change(screen.getByLabelText("Period"), { target: { value: "all_time" } });
  fireEvent.change(screen.getByLabelText("Caregiver"), { target: { value: "priest" } });
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "Visitation" } });
  fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "visit_count_desc" } });
  fireEvent.click(screen.getByRole("button", { name: "Run Report" }));
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  assert.deepEqual(calls, [
    "search:Mary",
    "show:never_visited",
    "period:all_time",
    "visitor:priest",
    "type:Visitation",
    "sort:visit_count",
    "run",
    "export",
  ]);
});

test("keyboard Tab, Enter and Space operate tag controls and restore focus", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.tab();
  const trigger = screen.getByRole("button", { name: "Member Tags: Any" });
  assert.equal(document.activeElement, trigger);
  await user.keyboard("{Enter}");
  assert.ok(screen.getByRole("dialog"));
  await user.tab();
  assert.equal(document.activeElement, screen.getByRole("checkbox", { name: "Newcomer" }));
  await user.keyboard(" ");
  assert.equal(screen.getByRole("checkbox", { name: "Newcomer" }).getAttribute("aria-checked"), "true");
  await user.tab();
  await user.keyboard("{Enter}");
  assert.equal(screen.getByRole("checkbox", { name: "Youth" }).getAttribute("aria-checked"), "true");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  assert.deepEqual(value().ids, ["tag-0", "tag-1"]);
  assert.equal(document.activeElement, trigger);
});
