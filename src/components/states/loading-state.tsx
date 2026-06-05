type LoadingStateProps = {
  title?: string;
  description?: string;
};

export const LoadingState = ({
  title = "Loading",
  description = "Please wait while data is being prepared.",
}: LoadingStateProps) => (
  <div className="rounded-md border border-border bg-white p-4 text-center panel-shadow">
    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
    <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
  </div>
);
