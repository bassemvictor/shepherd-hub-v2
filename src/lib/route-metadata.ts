import { formatTitle } from "./utils";

const routeTitleMap: Record<string, string> = {
  "/": "Congregation",
  "/calendar": "Connect & Configure",
  "/calendar/schedule": "Schedule",
  "/members": "Congregation",
  "/reports/visitations": "Reports Dashboard",
  "/reports/dashboard": "Reports Dashboard",
  "/reports/member-visitation": "Member Visitation",
  "/auth": "Sign In",
};

const breadcrumbMap: Record<string, Array<{ label: string; href?: string }>> = {
  "/calendar": [{ label: "Configurations" }, { label: "Connect & Configure" }],
  "/calendar/schedule": [{ label: "Calendar" }, { label: "Schedule" }],
  "/members": [{ label: "Congregation" }],
  "/reports/dashboard": [{ label: "Reports" }, { label: "Reports Dashboard" }],
  "/reports/member-visitation": [{ label: "Reports" }, { label: "Member Visitation" }],
  "/auth": [{ label: "Sign In" }],
};

const isMemberDetailPath = (pathname: string) => /^\/members\/[^/]+$/.test(pathname);

export const getPageTitle = (pathname: string) =>
  isMemberDetailPath(pathname)
    ? "Member Details"
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
        : formatTitle(segment),
    href: index === segments.length - 1 ? undefined : `/${segments.slice(0, index + 1).join("/")}`,
  }));
};
