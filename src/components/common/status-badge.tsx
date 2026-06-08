import { Badge } from "../ui/badge";

type StatusBadgeState = "active" | "archived" | "draft";

const variantByStatus: Record<StatusBadgeState, "default" | "success" | "warning" | "neutral"> = {
  active: "success",
  archived: "neutral",
  draft: "warning",
};

export const StatusBadge = ({ status }: { status: StatusBadgeState }) => (
  <Badge className="capitalize" variant={variantByStatus[status]}>
    {status}
  </Badge>
);
