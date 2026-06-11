import { createBrowserRouter, Navigate } from "react-router-dom";

import { ProtectedRoute } from "../components/auth/protected-route";
import { AppShell } from "../components/layout/app-shell";
import { AuthPage } from "../pages/auth-page";
import { CalendarSettingsPage } from "../pages/calendar-settings-page";
import { MemberDetailPage } from "../pages/member-detail-page";
import { MembersPage } from "../pages/members-page";
import { NotFoundPage } from "../pages/not-found-page";
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
        element: <Navigate replace to="/reports/dashboard" />,
      },
      {
        path: "reports/dashboard",
        element: <VisitationReportsPage reportView="dashboard" />,
      },
      {
        path: "reports/member-visitation",
        element: <VisitationReportsPage reportView="members" />,
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
