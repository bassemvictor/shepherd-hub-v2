import { formatTitle } from "./utils";

const routeTitleMap: Record<string, string> = {
  "/": "Congregation",
  "/calendar": "Connect & Configure",
  "/calendar/schedule": "Schedule",
  "/calendar/schedule-beta": "Schedule",
  "/members": "Congregation",
  "/households": "Households",
  "/admin/user-groups": "User Groups",
  "/admin/jobs": "Admin Jobs",
  "/admin/household-geocoding": "Household Geocoding",
  "/admin/tenant-reset": "Tenant Reset",
  "/reports": "Reports",
  "/reports/visitations": "Reports",
  "/reports/dashboard": "Reports",
  "/reports/member-visitation": "Member Report",
  "/reports/household-conflicts": "Household Conflicts",
  "/reports/visitation-geography": "Visitation Geography Report",
  "/auth": "Sign In",
};

const breadcrumbMap: Record<string, Array<{ label: string; href?: string }>> = {
  "/calendar": [{ label: "Settings" }, { label: "Connect & Configure" }],
  "/calendar/schedule": [{ label: "Calendar" }, { label: "Schedule" }],
  "/calendar/schedule-beta": [{ label: "Calendar" }, { label: "Schedule" }],
  "/members": [{ label: "Congregation" }],
  "/households": [{ label: "Congregation" }, { label: "Households" }],
  "/admin/user-groups": [{ label: "Admin" }, { label: "User Groups" }],
  "/admin/jobs": [{ label: "Admin" }, { label: "Admin Jobs" }],
  "/admin/household-geocoding": [{ label: "Admin" }, { label: "Household Geocoding" }],
  "/admin/tenant-reset": [{ label: "Admin" }, { label: "Tenant Reset" }],
  "/reports": [{ label: "Insights" }, { label: "Reports" }],
  "/reports/dashboard": [{ label: "Insights" }, { label: "Reports" }],
  "/reports/member-visitation": [{ label: "Insights" }, { label: "Member Report" }],
  "/reports/household-conflicts": [{ label: "Insights" }, { label: "Household Conflicts" }],
  "/reports/visitation-geography": [{ label: "Insights" }, { label: "Visitation Geography Report" }],
  "/auth": [{ label: "Sign In" }],
};

const isMemberDetailPath = (pathname: string) => /^\/members\/[^/]+$/.test(pathname);
const isHouseholdDetailPath = (pathname: string) => /^\/households\/[^/]+$/.test(pathname);

export const getPageTitle = (pathname: string) =>
  isMemberDetailPath(pathname)
    ? "Member Details"
    : isHouseholdDetailPath(pathname)
    ? "Household Details"
    :
  routeTitleMap[pathname] ??
  formatTitle(pathname.split("/").filter(Boolean).slice(-1)[0] ?? "Members");

export const getBreadcrumbs = (pathname: string): Array<{ label: string; href?: string }> => {
  const mappedBreadcrumbs = breadcrumbMap[pathname];

  if (mappedBreadcrumbs) {
    return mappedBreadcrumbs.map((crumb, index) => ({
      ...crumb,
      href: index === mappedBreadcrumbs.length - 1 ? undefined : crumb.href,
    }));
  }

  const segments = pathname.split("/").filter(Boolean);

  if (!segments.length) {
    return [{ label: "Congregation" }];
  }

  return segments.map((segment, index) => ({
    label:
      pathname.startsWith("/members/")
      && index === segments.length - 1
      && segments.length === 2
        ? "Member Details"
        : pathname.startsWith("/households/")
        && index === segments.length - 1
        && segments.length === 2
          ? "Household Details"
        : formatTitle(segment),
    href: index === segments.length - 1 ? undefined : `/${segments.slice(0, index + 1).join("/")}`,
  }));
};
