import { ReportPlaceholderPage } from "../components/reports/report-placeholder-page";

export const MyVisitationsPage = () => (
  <ReportPlaceholderPage
    subtitle="Track visits performed by the current user across week, month, year, and custom ranges."
    title="My Visitations"
  />
);

export const NotVisitedPage = () => (
  <ReportPlaceholderPage
    subtitle="Review members with zero visits in the selected reporting range."
    title="Not Visited"
  />
);

export const LowVisitationPage = () => (
  <ReportPlaceholderPage
    subtitle="Surface members with low visitation counts compared with the selected threshold."
    title="Low Visitation"
  />
);

export const VisitorPerformancePage = () => (
  <ReportPlaceholderPage
    subtitle="Compare visitor activity across week, month, year, total visits, and unique members reached."
    title="Visitor Performance"
  />
);

export const MemberEngagementPage = () => (
  <ReportPlaceholderPage
    subtitle="Review member-level visitation frequency, recency, and engagement status."
    title="Member Engagement"
  />
);

export const VisitTrendsPage = () => (
  <ReportPlaceholderPage
    subtitle="Visualize visitation trends over time, including repeat visits and coverage gaps."
    title="Visit Trends"
  />
);

export const CustomReportPage = () => (
  <ReportPlaceholderPage
    subtitle="Compose custom visitation reports by combining filters and alternate report views."
    title="Custom Report"
  />
);
