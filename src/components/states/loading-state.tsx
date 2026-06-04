type LoadingStateProps = {
  title?: string;
  description?: string;
};

export const LoadingState = ({
  title = "Loading",
  description = "Please wait while data is being prepared.",
}: LoadingStateProps) => (
  <div className="rounded-[1.4rem] border border-border bg-white p-8 text-center panel-shadow">
    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
    <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
    <p className="mt-2 text-sm text-muted-foreground">{description}</p>
  </div>
);
