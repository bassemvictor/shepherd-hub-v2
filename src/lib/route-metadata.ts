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

const isMemberDetailPath = (pathname: string) => /^\/members\/[^/]+$/.test(pathname);

export const getPageTitle = (pathname: string) =>
  isMemberDetailPath(pathname)
    ? "Member Details"
    :
  routeTitleMap[pathname] ??
  formatTitle(pathname.split("/").filter(Boolean).slice(-1)[0] ?? "Members");

export const getBreadcrumbs = (pathname: string): Array<{ label: string; href?: string }> => {
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
