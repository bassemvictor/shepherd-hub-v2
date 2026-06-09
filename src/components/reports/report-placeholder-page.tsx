import { ReportsLayout } from "./reports-layout";

export const ReportPlaceholderPage = ({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) => (
  <ReportsLayout subtitle={subtitle} title={title}>
    <div className="rounded-lg border border-dashed border-border bg-white px-4 py-8 text-center text-sm text-muted-foreground panel-shadow">
      This report page is scaffolded and ready for the next implementation pass.
    </div>
  </ReportsLayout>
);
