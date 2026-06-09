import { ErrorState } from "../states/error-state";
import { EmptyState } from "../states/empty-state";
import { LoadingState } from "../states/loading-state";

export const ReportLoadingState = () => (
  <LoadingState description="Loading report data." title="Preparing report" />
);

export const ReportErrorState = ({
  description,
}: {
  description: string;
}) => (
  <ErrorState description={description} title="Unable to load report" />
);

export const ReportEmptyState = ({
  description = "No members match this report.",
}: {
  description?: string;
}) => (
  <EmptyState description={description} title="No matching members" />
);
