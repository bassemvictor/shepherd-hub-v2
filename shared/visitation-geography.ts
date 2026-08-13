export type ClusterSummaryInput = {
  households: number;
  memberCount: number;
  visitedCount: number;
  visitCount: number;
};

export type ClusterSummary = {
  households: number;
  members: number;
  visited: number;
  notVisited: number;
  coverage: number;
  visitations: number;
};

export type ClusterCoverageTone = "positive" | "warning" | "low";

const toSafeCount = (value: number) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

export const deriveClusterSummary = ({
  households,
  memberCount,
  visitedCount,
  visitCount,
}: ClusterSummaryInput): ClusterSummary => {
  const safeHouseholds = toSafeCount(households);
  const safeMembers = toSafeCount(memberCount);
  const safeVisited = Math.min(toSafeCount(visitedCount), safeHouseholds);
  const safeVisitations = toSafeCount(visitCount);
  const notVisited = Math.max(0, safeHouseholds - safeVisited);
  const coverage = safeHouseholds ? (safeVisited / safeHouseholds) * 100 : 0;

  return {
    households: safeHouseholds,
    members: safeMembers,
    visited: safeVisited,
    notVisited,
    coverage,
    visitations: safeVisitations,
  };
};

export const getClusterCoverageTone = (coverage: number): ClusterCoverageTone => {
  if (coverage >= 70) {
    return "positive";
  }

  if (coverage >= 40) {
    return "warning";
  }

  return "low";
};

export const formatCoveragePercent = (coverage: number) => `${Math.round(coverage)}%`;
