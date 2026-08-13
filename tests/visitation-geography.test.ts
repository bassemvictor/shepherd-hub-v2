import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveClusterSummary,
  formatCoveragePercent,
  getClusterCoverageTone,
} from "../shared/visitation-geography.js";

test("derives cluster summary totals from aggregated household values", () => {
  const summary = deriveClusterSummary({
    households: 28,
    memberCount: 91,
    visitedCount: 18,
    visitCount: 37,
  });

  assert.deepEqual(summary, {
    households: 28,
    members: 91,
    visited: 18,
    notVisited: 10,
    coverage: (18 / 28) * 100,
    visitations: 37,
  });
  assert.equal(formatCoveragePercent(summary.coverage), "64%");
});

test("caps visited households at household count and guards invalid values", () => {
  const summary = deriveClusterSummary({
    households: 4,
    memberCount: -10,
    visitedCount: 9,
    visitCount: Number.NaN,
  });

  assert.deepEqual(summary, {
    households: 4,
    members: 0,
    visited: 4,
    notVisited: 0,
    coverage: 100,
    visitations: 0,
  });
});

test("assigns cluster coverage tone thresholds", () => {
  assert.equal(getClusterCoverageTone(84), "positive");
  assert.equal(getClusterCoverageTone(52), "warning");
  assert.equal(getClusterCoverageTone(12), "low");
});
