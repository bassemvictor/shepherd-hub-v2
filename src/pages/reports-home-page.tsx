import { ArrowRight, ChartColumnBig, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";

import { ReportsLayout } from "../components/reports/reports-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const reportDestinations = [
  {
    title: "Reports Dashboard",
    description: "See the high-level visitation picture, spot gaps quickly, and jump into follow-up work.",
    href: "/reports/dashboard",
    icon: ChartColumnBig,
  },
  {
    title: "Member Report",
    description: "Review detailed member-level results with filters, sorting, paging, and export-ready data.",
    href: "/reports/member-visitation",
    icon: UsersRound,
  },
] as const;

export const ReportsHomePage = () => (
  <ReportsLayout
    subtitle="Open the report you need from one simple reporting hub."
    title="Reports"
  >
    <Card className="border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,247,251,0.96)_100%)]">
      <CardHeader className="gap-2 pb-2">
        <CardTitle className="text-xl text-foreground">Choose a report</CardTitle>
        <CardDescription className="max-w-2xl text-sm">
          Start from the main dashboard for a quick overview, or open the member report for a detailed list.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-2 md:grid-cols-2">
        {reportDestinations.map((report) => {
          const Icon = report.icon;

          return (
            <Link
              className="group rounded-lg border border-border/80 bg-white p-4 transition-colors hover:border-primary/35 hover:bg-accent/40"
              key={report.href}
              to={report.href}
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-foreground">{report.title}</h2>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{report.description}</p>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  </ReportsLayout>
);
