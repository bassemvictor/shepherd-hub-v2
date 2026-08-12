import { ChartColumnBig, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";

import { ReportsLayout } from "../components/reports/reports-layout";

const reportDestinations = [
  {
    title: "Visitation Dashboard",
    href: "/reports/dashboard",
    icon: ChartColumnBig,
  },
  {
    title: "Member Visitation Report",
    href: "/reports/member-visitation",
    icon: UsersRound,
  },
  {
    title: "Household Conflicts",
    href: "/reports/household-conflicts",
    icon: UsersRound,
  },
] as const;

export const ReportsHomePage = () => (
  <ReportsLayout title="Reports">
    <div className="min-h-[calc(100vh-15rem)] rounded-[1.5rem] border border-border/60 bg-[linear-gradient(180deg,#f8fafc_0%,#f3f6fb_100%)] px-4 py-5 dark:bg-[linear-gradient(180deg,#0d1728_0%,#0a1220_100%)] sm:px-6 sm:py-8 lg:px-10 lg:py-12">
      <div className="mx-auto flex max-w-5xl justify-center">
        <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {reportDestinations.map((report) => {
            const Icon = report.icon;

            return (
              <Link
                className="group flex min-h-[124px] flex-col items-center justify-center rounded-[1.35rem] border border-slate-200/80 bg-card px-4 py-4 text-center shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)] dark:border-border/90 dark:shadow-[0_18px_40px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 sm:aspect-square sm:min-h-[138px] sm:rounded-[1.3rem] sm:px-4 sm:py-4"
                key={report.href}
                to={report.href}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-[1rem] bg-primary/8 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-transform duration-200 group-hover:scale-[1.03] dark:bg-primary/12 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] sm:h-12 sm:w-12 sm:rounded-[0.95rem]">
                  <Icon className="h-6 w-6 stroke-[1.8] sm:h-6 sm:w-6" />
                </div>
                <h2 className="mt-3 max-w-[11rem] text-[0.98rem] font-semibold tracking-[-0.01em] text-slate-900 dark:text-foreground sm:mt-3 sm:max-w-[10rem] sm:text-[0.98rem]">
                  {report.title}
                </h2>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  </ReportsLayout>
);
