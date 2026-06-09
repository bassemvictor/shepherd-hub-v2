import type { ReactNode } from "react";

import { PageHeader } from "../common/page-header";

export const ReportsLayout = ({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <div className="space-y-3">
    <PageHeader
      className="overflow-hidden rounded-lg border border-border bg-white p-3"
      description={subtitle}
      title={title}
    >
      {actions}
    </PageHeader>
    {children}
  </div>
);
