import { createBrowserRouter, Navigate } from "react-router-dom";

import { ProtectedRoute } from "../components/auth/protected-route";
import { RequireGroups } from "../components/auth/require-groups";
import { AppShell } from "../components/layout/app-shell";
import { AuthPage } from "../pages/auth-page";
import { AdminTenantResetPage } from "../pages/admin-tenant-reset-page";
import { AdminUserGroupsPage } from "../pages/admin-user-groups-page";
import { CalendarSettingsPage } from "../pages/calendar-settings-page";
import { MemberDetailPage } from "../pages/member-detail-page";
import { MembersPage } from "../pages/members-page";
import { NotFoundPage } from "../pages/not-found-page";
import { ReportsHomePage } from "../pages/reports-home-page";
import { ScheduleBetaPage, SchedulePage } from "../pages/schedule-page";
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
        path: "calendar/schedule-beta",
        element: <ScheduleBetaPage />,
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
        path: "reports",
        element: <ReportsHomePage />,
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
        path: "admin/user-groups",
        element: (
          <RequireGroups groups={["admin"]}>
            <AdminUserGroupsPage />
          </RequireGroups>
        ),
      },
      {
        path: "admin/tenant-reset",
        element: (
          <RequireGroups groups={["admin"]}>
            <AdminTenantResetPage />
          </RequireGroups>
        ),
      },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
]);
