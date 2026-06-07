import { createBrowserRouter, Navigate } from "react-router-dom";

import { ProtectedRoute } from "../components/auth/protected-route";
import { AppShell } from "../components/layout/app-shell";
import { AuthPage } from "../pages/auth-page";
import { CalendarSettingsPage } from "../pages/calendar-settings-page";
import { DashboardPage } from "../pages/dashboard-page";
import { MemberDetailPage } from "../pages/member-detail-page";
import { MembersPage } from "../pages/members-page";
import { NotFoundPage } from "../pages/not-found-page";
import { SampleRecordsPage } from "../pages/sample-records-page";
import { SchedulePage } from "../pages/schedule-page";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate replace to="/dashboard" />,
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
        path: "dashboard",
        element: <DashboardPage />,
      },
      {
        path: "records",
        element: <SampleRecordsPage />,
      },
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
