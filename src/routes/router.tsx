import { createBrowserRouter, Navigate } from "react-router-dom";

import { ProtectedRoute } from "../components/auth/protected-route";
import { AppShell } from "../components/layout/app-shell";
import { AuthPage } from "../pages/auth-page";
import { CalendarSettingsPage } from "../pages/calendar-settings-page";
import { MemberDetailPage } from "../pages/member-detail-page";
import { MembersPage } from "../pages/members-page";
import { NotFoundPage } from "../pages/not-found-page";
import {
  CustomReportPage,
  LowVisitationPage,
  MemberEngagementPage,
  MyVisitationsPage,
  NotVisitedPage,
  VisitTrendsPage,
  VisitorPerformancePage,
} from "../pages/reports-pages";
import { SchedulePage } from "../pages/schedule-page";
import { VisitationReportsPage } from "../pages/visitation-reports-page";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate replace to="/members" />,
  },
  {
    path: "/auth",
    element: <AuthPage />,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      {
        path: "calendar",
        element: <CalendarSettingsPage />,
      },
      {
        path: "calendar/schedule",
        element: <SchedulePage />,
      },
      {
        path: "members",
        element: <MembersPage />,
      },
      {
        path: "reports/visitations",
        element: <VisitationReportsPage />,
      },
      {
        path: "reports/my-visitations",
        element: <MyVisitationsPage />,
      },
      {
        path: "reports/not-visited",
        element: <NotVisitedPage />,
      },
      {
        path: "reports/low-visitation",
        element: <LowVisitationPage />,
      },
      {
        path: "reports/visitor-performance",
        element: <VisitorPerformancePage />,
      },
      {
        path: "reports/member-engagement",
        element: <MemberEngagementPage />,
      },
      {
        path: "reports/visit-trends",
        element: <VisitTrendsPage />,
      },
      {
        path: "reports/custom",
        element: <CustomReportPage />,
      },
      {
        path: "members/:memberId",
        element: <MemberDetailPage />,
      },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
]);
