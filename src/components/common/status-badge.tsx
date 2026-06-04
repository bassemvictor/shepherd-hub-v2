import type { RecordStatus } from "../../../shared/types";
import { Badge } from "../ui/badge";

const variantByStatus: Record<RecordStatus, "default" | "success" | "warning" | "neutral"> = {
  active: "success",
  archived: "neutral",
  draft: "warning",
};

export const StatusBadge = ({ status }: { status: RecordStatus }) => (
  <Badge className="capitalize" variant={variantByStatus[status]}>
    {status}
  </Badge>
);
