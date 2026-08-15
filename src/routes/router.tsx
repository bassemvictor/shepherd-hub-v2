import { createBrowserRouter, Navigate } from "react-router-dom";

import { ProtectedRoute } from "../components/auth/protected-route";
import { RequireGroups } from "../components/auth/require-groups";
import { AppShell } from "../components/layout/app-shell";
import { AuthPage } from "../pages/auth-page";
import { AdminJobsPage } from "../pages/admin-jobs-page";
import { AdminTenantResetPage } from "../pages/admin-tenant-reset-page";
import { AdminUserGroupsPage } from "../pages/admin-user-groups-page";
import { CalendarSettingsPage } from "../pages/calendar-settings-page";
import { HouseholdDetailPage } from "../pages/household-detail-page";
import { HouseholdConflictsReportPage } from "../pages/household-conflicts-report-page";
import { HouseholdsPage } from "../pages/households-page";
import { MemberDetailPage } from "../pages/member-detail-page";
import { MembersPage } from "../pages/members-page";
import { NotFoundPage } from "../pages/not-found-page";
import { ReportsHomePage } from "../pages/reports-home-page";
import { LegacyScheduleBetaRedirectPage, SchedulePage } from "../pages/schedule-page";
import { VisitationGeographyReportPage } from "../pages/visitation-geography-report-page";
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
        element: <LegacyScheduleBetaRedirectPage />,
      },
      {
        path: "members",
        element: <MembersPage />,
      },
      {
        path: "households",
        element: <HouseholdsPage />,
      },
      {
        path: "households/:householdId",
        element: <HouseholdDetailPage />,
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
        path: "reports/household-conflicts",
        element: <HouseholdConflictsReportPage />,
      },
      {
        path: "reports/visitation-geography",
        element: <VisitationGeographyReportPage />,
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
        path: "admin/jobs",
        element: (
          <RequireGroups groups={["admin"]}>
            <AdminJobsPage />
          </RequireGroups>
        ),
      },
      {
        path: "admin/household-geocoding",
        element: <Navigate replace to="/admin/jobs" />,
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
