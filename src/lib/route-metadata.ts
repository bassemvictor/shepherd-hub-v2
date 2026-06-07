import { formatTitle } from "./utils";

const routeTitleMap: Record<string, string> = {
  "/": "Dashboard",
  "/dashboard": "Dashboard",
  "/records": "Sample Records",
  "/calendar": "Connect & Configure",
  "/calendar/schedule": "Schedule",
  "/members": "Congregation",
  "/auth": "Sign In",
};

export const getPageTitle = (pathname: string) =>
  routeTitleMap[pathname] ??
  formatTitle(pathname.split("/").filter(Boolean).slice(-1)[0] ?? "Dashboard");

export const getBreadcrumbs = (pathname: string): Array<{ label: string; href?: string }> => {
  const segments = pathname.split("/").filter(Boolean);

  if (!segments.length) {
    return [{ label: "Dashboard" }];
  }

  return segments.map((segment, index) => ({
    label: formatTitle(segment),
    href: index === segments.length - 1 ? undefined : `/${segments.slice(0, index + 1).join("/")}`,
  }));
};
